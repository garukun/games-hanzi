#!/usr/bin/env node
/**
 * Build the offline asset pack used by the print tool (printer/).
 *
 *   node printer/scripts/print-assets.mjs                    # everything (compact)
 *   node printer/scripts/print-assets.mjs strokes            # 2-tier stroke/median bundles (Make Me a Hanzi)
 *   node printer/scripts/print-assets.mjs strokes --pretty   # formatted JSON for dev inspection
 *   node printer/scripts/print-assets.mjs emoji              # Fluent Emoji (Flat) + illustration map + catalog
 *   node printer/scripts/print-assets.mjs font               # LXGW WenKai subset (needs python3 fonttools+brotli)
 *
 * Network downloads are cached in printer/scripts/.cache so re-runs are cheap.
 * Outputs (all committed):
 *   - printer/assets/strokes/hanzi-strokes-core-1000.json        (Tier 1: built-in 1,000 curriculum chars)
 *   - printer/assets/strokes/hanzi-strokes-extended-gb2312.json  (Tier 2: remaining 2,757 GB2312 Level-1 chars)
 *   - printer/assets/emoji/*.svg
 *   - printer/assets/fonts/*.woff2
 *   - printer/data/illustrations.json, printer/data/emoji-catalog.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cleanStrokeMedians, smoothMedianToPath } from '../js/hanzi-data.js';

export { cleanStrokeMedians, smoothMedianToPath };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(root, 'scripts', '.cache');
const OUT = root;
const require = createRequire(import.meta.url);
mkdirSync(CACHE, { recursive: true });

/* ----------------------------------------------------------------- helpers */

async function download(url, file, { binary = false } = {}) {
  if (existsSync(file)) return readFileSync(file, binary ? undefined : 'utf8');
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, buf);
      return binary ? buf : buf.toString('utf8');
    } catch (e) {
      if (attempt === 4) throw new Error(`download failed ${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

function gb2312Level1() {
  const dec = new TextDecoder('gb2312');
  const out = [];
  for (let hi = 0xb0; hi <= 0xd7; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      const ch = dec.decode(new Uint8Array([hi, lo]));
      if (ch.length === 1 && /\p{Script=Han}/u.test(ch)) out.push(ch);
    }
  }
  return out;
}

/** Character list of the newest spec/data/hanzi-1000-v*.json (the illustration map covers these). */
export function latestDataFile() {
  const dir = join(root, 'spec', 'data');
  const files = readdirSync(dir)
    .filter((f) => /^hanzi-1000-v\d+\.json$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/g)[1]) - Number(b.match(/\d+/g)[1]));
  return join(dir, files[files.length - 1]);
}

function v5Chars() {
  const j = JSON.parse(readFileSync(latestDataFile(), 'utf8'));
  return j.groups.flatMap((g) => g.characters.map((c) => c.char));
}

const stripVS = (s) => s.replace(/\uFE0F/g, '');

/* ------------------------------------------------------------------ hanzi */

async function buildHanzi({ pretty = false } = {}) {
  console.log('[strokes] loading Make Me a Hanzi data…');
  const base = 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/';
  const gfx = await download(base + 'graphics.txt', join(CACHE, 'graphics.txt'));
  const dict = await download(base + 'dictionary.txt', join(CACHE, 'dictionary.txt'));

  const coreCharList = v5Chars();
  const coreSet = new Set(coreCharList);
  const gbList = gb2312Level1();
  const wanted = new Set([...coreCharList, ...gbList]);

  const radicals = new Map();
  for (const line of dict.split('\n')) {
    if (!line.trim()) continue;
    const d = JSON.parse(line);
    if (wanted.has(d.character)) radicals.set(d.character, d.radical || '');
  }

  const entriesByChar = new Map();
  for (const line of gfx.split('\n')) {
    if (!line.trim()) continue;
    const g = JSON.parse(line);
    if (!wanted.has(g.character)) continue;
    const m = Array.isArray(g.medians) ? g.medians.map(smoothMedianToPath).filter(Boolean) : undefined;
    entriesByChar.set(g.character, {
      s: g.strokes,
      ...(m && m.length > 0 ? { m } : {}),
      r: radicals.get(g.character) || '',
      n: g.strokes.length,
    });
  }

  // Order Tier 1 (core-1000) in curriculum order and Tier 2 (extended-gb2312) in GB2312 order
  const coreBundle = {};
  for (const ch of coreCharList) {
    if (entriesByChar.has(ch)) coreBundle[ch] = entriesByChar.get(ch);
  }
  const extendedBundle = {};
  for (const ch of gbList) {
    if (!coreSet.has(ch) && entriesByChar.has(ch)) {
      extendedBundle[ch] = entriesByChar.get(ch);
    }
  }

  // Clean up legacy hex-shard directory if present
  rmSync(join(OUT, 'assets', 'hanzi'), { recursive: true, force: true });

  const dir = join(OUT, 'assets', 'strokes');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const indent = pretty ? 2 : undefined;
  const coreText = JSON.stringify(coreBundle, null, indent);
  const extText = JSON.stringify(extendedBundle, null, indent);
  const coreFile = join(dir, 'hanzi-strokes-core-1000.json');
  const extFile = join(dir, 'hanzi-strokes-extended-gb2312.json');

  writeFileSync(coreFile, coreText);
  writeFileSync(extFile, extText);

  const missing = coreCharList.filter((c) => !entriesByChar.has(c));
  console.log(
    `[strokes] built 2-tier bundles (${pretty ? 'pretty' : 'compact'}):\n` +
      `  - hanzi-strokes-core-1000.json:       ${Object.keys(coreBundle).length} chars (${(coreText.length / 1e6).toFixed(2)} MB)\n` +
      `  - hanzi-strokes-extended-gb2312.json: ${Object.keys(extendedBundle).length} chars (${(extText.length / 1e6).toFixed(2)} MB)`,
  );
  if (missing.length) console.warn('[strokes] curriculum characters missing stroke data:', missing.join(''));
}

/* ------------------------------------------------------------------ emoji */

const FLUENT_RAW = 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/';

async function loadFluentIndex() {
  const treeFile = join(CACHE, 'fluent-tree.json');
  const tree = JSON.parse(
    await download('https://api.github.com/repos/microsoft/fluentui-emoji/git/trees/main?recursive=1', treeFile),
  );
  const paths = tree.tree.map((t) => t.path);
  const dirs = [...new Set(paths.filter((p) => /^assets\/[^/]+$/.test(p)))].map((p) => p.slice(7));
  const flat = new Map(); // dir -> relative svg path
  for (const p of paths) {
    const m = p.match(/^assets\/([^/]+)\/(?:(Default)\/)?Flat\/[^/]+\.svg$/);
    if (m && (!flat.has(m[1]) || m[2] === 'Default')) flat.set(m[1], p);
  }
  return { dirs, flat };
}

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function parseIllustrationSource() {
  const text = readFileSync(join(OUT, 'data', 'illustrations.src.txt'), 'utf8');
  const entries = new Map();
  const problems = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    for (const tok of line.split(/\s+/)) {
      const m = tok.match(/^(\p{Script=Han}):(.+?)(?:\*(\d+))?$/u);
      if (!m) {
        problems.push(`bad token: ${tok}`);
        continue;
      }
      const [, ch, art, n] = m;
      if (entries.has(ch)) problems.push(`duplicate mapping for ${ch}`);
      entries.set(ch, art === '-' ? { g: 1 } : { glyph: art, n: n ? Number(n) : undefined });
    }
  }
  return { entries, problems };
}

async function buildEmoji() {
  console.log('[emoji] loading Fluent Emoji index…');
  const { dirs, flat } = await loadFluentIndex();

  // metadata.json per emoji (glyph, cldr name, keywords) – needed to resolve glyph -> folder.
  const meta = new Map();
  await pool(dirs, 12, async (dir) => {
    const url = FLUENT_RAW + 'assets/' + encodeURI(dir) + '/metadata.json';
    try {
      const text = await download(url, join(CACHE, 'meta', slug(dir) + '.json'));
      meta.set(dir, JSON.parse(text));
    } catch {
      /* some folders (skin-tone-only) have no metadata */
    }
  });
  const byGlyph = new Map();
  for (const [dir, m] of meta) {
    if (m.glyph && flat.has(dir)) byGlyph.set(stripVS(m.glyph), dir);
  }
  console.log(`[emoji] ${meta.size} metadata files, ${byGlyph.size} glyphs with a Flat svg`);

  // Resolve the hand-written illustration map.
  const { entries, problems } = parseIllustrationSource();
  const chars = v5Chars();
  const map = {};
  const used = new Map(); // dir -> id
  for (const ch of chars) {
    const e = entries.get(ch);
    if (!e) {
      problems.push(`no illustration for ${ch}`);
      continue;
    }
    if (e.g) {
      map[ch] = { g: 1 };
      continue;
    }
    const dir = byGlyph.get(stripVS(e.glyph));
    if (!dir) {
      problems.push(`unknown emoji for ${ch}: ${e.glyph}`);
      continue;
    }
    const id = slug(dir);
    used.set(dir, id);
    map[ch] = e.n && e.n > 1 ? { e: id, n: e.n } : { e: id };
  }
  for (const ch of entries.keys()) if (!chars.includes(ch)) problems.push(`mapping for char not in v5: ${ch}`);
  if (problems.length) {
    console.warn(`[emoji] ${problems.length} problems:\n  ` + problems.join('\n  '));
  }

  // Download the Flat svgs that are actually used.
  const outDir = join(OUT, 'assets', 'emoji');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  await pool([...used], 12, async ([dir, id]) => {
    const svg = await download(FLUENT_RAW + encodeURI(flat.get(dir)), join(CACHE, 'svg', id + '.svg'));
    writeFileSync(join(outDir, id + '.svg'), svg);
  });
  const glyphCount = Object.values(map).filter((v) => v.g).length;
  console.log(`[emoji] ${used.size} distinct emoji, ${glyphCount} colour-glyph illustrations`);
  writeFileSync(join(OUT, 'data', 'illustrations.json'), JSON.stringify(map));

  // Catalog for the in-app picker (all Fluent emoji; thumbnails come from the CDN).
  let zh = [];
  try {
    zh = require('emojibase-data/zh/data.json');
  } catch {
    console.warn('[emoji] emojibase-data zh not installed – catalog will be English only');
  }
  const zhByGlyph = new Map(zh.map((z) => [stripVS(z.emoji), z]));
  const catalog = [];
  for (const [dir, m] of meta) {
    if (!m.glyph || !flat.has(dir)) continue;
    const z = zhByGlyph.get(stripVS(m.glyph));
    catalog.push({
      id: slug(dir),
      g: m.glyph,
      n: m.cldr || dir,
      k: (m.keywords || []).slice(0, 8).join(' '),
      z: z ? [z.label, ...(z.tags || [])].join(' ') : '',
      p: flat.get(dir).slice(7), // path under assets/ for the CDN
    });
  }
  catalog.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(join(OUT, 'data', 'emoji-catalog.json'), JSON.stringify(catalog));
  console.log(`[emoji] catalog: ${catalog.length} entries`);
  if (problems.length) process.exitCode = 1;
}

/* ------------------------------------------------------------------- font */

async function buildFont() {
  const ttf = join(CACHE, 'LXGWWenKai-Medium.ttf');
  if (!existsSync(ttf)) {
    console.log('[font] downloading LXGW WenKai Medium (~26 MB)…');
    await download(
      'https://github.com/lxgw/LxgwWenKai/releases/download/v1.530/LXGWWenKai-Medium.ttf',
      ttf,
      { binary: true },
    );
  }
  const extra =
    ' 0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.,:;!?-–—·•…()[]{}<>/\\&%+=*#@_~|"\'“”‘’，。、：；！？（）【】《》' +
    'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹḿ' +
    '部首笔画组词笔顺练习范字描红本页生字';
  const text = [...new Set([...gb2312Level1(), ...v5Chars(), ...extra])].join('');
  const textFile = join(CACHE, 'font-chars.txt');
  writeFileSync(textFile, text);
  const outDir = join(OUT, 'assets', 'fonts');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'LXGWWenKai-subset.woff2');
  execFileSync(
    existsSync(join(CACHE, 'venv', 'bin', 'python3')) ? join(CACHE, 'venv', 'bin', 'python3') : 'python3',
    ['-m', 'fontTools.subset', ttf, `--text-file=${textFile}`, '--flavor=woff2', `--output-file=${out}`,
      '--layout-features=*', '--no-hinting', '--desubroutinize'],
    { stdio: 'inherit' },
  );
  console.log('[font] wrote', out, (readFileSync(out).length / 1e6).toFixed(2), 'MB');
}

/* ------------------------------------------------------------------- main */

const args = process.argv.slice(2);
const prettyFlag = args.includes('--pretty');
const which = args.find((a) => !a.startsWith('-')) || 'all';
if (which === 'all' || which === 'strokes' || which === 'hanzi') await buildHanzi({ pretty: prettyFlag });
if (which === 'all' || which === 'emoji') await buildEmoji();
if (which === 'all' || which === 'font') await buildFont();

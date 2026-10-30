/**
 * Unit tests for printer/js/schema.js & printer/js/illustration.js —
 * dataset validation, 1000-character illustration coverage, and JSON export merge.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PRINTER_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

test('print schema: parses printer/spec/data/hanzi-1000-v6.json cleanly with 0 errors', async () => {
  const { parseDataset } = await import('../js/schema.js');
  const raw = fs.readFileSync(path.join(PRINTER_ROOT, 'spec/data/hanzi-1000-v6.json'), 'utf8');
  const res = parseDataset(raw);
  assert.equal(res.ok, true);
  assert.equal(res.characters.length, 1000);
  assert.equal(res.groups.length, 20);
  const errors = res.issues.filter((i) => i.level === 'error');
  assert.equal(errors.length, 0);
});

test('print schema: detects malformed JSON, duplicates, >1000 chars, and words missing char', async () => {
  const { parseDataset } = await import('../js/schema.js');

  const bad = parseDataset('{not valid json');
  assert.equal(bad.ok, false);
  assert.equal(bad.issues[0].code, 'INVALID_JSON');

  const dup = parseDataset({
    groups: [
      {
        category: '测试组',
        characters: [
          { char: '四', pinyin: 'sì', words: ['四季', '外人'] },
          { char: '四', pinyin: 'sì', words: ['四个'] },
          { char: '五', pinyin: '', words: [] },
        ],
      },
    ],
  });
  assert.equal(dup.ok, true);
  assert.equal(dup.characters.length, 2);
  const codes = new Set(dup.issues.map((i) => i.code));
  assert.ok(codes.has('DUPLICATE_CHAR'));
  assert.ok(codes.has('WORD_MISSING_CHAR'));
  assert.ok(codes.has('MISSING_PINYIN'));
  assert.ok(codes.has('EMPTY_WORDS'));

  // 1001 characters
  const chars1001 = Array.from({ length: 1001 }, (_, i) => {
    const ch = String.fromCodePoint(0x4e00 + i);
    return { char: ch, pinyin: 'yī', words: [ch + '个'] };
  });
  const over = parseDataset({ groups: [{ category: '超限组', characters: chars1001 }] });
  assert.equal(over.ok, true);
  assert.equal(over.characters.length, 1000);
  assert.ok(over.issues.some((i) => i.code === 'MAX_CHARS_EXCEEDED'));
});

test('print schema: exportDatasetJson merges overrides losslessly', async () => {
  const { parseDataset, exportDatasetJson } = await import('../js/schema.js');
  const doc = parseDataset({
    meta: { title: '测试字帖' },
    groups: [
      {
        category: '第一组',
        characters: [{ char: '四', pinyin: 'sì', words: ['四个', '四季'] }],
      },
    ],
  });

  const exported = exportDatasetJson(doc, {
    四: {
      pinyin: 'sì',
      words: ['四周', '四方'],
      display_words: ['四周'],
      radical: '口',
      strokes: 5,
      image: { type: 'emoji', id: 'pineapple', count: 4 },
    },
  });

  const c0 = exported.groups[0].characters[0];
  assert.deepEqual(c0.words, ['四周', '四方']);
  assert.deepEqual(c0.display_words, ['四周']);
  assert.equal(c0.radical, '口');
  assert.equal(c0.strokes, 5);
  assert.deepEqual(c0.image, { emoji: 'pineapple', count: 4 });
});

test('print illustrations: all 1000 characters in v6 resolve to a valid local SVG or colour-glyph', async () => {
  const { parseDataset } = await import('../js/schema.js');
  const { setIllustrationAssets, resolveIllustration } = await import('../js/illustration.js');

  const rawV6 = fs.readFileSync(path.join(PRINTER_ROOT, 'spec/data/hanzi-1000-v6.json'), 'utf8');
  const illMap = JSON.parse(fs.readFileSync(path.join(PRINTER_ROOT, 'data/illustrations.json'), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(PRINTER_ROOT, 'data/emoji-catalog.json'), 'utf8'));
  setIllustrationAssets(illMap, catalog);

  const doc = parseDataset(rawV6);
  for (const c of doc.characters) {
    assert.ok(illMap[c.char], `missing illustration mapping for ${c.char}`);
    const resolved = resolveIllustration(c.char, null, illMap);
    assert.ok(resolved.type === 'emoji' || resolved.type === 'glyph');
    if (resolved.type === 'emoji') {
      const svgFile = path.join(PRINTER_ROOT, 'assets/emoji', `${resolved.id}.svg`);
      assert.ok(fs.existsSync(svgFile), `missing SVG file for ${c.char}: ${svgFile}`);
    }
  }

  // Specific check for 四 -> 4 pineapples
  const si = resolveIllustration('四', null, illMap);
  assert.equal(si.type, 'emoji');
  assert.equal(si.id, 'pineapple');
  assert.equal(si.count, 4);
});

test('print strokes: 2-tier stroke bundles cover all 1000 core characters + 2757 extended GB2312 characters', async () => {
  const { parseDataset } = await import('../js/schema.js');
  const { ensureHanziData, clearHanziCache } = await import('../js/hanzi-data.js');

  const rawV6 = fs.readFileSync(path.join(PRINTER_ROOT, 'spec/data/hanzi-1000-v6.json'), 'utf8');
  const coreBundle = JSON.parse(
    fs.readFileSync(path.join(PRINTER_ROOT, 'assets/strokes/hanzi-strokes-core-1000.json'), 'utf8'),
  );
  const extendedBundle = JSON.parse(
    fs.readFileSync(path.join(PRINTER_ROOT, 'assets/strokes/hanzi-strokes-extended-gb2312.json'), 'utf8'),
  );

  const doc = parseDataset(rawV6);
  assert.equal(Object.keys(coreBundle).length, 1000);
  assert.equal(Object.keys(extendedBundle).length, 2757);

  for (const c of doc.characters) {
    const entry = coreBundle[c.char];
    assert.ok(entry && Array.isArray(entry.s) && entry.s.length > 0, `missing core stroke paths for ${c.char}`);
    assert.ok(Array.isArray(entry.m) && entry.m.length === entry.s.length, `missing median paths for ${c.char}`);
  }

  clearHanziCache();
  let coreCalls = 0;
  let extCalls = 0;
  // Requesting a core character only loads Tier 1 (core-1000), never Tier 2 (extended-gb2312)
  const map1 = await ensureHanziData(['一', '人'], {
    fetchCore: async () => {
      coreCalls++;
      return coreBundle;
    },
    fetchExtended: async () => {
      extCalls++;
      return extendedBundle;
    },
    allowCdn: false,
  });
  assert.equal(coreCalls, 1);
  assert.equal(extCalls, 0);
  assert.equal(map1.get('一').fallback, false);

  // Requesting an extended GB2312 character lazy-loads Tier 2 once
  const extChar = Object.keys(extendedBundle)[0];
  const map2 = await ensureHanziData([extChar], {
    fetchCore: async () => {
      coreCalls++;
      return coreBundle;
    },
    fetchExtended: async () => {
      extCalls++;
      return extendedBundle;
    },
    allowCdn: false,
  });
  assert.equal(coreCalls, 1);
  assert.equal(extCalls, 1);
  assert.equal(map2.get(extChar).fallback, false);
});

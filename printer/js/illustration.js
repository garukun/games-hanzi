/**
 * Unified illustration resolution & Fluent Emoji (Flat SVG) catalog search.
 *
 * Guarantees that EVERY character resolves to a non-empty illustration card:
 *   1. User override / JSON `image` field (`upload`, `emoji` + optional `count`, or `glyph`)
 *   2. Curated 1000-character mapping (`print/data/illustrations.json`)
 *   3. 3D sticker colour-glyph fallback (`{ type: 'glyph', char }`)
 */

import { normalizeImageSpec } from './schema.js';

let defaultIllustrationMap = {};
let defaultCatalog = [];
let localEmojiIds = new Set();

/** Load `illustrations.json` and `emoji-catalog.json` once in the browser. */
export async function loadIllustrationAssets(fetchJson) {
  const loader =
    fetchJson ||
    (async (relPath) => {
      const url = new URL(relPath, import.meta.url);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} loading ${relPath}`);
      return res.json();
    });

  const [map, catalog] = await Promise.all([
    loader('../data/illustrations.json'),
    loader('../data/emoji-catalog.json').catch(() => []),
  ]);
  setIllustrationAssets(map, catalog);
  return { illustrationMap: defaultIllustrationMap, catalog: defaultCatalog };
}

/** Set or replace the in-memory illustration map and emoji catalog (also used in tests). */
export function setIllustrationAssets(map = {}, catalog = []) {
  defaultIllustrationMap = map || {};
  defaultCatalog = Array.isArray(catalog) ? catalog : [];
  localEmojiIds = new Set(
    Object.values(defaultIllustrationMap)
      .filter((v) => v && typeof v.e === 'string')
      .map((v) => v.e),
  );
}

export function getIllustrationMap() {
  return defaultIllustrationMap;
}

export function getEmojiCatalog() {
  return defaultCatalog;
}

export function isVendoredEmoji(id) {
  return localEmojiIds.has(id);
}

/**
 * Resolve the illustration descriptor for `char`.
 * @param {string} char Single Han character
 * @param {object|null} customImage Optional override from user edit or JSON `image` field
 * @param {Record<string, object>} [map] Illustration map (defaults to loaded `illustrations.json`)
 * @param {string} [assetBase] Base URL for vendored emoji SVGs
 * @returns {{
 *   type: 'emoji'|'glyph'|'upload',
 *   char: string,
 *   id?: string,
 *   count: number,
 *   src?: string
 * }}
 */
export function resolveIllustration(char, customImage = null, map = defaultIllustrationMap, assetBase = './assets/emoji/') {
  const spec = normalizeImageSpec(customImage) || normalizeImageSpec(map?.[char]);
  if (!spec || spec.type === 'glyph') return { type: 'glyph', char, count: 1 };
  if (spec.type === 'upload') return { type: 'upload', char, count: 1, src: spec.src };
  const count = Math.min(10, Math.max(1, Number(spec.count) || 1));
  return {
    type: 'emoji',
    char,
    id: spec.id,
    count,
    src: `${assetBase}${spec.id}.svg`,
  };
}

/**
 * Search the 1595-entry Fluent Emoji catalog by Chinese keywords, English name, or emoji glyph.
 * @param {string} query
 * @param {Array<{id:string,g:string,n:string,k:string,z:string,p:string}>} [catalog]
 * @param {number} [limit]
 */
export function searchEmojiCatalog(query, catalog = defaultCatalog, limit = 60) {
  const q = (query || '').trim().toLowerCase();
  if (!q) {
    // Prefer locally vendored icons first when browsing with an empty query.
    const vendored = catalog.filter((item) => localEmojiIds.has(item.id));
    const rest = catalog.filter((item) => !localEmojiIds.has(item.id));
    return [...vendored, ...rest].slice(0, limit);
  }

  const scored = [];
  for (const item of catalog) {
    const id = item.id.toLowerCase();
    const n = (item.n || '').toLowerCase();
    const k = (item.k || '').toLowerCase();
    const z = (item.z || '').toLowerCase();
    let score = 0;
    if (item.g === q || id === q || n === q) score = 100;
    else if (z.split(/\s+/).includes(q)) score = 90;
    else if (n.startsWith(q) || id.startsWith(q) || z.startsWith(q)) score = 75;
    else if (z.includes(q)) score = 65;
    else if (n.includes(q) || id.includes(q)) score = 50;
    else if (k.includes(q)) score = 35;

    if (score > 0) {
      if (localEmojiIds.has(item.id)) score += 5;
      scored.push({ item, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
  return scored.slice(0, limit).map((s) => s.item);
}

/** Thumbnail URL for a catalog entry (uses local vendored SVG when available, otherwise jsDelivr CDN). */
export function catalogThumbUrl(entry, assetBase = './assets/emoji/') {
  if (!entry) return '';
  if (localEmojiIds.has(entry.id)) return `${assetBase}${entry.id}.svg`;
  return `https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/${encodeURI(entry.p)}`;
}

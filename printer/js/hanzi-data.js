/**
 * On-demand loader for Make Me a Hanzi stroke & radical shards (`print/assets/hanzi/<hex>.json`).
 *
 * Each shard maps characters with `(codePoint >> 6).toString(16) === hex` to:
 *   { s: string[] (SVG path d in 1024x1024 MakeMeAHanzi space), r: string (Kangxi radical), n: number (stroke count) }
 */

export const SHARD_BITS = 6;

export function shardKeyForChar(ch) {
  if (!ch || typeof ch !== 'string') return '';
  const cp = ch.codePointAt(0);
  return (cp >> SHARD_BITS).toString(16);
}

const shardCache = new Map();
const charCache = new Map();

async function defaultShardFetcher(key) {
  const url = new URL(`../assets/hanzi/${key}.json`, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for shard ${key}`);
  return res.json();
}

async function defaultCdnFallback(ch) {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${encodeURIComponent(ch)}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data?.strokes) && data.strokes.length > 0) {
      return { s: data.strokes, r: data.radical || '—', n: data.strokes.length, fallback: false, source: 'cdn' };
    }
  } catch {
    /* offline or blocked */
  }
  return null;
}

/**
 * Ensure stroke and radical data are loaded for a list of characters.
 * @param {string[]} chars
 * @param {{
 *   fetchShard?: (key:string) => Promise<Record<string, {s:string[], r:string, n:number}>>,
 *   fetchCdn?: (ch:string) => Promise<object|null>,
 *   allowCdn?: boolean
 * }} opts
 * @returns {Promise<Map<string, {s:string[]|null, r:string, n:number, fallback:boolean}>>}
 */
export async function ensureHanziData(chars, opts = {}) {
  const fetchShard = opts.fetchShard || defaultShardFetcher;
  const fetchCdn = opts.fetchCdn || defaultCdnFallback;
  const allowCdn = opts.allowCdn !== false;

  const uniqueChars = [...new Set(chars.filter(Boolean))];
  const neededShards = new Set();
  for (const ch of uniqueChars) {
    if (!charCache.has(ch)) {
      const k = shardKeyForChar(ch);
      if (k && !shardCache.has(k)) neededShards.add(k);
    }
  }

  await Promise.all(
    [...neededShards].map(async (key) => {
      try {
        const data = await fetchShard(key);
        shardCache.set(key, data || {});
        for (const [c, entry] of Object.entries(data || {})) {
          charCache.set(c, {
            s: Array.isArray(entry.s) ? entry.s : null,
            r: entry.r || '—',
            n: Number(entry.n) || (Array.isArray(entry.s) ? entry.s.length : 0),
            fallback: !Array.isArray(entry.s) || entry.s.length === 0,
            source: 'local',
          });
        }
      } catch {
        shardCache.set(key, {});
      }
    }),
  );

  // Resolve any character still missing from its shard.
  const missing = uniqueChars.filter((ch) => !charCache.has(ch));
  if (missing.length > 0) {
    await Promise.all(
      missing.map(async (ch) => {
        if (allowCdn) {
          const cdnData = await fetchCdn(ch);
          if (cdnData) {
            charCache.set(ch, cdnData);
            return;
          }
        }
        charCache.set(ch, { s: null, r: '—', n: 0, fallback: true, source: 'missing' });
      }),
    );
  }

  const out = new Map();
  for (const ch of uniqueChars) {
    out.set(ch, charCache.get(ch));
  }
  return out;
}

/** Synchronous lookup for an already-loaded character. */
export function getCachedHanzi(ch) {
  return charCache.get(ch) || { s: null, r: '—', n: 0, fallback: true, source: 'unloaded' };
}

/** Seed cache directly (used by unit tests or offline bundles). */
export function seedHanziCache(entries) {
  for (const [ch, entry] of Object.entries(entries || {})) {
    charCache.set(ch, {
      s: Array.isArray(entry.s) ? entry.s : null,
      r: entry.r || '—',
      n: Number(entry.n) || (Array.isArray(entry.s) ? entry.s.length : 0),
      fallback: !Array.isArray(entry.s) || entry.s.length === 0,
      source: 'seeded',
    });
  }
}

export function clearHanziCache() {
  shardCache.clear();
  charCache.clear();
}

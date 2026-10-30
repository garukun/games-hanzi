/**
 * 2-tier frequency-split loader for Make Me a Hanzi stroke, median & radical bundles:
 *   - Tier 1 (`assets/strokes/hanzi-strokes-core-1000.json`):
 *     All 1,000 built-in curriculum characters (`spec/data/hanzi-1000-v6.json`).
 *     Loaded in a single request on startup (~0.99 MB gzip).
 *   - Tier 2 (`assets/strokes/hanzi-strokes-extended-gb2312.json`):
 *     Remaining 2,757 GB2312 Level-1 characters. Lazy-loaded on demand only when a
 *     custom dataset contains characters outside the core 1,000.
 *   - Tier 3 (`hanzi-writer-data` CDN / font glyph fallback):
 *     For rare CJK characters outside the 3,757 offline set.
 *
 * Each character maps to:
 *   {
 *     s: string[] (SVG path d in 1024x1024 MakeMeAHanzi space),
 *     m?: string[] (smoothed single-line median SVG path d per stroke for dashed tracing),
 *     r: string (Kangxi radical),
 *     n: number (stroke count)
 *   }
 */

export const SHARD_BITS = 6;

export function shardKeyForChar(ch) {
  if (!ch || typeof ch !== 'string') return '';
  const cp = ch.codePointAt(0);
  return (cp >> SHARD_BITS).toString(16);
}

/** Clean Voronoi serif entry/exit jogs on a stroke's raw median point list. */
export function cleanStrokeMedians(pts) {
  if (!Array.isArray(pts) || pts.length <= 2) return pts || [];
  const p = pts.map(([x, y]) => [Number(x), Number(y)]);

  for (let pass = 0; pass < 2 && p.length >= 3; pass++) {
    const dx0 = p[1][0] - p[0][0];
    const dy0 = p[1][1] - p[0][1];
    const l0 = Math.hypot(dx0, dy0);
    let refIdx = 2;
    while (refIdx < p.length - 1 && Math.hypot(p[refIdx][0] - p[1][0], p[refIdx][1] - p[1][1]) < 80) {
      refIdx++;
    }
    const dxRef = p[refIdx][0] - p[1][0];
    const dyRef = p[refIdx][1] - p[1][1];
    const lRef = Math.hypot(dxRef, dyRef);
    if (l0 < 85 && lRef > l0 * 1.2 && l0 > 0 && lRef > 0) {
      const cos = (dx0 * dxRef + dy0 * dyRef) / (l0 * lRef);
      if (cos < 0.96) {
        const ux = dxRef / lRef;
        const uy = dyRef / lRef;
        const along = Math.max(0, dx0 * ux + dy0 * uy);
        p[1] = [p[1][0] - ux * along * 0.45, p[1][1] - uy * along * 0.45];
        p.shift();
      }
    }
  }

  for (let pass = 0; pass < 2 && p.length >= 3; pass++) {
    const n = p.length;
    const dx0 = p[n - 1][0] - p[n - 2][0];
    const dy0 = p[n - 1][1] - p[n - 2][1];
    const l0 = Math.hypot(dx0, dy0);
    let refIdx = n - 3;
    while (refIdx > 0 && Math.hypot(p[n - 2][0] - p[refIdx][0], p[n - 2][1] - p[refIdx][1]) < 80) {
      refIdx--;
    }
    const dxRef = p[n - 2][0] - p[refIdx][0];
    const dyRef = p[n - 2][1] - p[refIdx][1];
    const lRef = Math.hypot(dxRef, dyRef);
    if (l0 < 95 && lRef > l0 * 1.25 && l0 > 0 && lRef > 0) {
      const cos = (dx0 * dxRef + dy0 * dyRef) / (l0 * lRef);
      if (cos > 0.55 && cos < 0.96) {
        const ux = dxRef / lRef;
        const uy = dyRef / lRef;
        const along = Math.max(0, dx0 * ux + dy0 * uy);
        p[n - 2] = [p[n - 2][0] + ux * along * 0.45, p[n - 2][1] + uy * along * 0.45];
        p.pop();
      }
    }
  }
  return p;
}

/** Convert a stroke's median point array `[[x,y], ...]` into a smoothed SVG path string `d`. */
export function smoothMedianToPath(pts) {
  const p = cleanStrokeMedians(pts);
  if (!p || !p.length) return '';
  if (p.length === 1) return `M ${Math.round(p[0][0])} ${Math.round(p[0][1])}`;
  if (p.length === 2) {
    return `M ${Math.round(p[0][0])} ${Math.round(p[0][1])} L ${Math.round(p[1][0])} ${Math.round(p[1][1])}`;
  }
  let d = `M ${Math.round(p[0][0])} ${Math.round(p[0][1])}`;
  for (let i = 1; i < p.length - 1; i++) {
    const vx1 = p[i][0] - p[i - 1][0];
    const vy1 = p[i][1] - p[i - 1][1];
    const vx2 = p[i + 1][0] - p[i][0];
    const vy2 = p[i + 1][1] - p[i][1];
    const l1 = Math.hypot(vx1, vy1) || 1;
    const l2 = Math.hypot(vx2, vy2) || 1;
    const cos = (vx1 * vx2 + vy1 * vy2) / (l1 * l2);
    if (cos < 0.65) {
      d += ` L ${Math.round(p[i][0])} ${Math.round(p[i][1])}`;
    } else {
      const mx = Math.round((p[i][0] + p[i + 1][0]) / 2);
      const my = Math.round((p[i][1] + p[i + 1][1]) / 2);
      d += ` Q ${Math.round(p[i][0])} ${Math.round(p[i][1])} ${mx} ${my}`;
    }
  }
  d += ` L ${Math.round(p[p.length - 1][0])} ${Math.round(p[p.length - 1][1])}`;
  return d;
}

export function resolveMedianPaths(entry) {
  if (!entry) return null;
  if (Array.isArray(entry.m) && entry.m.length > 0) return entry.m;
  if (Array.isArray(entry.medians) && entry.medians.length > 0) {
    const paths = entry.medians.map(smoothMedianToPath).filter(Boolean);
    return paths.length > 0 ? paths : null;
  }
  return null;
}

const bundleState = {
  coreLoaded: false,
  corePromise: null,
  extendedLoaded: false,
  extendedPromise: null,
};
const shardCache = new Map();
const charCache = new Map();

export const CORE_STROKES_URL = new URL('../assets/strokes/hanzi-strokes-core-1000.json', import.meta.url);
export const EXTENDED_STROKES_URL = new URL('../assets/strokes/hanzi-strokes-extended-gb2312.json', import.meta.url);

async function fetchJsonBundle(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function populateCharCache(bundle, source = 'local') {
  for (const [c, entry] of Object.entries(bundle || {})) {
    charCache.set(c, {
      s: Array.isArray(entry.s) ? entry.s : null,
      m: resolveMedianPaths(entry),
      r: entry.r || '—',
      n: Number(entry.n) || (Array.isArray(entry.s) ? entry.s.length : 0),
      fallback: !Array.isArray(entry.s) || entry.s.length === 0,
      source,
    });
  }
}

async function ensureCoreBundle(fetchCore) {
  if (bundleState.coreLoaded) return;
  if (!bundleState.corePromise) {
    bundleState.corePromise = (async () => {
      try {
        const data = await fetchCore();
        populateCharCache(data, 'local-core');
      } catch {
        /* offline bundle missing or custom test env */
      } finally {
        bundleState.coreLoaded = true;
      }
    })();
  }
  await bundleState.corePromise;
}

async function ensureExtendedBundle(fetchExtended) {
  if (bundleState.extendedLoaded) return;
  if (!bundleState.extendedPromise) {
    bundleState.extendedPromise = (async () => {
      try {
        const data = await fetchExtended();
        populateCharCache(data, 'local-extended');
      } catch {
        /* extended bundle unavailable */
      } finally {
        bundleState.extendedLoaded = true;
      }
    })();
  }
  await bundleState.extendedPromise;
}

async function defaultCdnFallback(ch) {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${encodeURIComponent(ch)}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data?.strokes) && data.strokes.length > 0) {
      return {
        s: data.strokes,
        m: resolveMedianPaths(data),
        r: data.radical || '—',
        n: data.strokes.length,
        fallback: false,
        source: 'cdn',
      };
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
 *   fetchCore?: () => Promise<Record<string, {s:string[], m?:string[], r:string, n:number}>>,
 *   fetchExtended?: () => Promise<Record<string, {s:string[], m?:string[], r:string, n:number}>>,
 *   fetchShard?: (key:string) => Promise<Record<string, {s:string[], m?:string[], r:string, n:number}>>,
 *   fetchCdn?: (ch:string) => Promise<object|null>,
 *   allowCdn?: boolean
 * }} opts
 * @returns {Promise<Map<string, {s:string[]|null, m:string[]|null, r:string, n:number, fallback:boolean}>>}
 */
export async function ensureHanziData(chars, opts = {}) {
  const fetchCdn = opts.fetchCdn || defaultCdnFallback;
  const allowCdn = opts.allowCdn !== false;
  const uniqueChars = [...new Set(chars.filter(Boolean))];

  // Legacy custom shard fetcher hook (for custom unit tests passing opts.fetchShard)
  if (typeof opts.fetchShard === 'function') {
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
          const data = await opts.fetchShard(key);
          shardCache.set(key, data || {});
          populateCharCache(data, 'local');
        } catch {
          shardCache.set(key, {});
        }
      }),
    );
  } else {
    // Tier 1: Load core 1,000 curriculum characters in 1 request
    if (uniqueChars.some((ch) => !charCache.has(ch))) {
      const fetchCore = opts.fetchCore || (() => fetchJsonBundle(CORE_STROKES_URL));
      await ensureCoreBundle(fetchCore);
    }

    // Tier 2: Lazy-load extended 2,757 GB2312 characters only if needed
    if (uniqueChars.some((ch) => !charCache.has(ch))) {
      const fetchExtended = opts.fetchExtended || (() => fetchJsonBundle(EXTENDED_STROKES_URL));
      await ensureExtendedBundle(fetchExtended);
    }
  }

  // Tier 3: Resolve any character still missing via CDN or mark fallback
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
        charCache.set(ch, { s: null, m: null, r: '—', n: 0, fallback: true, source: 'missing' });
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
  return charCache.get(ch) || { s: null, m: null, r: '—', n: 0, fallback: true, source: 'unloaded' };
}

/** Seed cache directly (used by unit tests or offline bundles). */
export function seedHanziCache(entries) {
  populateCharCache(entries, 'seeded');
}

export function clearHanziCache() {
  shardCache.clear();
  charCache.clear();
  bundleState.coreLoaded = false;
  bundleState.corePromise = null;
  bundleState.extendedLoaded = false;
  bundleState.extendedPromise = null;
}

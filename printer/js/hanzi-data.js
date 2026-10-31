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

/**
 * Trim a short serif jog at `p[0]`. The exit jog is the same trim after `reverse()`:
 * both vectors flip, so the cosine test and the 0.45 pull-back match the old end loop.
 */
function trimStrokeTip(p, maxL0, ratio, acceptCos) {
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
    if (!(l0 < maxL0 && lRef > l0 * ratio && l0 > 0 && lRef > 0)) continue;
    const cos = (dx0 * dxRef + dy0 * dyRef) / (l0 * lRef);
    if (!acceptCos(cos)) continue;
    const ux = dxRef / lRef;
    const uy = dyRef / lRef;
    const along = Math.max(0, dx0 * ux + dy0 * uy);
    p[1] = [p[1][0] - ux * along * 0.45, p[1][1] - uy * along * 0.45];
    p.shift();
  }
}

/** Clean Voronoi serif entry/exit jogs on a stroke's raw median point list. */
export function cleanStrokeMedians(pts) {
  if (!Array.isArray(pts) || pts.length <= 2) return pts || [];
  const p = pts.map(([x, y]) => [Number(x), Number(y)]);
  trimStrokeTip(p, 85, 1.2, (cos) => cos < 0.96);
  p.reverse();
  trimStrokeTip(p, 95, 1.25, (cos) => cos > 0.55 && cos < 0.96);
  p.reverse();
  return p;
}

/** Convert a stroke's median point array `[[x,y], ...]` into a smoothed SVG path string `d`. */
const roundPt = ([x, y]) => `${Math.round(x)} ${Math.round(y)}`;

export function smoothMedianToPath(pts) {
  const p = cleanStrokeMedians(pts);
  if (!p || !p.length) return '';
  if (p.length === 1) return `M ${roundPt(p[0])}`;
  if (p.length === 2) return `M ${roundPt(p[0])} L ${roundPt(p[1])}`;
  let d = `M ${roundPt(p[0])}`;
  for (let i = 1; i < p.length - 1; i++) {
    const vx1 = p[i][0] - p[i - 1][0];
    const vy1 = p[i][1] - p[i - 1][1];
    const vx2 = p[i + 1][0] - p[i][0];
    const vy2 = p[i + 1][1] - p[i][1];
    const l1 = Math.hypot(vx1, vy1) || 1;
    const l2 = Math.hypot(vx2, vy2) || 1;
    const cos = (vx1 * vx2 + vy1 * vy2) / (l1 * l2);
    if (cos < 0.65) {
      d += ` L ${roundPt(p[i])}`;
    } else {
      d += ` Q ${roundPt(p[i])} ${roundPt([(p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2])}`;
    }
  }
  d += ` L ${roundPt(p[p.length - 1])}`;
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

/** Load one stroke bundle once. A missing file leaves the cache empty so the next tier can run. */
function ensureBundle(kind, source, fetchBundle) {
  const loadedKey = `${kind}Loaded`;
  const promiseKey = `${kind}Promise`;
  if (bundleState[loadedKey]) return bundleState[promiseKey] || Promise.resolve();
  if (!bundleState[promiseKey]) {
    bundleState[promiseKey] = (async () => {
      try {
        populateCharCache(await fetchBundle(), source);
      } catch {
        /* bundle missing or custom test env */
      } finally {
        bundleState[loadedKey] = true;
      }
    })();
  }
  return bundleState[promiseKey];
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
 * Tier 1 then tier 2, stopping once every character is cached. Still-missing
 * characters use `fetchCdn` unless `allowCdn` is false.
 * @param {string[]} chars
 * @param {{
 *   fetchCore?: () => Promise<Record<string, {s:string[], m?:string[], r:string, n:number}>>,
 *   fetchExtended?: () => Promise<Record<string, {s:string[], m?:string[], r:string, n:number}>>,
 *   fetchCdn?: (ch:string) => Promise<object|null>,
 *   allowCdn?: boolean
 * }} [opts]
 */
export async function ensureHanziData(chars, opts = {}) {
  const fetchCdn = opts.fetchCdn || defaultCdnFallback;
  const allowCdn = opts.allowCdn !== false;
  const uniqueChars = [...new Set(chars.filter(Boolean))];

  // Tier 1 (core 1,000) then tier 2 (extended GB2312), only while a character is still missing.
  for (const [kind, source, customFetch, url] of [
    ['core', 'local-core', opts.fetchCore, CORE_STROKES_URL],
    ['extended', 'local-extended', opts.fetchExtended, EXTENDED_STROKES_URL],
  ]) {
    if (!uniqueChars.some((ch) => !charCache.has(ch))) break;
    await ensureBundle(kind, source, customFetch || (() => fetchJsonBundle(url)));
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

  return new Map(uniqueChars.map((ch) => [ch, charCache.get(ch)]));
}

/** Synchronous lookup for an already-loaded character. */
export function getCachedHanzi(ch) {
  return charCache.get(ch) || { s: null, m: null, r: '—', n: 0, fallback: true, source: 'unloaded' };
}

export function clearHanziCache() {
  charCache.clear();
  bundleState.coreLoaded = false;
  bundleState.corePromise = null;
  bundleState.extendedLoaded = false;
  bundleState.extendedPromise = null;
}

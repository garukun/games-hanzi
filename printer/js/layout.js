/**
 * Pure layout maths for the practice-sheet printer. No DOM access, so it is unit-testable
 * from node (tests/print-layout.test.js).  All lengths are millimetres on a US Letter page.
 */

export const PAGE = Object.freeze({ w: 215.9, h: 279.4, margin: 12.7 });
export const BODY = Object.freeze({
  w: +(PAGE.w - 2 * PAGE.margin).toFixed(2), // 190.5
  h: +(PAGE.h - 2 * PAGE.margin).toFixed(2), // 254
  footer: 8,
});
export const UNITS_H = BODY.h - BODY.footer; // 246

export const MAX_CHARS = 1000;

/** Rotating colour themes, same order as the reference workbook: blue, orange, green, purple. */
export const THEMES = [
  { id: 'blue', main: '#2f7de1', dark: '#1d4f9c', mid: '#8bb6ee', light: '#e4effd', soft: '#f3f8ff', ink: '#16365f' },
  { id: 'orange', main: '#f08a24', dark: '#b45a0a', mid: '#f4be86', light: '#fdeedb', soft: '#fff8ef', ink: '#6a3708' },
  { id: 'green', main: '#2fae7c', dark: '#18785a', mid: '#8fd5b5', light: '#e0f6ec', soft: '#f2fbf6', ink: '#0f4a37' },
  { id: 'purple', main: '#8a63d2', dark: '#5b3a9e', mid: '#c0a8ec', light: '#ece4fa', soft: '#f8f5fe', ink: '#34205f' },
];
export const MONO_THEME = {
  id: 'mono', main: '#555a63', dark: '#2b2f36', mid: '#a9adb5', light: '#eceef1', soft: '#f8f9fa', ink: '#1f2329',
};

export function themeFor(index, mono = false) {
  return mono ? MONO_THEME : THEMES[((index % THEMES.length) + THEMES.length) % THEMES.length];
}

/* Per-layout design constants (mm). `cols`/`defRows`/`defTrace` are defaults the user can override. */
export const SPECS = {
  1: { mode: 'col', hh: 60, gap: 3, gw: 70, ph: 17, card: 'wide', sh: 22,
       cols: 6, defRows: 4, defTrace: 2, colGap: 2.5, rowGap: 2.8, minCols: 2, maxCols: 12,
       maxWords: 3, budget: 10, stepMax: 12, fs: 4.1, labelW: 9 },
  2: { mode: 'col', hh: 44, gap: 3, gwRatio: 0.5, ph: 12, card: 'tall', sh: 13,
       cols: 4, defRows: 6, defTrace: 2, colGap: 1.8, rowGap: 2.8, minCols: 2, maxCols: 10,
       maxWords: 2, budget: 8, stepMax: 9, fs: 3.3, labelW: 6.5 },
  3: { mode: 'row', hh: 44, gap: 3, leftW: 70, gw: 33, ph: 11, card: 'tall',
       cols: 5, defRows: 3, defTrace: 1, colGap: 1.8, rowGap: 2.2, minCols: 2, maxCols: 10,
       maxWords: 2, budget: 6, stepMax: 9, fs: 3, labelW: 6.5 },
  4: { mode: 'col', hh: 36, gap: 2.4, gwRatio: 0.5, ph: 10.5, card: 'tall', sh: 10.8,
       cols: 4, defRows: 3, defTrace: 1, colGap: 2.15, rowGap: 1.8, minCols: 2, maxCols: 10,
       maxWords: 2, budget: 8, stepMax: 8, fs: 3.1, labelW: 6 },
};

export const PER_PAGE_OPTIONS = [1, 2, 3, 4];

/** Where each character "unit" sits inside the page body. */
export function unitSlots(perPage) {
  const H = UNITS_H;
  const W = BODY.w;
  switch (perPage) {
    case 1:
      return [{ x: 0, y: 0, w: W, h: H }];
    case 2: {
      const gap = 6;
      const w = (W - gap) / 2;
      return [0, 1].map((i) => ({ x: i * (w + gap), y: 0, w, h: H }));
    }
    case 3: {
      const gap = 5;
      const h = (H - 2 * gap) / 3;
      return [0, 1, 2].map((i) => ({ x: 0, y: i * (h + gap), w: W, h }));
    }
    case 4: {
      const gap = 6;
      const w = (W - gap) / 2;
      const h = (H - gap) / 2;
      return [0, 1, 2, 3].map((i) => ({ x: (i % 2) * (w + gap), y: Math.floor(i / 2) * (h + gap), w, h }));
    }
    default:
      throw new RangeError(`unsupported perPage ${perPage}`);
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Geometry (all rects relative to the unit's top-left) for one character unit.
 * @param {number} perPage 1..4
 * @param {{x:number,y:number,w:number,h:number}} slot
 * @param {{rows?:number, trace?:number}} opts  user overrides (clamped to what fits)
 */
export function unitGeometry(perPage, slot, opts = {}) {
  const spec = SPECS[perPage];
  const { w, h } = slot;
  const g = { perPage, spec, w, h };

  if (spec.mode === 'col') {
    const gw = spec.gw ?? r2(w * spec.gwRatio);
    const cardX = gw + spec.gap;
    const cardW = r2(w - cardX);
    g.glyphBox = { x: 0, y: 0, w: gw, h: spec.hh };
    g.pinyinH = spec.ph;
    g.card = { x: cardX, y: 0, w: cardW, h: spec.hh };
    g.stroke = { x: 0, y: spec.hh + spec.gap, w, h: spec.sh };
    g.gridY = spec.hh + spec.gap + spec.sh + spec.gap;
    g.gridX = 0;
    g.gridW = w;
  } else {
    // 3 per page: info panel on the left, practice grid on the right.
    const { leftW, gw, gap, hh } = spec;
    g.glyphBox = { x: 0, y: 0, w: gw, h: hh };
    g.pinyinH = spec.ph;
    g.card = { x: gw + 2, y: 0, w: leftW - gw - 2, h: hh };
    g.stroke = { x: 0, y: hh + gap, w: leftW, h: h - hh - gap };
    g.gridY = 0;
    g.gridX = leftW + 4;
    g.gridW = w - leftW - 4;
  }

  // Card interior: illustration art on top (tall card) or at the left (wide card).
  const c = g.card;
  if (spec.card === 'wide') {
    g.art = { x: 0, y: 0, w: r2(c.w * 0.44), h: c.h };
    g.info = { x: g.art.w, y: 0, w: r2(c.w - g.art.w), h: c.h };
  } else {
    const artH = r2(c.h * 0.56);
    g.art = { x: 0, y: 0, w: c.w, h: artH };
    g.info = { x: 0, y: artH, w: c.w, h: r2(c.h - artH) };
  }

  const minCols = spec.minCols ?? 2;
  const maxCols = spec.maxCols ?? 12;
  const cols = clamp(Math.round(opts.cols ?? spec.cols), minCols, maxCols);
  const colGap = r2(clamp(opts.colGap ?? spec.colGap ?? 1.8, 0, 8));
  const minRowGap = r2(clamp(opts.rowGap ?? spec.rowGap ?? 2.0, 0, 10));
  const availH = Math.max(10, h - g.gridY);
  const cellByW = (g.gridW - Math.max(0, cols - 1) * colGap) / cols;
  const cell = Math.floor(Math.min(cellByW, availH) * 100) / 100;
  const maxRows = Math.max(1, Math.floor((availH + minRowGap) / (cell + minRowGap) + 1e-6));
  const rows = clamp(Math.round(opts.rows ?? spec.defRows), 1, maxRows);
  const trace = clamp(Math.round(opts.trace ?? spec.defTrace), 0, rows);
  const maxFitRowGap = rows > 1 ? Math.floor(((availH - rows * cell) / (rows - 1)) * 100) / 100 : 0;
  const rowGap = rows > 1 ? r2(Math.min(maxFitRowGap, minRowGap * 1.6)) : 0;
  const gridW = r2(cols * cell + Math.max(0, cols - 1) * colGap);
  const gridH = r2(rows * cell + Math.max(0, rows - 1) * rowGap);
  g.grid = {
    x: g.gridX,
    y: g.gridY,
    w: gridW,
    h: gridH,
    cols,
    rows,
    cell,
    colGap,
    rowGap,
    minCols,
    maxCols,
    maxRows,
    trace,
  };
  return g;
}

/**
 * Choose which words fit on the card. A user-picked `display` list wins (capped to maxWords);
 * otherwise take words in order while they fit the character budget (long idioms are skipped).
 */
export function pickWords(words = [], display, spec) {
  const list = (display && display.length ? display : null) || null;
  if (list) return list.slice(0, spec.maxWords);
  const out = [];
  let total = 0;
  for (const w of words) {
    if (out.length >= spec.maxWords) break;
    const len = [...w].length;
    if (out.length && total + len > spec.budget) continue;
    out.push(w);
    total += len;
  }
  return out;
}

/**
 * Stroke-order ribbon: pick 1–3 rows so the steps are as large as possible.
 * Accounts for the inter-step flex `gap` so `perRow` steps never wrap to an extra row.
 * @returns {{rows:number, perRow:number, size:number}} size in mm
 */
export function strokeSteps(n, innerW, innerH, maxStep, gap = 0.35) {
  let best = null;
  for (let rows = 1; rows <= 3; rows++) {
    const perRow = Math.ceil(n / rows);
    const availW = Math.max(1, innerW - Math.max(0, perRow - 1) * gap);
    const availH = Math.max(1, innerH - Math.max(0, rows - 1) * gap);
    const size = Math.floor(Math.min(maxStep, availW / perRow, availH / rows) * 100) / 100;
    if (!best || size > best.size + 0.05) best = { rows, perRow, size };
  }
  return best;
}

/** Row structure for tiling `n` copies of an icon in the illustration square. */
const COUNT_ROWS = {
  1: [1], 2: [2], 3: [2, 1], 4: [2, 2], 5: [3, 2], 6: [3, 3], 7: [4, 3], 8: [4, 4], 9: [3, 3, 3], 10: [5, 5],
};

/** Positions (percent of a square box) for `n` icons. */
export function countGrid(n) {
  const rows = COUNT_ROWS[clamp(Math.round(n), 1, 10)];
  const maxPer = Math.max(...rows);
  const size = Math.min(100 / maxPer, 100 / rows.length) * (n === 1 ? 1 : 0.96);
  const out = [];
  const totalH = rows.length * size;
  rows.forEach((count, ri) => {
    const rowW = count * size;
    for (let i = 0; i < count; i++) {
      out.push({ x: r2((100 - rowW) / 2 + i * size), y: r2((100 - totalH) / 2 + ri * size), s: r2(size) });
    }
  });
  return out;
}

/** Split the selected characters into pages. */
export function paginate(items, perPage) {
  const pages = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages;
}

export const pageCount = (n, perPage) => Math.ceil(n / perPage);

/** PDF coordinate helper: CSS px (96 dpi) → PDF points (72 dpi). */
export const pxToPt = (px) => px * 0.75;
export const mmToPt = (mm) => (mm / 25.4) * 72;

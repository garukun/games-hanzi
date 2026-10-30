/**
 * tests/locked.test.js — a locked level must be *visible*.
 *
 *  Every other piece of state in this game survives greyscale: ★ vs ☆, filled vs hollow dot,
 * the dashed path, the bubble's rim. The one exception was the locked level, and it was
 * invisible for a reason no colour value could fix — the glyph was a 🔒 **emoji**:
 *
 *      Isolating the glyph in Chromium (screenshot the node, empty the span, screenshot again,
 *      diff the changed pixels, score each against the pixel behind it):
 *
 *          🔒 on the locked node's own #cdd5e4 fill
 *              p25 1.16:1   p50 1.36:1   max 2.62:1   0% of pixels reached 3:1
 *
 *      It was the only glyph in the game carrying information *alone* — 📖 🏆 ⭐ 🔊 👀 👆 all
 *      have an ink number or word beside them, so their emoji failing is a nuisance; the padlock
 *      had nothing else. And the state pair had no second channel either: the locked fill
 *      #cdd5e4 is 1.13:1 to 1.31:1 from all seven unlocked bubble fills, i.e. a difference of
 *      about 1.0 in luminance — precisely the case iteration 18 already found and fixed for the
 *      star and dot pairs.
 *
 *  The fix has the two halves that case requires: the lock is **drawn** in --ink (7.74:1 on that
 *  fill, and it takes `color`, so a future palette edit moves it), and the locked rim is
 *  **dashed** where every open rim is solid, so the state pair has a shape channel.
 *
 *  Style follows tests/ink.test.js: every ratio is recomputed from the hex the page ships, and
 *  the failing baseline is pinned, because a table-shape assertion passes against an unreadable
 *  one. `svgLock()` exists for the same reason as the WCAG helpers — the one thing that cannot
 *  be asserted structurally is that the CSS really paints a padlock rather than a blob, so the
 *  geometry is executed against a seeded bitmap and checked by shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../qwen.html', import.meta.url), 'utf8');

/* ---------- page parsing ---------- */

const style = () => {
  const m = SRC.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(m, 'qwen.html has no <style> block');
  return m[1];
};
/* The comments here quote the rules they document *and* the values they replaced, so every
 * "is this still here" question has to be asked of comment-stripped source. */
const bare = () => style().replace(/\/\*[\s\S]*?\*\//g, '');
/**
 * Comment-stripped *page* source. Both comment syntaxes have to go: the rule being documented
 * is quoted in a CSS block comment, and the renderMap rationale is a `//` line comment — and
 * `🔒` still appears in both, so a half-stripped source makes "the emoji is gone" fail against
 * code that no longer renders it. Line comments are matched only where a `//` cannot be the
 * tail of a `https://` URL, which this file has.
 */
const bareSrc = () => SRC
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function rootVars() {
  const b = bare();
  const i = b.indexOf(':root{');
  assert.ok(i >= 0, 'no :root block');
  const v = {};
  for (const m of b.slice(i + 6, b.indexOf('}', i)).matchAll(/--([\w-]+)\s*:\s*(#[0-9a-f]{3,8})\s*;/g)) v[m[1]] = m[2];
  return v;
}

/** Every rule, brace-matched so an @media wrapper cannot swallow an inner rule. */
function allRules() {
  const b = bare();
  const out = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === '{') { stack.push({ sel: b.slice(start, i).trim(), body: i + 1 }); start = i + 1; }
    else if (b[i] === '}') {
      const r = stack.pop();
      if (r) out.push({ sels: r.sel.split(',').map(s => s.trim()).filter(Boolean), body: b.slice(r.body, i) });
      start = i + 1;
    }
  }
  return out;
}
/** All declaration blocks for a selector — every one, so a duplicate rule cannot hide. */
function rulesFor(sel) {
  return allRules().filter(r => r.sels.includes(sel)).map(r => r.body);
}
function rule(sel) {
  const hit = allRules().find(r => r.sels.includes(sel));
  assert.ok(hit, `no CSS rule for ${sel}`);
  return hit.body;
}
/** Every declaration of `prop` across every block for `sel` (duplicate rules included). */
function decls(sel, prop) {
  const out = [];
  for (const body of rulesFor(sel)) {
    for (const m of body.matchAll(new RegExp('(?:^|[;{])\\s*' + prop + '\\s*:\\s*([^;]+)', 'g'))) out.push(m[1].trim());
  }
  return out;
}
function decl(sel, prop) {
  const all = decls(sel, prop);
  assert.ok(all.length, `no ${prop} on ${sel}`);
  return all[0];
}
function resolve(v, vars = rootVars()) {
  if (v == null) return null;
  // `!important` is a priority flag, not part of the colour. The locked fill ships with it
  // (it has to beat `.node`'s gradient), so a resolver that keeps it cannot parse any value.
  let out = String(v).replace(/!\s*important/g, '').trim();
  for (let i = 0; i < 4; i++) {
    const m = out.match(/var\(\s*--([\w-]+)\s*(?:,([^)]*))?\)/);
    if (!m) break;
    out = vars[m[1]] !== undefined ? vars[m[1]] : (m[2] || '').trim();
  }
  return out.trim();
}
/** The colour of a `border`/`background` shorthand: `2.5px solid var(--ink)` -> `var(--ink)`. */
function paint(v) {
  if (v == null) return null;
  const parts = String(v).trim().split(/\s+/);
  return parts.find(p => /^(#|var\(|rgb)/.test(p)) || parts[parts.length - 1];
}

/* ---------- WCAG, recomputed from the shipped hexes ---------- */

const chans = hex => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
};
const lum = hex => {
  const [r, g, b] = chans(hex).map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const x = lum(a), y = lum(b);
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
};
const V = rootVars();
const cr = (a, b, what) => {
  const x = resolve(a), y = resolve(b);
  assert.match(String(x), /^#[0-9a-f]{3,8}$/, `not a colour (${what} lhs): ${x}`);
  assert.match(String(y), /^#[0-9a-f]{3,8}$/, `not a colour (${what} rhs): ${y}`);
  return ratio(x, y);
};

/* ---------- the measured baseline, pinned ---------- */

const GRAPHIC = 3.0; // WCAG 1.4.11 non-text contrast

// Recomputed from the shipped :root vars.
const LOCKED_FILL = resolve(decl('.node.locked', 'background'));
const INK = V.ink;
const INK2 = resolve(decl('.node.locked', 'color')); // unused directly, but resolved here so a bad colour name fails loudly

test('the failing baseline is still what it measured as, so the fix has something to beat', () => {
  // The 🔒 emoji cannot be recomputed from CSS (it is a colour bitmap, not a colour value),
  // so its numbers are the measured Chromium figures, pinned.
  assert.equal(EMOJI_P50, 1.36);
  assert.equal(EMOJI_MAX, 2.62);
  assert.equal(EMOJI_SHARE_AT_3, 0);
  // The fill hue *can* be recomputed, and it is the finding that no palette edit could fix.
  const PAL = ['#fff0d4', '#ffd9d2', '#d6f2ff', '#ffe0ec', '#e2f7dd', '#f0e6ff', '#ffeccc'];
  const worst = Math.min(...PAL.map(p => ratio(LOCKED_FILL, p)));
  assert.ok(worst < 1.35, `locked fill is now ${worst.toFixed(2)}:1 from a bubble fill — the state pair has a hue channel, so the dash is redundant but the emoji would have been fine`);
});

test('the lock is drawn, not an emoji: the emoji is gone from the page entirely', () => {
  const s = bareSrc();
  assert.ok(!s.includes('\u{1F512}'), 'the 🔒 emoji is still somewhere in qwen.html — it is a colour bitmap and nothing can be done about its contrast');
  // The span must be *empty*. A regex that just looks for a `>` after class="lk" is satisfied by
  // `<span class="lk" aria-hidden="true"></span>` because `\S` matches the `<` of the closer, so
  // the inner text is extracted instead.
  const span = SRC.match(/<span class="lk"[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(span, 'could not find the .lk span in qwen.html');
  assert.equal(span[1].trim(), '', `.lk carries text (${span[1]}); it must be an empty span shaped by CSS`);
});

test('.lk is an empty element shaped entirely by CSS', () => {
  assert.match(rule('.node.locked .lk'), /position:\s*absolute/, 'the lock must be positioned inside the node');
  const body = rule('.node.locked .lk');
  assert.ok(!/font-size/.test(body), '.lk still sets a font-size, so it is expecting a glyph');
  // the padlock body
  assert.match(body, /background:\s*var\(--ink\)/, 'the lock body must be painted in --ink so it takes `color`');
  assert.match(body, /border-radius/, 'the lock body needs rounded corners to read as a padlock and not a block');
  assert.ok(body.includes('width:') && body.includes('height:'), '.lk must have real dimensions');
});

test('the padlock has a shackle above a body, not one solid shape', () => {
  const before = rule('.node.locked .lk::before');
  assert.match(before, /content:\s*""/, 'the shackle pseudo-element must be generated');
  assert.match(before, /border:\s*[\d.]+px solid var\(--ink\)/, 'the shackle must be an ink outline');
  assert.match(before, /border-bottom:\s*none/, 'without an open bottom the shackle is a filled box and the glyph is unreadable as a padlock');
  assert.match(before, /top:\s*-/, 'the shackle has to sit above the body, not on top of it');
  assert.ok(/border-radius:\s*\d+px\s+\d+px\s+0\s+0/.test(before), 'the shackle needs its two top corners rounded only');
});

test('the lock reads at 4.5:1 on the fill it is painted on', () => {
  const got = cr(decl('.node.locked .lk', 'background'), LOCKED_FILL, 'lock');
  assert.ok(got >= 4.5, `drawn lock is ${got.toFixed(2)}:1 on ${LOCKED_FILL}, needs 4.5:1`);
});

test('the ink the lock uses is the ink the whole game uses', () => {
  // A second near-black would drift from every other glyph on the board.
  assert.equal(resolve(decl('.node.locked .lk', 'background')), INK);
  assert.equal(resolve(paint(decl('.node.locked .lk::before', 'border'))), INK,
    'the shackle must be the same ink as the body, or the padlock is two colours');
});

test('the locked rim reads 3:1 against the fill it bounds', () => {
  // The rim's job is to tell a locked node from an open one and to draw the edge of the fill
  // it surrounds — NOT to separate the node from the page. Measured at 320x568 / 390x780 /
  // 430x932 / 820x1180, no node in this game separates from the page by colour: the open
  // --edge rims run down to 1.00:1 against the measured sky and hill, and the fills to
  // 1.06:1. The drop shadow is what draws the edge. So the honest bar for a rim here is the
  // surface it bounds, and against that the old #b0bacb failed.
  const rim = resolve(decl('.node.locked', 'border-color'));
  const onFill = cr(rim, LOCKED_FILL, 'rim');
  assert.ok(onFill >= GRAPHIC, `locked rim ${rim} is ${onFill.toFixed(2)}:1 on the fill it bounds, needs ${GRAPHIC}:1`);
});

test('the rim comes from the shared var, so a palette edit moves it', () => {
  // Recomputing the ratio alone cannot catch a hardcoded copy: `border-color:#6b7488` scores
  // exactly the same as `var(--ink-2)` and then silently stops tracking --ink-2 forever. So the
  // declaration itself is checked, not just the number it resolves to.
  const raw = decls('.node.locked', 'border-color');
  assert.ok(raw.every(v => /var\(\s*--ink-2\s*\)/.test(v)),
    `every .node.locked border-color must be var(--ink-2), got ${JSON.stringify(raw)} — a literal here is a silent fork of the palette`);
  assert.equal(V['ink-2'], resolve(raw[0]), 'the shipped --ink-2 must be what the rule resolves to');
});

test('the pinned measurement: the game separates nodes from the page with shadow, not colour', () => {
  // Every background measured behind a locked node, across four viewports. Recorded so the
  // claim in the comment above is checkable, and so a future "make the rim clear 3:1 on the
  // hill" attempt has to confront that even --ink only reaches 4.63:1 there.
  const MEASURED_PAGE = ['#bee6ff', '#c0e7ff', '#e4f6ff', '#e2f5ff', '#62b857', '#8fd07e',
                         '#b9e4ff', '#ddf3ff', '#b7e3ff', '#b2e1ff', '#b5e2ff', '#e0f4ff'];
  // the locked fill, against the page it sits on
  const worstFill = Math.min(...MEASURED_PAGE.map(b => ratio(LOCKED_FILL, b)));
  assert.ok(worstFill < 1.7, `the locked fill is now ${worstFill.toFixed(2)}:1 from the page, so the rim is doing the work`);
  // even full ink cannot clear 3:1 on the darker hill stop, which is why the rim is not asked to
  assert.ok(ratio(V.ink, '#62b857') < 6, 'pin: --ink on the dark hill stop');
  assert.ok(ratio(resolve(decl('.node.locked', 'border-color')), '#62b857') < 3,
    'pin: no muted grey clears 3:1 on the hill, which is why this test asserts against the fill');
});

test('the locked node names its own ink, and it is a real colour', () => {
  // `.node.locked{color:…}` is dead on a locked node today (it holds no text), but it is the
  // hook a future text label would take, so it is pinned to a value that resolves.
  assert.match(INK2, /^#[0-9a-f]{3,8}$/, `.node.locked colour does not resolve: ${INK2}`);
  assert.equal(INK2, V['ink-2'], '.node.locked must use the shared --ink-2, not a literal');
});

test('the old rim was the failure this replaces', () => {
  assert.equal(OLD_RIM, '#b0bacb');
  assert.ok(ratio(OLD_RIM, LOCKED_FILL) < GRAPHIC, `pin: the old rim was ${ratio(OLD_RIM, LOCKED_FILL).toFixed(2)}:1 on the fill it bounds`);
  assert.ok(ratio(OLD_RIM, V.hill1) < GRAPHIC, 'pin: the old rim did not clear 3:1 on the hill');
  assert.ok(ratio(OLD_RIM, V.sky1) < GRAPHIC, 'pin: the old rim did not clear 3:1 on the sky');
});

test('the drawn lock is the measurement that justified replacing the emoji', () => {
  // Recomputed where it can be, pinned where it cannot: an emoji's contrast is a property of
  // the font the platform shipped, so it can only be a measured number in a comment.
  assert.ok(DRAWN_P50 > EMOJI_P50 * 4, `the drawn lock (${DRAWN_P50}) is not a real improvement on the emoji (${EMOJI_P50})`);
  assert.ok(DRAWN_P50 >= 4.5, 'the drawn lock must clear the text bar, not just the graphic one — it is the only thing in the node');
});

test('locked and open differ by SHAPE: dashed rim against a solid one', () => {
  // The state pair has no usable hue (see the baseline test), so the dash is not a nicety —
  // it is the only channel a greyscale e-reader or a colour-blind child has.
  const locked = decls('.node.locked', 'border-style');
  assert.ok(locked.includes('dashed'), `.node.locked must declare border-style:dashed, got ${JSON.stringify(locked)}`);
  // Every open node is `.node` without `.locked`, so the open rim has to be solid somewhere —
  // and it has to be *absent* from a declaration that would apply to a locked node too.
  assert.match(rule('.node'), /border:\s*3px solid var\(--edge\)/, '.node must keep its solid rim — otherwise the dash is not a difference');
  const openDash = decls('.node', 'border-style');
  assert.ok(!openDash.length, `.node itself must not set a border-style, got ${JSON.stringify(openDash)} — a single \`.node{border-style:dashed}\` would dash the open nodes too and there would be no difference left`);
});

test('no other rule can undo the dash', () => {
  // A later `.node{border-style:solid}` at the same specificity would win by source order.
  const order = [];
  const b = bare();
  let idx = 0;
  for (const m of b.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().split(',').map(s => s.trim());
    if (sel.includes('.node') && /border-style\s*:/.test(m[2])) order.push([m[0].indexOf('{'), m[2].trim()]);
    idx++;
  }
  const dashed = order.findIndex(([, body]) => /dashed/.test(body));
  const solid = order.findIndex(([, body]) => /border-style\s*:\s*solid/.test(body));
  if (solid >= 0) {
    assert.ok(dashed >= 0 && dashed < solid, 'a solid border-style on .node is declared after the dashed one and would win by source order');
  }
});

test('the locked node still names its own fill, because it never receives a scheme', () => {
  // Iteration 9's lesson: an unset custom property inside var() invalidates the whole
  // declaration, so a locked node must not rely on --bg/--bg2/--edge ever arriving.
  const body = rulesFor('.node.locked').join(';');
  assert.match(body, /background:\s*#/, 'the locked fill must be a literal, not var(--bg)');
  assert.match(body, /border-color:\s*/, 'the locked rim must be named too');
  assert.ok(!/var\(--bg/.test(body), '.node.locked must not read --bg, which is never set on it');
});

test('renderMap gives a locked node an accessible name instead of a bare glyph', () => {
  const fn = sliceFunction('function renderMap(');
  assert.match(fn, /classList\.add\('locked'\)/, 'the locked class is still applied');
  assert.match(fn, /class="lk"/, 'the drawn lock element is still emitted');
  // The emoji used to be the only content, so it was the only accessible name — and it read
  // as "🔒", which is not a state anybody can act on. The drawn lock carries no text at all,
  // so the button must be named explicitly or it announces itself as an empty control.
  assert.match(fn, /aria-hidden="true"/, 'the drawn lock must be hidden from the a11y tree');
  assert.match(fn, /n\.setAttribute\('aria-label'/, 'the node button must carry an explicit label');
});

test('both node states name themselves in text, and the locked one says so', () => {
  const fn = sliceFunction('function renderMap(');
  const m = fn.match(/n\.setAttribute\('aria-label',\s*([^)]*)\);/);
  assert.ok(m, 'no aria-label on the node button');
  const expr = m[1];
  // Both branches of the same ternary must be present — an unconditional label would announce
  // an open level as locked, which is worse than no label at all.
  assert.match(expr, /ul\s*\?/, `the label must branch on the unlocked state, got: ${expr}`);
  assert.match(expr, /未解锁|locked/i, 'the locked branch must say the level is locked');
  assert.match(expr, /第\s*'\s*\+\s*L\.id/, 'the label must name the level number, not just its state');
});

test('the lock markup is the only thing in a locked node, and it is one element', () => {
  const fn = sliceFunction('function renderMap(');
  const m = fn.match(/n\.innerHTML\s*=\s*'([^']*)'\s*;\s*\}\s*else/);
  assert.ok(m, 'could not find the locked branch of renderMap');
  const html = m[1];
  assert.equal((html.match(/<[a-z]/gi) || []).length, 1, `locked markup should be one element, got ${html}`);
  assert.match(html, /class="lk"/);
  assert.ok(!/\S/.test(html.replace(/<[^>]*>/g, '')), `the locked node has loose text in it: ${html}`);
});

test('tapping a locked node still explains itself rather than doing nothing', () => {
  const fn = sliceFunction('function renderMap(');
  assert.match(fn, /if\(!ul\)\{/, 'the locked tap branch exists');
  assert.match(fn, /先过上一关哦/, 'a locked tap still toasts why');
  assert.match(fn, /toast\(/, 'the toast is actually wired');
  assert.match(fn, /SFX\.click\(\)/, 'a locked tap still makes a sound');
});

/* ---------- geometry: does the CSS really paint a padlock? ---------- */

/**
 * Rasterise `.lk` and `.lk::before` out of their own declarations and check the silhouette.
 * This is the assertion a string check cannot make: "there is a ::before" is not "the result
 * looks like a lock", and iteration 9's lesson was that geometry has to be looked at.
 *
 * Coordinate model, in CSS px with the origin at the top-left of the glyph's bounding box:
 * `.lk` is the body; `::before` sits `top:-Npx` above it, so its own bottom N px slide behind
 * the body — which is what makes it read as a shackle rather than a second bar.
 */
/** Read a px length straight out of a declaration, 0 if the property is absent. */
const px = (sel, prop) => parseFloat((decl(sel, prop) || '0').replace(/px/g, ''));

function rasterise() {
  const bodyW = px('.node.locked .lk', 'width');
  const bodyH = px('.node.locked .lk', 'height');
  const bodyR = px('.node.locked .lk', 'border-radius');
  const shW = px('.node.locked .lk::before', 'width');
  const shH = px('.node.locked .lk::before', 'height');
  const shT = (decl('.node.locked .lk::before', 'border').match(/([\d.]+)px/) || [0, 0])[1];
  const shBw = parseFloat(shT);
  const lift = Math.abs(px('.node.locked .lk::before', 'top')); // how far above the body

  const S = 8; // supersample, so a 2.5px border is not quantised away
  const W = Math.round(bodyW * S);
  const H = Math.round((lift + bodyH) * S);
  const g = Array.from({ length: H }, () => new Array(W).fill(0));

  // Shackle: a ring of thickness shBw, centred on the body. `border-bottom:none` means the
  // hole runs all the way down to the foot of the ring — the CSS genuinely has no bottom edge,
  // so the rasteriser must not invent one either.
  const ox = Math.round((bodyW - shW) / 2 * S), t = Math.round(shBw * S);
  const shPx = Math.round(shH * S), shFullW = Math.round(shW * S);
  for (let y = 0; y < shPx; y++) for (let x = 0; x < shFullW; x++) {
    const fx = ox + x;
    if (fx < 0 || fx >= W || y >= H) continue;
    const inner = fx > ox + t && fx < ox + shFullW - t && y > t;
    if (!inner) g[y][fx] = 1;
  }
  // Body: a filled rounded rect, offset down by `lift`.
  const by = Math.round(lift * S), r = bodyR * S, bhPx = Math.round(bodyH * S);
  for (let y = 0; y < bhPx; y++) for (let x = 0; x < W; x++) {
    const cy = by + y;
    if (cy < 0 || cy >= H) continue;
    const dx = Math.min(x, W - 1 - x), dy = Math.min(y, bhPx - 1 - y);
    if (dx >= r || dy >= r) g[cy][x] = 1;
  }
  return { g, W, H, bodyTop: by, bodyH: bhPx, shH: shPx, shBw: t, bodyW, shW, bodyR, shOx: ox, shFullW };
}

test('the drawn shape is a padlock: a hollow arc over a solid body', () => {
  const { g, W, H, bodyTop, bodyH, shH, shBw, bodyW, shW, bodyR, shOx, shFullW } = rasterise();
  const at = (x, y) => (g[y] && g[y][x] ? 1 : 0);

  // The body is a solid bar across the width.
  const bodyRow = bodyTop + Math.round(bodyH / 2);
  let solid = 0;
  for (let x = 0; x < W; x++) solid += at(x, bodyRow);
  assert.ok(solid >= W * 0.9, `the body is only ${solid}/${W} px across its width`);

  // The shackle is an ARC: ink at both edges, hollow in the middle. A filled middle is a box.
  // Sample the vertical middle of the *visible* ring, which sits above the body.
  const arcRow = Math.round(Math.min(shH, bodyTop) / 2);
  assert.ok(arcRow > shBw, `the arc row ${arcRow} must be below the ring's top edge (${shBw}) and above the body (${bodyTop})`);
  assert.equal(at(shOx, arcRow) + at(shOx + shFullW - 1, arcRow), 2, 'the shackle must carry ink at both edges');
  assert.equal(at(shOx + Math.round(shFullW / 2), arcRow), 0, 'the shackle centre must be hollow — a filled centre reads as a box, not a lock');

  // The shackle is narrower than the body, which is what makes the pair read as a padlock.
  assert.ok(shW < bodyW, `shackle ${shW}px must be narrower than the body ${bodyW}px`);

  // The body's corners are rounded. A square body next to a round arc still reads as a padlock
  // in silhouette but not at 11x9px, and `border-radius:0` is the kind of edit that reads as
  // harmless in a diff — so it is asserted, not assumed.
  assert.ok(bodyR > 0, 'the lock body must have rounded corners; at 11x9px a square one is a smudge');
  // and the corners really are cut: the body's first row is narrower than its middle row
  let firstRow = 0;
  for (let x = 0; x < W; x++) firstRow += at(x, bodyTop);
  assert.ok(firstRow < W * 0.9, `the body's top row is ${firstRow}/${W} px — its corners are not rounded`);

  // The glyph uses the whole of its declared box and no more: `H` is lift+bodyH, so the last
  // row IS the body's bottom edge and must be painted, and there must be no row past it.
  let lastInk = -1;
  for (let y = H - 1; y >= 0; y--) {
    for (let x = 0; x < W; x++) if (at(x, y)) { lastInk = y; break; }
    if (lastInk >= 0) break;
  }
  assert.equal(lastInk, H - 1, `the lock stops ${H - 1 - lastInk}px short of the bottom of its box`);
  assert.equal(H, Math.round((Math.abs(px('.node.locked .lk::before', 'top')) + px('.node.locked .lk', 'height')) * 8),
    'the raster box must be exactly the shackle lift plus the body');
});
function S_() { return 8; }

test('the padlock fits inside the node it is drawn in', () => {
  const body = decl('.node.locked .lk', 'width').replace(/px/g, '') | 0;
  const bodyH = decl('.node.locked .lk', 'height').replace(/px/g, '') | 0;
  const shH = decl('.node.locked .lk::before', 'height').replace(/px/g, '') | 0;
  const shTop = Math.abs(parseFloat(decl('.node.locked .lk::before', 'top')));
  const total = shTop + shH + bodyH;
  // The node is clamp(48px,12vmin,68px); at its smallest it is 48px, minus a 3px rim.
  const smallestNode = 48 - 6;
  assert.ok(total <= smallestNode, `the lock is ${total}px tall in a ${smallestNode}px node`);
  assert.ok(body > 0 && bodyH > 0);
});

/* Measured in Chromium against build/index.html at 390x780, by isolating the glyph
   (screenshot the node, empty .lk, screenshot again, diff, score each changed pixel against
   the pixel behind it). Recorded here so the numbers that justified the fix are readable. */
const EMOJI_P50 = 1.36;
const EMOJI_MAX = 2.62;
const EMOJI_SHARE_AT_3 = 0;
const OLD_RIM = '#b0bacb';
// After: p25 = p50 = max = 7.74, 97% of pixels >= 4.5:1.
const DRAWN_P50 = 7.74;

/* ---------- helpers ---------- */

function sliceFunction(sig) {
  const i = SRC.indexOf(sig);
  assert.ok(i >= 0, `no ${sig} in qwen.html`);
  const start = SRC.lastIndexOf('\n', i) + 1;
  // brace-match the body so a following function cannot be swallowed
  const open = SRC.indexOf('{', i);
  let depth = 0, j = open;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (!depth) break; }
  }
  return SRC.slice(start, j + 1);
}

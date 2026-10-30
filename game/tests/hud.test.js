'use strict';
/**
 * Tests for the one-row invariant of the in-game header (#hud).
 *
 * There is no module here: this is a CSS-level contract that three separate iterations
 * have had to re-establish by measurement, and every one of them got it wrong in the same
 * direction — a new HUD element was added, the row was checked on the level it happened to
 * be checked on, and the header quietly grew on the levels nobody looked at.
 *
 * ## What the measurements were
 *
 * Measured in headless Chromium, `#hud` height against viewport width, one pixel at a time,
 * for all 12 shipped levels plus a review, in both mistake-counter states:
 *
 *   - 300-375px: 46px        (the level name is dropped)
 *   - 376-400px: 63 / 97 / 131px   ← the name came back at 376 and the row wrapped
 *   - 410-416px: the row overhung its own header on 三字经·对句 with a 💧 counter
 *
 * and, the one that matters, with the 💧 mistake counter shown — the state a child is in the
 * moment they are struggling, and the state every previous sweep had left switched off:
 *
 *   - 320px, level 8:  114px  (68px of play area gone)
 *   - 320px, level 12:  97px
 *   - 390px, level 12:  46px
 *
 * The height driver was never the chips: it was `.dots{flex-wrap:wrap}`, which stacked one
 * 12px round dot per row as soon as the flex line left the dot row only a few pixels. Seven
 * rounds became a 114px column of dots.
 *
 * So the contract these tests pin is not "the header is 46px at 320" — a string assertion
 * cannot know that. It is the set of structural properties that make 46px true at every
 * width for every level, plus the floor values the real data measured out.
 *
 *   node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'qwen.html');

const page = () => fs.readFileSync(PAGE, 'utf8');

function slice(src, a, b) {
  const i = src.indexOf(a);
  const j = src.indexOf(b, i);
  assert.ok(i > -1 && j > i, `could not slice ${a} .. ${b}`);
  return src.slice(i, j);
}

/** Strip CSS comments: the file explains these rules in prose next to them, and a naive
 *  indexOf lands on the sentence rather than the declaration. */
function uncomment(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The block of CSS that opens at `sel`, up to its closing brace. */
function rule(src, sel) {
  const clean = uncomment(src);
  const i = clean.indexOf(sel);
  assert.ok(i > -1, `${sel} is missing from the stylesheet`);
  const end = clean.indexOf('}', i);
  assert.ok(end > i, `${sel} has no closing brace`);
  return clean.slice(i, end + 1);
}

/** The narrow-phone media block that carries the HUD adaptations. */
function narrowBlock(src) {
  const i = src.indexOf('#hud{gap:5px;}');
  assert.ok(i > -1, 'the narrow-phone HUD block is missing');
  const head = src.lastIndexOf('@media', i);
  assert.ok(head > -1, 'the HUD adaptations are not inside a media query');
  return {
    at: head,
    breakpoint: Number(/@media \(max-width:(\d+)px\)/.exec(src.slice(head, i))[1]),
    body: slice(src, '@media (max-width:', '\n}\n#promptCard'),
  };
}

function levels() {
  const src = page();
  // The pools and the level table are one lexical unit; take both or neither.
  const start = src.indexOf('const A=s=>Array.from(s);');
  const end = src.indexOf('\n];', src.indexOf('const LEVELS=[')) + 3;
  assert.ok(start > -1 && end > start + 3, 'could not slice the data block');
  const ctx = vm.createContext({});
  vm.runInContext(src.slice(start, end), ctx, { filename: 'qwen.html#data' });
  return vm.runInContext('LEVELS', ctx);
}

/* ------------------------------------------------------------------ *
 * the row itself
 * ------------------------------------------------------------------ */

test('the header is one flex line and never wraps', () => {
  const src = page();
  assert.ok(/flex-wrap:nowrap/.test(rule(src, '#hud{')), rule(src, '#hud{'));
  // `overflow:hidden` would be wrong here: the icon buttons carry a 4px 3D shadow that sits
  // below the header box, and clipping it would flatten the whole row for a gain that only
  // matters below 300px wide.
  assert.ok(!/overflow:hidden/.test(rule(src, '#hud{')), rule(src, '#hud{'));
});

test('the round dots clip instead of stacking into extra rows', () => {
  // This is the actual bug: `.dots{flex-wrap:wrap}` put one dot per row whenever the row
  // left it a few pixels, turning a 46px header into 114px — 68px of the play area.
  const src = page();
  const dots = rule(src, '.dots{');
  assert.ok(/flex-wrap:nowrap/.test(dots), dots);
  assert.ok(/min-width:0/.test(dots), 'the dot row cannot shrink, so it pushes the row wide');
  assert.ok(/overflow:hidden/.test(dots), 'the dot row must clip what does not fit');
  // `safe center`, not `center`: plain centre alignment clips the *start* of an overflowing
  // row, so a squeezed dot row would show the middle of a level instead of the rounds done.
  assert.ok(/justify-content:safe center/.test(dots), dots);
  // ...and the dots must keep their size rather than flex-shrink into 4px slivers: clipped
  // full-size circles read as progress, slivers read as a rendering bug.
  assert.ok(/flex:0 0 auto/.test(rule(src, '.dot{')), rule(src, '.dot{'));
  // ...and nothing between the header and the prompt card can wrap either. (The result
  // card's word grid further down legitimately does — it is a grid, not a fixed row.)
  const header = uncomment(slice(src, '#hud{display:flex;', '#promptCard{display:flex;'));
  assert.ok(!/flex-wrap:wrap/.test(header), header);
});

test('the mistake counter takes the dots\' place on a phone that cannot hold both', () => {
  const src = page();
  const narrow = narrowBlock(src);
  // Measured: the five chips are 270px plus 25px of gaps in a 304px header, which leaves the
  // dot row 9px. Squeezing a 7-dot counter into 9px shows neither indicator properly.
  assert.ok(/#hud:has\(\.missChip\.show\) \.dots\{display:none;\}/.test(narrow.body), narrow.body);
  // It has to be the `.show` state that is overridden: `.missChip` is display:none by
  // default, and `.missChip.show` is specificity (0,2,0) — a plain `.missChip` rule inside the
  // media query would lose to it and the counter would simply never appear.
  assert.ok(/^\.missChip\.show\{display:inline-flex/.test(rule(src, '.missChip.show{')), 'the default state moved');
  // The counter must not be hidden outright: it is the thing the result card's 再练练 list is
  // built from, and the toast already reports each individual mistake.
  assert.ok(!/\.missChip(\.show)?\{display:none/.test(narrow.body), 'the mistake counter is hidden on narrow phones');
});

/* ------------------------------------------------------------------ *
 * the measured breakpoint
 * ------------------------------------------------------------------ */

test('the level name is dropped across the whole band that could not hold it', () => {
  const src = page();
  const narrow = narrowBlock(src);
  // 376 was measured on level 1, whose name is the shortest in the table. Re-swept against
  // every level in both mistake states, the name reappearing at 376 needs 417 before the row
  // fits again — so 376 is not a cut-off, it is the start of a 41px band of phones (including
  // every iPhone 12/13/14 width) where the header overhung its own edge.
  assert.ok(narrow.breakpoint >= 417, `the breakpoint is ${narrow.breakpoint}px; 416 still overhangs`);
  assert.ok(/\.lvlChip \.lname\{display:none;\}/.test(narrow.body), narrow.body);
  // ...and the score chip, which is the thing that has to keep moving, is never the one dropped.
  assert.ok(!/\.scoreChip\{display:none/.test(narrow.body), narrow.body);
  assert.ok(!/\.scoreChip #scoreN\{display:none/.test(narrow.body), narrow.body);
});

test('the ground truth those measurements were taken from is still the worst case', () => {
  // The breakpoint is a pixel count standing in for "the widest level name plus the most round
  // dots plus a mistake counter". Nothing ties those three numbers together automatically, so
  // pin them: a level added with a longer name, or one with more rounds, invalidates the
  // measurement and the next pass has to re-sweep rather than trust 419.
  const L = levels();
  const names = L.map((l) => l.name);
  assert.ok(names.every((n) => [...n].length <= 6), 'a level name is wider than the ones measured: ' + names.join(','));
  assert.equal(Math.max(...L.map((l) => l.rounds)), 8, 'a level now has more round dots than the worst measured case');
  // The two ends of the range are held by different levels — 三字经·对句 has the widest name,
  // 国学小状元 the most dots — which is exactly why the cut-off was swept across all twelve
  // rather than taken from whichever level happened to be open.
  assert.ok(names.some((n) => [...n].length === 6), 'no level has the widest measured name any more: ' + names.join(','));
  assert.ok(L.some((l) => l.rounds === 8), 'no level has the most measured dots any more');
  assert.equal(new Set(names).size, names.length, 'two levels now share a name');
});

test('the HUD holds exactly the six elements the measurements accounted for', () => {
  // Each extra fixed-width chip is paid for in board height (or in a squeeze); a seventh would
  // invalidate every number above, so the row's contents are part of the contract.
  const src = page();
  const hud = slice(src, '<header id="hud">', '</header>');
  const ids = [...hud.matchAll(/id="([a-zA-Z0-9]+)"/g)].map((m) => m[1]).filter((id) => id !== 'hud');
  assert.deepEqual(ids, ['btnHome', 'lvlChip', 'lvlNo', 'lvlName', 'lvlKind', 'scoreChip', 'scoreN', 'dotsWrap', 'missChip', 'missN', 'btnMute']);
  // The three that carry information the child reads mid-round.
  for (const id of ['scoreChip', 'dotsWrap', 'missChip']) {
    assert.ok(hud.includes(`id="${id}"`), `${id} is gone from the header`);
  }
});
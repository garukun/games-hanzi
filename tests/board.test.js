'use strict';
/**
 * Tests for the inlined Board module inside qwen.html.
 *
 * Same trick as tests/palette.test.js and tests/pace.test.js: the module ships
 * inside the single-file page, so we slice it out between the BOARD START/END
 * markers and evaluate it in a vm context. It touches no browser globals.
 *
 * Two things are measured here rather than asserted by shape, because the defect
 * this fixes was a measurement: bubble *fill* (what share of the play area the
 * bubbles cover) and placement failures (how often a board spawns a bubble on
 * top of another one).
 *
 *   - The original formula was clamp(minDim*0.085, 28, 60), and 60 is reached at
 *     minDim=706px, so every tablet drew 60px bubbles no matter how big the board
 *     was. Measured in Chromium: a 768x1024 tablet filled 7.2% of its board at
 *     level 1 against a 320x568 phone's 7.7% of a board a quarter the size, and
 *     its four level-1 bubbles never touched once in six seconds — so the help
 *     modal's 泡泡会轻轻碰撞 was false on that device at that level.
 *   - The density cap is untouched, so this cannot make a board denser than the
 *     game already allowed; what it does move is the *low* end of the range.
 *   - The compatibility guarantee is the load-bearing claim, so it is tested as
 *     arithmetic: for every board at or below the reference phone's area the new
 *     formula must equal qwen's original formula exactly, across a sweep of sizes,
 *     bubble counts and text lengths.
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

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function slice(src, a, b) {
  const i = src.indexOf(a);
  const j = src.indexOf(b, i);
  assert.ok(i > -1 && j > i, `could not slice ${a} .. ${b}`);
  return src.slice(i, j);
}

function loadBoard() {
  const html = page();
  const start = html.indexOf('/* ==== BOARD START ==== */');
  const endMark = '/* ==== BOARD END ==== */';
  const end = html.indexOf(endMark);
  assert.ok(start > -1 && end > start, 'BOARD markers not found in qwen.html');
  const src = html.slice(start, end + endMark.length);
  const ctx = vm.createContext({});
  vm.runInContext(src + '\nglobalThis.__board = Board;', ctx, { filename: 'qwen.html#board' });
  assert.ok(ctx.__board, 'Board was not defined by the extracted module');
  return ctx.__board;
}

/** qwen's original radiusFor, transcribed. Anything at or below the reference
    phone's area must still produce these numbers, to the last float. */
function legacy(W, H, count, len) {
  const area = W * H;
  const maxR = 0.5 * Math.sqrt(area / (count * 2.1));
  let r1 = Math.max(28, Math.min(Math.min(W, H) * 0.085, 60));
  let r = r1 * [1, 1.16, 1.3][Math.min(2, len - 1)];
  r = Math.min(r, maxR);
  r = Math.max(r, 22);
  const fs = len === 1 ? r * 0.92 : len === 2 ? r * 0.6 : Math.max(13, r * 0.5);
  return { r, fs };
}

/** The level table, so the suite runs against the twelve boards that ship. */
function loadLevels() {
  const src = slice(page(), 'const A=s=>', '/* ============ AUDIO SFX');
  const ctx = vm.createContext({});
  vm.runInContext(src + '\nglobalThis.__levels = LEVELS;', ctx, { filename: 'qwen.html#levels' });
  const LEVELS = ctx.__levels;
  assert.ok(Array.isArray(LEVELS) && LEVELS.length, 'LEVELS not found');
  assert.ok(Array.isArray(LEVELS[0].pool), 'the level rows carry their vocabulary');
  return Array.from(LEVELS);   // out of the vm realm, so deepStrictEqual behaves
}

/** Text length for a level's bubbles: a phrase bubble carries three characters. */
const LEN = { char: 1, word: 2, phrase: 3 };

/* Play areas measured in Chromium at deviceScaleFactor 1, per level. */
const PHONE = [[304, 424], [371, 636], [409, 784], [456, 700]];
const BIG = [[516, 816], [731, 861], [781, 1017], [984, 605]];

/* ------------------------------------------------------------------ *
 * the compatibility guarantee
 * ------------------------------------------------------------------ */

test('every board at or below the reference phone is bit-identical to the original formula', () => {
  const B = loadBoard();
  // 320x568, 390x780, 430x932, 480x800 and the short-screen 320x540 the stylesheet
  // adapts for — each with every bubble count the twelve levels use and all three text lengths.
  let checked = 0;
  for (const [W, H] of PHONE) {
    for (let count = 4; count <= 12; count++) {
      for (const len of [1, 2, 3]) {
        const want = legacy(W, H, count, len);
        const got = B.radius(W, H, count, len);
        assert.ok(Number.isFinite(got.r) && Number.isFinite(got.fs), `junk radius at ${W}x${H}/${count}/${len}`);
        assert.equal(got.r, want.r, `radius changed at ${W}x${H}, ${count} bubbles, ${len} chars`);
        assert.equal(got.fs, want.fs, `glyph size changed at ${W}x${H}, ${count} bubbles, ${len} chars`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 100, `sweep was too small to be meaningful (${checked})`);
});

test('room() is exactly 1 at and below the reference area, so the guarantee above is not luck', () => {
  const B = loadBoard();
  assert.equal(B.room(409, 784), 1);
  assert.equal(B.room(304, 424), 1);
  assert.equal(B.room(456, 700), 1);
  // …and it is the sqrt of the area ratio above it, not a table of devices.
  assert.equal(B.room(781, 1017), Math.sqrt((781 * 1017) / B.REF));
});

test('no board anywhere gets smaller than it had', () => {
  const B = loadBoard();
  // Grow-only: a shrink would move a tap ring, a font size and a physics radius that sixteen
  // earlier iterations measured on the phone.
  for (let W = 260; W <= 1400; W += 23) {
    for (let H = 300; H <= 1300; H += 41) {
      for (let count = 3; count <= 14; count++) {
        for (const len of [1, 2, 3]) {
          assert.ok(
            B.radius(W, H, count, len).r >= legacy(W, H, count, len).r - 1e-9,
            `radius shrank at ${W}x${H}, ${count} bubbles, ${len} chars`
          );
        }
      }
    }
  }
});

/* ------------------------------------------------------------------ *
 * the constants, pinned to the measurements they came from
 * ------------------------------------------------------------------ */

test('every constant is the number it was measured as', () => {
  const B = loadBoard();
  // These six are qwen's original values, transcribed. The whole phone-compatibility guarantee
  // rests on them, so a "harmless" tidy-up to any of them is a behaviour change and must be a
  // deliberate edit of this test rather than an accident.
  assert.equal(B.FRAC, 0.085, 'radius as a share of the short side');
  assert.equal(B.R_MIN, 28, 'the smallest a bubble may ever be');
  assert.equal(B.R_MAX, 60, 'the ceiling this change lifts in proportion to the board');
  assert.equal(B.FLOOR, 22, 'below maxR a board has to overlap; this is qwen\'s original floor');
  assert.equal(B.PACK, 2.1, 'maxR\'s packing density — π/2.1 = 37.4% of the board at most');
  assert.deepStrictEqual(Array.from(B.TIER), [1, 1.16, 1.3], '一字 / 二字 / 三字');
  assert.equal(B.REF, 320950, 'the play area of a 430x932 phone: 409x784');
  // …and the two that are new, restated so a retune has to be deliberate.
  assert.equal(B.GAP, 8, 'nextRound\'s original clearance between two bubbles');
  assert.equal(B.TRIES, 70, 'the original number of random draws');
  assert.ok(B.PITCH > 0 && B.PITCH <= 0.5, 'the lattice pitch is coarser than half a bubble');
});

test('the floor really is the floor: a board too small to pack falls back to it', () => {
  const B = loadBoard();
  // Unreachable with a real viewport — which is exactly why it needs a test of its own: the only
  // way to observe FLOOR at all is to hand the module a degenerate board.
  assert.equal(B.radius(0, 0, 4, 1).r, B.FLOOR);
  assert.equal(B.radius(NaN, NaN, 4, 1).r, B.FLOOR);
  assert.equal(B.radius(10, 10, 4, 1).r, B.FLOOR);
});

/* ------------------------------------------------------------------ *
 * the defect: a 60px ceiling on every tablet
 * ------------------------------------------------------------------ */

test('a tablet no longer starves its bubbles at the old 60px ceiling', () => {
  const B = loadBoard();
  // The ceiling is reached at minDim=706px, which is every tablet the game will run on.
  assert.equal(legacy(731, 861, 4, 1).r, 60, 'the old ceiling is not where this test thinks it is');
  assert.equal(legacy(781, 1017, 4, 1).r, 60);
  const grown = B.radius(781, 1017, 4, 1).r;
  assert.ok(grown > 60, `tablet level 1 still capped at 60 (got ${grown})`);
  // …and by the measured ratio, not an arbitrary one.
  assert.ok(Math.abs(grown - 60 * B.room(781, 1017)) < 1e-9);
});

test('the level-1 tablet board now covers a usable share of the screen', () => {
  const B = loadBoard();
  const before = B.fill(781, 1017, 4, legacy(781, 1017, 4, 1).r);
  const after = B.fill(781, 1017, 4, B.radius(781, 1017, 4, 1).r);
  assert.ok(before < 0.07, `baseline moved: ${before}`);
  assert.ok(after >= 0.12, `tablet level 1 still looks empty: ${after.toFixed(3)}`);
  assert.ok(after < 0.20, `tablet level 1 now looks crowded: ${after.toFixed(3)}`);
});

test('every shipped level fills more of a big board than it used to, or exactly as much', () => {
  const B = loadBoard();
  const LEVELS = loadLevels();
  for (const cfg of LEVELS) {
    for (const [W, H] of BIG) {
      const len = LEN[cfg.type];
      const before = B.fill(W, H, cfg.bubbles, legacy(W, H, cfg.bubbles, len).r);
      const after = B.fill(W, H, cfg.bubbles, B.radius(W, H, cfg.bubbles, len).r);
      assert.ok(after >= before - 1e-9, `level ${cfg.id} at ${W}x${H} got emptier`);
    }
  }
});

test('the density ceiling is untouched: no board anywhere exceeds the packing limit', () => {
  const B = loadBoard();
  // maxR is the game's own limit: count circles of radius maxR cover π/2.1 = 37.4% of the board.
  const limit = Math.PI / B.PACK;
  const LEVELS = loadLevels();
  for (const cfg of LEVELS) {
    for (const [W, H] of PHONE.concat(BIG)) {
      const len = LEN[cfg.type];
      const f = B.fill(W, H, cfg.bubbles, B.radius(W, H, cfg.bubbles, len).r);
      assert.ok(f <= limit + 1e-9, `level ${cfg.id} at ${W}x${H} is denser than the game allows: ${f}`);
    }
  }
});

test('the level ramp survives: an easier level is still a less crowded board', () => {
  const B = loadBoard();
  const LEVELS = loadLevels().filter((c) => c.type === 'char');
  for (const [W, H] of [[409, 784], [731, 861], [781, 1017]]) {
    let prev = 0;
    for (const cfg of LEVELS) {
      const f = B.fill(W, H, cfg.bubbles, B.radius(W, H, cfg.bubbles, 1).r);
      assert.ok(f >= prev - 1e-9, `level ${cfg.id} at ${W}x${H} is denser than the level before it`);
      prev = f;
    }
    assert.ok(prev > 0, 'the sweep measured nothing');
  }
});

test('the three text lengths keep their size ladder', () => {
  const B = loadBoard();
  // 4 bubbles on a big board, so maxR's ceiling is nowhere near and the tiers decide.
  const one = B.radius(781, 1017, 4, 1);
  const two = B.radius(781, 1017, 4, 2);
  const three = B.radius(781, 1017, 4, 3);
  assert.ok(one.r < two.r && two.r < three.r, 'the tier ladder is not monotonic');
  assert.ok(Math.abs(one.r * B.TIER[0] - one.r) < 1e-9);
  assert.ok(Math.abs(two.r / one.r - B.TIER[1]) < 1e-9);
  assert.ok(Math.abs(three.r / one.r - B.TIER[2]) < 1e-9);
  // A glyph never exceeds its own bubble, and the three-character floor still holds.
  assert.ok(one.fs < one.r && two.fs < two.r && three.fs < three.r);
  assert.ok(three.fs >= 13, 'a three-character glyph fell below the 13px floor');
});

/* ------------------------------------------------------------------ *
 * junk tolerance — a NaN radius is a bubble that never renders
 * ------------------------------------------------------------------ */

test('hostile geometry still returns a finite, on-screen radius', () => {
  const B = loadBoard();
  const junk = [
    [NaN, 400, 4, 1], [400, NaN, 4, 1], [Infinity, Infinity, 4, 1], [-Infinity, 1, 4, 1],
    [0, 0, 4, 1], [-10, -10, 4, 1], [1e308, 1e308, 12, 3], [undefined, undefined, 4, 1],
    ['400', '800', 4, 1], [400, 800, 0, 1], [400, 800, -3, 1], [400, 800, Infinity, 1],
    [400, 800, NaN, 1], [400, 800, 'x', 1], [400, 800, 4, 0], [400, 800, 4, -2],
    [400, 800, 4, NaN], [400, 800, 4, Infinity], [400, 800, 4, undefined], [400, 800, 4, 'abc'],
  ];
  for (const [W, H, count, len] of junk) {
    const got = B.radius(W, H, count, len);
    assert.ok(Number.isFinite(got.r), `r was ${got.r} for ${W}x${H}/${count}/${len}`);
    assert.ok(Number.isFinite(got.fs), `fs was ${got.fs} for ${W}x${H}/${count}/${len}`);
    assert.ok(got.r >= B.FLOOR, `r fell below the floor for ${W}x${H}/${count}/${len}`);
    assert.ok(got.fs > 0, `fs was ${got.fs} for ${W}x${H}/${count}/${len}`);
  }
});

test('fill() refuses to divide by a board that does not exist', () => {
  const B = loadBoard();
  assert.equal(B.fill(0, 0, 4, 30), 0);
  assert.equal(B.fill(400, 800, 0, 30), 0);
  assert.equal(B.fill(400, 800, 4, 0), 0);
  assert.equal(B.fill(NaN, 800, 4, 30), 0);
  assert.equal(B.fill(Infinity, 800, 4, 30), 0);
  // Infinity through both ends of the fraction: without a guard this is Infinity/Infinity = NaN,
  // and a NaN answer reads as "no fill" to any caller that compares it, so it must be 0 by name.
  assert.equal(B.fill(Infinity, 800, Infinity, 30), 0);
  assert.equal(B.fill(1e308, 1e308, 4, Infinity), 0);
  assert.ok(Math.abs(B.fill(400, 800, 4, 30) - (4 * Math.PI * 900) / 320000) < 1e-12);
});

test('room() and base() treat a non-finite board as no board at all', () => {
  const B = loadBoard();
  // `Infinity` is truthy and `Infinity > 0`, so a truthiness guard lets it through and the whole
  // formula answers Infinity — the hole Palette.at already had.
  for (const junk of [Infinity, -Infinity, NaN, 'x', undefined, null]) {
    assert.equal(B.room(junk, 800), 1, `room(${String(junk)}, 800)`);
    assert.equal(B.room(800, junk), 1, `room(800, ${String(junk)})`);
    assert.equal(B.base(junk, 800), B.R_MIN, `base(${String(junk)}, 800)`);
    assert.ok(Number.isFinite(B.radius(junk, 800, 4, 1).r), `radius(${String(junk)}, 800)`);
  }
});

test('base() is the un-tiered, un-capped size and is monotonic in the short side', () => {
  const B = loadBoard();
  assert.equal(B.base(0, 0), B.R_MIN);
  let prev = 0;
  for (let m = 200; m <= 1200; m += 20) {
    const r = B.base(m, m * 2);
    assert.ok(r >= prev, `base() fell at a ${m}px short side`);
    prev = r;
  }
});

/* ------------------------------------------------------------------ *
 * placement: rejection sampling alone fails once the board fills up
 * ------------------------------------------------------------------ */

const lcg = (seed) => {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
};

/** qwen's original placement: 70 uniform draws, then drop it anywhere. */
function legacySpot(r, placed, W, H, rand) {
  let x = 0, y = 0, ok = false;
  for (let k = 0; k < 70; k++) {
    x = r + rand() * (W - 2 * r);
    y = r + rand() * (H - 2 * r);
    ok = placed.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + r + 8);
    if (ok) break;
  }
  if (!ok) {
    x = r + rand() * (W - 2 * r);
    y = r + rand() * (H - 2 * r);
  }
  return { x, y, ok };
}

/** Lay out a whole board and report how many bubbles could not find a legal spot. */
function failures(which, W, H, count, r, seed) {
  const rand = lcg(seed);
  const placed = [];
  let bad = 0;
  for (let i = 0; i < count; i++) {
    const s = which === 'legacy' ? legacySpot(r, placed, W, H, rand) : BoardSpot(which)(r, placed, W, H, rand);
    if (!s.ok) bad++;
    placed.push({ x: s.x, y: s.y, r });
  }
  return bad;
}
let _Board;
function BoardSpot() {
  if (!_Board) _Board = loadBoard();
  return _Board.spot;
}

test('clearance() ignores rows it cannot read instead of turning them into phantom bubbles', () => {
  const B = loadBoard();
  assert.equal(B.clearance([], 10, 10), Infinity, 'an empty board has infinite room');
  assert.ok(Math.abs(B.clearance([{ x: 100, y: 0, r: 20 }], 0, 0) - 80) < 1e-9);
  // A row that is not a bubble must be skipped, not coerced. `Number(null && null.x)` is 0, so a
  // truthiness guard instead of a finiteness one silently plants a zero-radius bubble at the
  // origin — and then every bubble in the top-left quadrant of the board looks crowded.
  const withJunk = B.clearance([null, undefined, { x: 900, y: 900, r: 10 }], 0, 0);
  assert.ok(Math.abs(withJunk - (Math.hypot(900, 900) - 10)) < 1e-9, `got ${withJunk}`);
  // A NaN row must not poison the answer either: NaN never compares less than anything, so a
  // minimum that has not been set yet must stay unset rather than becoming NaN.
  const withNaN = B.clearance([{ x: NaN, y: 3, r: 10 }, { x: 0, y: 0, r: 10 }], 0, 0);
  assert.ok(Number.isFinite(withNaN), `a NaN row poisoned the answer: ${withNaN}`);
  assert.ok(Math.abs(withNaN + 10) < 1e-9, `got ${withNaN}`);
  assert.equal(B.clearance([null, { x: NaN, y: NaN, r: NaN }], 5, 5), Infinity, 'all-junk is an empty board');
});

test('the cheap random path answers almost every placement, so boards stay organic', () => {
  const B = loadBoard();
  // The lattice is a fallback. If it were the main path every board would be a visible grid, which
  // no failure count would catch — so count the draws: on an ordinary board spot() must answer from
  // the random phase, and it must stop as soon as it has an answer.
  const drawn = [];
  const rnd = () => { drawn.push(1); return 0.5; };      // one draw for x, one for y
  const s = B.spot(30, [{ x: 40, y: 40, r: 30 }], 400, 800, rnd);
  assert.ok(s.ok, 'an uncrowded board should always find a spot on the first attempt');
  assert.equal(drawn.length, 2, `expected one attempt (2 draws), spent ${drawn.length}`);
  assert.ok(Math.abs(s.x - 200) < 1e-9 && Math.abs(s.y - 400) < 1e-9, `rnd was not consulted: ${JSON.stringify(s)}`);
  // And when the random phase does run out, it is the lattice that answers, not a random guess.
  let calls = 0;
  const counter = () => { calls++; return 0.02; };   // always lands in the corner, always illegal
  const packed = Array.from({ length: 20 }, (_, i) => ({ x: 30 + (i % 5) * 70, y: 30 + Math.floor(i / 5) * 70, r: 30 }));
  const t = B.spot(30, packed, 400, 800, counter);
  assert.equal(calls, 2 * B.TRIES, `the random phase should have spent all ${B.TRIES} attempts, spent ${calls / 2}`);
  assert.equal(typeof t.ok, 'boolean');
});

test('the lattice fallback finds a legal spot wherever one provably exists', () => {
  const B = loadBoard();
  // The property, not a contrived case: for each of three crowded boards, a brute-force scan
  // decides whether a legal spot exists at all, and spot() must agree — found when one exists,
  // honestly reported missing when none does. A crowded board with a legal spot is exactly the
  // situation 70 uniform draws cannot resolve and the lattice sweep exists for.
  const W = 800, H = 1000, r = 94, need = r + B.GAP;
  const boards = {
    // a solid block in one corner, the rest of the board free
    block: Array.from({ length: 12 }, (_, i) => ({ x: 220 + (i % 4) * 205, y: 220 + Math.floor(i / 4) * 205, r })),
    // a wall down the middle with a single corridor along the bottom
    wall: Array.from({ length: 4 }, (_, i) => ({ x: 400, y: 130 + i * 200, r })),
    // packed solid: no legal spot anywhere
    packed: Array.from({ length: 25 }, (_, i) => ({ x: 120 + (i % 5) * 195, y: 120 + Math.floor(i / 5) * 195, r })),
  };
  const bruteForce = (placed) => {
    for (let x = r; x <= W - r; x += 4) {
      for (let y = r; y <= H - r; y += 4) {
        if (B.clearance(placed, x, y) > need) return true;
      }
    }
    return false;
  };
  const rand = lcg(1234);
  for (const [name, placed] of Object.entries(boards)) {
    const exists = bruteForce(placed);
    const runs = Array.from({ length: 30 }, () => B.spot(r, placed, W, H, rand));
    if (exists) {
      assert.ok(runs.every((s) => s.ok), `${name}: a legal spot exists but spot() missed it`);
    } else {
      assert.ok(runs.every((s) => !s.ok), `${name}: spot() claimed a spot a brute-force scan says is illegal`);
    }
    for (const s of runs) {
      assert.ok(s.x >= r - 1e-9 && s.x <= W - r + 1e-9, `${name}: x out of bounds`);
      assert.ok(s.y >= r - 1e-9 && s.y <= H - r + 1e-9, `${name}: y out of bounds`);
    }
  }
  // Guard against the fixture quietly degenerating into three easy boards.
  assert.equal(bruteForce(boards.block), true);
  assert.equal(bruteForce(boards.wall), true);
  assert.equal(bruteForce(boards.packed), false);
});

test('the shipped placement spawns overlapping bubbles far less often than the original', () => {
  const B = loadBoard();
  const LEVELS = loadLevels();
  // Three boards per device, 20 seeds per level, so every number is over the same 1180 placements:
  //   shipped      the old radii with the old placement — what the game did before this change
  //   radius-only  the new radii with the old placement — the regression the radius fix causes
  //   shipped now  the new radii with the lattice fallback — what the game does now
  for (const [W, H] of [[304, 424], [781, 1017]]) {
    let shipped = 0, radiusOnly = 0, now = 0, total = 0;
    for (const cfg of LEVELS) {
      const len = LEN[cfg.type];
      const oldR = legacy(W, H, cfg.bubbles, len).r;
      const newR = B.radius(W, H, cfg.bubbles, len).r;
      for (let s = 1; s <= 20; s++) {
        shipped += failures('legacy', W, H, cfg.bubbles, oldR, s * 7919);
        radiusOnly += failures('legacy', W, H, cfg.bubbles, newR, s * 7919);
        now += failures('board', W, H, cfg.bubbles, newR, s * 7919);
        total += cfg.bubbles;
      }
    }
    // Measured: 33 → 2 on a 320x568 phone, and 0 → 80 → 6 on an 820x1180 tablet. The floor is 2%
    // of bubbles, which is what is geometrically unavoidable at the game's own 37.4% packing
    // ceiling. (The tablet's `shipped` count is 0 only because its bubbles were *smaller*: a
    // sparser board cannot produce an overlap, which is the defect, not a baseline to beat.)
    assert.ok(now <= total * 0.02, `${W}x${H}: ${now}/${total} bubbles still spawn on top of another`);
    assert.ok(
      now * 4 <= radiusOnly,
      `${W}x${H}: the lattice fallback only got ${radiusOnly} → ${now}, which is not a fix`,
    );
    if (shipped > 0) {
      assert.ok(now <= shipped / 2, `${W}x${H}: ${now} failures against ${shipped} that shipped before`);
    }
  }
});

test('spot() keeps every bubble fully inside the board', () => {
  const B = loadBoard();
  const rand = lcg(99);
  for (const [W, H] of PHONE.concat(BIG)) {
    for (const count of [4, 8, 12]) {
      const r = B.radius(W, H, count, 1).r;
      for (let i = 0; i < 12; i++) {
        const s = B.spot(r, [], W, H, rand);
        assert.ok(s.x >= r - 1e-9 && s.x <= W - r + 1e-9, `x=${s.x} outside ${W}x${H} r=${r}`);
        assert.ok(s.y >= r - 1e-9 && s.y <= H - r + 1e-9, `y=${s.y} outside ${W}x${H} r=${r}`);
      }
    }
  }
});

test('spot() tolerates an empty, absent or junk board without throwing', () => {
  const B = loadBoard();
  for (const placed of [[], null, undefined, 'nope', {}, [null, undefined, { x: NaN, y: 0, r: 30 }]]) {
    for (const [W, H, r] of [[400, 800, 30], [10, 10, 30], [0, 0, 0], [NaN, NaN, NaN], [1e308, 1e308, 94]]) {
      const s = B.spot(r, placed, W, H, lcg(7));
      assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y), `junk coordinates for ${JSON.stringify([W, H, r])}`);
      assert.equal(typeof s.ok, 'boolean');
    }
  }
});

test('the lattice sweep is bounded, so a huge board cannot stall a frame', () => {
  const B = loadBoard();
  const rand = lcg(3);
  const placed = Array.from({ length: 12 }, (_, i) => ({ x: 20 + i * 30, y: 20 + i * 30, r: 60 }));
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) B.spot(94, placed, 4000, 4000, rand);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 1500, `200 fallback placements on a 4000x4000 board took ${ms.toFixed(0)}ms`);
  // …and the sweep really is capped, not merely fast.
  assert.ok(B.MAX_CELLS <= 32, 'the lattice cap grew past the point of being a bound');
});

/* ------------------------------------------------------------------ *
 * wiring
 * ------------------------------------------------------------------ */

test('radiusFor delegates to Board and keeps none of the old formula', () => {
  const src = stripComments(slice(page(), 'function radiusFor(len){', '\nfunction nextRound('));
  assert.ok(src.includes('Board.radius(G.W,G.H,G.cfg.bubbles,len)'), 'radiusFor no longer asks Board');
  for (const gone of ['0.085', '0.5*Math.sqrt', '1.16', '2.1', 'Math.max(22']) {
    assert.ok(!src.includes(gone), `radiusFor still computes ${gone} itself`);
  }
});

test('nextRound places every bubble through Board.spot and has no orphan fallback', () => {
  const src = stripComments(slice(page(), 'function nextRound(){', '\n/* The one place that owns'));
  assert.ok(src.includes('Board.spot(r,placed,G.W,G.H)'), 'nextRound does not use the placement helper');
  assert.ok(src.includes('const x=spot.x, y=spot.y'), 'the spot is not the bubble position');
  // The old "70 draws then drop it anywhere" is exactly the two statements this replaces.
  assert.ok(!/for\(let k=0;k<70/.test(src), 'the old rejection loop is still inline');
  assert.ok(!src.includes('if(!ok){ x=r+Math.random()'), 'the old give-up-and-drop-anywhere branch survived');
});

test('Board is declared before anything that can dereference it at load time', () => {
  // The hazard this run has hit twice: a top-level `const Module=(()=>{…})()` that another
  // module's IIFE dereferences *while that IIFE runs* is a temporal-dead-zone dependency, and it
  // throws "Cannot access 'X' before initialization" on boot — invisible to every suite here,
  // because they all extract modules in isolation. `radiusFor` is a hoisted function called at
  // runtime, so its position does not matter; what matters is that no module body runs against
  // Board before Board exists.
  const src = page();
  const declAt = new Map(
    [...src.matchAll(/^const ([A-Z][A-Za-z0-9]*)=\(\(\)=>\{/gm)].map((m) => [m[1], m.index]),
  );
  assert.ok(declAt.has('Board'), 'Board is not declared as a module');
  assert.ok(declAt.size >= 9, `expected the module set, found ${declAt.size}`);
  for (const [name, at] of declAt) {
    if (name === 'Board') continue;
    const open = src.indexOf('=>{', at) + 3;
    let depth = 1, i = open;
    while (depth > 0 && i < src.length) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    for (const m of src.slice(open, i).matchAll(/\bBoard\./g)) {
      assert.ok(
        declAt.get('Board') < at,
        `${name} dereferences Board inside its IIFE but Board is declared later — ` +
          '"Cannot access \'Board\' before initialization" on boot',
      );
    }
  }
});

test('build.mjs guards the markers this suite slices on', () => {
  const build = fs.readFileSync(path.join(ROOT, 'build.mjs'), 'utf8');
  for (const marker of ['BOARD START', 'BOARD END']) {
    assert.ok(build.includes(`'${marker}'`), `build.mjs does not guard ${marker}`);
  }
});

test('no other module grew a private copy of the sizing formula', () => {
  const html = stripComments(page());
  // One owner for each constant, and the old inline expression is gone from the page entirely.
  assert.equal((html.match(/const PACK=2\.1;/g) || []).length, 1, 'the packing constant is duplicated or renamed');
  assert.equal((html.match(/const FRAC=0\.085;/g) || []).length, 1, 'the radius fraction is duplicated or renamed');
  assert.equal((html.match(/const REF=/g) || []).length, 1, 'the reference area is declared twice');
  assert.ok(!/0\.5\*Math\.sqrt\(area\/\(count\*2\.1\)\)/.test(html), 'the old inline maxR survived somewhere');
});

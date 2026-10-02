'use strict';
/**
 * Tests for the inlined Hit module inside qwen.html — tap forgiveness on moving bubbles.
 *
 * Same marker-extraction trick as tests/voice.test.js, tests/help.test.js and
 * tests/inset.test.js: the module ships inside the single-file page, so it is sliced
 * out between the HIT START/END markers and evaluated in a vm. Hit is pure (coordinates
 * in, bubble or null out), so the behavioural assertions actually *run* — no DOM stubs,
 * no timers.
 *
 * ## Why this exists
 *
 * A tap that missed a bubble used to do nothing at all: no word read aloud, no smile, no
 * sound, no hint that the screen is even listening. That is only tolerable if the target
 * is stationary. It is not — measured in Chromium at 320x568 on level 12 (12 bubbles,
 * 71.5px across) the path speed is 26 / 33 / 62 px/s for 慢/中/快, so a bubble slides
 * 8-15px while a child lines up a finger and 25px on the fast tier, against a target
 * 71.5px wide. The game was charging a 💧 mistake for a delay a five-year-old cannot
 * compensate for. gemini.html hit-tests a circle (gemini.html:934) and has exactly the
 * same hole.
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

/** Drop /* … *\/ comments: this file documents itself next to its own code, so a bare
    indexOf or regex finds the explanation before it finds the declaration. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Load the shipped module into a fresh vm. */
function loadHit() {
  const html = page();
  const start = html.indexOf('/* ==== HIT START ==== */');
  const endMark = '/* ==== HIT END ==== */';
  const end = html.indexOf(endMark);
  assert.ok(start > -1 && end > start, 'HIT markers not found in qwen.html');
  const src = html.slice(start, end + endMark.length);
  const ctx = vm.createContext({});
  vm.runInContext(src + '\nglobalThis.__hit = Hit;', ctx, { filename: 'qwen.html#hit' });
  const Hit = ctx.__hit;
  assert.ok(Hit, 'Hit was not defined by the extracted module');
  return Hit;
}

/** A board of bubbles, all at rest. */
function board(spec) {
  return spec.map(([x, y, r, extra]) => Object.assign({ x, y, r, dead: false }, extra || {}));
}

/* ------------------------------------------------------------------ *
 * the slop itself
 * ------------------------------------------------------------------ */

test('slop is a fraction of the radius, so it scales with the board', () => {
  const Hit = loadHit();
  // The exact relationship, not a table: a mutation that hard-codes 10px fails this.
  assert.equal(Hit.slop(40), 12);
  assert.equal(Hit.slop(20), 6);
  assert.equal(Hit.slop(80), 14);
});

test('slop is clamped at both ends', () => {
  const Hit = loadHit();
  // Ceiling: a 120px bubble on a tablet must not hand out a 36px ring, which would swallow a
  // neighbour in a crowded board.
  assert.equal(Hit.slop(200), 14);
  assert.ok(Hit.slop(200) <= Hit.MAX);
  // Floor: the smallest board the game renders (radiusFor's 22px floor) still gets something.
  assert.equal(Hit.slop(1), 6);
  assert.equal(Hit.slop(0), 6);
  assert.ok(Hit.slop(22) >= Hit.MIN);
});

test('the shipped slop covers the drift it was sized against', () => {
  const Hit = loadHit();
  // The measurements the 0.3 fraction came from, restated as an assertion so a future edit to
  // FRAC has to beat a number someone can read. 320x568, level 12: r=35.8, path speed
  // 26.3 / 33.3 / 61.5 px/s for 慢/中/快.
  const r = 35.8;
  const speed = { slow: 26.3, normal: 33.3, fast: 61.5 };
  const window = Hit.slop(r) / speed.normal;
  assert.ok(window > 0.3, `slop only covers ${(window * 1000).toFixed(0)}ms of 中-speed drift`);
  // ...and it must not be so generous that a 10px miss lands on a bubble: 0.3r of a 35.8px
  // bubble is ~11px, i.e. 15% of the 71.5px target width.
  assert.ok(Hit.slop(r) / (2 * r) < 0.2, 'the ring is wide enough to be a visible second target');
});

test('slop survives junk radii instead of returning NaN', () => {
  const Hit = loadHit();
  for (const v of [NaN, Infinity, -Infinity, null, undefined, {}, [], true, -5]) {
    const s = Hit.slop(v);
    assert.ok(Number.isFinite(s), `slop(${String(v)}) returned ${s}`);
    assert.equal(s, Hit.MIN, `slop(${String(v)}) should fall back to the floor`);
  }
  // A numeric string is a radius the board could genuinely hold, so it is honoured, not refused.
  assert.equal(Hit.slop('40'), 12);
});

/* ------------------------------------------------------------------ *
 * what a tap counts as
 * ------------------------------------------------------------------ */

test('the centre of a bubble is a hit, with or without the forgiveness', () => {
  const Hit = loadHit();
  const bs = board([[100, 100, 30]]);
  assert.equal(Hit.nearest(bs, 100, 100), bs[0]);
});

test('a tap 8px outside the edge is a hit — the case that used to do nothing', () => {
  const Hit = loadHit();
  const bs = board([[100, 100, 30]]);
  // r=30 -> slop 9, so 8px outside is inside the ring.
  assert.equal(Hit.nearest(bs, 138, 100), bs[0]);
  assert.equal(Hit.nearest(bs, 100, 138), bs[0]);
  // ...and just past the ring is still a miss.
  assert.equal(Hit.nearest(bs, 145, 100), null);
  assert.equal(Hit.nearest(bs, 100, 145), null);
});

test('a tap on the bare board is a miss', () => {
  const Hit = loadHit();
  const bs = board([[10, 10, 30], [300, 400, 30]]);
  assert.equal(Hit.nearest(bs, 160, 200), null);
});

test('the winner is the bubble the finger is furthest into', () => {
  const Hit = loadHit();
  // Two bubbles 72px apart — exactly touching, which is what the collision solver produces.
  // The midpoint of their contact is 6px outside A's edge and 6px inside B's edge, so only a
  // penetration rule can answer it; picking by centre distance calls it a tie and hands the
  // decision to spawn order.
  const bs = board([[100, 100, 36], [172, 100, 36]]);
  assert.ok(Hit.depth(bs[0], 142, 100) < 0, 'the probe point should be outside A');
  assert.ok(Hit.depth(bs[1], 142, 100) > 0, 'the probe point should be inside B');
  assert.equal(Hit.nearest(bs, 142, 100), bs[1]);
  assert.equal(Hit.nearest(bs, 130, 100), bs[0], 'mirrored, the point is inside A');
});

test('the slop is an acceptance test, not a ranking bonus', () => {
  const Hit = loadHit();
  // A 120px balloon and a 28px bubble, well separated. A tap 4px outside the *small* bubble's
  // edge is 20px outside the big one's, so both are forgiven candidates: if the ring width
  // were added to the score, the big bubble's larger ring would win and the child who aimed at
  // the small one would be handed the wrong word and a 💧 mistake for it.
  const bs = board([[100, 100, 60], [220, 100, 20]]);
  assert.equal(Hit.slop(60), 14, 'the big bubble has the wider ring');
  assert.equal(Hit.nearest(bs, 244, 100), bs[1]);
  // And a tap just past the small bubble's own ring is a miss, even though it is comfortably
  // inside the big one's: the ring that decides is the winner's.
  assert.equal(Hit.nearest(bs, 260, 100), null);
});

test('a forgiven tap is still answered — a hit, not silence', () => {
  const Hit = loadHit();
  const bs = board([[100, 100, 36]]);
  assert.equal(Hit.nearest(bs, 142, 100), bs[0]);
  assert.equal(Hit.at({ bubbles: bs }, 142, 100), bs[0]);
});

test('burst bubbles are never resurrected by the fallback', () => {
  const Hit = loadHit();
  // A correct tap sets dead and drops the bubble out of G.bubbles, but the element lingers for
  // its 300ms shrink-out and `tapBubble` refuses dead bubbles. The fallback has to refuse them
  // too, or a child double-tapping a burst bubble would score the round twice.
  const b = board([[100, 100, 30]])[0];
  b.dead = true;
  assert.equal(Hit.nearest([b], 100, 100), null);
  // ...including when it would otherwise have been the only, and the easiest, hit.
  assert.equal(Hit.at({ bubbles: [b] }, 100, 100), null);
});

test('the fallen bubble never blocks the live one next to it', () => {
  const Hit = loadHit();
  const dead = board([[100, 100, 30]])[0];
  dead.dead = true;
  const live = board([[180, 100, 30]])[0];
  assert.equal(Hit.nearest([dead, live], 180, 100), live);
  assert.equal(Hit.nearest([live, dead], 180, 100), live);
});

/* ------------------------------------------------------------------ *
 * hostile boards
 * ------------------------------------------------------------------ */

test('an empty or absent board is a miss, never a throw', () => {
  const Hit = loadHit();
  assert.equal(Hit.nearest([], 10, 10), null);
  assert.equal(Hit.nearest(null, 10, 10), null);
  assert.equal(Hit.nearest(undefined, 10, 10), null);
  assert.equal(Hit.nearest('nope', 10, 10), null);
  assert.equal(Hit.at(null, 10, 10), null);
  assert.equal(Hit.at({ bubbles: null }, 10, 10), null);
});

test('hostile pointer coordinates are refused rather than matched', () => {
  const Hit = loadHit();
  const bs = board([[100, 100, 30]]);
  for (const [x, y] of [[NaN, 100], [100, NaN], [Infinity, 100], [-Infinity, 100], [100, Infinity], [undefined, 100], [null, 100], ['100', 100]]) {
    assert.equal(Hit.nearest(bs, x, y), null, `(${String(x)},${String(y)}) matched a bubble`);
  }
});

test('a malformed bubble is skipped, not fatal to the round', () => {
  const Hit = loadHit();
  const good = board([[300, 100, 30]])[0];
  // Each of these is a row that only a bad edit could produce; a throw here would take the
  // whole tap handler down with it.
  for (const bad of [null, undefined, {}, { x: 100, y: 100 }, { x: 100, y: 100, r: 0 }, { x: NaN, y: 100, r: 30 }, { x: 100, y: Infinity, r: 30 }, { x: '100', y: 100, r: 30 }, { x: 100, y: 100, r: -5 }, { x: 100, y: 100, r: Infinity }]) {
    assert.equal(Hit.nearest([bad, good], 300, 100), good, `a malformed bubble (${JSON.stringify(bad)}) broke the search`);
  }
});

test('a whole board of malformed bubbles is a miss, not a crash', () => {
  const Hit = loadHit();
  assert.equal(Hit.nearest([null, undefined, {}, { x: NaN, y: NaN, r: NaN }], 10, 10), null);
});

test('a full board stays cheap enough to run on every near miss', () => {
  // The fallback only runs when the DOM hit failed, and it is O(bubbles) with a sqrt. The
  // densest board the game builds is 12; guard against an accidental quadratic rewrite.
  const Hit = loadHit();
  const bs = board(Array.from({ length: 12 }, (_, i) => [50 + i * 40, 300, 34]));
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20000; i++) Hit.nearest(bs, 7, 13);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 2000, `20k searches over a 12-bubble board took ${ms.toFixed(0)}ms`);
});

/* ------------------------------------------------------------------ *
 * the handler, executed
 *
 * A string-level assertion cannot tell a wired fallback from a dead one: a mutation that
 * inserts `return;` in front of the search leaves every `includes()` check green. So the real
 * `boardTap` is sliced out of the page and run against stub bubbles — the technique from
 * tests/inset.test.js, which executes loop() and promptIfHeard() the same way.
 * ------------------------------------------------------------------ */

function loadBoardTap(setup) {
  const html = page();
  const hitStart = html.indexOf('/* ==== HIT START ==== */');
  const hitEndMark = '/* ==== HIT END ==== */';
  const hitEnd = html.indexOf(hitEndMark);
  const fnStart = html.indexOf('function boardTap(e){');
  assert.ok(hitStart > -1 && hitEnd > hitStart, 'HIT markers not found in qwen.html');
  assert.ok(fnStart > hitEnd, 'boardTap is not declared after the Hit module');
  const fnEnd = html.indexOf('\n}', html.indexOf('tapBubble(b,e.clientX,e.clientY);', fnStart)) + 2;
  const src = html.slice(hitStart, hitEnd + hitEndMark.length) + '\n' + html.slice(fnStart, fnEnd);

  const calls = [];
  const ctx = vm.createContext({
    // client coords of the play area's top-left: the bubble board lives in its own space, so
    // this offset is what proves the handler converts.
    $: () => ({ getBoundingClientRect: () => ({ left: 40, top: 90 }) }),
    // Faithful to the page's own first line, so a tap the page would swallow does not read as
    // a tap here: a locked round and a burst bubble are both real, both reachable.
    tapBubble: (b, cx, cy) => {
      if (!ctx.G || ctx.G.lock || !b || b.dead) return;
      calls.push({ b, cx, cy });
    },
    globalThis: undefined,
  });
  ctx.globalThis = ctx;
  vm.runInContext(src + '\nglobalThis.__hit = Hit; globalThis.__tap = boardTap;', ctx, { filename: 'qwen.html#boardTap' });
  const G = (setup && setup.G) || { bubbles: [], lock: false };
  const run = (ev) => {
    ctx.G = G;
    calls.length = 0;
    ctx.__tap(ev);
    return calls;
  };
  return { run, G, Hit: ctx.__hit };
}

/** A pointerup event whose target resolves to no bubble (closest() -> null). */
function bareTap(x, y) {
  return { clientX: x, clientY: y, target: { closest: () => null } };
}

test('a tap in the gap still answers — the bug this exists for', () => {
  const b = board([[100, 100, 30]])[0];   // b.x/b.y are play-area *local*
  // 8px outside the bubble, in client space: the whole point of the fallback.
  const { run } = loadBoardTap({ G: { bubbles: [b], lock: false } });
  const calls = run(bareTap(40 + 100 + 38, 90 + 100));
  assert.equal(calls.length, 1, 'a near miss was ignored — no word read, no smile, no sound');
  assert.equal(calls[0].b, b);
  assert.equal(calls[0].cx, 178, 'the client coordinates must reach tapBubble, not the local ones');
});

test('the fallback converts client coordinates into the board\'s own space', () => {
  // b.x/b.y are play-area local. Without the rect the search would look up the wrong corner and
  // every forgiveness hit would miss instead — the fallback would exist and do nothing.
  const near = board([[100, 100, 30]])[0];
  const { run } = loadBoardTap({ G: { bubbles: [near], lock: false } });
  assert.equal(run(bareTap(140, 190)).length, 1, 'client coords were not offset by the play-area rect');
  // The same point in *local* space: nowhere near the bubble, so nothing should answer.
  const far = board([[300, 300, 30]])[0];
  const r2 = loadBoardTap({ G: { bubbles: [far], lock: false } });
  assert.equal(r2.run(bareTap(140, 190)).length, 0, 'the search is running in the wrong space');
});

test('an exact DOM hit is used as-is and never re-searched', () => {
  // The DOM path is the cheap one and it is what keeps the face and the glyph hit-testing
  // identical to before. Here `closest` finds a bubble while the *search* would prefer a
  // different (nearer, deeper) one, which is exactly the disagreement this pins.
  const domHit = board([[40 + 300, 90 + 300, 30]])[0];
  domHit._b = domHit;
  const nearer = board([[40 + 100, 90 + 100, 30]])[0];
  const { run, Hit } = loadBoardTap({ G: { bubbles: [nearer, domHit], lock: false } });
  assert.ok(Hit, 'the Hit module was not loaded alongside boardTap');
  const ev = { clientX: 40 + 300, clientY: 90 + 300, target: { closest: () => ({ _b: domHit }) } };
  const calls = run(ev);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].b, domHit, 'the exact DOM hit was replaced by a search result');
});

test('a tap on the bare board does nothing', () => {
  const bs = board([[40, 90, 30], [340, 490, 30]]);
  const { run } = loadBoardTap({ G: { bubbles: bs, lock: false } });
  assert.equal(run(bareTap(200, 300)).length, 0);
});

test('a tap with no level behind it cannot throw', () => {
  // #playArea and its handler exist in the DOM before any level does. Note there is no `if(!G)`
  // in the handler: Hit.at() treats a missing game as an empty board, so a guard there could
  // never change the outcome. See the "no !G guard" mutation in the harness history.
  const { run } = loadBoardTap({ G: null });
  assert.doesNotThrow(() => run(bareTap(200, 300)));
  assert.equal(run(bareTap(200, 300)).length, 0);
  const empty = loadBoardTap({ G: { bubbles: [], lock: false } });
  assert.equal(empty.run(bareTap(200, 300)).length, 0);
});

test('a burst bubble under the finger swallows the tap instead of scoring a neighbour', () => {
  // A correct tap sets dead and drops the bubble out of G.bubbles, but its element lingers for
  // the 300ms shrink-out animation, so it can still be what closest() finds. The DOM path then
  // hands it to tapBubble, which refuses it — and that refusal must be the end of the story.
  // Re-searching here would let a child double-tapping a burst bubble score whatever live
  // bubble happened to drift under their finger, which is how a round gets a 💧 for free.
  const dead = board([[100, 100, 30]])[0];
  dead.dead = true;
  const live = board([[132, 100, 30]])[0];   // 2px past the dead one's edge
  const { run } = loadBoardTap({ G: { bubbles: [live], lock: false } });
  const ev = { clientX: 40 + 100, clientY: 90 + 100, target: { closest: () => ({ _b: dead }) } };
  assert.equal(run(ev).length, 0, 'a swallowed tap was replaced by a search result');
});

test('a dead bubble is not reachable even through the fallback', () => {
  const b = board([[100, 100, 30]])[0];
  b.dead = true;
  const { run } = loadBoardTap({ G: { bubbles: [b], lock: false } });
  assert.equal(run(bareTap(40 + 100, 90 + 100)).length, 0, 'the fallback can score an already-burst bubble');
});

/* ------------------------------------------------------------------ *
 * structural guards in the page
 * ------------------------------------------------------------------ */

test('the module is declared before the handler that runs it', () => {
  const src = page();
  assert.ok(src.indexOf('/* ==== HIT START ==== */') < src.indexOf('function boardTap(e){'), 'Hit is used above its declaration');
  assert.ok(src.includes("$('#playArea').addEventListener('pointerup',boardTap);"), 'boardTap is not the registered handler');
  assert.ok(page().includes('if(G.lock||b.dead)return;'), 'the tap guards were removed');
});

test('the forgiveness is invisible — no ring is drawn for a child to aim at', () => {
  // A visible hit ring would teach the child that the big circle is the real target, which is
  // the opposite of the point: the slop exists so that the *visual* bubble is the target. The
  // <style> block is the only place in this single-file page that can declare CSS, so scanning
  // every class name in it is exhaustive.
  const src = stripComments(page());
  const css = slice(src, '<style>', '</style>');
  const classes = (css.match(/\.[A-Za-z][\w-]*/g) || []).map((c) => c.slice(1));
  const offenders = classes.filter((c) => /hit|slop/i.test(c));
  assert.deepEqual(offenders, [], 'a stylesheet rule styles the hit ring');
  // And a bubble only ever carries the classes nextRound gives it: bubble, spawn, and its
  // species. A ring class has nowhere to attach.
  assert.ok(src.includes("el.className='bubble spawn '+Faces.cls(sp2);"), 'the bubble class list is not the measured two');
  // slop()/depth() are the sizing rules; letting the page reach past at() would let a second
  // copy of the forgiveness grow somewhere that does not re-measure the drift.
  const uses = src.match(/Hit\.[A-Za-z]+/g) || [];
  assert.ok(uses.length > 0, 'the module is never called');
  for (const u of uses) assert.equal(u, 'Hit.at', `the page reaches for ${u} directly`);
});

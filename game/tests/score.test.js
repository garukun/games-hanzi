'use strict';
/**
 * Tests for the inlined Score module inside qwen.html, plus the wiring that turns
 * gemini.html's live star counter into something a child can actually chase.
 *
 * ## Why this module exists
 *
 * gemini.html kept a `⭐ n` in its header and ticked it up on every correct tap,
 * paying `10 + combo*5`:
 *
 *   this.combo++;
 *   const extraBonus = (this.combo > 1) ? this.combo * 5 : 0;
 *   this.stars += (10 + extraBonus);
 *
 * qwen had no score at all. Its only in-play feedback was the round dots (which move
 * once per *round*, not per tap) and the 💧 mistake chip (which only ever goes up), so
 * on a 12-bubble phrase level a child could spend most of a round hunting with nothing
 * on screen confirming that the taps before this one counted. qwen also tracked the
 * streak and displayed it as 连对 ×N — displayed, but never paid out.
 *
 * ## What is different from gemini, and why it matters
 *
 *   1. `(streak-1)*STEP`, not `streak*STEP`. gemini paid 10 for the first hit of a
 *      streak and 20 for the second, so the number leapt the moment a child got lucky
 *      twice. The first step is flat.
 *   2. A cap. Levels 6-8 are two-target, so a clean run is a 14-hit streak and gemini's
 *      uncapped bonus would pay 70 for the last tap alone.
 *   3. Persistence. gemini has no storage at all, so its number was worthless the moment
 *      the page reloaded. Here the per-level record survives and shows on the level map.
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

function loadScore() {
  const html = page();
  const start = html.indexOf('/* ==== SCORE START ==== */');
  const endMark = '/* ==== SCORE END ==== */';
  const end = html.indexOf(endMark);
  assert.ok(start > -1 && end > start, 'SCORE markers not found in qwen.html');
  const src = html.slice(start, end + endMark.length);
  const ctx = vm.createContext({});
  vm.runInContext(src + '\nglobalThis.__score = Score;', ctx, { filename: 'qwen.html#score' });
  assert.ok(ctx.__score, 'Score was not defined by the extracted module');
  return ctx.__score;
}

/** Run the real Store against a fake localStorage. */
function loadStore(seed) {
  const src = page();
  const i = src.indexOf('const Store=(()=>{');
  const j = src.indexOf('/* ============ CONFETTI ============ */');
  assert.ok(i > -1 && j > i, 'Store body not found');
  const body = src.slice(i, j);
  const mem = seed === undefined ? {} : seed;
  const ctx = vm.createContext({
    Pace: { TIERS: { slow: 1, normal: 2, fast: 3 }, DEFAULT: 'normal' },
    localStorage: {
      getItem: (k) => (k in mem ? JSON.stringify(mem[k]) : null),
      setItem: (k, v) => { mem[k] = v; },
    },
    console,
  });
  vm.runInContext(body + '\nglobalThis.__store = Store;', ctx, { filename: 'qwen.html#store' });
  assert.ok(ctx.__store, 'Store was not defined');
  return { store: ctx.__store, mem };
}

/** The real LEVELS table, so assertions are about the game that actually ships. */
function loadLevels() {
  const src = page();
  const ctx = vm.createContext({});
  // Start at the top of the DATA block so the pool constants the levels reference are in scope.
  vm.runInContext(slice(src, 'const A=s=>Array.from(s);', '\nfunction pyOf(') + '\nglobalThis.__L = LEVELS;', ctx);
  assert.ok(Array.isArray(ctx.__L) && ctx.__L.length, 'LEVELS did not load');
  return ctx.__L;
}

/* ------------------------------------------------------------------ *
 * The payout curve
 * ------------------------------------------------------------------ */

test('a correct tap is always worth at least the base, whatever streak it claims', () => {
  const Score = loadScore();
  for (const s of [undefined, null, 0, -5, NaN, 'x', {}, [], 1.9]) {
    assert.ok(Score.gain(s) >= Score.BASE, 'gain(' + String(s) + ') = ' + Score.gain(s));
  }
});

test('the first hit of a streak and a lone hit pay the same', () => {
  const Score = loadScore();
  // This is the difference from gemini, which paid 10 then 20. A 4-year-old should read
  // "you are doing better", not "something happened".
  assert.strictEqual(Score.gain(1), Score.BASE);
  assert.strictEqual(Score.gain(0), Score.BASE, 'a streak cannot start below 1');
  assert.strictEqual(Score.gain(2), Score.BASE + Score.STEP, 'exactly one step, not two');
});

test('the bonus grows by a constant step, with no jump and no gap', () => {
  const Score = loadScore();
  const bonuses = [];
  for (let n = 1; n <= Score.STREAK_CAP; n++) bonuses.push(Score.gain(n) - Score.BASE);
  for (let i = 1; i < bonuses.length; i++) {
    assert.strictEqual(bonuses[i] - bonuses[i - 1], Score.STEP, 'step changed at streak ' + (i + 1));
  }
  assert.strictEqual(bonuses[0], 0, 'the curve must start flat');
});

test('the streak bonus is capped, so a 14-hit clean run cannot pay 70 for the last tap', () => {
  const Score = loadScore();
  assert.strictEqual(Score.gain(Score.STREAK_CAP + 1), Score.gain(Score.STREAK_CAP));
  assert.strictEqual(Score.gain(1e6), Score.gain(Score.STREAK_CAP));
  assert.ok(Score.gain(Score.STREAK_CAP) / Score.BASE <= 5,
    'a perfect run should be worth about 4.5x a single tap, not unboundedly more');
});

test('the cap is chosen from the real data, not from a guess', () => {
  const Score = loadScore();
  const LEVELS = loadLevels();
  let longest = 0;
  for (const L of LEVELS) longest = Math.max(longest, L.correct * L.rounds);
  // Levels 6-8 are the two-target ones; level 8 at 2 x 7 = 14 is the longest clean streak
  // the shipped data can actually produce.
  assert.strictEqual(longest, 14, 'the longest clean streak in the shipped levels changed');
  assert.ok(Score.STREAK_CAP >= 4 && Score.STREAK_CAP < longest,
    'the cap must be reachable but must also stop short of a whole level: ' + Score.STREAK_CAP);
});

test('a fractional or negative streak is floored into range rather than producing a weird award', () => {
  const Score = loadScore();
  assert.strictEqual(Score.gain(3.9), Score.gain(3), 'a fractional streak truncates');
  assert.strictEqual(Score.gain(-4), Score.gain(1));
  assert.strictEqual(Score.gain('4'), Score.gain(4), 'a numeric string still counts');
  // A non-finite streak means the caller's counter is corrupted, not that the child is
  // amazing, so it collapses to the plain BASE instead of the cap.
  assert.strictEqual(Score.gain(Infinity), Score.BASE);
  assert.strictEqual(Score.gain(-Infinity), Score.BASE);
});

/* ------------------------------------------------------------------ *
 * The accumulator
 * ------------------------------------------------------------------ */

test('hit() banks the points and hands back exactly what it added', () => {
  const Score = loadScore();
  Score.reset();
  assert.strictEqual(Score.value, 0);
  const a = Score.hit(1);
  assert.strictEqual(Score.value, a);
  const b = Score.hit(2);
  assert.strictEqual(Score.value, a + b);
  assert.strictEqual(a, Score.BASE);
  assert.ok(b > a, 'the second hit of a streak pays more than the first');
});

test('reset() returns the total to zero, so one level cannot carry a score into the next', () => {
  const Score = loadScore();
  Score.hit(5); Score.hit(6);
  assert.ok(Score.value > 0);
  Score.reset();
  assert.strictEqual(Score.value, 0);
  // ...and it must not go negative or NaN on a second reset.
  Score.reset();
  assert.strictEqual(Score.value, 0);
});

test('a whole clean level scores exactly what the curve predicts', () => {
  const Score = loadScore();
  const LEVELS = loadLevels();
  for (const L of LEVELS) {
    Score.reset();
    let streak = 0;
    for (let round = 0; round < L.rounds; round++) {
      for (let i = 0; i < L.correct; i++) Score.hit(++streak);
    }
    let predicted = 0;
    for (let n = 1; n <= L.correct * L.rounds; n++) predicted += Score.gain(n);
    assert.strictEqual(Score.value, predicted, 'level ' + L.id);
    assert.ok(Score.value > 0, 'every level must be worth playing');
  }
});

test('the module exports only what the game calls', () => {
  const Score = loadScore();
  assert.deepStrictEqual(Object.keys(Score).sort(), ['BASE', 'STEP', 'STREAK_CAP', 'gain', 'hit', 'reset', 'value']);
  // A dead export is a promise nobody keeps. If `hit` were ever split out and abandoned,
  // the chip would animate while the total stood still.
  const src = page();
  const body = slice(src, '/* ==== SCORE START ==== */', '/* ==== SCORE END ==== */');
  for (const name of ['gain', 'hit', 'reset']) assert.ok(body.includes(name + '('), name + ' is missing');
});

/* ------------------------------------------------------------------ *
 * Store: a best score that survives a reload
 * ------------------------------------------------------------------ */

test('setBest is max-only, so a worse replay can never erase a better record', () => {
  const { store } = loadStore();
  assert.strictEqual(store.setBest(3, 200), true, 'the first record is new');
  assert.strictEqual(store.setBest(3, 120), false, 'a worse run must not win');
  assert.strictEqual(store.bestOf(3), 200);
  assert.strictEqual(store.setBest(3, 250), true);
  assert.strictEqual(store.bestOf(3), 250);
});

test('a hostile or zero score is refused rather than stored', () => {
  const { store } = loadStore();
  for (const bad of [0, -5, NaN, undefined, null, 'x', {}, []]) {
    assert.strictEqual(store.setBest(1, bad), false, String(bad));
    assert.strictEqual(store.bestOf(1), 0, String(bad));
  }
  assert.strictEqual(store.setBest(1, 40.9), true, 'a fractional score truncates');
  assert.strictEqual(store.bestOf(1), 40);
});

test('bestOf reads 0 for a level that was never played or never cleared', () => {
  const { store } = loadStore();
  for (const id of [1, 7, 12, 999, undefined, null, 'x']) {
    assert.strictEqual(store.bestOf(id), 0, String(id));
  }
});

test('bestTotal sums only the real records, ignoring junk', () => {
  const { store } = loadStore({ 'paopao-guoxue-v2': { best: { 1: 100, 2: 50, 3: 'x', 4: null, 5: -9 } } });
  assert.strictEqual(store.bestTotal(), 150);
});

test('a junk `best` payload is repaired at boot, exactly like `known`', () => {
  for (const junk of [null, 'nope', 42, [1, 2, 3], true]) {
    const { store } = loadStore({ 'paopao-guoxue-v2': { best: junk } });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(store.best)), {}, 'junk: ' + JSON.stringify(junk));
    assert.strictEqual(store.setBest(1, 33), true, 'and the level must still be writable');
  }
});

test('the record is written to localStorage, so it survives a reload', () => {
  const { store, mem } = loadStore();
  store.setBest(5, 260);
  const key = 'paopao-guoxue-v2';
  assert.ok(key in mem, 'nothing was persisted');
  assert.strictEqual(JSON.parse(mem[key]).best[5], 260);
  // A lost write would still show correctly in-session, so reload it for real.
  const reloaded = loadStore({ 'paopao-guoxue-v2': JSON.parse(mem[key]) }).store;
  assert.strictEqual(reloaded.bestOf(5), 260);
});

test('a refused setBest does not write to localStorage at all', () => {
  const { store, mem } = loadStore();
  store.setBest(2, 100);
  const before = mem['paopao-guoxue-v2'];
  store.setBest(2, 50);
  assert.strictEqual(mem['paopao-guoxue-v2'], before, 'a no-op setBest must not rewrite the payload');
});

/* ------------------------------------------------------------------ *
 * Wiring: the number a child actually sees
 * ------------------------------------------------------------------ */

function wiring() {
  const src = page();
  return {
    src,
    startLevel: slice(src, 'function startLevel(id){', 'function buildDots()'),
    tap: slice(src, 'if(b.isTarget&&!b.found){', '} else if(!b.isTarget){'),
    // The wrong-tap branch lives *after* `tap` ends, so it has to be sliced from the page.
    wrong: slice(src, '} else if(!b.isTarget){', '$(\'#missN\').textContent=G.mistakes;'),
    combo: slice(src, 'function showCombo(', 'function hideCombo('),
    paint: slice(src, 'function paintScore(', '/* Re-arm a tapped bubble'),
    clear: slice(src, 'function levelClear(){', '/* The port of gemini.html'),
    map: slice(src, 'function renderMap(){', '/* ==== FACES START ==== */'),
  };
}

test('the HUD carries a score chip and a live score readout', () => {
  const src = page();
  assert.ok(src.includes('id="scoreChip"'), 'the score chip is missing from the HUD');
  assert.ok(src.includes('id="scoreN"'), 'the score readout is missing');
  // The chip has to sit inside the game HUD, not on some other screen.
  const hud = slice(src, '<header id="hud">', '</header>');
  assert.ok(hud.includes('id="scoreChip"'), 'the score chip is not in the HUD');
});

test('a correct tap banks the score, repaints the chip and feeds the combo chip', () => {
  const w = wiring();
  const i = w.tap.indexOf('Score.hit(G.streak)');
  assert.ok(i > -1, 'the correct branch must bank the score');
  // Assert the increment exists *before* comparing positions — a bare `indexOf(...) < i`
  // passes vacuously when the increment is missing, because -1 sorts first.
  const inc = w.tap.indexOf('G.streak++');
  assert.ok(inc > -1, 'the streak must be incremented');
  assert.ok(inc < i, 'Score.hit must run after the streak is incremented, or every tap pays the same');
  assert.ok(w.tap.includes('paintScore(pts,G.streak>=2)'), w.tap);
  assert.ok(w.tap.includes('showCombo(pts)'), 'the combo chip must be told what the tap was worth');
});

test('a wrong tap banks nothing and leaves the chip alone', () => {
  const w = wiring();
  assert.ok(w.wrong.includes('G.mistakes++; G.streak=0;'), w.wrong);
  assert.ok(!w.wrong.includes('Score.'), 'a wrong tap must not score: ' + w.wrong);
  assert.ok(!w.wrong.includes('paintScore('), w.wrong);
});

test('paintScore reads the module rather than the caller\'s argument', () => {
  const w = wiring();
  assert.ok(w.paint.includes("$('#scoreN').textContent=Score.value;"), w.paint);
  // ...and it must clear both animation classes, or a fast streak leaves `pop` stuck on and
  // the CSS animation never restarts, so the chip stops responding after the third tap.
  assert.ok(/classList\.remove\('pop','big'\)/.test(w.paint), w.paint);
  assert.ok(/clearTimeout\(paintScore\.t\)/.test(w.paint), w.paint);
});

test('the combo chip shows the bonus in points, not a star glyph', () => {
  const w = wiring();
  // It used to read `连对 ×N ⭐`, which is the same symbol as the star total — two numbers
  // on screen wearing one icon is exactly the ambiguity this port removes.
  assert.ok(w.combo.includes("'  +'+Score.gain(G.streak)+'分'"), w.combo);
  assert.ok(w.combo.includes("'连对 ×'+G.streak"), w.combo);
});

test('starting a level resets both the score and the chip it is painted into', () => {
  const w = wiring();
  assert.ok(w.startLevel.includes('Score.reset()'), w.startLevel);
  assert.ok(w.startLevel.includes('paintScore(0,false)'), w.startLevel);
  // Order matters: resetting the number before repainting is the only order that shows 0.
  assert.ok(w.startLevel.indexOf('Score.reset()') < w.startLevel.indexOf('paintScore(0,false)'));
});

test('the clear card banks the record before it renders the best score', () => {
  const w = wiring();
  const i = w.clear.indexOf('Store.setBest(G.cfg.id,Score.value)');
  assert.ok(i > -1, 'the record must be banked');
  assert.ok(i < w.clear.indexOf('Store.bestOf(G.cfg.id)'),
    'the card must read the record back after banking it, or it always shows the old one');
  assert.ok(w.clear.includes("$('#cScore')"), 'the clear card must report the score');
  assert.ok(w.clear.includes('新纪录'), 'beating the record has to be announced, not silently banked');
  // gemini printed one line of stats; qwen adds the score without dropping anything.
  for (const bit of ['用时 ', '失误 ', '最高连对 ']) assert.ok(w.clear.includes(bit), 'lost: ' + bit);
});

test('the level map shows each level\'s record and a running total', () => {
  const w = wiring();
  assert.ok(w.map.includes("$('#totalBest').textContent='🏆 '+Store.bestTotal()"), w.map);
  assert.ok(w.map.includes("bs.textContent=ul?(Store.bestOf(L.id)||''):''"), w.map);
  // A locked level has no record to show, and an empty one must not print "0".
  assert.ok(/bs\.textContent=ul\?/.test(w.map));
});

test('the score chip has the CSS it needs: a fixed-width readout and both animations', () => {
  const src = page();
  assert.ok(/\.scoreChip #scoreN\{[^}]*font-variant-numeric:tabular-nums/.test(src),
    'a proportional readout makes the chip change width on every tap and shove the round dots sideways');
  assert.ok(/\.scoreChip\.pop\{animation:scorePop/.test(src));
  assert.ok(/\.scoreChip\.big\{animation:scoreBig/.test(src));
  for (const kf of ['@keyframes scorePop{', '@keyframes scoreBig{']) {
    assert.ok(src.includes(kf), kf + ' is missing');
  }
  assert.ok(src.includes('.nodeBest{'), 'the level map needs a rule for the per-level record');
  assert.ok(src.includes('.cScore{'), 'the clear card needs a rule for the score line');
});

test('Score stays a call-time reference, so its position in the file cannot strand the boot', () => {
  const src = page();
  assert.ok(src.includes('const Score=(()=>{'), 'Score declaration not found');
  // No module IIFE may dereference Score while it runs — that would be a temporal-dead-zone
  // dependency if Score were ever moved below the caller, and it would throw on boot.
  const uses = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /(?<![A-Za-z.])Score\./.test(l));
  const declLine = src.split('\n').findIndex((l) => l.includes('const Score=(()=>{')) + 1;
  const endLine = src.split('\n').findIndex((l) => l.includes('/* ==== SCORE END ==== */')) + 1;
  for (const [line, text] of uses) {
    assert.ok(line < declLine || line > endLine,
      'Score is dereferenced inside its own IIFE at line ' + line + ': ' + text.trim());
  }
});
/* ------------------------------------------------------------------ *
 * The score chip must not cost the play area its header
 * ------------------------------------------------------------------ */

test('the level name lives in its own span, so a narrow screen can drop just that', () => {
  const src = page();
  // Measured in Chromium: adding a fourth fixed-width chip to the HUD grew it from 46px to
  // 116px at 320px wide, i.e. it took 70px off the board. The escape is to hide the
  // level *name* below 430px, which only works if the number and the name are separate nodes.
  assert.ok(src.includes('<span class="lname" id="lvlName">'), 'the level name needs its own span');
  assert.ok(src.includes('id="lvlNo"'), 'the level number needs its own span');
  const w = wiring();
  assert.ok(w.startLevel.includes("$('#lvlNo').textContent=id"), w.startLevel);
  assert.ok(
    w.startLevel.includes("$('#lvlName').textContent=rev?Review.LABEL:' · '+cfg.name"),
    w.startLevel,
  );
  // Writing straight into #lvlChip would destroy both spans on the first level start.
  assert.ok(!w.startLevel.includes("$('#lvlChip').textContent="), w.startLevel);
});

test('a narrow viewport drops the level name rather than wrapping the header', () => {
  const src = page();
  // Slice tightly: a loose slice from the breakpoint string picks up the *other* 375px block
  // (the map header's) and goes green even when the HUD adaptation has been widened away.
  const i = src.indexOf('#hud{gap:5px;}');
  assert.ok(i > -1, 'the narrow-phone HUD block is missing');
  const head = src.slice(Math.max(0, i - 60), i);
  const m = /@media \(max-width:(\d+)px\)\{\s*$/.exec(head);
  assert.ok(m, 'the HUD adaptation must stay gated on a breakpoint: ' + JSON.stringify(head));
  // 376 was measured on level 1, whose name is the *shortest* in the table. Swept against
  // every shipped level in both mistake states, a name wider than that reappears at 376 and
  // the row no longer fits: 三字经·对句 with a 💧 counter needs 417 before it fits again, so
  // 376 is the start of a 41px band — every iPhone 12/13/14 width — where the header overhung
  // its own edge. tests/hud.test.js owns the structural half of this.
  assert.ok(Number(m[1]) >= 417, `the breakpoint ${m[1]}px does not cover the 376-416 overflow band`);
  const block = slice(src, '#hud{gap:5px;}', '@keyframes scorePop{');
  assert.ok(/\.lvlChip \.lname\{display:none;\}/.test(block), block);
  // ...and it must not be the score chip that gets hidden.
  assert.ok(!/\.scoreChip\{display:none/.test(block), block);
  assert.ok(!/\.scoreChip #scoreN\{display:none/.test(block), block);
});

test('the level names the breakpoint was measured against are still the widest ones', () => {
  // The breakpoint is a fixed pixel count standing in for "as wide as the widest level name".
  // Nothing checks that relationship automatically, so pin the ground truth it was chosen from:
  // if a level is ever given a longer name than these, the cut-off has to be re-measured.
  const src = page();
  // The pools and the level table are one lexical unit; take both or neither.
  const start = src.indexOf('const A=s=>Array.from(s);');
  const end = src.indexOf('\n];', src.indexOf('const LEVELS=[')) + 3;
  assert.ok(start > -1 && end > start + 3, 'could not slice the data block');
  const ctx = vm.createContext({});
  vm.runInContext(src.slice(start, end), ctx, { filename: 'qwen.html#data' });
  const data = vm.runInContext("LEVELS", ctx);
  const names = data.map((L) => L.name);
  assert.ok(names.every((n) => [...n].length <= 6), 'a level name is now wider than the ones measured: ' + names.join(','));
  // The two levels that measured worst were the widest name *and* the most round dots, which is
  // why the fix had to hide the name rather than shrink the dots.
  const worst = data.filter((L) => [...L.name].length === 6);
  assert.ok(worst.length >= 3, 'expected the three 6-character level names, got ' + worst.map((L) => L.name).join(','));
  assert.ok(Math.max(...data.map((L) => L.rounds)) === 8, 'the busiest level is no longer 8 rounds');
});

test('the score chip and the level chip still share the chip look on a wide screen', () => {
  const src = page();
  assert.ok(src.includes('class="lvlChip scoreChip"'), 'the chip must inherit .lvlChip, not redefine it');
  // The gold fill is the only thing that distinguishes it, and it has to exist.
  assert.ok(/\.scoreChip\{[^}]*background:var\(--gold\)/.test(src), '.scoreChip has no fill');
});

test('the level map header stays one row: the title holds its width and the chips flex', () => {
  const src = page();
  // Measured in Chromium: with the title as the flex:1 item, the 🏆 record chip squeezed
  // 选择关卡 onto two lines at 320 and 390 wide. Measured after the fix: the header is 56px
  // and the title is one line at 300/320/360/390/414/480/820.
  assert.ok(/\.mapHead h2\{[^}]*flex:0 0 auto;white-space:nowrap;\}/.test(src), 'the title must hold its width');
  assert.ok(/\.mapHead \.chip\{[^}]*flex:0 1 auto;min-width:0;overflow:hidden/.test(src),
    'the chips must be the flexible items, so a number clips instead of the title stacking');
  assert.ok(!/\.mapHead h2\{[^}]*flex:1;\}/.test(src), 'the old flex:1 title rule is gone');
});

test('the redundant total hides on the narrowest phones; each level keeps its own record', () => {
  const src = page();
  assert.ok(src.includes('id="totalBest"'), 'the running total chip is missing');
  const block = slice(src, '@media (max-width:375px){ #totalBest{display:none;} }',
    '.rowLink{text-align:center');
  assert.ok(block.length > 0 && block.startsWith('@media'), block);
  // The per-node record must NOT be hidden by the same breakpoint — it is the finer-grained
  // information, and the total is just its sum.
  assert.ok(!/@media \(max-width:375px\)\{[^}]*\.nodeBest\{display:none/.test(src));
  assert.ok(src.includes("bs.textContent=ul?(Store.bestOf(L.id)||''):''"), 'per-node records are gone');
});

/* ------------------------------------------------------------------ *
 * The help modal must not trap a short phone
 * ------------------------------------------------------------------ */

test('the help card scrolls and is centred by margin:auto, not by align-items:center', () => {
  const src = page();
  // Measured in Chromium at 320x568: the card is 615px tall in a 568px viewport, so with
  // `align-items:center` + `overflow:visible` the top 23px — the 怎么玩？ title and the first
  // instruction row — was clipped, `cardScrollTop` stayed 0 through four swipes and
  // `window.scrollY` stayed 0 because `body{overflow:hidden}`. The clip was unreachable.
  assert.ok(/#modalHelp\{[^}]*align-items:flex-start;/.test(src), 'the overlay must not centre its child');
  assert.ok(!/#modalHelp\{[^}]*align-items:center;/.test(src), 'align-items:center is the trap');
  assert.ok(/\.helpCard\{[^}]*max-height:100%;overflow-y:auto;/.test(src), 'the card needs its own scroll box');
  assert.ok(/\.helpCard\{[^}]*margin:auto;/.test(src), 'margin:auto centres it only when it fits');
});

test('the help card uses the same escape hatch as the result card', () => {
  // .clearCard was fixed for exactly this in an earlier pass; the help card is the last
  // card in the file that had not been given it, and a future refactor must not undo
  // either one.
  const src = page();
  for (const sel of ['.helpCard{', '.clearCard{']) {
    const i = src.indexOf(sel);
    assert.ok(i > -1, sel + ' is missing');
    const block = src.slice(i, src.indexOf('}', i) + 1);
    assert.ok(/max-height:100%/.test(block), sel + ' has no max-height');
    assert.ok(/overflow-y:auto/.test(block), sel + ' cannot scroll');
    assert.ok(/margin:auto/.test(block), sel + ' does not use margin:auto');
  }
});

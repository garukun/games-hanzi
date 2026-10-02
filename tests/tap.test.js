'use strict';
/**
 * Tests for the locked-round tap contract in qwen.html — what a tap is *allowed* to do while
 * the round it lands in is not live.
 *
 * Same slicing trick as tests/hit.test.js: `tapBubble` is a top-level function in the single
 * file, so it is cut out between its signature and the end of its wrong-tap branch and run in a
 * vm with every one of its collaborators stubbed. The behavioural assertions therefore execute
 * the shipped control flow rather than matching its source text — which matters here, because
 * the defect was a *silent* one and every string-level assertion in the suite stayed green
 * against it for fifteen iterations.
 *
 * ## Why this exists
 *
 * `G.lock` is true in two windows: for 650ms after the board spawns (so the instruction can be
 * read out before the board goes live) and for the 1700ms the win animation runs before
 * nextRound() arms it again. Instrumented in Chromium at 320x568 on level 1, that is one
 * unbroken spell of **2368ms** between the tap that won a round and the tap that could score
 * the next one — the two windows are contiguous, not separate. The tap handler's first line
 * used to be `if(G.lock||b.dead)return;`, so a child tapping at a board that was on screen,
 * drifting and colliding got *nothing*: no word read aloud, no smile, no sound. Measured, 13
 * taps across the win pause produced 0 utterances and 0 sound effects.
 *
 * The fix inverts what a lock means. Feedback — the tap sound, the bounce, the word spoken,
 * the smile — is unconditional; only scoring waits for the round to be live. That keeps both
 * reasons the lock exists: a child cannot answer a phrase round before hearing it, and nobody
 * is charged a 💧 for tapping while the round they just finished is still on screen.
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
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

/**
 * Cut the shipped `tapBubble` out of the page and run it.
 *
 * Every collaborator is stubbed and *recorded*, so the tests can assert on what a tap caused
 * rather than on what it looks like. `G` is supplied by the caller because the lock is the
 * thing under test: the same function has to behave differently at lock=false and lock=true.
 */
function loadTapper(setup) {
  const html = page();
  const fnStart = html.indexOf('function tapBubble(b,clientX,clientY){');
  assert.ok(fnStart > -1, 'tapBubble was not found in qwen.html');
  // The function ends at the closing brace of its wrong-tap branch; the `const mc=` line is the
  // last statement before it and appears nowhere else in the file.
  const tail = html.indexOf("const mc=$('#missChip');", fnStart);
  assert.ok(tail > fnStart, "the wrong-tap branch's last statement was not found");
  const fnEnd = html.indexOf('\n}', tail) + 2;
  const src = stripComments(html.slice(fnStart, fnEnd));

  const log = {
    sfx: [], speaks: [], smiles: [], toasts: [], vib: [], confetti: [],
    score: [], combo: [], learned: [], missed: [], wins: 0,
  };
  const ctx = vm.createContext({
    Math,
    G: setup.G,
    // A vm context has no host timers, and the shake-cleanup timer is the only one the wrong
    // branch starts. A no-op is faithful enough: nothing in these tests depends on the class
    // being removed again 500ms later.
    setTimeout: () => 0,
    Store: { pace: setup.pace || 'normal' },
    Pace: { mul: (v) => ({ slow: 1, normal: 2, fast: 4 }[v] === undefined ? 2 : { slow: 1, normal: 2, fast: 4 }[v]) },
    SFX: {
      tap: () => log.sfx.push('tap'),
      ding: () => log.sfx.push('ding'),
      buzz: () => log.sfx.push('buzz'),
    },
    Voice: { speak: (t, o) => log.speaks.push({ text: t, interrupt: o && o.interrupt }) },
    smile: (b) => log.smiles.push(b.text),
    vib: (p) => log.vib.push(p),
    toast: (x, y, t, kind) => log.toasts.push({ x, y, t, kind }),
    pick: (a) => a[0],
    PRAISE: ['对啦！'],
    ENCO: ['再找找'],
    Confetti: { burst: (...a) => log.confetti.push(a[2]) },
    Score: { hit: (s) => { log.score.push(s); return 10 * s; } },
    paintScore: (pts, big) => log.combo.push({ paint: pts, big }),
    showCombo: (pts) => log.combo.push({ combo: pts }),
    hideCombo: () => log.combo.push({ hide: true }),
    Learned: { hit: (rt) => log.learned.push(rt), missed: (t, py) => log.missed.push([t, py]) },
    Praise: { spoken: () => '真棒！' },
    pyOf: (type, t) => type + ':' + t,
    roundWin: () => { log.wins++; },
    $: () => ({ classList: { add() {}, remove() {} }, textContent: '', style: {} }),
    globalThis: undefined,
  });
  ctx.globalThis = ctx;
  vm.runInContext(src + '\nglobalThis.__tap = tapBubble;', ctx, { filename: 'qwen.html#tapBubble' });
  return { tap: ctx.__tap, log, G: setup.G };
}

function bubble(spec) {
  return Object.assign({
    text: '山', r: 30, x: 0, y: 0, vx: 0, vy: 0,
    isTarget: false, found: false, dead: false,
    el: {
      classList: { add() {}, remove() {} },
      offsetWidth: 60,
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 60, height: 60 }),
    },
  }, spec || {});
}

function game(lock, over) {
  return Object.assign({
    lock, found: 0, need: 1, streak: 0, maxStreak: 0, mistakes: 0,
    rt: { type: 'char', text: '山' }, cfg: { type: 'char' }, bubbles: [],
  }, over || {});
}

/* ------------------------------------------------------------------ *
 * the locked round is heard, not judged
 * ------------------------------------------------------------------ */

test('a locked round still reads the tapped word out loud', () => {
  const G = game(true);
  const b = bubble({ text: '水' });
  const { tap, log } = loadTapper({ G });
  tap(b, 100, 200);
  assert.deepEqual(log.speaks.map((s) => s.text), ['水'],
    'a locked tap was silent — the child learns the screen is broken');
});

test('a locked tap interrupts, so tapping twice hears the second word', () => {
  const G = game(true);
  const { tap, log } = loadTapper({ G });
  tap(bubble({ text: '山' }), 1, 1);
  tap(bubble({ text: '水' }), 2, 2);
  assert.deepEqual(log.speaks, [
    { text: '山', interrupt: true },
    { text: '水', interrupt: true },
  ]);
});

test('a locked tap is heard four ways: sound, bounce, word, smile', () => {
  // The whole point is that the board acknowledges the finger. One of these alone could be
  // mistaken for coincidence; together they are an answer.
  const G = game(true);
  const b = bubble({ text: '月' });
  const { tap, log } = loadTapper({ G });
  tap(b, 5, 6);
  assert.ok(log.sfx.includes('tap'), 'no tap sound while locked');
  assert.ok(log.smiles.includes('月'), 'no smile while locked');
  assert.ok(b.vy < 0, 'the bubble did not bounce while locked');
  assert.deepEqual(log.speaks.map((s) => s.text), ['月']);
  assert.ok(b.vx !== 0, 'the horizontal kick was skipped while locked');
});

test('the bounce scales with the 泡泡速度 tier, live or not', () => {
  const slow = bubble();
  loadTapper({ G: game(true), pace: 'slow' }).tap(slow, 0, 0);
  const fast = bubble();
  loadTapper({ G: game(true), pace: 'fast' }).tap(fast, 0, 0);
  assert.ok(fast.vy < slow.vy, 'the locked tap kick ignored the pace tier');
});

test('a locked correct tap scores nothing at all', () => {
  const G = game(true, { need: 2, streak: 3, maxStreak: 3 });
  const b = bubble({ text: '山', isTarget: true });
  const { tap, log } = loadTapper({ G });
  tap(b, 10, 20);
  assert.equal(G.found, 0, 'the locked round banked a hit');
  assert.equal(G.streak, 3, 'a locked tap changed the streak');
  assert.equal(G.maxStreak, 3);
  assert.equal(b.found, false);
  assert.equal(b.dead, false, 'the target was consumed by a locked tap');
  assert.equal(log.wins, 0, 'a locked tap won the round');
  assert.deepEqual(log.score, [], 'a locked tap paid out score');
  assert.deepEqual(log.confetti, [], 'a locked tap burst confetti');
  assert.deepEqual(log.learned, [], 'a locked tap recorded a learned word');
  assert.ok(!log.sfx.includes('ding'), 'a locked tap played the success sound');
});

test('a locked wrong tap costs no mistake but is still heard', () => {
  const G = game(true, { streak: 4 });
  const b = bubble({ text: '目', isTarget: false });
  const { tap, log } = loadTapper({ G });
  tap(b, 12, 34);
  assert.equal(G.mistakes, 0, 'a 💧 was charged for a tap during a locked window');
  assert.equal(G.streak, 4, 'a locked tap broke a live streak');
  assert.deepEqual(log.missed, [], 'a locked tap wrote to the homework list');
  assert.ok(!log.sfx.includes('buzz'), 'a locked tap played the error sound');
  assert.deepEqual(log.toasts, [], 'a locked tap showed ✗ 对错 feedback');
  // ...but it was not silent:
  assert.deepEqual(log.speaks.map((s) => s.text), ['目']);
  assert.ok(log.smiles.includes('目'));
  assert.ok(log.sfx.includes('tap'));
});

test('the help modal promise 点错了也会读给你听 is true during the win pause', () => {
  // The literal claim in 怎么玩？ is that a wrong tap is read aloud. Before the fix it was only
  // true while the round was live, i.e. false for the 1.7s the win animation covers the screen.
  const G = game(true);
  const { tap, log } = loadTapper({ G });
  tap(bubble({ text: '太', isTarget: false }), 1, 1);
  assert.ok(log.speaks.length > 0 && log.toasts.length === 0,
    'the word must be read aloud, and nothing that looks like a verdict');
});

test('a burst bubble is still absolutely silent, locked or not', () => {
  // The one refusal that must survive: a correct tap marks the bubble dead but leaves its
  // element on screen for the 300ms shrink-out, so it can still be what the finger lands on.
  // Reading that bubble out loud would say the word the child just got right, for free.
  for (const lock of [false, true]) {
    const G = game(lock);
    const b = bubble({ text: '山', isTarget: true, found: true, dead: true });
    const { tap, log } = loadTapper({ G });
    tap(b, 0, 0);
    assert.deepEqual(log.speaks, [], 'a dead bubble was spoken while lock=' + lock);
    assert.deepEqual(log.smiles, [], 'a dead bubble smiled while lock=' + lock);
    assert.deepEqual(log.sfx, [], 'a dead bubble made a sound while lock=' + lock);
    assert.equal(G.found, 0);
    assert.equal(G.mistakes, 0);
  }
});

/* ------------------------------------------------------------------ *
 * the live round is unchanged
 * ------------------------------------------------------------------ */

test('a live correct tap still scores, bursts, praises and wins', () => {
  const G = game(false, { need: 1 });
  const rt = G.rt;
  const b = bubble({ text: '山', isTarget: true });
  const { tap, log } = loadTapper({ G });
  tap(b, 10, 20);
  assert.equal(G.found, 1);
  assert.equal(G.streak, 1);
  assert.equal(b.found, true);
  assert.equal(b.dead, true);
  assert.deepEqual(log.score, [1], 'the streak was not paid out');
  assert.ok(log.sfx.includes('ding'));
  assert.deepEqual(log.confetti, [14], 'the confetti burst count changed');
  assert.deepEqual(log.learned, [rt], 'the learned-word list was not written');
  assert.equal(log.wins, 1);
  // The praise is queued behind the word, never on top of it.
  assert.deepEqual(log.speaks.map((s) => s.text), ['山', '真棒！']);
  assert.equal(log.speaks[1].interrupt, false, 'the praise cut the pronunciation off');
  assert.deepEqual(log.toasts.map((t) => t.kind), ['good']);
});

test('a live wrong tap still charges a mistake and answers it with the word', () => {
  const G = game(false, { streak: 3 });
  const b = bubble({ text: '目', isTarget: false });
  const { tap, log } = loadTapper({ G });
  tap(b, 7, 8);
  assert.equal(G.mistakes, 1);
  assert.equal(G.streak, 0, 'a wrong tap must break the streak');
  assert.deepEqual(log.missed, [['目', 'char:目']]);
  assert.ok(log.sfx.includes('buzz'));
  assert.deepEqual(log.toasts.map((t) => t.kind), ['bad']);
  assert.deepEqual(log.speaks.map((s) => s.text), ['目']);
});

test('an already-found target cannot be scored twice in one live round', () => {
  // correct:2 rounds leave one copy of the target on the board. The `!b.found` half of the
  // condition is what stops the second copy paying out for the same answer.
  const G = game(false, { need: 2 });
  const b = bubble({ text: '山', isTarget: true });
  const { tap, log } = loadTapper({ G });
  b.found = true;                 // reachable only if the bubble outlives its own burst
  tap(b, 0, 0);
  assert.equal(G.found, 0);
  assert.equal(log.wins, 0);
  assert.deepEqual(log.score, []);
  // Still audible, though — it is a live board.
  assert.deepEqual(log.speaks.map((s) => s.text), ['山']);
});

/* ------------------------------------------------------------------ *
 * the lock windows themselves
 * ------------------------------------------------------------------ */

test('the lock gate sits after the feedback and before the scoring branch', () => {
  // A guard hoisted back above `SFX.tap()` would restore the silence while leaving every
  // behavioural test above green, because they all go in through the same door.
  const html = page();
  const src = stripComments(html.slice(html.indexOf('function tapBubble(b,clientX,clientY){')));
  const at = (s) => src.indexOf(s);
  assert.ok(at('SFX.tap()') > -1, 'the tap sound is gone from the handler');
  assert.ok(at('Voice.speak(b.text') > -1, 'the word is no longer read from the handler');
  assert.ok(at('smile(b);') > -1, 'the smile is gone from the handler');
  assert.ok(at('SFX.tap()') < at('if(G.lock)return;'), 'the lock gate was hoisted above the feedback');
  assert.ok(at('if(G.lock)return;') < at('if(b.isTarget&&!b.found)'),
    'the lock gate was moved below the scoring branch, so a locked round can score');
  assert.equal(src.split('if(G.lock)return;').length - 1, 1, 'there is more than one lock gate');
});

test('the lock is only ever armed or released in two functions', () => {
  // The 2368ms measurement above comes from exactly these sites: nextRound arms the spawn
  // window, its 650ms timer releases it, and roundWin arms the win window. A fourth site
  // would silently change how much of a round is spent waiting to be heard.
  const src = stripComments(page());
  const sites = [...src.matchAll(/G\.lock\s*=\s*(true|false)/g)]
    .map((m) => ({ value: m[1], at: m.index }));
  assert.equal(sites.length, 3, `expected 3 lock assignments, found ${sites.length}`);
  const around = (site, before, after) => src.slice(Math.max(0, site.at - before), site.at + after);
  assert.ok(around(sites[0], 120, 20).includes('G.round++;'), 'the first lock assignment is not in nextRound');
  assert.ok(around(sites[1], 60, 80).includes('},650);'), 'the release timer is no longer 650ms');
  assert.ok(around(sites[2], 60, 60).includes('cardReveal()'), 'the third lock assignment is not the win window');
});

test('the lock is read, not written, by the tap handler', () => {
  // `G.lock=false` here would make the board scoreable but also un-readable as a window; the
  // handler must only consult it.
  const src = stripComments(page());
  const fn = src.slice(src.indexOf('function tapBubble(b,clientX,clientY){'), src.indexOf('\n}', src.indexOf("const mc=$('#missChip');")) + 2);
  assert.ok(fn.includes('if(G.lock)return;'), 'the lock gate changed shape');
  assert.ok(!/G\.lock\s*=/.test(fn), 'the tap handler writes to the lock');
});

test('no other tap path can swallow a tap before it is heard', () => {
  // boardTap is the only pointerup listener on the board, and it hands straight to tapBubble.
  const src = page();
  const listeners = [...src.matchAll(/addEventListener\('(pointerup|click|touchend)'\s*,\s*([A-Za-z_$][\w$]*)/g)];
  const board = listeners.filter((m) => m[2] === 'boardTap');
  assert.equal(board.length, 1, 'the board is no longer bound to boardTap exactly once');
  assert.ok(src.includes("$('#playArea').addEventListener('pointerup',boardTap);"));
  // And the forgiveness fallback from iteration 15 reaches the same handler, so a near miss on
  // a locked board is now heard too.
  assert.ok(src.includes('if(b)tapBubble(b,e.clientX,e.clientY);'), 'the forgiveness path was unwired');
});
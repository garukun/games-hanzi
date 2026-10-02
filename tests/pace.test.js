'use strict';
/**
 * Tests for the inlined Pace module inside qwen.html.
 *
 * The module ships inside the single-file page, so — as in faces/praise/prompt
 * tests — we slice it out between the PACE START/END markers and evaluate it in
 * a vm context. It touches no browser globals.
 *
 * Unlike the other three modules, the strongest test here executes the *physics*
 * (step(), extracted too) against a seeded RNG and asserts on measured motion,
 * because the defect this fixes was a measurement, not a wording: qwen's bubbles
 * drifted at ~22 px/s — 0.37 px per frame, i.e. visually frozen — and produced
 * zero bubble collisions in five seconds, so the help modal's promise that
 * 泡泡会轻轻碰撞 never actually happened. A test that only checked the tier
 * table would have passed against the broken version.
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

function loadPace() {
  const html = page();
  const start = html.indexOf('/* ==== PACE START ==== */');
  const endMark = '/* ==== PACE END ==== */';
  const end = html.indexOf(endMark);
  assert.ok(start > -1 && end > start, 'PACE markers not found in qwen.html');
  const src = html.slice(start, end + endMark.length);
  const ctx = vm.createContext({});
  vm.runInContext(src + '\nglobalThis.__pace = Pace;', ctx, { filename: 'qwen.html#pace' });
  assert.ok(ctx.__pace, 'Pace was not defined by the extracted module');
  return ctx.__pace;
}

/** Extract the physics step so the tier can be measured, not just inspected. */
function loadStep(Pace, pace) {
  const src = page();
  const start = src.indexOf('function step(dt){');
  const end = src.indexOf('function render(){');
  assert.ok(start > -1 && end > start, 'step() not found in qwen.html');
  const code = src.slice(start, end);
  const ctx = vm.createContext({
    Math,
    Pace,
    Store: { pace },
    G: { bubbles: [], W: 0, H: 0 },
  });
  vm.runInContext(code + '\nglobalThis.__step = step;', ctx, { filename: 'qwen.html#step' });
  assert.ok(ctx.__step, 'step was not defined by the extracted function');
  return ctx;
}

/** Deterministic RNG so a physics measurement never flakes. */
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PHONE_W = 371;   // measured play area on a 390x780 viewport
const PHONE_H = 632;

/** Run the real physics for `secs` and report motion + how often bubbles overlap. */
function simulate(pace, { n = 8, r = 32, secs = 8, seed = 12345, W = PHONE_W, H = PHONE_H } = {}) {
  const Pace = loadPace();
  const rand = seeded(seed);
  const stepCtx = loadStep(Pace, pace);
  // A seeded Math for the vm: same builtins, one reproducible random().
  const seededMath = { random: rand };
  for (const k of Object.getOwnPropertyNames(Math)) seededMath[k] = Math[k];
  stepCtx.Math = seededMath;
  const G = stepCtx.G;
  G.W = W;
  G.H = H;
  // Initial velocities as nextRound() builds them, including the pace multiplier.
  const base = Pace.base(Math.min(W, H)) * Pace.mul(pace);
  for (let i = 0; i < n; i++) {
    const ang = rand() * Math.PI * 2;
    const sp = base * (0.7 + rand() * 0.6);
    G.bubbles.push({
      x: r + rand() * (W - 2 * r),
      y: r + rand() * (H - 2 * r),
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      r,
    });
  }
  const dt = 1 / 60;
  const frames = Math.round(secs / dt);
  let travelled = 0;
  let overlapFrames = 0;
  let escaped = 0;
  for (let f = 0; f < frames; f++) {
    const before = G.bubbles.map((b) => ({ x: b.x, y: b.y }));
    stepCtx.__step(dt);
    let overlap = 0;
    for (let i = 0; i < G.bubbles.length; i++) {
      const b = G.bubbles[i];
      travelled += Math.hypot(b.x - before[i].x, b.y - before[i].y);
      if (b.x < b.r - 0.5 || b.x > W - b.r + 0.5 || b.y < b.r - 0.5 || b.y > H - b.r + 0.5) escaped++;
      for (let j = i + 1; j < G.bubbles.length; j++) {
        const c = G.bubbles[j];
        if (Math.hypot(a2(b.x, c.x), a2(b.y, c.y)) < b.r + c.r) overlap++;
      }
    }
    if (overlap) overlapFrames++;
  }
  return {
    pxPerSec: travelled / secs / n,
    pxPerFrame: travelled / secs / n / 60,
    crossSec: Math.min(W, H) / (travelled / secs / n),
    overlapFrames,
    frames,
    escaped,
  };
}
const a2 = (a, b) => a - b;

/* ------------------------------------------------------------------ *
 * The tier table
 * ------------------------------------------------------------------ */

test('there are exactly three tiers, slow < normal < fast', () => {
  const P = loadPace();
  assert.deepStrictEqual(Array.from(P.ORDER), ['slow', 'normal', 'fast']);
  assert.strictEqual(Object.keys(P.TIERS).length, 3);
  const [s, n, f] = P.ORDER.map((k) => P.TIERS[k]);
  assert.ok(s < n && n < f, `tiers must be strictly ordered: ${s}/${n}/${f}`);
  assert.ok(s > 0, 'the slow tier must still move, not freeze the board');
});

test('normal is the default tier', () => {
  const P = loadPace();
  assert.strictEqual(P.DEFAULT, 'normal');
  assert.strictEqual(P.mul(undefined), P.TIERS.normal);
});

test('gemini.html offered the same three tiers, so this is a port and not a new dial', () => {
  // gemini.html:472-479  <div class="setting-group">…移动速度… slow/normal/fast
  const g = fs.readFileSync(path.join(ROOT, 'gemini.html'), 'utf8');
  assert.ok(g.includes('移动速度'), 'gemini.html no longer has the movement-speed setting');
  assert.ok(g.includes('data-value="slow"') && g.includes('data-value="normal"') && g.includes('data-value="fast"'));
});

/* ------------------------------------------------------------------ *
 * base() must reproduce qwen's original viewport formula
 * ------------------------------------------------------------------ */

test('base() is exactly the clamp qwen always used, so only the tier is new', () => {
  const P = loadPace();
  const orig = (minDim) => Math.max(20, Math.min(minDim * 0.05, 42));
  for (const minDim of [200, 320, 371, 480, 600, 780, 900, 1200, 1600]) {
    assert.strictEqual(P.base(minDim), orig(minDim), `base(${minDim}) drifted`);
  }
});

test('base() is floored at 20 and capped at 42', () => {
  const P = loadPace();
  assert.strictEqual(P.base(0), 20);
  assert.strictEqual(P.base(100), 20);
  assert.strictEqual(P.base(20000), 42);
});

/* ------------------------------------------------------------------ *
 * Junk input must never freeze the board
 * ------------------------------------------------------------------ */

test('an unknown tier falls back to normal rather than zero', () => {
  const P = loadPace();
  for (const v of [null, undefined, '', 'SLOW', 'faster', 0, -1, NaN, {}, [], true, 'normal ']) {
    assert.strictEqual(P.mul(v), P.TIERS.normal, `bad tier for ${JSON.stringify(v)}`);
  }
});

test('a zero multiplier would be a dead game, so none is ever reachable', () => {
  const P = loadPace();
  for (const k of P.ORDER) assert.ok(P.TIERS[k] > 0, `${k} must move`);
  assert.ok(P.range('slow', PHONE_W).min > 0);
});

/* ------------------------------------------------------------------ *
 * range()
 * ------------------------------------------------------------------ */

test('range() keeps the original 0.5x/1.7x bracket at every tier', () => {
  const P = loadPace();
  for (const k of P.ORDER) {
    const { min, max } = P.range(k, PHONE_W);
    assert.ok(max > min, `${k}: max must exceed min`);
    assert.ok(Math.abs(max / min - 1.7 / 0.5) < 1e-9, `${k}: bracket drifted to ${max / min}`);
  }
});

test('range() is strictly increasing with the tier', () => {
  const P = loadPace();
  let prev = 0;
  for (const k of P.ORDER) {
    const { max } = P.range(k, PHONE_W);
    assert.ok(max > prev, `${k} is not faster than the tier below it`);
    prev = max;
  }
});

test('range() scales with the screen, so a tablet is not slower than a phone', () => {
  const P = loadPace();
  const phone = P.range('normal', PHONE_W).max;
  const tablet = P.range('normal', 900).max;
  assert.ok(tablet > phone, `tablet (${tablet}) should drift faster than phone (${phone})`);
});

/* ------------------------------------------------------------------ *
 * The measured fix — the whole point of the module
 * ------------------------------------------------------------------ */

test('at the default tier the bubbles actually move on a phone screen', () => {
  const m = simulate('normal');
  // The broken version measured 0.37 px/frame — visually frozen.
  assert.ok(
    m.pxPerFrame >= 0.5,
    `default tier must be visibly in motion, got ${m.pxPerFrame.toFixed(2)} px/frame (${m.pxPerSec.toFixed(1)} px/s)`,
  );
  // ...but still calm enough that a five-year-old can catch the character they are hunting.
  assert.ok(m.crossSec >= 4, `crossing the screen in ${m.crossSec.toFixed(1)}s is too frantic to tap`);
});

test('the default tier is a real speed-up over the frozen one it replaces', () => {
  // The measured regression this module exists to fix: 22 px/s on a phone. Anything that
  // silently drifts back toward that reintroduces a board whose bubbles never move.
  const m = simulate('normal');
  assert.ok(m.pxPerSec > 22 * 2, `normal is only ${m.pxPerSec.toFixed(1)} px/s, barely above the old 22`);
  // And it holds up on a crowded level, where collisions absorb a lot of energy.
  const dense = simulate('normal', { n: 12 });
  assert.ok(dense.pxPerSec > 22, `dense board collapsed to ${dense.pxPerSec.toFixed(1)} px/s`);
});

test('the slow tier is the gentle one, for a child who cannot track a moving target', () => {
  const slow = simulate('slow');
  const normal = simulate('normal');
  assert.ok(
    slow.pxPerSec < normal.pxPerSec * 0.6,
    `slow=${slow.pxPerSec.toFixed(1)} normal=${normal.pxPerSec.toFixed(1)}`,
  );
  assert.ok(slow.pxPerSec > 0, 'slow must not be frozen');
  // slow is deliberately calmer than the old default; it is the "hold still so I can tap it" tier.
  assert.ok(slow.pxPerSec <= 26, `slow=${slow.pxPerSec.toFixed(1)} is no longer a slow tier`);
});

test('the fast tier is genuinely fast', () => {
  const fast = simulate('fast');
  assert.ok(fast.pxPerSec > 80, `fast=${fast.pxPerSec.toFixed(1)} px/s`);
  assert.ok(fast.crossSec < 5, `fast crosses in ${fast.crossSec.toFixed(1)}s`);
});

test('gemini.html tuned the whole range far livelier, which is why a port alone was wrong', () => {
  // gemini.html:546  speed = (0.8 + rand*0.6) * tier, in px per *frame* at 60fps:
  //   slow 58-100 px/s, normal 134-235, fast 230-403.
  // Even its slowest is ~3x this game's fastest, so copying the values would have made the
  // game unplayable. The dial is the port; the numbers are not.
  const fast = simulate('fast');
  assert.ok(fast.pxPerSec < 100, `fast must stay under gemini's slow tier, got ${fast.pxPerSec.toFixed(1)}`);
});

test('the bubbles actually collide — the promise the help modal makes', () => {
  // Help modal: 泡泡会轻轻碰撞. Measured against the unported version: 0 overlapping
  // pairs in five seconds even on a crowded board, so the speed was the cause and not
  // the bubble count. slow is excluded by design — it is the "hold still" tier.
  for (const pace of ['normal', 'fast']) {
    for (const n of [4, 12]) {
      const m = simulate(pace, { n, secs: 10 });
      assert.ok(
        m.overlapFrames > 0,
        `${pace} (${n} bubbles): never touched in 10s, so 泡泡会轻轻碰撞 is a lie at this pace`,
      );
    }
  }
});

test('no tier lets a bubble escape the play area', () => {
  for (const pace of ['slow', 'normal', 'fast']) {
    const m = simulate(pace, { secs: 12 });
    assert.strictEqual(m.escaped, 0, `${pace}: a bubble left the play area`);
  }
});

/* ------------------------------------------------------------------ *
 * Store wiring
 * ------------------------------------------------------------------ */

test('Store gains a pace key with a valid default', () => {
  const src = page();
  const store = src.slice(src.indexOf('/* ============ STORE'), src.indexOf('/* ============ CONFETTI'));
  assert.ok(/pace:'normal'/.test(store), 'the default tier is missing from the store');
  assert.ok(/get pace\(\)/.test(store), 'no pace getter');
  assert.ok(/setPace\(v\)/.test(store), 'no pace setter');
});

test('a persisted junk pace is repaired on boot, never left to freeze the board', () => {
  const src = page();
  const store = src.slice(src.indexOf('/* ============ STORE'), src.indexOf('/* ============ CONFETTI'));
  assert.ok(/if\(!Pace\.TIERS\[d\.pace\]\) d\.pace=Pace\.DEFAULT;/.test(store), 'no boot-time repair');
  assert.ok(/setPace\(v\)\{ d\.pace=Pace\.TIERS\[v\]\?v:Pace\.DEFAULT;/.test(store), 'setPace does not validate');
});

test('the old star/toggle store keys survive the new one', () => {
  const src = page();
  const store = src.slice(src.indexOf('/* ============ STORE'), src.indexOf('/* ============ CONFETTI'));
  for (const k of ['stars', 'sfx', 'voice', 'engine', 'speed', 'faces', 'pace']) {
    assert.ok(store.includes(k), `store lost ${k}`);
  }
  assert.ok(/paopao-guoxue-v2/.test(store), 'the localStorage key must not change or progress is lost');
});

/* ------------------------------------------------------------------ *
 * Load order — the one failure a string assertion can never catch
 * ------------------------------------------------------------------ */

test('the Store is built after Pace, or the whole page dies on boot', () => {
  // Store's IIFE calls Pace.TIERS at load time to repair a persisted value. A `const Pace`
  // declared *below* Store is in its temporal dead zone, so the page throws
  // "Cannot access 'Pace' before initialization" and the game never starts — and this is
  // invisible to every other test here, because they all extract modules individually.
  const src = page();
  const pace = src.indexOf('/* ==== PACE START ==== */');
  const store = src.indexOf('/* ============ STORE ============ */');
  assert.ok(pace > -1 && store > -1);
  assert.ok(pace < store, 'Pace must be declared before the Store that reads it');
});

test('the page boots with no reference errors', () => {
  // Broader guard on the same hazard: brace-match each module's IIFE body and make sure it
  // only reaches for modules declared ahead of it. An IIFE's body *does* run at load time,
  // so anything it dereferences is a hard TDZ dependency. (Plain textual "first use" is not
  // enough: prefetchLevel() mentions Praise hundreds of lines before Praise is declared,
  // and that is perfectly fine because the function is only called later.)
  const src = page();
  const declAt = new Map(
    [...src.matchAll(/^const ([A-Z][A-Za-z0-9]*)=\(\(\)=>\{/gm)].map((m) => [m[1], m.index]),
  );
  assert.ok(declAt.size >= 8, `expected the module set, found ${declAt.size}`);

  for (const [name, at] of declAt) {
    const open = src.indexOf('=>{', at) + 3;
    let depth = 1;
    let i = open;
    while (depth > 0 && i < src.length) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    const body = src.slice(open, i);
    for (const m of body.matchAll(/\b([A-Z][A-Za-z0-9]*)\./g)) {
      const dep = m[1];
      if (!declAt.has(dep)) continue;   // Map.has, not `in` — `in` would always be false here
      assert.ok(
        declAt.get(dep) < at,
        `${name} dereferences ${dep} inside its IIFE but ${dep} is declared later — ` +
          `"Cannot access '${dep}' before initialization" on boot`,
      );
    }
  }
});

/* ------------------------------------------------------------------ *
 * Physics wiring — string level where a DOM is required
 * ------------------------------------------------------------------ */

test('the physics step clamps with the tier, not the old hard-coded base', () => {
  const src = page();
  const step = src.slice(src.indexOf('function step(dt){'), src.indexOf('function render(){'));
  assert.ok(/Pace\.range\(Store\.pace,minDim\)/.test(step), 'step() must clamp via Pace.range');
  assert.ok(!/const minS=base\*0\.5, maxS=base\*1\.7/.test(step), 'the old hard-coded clamp is still there');
  // Read every frame so changing the setting re-paces a level already in progress.
  assert.ok(step.indexOf('Pace.range(Store.pace') < step.indexOf('for(const b of bs)'), 'read it per frame');
});

test('spawn velocity is scaled by the tier too', () => {
  const src = page();
  const fn = src.slice(src.indexOf('function nextRound('), src.indexOf('function speakTarget('));
  assert.ok(/Pace\.mul\(Store\.pace\)/.test(fn), 'new bubbles must be born at the chosen pace');
  // One formula behind the base speed, so the spawn velocity and the step() clamp cannot
  // drift apart — which is exactly what a copy of clamp(minDim*0.05,20,42) here would do.
  assert.ok(/Pace\.base\(Math\.min\(G\.W,G\.H\)\)/.test(fn), 'nextRound must reuse Pace.base');
  assert.ok(!/clamp\(Math\.min\(G\.W,G\.H\)\*0\.05/.test(fn), 'the inline clamp is still there');
});

test('the tap kick is scaled by the tier so a bounce feels the same at any pace', () => {
  const src = page();
  const fn = src.slice(src.indexOf('function tapBubble('), src.indexOf('function showCombo('));
  assert.ok(/Pace\.mul\(Store\.pace\)/.test(fn), 'the tap impulse must follow the tier');
  assert.ok(!/b\.vy-=26;/.test(fn), 'the old fixed-magnitude kick is still there');
});

test('the random nudge scales with the tier, so slow bubbles wander instead of stalling', () => {
  const src = page();
  const step = src.slice(src.indexOf('function step(dt){'), src.indexOf('function render(){'));
  assert.ok(/const jit=rng\.max\*0\.28;/.test(step), 'the nudge must be a fraction of the drift');
  assert.ok(!/\*16\*dt/.test(step), 'the old unscaled nudge is still there');
});

/* ------------------------------------------------------------------ *
 * Settings UI
 * ------------------------------------------------------------------ */

test('the help modal exposes all three tiers as a segmented control', () => {
  const src = page();
  const row = src.slice(src.indexOf('<div class="setRow"><span class="setLab">🌊 泡泡速度'), src.indexOf('</div></div>', src.indexOf('泡泡速度')) + 12);
  assert.ok(row.length, 'no 泡泡速度 row in the help modal');
  for (const k of ['slow', 'normal', 'fast']) {
    assert.ok(row.includes(`data-v="${k}"`), `tier ${k} has no button`);
  }
  // Labels must ascend in speed, left to right.
  const labels = [...row.matchAll(/data-v="(\w+)">([^<]*)</g)].map((m) => m[2]);
  assert.deepStrictEqual(labels, ['慢', '中', '快']);
});

test('the pace control is wired and highlighted like every other segment', () => {
  const src = page();
  assert.ok(/wireSeg\('#optPace',\(\)=>Store\.pace,v=>Store\.setPace\(v\)\);/.test(src), 'not wired');
  assert.ok(/\$\$\('#optPace \.seg'\)\.forEach\(b=>b\.classList\.toggle\('on',b\.dataset\.v===Store\.pace\)\);/.test(src), 'not highlighted');
});

test('the help text points parents at the new control', () => {
  assert.ok(page().includes('泡泡速度可以按孩子的反应调慢一点'));
});
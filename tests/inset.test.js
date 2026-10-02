'use strict';
/**
 * Tests for in-game settings access — the ⚙️ in the prompt card.
 *
 * ## The gap
 *
 * gemini.html put ⚙️ 设置 in its *game* header (`gemini.html:396`), so the voice, the pace and
 * the question type were one tap away in the middle of a level. qwen had exactly one way in:
 * the ❓ chip on the title screen. From a round that is 🏠 → 🏠 → ❓ → 开始 — four taps, and the
 * level you were in is thrown away.
 *
 * ## Why the gear is in the prompt card and not the header
 *
 * The header is at capacity: tests/hud.test.js pins its six elements, the 419px breakpoint and
 * the measured 46px height, and the round dots are its only flexible item. A seventh
 * fixed-width control there either wraps the row or starves them. The prompt card is the only
 * fixed row on the game screen with slack in it, and it already holds the two controls a child
 * needs *mid-round* (🔊 replay, 💡 hint).
 *
 * ## What had to be paid for it
 *
 * A third 34px circle in that row leaves the text ~126px at 320 wide, and 听一听，找一找 needs
 * 154px at 22px — it wraps, and the board loses 24px. The narrow-phone block below 419px pays
 * for the gear out of the card's chrome (gaps, padding, and the two text sizes) instead, and
 * the buttons themselves keep their size. Measured in Chromium against the same page without
 * the gear, 300/320/360/375/390/414/430/768 wide, in the listen state, the reveal state and both
 * mistake-counter states:
 *
 *   card height   320: 70 -> 66   360: 70 -> 66   390: 70 -> 66   430/768: unchanged
 *   play area     +4px at every width from 320 up; +2px at 300, narrower than any phone this
 *                 game ships a media query for.
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

/** Strip CSS comments: this file documents its rules in prose right next to them. */
function uncomment(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The declaration block that opens at `sel`, up to its closing brace. */
function rule(src, sel) {
  const clean = uncomment(src);
  const i = clean.indexOf(sel);
  assert.ok(i > -1, `${sel} is missing from the stylesheet`);
  const end = clean.indexOf('}', i);
  assert.ok(end > i, `${sel} has no closing brace`);
  return clean.slice(i, end + 1);
}

/** A `function name(...)` declaration and its body, brace-matched. */
function fn(src, sig) {
  const i = src.indexOf(sig);
  assert.ok(i > -1, `${sig} is missing from the page`);
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  throw new Error(`${sig} has no closing brace`);
}

/** The prompt card's markup, without the CSS around it. */
const card = (src) => slice(src, '<div id="promptCard">', '\n      </div>');

/* ------------------------------------------------------------------ *
 * the control
 * ------------------------------------------------------------------ */

test('the prompt card carries a settings gear next to the two per-round controls', () => {
  const src = page();
  const ids = [...card(src).matchAll(/id="([a-zA-Z0-9]+)"/g)].map((m) => m[1]);
  // Exactly three controls' worth of markup: the two the child hunts for mid-round and the one
  // a grown-up needs. A fourth would invalidate every width measured above, so pin the roster —
  // the same contract tests/hud.test.js holds the header to.
  assert.deepEqual(ids, ['promptCard', 'btnSpeak', 'pBig', 'pSub', 'btnHint', 'btnSet']);
  const gear = slice(src, 'id="btnSet"', '</button>');
  assert.match(gear, /aria-label="[^"]*">\s*⚙/, `the gear has no glyph: ${gear}`);
  assert.match(gear, /aria-label="设置"/, 'a screen reader has to be able to name it');
});

test('the gear is a button in the markup, not a div with a handler bolted on', () => {
  const src = page();
  assert.ok(/<button class="setBtn" id="btnSet"/.test(src), slice(src, 'id="btnSet"', '</button>'));
  // Enter/Space on a focused gear has to work, and :active has to move it: a control that only
  // responds to a tap reads as broken on a keyboard and feels dead on a slow phone.
  assert.ok(/\.setBtn:active\{/.test(uncomment(src)), '.setBtn has no pressed state');
  // Exactly one .setBtn block. A second one later in the sheet would silently override the
  // measured size, border and colour, and every assertion above would still be reading the
  // first — which is how a duplicate rule hides a layout regression.
  const blocks = uncomment(src).match(/\.setBtn\{/g) || [];
  assert.equal(blocks.length, 1, `the gear has ${blocks.length} rules; a later one would win`);
});

test('the gear opens the same modal the title screen does, and only during a level', () => {
  const src = page();
  const handler = src.split('\n').find((l) => l.includes("$('#btnSet').onclick="));
  assert.ok(handler, "the gear has no handler");
  assert.ok(handler.trim().endsWith(';'), `the handler is more than one statement: ${handler}`);
  // The DOM holds the gear before any level exists, and Help.open() with no level behind it is
  // a settings screen for a game that is not running — the same guard 🔊 and 💡 already carry.
  assert.ok(handler.includes('if(!G)return'), handler);
  assert.ok(handler.includes('Help.open()'), handler);
  // It must be the same module, not a second settings screen: one modal means one set of
  // toggles, one dismissal behaviour (backdrop, ✖, Escape) and one voice-stop on open.
  assert.ok(src.includes("$('#btnHelp').onclick=()=>Help.open();"), 'the title screen lost its ❓');
  assert.ok(src.includes("Help.attach($('#modalHelp'),{"), 'the gear bypasses the shared modal');
});

/* ------------------------------------------------------------------ *
 * what it costs the board
 * ------------------------------------------------------------------ */

test('the gear cannot be squeezed: the row is one line and the gear does not flex', () => {
  const src = page();
  assert.ok(!/flex-wrap:wrap/.test(rule(src, '#promptCard{')), rule(src, '#promptCard{'));
  // Without flex:0 0 auto the gear is the one item in the row that can shrink below its
  // measured size, and a squashed gear is an untappable one.
  assert.ok(/flex:0 0 auto/.test(rule(src, '.setBtn{')), rule(src, '.setBtn{'));
  // The two round buttons the child uses mid-round must not be quietly shrunk to pay for it.
  assert.ok(/flex:0 0 auto/.test(rule(src, '.speakBtn{')), rule(src, '.speakBtn{'));
  assert.ok(/flex:0 0 auto/.test(rule(src, '.hintBtn{')), rule(src, '.hintBtn{'));
});

test('the gear is chrome, not a third candy-coloured action', () => {
  const src = page();
  const gear = rule(src, '.setBtn{');
  // 🔊 and 💡 are the child's two actions; a third saturated circle would read as a third thing
  // to do in a round. Paper + ink also keeps the row's two real controls identifiable.
  assert.ok(/background:var\(--paper\)/.test(gear), gear);
  assert.ok(!/background:var\(--(coral|amber|teal|blue|pink|green|orange|gold)\)/.test(gear), gear);
});

test('the gear is the darkest thing on its own background', () => {
  // Same arithmetic tests/palette.test.js uses, run against the two colours this button uses:
  // the glyph inherits --ink and the fill is --paper. A contrast regression here is a settings
  // control nobody can find.
  const src = page();
  const root = rule(src, ':root{');
  const vars = Object.fromEntries(
    [...root.matchAll(/--([a-z0-9]+):(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]])
  );
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (h) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const [r, g, b] = hex(h);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  assert.ok(vars.ink && vars.paper, `missing colours: ${Object.keys(vars).join(',')}`);
  const r = ratio(vars.ink, vars.paper);
  // 11.2:1 as shipped. A large glyph only needs 3:1, but this is a 15-19px gear, which is
  // text by any reading, so it is held to the 4.5:1 text bar.
  assert.ok(r >= 4.5, `the gear glyph is ${r.toFixed(2)}:1 on the card`);
  // The 3px ink rim is what separates it from the paper card it sits on.
  assert.ok(/border:3px solid var\(--ink\)/.test(rule(src, '.setBtn{')), rule(src, '.setBtn{'));
});

test('the gear stays a tappable size on the phones where the row is tightest', () => {
  const src = page();
  const gear = rule(src, '.setBtn{');
  const min = Number(/width:clamp\((\d+)px/.exec(gear)[1]);
  // 34px is what the clamp bottoms out at on a 320px phone (8vmin there is 25.6). Anything under
  // 32px stops being a target a child or a hurried adult can hit, and this control is the only
  // way to change the voice in the middle of a level.
  assert.ok(min >= 32, `the gear can shrink to ${min}px`);
  // ...and it must not outgrow its neighbours' 44px ceiling either.
  const cap = Number(/clamp\(\d+px,[^,]+,(\d+)px\)/.exec(gear)[1]);
  assert.ok(cap <= 52, `the gear grows to ${cap}px`);
  assert.ok(/height:clamp\(/.test(gear), 'the gear is not square, so it is not a circle');
  assert.match(gear, /border-radius:50%/);
});

test('the narrow-phone block that pays for the gear comes after the short-screen one', () => {
  const src = uncomment(page());
  const short = src.indexOf('@media (max-height:560px)');
  const narrow = src.indexOf('@media (max-width:419px){\n  #promptCard{gap:6px');
  assert.ok(short > -1, 'the max-height:560 block is gone');
  assert.ok(narrow > -1, 'the prompt card lost its narrow-phone adaptation');
  // A later rule of equal specificity wins, and a 320x540 phone matches *both* queries. With
  // this block first, that device would get the other block's 8px gaps and 18px text — a mix
  // that puts the reveal's pinyin on a second line for no reason at all.
  assert.ok(narrow > short, 'the prompt card must yield to the short-screen rule, not the reverse');
  const block = slice(src, '@media (max-width:419px){\n  #promptCard{gap:6px', '\n}');
  for (const sel of ['#promptCard', '.pBig', '.pSub']) {
    assert.ok(block.includes(sel + '{'), `${sel} is not adapted for the gear: ${block}`);
  }
  // The buttons are deliberately *not* in there: 🔊 and 💡 are the two controls a child's finger
  // hunts for, and 44px is already the smallest touch target worth shipping.
  assert.ok(!/\.speakBtn\{|\.hintBtn\{/.test(block), block);
  // The text does have to shrink — that is what stops 听一听，找一找 wrapping onto a second
  // line and costing the board 24px at 320.
  const big = /\.pBig\{font-size:clamp\((\d+)px/.exec(block)[1];
  const bigFloor = Number(big);
  assert.ok(bigFloor >= 16, `the instruction drops to ${bigFloor}px at 320, which is not legible`);
  assert.ok(bigFloor < 22, 'the text never shrinks, so the card wraps and the board loses 24px');
});

/* ------------------------------------------------------------------ *
 * a round that is not disturbed by the detour
 * ------------------------------------------------------------------ */

test('the board holds still while the settings are open', () => {
  // Executed, not pattern-matched: a vm with a Help that reports itself open, and stubs for
  // step/render/requestAnimationFrame.
  const src = page();
  const ctx = vm.createContext({});
  vm.runInContext(
    [
      'var G={pausedMs:0};',
      'var steps=[],renders=0,rafs=[];',
      'var open=true;',
      'var Help={shown:()=>open};',
      'function step(dt){ steps.push(dt); }',
      'function render(){ renders++; }',
      'function requestAnimationFrame(f){ rafs.push(f); return rafs.length; }',
      fn(src, 'function loop(ts){'),
    ].join('\n'),
    ctx,
    { filename: 'qwen.html#loop' }
  );
  vm.runInContext('loop(1000)', ctx);
  assert.deepEqual(Array.from(vm.runInContext('steps', ctx)), [], 'the board moved while the settings were open');
  assert.equal(vm.runInContext('renders', ctx), 1, 'the frame loop stopped while the settings were open');
  // The pause is credited from the *raw* delta: the physics dt is clamped to 33ms, and reading
  // the clamped value would cap a 20-second detour at 33ms of credit on the result card.
  assert.equal(vm.runInContext('Math.round(G.pausedMs)', ctx), 0, 'the first frame has no delta to credit');
  vm.runInContext('loop(4200)', ctx);
  assert.equal(vm.runInContext('Math.round(G.pausedMs)', ctx), 3200, 'the pause was not credited in full');
  assert.equal(vm.runInContext('G.pausedMs - 3200', ctx), 0);
  // Close it and the board moves again, on a clamped delta so it cannot teleport after a long
  // pause, and the paused time is not credited twice.
  vm.runInContext('open=false; loop(4300)', ctx);
  assert.deepEqual(Array.from(vm.runInContext('steps', ctx)), [0.033], 'the resume step was not clamped');
  assert.equal(vm.runInContext('Math.round(G.pausedMs)', ctx), 3200, 'play time leaked into the pause');
  vm.runInContext('loop(4316)', ctx);
  assert.deepEqual(Array.from(vm.runInContext('steps', ctx)), [0.033, 0.016]);
  assert.equal(vm.runInContext('G.pausedMs', ctx), 3200);
  // A three-second stall is still only one clamped step: resuming must not fling every bubble
  // across the board, which is the whole reason dt is capped.
  vm.runInContext('loop(7316)', ctx);
  assert.deepEqual(Array.from(vm.runInContext('steps', ctx)), [0.033, 0.016, 0.033]);
});

test('the board stops for nothing else — a closed modal never pauses a level', () => {
  const src = page();
  const ctx = vm.createContext({});
  vm.runInContext(
    [
      'var G={pausedMs:0};', 'var steps=[];', 'var open=false;',
      'var Help={shown:()=>open};',
      'function step(dt){ steps.push(dt); }',
      'function render(){}',
      'function requestAnimationFrame(){ return 1; }',
      fn(src, 'function loop(ts){'),
    ].join('\n'),
    ctx
  );
  vm.runInContext('loop(1000); loop(1016)', ctx);
  assert.deepEqual(Array.from(vm.runInContext('steps', ctx)), [0, 0.016], 'an ordinary frame did not step the board');
  assert.equal(vm.runInContext('G.pausedMs', ctx), 0, 'an ordinary frame was credited as a pause');
});

test('the loop still does nothing at all when no level is running', () => {
  const src = page();
  const ctx = vm.createContext({});
  vm.runInContext(
    [
      'var G=null;', 'var steps=0;',
      'var Help={shown:()=>false};',
      'function step(){ steps++; }',
      'function render(){}',
      'function requestAnimationFrame(){ return 1; }',
      fn(src, 'function loop(ts){'),
    ].join('\n'),
    ctx
  );
  assert.doesNotThrow(() => vm.runInContext('loop(1000)', ctx));
  assert.equal(vm.runInContext('steps', ctx), 0);
});

test('the result card subtracts the paused time from 用时', () => {
  // A level the child played for 20s and paused in the settings for 15 must report 5, not 35.
  // Executed rather than asserted: the expression is lifted straight out of levelClear() and
  // run with a stubbed clock, which is the only way to catch it reading wall-clock time again.
  const src = page();
  const line = slice(src, 'const secs=', '\n');
  assert.match(line, /^const secs=Math\.max\(1,Math\.round\(/, line);
  const secs = (startAge, pausedMs) => {
    const ctx = vm.createContext({ Date: { now: () => startAge } });
    vm.runInContext(
      `var G=${JSON.stringify({ start: 0, ...(pausedMs === undefined ? {} : { pausedMs }) })};` +
        line.replace('const secs=', 'var secs='),
      ctx
    );
    return vm.runInContext('secs', ctx);
  };
  assert.equal(secs(20000, 15000), 5, 'the settings detour is still on the clock');
  assert.equal(secs(20000, undefined), 20, 'a level that was never paused is misreported');
  assert.equal(secs(20000, 19000), 1, 'a level paused to nothing still reports at least a second');
  assert.equal(secs(30000, 30000), 1, 'a fully paused level must not report zero');
  assert.equal(secs(90000, 0), 90);
});

test('the round instruction never starts talking behind the modal', () => {
  const src = page();
  const ctx = vm.createContext({});
  vm.runInContext(
    [
      'var spoken=[],open=true;',
      'var G={lock:false,rt:{type:"char",text:"山"}};',
      'var Help={shown:()=>open};',
      'function speakTarget(){ spoken.push(G&&G.rt?G.rt.text:null); return true; }',
      fn(src, 'function promptIfHeard(){'),
    ].join('\n'),
    ctx
  );
  vm.runInContext('promptIfHeard()', ctx);
  assert.deepEqual(vm.runInContext('spoken', ctx), [], 'it spoke behind the settings modal');
  vm.runInContext('open=false; promptIfHeard()', ctx);
  assert.deepEqual(vm.runInContext('spoken', ctx), ['山'], 'closing the modal did not re-say the task');
  // A locked round (the 650ms at the start of every round) and a missing round both stay silent
  // rather than speaking a target that is not on the board yet.
  vm.runInContext('G.lock=true; promptIfHeard()', ctx);
  vm.runInContext('G.lock=false; G.rt=null; promptIfHeard()', ctx);
  vm.runInContext('G=null; promptIfHeard()', ctx);
  assert.deepEqual(vm.runInContext('spoken', ctx), ['山'], 'a locked or empty round spoke anyway');
});

test('both doors into the prompt go through the same gate', () => {
  // The 650ms post-round timer and the modal's onClose are the only two moments a round's
  // instruction starts on its own. If either goes back to calling speakTarget() directly the
  // modal guard is one refactor away from being bypassed. (The 🔊 button still calls it
  // directly, which is correct: that is the child asking for it while the modal is closed.)
  const src = page();
  assert.ok(src.includes('G.lock=false; promptIfHeard(); },650);'), 'the round timer bypasses the gate');
  assert.ok(src.includes('onClose:()=>{ SFX.click(); promptIfHeard(); }'), 'closing the settings bypasses the gate');
  const speakers = src.split('\n').filter((l) => /speakTarget\(\);/.test(l) && !l.includes('function speakTarget'));
  assert.deepEqual(speakers.map((l) => l.trim()), [
    'if(G&&!G.lock&&G.rt&&!Help.shown())speakTarget();',
    "$('#btnSpeak').onclick=()=>{ if(!G)return; SFX.click(); speakTarget(); };",
  ], 'speakTarget() is called as a statement from somewhere unexpected');
});

test('the settings modal documents where the gear is', () => {
  // An adult who has never seen the gear will never find it, and the modal is the one piece of
  // copy in the game written for them.
  const src = page();
  const note = slice(src, '<div class="helpNote">', '</div>');
  assert.ok(note.includes('⚙'), `the settings note does not mention the gear: ${note}`);
  assert.ok(note.includes('泡泡'), 'the note does not say the board pauses');
});
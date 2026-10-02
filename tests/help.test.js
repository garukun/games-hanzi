'use strict';
/**
 * Tests for the inlined Help module inside qwen.html.
 *
 * Same trick as tests/voice.test.js and tests/faces.test.js: the module ships inside
 * the single-file page, so we slice it out between the HELP START/END markers and
 * evaluate it in a vm context. It needs no browser globals at load time, so the only
 * stubs are a fake element and a fake `document` that record their listeners — which
 * is what lets the behavioural assertions (backdrop vs. inside-the-card, Escape vs.
 * other keys, transition-only callbacks) actually *run* rather than being asserted
 * against the module's source text.
 *
 * ## Why this exists
 *
 * The 怎么玩/设置 modal had exactly one exit: 知道啦！, the last element in a card
 * measured at 615px tall inside a 568px viewport (see tests/score.test.js). On a short
 * phone the only way out was to scroll to the bottom of a card with no other affordance
 * anywhere in it. gemini.html dismissed its settings on a backdrop tap — the gesture a
 * child tries first — so that is ported, together with a ✖ beside the title and Escape.
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

/** A stand-in for the overlay: records listeners and the classes it has been given. */
function fakeEl() {
  const listeners = {};
  const classes = new Set();
  return {
    listeners,
    classes,
    shown: () => classes.has('show'),
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    /** Fire an event at this element with `target` set to something else (a child). */
    fire(type, ev) {
      for (const fn of listeners[type] || []) fn(Object.assign({ target: this }, ev));
    },
    childFire(type, ev) {
      const child = { tagName: 'BUTTON' };
      for (const fn of listeners[type] || []) fn(Object.assign({ target: child }, ev));
    },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
  };
}

function fakeDocument() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    fire(type, ev) {
      const prevented = [];
      for (const fn of listeners[type] || []) {
        fn(Object.assign({ key: 'Escape', preventDefault: () => prevented.push(ev && ev.key) }, ev));
      }
      return prevented;
    },
  };
}

/** Load the shipped module into a fresh vm, with the overlay/document already attached. */
function loadHelp(opts) {
  const html = page();
  const start = html.indexOf('/* ==== HELP START ==== */');
  const endMark = '/* ==== HELP END ==== */';
  const end = html.indexOf(endMark);
  assert.ok(start > -1 && end > start, 'HELP markers not found in qwen.html');
  const src = html.slice(start, end + endMark.length);
  const el = fakeEl();
  const doc = fakeDocument();
  const calls = { open: 0, close: 0 };
  const ctx = vm.createContext({ document: doc });
  vm.runInContext(src + '\nglobalThis.__help = Help;', ctx, { filename: 'qwen.html#help' });
  const Help = ctx.__help;
  assert.ok(Help, 'Help was not defined by the extracted module');
  const hooks = Object.assign(
    {
      onOpen: () => calls.open++,
      onClose: () => calls.close++,
    },
    opts,
  );
  Help.attach(el, hooks);
  return { Help, el, doc, calls };
}

/* ------------------------------------------------------------------ *
 * the three ways out
 * ------------------------------------------------------------------ */

test('open shows the modal and close hides it', () => {
  const { Help, el } = loadHelp();
  assert.equal(Help.shown(), false);
  assert.equal(Help.open(), true);
  assert.equal(el.shown(), true);
  assert.equal(Help.shown(), true);
  assert.equal(Help.close(), true);
  assert.equal(el.shown(), false);
  assert.equal(Help.shown(), false);
});

test('a backdrop tap closes the modal', () => {
  const { Help, el } = loadHelp();
  Help.open();
  el.fire('click', {});
  assert.equal(Help.shown(), false, 'tapping the dimmed backdrop did not close the modal');
});

test('a tap *inside* the card does not close it', () => {
  // The `target===el` test is the whole point of the handler. Without it every tap on a
  // 慢/中/快 segment would dismiss the modal instead of choosing, and the setting row would
  // be unusable — the failure is silent, because the modal closing still looks like a tap.
  const { Help, el } = loadHelp();
  Help.open();
  el.childFire('click', {});
  assert.equal(Help.shown(), true, 'a settings row dismissed the modal');
  assert.ok(el.classes.has('show'));
});

test('Escape closes the modal', () => {
  const { Help, el, doc } = loadHelp();
  Help.open();
  const prevented = doc.fire('keydown', { key: 'Escape' });
  assert.equal(Help.shown(), false, 'Escape did not close the modal');
  assert.equal(el.shown(), false);
  assert.deepEqual(prevented, ['Escape'], 'Escape must be swallowed only while the modal is open');
});

test('Escape is inert while the modal is closed', () => {
  const { Help, doc } = loadHelp();
  const prevented = doc.fire('keydown', { key: 'Escape' });
  assert.deepEqual(prevented, [], 'a closed modal must not swallow Escape from the page');
  assert.equal(Help.shown(), false);
});

test('other keys are never swallowed', () => {
  const { Help, doc } = loadHelp();
  Help.open();
  for (const key of ['Enter', ' ', 'e', 'Esc', 'ESCAPE']) {
    const prevented = doc.fire('keydown', { key });
    assert.deepEqual(prevented, [], `key ${key} was swallowed`);
    assert.equal(Help.shown(), true, `key ${key} closed the modal`);
  }
});

/* ------------------------------------------------------------------ *
 * callbacks fire on transitions only
 * ------------------------------------------------------------------ */

test('the hooks fire once per transition, never on a repeat', () => {
  // syncToggles() re-reads every setting and Voice.stop() cancels the in-flight clip, so a
  // double-open would restart the audio and a double-close would click twice.
  const { Help, calls } = loadHelp();
  Help.open();
  Help.open();
  Help.open();
  assert.equal(calls.open, 1, 'onOpen ran more than once for one open');
  Help.close();
  Help.close();
  assert.equal(calls.close, 1, 'onClose ran more than once for one close');
});

test('a close without an open never runs the open hook', () => {
  const { Help, calls } = loadHelp();
  Help.close();
  assert.equal(calls.open, 0);
  assert.equal(calls.close, 0, 'closing an already-closed modal ran its hook');
});

test('the two hooks are independent', () => {
  let opens = 0;
  let closes = 0;
  const { Help } = loadHelp({ onOpen: () => opens++, onClose: () => closes++ });
  Help.open();
  assert.equal(opens, 1);
  assert.equal(closes, 0);
  Help.close();
  assert.equal(opens, 1);
  assert.equal(closes, 1);
});

/* ------------------------------------------------------------------ *
 * hostile input
 * ------------------------------------------------------------------ */

test('attach/with no overlay at all degrades instead of throwing', () => {
  const html = page();
  const start = html.indexOf('/* ==== HELP START ==== */');
  const endMark = '/* ==== HELP END ==== */';
  const src = html.slice(start, html.indexOf(endMark) + endMark.length);
  const ctx = vm.createContext({ document: fakeDocument() });
  vm.runInContext(src + '\nglobalThis.__help = Help;', ctx, { filename: 'qwen.html#help' });
  const Help = ctx.__help;
  assert.equal(Help.attach(null, { onOpen: () => { throw new Error('must not run'); } }), false);
  assert.equal(Help.open(), false);
  assert.equal(Help.close(), false);
  assert.equal(Help.shown(), false);
  // ...and the page is still usable: attaching the real overlay afterwards works.
  const el = fakeEl();
  assert.equal(Help.attach(el, {}), true);
  assert.equal(Help.open(), true);
  assert.equal(el.shown(), true);
});

test('open/close survive an attached overlay with no hooks', () => {
  const { Help, el } = loadHelp({ onOpen: null, onClose: null });
  assert.equal(Help.open(), true);
  assert.equal(el.shown(), true);
  assert.equal(Help.close(), true);
  assert.equal(el.shown(), false);
});

test('a throwing hook cannot leave the modal out of step with itself', () => {
  // syncToggles() touches a dozen DOM nodes and Voice.stop() talks to the audio engine. The
  // flag and the class must both move before the hook runs, so the worst a throwing hook can
  // do is skip a side effect — never leave a modal the module thinks is closed covering the
  // screen with no way out.
  const { Help, el } = loadHelp({ onOpen: () => { throw new Error('boom'); } });
  assert.throws(() => Help.open(), /boom/);
  assert.equal(el.shown(), true, 'the overlay is visible but the module lost track of it');
  assert.equal(Help.shown(), true);
  assert.equal(Help.close(), true);
  assert.equal(el.shown(), false, 'the overlay is stuck visible');
  assert.equal(Help.shown(), false);
});

/* ------------------------------------------------------------------ *
 * the wiring in the page
 * ------------------------------------------------------------------ */

test('the page attaches the module instead of poking the overlay class', () => {
  const src = page();
  assert.ok(src.includes("Help.attach($('#modalHelp')"), 'the overlay is never attached');
  for (const [btn, fn] of [['#btnHelp', 'Help.open'], ['#btnHelpOk', 'Help.close'], ['#btnHelpX', 'Help.close']]) {
    assert.ok(
      src.includes(`$('${btn}').onclick=()=>${fn}();`),
      `${btn} is not wired to ${fn}()`,
    );
  }
  // The old shape — reaching into the class list from each button — is what let the three
  // dismissal paths drift apart in the first place.
  assert.ok(!src.includes("$('#modalHelp').classList.add('show')"), 'the open path bypasses the module');
  assert.ok(!src.includes("$('#modalHelp').classList.remove('show')"), 'the close path bypasses the module');
});

test('opening the modal stops the audio and syncs the settings; closing clicks', () => {
  const src = slice(page(), 'Help.attach($(\'#modalHelp\')', '\n');
  assert.ok(src.includes('onOpen:()=>{ syncToggles(); Voice.stop(); }'), src);
  assert.ok(src.includes('onClose:()=>SFX.click()'), src);
});

test('the ✖ lives in the title row of the card, not floating over it', () => {
  const src = page();
  const card = slice(src, '<div class="helpCard">', '<button class="btn3d teal" id="btnHelpOk"');
  assert.ok(card.includes('<div class="helpHead">'), 'there is no title row to hold the ✖');
  assert.ok(
    /<div class="helpHead">\s*<h3>怎么玩？<\/h3>\s*<button class="helpX" id="btnHelpX" aria-label="关闭">✖<\/button>/.test(card),
    'the ✖ is not in the head, or lost its accessible name',
  );
  // Inside the scroll box (not a sibling of the card) is what makes it visible at the top of
  // the card at 320x568, where the 知道啦！ button is 1px below the fold.
  const overlay = slice(src, '<div id="modalHelp">', '</div>\n</div>');
  assert.ok(overlay.includes('helpCard'), 'the card is gone');
  assert.ok(!overlay.includes('id="btnHelpX"\n  </div>'), 'the ✖ is a sibling of the card, outside its scroll box');
});

test('the ✖ is a 44px target in ink on paper, not another white-on-coral label', () => {
  const src = page();
  const css = slice(src, '.helpHead{', '.helpRow{');
  assert.ok(/position:absolute/.test(css), 'the ✖ is not anchored to the title row');
  assert.ok(/right:-\d+px/.test(css), 'the ✖ is not pinned to the right of the title row');
  // Nothing from the card up declares a position except the overlay itself, so the head has to
  // be the ✖'s containing block: without it the button resolves against #modalHelp and lands in
  // the corner of the *viewport*, on top of the first instruction row.
  const head = src.slice(src.indexOf('.helpHead{'), src.indexOf('}', src.indexOf('.helpHead{')));
  assert.ok(/position:relative/.test(head), head);
  const cardRule = src.slice(src.indexOf('.helpCard{'), src.indexOf('}', src.indexOf('.helpCard{')));
  assert.ok(!/position:relative/.test(cardRule), 'the card should not be the ✖\'s containing block');
  assert.ok(/width:44px;height:44px/.test(css), 'the ✖ is smaller than the 44px touch target the rest of the game uses');
  assert.ok(/background:var\(--ink\)/.test(css) && /color:var\(--paper\)/.test(css), 'the ✖ is not ink-on-paper');

  // Recompute the ratio rather than trusting the variable names.
  const root = slice(src, ':root{', '}');
  const hex = (name) => {
    const m = new RegExp(name + ':(#[0-9a-fA-F]{6})').exec(root);
    assert.ok(m, `no --${name} in :root`);
    return m[1].toLowerCase();
  };
  const lum = (h) => {
    const n = parseInt(h.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const a = lum(hex('ink'));
  const b = lum(hex('paper'));
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  assert.ok(ratio >= 4.5, `the ✖ measures ${ratio.toFixed(2)}:1, below 4.5:1`);
});

test('the title margin moved to the head row so the two do not stack', () => {
  const src = page();
  const head = slice(src, '.helpHead{', '\n}');
  assert.ok(/margin:0 0 \d+px;/.test(head), 'the head row has no bottom margin');
  const h3 = src.slice(src.indexOf('.helpCard h3{'), src.indexOf('}', src.indexOf('.helpCard h3{')));
  assert.ok(/margin:0;/.test(h3), 'the title still owns the bottom margin, doubling the gap');
  assert.ok(/text-align:center/.test(h3), 'the title is no longer centred');
});
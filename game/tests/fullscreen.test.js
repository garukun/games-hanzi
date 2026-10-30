'use strict';
/**
 * Tests for the inlined Fullscreen module inside qwen.html.
 *
 * Same trick as tests/voice.test.js, tests/faces.test.js and tests/help.test.js: the module
 * ships inside the single-file page, so we slice it out between the FULLSCREEN START/END
 * markers and evaluate it in a vm with a fake `document`. Nothing here needs a browser, so
 * the behaviour assertions (which prefixed name is called, what happens when a request is
 * refused, whether the control is offered on a device that cannot use it) actually *run*
 * rather than being asserted against the module's source text.
 *
 * ## Why this exists
 *
 * gemini.html ships a ⛶ 全屏 toggle (gemini.html:1033-1050). On a phone the browser's
 * address bar is 60-90px of the board, so handing it back is the cheapest play-area win in
 * the whole game — and it takes the address bar away from a five-year-old mid-level.
 * gemini's version has two defects that matter more on the devices this game is for:
 *
 *   1. It draws the button unconditionally and the handler then does nothing on a device
 *      without the Fullscreen API — which is every iPhone and every iPad.
 *   2. Its label stays "⛶ 全屏" forever, including while fullscreen, so the control lies
 *      about the state it is in.
 *
 * `supported()` gates the control so a dead button is never drawn, and `watch()` re-reads the
 * real state on fullscreenchange so a fullscreen left with Escape or a swipe is reflected.
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
const GEMINI = path.join(ROOT, 'gemini.html');

const src = () => fs.readFileSync(PAGE, 'utf8');
const gemini = () => fs.readFileSync(GEMINI, 'utf8');

const START = '/* ==== FULLSCREEN START ==== */';
const END = '/* ==== FULLSCREEN END ==== */';

/** Every vendor spelling the module has to know, request and exit names separately. */
const REQUESTS = [
  'requestFullscreen',
  'webkitRequestFullscreen',
  'webkitRequestFullScreen',
  'mozRequestFullScreen',
  'msRequestFullscreen',
];
const EXITS = ['exitFullscreen', 'webkitExitFullscreen', 'mozCancelFullScreen', 'msExitFullscreen'];
const CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];

function moduleSrc() {
  const html = src();
  const i = html.indexOf(START);
  const j = html.indexOf(END);
  assert.ok(i > -1 && j > i, 'FULLSCREEN markers not found in qwen.html');
  return html.slice(i, j + END.length);
}

/**
 * Load the shipped module against a fake DOM.
 *
 * @param opts.el     names to install on document.documentElement (a value that is not a
 *                    function is installed as-is, to reproduce a host that exposes the name
 *                    but not as a callable)
 * @param opts.doc    names to install on `document` (the exit side + fullscreenElement)
 * @param opts.node   the element the document reports as fullscreen, or null
 */
function loadFullscreen(opts) {
  opts = opts || {};
  const calls = [];
  const el = {};
  const doc = {};
  const listeners = {};
  const slot = { node: null };           // what the document reports as fullscreen
  const fullProps = ['fullscreenElement', 'webkitFullscreenElement', 'mozFullScreenElement', 'msFullscreenElement'];

  doc.documentElement = el;
  doc.addEventListener = (type, fn) => {
    (listeners[type] = listeners[type] || []).push(fn);
  };
  const fire = (type) => {
    for (const fn of listeners[type] || []) fn({ type });
  };

  /** Record the call and its receiver, then run whatever the test supplied. */
  const wrap = (name, recv, fn) =>
    function () {
      calls.push([name, this === recv]);
      return fn.apply(this, arguments);
    };

  /* opts.el / opts.doc may name any vendor spelling. A function is wrapped so calls are
     recorded while the test's own behaviour — including throwing synchronously, which is
     what a document not activated yet does — is preserved exactly. A non-function is copied
     as-is: that is a host that exposes the *name* without a callable behind it. */
  for (const k of REQUESTS)
    if (k in (opts.el || {})) el[k] = typeof opts.el[k] === 'function' ? wrap(k, el, opts.el[k]) : opts.el[k];
  for (const k of EXITS)
    if (k in (opts.doc || {})) doc[k] = typeof opts.doc[k] === 'function' ? wrap(k, doc, opts.doc[k]) : opts.doc[k];
  for (const k of fullProps)
    if (k in (opts.doc || {})) slot[k] = opts.doc[k];

  /* Defaults, so a test only has to name the prefix it cares about. A rejected request
     promise is the common real outcome (no user gesture, or an iframe without
     allow="fullscreen") and must never throw at the call site. `bare` suppresses both, which
     is how a device with no Fullscreen API at all is reproduced. */
  if (!opts.bare) {
    if (!('requestFullscreen' in el))
      el.requestFullscreen = wrap('requestFullscreen', el, function () {
        slot.fullscreenElement = el;
        return Promise.reject(new Error('gesture required'));
      });
    if (!('exitFullscreen' in doc))
      doc.exitFullscreen = wrap('exitFullscreen', doc, function () {
        slot.fullscreenElement = null;
        return Promise.resolve();
      });
  }
  if (!('fullscreenElement' in slot)) slot.fullscreenElement = null;
  for (const k of fullProps) doc[k] = slot[k];

  const ctx = vm.createContext({ document: doc, Promise });
  vm.runInContext(moduleSrc() + '\nglobalThis.__fs = Fullscreen;', ctx, { filename: 'qwen.html#fullscreen' });
  const Fullscreen = ctx.__fs;
  assert.ok(Fullscreen, 'Fullscreen was not defined by the extracted module');

  const setNode = (n) => {
    for (const k of fullProps) slot[k] = n;
    for (const k of fullProps) doc[k] = slot[k];
  };
  return {
    Fullscreen,
    calls,
    el,
    doc,
    listeners,
    fire,
    setNode,
    enterFullscreen() {
      setNode(el);
      fire('fullscreenchange');
    },
    leaveFullscreen() {
      setNode(null);
      fire('fullscreenchange');
    },
  };
}

/* ------------------------------------------------------------------ *
 * the thing gemini got wrong: a control that cannot work
 * ------------------------------------------------------------------ */

test('a device with no Fullscreen API at all is reported as unsupported', () => {
  // `bare` installs nothing: this is the shape of every iPhone and every iPad, where
  // Element.prototype has no request method of any spelling. gemini.html drew its button here.
  const f = loadFullscreen({ bare: true });
  for (const k of REQUESTS) assert.equal(k in f.el, false);
  assert.equal(f.Fullscreen.supported(), false);
});

test('supported() is false when the name exists but is not callable', () => {
  // A host that exposes the property without a callable behind it must not be counted as
  // supported, or the row is offered and every tap throws.
  const f = loadFullscreen({ bare: true, el: { webkitRequestFullScreen: 'nope' } });
  assert.equal(typeof f.el.webkitRequestFullScreen, 'string');
  assert.equal(f.Fullscreen.supported(), false);
});

test('supported() is true for each vendor spelling, and only for that spelling', () => {
  // `bare` matters here: with the standard request installed as a default, every host would
  // look supported and a dropped vendor name could never be noticed.
  for (const k of REQUESTS) {
    const f = loadFullscreen({ bare: true, el: { [k]: function () {} } });
    assert.equal(f.Fullscreen.supported(), true, `${k} was not recognised as a request`);
    for (const other of REQUESTS) if (other !== k) delete f.el[other];
    assert.equal(f.Fullscreen.supported(), true, `${k} stopped being accepted on its own`);
  }
});

test('each vendor spelling is the one that actually gets called', () => {
  // Reading a name and calling a different one is the failure this pair of assertions exists
  // for: supported() true, the control drawn, and the tap doing nothing.
  for (const k of REQUESTS) {
    const f = loadFullscreen({ bare: true, el: { [k]: function () {} } });
    assert.equal(f.Fullscreen.enter(), true);
    assert.deepEqual(f.calls.map(c => c[0]), [k], `${k} was read but something else was called`);
  }
});

test('enter/exit/toggle do nothing at all where there is no API', () => {
  const f = loadFullscreen({ bare: true });
  assert.equal(f.Fullscreen.enter(), false);
  assert.equal(f.Fullscreen.exit(), false);
  assert.equal(f.Fullscreen.toggle(), false);
  assert.deepEqual(f.calls, [], 'a request was attempted on a device that cannot do it');
});

/* ------------------------------------------------------------------ *
 * requesting and leaving
 * ------------------------------------------------------------------ */

test('the standard request is made with documentElement as the receiver', () => {
  const f = loadFullscreen({ el: {} });
  assert.equal(f.Fullscreen.enter(), true);
  assert.deepEqual(f.calls, [['requestFullscreen', true]]);
});

test('a prefixed request is used when the standard one is absent', () => {
  const f = loadFullscreen({ el: { webkitRequestFullscreen: function () {} } });
  delete f.el.requestFullscreen;
  assert.equal(f.Fullscreen.enter(), true);
  assert.deepEqual(f.calls, [['webkitRequestFullscreen', true]]);
});

test('the newest spelling wins when a host offers more than one', () => {
  const f = loadFullscreen({
    el: {
      webkitRequestFullscreen: function () {},
      mozRequestFullScreen: function () {},
    },
  });
  delete f.el.requestFullscreen;
  f.Fullscreen.enter();
  assert.equal(f.calls[0][0], 'webkitRequestFullscreen');
});

test('toggle enters when not fullscreen and exits when fullscreen', () => {
  const f = loadFullscreen({ el: {} });
  f.Fullscreen.toggle();
  assert.deepEqual(f.calls.map(c => c[0]), ['requestFullscreen']);
  f.enterFullscreen();
  assert.equal(f.Fullscreen.on(), true);
  f.Fullscreen.toggle();
  assert.deepEqual(f.calls.map(c => c[0]), ['requestFullscreen', 'exitFullscreen']);
});

test('exit uses the standard name with document as the receiver', () => {
  const f = loadFullscreen({ el: {} });
  f.Fullscreen.exit();
  assert.deepEqual(f.calls, [['exitFullscreen', true]]);
});

test('a prefixed exit is used where it is the only one', () => {
  const f = loadFullscreen({ el: {}, doc: { webkitExitFullscreen: function () {} } });
  delete f.doc.exitFullscreen;
  f.Fullscreen.exit();
  assert.deepEqual(f.calls, [['webkitExitFullscreen', true]]);
});

test('on() reads whichever element property the host uses', () => {
  for (const k of ['fullscreenElement', 'webkitFullscreenElement', 'mozFullScreenElement', 'msFullscreenElement']) {
    const f = loadFullscreen({ el: {}, doc: { [k]: null } });
    delete f.doc.fullscreenElement;
    assert.equal(f.Fullscreen.on(), false);
    f.doc[k] = f.el;
    assert.equal(f.Fullscreen.on(), true, `${k} was not read`);
    delete f.doc[k];
  }
});

test('on() is false, not truthy-garbage, when no element is reported', () => {
  const f = loadFullscreen({ el: {} });
  assert.equal(f.Fullscreen.on(), false);
  assert.strictEqual(f.Fullscreen.on(), !!f.Fullscreen.on());
});

/* ------------------------------------------------------------------ *
 * refusals: a fullscreen request fails for reasons outside the child's control
 * ------------------------------------------------------------------ */

test('a rejected request promise does not throw at the call site', () => {
  const unhandled = [];
  const guard = (e) => unhandled.push(String(e));
  process.on('unhandledRejection', guard);
  try {
    const f = loadFullscreen({ el: {} });
    let threw = null;
    try {
      assert.equal(f.Fullscreen.enter(), true);
    } catch (err) {
      threw = String(err);
    }
    assert.equal(threw, null);
  } finally {
    process.off('unhandledRejection', guard);
  }
});

test('a request that throws synchronously is reported as not done, and never propagates', () => {
  const f = loadFullscreen({
    el: {
      requestFullscreen: function () {
        throw new Error('SecurityError');
      },
    },
  });
  let threw = null;
  let res;
  try {
    res = f.Fullscreen.enter();
  } catch (err) {
    threw = String(err);
  }
  assert.equal(threw, null);
  assert.equal(res, false, 'a synchronous failure was reported as success');
});

test('an exit that throws synchronously is reported as not done, and never propagates', () => {
  const f = loadFullscreen({
    doc: {
      exitFullscreen: function () {
        throw new Error('not in fullscreen');
      },
    },
  });
  let threw = null;
  try {
    assert.equal(f.Fullscreen.exit(), false);
  } catch (err) {
    threw = String(err);
  }
  assert.equal(threw, null);
  assert.deepEqual(f.calls, [['exitFullscreen', true]], 'the call was not even attempted');
});

test('a promise-less prefixed request is not treated as a promise', () => {
  // The old prefixed spellings return undefined, so `.catch` on the result would itself
  // throw — the shape gemini.html's handler has on its webkit branches.
  const f = loadFullscreen({ el: { webkitRequestFullscreen: function () { return undefined; } } });
  delete f.el.requestFullscreen;
  assert.equal(f.Fullscreen.enter(), true);
});

test('toggle on a host with no API is inert whether or not it claims to be fullscreen', () => {
  // Neither branch may attempt anything on a device that cannot do it: a stale
  // fullscreenElement sends toggle() at an exit that does not exist, and that is exactly the
  // TypeError a five-year-old would see if enter()/exit() ever stopped returning false.
  const f = loadFullscreen({ bare: true, doc: { fullscreenElement: null } });
  assert.equal(f.Fullscreen.toggle(), false);
  f.setNode(f.el);
  assert.equal(f.Fullscreen.on(), true);
  assert.equal(f.Fullscreen.toggle(), false);
  assert.deepEqual(f.calls, []);
});

/* ------------------------------------------------------------------ *
 * the other thing gemini got wrong: a label that never changes
 * ------------------------------------------------------------------ */

test('watch reports the state immediately, so a stale label cannot survive', () => {
  const seen = [];
  const f = loadFullscreen({ el: {} });
  f.Fullscreen.watch((v) => seen.push(v));
  assert.deepEqual(seen, [false]);
  f.enterFullscreen();
  assert.deepEqual(seen, [false, true]);
  f.leaveFullscreen();
  assert.deepEqual(seen, [false, true, false]);
});

test('every vendor spelling of the change event is listened for', () => {
  const f = loadFullscreen({ el: {} });
  f.Fullscreen.watch(() => {});
  for (const e of CHANGE_EVENTS) {
    assert.ok((f.listeners[e] || []).length > 0, `no listener for ${e}`);
  }
});

test('watching twice re-points the callback without attaching a second listener', () => {
  // Help.open() re-syncs the row every time it is opened, and syncToggles() also reads the
  // real state, so watch() must be safe to call repeatedly: a duplicated listener would
  // make the highlight flap once per listener on every fullscreen change.
  const seen = [];
  const f = loadFullscreen({ el: {} });
  f.Fullscreen.watch(v => seen.push('a' + v));
  const before = CHANGE_EVENTS.map(e => (f.listeners[e] || []).length);
  f.enterFullscreen();
  assert.deepEqual(seen, ['afalse', 'atrue'], 'the first callback should have seen both states');
  f.Fullscreen.watch(v => seen.push('b' + v));
  assert.deepEqual(CHANGE_EVENTS.map(e => (f.listeners[e] || []).length), before, 'a second watch() duplicated the listeners');
  assert.deepEqual(seen.slice(2), ['btrue'], 're-watching must re-report the current state');
  f.leaveFullscreen();
  assert.deepEqual(seen.slice(2), ['btrue', 'bfalse']);
});

test('watch(null) detaches the callback but keeps listening harmlessly', () => {
  let fires = 0;
  const f = loadFullscreen({ el: {} });
  f.Fullscreen.watch(() => fires++);
  f.Fullscreen.watch(null);
  f.enterFullscreen();
  assert.equal(fires, 1);
});

test('a change event with no callback does not throw', () => {
  const f = loadFullscreen({ el: {} });
  f.Fullscreen.watch(null);
  f.leaveFullscreen();
  assert.equal(f.Fullscreen.on(), false);
});

/* ------------------------------------------------------------------ *
 * the shipped wiring
 * ------------------------------------------------------------------ */

function markup() {
  const html = src();
  const i = html.indexOf('<div class="setRow" id="fsRow"');
  assert.ok(i > -1, 'the 全屏 settings row is missing from the help modal');
  const j = html.indexOf('</div>\n    <div class="helpNote"', i);
  assert.ok(j > i, 'the 全屏 settings row is not terminated before the help note');
  return html.slice(i, j);
}

test('the help modal carries a two-state 全屏 row that starts hidden', () => {
  const row = markup();
  assert.match(row, /id="fsRow"[^>]*\bhidden\b/, 'the row must ship hidden so it can be revealed at boot');
  assert.match(row, /id="optFull"/);
  assert.equal((row.match(/class="seg"/g) || []).length, 2);
  assert.match(row, /data-v="on">全屏</);
  assert.match(row, /data-v="off">普通</);
});

test('the row is hidden where the API is missing, and the CSS lets [hidden] win', () => {
  // `$('#fsRow').hidden=!Fullscreen.supported()` is the behaviour; `.setRow[hidden]` is what
  // makes it real. `.setRow{display:flex}` is an author rule at the same specificity (0,1,0)
  // as the UA's `[hidden]{display:none}`, so without the named rule the row would draw anyway.
  assert.ok(src().includes("$('#fsRow').hidden=!Fullscreen.supported();"), 'the row is never gated on support');
  const css = src();
  assert.ok(/^\.setRow\[hidden\]\{display:none;\}/m.test(css), 'no [hidden] rule for .setRow');
  // Anchored at the line start so the explanatory comment above the rule cannot satisfy it,
  // and counted so a second `.setRow` rule cannot quietly override the measured pair.
  assert.equal((css.match(/^\.setRow\{/gm) || []).length, 1, '.setRow is declared more than once');
  assert.equal((css.match(/^\.setRow\[hidden\]\{/gm) || []).length, 1, 'the [hidden] rule is duplicated');
});

test('the row is wired to the module, and a refused request is not retried forever', () => {
  const code = src();
  assert.ok(code.includes("$$('#optFull .seg').forEach(b=>{ b.onclick="), 'no click handler on the segments');
  assert.ok(
    /if\(Fullscreen\.on\(\)===want\)return;/.test(code),
    'tapping the state the page is already in would fire another request every time',
  );
  assert.ok(code.includes('Fullscreen.toggle();'), 'the segments do not toggle');
});

test('syncToggles reflects the real fullscreen state, so a stale highlight is impossible', () => {
  // Anchored inside syncToggles' own body: the same expression also runs in the change
  // listener, so a bare `src().includes(...)` would be satisfied by that second copy and a
  // syncToggles that had lost the line would still pass.
  const code = src();
  const i = code.indexOf('function syncToggles(){');
  const j = code.indexOf('\nfunction wireSeg(', i);
  assert.ok(i > -1 && j > i, 'could not slice syncToggles');
  const body = code.slice(i, j);
  assert.ok(
    body.includes("$$('#optFull .seg').forEach(b=>b.classList.toggle('on',(b.dataset.v==='on')===Fullscreen.on()));"),
    'syncToggles does not sync the 全屏 row: ' + body,
  );
  // and the same expression is what the change listener runs
  assert.ok(code.includes("Fullscreen.watch(()=>{ $$('#optFull .seg').forEach(b=>b.classList.toggle('on',(b.dataset.v==='on')===Fullscreen.on())); });"),
    'the fullscreenchange handler does not resync the row');
});

test('the module is declared before the settings UI that reads it', () => {
  const code = src();
  const mod = code.indexOf(START);
  const sync = code.indexOf('function syncToggles()');
  const hide = code.indexOf("$('#fsRow').hidden=!Fullscreen.supported();");
  const watch = code.indexOf('Fullscreen.watch(');
  assert.ok(mod > -1 && sync > mod, 'syncToggles is declared above the module it reads');
  assert.ok(hide > mod, 'the row is gated before the module exists');
  assert.ok(watch > mod, 'watch() is called before the module exists');
});

test('the row mentions fullscreen in the help note, so it is findable', () => {
  const note = src().slice(src().indexOf('<div class="helpNote">'));
  assert.match(note.slice(0, note.indexOf('</div>')), /全屏/);
});

test('fullscreen is deliberately not persisted: a browser refuses it without a gesture', () => {
  const mod = moduleSrc();
  assert.ok(!/Store|localStorage/.test(mod), 'the module must not remember the choice');
  assert.ok(!/setFull|fullscreen:/.test(src()), 'no fullscreen key was added to the Store');
});

test('a throwing row sync is not swallowed, and leaves the module usable', () => {
  // Silently swallowing an error in the row sync would leave the highlight stuck on the wrong
  // state with nothing in the console to explain it; swallowing it *and* the listener count
  // would be worse. The error must reach the console and the module must stay consistent.
  const f = loadFullscreen({ el: {} });
  let calls = 0;
  assert.throws(
    () =>
      f.Fullscreen.watch(() => {
        calls++;
        throw new Error('row sync blew up');
      }),
    /row sync blew up/,
  );
  const before = CHANGE_EVENTS.map(e => (f.listeners[e] || []).length);
  assert.throws(() => f.enterFullscreen(), /row sync blew up/);
  assert.equal(calls, 2, 'the change event never reached the callback');
  f.Fullscreen.watch(() => {});
  assert.deepEqual(CHANGE_EVENTS.map(e => (f.listeners[e] || []).length), before);
});

/* ------------------------------------------------------------------ *
 * the merge this port came from
 * ------------------------------------------------------------------ */

test('gemini.html really does ship the toggle being ported', () => {
  const g = gemini();
  assert.match(g, /id="fullscreen-toggle-btn"/);
  assert.match(g, /requestFullscreen/);
  assert.match(g, /exitFullscreen/);
  // ...and its two defects, which is what the port fixes rather than copies.
  assert.ok(
    !/fullscreenchange/.test(g),
    'gemini never listens for a change, which is why its label never changes',
  );
});

test('gemini draws its button unconditionally; qwen gates it on support', () => {
  assert.ok(/class="fullscreen-btn"/.test(gemini()), 'the gemini button is gone from gemini');
  assert.ok(src().includes('Fullscreen.supported()'), 'qwen does not gate anything on support');
});
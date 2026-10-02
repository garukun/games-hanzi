'use strict';
/**
 * Tests for the inlined Pulse module inside qwen.html, plus the Voice-engine
 * contract that makes it necessary.
 *
 * ## Why this module exists
 *
 * The 🔊 button's "speaking" glow used to be driven by a plain boolean that
 * Voice's `onend` callback flipped. An utterance can end three ways — it finishes,
 * something interrupts it, or it is displaced before it starts — and the boolean had
 * a race in both directions:
 *
 *   * latch:    an interrupted utterance had its `onend` dropped entirely, so the
 *              button pulsed forever. Reproduced in headless Chromium: pressing 🔊
 *              and then tapping a bubble left `speaking` on 8 s later.
 *   * steal:    the displaced utterance's `onend` fires *after* the replacement has
 *              already switched the glow on, switching it back off while the new
 *              clip is still playing.
 *
 * Two changes fix it, and this suite pins both halves because either alone leaves
 * a failure mode:
 *
 *   1. `Voice.stop()` now settles the item it displaces. `onend` means "I am done
 *      talking", not "I played to the end of the text" — see VOICE ENGINE tests.
 *   2. `Pulse` gives each utterance a generation token, so only the newest one may
 *      switch the glow off. Without this, change 1 alone *causes* the steal.
 *
 * The module is pure data, so it is extracted by markers and run in a vm like the
 * other four.
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

function loadPulse() {
  const html = page();
  const start = html.indexOf('/* ==== PULSE START ==== */');
  const endMark = '/* ==== PULSE END ==== */';
  const end = html.indexOf(endMark);
  assert.ok(start > -1 && end > start, 'PULSE markers not found in qwen.html');
  const src = html.slice(start, end + endMark.length);
  const ctx = vm.createContext({});
  vm.runInContext(src + '\nglobalThis.__pulse = Pulse;', ctx, { filename: 'qwen.html#pulse' });
  assert.ok(ctx.__pulse, 'Pulse was not defined by the extracted module');
  return ctx.__pulse;
}

/** Every Voice.speak call site must go through sayNow, never bare setSpeaking. */
function speakWiring() {
  const src = page();
  const grab = (a, b) => {
    const i = src.indexOf(a);
    const j = src.indexOf(b, i);
    assert.ok(i > -1 && j > i, `could not slice ${a} .. ${b}`);
    return src.slice(i, j);
  };
  return {
    sayNow: grab('function sayNow(', 'function speakTarget('),
    speakTarget: grab('function speakTarget(', 'function setSpeaking('),
    hint: grab("$('#btnHint').onclick", 'function tapBubble('),
    nav: grab('function leaveGame(', '/* ============ PHYSICS'),
    global: src,
  };
}

/* ------------------------------------------------------------------ *
 * The ownership rule
 * ------------------------------------------------------------------ */

test('a fresh token owns the glow; older tokens never do again', () => {
  const Pulse = loadPulse();
  const a = Pulse.begin();
  assert.strictEqual(Pulse.owns(a), true, 'the newest utterance owns the glow');
  const b = Pulse.begin();
  assert.strictEqual(Pulse.owns(b), true);
  assert.strictEqual(Pulse.owns(a), false, 'an interrupted utterance has lost the glow');
});

test('steal race: the displaced utterance cannot switch the glow off', () => {
  const Pulse = loadPulse();
  // This is the exact interleaving that used to blank the button mid-sentence:
  // say A, say B (which interrupts A), then A's callback finally arrives.
  const a = Pulse.begin();
  Pulse.begin(); // B claims the glow and switches it on
  assert.strictEqual(Pulse.owns(a), false);
});

test('latch race: repeated interrupts still leave one live owner', () => {
  const Pulse = loadPulse();
  let live = 0;
  const tokens = [];
  for (let i = 0; i < 5; i++) tokens.push(Pulse.begin());
  // Every stale callback arrives late, out of order, exactly as audio events do.
  for (const t of [...tokens].reverse()) if (Pulse.owns(t)) live++;
  assert.strictEqual(live, 1, 'exactly the newest token may switch the glow off');
  assert.strictEqual(Pulse.owns(tokens[tokens.length - 1]), true);
});

test('tokens never repeat, so a stale callback can never match a later utterance', () => {
  const Pulse = loadPulse();
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const t = Pulse.begin();
    assert.ok(!seen.has(t), 'generation ' + t + ' was handed out twice');
    seen.add(t);
  }
});

test('owns() is false for hostile tokens rather than throwing or matching', () => {
  const Pulse = loadPulse();
  Pulse.begin();
  for (const bad of [undefined, null, NaN, 0, -1, '', '1', {}, [1]]) {
    assert.strictEqual(Pulse.owns(bad), false, String(bad));
  }
});

/* ------------------------------------------------------------------ *
 * sayNow: the single owner of the glow
 * ------------------------------------------------------------------ */

test('sayNow claims a token *before* speak, so an interrupt cannot steal it back', () => {
  const w = speakWiring();
  // Voice.speak() may synchronously settle the item it displaces, which runs the
  // previous utterance's onend. If the token were claimed afterwards, that callback
  // would still look like the current owner.
  assert.ok(
    w.sayNow.indexOf('Pulse.begin()') < w.sayNow.indexOf('Voice.speak('),
    'the token must be claimed before Voice.speak() can settle the previous item'
  );
});

test('sayNow switches the glow on only after speak returns', () => {
  const w = speakWiring();
  assert.ok(
    w.sayNow.indexOf('Voice.speak(') < w.sayNow.indexOf('setSpeaking(true)'),
    'setSpeaking(true) must follow speak(), or a synchronous onend undoes it'
  );
});

test('sayNow only lights the glow when the engine actually took the utterance', () => {
  // A device with the local engine and no speechSynthesis at all settles the item
  // synchronously inside speak(). Gating on `busy` is what stops that dead path from
  // latching a glow that no callback is left to clear.
  const w = speakWiring();
  assert.ok(/if\(Voice\.busy\)setSpeaking\(true\);/.test(w.sayNow), w.sayNow);
});

test('sayNow refuses empty text, so the glow can never be left on with nothing spoken', () => {
  const w = speakWiring();
  assert.ok(/if\(typeof text!=='string'\|\|!text\.trim\(\)\)return false;/.test(w.sayNow), w.sayNow);
});

test('sayNow handles the muted voice by clearing explicitly, not by guessing a timeout', () => {
  const w = speakWiring();
  assert.ok(/if\(!Voice\.on\)\{ clear\(\); return true; \}/.test(w.sayNow), w.sayNow);
  assert.ok(!/setTimeout/.test(w.sayNow), 'the 900 ms mute timeout guess is gone');
});

test('the glow is gated on token ownership in both directions', () => {
  const w = speakWiring();
  assert.ok(/const clear=\(\)=>\{ if\(Pulse\.owns\(tok\)\)setSpeaking\(false\); \};/.test(w.sayNow), w.sayNow);
  assert.ok(/setSpeaking\(true\)/.test(w.sayNow));
});

test('Voice exposes busy so a device that cannot speak is not shown as speaking', () => {
  const src = page();
  assert.ok(/get busy\(\)\{ return playing; \}/.test(src), 'Voice.busy is missing');
  // It has to read the claim flag, not the queue: a queued item has not started yet.
  assert.ok(!/get busy\(\)\{ return queue/.test(src), 'busy must report the in-flight claim');
});

/* ------------------------------------------------------------------ *
 * Call sites
 * ------------------------------------------------------------------ */

test('speakTarget routes through sayNow and tolerates a missing game state', () => {
  const w = speakWiring();
  assert.ok(/return sayNow\(txt\);/.test(w.speakTarget), w.speakTarget);
  // Prompt.say(G&&G.rt) — the 🔊 button can be pressed before a level exists.
  assert.ok(/Prompt\.say\(G&&G\.rt\)/.test(w.speakTarget), w.speakTarget);
});

test('the hint speaks through sayNow too, on both the phrase and char paths', () => {
  const w = speakWiring();
  assert.ok(w.hint.includes("sayNow(rt.a+'，'+rt.b)"), w.hint);
  assert.ok(w.hint.includes('sayNow(rt.text)'), w.hint);
});

test('no bare setSpeaking survives anywhere outside sayNow/setSpeaking itself', () => {
  const src = page();
  const bodyStart = src.indexOf('function sayNow(text){');
  const bodyEnd = src.indexOf('function speakTarget(');
  assert.ok(bodyStart > -1 && bodyEnd > bodyStart, 'sayNow body not found');
  const offenders = [];
  src.split('\n').forEach((line, i) => {
    const lineNo = i + 1;
    if (!line.includes('setSpeaking(')) return;
    if (/function setSpeaking\(v\)/.test(line)) return;          // the definition itself
    if (lineNo >= src.slice(0, bodyStart).split('\n').length &&
        lineNo <= src.slice(0, bodyEnd).split('\n').length) return; // inside sayNow
    offenders.push(lineNo + ': ' + line.trim());
  });
  assert.deepStrictEqual(offenders, [], 'setSpeaking must only be called from sayNow()');
});

test('leaving a level stops the prompt instead of talking over the level map', () => {
  const w = speakWiring();
  assert.ok(/function leaveGame\(\)\{\s*\n\s*Voice\.stop\(\);/.test(w.nav), w.nav);
  // Every route off the game screen goes through it.
  assert.ok(w.global.includes("$('#btnHome').onclick=()=>leaveGame();"), '🏠 must leave via leaveGame()');
  assert.ok(w.global.includes("$('#btnMap2').onclick=()=>leaveGame();"), '🗺️ on the clear card must too');
  assert.ok(w.global.includes("$('#btnLevels').onclick=()=>{ SFX.click(); leaveGame(); };"), '🗺️ on the start screen must too');
  assert.ok(
    w.global.includes("$('#btnBackMap').onclick=()=>{ SFX.click(); Voice.stop(); show('scr-start'); };"),
    'leaving the level map for the title screen must stop speech as well'
  );
});

/* ------------------------------------------------------------------ *
 * Wiring guards that keep the module from being renamed away
 * ------------------------------------------------------------------ */

test('Pulse stays a hoisted, call-time reference so load order cannot strand it', () => {
  const src = page();
  assert.ok(src.includes('const Pulse=(()=>{'), 'Pulse declaration not found');
  // sayNow must remain a hoisted function declaration. If it were ever rewritten as an
  // IIFE that dereferences Pulse while running, moving Pulse below Store would throw
  // "Cannot access 'Pulse' before initialization" on boot — invisible to this suite.
  assert.ok(/function sayNow\(text\)\{/.test(src), 'sayNow must be a function declaration');
  const body = src.slice(src.indexOf('function sayNow(text){'), src.indexOf('function speakTarget('));
  assert.ok(/const tok=Pulse\.begin\(\);/.test(body), 'sayNow must claim the token itself');
  // Every Pulse dereference in the whole page must live inside sayNow's body.
  const uses = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /Pulse\.(begin|owns|retire)\(/.test(l));
  const bodyStart = src.slice(0, src.indexOf('function sayNow(text){')).split('\n').length;
  const bodyEnd = src.slice(0, src.indexOf('function speakTarget(')).split('\n').length;
  for (const [line, text] of uses) {
    assert.ok(line >= bodyStart && line <= bodyEnd, 'Pulse is used outside sayNow at line ' + line + ': ' + text.trim());
  }
});

test('the module exports only what sayNow actually calls', () => {
  const Pulse = loadPulse();
  assert.deepStrictEqual(Object.keys(Pulse).sort(), ['begin', 'owns']);
  // A dead export is a promise nobody keeps; retire() went away once Voice.stop() became
  // the single thing that orphans an utterance.
  const declared = page().slice(page().indexOf('/* ==== PULSE START'), page().indexOf('/* ==== PULSE END'));
  for (const name of ['begin', 'owns']) assert.ok(declared.includes(name + '('), name + ' is missing');
});
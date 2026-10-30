'use strict';
/**
 * Tests for the inlined Voice engine inside qwen.html.
 *
 * The engine ships inside a single-file HTML page, so instead of keeping a
 * duplicate copy in a module we extract it verbatim (between the
 * VOICE ENGINE START/END markers) and run it inside a vm context with stubbed
 * browser globals. That way the tests always exercise the code that ships.
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
const Voice_TIMEOUT = 5000;

/* ------------------------------------------------------------------ *
 * Browser stubs
 * ------------------------------------------------------------------ */

/** A controllable <audio>: never touches the network, just fires events. */
function makeAudioClass(net) {
  const created = [];
  class FakeAudio {
    constructor(src) {
      this.src = src || '';
      this.preload = '';
      this.playsInline = false;
      this.volume = 1;
      this.currentTime = 0;
      this.paused = true;
      this.playCalls = 0;
      this.pauseCalls = 0;
      this.loadCalls = 0;
      this.onended = null;
      this.onerror = null;
      this._h = {};
      this._done = false;
      created.push(this);
    }
    addEventListener(type, fn) {
      this._h[type] = fn;
    }
    removeEventListener(type) {
      delete this._h[type];
    }
    load() {
      this.loadCalls++;
      // net.offline drives the failure path; net.failHosts kills individual
      // providers (matched against the URL) so failover can be exercised.
      Promise.resolve().then(() => {
        if (net.hang) return; // neither event ever arrives
        const dead = net.failHosts.some((h) => this.src.includes(h));
        if (net.offline || dead) {
          if (this._h.error) this._h.error({ type: 'error' });
        } else if (this._h.canplaythrough) {
          this._h.canplaythrough({ type: 'canplaythrough' });
        }
      });
    }
    play() {
      this.playCalls++;
      this.paused = false;
      if (net.blocked) {
        const err = new Error('autoplay blocked');
        err.name = 'NotAllowedError';
        return Promise.reject(err);
      }
      return Promise.resolve();
    }
    pause() {
      this.pauseCalls++;
      this.paused = true;
    }
    /** Simulate the clip reaching its end. */
    finish() {
      if (this._done) return;
      this._done = true;
      if (this.onended) this.onended();
    }
  }
  FakeAudio.created = created;
  return FakeAudio;
}

function makeSynth() {
  return {
    spoken: [],
    canceled: 0,
    paused: false,
    _voices: [],
    getVoices() {
      return this._voices;
    },
    speak(u) {
      this.spoken.push(u);
      // The real synth always reports completion; mirror that.
      Promise.resolve().then(() => u.onend && u.onend());
    },
    cancel() {
      this.canceled++;
    },
    resume() {},
    onvoiceschanged: null,
  };
}

/**
 * Load the Voice engine from qwen.html into an isolated context.
 * @param {object} cfg
 * @param {string[]} cfg.voices   speechSynthesis voice list
 * @param {boolean}  cfg.noSynth  omit window.speechSynthesis entirely
 * @param {boolean}  cfg.offline  make every clip fail to load
 * @param {boolean}  cfg.blocked  make audio.play() reject with NotAllowedError
 * @param {string[]} cfg.failHosts URL substrings whose provider always fails to load
 */
function loadEngine(cfg = {}) {
  const html = fs.readFileSync(PAGE, 'utf8');
  const start = html.indexOf('/* ==== VOICE ENGINE START ====');
  const endMark = '/* ==== VOICE ENGINE END ==== */';
  const end = html.indexOf(endMark);
  assert.ok(start > -1 && end > start, 'VOICE ENGINE markers not found in qwen.html');
  const src = html.slice(start, end + endMark.length);

  const net = { offline: !!cfg.offline, blocked: !!cfg.blocked, hang: false, failHosts: cfg.failHosts || [] };
  const FakeAudio = makeAudioClass(net);
  const synth = cfg.noSynth ? null : makeSynth();
  if (synth) {
    synth._voices = cfg.voices || [
      { lang: 'zh-CN', name: 'Tingting' },
      { lang: 'en-US', name: 'Samantha' },
    ];
  }
  const timers = [];
  const setTimeoutStub = (fn, ms) => {
    const t = { fn, ms, cleared: false };
    timers.push(t);
    return t;
  };
  const clearTimeoutStub = (t) => {
    if (t) t.cleared = true;
  };
  const win = {
    speechSynthesis: synth,
    requestIdleCallback: undefined,
    setTimeout: setTimeoutStub,
    clearTimeout: clearTimeoutStub,
  };
  const ctx = vm.createContext({
    window: win,
    Audio: FakeAudio,
    SpeechSynthesisUtterance: function (text) {
      this.text = text;
      this.lang = '';
      this.voice = null;
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
    },
    console: { debug() {}, log() {}, warn() {}, error() {} },
    setTimeout: setTimeoutStub,
    clearTimeout: clearTimeoutStub,
  });
  // `const Voice = ...` is a lexical binding, so it never lands on the context
  // object. Hand it back explicitly.
  vm.runInContext(src + '\nglobalThis.__voice = Voice;', ctx, { filename: 'qwen.html#voice-engine' });
  assert.ok(ctx.__voice, 'Voice was not defined by the extracted engine');

  /** Run at most `max` due timers — one task per turn, like a real event loop. */
  const fired = [];
  const runTimers = (max = 1) => {
    let n = 0;
    while (timers.length && n++ < max) {
      const t = timers.shift();
      fired.push(t);
      if (!t.cleared) t.fn();
    }
  };
  const harness = {
    Voice: ctx.__voice,
    Audio: FakeAudio,
    synth,
    timers,
    fired,
    runTimers,
    net,
    /** The clips that started playing and have not finished, oldest first. */
    playing: () => FakeAudio.created.filter((a) => a.playCalls > 0 && !a._done),
    /** Every clip requested, tagged with the provider that served it. */
    clips: () => FakeAudio.created.map((a) => ({ a, host: providerOf(a.src) })),
  };
  /** Which rung of the ladder a URL belongs to. */
  function providerOf(url) {
    if (url.includes('translate.google.com')) return 'google';
    if (url.includes('fanyi.baidu.com')) return 'baidu';
    return url.startsWith('data:') ? 'prime' : 'unknown';
  }
  harness.providerOf = providerOf;
  /** Finish clips one by one until nothing is playing. Returns how many. */
  harness.drain = async (max = 20) => {
    let n = 0;
    for (; n < max; n++) {
      const live = harness.playing();
      if (!live.length) break;
      live[live.length - 1].finish();
      await settle(harness);
    }
    return n;
  };
  return harness;
}

/** Values built inside the vm realm need copying out before deepStrictEqual. */
const plain = (v) => JSON.parse(JSON.stringify(v));

/** Let all pending microtasks and fake timers settle. */
async function settle(harness, rounds = 80) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setImmediate(r));
    harness.runTimers();
  }
  await new Promise((r) => setImmediate(r));
}

/* ------------------------------------------------------------------ *
 * URL building / chunking
 * ------------------------------------------------------------------ */

test('buildUrl targets the keyless neural endpoint and encodes the text', () => {
  const { Voice } = loadEngine();
  const url = Voice._internals.buildUrl('汉字');
  assert.ok(url.startsWith('https://translate.google.com/translate_tts?'), url);
  assert.ok(url.includes('client=tw-ob'), 'client=tw-ob is required or the endpoint 302s');
  assert.ok(url.includes('tl=zh-CN'), url);
  assert.ok(url.includes('q=%E6%B1%89%E5%AD%97'), 'text must be percent-encoded: ' + url);
  assert.ok(!url.includes('q=汉字'), 'raw CJK must not leak into the query string');
});

test('buildUrl collapses newlines and rejects empty text (endpoint 400s on empty q)', () => {
  const { Voice } = loadEngine();
  assert.strictEqual(Voice._internals.buildUrl(''), '');
  assert.strictEqual(Voice._internals.buildUrl('   \n\t '), '');
  const folded = Voice._internals.buildUrl('父\n母呼');
  assert.ok(folded.includes('%20'), folded);
  assert.ok(!folded.includes('%0A'), folded);
});

test('buildUrl applies the slow/normal speed setting', () => {
  const { Voice } = loadEngine();
  assert.ok(Voice._internals.buildUrl('汉').includes('ttsspeed=1'));
  Voice.setSpeed('slow');
  assert.ok(Voice._internals.buildUrl('汉').includes('ttsspeed=0.3'));
  assert.strictEqual(Voice.speed, 'slow');
  Voice.setSpeed('nonsense');
  assert.strictEqual(Voice.speed, 'slow', 'unknown speed values are ignored');
});

test('chunk leaves normal game words alone but splits very long text on punctuation', () => {
  const { Voice } = loadEngine();
  for (const w of ['汉', '太阳', '父母呼', '性本善']) {
    assert.deepStrictEqual(plain(Voice._internals.chunk(w)), [w]);
  }
  const long = '弟子规圣人训首孝悌次谨信泛爱众而亲仁。'.repeat(6);
  const parts = Voice._internals.chunk(long);
  assert.ok(parts.length > 1, 'expected the text to be split');
  assert.strictEqual(parts.join('').length, long.length, 'chunking must not drop characters');
  parts.forEach((p) => assert.ok(p.length <= Voice._internals.CHUNK, 'chunk too large: ' + p.length));
});

/* ------------------------------------------------------------------ *
 * Playback: happy path
 * ------------------------------------------------------------------ */

test('speak loads a clip through an <audio> element and plays it', async () => {
  const h = loadEngine();
  let ended = false;
  h.Voice.speak('汉', { onend: () => { ended = true; } });
  await settle(h);

  assert.strictEqual(h.Audio.created.length, 1, 'exactly one audio element');
  const a = h.Audio.created[0];
  assert.strictEqual(a.playCalls, 1);
  assert.strictEqual(a.loadCalls, 1, 'load() must be called to kick off the fetch');
  assert.ok(a.src.includes('q=%E6%B1%89'));

  a.finish();
  assert.strictEqual(ended, true, 'onend must fire when the clip finishes');
  assert.strictEqual(h.Voice.stats.neural, 1);
  assert.strictEqual(h.Voice.stats.local, 0);
});

test('multi-chunk text plays sequentially and only then fires onend', async () => {
  const h = loadEngine();
  const long = '弟子规，圣人训。'.repeat(14);
  let ended = false;
  h.Voice.speak(long, { onend: () => { ended = true; } });
  await settle(h);

  assert.strictEqual(h.playing().length, 1, 'must not start chunk 2 before chunk 1 ends');
  assert.strictEqual(ended, false);

  // Drain the chain: each finished clip reveals the next one.
  await h.drain();
  assert.strictEqual(ended, true, 'onend must wait for every chunk');
  assert.ok(h.Audio.created.length > 1, 'expected the text to be chunked');
  assert.strictEqual(
    h.Audio.created.map((a) => decodeURIComponent(a.src.split('q=')[1])).join(''),
    long,
    'the chunks must reassemble into the original text',
  );
});

test('same text is fetched once and replayed from cache', async () => {
  const h = loadEngine();
  h.Voice.speak('汉');
  await settle(h);
  h.Audio.created[0].finish();
  h.Voice.speak('汉');
  await settle(h);

  assert.strictEqual(h.Audio.created.length, 1, 'second request must hit the cache');
  assert.strictEqual(h.Audio.created[0].playCalls, 2);
});

test('the cache is keyed by speed, so switching speed refetches', async () => {
  const h = loadEngine();
  h.Voice.speak('汉');
  await settle(h);
  h.Audio.created[0].finish();
  h.Voice.setSpeed('slow');
  h.Voice.speak('汉');
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 2);
  assert.ok(h.Audio.created[1].src.includes('ttsspeed=0.3'));
});

test('interrupt:true drops whatever is queued and plays the newest text', async () => {
  const h = loadEngine();
  h.Voice.speak('父');
  await settle(h);
  h.Voice.speak('母', { interrupt: true });
  await settle(h);

  assert.strictEqual(h.Audio.created.length, 2);
  assert.ok(h.Audio.created[1].src.includes('q=%E6%AF%8D'), 'newest text must be the one playing');
  assert.strictEqual(h.Audio.created[0].pauseCalls >= 1, true, 'previous clip must be paused');
});

test('interrupt:false queues behind the current clip and drains in order', async () => {
  const h = loadEngine();
  h.Voice.speak('父');
  await settle(h);
  h.Voice.speak('母', { interrupt: false });
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 1, 'queued item must not start early');

  h.Audio.created[0].finish();
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 2);
  assert.ok(h.Audio.created[1].src.includes('q=%E6%AF%8D'));
});

test('interrupt:false items enqueued mid-playback all run, in order', async () => {
  const h = loadEngine();
  const order = [];
  h.Voice.speak('一', { onend: () => order.push('一') });
  await settle(h);
  h.Voice.speak('二', { interrupt: false, onend: () => order.push('二') });
  h.Voice.speak('三', { interrupt: false, onend: () => order.push('三') });
  await settle(h);
  await h.drain();
  assert.deepStrictEqual(order, ['一', '二', '三']);
  assert.deepStrictEqual(
    h.Audio.created.map((a) => decodeURIComponent(a.src.split('q=')[1])),
    ['一', '二', '三'],
    'clips played out of order',
  );
});

/* ------------------------------------------------------------------ *
 * Fallback to the OS speech engine
 * ------------------------------------------------------------------ */

test('a network failure falls back to speechSynthesis instead of going silent', async () => {
  const h = loadEngine({ offline: true });
  let ended = false;
  h.Voice.speak('汉', { onend: () => { ended = true; } });
  await settle(h);

  assert.strictEqual(h.synth.spoken.length, 1, 'fallback utterance should be spoken');
  assert.strictEqual(h.synth.spoken[0].text, '汉');
  assert.strictEqual(h.synth.spoken[0].voice.name, 'Tingting', 'a zh voice must be selected');
  assert.strictEqual(h.Voice.stats.local, 1);
  assert.ok(h.Voice.stats.errors >= 1);
});

test('auto mode demotes to the local engine after repeated network failures', async () => {
  const h = loadEngine({ offline: true });
  h.Voice.speak('汉');
  await settle(h);
  h.Voice.speak('字');
  await settle(h);
  assert.strictEqual(h.synth.spoken.length, 2, 'both attempts should have fallen back');

  h.Voice.speak('母');
  await settle(h);
  const net = h.Audio.created.filter((a) => a.src.startsWith('https://'));
  assert.strictEqual(
    net.length,
    4,
    'auto mode must stop hammering a dead endpoint after two whole-ladder failures (2 x 2 providers)',
  );
  assert.strictEqual(h.synth.spoken.length, 3);
});

test('engine:"local" never touches the network', async () => {
  const h = loadEngine();
  h.Voice.setEngine('local');
  h.Voice.speak('汉');
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 0);
  assert.strictEqual(h.synth.spoken.length, 1);
});

test('engine:"neural" retries the network even after auto mode gave up', async () => {
  const h = loadEngine({ offline: true });
  h.Voice.speak('汉');
  await settle(h);

  h.Voice.setEngine('neural');
  h.Voice.speak('母');
  await settle(h);
  // setEngine also un-quarantines the providers, so both rungs are retried.
  assert.strictEqual(h.Audio.created.length, 4);
  assert.ok(h.Audio.created[3].src.startsWith('https://'));
});

test('setEngine rejects unknown values', () => {
  const h = loadEngine();
  h.Voice.setEngine('bogus');
  assert.strictEqual(h.Voice.engine, 'auto');
});

test('slow speed is honoured on the fallback engine too', async () => {
  const h = loadEngine();
  h.Voice.setEngine('local');
  h.Voice.setSpeed('slow');
  h.Voice.speak('汉');
  await settle(h);
  assert.ok(h.synth.spoken[0].rate < 0.8, 'slow fallback rate: ' + h.synth.spoken[0].rate);
});

test('fallback picks a zh-CN voice over an unrelated one', async () => {
  const h = loadEngine({
    offline: true,
    voices: [
      { lang: 'en-US', name: 'Samantha' },
      { lang: 'zh-HK', name: 'Sinji' },
      { lang: 'en-GB', name: 'Daniel' },
    ],
  });
  h.Voice.speak('汉');
  await settle(h);
  assert.strictEqual(h.synth.spoken[0].voice.name, 'Sinji');
});

test('with no speechSynthesis and no network there is still no crash, and onend fires', async () => {
  const h = loadEngine({ noSynth: true, offline: true });
  let ended = false;
  h.Voice.speak('汉', { onend: () => { ended = true; } });
  await settle(h);
  assert.strictEqual(ended, true, 'onend must always fire so the speaker button stops pulsing');
});

/* ------------------------------------------------------------------ *
 * Mute / unlock / prefetch
 * ------------------------------------------------------------------ */

test('setOn(false) mutes and still fires onend; setOn(true) restores', async () => {
  const h = loadEngine();
  h.Voice.setOn(false);
  let ended = false;
  h.Voice.speak('汉', { onend: () => { ended = true; } });
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 0, 'muted voice must not fetch');
  assert.strictEqual(ended, true);

  h.Voice.setOn(true);
  h.Voice.speak('母');
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 1);
});

test('prime() plays an inline data URI, never a network request', () => {
  const h = loadEngine();
  h.Voice.prime();
  assert.strictEqual(h.Audio.created.length, 1);
  assert.ok(h.Audio.created[0].src.startsWith('data:audio/wav'), h.Audio.created[0].src);
  h.Voice.prime();
  assert.strictEqual(h.Audio.created.length, 1, 'prime must be idempotent');
});

test('a load that never resolves gives up on its own timeout instead of hanging', async () => {
  const h = loadEngine();
  h.net.hang = true; // neither canplaythrough nor error ever arrives
  let ended = false;
  h.Voice.speak('汉', { onend: () => { ended = true; } });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(ended, false, 'should still be waiting on the clip');

  const armed = h.timers.filter((t) => !t.cleared);
  assert.strictEqual(armed.length, 1, 'load() must arm a timeout so a dead request cannot hang the game');
  assert.strictEqual(armed[0].ms, Voice_TIMEOUT);
  armed[0].fn();
  await settle(h);
  assert.strictEqual(ended, true, 'the timeout must hand over to the fallback');
  assert.strictEqual(h.synth.spoken.length, 1, 'and the fallback must actually speak');
});

test('a blocked autoplay play() stops the engine retrying rather than looping', async () => {
  const h = loadEngine({ blocked: true });
  let ended = false;
  h.Voice.speak('汉', { onend: () => { ended = true; } });
  await settle(h);
  assert.strictEqual(ended, true, 'the speaker icon must stop pulsing even when playback is refused');
  assert.strictEqual(h.Audio.created.length, 1, 'must not retry after NotAllowedError');
});

test('prefetch warms the cache and dedupes, so the first tap is instant', async () => {
  const h = loadEngine();
  h.Voice.prefetch(['汉', '字', '大', '汉']);
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 3, 'duplicates must not be re-fetched');
  assert.strictEqual(h.Voice.stats.cached, 3, 'all three clips should be cached');

  h.Voice.speak('汉');
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 3, 'speak must reuse the prefetched clip');
});

test('prefetch works again on a later level (timer is not latched)', async () => {
  const h = loadEngine();
  h.Voice.prefetch(['汉', '字']);
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 2);
  h.Voice.prefetch(['大', '小']);
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 4, 'second prefetch was ignored');
});

test('prefetch skips blanks and tolerates a bare string', async () => {
  const h = loadEngine();
  h.Voice.prefetch(['汉', '', '   ', null, undefined]);
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 1);
});

test('stop() cancels playback so a hidden tab goes quiet', async () => {
  const h = loadEngine();
  h.Voice.speak('父');
  await settle(h);
  h.Voice.speak('母', { onend: () => { throw new Error('must not fire after stop'); } });
  h.Voice.stop();
  await settle(h);
  assert.ok(h.Audio.created[0].pauseCalls >= 1);
  assert.strictEqual(h.synth.canceled >= 1, true);
});

test('whitespace-only text is ignored and never hits the endpoint', async () => {
  const h = loadEngine();
  h.Voice.speak('   ');
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 0);
});

test('an interrupt settles the utterance it displaces — exactly once, never twice', async () => {
  // `onend` means "I am done talking", not "I played to the end of the text". The 🔊
  // speaking glow is switched off by nothing else, so dropping it on an interrupt latched
  // the button on forever (reproduced in Chromium). A late `ended` from the displaced clip
  // must still not report a *second* completion.
  const h = loadEngine();
  const fired = [];
  h.Voice.speak('父', { onend: () => fired.push('父') });
  await settle(h);
  h.Voice.speak('母', { interrupt: true, onend: () => fired.push('母') });
  await settle(h);
  assert.deepStrictEqual(fired, ['父'], 'the displaced utterance was never told it was done');
  h.Audio.created[0].finish(); // the superseded clip reports ending late
  await settle(h);
  assert.deepStrictEqual(fired, ['父'], 'a stale clip must not settle anything a second time');
  h.Audio.created[1].finish();
  await settle(h);
  assert.deepStrictEqual(fired, ['父', '母'], 'the live utterance never completed');
});

test('a late clip cannot settle the utterance that replaced it', async () => {
  const h = loadEngine();
  const fired = [];
  h.Voice.speak('父', { onend: () => fired.push('父') });
  await settle(h);
  h.Voice.speak('母', { interrupt: true, onend: () => fired.push('母') });
  await settle(h);
  assert.deepStrictEqual(fired, ['父']);
  // 父's audio element fires `ended` after 母 is already playing. Only the item that holds
  // the play claim may release it, otherwise the queue would let a third clip start early.
  h.Audio.created[0].finish();
  await settle(h);
  assert.deepStrictEqual(fired, ['父'], '母 must not be settled by 父 arriving late');
  assert.strictEqual(h.Audio.created.length, 2, 'a third clip started while 母 was still playing');
  h.Audio.created[1].finish();
  await settle(h);
  assert.deepStrictEqual(fired, ['父', '母']);
});

test('stop() settles the utterance in flight so a mute cannot strand the glow', async () => {
  const h = loadEngine();
  const fired = [];
  h.Voice.speak('父', { onend: () => fired.push('父') });
  await settle(h);
  h.Voice.stop();
  assert.deepStrictEqual(fired, ['父'], 'stop() left the caller waiting forever for onend');
  // ...and turning the voice off goes through stop().
  h.Voice.speak('母', { onend: () => fired.push('母') });
  await settle(h);
  h.Voice.setOn(false);
  assert.deepStrictEqual(fired, ['父', '母'], 'muting mid-utterance stranded the caller');
});

test('stop() settles queued (not yet started) utterances too', async () => {
  const h = loadEngine();
  const fired = [];
  h.Voice.speak('父', { onend: () => fired.push('父') });
  await settle(h);
  h.Voice.speak('母', { interrupt: false, onend: () => fired.push('母') });
  await settle(h);
  assert.deepStrictEqual(fired, [], '母 was queued behind 父');
  h.Voice.stop();
  assert.ok(fired.includes('父'), 'the in-flight utterance was not settled');
  assert.ok(!fired.includes('母'), 'a queued utterance was dropped without being settled');
});

test('a throwing onend cannot wedge the queue or throw out of stop()', async () => {
  const h = loadEngine();
  h.Voice.speak('父', { onend: () => { throw new Error('caller blew up'); } });
  await settle(h);
  h.Voice.speak('母', { interrupt: true, onend: () => {} });
  await settle(h);
  assert.doesNotThrow(() => h.Voice.stop());
  h.Voice.speak('兄', { onend: () => {} });
  await settle(h);
  assert.ok(h.Audio.created.length >= 3, 'the engine stopped accepting work after a caller threw');
});

test('busy tracks the in-flight claim, and is false on a device that cannot speak', async () => {
  const h = loadEngine();
  assert.strictEqual(h.Voice.busy, false, 'nothing is playing yet');
  h.Voice.speak('父', { onend: () => {} });
  assert.strictEqual(h.Voice.busy, true, 'the utterance took the claim synchronously');
  await settle(h);
  h.Audio.created[0].finish();
  await settle(h);
  assert.strictEqual(h.Voice.busy, false, 'the claim was released when the clip ended');
});

test('busy is false when the local engine has no speechSynthesis to fall back on', async () => {
  // This is the case that would latch a "speaking" glow: the item is settled synchronously
  // inside speak(), so the caller's onend runs *before* it decides to switch the glow on.
  const h = loadEngine({ noSynth: true });
  h.Voice.setEngine('local');
  const fired = [];
  h.Voice.speak('父', { onend: () => fired.push('父') });
  await settle(h);
  assert.strictEqual(h.Voice.busy, false, 'a device that can speak nothing must report idle');
  assert.deepStrictEqual(fired, ['父'], 'and it must still settle the caller synchronously');
});

/* ------------------------------------------------------------------ *
 * The neural ladder: Google (primary) -> Baidu (backup) -> OS voice
 * ------------------------------------------------------------------ */

test('both neural providers build keyless URLs for the same text', () => {
  const { Voice } = loadEngine();
  const g = Voice._internals.buildUrl('汉字', 'google');
  const b = Voice._internals.buildUrl('汉字', 'baidu');
  assert.ok(g.startsWith('https://translate.google.com/translate_tts?'), g);
  assert.ok(b.startsWith('https://fanyi.baidu.com/gettts?'), b);
  for (const url of [g, b]) {
    assert.ok(!/api[_-]?key|token|key=/i.test(url), 'no endpoint may need a credential: ' + url);
    assert.ok(url.includes('%E6%B1%89%E5%AD%97'), 'text must be percent-encoded: ' + url);
    assert.ok(!url.includes('q=汉字') && !url.includes('text=汉字'), 'raw CJK leaked: ' + url);
  }
  assert.ok(g.includes('client=tw-ob'), 'client=tw-ob is required or the endpoint 302s');
  assert.ok(b.includes('lan=zh'), b);
  assert.strictEqual(Voice._internals.buildUrl('汉字'), g, 'the default must stay the primary provider');
});

test('each provider maps the slow/normal setting onto its own speed dial', () => {
  const h = loadEngine();
  const I = h.Voice._internals;
  assert.ok(I.buildUrl('汉', 'google').includes('ttsspeed=1'));
  assert.ok(I.buildUrl('汉', 'baidu').includes('spd=' + I.BSPD.normal));

  h.Voice.setSpeed('slow');
  assert.ok(I.buildUrl('汉', 'google').includes('ttsspeed=0.3'), 'google slows only at <=0.3');
  assert.ok(I.buildUrl('汉', 'baidu').includes('spd=' + I.BSPD.slow));
  assert.ok(I.BSPD.slow < I.BSPD.normal, 'the backup dial must actually move');
});

test('both providers reject empty text, which their endpoints answer 4xx/5xx on', () => {
  const { Voice } = loadEngine();
  for (const id of Voice._internals.PROVIDERS.map((p) => p.id)) {
    assert.strictEqual(Voice._internals.buildUrl('', id), '', id);
    assert.strictEqual(Voice._internals.buildUrl(' \n\t ', id), '', id);
  }
});

test('a dead primary provider hands the clip to the backup, never to the OS voice', async () => {
  const h = loadEngine({ failHosts: ['translate.google.com'] });
  h.Voice.speak('汉');
  await settle(h);

  assert.deepStrictEqual(
    h.clips().map((c) => c.host),
    ['google', 'baidu'],
    'the ladder must try google, then baidu',
  );
  const playing = h.playing();
  assert.strictEqual(playing.length, 1);
  assert.ok(playing[0].src.includes('fanyi.baidu.com'), playing[0].src);
  assert.strictEqual(h.playing()[0].playCalls, 1);
  assert.strictEqual(h.synth.spoken.length, 0, 'a neural backup must beat the system voice');
  assert.strictEqual(h.Voice.provider, 'baidu');
  assert.strictEqual(h.Voice.stats.providers.baidu, 1);
  assert.strictEqual(h.Voice.stats.providers.google, 0);
  assert.strictEqual(h.Voice.stats.errors, 1, 'only the dead provider counts as an error');
  assert.strictEqual(h.Voice.activeEngine, 'neural');
});

test('the backup becomes the preferred provider while the primary is dead', async () => {
  const h = loadEngine({ failHosts: ['translate.google.com'] });
  h.Voice.speak('汉');
  await settle(h);
  h.playing()[0].finish();
  h.Voice.speak('字');
  await settle(h);
  assert.deepStrictEqual(
    h.clips().map((c) => c.host),
    ['google', 'baidu', 'baidu'],
    'after one failure the working provider should be tried first',
  );
});

test('a working provider is promoted, so a dead rung is not retried on every tap', async () => {
  const h = loadEngine({ failHosts: ['translate.google.com'] });
  for (const t of ['汉', '字', '大']) {
    h.Voice.speak(t);
    await settle(h);
    h.playing().forEach((a) => a.finish());
  }
  const perProvider = h.clips().reduce((m, c) => ((m[c.host] = (m[c.host] || 0) + 1), m), {});
  assert.strictEqual(perProvider.google, 1, 'google failed once, then must not be asked again');
  assert.strictEqual(perProvider.baidu, 3, 'every tap is carried by the backup');
  assert.deepStrictEqual(
    plain(h.Voice._internals.order()).map((p) => p.id),
    ['baidu', 'google'],
    'the provider that served last is tried first',
  );
});

test('a provider that keeps failing is quarantined after PROV_GIVEUP attempts', async () => {
  const h = loadEngine({ offline: true });
  for (const t of ['汉', '字']) {
    h.Voice.speak(t);
    await settle(h);
  }
  assert.ok(
    h.Voice._internals.PROVIDERS.every((p) => p.fails === h.Voice._internals.PROV_GIVEUP),
    'each rung gets exactly PROV_GIVEUP tries: ' + JSON.stringify(plain(h.Voice._internals.PROVIDERS)),
  );
  assert.strictEqual(
    h.clips().filter((c) => c.host !== 'prime').length,
    4,
    'two utterances x two rungs, then auto mode gave up on the network',
  );
});

test('only when the whole ladder fails does the OS voice take over', async () => {
  const h = loadEngine({ offline: true });
  h.Voice.speak('汉');
  await settle(h);
  assert.strictEqual(h.synth.spoken.length, 1);
  assert.strictEqual(h.synth.spoken[0].text, '汉');
  assert.strictEqual(h.synth.spoken[0].voice.name, 'Tingting');
  assert.strictEqual(h.Voice.stats.errors, 2, 'both providers failed');
});

test('a dead backup never costs the primary anything (and vice versa)', async () => {
  const h = loadEngine({ failHosts: ['fanyi.baidu.com'] });
  h.Voice.speak('汉');
  await settle(h);
  assert.deepStrictEqual(h.clips().map((c) => c.host), ['google']);
  assert.ok(h.playing()[0].src.includes('translate.google.com'));
  assert.strictEqual(h.Voice.provider, 'google');
  assert.strictEqual(h.Voice.stats.errors, 0, 'a rung that never failed must not be blamed');
});

test('the same text is fetched once, not once per rung, and replays from cache', async () => {
  const h = loadEngine({ failHosts: ['translate.google.com'] });
  h.Voice.speak('汉');
  await settle(h);
  const cached = h.playing()[0];
  assert.ok(cached.src.includes('fanyi.baidu.com'), cached.src);
  cached.finish();

  h.Voice.speak('汉');
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 2, 'the backup clip must be replayed from cache');
  assert.strictEqual(cached.playCalls, 2);
  h.playing().forEach((a) => a.finish());

  h.Voice.speak('汉');
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 2, 'still no fifth request');
  assert.strictEqual(cached.playCalls, 3);
});

test('prefetch survives a dead primary and warms the backup instead', async () => {
  const h = loadEngine({ failHosts: ['translate.google.com'] });
  h.Voice.prefetch(['汉', '字', '汉']);
  await settle(h);
  const counts = h.clips().reduce((m, c) => ((m[c.host] = (m[c.host] || 0) + 1), m), {});
  assert.strictEqual(counts.baidu, 2, 'both words must be cached from the backup: ' + JSON.stringify(counts));
  assert.ok(counts.google >= 1, 'the primary is attempted first for every word');

  h.Voice.speak('汉');
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 4, 'the tap must be a cache hit, not a fifth request');
  assert.strictEqual(h.Voice.stats.neural, 1);
  assert.strictEqual(h.Voice.provider, 'baidu');
});

test('provider health resets when the child changes the voice setting', async () => {
  const h = loadEngine({ failHosts: ['translate.google.com'] });
  h.Voice.speak('汉');
  await settle(h);
  assert.ok(h.Voice._internals.PROVIDERS[0].fails > 0, 'google recorded a failure');

  h.Voice.setEngine('auto');
  assert.ok(
    h.Voice._internals.PROVIDERS.every((p) => p.fails === 0),
    'setEngine must un-quarantine',
  );
  assert.deepStrictEqual(
    plain(h.Voice._internals.order()).map((p) => p.id),
    ['google', 'baidu'],
    'the primary is retried first after an explicit reset',
  );
});

test('the ladder is ordered google -> baidu, both keyless, both https', () => {
  const h = loadEngine();
  for (const p of h.Voice._internals.PROVIDERS) {
    const url = h.Voice._internals.buildUrl('父母呼', p.id);
    assert.ok(url.startsWith('https://'), p.id + ' must be https: ' + url);
    assert.ok(!/api[_-]?key|token|key=|secret/i.test(url), p.id + ' needs no credential: ' + url);
  }
  assert.deepStrictEqual(
    plain(h.Voice._internals.PROVIDERS).map((p) => p.id),
    ['google', 'baidu'],
    'google is primary (24 kHz clip), baidu is the backup',
  );
});

test('two concurrent requests for the same clip share one request', async () => {
  const h = loadEngine();
  const p = h.Voice._internals.PROVIDERS[0];
  const [a, b] = await Promise.all([
    h.Voice._internals.load(p, '汉'),
    h.Voice._internals.load(p, '汉'),
  ]);
  assert.strictEqual(a, b, 'the second caller must get the in-flight promise, not undefined');
  assert.strictEqual(h.Audio.created.length, 1, 'only one network request');
  assert.strictEqual(h.Audio.created[0].loadCalls, 1);

  // A prefetch racing a tap on the same word must not duplicate the request either.
  h.Voice.speak('字');
  const raced = h.Voice._internals.load(p, '字');
  await settle(h);
  assert.ok(raced, 'the racing load must resolve to the same element');
  assert.strictEqual(h.Audio.created.filter((x) => x.src.includes('%E5%AD%97')).length, 1);
});

test('a prefetch and a tap that race on one word cost a single request', async () => {
  const h = loadEngine();
  h.Voice.prefetch(['母']);
  h.Voice.speak('母');
  await settle(h);
  assert.strictEqual(h.Audio.created.length, 1, 'prefetch and tap must share the clip');
  assert.strictEqual(h.Voice.stats.neural, 1);
  assert.ok(h.playing()[0], 'the clip is playing');
});

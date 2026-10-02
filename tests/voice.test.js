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
      // net.offline drives the failure path; otherwise report the clip ready.
      Promise.resolve().then(() => {
        if (net.hang) return; // neither event ever arrives
        if (net.offline) {
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
 */
function loadEngine(cfg = {}) {
  const html = fs.readFileSync(PAGE, 'utf8');
  const start = html.indexOf('/* ==== VOICE ENGINE START ====');
  const endMark = '/* ==== VOICE ENGINE END ==== */';
  const end = html.indexOf(endMark);
  assert.ok(start > -1 && end > start, 'VOICE ENGINE markers not found in qwen.html');
  const src = html.slice(start, end + endMark.length);

  const net = { offline: !!cfg.offline, blocked: !!cfg.blocked, hang: false };
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
  };
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
  assert.strictEqual(h.Voice.stats.local, 2, 'both attempts should have fallen back');

  h.Voice.speak('母');
  await settle(h);
  const net = h.Audio.created.filter((a) => a.src.startsWith('https://'));
  assert.strictEqual(net.length, 2, 'auto mode must stop hammering a dead endpoint');
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
  assert.strictEqual(h.Audio.created.length, 2);
  assert.ok(h.Audio.created[1].src.startsWith('https://'));
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

test('speaking text never outlives an interrupt (stale onend is swallowed)', async () => {
  const h = loadEngine();
  const fired = [];
  h.Voice.speak('父', { onend: () => fired.push('父') });
  await settle(h);
  h.Voice.speak('母', { interrupt: true, onend: () => fired.push('母') });
  await settle(h);
  h.Audio.created[0].finish(); // the superseded clip reports ending late
  await settle(h);
  assert.deepStrictEqual(fired, [], 'the superseded utterance reported completion');
  h.Audio.created[1].finish();
  await settle(h);
  assert.deepStrictEqual(fired, ['母'], 'the live utterance never completed');
});

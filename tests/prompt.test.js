'use strict';
/**
 * Tests for the inlined Prompt module inside qwen.html.
 *
 * The module ships inside the single-file page, so — as in faces.test.js and
 * praise.test.js — we slice it out between the PROMPT START/END markers and
 * evaluate it in a vm context. It touches no browser globals.
 *
 * What is actually being pinned here is wording, which unit tests are good at:
 * the instruction is the only thing telling a pre-reader what to do, and the
 * failure mode of getting it wrong (telling a child to find a bubble that
 * deliberately does not exist) is invisible in a screenshot.
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

function loadPrompt() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const start = html.indexOf('/* ==== PROMPT START ==== */');
  const endMark = '/* ==== PROMPT END ==== */';
  const end = html.indexOf(endMark);
  assert.ok(start > -1 && end > start, 'PROMPT markers not found in qwen.html');
  const src = html.slice(start, end + endMark.length);
  const ctx = vm.createContext({});
  vm.runInContext(src + '\nglobalThis.__prompt = Prompt;', ctx, { filename: 'qwen.html#prompt' });
  assert.ok(ctx.__prompt, 'Prompt was not defined by the extracted module');
  return ctx.__prompt;
}

const page = () => fs.readFileSync(PAGE, 'utf8');
const CJK = /[一-鿿]/;

/* ------------------------------------------------------------------ *
 * The templates
 * ------------------------------------------------------------------ */

test('the find template is the one gemini.html speaks', () => {
  // gemini.html:1105-1109  speakTargetPrompt() -> `请找到：${this.currentTarget}`
  assert.strictEqual(loadPrompt().FIND, '请找到：');
});

test('a char round speaks the task, not a bare character', () => {
  const P = loadPrompt();
  assert.strictEqual(P.say({ type: 'char', text: '人' }), '请找到：人');
  // A bare "人" is not an instruction. This is the whole point of the module.
  assert.ok(P.say({ type: 'char', text: '人' }).startsWith(P.FIND));
  assert.ok(P.say({ type: 'char', text: '人' }).length > 4);
});

test('a word round speaks the task too', () => {
  const P = loadPrompt();
  assert.strictEqual(P.say({ type: 'word', text: '太阳' }), '请找到：太阳');
});

test('a phrase round never says 请找到, because the target is not on screen', () => {
  const P = loadPrompt();
  const s = P.say({ type: 'phrase', a: '昔孟母', b: '择邻处' });
  assert.ok(!s.includes('请找到'), `a phrase round must not hunt for the spoken half: ${s}`);
  assert.ok(s.includes('下一句'), `the child has to be told the task is to continue: ${s}`);
  assert.ok(s.includes('昔孟母'), 'but the half they are given still has to be said aloud');
  assert.ok(!s.includes('择邻处'), 'the answer must not be read out before they tap it');
});

test('phrase prompts are audibly two clauses, so the neural voice pauses', () => {
  const P = loadPrompt();
  const s = P.say({ type: 'phrase', a: '父母呼' });
  assert.ok(s.startsWith(P.LISTEN), s);
  assert.ok(s.endsWith(P.NEXT), s);
  // The colon in 请找到： carries the pause on char rounds; the phrase template uses a
  // comma instead, so both must actually contain the punctuation they rely on.
  assert.match(P.FIND, /[：:]/);
  assert.match(P.NEXT, /[，,？?]/);
  assert.match(P.LISTEN, /[，,：:]/);
});

test('every instruction is short enough to stay one clip', () => {
  const P = loadPrompt();
  // CHUNK in the Voice engine is 90; the guidance to a five-year-old should be far below it.
  const samples = [
    { type: 'char', text: '人' },
    { type: 'word', text: '苹果' },
    { type: 'phrase', a: '幼不学' },
    { type: 'phrase', a: '能温席' },
  ];
  for (const rt of samples) {
    const s = P.say(rt);
    assert.ok(s.length <= 20, `too wordy to hold a child's attention (${s.length}): ${s}`);
    assert.ok(CJK.test(s), `must be spoken Chinese: ${s}`);
  }
});

/* ------------------------------------------------------------------ *
 * Hostile input
 * ------------------------------------------------------------------ */

test('say() returns an empty string rather than throwing on junk', () => {
  const P = loadPrompt();
  for (const rt of [
    null,
    undefined,
    {},
    { type: 'char' },
    { type: 'char', text: null },
    { type: 'char', text: '' },
    { type: 'char', text: '   ' },
    { type: 'phrase' },
    { type: 'phrase', a: null },
    { type: 'phrase', a: '' },
    { type: 'word', text: 0 },
  ]) {
    assert.strictEqual(P.say(rt), '', `expected silence for ${JSON.stringify(rt)}`);
  }
});

test('a newline in the target cannot poison the request URL', () => {
  // Voice.build() also folds newlines, but the prompt is assembled here and the neural
  // endpoints answer 4xx on one, so it must never leave this function.
  const P = loadPrompt();
  assert.ok(!/[\r\n]/.test(P.say({ type: 'char', text: '人\n口' })));
  assert.strictEqual(P.say({ type: 'char', text: ' 人 ' }), '请找到：人', 'targets are trimmed');
  assert.ok(!/[\r\n]/.test(P.say({ type: 'phrase', a: '父\n母呼' })));
});

test('an unknown round type falls back to the find wording rather than silence', () => {
  const P = loadPrompt();
  assert.strictEqual(P.say({ type: 'mystery', text: '天' }), '请找到：天');
});

/* ------------------------------------------------------------------ *
 * Wiring — string level, because speakTarget needs a DOM
 * ------------------------------------------------------------------ */

test('speakTarget speaks the instruction, not the raw target', () => {
  const src = page();
  const fn = src.slice(src.indexOf('function speakTarget('), src.indexOf('function setSpeaking('));
  assert.ok(/Prompt\.say\(G&&G\.rt\)/.test(fn), 'speakTarget must go through Prompt.say');
  assert.ok(!/rt\.a:rt\.text/.test(fn), 'the old bare-target read-aloud is gone');
  // Silence must stay silent: an empty instruction must not poke the speaker button on.
  assert.ok(/if\(!txt\)return false;/.test(fn), 'a junk round target must not speak or pulse');
  // sayNow owns the pulse now, so the bail must come before it rather than before a
  // setSpeaking(true) that no longer lives in this function.
  assert.ok(
    fn.indexOf('if(!txt)return false;') < fn.indexOf('return sayNow(txt);'),
    'bail before the speaker starts pulsing',
  );
});

test('both entry points into speakTarget get the instruction', () => {
  const src = page();
  // once when the round unlocks, once when the child taps the speaker
  const round = src.slice(src.indexOf('function nextRound('), src.indexOf('function speakTarget('));
  assert.ok(/speakTarget\(\)/.test(round), 'the round still reads its task aloud');
  const btn = src.match(/#btnSpeak'\)\.onclick=[^\n]*/);
  assert.ok(btn && /speakTarget\(\)/.test(btn[0]), 'the 🔊 button replays the whole instruction');
});

test('the hint keeps speaking the bare target — it is a hint, not a task', () => {
  const src = page();
  const hint = src.slice(src.indexOf("$('#btnHint').onclick="), src.indexOf('function tapBubble('));
  assert.ok(hint.length, 'btnHint handler not found');
  assert.ok(!hint.includes('Prompt.say'), 'a hint prefixed with 请找到 teaches the wrong lesson');
  assert.ok(/sayNow\(rt\.text\)/.test(hint), 'the character itself is still read aloud');
});

/* ------------------------------------------------------------------ *
 * prefetchLevel, executed for real
 * ------------------------------------------------------------------ */

function loadPrefetchLevel() {
  const src = page();
  const start = src.indexOf('function prefetchLevel(cfg)');
  assert.ok(start > -1, 'prefetchLevel not found');
  const end = src.indexOf('\n}\n', start);
  const code = src.slice(start, end + 2);
  const calls = [];
  const timers = [];
  const prompt = loadPrompt();
  const ctx = vm.createContext({
    window: { requestIdleCallback: null },
    Praise: { SPOKEN: ['对啦'] },
    Prompt: prompt,
    G: null,
    Voice: { engine: 'auto', prefetch: (items) => calls.push(Array.from(items)) },
    setTimeout: (fn) => timers.push(fn),
    __calls: calls,
    __run: () => timers.forEach((fn) => fn()),
  });
  vm.runInContext(code + '\nglobalThis.__prefetchLevel = prefetchLevel;', ctx);
  assert.ok(ctx.__prefetchLevel, 'prefetchLevel was not defined by the extracted function');
  return ctx;
}

test('this round\'s instruction is warmed, so the first prompt is not a network stall', () => {
  const ctx = loadPrefetchLevel();
  ctx.G = { rt: { type: 'char', text: '人' } };
  ctx.__prefetchLevel({ id: 1, type: 'char', pool: ['人', '口', '手'] });
  ctx.__run();
  assert.deepStrictEqual(
    ctx.__calls[0],
    ['人', '口', '手', '对啦', '请找到：人'],
    'the instruction rides along with the vocabulary and the praise',
  );
});

test('a phrase level warms the instruction for the half it actually reads out', () => {
  const ctx = loadPrefetchLevel();
  ctx.G = { rt: { type: 'phrase', a: '昔孟母', apy: 'xī mèng mǔ', b: '择邻处', bpy: 'zé lín chǔ' } };
  ctx.__prefetchLevel({
    id: 10,
    type: 'phrase',
    pool: [['昔孟母', 'xī mèng mǔ', '择邻处', 'zé lín chǔ']],
  });
  ctx.__run();
  const warm = ctx.__calls[0];
  assert.ok(warm.includes('请听好，昔孟母，下一句是什么？'), 'the spoken task is cached up front');
  // The answer half IS warmed on purpose (tapBubble speaks it on a correct tap) — what must
  // never happen is the *instruction* giving it away before the child has found it.
  assert.ok(warm.includes('择邻处'), 'the tapped answer is still warmed for its own playback');
  assert.ok(!warm.some((s) => s.startsWith('请') && s.includes('择邻处')), 'the answer is pre-announced');
  assert.ok(!warm.some((s) => /[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/.test(s)), 'no Latin pinyin is spoken');
});

test('no round target yet means no stray entry in the warm list', () => {
  const ctx = loadPrefetchLevel();
  ctx.G = null;
  ctx.__prefetchLevel({ id: 1, type: 'char', pool: ['人'] });
  ctx.__run();
  assert.deepStrictEqual(ctx.__calls[0], ['人', '对啦']);
});

test('the instruction still warms nothing when the OS voice is chosen', () => {
  const ctx = loadPrefetchLevel();
  ctx.Voice.engine = 'local';
  ctx.G = { rt: { type: 'char', text: '人' } };
  ctx.__prefetchLevel({ id: 1, type: 'char', pool: ['人'] });
  ctx.__run();
  assert.deepStrictEqual(ctx.__calls, []);
});

/* ------------------------------------------------------------------ *
 * Every real target in the game produces a usable instruction
 * ------------------------------------------------------------------ */

test('every level in the table yields an instruction for each of its targets', () => {
  const src = page();
  // The pools and the level table are one lexical unit; take both or neither.
  const start = src.indexOf('const A=s=>Array.from(s);');
  const end = src.indexOf('\n];', src.indexOf('const LEVELS=[')) + 3;
  assert.ok(start > -1 && end > start + 3, 'could not slice the data block');
  const P = loadPrompt();
  const ctx = vm.createContext({});
  vm.runInContext(src.slice(start, end), ctx, { filename: 'qwen.html#data' });
  const levels = vm.runInContext('LEVELS', ctx);
  assert.ok(levels.length >= 12, 'the level table looks truncated');
  let checked = 0;
  for (const L of levels) {
    const targets =
      L.type === 'phrase' ? L.pool.map((p) => ({ type: 'phrase', a: p[0], b: p[2] })) : L.pool.map((t) => ({ type: L.type, text: t }));
    assert.ok(targets.length, `level ${L.id} has no vocabulary`);
    for (const rt of targets) {
      const s = P.say(rt);
      assert.ok(s && CJK.test(s), `level ${L.id} target produced no instruction`);
      assert.ok(!/[,，]xī|[a-z]{3,}/.test(s), `level ${L.id} leaked a latin pinyin: ${s}`);
      if (L.type === 'phrase') assert.ok(!s.includes('请找到'), `level ${L.id}: ${s}`);
      checked++;
    }
  }
  assert.ok(checked > 100, 'expected the whole vocabulary to be covered, got ' + checked);
});
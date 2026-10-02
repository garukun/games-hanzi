'use strict';
/**
 * Tests for the inlined Learned module inside qwen.html, plus its wiring.
 *
 * Learned is the port of gemini.html's victory card, which named the word it had
 * just asked for (`你学会了“${this.currentTarget}”！`). gemini asks one target per
 * level so one word is all it could show; qwen plays `rounds` targets per level,
 * so the port is the whole list — and, because qwen counts mistakes per bubble
 * rather than per level, a second list of the words they never got right.
 *
 * The module is pure data, so it is sliced out between the LEARNED START/END
 * markers and executed in a vm for real; the DOM-facing half is pinned by string.
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

const START = '/* ==== LEARNED START ==== */';
const END = '/* ==== LEARNED END ==== */';

function loadLearned() {
  const html = page();
  const start = html.indexOf(START);
  const end = html.indexOf(END);
  assert.ok(start > -1 && end > start, 'LEARNED markers not found in qwen.html');
  const src = html.slice(start, end + END.length);
  const ctx = vm.createContext({});
  vm.runInContext(src + '\nglobalThis.__learned = Learned;', ctx, { filename: 'qwen.html#learned' });
  assert.ok(ctx.__learned, 'Learned was not defined by the extracted module');
  return ctx.__learned;
}

/** Fresh module + a pristine sandbox per test, so no test can see another's rows. */
function fresh() {
  const L = loadLearned();
  L.reset();
  return L;
}

const words = (L) => Array.from(L.words(), (r) => r.word);
const again = (L) => Array.from(L.struggled(), (r) => r.word);

/* ------------------------------------------------------------------ *
 * The core promise: a hit is recorded and shows up
 * ------------------------------------------------------------------ */

test('a correct tap records the round target', () => {
  const L = fresh();
  L.hit({ type: 'char', text: '人', py: 'rén' });
  assert.deepStrictEqual(words(L), ['人']);
  assert.strictEqual(L.words()[0].py, 'rén');
  assert.strictEqual(L.words()[0].hits, 1);
});

test('a word round records the whole word, not one of its characters', () => {
  const L = fresh();
  L.hit({ type: 'word', text: '太阳', py: 'tài yáng' });
  assert.deepStrictEqual(words(L), ['太阳']);
});

test('a phrase round is recorded as the couplet they completed', () => {
  const L = fresh();
  L.hit({ type: 'phrase', a: '昔孟母', apy: 'xī mèng mǔ', b: '择邻处', bpy: 'zé lín chǔ' });
  const [r] = L.words();
  // Recording only 择邻处 would be a lie: the answer half is on the board, the taught
  // unit is the pairing, and 昔孟母 ➜ 择邻处 is what the child actually practised.
  assert.strictEqual(r.word, '昔孟母择邻处');
  assert.strictEqual(r.py, 'xī mèng mǔ → zé lín chǔ');
});

test('both halves of a two-target level are listed, in the order they were found', () => {
  const L = fresh();
  L.hit({ type: 'word', text: '哥哥', py: 'gē ge' });
  L.hit({ type: 'word', text: '弟弟', py: 'dì di' });
  L.hit({ type: 'word', text: '妹妹', py: 'mèi mei' });
  assert.deepStrictEqual(words(L), ['哥哥', '弟弟', '妹妹']);
});

test('the same word found twice counts once in the list', () => {
  const L = fresh();
  L.hit({ type: 'char', text: '山', py: 'shān' });
  L.hit({ type: 'char', text: '山', py: 'shān' });
  L.hit({ type: 'char', text: '水', py: 'shuǐ' });
  assert.deepStrictEqual(words(L), ['山', '水']);
  assert.strictEqual(L.words()[0].hits, 2, 'but the tally is remembered');
});

test('level 6 and 7 tap two targets per round, so one round can contribute two words', () => {
  const L = fresh();
  // These are the only levels with correct:2 — a tap-driven recorder that only looked at
  // roundWin() would report four words on a six-round level instead of eight.
  const rt = { type: 'word', text: '太阳', py: 'tài yáng' };
  L.hit(rt);
  L.hit({ type: 'word', text: '月亮', py: 'yuè liang' });
  assert.deepStrictEqual(words(L), ['太阳', '月亮']);
});

/* ------------------------------------------------------------------ *
 * The 再练 list
 * ------------------------------------------------------------------ */

test('a bubble they tapped but never got right is offered back as homework', () => {
  const L = fresh();
  L.missed('人', 'rén');
  assert.deepStrictEqual(words(L), [], 'a miss is not a success');
  assert.deepStrictEqual(again(L), ['人']);
  assert.strictEqual(L.struggled()[0].missed, 1);
});

test('a word they got right once is not also told to practise', () => {
  const L = fresh();
  L.hit({ type: 'char', text: '人', py: 'rén' });
  L.missed('人', 'rén');
  assert.deepStrictEqual(words(L), ['人']);
  assert.deepStrictEqual(again(L), [], 'one success is enough to move it out of the drill list');
});

test('missing the same bubble three times still lists it once', () => {
  const L = fresh();
  L.missed('入', 'rù');
  L.missed('入', 'rù');
  L.missed('入', 'rù');
  assert.deepStrictEqual(again(L), ['入']);
  assert.strictEqual(L.struggled()[0].missed, 3);
});

test('the 形近字 case: the wrong bubble is a lookalike, and both get reported', () => {
  const L = fresh();
  L.missed('未', 'wèi');
  L.hit({ type: 'char', text: '末', py: 'mò' });
  assert.deepStrictEqual(words(L), ['末']);
  assert.deepStrictEqual(again(L), ['未']);
});

test('reset() drops everything, so a replay never shows the previous run', () => {
  const L = fresh();
  L.hit({ type: 'char', text: '山', py: 'shān' });
  L.missed('水', 'shuǐ');
  assert.strictEqual(L.count(), 2);
  L.reset();
  assert.strictEqual(L.count(), 0);
  assert.deepStrictEqual(words(L), []);
  assert.deepStrictEqual(again(L), []);
});

/* ------------------------------------------------------------------ *
 * Hostile input — this renders into a fixed-size card and is persisted
 * ------------------------------------------------------------------ */

test('junk round targets are ignored rather than rendered', () => {
  const L = fresh();
  for (const rt of [null, undefined, {}, { type: 'char' }, { type: 'char', text: '' }, { type: 'char', text: null }, { type: 'word', text: 0 }]) {
    assert.strictEqual(L.hit(rt), null, `expected no row for ${JSON.stringify(rt)}`);
  }
  for (const w of [null, undefined, '', '   ', 0, {}, []]) {
    assert.strictEqual(L.missed(w, ''), null, `expected no row for ${JSON.stringify(w)}`);
  }
  assert.strictEqual(L.count(), 0);
});

test('a partially-broken phrase row never produces half a couplet', () => {
  const L = fresh();
  L.hit({ type: 'phrase', a: '昔孟母' });
  assert.strictEqual(L.hit({ type: 'phrase', a: '昔孟母' }), null, 'no b half means nothing to teach');
  assert.strictEqual(L.count(), 0);
});

test('newlines and runaway lengths cannot break the clear card', () => {
  const L = fresh();
  L.hit({ type: 'char', text: '山\n\n川', py: 'shān\nchuān' });
  L.missed('水'.repeat(400), 'x'.repeat(400));
  for (const r of L.words().concat(L.struggled())) {
    assert.ok(!/[\r\n]/.test(r.word), `word kept a newline: ${JSON.stringify(r.word)}`);
    assert.ok(!/[\r\n]/.test(r.py), `pinyin kept a newline: ${JSON.stringify(r.py)}`);
    assert.ok(r.word.length <= L.MAX_WORD, `word too wide for a chip: ${r.word.length}`);
    assert.ok(r.py.length <= L.MAX_PY, `pinyin too wide for a chip: ${r.py.length}`);
  }
});

test('whitespace variants of one word do not become two chips', () => {
  const L = fresh();
  L.hit({ type: 'char', text: ' 人 ', py: 'rén' });
  L.hit({ type: 'char', text: '人', py: 'rén' });
  assert.deepStrictEqual(words(L), ['人']);
});

test('the list is capped, so a tap-happy child cannot overflow the card', () => {
  const L = fresh();
  for (let i = 0; i < 200; i++) L.missed('字' + i, 'zì' + i);
  assert.strictEqual(L.count(), L.MAX);
  // New words are refused, not the list evicted — the first things they met stay on screen.
  assert.strictEqual(again(L)[0], '字0');
  // ...but a word already on the list still tallies.
  L.missed('字0', 'zì0');
  assert.strictEqual(L.struggled()[0].missed, 2);
  assert.strictEqual(L.count(), L.MAX);
});

test('a later hit fills in the pinyin a miss could not know', () => {
  const L = fresh();
  // pyOf() has no entry for a phrase half, so a wrong tap on a phrase bubble records no
  // reading. If the same text later turns up as a target, the reading is worth keeping.
  L.missed('择邻处', '');
  L.hit({ type: 'char', text: '择邻处', py: 'zé lín chǔ' });
  assert.strictEqual(L.words()[0].py, 'zé lín chǔ');
  assert.strictEqual(L.count(), 1, 'the miss and the hit are the same word, so one chip');
  assert.strictEqual(L.words()[0].missed, 1, 'the miss is still remembered on the row');
});

test('the returned rows are frozen copies, so a stray caller cannot corrupt the tally', () => {
  const L = fresh();
  L.hit({ type: 'char', text: '山', py: 'shān' });
  const r = L.words()[0];
  assert.ok(Object.isFrozen(r));
  assert.throws(() => { 'use strict'; r.hits = 99; }, TypeError);
  assert.strictEqual(L.words()[0].hits, 1);
});

/* ------------------------------------------------------------------ *
 * Wiring — string level, because levelClear and fillChips need a DOM
 * ------------------------------------------------------------------ */

test('a correct tap records the target and a wrong tap records the bubble', () => {
  const src = page();
  const fn = src.slice(src.indexOf('function tapBubble('), src.indexOf('function showCombo('));
  assert.ok(fn.length, 'tapBubble not found');
  assert.match(fn, /Learned\.hit\(G\.rt\)/, 'a correct tap must record the round target');
  assert.match(fn, /Learned\.missed\(b\.text/, 'a wrong tap must record the bubble they read');
  // Both must sit in the right branch: a hit recorded in the miss branch would report
  // 学会 for a bubble the child got wrong.
  assert.ok(fn.indexOf('Learned.hit(G.rt)') < fn.indexOf('else if(!b.isTarget)'), 'hit is in the correct branch');
  assert.ok(fn.indexOf('Learned.missed') > fn.indexOf('else if(!b.isTarget)'), 'missed is in the wrong branch');
});

test('startLevel resets the list, so the card reports the level just played', () => {
  const src = page();
  const fn = src.slice(src.indexOf('function startLevel('), src.indexOf('function buildDots('));
  assert.match(fn, /Learned\.reset\(\)/);
  assert.ok(
    fn.indexOf('Learned.reset()') < fn.indexOf('nextRound()'),
    'reset before the first round can possibly score',
  );
});

test('the result card is rendered before it is shown', () => {
  const src = page();
  const fn = src.slice(src.indexOf('function levelClear('), src.indexOf('function fillChips('));
  assert.match(fn, /renderLearned\(\)/, 'levelClear must render the word list');
  assert.ok(
    fn.indexOf('renderLearned()') < fn.indexOf("ov.classList.add('show')"),
    'populated before the card appears, or the child sees an empty flash',
  );
});

test('the clear card can show both lists, and hides the header of an empty one', () => {
  const src = page();
  const fn = src.slice(src.indexOf('function renderLearned('), src.indexOf('function fillChips('));
  assert.match(fn, /Learned\.words\(\)/);
  assert.match(fn, /Learned\.struggled\(\)/);
  assert.ok(/#cLearnHead'\)\.hidden=!got\.length/.test(fn), 'no learned words → no "这一关学会了 0 个"');
  assert.ok(/#cMissHead'\)\.hidden=!bad\.length/.test(fn), 'no mistakes → no empty 再练 header');
  // Both grids must exist in the shipped markup, not just in this function.
  for (const id of ['cLearned', 'cLearnHead', 'cLearnN', 'cLearnGrid', 'cMissHead', 'cMissGrid']) {
    assert.ok(src.includes(`id="${id}"`), `#${id} is missing from the clear card`);
  }
});

test('a chip is a real button that reads the word out loud again', () => {
  const src = page();
  const fn = src.slice(src.indexOf('function fillChips('), src.indexOf('function step('));
  assert.ok(fn.length, 'fillChips not found');
  assert.match(fn, /createElement\('button'\)/, 'chips must be focusable buttons, not divs');
  assert.match(fn, /b\.type='button'/, 'and must not submit anything');
  assert.match(fn, /Voice\.speak\(r\.word/, 'tapping a chip re-speaks it — this is a revision card');
  assert.match(fn, /\{interrupt:true\}/, 'a second tap must replace the first, not queue behind it');
  assert.match(fn, /classList\.add\('speaking'\)/, 'and the chip has to show it is talking');
  assert.match(fn, /\.remove\('speaking'\)/, 'and stop showing it, or it stays stuck on');
  // The pinyin rides along so a pre-reader can self-check the tone.
  assert.match(fn, /r\.py/, 'a chip shows its pinyin when there is one');
});

/* ------------------------------------------------------------------ *
 * Store — progress that survives a reload, beyond stars
 * ------------------------------------------------------------------ */

function loadStore(persisted) {
  const src = page();
  const start = src.indexOf('const Store=(()=>{');
  const end = src.indexOf('\n})();', start) + 6;
  assert.ok(start > -1 && end > start, 'Store module not found');
  const saved = [];
  const ctx = vm.createContext({
    localStorage: {
      getItem: () => (persisted === undefined ? null : JSON.stringify(persisted)),
      setItem: (_k, v) => saved.push(v),
    },
    Pace: { DEFAULT: 'normal', TIERS: { slow: 1, normal: 2.8, fast: 5.5 } },
  });
  vm.runInContext(src.slice(start, end) + '\nglobalThis.__store = Store;', ctx, { filename: 'qwen.html#store' });
  assert.ok(ctx.__store, 'Store was not defined by the extracted module');
  ctx.__saved = saved;
  return ctx.__store;
}

test('words found are persisted, so progress outlasts a reload', () => {
  const S = loadStore();
  assert.strictEqual(S.knownCount(), 0);
  assert.strictEqual(S.markKnown(['人', '山', '水']), 3, 'three new words');
  assert.strictEqual(S.knownCount(), 3);
  assert.ok(S.known[0] === undefined, 'a numeric-looking word is not an array index');
  assert.ok(S.known.山 >= 1, '山 was stored');
});

test('a replay adds meaning instead of inflating the count', () => {
  const S = loadStore();
  S.markKnown(['人', '山']);
  assert.strictEqual(S.markKnown(['人']), 0, '人 was already known — no new word');
  assert.strictEqual(S.knownCount(), 2);
  assert.strictEqual(S.known.人, 2, 'but it was seen twice');
});

test('known survives a reload and a junk payload cannot break it', () => {
  const first = loadStore();
  first.markKnown(['山', '水']);
  const reloaded = loadStore({ known: { 山: 3, 水: 1 }, stars: {} });
  assert.strictEqual(reloaded.knownCount(), 2);

  for (const bad of [{ known: 'nope' }, { known: [] }, { known: null }, { known: 42 }]) {
    const S = loadStore(bad);
    assert.strictEqual(S.knownCount(), 0, `${JSON.stringify(bad)} must not become a broken tally`);
    S.markKnown(['山']);                       // and it must still be writable afterwards
    assert.strictEqual(S.knownCount(), 1);
  }
});

test('markKnown refuses junk instead of poisoning the vocabulary map', () => {
  const S = loadStore();
  assert.strictEqual(S.markKnown(null), 0);
  assert.strictEqual(S.markKnown('人'), 0, 'a bare string is not a list of words');
  S.markKnown(['人', '', '   ', null, 42, {}, '山']);
  assert.strictEqual(S.knownCount(), 2);
});

test('the level map shows how many words are known, not just stars', () => {
  const src = page();
  const fn = src.slice(src.indexOf('function renderMap('), src.indexOf('/* ==== FACES START'));
  assert.match(fn, /#totalWords/, 'the map must report vocabulary progress');
  assert.match(fn, /Store\.knownCount\(\)/);
  assert.ok(src.includes('id="totalWords"'), 'the chip is missing from the map header');
  // Stars alone cannot move: a child can clear level 1 twice without learning anything new.
  assert.ok(src.includes("'📖 '"), 'the vocabulary chip needs a label the child can read');
});

test('the learned words are marked known at clear time, not on every tap', () => {
  const src = page();
  const fn = src.slice(src.indexOf('function renderLearned('), src.indexOf('function fillChips('));
  assert.match(fn, /Store\.markKnown\(got\.map\(r=>r\.word\)\)/);
  // Only the 学会 list counts: a word the child never got right must not be recorded as learnt.
  assert.ok(!/markKnown\([^)]*bad/.test(fn), 'mistakes must not be counted as learned vocabulary');
});

/* ------------------------------------------------------------------ *
 * Every real target in the game produces a renderable row
 * ------------------------------------------------------------------ */

test('every level in the table yields a chip for each of its targets', () => {
  const src = page();
  const start = src.indexOf('const A=s=>Array.from(s);');
  const end = src.indexOf('\n];', src.indexOf('const LEVELS=[')) + 3;
  assert.ok(start > -1 && end > start + 3, 'could not slice the data block');
  const ctx = vm.createContext({});
  vm.runInContext(src.slice(start, end) + '\nglobalThis.__levels = LEVELS;', ctx, { filename: 'qwen.html#data' });
  const levels = ctx.__levels;
  assert.ok(levels.length >= 12, 'the level table looks truncated');

  const L = fresh();
  let checked = 0;
  for (const cfg of levels) {
    L.reset();
    for (const p of cfg.pool) {
      const rt = cfg.type === 'phrase'
        ? { type: 'phrase', a: p[0], apy: p[1], b: p[2], bpy: p[3] }
        : { type: cfg.type, text: p, py: '' };
      L.hit(rt);
      // Anything else on the board is a legal thing to tap by mistake.
      const other = cfg.type === 'phrase' ? cfg.pool.find((q) => q !== p)[2] : cfg.pool.find((q) => q !== p);
      L.missed(other, '');
    }
    assert.ok(L.words().length, `level ${cfg.id} recorded nothing`);
    for (const r of L.words().concat(L.struggled())) {
      assert.ok(/[一-鿿]/.test(r.word), `level ${cfg.id}: ${JSON.stringify(r.word)} is not text a chip can show`);
      assert.ok(r.word.length <= L.MAX_WORD, `level ${cfg.id} chip too wide: ${r.word}`);
      assert.ok(!/[<>"]/.test(r.word), `level ${cfg.id} chip would inject markup: ${r.word}`);
    }
    // A level's pool is bigger than MAX only in theory, but the card must never overflow.
    assert.ok(L.count() <= L.MAX, `level ${cfg.id} recorded ${L.count()} rows`);
    checked += cfg.pool.length;
  }
  assert.ok(checked > 150, 'expected the whole vocabulary to be covered, got ' + checked);
});

test('no real reading is ever clipped — a half syllable on a chip teaches a wrong tone', () => {
  // This is the failure that only the real data can find: a phrase reading like
  // `jiāng shàng táng → shēng bì yáng` is 32 characters, so a cap tuned on a hand-picked
  // sample (`xī mèng mǔ → zé lín chǔ`, 21) silently amputates it in the browser while every
  // unit test still passes.
  const src = page();
  const start = src.indexOf('const A=s=>Array.from(s);');
  const end = src.indexOf('\n];', src.indexOf('const LEVELS=[')) + 3;
  const ctx = vm.createContext({});
  vm.runInContext(src.slice(start, end) + '\nglobalThis.__levels = LEVELS;', ctx, { filename: 'qwen.html#data' });
  const levels = ctx.__levels;
  const L = fresh();
  let longest = 0;
  for (const cfg of levels) {
    // Only phrase levels carry a reading in the pool itself; char/word readings live in the
    // PY/WORDS tables, which tapBubble supplies and which the char-level browser pass covers.
    if (cfg.type !== 'phrase') continue;
    for (const p of cfg.pool) {
      L.reset();
      L.hit({ type: 'phrase', a: p[0], apy: p[1], b: p[2], bpy: p[3] });
      const [r] = L.words();
      assert.strictEqual(r.py, `${p[1]} → ${p[3]}`, `level ${cfg.id} clipped the reading of ${p[0]}`);
      assert.strictEqual(r.word, p[0] + p[2], `level ${cfg.id} clipped the couplet of ${p[0]}`);
      longest = Math.max(longest, r.py.length);
    }
  }
  assert.ok(longest >= 30, `expected the real data to include a long reading, longest was ${longest}`);
  assert.ok(longest <= L.MAX_PY, `MAX_PY (${L.MAX_PY}) is below the real data's longest reading (${longest})`);
});

test('the result card can never be clipped out of reach on a short phone', () => {
  // Measured in Chromium at 320x568 with a full level-12 card: the lists push the card past
  // the viewport, and the old `align-items:center` overlay clipped the *top* — the 过关啦 line
  // and the mascot became unreachable no matter how far you scrolled. margin:auto + internal
  // scroll is the fix, and it is invisible to any DOM-free test.
  const src = page();
  const overlay = src.match(/#clearOverlay\{[^}]*\}/)[0];
  assert.match(overlay, /overflow-y:auto/, 'the overlay must be scrollable');
  assert.ok(!/align-items:center/.test(overlay), 'a centred flex child is clipped when it overflows');
  const card = src.match(/\.clearCard\{[^}]*\}/)[0];
  assert.match(card, /margin:auto/, 'the card centres itself via auto margins, which is scroll-safe');
  assert.match(card, /max-height:100%/, 'and is bounded by the overlay it lives in');
  // A short phone also has to give the mascot and the stars back to the word lists.
  assert.match(src, /@media \(max-height:640px\)\{[\s\S]*?\.cMascot\{width:80px/, 'short-viewport compaction is present');
});

test('the module is self-contained: it reads nothing from the page at load time', () => {
  // A module that reached for $, G or Store while its IIFE runs would be a load-order bug
  // waiting to happen (see the Pace/Store incident); this pins that it touches none of them.
  const src = page();
  const start = src.indexOf(START);
  const end = src.indexOf(END);
  const body = src.slice(start, end);
  for (const foreign of ['$(', 'Store', 'Voice', 'G.', 'document', 'window', 'localStorage']) {
    assert.ok(!body.includes(foreign), `the Learned module must not reference ${foreign}`);
  }
});

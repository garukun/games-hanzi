'use strict';
/**
 * Tests for the inlined Praise module inside qwen.html.
 *
 * Same trick as tests/faces.test.js: the module ships inside the single-file
 * page, so we slice it out between the PRAISE START/END markers and evaluate it
 * in a vm context. It touches no browser globals, so no stubbing is needed.
 *
 * The integration half is string-level (as in faces.test.js) because the wiring
 * lives inside tapBubble(), which cannot run without a DOM — but the wiring is
 * exactly what could silently regress, so it is pinned here.
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

function loadPraise() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const start = html.indexOf('/* ==== PRAISE START ==== */');
  const endMark = '/* ==== PRAISE END ==== */';
  const end = html.indexOf(endMark);
  assert.ok(start > -1 && end > start, 'PRAISE markers not found in qwen.html');
  const src = html.slice(start, end + endMark.length);
  const ctx = vm.createContext({});
  // `const Praise = ...` is a lexical binding, so hand it back explicitly.
  vm.runInContext(src + '\nglobalThis.__praise = Praise;', ctx, { filename: 'qwen.html#praise' });
  assert.ok(ctx.__praise, 'Praise was not defined by the extracted module');
  // Hand back the module itself (not a copy) so a test can mutate the live roster;
  // every test calls loadPraise() afresh, so nothing leaks between them.
  return ctx.__praise;
}

const page = () => fs.readFileSync(PAGE, 'utf8');

/* ------------------------------------------------------------------ *
 * The roster
 * ------------------------------------------------------------------ */

test('the spoken roster is short, unique, child-sized Chinese', () => {
  const P = loadPraise();
  assert.ok(Array.isArray(P.SPOKEN) && P.SPOKEN.length >= 4, 'need several lines to rotate');
  assert.equal(new Set(P.SPOKEN).size, P.SPOKEN.length, 'lines must be unique');
  for (const line of P.SPOKEN) {
    assert.match(line, /^[一-鿿]+$/, `not plain CJK: ${line}`);
    assert.ok(line.length <= 4, `too long to be a snappy reward (${line.length}): ${line}`);
    assert.ok(!/[！!。，,.？?]/.test(line), `punctuation only adds a pause to the clip: ${line}`);
  }
});

test('every spoken line overlaps the toast vocabulary, so the two agree', () => {
  const src = page();
  const toast = src.slice(src.indexOf('const PRAISE='), src.indexOf('\n', src.indexOf('const PRAISE=')));
  const spoken = loadPraise().SPOKEN;
  for (const line of spoken) {
    assert.ok(
      toast.includes(line),
      `the silent toast says "${toast.trim()}" but the child only hears "${line}"`,
    );
  }
});

test('the six lines come from gemini.html (or better)', () => {
  const spoken = loadPraise().SPOKEN;
  // gemini.html: PRAISE_WORDS = 好棒呀！ 真聪明！ 答对啦！ 真厉害！ 太优秀了！ 真赞！
  const roots = spoken.map((s) => s.replace(/[^\u4e00-\u9fff]/g, ''));
  assert.ok(roots.includes('真棒'), 'gemini praise dropped');
  assert.ok(roots.includes('你真聪明'), 'gemini praise dropped');
  assert.ok(roots.includes('答对啦'), 'gemini praise dropped');
});

/* ------------------------------------------------------------------ *
 * Rotation
 * ------------------------------------------------------------------ */

test('the same line never fires twice in a row', () => {
  const P = loadPraise();
  let prev = null;
  for (let i = 0; i < 400; i++) {
    const line = P.spoken();
    assert.ok(P.SPOKEN.includes(line), 'spoken() must return a roster line: ' + line);
    assert.notStrictEqual(line, prev, 'praise repeated back to back');
    prev = line;
  }
});

test('the rotation is not secretly constant', () => {
  const P = loadPraise();
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(P.spoken());
  assert.ok(seen.size >= 2, 'every call returned the same line');
  assert.equal(seen.size, P.SPOKEN.length, 'every roster line should be reachable: ' + [...seen]);
});

test('spoken() survives a one-line roster instead of looping forever', () => {
  const P = loadPraise();
  P.SPOKEN.length = 0;
  P.SPOKEN.push('好棒');
  const a = P.spoken();
  const b = P.spoken();
  assert.strictEqual(a, '好棒');
  assert.strictEqual(b, '好棒', 'a degenerate roster must still return something');
});

/* ------------------------------------------------------------------ *
 * Wiring — string level, because tapBubble needs a DOM
 * ------------------------------------------------------------------ */

test('a correct tap speaks a praise behind the character, never over it', () => {
  const src = page();
  const tap = src.slice(src.indexOf('function tapBubble('), src.indexOf('function showCombo('));
  assert.ok(
    /Voice\.speak\(b\.text,\{interrupt:true\}\)/.test(tap),
    'the tapped character must still be spoken on its own',
  );
  assert.ok(
    /Voice\.speak\(Praise\.spoken\(\),\{interrupt:false\}\)/.test(tap),
    'the reward must be queued (interrupt:false) so the pronunciation is not cut off',
  );
  const iChar = tap.indexOf('Voice.speak(b.text');
  const iPraise = tap.indexOf('Praise.spoken()');
  assert.ok(iChar < iPraise, 'order matters: character first, then the reward');
});

test('the wrong-tap branch never speaks a praise', () => {
  const tap = page().slice(page().indexOf('function tapBubble('), page().indexOf('function showCombo('));
  const wrong = tap.slice(tap.indexOf('else if(!b.isTarget)'));
  assert.ok(!wrong.includes('Praise'), 'a wrong answer must not be congratulated');
  assert.ok(wrong.includes('pick(ENCO)'), 'the wrong tap keeps its own toast');
});

test('every correct tap is praised, including the one that closes the round', () => {
  const tap = page().slice(page().indexOf('function tapBubble('), page().indexOf('function showCombo('));
  const branch = tap.slice(tap.indexOf('if(b.isTarget&&!b.found)'));
  const praise = branch.indexOf('Praise.spoken()');
  const roundEnd = branch.indexOf('if(G.found>=G.need)roundWin()');
  assert.ok(praise > -1 && roundEnd > -1);
  assert.ok(
    praise < roundEnd,
    'the praise must be spoken before the round-end branch, so all levels get it',
  );
});

test('roundWin no longer stacks a second spoken line on top of the tap praise', () => {
  const win = page().slice(page().indexOf('function roundWin('), page().indexOf('function levelClear('));
  assert.ok(!/Voice\.speak/.test(win), 'one spoken reward per correct tap, not two');
  assert.ok(/cardReveal\(\)/.test(win), 'the reveal card still lands');
  assert.ok(/SFX\.sparkle\(\)/.test(win), 'and so does the sparkle');
});

test('the praise lines are prefetched, so the first reward is not a network stall', () => {
  const src = page();
  const pre = src.slice(src.indexOf('function prefetchLevel('), src.indexOf('/* ============ LEVEL MAP'));
  assert.ok(/for\(const p of Praise\.SPOKEN\)items\.push\(p\)/.test(pre), 'praise must join the warm list');
  assert.ok(
    pre.indexOf('Praise.SPOKEN') < pre.indexOf('Voice.prefetch('),
    'they have to be added before the prefetch call',
  );
});

test('prefetchLevel still bails out before warming when the OS voice is chosen', () => {
  const pre = page().slice(page().indexOf('function prefetchLevel('), page().indexOf('/* ============ LEVEL MAP'));
  assert.ok(/if\(Voice\.engine==='local'\)return;/.test(pre), 'no pointless requests in local mode');
  assert.ok(
    pre.indexOf("Voice.engine==='local'") < pre.indexOf('Voice.prefetch('),
    'the guard must come first',
  );
});

/* ------------------------------------------------------------------ *
 * prefetchLevel, executed for real: appending the praise lines must not
 * leak into the level's own vocabulary table (which doubles as the pool of
 * playable bubbles). A silent slice() typo here would put "真棒" in the game.
 * ------------------------------------------------------------------ */

function loadPrefetchLevel() {
  const src = page();
  const start = src.indexOf('function prefetchLevel(cfg)');
  assert.ok(start > -1, 'prefetchLevel not found');
  const end = src.indexOf('\n}\n', start);
  const code = src.slice(start, end + 2);
  const calls = [];
  const timers = [];
  const ctx = vm.createContext({
    window: { requestIdleCallback: null },
    Praise: { SPOKEN: ['对啦', '真棒'] },
    Voice: {
      engine: 'auto',
      prefetch: (items) => calls.push(Array.from(items)),
    },
    setTimeout: (fn) => timers.push(fn),
    LEVELS: null,
    __calls: calls,
    __run: () => timers.forEach((fn) => fn()),
  });
  vm.runInContext(code + '\nglobalThis.__prefetchLevel = prefetchLevel;', ctx);
  assert.ok(ctx.__prefetchLevel, 'prefetchLevel was not defined by the extracted function');
  return ctx;
}

test('prefetchLevel never mutates the level vocabulary it was handed', () => {
  const ctx = loadPrefetchLevel();
  const pool = ['人', '口', '手'];
  const cfg = { id: 1, type: 'char', pool };
  ctx.__prefetchLevel(cfg);
  ctx.__run();
  assert.deepStrictEqual(pool, ['人', '口', '手'], 'the pool doubles as the playable bubbles');
  assert.deepStrictEqual(ctx.__calls[0], ['人', '口', '手', '对啦', '真棒']);
});

test('prefetchLevel leaves a phrase level pool alone too', () => {
  const ctx = loadPrefetchLevel();
  const pool = [['父母呼', 'fù mǔ hū', '应勿缓', 'yìng wù huǎn']];
  ctx.__prefetchLevel({ id: 9, type: 'phrase', pool });
  ctx.__run();
  assert.strictEqual(pool.length, 1);
  assert.deepStrictEqual(ctx.__calls[0], ['父母呼', '应勿缓', '对啦', '真棒']);
});

test('prefetchLevel skips the warm-up entirely in local-voice mode', () => {
  const ctx = loadPrefetchLevel();
  ctx.Voice.engine = 'local';
  ctx.__prefetchLevel({ id: 1, type: 'char', pool: ['人'] });
  ctx.__run();
  assert.deepStrictEqual(ctx.__calls, [], 'no network request when the OS voice is chosen');
});
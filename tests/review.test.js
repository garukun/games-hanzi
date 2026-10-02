'use strict';
/**
 * Tests for the inlined Review module inside qwen.html — the fix for the dead end a child
 * hits once every level is 3-starred.
 *
 * ## Why this module exists
 *
 * qwen shipped `function continueId(){ for(const L of LEVELS){...} return 12; }`. The hard 12
 * was the "nothing left" answer: 开始 dropped a fully-mastered child back into level 12, over
 * and over, with a board they had already seen. gemini.html never hit this because it had no
 * persistence at all — once Store.stars exists, "what next?" is a question the game has to
 * answer, and "level 12" is not an answer.
 *
 * The answer here is a review level: an ordinary level config assembled from every level of
 * one type, re-shuffled each time, so it is playable by the existing makeTexts()/Prompt/
 * pyOf() paths with no new code anywhere else.
 *
 * The tests run the *shipped* module against the *real* tables. Hand-picked samples would
 * have missed the two things that actually matter — that the union pool is a legal level
 * pool for every type, and that every entry still has the metadata (pinyin, readings) that
 * the rest of the game looks up.
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

/** The shipped Review module, evaluated on its own. It touches no browser globals. */
function loadReview() {
  const html = page();
  const start = html.indexOf('/* ==== REVIEW START ==== */');
  const endMark = '/* ==== REVIEW END ==== */';
  const end = html.indexOf(endMark);
  assert.ok(start > -1 && end > start, 'REVIEW markers not found in qwen.html');
  const ctx = vm.createContext({});
  vm.runInContext(html.slice(start, end + endMark.length) + '\nglobalThis.__review = Review;', ctx, {
    filename: 'qwen.html#review',
  });
  assert.ok(ctx.__review, 'Review was not defined by the extracted module');
  return ctx.__review;
}

/**
 * The real vocabulary tables, the real LEVELS row list and the real pyOf(), sliced into a vm.
 * Every assertion below that talks about "the game that actually ships" runs on this.
 */
function loadData() {
  const src = page();
  const ctx = vm.createContext({});
  vm.runInContext(
    slice(src, 'const PY={', '/* ============ AUDIO SFX') +
      '\nglobalThis.__d = { PY, WORDS, LEVELS, pyOf };',
    ctx,
    { filename: 'qwen.html#data' },
  );
  assert.ok(ctx.__d && Array.isArray(ctx.__d.LEVELS), 'the data block did not load');
  return ctx.__d;
}

/** The page's own unlock rule, so nextId() is tested against the real gating. */
function unlockedFactory(stars) {
  return (id) => id === 1 || (stars[id - 1] || 0) >= 1;
}

/** A deterministic stand-in for Math.random, so "a fresh sample each time" is checkable. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* sRGB relative luminance + WCAG contrast, recomputed rather than trusted. */
function contrast(a, b) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Everything 3-starred except the ids named in `gaps` (which get the given star count). */
function starsWith(gaps = {}) {
  const { LEVELS } = loadData();
  const stars = {};
  for (const L of LEVELS) stars[L.id] = 3;
  for (const [id, n] of Object.entries(gaps)) stars[id] = n;
  return stars;
}

/* ------------------------------------------------------------------ *
 * The dead end
 * ------------------------------------------------------------------ */

test('continueId no longer answers "12" — it asks the review module', () => {
  const src = page();
  const fn = src.slice(src.indexOf('function continueId('), src.indexOf('function renderMap('));
  assert.match(fn, /Review\.nextId\(LEVELS,unlocked,Store\.stars\)/, 'continueId must delegate to Review');
  assert.ok(!/return 12;/.test(fn), 'the hard-coded level 12 dead end is still there');
});

test('a child with no stars starts at level 1, not the review', () => {
  const Review = loadReview();
  const { LEVELS } = loadData();
  assert.strictEqual(Review.nextId(LEVELS, unlockedFactory({}), {}), 1);
});

test('the review is offered exactly once there is nothing left to unlock', () => {
  const Review = loadReview();
  const { LEVELS } = loadData();
  const stars = {};
  // Walk the chain the way a child does: each clear unlocks the next level.
  for (const L of LEVELS) {
    stars[L.id] = 3;
    const nxt = Review.nextId(LEVELS, unlockedFactory(stars), stars);
    if (L.id < LEVELS.length) {
      assert.strictEqual(nxt, L.id + 1, `after clearing ${L.id} the next target should be ${L.id + 1}`);
    } else {
      assert.strictEqual(nxt, Review.ID, 'the 36th star is where the dead end used to be');
    }
  }
});

test('a level cleared with 2 stars is still "not done", so it stays the continue target', () => {
  const Review = loadReview();
  const { LEVELS } = loadData();
  const stars = {};
  for (const L of LEVELS) stars[L.id] = 3;
  stars[5] = 2;
  assert.strictEqual(Review.nextId(LEVELS, unlockedFactory(stars), stars), 5);
  // ...and one more star flips it back to the end of the list.
  stars[5] = 3;
  assert.strictEqual(Review.nextId(LEVELS, unlockedFactory(stars), stars), Review.ID);
});

test('an unreachable high level does not hide an unfinished low one', () => {
  const Review = loadReview();
  const { LEVELS } = loadData();
  // A hand-edited profile: level 12 has 3 stars but the chain before it does not.
  const stars = { 12: 3 };
  assert.strictEqual(Review.nextId(LEVELS, unlockedFactory(stars), stars), 1);
});

test('nextId returns a real level id for every hostile stars payload', () => {
  const Review = loadReview();
  const { LEVELS } = loadData();
  const ids = new Set(LEVELS.map((L) => L.id));
  for (const stars of [undefined, null, 'x', [], 0, {}, { 1: '3' }, { 1: NaN }, { 1: -4 }, { 99: 3 }]) {
    const id = Review.nextId(LEVELS, unlockedFactory({}), stars);
    assert.ok(ids.has(id) || id === Review.ID, 'nextId(' + JSON.stringify(stars) + ') = ' + id);
  }
});

test('complete() is a total function — no level table means "not complete", not a throw', () => {
  const Review = loadReview();
  const { LEVELS } = loadData();
  assert.strictEqual(Review.complete(LEVELS, starsWith()), true);
  assert.strictEqual(Review.complete(LEVELS, starsWith({ 9: 2 })), false, '2 stars is not complete');
  for (const [levels, stars] of [
    [undefined, undefined],
    [[], {}],
    [null, null],
    [LEVELS, undefined],
    [LEVELS, 'x'],
    [LEVELS, []],
  ]) {
    assert.strictEqual(Review.complete(levels, stars), false);
  }
});

test('the review id is one past the last level, so no map node can claim it', () => {
  const Review = loadReview();
  const { LEVELS } = loadData();
  assert.strictEqual(Review.ID, LEVELS.length + 1);
  assert.ok(!LEVELS.some((L) => L.id === Review.ID));
});

/* ------------------------------------------------------------------ *
 * The assembled pool — run against the real tables
 * ------------------------------------------------------------------ */

test('each type pools exactly the union of that type\'s levels, de-duplicated', () => {
  const Review = loadReview();
  const { LEVELS } = loadData();
  for (const type of Review.TYPES) {
    const got = Review.pool(LEVELS, type);
    const want = [];
    const seen = new Set();
    for (const L of LEVELS) {
      if (L.type !== type) continue;
      for (const it of L.pool) {
        const k = type === 'phrase' ? it[0] : it;
        if (seen.has(k)) continue;
        seen.add(k);
        want.push(it);
      }
    }
    assert.deepStrictEqual(Array.from(got), want, `${type} pool is not the union of its levels`);
    assert.strictEqual(new Set(want.map((x) => (type === 'phrase' ? x[0] : x))).size, want.length);
  }
});

test('the three review pools never leak into each other\'s shape', () => {
  const Review = loadReview();
  const { LEVELS } = loadData();
  // A mixed board would put 请找到：太阳 and 请听好：X，下一句是什么？ on the same round, and
  // makeTexts()/pyOf() both branch on a single cfg.type — so the shapes must stay separate.
  for (const c of Review.pool(LEVELS, 'char')) assert.strictEqual(c.length, 1);
  for (const w of Review.pool(LEVELS, 'word')) assert.strictEqual(w.length, 2);
  for (const p of Review.pool(LEVELS, 'phrase')) assert.strictEqual(p.length, 4);
});

test('every review target still has the metadata the game looks up', () => {
  const Review = loadReview();
  const { LEVELS, pyOf } = loadData();
  for (const c of Review.pool(LEVELS, 'char')) {
    assert.ok(pyOf('char', c), `no pinyin for ${c} — the prompt card and the reveal would go blank`);
  }
  for (const w of Review.pool(LEVELS, 'word')) {
    assert.ok(pyOf('word', w), `no pinyin for ${w}`);
  }
  for (const p of Review.pool(LEVELS, 'phrase')) {
    for (const [i, field] of p.entries()) {
      assert.ok(typeof field === 'string' && field.trim(), `phrase field ${i} is empty`);
    }
    assert.notStrictEqual(p[0], p[2], 'a couplet whose two halves are identical is a free tap');
  }
});

test('a review config is a legal level row for every type', () => {
  const Review = loadReview();
  const { LEVELS } = loadData();
  for (const type of Review.TYPES) {
    const c = Review.cfg(LEVELS, type, lcg(7));
    assert.strictEqual(c.id, Review.ID);
    assert.strictEqual(c.type, type);
    assert.strictEqual(c.correct, 1, 'the round logic assumes one target per tap');
    assert.strictEqual(c.review, true);
    assert.match(c.name, /总复习/);
    assert.ok(c.rounds >= 5, 'a review shorter than a real level is not a review');
    assert.ok(c.bubbles >= 4 && c.bubbles <= 12, `${type}: ${c.bubbles} bubbles is off the board`);
    assert.ok(
      c.pool.length >= c.bubbles + 1,
      `${type}: only ${c.pool.length} entries for a ${c.bubbles}-bubble board — ` +
        'makeTexts() slices cfg.bubbles-cfg.correct distractors out of the same pool',
    );
    assert.strictEqual(new Set(c.pool.map((x) => (type === 'phrase' ? x[0] : x))).size, c.pool.length);
  }
});

test('a review pool is never an alias of a level\'s own pool', () => {
  const Review = loadReview();
  const { LEVELS } = loadData();
  // cfg.pool *is* the playable bubble table. Handing back a level's own array would let any
  // later append — the prefetchLevel bug — make review words playable in that level.
  const owned = new Set(LEVELS.map((L) => L.pool));
  for (const type of Review.TYPES) {
    const c = Review.cfg(LEVELS, type, lcg(3));
    assert.ok(!owned.has(c.pool), `${type} review handed out a level's own pool array`);
  }
  const before = LEVELS.map((L) => L.pool.length);
  for (const type of Review.TYPES) Review.cfg(LEVELS, type, lcg(1));
  assert.deepStrictEqual(LEVELS.map((L) => L.pool.length), before, 'a level vocabulary changed size');
});

test('a char review keeps the hardest 形近字 rate any char level uses', () => {
  const Review = loadReview();
  const { LEVELS } = loadData();
  const hardest = Math.max(...LEVELS.filter((L) => L.type === 'char').map((L) => L.conf));
  assert.ok(hardest > 0, 'the char levels carry no confusable rate at all');
  assert.strictEqual(Review.cfg(LEVELS, 'char', lcg(2)).conf, hardest);
  // Words and couplets have no confusable sets, so they must not invent one.
  assert.strictEqual(Review.cfg(LEVELS, 'word', lcg(2)).conf, 0);
  assert.strictEqual(Review.cfg(LEVELS, 'phrase', lcg(2)).conf, 0);
});

test('every review type is a legal cfg.type for the real makeTexts()/Prompt branch', () => {
  const Review = loadReview();
  const src = page();
  const mk = slice(src, 'function makeTexts()', 'function radiusFor(');
  const pr = slice(src, '/* ==== PROMPT START ==== */', '/* ==== PROMPT END ==== */');
  for (const type of Review.TYPES) {
    assert.ok(mk.includes(`cfg.type==='phrase'`), 'makeTexts lost its phrase branch');
    assert.ok(pr.includes("rt.type==='phrase'"), 'Prompt lost its phrase branch');
    assert.ok(
      ['char', 'word', 'phrase'].includes(type),
      `${type} is not one of the types the round logic knows`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * The shuffle
 * ------------------------------------------------------------------ */

test('sample returns a permutation of its input, never a shorter or longer list', () => {
  const Review = loadReview();
  const list = ['a', 'b', 'c', 'd', 'e', 'f'];
  const got = Review.sample(list, 4, lcg(99));
  assert.strictEqual(got.length, 4);
  for (const x of got) assert.ok(list.includes(x), `${x} is not in the input`);
  assert.deepStrictEqual(Array.from(list), ['a', 'b', 'c', 'd', 'e', 'f'], 'the input was shuffled in place');
});

test('sample handles phrase rows without mangling them', () => {
  const Review = loadReview();
  const rows = [
    ['甲', 'jiǎ', '乙', 'yǐ'],
    ['丙', 'bǐng', '丁', 'dīng'],
    ['戊', 'wù', '己', 'jǐ'],
  ];
  const got = Review.sample(rows, 2, lcg(11));
  assert.strictEqual(got.length, 2);
  for (const row of got) assert.ok(rows.some((r) => r[0] === row[0] && r === row));
  assert.strictEqual(rows.length, 3);
});

test('two reviews of the same type are not the same drill', () => {
  const Review = loadReview();
  const { LEVELS } = loadData();
  const a = Review.cfg(LEVELS, 'char', lcg(1)).pool;
  const b = Review.cfg(LEVELS, 'char', lcg(2)).pool;
  assert.notDeepStrictEqual(Array.from(a), Array.from(b));
  // ...and every entry is still legal, which is what a reshuffle could break.
  assert.strictEqual(new Set([...a, ...b].map((x) => x)).size, new Set(a).size + new Set(b).size);
});

test('sample survives a hostile rng instead of writing undefined into the board', () => {
  const Review = loadReview();
  const list = ['a', 'b', 'c'];
  for (const rnd of [() => 1, () => NaN, () => -1, () => 1e9, () => 0.999999999, null, undefined, 42, {}]) {
    const got = Review.sample(list, 2, rnd);
    assert.strictEqual(got.length, 2, `rnd ${String(rnd)} changed the length`);
    for (const x of got) assert.ok(list.includes(x), `rnd ${String(rnd)} produced ${x}`);
  }
});

test('sample survives a hostile size and never returns an empty board', () => {
  const Review = loadReview();
  const list = ['a', 'b', 'c'];
  for (const n of [undefined, null, NaN, 0, -4, 1e9, '3', {}, Infinity]) {
    const got = Review.sample(list, n, lcg(4));
    assert.ok(got.length >= 1, `n=${String(n)} produced an empty board`);
    assert.ok(got.length <= list.length, `n=${String(n)} produced ${got.length} of ${list.length}`);
  }
  // An empty or missing source is not a crash, it is an empty board — the caller's problem.
  assert.deepStrictEqual(Array.from(Review.sample(undefined, 3, lcg(1))), []);
  assert.deepStrictEqual(Array.from(Review.sample([], 3, lcg(1))), []);
});

test('a hostile type falls back to a real one instead of building an unplayable level', () => {
  const Review = loadReview();
  const { LEVELS } = loadData();
  for (const type of [undefined, null, '', 'chars', 'klingon', 7, {}, ['char']]) {
    const c = Review.cfg(LEVELS, type, lcg(5));
    assert.ok(Review.TYPES.includes(c.type), `${String(type)} -> ${c.type}`);
    assert.ok(c.pool.length > 0, `${String(type)} built an empty board`);
  }
});

test('a hostile level table yields an empty pool rather than a throw', () => {
  const Review = loadReview();
  for (const levels of [undefined, null, [], [null, 42, { type: 'char' }], [{ type: 'char', pool: '人' }]]) {
    assert.ok(Array.isArray(Review.pool(levels, 'char')));
    const c = Review.cfg(levels, 'char', lcg(6));
    assert.ok(Array.isArray(c.pool));
    assert.strictEqual(c.id, Review.ID);
  }
  assert.strictEqual(Review.nextId(undefined, unlockedFactory({}), {}), Review.ID);
});

test('review type() only ever hands back a type the round logic knows', () => {
  const Review = loadReview();
  for (let i = 0; i < 40; i++) {
    assert.ok(Review.TYPES.includes(Review.type()));
  }
  assert.strictEqual(Review.TYPES.length, new Set(Review.TYPES).size, 'duplicate type in the roster');
});

/* ------------------------------------------------------------------ *
 * Wiring — string level, because these need the DOM
 * ------------------------------------------------------------------ */

test('startLevel builds a review config instead of looking it up in LEVELS', () => {
  const fn = slice(page(), 'function startLevel(id){', 'function buildDots()');
  assert.match(fn, /const rev=id===Review\.ID;/, 'startLevel does not know about the review');
  assert.match(fn, /Review\.cfg\(LEVELS,Review\.type\(\)\)/, 'the review config is never built');
  assert.match(fn, /LEVELS\.find\(L=>L\.id===id\)/, 'a normal level must still be looked up');
  // Review.cfg() can legitimately return nothing if the tables were emptied, so the null
  // guard is load-bearing: without it the page dies on `cfg.correct` instead of the map.
  assert.match(fn, /if\(!cfg\)\{ show\('scr-levels'\); renderMap\(\); return; \}/, 'no guard on an empty review');
});

test('the HUD drops the 第N关 lie for a review and keeps it for a level', () => {
  const src0 = page();
  const fn = slice(src0, 'function startLevel(id){', 'function buildDots()');
  assert.ok(fn.includes("$('#lvlNo').textContent=id"), 'the level number must still be written');
  assert.match(
    fn,
    /\$\('#lvlName'\)\.textContent=rev\?Review\.LABEL:' · '\+cfg\.name;/,
    'a review chip must not read " · 总复习" behind a 第13关 prefix',
  );
  // The kind is a separate node so the narrow-phone rule can drop it: "总复习 · 字" measures
  // 102px against a numbered level's 53px and wraps #hud to two rows at 320px.
  assert.match(fn, /\$\('#lvlKind'\)\.textContent=rev\?' · '\+Review\.KIND\[cfg\.type\]:'';/,
    'the review kind is not in its own node');
  assert.ok(src0.includes('class="lkind" id="lvlKind"'), 'there is no node for the kind');
  assert.match(fn, /\$\('#lvlChip'\)\.classList\.toggle\('review',rev\)/, 'the chip is not flagged as a review');
});

test('the 第/关 literals are spans, so CSS can hide them for a review', () => {
  const src = page();
  const chip = slice(src, '<span class="lvlChip" id="lvlChip">', '</span></span>');
  // Classes, not ids: `hidden` needs to be selectable, and a selector written against a class
  // the element does not carry matches nothing at all — a rule that reads correct and hides
  // nothing, which is exactly what the first browser pass caught.
  for (const c of ['lvlPre', 'lvlNo', 'lvlPost']) {
    assert.ok(chip.includes(`class="${c}"`), `${c} has no class to select on`);
  }
  assert.ok(
    /\.lvlChip\.review \.lvlPre,\.lvlChip\.review \.lvlNo,\.lvlChip\.review \.lvlPost\{display:none;\}/.test(src),
    'the review chip still renders a level number',
  );
  // The review name has to survive the narrow-phone rule that hides a level's name.
  assert.ok(/\.lvlChip\.review \.lname\{display:inline;\}/.test(src), 'a review is unidentifiable on a 320px screen');
  const narrow = slice(src, '#hud{gap:5px;}', '\n}');
  const at = src.indexOf('#hud{gap:5px;}');
  // Read the breakpoint out of the source rather than pinning it: it is a measured pixel count
  // (see tests/score.test.js) and has already moved once from 375 to 409.
  assert.match(src.slice(Math.max(0, at - 40), at), /@media \(max-width:\d+px\)\{\s*$/, 'the adaptation lost its breakpoint');
  assert.ok(/\.lvlChip \.lkind\{display:none;\}/.test(narrow), 'the review kind still wraps the HUD at 320px');
});

test('levelClear celebrates a review and offers no "next level"', () => {
  const fn = slice(page(), 'function levelClear(){', '/* The port of gemini.html');
  assert.match(fn, /const rev=G\.cfg\.id===Review\.ID;/, 'levelClear does not know about the review');
  assert.ok(fn.includes("$('#cTitle').textContent=rev?'复习完成！🎯':"), 'the clear card still says 过关啦');
  // An exact `includes`, not a regex: the first version of this assertion was a regex whose
  // trailing alternation matched the first quote in the function and therefore passed no matter
  // what levelClear did. The mutation pass caught it; a bare substring cannot.
  assert.ok(
    fn.includes("$('#btnNext').style.display=(last||rev)?'none':'flex';"),
    '下一关 is still offered after a review',
  );
  // ...but the review's own record still banks, so beating it is announced like a level's.
  assert.ok(fn.indexOf('Store.setBest(') < fn.indexOf("$('#cScore')"), 'the record must be banked before it is read');
});

test('the map footer appears exactly when there is nothing left to unlock', () => {
  const fn = slice(page(), 'function renderMap(){', '/* ==== FACES START');
  assert.match(fn, /\$\('#mapFoot'\)\.hidden=!Review\.complete\(LEVELS,Store\.stars\);/, 'the footer is not gated on complete()');
});

test('the footer cannot be un-hidden by its own layout rule', () => {
  const src = page();
  const foot = slice(src, '.mapFoot{flex:0 0 auto', '\n');
  // `hidden` is a UA `display:none` at specificity (0,1,0); an author rule for this selector
  // at the same weight would beat it and the button would show on a fresh profile.
  assert.ok(!/display:/.test(foot), `the footer declares display, so [hidden] loses: ${foot}`);
  assert.ok(src.includes('<div class="mapFoot" id="mapFoot" hidden>'), 'the footer starts hidden');
  assert.ok(src.includes('id="btnReview"'), 'there is no review button');
});

test('a short screen trims the footer instead of clipping the map', () => {
  const src = page();
  const block = slice(src, '@media (max-height:640px){', '\n}');
  // Measured at 320x568: the map needs 411px and a full-size 90px footer leaves it 404, so the
  // last chapter's 得分 record was cut off. The compact block gives those 7px back.
  assert.ok(/\.mapFoot \.btn3d\{[^}]*padding:7px 14px;[^}]*font-size:17px;/.test(block), block);
  assert.ok(/\.mapFootNote\{[^}]*font-size:11px;/.test(block), block);
});

test('the footer note is legible on the green hill it actually lands on', () => {
  const src = page();
  const rule = slice(src, '.mapFootNote{margin:6px', '\n}');
  assert.match(rule, /color:var\(--ink\)/, 'the note must not use --ink2 on the hill');
  // Recomputed rather than trusted: --ink2 is 2.19:1 on --hill2 and 2.95:1 on --hill1, both
  // under the 4.5:1 a line of 11-12px text needs. --ink clears 4.5:1 on both stops.
  for (const [ink, hill] of [
    ['#2b3a55', '#8fd07e'],
    ['#2b3a55', '#62b857'],
  ]) {
    assert.ok(contrast(ink, hill) >= 4.5, `${ink} on ${hill} is ${contrast(ink, hill).toFixed(2)}:1`);
  }
  assert.ok(contrast('#5a6b88', '#62b857') < 4.5, 'the failing baseline changed — re-audit this rule');
});

test('both entry points into a review exist and are reachable from a tap', () => {
  const src = page();
  assert.match(
    src,
    /\$\('#btnReview'\)\.onclick=\(\)=>\{[^}]*startLevel\(Review\.ID\); \}/,
    'the footer button does not start a review',
  );
  // 开始 speaks what it is about to do, so the button stops silently meaning level 12.
  const nav = slice(src, '/* ============ NAV ============ */', '/* ============ RESIZE');
  assert.match(nav, /Voice\.speak\(nid===Review\.ID\?'复习开始啦':'开始啦'\)/, 'the title screen still promises 开始啦');
  assert.match(nav, /startLevel\(nid\)/, '开始 must start whatever continueId resolved to');
});

/* ------------------------------------------------------------------ *
 * prefetchLevel, executed for real against a review config — the
 * iteration-3 bug class (a prefetch that appends to cfg.pool turns
 * warm-up strings into playable bubbles).
 * ------------------------------------------------------------------ */

function loadPrefetchLevel() {
  const src = page();
  const start = src.indexOf('function prefetchLevel(cfg)');
  assert.ok(start > -1, 'prefetchLevel not found');
  const code = src.slice(start, src.indexOf('\n}\n', start) + 2);
  const calls = [];
  const timers = [];
  const ctx = vm.createContext({
    window: { requestIdleCallback: null },
    Praise: { SPOKEN: ['对啦', '真棒'] },
    Prompt: { say: () => '' },
    G: null,
    Voice: { engine: 'auto', prefetch: (items) => calls.push(Array.from(items)) },
    setTimeout: (fn) => timers.push(fn),
  });
  vm.runInContext(code + '\nglobalThis.__pf = prefetchLevel;', ctx);
  return {
    run(cfg) {
      const before = JSON.parse(JSON.stringify(cfg.pool));
      ctx.__pf(cfg);
      timers.splice(0).forEach((f) => f());
      return {
        warmed: calls.map((c) => Array.from(c)),
        pool: JSON.parse(JSON.stringify(cfg.pool)),
        before,
      };
    },
  };
}

test('warming a review config changes neither its pool nor its length', () => {
  const Review = loadReview();
  const { LEVELS } = loadData();
  for (const type of Review.TYPES) {
    const r = loadPrefetchLevel().run(Review.cfg(LEVELS, type, lcg(8)));
    assert.strictEqual(r.warmed.length, 1, `${type}: the warm list never ran`);
    assert.deepStrictEqual(r.pool, r.before, `${type}: the review pool was mutated`);
    // The vocabulary is warmed in full — that is what made the learned-word chips free.
    // A phrase row is warmed as its two spoken halves, never as the row or its Latin pinyin.
    for (const item of r.before) {
      for (const s of type === 'phrase' ? [item[0], item[2]] : [item]) {
        assert.ok(r.warmed[0].includes(s), `${type}: ${JSON.stringify(s)} was not warmed`);
      }
    }
  }
});

/* ------------------------------------------------------------------ *
 * Load order
 * ------------------------------------------------------------------ */

test('Review is declared before the boot-time renderMap() that calls it', () => {
  const src = page();
  const rev = src.indexOf('const Review=(()=>{');
  const boot = src.lastIndexOf('\nrenderMap();');
  assert.ok(rev > -1, 'the Review module is missing');
  assert.ok(rev < boot, 'renderMap() runs on boot and dereferences Review');
  // It must also sit after the LEVELS table it is built from.
  assert.ok(src.indexOf('const LEVELS=[') < rev);
});

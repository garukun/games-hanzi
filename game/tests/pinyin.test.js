'use strict';
/**
 * Tests for the inlined Pinyin module inside qwen.html, and for the readings it guards.
 *
 * Same trick as tests/voice.test.js, tests/faces.test.js and tests/pin.test.js's siblings: the
 * module ships inside the single-file page, so it is sliced out between the PINYIN
 * START/END markers and evaluated in a vm. The tables it reads are sliced out with it, so
 * every assertion about "the readings that ship" runs against the real 94 characters, 52 words
 * and 92 couplet halves rather than hand-picked samples.
 *
 * ## Why this exists
 *
 * WORDS.勇敢 read "yǒng gn" — a dropped ǎ and a dropped syllable. That string is what the 💡
 * hint line, the round reveal and the result-card chip all printed to a child who had just
 * tapped the right bubble. Nothing caught it:
 *
 *   · `pyOf()` hands back whatever the table holds, and "" is a legal reading as far as it
 *     knows, so it cannot report the problem.
 *   · tests/review.test.js walks every pool and asserts a reading *exists* — a well-formed
 *     one is a different question, and that was the only pinyin check in the repo.
 *   · Every other suite in tests/ exercises logic, not data.
 *
 * So the rules live in the page next to the data and run over it at load, and this file
 * executes those same rules over those same tables.
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

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ');
}
function slice(src, a, b) {
  const i = src.indexOf(a);
  const j = src.indexOf(b, i);
  assert.ok(i > -1 && j > i, `could not slice ${a} .. ${b}`);
  return src.slice(i, j);
}

/** The module plus the three tables it audits, in a vm, with no DOM involved. */
function load(opts) {
  opts = opts || {};
  const html = page();
  const code =
    slice(html, 'const PY={', '/* ============ PINYIN') +
    slice(html, '/* PINYIN START */', '/* ============ AUDIO SFX') +
    '\nglobalThis.__p = Pinyin; globalThis.__d = { PY, WORDS, DZG1, SZJ1, DZG2, FIN, LEVELS, CONF };';
  const warnings = [];
  const ctx = vm.createContext({ console: { warn: (...a) => warnings.push(a) } });
  vm.runInContext(code, ctx, { filename: 'qwen.html#pinyin' });
  assert.ok(ctx.__p && ctx.__d.PY, 'the Pinyin block did not load');
  return {
    Pinyin: ctx.__p,
    PY: ctx.__d.PY,
    WORDS: ctx.__d.WORDS,
    POOLS: [ctx.__d.DZG1, ctx.__d.SZJ1, ctx.__d.DZG2, ctx.__d.FIN],
    LEVELS: ctx.__d.LEVELS,
    CONF: ctx.__d.CONF,
    warnings,
    /* out of the vm realm, so assert.deepStrictEqual behaves */
    audit: () => Array.from(ctx.__p.audit(ctx.__d.PY, ctx.__d.WORDS, [ctx.__d.DZG1, ctx.__d.SZJ1, ctx.__d.DZG2, ctx.__d.FIN])),
    mutate: (fn) => vm.runInContext(fn, ctx),
  };
}

/* The real one, loaded once — every "what ships" assertion below reads it. */
const L = load();
const { Pinyin, PY, WORDS } = L;

/* ------------------------------------------------------------------ *
 * The tone table itself
 * ------------------------------------------------------------------ */

test('the tone table is eight vowels x four tones, and every row is distinct', () => {
  assert.equal(Pinyin.MARKS.length, 8, 'a,e,i,o,u,ü,n,m — the only vowels that take a mark');
  const seen = new Set();
  for (const row of Pinyin.MARKS) {
    assert.equal(row.length, 5, 'base + tones 1..4');
    const marks = row.slice(1).filter(Boolean);
    // n and m only ever have the marks that exist on a nasal final (ń ǹ / ḿ).
    assert.ok(marks.length >= 1, `${row[0]} has no marked form at all`);
    for (const c of marks) {
      assert.ok(!seen.has(c.codePointAt(0)), `${c} appears in two rows of MARKS`);
      seen.add(c.codePointAt(0));
    }
  }
  // 5 vowels x 4 tones, plus the two marked nasals and the one marked m.
  assert.equal(seen.size, 27, 'the marked vowels of 汉语拼音方案');
});

test('TONE maps exactly the marked codepoints in MARKS, to 1..4', () => {
  const expected = new Map();
  Pinyin.MARKS.forEach((row) =>
    row.slice(1).forEach((c, i) => {
      if (c) expected.set(c.codePointAt(0), i + 1);
    }),
  );
  const actual = new Map(Object.entries(Pinyin.TONE).map(([k, v]) => [Number(k), v]));
  assert.deepStrictEqual([...actual].sort(), [...expected].sort());
  for (const t of actual.values()) assert.ok(t >= 1 && t <= 4, `tone ${t} is out of range`);
});

test('BASE is exactly the 27 marked vowels plus ê and ü, and each folds to its own letter', () => {
  const keys = Object.keys(Pinyin.BASE).map(Number).sort((a, b) => a - b);
  const marked = [];
  Pinyin.MARKS.forEach((row) => row.slice(1).forEach((c) => c && marked.push(c.codePointAt(0))));
  assert.deepStrictEqual(keys, [...marked, 0xEA, 0xFC].sort((a, b) => a - b),
    'BASE is what makes a character a vowel, so nothing else may be in it');
  for (const [cp, letter] of Object.entries(Pinyin.BASE)) {
    assert.equal(typeof letter, 'string');
    assert.ok([...letter].every((c) => c >= 'a' && c <= 'z' || c === 'ü' || c === 'ê'), `BASE[${cp}] = ${letter}`);
    // Only the two plain vowels are unmarked; every other key has a tone.
    if (Number(cp) !== 0xEA && Number(cp) !== 0xFC)
      assert.ok(Pinyin.TONE[cp] > 0 && Pinyin.TONE[cp] <= 4, `BASE[${cp}] is not a tone-marked vowel`);
  }
  assert.equal(Pinyin.BASE[0xEA], 'ê');
  assert.equal(Pinyin.BASE[0xFC], 'ü');
});

test('the finals table is the 汉语拼音方案 inventory, apical vowels included', () => {
  const f = Pinyin.FINALS;
  for (const x of ['a', 'o', 'e', 'i', 'u', 'ü', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'ie', 'uo', 'ui', 'iu', 'un', 'ün', 'ue'])
    assert.ok(f.has(x), `${x} is a real final and must be accepted`);
  // Apical vowels are legal on their own and illegal after an initial — that asymmetry is
  // the whole reason `gn` is not a syllable, so it has to be in the table, not implicit.
  for (const x of ['n', 'ng', 'm']) {
    assert.ok(f.has(x), `${x} is a 舌尖元音`);
    assert.ok(Pinyin.APICAL.has(x), `${x} must be listed as apical`);
  }
  assert.equal(Pinyin.APICAL.size, 3);
  for (const x of ['x', 'q', 'j', 'kk', 'nn', 'zh', 'uii', 'aoao', 'oong', 'ama', 'aa'])
    assert.ok(!f.has(x), `${x} is not a final`);
  // No final repeats a letter, and that is *why* a doubled tone mark cannot slip through:
  // folding `ǒǒ` back gives `oo`, which this forbids. Assert the invariant rather than
  // trusting that a future edit to the list keeps it true.
  for (const x of f) assert.ok(!/[a-zü]\1/.test(x), `the final ${x} repeats a letter`);
});

/* ------------------------------------------------------------------ *
 * parse() — one syllable, and one reading
 * ------------------------------------------------------------------ */

test('all four tones parse, with the tone number and the initial split off', () => {
  const p = Pinyin.parse('ā á ǎ à');
  assert.equal(p.length, 4);
  assert.deepStrictEqual(Array.from(p, (x) => x.tone), [1, 2, 3, 4]);
  assert.ok(p.every((x) => x.initial === '' && x.vowel === x.s));
  assert.ok(p.every((x) => x.neutral === false));
  // A real single syllable: m is an initial here, so the vowel is the whole rest of it.
  const m = Pinyin.syl('mā');
  assert.equal(m.initial, 'm');
  assert.equal(m.vowel, 'ā');
  assert.equal(m.tone, 1);
});

test('the digraph initials win over the single letters they start with', () => {
  const cases = [['zhōng', 'zh', 'ong'], ['chī', 'ch', 'i'], ['shū', 'sh', 'u'],
                 ['zǐ', 'z', 'i'], ['cǎo', 'c', 'ao'], ['sān', 's', 'an']];
  for (const [py, initial] of cases) {
    const p = Pinyin.syl(py);
    assert.ok(p, `${py} did not parse`);
    assert.equal(p.initial, initial, `${py}: wrong initial`);
  }
  // n is an initial but never the start of the final it is also a letter of.
  assert.equal(Pinyin.syl('niǎo').initial, 'n');
  assert.equal(Pinyin.syl('niǎo').vowel, 'iǎo');
});

test('an unmarked syllable is neutral (tone 0), not tone 1', () => {
  const p = Pinyin.parse('bà ba');
  assert.deepStrictEqual(Array.from(p, (x) => x.tone), [4, 0]);
  assert.equal(p[1].neutral, true);
  assert.equal(p[0].neutral, false);
});

test('syls() gives the raw syllable strings back, or null for an unreadable reading', () => {
  assert.deepStrictEqual(Array.from(Pinyin.syls('péng you')), ['péng', 'you']);
  assert.deepStrictEqual(Array.from(Pinyin.syls('  yǒng   gǎn  ')), ['yǒng', 'gǎn'], 'whitespace is collapsed');
  assert.equal(Pinyin.syls('yǒng gn'), null);
  assert.equal(Pinyin.syls(''), null);
});

test('the bug this module exists for is not pinyin', () => {
  // "yǒng gn" splits into a valid first syllable and `gn`, which is g + n. A rule that only
  // counted letters and tone marks calls it a valid two-syllable reading with a neutral
  // second syllable, so the final has to be checked for shape, not just for tone.
  assert.equal(Pinyin.syl('yǒng gn') && null, null);
  assert.equal(Pinyin.syl('gn'), null, 'g+n is not a syllable');
  assert.equal(Pinyin.syl('yǒng').tone, 3);
  assert.equal(Pinyin.syl('gǎn').tone, 3);
  assert.ok(Pinyin.ok('yǒng gǎn', 2, true), 'the corrected reading passes');
});

test('letters that are not pinyin are rejected', () => {
  const bad = ['gn', 'zh', 'ch', 'sh', 'kk', 'ee', 'yǒǒng', 'rén2', 'r-en', '→', '  ', 'a b', 'yǒng gǎn。'];
  for (const s of bad) assert.equal(Pinyin.syl(s), null, `${JSON.stringify(s)} should not be a syllable`);
  // …and a neutral final that has no vowel at all is not a syllable either.
  assert.equal(Pinyin.syl('zh'), null);
});

test('a syllable cannot carry two tone marks', () => {
  // Folding each mark back to its letter repeats that letter, and no final in the table has a
  // repeated one — so this is the final check doing the work, not a separate guard. The test
  // pins the *property* so a future edit cannot reintroduce `maā` by relaxing the final table.
  for (const s of ['yǒǒng', 'shāǎng', 'māmā', 'maā', 'aā', 'zhōōng']) assert.equal(Pinyin.syl(s), null, s);
  assert.equal(Pinyin.parse('yǒǒng gǎn'), null);
  // One mark is ordinary, whatever the final is.
  for (const s of ['shāng', 'shàng', 'shǎng', 'mā', 'lüè']) assert.ok(Pinyin.syl(s), s);
});

test('ü is spelled ü, ue, u or v after the initials that take it', () => {
  for (const s of ['lǜ', 'lü', 'nǚ', 'jú', 'qù', 'xǔ', 'yuè', 'xué']) assert.ok(Pinyin.syl(s), s);
});

/* ------------------------------------------------------------------ *
 * ok() — the reading as a whole
 * ------------------------------------------------------------------ */

test('ok() requires one syllable per character, and lets neutral through only when asked', () => {
  assert.ok(Pinyin.ok('rén', 1, false));
  assert.ok(!Pinyin.ok('rén rén', 1, false), 'too many syllables');
  assert.ok(!Pinyin.ok('rén', 2, false), 'too few');
  assert.ok(Pinyin.ok('bà ba', 2, true), '爸爸 is neutral on the second syllable');
  assert.ok(!Pinyin.ok('bà ba', 2, false), 'and a PY reading may not be');
  assert.ok(Pinyin.ok('bà ba', 2), 'a bare ok() allows 轻声 — 爸爸 is genuinely neutral');
  assert.ok(Pinyin.ok('rén', undefined, false), 'the count is optional');
});

test('ok() survives every kind of rubbish a stale profile or a bad edit can hand it', () => {
  const junk = [null, undefined, 0, 1, NaN, Infinity, -1, {}, [], true, false,
                '', ' ', '\n', '\t', 'rén\nshuǐ', '🙂', 'rén🙂', '  ', 'a'.repeat(50)];
  for (const j of junk) {
    assert.doesNotThrow(() => Pinyin.ok(j, 2, false), `ok(${JSON.stringify(j)}) threw`);
    assert.doesNotThrow(() => Pinyin.parse(j));
    assert.doesNotThrow(() => Pinyin.syl(j));
  }
  assert.equal(Pinyin.ok(null, 2, false), false);
  assert.equal(Pinyin.ok('', 2, false), false);
  assert.equal(Pinyin.ok('rén\nshuǐ', 2, false), true, 'a newline is just whitespace');
  assert.equal(Pinyin.ok(NaN, 2, false), false);
  // A junk count is "no count", not "count zero".
  assert.ok(Pinyin.ok('rén', NaN, false));
  assert.ok(Pinyin.ok('rén', Infinity, false));
  assert.ok(Pinyin.ok('rén', 'two', false));
});

test('a reading with a newline is folded to a space, which is what the neural voices need', () => {
  // Both free endpoints 4xx on a newline in `q`, which is why Prompt.say() folds them. The
  // reading tables must be safe to fold without becoming something else.
  assert.ok(Pinyin.ok('rén\nshuǐ', 2, false));
  assert.ok(Pinyin.ok('rén\n\nshuǐ', 2, false));
});

/* ------------------------------------------------------------------ *
 * audit() — the shipped tables
 * ------------------------------------------------------------------ */

test('every reading the game can print is well formed: zero defects', () => {
  assert.deepStrictEqual(L.audit(), [], 'the shipped pinyin tables must be clean');
});

test('the old WORDS.勇敢 typo is exactly what the audit reports', () => {
  // Pinned as a regression: this is the string the 💡 hint, the reveal and the result-card
  // chip all printed, and it is a *silent* one — the word exists, the syllables count is
  // right, and every letter is a letter.
  const before = WORDS['勇敢'];
  assert.equal(before, 'yǒng gǎn', 'the shipped reading is the corrected one');
  L.mutate('WORDS["勇敢"]="yǒng gn";');
  try {
    const d = L.audit();
    assert.equal(d.length, 1, 'exactly one defect');
    assert.equal(d[0].table, 'WORDS');
    assert.equal(d[0].key, '勇敢');
    assert.match(d[0].why, /unreadable/);
  } finally {
    L.mutate('WORDS["勇敢"]="yǒng gǎn";');
  }
  assert.deepStrictEqual(L.audit(), []);
});

test('the audit is not just a table check: it reports every class of defect', () => {
  const cases = [
    // PY: one character, one syllable, one tone mark, and the final has to be a real one.
    ['PY', { 山: 'shan' }, '山', /no tone mark/],
    ['PY', { 山: 'shān shān' }, '山', /2 syllables for 1/],
    ['PY', { 山: 'shān shuǐ' }, '山', /2 syllables for 1/],
    ['PY', { 山: 'yǒǒng' }, '山', /unreadable/],
    ['PY', { 山: 'shn' }, '山', /unreadable/],
    ['PY', { 山: '' }, '山', /unreadable/],
    ['PY', { 山: null }, '山', /unreadable/],
    // WORDS: neutral is legal, the count is not negotiable.
    ['WORDS', { 太阳: 'tài yáng gāo' }, '太阳', /3 syllables for 2/],
    ['WORDS', { 太阳: 'tài yang a' }, '太阳', /3 syllables for 2/],
    // PHRASE: classical recitation puts a real tone on every syllable.
    ['PHRASE', [[['人之初', 'rén zhī chū', '性本善', 'xìng běn shang']]], '性本善', /no tone mark on shang/],
    ['PHRASE', [[['人之初', 'rén zhi chū', '性本善', 'xìng běn shàn']]], '人之初', /no tone mark on zhi/],
  ];
  for (const [table, bag, key, why] of cases) {
    const out = Pinyin.audit(table === 'PY' ? bag : {}, table === 'WORDS' ? bag : {},
      table === 'PHRASE' ? bag : []);
    assert.equal(out.length, 1, `${table} ${key} should produce one defect, got ${JSON.stringify(out)}`);
    assert.equal(out[0].table, table);
    assert.equal(out[0].key, key);
    assert.match(out[0].why, why);
  }
  // A phrase row that lost a half is reported rather than read off the end.
  const short = Pinyin.audit({}, {}, [[['人之初', 'rén zhī chū', '性本善']]]);
  assert.equal(short.length, 1);
  assert.match(short[0].why, /row is not/);
});

test('a clean audit is silent, and a broken one names every entry', () => {
  assert.deepStrictEqual(Array.from(Pinyin.audit(PY, WORDS, L.POOLS)), []);
  const dirty = Pinyin.audit({ 山: 'shan' }, { 太阳: 'tài yang a' }, [[['人之初', 'rén zhī chū', '性本善', '']]]);
  assert.equal(dirty.length, 3, 'one report per broken entry, not one per run');
  assert.deepStrictEqual(Array.from(dirty, (d) => d.table), ['PY', 'WORDS', 'PHRASE']);
  assert.deepStrictEqual(Array.from(dirty, (d) => d.key), ['山', '太阳', '性本善']);
});

test('the audit survives missing, junk and malformed arguments', () => {
  for (const args of [[], [null, null, null], [{}, {}, {}], [[], [], []], [PY, WORDS, 'nope'],
                       [{ 1: 'x' }, null, [null]], [{ '': '' }, { '': '' }, [[]]],
                       [{ 人: 'rén' }, { 人: 'rén' }, [['人之初', 'rén zhī chū', '性本善', 'xìng běn shàn'], null, 'x']]]) {
    assert.doesNotThrow(() => Pinyin.audit(...args), `audit(${JSON.stringify(args)}) threw`);
  }
  // A phrase pool row that is not a four-slot row is reported rather than crashing the page.
  const bad = Pinyin.audit({}, {}, [[['a', 'rén']], null, 'x', [null]]);
  assert.equal(bad.length, 2, 'the short row and the null row; a null pool is skipped entirely');
  assert.ok(bad.some((d) => /row is not/.test(d.why)), JSON.stringify(bad));
  // A PY key that is not a single character is a defect in its own right.
  assert.ok(Pinyin.audit({ 人山: 'rén shān' }, {}, []).some((d) => /single character/.test(d.why)));
});

/* ------------------------------------------------------------------ *
 * Coverage — the tables and the levels have to agree
 * ------------------------------------------------------------------ */

test('every character any level can put on the board has a well-formed reading', () => {
  let checked = 0;
  for (const Lv of L.LEVELS) {
    if (Lv.type === 'phrase') {
      for (const row of Lv.pool) {
        for (const [t, py] of [[row[0], row[1]], [row[2], row[3]]]) {
          assert.ok(Pinyin.ok(py, [...t].length, false), `L${Lv.id} ${t} -> ${JSON.stringify(py)}`);
          checked++;
        }
      }
    } else if (Lv.type === 'char') {
      for (const c of Lv.pool) {
        assert.ok(PY[c], `L${Lv.id} has no reading for ${c}`);
        assert.ok(Pinyin.ok(PY[c], 1, false), `L${Lv.id} ${c} -> ${JSON.stringify(PY[c])}`);
        checked++;
      }
    } else {
      for (const w of Lv.pool) {
        assert.ok(WORDS[w], `L${Lv.id} has no reading for ${w}`);
        assert.ok(Pinyin.ok(WORDS[w], [...w].length, true), `L${Lv.id} ${w} -> ${JSON.stringify(WORDS[w])}`);
        checked++;
      }
    }
  }
  // 293 = the pool slots the twelve levels actually reach (140 character slots, 61 word slots
  // and 92 couplet halves — the pools overlap, so more slots than PY+WORDS entries).
  assert.ok(checked >= 290, `only ${checked} readings checked — the tables shrank?`);
});

test('the tables carry nothing no level uses', () => {
  const used = new Set();
  for (const Lv of L.LEVELS)
    for (const it of Lv.pool) {
      if (Lv.type === 'phrase') { used.add(it[0]); used.add(it[2]); } else used.add(it);
    }
  // CONF counts too: a character in a look-alike group is put on the board as a distractor
  // when a sibling of it is the target, so 八 is taught on level 7 without being in its pool.
  for (const group of L.CONF) for (const c of group) used.add(c);
  const unused = (t) => Object.keys(t).filter((k) => !used.has(k));
  assert.deepStrictEqual(unused(PY), [], 'a PY entry nothing teaches');
  assert.deepStrictEqual(unused(WORDS), [], 'a WORDS entry nothing teaches');
});

test('the neutral syllables in WORDS are the 轻声 ones and nothing else', () => {
  const neutral = Object.keys(WORDS).filter((w) => Pinyin.parse(WORDS[w]).some((s) => s.neutral));
  // Pinned: these are the words whose second syllable really is neutral. A new entry with an
  // unmarked syllable has to be a decision, and this is the list that decision shows up in.
  assert.deepStrictEqual(neutral.sort(),
    ['哥哥', '妈妈', '妹妹', '鱼儿', '姐姐', '故事', '星星', '月亮', '朋友', '爸爸', '聪明', '弟弟'].sort());
  assert.equal(neutral.length, 12);
  // And nothing in PY or in the classical text may carry one.
  for (const [c, py] of Object.entries(PY)) assert.ok(Pinyin.parse(py)[0].tone > 0, `${c} ${py}`);
  for (const pool of L.POOLS)
    for (const row of pool)
      for (const py of [row[1], row[3]])
        assert.ok(Pinyin.parse(py).every((s) => s.tone > 0), JSON.stringify(py));
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the page audits its own tables at load, and stays silent when they are clean', () => {
  const html = page();
  assert.ok(html.includes('const PINYIN_DEFECTS=Pinyin.audit(PY,WORDS,[DZG1,SZJ1,DZG2,FIN]);'),
    'the shipped audit must name all four phrase pools');
  assert.match(html, /if\(PINYIN_DEFECTS\.length&&typeof console!=='undefined'\)/,
    'and only speak up when there is something to say');
  assert.equal(L.warnings.length, 0, 'clean data must not print anything');
});

test('the shipped audit really does print the bad entry, and only that one', () => {
  const html = page().replace("勇敢:'yǒng gǎn'", "勇敢:'yǒng gn'");
  const code =
    slice(html, 'const PY={', '/* ============ PINYIN') +
    slice(html, '/* PINYIN START */', '/* ============ AUDIO SFX');
  const warnings = [];
  const ctx = vm.createContext({ console: { warn: (...a) => warnings.push(a) } });
  vm.runInContext(code, ctx, { filename: 'qwen.html#pinyin-broken' });
  assert.equal(warnings.length, 1, 'exactly one warning');
  assert.match(String(warnings[0][0]), /拼音数据有问题/, 'the warning says what it is');
  assert.match(String(warnings[0][1]), /勇敢/, 'and names the entry');
});

test('pyLine() is the one place a reading reaches the screen, and it never renders an empty hint', () => {
  const live = stripComments(page());
  assert.ok(live.includes("function pyLine(prefix,a,b,fallback){"), 'pyLine must exist');
  // Every site that used to interpolate a reading straight into innerHTML now goes through it.
  assert.ok(!live.includes("'提示：'+rt.bpy"), 'the hint must not build its own string');
  assert.ok(!live.includes("'提示：'+rt.py"), 'the hint must not build its own string');
  assert.ok(!live.includes("'<span class=\"py\">'+rt.py+'</span>'"), 'nor the reveal');
  assert.ok(!live.includes("'<span class=\"py\">'+rt.apy+' → '+rt.bpy+'</span>'"), 'nor the couplet reveal');
  for (const call of ["pyLine('提示：',rt.bpy,undefined,", "pyLine('提示：',rt.py,undefined,", "pyLine('',rt.apy,rt.bpy,", "pyLine('',rt.py,undefined,"])
    assert.ok(live.includes(call), `${call} is not wired`);
});

test('pyLine() returns the reading, or the fallback, and never a bare 提示：', () => {
  const src = slice(page(), 'function pyLine(prefix,a,b,fallback){', 'function cardReveal(){');
  const ctx = vm.createContext({ Pinyin });
  vm.runInContext(src + '\nglobalThis.__f = pyLine;', ctx);
  const pyLine = ctx.__f;
  assert.equal(pyLine('', 'shān', undefined, '读一读这个字'), '<span class="py">shān</span>');
  assert.equal(pyLine('提示：', 'bàn', undefined, '再听一遍'), '<span class="py">提示：bàn</span>');
  assert.equal(pyLine('', 'xī mèng mǔ', 'zé lín chǔ', 'x'), '<span class="py">xī mèng mǔ → zé lín chǔ</span>');
  // No reading at all: the fallback, so the sub-line is never shorter than the question above it.
  assert.equal(pyLine('提示：', '', undefined, '再听一遍'), '再听一遍');
  assert.equal(pyLine('提示：', undefined, undefined, '再听一遍'), '再听一遍');
  // A reading that is present but malformed gets the fallback too, not a typo on the card.
  assert.equal(pyLine('提示：', 'yǒng gn', undefined, '再听一遍'), '再听一遍');
  assert.equal(pyLine('提示：', 'yǒǒng', undefined, '再听一遍'), '再听一遍');
  assert.equal(pyLine('提示：', 'rén shān!', undefined, '再听一遍'), '再听一遍');
  assert.equal(pyLine('提示：', 'rén shān', 1, '再听一遍'), '再听一遍', 'and a count the reading misses');
  // An untoned reading is *not* malformed — 爸爸 is genuinely neutral — so it still shows.
  assert.equal(pyLine('提示：', 'bà ba', undefined, '再听一遍'), '<span class="py">提示：bà ba</span>');
  // One half of a couplet missing must not print the half that is there.
  assert.equal(pyLine('', 'xī mèng mǔ', '', 'x'), 'x');
  assert.equal(pyLine('', '', 'zé lín chǔ', 'x'), 'x');
  // The arrow between two readings is not part of either reading, so it is never validated.
  assert.ok(pyLine('', 'xī mèng mǔ → zé lín chǔ', undefined, 'x').includes('→') === false);
  for (const junk of [null, undefined, 0, {}, []])
    assert.equal(pyLine('提示：', junk, junk, '再听一遍'), '再听一遍', JSON.stringify(junk));
});

test('pyOf() is unchanged, and still the single reader the game asks for', () => {
  const live = stripComments(page());
  assert.ok(live.includes("function pyOf(type,t){ if(type==='char')return PY[t]||''; if(type==='word')return WORDS[t]||''; return ''; }"),
    'pyOf must keep its contract — the hint and the Learned chip both depend on "" for unknown text');
});

test('the PINYIN markers build.mjs guards are in place', () => {
  const b = fs.readFileSync(path.join(ROOT, 'build.mjs'), 'utf8');
  assert.ok(b.includes("'PINYIN START'"));
  assert.ok(b.includes("'PINYIN END'"));
});
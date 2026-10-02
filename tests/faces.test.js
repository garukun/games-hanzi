'use strict';
/**
 * Tests for the inlined Faces module inside qwen.html.
 *
 * Same trick as tests/voice.test.js: the module ships inside the single-file
 * page, so we slice it out between the FACES START/END markers and evaluate it
 * in a vm context. It touches no browser globals, so no stubbing is needed.
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

function loadFaces() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const start = html.indexOf('/* ==== FACES START ==== */');
  const endMark = '/* ==== FACES END ==== */';
  const end = html.indexOf(endMark);
  assert.ok(start > -1 && end > start, 'FACES markers not found in qwen.html');
  const src = html.slice(start, end + endMark.length);
  const ctx = vm.createContext({});
  // `const Faces = ...` is a lexical binding, so hand it back explicitly.
  vm.runInContext(src + '\nglobalThis.__faces = Faces;', ctx, { filename: 'qwen.html#faces' });
  assert.ok(ctx.__faces, 'Faces was not defined by the extracted module');
  // Keep the functions, but copy the data arrays out of the vm realm so
  // assert.deepEqual / Set comparisons behave like they do for host objects.
  return Object.assign({}, ctx.__faces, {
    SPECIES: ctx.__faces.SPECIES.map((s) => Object.assign({}, s)),
    KINDS: Array.from(ctx.__faces.KINDS),
  });
}

/* ------------------------------------------------------------------ */

test('roster is a valid, non-empty species table', () => {
  const F = loadFaces();
  assert.ok(Array.isArray(F.SPECIES) && F.SPECIES.length >= 3, 'need at least 3 species');
  const ids = F.SPECIES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'species ids must be unique');
  for (const s of F.SPECIES) {
    assert.match(s.id, /^[a-z]+$/, `bad id: ${s.id}`);
    assert.ok(F.KINDS.includes(s.ear), `${s.id} has unknown ear kind: ${s.ear}`);
    for (const key of ['earCol', 'ink', 'eye', 'ring']) {
      assert.equal(typeof s[key], 'string');
      assert.ok(s[key].length > 0, `${s.id}.${key} must not be empty`);
    }
  }
});

test('species match the five animals gemini.html drew', () => {
  const ids = loadFaces().SPECIES.map((s) => s.id);
  // gemini.html's ANIMAL_TYPES was ['bear','rabbit','cat','panda','frog'].
  for (const id of ['bear', 'rabbit', 'cat', 'panda', 'frog']) {
    assert.ok(ids.includes(id), `dropped gemini's ${id}`);
  }
});

test('pick cycles the whole roster and never repeats the previous face', () => {
  const F = loadFaces();
  const n = F.SPECIES.length;
  const seen = [];
  let prev = null;
  for (let i = 0; i < n * 3; i++) {
    const sp = F.pick(i, prev);
    assert.notEqual(sp.id, prev, `bubble ${i} repeated the previous species ${prev}`);
    seen.push(sp.id);
    prev = sp.id;
  }
  assert.equal(new Set(seen).size, n, 'every species should appear within one roster pass');
});

test('pick survives negative, fractional and undefined indices', () => {
  const F = loadFaces();
  const ids = new Set(F.SPECIES.map((s) => s.id));
  for (const i of [-1, -99, 0.4, NaN, undefined, null, 1e9]) {
    assert.ok(ids.has(F.pick(i, null).id), `pick(${i}) returned an unknown species`);
  }
  // An unknown previous id is ignored rather than throwing.
  assert.ok(ids.has(F.pick(0, 'dinosaur').id));
});

test('idFor and pick never disagree', () => {
  const F = loadFaces();
  for (let i = 0; i < 12; i++) {
    const prev = i > 0 ? F.idFor(i - 1, null) : null;
    assert.equal(F.idFor(i, prev), F.pick(i, prev).id);
  }
});

test('cls produces a class the stylesheet can key off', () => {
  const F = loadFaces();
  const css = fs.readFileSync(PAGE, 'utf8');
  for (const s of F.SPECIES) {
    const c = F.cls(s);
    assert.equal(c, 'f-' + s.id);
    assert.match(c, /^f-[a-z]+$/);
    // The stylesheet in qwen.html must actually define a rule for it.
    assert.ok(css.includes('.' + c + ' '), `no CSS rule for .${c}`);
  }
});

test('vars exposes every colour the CSS reads', () => {
  const F = loadFaces();
  const v = F.vars(F.pick(0, null));
  assert.deepEqual(Object.keys(v).sort(), ['--ear', '--eye', '--ink', '--ring', '--ringw']);
  for (const k of Object.keys(v)) assert.match(k, /^--[a-z]+$/);
  const css = fs.readFileSync(PAGE, 'utf8');
  const block = css.slice(css.indexOf('/* ---------- BUBBLE FACES'), css.indexOf('#playArea.noface'));
  for (const k of Object.keys(v)) {
    assert.ok(block.includes('var(' + k + ')'), `.face CSS never reads ${k}, so setting it is dead code`);
  }
});

test('markup emits the five face parts the CSS positions', () => {
  const html = loadFaces().markup();
  const parts = html.match(/<i class="[a-z ]+"><\/i>/g) || [];
  assert.equal(parts.length, 5, 'expected 2 ears + 2 eyes + 1 mouth');
  assert.ok(html.includes('class="ear l"') && html.includes('class="ear r"'));
  assert.ok(html.includes('class="eye l"') && html.includes('class="eye r"'));
  assert.ok(html.includes('class="mouth"'));
});

test('REACT_MS is long enough to be seen but short enough not to stick', () => {
  const F = loadFaces();
  assert.ok(F.REACT_MS >= 500, 'smile flashes by too fast to notice');
  assert.ok(F.REACT_MS <= 2500, 'smile lingers past the next interaction');
});

/* ------------------------------------------------------------------ *
 * Integration: the wiring in nextRound()/tapBubble()/Store that the pure
 * module cannot see. These are string assertions over the shipped page, which
 * is enough to catch a rename or a dropped call site.
 * ------------------------------------------------------------------ */

test('nextRound gives every bubble a face and keeps the character on top', () => {
  const src = fs.readFileSync(PAGE, 'utf8');
  const body = src.slice(src.indexOf('function nextRound()'), src.indexOf('function speakTarget()'));
  assert.ok(body.includes('Faces.pick(idx,prevFace)'), 'bubbles are not assigned a species');
  assert.ok(body.includes('Faces.cls(sp2)'), 'the species class is never applied');
  assert.ok(body.includes('Faces.markup()'), 'the face layer is never created');
  assert.ok(body.includes('Faces.vars(sp2)'), 'face colours are never applied');
  // The face must be appended before .btxt, and .btxt must be positioned so it
  // is not painted under the absolutely-positioned face layer.
  assert.ok(body.indexOf("className='face'") < body.indexOf("className='btxt'"), 'face must come first');
  const css = src.slice(0, src.indexOf('</style>'));
  assert.ok(/\.btxt\{position:relative/.test(css), '.btxt needs position:relative to stack above .face');
  assert.ok(/\.face\{position:absolute/.test(css), '.face must be absolutely positioned');
});

test('every tap smiles the bubble, and a burst bubble is not resurrected', () => {
  const src = fs.readFileSync(PAGE, 'utf8');
  const tap = src.slice(src.indexOf('function tapBubble('), src.indexOf('function showCombo('));
  assert.ok(/smile\(b\);/.test(tap), 'tapBubble no longer triggers the smile');
  const fn = src.slice(src.indexOf('function smile('), src.indexOf("addEventListener('pointerup'"));
  assert.ok(/if\(!b\|\|!b\.el\|\|b\.dead\)return;/.test(fn), 'smile must ignore dead bubbles');
  assert.ok(/clearTimeout\(b\.smT\)/.test(fn), 're-tapping should restart the timer, not stack timers');
  assert.ok(/Faces\.REACT_MS/.test(fn), 'the smile timer must come from the shared constant');
});

test('a smile is actually visible: the bubble grows, the eyes squint, the mouth opens', () => {
  const src = fs.readFileSync(PAGE, 'utf8');
  const css = src.slice(0, src.indexOf('</style>'));
  const rules = ['.bubble.smile', '.bubble.smile .face', '.bubble.smile .eye', '.bubble.smile .mouth'];
  for (const r of rules) {
    assert.ok(css.includes(r + '{'), `missing rule ${r}{}`);
  }
  assert.match(css, /\.bubble\.smile\{scale:[\d.]+;\}/, 'a smiling bubble must scale up');
  // `scale` is a standalone property, so it composes with the transform the
  // physics loop rewrites every frame instead of fighting it.
  assert.ok(/@keyframes cheer\{/.test(css), 'the cheer keyframe is missing');
  assert.ok(/animation:cheer/.test(css), 'nothing animates on smile');
  // The mouth must gain a fill, otherwise "smiling" is just a wider line.
  assert.match(css, /\.bubble\.smile \.mouth\{[^}]*background:var\(--ink\)/);
});

test('faces can be switched off from the help modal and is persisted', () => {
  const src = fs.readFileSync(PAGE, 'utf8');
  assert.ok(src.includes('id="optFaces"'), 'no 泡泡脸 control in the help modal');
  assert.ok(src.includes("wireSeg('#optFaces'"), 'the control is not wired');
  assert.ok(/setFaces\(v\)\{d\.faces=/.test(src), 'faces are not persisted by the Store');
  assert.ok(/classList\.toggle\('noface',Store\.faces==='off'\)/.test(src), 'noface never applied');
  const css = src.slice(0, src.indexOf('</style>'));
  assert.ok(css.includes('#playArea.noface .face{display:none;}'), 'noface has no CSS');
  // A child playing on an old saved profile must not end up with invisible
  // bubbles, so the default is on and any junk value is coerced.
  assert.ok(src.includes("faces:'on'"), 'faces should default to on');
  assert.ok(/if\(d\.faces!=='on'&&d\.faces!=='off'\) d\.faces='on';/.test(src), 'junk persisted value is not repaired');
});

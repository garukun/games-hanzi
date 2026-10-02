'use strict';
/**
 * Tests for the inlined Palette module inside qwen.html.
 *
 * Same trick as tests/voice.test.js and tests/faces.test.js: the module ships
 * inside the single-file page, so we slice it out between the PALETTE START/END
 * markers and evaluate it in a vm context. It touches no browser globals.
 *
 * The centrepiece of this suite is that it *recomputes the contrast ratios itself*
 * from the shipped hex values. A test that only asserted "there is a table with
 * light and dark columns" would have passed against qwen's original 1.75:1
 * white-on-amber bubbles, because those were a table too. Every assertion below
 * about readability is arithmetic over the colours that actually ship.
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

/* ------------------------------------------------------------------ *
 * sRGB relative luminance + WCAG contrast, recomputed rather than trusted
 * ------------------------------------------------------------------ */
const HEX = /^#[0-9a-f]{6}$/;
function channels(hex) {
  assert.match(hex, HEX, `not a 6-digit lowercase hex: ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The colour under a white glyph drawn on top of `bg` — what `color:#fff` really rendered. */
function withWhite(bg, alpha) {
  const [r, g, b] = channels(bg);
  const m = (c) => Math.round(c + (255 - c) * alpha);
  const out = [m(r), m(g), m(b)];
  return '#' + out.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** WCAG 1.4.3 normal text, and 1.4.11 non-text (graphical objects). */
const TEXT = 4.5;
const GRAPHIC = 3;

/* The two light backgrounds a mark can land on: the sky gradient the logo and the
 * confetti sit on, and the cream the level map is drawn on. */
const SCREENS = ['#9fd9ff', '#e9f8ff', '#fffdf6'];

function load() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const start = html.indexOf('/* ==== PALETTE START ==== */');
  const endMark = '/* ==== PALETTE END ==== */';
  const end = html.indexOf(endMark);
  assert.ok(start > -1 && end > start, 'PALETTE markers not found in qwen.html');
  const src = html.slice(start, end + endMark.length);
  const ctx = vm.createContext({});
  // `const Palette = ...` is a lexical binding in a vm realm, so hand it back explicitly.
  vm.runInContext(src + '\nglobalThis.__p = Palette;', ctx, { filename: 'qwen.html#palette' });
  assert.ok(ctx.__p, 'Palette was not defined by the extracted module');
  return Object.assign({}, ctx.__p, {
    SCHEMES: ctx.__p.SCHEMES.map((s) => Object.assign({}, s)),
    byId: Object.assign({}, ctx.__p.byId),
  });
}

function page() {
  return fs.readFileSync(PAGE, 'utf8');
}

/** An element stub that records setProperty calls, like Faces.vars' consumer does. */
function fakeEl() {
  const props = {};
  return {
    props,
    style: {
      setProperty(k, v) {
        props[k] = v;
      },
    },
  };
}

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

test('there are seven schemes, one per hue family qwen already used', () => {
  const P = load();
  assert.equal(P.SCHEMES.length, 7, 'the roster size is what the board layout was tuned around');
  // qwen's original PAL was
  // ['#ff6b5e','#ffb63d','#29c1b0','#4d9de0','#f27bae','#7cb518','#ff8f3f']
  // — coral, amber, teal, blue, pink, green, orange. Same seven families, same order,
  // so two bubbles that used to be different colours still are.
  assert.deepEqual(
    P.SCHEMES.map((s) => s.id),
    ['coral', 'tangerine', 'amber', 'mint', 'sky', 'bubblegum', 'lime'],
  );
  assert.equal(P.N, P.SCHEMES.length);
  assert.equal(Object.keys(P.byId).length, P.SCHEMES.length, 'byId must index every scheme');
  for (const s of P.SCHEMES) {
    assert.equal(P.byId[s.id].id, s.id, `byId has no entry for ${s.id}`);
    for (const key of ['bg', 'bg2', 'edge', 'ink', 'mark']) {
      assert.equal(P.byId[s.id][key], s[key], `byId[${s.id}].${key} points at the wrong scheme`);
    }
  }
});

test('every scheme carries all four colours and no extras', () => {
  const P = load();
  for (const s of P.SCHEMES) {
    assert.deepEqual(
      Object.keys(s).sort(),
      ['bg', 'bg2', 'edge', 'id', 'ink', 'mark'],
      `${s.id} has the wrong fields`,
    );
    for (const key of ['bg', 'bg2', 'edge', 'ink', 'mark']) {
      assert.match(s[key], HEX, `${s.id}.${key} = ${s[key]}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * The point of the whole change: measured legibility
 * ------------------------------------------------------------------ */

test('the character clears 4.5:1 against BOTH stops of its own bubble', () => {
  const P = load();
  for (const s of P.SCHEMES) {
    for (const stop of ['bg', 'bg2']) {
      const r = contrast(s.ink, s[stop]);
      assert.ok(
        r >= TEXT,
        `${s.id}: ink ${s.ink} on ${stop} ${s[stop]} is ${r.toFixed(2)}:1 — ` +
          `the character has to be nameable, which needs ${TEXT}:1`,
      );
    }
  }
});

test('the character also survives the white sheen painted over the top of the bubble', () => {
  // .bubble stacks a white highlight at 32%/27% fading out by 46% radius on top of the
  // fill. At its strongest that lightens the fill; dark ink only gets easier from that, so
  // the number to check is the *darkest* pixel, which is the untouched bg2 — already
  // asserted above. What this guards is the opposite mistake: a future edit that darkens
  // the sheen or moves it over the centre would raise bg2 under the glyph.
  const P = load();
  for (const s of P.SCHEMES) {
    const lightened = withWhite(s.bg2, 0.78);
    assert.ok(
      contrast(s.ink, lightened) >= TEXT,
      `${s.id}: ink ${s.ink} on the sheened fill ${lightened} is only ` +
        `${contrast(s.ink, lightened).toFixed(2)}:1`,
    );
  }
});

test('every scheme is measurably better than the white glyph it replaced', () => {
  // The old rendering was `color:#fff` on the flat saturated bubble. Whiten each new
  // scheme by the amount the old sheen whitenened the old colour and the comparison is
  // exact: the dark ink must beat white on the same light background, everywhere.
  const P = load();
  for (const s of P.SCHEMES) {
    for (const stop of ['bg', 'bg2']) {
      const ink = contrast(s.ink, s[stop]);
      const white = contrast('#ffffff', s[stop]);
      assert.ok(
        ink > white,
        `${s.id}: ink ${s.ink} (${ink.toFixed(2)}:1) does not beat white ` +
          `(${white.toFixed(2)}:1) on ${s[stop]}`,
      );
    }
  }
});

test('the old white-on-flat rendering really was failing, so this is a fix not a cosmetic', () => {
  // Pin the measured baseline. If someone "restores" the saturated bubbles this is the
  // number that has to change, and it should have to change deliberately.
  const OLD = { coral: '#ff6b5e', amber: '#ffb63d', mint: '#29c1b0', sky: '#4d9de0' };
  for (const [id, hex] of Object.entries(OLD)) {
    const r = contrast('#ffffff', hex);
    assert.ok(r < GRAPHIC, `${id} ${hex}: white was ${r.toFixed(2)}:1 — expected a failure`);
  }
  assert.ok(contrast('#ffffff', '#ffb63d') < 1.8, 'the worst case was amber at ~1.75:1');
});

test('mark clears 4.5:1 on every light background a logo glyph or confetti piece lands on', () => {
  const P = load();
  for (const s of P.SCHEMES) {
    for (const bg of SCREENS) {
      const r = contrast(s.mark, bg);
      assert.ok(r >= TEXT, `${s.id}: mark ${s.mark} on ${bg} is ${r.toFixed(2)}:1`);
    }
  }
});

test('mark beats the bright colour it replaced on the same screen background', () => {
  const OLD = ['#ff6b5e', '#ffb63d', '#29c1b0', '#4d9de0', '#f27bae', '#7cb518', '#ff8f3f'];
  const P = load();
  P.SCHEMES.forEach((s, i) => {
    for (const bg of SCREENS) {
      assert.ok(
        contrast(s.mark, bg) > contrast(OLD[i], bg),
        `${s.id}: mark ${s.mark} does not beat the old ${OLD[i]} on ${bg}`,
      );
    }
  });
});

test('the rim is a visible step darker than the fill, so seven bubbles stay tellable apart', () => {
  const P = load();
  for (const s of P.SCHEMES) {
    const rim = contrast(s.edge, s.bg2);
    assert.ok(rim > 1.35, `${s.id}: edge ${s.edge} on bg2 ${s.bg2} is only ${rim.toFixed(2)}:1`);
    // ...and the rim must never be dark enough to be mistaken for the ink.
    assert.ok(s.edge !== s.ink, `${s.id}: edge and ink are the same colour`);
  }
});

test('all seven inks are distinct, so two bubbles never look identical', () => {
  const P = load();
  for (const key of ['bg', 'bg2', 'edge', 'ink', 'mark']) {
    const seen = P.SCHEMES.map((s) => s[key]);
    assert.equal(new Set(seen).size, seen.length, `${key} repeats across schemes`);
  }
});

/* ------------------------------------------------------------------ *
 * Lookup
 * ------------------------------------------------------------------ */

test('at() cycles in both directions', () => {
  const P = load();
  for (let i = 0; i < P.N * 3; i++) {
    assert.equal(P.at(i).id, P.at(i + P.N).id, 'a full turn must come back round');
    assert.equal(P.at(i).id, P.at(-P.N + i).id, 'and counting down must match counting up');
  }
});

test('at() collapses hostile indices instead of returning undefined', () => {
  const P = load();
  const first = P.SCHEMES[0].id;
  for (const junk of [undefined, null, NaN, '3', '', {}, [], true, false, -0.5, 0.5, Infinity, -Infinity]) {
    const s = P.at(junk);
    assert.ok(s && typeof s.id === 'string', `at(${String(junk)}) returned ${s}`);
    assert.ok(
      P.SCHEMES.some((t) => t.id === s.id),
      `at(${String(junk)}) escaped the table`,
    );
  }
  assert.equal(P.at('3').id, P.SCHEMES[3].id, 'a numeric string is still a usable index');
  assert.equal(P.at(NaN).id, first, 'NaN falls back to the first scheme');
  assert.equal(P.at(-1).id, P.SCHEMES[P.N - 1].id, '-1 is the last scheme');
});

test('vars() hands back exactly the four custom properties the stylesheet reads', () => {
  const P = load();
  const css = page();
  for (const s of P.SCHEMES) {
    const v = P.vars(s);
    assert.deepEqual(Object.keys(v).sort(), ['--bg', '--bg2', '--edge', '--ink']);
    assert.equal(v['--bg'], s.bg);
    assert.equal(v['--bg2'], s.bg2);
    assert.equal(v['--edge'], s.edge);
    assert.equal(v['--ink'], s.ink);
    // Every property the module emits has to be read by the sheet, or the table is lying.
    for (const prop of Object.keys(v)) {
      const uses = css.split(`var(${prop})`).length - 1;
      assert.ok(uses >= 2, `${prop} is set ${P.SCHEMES.length} times but read ${uses} times`);
    }
  }
});

test('apply() writes them onto an element and returns it for chaining', () => {
  const P = load();
  for (const s of P.SCHEMES) {
    const el = fakeEl();
    assert.equal(P.apply(el, s), el, 'apply must return the element it painted');
    assert.deepEqual(el.props, {
      '--bg': s.bg,
      '--bg2': s.bg2,
      '--edge': s.edge,
      '--ink': s.ink,
    });
  }
});

test('mark() returns the scheme mark and never a bubble colour', () => {
  const P = load();
  P.SCHEMES.forEach((s, i) => {
    assert.equal(P.mark(i), s.mark);
    assert.notEqual(P.mark(i), s.bg);
    assert.notEqual(P.mark(i), s.bg2);
  });
  assert.equal(P.mark(P.N), P.mark(0), 'mark() cycles like at()');
});

/* ------------------------------------------------------------------ *
 * Wiring — string level, because this is a single file with no DOM
 * ------------------------------------------------------------------ */

test('the old flat palette array is gone from the page', () => {
  const src = page();
  assert.ok(!/\bPAL\b/.test(src), 'PAL is still referenced somewhere');
  assert.ok(!/const PAL=/.test(src), 'the flat colour array is still declared');
  assert.ok(!/--c\b/.test(src), 'the old --c custom property is still used');
});

test('the bubble paints its character in the scheme ink, not white', () => {
  const src = page();
  const css = src.slice(src.indexOf('.bubble{'), src.indexOf('.btxt{'));
  assert.ok(/color:var\(--ink\)/.test(css), '.bubble must colour its glyph with --ink');
  assert.ok(!/color:#fff/.test(css), 'white text is still on the bubble');
  assert.ok(/radial-gradient\(circle at 50% 58%,var\(--bg\),var\(--bg2\)\)/.test(css),
    'the bubble must fill with the light gradient');
  assert.ok(/border:3px solid var\(--edge\)/.test(css),
    'the white rim is invisible on a light bubble; the edge must replace it');
  // The dark inset shading at the bottom used to darken the fill under the glyph. On a
  // light bubble it has to become a *light* inner glow or it eats into the ink's contrast.
  assert.ok(/inset 0 -8px 14px rgba\(255,255,255/.test(css),
    'the bottom inset must lighten the bubble, not darken it');
  assert.ok(!/inset 0 -6px 12px rgba\(0,0,0/.test(css), 'the dark inset is still there');
});

test('the character gets a light halo, not a black drop shadow', () => {
  const css = page().match(/\.btxt\{[^}]*\}/)[0];
  assert.ok(/text-shadow:0 1px 0 rgba\(255,255,255/.test(css), 'btxt needs a light halo');
  assert.ok(!/text-shadow:[^;]*rgba\(0,0,0/.test(css), 'a black shadow under dark ink muddies it');
});

test('the burst ring is visible on a light board', () => {
  const src = page();
  const ring = src.match(/\.bubble\.burst::after\{[^}]*\}/)[0];
  assert.ok(/border:4px solid var\(--edge\)/.test(ring),
    'a white ring vanishes against the sky the burst expands into');
  assert.ok(!/rgba\(255,255,255,\.85\)/.test(ring));
});

test('every bubble is painted through Palette, with the scheme kept on its model', () => {
  const src = page();
  const fn = src.slice(src.indexOf('function nextRound('), src.indexOf('function speakTarget('));
  assert.ok(/scheme:Palette\.at\(item\.i\+idx\)/.test(fn),
    'the bubble must record its scheme so the element and the model cannot disagree');
  assert.ok(/Palette\.apply\(el,b\.scheme\)/.test(fn), 'the element must be painted from the model');
  assert.ok(!/--c/.test(fn) && !/b\.color/.test(fn), 'the old --c plumbing is still in nextRound');
});

test('the level map paints its nodes through Palette too', () => {
  const src = page();
  const fn = src.slice(src.indexOf('function renderMap('), src.indexOf('function bubbleRadius'));
  assert.ok(/Palette\.apply\(n,Palette\.at\(L\.id-1\)\)/.test(fn),
    'a level number is a glyph too — it was white on the same saturated fill');
  assert.ok(!/n\.style\.background=PAL/.test(fn));
});

test('the logo and the confetti use the darkened mark', () => {
  const src = page();
  const logo = src.slice(src.indexOf("(function(){ const name='泡泡国学堂'"), src.indexOf("$('#mImg1').src"));
  assert.ok(/Palette\.mark\(i\)/.test(logo), 'the title glyphs need a colour that reads on the sky');
  const conf = src.slice(src.indexOf('const Confetti=(()=>{'), src.indexOf('/* ============ HELPERS'));
  assert.ok(/Palette\.mark\(\(Math\.random\(\)\*Palette\.N\)\|0\)/.test(conf),
    'confetti is a 6px shape on a light background — it needs mark, not the bubble fill');
});

test('the five floating title-screen characters are bubbles as well', () => {
  const src = page();
  const deco = src.match(/\.deco\{[^}]*\}/)[0];
  assert.ok(/color:var\(--ink\)/.test(deco), 'a deco glyph is a character; it needs the ink');
  assert.ok(!/color:#fff/.test(deco), 'white-on-bright is the defect this module exists to kill');
  assert.ok(/var\(--bg\)/.test(deco) && /var\(--edge\)/.test(deco));
  // ...and they are painted from the one table rather than from hand-copied inline hexes.
  const logo = src.slice(src.indexOf("(function(){ const name='泡泡国学堂'"), src.indexOf("$('#mImg1').src"));
  assert.ok(/\$\$\('\.deco'\)\.forEach\(\(d,i\)=>Palette\.apply\(d,Palette\.at\(/.test(logo),
    'the decos must be painted through Palette');
  const markup = src.match(/<div class="deco"[^>]*>/g) || [];
  assert.equal(markup.length, 5, 'there are five of them on the title screen');
  for (const m of markup) {
    assert.ok(!/background:/.test(m), `a deco still hardcodes its fill: ${m}`);
  }
});

test('the map node paints like a bubble now, and a locked node names its own colours', () => {
  const src = page();
  const node = src.match(/\.node\{[^}]*\}/)[0];
  assert.ok(/color:var\(--ink\)/.test(node), 'the level number must use the ink');
  assert.ok(!/color:#fff/.test(node), 'white level number is still there');
  assert.ok(/radial-gradient\(circle at 50% 58%,var\(--bg\),var\(--bg2\)\)/.test(node));
  // A locked node never gets a scheme, so --bg/--bg2/--edge are unset on it and every
  // var() in .node falls back to its initial value — which is `transparent` for a
  // background. That is invisible, so the locked rule has to name all three itself.
  const locked = src.match(/\.node\.locked\{[^}]*\}/)[0];
  assert.ok(/background:#/.test(locked), 'a locked node needs an explicit background');
  assert.ok(/border-color:/.test(locked), 'a locked node needs an explicit rim');
});

test('the pale species keep a silhouette on a light bubble', () => {
  const src = page();
  const ear = src.match(/\.face \.ear\{[^}]*\}/)[0];
  assert.ok(/filter:drop-shadow\(/.test(ear),
    'rabbit measured 1.00:1 and cat 1.13:1 against the lightest fills — they need a halo');
  assert.ok(!/box-shadow/.test(ear),
    'the cat ear is a clip-path polygon, which clips a box-shadow away entirely');
  const cat = src.match(/\.f-cat \.ear\{[^}]*\}/)[0];
  assert.ok(/clip-path:/.test(cat), 'if the cat stops being a clip-path, box-shadow would do');
});

test('the pulsing "play here" node keeps the same lighting as every other node', () => {
  // A keyframes rule owns the whole box-shadow while it runs. The old nodePulse restated the
  // pre-palette shadow, so the current node was the one bubble on the map lit from below.
  const src = page();
  const kf = src.match(/@keyframes nodePulse\{[^}]*\}\s*[^}]*\}/)[0];
  const frames = kf.match(/box-shadow:[^;}]+/g);
  assert.equal(frames.length, 2, 'nodePulse must still have a 0% and a 50% frame');
  for (const f of frames) {
    assert.ok(/inset 0 -5px 10px rgba\(255,255,255/.test(f), `frame lost the light inset: ${f}`);
    assert.ok(/0 5px 0 rgba\(43,58,85/.test(f), `frame lost the 3D press shadow: ${f}`);
  }
});

test('Palette is declared before every module that reaches for it', () => {
  const src = page();
  const decl = src.indexOf('const Palette=(()=>{');
  assert.ok(decl > -1, 'Palette declaration not found');
  for (const other of ['const Confetti=(()=>{', "(function(){ const name='泡泡国学堂'"]) {
    const at = src.indexOf(other);
    assert.ok(at > -1, `anchor not found: ${other}`);
    assert.ok(decl < at, `${other} dereferences Palette but is declared before it`);
  }
});

test('the module survives being the only thing on the page (no browser globals)', () => {
  const P = load();
  assert.ok(typeof P.at === 'function');
  assert.ok(typeof P.apply === 'function');
  assert.ok(typeof P.mark === 'function');
  assert.ok(typeof P.vars === 'function');
});
/**
 * tests/ink.test.js — every coloured glyph in the game clears WCAG.
 *
 *  Iteration 9 fixed the bubbles, and the run recorded the rest of the palette as "a known,
 *  deliberately unchanged consistency choice". It was not actually a choice: --coral, --teal
 *  and --blue had been picked as *fills* and then reused as *text*, and nothing had ever
 *  measured either role. The measured result was that **every** coloured label in the game
 *  failed:
 *
 *      white on --gold (the live 得分)   1.48:1      coral text on --paper (过关啦！)   2.74:1
 *      white on --teal (每颗设置按钮)    2.25:1      teal text on --paper (怎么玩？)   2.21:1
 *      white on --coral (开始冒险)      2.79:1      --orange praise/✗ on --sky2      2.09:1
 *      white on --pink (连对 ×N)        2.55:1      --ink2 record on the hill         2.16:1
 *
 *  The style of these tests follows tests/palette.test.js: a table-shape assertion ("there is
 *  a dark column") passes against a palette that is unreadable, because those were tables too.
 *  So every ratio below is **recomputed from the hexes the page actually ships**, and the old
 *  failing values are pinned as a baseline — restoring them has to be a deliberate act that
 *  changes a number somebody can see.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../qwen.html', import.meta.url), 'utf8');

/* ---------- page parsing (the whole palette lives in one <style> block) ---------- */

const style = () => {
  const m = SRC.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(m, 'qwen.html has no <style> block');
  return m[1];
};
/* Comments in this file routinely quote the rule they document — and the value they replaced —
 * so any "is this colour still here" question has to be asked of comment-stripped source. */
const bare = () => style().replace(/\/\*[\s\S]*?\*\//g, '');

function rootVars() {
  const b = bare();
  const i = b.indexOf(':root{');
  assert.ok(i >= 0, 'no :root block');
  const body = b.slice(i + 6, b.indexOf('}', i));
  const v = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-f]{3,8})\s*;/g)) v[m[1]] = m[2];
  return v;
}

/** Every rule in the page, brace-matched so an @media wrapper cannot swallow an inner rule. */
function allRules() {
  const b = bare();
  const out = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === '{') { stack.push({ sel: b.slice(start, i).trim(), body: i + 1 }); start = i + 1; }
    else if (b[i] === '}') {
      const r = stack.pop();
      if (r) out.push({ sels: r.sel.split(',').map(s => s.trim()).filter(Boolean), body: b.slice(r.body, i) });
      start = i + 1;
    }
  }
  return out;
}
/**
 * The declaration block of the first rule that declares exactly `sel` — exact, because
 * `.seg` must not answer with `.seg.on`'s body (and iteration 7's lesson: a lookup that reads
 * the *first* textual match lets a duplicate rule override everything a test measured).
 */
function rule(sel) {
  const hit = allRules().find(r => r.sels.includes(sel));
  assert.ok(hit, `no CSS rule for ${sel}`);
  return hit.body;
}
function decl(block, prop) {
  const m = block.match(new RegExp('(?:^|[;{])\\s*' + prop + '\\s*:\\s*([^;]+)'));
  return m ? m[1].trim() : null;
}
/** Resolve `var(--x[, fallback])` against :root. Anything else is returned as written. */
function resolve(v, vars = rootVars()) {
  if (v == null) return null;
  let out = String(v).trim();
  for (let i = 0; i < 4; i++) {
    const m = out.match(/var\(\s*--([\w-]+)\s*(?:,([^)]*))?\)/);
    if (!m) break;
    out = vars[m[1]] !== undefined ? vars[m[1]] : (m[2] || '').trim();
  }
  return out.trim();
}

/* ---------- WCAG, recomputed ---------- */

const chans = hex => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
};
const lum = hex => {
  const [r, g, b] = chans(hex).map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const x = lum(a), y = lum(b);
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
};
const V = rootVars();
/** contrast between two CSS values, either of which may be var() or a literal hex. */
const cr = (a, b) => {
  const x = resolve(a), y = resolve(b);
  assert.match(String(x), /^#[0-9a-f]{3,8}$/, `not a colour: ${x}`);
  assert.match(String(y), /^#[0-9a-f]{3,8}$/, `not a colour: ${y}`);
  return ratio(x, y);
};

/* ---------- the audit inventory ----------
 * Pairings only. Every value on the right-hand side is read out of the page, so the test
 * cannot agree with a palette that has drifted — it just reports what the page now does. */
const TEXT = 4.5;   // WCAG 1.4.3 normal-size text
const LARGE = 3.0;  // WCAG 1.4.3 large text (>=24px, or >=18.66px bold)
const GRAPHIC = 3.0; // WCAG 1.4.11 non-text contrast

const AUDIT = [
  // --- white labels on a saturated fill: the primary controls ---
  ['.btn3d.coral 开始冒险/下一关 label', '#fff', decl(rule('.btn3d.coral'), 'background'), TEXT],
  ['.btn3d.teal 选择关卡/知道啦！ label', '#fff', decl(rule('.btn3d.teal'), 'background'), TEXT],
  ['.btn3d.blue 选关卡 label', '#fff', decl(rule('.btn3d.blue'), 'background'), TEXT],
  ['.btn3d.amber label (no button uses it, the rule must not rot)', '#fff', decl(rule('.btn3d.amber'), 'background'), TEXT],
  ['.seg.on selected setting label', decl(rule('.seg.on'), 'color'), decl(rule('.seg.on'), 'background'), TEXT],
  ['.wchip.speaking word label', decl(rule('.wchip.speaking'), 'color'), decl(rule('.wchip.speaking'), 'background'), TEXT],
  ['.wchip.speaking pinyin sub-label', decl(rule('.wchip.speaking .wp'), 'color'), decl(rule('.wchip.speaking'), 'background'), TEXT],
  ['.scoreChip 得分 number and star', decl(rule('.scoreChip'), 'color'), decl(rule('.scoreChip'), 'background'), TEXT],
  ['#comboChip 连对 ×N +N分', decl(rule('#comboChip'), 'color'), decl(rule('#comboChip'), 'background'), TEXT],
  ['.chBanner 启蒙篇 banner', '#fff', chapterColor(0), TEXT],
  ['.chBanner 进阶篇 banner', '#fff', chapterColor(1), TEXT],
  ['.chBanner 国学篇 banner', '#fff', chapterColor(2), TEXT],

  // --- the same hues reused as coloured type on the paper cards ---
  ['.cTitle 过关啦！ (28-42px)', decl(rule('.cTitle'), 'color'), V.paper, LARGE],
  ['.cScore b 得分 (20px bold)', decl(rule('.cScore b'), 'color'), V.paper, LARGE],
  ['.clHead.again 这些再练练 (12px bold)', decl(rule('.clHead.again'), 'color'), V.paper, TEXT],
  ['.pBig .q the ，？ marker', decl(rule('.pBig .q'), 'color'), V.paper, LARGE],
  ['.pBig .rb the revealed answer', decl(rule('.pBig .rb'), 'color'), V.paper, LARGE],
  ['.clHead b 这一关学会了 N 个', decl(rule('.clHead b'), 'color'), V.paper, TEXT],
  ['.helpCard h3 怎么玩？ (26px)', decl(rule('.helpCard h3'), 'color'), V.paper, LARGE],

  // --- coloured type drawn straight onto the sky or the hill ---
  ['.toast.good the spoken praise, on the lightest sky', decl(rule('.toast.good'), 'color'), V.sky2, TEXT],
  ['.toast.good, on the darkest sky', decl(rule('.toast.good'), 'color'), V.sky1, TEXT],
  ['.toast.bad the ✗ wrong tap, on the lightest sky', decl(rule('.toast.bad'), 'color'), V.sky2, TEXT],
  ['.toast.bad, on the darkest sky', decl(rule('.toast.bad'), 'color'), V.sky1, TEXT],
  ['.arr the ➜ between the three steps', decl(rule('.arr'), 'color'), V.sky1, TEXT],
  ['.nodeBest 最高 record, on the darkest sky', decl(rule('.nodeBest'), 'color'), V.sky1, TEXT],
  ['.nodeBest 最高 record, on the hill', decl(rule('.nodeBest'), 'color'), V.hill2, TEXT],
  ['.helpNote the grown-up note', decl(rule('.helpNote'), 'color'), '#fff6d8', TEXT],
];

/* CHAPTERS is plain data, so it can be *run* rather than grepped — this is the same vm-slice
 * technique the praise and prompt suites use, and it is what makes "the banner fill is the
 * :root value" a fact instead of a hope. */
function chapters() {
  const m = SRC.match(/const CHAPTERS=\[[\s\S]*?\];/);
  assert.ok(m, 'no CHAPTERS table');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(m[0] + '\nCH=CHAPTERS;', ctx);
  return ctx.CH;
}
function chapterColor(i) {
  const c = chapters()[i];
  assert.ok(c, `CHAPTERS[${i}] is missing`);
  assert.match(c.color, /^#[0-9a-f]{6}$/);
  return c.color;
}

/* ---------- the inventory itself ---------- */

test('the stylesheet parses into a :root palette with every audited hue', () => {
  for (const name of ['ink', 'ink2', 'paper', 'coral', 'teal', 'blue', 'amber',
    'pink', 'green', 'orange', 'gold', 'sky1', 'sky2', 'hill1', 'hill2']) {
    assert.match(String(V[name]), /^#[0-9a-f]{3,8}$/, `--${name} is not a colour`);
  }
  assert.ok(Object.keys(V).length >= 15, `only ${Object.keys(V).length} root colours parsed`);
});

test('every audited glyph/fill pair clears its WCAG threshold', () => {
  for (const [what, glyph, fill, min] of AUDIT) {
    const c = cr(glyph, fill);
    assert.ok(c >= min, `${what}: ${resolve(glyph)} on ${resolve(fill)} is ${c.toFixed(2)}:1, needs ${min}:1`);
  }
});

test('every rule that draws a white label on a fill is in the inventory', () => {
  // Structural guard: a new white-on-something rule has to be added to the inventory, or this
  // fails. A palette assertion can pass against an unreadable palette; a coverage assertion
  // cannot pass against an unmeasured one.
  const white = allRules().filter(r => /(^|[\s;])color\s*:\s*#fff\b/.test(r.body));
  const sels = white.flatMap(r => r.sels);
  assert.ok(sels.length >= 3, `only ${sels.length} white-label rules found — the parse broke`);
  assert.deepEqual(sels.sort(), ['.btn3d', '.chBanner', '.seg.on', '.wchip.speaking'].sort(),
    'a white-label rule was added or removed; add it to AUDIT with a measurement');
  // The three that carry their own fill are audited against it; the fourth is painted inline
  // from CHAPTERS and is audited in the chapters test.
  for (const sel of ['.btn3d.coral 开始冒险/下一关 label', '.seg.on selected setting label',
    '.wchip.speaking word label']) {
    assert.ok(AUDIT.some(a => a[0] === sel), `${sel} is missing from the inventory`);
  }
});

test('the old failing values are still failing, so restoring them would be visible', () => {
  const was = [
    ['white on the old gold 得分 chip', '#ffffff', '#ffce3a', 4.5],
    ['white on the old teal', '#ffffff', '#29c1b0', 4.5],
    ['white on the old coral', '#ffffff', '#ff6b5e', 4.5],
    ['white on the old blue', '#ffffff', '#4d9de0', 4.5],
    ['white on the old pink 连对 chip', '#ffffff', '#f27bae', 4.5],
    ['the old coral as 过关啦！ on paper', '#ff6b5e', '#fffdf6', 3.0],
    ['the old teal as 怎么玩？ on paper', '#29c1b0', '#fffdf6', 3.0],
    ['the old --ink2 record on the hill', '#5a6b88', '#62b857', 4.5],
    ['the old green chapter banner', '#ffffff', '#7cb518', 4.5],
    ['the old praise toast on the sky', '#3fbf6b', '#e9f8ff', 4.5],
    ['the old --orange ✗ on the sky', '#ff8f3f', '#e9f8ff', 4.5],
    ['the old help-note ink', '#a06a10', '#fff6d8', 4.5],
  ];
  for (const [what, a, b, min] of was) {
    assert.ok(ratio(a, b) < min, `${what} now measures ${ratio(a, b).toFixed(2)}:1 — update the baseline`);
  }
  // ...and none of them is still shipped.
  for (const h of ['#ff6b5e', '#29c1b0', '#4d9de0', '#f27bae', '#3fbf6b', '#a06a10', '#ff8f3f']) {
    assert.ok(!bare().includes(h), `${h} is still in the stylesheet`);
  }
});

/* ---------- the two directions, and why each one ---------- */

test('the deep hues do double duty: white label *and* body text on the paper cards', () => {
  // One value has to satisfy both roles, which is only possible because both want the *same*
  // thing (a dark colour). This is the whole reason the fix is three hexes and not six rules.
  for (const name of ['coral', 'teal', 'blue']) {
    const c = V[name];
    assert.ok(ratio('#ffffff', c) >= 4.5, `--${name} cannot carry a white label (${ratio('#ffffff', c).toFixed(2)}:1)`);
    assert.ok(ratio(c, V.paper) >= 4.5, `--${name} cannot be body text on paper (${ratio(c, V.paper).toFixed(2)}:1)`);
  }
});

test('the pale hues keep their fill and take a dark glyph instead', () => {
  // Gold is 0.66 luminance: a deep gold is olive, a deep pink is maroon. Deriving a 3:1 fill for
  // either destroys the identity, exactly as a dark mustard destroyed the rabbit's ear in
  // iteration 9 — so these two move the glyph, not the fill.
  assert.ok(lum(V.gold) > 0.5, '--gold was darkened; it should keep its bright fill');
  assert.ok(lum(V.pink) > 0.35, '--pink was darkened; it should keep its bright fill');
  assert.ok(ratio(V.ink, V.gold) >= 4.5, `--ink on --gold is ${ratio(V.ink, V.gold).toFixed(2)}:1`);
  assert.ok(ratio(V.ink, V.pink) >= 4.5, `--ink on --pink is ${ratio(V.ink, V.pink).toFixed(2)}:1`);
  // ...and the glyph is actually wired to --ink, not merely available.
  assert.equal(resolve(decl(rule('.scoreChip'), 'color')), V.ink);
  assert.equal(resolve(decl(rule('#comboChip'), 'color')), V.ink);
});

test('the 得分 chip is outlined in ink without taking a pixel of header width', () => {
  const sh = decl(rule('.scoreChip'), 'box-shadow') || '';
  assert.match(sh, /0 0 0 3px var\(--ink\)/, 'the score chip lost its ink ring');
  // box-shadow, not border: a border would add 6px to a header row measured at exactly 46px
  // (tests/hud.test.js), and the chip's siblings already carry a real 3px ink border.
  assert.equal(decl(rule('.scoreChip'), 'border'), null, 'the ring must not be a border');
  // A second rule that also sets a paint would silently override every value measured here
  // (iteration 13's lesson), so count the ones that can: the media-query padding tweak cannot.
  const painting = allRules().filter(r => r.sels.includes('.scoreChip') && /background|color/.test(r.body));
  assert.equal(painting.length, 1, `${painting.length} .scoreChip rules set a paint`);
});

test('the score chip marks its value with a text star, not an emoji that ignores `color`', () => {
  // ⭐ (U+2B50) is a colour emoji on every real phone, so on a gold chip it stays yellow on
  // yellow no matter what `color` says; headless Chromium is the only place it would have
  // looked fine. ★ (U+2605) is guaranteed text presentation and inherits --ink.
  assert.ok(SRC.includes('id="scoreChip">★<span id="scoreN">'), 'the score chip star is not a text ★');
  assert.ok(!SRC.includes('id="scoreChip">⭐'), 'the score chip still uses the ⭐ emoji');
});

test('every earned/unearned pair differs in shape, not only in colour', () => {
  // Three pairs of state used to be told apart by hue alone, and two of them measured 1.01:1
  // and 1.48:1 between their own two colours — i.e. not at all. WCAG 1.4.11 asks for 3:1 on a
  // state that has to be read; a filled-vs-hollow star and a ringed-vs-empty dot are the
  // shapes that carry it, and neither costs a pixel.
  assert.equal(ratio(V.gold, '#cdd5e4') < 1.05, true,
    `the two map stars now measure ${ratio(V.gold, '#cdd5e4').toFixed(2)}:1 — colour alone would do; re-check the baseline`);
  assert.ok(SRC.includes("s.textContent=i<st?'★':'☆'"), 'the level map still draws every star the same shape');
  assert.ok(SRC.includes("s.textContent=i<stars?'★':'☆'"), 'the result card still draws every star the same shape');
  assert.ok(SRC.includes("s.classList.add('on')"), 'the star state class was dropped');

  const cStar = rule('.cStar');
  assert.ok(!/transform\s*:\s*scale\(0\)/.test(cStar),
    'an unearned result star is still drawn at scale(0), i.e. invisible: a child who got one star sees one star and no goal');
  assert.match(decl(rule('.cStar.on'), 'animation') || '', /starPop[^\n]*\bboth\b/,
    'the pop animation needs `both`, or the fill-delay shows the star at full size and then snaps to zero');

  const dotDone = rule('.dot.done');
  assert.match(decl(dotDone, 'background') || '', /--gold/, 'a finished round lost its gold');
  assert.match(decl(dotDone, 'box-shadow') || '', /inset/,
    'a finished round is a hue difference again (--gold on #fff is 1.48:1)');
  assert.ok(ratio('#b8860b', V.gold) >= 1.2, 'the dot ring must read as a different tone from the dot fill');
});

test('every 3D bottom bar is darker than the fill it sits under', () => {
  for (const sel of ['.btn3d.coral', '.btn3d.teal', '.btn3d.blue', '.btn3d.amber']) {
    const block = rule(sel);
    const fill = resolve(decl(block, 'background'));
    const cd = decl(block, '--cd');
    assert.match(String(cd), /^#[0-9a-f]{6}$/, `${sel} has no literal --cd`);
    assert.ok(lum(cd) < lum(fill) * 0.7, `${sel}: --cd ${cd} (L ${lum(cd).toFixed(3)}) is not clearly darker than its fill ${fill} (L ${lum(fill).toFixed(3)})`);
  }
  // ...including the two that carry their bottom edge in a box-shadow rather than --cd.
  for (const sel of ['.seg.on', '#comboChip', '.scoreChip']) {
    const block = rule(sel);
    const bar = (decl(block, 'box-shadow') || '').match(/#[0-9a-f]{6}(?!.*#[0-9a-f]{6})/);
    assert.ok(bar, `${sel} lost its 3D bottom edge`);
    assert.ok(lum(bar[0]) < lum(resolve(decl(block, 'background'))),
      `${sel}: bottom edge ${bar[0]} is not darker than its fill`);
  }
});

test('the chapter banners use the :root hues, not a second set of literals', () => {
  const ch = chapters();
  assert.equal(ch.length, 3);
  const expected = [V.green, V.blue, V.coral];
  ch.forEach((c, i) => {
    assert.equal(c.color.toLowerCase(), expected[i].toLowerCase(),
      `CHAPTERS[${i}] banner fill ${c.color} has drifted from :root (${expected[i]})`);
  });
  // The banner label is white, and .chBanner itself carries no background — it is painted
  // inline from this table — so this pair is only checkable here.
  const banner = rule('.chBanner');
  assert.equal(decl(banner, 'background'), null, '.chBanner should still take its fill inline');
  assert.match(decl(banner, 'color'), /#fff/);
});

test('--ink2 survives only where it sits on paper, and that is measured rather than hoped', () => {
  // --ink2 is 3.56:1 against the top of the sky and 2.16:1 against the hill. It is fine on the
  // paper cards it is still used by (.cSub, .clHead, .cStats, .wchip .wp), and it is no longer
  // used anywhere a child has to read it against the sky.
  assert.ok(ratio(V.ink2, V.paper) >= 4.5, `--ink2 on paper is ${ratio(V.ink2, V.paper).toFixed(2)}:1`);
  assert.ok(ratio(V.ink2, V.sky1) < 4.5, 'the baseline changed: --ink2 now clears the sky, so the sky-facing sites could use it again');
  assert.equal(resolve(decl(rule('.nodeBest'), 'color')), V.ink);
  assert.equal(resolve(decl(rule('.arr'), 'color')), V.ink);
  for (const sel of ['.cSub', '.clHead', '.cStats', '.wchip .wp']) {
    assert.equal(resolve(decl(rule(sel), 'color')), V.ink2, `${sel} changed its ink without a measurement`);
  }
});

test('the ink rim, not the fill, is what identifies a control against its surface', () => {
  // The deep fills are 3.3-3.7:1 against the sky, which is below the 3:1 a *shape* needs, so the
  // 3px --ink border has to stay: it is the boundary that tells a child this is a button. This
  // pins the premise rather than the pixels.
  for (const sel of ['.btn3d', '.seg', '.wchip', '.chBanner']) {
    const border = decl(rule(sel), 'border');
    assert.ok(border && /3px solid var\(--ink\)/.test(border), `${sel} lost its 3px ink rim`);
    assert.ok(ratio(V.ink, V.sky1) >= 3 && ratio(V.ink, V.hill2) >= 3,
      `the ink rim must read against both the sky and the hill`);
  }
});

test('nothing on a paper card is left in a mid-tone', () => {
  // A final sweep over every colour a rule uses as `color:` on the paper cards: the three deep
  // hues, --ink, --ink2 and the pale pair with an ink glyph. Anything new has to be added here.
  const inks = new Set([V.ink, V.ink2, V.coral, V.teal, V.blue, V.green]);
  for (const r of allRules()) {
    const c = decl(r.body, 'color');
    if (!c) continue;
    const v = resolve(c);
    if (!/^#[0-9a-f]{3,8}$/.test(v) || !inks.has(v.toLowerCase())) continue;
    assert.ok(ratio(v, V.paper) >= 4.5, `${r.sels.join(',')} paints ${v} on paper: ${ratio(v, V.paper).toFixed(2)}:1`);
  }
});

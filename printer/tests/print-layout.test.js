'use strict';
/**
 * Unit tests for printer/js/layout.js — US Letter page geometry, word selection,
 * stroke-order step sizing, count-grid icon tiling, and coordinate conversion.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

test('print layout: US Letter dimensions and body margins', async () => {
  const { PAGE, BODY, UNITS_H, mmToPt, pxToPt } = await import('../js/layout.js');
  assert.equal(PAGE.w, 215.9);
  assert.equal(PAGE.h, 279.4);
  assert.equal(PAGE.margin, 12.7);
  assert.equal(BODY.w, 190.5);
  assert.equal(BODY.h, 254);
  assert.equal(UNITS_H, 246);

  // 215.9mm x 279.4mm == 612pt x 792pt
  assert.ok(Math.abs(mmToPt(PAGE.w) - 612) < 0.05);
  assert.ok(Math.abs(mmToPt(PAGE.h) - 792) < 0.05);
  assert.equal(pxToPt(96), 72);
});

test('print layout: unitSlots and unitGeometry fit cleanly inside page body for 1..4 perPage', async () => {
  const { BODY, UNITS_H, PER_PAGE_OPTIONS, unitSlots, unitGeometry } = await import('../js/layout.js');
  for (const k of PER_PAGE_OPTIONS) {
    const slots = unitSlots(k);
    assert.equal(slots.length, k);
    for (const s of slots) {
      assert.ok(s.x >= 0 && s.y >= 0);
      assert.ok(s.x + s.w <= BODY.w + 0.01);
      assert.ok(s.y + s.h <= UNITS_H + 0.01);

      const g = unitGeometry(k, s);
      assert.ok(g.grid.rows >= 1 && g.grid.rows <= g.grid.maxRows);
      assert.ok(g.grid.trace >= 0 && g.grid.trace <= g.grid.rows);
      assert.ok(g.grid.y + g.grid.h <= s.h + 0.05, `grid fits vertically for perPage=${k}`);
      assert.ok(g.grid.x + g.grid.w <= s.w + 0.05, `grid fits horizontally for perPage=${k}`);
    }
  }
});

test('print layout: pickWords respects character budget and display override', async () => {
  const { SPECS, pickWords } = await import('../js/layout.js');
  // '五颜六色' is 4 chars; in 2-per-page (maxWords: 2, budget: 8), '五个' + '五月' fits
  const words = ['五个', '五颜六色', '五月', '五十'];
  assert.deepEqual(pickWords(words, null, SPECS[2]), ['五个', '五颜六色']);

  // When first word is 4 chars and next is 5 chars (exceeding budget 8), skips the 5-char word
  assert.deepEqual(pickWords(['一二三四', '一二三四五', '一二'], null, SPECS[2]), ['一二三四', '一二']);

  // Explicit display_words wins up to maxWords
  assert.deepEqual(pickWords(words, ['五十', '五月', '五个'], SPECS[2]), ['五十', '五月']);
});

test('print layout: countGrid produces non-overlapping percentage boxes for 1..10', async () => {
  const { countGrid } = await import('../js/layout.js');
  for (let n = 1; n <= 10; n++) {
    const cells = countGrid(n);
    assert.equal(cells.length, n);
    for (const c of cells) {
      assert.ok(c.x >= -0.01 && c.y >= -0.01);
      assert.ok(c.x + c.s <= 100.05 && c.y + c.s <= 100.05);
    }
  }
});

test('print layout: paginate and pageCount', async () => {
  const { paginate, pageCount } = await import('../js/layout.js');
  const items = Array.from({ length: 10 }, (_, i) => i);
  assert.equal(pageCount(10, 4), 3);
  const pages = paginate(items, 4);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages[2], [8, 9]);
});

test('print layout: sparse large Tianzige defaults and adjustable cols/rows sizing', async () => {
  const { PER_PAGE_OPTIONS, unitSlots, unitGeometry } = await import('../js/layout.js');
  for (const k of PER_PAGE_OPTIONS) {
    const slot = unitSlots(k)[0];
    const defGeom = unitGeometry(k, slot);
    // Default Tianzige cells are >= 21mm square with positive inter-cell and inter-row gaps
    assert.ok(defGeom.grid.cell >= 21, `perPage=${k} default cell=${defGeom.grid.cell}mm should be >= 21mm`);
    assert.ok(defGeom.grid.colGap >= 1.5, `perPage=${k} colGap=${defGeom.grid.colGap}mm should be >= 1.5mm`);
    assert.ok(defGeom.grid.rowGap >= 1.8, `perPage=${k} rowGap=${defGeom.grid.rowGap}mm should be >= 1.8mm`);

    // Decreasing cols makes each Tianzige square larger while fitting inside slot
    const fewerCols = unitGeometry(k, slot, { cols: 3 });
    assert.equal(fewerCols.grid.cols, 3);
    assert.ok(fewerCols.grid.cell > defGeom.grid.cell, `cols=3 should produce larger cell than default for perPage=${k}`);
    assert.ok(fewerCols.grid.y + fewerCols.grid.h <= slot.h + 0.05);
    assert.ok(fewerCols.grid.x + fewerCols.grid.w <= slot.w + 0.05);
  }
});

test('print layout: dashed light-grey tracing symbol uses smoothed median paths', async () => {
  const { smoothMedianToPath } = await import('../js/hanzi-data.js');
  const { renderCharUnitHtml } = await import('../js/render-sheet.js');
  const { unitSlots } = await import('../js/layout.js');

  const d = smoothMedianToPath([[121, 393], [193, 372], [417, 402], [827, 434], [920, 401]]);
  assert.ok(d.startsWith('M ') && !d.includes('NaN'));

  const html = renderCharUnitHtml(
    {
      char: '一',
      index: 0,
      pinyin: 'yī',
      radical: '一',
      strokes: 1,
      strokePaths: ['M 100 400 L 900 400 L 900 450 L 100 450 Z'],
      medianPaths: [d],
      pickedWords: ['一个'],
      illustration: { type: 'glyph' },
    },
    unitSlots(2)[0],
    0,
    0,
    { perPage: 2 },
  );
  assert.ok(html.includes('class="trace-centerline"'), 'should render dashed centerline group in trace symbol');
  assert.ok(html.includes('stroke-dasharray="28,54"'), 'trace symbol should use dashed stroke');
  assert.ok(html.includes('data-trace-style="dashed"'), 'trace cells should mark dashed trace style');
});

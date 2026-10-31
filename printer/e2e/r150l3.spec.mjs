/**
 * E2E PDF Verification for 150 Random Non-Repeating Characters at Layout 3 (`r150l3-<hex4>`).
 *
 * - Samples 150 random characters from `printer/spec/data/hanzi-1000-v6.json`
 *   while avoiding characters already recorded in `printer/e2e/output/run-history.json`.
 * - Generates a 4-hex-character run ID and prefixes all output files with `r150l3-<runId>`.
 * - Renders all 150 characters at Layout 3 (3 chars/page = 50 pages) with default large
 *   Tianzige (`5 cols × 3 rows`, `21.86mm` square cells) and light-grey dashed tracing.
 * - Exports the 50-page US Letter PDF, verifies text/fonts/geometry across all 50 pages,
 *   rasterizes sample pages for pixel-level verification, and commits the run history.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startStaticServer } from '../scripts/serve.mjs';
import {
  inspectPdfTextAndMeta,
  renderPdfPageToImage,
  cropPdfRegion,
  analyzeRegionPixels,
} from './helpers/pdf.mjs';
import { sampleNonRepeatingChars, DEFAULT_HISTORY_PATH } from './helpers/run-history.mjs';

const PRINTER_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO_ROOT = resolve(PRINTER_ROOT, '..');
const OUT_DIR = join(PRINTER_ROOT, 'e2e', 'output');
mkdirSync(OUT_DIR, { recursive: true });

async function getElementPdfRect(page, pageIdx, selector) {
  return page.evaluate(
    ({ pageIdx: pIdx, selector: sel }) => {
      const stage = document.getElementById('sheet-stage');
      const prevZoom = stage.style.getPropertyValue('--sheet-zoom');
      stage.style.setProperty('--sheet-zoom', '1');
      const pageEl = document.querySelector(`.sheet-page[data-page-index="${pIdx}"]`);
      const targetEl = pageEl?.querySelector(sel);
      if (!pageEl || !targetEl) {
        if (prevZoom) stage.style.setProperty('--sheet-zoom', prevZoom);
        return null;
      }
      const pr = pageEl.getBoundingClientRect();
      const tr = targetEl.getBoundingClientRect();
      if (prevZoom) stage.style.setProperty('--sheet-zoom', prevZoom);
      return {
        xPt: (tr.left - pr.left) * 0.75,
        yPt: (tr.top - pr.top) * 0.75,
        wPt: tr.width * 0.75,
        hPt: tr.height * 0.75,
      };
    },
    { pageIdx, selector },
  );
}

async function uploadJsonDataset(page, dataObj, filename = 'fixture.json') {
  const prevSeq = await page.evaluate(() => document.body.dataset.ingestSeq || '0');
  const buf = Buffer.from(typeof dataObj === 'string' ? dataObj : JSON.stringify(dataObj, null, 2), 'utf8');
  await page.locator('[data-testid="json-file-input"]').setInputFiles({
    name: filename,
    mimeType: 'application/json',
    buffer: buf,
  });
  await page.waitForFunction(
    (prev) => document.body.dataset.datasetReady === 'true' && document.body.dataset.ingestSeq !== prev,
    prevSeq,
  );
}

async function exportPdfBuffer(page, outPath = null) {
  await page.evaluate(() => window.__hanziPrintPrepare());
  await page.waitForFunction(() => document.body.dataset.printReady === 'true');
  const pdfBuf = await page.pdf({
    format: 'Letter',
    printBackground: true,
    preferCSSPageSize: true,
  });
  if (outPath) {
    writeFileSync(outPath, pdfBuf);
  }
  return pdfBuf;
}

test('r150l3: 150 random non-repeating characters at Layout 3 (50 pages) with run-history cache', async (t) => {
  const rawV6 = JSON.parse(readFileSync(join(PRINTER_ROOT, 'spec/data/hanzi-1000-v6.json'), 'utf8'));
  const allChars = rawV6.groups.flatMap((g) =>
    g.characters.map((c) => ({ ...c, category: g.category })),
  );
  assert.equal(allChars.length, 1000, 'hanzi-1000-v6.json must contain 1000 characters');

  const sample = sampleNonRepeatingChars(allChars, 150, {
    prefix: 'r150l3',
    layout: 3,
    historyPath: DEFAULT_HISTORY_PATH,
  });
  const { runId, runTag, picked } = sample;
  assert.equal(picked.length, 150, 'Must sample exactly 150 characters');
  assert.match(runId, /^[0-9a-f]{4}$/, 'Run ID must be a 4-character hex string');

  console.log(
    `[${runTag}] Run ID=${runId} | Previously used=${sample.previouslyUsedCount} chars | ` +
      `Remaining unused after run=${sample.remainingUnusedAfterRun} chars`,
  );
  console.log(
    `[${runTag}] Picked 150 characters:\n  ` +
      picked.map((c) => `${c.char}(${c.pinyin})`).join(', '),
  );

  const dataset = {
    meta: {
      title: `随机150字抽样字帖 (${runTag}) · 3字/页`,
      description: `Run ${runTag}: 150 non-repeating characters from hanzi-1000-v6.json at Layout 3`,
    },
    groups: [
      {
        category: `随机抽样150字 (${runTag})`,
        characters: picked.map(({ char, pinyin, words }) => ({ char, pinyin, words })),
      },
    ],
  };

  const outputFiles = [];
  const datasetPath = join(OUT_DIR, `${runTag}-dataset.json`);
  writeFileSync(datasetPath, JSON.stringify(dataset, null, 2));
  outputFiles.push(`${runTag}-dataset.json`);

  const srv = await startStaticServer({ port: 0, root: REPO_ROOT });
  t.after(async () => {
    await srv.close();
  });

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  t.after(async () => {
    await browser.close();
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 920 } });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('[pageerror]', err));

  await page.goto(`${srv.url}/printer/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.datasetReady === 'true');

  // Upload the 150-character dataset
  await uploadJsonDataset(page, dataset, `${runTag}-dataset.json`);

  // Select Layout 3 (3 chars/page -> 50 pages)
  await page.locator('[data-testid="per-page-3"]').click();
  const expectedPages = 50;

  // Verify default large Tianzige toolbar inputs for Layout 3
  const toolbarVals = await page.evaluate(() => ({
    cols: Number(document.getElementById('setting-cols')?.value || 0),
    rows: Number(document.getElementById('setting-rows')?.value || 0),
    trace: Number(document.getElementById('setting-trace')?.value || 0),
  }));
  assert.equal(toolbarVals.cols, 5, 'Layout 3 default cols must be 5');
  assert.equal(toolbarVals.rows, 3, 'Layout 3 default rows must be 3');
  assert.equal(toolbarVals.trace, 1, 'Layout 3 default trace rows must be 1');

  // Verify DOM stroke steps, large Tianzige geometry (>=21.4mm), dashed tracing & zero overflow for all 150 characters
  const domCheck = await page.evaluate(async () => {
    await window.__hanziPrintPrepare();
    const mismatches = [];
    const gridIssues = [];
    let overflowCount = 0;
    for (const unit of document.querySelectorAll('.char-unit')) {
      const ch = unit.dataset.char;
      const expectedStrokes = Number(unit.querySelector('[data-field="strokes"]')?.textContent);
      const stepBoxes = unit.querySelectorAll('[data-stroke-ribbon] .stroke-step').length;
      if (stepBoxes !== expectedStrokes) {
        mismatches.push({ ch, expectedStrokes, stepBoxes });
      }
      const grid = unit.querySelector('.unit-grid');
      const cellMm = Number(grid?.dataset.gridCellMm || 0);
      const cols = Number(grid?.dataset.gridCols || 0);
      const rows = Number(grid?.dataset.gridRows || 0);
      const trace = Number(grid?.dataset.gridTrace || 0);
      const traceUse = grid?.querySelector('.glyph-trace');
      const centerlines = unit.querySelectorAll('.trace-centerline path').length;
      if (!traceUse || traceUse.dataset.traceStyle !== 'dashed' || centerlines !== expectedStrokes) {
        gridIssues.push({ ch, traceStyle: traceUse?.dataset.traceStyle, centerlines, expectedStrokes });
      }
      if (cellMm < 21.4 || cols !== 5 || rows !== 3 || trace !== 1) {
        gridIssues.push({ ch, cellMm, cols, rows, trace });
      }
      const info = unit.querySelector('.unit-info');
      if (info && (info.scrollWidth > info.clientWidth + 2 || info.scrollHeight > info.clientHeight + 2)) {
        overflowCount++;
      }
      const track = unit.querySelector('.stroke-track');
      if (track && track.scrollHeight > track.clientHeight + 2) {
        overflowCount++;
      }
    }
    return {
      mismatches,
      gridIssues,
      overflowCount,
      totalUnits: document.querySelectorAll('.char-unit').length,
      totalPages: document.querySelectorAll('.sheet-page').length,
    };
  });

  assert.equal(domCheck.totalPages, expectedPages, 'Must render 50 sheet pages in DOM');
  assert.equal(domCheck.totalUnits, 150, 'Must render all 150 character units in DOM');
  assert.deepEqual(domCheck.mismatches, [], 'All 150 stroke ribbons must match character stroke counts');
  assert.deepEqual(domCheck.gridIssues, [], 'All 150 units must have 21.86mm large Tianzige & dashed centerlines');
  assert.equal(domCheck.overflowCount, 0, 'Zero info card or stroke-ribbon overflow across all 150 characters');

  // Save workbench UI screenshot
  const uiPngName = `${runTag}-workbench-ui.png`;
  await page.screenshot({ path: join(OUT_DIR, uiPngName), fullPage: false });
  outputFiles.push(uiPngName);

  // Export 50-page US Letter PDF
  const pdfName = `${runTag}.pdf`;
  const pdfPath = join(OUT_DIR, pdfName);
  const pdfBuf = await exportPdfBuffer(page, pdfPath);
  outputFiles.push(pdfName);

  // Inspect all 50 PDF pages
  const info = await inspectPdfTextAndMeta(pdfBuf);
  assert.equal(info.numPages, expectedPages, 'PDF must have exactly 50 pages');
  assert.ok(info.fontNames.some((f) => /WenKai|g_d/i.test(f)), 'Embedded LXGW WenKai font must be present');

  for (let p = 0; p < expectedPages; p++) {
    const pageInfo = info.pages[p];
    assert.ok(Math.abs(pageInfo.widthPt - 612) < 1, `Page ${p + 1} widthPt=${pageInfo.widthPt}`);
    assert.ok(Math.abs(pageInfo.heightPt - 792) < 1, `Page ${p + 1} heightPt=${pageInfo.heightPt}`);
    assert.ok(pageInfo.text.includes(`- ${p + 1} -`), `Page ${p + 1} footer must contain "- ${p + 1} -"`);

    const slice = picked.slice(p * 3, (p + 1) * 3);
    for (const item of slice) {
      assert.ok(pageInfo.text.includes(item.char), `Page ${p + 1} PDF text must include char ${item.char}`);
      assert.ok(pageInfo.text.includes(item.pinyin), `Page ${p + 1} PDF text must include pinyin ${item.pinyin}`);
      assert.ok(pageInfo.text.includes(item.words[0]), `Page ${p + 1} PDF text must include word ${item.words[0]}`);
    }
  }

  // Rasterize and pixel-verify sample pages across the 50-page PDF (pages 1, 10, 20, 30, 40, 50)
  const samplePages = [1, 10, 20, 30, 40, 50];
  for (const pageNum of samplePages) {
    const pIdx = pageNum - 1;
    const rendered = await renderPdfPageToImage(pdfBuf, pageNum, 2);
    const pngName = `${runTag}-page${String(pageNum).padStart(2, '0')}.png`;
    writeFileSync(join(OUT_DIR, pngName), rendered.pngBuffer);
    outputFiles.push(pngName);

    const slice = picked.slice(pIdx * 3, (pIdx + 1) * 3);
    for (const item of slice) {
      const rectPt = await getElementPdfRect(page, pIdx, `.unit-art[data-illustration-slot="${item.char}"]`);
      assert.ok(rectPt, `Illustration rect for "${item.char}" on page ${pageNum}`);
      const stats = analyzeRegionPixels(cropPdfRegion(rendered, rectPt, 2));
      assert.ok(
        stats.nonWhiteRatio > 0.015,
        `Page ${pageNum} char "${item.char}" illustration must be non-empty (nonWhite=${stats.nonWhiteRatio.toFixed(3)})`,
      );
    }

    // Verify red model cell, light-grey dashed trace cell, and blank cell on the first character of the page
    const firstChar = slice[0].char;
    const modelRect = await getElementPdfRect(page, pIdx, `.char-unit[data-char="${firstChar}"] .grid-cell[data-cell="0-0"]`);
    const traceRect = await getElementPdfRect(page, pIdx, `.char-unit[data-char="${firstChar}"] .grid-cell[data-cell="0-1"]`);
    const blankRect = await getElementPdfRect(page, pIdx, `.char-unit[data-char="${firstChar}"] .grid-cell[data-cell="2-1"]`);
    const modelStats = analyzeRegionPixels(cropPdfRegion(rendered, modelRect, 3));
    const traceStats = analyzeRegionPixels(cropPdfRegion(rendered, traceRect, 3));
    const blankStats = analyzeRegionPixels(cropPdfRegion(rendered, blankRect, 3));

    assert.ok(modelStats.redPixels > 15 && modelStats.redRatio > 0.2, `Page ${pageNum} "${firstChar}" col 0 must have red model glyph`);
    assert.ok(traceStats.greyPixels > 15 && traceStats.redPixels === 0, `Page ${pageNum} "${firstChar}" trace cell must have light-grey dashed glyph`);
    assert.ok(traceStats.nonWhiteRatio > blankStats.nonWhiteRatio + 0.02, `Page ${pageNum} "${firstChar}" trace cell must have more ink than blank cell`);
  }

  // Commit run history only after all assertions pass
  const updatedHistory = sample.commitRun(outputFiles);
  console.log(
    `[${runTag}] Saved 50-page PDF and ${outputFiles.length} artifacts to printer/e2e/output/.\n` +
      `[${runTag}] Updated run history cache (${DEFAULT_HISTORY_PATH}): total unique used=${updatedHistory.totalUniqueUsed}/1000 chars.`,
  );
});

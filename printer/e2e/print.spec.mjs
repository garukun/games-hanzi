/**
 * End-to-End PDF Verification Suite for the Hanzi Practice-Sheet Workbench.
 *
 * Drives the real browser UI via Playwright, prints to actual US Letter PDFs via
 * `page.pdf()`, and verifies the resulting PDFs using `pdfjs-dist` (text, page size,
 * page count, embedded fonts) and rasterized pixel analysis (illustration presence,
 * connected-component count for 四=4 pineapples, Tianzige red model vs grey trace cells,
 * visual regression against golden PNGs, and 1000-character 250-page stress testing).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startStaticServer } from '../scripts/serve.mjs';
import {
  inspectPdfTextAndMeta,
  renderPdfPageToImage,
  cropPdfRegion,
  analyzeRegionPixels,
  countIllustrationBlobs,
  comparePngBuffers,
  createSolidPngBuffer,
} from './helpers/pdf.mjs';

const PRINTER_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO_ROOT = resolve(PRINTER_ROOT, '..');
const OUT_DIR = join(PRINTER_ROOT, 'e2e', 'output');
const GOLDEN_DIR = join(PRINTER_ROOT, 'e2e', 'golden');
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(GOLDEN_DIR, { recursive: true });

// 12-character fixture covering all 3 illustration types:
//   - emoji+count: 一(1), 二(2), 三(3), 四(4 pineapples), 五(5), 六(6)
//   - single emoji: 人, 口, 日, 月
//   - colour-glyph (3D sticker): 千, 正
const FIXTURE_12 = {
  meta: {
    title: '端到端测试字帖（12字全类型覆盖）',
    description: '覆盖数量重复图标、单图标与彩色立体字三种插图类型',
  },
  groups: [
    {
      category: '1. 测试生字组',
      characters: [
        { char: '一', pinyin: 'yī', words: ['一个', '一天', '一月', '一生'] },
        { char: '二', pinyin: 'èr', words: ['二月', '二十', '二人', '二号'] },
        { char: '三', pinyin: 'sān', words: ['三天', '三个', '三月', '三年'] },
        { char: '四', pinyin: 'sì', words: ['四季', '四方', '四个', '四月'] },
        { char: '五', pinyin: 'wǔ', words: ['五个', '五月', '五官', '五十'] },
        { char: '六', pinyin: 'liù', words: ['六个', '六月', '六十', '六一'] },
        { char: '人', pinyin: 'rén', words: ['人们', '大人', '好人', '人口'] },
        { char: '口', pinyin: 'kǒu', words: ['门口', '口水', '人口', '出口'] },
        { char: '日', pinyin: 'rì', words: ['日出', '日月', '生日', '节日'] },
        { char: '月', pinyin: 'yuè', words: ['月亮', '月光', '一月', '岁月'] },
        { char: '千', pinyin: 'qiān', words: ['千万', '千里', '秋千', '千山'] },
        { char: '正', pinyin: 'zhèng', words: ['正在', '立正', '端正', '正好'] },
      ],
    },
  ],
};

/** Measure an element's bounding box in PDF points (72 dpi) relative to its `.sheet-page`. */
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

/** Upload a JSON object via the file input and wait for dataset readiness. */
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

/** Prepare all pages and generate a US Letter PDF via Playwright. */
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

test('E2E PDF Verification Suite', async (t) => {
  const srv = await startStaticServer({ port: 0, root: REPO_ROOT });
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());

  t.after(async () => {
    await browser.close();
    await srv.close();
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 920 },
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('[pageerror]', err));

  await page.goto(`${srv.url}/printer/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.datasetReady === 'true');

  // ---------------------------------------------------------------------------
  // 1. Basic Layouts × 4 (1, 2, 3, 4 chars per page) + Font & Stroke-Ribbon Checks
  // ---------------------------------------------------------------------------
  await t.test('1. Basic layouts (1/2/3/4 chars/page): PDF page count, 612x792pt size, text order, stroke ribbon & embedded font', async () => {
    await uploadJsonDataset(page, FIXTURE_12, 'fixture-12.json');

    for (const perPage of [1, 2, 3, 4]) {
      await page.locator(`[data-testid="per-page-${perPage}"]`).click();
      const expectedPages = Math.ceil(FIXTURE_12.groups[0].characters.length / perPage);

      // Verify DOM stroke ribbon steps match stroke counts and have zero horizontal/vertical overflow
      const domAudit = await page.evaluate(async () => {
        await window.__hanziPrintPrepare();
        const strokeMismatches = [];
        for (const unit of document.querySelectorAll('.char-unit')) {
          const ch = unit.dataset.char;
          const expectedStrokes = Number(unit.querySelector('[data-field="strokes"]')?.textContent);
          const ribbon = unit.querySelector('[data-stroke-ribbon]');
          const stepBoxes = ribbon ? ribbon.querySelectorAll('.stroke-step').length : 0;
          if (stepBoxes !== expectedStrokes) {
            strokeMismatches.push({ ch, expectedStrokes, stepBoxes });
          }
          // Check last step contains all `expectedStrokes` path elements
          const lastStepPaths = ribbon?.querySelector(`.stroke-step[data-step="${expectedStrokes}"]`)?.querySelectorAll('path').length || 0;
          if (lastStepPaths !== expectedStrokes) {
            strokeMismatches.push({ ch, expectedStrokes, lastStepPaths });
          }
        }
        return { strokeMismatches };
      });
      assert.deepEqual(domAudit.strokeMismatches, [], `stroke steps must match stroke count for perPage=${perPage}`);

      const pdfPath = join(OUT_DIR, `layout-${perPage}.pdf`);
      const pdfBuf = await exportPdfBuffer(page, pdfPath);
      const info = await inspectPdfTextAndMeta(pdfBuf);

      assert.equal(info.numPages, expectedPages, `perPage=${perPage} should produce ${expectedPages} pages`);

      // Verify embedded LXGW WenKai font is present in PDF
      assert.ok(
        info.fontNames.some((f) => /WenKai|g_d/i.test(f)),
        `PDF should contain embedded font (got ${info.fontNames.join(', ')})`,
      );

      for (let p = 0; p < expectedPages; p++) {
        const pageInfo = info.pages[p];
        // US Letter = 612 x 792 pt
        assert.ok(Math.abs(pageInfo.widthPt - 612) < 1, `page ${p + 1} widthPt=${pageInfo.widthPt}`);
        assert.ok(Math.abs(pageInfo.heightPt - 792) < 1, `page ${p + 1} heightPt=${pageInfo.heightPt}`);

        // Page number continuity
        assert.ok(pageInfo.text.includes(`- ${p + 1} -`), `page ${p + 1} footer should contain "- ${p + 1} -"`);

        // Verify every character assigned to this page has its char, pinyin, radical, strokes, and words in PDF text
        const slice = FIXTURE_12.groups[0].characters.slice(p * perPage, (p + 1) * perPage);
        for (const item of slice) {
          assert.ok(pageInfo.text.includes(item.char), `page ${p + 1} PDF text must include char ${item.char}`);
          assert.ok(pageInfo.text.includes(item.pinyin), `page ${p + 1} PDF text must include pinyin ${item.pinyin}`);
          assert.ok(pageInfo.text.includes(item.words[0]), `page ${p + 1} PDF text must include first word ${item.words[0]}`);
        }
      }

      // Render page 1 of each layout to PNG & perform visual regression comparison
      const renderedP1 = await renderPdfPageToImage(pdfBuf, 1, 2);
      const outPngPath = join(OUT_DIR, `layout-${perPage}-page1.png`);
      writeFileSync(outPngPath, renderedP1.pngBuffer);

      const goldenPath = join(GOLDEN_DIR, `layout-${perPage}.png`);
      if (!existsSync(goldenPath)) {
        writeFileSync(goldenPath, renderedP1.pngBuffer);
      } else {
        const goldenBuf = readFileSync(goldenPath);
        const cmp = comparePngBuffers(renderedP1.pngBuffer, goldenBuf);
        assert.ok(
          cmp.mismatchRatio < 0.005,
          `Visual regression for layout-${perPage}: diff ${(cmp.mismatchRatio * 100).toFixed(3)}% exceeds 0.5%`,
        );
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Illustrations Guaranteed Non-Empty + Connected Component Count for "四" = 4
  // ---------------------------------------------------------------------------
  await t.test('2. Illustrations in PDF: all 12 slots non-empty & saturated across emoji/count/glyph; "四" has exactly 4 icons', async () => {
    await page.locator('[data-testid="per-page-2"]').click();
    const pdfBuf = await exportPdfBuffer(page);

    // 12 chars at 2 per page = 6 pages
    for (let pIdx = 0; pIdx < 6; pIdx++) {
      const rendered = await renderPdfPageToImage(pdfBuf, pIdx + 1, 2);
      const slice = FIXTURE_12.groups[0].characters.slice(pIdx * 2, pIdx * 2 + 2);

      for (const item of slice) {
        const rectPt = await getElementPdfRect(page, pIdx, `.unit-art[data-illustration-slot="${item.char}"]`);
        assert.ok(rectPt, `DOM rect for illustration slot ${item.char} on page ${pIdx + 1}`);

        const crop = cropPdfRegion(rendered, rectPt, 2);
        const stats = analyzeRegionPixels(crop);

        assert.ok(
          stats.nonWhiteRatio > 0.03,
          `Illustration for "${item.char}" must not be blank (nonWhiteRatio=${stats.nonWhiteRatio.toFixed(3)})`,
        );
        assert.ok(
          stats.coloredRatio > 0.15 && stats.meanSaturation > 0.12,
          `Illustration for "${item.char}" must be colourful (coloredRatio=${stats.coloredRatio.toFixed(3)}, sat=${stats.meanSaturation.toFixed(3)})`,
        );

        // Specifically verify connected component count for "四" (4 pineapples)
        if (item.char === '四') {
          const blobs = countIllustrationBlobs(crop, { dilationRadius: 2, minAreaRatio: 0.01 });
          assert.equal(blobs, 4, `"四" illustration in PDF must contain exactly 4 pineapple icons (got ${blobs})`);
        }
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Tianzige Practice Grid & Tracing Pixel Verification in PDF
  // ---------------------------------------------------------------------------
  await t.test('3. Tianzige & tracing in PDF: col 0 has red model char, trace rows have grey chars, blank rows are empty', async () => {
    const pdfBuf = await exportPdfBuffer(page);
    const renderedP2 = await renderPdfPageToImage(pdfBuf, 2, 2); // Page 2 has 三 and 四

    // Measure 3 cells of "四" on page index 1:
    //   - (0, 0): model cell (red)
    //   - (0, 1): trace cell (light grey)
    //   - (5, 1): blank cell (empty grid)
    const modelRect = await getElementPdfRect(page, 1, '.char-unit[data-char="四"] .grid-cell[data-cell="0-0"]');
    const traceRect = await getElementPdfRect(page, 1, '.char-unit[data-char="四"] .grid-cell[data-cell="0-1"]');
    const blankRect = await getElementPdfRect(page, 1, '.char-unit[data-char="四"] .grid-cell[data-cell="5-1"]');

    const modelStats = analyzeRegionPixels(cropPdfRegion(renderedP2, modelRect, 3));
    const traceStats = analyzeRegionPixels(cropPdfRegion(renderedP2, traceRect, 3));
    const blankStats = analyzeRegionPixels(cropPdfRegion(renderedP2, blankRect, 3));

    assert.ok(
      modelStats.redPixels > 25 && modelStats.redRatio > 0.25,
      `Col 0 model cell must contain red model glyph (redPixels=${modelStats.redPixels}, redRatio=${modelStats.redRatio.toFixed(2)})`,
    );
    assert.ok(
      traceStats.greyPixels > 25 && traceStats.redPixels === 0,
      `Trace cell (0,1) must contain grey tracing glyph and no red (greyPixels=${traceStats.greyPixels})`,
    );
    assert.ok(
      traceStats.nonWhiteRatio > blankStats.nonWhiteRatio + 0.03,
      `Trace cell must have significantly more ink than blank cell (${traceStats.nonWhiteRatio.toFixed(3)} vs ${blankStats.nonWhiteRatio.toFixed(3)})`,
    );

    // Verify dashed light-grey tracing DOM attributes & adjustable cols control
    const traceDomInfo = await page.evaluate(() => {
      const grid = document.querySelector('.char-unit[data-char="四"] .unit-grid');
      const traceUse = grid?.querySelector('.glyph-trace');
      const centerlines = document.querySelectorAll('.char-unit[data-char="四"] .trace-centerline path').length;
      return {
        cellMm: Number(grid?.dataset.gridCellMm || 0),
        cols: Number(grid?.dataset.gridCols || 0),
        traceStyle: traceUse?.dataset.traceStyle || '',
        centerlines,
      };
    });
    assert.equal(traceDomInfo.traceStyle, 'dashed', 'Tracing glyphs must use dashed style');
    assert.equal(traceDomInfo.centerlines, 5, '"四" tracing symbol must have 5 dashed centerline stroke paths');
    assert.ok(traceDomInfo.cellMm >= 21, `Default 2-per-page Tianzige cell should be >= 21mm (got ${traceDomInfo.cellMm}mm)`);

    // Lower setting-cols from 4 to 3 -> cell size grows even larger
    await page.locator('[data-testid="setting-cols"]').fill('3');
    await page.locator('[data-testid="setting-cols"]').dispatchEvent('change');
    const sparserCellMm = await page.evaluate(() =>
      Number(document.querySelector('.char-unit[data-char="四"] .unit-grid')?.dataset.gridCellMm || 0),
    );
    assert.ok(sparserCellMm > traceDomInfo.cellMm + 5, `Setting cols=3 must enlarge each Tianzige cell (${sparserCellMm}mm vs ${traceDomInfo.cellMm}mm)`);

    // Restore cols=4
    await page.locator('[data-testid="setting-cols"]').fill('4');
    await page.locator('[data-testid="setting-cols"]').dispatchEvent('change');
  });

  // ---------------------------------------------------------------------------
  // 4. Per-Character Fine-Tuning (Words, Emoji Swap, Custom PNG Upload) -> PDF Check
  // ---------------------------------------------------------------------------
  await t.test('4. Per-character fine-tuning: word edit ("四季" -> "四周"), icon swap, and custom PNG upload verified in PDF', async () => {
    // Capture baseline pixel hash for "四" illustration on page 2 (pageIdx 1)
    const pdfBefore = await exportPdfBuffer(page);
    const renderedBefore = await renderPdfPageToImage(pdfBefore, 2, 2);
    const siArtRect = await getElementPdfRect(page, 1, '.unit-art[data-illustration-slot="四"]');
    const hashBefore = analyzeRegionPixels(cropPdfRegion(renderedBefore, siArtRect, 2)).hash;

    // Click "四" unit in preview to open editor
    await page.locator('.char-unit[data-char="四"]').click();
    await page.locator('[data-testid="edit-word-item-0"]').fill('四周');
    await page.locator('[data-testid="edit-word-item-0"]').dispatchEvent('change');

    // Swap illustration of "四" to another emoji ("watermelon") via picker
    await page.locator('[data-testid="emoji-search-input"]').fill('watermelon');
    await page.locator('.emoji-pick-btn[data-emoji-id="watermelon"]').click();
    await page.waitForSelector('.unit-art[data-illustration-slot="四"] img[data-emoji-id="watermelon"]');

    const pdfAfterSwap = await exportPdfBuffer(page, join(OUT_DIR, 'edited-swap.pdf'));
    const textAfterSwap = await inspectPdfTextAndMeta(pdfAfterSwap);
    const page2Text = textAfterSwap.pages[1].text;

    assert.ok(page2Text.includes('四周'), 'Updated word "四周" must appear in PDF page 2');
    assert.ok(!page2Text.includes('四季'), 'Replaced word "四季" must no longer appear in PDF page 2');

    const renderedAfterSwap = await renderPdfPageToImage(pdfAfterSwap, 2, 2);
    const hashAfterSwap = analyzeRegionPixels(cropPdfRegion(renderedAfterSwap, siArtRect, 2)).hash;
    assert.notEqual(hashAfterSwap, hashBefore, 'Illustration pixel hash in PDF must change after swapping emoji');

    // Now test custom PNG upload on "四"
    const customGreenPng = createSolidPngBuffer(64, 64, [15, 190, 85, 255]);
    await page.locator('[data-testid="edit-image-upload"]').setInputFiles({
      name: 'custom-card.png',
      mimeType: 'image/png',
      buffer: customGreenPng,
    });
    await page.waitForSelector('.unit-art[data-illustration-slot="四"][data-illustration-type="upload"]');

    const pdfAfterUpload = await exportPdfBuffer(page, join(OUT_DIR, 'edited-upload.pdf'));
    const renderedAfterUpload = await renderPdfPageToImage(pdfAfterUpload, 2, 2);
    const uploadStats = analyzeRegionPixels(cropPdfRegion(renderedAfterUpload, siArtRect, 2));
    assert.notEqual(uploadStats.hash, hashAfterSwap, 'Custom uploaded PNG must change PDF illustration pixels');
    assert.ok(uploadStats.coloredRatio > 0.4, 'Uploaded green PNG must render with high colour ratio in PDF');
  });

  // ---------------------------------------------------------------------------
  // 5. Persistence & Merged JSON Export/Re-Import -> PDF Identity Check
  // ---------------------------------------------------------------------------
  await t.test('5. Persistence across page reload and merged JSON export/re-upload produces identical PDF', async () => {
    // Reload page and re-upload the same fixture-12.json (same fileHash -> restores overrides from IndexedDB/localStorage)
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.dataset.datasetReady === 'true');
    await uploadJsonDataset(page, FIXTURE_12, 'fixture-12.json');

    const pdfReloaded = await exportPdfBuffer(page);
    const textReloaded = await inspectPdfTextAndMeta(pdfReloaded);
    assert.ok(
      textReloaded.pages[1].text.includes('四周') && !textReloaded.pages[1].text.includes('四季'),
      'Edits must persist after page reload',
    );

    // Export merged JSON
    await page.locator('[data-testid="btn-export-json"]').click();
    const exportedJsonText = await page.evaluate(() => window.__hanziExportedJson);
    assert.ok(exportedJsonText && exportedJsonText.includes('四周'), 'Exported JSON must contain merged edits');

    // Clear overrides, upload exported JSON, and compare PDF page 2 pixels
    await page.evaluate(() => window.__hanziStore.clearAllOverrides());
    await uploadJsonDataset(page, exportedJsonText, 'reimported.json');

    const pdfReimported = await exportPdfBuffer(page, join(OUT_DIR, 'reimported.pdf'));
    const imgReloaded = await renderPdfPageToImage(pdfReloaded, 2, 2);
    const imgReimported = await renderPdfPageToImage(pdfReimported, 2, 2);
    const cmp = comparePngBuffers(imgReloaded.pngBuffer, imgReimported.pngBuffer);
    assert.ok(cmp.mismatchRatio < 0.001, `Re-imported JSON PDF must match persisted PDF (diff=${cmp.mismatchRatio})`);
  });

  // ---------------------------------------------------------------------------
  // 6. Abnormal Inputs Validation (Duplicates, 1001 Chars, Malformed JSON, Missing Fields)
  // ---------------------------------------------------------------------------
  await t.test('6. Abnormal inputs: malformed JSON, duplicate chars, 1001 chars, and missing fields show validation notices without crashing', async () => {
    // Malformed JSON
    await uploadJsonDataset(page, '{ broken json ', 'broken.json');
    let issueCodes = await page.evaluate(() =>
      [...document.querySelectorAll('[data-issue-code]')].map((el) => el.dataset.issueCode),
    );
    assert.ok(issueCodes.includes('INVALID_JSON'), 'Malformed JSON must show INVALID_JSON in validation panel');

    // 1001 chars + duplicate + missing pinyin + word missing char
    const overChars = [
      { char: '四', pinyin: 'sì', words: ['四季', '不相关词'] },
      { char: '四', pinyin: 'sì', words: ['四个'] },
      { char: '五', pinyin: '', words: [] },
    ];
    for (let i = 0; i < 1000; i++) {
      const ch = String.fromCodePoint(0x4e10 + i);
      overChars.push({ char: ch, pinyin: 'yī', words: [ch + '字'] });
    }
    await uploadJsonDataset(page, { groups: [{ category: '异常测试组', characters: overChars }] }, 'abnormal.json');

    issueCodes = await page.evaluate(() =>
      [...document.querySelectorAll('[data-issue-code]')].map((el) => el.dataset.issueCode),
    );
    assert.ok(issueCodes.includes('MAX_CHARS_EXCEEDED'), '1001+ items must trigger MAX_CHARS_EXCEEDED');
    assert.ok(issueCodes.includes('DUPLICATE_CHAR'), 'Duplicate char must trigger DUPLICATE_CHAR');
    assert.ok(issueCodes.includes('WORD_MISSING_CHAR'), 'Word missing char must trigger WORD_MISSING_CHAR');
    assert.ok(issueCodes.includes('MISSING_PINYIN'), 'Missing pinyin must trigger MISSING_PINYIN');
  });

  // ---------------------------------------------------------------------------
  // 7. Full 1000-Character Stress Test (250 Pages at 4 chars/page)
  // ---------------------------------------------------------------------------
  await t.test('7. 1000-character stress test: load < 1s, zero DOM overflow, 250-page PDF generation & illustration verification', async () => {
    const rawV6 = readFileSync(join(PRINTER_ROOT, 'spec/data/hanzi-1000-v6.json'), 'utf8');
    await uploadJsonDataset(page, rawV6, 'hanzi-1000-v6.json');

    const loadMs = await page.evaluate(() => Number(document.body.dataset.lastLoadMs || 0));
    assert.ok(loadMs < 1500, `1000-character ingest should be fast (took ${loadMs} ms)`);

    // Switch to 4 chars/page => 250 pages
    await page.locator('[data-testid="per-page-4"]').click();

    const tPrepStart = Date.now();
    const stressPdfPath = join(OUT_DIR, 'stress-1000-chars-250p.pdf');
    const pdfBuf = await exportPdfBuffer(page, stressPdfPath);
    const prepAndPdfMs = Date.now() - tPrepStart;

    // Check DOM for any horizontal overflow across all 1000 hydrated character units
    const overflowAudit = await page.evaluate(() => {
      let overflowCount = 0;
      for (const info of document.querySelectorAll('.unit-info')) {
        if (info.scrollWidth > info.clientWidth + 2 || info.scrollHeight > info.clientHeight + 2) {
          overflowCount++;
        }
      }
      return {
        totalUnits: document.querySelectorAll('.char-unit').length,
        overflowCount,
      };
    });
    assert.equal(overflowAudit.totalUnits, 1000, 'All 1000 character units must be rendered');
    assert.equal(overflowAudit.overflowCount, 0, 'Zero text overflow across all 1000 character cards');

    // Verify 250-page PDF structure
    const pdfMeta = await inspectPdfTextAndMeta(pdfBuf, { maxPagesToExtractText: 10 });
    assert.equal(pdfMeta.numPages, 250, '1000 chars at 4/page must produce exactly 250 PDF pages');
    assert.ok(Math.abs(pdfMeta.pages[0].widthPt - 612) < 1);
    assert.ok(Math.abs(pdfMeta.pages[0].heightPt - 792) < 1);

    // Sample pages across the 250-page PDF (first, 50th, 125th, 200th, 250th) and verify all 4 illustration slots are non-empty
    for (const samplePage of [1, 50, 125, 200, 250]) {
      const pIdx = samplePage - 1;
      const rendered = await renderPdfPageToImage(pdfBuf, samplePage, 1.5);
      const pageChars = await page.evaluate(
        (idx) =>
          [...document.querySelectorAll(`.sheet-page[data-page-index="${idx}"] .unit-art`)].map(
            (el) => el.dataset.illustrationSlot,
          ),
        pIdx,
      );
      assert.equal(pageChars.length, 4, `Page ${samplePage} must have 4 illustration slots`);
      for (const ch of pageChars) {
        const rectPt = await getElementPdfRect(page, pIdx, `.unit-art[data-illustration-slot="${ch}"]`);
        const crop = cropPdfRegion(rendered, rectPt, 2);
        const stats = analyzeRegionPixels(crop);
        assert.ok(
          stats.nonWhiteRatio > 0.025,
          `Page ${samplePage} char "${ch}" illustration slot in 250p PDF must not be blank (nonWhiteRatio=${stats.nonWhiteRatio.toFixed(3)})`,
        );
      }
    }

    console.log(
      `[stress-test] 1000 chars: load=${loadMs}ms, 250-page PDF export=${prepAndPdfMs}ms, size=${(pdfBuf.byteLength / 1e6).toFixed(2)}MB`,
    );
  });

  // ---------------------------------------------------------------------------
  // 8. 1000-Character Illustration Overview Contact Sheet PDF
  // ---------------------------------------------------------------------------
  await t.test('8. Generate 1000-character illustration overview PDF (10 pages, 100 chars/page)', async () => {
    const overviewPage = await context.newPage();
    await overviewPage.goto(`${srv.url}/printer/index.html`, { waitUntil: 'networkidle' });
    await overviewPage.waitForFunction(() => document.body.dataset.datasetReady === 'true');

    await overviewPage.evaluate(() => {
      const store = window.__hanziStore;
      const chars = store.getSelectedResolvedChars();
      const pagesHtml = [];
      for (let p = 0; p < 10; p++) {
        const slice = chars.slice(p * 100, (p + 1) * 100);
        const cells = slice
          .map((item) => {
            const ill = item.illustration;
            let art = '';
            if (ill.type === 'emoji') {
              art = `<img src="${ill.src}" style="width:24px;height:24px;object-fit:contain;" />${ill.count > 1 ? `<span style="font-size:9px;color:#2563eb;font-weight:700;">×${ill.count}</span>` : ''}`;
            } else if (Array.isArray(item.strokePaths) && item.strokePaths.length > 0) {
              const paths = item.strokePaths.map((d) => `<path d="${d}"/>`).join('');
              art = `<svg viewBox="0 0 1024 1024" style="width:24px;height:24px;display:block;"><g transform="scale(1,-1) translate(0,-900)" fill="#2563eb" stroke="#1d4ed8" stroke-width="24">${paths}</g></svg>`;
            } else {
              art = `<span style="font-family:'LXGW WenKai',serif;font-size:18px;font-weight:700;color:#2563eb;">${item.char}</span>`;
            }
            return `<div style="border:1px solid #cbd5e1;border-radius:4px;padding:2px 3px;display:flex;align-items:center;justify-content:space-between;background:#fff;">
              <div style="line-height:1.1;">
                <div style="font-family:'LXGW WenKai',serif;font-size:14px;font-weight:700;color:#0f172a;">${item.char}</div>
                <div style="font-size:8px;color:#64748b;">${item.pinyin}</div>
              </div>
              <div style="display:flex;align-items:center;gap:1px;">${art}</div>
            </div>`;
          })
          .join('');
        pagesHtml.push(`
          <section style="width:215.9mm;height:279.4mm;padding:10mm;box-sizing:border-box;page-break-after:always;background:#fff;font-family:sans-serif;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3mm;font-family:'LXGW WenKai',serif;font-size:12pt;">
              <strong>1000 汉字插图总览表（第 ${p + 1} / 10 页 · 第 ${p * 100 + 1}–${(p + 1) * 100} 字）</strong>
              <span>Fluent Emoji Flat + 彩色立体字</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(10,1fr);grid-template-rows:repeat(10,23.5mm);gap:1.5mm;">
              ${cells}
            </div>
          </section>`);
      }
      document.body.innerHTML = pagesHtml.join('');
    });

    const imgs = await overviewPage.locator('img').all();
    await overviewPage.evaluate(async () => {
      await Promise.all(
        [...document.querySelectorAll('img')].map((img) =>
          img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; }),
        ),
      );
    });
    assert.ok(imgs.length >= 900, `Overview should contain >=900 emoji images (got ${imgs.length})`);

    const overviewPdfPath = join(OUT_DIR, 'illustrations-overview-1000.pdf');
    const overviewBuf = await overviewPage.pdf({ format: 'Letter', printBackground: true });
    writeFileSync(overviewPdfPath, overviewBuf);

    const overviewMeta = await inspectPdfTextAndMeta(overviewBuf, { maxPagesToExtractText: 2 });
    assert.equal(overviewMeta.numPages, 10, 'Overview PDF should have 10 pages');

    const overviewP1 = await renderPdfPageToImage(overviewBuf, 1, 2);
    writeFileSync(join(OUT_DIR, 'illustrations-overview-page1.png'), overviewP1.pngBuffer);
    await overviewPage.close();
  });

  // ---------------------------------------------------------------------------
  // 9. 20 Random Characters from spec/data/hanzi-1000-v6.json — Full PDF Prints & Verification
  // ---------------------------------------------------------------------------
  await t.test('9. 20 random characters from hanzi-1000-v6.json: actual PDF prints across 1/2/3/4 chars/page & pixel verification', async () => {
    const rawV6 = JSON.parse(readFileSync(join(PRINTER_ROOT, 'spec/data/hanzi-1000-v6.json'), 'utf8'));
    const allChars = rawV6.groups.flatMap((g) =>
      g.characters.map((c) => ({ ...c, category: g.category })),
    );
    assert.equal(allChars.length, 1000, 'hanzi-1000-v6.json must contain 1000 characters');

    // Fisher-Yates shuffle with crypto-random / Math.random to pick 20 distinct characters
    const pool = [...allChars];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked20 = pool.slice(0, 20);
    console.log(
      `[random-20] Picked 20 random characters from hanzi-1000-v6.json: ${picked20.map((c) => `${c.char}(${c.pinyin})`).join(', ')}`,
    );

    const random20Dataset = {
      meta: {
        title: '随机20字抽样字帖（hanzi-1000-v6）',
        description: '从 spec/data/hanzi-1000-v6.json 随机抽取 20 个汉字进行端到端 PDF 打印验证',
      },
      groups: [
        {
          category: '随机抽样20字',
          characters: picked20.map(({ char, pinyin, words }) => ({ char, pinyin, words })),
        },
      ],
    };

    await uploadJsonDataset(page, random20Dataset, 'random-20-v6.json');

    for (const perPage of [1, 2, 3, 4]) {
      await page.locator(`[data-testid="per-page-${perPage}"]`).click();
      const expectedPages = Math.ceil(picked20.length / perPage);

      // Verify DOM stroke steps & zero overflow for all 20 random characters
      const domCheck = await page.evaluate(async () => {
        await window.__hanziPrintPrepare();
        const mismatches = [];
        let overflowCount = 0;
        for (const unit of document.querySelectorAll('.char-unit')) {
          const ch = unit.dataset.char;
          const expectedStrokes = Number(unit.querySelector('[data-field="strokes"]')?.textContent);
          const stepBoxes = unit.querySelectorAll('[data-stroke-ribbon] .stroke-step').length;
          if (stepBoxes !== expectedStrokes) {
            mismatches.push({ ch, expectedStrokes, stepBoxes });
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
        return { mismatches, overflowCount, totalUnits: document.querySelectorAll('.char-unit').length };
      });
      assert.equal(domCheck.totalUnits, 20, `All 20 random units must be rendered for perPage=${perPage}`);
      assert.deepEqual(domCheck.mismatches, [], `Stroke ribbon steps must match stroke count for perPage=${perPage}`);
      assert.equal(domCheck.overflowCount, 0, `Zero card or stroke-ribbon overflow for 20 random chars at perPage=${perPage}`);

      const pdfPath = join(OUT_DIR, `random-20-layout-${perPage}.pdf`);
      const pdfBuf = await exportPdfBuffer(page, pdfPath);
      const info = await inspectPdfTextAndMeta(pdfBuf);

      assert.equal(info.numPages, expectedPages, `20 chars at perPage=${perPage} must produce ${expectedPages} pages`);
      assert.ok(info.fontNames.some((f) => /WenKai|g_d/i.test(f)), 'Embedded LXGW WenKai font must be present');

      for (let p = 0; p < expectedPages; p++) {
        const pageInfo = info.pages[p];
        assert.ok(Math.abs(pageInfo.widthPt - 612) < 1, `page ${p + 1} widthPt=${pageInfo.widthPt}`);
        assert.ok(Math.abs(pageInfo.heightPt - 792) < 1, `page ${p + 1} heightPt=${pageInfo.heightPt}`);
        assert.ok(pageInfo.text.includes(`- ${p + 1} -`), `page ${p + 1} footer must contain "- ${p + 1} -"`);

        const slice = picked20.slice(p * perPage, (p + 1) * perPage);
        for (const item of slice) {
          assert.ok(pageInfo.text.includes(item.char), `page ${p + 1} PDF text must include random char ${item.char}`);
          assert.ok(pageInfo.text.includes(item.pinyin), `page ${p + 1} PDF text must include pinyin ${item.pinyin}`);
          assert.ok(pageInfo.text.includes(item.words[0]), `page ${p + 1} PDF text must include word ${item.words[0]}`);
        }
      }

      // Render page 1 of each layout for the 20 random characters
      const renderedP1 = await renderPdfPageToImage(pdfBuf, 1, 2);
      writeFileSync(join(OUT_DIR, `random-20-layout-${perPage}-page1.png`), renderedP1.pngBuffer);

      // In 4-chars/page mode (5 pages total), rasterize all 5 pages and verify all 20 illustrations + Tianzige cells
      if (perPage === 4) {
        let totalColoredRatio = 0;
        for (let pIdx = 0; pIdx < expectedPages; pIdx++) {
          const rendered = pIdx === 0 ? renderedP1 : await renderPdfPageToImage(pdfBuf, pIdx + 1, 2);
          writeFileSync(join(OUT_DIR, `random-20-layout-4-page${pIdx + 1}.png`), rendered.pngBuffer);
          const slice = picked20.slice(pIdx * 4, (pIdx + 1) * 4);
          for (const item of slice) {
            const rectPt = await getElementPdfRect(page, pIdx, `.unit-art[data-illustration-slot="${item.char}"]`);
            assert.ok(rectPt, `Illustration rect for random char "${item.char}" on page ${pIdx + 1}`);
            const crop = cropPdfRegion(rendered, rectPt, 2);
            const stats = analyzeRegionPixels(crop);
            totalColoredRatio += stats.coloredRatio;
            assert.ok(
              stats.nonWhiteRatio > 0.015,
              `Random char "${item.char}" illustration in PDF must be non-empty (nonWhite=${stats.nonWhiteRatio.toFixed(3)})`,
            );
          }
        }
        assert.ok(
          totalColoredRatio / 20 > 0.2,
          `20 random illustrations must have vivid overall colour saturation (avgColoredRatio=${(totalColoredRatio / 20).toFixed(3)})`,
        );

        // Verify Tianzige red model cell vs grey trace cell vs blank cell on the first random character
        const firstChar = picked20[0].char;
        const modelRect = await getElementPdfRect(page, 0, `.char-unit[data-char="${firstChar}"] .grid-cell[data-cell="0-0"]`);
        const traceRect = await getElementPdfRect(page, 0, `.char-unit[data-char="${firstChar}"] .grid-cell[data-cell="0-1"]`);
        const blankRect = await getElementPdfRect(page, 0, `.char-unit[data-char="${firstChar}"] .grid-cell[data-cell="2-1"]`);
        const modelStats = analyzeRegionPixels(cropPdfRegion(renderedP1, modelRect, 3));
        const traceStats = analyzeRegionPixels(cropPdfRegion(renderedP1, traceRect, 3));
        const blankStats = analyzeRegionPixels(cropPdfRegion(renderedP1, blankRect, 3));

        assert.ok(modelStats.redPixels > 15 && modelStats.redRatio > 0.2, `First random char "${firstChar}" col 0 must have red model glyph`);
        assert.ok(traceStats.greyPixels > 15 && traceStats.redPixels === 0, `First random char "${firstChar}" trace cell must have grey glyph`);
        assert.ok(traceStats.nonWhiteRatio > blankStats.nonWhiteRatio + 0.02, `Trace cell must have more ink than blank cell`);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 10. 24 Random Characters from spec/data/hanzi-1000-v6.json across Layout 2, Layout 3 & Layout 4
  // ---------------------------------------------------------------------------
  await t.test('10. 24 random characters from hanzi-1000-v6.json across Layout 2 (12p), Layout 3 (8p) & Layout 4 (6p): default large Tianzige, dashed grey tracing & PDF pixel verification', async () => {
    const rawV6 = JSON.parse(readFileSync(join(PRINTER_ROOT, 'spec/data/hanzi-1000-v6.json'), 'utf8'));
    const allChars = rawV6.groups.flatMap((g) =>
      g.characters.map((c) => ({ ...c, category: g.category })),
    );
    assert.equal(allChars.length, 1000, 'hanzi-1000-v6.json must contain 1000 characters');

    const pool = [...allChars];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked24 = pool.slice(0, 24);
    console.log(
      `[random-24-layouts-2-3-4] Picked 24 random characters: ${picked24.map((c) => `${c.char}(${c.pinyin})`).join(', ')}`,
    );

    const random24Dataset = {
      meta: {
        title: '随机24字抽样字帖 · 大田字格与虚线描红验证',
        description: '从 printer/spec/data/hanzi-1000-v6.json 随机抽取 24 个汉字进行 Layout 2 / 3 / 4 端到端 PDF 验证',
      },
      groups: [
        {
          category: '随机抽样24字',
          characters: picked24.map(({ char, pinyin, words }) => ({ char, pinyin, words })),
        },
      ],
    };

    const EXPECTED_GRID_DEFAULTS = {
      2: { cols: 4, rows: 6, trace: 2, minCellMm: 21.4, blankRow: 5 },
      3: { cols: 5, rows: 3, trace: 1, minCellMm: 21.4, blankRow: 2 },
      4: { cols: 4, rows: 3, trace: 1, minCellMm: 21.4, blankRow: 2 },
    };

    await uploadJsonDataset(page, random24Dataset, 'random-24-layouts.json');

    for (const perPage of [2, 3, 4]) {
      await page.locator(`[data-testid="per-page-${perPage}"]`).click();
      const expectedPages = Math.ceil(picked24.length / perPage);
      const expGrid = EXPECTED_GRID_DEFAULTS[perPage];

      // Capture workbench UI screenshot for each layout
      const uiScreenshotPath = join(OUT_DIR, `random-24-layout-${perPage}-workbench-ui.png`);
      await page.screenshot({ path: uiScreenshotPath, fullPage: false });

      // Verify toolbar inputs reflect default large Tianzige settings
      const toolbarVals = await page.evaluate(() => ({
        cols: Number(document.getElementById('setting-cols')?.value || 0),
        rows: Number(document.getElementById('setting-rows')?.value || 0),
        trace: Number(document.getElementById('setting-trace')?.value || 0),
      }));
      assert.equal(toolbarVals.cols, expGrid.cols, `Layout ${perPage} default cols input must be ${expGrid.cols}`);
      assert.equal(toolbarVals.rows, expGrid.rows, `Layout ${perPage} default rows input must be ${expGrid.rows}`);
      assert.equal(toolbarVals.trace, expGrid.trace, `Layout ${perPage} default trace input must be ${expGrid.trace}`);

      // Verify DOM stroke steps, default large Tianzige geometry, dashed tracing & zero overflow for all 24 characters
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
          if (cellMm < 21.4) {
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
        return { mismatches, gridIssues, overflowCount, totalUnits: document.querySelectorAll('.char-unit').length };
      });
      assert.equal(domCheck.totalUnits, 24, `Layout ${perPage}: all 24 random character units must be rendered`);
      assert.deepEqual(domCheck.mismatches, [], `Layout ${perPage}: stroke ribbon steps must match stroke count`);
      assert.deepEqual(domCheck.gridIssues, [], `Layout ${perPage}: all 24 units must have large Tianzige (>=21.4mm) & dashed centerlines`);
      assert.equal(domCheck.overflowCount, 0, `Layout ${perPage}: zero card or stroke-ribbon overflow for 24 random chars`);

      const pdfPath = join(OUT_DIR, `random-24-layout-${perPage}.pdf`);
      const pdfBuf = await exportPdfBuffer(page, pdfPath);
      const info = await inspectPdfTextAndMeta(pdfBuf);

      assert.equal(info.numPages, expectedPages, `24 chars at ${perPage} chars/page must produce ${expectedPages} PDF pages`);
      assert.ok(info.fontNames.some((f) => /WenKai|g_d/i.test(f)), 'Embedded LXGW WenKai font must be present');

      for (let p = 0; p < expectedPages; p++) {
        const pageInfo = info.pages[p];
        assert.ok(Math.abs(pageInfo.widthPt - 612) < 1, `Layout ${perPage} page ${p + 1} widthPt=${pageInfo.widthPt}`);
        assert.ok(Math.abs(pageInfo.heightPt - 792) < 1, `Layout ${perPage} page ${p + 1} heightPt=${pageInfo.heightPt}`);
        assert.ok(pageInfo.text.includes(`- ${p + 1} -`), `Layout ${perPage} page ${p + 1} footer must contain "- ${p + 1} -"`);

        const slice = picked24.slice(p * perPage, (p + 1) * perPage);
        const rendered = await renderPdfPageToImage(pdfBuf, p + 1, 2);
        writeFileSync(join(OUT_DIR, `random-24-layout-${perPage}-page${p + 1}.png`), rendered.pngBuffer);

        for (const item of slice) {
          assert.ok(pageInfo.text.includes(item.char), `Layout ${perPage} page ${p + 1} PDF text must include char ${item.char}`);
          assert.ok(pageInfo.text.includes(item.pinyin), `Layout ${perPage} page ${p + 1} PDF text must include pinyin ${item.pinyin}`);
          assert.ok(pageInfo.text.includes(item.words[0]), `Layout ${perPage} page ${p + 1} PDF text must include word ${item.words[0]}`);

          const rectPt = await getElementPdfRect(page, p, `.unit-art[data-illustration-slot="${item.char}"]`);
          assert.ok(rectPt, `Illustration rect for "${item.char}" on Layout ${perPage} page ${p + 1}`);
          const crop = cropPdfRegion(rendered, rectPt, 2);
          const stats = analyzeRegionPixels(crop);
          assert.ok(
            stats.nonWhiteRatio > 0.015,
            `Layout ${perPage} page ${p + 1} char "${item.char}" illustration must be non-empty (nonWhite=${stats.nonWhiteRatio.toFixed(3)})`,
          );
        }

        // Verify red model cell, light-grey dashed trace cell, and blank cell on the first character of page 1
        if (p === 0) {
          const firstChar = slice[0].char;
          const modelRect = await getElementPdfRect(page, 0, `.char-unit[data-char="${firstChar}"] .grid-cell[data-cell="0-0"]`);
          const traceRect = await getElementPdfRect(page, 0, `.char-unit[data-char="${firstChar}"] .grid-cell[data-cell="0-1"]`);
          const blankRect = await getElementPdfRect(page, 0, `.char-unit[data-char="${firstChar}"] .grid-cell[data-cell="${expGrid.blankRow}-1"]`);
          const modelStats = analyzeRegionPixels(cropPdfRegion(rendered, modelRect, 3));
          const traceStats = analyzeRegionPixels(cropPdfRegion(rendered, traceRect, 3));
          const blankStats = analyzeRegionPixels(cropPdfRegion(rendered, blankRect, 3));

          assert.ok(
            modelStats.redPixels > 15 && modelStats.redRatio > 0.2,
            `Layout ${perPage} "${firstChar}" col 0 must have red model glyph (redPixels=${modelStats.redPixels})`,
          );
          assert.ok(
            traceStats.greyPixels > 15 && traceStats.redPixels === 0,
            `Layout ${perPage} "${firstChar}" trace cell must have light-grey dashed glyph (greyPixels=${traceStats.greyPixels})`,
          );
          assert.ok(
            traceStats.nonWhiteRatio > blankStats.nonWhiteRatio + 0.02,
            `Layout ${perPage} "${firstChar}" trace cell must have more ink than blank cell (${traceStats.nonWhiteRatio.toFixed(3)} vs ${blankStats.nonWhiteRatio.toFixed(3)})`,
          );
        }
      }
    }
  });
});

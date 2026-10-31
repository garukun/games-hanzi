/**
 * Evaluates the print CLI against the existing e2e browser workflow.
 *
 * The e2e suite generates PDFs by uploading JSON, clicking a layout button, calling
 * `window.__hanziPrintPrepare()`, then `page.pdf({ format: 'Letter', printBackground,
 * preferCSSPageSize })`. This spec runs that UI path and the CLI on the example
 * dataset (`printer/spec/data/hanzi-1000-v6.json`) and requires the page rasters to match.
 * Agents should print with `npm run print:layout-3` or jobs[].argv from --describe,
 * not by running this spec.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDF_EXPORT } from '../js/print-config.js';
import { renderPrintPdf } from '../scripts/print-pdf.mjs';
import { buildPrintJob } from '../js/print-config.js';
import { startStaticServer } from '../scripts/serve.mjs';
import { inspectPdfTextAndMeta, renderPdfPageToImage, comparePngBuffers } from './helpers/pdf.mjs';

const PRINTER_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO_ROOT = resolve(PRINTER_ROOT, '..');
const SCRIPT = join(PRINTER_ROOT, 'scripts', 'print-pdf.mjs');
const EXAMPLE = join(PRINTER_ROOT, 'spec', 'data', 'hanzi-1000-v6.json');

function firstCharsDataset(n) {
  const raw = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  const characters = raw.groups.flatMap((group) => group.characters).slice(0, n);
  return {
    meta: raw.meta,
    groups: [{ category: raw.groups[0].category, characters }],
  };
}

async function uploadJsonDataset(page, dataObj, filename = 'fixture.json') {
  const prevSeq = await page.evaluate(() => document.body.dataset.ingestSeq || '0');
  await page.locator('[data-testid="json-file-input"]').setInputFiles({
    name: filename,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(dataObj), 'utf8'),
  });
  await page.waitForFunction(
    (prev) => document.body.dataset.datasetReady === 'true' && document.body.dataset.ingestSeq !== prev,
    prevSeq,
  );
}

async function exportPdfBuffer(page) {
  await page.evaluate(() => window.__hanziPrintPrepare());
  await page.waitForFunction(() => document.body.dataset.printReady === 'true');
  return page.pdf(PDF_EXPORT);
}

test('CLI PDF matches the e2e UI print path for the example dataset', { timeout: 300000 }, async (t) => {
  assert.deepEqual(PDF_EXPORT, {
    format: 'Letter',
    printBackground: true,
    preferCSSPageSize: true,
  });

  const outDir = mkdtempSync(join(tmpdir(), 'hanzi-cli-print-'));
  const cliPdfPath = join(outDir, 'v6-layout-3-limit6.pdf');
  const cliRun = spawnSync(process.execPath, [
    SCRIPT,
    '--input', EXAMPLE,
    '--layout', '3',
    '--limit', '6',
    '--output', cliPdfPath,
  ], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 180000 });
  assert.equal(cliRun.status, 0, cliRun.stdout || cliRun.stderr);
  const cliResult = JSON.parse(cliRun.stdout);
  assert.equal(cliResult.ok, true);
  assert.equal(cliResult.layout, 3);
  assert.equal(cliResult.selection.selected, 6);
  assert.equal(cliResult.expectedPages, 2);
  assert.equal(cliResult.applied.settings.cols, 5);
  assert.equal(cliResult.applied.settings.rows, 3);
  assert.equal(cliResult.applied.settings.trace, 1);
  assert.ok(cliResult.applied.settings.cellMm >= 21.4);

  const dataset = firstCharsDataset(6);
  const picked = dataset.groups[0].characters;
  const cliBuf = readFileSync(cliPdfPath);
  const cliInfo = await inspectPdfTextAndMeta(cliBuf);
  assert.equal(cliInfo.numPages, 2);
  assert.ok(cliInfo.fontNames.some((font) => /WenKai|g_d/i.test(font)), cliInfo.fontNames.join(', '));
  for (let p = 0; p < 2; p++) {
    assert.ok(Math.abs(cliInfo.pages[p].widthPt - 612) < 1);
    assert.ok(Math.abs(cliInfo.pages[p].heightPt - 792) < 1);
    assert.ok(cliInfo.pages[p].text.includes(`- ${p + 1} -`));
    for (const item of picked.slice(p * 3, (p + 1) * 3)) {
      assert.ok(cliInfo.pages[p].text.includes(item.char), item.char);
      assert.ok(cliInfo.pages[p].text.includes(item.pinyin), item.pinyin);
      assert.ok(cliInfo.pages[p].text.includes(item.words[0]), item.words[0]);
    }
  }

  const server = await startStaticServer({ port: 0, root: REPO_ROOT });
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  t.after(async () => {
    await browser.close();
    await server.close();
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 920 } });
  const page = await context.newPage();
  await page.goto(`${server.url}/printer/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.datasetReady === 'true');

  for (const layout of [2, 3]) {
    const job = buildPrintJob({
      input: EXAMPLE,
      layout,
      datasetText: JSON.stringify(dataset),
    });
    assert.equal(job.ok, true, job.errors.join('; '));
    const rendered = await renderPrintPdf(job);
    const uiReady = page;
    await uploadJsonDataset(uiReady, dataset, `v6-first6-layout-${layout}.json`);
    await uiReady.locator(`[data-testid="per-page-${layout}"]`).click();
    const uiBuf = await exportPdfBuffer(uiReady);

    const cliMeta = await inspectPdfTextAndMeta(rendered.pdfBuf);
    const uiMeta = await inspectPdfTextAndMeta(uiBuf);
    assert.equal(cliMeta.numPages, Math.ceil(6 / layout));
    assert.equal(uiMeta.numPages, cliMeta.numPages);
    for (let p = 0; p < cliMeta.numPages; p++) {
      assert.ok(Math.abs(uiMeta.pages[p].widthPt - 612) < 1);
      assert.ok(Math.abs(cliMeta.pages[p].heightPt - 792) < 1);
      const cliPng = await renderPdfPageToImage(rendered.pdfBuf, p + 1, 2);
      const uiPng = await renderPdfPageToImage(uiBuf, p + 1, 2);
      const cmp = comparePngBuffers(cliPng.pngBuffer, uiPng.pngBuffer);
      assert.ok(
        cmp.mismatchRatio < 0.005,
        `layout ${layout} page ${p + 1} CLI vs e2e UI diff ${(cmp.mismatchRatio * 100).toFixed(3)}% exceeds 0.5%`,
      );
    }
    if (layout === 3) {
      const limitVsSlice = comparePngBuffers(
        (await renderPdfPageToImage(cliBuf, 1, 2)).pngBuffer,
        (await renderPdfPageToImage(rendered.pdfBuf, 1, 2)).pngBuffer,
      );
      assert.ok(
        limitVsSlice.mismatchRatio < 0.005,
        `full example file --limit 6 must match a 6-character slice at layout 3 (diff ${(limitVsSlice.mismatchRatio * 100).toFixed(3)}%)`,
      );
    }
  }
});

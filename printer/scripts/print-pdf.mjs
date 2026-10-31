#!/usr/bin/env node
/**
 * Agent-facing CLI for the Hanzi practice-sheet printer.
 *
 *   node printer/scripts/print-pdf.mjs --describe
 *   node printer/scripts/print-pdf.mjs layout 3
 *   node printer/scripts/print-pdf.mjs layout 3 limit 6
 *   node printer/scripts/print-pdf.mjs layout 3 序号 1-12
 *   node printer/scripts/print-pdf.mjs "3 字/页" 选取 1 - 6
 *   node printer/scripts/print-pdf.mjs "3个字/页"
 *   node printer/scripts/print-pdf.mjs 每页字数 3
 *   node printer/scripts/print-pdf.mjs layout 3 关闭 页脚标题
 *   node printer/scripts/print-pdf.mjs layout 3 把 页脚标题 关闭
 *   node printer/scripts/print-pdf.mjs layout 3 页脚标题关闭
 *   node printer/scripts/print-pdf.mjs "layout 3，页脚标题关闭"
 *   node printer/scripts/print-pdf.mjs layout 3 showFooterTitlefalse
 *   node printer/scripts/print-pdf.mjs "layout 3，showFooterTitlefalse"
 *   node printer/scripts/print-pdf.mjs layout 3 showFooterTitle-off
 *   node printer/scripts/print-pdf.mjs layout 3 showFooterTitle -off
 *   node printer/scripts/print-pdf.mjs "layout 3，showFooterTitle -off"
 *   node printer/scripts/print-pdf.mjs layout 3 showFooterTitle - off
 *   node printer/scripts/print-pdf.mjs "layout 3，showFooterTitle - off"
 *   node printer/scripts/print-pdf.mjs layout 3 off-showFooterTitle
 *   node printer/scripts/print-pdf.mjs "layout 3，off-showFooterTitle"
 *   node printer/scripts/print-pdf.mjs "layout 3，setting-footer-title-off"
 *   node printer/scripts/print-pdf.mjs "3 字/页" 每行 5
 *   node printer/scripts/print-pdf.mjs "3 per page"
 *   node printer/scripts/print-pdf.mjs chars per page 3
 *   node printer/scripts/print-pdf.mjs "3 chars per page"
 *   node printer/scripts/print-pdf.mjs "three Chinese characters on the page"
 *   node printer/scripts/print-pdf.mjs "run the end-to-end test to generate the PDF, layout 3"
 *   node printer/scripts/print-pdf.mjs run the end-to-end test to generate the PDF, layout 3
 *   node printer/scripts/print-pdf.mjs "跑端到端测试生成 PDF，layout 3 --limit 6 --dry-run"
 *   node printer/scripts/print-pdf.mjs printer/spec/print-job.example.json
 *   node printer/scripts/print-pdf.mjs hanzi-1000-v6.json layout 3
 *   node printer/scripts/print-pdf.mjs print-job.example.json
 *   npm run print:layout-3
 *   npm run test:e2e layout 3
 *
 * Prefer jobs[].argv from --describe. It is an absolute node invocation and
 * works from any cwd. Do not append --limit/--output to npm. If npm eats
 * --dry-run, this script dry-runs and does not write the PDF.
 * `npm run test:e2e` with no layout is still the visual-regression suite.
 * A single quoted human instruction is the published job, not a missing filename.
 * The same words as separate argv are that job too. A comma stuck to PDF, is glue, not a filename.
 * Separate argv `limit 6`, `cols 5`, `每行 5`, and `黑白省墨` are options, not filenames.
 * The workbench 序号 picker (`序号 1-12`, `选取 1 - 6`) is --range. That hyphen is not an option.
 * A bare 选取 does not change the selection.
 * Checkbox wording and quoted near-misses are --describe (example.note / --help).
 *
 * The PDF is produced by Chromium `page.pdf()` with the same options as
 * `printer/e2e/print.spec.mjs`, after the workbench hydrates every sheet.
 * Layout defaults are the app's own SPECS (see --describe), not a second copy.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  NPM_SWALLOWED_DRY_RUN,
  PDF_EXPORT,
  buildPrintJob,
  describePrintConfig,
  formatHelp,
  npmSwallowedDryRun,
  parseCliArgs,
  publishedPrintJob,
  resolveE2eEntry,
} from '../js/print-config.js';
import { startStaticServer } from './serve.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const E2E_SPEC = fileURLToPath(new URL('../e2e/print.spec.mjs', import.meta.url));

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function publicJob(job, extra = {}) {
  const published = job.settings?.layout ? publishedPrintJob(job.settings.layout) : null;
  return {
    ok: job.ok,
    input: job.input,
    inputDefaulted: Boolean(job.inputDefaulted),
    output: job.output,
    job: job.job ?? null,
    layout: job.settings?.layout ?? null,
    settings: job.settings
      ? {
          perPage: job.settings.perPage,
          cols: job.settings.cols,
          rows: job.settings.rows,
          trace: job.settings.trace,
          mono: job.settings.mono,
          showFooterTitle: job.settings.showFooterTitle,
          defaults: job.settings.defaults,
          effective: job.settings.effective,
        }
      : null,
    range: job.range,
    chars: job.chars,
    selection: job.selection ? { total: job.selection.total, selected: job.selection.selected } : null,
    expectedPages: job.expectedPages,
    validation: job.validation,
    warnings: job.warnings,
    errors: job.errors,
    ...(Array.isArray(job.jobs) ? { jobs: job.jobs } : {}),
    invoke: published
      ? { argv: published.argv, command: published.command, npm: published.npm }
      : null,
    pdf: PDF_EXPORT,
    ...extra,
  };
}

/**
 * Render a normalized job to a PDF buffer. Same browser print path as the e2e suite.
 * @param {ReturnType<typeof buildPrintJob>} job
 */
export async function renderPrintPdf(job) {
  if (!job?.ok) {
    throw new Error(job?.errors?.join('; ') || 'print job is not runnable');
  }
  const server = await startStaticServer({ port: 0, root: REPO_ROOT });
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 920 } });
    const page = await context.newPage();
    page.on('pageerror', (err) => {
      process.stderr.write(`[pageerror] ${err}\n`);
    });
    await page.addInitScript(() => {
      window.__HANZI_CLI__ = true;
    });
    await page.goto(`${server.url}/printer/index.html?cli=1`, {
      waitUntil: 'networkidle',
      timeout: 120000,
    });
    await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120000 });

    const applied = await page.evaluate(
      async ({ raw, settings, range, chars }) => {
        const ingestOpts = {};
        if (Array.isArray(chars) && chars.length > 0) ingestOpts.selectChars = chars;
        else if (range && range.start === 1) ingestOpts.selectFirstN = range.end;
        await window.__hanziIngestDataset(raw, ingestOpts);
        const store = window.__hanziStore;
        store.updateSettings({ perPage: settings.layout });
        const patch = {
          mono: settings.mono,
          showFooterTitle: settings.showFooterTitle,
        };
        if (settings.cols != null) patch.cols = settings.cols;
        if (settings.rows != null) patch.rows = settings.rows;
        if (settings.trace != null) patch.trace = settings.trace;
        store.updateSettings(patch);
        if (Array.isArray(chars) && chars.length > 0) store.setSelection(chars);
        else if (range && range.start !== 1) store.selectRange(range.start, range.end);

        const report = store.getValidationReport();
        const selected = store.state.selectedChars.size;
        const grid = document.querySelector('.unit-grid');
        return {
          selected,
          pages: document.querySelectorAll('.sheet-page').length,
          settings: {
            perPage: store.state.settings.perPage,
            cols: grid ? Number(grid.dataset.gridCols) : null,
            rows: grid ? Number(grid.dataset.gridRows) : null,
            trace: grid ? Number(grid.dataset.gridTrace) : null,
            cellMm: grid ? Number(grid.dataset.gridCellMm) : null,
            mono: Boolean(store.state.settings.mono),
            showFooterTitle: store.state.settings.showFooterTitle !== false,
          },
          validation: {
            ok: report.ok,
            errors: report.issues.filter((issue) => issue.level === 'error').length,
            warnings: report.issues.filter((issue) => issue.level === 'warning').length,
          },
        };
      },
      {
        raw: job.datasetText,
        settings: {
          layout: job.settings.layout,
          cols: job.settings.cols,
          rows: job.settings.rows,
          trace: job.settings.trace,
          mono: job.settings.mono,
          showFooterTitle: job.settings.showFooterTitle,
        },
        range: job.range,
        chars: job.chars,
      },
    );

    if (applied.selected === 0) {
      const err = new Error('no characters selected after ingest');
      err.applied = applied;
      throw err;
    }
    if (job.strict && applied.validation.errors > 0) {
      const err = new Error(`strict validation failed with ${applied.validation.errors} error(s)`);
      err.applied = applied;
      throw err;
    }

    await page.evaluate(() => window.__hanziPrintPrepare());
    await page.waitForFunction(() => document.body.dataset.printReady === 'true', null, { timeout: 600000 });
    const pdfBuf = await page.pdf(PDF_EXPORT);
    return { pdfBuf, applied };
  } finally {
    await browser.close();
    await server.close();
  }
}

function runVisualRegression(extraArgs) {
  const result = spawnSync(process.execPath, ['--test', E2E_SPEC, ...extraArgs], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

async function main() {
  const argv = process.argv.slice(2);
  // Historical printer command: `npm run test:e2e layout 3`. No layout still runs the suite.
  if (argv.includes('--e2e') && resolveE2eEntry(argv).action === 'test') {
    runVisualRegression(argv.filter((arg) => arg !== '--e2e'));
    return;
  }
  const parsed = parseCliArgs(argv);
  if (parsed.mode === 'help') {
    process.stdout.write(formatHelp());
    return;
  }
  if (parsed.mode === 'describe') {
    emit(describePrintConfig());
    return;
  }
  if (parsed.mode === 'error') {
    emit({ ok: false, errors: parsed.errors, code: parsed.code });
    process.exit(parsed.code);
  }

  const swallowedDryRun = npmSwallowedDryRun();
  const built = buildPrintJob(parsed.request);
  const job = swallowedDryRun
    ? { ...built, warnings: [...(built.warnings || []), NPM_SWALLOWED_DRY_RUN] }
    : built;
  const dryRun = parsed.mode === 'dry-run' || (parsed.mode === 'run' && swallowedDryRun);
  if (!job.ok || dryRun) {
    emit({
      ...publicJob(job),
      dryRun,
      ...(swallowedDryRun ? { npmDryRunRecovered: true } : {}),
    });
    process.exit(job.ok ? 0 : job.code || 2);
  }

  process.stderr.write(
    `Printing ${job.selection.selected} characters at layout ${job.settings.layout} ` +
      `(${job.expectedPages} page${job.expectedPages === 1 ? '' : 's'}) → ${job.output}\n`,
  );
  const rendered = await renderPrintPdf(job);
  mkdirSync(dirname(job.output), { recursive: true });
  writeFileSync(job.output, rendered.pdfBuf);
  emit({
    ...publicJob(job),
    dryRun: false,
    bytes: rendered.pdfBuf.byteLength,
    applied: rendered.applied,
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    emit({ ok: false, code: 1, errors: [err.message], applied: err.applied || null });
    process.exit(1);
  });
}

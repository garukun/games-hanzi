#!/usr/bin/env node
/**
 * Self-contained E2E visual and semantic parity verifier for Hanzi practice-sheet PDFs.
 *
 * Verifies that an agent-generated PDF matches the webapp E2E print workflow
 * (`printer/index.html` -> Playwright -> Chromium `page.pdf()`).
 *
 * Works both within the monorepo and when installed via `npx skills add` to `.agents/skills/`,
 * `.claude/skills/`, `.cursor/skills/`, etc.
 *
 * Usage:
 *   # Mode 1: Compare two existing PDFs
 *   node <path-to>/verify-pdf-parity.mjs \
 *     --agent-pdf /path/to/agent.pdf \
 *     --e2e-pdf /path/to/e2e.pdf \
 *     --report-dir /path/to/report
 *
 *   # Mode 2: Run live webapp UI E2E print to generate reference PDF and compare
 *   node <path-to>/verify-pdf-parity.mjs \
 *     --agent-pdf /path/to/agent.pdf \
 *     --run-webapp-e2e \
 *     --input printer/spec/data/hanzi-1000-v6.json \
 *     --layout 3 \
 *     --range 1-12 \
 *     --report-dir /path/to/report
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Dynamically locate the repository root and printer root whether invoked from
 * printer/skills/..., .agents/skills/..., .cursor/skills/..., or anywhere else.
 */
function resolveRoots() {
  if (process.env.HANZI_PRINTER_ROOT && existsSync(process.env.HANZI_PRINTER_ROOT)) {
    const pRoot = resolve(process.env.HANZI_PRINTER_ROOT);
    return { printerRoot: pRoot, repoRoot: resolve(pRoot, '..') };
  }
  if (process.env.HANZI_REPO_ROOT && existsSync(process.env.HANZI_REPO_ROOT)) {
    const rRoot = resolve(process.env.HANZI_REPO_ROOT);
    return { printerRoot: resolve(rRoot, 'printer'), repoRoot: rRoot };
  }

  // 1. Check if SCRIPT_DIR is inside printer/skills/hanzi-pdf-printer/scripts
  const candPrinter1 = resolve(SCRIPT_DIR, '../../..');
  if (existsSync(join(candPrinter1, 'scripts', 'print-pdf.mjs'))) {
    return { printerRoot: candPrinter1, repoRoot: resolve(candPrinter1, '..') };
  }

  // 2. Search upward from SCRIPT_DIR for a directory containing printer/scripts/print-pdf.mjs
  let d = SCRIPT_DIR;
  while (d && d !== dirname(d)) {
    if (existsSync(join(d, 'printer', 'scripts', 'print-pdf.mjs'))) {
      return { printerRoot: join(d, 'printer'), repoRoot: d };
    }
    d = dirname(d);
  }

  // 3. Search upward from process.cwd()
  let c = process.cwd();
  while (c && c !== dirname(c)) {
    if (existsSync(join(c, 'printer', 'scripts', 'print-pdf.mjs'))) {
      return { printerRoot: join(c, 'printer'), repoRoot: c };
    }
    if (existsSync(join(c, 'scripts', 'print-pdf.mjs')) && basename(c) === 'printer') {
      return { printerRoot: c, repoRoot: dirname(c) };
    }
    c = dirname(c);
  }

  // 4. Fallback to git rev-parse --show-toplevel
  try {
    const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout.trim()) {
      const gitRoot = res.stdout.trim();
      if (existsSync(join(gitRoot, 'printer', 'scripts', 'print-pdf.mjs'))) {
        return { printerRoot: join(gitRoot, 'printer'), repoRoot: gitRoot };
      }
    }
  } catch {}

  throw new Error(
    'Cannot find printer directory containing scripts/print-pdf.mjs. Please run from within the games-hanzi repository or set HANZI_REPO_ROOT.',
  );
}

const { printerRoot: PRINTER_ROOT, repoRoot: REPO_ROOT } = resolveRoots();

// Dynamically import dependencies from the discovered printer directory
const { PDF_EXPORT, resolveExistingPath } = await import(
  pathToFileURL(join(PRINTER_ROOT, 'js/print-config.js')).href
);
const { startStaticServer } = await import(
  pathToFileURL(join(PRINTER_ROOT, 'scripts/serve.mjs')).href
);
const { comparePngBuffers, inspectPdfTextAndMeta, renderPdfPageToImage } = await import(
  pathToFileURL(join(PRINTER_ROOT, 'e2e/helpers/pdf.mjs')).href
);

// Resolve playwright from repo or environment
let chromium;
try {
  const req = createRequire(join(REPO_ROOT, 'package.json'));
  chromium = req('playwright').chromium;
} catch {
  const pw = await import('playwright');
  chromium = pw.chromium;
}

function parseRangeToken(val) {
  if (!val) return null;
  const match = String(val).trim().match(/^(\d+)\s*[-~至到]\s*(\d+)$/);
  if (!match) return null;
  const s = parseInt(match[1], 10);
  const e = parseInt(match[2], 10);
  return { start: Math.min(s, e), end: Math.max(s, e) };
}

function parseCharsToken(val) {
  if (!val) return null;
  return String(val)
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Drive the real webapp UI in Chromium to export an E2E reference PDF.
 */
async function generateWebappE2ePdf({
  input,
  layout,
  range,
  limit,
  chars,
  cols,
  rows,
  trace,
  mono,
  showFooterTitle,
  outPdfPath,
}) {
  const server = await startStaticServer({ port: 0, root: REPO_ROOT });
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 920 } });
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error('[webapp-e2e pageerror]', err));

    await page.goto(`${server.url}/printer/index.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.dataset.datasetReady === 'true', null, { timeout: 120000 });

    // Handle dataset input: if input is custom (or specified explicitly), upload via file input
    if (input) {
      const resolved = resolveExistingPath(input, process.cwd());
      if (!resolved.path || !existsSync(resolved.path)) {
        throw new Error(`Dataset input not found: ${input}`);
      }
      const rawText = readFileSync(resolved.path, 'utf8');
      const prevSeq = await page.evaluate(() => document.body.dataset.ingestSeq || '0');
      await page.locator('[data-testid="json-file-input"]').setInputFiles({
        name: 'dataset.json',
        mimeType: 'application/json',
        buffer: Buffer.from(rawText, 'utf8'),
      });
      await page.waitForFunction(
        (prev) => document.body.dataset.datasetReady === 'true' && document.body.dataset.ingestSeq !== prev,
        prevSeq,
        { timeout: 120000 },
      );
    }

    // Click layout button
    await page.locator(`[data-testid="per-page-${layout}"]`).click();

    // Adjust grid settings if specified
    if (cols != null) {
      await page.locator('[data-testid="setting-cols"]').fill(String(cols));
      await page.locator('[data-testid="setting-cols"]').dispatchEvent('change');
    }
    if (rows != null) {
      await page.locator('[data-testid="setting-rows"]').fill(String(rows));
      await page.locator('[data-testid="setting-rows"]').dispatchEvent('change');
    }
    if (trace != null) {
      await page.locator('[data-testid="setting-trace"]').fill(String(trace));
      await page.locator('[data-testid="setting-trace"]').dispatchEvent('change');
    }
    if (mono != null) {
      const monoEl = page.locator('[data-testid="setting-mono"]');
      const isChecked = await monoEl.isChecked();
      if (isChecked !== Boolean(mono)) {
        await monoEl.setChecked(Boolean(mono));
        await monoEl.dispatchEvent('change');
      }
    }
    if (showFooterTitle != null) {
      const footEl = page.locator('[data-testid="setting-footer-title"]');
      const isChecked = await footEl.isChecked();
      if (isChecked !== Boolean(showFooterTitle)) {
        await footEl.setChecked(Boolean(showFooterTitle));
        await footEl.dispatchEvent('change');
      }
    }

    // Apply character selection
    if (Array.isArray(chars) && chars.length > 0) {
      await page.evaluate((charList) => {
        window.__hanziStore.setSelection(charList);
      }, chars);
    } else if (range) {
      await page.locator('[data-testid="range-start"]').fill(String(range.start));
      await page.locator('[data-testid="range-end"]').fill(String(range.end));
      await page.locator('[data-testid="btn-select-range"]').click();
    } else if (limit != null) {
      await page.locator('[data-testid="range-start"]').fill('1');
      await page.locator('[data-testid="range-end"]').fill(String(limit));
      await page.locator('[data-testid="btn-select-range"]').click();
    }

    // Wait for DOM preparation
    await page.evaluate(() => window.__hanziPrintPrepare());
    await page.waitForFunction(() => document.body.dataset.printReady === 'true', null, { timeout: 120000 });

    const pdfBuf = await page.pdf(PDF_EXPORT);
    if (outPdfPath) {
      mkdirSync(dirname(outPdfPath), { recursive: true });
      writeFileSync(outPdfPath, pdfBuf);
    }
    return pdfBuf;
  } finally {
    await browser.close();
    await server.close();
  }
}

/**
 * Compare two PDF buffers visually and semantically across all pages.
 */
async function verifyParity(agentBuf, e2eBuf, reportDir) {
  mkdirSync(reportDir, { recursive: true });

  const agentMeta = await inspectPdfTextAndMeta(agentBuf);
  const e2eMeta = await inspectPdfTextAndMeta(e2eBuf);

  const errors = [];
  const warnings = [];

  // 1. Page count check
  if (agentMeta.numPages !== e2eMeta.numPages) {
    errors.push(`Page count mismatch: agent has ${agentMeta.numPages} pages, e2e has ${e2eMeta.numPages} pages`);
  }

  // 2. Embedded fonts check
  const agentHasFont = agentMeta.fontNames.some((f) => /WenKai|g_d/i.test(f));
  const e2eHasFont = e2eMeta.fontNames.some((f) => /WenKai|g_d/i.test(f));
  if (!agentHasFont) errors.push('Agent PDF does not contain embedded LXGW WenKai font');
  if (!e2eHasFont) warnings.push('E2E reference PDF font name check did not find WenKai match');

  const pagesReport = [];
  const totalPages = Math.min(agentMeta.numPages, e2eMeta.numPages);
  let maxMismatch = 0;

  for (let p = 1; p <= totalPages; p++) {
    const aPage = agentMeta.pages[p - 1];
    const ePage = e2eMeta.pages[p - 1];

    // Semantic checks: dimensions
    const aDimOk = Math.abs(aPage.widthPt - 612) < 1 && Math.abs(aPage.heightPt - 792) < 1;
    const eDimOk = Math.abs(ePage.widthPt - 612) < 1 && Math.abs(ePage.heightPt - 792) < 1;
    if (!aDimOk) errors.push(`Page ${p} dimensions not US Letter: ${aPage.widthPt}x${aPage.heightPt} pt`);

    // Text comparison
    const aTextNorm = aPage.text.replace(/\s+/g, ' ').trim();
    const eTextNorm = ePage.text.replace(/\s+/g, ' ').trim();
    const textMatch = aTextNorm === eTextNorm;
    if (!textMatch) {
      warnings.push(`Page ${p} text stream differs slightly between agent and e2e`);
    }

    // Visual screenshot rendering at 2x scale (1224x1584 px)
    const agentImg = await renderPdfPageToImage(agentBuf, p, 2);
    const e2eImg = await renderPdfPageToImage(e2eBuf, p, 2);

    const padP = String(p).padStart(2, '0');
    const agentPngPath = join(reportDir, `page-${padP}-agent.png`);
    const e2ePngPath = join(reportDir, `page-${padP}-e2e.png`);
    const diffPngPath = join(reportDir, `page-${padP}-diff.png`);

    writeFileSync(agentPngPath, agentImg.pngBuffer);
    writeFileSync(e2ePngPath, e2eImg.pngBuffer);

    const cmp = comparePngBuffers(agentImg.pngBuffer, e2eImg.pngBuffer);
    writeFileSync(diffPngPath, cmp.diffPngBuffer);

    if (cmp.mismatchRatio > maxMismatch) {
      maxMismatch = cmp.mismatchRatio;
    }

    // Parity threshold: < 0.5% diff (matching print.spec.mjs)
    const visualPassed = cmp.mismatchRatio < 0.005;
    if (!visualPassed) {
      errors.push(
        `Page ${p} visual mismatch ${(cmp.mismatchRatio * 100).toFixed(3)}% exceeds 0.5% tolerance (${cmp.diffPixels} diff px)`,
      );
    }

    pagesReport.push({
      pageNumber: p,
      widthPt: aPage.widthPt,
      heightPt: aPage.heightPt,
      textMatch,
      diffPixels: cmp.diffPixels,
      mismatchRatio: cmp.mismatchRatio,
      mismatchPercent: `${(cmp.mismatchRatio * 100).toFixed(3)}%`,
      passed: visualPassed,
      agentScreenshot: agentPngPath,
      e2eScreenshot: e2ePngPath,
      diffScreenshot: diffPngPath,
    });
  }

  const ok = errors.length === 0;
  const result = {
    ok,
    numPages: totalPages,
    maxMismatchRatio: maxMismatch,
    maxMismatchPercent: `${(maxMismatch * 100).toFixed(3)}%`,
    semanticParity: ok && warnings.length === 0,
    errors,
    warnings,
    pages: pagesReport,
    reportDir,
  };

  writeFileSync(join(reportDir, 'parity-report.json'), JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: false,
    options: {
      'agent-pdf': { type: 'string' },
      'e2e-pdf': { type: 'string' },
      'run-webapp-e2e': { type: 'boolean' },
      input: { type: 'string' },
      layout: { type: 'string' },
      range: { type: 'string' },
      limit: { type: 'string' },
      chars: { type: 'string' },
      cols: { type: 'string' },
      rows: { type: 'string' },
      trace: { type: 'string' },
      mono: { type: 'boolean' },
      'no-mono': { type: 'boolean' },
      'footer-title': { type: 'boolean' },
      'no-footer-title': { type: 'boolean' },
      'report-dir': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    process.stdout.write(
      [
        'Hanzi PDF Parity Verifier',
        '',
        'Options:',
        '  --agent-pdf <file.pdf>       Path to PDF generated by agent (required)',
        '  --e2e-pdf <file.pdf>         Path to reference PDF from webapp E2E',
        '  --run-webapp-e2e             Launch Playwright webapp to generate reference PDF',
        '  --input <file.json>          Input dataset for webapp E2E',
        '  --layout <1|2|3|4>           Layout for webapp E2E',
        '  --range <start-end>          Range for webapp E2E (e.g. 1-12)',
        '  --limit <n>                  Limit first N chars for webapp E2E',
        '  --chars <a,b,c>              Filter chars for webapp E2E',
        '  --cols <n>                   Grid columns for webapp E2E',
        '  --rows <n>                   Grid rows for webapp E2E',
        '  --trace <n>                  Trace rows for webapp E2E',
        '  --mono / --no-mono           Monochrome mode toggle',
        '  --footer-title / --no-footer-title Footer title toggle',
        '  --report-dir <dir>           Directory to save screenshots & report',
        '',
      ].join('\n'),
    );
    return;
  }

  if (!values['agent-pdf']) {
    console.error('Error: --agent-pdf is required');
    process.exit(2);
  }

  const agentPdfPath = resolve(process.cwd(), values['agent-pdf']);
  if (!existsSync(agentPdfPath)) {
    console.error(`Error: agent-pdf file not found at ${agentPdfPath}`);
    process.exit(2);
  }

  const reportDir = values['report-dir']
    ? resolve(process.cwd(), values['report-dir'])
    : mkdtempSync(join(tmpdir(), 'hanzi-pdf-parity-'));

  let e2eBuf = null;
  if (values['run-webapp-e2e']) {
    if (!values.layout) {
      console.error('Error: --layout is required when using --run-webapp-e2e');
      process.exit(2);
    }
    const layoutNum = parseInt(values.layout, 10);
    const rangeObj = values.range ? parseRangeToken(values.range) : null;
    const limitNum = values.limit ? parseInt(values.limit, 10) : null;
    const charsList = values.chars ? parseCharsToken(values.chars) : null;
    const colsNum = values.cols ? parseInt(values.cols, 10) : null;
    const rowsNum = values.rows ? parseInt(values.rows, 10) : null;
    const traceNum = values.trace ? parseInt(values.trace, 10) : null;
    const monoVal = values['no-mono'] ? false : values.mono ? true : null;
    const footerVal = values['no-footer-title'] ? false : values['footer-title'] ? true : null;

    const e2ePdfPath = join(reportDir, 'reference-webapp-e2e.pdf');
    e2eBuf = await generateWebappE2ePdf({
      input: values.input,
      layout: layoutNum,
      range: rangeObj,
      limit: limitNum,
      chars: charsList,
      cols: colsNum,
      rows: rowsNum,
      trace: traceNum,
      mono: monoVal,
      showFooterTitle: footerVal,
      outPdfPath: e2ePdfPath,
    });
  } else if (values['e2e-pdf']) {
    const e2ePdfPath = resolve(process.cwd(), values['e2e-pdf']);
    if (!existsSync(e2ePdfPath)) {
      console.error(`Error: e2e-pdf file not found at ${e2ePdfPath}`);
      process.exit(2);
    }
    e2eBuf = readFileSync(e2ePdfPath);
  } else {
    console.error('Error: either --e2e-pdf or --run-webapp-e2e must be provided');
    process.exit(2);
  }

  const agentBuf = readFileSync(agentPdfPath);
  const report = await verifyParity(agentBuf, e2eBuf, reportDir);

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (!report.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Parity verifier failed:', err);
  process.exit(1);
});

/**
 * Config resolution for the print CLI. Browser PDF output is covered by
 * printer/e2e/cli-print.spec.mjs against the existing e2e print path.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECS } from '../js/layout.js';
import {
  EXAMPLE_INPUT,
  EXAMPLE_JOB,
  NPM_SWALLOWED_DRY_RUN,
  PDF_EXPORT,
  PRINT_INSTRUCTION,
  PRINT_SCRIPT,
  REPO_ROOT,
  buildPrintJob,
  describePrintConfig,
  formatHelp,
  npmSwallowedDryRun,
  parseCliArgs,
  printInvoke,
  publishedPrintJob,
  resolveE2eEntry,
  WORKBENCH_PER_PAGE_GROUP,
  measureWordLayoutLabel,
  workbenchLayoutLabel,
} from '../js/print-config.js';

const SCRIPT = resolve(fileURLToPath(new URL('../scripts/print-pdf.mjs', import.meta.url)));
const EXAMPLE_ABS = join(REPO_ROOT, EXAMPLE_INPUT);

test('print config: layout defaults are the app SPECS, and PDF options match the e2e exporter', () => {
  const desc = describePrintConfig();
  assert.equal(desc.exampleInput, 'printer/spec/data/hanzi-1000-v6.json');
  assert.deepEqual(
    { format: desc.pdf.format, printBackground: desc.pdf.printBackground, preferCSSPageSize: desc.pdf.preferCSSPageSize },
    PDF_EXPORT,
  );
  assert.deepEqual(PDF_EXPORT, { format: 'Letter', printBackground: true, preferCSSPageSize: true });
  for (const layout of [1, 2, 3, 4]) {
    const spec = SPECS[layout];
    const described = desc.layouts[String(layout)];
    assert.equal(described.defaults.cols, spec.cols);
    assert.equal(described.defaults.rows, spec.defRows);
    assert.equal(described.defaults.trace, spec.defTrace);
    assert.equal(described.limits.cols.min, spec.minCols);
    assert.equal(described.limits.cols.max, spec.maxCols);
  }
});

test('print config: example dataset dry-run resolves layout 2 and layout 3 from the app', () => {
  const layout3 = buildPrintJob({ input: EXAMPLE_ABS, layout: 3, limit: 6 });
  assert.equal(layout3.ok, true, layout3.errors.join('; '));
  assert.equal(layout3.selection.total, 1000);
  assert.equal(layout3.selection.selected, 6);
  assert.equal(layout3.expectedPages, 2);
  assert.deepEqual(layout3.settings.effective, {
    cols: 5,
    rows: 3,
    trace: 1,
    mono: false,
    showFooterTitle: true,
  });
  assert.equal(layout3.settings.cols, null, 'omitted cols stay null so the sheet applies the layout default');

  const layout2 = buildPrintJob({ input: EXAMPLE_ABS, layout: 2, range: '1-6' });
  assert.equal(layout2.expectedPages, 3);
  assert.equal(layout2.settings.effective.cols, 4);
  assert.equal(layout2.settings.effective.rows, 6);
  assert.equal(layout2.settings.effective.trace, 2);

  const full = buildPrintJob({ input: EXAMPLE_ABS, layout: 3 });
  assert.equal(full.selection.selected, 1000);
  assert.equal(full.expectedPages, 334);
});

test('print config: rejects missing layout, conflicting selectors, and clamps cols to the layout limit', () => {
  const missing = buildPrintJob({ input: EXAMPLE_ABS });
  assert.equal(missing.ok, false);
  assert.match(missing.errors[0], /--layout is required/);

  const conflict = buildPrintJob({ input: EXAMPLE_ABS, layout: 3, limit: 4, range: '1-2' });
  assert.equal(conflict.ok, false);
  assert.match(conflict.errors.join('\n'), /only one of --range and --limit/);

  const clamped = buildPrintJob({
    input: EXAMPLE_ABS,
    layout: 3,
    cols: 1,
    limit: 3,
  });
  assert.equal(clamped.ok, true, clamped.errors.join('; '));
  assert.equal(clamped.settings.cols, 2);
  assert.match(clamped.warnings.join('\n'), /clamped to 2/);
});

test('print config: --config file is overridable by flags, and --describe does not need a dataset', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hanzi-print-'));
  const configPath = join(dir, 'job.json');
  writeFileSync(configPath, JSON.stringify({
    input: EXAMPLE_INPUT,
    layout: 2,
    limit: 4,
    note: 'ignored',
  }));
  const parsed = parseCliArgs(['--config', configPath, '--layout', '4', '--strict'], { cwd: REPO_ROOT });
  assert.equal(parsed.mode, 'run');
  const job = buildPrintJob(parsed.request, { cwd: REPO_ROOT });
  assert.equal(job.ok, true, job.errors.join('; '));
  assert.equal(job.settings.layout, 4);
  assert.equal(job.selection.selected, 4);
  assert.equal(job.expectedPages, 1);
  assert.equal(job.strict, true);

  const described = parseCliArgs(['--describe']);
  assert.equal(described.mode, 'describe');
});

test('print config: layout alone uses the app example dataset, from any cwd', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-cwd-'));
  const layout3 = buildPrintJob({ layout: 3, limit: 6 }, { cwd: outside });
  assert.equal(layout3.ok, true, layout3.errors.join('; '));
  assert.equal(layout3.inputDefaulted, true);
  assert.equal(layout3.input, EXAMPLE_ABS);
  assert.equal(layout3.selection.total, 1000);
  assert.equal(layout3.selection.selected, 6);
  assert.equal(layout3.settings.effective.cols, SPECS[3].cols);
  assert.equal(layout3.settings.effective.rows, SPECS[3].defRows);
  assert.equal(layout3.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(layout3.output, join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-6.pdf'));

  const fromPrinterDir = buildPrintJob(
    { input: 'spec/data/hanzi-1000-v6.json', layout: 2, limit: 2 },
    { cwd: join(REPO_ROOT, 'printer') },
  );
  assert.equal(fromPrinterDir.ok, true, fromPrinterDir.errors.join('; '));
  assert.equal(fromPrinterDir.inputDefaulted, false);
  assert.equal(fromPrinterDir.input, EXAMPLE_ABS);
  assert.equal(fromPrinterDir.settings.effective.cols, SPECS[2].cols);

  const positional = parseCliArgs(['3', '--limit', '4'], { cwd: outside });
  assert.equal(positional.mode, 'run');
  assert.equal(positional.request.layout, '3');
  assert.equal(positional.request.input, undefined);
  const positionalJob = buildPrintJob(positional.request, { cwd: outside });
  assert.equal(positionalJob.ok, true, positionalJob.errors.join('; '));
  assert.equal(positionalJob.inputDefaulted, true);
  assert.equal(positionalJob.settings.layout, 3);
  assert.equal(positionalJob.selection.selected, 4);

  const fileAndLayout = parseCliArgs([EXAMPLE_INPUT, '2'], { cwd: outside });
  assert.equal(fileAndLayout.request.input, EXAMPLE_INPUT);
  assert.equal(fileAndLayout.request.layout, '2');
  const fileJob = buildPrintJob(fileAndLayout.request, { cwd: outside });
  assert.equal(fileJob.ok, true, fileJob.errors.join('; '));
  assert.equal(fileJob.input, EXAMPLE_ABS);
  assert.equal(fileJob.settings.layout, 2);

  const junk = parseCliArgs(['3', 'extra']);
  assert.equal(junk.mode, 'error');
  assert.match(junk.errors[0], /unexpected argument/);

  const configured = parseCliArgs(['--config', 'printer/spec/print-job.example.json'], { cwd: outside });
  assert.equal(configured.mode, 'run');
  const configuredJob = buildPrintJob(configured.request, { cwd: outside });
  assert.equal(configuredJob.ok, true, configuredJob.errors.join('; '));
  assert.equal(configuredJob.inputDefaulted, false);
  assert.equal(configuredJob.input, EXAMPLE_ABS);
  assert.equal(configuredJob.settings.layout, 3);
  assert.equal(configuredJob.settings.effective.trace, 1);
  assert.equal(
    configuredJob.output,
    join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf'),
    'example job output must stay in the repo when cwd is outside it',
  );

  const dry = spawnSync(process.execPath, [SCRIPT, '--layout', '2', '--limit', '4', '--dry-run'], {
    cwd: outside,
    encoding: 'utf8',
  });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.layout, 2);
  assert.equal(body.selection.selected, 4);
  assert.equal(body.settings.effective.cols, SPECS[2].cols);
  assert.equal(body.settings.effective.rows, SPECS[2].defRows);
  assert.equal(body.input, EXAMPLE_ABS);
});

test('print config: app-published printer/ output paths stay in the repo from any cwd', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-out-'));
  const expected = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');

  const fromPrinterDir = buildPrintJob(
    { layout: 3, output: 'printer/output/hanzi-1000-v6-layout-3.pdf', limit: 1 },
    { cwd: join(REPO_ROOT, 'printer') },
  );
  assert.equal(fromPrinterDir.ok, true, fromPrinterDir.errors.join('; '));
  assert.equal(fromPrinterDir.output, expected, 'must not write printer/printer/output when cwd is printer/');

  const dotted = buildPrintJob(
    { layout: 3, output: './printer/output/hanzi-1000-v6-layout-3.pdf', limit: 1 },
    { cwd: outside },
  );
  assert.equal(dotted.output, expected);

  const localName = buildPrintJob({ layout: 2, output: 'out.pdf', limit: 1 }, { cwd: outside });
  assert.equal(localName.output, join(outside, 'out.pdf'));

  const absolute = buildPrintJob({ layout: 2, output: '/tmp/hanzi-sheet.pdf', limit: 1 }, { cwd: outside });
  assert.equal(absolute.output, '/tmp/hanzi-sheet.pdf');

  const dry = spawnSync(process.execPath, [
    SCRIPT,
    '--config', 'printer/spec/print-job.example.json',
    '--limit', '2',
    '--dry-run',
  ], { cwd: outside, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.output, expected);
  assert.equal(body.layout, 3);
  assert.equal(body.selection.selected, 2);
  assert.equal(body.settings.cols, null, 'example job must still omit cols so the sheet applies layout defaults');
});

test('print CLI: --describe and example-file --dry-run exit 0 with app layout 3 defaults', () => {
  const described = spawnSync(process.execPath, [SCRIPT, '--describe'], { encoding: 'utf8' });
  assert.equal(described.status, 0, described.stderr);
  const schema = JSON.parse(described.stdout);
  assert.equal(schema.layouts['3'].defaults.cols, 5);
  assert.equal(schema.layouts['2'].defaults.rows, 6);
  assert.equal(schema.exampleInput, EXAMPLE_INPUT);

  const dry = spawnSync(process.execPath, [
    SCRIPT,
    '--input', EXAMPLE_INPUT,
    '--layout', '3',
    '--limit', '6',
    '--dry-run',
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const job = JSON.parse(dry.stdout);
  assert.equal(job.ok, true);
  assert.equal(job.dryRun, true);
  assert.equal(job.selection.selected, 6);
  assert.equal(job.expectedPages, 2);
  assert.equal(job.settings.effective.cols, 5);
  assert.equal(job.settings.effective.rows, 3);
  assert.equal(job.settings.effective.trace, 1);
  assert.equal(job.validation.totalChars, 1000);
  assert.equal(job.job, 'layout-3');
  const layout3 = schema.jobs.find((item) => item.layout === 3);
  assert.deepEqual(layout3.argv, [process.execPath, PRINT_SCRIPT, 'layout', '3']);
  assert.equal(layout3.command, printInvoke(3).command);
  assert.equal(schema.example.command, layout3.command);
  assert.equal(schema.example.argv[1], PRINT_SCRIPT);
  assert.match(layout3.npm, /print:layout-3$/);
  assert.match(schema.npmFlagWarning, /consumes --dry-run/);
  assert.match(schema.npmFlagWarning, /does not write the PDF/);
  assert.equal(schema.recoversNpmDryRun, true);
});

test('print CLI: layout 2 / layout 3 phrases are the app-published jobs', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-phrase-'));
  const phrase = parseCliArgs(['layout', '3', '--limit', '4'], { cwd: outside });
  assert.equal(phrase.mode, 'run');
  assert.equal(phrase.request.layout, '3');
  assert.equal(phrase.request.input, undefined);
  const phraseJob = buildPrintJob(phrase.request, { cwd: outside });
  assert.equal(phraseJob.ok, true, phraseJob.errors.join('; '));
  assert.equal(phraseJob.job, 'layout-3');
  assert.equal(phraseJob.inputDefaulted, true);
  assert.equal(phraseJob.input, EXAMPLE_ABS);
  assert.equal(phraseJob.selection.selected, 4);
  assert.equal(phraseJob.settings.cols, null);
  assert.deepEqual(phraseJob.settings.effective, {
    cols: SPECS[3].cols,
    rows: SPECS[3].defRows,
    trace: SPECS[3].defTrace,
    mono: false,
    showFooterTitle: true,
  });

  const tokenJob = buildPrintJob(parseCliArgs(['layout-2', '--limit', '2'], { cwd: outside }).request, { cwd: outside });
  assert.equal(tokenJob.ok, true, tokenJob.errors.join('; '));
  assert.equal(tokenJob.job, 'layout-2');
  assert.equal(tokenJob.settings.effective.cols, SPECS[2].cols);
  assert.equal(tokenJob.settings.effective.rows, SPECS[2].defRows);
  assert.equal(tokenJob.settings.effective.trace, SPECS[2].defTrace);

  const namedJob = buildPrintJob(parseCliArgs(['--job', 'layout-3', '--limit', '1'], { cwd: outside }).request, { cwd: outside });
  assert.equal(namedJob.ok, true, namedJob.errors.join('; '));
  assert.equal(namedJob.settings.layout, 3);
  assert.equal(namedJob.settings.cols, null);

  const quoted = buildPrintJob(parseCliArgs(['--job', 'layout 2', '--limit', '1'], { cwd: outside }).request, { cwd: outside });
  assert.equal(quoted.ok, true, quoted.errors.join('; '));
  assert.equal(quoted.settings.layout, 2);

  const published = publishedPrintJob(3);
  assert.equal(published.input, EXAMPLE_INPUT);
  assert.equal(published.output, 'printer/output/hanzi-1000-v6-layout-3.pdf');
  const example = JSON.parse(readFileSync(join(REPO_ROOT, 'printer/spec/print-job.example.json'), 'utf8'));
  assert.equal(example.input, published.input);
  assert.equal(example.layout, published.layout);
  assert.equal(example.output, published.output);
  assert.equal(example.cols, undefined);
  assert.equal(example.rows, undefined);
  assert.equal(example.trace, undefined);

  const bad = parseCliArgs(['layout', '9']);
  assert.equal(bad.mode, 'error');
  assert.match(bad.errors[0], /layout must be 1, 2, 3, or 4/);

  const unknown = parseCliArgs(['--job', 'poster']);
  assert.equal(unknown.mode, 'error');
  assert.match(unknown.errors[0], /unknown job/);

  const conflict = parseCliArgs(['--job', 'layout-2', '--layout', '3']);
  assert.equal(conflict.mode, 'error');
  assert.match(conflict.errors[0], /conflicting layout/);

  const withFile = buildPrintJob(
    parseCliArgs([EXAMPLE_INPUT, 'layout', '2', '--limit', '2'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(withFile.ok, true, withFile.errors.join('; '));
  assert.equal(withFile.settings.layout, 2);
  assert.equal(withFile.input, EXAMPLE_ABS);

  const dry = spawnSync(process.execPath, [SCRIPT, 'layout', '3', '--limit', '2', '--dry-run'], {
    cwd: outside,
    encoding: 'utf8',
  });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.job, 'layout-3');
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.selection.selected, 2);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.output, join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-2.pdf'));

  const npm = spawnSync('npm', ['run', '--silent', 'print', '--', 'layout', '2', '--limit', '1', '--dry-run'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.job, 'layout-2');
  assert.equal(npmBody.layout, 2);
  assert.equal(npmBody.selection.selected, 1);
  assert.equal(npmBody.settings.effective.rows, SPECS[2].defRows);
  assert.equal(npmBody.input, EXAMPLE_ABS);
});

test('print CLI: a quoted layout phrase is the published job, not a filename', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-quoted-'));
  const quoted = parseCliArgs(['layout 3', '--limit', '2'], { cwd: outside });
  assert.equal(quoted.mode, 'run');
  assert.equal(quoted.request.layout, '3');
  assert.equal(quoted.request.input, undefined);
  const quotedJob = buildPrintJob(quoted.request, { cwd: outside });
  assert.equal(quotedJob.ok, true, quotedJob.errors.join('; '));
  assert.equal(quotedJob.job, 'layout-3');
  assert.equal(quotedJob.inputDefaulted, true);
  assert.equal(quotedJob.input, EXAMPLE_ABS);
  assert.equal(quotedJob.settings.layout, 3);
  assert.equal(quotedJob.settings.cols, null);
  assert.equal(quotedJob.settings.effective.cols, SPECS[3].cols);
  assert.equal(quotedJob.settings.effective.rows, SPECS[3].defRows);
  assert.equal(quotedJob.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(quotedJob.selection.selected, 2);
  assert.equal(quotedJob.jobs, undefined);

  for (const token of ['layout=2', 'layout:2', '"layout 2"', "'layout 2'"]) {
    const parsed = parseCliArgs([token, '--limit', '1'], { cwd: outside });
    assert.equal(parsed.mode, 'run', token);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${token}: ${job.errors.join('; ')}`);
    assert.equal(job.settings.layout, 2, token);
    assert.equal(job.input, EXAMPLE_ABS, token);
    assert.equal(job.settings.cols, null, token);
  }

  const withFile = buildPrintJob(
    parseCliArgs([EXAMPLE_INPUT, 'layout 2', '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(withFile.ok, true, withFile.errors.join('; '));
  assert.equal(withFile.input, EXAMPLE_ABS);
  assert.equal(withFile.settings.layout, 2);

  const fromConfigDir = mkdtempSync(join(tmpdir(), 'hanzi-print-quoted-config-'));
  const configPath = join(fromConfigDir, 'job.json');
  writeFileSync(configPath, JSON.stringify({ layout: 'layout 3', limit: 1 }));
  const fromConfig = buildPrintJob(parseCliArgs(['--config', configPath], { cwd: outside }).request, { cwd: outside });
  assert.equal(fromConfig.ok, true, fromConfig.errors.join('; '));
  assert.equal(fromConfig.settings.layout, 3);
  assert.equal(fromConfig.inputDefaulted, true);
  assert.equal(fromConfig.settings.cols, null);
  assert.equal(fromConfig.input, EXAMPLE_ABS);

  const splitJob = parseCliArgs(['--job', 'layout', '3', '--limit', '1'], { cwd: outside });
  assert.equal(splitJob.mode, 'run');
  assert.equal(splitJob.request.layout, '3');
  const splitJobBuilt = buildPrintJob(splitJob.request, { cwd: outside });
  assert.equal(splitJobBuilt.ok, true, splitJobBuilt.errors.join('; '));
  assert.equal(splitJobBuilt.settings.layout, 3);
  assert.equal(splitJobBuilt.inputDefaulted, true);

  const bad = parseCliArgs(['layout 9']);
  assert.equal(bad.mode, 'error');
  assert.match(bad.errors[0], /layout must be 1, 2, 3, or 4/);
  const badToken = parseCliArgs(['layout-9']);
  assert.equal(badToken.mode, 'error');
  assert.match(badToken.errors[0], /layout must be 1, 2, 3, or 4/);

  const missing = buildPrintJob({ input: EXAMPLE_ABS });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.jobs.find((item) => item.layout === 3).argv, [process.execPath, PRINT_SCRIPT, 'layout', '3']);
  assert.equal(missing.jobs.find((item) => item.layout === 3).input, EXAMPLE_INPUT);

  const dry = spawnSync(process.execPath, [SCRIPT, 'layout 3', '--limit', '1', '--dry-run'], {
    cwd: outside,
    encoding: 'utf8',
  });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.job, 'layout-3');
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.settings.cols, null);
  assert.equal(body.jobs, undefined);

  const none = spawnSync(process.execPath, [SCRIPT], { cwd: outside, encoding: 'utf8' });
  assert.equal(none.status, 2);
  const errBody = JSON.parse(none.stdout);
  assert.equal(errBody.ok, false);
  assert.match(errBody.errors.join('\n'), /layout 3/);
  assert.equal(errBody.jobs.find((item) => item.layout === 2).npm, printInvoke(2).npm);
  assert.equal(errBody.jobs.find((item) => item.layout === 3).input, EXAMPLE_INPUT);
  assert.equal(errBody.invoke, null);

  const described = spawnSync(process.execPath, [SCRIPT, '--describe'], { encoding: 'utf8' });
  assert.equal(described.status, 0, described.stderr);
  const schema = JSON.parse(described.stdout);
  assert.equal(schema.example.quoted, printInvoke(3, { quotedPhrase: true }).command);
  assert.match(schema.example.quoted, /'layout 3'$/);
});

test('print CLI: published argv works from any cwd and does not go through npm', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-argv-'));
  const published = publishedPrintJob(3);
  assert.equal(published.argv[0], process.execPath);
  assert.equal(published.argv[1], PRINT_SCRIPT);
  assert.equal(published.input, EXAMPLE_INPUT);
  assert.equal(published.cols, undefined);

  for (const cwd of [outside, join(REPO_ROOT, 'printer')]) {
    const dry = spawnSync(published.argv[0], [...published.argv.slice(1), '--limit', '1', '--dry-run'], {
      cwd,
      encoding: 'utf8',
    });
    assert.equal(dry.status, 0, `${cwd}: ${dry.stderr || dry.stdout}`);
    const body = JSON.parse(dry.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.dryRun, true);
    assert.equal(body.layout, 3);
    assert.equal(body.inputDefaulted, true);
    assert.equal(body.input, EXAMPLE_ABS);
    assert.equal(body.settings.cols, null);
    assert.equal(body.settings.effective.cols, SPECS[3].cols);
    assert.equal(body.settings.effective.rows, SPECS[3].defRows);
    assert.equal(body.settings.effective.trace, SPECS[3].defTrace);
    assert.equal(body.selection.selected, 1);
    assert.deepEqual(body.invoke.argv, published.argv);
    assert.equal(body.output, join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf'));
  }

  const quoted = spawnSync('sh', ['-c', `${printInvoke(2, { quotedPhrase: true }).command} --limit 1 --dry-run`], {
    cwd: outside,
    encoding: 'utf8',
  });
  assert.equal(quoted.status, 0, quoted.stderr || quoted.stdout);
  const quotedBody = JSON.parse(quoted.stdout);
  assert.equal(quotedBody.layout, 2);
  assert.equal(quotedBody.settings.cols, null);
  assert.equal(quotedBody.settings.effective.cols, SPECS[2].cols);
  assert.equal(quotedBody.input, EXAMPLE_ABS);

  const relativeFromPrinter = spawnSync(process.execPath, ['printer/scripts/print-pdf.mjs', '--describe'], {
    cwd: join(REPO_ROOT, 'printer'),
    encoding: 'utf8',
  });
  assert.notEqual(relativeFromPrinter.status, 0);
  assert.match(relativeFromPrinter.stderr, /MODULE_NOT_FOUND|Cannot find module/);

  const npm = spawnSync('npm', ['--prefix', REPO_ROOT, 'run', '--silent', 'print:layout-3', '--', '--limit', '1', '--dry-run'], {
    cwd: outside,
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.job, 'layout-3');
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.inputDefaulted, true);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(npmBody.selection.selected, 1);
  assert.equal(npmBody.input, EXAMPLE_ABS);
});

test('print config: npm-consumed --dry-run is only the print script, not an e2e child', () => {
  assert.equal(npmSwallowedDryRun({
    npm_config_dry_run: 'true',
    npm_lifecycle_script: 'node printer/scripts/print-pdf.mjs layout 3',
  }, PRINT_SCRIPT), true);
  assert.equal(npmSwallowedDryRun({
    npm_config_dry_run: 'true',
    npm_lifecycle_script: 'node scripts/print-pdf.mjs layout 3',
  }, join(REPO_ROOT, 'printer', 'scripts', 'print-pdf.mjs')), true);
  assert.equal(npmSwallowedDryRun({
    npm_config_dry_run: 'true',
    npm_lifecycle_script: 'node --test printer/e2e/cli-print.spec.mjs',
  }, PRINT_SCRIPT), false, 'e2e children inherit npm_config_dry_run and must still write a PDF');
  assert.equal(npmSwallowedDryRun({
    npm_lifecycle_script: 'node printer/scripts/print-pdf.mjs layout 3',
  }, PRINT_SCRIPT), false);
  assert.equal(npmSwallowedDryRun({
    npm_config_dry_run: 'true',
    npm_lifecycle_script: 'node printer/scripts/print-pdf.mjs',
  }, join(tmpdir(), 'other.mjs')), false);
});

test('print CLI: npm --dry-run on a published layout job does not write the PDF', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-npm-dry-'));
  const out = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const before = existsSync(out) ? statSync(out).mtimeMs : 0;
  const invocations = [
    {
      cwd: outside,
      args: ['--prefix', REPO_ROOT, 'run', '--silent', 'print', 'layout', '3', '--dry-run'],
    },
    {
      cwd: join(REPO_ROOT, 'printer'),
      args: ['run', '--silent', 'print:layout-3', '--dry-run'],
    },
  ];
  for (const invocation of invocations) {
    const npm = spawnSync('npm', invocation.args, {
      cwd: invocation.cwd,
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(npm.status, 0, `${invocation.cwd}: ${npm.stderr || npm.stdout}`);
    const body = JSON.parse(npm.stdout);
    assert.equal(body.ok, true, invocation.cwd);
    assert.equal(body.dryRun, true, invocation.cwd);
    assert.equal(body.npmDryRunRecovered, true, invocation.cwd);
    assert.equal(body.layout, 3, invocation.cwd);
    assert.equal(body.inputDefaulted, true, invocation.cwd);
    assert.equal(body.settings.cols, null, invocation.cwd);
    assert.equal(body.settings.effective.cols, SPECS[3].cols, invocation.cwd);
    assert.equal(body.input, EXAMPLE_ABS, invocation.cwd);
    assert.ok(body.warnings.includes(NPM_SWALLOWED_DRY_RUN), invocation.cwd);
    const after = existsSync(out) ? statSync(out).mtimeMs : 0;
    assert.equal(after, before, `${invocation.cwd}: npm --dry-run must not write ${out}`);
  }
});

test('print CLI: workbench label and the old e2e wording are the published job', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-label-'));
  assert.equal(workbenchLayoutLabel(3), '3 字/页');
  assert.equal(publishedPrintJob(3).label, '3 字/页');
  assert.match(publishedPrintJob(2).legacyNpm, /test:e2e -- layout 2$/);

  const phrases = [
    ['3字/页', '--limit', '1'],
    ['3 字/页', '--limit', '1'],
    ['三字/页', '--limit', '1'],
    ['每页3字', '--limit', '1'],
    ['每页三个字', '--limit', '1'],
    ['3字每页', '--limit', '1'],
    ['per-page', '3', '--limit', '1'],
    ['per-page-3', '--limit', '1'],
    ['layout', '三', '--limit', '1'],
    ['e2e', 'layout', '3', '--limit', '1'],
    ['test:e2e', 'layout', '3', '--limit', '1'],
    ['run', 'the', 'e2e', 'test', 'layout', '3', '--limit', '1'],
    ['print', 'layout', '3', '--limit', '1'],
    ['3', '字/页', '--limit', '1'],
    ['每页', '3', '字', '--limit', '1'],
  ];
  for (const argv of phrases) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', argv.join(' '));
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' ')}: ${job.errors.join('; ')}`);
    assert.equal(job.settings.layout, 3, argv.join(' '));
    assert.equal(job.inputDefaulted, true, argv.join(' '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' '));
    assert.equal(job.settings.cols, null, argv.join(' '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' '));
    assert.equal(job.settings.effective.rows, SPECS[3].defRows, argv.join(' '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' '));
    assert.equal(job.selection.selected, 1, argv.join(' '));
  }

  const withFile = buildPrintJob(
    parseCliArgs([EXAMPLE_INPUT, 'e2e', 'layout', '2', '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(withFile.ok, true, withFile.errors.join('; '));
  assert.equal(withFile.inputDefaulted, false);
  assert.equal(withFile.input, EXAMPLE_ABS);
  assert.equal(withFile.settings.layout, 2);
  assert.equal(withFile.settings.cols, null);

  const conflict = parseCliArgs(['layout', '2', '3字/页']);
  assert.equal(conflict.mode, 'error');
  assert.match(conflict.errors[0], /conflicting layout/);

  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');
  assert.equal(resolveE2eEntry(['--e2e', 'layout', '3']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '3字/页']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '--test-name-pattern', 'Basic']).action, 'test');
  assert.equal(resolveE2eEntry([]).action, 'test', 'a bare print CLI call is not the test suite');

  const dry = spawnSync(process.execPath, [SCRIPT, '--e2e', 'layout', '3', '--limit', '1', '--dry-run'], {
    cwd: outside,
    encoding: 'utf8',
  });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.settings.cols, null);
  assert.equal(body.input, EXAMPLE_ABS);
});

test('print CLI: npm run test:e2e layout 3 --dry-run prints a preview, not the suite', () => {
  const out = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const before = existsSync(out) ? statSync(out).mtimeMs : 0;
  const npm = spawnSync('npm', ['run', '--silent', 'test:e2e', 'layout', '3', '--dry-run'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const body = JSON.parse(npm.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.npmDryRunRecovered, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(existsSync(out) ? statSync(out).mtimeMs : 0, before);
});

test('print CLI: the app-published job file is an argument, not a dataset', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-jobfile-'));
  const expectedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const before = existsSync(expectedOut) ? statSync(expectedOut).mtimeMs : 0;

  const phrases = [
    [EXAMPLE_JOB, '--limit', '1'],
    ['"' + EXAMPLE_JOB + '"', '--limit', '1'],
    [join(REPO_ROOT, EXAMPLE_JOB), '--limit', '1'],
  ];
  for (const argv of phrases) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', argv.join(' '));
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' ')}: ${job.errors.join('; ')}`);
    assert.equal(job.settings.layout, 3, argv.join(' '));
    assert.equal(job.inputDefaulted, false, argv.join(' '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' '));
    assert.equal(job.settings.cols, null, argv.join(' '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' '));
    assert.equal(job.settings.effective.rows, SPECS[3].defRows, argv.join(' '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' '));
    assert.equal(job.selection.selected, 1, argv.join(' '));
    assert.equal(job.output, expectedOut, argv.join(' '));
  }

  const fromPrinter = buildPrintJob(
    parseCliArgs(['spec/print-job.example.json', '--limit', '1'], { cwd: join(REPO_ROOT, 'printer') }).request,
    { cwd: join(REPO_ROOT, 'printer') },
  );
  assert.equal(fromPrinter.ok, true, fromPrinter.errors.join('; '));
  assert.equal(fromPrinter.output, expectedOut, 'printer/ cwd must not nest printer/printer/output');
  assert.equal(fromPrinter.settings.cols, null);

  const datasetOnly = parseCliArgs([EXAMPLE_INPUT], { cwd: outside });
  assert.equal(datasetOnly.mode, 'run');
  assert.equal(datasetOnly.request.input, EXAMPLE_INPUT);
  assert.equal(datasetOnly.request.layout, undefined);
  const datasetBuilt = buildPrintJob(datasetOnly.request, { cwd: outside });
  assert.equal(datasetBuilt.ok, false);
  assert.match(datasetBuilt.errors.join('\n'), /layout is required/);
  assert.equal(datasetBuilt.input, EXAMPLE_ABS);

  const disguised = join(outside, 'chars.json');
  writeFileSync(disguised, JSON.stringify({
    layout: 4,
    groups: [{ category: 'g', characters: [{ char: '一', pinyin: 'yī', words: ['一个'] }] }],
  }));
  const disguisedParsed = parseCliArgs([disguised], { cwd: outside });
  assert.equal(disguisedParsed.request.layout, undefined);
  assert.equal(disguisedParsed.request.input, disguised);
  assert.match(buildPrintJob(disguisedParsed.request, { cwd: outside }).errors.join('\n'), /layout is required/);

  const miniPath = join(outside, 'mini-job.json');
  writeFileSync(miniPath, JSON.stringify({ layout: 2, limit: 1 }));
  const mini = buildPrintJob(parseCliArgs([miniPath], { cwd: outside }).request, { cwd: outside });
  assert.equal(mini.ok, true, mini.errors.join('; '));
  assert.equal(mini.settings.layout, 2);
  assert.equal(mini.inputDefaulted, true);
  assert.equal(mini.input, EXAMPLE_ABS);
  assert.equal(mini.settings.cols, null);
  assert.equal(mini.settings.effective.cols, SPECS[2].cols);
  assert.equal(mini.selection.selected, 1);

  const twoJobs = parseCliArgs([EXAMPLE_JOB, miniPath], { cwd: outside });
  assert.equal(twoJobs.mode, 'error');
  assert.match(twoJobs.errors[0], /only one print-job JSON/);

  const bothConfigs = parseCliArgs(['--config', EXAMPLE_JOB, EXAMPLE_JOB], { cwd: outside });
  assert.equal(bothConfigs.mode, 'error');
  assert.match(bothConfigs.errors[0], /only one config/);

  const datasetAsConfig = parseCliArgs(['--config', EXAMPLE_INPUT, '--layout', '3'], { cwd: outside });
  assert.equal(datasetAsConfig.mode, 'error');
  assert.match(datasetAsConfig.errors[0], /character dataset/);

  const inputOverride = buildPrintJob(
    parseCliArgs(['--config', EXAMPLE_JOB, EXAMPLE_INPUT, '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(inputOverride.ok, true, inputOverride.errors.join('; '));
  assert.equal(inputOverride.input, EXAMPLE_ABS);
  assert.equal(inputOverride.settings.layout, 3);
  assert.equal(inputOverride.settings.cols, null);

  const layoutOverride = buildPrintJob(
    parseCliArgs([EXAMPLE_JOB, 'layout', '2', '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(layoutOverride.ok, true, layoutOverride.errors.join('; '));
  assert.equal(layoutOverride.settings.layout, 2);
  assert.equal(layoutOverride.settings.cols, null);
  assert.equal(layoutOverride.settings.effective.cols, SPECS[2].cols);
  assert.equal(layoutOverride.output, expectedOut, 'explicit output in the job file stays unless --output is passed');

  assert.equal(resolveE2eEntry(['--e2e', EXAMPLE_JOB]).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '--config', 'missing-job.json']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');

  const described = describePrintConfig();
  assert.deepEqual(described.example.configArgv, [process.execPath, PRINT_SCRIPT, join(REPO_ROOT, EXAMPLE_JOB)]);
  assert.deepEqual(described.jobs.find((item) => item.layout === 3).configArgv, described.example.configArgv);
  assert.equal(described.jobs.find((item) => item.layout === 2).config, undefined);

  const invocations = [
    { cwd: outside, args: [SCRIPT, EXAMPLE_JOB, '--limit', '1', '--dry-run'] },
    { cwd: join(REPO_ROOT, 'printer'), args: [SCRIPT, 'printer/spec/print-job.example.json', '--limit', '1', '--dry-run'] },
    { cwd: outside, args: [SCRIPT, '--e2e', EXAMPLE_JOB, '--limit', '1', '--dry-run'] },
    {
      cwd: outside,
      command: described.example.configArgv[0],
      args: [...described.example.configArgv.slice(1), '--limit', '1', '--dry-run'],
    },
  ];
  for (const invocation of invocations) {
    const run = spawnSync(invocation.command || process.execPath, invocation.args, {
      cwd: invocation.cwd,
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(run.status, 0, `${invocation.cwd} ${invocation.args.join(' ')}\n${run.stderr || run.stdout}`);
    const body = JSON.parse(run.stdout);
    assert.equal(body.ok, true, invocation.cwd);
    assert.equal(body.dryRun, true, invocation.cwd);
    assert.equal(body.layout, 3, invocation.cwd);
    assert.equal(body.input, EXAMPLE_ABS, invocation.cwd);
    assert.equal(body.settings.cols, null, invocation.cwd);
    assert.equal(body.settings.effective.trace, SPECS[3].defTrace, invocation.cwd);
    assert.equal(body.selection.selected, 1, invocation.cwd);
    assert.equal(body.output, expectedOut, invocation.cwd);
    assert.equal(existsSync(expectedOut) ? statSync(expectedOut).mtimeMs : 0, before, invocation.cwd);
  }

  const npm = spawnSync('npm', ['--prefix', REPO_ROOT, 'run', '--silent', 'print', '--', EXAMPLE_JOB, '--limit', '1', '--dry-run'], {
    cwd: outside,
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.input, EXAMPLE_ABS);
  assert.equal(existsSync(expectedOut) ? statSync(expectedOut).mtimeMs : 0, before);
});

test('print CLI: a quoted human instruction is the published job, not a filename', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-instruction-'));
  const expectedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  const phrases = [
    PRINT_INSTRUCTION,
    'run the end-to-end test to generate the PDF file, layout 3',
    'run the end-to-end test to generate the PDF file, and then giving some configuration such as layout 3',
    'generate the PDF. layout 3',
    'click the workbench button 3 字/页',
    '"run the e2e test, layout 3"',
  ];
  for (const phrase of phrases) {
    const parsed = parseCliArgs([phrase, '--limit', '1'], { cwd: outside });
    assert.equal(parsed.mode, 'run', phrase);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${phrase}: ${job.errors.join('; ')}`);
    assert.equal(job.settings.layout, 3, phrase);
    assert.equal(job.inputDefaulted, true, phrase);
    assert.equal(job.input, EXAMPLE_ABS, phrase);
    assert.equal(job.settings.cols, null, phrase);
    assert.equal(job.settings.effective.cols, SPECS[3].cols, phrase);
    assert.equal(job.settings.effective.rows, SPECS[3].defRows, phrase);
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, phrase);
    assert.equal(job.selection.selected, 1, phrase);
    assert.equal(job.output, expectedOut, phrase);
  }

  const withDataset = buildPrintJob(
    parseCliArgs([`print ${EXAMPLE_INPUT} layout 2`, '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(withDataset.ok, true, withDataset.errors.join('; '));
  assert.equal(withDataset.inputDefaulted, false);
  assert.equal(withDataset.input, EXAMPLE_ABS);
  assert.equal(withDataset.settings.layout, 2);
  assert.equal(withDataset.settings.cols, null);
  assert.equal(withDataset.settings.effective.cols, SPECS[2].cols);

  const fromJobFile = buildPrintJob(
    parseCliArgs([`use ${EXAMPLE_JOB}`], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(fromJobFile.ok, true, fromJobFile.errors.join('; '));
  assert.equal(fromJobFile.settings.layout, 3);
  assert.equal(fromJobFile.input, EXAMPLE_ABS);
  assert.equal(fromJobFile.settings.cols, null);
  assert.equal(fromJobFile.output, join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf'));

  const notAnInstruction = buildPrintJob(
    parseCliArgs(['run the visual regression suite'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(notAnInstruction.ok, false);
  assert.notEqual(notAnInstruction.input, EXAMPLE_ABS);
  assert.match(notAnInstruction.errors.join('\n'), /input not found/);

  const conflict = parseCliArgs(['layout 3 or layout 2']);
  assert.equal(conflict.mode, 'error');
  assert.match(conflict.errors[0], /conflicting layout/);

  const bad = parseCliArgs(['print layout 9']);
  assert.equal(bad.mode, 'error');
  assert.match(bad.errors[0], /layout must be 1, 2, 3, or 4/);

  assert.equal(resolveE2eEntry(['--e2e', PRINT_INSTRUCTION]).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');

  const described = describePrintConfig();
  assert.equal(described.example.instruction, PRINT_INSTRUCTION);
  assert.deepEqual(described.example.instructionArgv, [process.execPath, PRINT_SCRIPT, PRINT_INSTRUCTION]);

  const before = existsSync(expectedOut) ? statSync(expectedOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [SCRIPT, PRINT_INSTRUCTION, '--limit', '1', '--dry-run'], {
    cwd: outside,
    encoding: 'utf8',
  });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, expectedOut);
  assert.equal(existsSync(expectedOut) ? statSync(expectedOut).mtimeMs : 0, before);

  const npm = spawnSync('npm', ['run', '--silent', 'test:e2e', PRINT_INSTRUCTION, '--dry-run'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.npmDryRunRecovered, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.inputDefaulted, true);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.input, EXAMPLE_ABS);
  assert.equal(existsSync(expectedOut) ? statSync(expectedOut).mtimeMs : 0, before);
});

test('print CLI: quoted instruction options are configuration, not a filename', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-embedded-'));
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');

  const phrases = [
    '跑端到端测试生成 PDF，layout 3',
    '生成字帖 PDF，3 字/页',
    '生成PDF。layout 3',
    'use the example input file, layout 3',
    'job layout-3',
    'npm run print:layout-3',
    'node printer/scripts/print-pdf.mjs layout 3',
    `npm --prefix ${outside} run print:layout-3`,
  ];
  for (const phrase of phrases) {
    const parsed = parseCliArgs([phrase, '--limit', '1'], { cwd: outside });
    assert.equal(parsed.mode, 'run', phrase);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${phrase}: ${job.errors.join('; ')}`);
    assert.equal(job.settings.layout, 3, phrase);
    assert.equal(job.inputDefaulted, true, phrase);
    assert.equal(job.input, EXAMPLE_ABS, phrase);
    assert.equal(job.settings.cols, null, phrase);
    assert.equal(job.settings.effective.cols, SPECS[3].cols, phrase);
    assert.equal(job.settings.effective.rows, SPECS[3].defRows, phrase);
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, phrase);
    assert.equal(job.selection.selected, 1, phrase);
    assert.notEqual(job.input, outside, phrase);
  }

  const flagged = parseCliArgs(['layout 3 --limit 6 --cols 6 --rows 4 --dry-run'], { cwd: outside });
  assert.equal(flagged.mode, 'dry-run');
  const withFlags = buildPrintJob(flagged.request, { cwd: outside });
  assert.equal(withFlags.ok, true, withFlags.errors.join('; '));
  assert.equal(withFlags.inputDefaulted, true);
  assert.equal(withFlags.input, EXAMPLE_ABS);
  assert.equal(withFlags.selection.selected, 6);
  assert.equal(withFlags.settings.cols, 6);
  assert.equal(withFlags.settings.rows, 4);
  assert.equal(withFlags.settings.trace, null, 'omitted trace still comes from the layout SPEC');
  assert.equal(withFlags.settings.effective.trace, SPECS[3].defTrace);

  const prose = buildPrintJob(
    parseCliArgs(['with layout 3 and cols 5 rows 3 trace 1, limit 2'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(prose.ok, true, prose.errors.join('; '));
  assert.equal(prose.input, EXAMPLE_ABS);
  assert.equal(prose.settings.layout, 3);
  assert.equal(prose.settings.cols, 5);
  assert.equal(prose.settings.rows, 3);
  assert.equal(prose.settings.trace, 1);
  assert.equal(prose.selection.selected, 2);

  const grid = buildPrintJob(
    parseCliArgs(['3 字/页，每行 5，总行 3，描红 1，黑白省墨'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(grid.ok, true, grid.errors.join('; '));
  assert.equal(grid.inputDefaulted, true);
  assert.equal(grid.input, EXAMPLE_ABS);
  assert.equal(grid.settings.cols, 5);
  assert.equal(grid.settings.rows, 3);
  assert.equal(grid.settings.trace, 1);
  assert.equal(grid.settings.mono, true);
  assert.equal(grid.settings.effective.cols, 5);

  const outputPhrase = parseCliArgs(['layout 3 --output printer/output/x.pdf --limit 1'], { cwd: outside });
  assert.equal(outputPhrase.mode, 'run');
  assert.equal(outputPhrase.request.input, undefined);
  assert.equal(outputPhrase.request.output, 'printer/output/x.pdf');
  const outputJob = buildPrintJob(outputPhrase.request, { cwd: outside });
  assert.equal(outputJob.ok, true, outputJob.errors.join('; '));
  assert.equal(outputJob.input, EXAMPLE_ABS);
  assert.equal(outputJob.output, join(REPO_ROOT, 'printer', 'output', 'x.pdf'));

  const fromJob = buildPrintJob(
    parseCliArgs([`use ${EXAMPLE_JOB} --limit 1`], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(fromJob.ok, true, fromJob.errors.join('; '));
  assert.equal(fromJob.settings.layout, 3);
  assert.equal(fromJob.input, EXAMPLE_ABS);
  assert.equal(fromJob.selection.selected, 1);
  assert.equal(fromJob.settings.cols, null);
  assert.equal(fromJob.output, fullOut);

  const argvWins = buildPrintJob(
    parseCliArgs(['layout 3 --limit 6', '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(argvWins.ok, true, argvWins.errors.join('; '));
  assert.equal(argvWins.selection.selected, 1);

  const flagFirst = parseCliArgs(['--dry-run layout 3 --limit 1'], { cwd: outside });
  assert.equal(flagFirst.mode, 'dry-run');
  const flagFirstJob = buildPrintJob(flagFirst.request, { cwd: outside });
  assert.equal(flagFirstJob.ok, true, flagFirstJob.errors.join('; '));
  assert.equal(flagFirstJob.inputDefaulted, true);
  assert.equal(flagFirstJob.input, EXAMPLE_ABS);
  assert.equal(flagFirstJob.selection.selected, 1);
  assert.equal(flagFirstJob.settings.cols, null);

  assert.equal(parseCliArgs(['layout 3 or layout 2']).mode, 'error');
  assert.match(parseCliArgs(['layout 3 or layout 2']).errors[0], /conflicting layout/);
  const separateExtra = buildPrintJob(parseCliArgs(['layout', '3', 'extra'], { cwd: outside }).request, { cwd: outside });
  assert.equal(separateExtra.ok, false);
  assert.match(separateExtra.errors.join('\n'), /input not found/);
  assert.notEqual(separateExtra.input, EXAMPLE_ABS);
  const quotedExtra = buildPrintJob(parseCliArgs(['layout 3 extra'], { cwd: outside }).request, { cwd: outside });
  assert.equal(quotedExtra.ok, true, quotedExtra.errors.join('; '));
  assert.equal(quotedExtra.inputDefaulted, true);
  assert.equal(quotedExtra.input, EXAMPLE_ABS);

  const notAnInstruction = buildPrintJob(
    parseCliArgs(['run the visual regression suite'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(notAnInstruction.ok, false);
  assert.notEqual(notAnInstruction.input, EXAMPLE_ABS);

  assert.equal(resolveE2eEntry(['--e2e', '跑端到端测试生成 PDF，layout 3']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'layout 3 --not-a-real-flag']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');

  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT,
    '--e2e',
    '跑端到端测试生成 PDF，layout 3 --limit 1 --dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, limitedOut);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
});

test('print CLI: 3 per page and N Chinese characters on the page are the published job', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-per-page-'));
  const expectedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  const described = describePrintConfig();
  assert.deepEqual(described.jobs.find((job) => job.layout === 3).phrases, [
    'layout 3',
    '3 字/页',
    '3个字/页',
    '每页字数 3',
    '3 per page',
    '3 chars per page',
    'chars per page 3',
    'three per page',
    'three Chinese characters on the page',
  ]);
  assert.match(described.example.note, /3 per page/);
  assert.match(described.example.note, /jobs\[\]\.phrases/);

  const phrases = [
    ['3 per page'],
    ['3', 'per', 'page'],
    ['3 per page.'],
    ['three per page'],
    ['layout three'],
    ['layout', 'three'],
    ['3-per-page'],
    ['3 chars/page'],
    ['three characters per page'],
    ['three Chinese characters on the page'],
    ['3', 'Chinese', 'characters', 'on', 'the', 'page'],
    ['run the end-to-end test to generate the PDF, 3 per page'],
    ['whether there are three Chinese characters on the page'],
    ['layout', '3', 'per', 'page'],
  ];
  for (const argv of phrases) {
    const parsed = parseCliArgs([...argv, '--limit', '1'], { cwd: outside });
    assert.equal(parsed.mode, 'run', argv.join(' | '));
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.inputDefaulted, true, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.rows, null, argv.join(' | '));
    assert.equal(job.settings.trace, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.settings.effective.rows, SPECS[3].defRows, argv.join(' | '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' | '));
    assert.equal(job.selection.selected, 1, argv.join(' | '));
    assert.equal(job.output, expectedOut, argv.join(' | '));
  }

  const two = buildPrintJob(
    parseCliArgs(['two Chinese characters on the page', '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(two.ok, true, two.errors.join('; '));
  assert.equal(two.settings.layout, 2);
  assert.equal(two.inputDefaulted, true);
  assert.equal(two.input, EXAMPLE_ABS);
  assert.equal(two.settings.cols, null);
  assert.equal(two.settings.effective.cols, SPECS[2].cols);
  assert.equal(two.settings.effective.rows, SPECS[2].defRows);
  assert.equal(two.settings.effective.trace, SPECS[2].defTrace);

  const withDataset = buildPrintJob(
    parseCliArgs([`print ${EXAMPLE_INPUT} at 3 per page`, '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(withDataset.ok, true, withDataset.errors.join('; '));
  assert.equal(withDataset.inputDefaulted, false);
  assert.equal(withDataset.input, EXAMPLE_ABS);
  assert.equal(withDataset.settings.layout, 3);
  assert.equal(withDataset.settings.cols, null);

  const notALayout = buildPrintJob(
    parseCliArgs(['notes on the page'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(notALayout.ok, false);
  assert.notEqual(notALayout.input, EXAMPLE_ABS);
  assert.match(notALayout.errors.join('\n'), /input not found/);

  const conflict = parseCliArgs(['two or three Chinese characters on the page']);
  assert.equal(conflict.mode, 'error');
  assert.match(conflict.errors[0], /conflicting layout/);

  const separateExtra = buildPrintJob(
    parseCliArgs(['layout', '3', 'extra'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(separateExtra.ok, false);
  assert.match(separateExtra.errors.join('\n'), /input not found/);

  assert.match(parseCliArgs(['per', 'page']).errors[0], /layout must be 1, 2, 3, or 4/);
  assert.match(parseCliArgs(['per-page']).errors[0], /layout must be 1, 2, 3, or 4/);
  assert.match(parseCliArgs(['per-page', '9']).errors[0], /layout must be 1, 2, 3, or 4/);

  assert.equal(resolveE2eEntry(['--e2e', '3 per page']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'three Chinese characters on the page']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');

  const before = existsSync(expectedOut) ? statSync(expectedOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [SCRIPT, '--e2e', '3 per page', '--limit', '1', '--dry-run'], {
    cwd: outside,
    encoding: 'utf8',
  });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, expectedOut);
  assert.equal(existsSync(expectedOut) ? statSync(expectedOut).mtimeMs : 0, before);
});

test('print CLI: a comma stuck to a split instruction word is glue, not a filename', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-comma-'));
  const expectedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  const layout2Out = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-2-r1-1.pdf');
  assert.match(describePrintConfig().example.note, /comma stuck to PDF,/);
  assert.match(formatHelp(), /comma stuck to PDF,/);

  const phrases = [
    ['run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF,', 'layout', '3'],
    ['run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF', 'file,', 'layout', '3'],
    ['run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF', ',', 'layout', '3'],
    ['run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF\uff0c', 'layout', '3'],
    ['run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF', 'file.', 'and', 'then', 'giving', 'some', 'configuration', 'such', 'as', 'layout', '3'],
    ['3,'],
    ['--job', 'layout-3,'],
    ['--layout', 'layout 3,'],
  ];
  for (const argv of phrases) {
    const parsed = parseCliArgs([...argv, '--limit', '1'], { cwd: outside });
    assert.equal(parsed.mode, 'run', argv.join(' | '));
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.inputDefaulted, true, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.rows, null, argv.join(' | '));
    assert.equal(job.settings.trace, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.settings.effective.rows, SPECS[3].defRows, argv.join(' | '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' | '));
    assert.equal(job.selection.selected, 1, argv.join(' | '));
    assert.equal(job.output, expectedOut, argv.join(' | '));
  }

  const fromDataset = buildPrintJob(
    parseCliArgs([`${EXAMPLE_INPUT},`, 'layout', '2', '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(fromDataset.ok, true, fromDataset.errors.join('; '));
  assert.equal(fromDataset.inputDefaulted, false);
  assert.equal(fromDataset.input, EXAMPLE_ABS);
  assert.equal(fromDataset.settings.layout, 2);
  assert.equal(fromDataset.settings.cols, null);
  assert.equal(fromDataset.settings.effective.cols, SPECS[2].cols);
  assert.equal(fromDataset.output, layout2Out);

  const flaggedInput = buildPrintJob(
    parseCliArgs(['--input', `${EXAMPLE_INPUT},`, '--layout', '3', '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(flaggedInput.ok, true, flaggedInput.errors.join('; '));
  assert.equal(flaggedInput.input, EXAMPLE_ABS);
  assert.equal(flaggedInput.inputDefaulted, false);
  assert.equal(flaggedInput.settings.cols, null);

  const fromJobFile = buildPrintJob(
    parseCliArgs([`${EXAMPLE_JOB},`, '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(fromJobFile.ok, true, fromJobFile.errors.join('; '));
  assert.equal(fromJobFile.settings.layout, 3);
  assert.equal(fromJobFile.input, EXAMPLE_ABS);
  assert.equal(fromJobFile.settings.cols, null);
  assert.equal(fromJobFile.output, join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf'));

  const missing = buildPrintJob(
    parseCliArgs(['layout', '3', 'extra,'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join('\n'), /extra,/);
  assert.notEqual(missing.input, EXAMPLE_ABS);

  const conflict = parseCliArgs(['run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF,', 'layout', '3', 'or', 'layout', '2']);
  assert.equal(conflict.mode, 'error');
  assert.match(conflict.errors[0], /conflicting layout/);

  assert.equal(
    resolveE2eEntry(['--e2e', 'run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF,', 'layout', '3']).action,
    'print',
  );
  assert.equal(resolveE2eEntry(['--e2e', 'run', 'the', 'suite']).action, 'test');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');

  const before = existsSync(expectedOut) ? statSync(expectedOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT,
    '--e2e',
    'run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF,', 'layout', '3',
    '--limit', '1',
    '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, expectedOut);
  assert.equal(existsSync(expectedOut) ? statSync(expectedOut).mtimeMs : 0, before);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    'run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF,', 'layout', '3',
    '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.inputDefaulted, true);
  assert.equal(npmBody.input, EXAMPLE_ABS);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.selection.selected, 1);
  assert.equal(existsSync(expectedOut) ? statSync(expectedOut).mtimeMs : 0, before);
});

test('print CLI: a bare published filename is that app file from any cwd', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-basename-'));
  const expectedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  const seedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-seed-layout-2-r1-1.pdf');
  assert.match(describePrintConfig().example.note, /bare name hanzi-1000-v6.json/);
  assert.match(formatHelp(), /bare name hanzi-1000-v6.json/);
  assert.match(formatHelp(), /print-job.example.json/);

  const phrases = [
    ['hanzi-1000-v6.json', 'layout', '3'],
    ['hanzi-1000-v6.json,', 'layout', '3'],
    ['--input', 'hanzi-1000-v6.json', '--layout', '3'],
    ['spec/data/hanzi-1000-v6.json', 'layout', '3'],
    ['data/hanzi-1000-v6.json', 'layout', '3'],
    ['./hanzi-1000-v6.json', 'layout', '3'],
    ['use hanzi-1000-v6.json, layout 3'],
    ['use', 'hanzi-1000-v6.json,', 'layout', '3'],
    ['run the end-to-end test with hanzi-1000-v6.json, layout 3'],
  ];
  for (const argv of phrases) {
    const parsed = parseCliArgs([...argv, '--limit', '1'], { cwd: outside });
    assert.equal(parsed.mode, 'run', argv.join(' | '));
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.inputDefaulted, false, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.rows, null, argv.join(' | '));
    assert.equal(job.settings.trace, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' | '));
    assert.equal(job.selection.selected, 1, argv.join(' | '));
    assert.equal(job.selection.total, 1000, argv.join(' | '));
    assert.equal(job.output, expectedOut, argv.join(' | '));
  }

  const seed = buildPrintJob(
    parseCliArgs(['hanzi-seed.json', 'layout', '2', '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(seed.ok, true, seed.errors.join('; '));
  assert.equal(seed.input, join(REPO_ROOT, 'printer', 'spec', 'data', 'hanzi-seed.json'));
  assert.equal(seed.settings.layout, 2);
  assert.equal(seed.settings.cols, null);
  assert.equal(seed.settings.effective.cols, SPECS[2].cols);
  assert.equal(seed.output, seedOut);

  const v5 = buildPrintJob(
    parseCliArgs(['--input', 'hanzi-1000-v5.json', '--layout', '3', '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(v5.ok, true, v5.errors.join('; '));
  assert.equal(v5.input, join(REPO_ROOT, 'printer', 'spec', 'data', 'hanzi-1000-v5.json'));
  assert.equal(v5.inputDefaulted, false);

  const jobFile = buildPrintJob(
    parseCliArgs(['print-job.example.json', '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(jobFile.ok, true, jobFile.errors.join('; '));
  assert.equal(jobFile.settings.layout, 3);
  assert.equal(jobFile.input, EXAMPLE_ABS);
  assert.equal(jobFile.settings.cols, null);
  assert.equal(jobFile.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(jobFile.output, join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf'));

  const jobAlias = buildPrintJob(
    parseCliArgs(['--config', 'spec/print-job.example.json', '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(jobAlias.ok, true, jobAlias.errors.join('; '));
  assert.equal(jobAlias.settings.layout, 3);
  assert.equal(jobAlias.input, EXAMPLE_ABS);
  assert.equal(jobAlias.settings.cols, null);

  const missing = buildPrintJob(
    parseCliArgs(['layout', '3', 'not-a-real.json'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join('\n'), /not-a-real.json/);
  assert.equal(missing.input, join(outside, 'not-a-real.json'));
  assert.doesNotMatch(missing.errors.join('\n'), /printer\/spec/);

  writeFileSync(join(outside, 'hanzi-1000-v6.json'), JSON.stringify({
    meta: { title: 'local' },
    groups: [{ category: 't', characters: [{ char: '一', pinyin: 'yī', words: ['一个'] }] }],
  }));
  const local = buildPrintJob(
    parseCliArgs(['hanzi-1000-v6.json', 'layout', '3', '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(local.ok, true, local.errors.join('; '));
  assert.equal(local.input, join(outside, 'hanzi-1000-v6.json'));
  assert.equal(local.selection.total, 1);
  assert.notEqual(local.input, EXAMPLE_ABS);

  writeFileSync(join(outside, 'print-job.example.json'), JSON.stringify({
    input: 'hanzi-seed.json',
    layout: 2,
    output: 'printer/output/local-job.pdf',
  }));
  const localJob = buildPrintJob(
    parseCliArgs(['print-job.example.json', '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(localJob.ok, true, localJob.errors.join('; '));
  assert.equal(localJob.settings.layout, 2);
  assert.equal(localJob.input, join(REPO_ROOT, 'printer', 'spec', 'data', 'hanzi-seed.json'));
  assert.equal(localJob.output, join(REPO_ROOT, 'printer', 'output', 'local-job.pdf'));
  assert.equal(localJob.settings.cols, null);

  const before = existsSync(expectedOut) ? statSync(expectedOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT, '--input', 'hanzi-1000-v6.json', '--layout', '3', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, false);
  assert.notEqual(body.input, EXAMPLE_ABS);
  assert.equal(body.input.endsWith('/hanzi-1000-v6.json'), true, body.input);
  assert.equal(body.selection.total, 1, 'cwd file still wins over the published dataset');
  assert.equal(existsSync(expectedOut) ? statSync(expectedOut).mtimeMs : 0, before);

  const jobDry = spawnSync(process.execPath, [
    SCRIPT, 'print-job.example.json', '--limit', '1', '--dry-run',
  ], { cwd: mkdtempSync(join(tmpdir(), 'hanzi-print-jobname-')), encoding: 'utf8', timeout: 20000 });
  assert.equal(jobDry.status, 0, jobDry.stderr || jobDry.stdout);
  const jobBody = JSON.parse(jobDry.stdout);
  assert.equal(jobBody.ok, true);
  assert.equal(jobBody.dryRun, true);
  assert.equal(jobBody.layout, 3);
  assert.equal(jobBody.input, EXAMPLE_ABS);
  assert.equal(jobBody.settings.cols, null);
  assert.equal(jobBody.settings.effective.cols, SPECS[3].cols);
  assert.equal(jobBody.selection.selected, 1);
});

test('print CLI: separate argv option words are configuration, not a filename', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-split-opts-'));
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  assert.match(formatHelp(), /layout 3 limit 6/);
  assert.match(describePrintConfig().example.note, /as separate argv/);
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /layout 3 limit 6/);

  const phrases = [
    ['layout', '3', 'limit', '6'],
    ['layout', '3', 'limit,', '6'],
    ['layout', '3', '--', 'limit', '6'],
    ['hanzi-1000-v6.json', 'layout', '3', 'limit', '24'],
    ['input', 'hanzi-1000-v6.json', 'layout', '3', 'limit', '6'],
    ['the', 'input', 'file', 'hanzi-1000-v6.json', 'and', 'layout', '3', 'limit', '6'],
    ['the', 'input', 'of', 'a', 'JSON', 'file', 'hanzi-1000-v6.json,', 'layout', '3', 'limit', '6'],
  ];
  for (const argv of phrases) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', argv.join(' | '));
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.rows, null, argv.join(' | '));
    assert.equal(job.settings.trace, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' | '));
    assert.equal(job.selection.total, 1000, argv.join(' | '));
    const named = argv.some((token) => String(token).includes('hanzi-1000-v6.json'));
    assert.equal(job.inputDefaulted, !named, argv.join(' | '));
    assert.equal(job.selection.selected, argv.includes('24') ? 24 : 6, argv.join(' | '));
  }

  const grid = buildPrintJob(
    parseCliArgs(['3', '字/页', '每行', '5', '总行', '3', '描红', '1', 'please'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(grid.ok, true, grid.errors.join('; '));
  assert.equal(grid.inputDefaulted, true);
  assert.equal(grid.input, EXAMPLE_ABS);
  assert.equal(grid.settings.layout, 3);
  assert.equal(grid.settings.cols, 5);
  assert.equal(grid.settings.rows, 3);
  assert.equal(grid.settings.trace, 1);
  assert.equal(grid.settings.mono, false);
  assert.equal(grid.selection.selected, 1000);

  const button = buildPrintJob(
    parseCliArgs(['3', '字/页', 'please', 'print'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(button.ok, true, button.errors.join('; '));
  assert.equal(button.inputDefaulted, true);
  assert.equal(button.input, EXAMPLE_ABS);
  assert.equal(button.settings.cols, null);
  assert.equal(button.settings.effective.cols, SPECS[3].cols);

  const mono = buildPrintJob(
    parseCliArgs(['黑白省墨', 'layout', '3', 'limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(mono.ok, true, mono.errors.join('; '));
  assert.equal(mono.inputDefaulted, true);
  assert.equal(mono.input, EXAMPLE_ABS);
  assert.equal(mono.settings.mono, true);
  assert.equal(mono.settings.cols, null);
  assert.equal(mono.selection.selected, 1);
  assert.equal(mono.output, limitedOut);

  const footer = parseCliArgs(['页脚标题', 'layout', '2'], { cwd: outside });
  assert.equal(footer.mode, 'run');
  assert.equal(footer.request.showFooterTitle, true);
  assert.equal(footer.request.input, undefined);
  const noMono = parseCliArgs(['no-mono', 'layout', '3'], { cwd: outside });
  assert.equal(noMono.request.mono, false);
  assert.equal(noMono.request.input, undefined);

  const jobFile = buildPrintJob(
    parseCliArgs(['print-job.example.json', 'limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(jobFile.ok, true, jobFile.errors.join('; '));
  assert.equal(jobFile.settings.layout, 3);
  assert.equal(jobFile.input, EXAMPLE_ABS);
  assert.equal(jobFile.settings.cols, null);
  assert.equal(jobFile.selection.selected, 1);
  assert.equal(jobFile.output, fullOut);

  const flagWins = buildPrintJob(
    parseCliArgs(['layout', '3', 'limit', '6', '--limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(flagWins.ok, true, flagWins.errors.join('; '));
  assert.equal(flagWins.selection.selected, 1);
  assert.equal(flagWins.inputDefaulted, true);

  const missing = buildPrintJob(
    parseCliArgs(['layout', '3', 'extra'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join('\n'), /extra/);
  assert.notEqual(missing.input, EXAMPLE_ABS);
  const punctuated = buildPrintJob(
    parseCliArgs(['layout', '3', 'extra,'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(punctuated.ok, false);
  assert.match(punctuated.errors.join('\n'), /extra,/);

  assert.equal(parseCliArgs(['layout', '3', 'or', 'layout', '2']).mode, 'error');
  assert.match(parseCliArgs(['layout', '3', 'or', 'layout', '2']).errors[0], /conflicting layout/);
  assert.match(parseCliArgs(['per', 'page']).errors[0], /per page/);
  assert.match(parseCliArgs(['3', 'extra']).errors[0], /unexpected argument/);
  assert.equal(resolveE2eEntry(['--e2e', 'layout', '3', 'limit', '6']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '--test-name-pattern', 'Basic']).action, 'test');

  writeFileSync(join(outside, 'hanzi-1000-v6.json'), JSON.stringify({
    meta: { title: 'local' },
    groups: [{ category: 't', characters: [{ char: '一', pinyin: 'yī', words: ['一个'] }] }],
  }));
  const local = buildPrintJob(
    parseCliArgs(['input', 'hanzi-1000-v6.json', 'layout', '3', 'limit', '1'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(local.ok, true, local.errors.join('; '));
  assert.equal(local.input, join(outside, 'hanzi-1000-v6.json'));
  assert.equal(local.selection.total, 1);
  assert.equal(local.settings.cols, null);

  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT, 'layout', '3', 'limit', '1', 'cols', '5', 'dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, 5);
  assert.equal(body.settings.rows, null);
  assert.equal(body.settings.effective.rows, SPECS[3].defRows);
  assert.equal(body.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, limitedOut);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    'layout', '3', 'limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.inputDefaulted, true);
  assert.equal(npmBody.input, EXAMPLE_ABS);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.selection.selected, 1);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
});

test('print CLI: workbench 序号 picker is --range, not a filename', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-range-'));
  const rangedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-12.pdf');
  const sliceOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r2-2.pdf');
  assert.match(formatHelp(), /序号 1-12/);
  assert.match(formatHelp(), /选取 1-24/);
  assert.match(describePrintConfig().example.note, /序号 1-12/);
  assert.match(describePrintConfig().options.find((opt) => opt.flag.startsWith('--range')).description, /选取/);
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /序号 1-12/);

  const phrases = [
    ['序号', '1-12', 'layout', '3'],
    ['序号', '1', '-', '12', 'layout', '3'],
    ['序号,', '1', '-', '12,', 'layout', '3'],
    ['选取', '1-12', '3', '字/页'],
    ['选取,', '1', '-', '12,', 'layout', '3'],
    ['序号：1-12', 'layout', '3'],
    ['序号:1-12', 'layout', '3'],
    ['序号1-12', 'layout', '3'],
    ['序号', '1到12', 'layout', '3'],
    ['序号', '1', '到', '12', 'layout', '3'],
    ['--range', '1', '-', '12', 'layout', '3'],
    ['layout', '3', '序号', '1-12', '选取'],
    ['run the end-to-end test to generate the PDF, layout 3, 选取 1 - 12'],
    ['3 字/页 序号 1 - 12'],
  ];
  for (const argv of phrases) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', argv.join(' | '));
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.inputDefaulted, true, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.rows, null, argv.join(' | '));
    assert.equal(job.settings.trace, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' | '));
    assert.deepEqual(job.range, { start: 1, end: 12 }, argv.join(' | '));
    assert.equal(job.selection.selected, 12, argv.join(' | '));
    assert.equal(job.selection.total, 1000, argv.join(' | '));
    assert.equal(job.output, rangedOut, argv.join(' | '));
  }

  const named = buildPrintJob(
    parseCliArgs(['hanzi-1000-v6.json', '序号', '5-8', 'layout', '3'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(named.ok, true, named.errors.join('; '));
  assert.equal(named.inputDefaulted, false);
  assert.equal(named.input, EXAMPLE_ABS);
  assert.equal(named.settings.cols, null);
  assert.deepEqual(named.range, { start: 5, end: 8 });
  assert.equal(named.selection.selected, 4);

  const grid = buildPrintJob(
    parseCliArgs(['3', '字/页', '每行', '5', '序号', '1', '-', '6'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(grid.ok, true, grid.errors.join('; '));
  assert.equal(grid.settings.layout, 3);
  assert.equal(grid.settings.cols, 5);
  assert.equal(grid.settings.rows, null);
  assert.equal(grid.settings.effective.rows, SPECS[3].defRows);
  assert.equal(grid.selection.selected, 6);

  const swapped = buildPrintJob(
    parseCliArgs(['序号', '12-1', 'layout', '2'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(swapped.ok, true, swapped.errors.join('; '));
  assert.equal(swapped.settings.layout, 2);
  assert.equal(swapped.settings.cols, null);
  assert.deepEqual(swapped.range, { start: 1, end: 12 });

  const noLayout = parseCliArgs(['序号', '1-4'], { cwd: outside });
  assert.equal(noLayout.mode, 'run');
  assert.equal(noLayout.request.layout, undefined);
  assert.equal(noLayout.request.range, '1-4');
  const noLayoutJob = buildPrintJob(noLayout.request, { cwd: outside });
  assert.equal(noLayoutJob.ok, false);
  assert.match(noLayoutJob.errors.join('\n'), /layout/);

  const bareButton = buildPrintJob(
    parseCliArgs(['layout', '3', '选取'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(bareButton.ok, true, bareButton.errors.join('; '));
  assert.equal(bareButton.inputDefaulted, true);
  assert.equal(bareButton.range, null);
  assert.equal(bareButton.selection.selected, 1000);
  assert.equal(bareButton.settings.cols, null);
  const bareLabel = buildPrintJob(
    parseCliArgs(['layout', '3', '序号'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(bareLabel.ok, true, bareLabel.errors.join('; '));
  assert.equal(bareLabel.selection.selected, 1000);
  assert.equal(bareLabel.settings.cols, null);

  const bareNumbers = buildPrintJob(
    parseCliArgs(['1-12', 'layout', '3'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(bareNumbers.ok, false);
  assert.match(bareNumbers.errors.join('\n'), /1-12/);
  assert.notEqual(bareNumbers.input, EXAMPLE_ABS);

  const incomplete = parseCliArgs(['layout', '3', '序号', '1'], { cwd: outside });
  assert.equal(incomplete.mode, 'error');
  assert.match(incomplete.errors[0], /1-12/);
  assert.match(incomplete.errors[0], /序号/);
  const conflict = parseCliArgs(['layout', '3', '序号', '1-6', '选取', '10-12'], { cwd: outside });
  assert.equal(conflict.mode, 'error');
  assert.match(conflict.errors[0], /conflicting range/);
  const both = buildPrintJob(
    parseCliArgs(['layout', '3', 'limit', '6', '序号', '10-12'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(both.ok, false);
  assert.match(both.errors.join('\n'), /only one of --range and --limit/);

  const flagWins = buildPrintJob(
    parseCliArgs(['序号', '1-12', '--range', '2-3', 'layout', '3'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(flagWins.ok, true, flagWins.errors.join('; '));
  assert.deepEqual(flagWins.range, { start: 2, end: 3 });
  assert.equal(flagWins.selection.selected, 2);
  assert.equal(flagWins.settings.cols, null);

  const missing = buildPrintJob(
    parseCliArgs(['layout', '3', 'extra'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join('\n'), /extra/);
  assert.equal(resolveE2eEntry(['--e2e', '序号', '1']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '选取', '1', '-', '6', 'layout', '3']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '--test-name-pattern', 'Basic']).action, 'test');

  const beforeRanged = existsSync(rangedOut) ? statSync(rangedOut).mtimeMs : 0;
  const beforeSlice = existsSync(sliceOut) ? statSync(sliceOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT, 'layout', '3', '序号', '2', '-', '2', 'dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.settings.effective.trace, SPECS[3].defTrace);
  assert.deepEqual(body.range, { start: 2, end: 2 });
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, sliceOut);
  assert.equal(existsSync(rangedOut) ? statSync(rangedOut).mtimeMs : 0, beforeRanged);
  assert.equal(existsSync(sliceOut) ? statSync(sliceOut).mtimeMs : 0, beforeSlice);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    '序号', '2', '-', '2', 'layout', '3', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.inputDefaulted, true);
  assert.equal(npmBody.input, EXAMPLE_ABS);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.selection.selected, 1);
  assert.equal(npmBody.output, sliceOut);
  assert.equal(existsSync(rangedOut) ? statSync(rangedOut).mtimeMs : 0, beforeRanged);
  assert.equal(existsSync(sliceOut) ? statSync(sliceOut).mtimeMs : 0, beforeSlice);
});

test('print CLI: --no-mono and --no-footer-title are the workbench checkboxes, not unknown options', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-checks-'));
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  assert.match(formatHelp(), /--no-footer-title unchecks/);
  assert.match(describePrintConfig().example.note, /--no-footer-title/);
  assert.match(describePrintConfig().options.find((opt) => opt.flag.startsWith('--footer-title')).description, /not an unknown option/);
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /--no-footer-title/);

  const off = buildPrintJob(
    parseCliArgs(['layout', '3', '--no-footer-title', '--no-mono'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(off.ok, true, off.errors.join('; '));
  assert.equal(off.inputDefaulted, true);
  assert.equal(off.input, EXAMPLE_ABS);
  assert.equal(off.settings.layout, 3);
  assert.equal(off.settings.cols, null);
  assert.equal(off.settings.rows, null);
  assert.equal(off.settings.trace, null);
  assert.equal(off.settings.effective.cols, SPECS[3].cols);
  assert.equal(off.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(off.settings.mono, false);
  assert.equal(off.settings.showFooterTitle, false);
  assert.equal(off.settings.defaults.showFooterTitle, true);
  assert.equal(off.settings.effective.showFooterTitle, false);
  assert.equal(off.selection.selected, 1000);
  assert.equal(off.output, fullOut);

  const quoted = buildPrintJob(
    parseCliArgs(['layout 3 --no-footer-title'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(quoted.ok, true, quoted.errors.join('; '));
  assert.equal(quoted.inputDefaulted, true);
  assert.equal(quoted.settings.showFooterTitle, false);
  assert.equal(quoted.settings.mono, false);
  assert.equal(quoted.settings.cols, null);

  const button = buildPrintJob(
    parseCliArgs(['--no-footer-title', '3', '字/页', '--mono'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(button.ok, true, button.errors.join('; '));
  assert.equal(button.settings.layout, 3);
  assert.equal(button.settings.showFooterTitle, false);
  assert.equal(button.settings.mono, true);
  assert.equal(button.settings.cols, null);
  assert.equal(button.settings.effective.cols, SPECS[3].cols);
  assert.equal(button.inputDefaulted, true);

  writeFileSync(join(outside, 'job.json'), JSON.stringify({
    input: 'hanzi-1000-v6.json',
    layout: 3,
    showFooterTitle: true,
    mono: true,
    cols: 6,
  }));
  const overridden = buildPrintJob(
    parseCliArgs(['--config', join(outside, 'job.json'), '--no-footer-title', '--no-mono'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(overridden.ok, true, overridden.errors.join('; '));
  assert.equal(overridden.settings.layout, 3);
  assert.equal(overridden.settings.cols, 6);
  assert.equal(overridden.settings.mono, false);
  assert.equal(overridden.settings.showFooterTitle, false);
  assert.equal(overridden.input, EXAMPLE_ABS);

  const monoClash = parseCliArgs(['黑白省墨', 'layout', '3', '--no-mono'], { cwd: outside });
  assert.equal(monoClash.mode, 'error');
  assert.match(monoClash.errors[0], /conflicting mono/);
  const footerClash = parseCliArgs(['页脚标题', '--no-footer-title', 'layout', '3'], { cwd: outside });
  assert.equal(footerClash.mode, 'error');
  assert.match(footerClash.errors[0], /conflicting footer-title/);
  const bothFlags = parseCliArgs(['layout', '3', '--footer-title', '--no-footer-title'], { cwd: outside });
  assert.equal(bothFlags.mode, 'error');
  assert.match(bothFlags.errors[0], /conflicting footer-title/);

  assert.equal(resolveE2eEntry(['--e2e', '--no-footer-title']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '--mono']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '--footer-title', '--no-footer-title']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');
  assert.equal(resolveE2eEntry(['--e2e', '--test-name-pattern', 'Basic']).action, 'test');

  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT, 'layout', '3', '--no-footer-title', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(body.settings.showFooterTitle, false);
  assert.equal(body.settings.defaults.showFooterTitle, true);
  assert.equal(body.settings.mono, false);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    'layout', '3', '--no-footer-title', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.inputDefaulted, true);
  assert.equal(npmBody.input, EXAMPLE_ABS);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.settings.showFooterTitle, false);
  assert.equal(npmBody.selection.selected, 1);
  assert.equal(npmBody.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const suite = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--', '--no-footer-title',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(suite.status, 2, suite.stderr || suite.stdout);
  const suiteBody = JSON.parse(suite.stdout);
  assert.equal(suiteBody.ok, false);
  assert.match(suiteBody.errors.join('\n'), /layout/);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
});

test('print CLI: a checkbox value unchecks the workbench box instead of becoming a filename', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-check-value-'));
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  assert.match(formatHelp(), /--footer-title false/);
  assert.match(formatHelp(), /bare false is still a filename/);
  assert.match(describePrintConfig().example.note, /--footer-title false/);
  assert.match(describePrintConfig().options.find((opt) => opt.flag.startsWith('--footer-title')).description, /do not leave the box checked/);
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /setting-footer-title false/);
  JSON.parse(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'));

  function jobFor(argv) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', `${argv.join(' ')}: ${(parsed.errors || []).join('; ')}`);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' ')}: ${job.errors.join('; ')}`);
    return { parsed, job };
  }

  const unchecked = [
    ['layout', '3', '--footer-title', 'false'],
    ['layout', '3', '--footer-title=off'],
    ['--footer-title=false', 'layout', '3'],
    ['layout', '3', '--setting-footer-title', 'false'],
    ['layout', '3', '页脚标题', 'off'],
    ['页脚标题，', 'off', 'layout', '3'],
    ['showFooterTitle', 'false', 'layout', '3'],
    ['showFooterTitle=false', 'layout', '3'],
    ['setting-footer-title', 'false', 'layout', '3'],
    ['footer-title', 'unchecked', 'layout', '3'],
    ['layout 3 --footer-title false'],
    ['layout 3 --footer-title=false'],
    ['run the end-to-end test to generate the PDF, layout 3 --footer-title false'],
    ['跑端到端测试生成 PDF，layout 3，页脚标题 关'],
  ];
  for (const argv of unchecked) {
    const { parsed, job } = jobFor(argv);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.inputDefaulted, true, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.rows, null, argv.join(' | '));
    assert.equal(job.settings.trace, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' | '));
    assert.equal(job.settings.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.defaults.showFooterTitle, true, argv.join(' | '));
    assert.equal(job.settings.effective.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.mono, false, argv.join(' | '));
    assert.equal(parsed.request.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.selection.selected, 1000, argv.join(' | '));
    assert.equal(job.output, fullOut, argv.join(' | '));
  }

  const monoOff = [
    ['layout', '3', '--mono', 'false'],
    ['layout', '3', '--mono=off'],
    ['layout', '3', '--mono', '0'],
    ['黑白省墨', 'off', 'layout', '3'],
    ['mono', 'off', 'layout', '3'],
    ['mono=off', 'layout', '3'],
    ['setting-mono', 'false', 'layout', '3'],
    ['--setting-mono=off', 'layout', '3'],
    ['layout 3 --mono false'],
    ['layout 3 --mono=off'],
  ];
  for (const argv of monoOff) {
    const { parsed, job } = jobFor(argv);
    assert.equal(job.inputDefaulted, true, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.mono, false, argv.join(' | '));
    assert.equal(job.settings.defaults.mono, false, argv.join(' | '));
    assert.equal(parsed.request.mono, false, argv.join(' | '));
    assert.equal(job.settings.showFooterTitle, true, argv.join(' | '));
    assert.equal(job.selection.selected, 1000, argv.join(' | '));
  }

  const stillOn = jobFor(['页脚标题', 'layout', '3']);
  assert.equal(stillOn.job.settings.showFooterTitle, true);
  assert.equal(stillOn.job.settings.mono, false);
  assert.equal(stillOn.job.settings.cols, null);
  const ink = jobFor(['黑白省墨', 'layout', '3']);
  assert.equal(ink.job.settings.mono, true);
  assert.equal(ink.job.settings.showFooterTitle, true);
  assert.equal(ink.job.settings.cols, null);
  const oneMeansOn = jobFor(['--footer-title', '1', 'layout', '3']);
  assert.equal(oneMeansOn.job.settings.layout, 3);
  assert.equal(oneMeansOn.job.settings.showFooterTitle, true);
  assert.equal(oneMeansOn.job.inputDefaulted, true);
  assert.equal(oneMeansOn.job.settings.cols, null);

  const agree = jobFor(['layout', '3', '--footer-title', 'false', '--no-footer-title']);
  assert.equal(agree.job.settings.showFooterTitle, false);
  assert.equal(agree.job.inputDefaulted, true);
  assert.equal(agree.job.settings.cols, null);
  const agreeMono = jobFor(['layout', '3', '--mono', 'false', '--no-mono']);
  assert.equal(agreeMono.job.settings.mono, false);
  assert.equal(agreeMono.job.inputDefaulted, true);
  const agreeNegation = jobFor(['layout', '3', '--no-footer-title', 'false']);
  assert.equal(agreeNegation.job.settings.showFooterTitle, false);
  assert.equal(agreeNegation.job.inputDefaulted, true);
  assert.equal(agreeNegation.job.input, EXAMPLE_ABS);
  const agreeEq = jobFor(['layout', '3', '--no-footer-title=false']);
  assert.equal(agreeEq.job.settings.showFooterTitle, false);
  assert.equal(agreeEq.job.inputDefaulted, true);

  const flagWins = jobFor(['页脚标题', 'false', '--footer-title', 'layout', '3']);
  assert.equal(flagWins.job.settings.showFooterTitle, true);
  assert.equal(flagWins.job.inputDefaulted, true);
  assert.equal(flagWins.job.settings.cols, null);

  const bothFlags = parseCliArgs(['layout', '3', '--footer-title', '--no-footer-title'], { cwd: outside });
  assert.equal(bothFlags.mode, 'error');
  assert.match(bothFlags.errors[0], /conflicting footer-title/);
  const opposite = parseCliArgs(['layout', '3', '--footer-title', 'true', '--no-footer-title'], { cwd: outside });
  assert.equal(opposite.mode, 'error');
  assert.match(opposite.errors[0], /conflicting footer-title/);
  const noTurnsOn = parseCliArgs(['layout', '3', '--no-footer-title', 'true'], { cwd: outside });
  assert.equal(noTurnsOn.mode, 'error');
  assert.match(noTurnsOn.errors[0], /does not turn the box on/);
  assert.doesNotMatch(noTurnsOn.errors[0], /input not found/);
  const noValue = parseCliArgs(['layout', '3', '--no-footer-title=maybe'], { cwd: outside });
  assert.equal(noValue.mode, 'error');
  assert.match(noValue.errors[0], /does not take a value/);
  const maybe = parseCliArgs(['layout', '3', '--footer-title=maybe'], { cwd: outside });
  assert.equal(maybe.mode, 'error');
  assert.match(maybe.errors[0], /true or false/);
  assert.doesNotMatch(maybe.errors[0], /does not take an argument/);
  const bareNo = parseCliArgs(['layout', '3', 'no-mono=true'], { cwd: outside });
  assert.equal(bareNo.mode, 'error');
  assert.match(bareNo.errors[0], /does not turn the box on/);

  const bareFalse = buildPrintJob(
    parseCliArgs(['layout', '3', 'false'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(bareFalse.ok, false);
  assert.match(bareFalse.errors.join('\n'), /false/);
  assert.notEqual(bareFalse.input, EXAMPLE_ABS);
  assert.equal(bareFalse.settings.showFooterTitle, true);
  assert.equal(bareFalse.settings.mono, false);
  assert.equal(bareFalse.settings.cols, null);

  const notACheckbox = parseCliArgs(['layout', '3', 'setting-cols', '5'], { cwd: outside });
  assert.equal(notACheckbox.mode, 'error');
  assert.match(notACheckbox.errors[0], /5/);

  assert.equal(resolveE2eEntry(['--e2e', '--footer-title', 'false']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '--footer-title=maybe']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '--setting-footer-title', 'false']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '页脚标题', 'off']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');
  assert.equal(resolveE2eEntry(['--e2e', '--test-name-pattern', 'Basic']).action, 'test');

  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT, 'layout', '3', '--footer-title', 'false', '--mono', 'off', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(body.settings.showFooterTitle, false);
  assert.equal(body.settings.defaults.showFooterTitle, true);
  assert.equal(body.settings.mono, false);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    'layout', '3', '--footer-title', 'false', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.inputDefaulted, true);
  assert.equal(npmBody.input, EXAMPLE_ABS);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.settings.showFooterTitle, false);
  assert.equal(npmBody.settings.mono, false);
  assert.equal(npmBody.selection.selected, 1);
  assert.equal(npmBody.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const noLayout = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--', '--footer-title', 'false',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(noLayout.status, 2, noLayout.stderr || noLayout.stdout);
  const noLayoutBody = JSON.parse(noLayout.stdout);
  assert.equal(noLayoutBody.ok, false);
  assert.match(noLayoutBody.errors.join('\n'), /layout/);
  assert.doesNotMatch(noLayoutBody.errors.join('\n'), /false/);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
});

test('print CLI: chars per page is the layout phrase, not a --chars filter', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-chars-page-'));
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  const layout2Out = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-2.pdf');
  const charsOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-chars2.pdf');
  assert.match(formatHelp(), /chars per page 3/);
  assert.match(formatHelp(), /not a --chars filter/);
  assert.match(describePrintConfig().example.note, /chars per page 3/);
  assert.match(describePrintConfig().options.find((opt) => opt.flag.startsWith('--chars')).description, /not this filter/);
  assert.ok(describePrintConfig().jobs.find((job) => job.layout === 3).phrases.includes('chars per page 3'));
  assert.ok(describePrintConfig().jobs.find((job) => job.layout === 2).phrases.includes('2 chars per page'));
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /chars per page 3/);
  JSON.parse(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'));

  function jobFor(argv) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', `${argv.join(' | ')}: ${(parsed.errors || []).join('; ')}`);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    return { parsed, job };
  }

  const phrases = [
    ['chars', 'per', 'page', '3'],
    ['chars,', 'per', 'page', '3'],
    ['chars', 'per', 'page,', '3'],
    ['chars', 'per', 'page', 'three'],
    ['3', 'chars', 'per', 'page'],
    ['3', 'chars,', 'per', 'page'],
    ['three', 'chars', 'per', 'page'],
    ['3', 'chinese', 'chars', 'per', 'page'],
    ['chinese', 'chars', 'per', 'page', '3'],
    ['chars per page 3'],
    ['--chars per page 3'],
    ['--chars', 'per', 'page', '3'],
    ['--CHARS', 'per', 'page', '3'],
    ['run the end-to-end test to generate the PDF, chars per page 3'],
    ['run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF,', 'chars', 'per', 'page', '3'],
  ];
  for (const argv of phrases) {
    const { parsed, job } = jobFor([...argv, '--limit', '1']);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.inputDefaulted, true, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(parsed.request.input, undefined, argv.join(' | '));
    assert.equal(parsed.request.chars, undefined, argv.join(' | '));
    assert.equal(job.chars, null, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.rows, null, argv.join(' | '));
    assert.equal(job.settings.trace, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.settings.effective.rows, SPECS[3].defRows, argv.join(' | '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' | '));
    assert.equal(job.selection.selected, 1, argv.join(' | '));
    assert.equal(job.output, limitedOut, argv.join(' | '));
  }

  const withLimit = jobFor(['chars', 'per', 'page', '3', 'limit', '6']);
  assert.equal(withLimit.job.settings.layout, 3);
  assert.equal(withLimit.job.chars, null);
  assert.equal(withLimit.job.inputDefaulted, true);
  assert.equal(withLimit.job.settings.cols, null);
  assert.equal(withLimit.job.selection.selected, 6);
  assert.equal(withLimit.parsed.request.chars, undefined);

  const quotedLimit = jobFor(['chars per page 3 --limit 1']);
  assert.equal(quotedLimit.job.settings.layout, 3);
  assert.equal(quotedLimit.job.chars, null);
  assert.equal(quotedLimit.job.inputDefaulted, true);
  assert.equal(quotedLimit.job.selection.selected, 1);
  assert.equal(quotedLimit.job.settings.cols, null);

  const two = jobFor(['chars', 'per', 'page', '2']);
  assert.equal(two.job.settings.layout, 2);
  assert.equal(two.job.inputDefaulted, true);
  assert.equal(two.job.input, EXAMPLE_ABS);
  assert.equal(two.job.chars, null);
  assert.equal(two.job.settings.cols, null);
  assert.equal(two.job.settings.effective.cols, SPECS[2].cols);
  assert.equal(two.job.output, layout2Out);
  assert.equal(two.job.selection.selected, 1000);

  const withCols = jobFor(['3', 'chars', 'per', 'page', '每行', '5']);
  assert.equal(withCols.job.settings.layout, 3);
  assert.equal(withCols.job.chars, null);
  assert.equal(withCols.job.settings.cols, 5);
  assert.equal(withCols.job.settings.rows, null);
  assert.equal(withCols.job.settings.trace, null);
  assert.equal(withCols.job.inputDefaulted, true);

  const filtered = [
    ['layout', '3', '--chars', '一,二'],
    ['layout', '3', '--chars=一,二'],
    ['chars', '一,二', 'layout', '3'],
  ];
  for (const argv of filtered) {
    const { parsed, job } = jobFor(argv);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.inputDefaulted, true, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.chars.length, 2, argv.join(' | '));
    assert.deepEqual(job.selection.chars, ['一', '二'], argv.join(' | '));
    assert.equal(job.selection.selected, 2, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(parsed.request.chars, '一,二', argv.join(' | '));
    assert.equal(job.output, charsOut, argv.join(' | '));
  }

  const perAlone = parseCliArgs(['layout', '3', '--chars', 'per'], { cwd: outside });
  assert.equal(perAlone.mode, 'run');
  assert.equal(perAlone.request.layout, '3');
  assert.equal(perAlone.request.chars, 'per');
  assert.equal(perAlone.request.input, undefined);
  const charsPer = parseCliArgs(['chars', 'per', 'layout', '3'], { cwd: outside });
  assert.equal(charsPer.mode, 'run');
  assert.equal(charsPer.request.chars, 'per');
  assert.equal(charsPer.request.layout, '3');

  const conflict = parseCliArgs(['layout', '2', 'chars', 'per', 'page', '3'], { cwd: outside });
  assert.equal(conflict.mode, 'error');
  assert.match(conflict.errors[0], /conflicting layout/);
  const conflictQuoted = parseCliArgs(['chars per page 2 or layout 3'], { cwd: outside });
  assert.equal(conflictQuoted.mode, 'error');
  assert.match(conflictQuoted.errors[0], /conflicting layout/);

  const incomplete = parseCliArgs(['chars', 'per', 'page'], { cwd: outside });
  assert.equal(incomplete.mode, 'error');
  assert.match(incomplete.errors[0], /layout must be 1, 2, 3, or 4/);
  assert.match(incomplete.errors[0], /per page/);
  assert.doesNotMatch(incomplete.errors[0], /input not found/);

  assert.equal(resolveE2eEntry(['--e2e', 'chars', 'per', 'page', '3']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '--chars', 'per', 'page', '3']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'chars per page 3']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'chars', 'per', 'page']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');
  assert.equal(resolveE2eEntry(['--e2e', '--test-name-pattern', 'Basic']).action, 'test');

  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const beforeChars = existsSync(charsOut) ? statSync(charsOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT, '--e2e', 'chars', 'per', 'page', '3', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.chars, null);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);
  assert.equal(existsSync(charsOut) ? statSync(charsOut).mtimeMs : 0, beforeChars);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    'chars', 'per', 'page', '3', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.inputDefaulted, true);
  assert.equal(npmBody.input, EXAMPLE_ABS);
  assert.equal(npmBody.chars, null);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.selection.selected, 1);
  assert.equal(npmBody.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);
});

test('print CLI: workbench aria-label 每页字数 and 3个字/页 are the published job', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-aria-'));
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  const layout2Out = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-2.pdf');
  const html = readFileSync(join(REPO_ROOT, 'printer/index.html'), 'utf8');
  assert.equal(WORKBENCH_PER_PAGE_GROUP, '每页字数');
  assert.match(html, new RegExp(`aria-label="${WORKBENCH_PER_PAGE_GROUP}"`));
  assert.match(html, />3 字\/页</);
  assert.equal(measureWordLayoutLabel(3), '3个字/页');
  assert.match(formatHelp(), /3个字\/页/);
  assert.match(formatHelp(), /每页字数 3/);
  assert.match(describePrintConfig().example.note, /每页字数 3/);
  assert.match(describePrintConfig().example.note, /3个字\/页/);
  assert.ok(describePrintConfig().jobs.find((job) => job.layout === 3).phrases.includes('每页字数 3'));
  assert.ok(describePrintConfig().jobs.find((job) => job.layout === 2).phrases.includes('2个字/页'));
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /每页字数 3/);
  JSON.parse(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'));

  function jobFor(argv) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.ok(parsed.mode === 'run' || parsed.mode === 'dry-run', `${argv.join(' | ')}: ${parsed.mode} ${(parsed.errors || []).join('; ')}`);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    return { parsed, job };
  }

  const phrases = [
    ['3个字/页'],
    ['3个字/页,'],
    ['3个字／页'],
    ['三个字/页'],
    ['3个字每页'],
    ['3', '个', '字/页'],
    ['3', '个字/页'],
    ['每页字数', '3'],
    ['每页字数,', '3'],
    ['每页字数', '三'],
    ['每页字数', 'three'],
    ['每页字数3'],
    ['每页字数=3'],
    ['每页字数：3'],
    ['每页', '字数', '3'],
    ['3', '每页字数'],
    ['3', '每页', '字数'],
    ['aria-label', '每页字数', '3'],
    ['aria-label="每页字数"', '3'],
    ['run the end-to-end test to generate the PDF, 每页字数 3'],
    ['run the end-to-end test to generate the PDF, 3个字/页'],
    ['run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF,', '每页字数', '3'],
    ['--dry-run 每页字数 3 --limit 1'],
  ];
  for (const argv of phrases) {
    const limited = argv.some((token) => String(token).includes('--limit'));
    const { parsed, job } = jobFor(limited ? argv : [...argv, '--limit', '1']);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.inputDefaulted, true, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(parsed.request.input, undefined, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.rows, null, argv.join(' | '));
    assert.equal(job.settings.trace, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.settings.effective.rows, SPECS[3].defRows, argv.join(' | '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' | '));
    assert.equal(job.selection.selected, 1, argv.join(' | '));
    assert.equal(job.output, limitedOut, argv.join(' | '));
  }

  const withCols = jobFor(['每页字数', '3', '每行', '5']);
  assert.equal(withCols.job.settings.layout, 3);
  assert.equal(withCols.job.settings.cols, 5);
  assert.equal(withCols.job.settings.rows, null);
  assert.equal(withCols.job.settings.trace, null);
  assert.equal(withCols.job.inputDefaulted, true);
  assert.equal(withCols.job.settings.effective.trace, SPECS[3].defTrace);

  const two = jobFor(['2个字/页']);
  assert.equal(two.job.settings.layout, 2);
  assert.equal(two.job.inputDefaulted, true);
  assert.equal(two.job.input, EXAMPLE_ABS);
  assert.equal(two.job.settings.cols, null);
  assert.equal(two.job.settings.effective.cols, SPECS[2].cols);
  assert.equal(two.job.output, layout2Out);
  assert.equal(two.job.selection.selected, 1000);

  const redundant = jobFor(['layout', '3', '每页字数', '--limit', '1']);
  assert.equal(redundant.job.settings.layout, 3);
  assert.equal(redundant.job.inputDefaulted, true);
  assert.equal(redundant.parsed.request.input, undefined);
  assert.equal(redundant.job.settings.cols, null);
  assert.equal(redundant.job.selection.selected, 1);

  const afterWords = jobFor(['每页字数', '3', 'please', '--limit', '1']);
  assert.equal(afterWords.job.settings.layout, 3);
  assert.equal(afterWords.job.inputDefaulted, true);
  assert.equal(afterWords.parsed.request.input, undefined);

  const filtered = jobFor(['每页字数', '3', '--chars', '一,二']);
  assert.equal(filtered.job.settings.layout, 3);
  assert.equal(filtered.job.inputDefaulted, true);
  assert.deepEqual(filtered.job.selection.chars, ['一', '二']);
  assert.equal(filtered.job.settings.cols, null);

  const same = jobFor(['每页字数', '3', '3个字/页', '--limit', '1']);
  assert.equal(same.job.settings.layout, 3);
  assert.equal(same.job.inputDefaulted, true);
  assert.equal(same.job.settings.cols, null);

  const conflict = parseCliArgs(['layout', '2', '每页字数', '3'], { cwd: outside });
  assert.equal(conflict.mode, 'error');
  assert.match(conflict.errors[0], /conflicting layout/);
  const conflictQuoted = parseCliArgs(['3个字/页 or layout 2'], { cwd: outside });
  assert.equal(conflictQuoted.mode, 'error');
  assert.match(conflictQuoted.errors[0], /conflicting layout/);

  const incomplete = parseCliArgs(['每页字数'], { cwd: outside });
  assert.equal(incomplete.mode, 'error');
  assert.match(incomplete.errors[0], /layout must be 1, 2, 3, or 4/);
  assert.match(incomplete.errors[0], /每页字数/);
  assert.doesNotMatch(incomplete.errors[0], /input not found/);
  const incompleteCount = parseCliArgs(['每页字数', '9'], { cwd: outside });
  assert.equal(incompleteCount.mode, 'error');
  assert.match(incompleteCount.errors[0], /layout must be 1, 2, 3, or 4/);
  assert.doesNotMatch(incompleteCount.errors[0], /input not found/);

  const unknown = buildPrintJob(parseCliArgs(['每页字数', '3', 'extra'], { cwd: outside }).request, { cwd: outside });
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors.join('\n'), /extra/);
  assert.match(unknown.errors.join('\n'), /input not found/);

  assert.equal(resolveE2eEntry(['--e2e', '每页字数', '3']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '3个字/页']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '每页字数']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');
  assert.equal(resolveE2eEntry(['--e2e', '--test-name-pattern', 'Basic']).action, 'test');

  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT, '--e2e', '每页字数', '3', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    '3个字/页', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.inputDefaulted, true);
  assert.equal(npmBody.input, EXAMPLE_ABS);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.selection.selected, 1);
  assert.equal(npmBody.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);
});

test('print CLI: a verb before a workbench checkbox sets the box instead of a filename', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-verb-box-'));
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  const layout1Out = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-1.pdf');
  const html = readFileSync(join(REPO_ROOT, 'printer/index.html'), 'utf8');
  assert.match(html, /<span>页脚标题<\/span>/);
  assert.match(html, /title="在页脚显示字库标题"/);
  assert.match(html, /<span>黑白省墨<\/span>/);
  assert.match(html, /title="切换黑白省墨打印模式"/);
  assert.match(formatHelp(), /关闭 页脚标题/);
  assert.match(formatHelp(), /bare `关闭` is still a filename/);
  assert.match(describePrintConfig().example.note, /关闭 页脚标题/);
  assert.match(describePrintConfig().example.note, /开启 黑白省墨/);
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--footer-title')).description,
    /关闭 页脚标题/,
  );
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--mono')).description,
    /开启 黑白省墨/,
  );
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /关闭 页脚标题/);
  JSON.parse(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'));

  function jobFor(argv) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', `${argv.join(' | ')}: ${(parsed.errors || []).join('; ')}`);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    return { parsed, job };
  }

  const unchecked = [
    ['layout', '3', '关闭', '页脚标题'],
    ['关闭', '页脚标题', 'layout', '3'],
    ['关闭，', '页脚标题', 'layout', '3'],
    ['关闭', '页脚标题，', 'layout', '3'],
    ['关闭页脚标题', 'layout', '3'],
    ['关闭页脚标题，', 'layout', '3'],
    ['关闭，页脚标题', 'layout', '3'],
    ['请关闭页脚标题', 'layout', '3'],
    ['请', '关闭', '页脚标题', 'layout', '3'],
    ['不显示', '页脚标题', 'layout', '3'],
    ['不显示页脚标题', 'layout', '3'],
    ['关掉', '页脚标题', 'layout', '3'],
    ['关', '页脚标题', 'layout', '3'],
    ['uncheck', '页脚标题', 'layout', '3'],
    ['uncheck页脚标题', 'layout', '3'],
    ['off', '页脚标题', 'layout', '3'],
    ['false', '页脚标题', 'layout', '3'],
    ['turn', 'off', '页脚标题', 'layout', '3'],
    ['switch', 'off', 'setting-footer-title', 'layout', '3'],
    ['关闭', 'setting-footer-title', 'layout', '3'],
    ['关闭', 'showFooterTitle', 'layout', '3'],
    ['关闭', '在页脚显示字库标题', 'layout', '3'],
    ['关闭在页脚显示字库标题', 'layout', '3'],
    ['layout 3 关闭 页脚标题'],
    ['跑端到端测试生成 PDF，layout 3，关闭页脚标题'],
    ['run the end-to-end test to generate the PDF, layout 3, 关闭 页脚标题'],
    ['run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF,', 'layout', '3', '关闭', '页脚标题'],
  ];
  for (const argv of unchecked) {
    const { parsed, job } = jobFor(argv);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.inputDefaulted, true, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(parsed.request.input, undefined, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.rows, null, argv.join(' | '));
    assert.equal(job.settings.trace, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' | '));
    assert.equal(job.settings.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.defaults.showFooterTitle, true, argv.join(' | '));
    assert.equal(job.settings.effective.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.mono, false, argv.join(' | '));
    assert.equal(parsed.request.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.selection.selected, 1000, argv.join(' | '));
    assert.equal(job.output, fullOut, argv.join(' | '));
  }

  const agree = jobFor(['layout', '3', '关闭', '页脚标题', 'off']);
  assert.equal(agree.job.settings.showFooterTitle, false);
  assert.equal(agree.job.inputDefaulted, true);
  assert.equal(agree.job.settings.cols, null);
  const agreeFalse = jobFor(['关闭页脚标题', 'false', 'layout', '3']);
  assert.equal(agreeFalse.job.settings.showFooterTitle, false);
  assert.equal(agreeFalse.job.inputDefaulted, true);
  assert.equal(agreeFalse.parsed.request.input, undefined);

  const inkOn = [
    ['开启', '黑白省墨', 'layout', '3'],
    ['打开', '黑白省墨', 'layout', '3'],
    ['开启黑白省墨', 'layout', '3'],
    ['打开', '切换黑白省墨打印模式', 'layout', '3'],
    ['enable', 'setting-mono', 'layout', '3'],
  ];
  for (const argv of inkOn) {
    const { parsed, job } = jobFor(argv);
    assert.equal(job.inputDefaulted, true, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.mono, true, argv.join(' | '));
    assert.equal(parsed.request.mono, true, argv.join(' | '));
    assert.equal(job.settings.showFooterTitle, true, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.selection.selected, 1000, argv.join(' | '));
  }

  const inkOff = jobFor(['关闭', '黑白省墨', 'layout', '3']);
  assert.equal(inkOff.job.settings.mono, false);
  assert.equal(inkOff.parsed.request.mono, false);
  assert.equal(inkOff.job.settings.showFooterTitle, true);
  assert.equal(inkOff.job.inputDefaulted, true);
  assert.equal(inkOff.job.settings.cols, null);

  const footerOn = jobFor(['开启', '页脚标题', 'layout', '3']);
  assert.equal(footerOn.job.settings.showFooterTitle, true);
  assert.equal(footerOn.parsed.request.showFooterTitle, true);
  assert.equal(footerOn.job.settings.mono, false);
  assert.equal(footerOn.job.inputDefaulted, true);
  assert.equal(footerOn.job.settings.cols, null);

  const withCols = jobFor(['关闭', '页脚标题', 'layout', '3', '每行', '5']);
  assert.equal(withCols.job.settings.showFooterTitle, false);
  assert.equal(withCols.job.settings.cols, 5);
  assert.equal(withCols.job.settings.rows, null);
  assert.equal(withCols.job.settings.trace, null);
  assert.equal(withCols.job.inputDefaulted, true);

  const digitStaysLayout = jobFor(['1', '页脚标题']);
  assert.equal(digitStaysLayout.job.settings.layout, 1);
  assert.equal(digitStaysLayout.job.inputDefaulted, true);
  assert.equal(digitStaysLayout.job.input, EXAMPLE_ABS);
  assert.equal(digitStaysLayout.job.settings.showFooterTitle, true);
  assert.equal(digitStaysLayout.job.settings.cols, null);
  assert.equal(digitStaysLayout.job.output, layout1Out);

  const flagWins = jobFor(['关闭', '页脚标题', '--footer-title', 'layout', '3']);
  assert.equal(flagWins.job.settings.showFooterTitle, true);
  assert.equal(flagWins.job.inputDefaulted, true);
  assert.equal(flagWins.job.settings.cols, null);
  const agreeFlag = jobFor(['关闭', '页脚标题', '--no-footer-title', 'layout', '3']);
  assert.equal(agreeFlag.job.settings.showFooterTitle, false);
  assert.equal(agreeFlag.job.inputDefaulted, true);

  const conflict = parseCliArgs(['layout', '3', '关闭', '页脚标题', 'true'], { cwd: outside });
  assert.equal(conflict.mode, 'error');
  assert.match(conflict.errors[0], /conflicting footer-title/);
  assert.doesNotMatch(conflict.errors[0], /input not found/);
  const conflictMono = parseCliArgs(['开启', '黑白省墨', 'off', 'layout', '3'], { cwd: outside });
  assert.equal(conflictMono.mode, 'error');
  assert.match(conflictMono.errors[0], /conflicting mono/);
  assert.doesNotMatch(conflictMono.errors[0], /input not found/);
  const bothWords = parseCliArgs(['关闭', '页脚标题', '页脚标题', 'layout', '3'], { cwd: outside });
  assert.equal(bothWords.mode, 'error');
  assert.match(bothWords.errors[0], /conflicting footer-title/);

  const bareVerb = buildPrintJob(parseCliArgs(['layout', '3', '关闭'], { cwd: outside }).request, { cwd: outside });
  assert.equal(bareVerb.ok, false);
  assert.match(bareVerb.errors.join('\n'), /关闭/);
  assert.match(bareVerb.errors.join('\n'), /input not found/);
  assert.notEqual(bareVerb.input, EXAMPLE_ABS);
  assert.equal(bareVerb.settings.showFooterTitle, true);
  assert.equal(bareVerb.settings.mono, false);
  assert.equal(bareVerb.settings.cols, null);

  const panel = buildPrintJob(parseCliArgs(['layout', '3', '关闭面板'], { cwd: outside }).request, { cwd: outside });
  assert.equal(panel.ok, false);
  assert.match(panel.errors.join('\n'), /关闭面板/);
  assert.match(panel.errors.join('\n'), /input not found/);
  assert.equal(panel.settings.showFooterTitle, true);

  const negated = buildPrintJob(
    parseCliArgs(['layout', '3', '不关闭', '页脚标题'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(negated.ok, false);
  assert.match(negated.errors.join('\n'), /不关闭/);
  assert.match(negated.errors.join('\n'), /input not found/);
  assert.equal(negated.settings.showFooterTitle, true);

  const bareTitle = buildPrintJob(
    parseCliArgs(['layout', '3', '在页脚显示字库标题'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(bareTitle.ok, false);
  assert.match(bareTitle.errors.join('\n'), /在页脚显示字库标题/);
  assert.match(bareTitle.errors.join('\n'), /input not found/);
  assert.equal(bareTitle.settings.showFooterTitle, true);

  const stillOn = jobFor(['页脚标题', 'layout', '3']);
  assert.equal(stillOn.job.settings.showFooterTitle, true);
  assert.equal(stillOn.job.inputDefaulted, true);
  assert.equal(stillOn.job.settings.cols, null);

  assert.equal(resolveE2eEntry(['--e2e', '关闭', '页脚标题']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '关闭', '页脚标题', 'true']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '开启', '黑白省墨']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');
  assert.equal(resolveE2eEntry(['--e2e', '--test-name-pattern', 'Basic']).action, 'test');

  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT, 'layout', '3', '关闭', '页脚标题', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(body.settings.showFooterTitle, false);
  assert.equal(body.settings.defaults.showFooterTitle, true);
  assert.equal(body.settings.mono, false);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    '关闭', '页脚标题', 'layout', '3', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.inputDefaulted, true);
  assert.equal(npmBody.input, EXAMPLE_ABS);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.settings.showFooterTitle, false);
  assert.equal(npmBody.settings.mono, false);
  assert.equal(npmBody.selection.selected, 1);
  assert.equal(npmBody.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const noLayout = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--', '关闭', '页脚标题',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(noLayout.status, 2, noLayout.stderr || noLayout.stdout);
  const noLayoutBody = JSON.parse(noLayout.stdout);
  assert.equal(noLayoutBody.ok, false);
  assert.match(noLayoutBody.errors.join('\n'), /layout/);
  assert.doesNotMatch(noLayoutBody.errors.join('\n'), /关闭/);
  assert.doesNotMatch(noLayoutBody.errors.join('\n'), /input not found/);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
});

test('print CLI: 把 页脚标题 关闭 sets the box instead of a file named 把', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-ba-box-'));
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  assert.match(formatHelp(), /把 页脚标题 关闭/);
  assert.match(formatHelp(), /把 页脚标题` without a verb/);
  assert.match(describePrintConfig().example.note, /把页脚标题关闭/);
  assert.match(describePrintConfig().example.note, /turn 页脚标题 off/);
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--footer-title')).description,
    /把 页脚标题 关闭/,
  );
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--mono')).description,
    /把 黑白省墨 关闭/,
  );
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /把 页脚标题 关闭/);
  JSON.parse(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'));

  function jobFor(argv) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', `${argv.join(' | ')}: ${(parsed.errors || []).join('; ')}`);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    return { parsed, job };
  }

  const unchecked = [
    ['把', '页脚标题', '关闭', 'layout', '3'],
    ['layout', '3', '把', '页脚标题', '关闭'],
    ['把，', '页脚标题', '关闭', 'layout', '3'],
    ['把', '页脚标题，', '关闭，', 'layout', '3'],
    ['把页脚标题关闭', 'layout', '3'],
    ['把页脚标题关闭，', 'layout', '3'],
    ['把', '页脚标题关闭', 'layout', '3'],
    ['把页脚标题', '关闭', 'layout', '3'],
    ['请', '把', '页脚标题', '关闭', 'layout', '3'],
    ['请把', '页脚标题', '关闭', 'layout', '3'],
    ['请把页脚标题关闭', 'layout', '3'],
    ['将', '页脚标题', '关掉', 'layout', '3'],
    ['把', '在页脚显示字库标题', '关闭', 'layout', '3'],
    ['把在页脚显示字库标题关闭', 'layout', '3'],
    ['把', 'setting-footer-title', 'off', 'layout', '3'],
    ['turn', '页脚标题', 'off', 'layout', '3'],
    ['switch', 'footer-title', 'off', 'layout', '3'],
    ['把关闭页脚标题', 'layout', '3'],
    ['把 页脚标题 关闭 layout 3'],
    ['layout 3 把页脚标题关闭'],
    ['跑端到端测试生成 PDF，layout 3，把页脚标题关闭'],
    ['run the end-to-end test to generate the PDF, layout 3, 把 页脚标题 关闭'],
    ['把 页脚标题 关闭', 'layout', '3'],
    ['hanzi-1000-v6.json', '把', '页脚标题', '关闭', 'layout', '3'],
  ];
  for (const argv of unchecked) {
    const { parsed, job } = jobFor(argv);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.rows, null, argv.join(' | '));
    assert.equal(job.settings.trace, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' | '));
    assert.equal(job.settings.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.defaults.showFooterTitle, true, argv.join(' | '));
    assert.equal(job.settings.effective.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.mono, false, argv.join(' | '));
    assert.equal(parsed.request.showFooterTitle, false, argv.join(' | '));
    assert.equal(parsed.request.input, argv[0] === 'hanzi-1000-v6.json' ? 'hanzi-1000-v6.json' : undefined, argv.join(' | '));
    assert.equal(job.inputDefaulted, argv[0] !== 'hanzi-1000-v6.json', argv.join(' | '));
    assert.equal(job.selection.selected, 1000, argv.join(' | '));
    assert.equal(job.output, fullOut, argv.join(' | '));
  }

  const agree = jobFor(['layout', '3', '把', '页脚标题', '关闭', 'off']);
  assert.equal(agree.job.settings.showFooterTitle, false);
  assert.equal(agree.job.inputDefaulted, true);
  assert.equal(agree.job.settings.cols, null);

  const inkOn = jobFor(['把', '黑白省墨', '打开', 'layout', '3']);
  assert.equal(inkOn.job.settings.mono, true);
  assert.equal(inkOn.parsed.request.mono, true);
  assert.equal(inkOn.job.settings.showFooterTitle, true);
  assert.equal(inkOn.job.inputDefaulted, true);
  assert.equal(inkOn.job.settings.cols, null);
  const inkOnCompact = jobFor(['将黑白省墨打开', 'layout', '3']);
  assert.equal(inkOnCompact.job.settings.mono, true);
  assert.equal(inkOnCompact.job.inputDefaulted, true);
  assert.equal(inkOnCompact.job.settings.showFooterTitle, true);

  const inkOff = jobFor(['把', '黑白省墨', '关闭', 'layout', '3']);
  assert.equal(inkOff.job.settings.mono, false);
  assert.equal(inkOff.parsed.request.mono, false);
  assert.equal(inkOff.job.settings.showFooterTitle, true);
  assert.equal(inkOff.job.inputDefaulted, true);
  assert.equal(inkOff.job.settings.cols, null);

  const flagWins = jobFor(['把', '页脚标题', '关闭', '--footer-title', 'layout', '3']);
  assert.equal(flagWins.job.settings.showFooterTitle, true);
  assert.equal(flagWins.job.inputDefaulted, true);
  assert.equal(flagWins.job.settings.cols, null);
  const agreeFlag = jobFor(['把', '页脚标题', '关闭', '--no-footer-title', 'layout', '3']);
  assert.equal(agreeFlag.job.settings.showFooterTitle, false);
  assert.equal(agreeFlag.job.inputDefaulted, true);

  const conflict = parseCliArgs(['layout', '3', '把', '页脚标题', '关闭', 'true'], { cwd: outside });
  assert.equal(conflict.mode, 'error');
  assert.match(conflict.errors[0], /conflicting footer-title/);
  assert.doesNotMatch(conflict.errors[0], /input not found/);
  const quotedConflict = parseCliArgs(['把 页脚标题 关闭 --footer-title layout 3'], { cwd: outside });
  assert.equal(quotedConflict.mode, 'error');
  assert.match(quotedConflict.errors[0], /conflicting footer-title/);
  assert.doesNotMatch(quotedConflict.errors[0], /input not found/);

  const bareMarker = buildPrintJob(parseCliArgs(['layout', '3', '把'], { cwd: outside }).request, { cwd: outside });
  assert.equal(bareMarker.ok, false);
  assert.match(bareMarker.errors.join('\n'), /把/);
  assert.match(bareMarker.errors.join('\n'), /input not found/);
  assert.equal(bareMarker.settings.showFooterTitle, true);
  assert.equal(bareMarker.settings.cols, null);

  const noVerb = buildPrintJob(
    parseCliArgs(['layout', '3', '把', '页脚标题'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(noVerb.ok, false);
  assert.match(noVerb.errors.join('\n'), /input not found/);
  assert.match(noVerb.errors.join('\n'), /把/);
  assert.equal(noVerb.settings.showFooterTitle, true);

  const noVerbCompact = buildPrintJob(
    parseCliArgs(['layout', '3', '把页脚标题'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(noVerbCompact.ok, false);
  assert.match(noVerbCompact.errors.join('\n'), /把页脚标题/);
  assert.match(noVerbCompact.errors.join('\n'), /input not found/);
  assert.equal(noVerbCompact.settings.showFooterTitle, true);

  const extra = buildPrintJob(
    parseCliArgs(['layout', '3', '把', '页脚标题', '关闭', 'extra'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(extra.ok, false);
  assert.match(extra.errors.join('\n'), /extra/);
  assert.match(extra.errors.join('\n'), /input not found/);
  assert.equal(extra.settings.showFooterTitle, false);

  const missingLayout = parseCliArgs(['把', '页脚标题', '关闭'], { cwd: outside });
  assert.equal(missingLayout.mode, 'run');
  assert.equal(missingLayout.request.input, undefined);
  assert.equal(missingLayout.request.showFooterTitle, false);
  const missingBuilt = buildPrintJob(missingLayout.request, { cwd: outside });
  assert.equal(missingBuilt.ok, false);
  assert.match(missingBuilt.errors.join('\n'), /layout/);
  assert.doesNotMatch(missingBuilt.errors.join('\n'), /input not found/);
  assert.doesNotMatch(missingBuilt.errors.join('\n'), /把/);

  assert.equal(resolveE2eEntry(['--e2e', '把', '页脚标题', '关闭']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '把页脚标题关闭']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '把', '页脚标题', '关闭', 'true']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');

  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT, 'layout', '3', '把', '页脚标题', '关闭', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(body.settings.showFooterTitle, false);
  assert.equal(body.settings.defaults.showFooterTitle, true);
  assert.equal(body.settings.mono, false);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    '把', '页脚标题', '关闭', 'layout', '3', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.inputDefaulted, true);
  assert.equal(npmBody.input, EXAMPLE_ABS);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.settings.showFooterTitle, false);
  assert.equal(npmBody.settings.mono, false);
  assert.equal(npmBody.selection.selected, 1);
  assert.equal(npmBody.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const noLayout = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--', '把', '页脚标题', '关闭',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(noLayout.status, 2, noLayout.stderr || noLayout.stdout);
  const noLayoutBody = JSON.parse(noLayout.stdout);
  assert.equal(noLayoutBody.ok, false);
  assert.match(noLayoutBody.errors.join('\n'), /layout/);
  assert.doesNotMatch(noLayoutBody.errors.join('\n'), /把/);
  assert.doesNotMatch(noLayoutBody.errors.join('\n'), /input not found/);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
});

test('print CLI: 页脚标题关闭 sets the box with no 把 instead of a filename or a checked footer', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-label-verb-'));
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  const html = readFileSync(join(REPO_ROOT, 'printer/index.html'), 'utf8');
  assert.match(html, /<span>页脚标题<\/span>/);
  assert.match(html, /title="在页脚显示字库标题"/);
  assert.match(html, /<span>黑白省墨<\/span>/);
  assert.match(formatHelp(), /页脚标题关闭/);
  assert.match(formatHelp(), /bare `关掉` is still a filename/);
  assert.match(formatHelp(), /showFooterTitlefalse/);
  assert.match(formatHelp(), /showFooterTitleoffline/);
  assert.match(describePrintConfig().example.note, /layout 3，页脚标题关闭/);
  assert.match(describePrintConfig().example.note, /layout 3，showFooterTitlefalse/);
  assert.match(describePrintConfig().example.note, /黑白省墨打开/);
  assert.match(describePrintConfig().example.note, /offline/);
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--footer-title')).description,
    /页脚标题 关掉/,
  );
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--mono')).description,
    /黑白省墨打开/,
  );
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /页脚标题关闭/);
  JSON.parse(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'));

  function jobFor(argv) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', `${argv.join(' | ')}: ${(parsed.errors || []).join('; ')}`);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    return { parsed, job };
  }

  const unchecked = [
    ['页脚标题关闭', 'layout', '3'],
    ['layout', '3', '页脚标题关闭'],
    ['页脚标题关掉', 'layout', '3'],
    ['页脚标题', '关掉', 'layout', '3'],
    ['页脚标题，', '关掉，', 'layout', '3'],
    ['页脚标题关闭，', 'layout', '3'],
    ['页脚标题off', 'layout', '3'],
    ['页脚标题 关掉', 'layout', '3'],
    ['页脚标题不显示', 'layout', '3'],
    ['请页脚标题关闭', 'layout', '3'],
    ['请', '页脚标题', '关掉', 'layout', '3'],
    ['请', '在页脚显示字库标题', '关闭', 'layout', '3'],
    ['在页脚显示字库标题关闭', 'layout', '3'],
    ['在页脚显示字库标题', '关闭', 'layout', '3'],
    ['showFooterTitle=false', 'layout', '3'],
    ['layout 3，页脚标题关闭'],
    ['layout 3 页脚标题 关掉'],
    ['跑端到端测试生成 PDF，layout 3，页脚标题关闭'],
    ['run the end-to-end test to generate the PDF, layout 3, 页脚标题关闭'],
    ['run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF,', 'layout', '3', '页脚标题', '关掉'],
    ['hanzi-1000-v6.json', '页脚标题关闭', 'layout', '3'],
    ['3 字/页', '页脚标题关闭'],
    ['showFooterTitlefalse', 'layout', '3'],
    ['layout', '3', 'showFooterTitlefalse'],
    ['showFooterTitleFalse', 'layout', '3'],
    ['showFooterTitleoff', 'layout', '3'],
    ['footer-titlefalse', 'layout', '3'],
    ['setting-footer-titleoff', 'layout', '3'],
    ['show-footer-titleoff', 'layout', '3'],
    ['footerTitlefalse', 'layout', '3'],
    ['offshowFooterTitle', 'layout', '3'],
    ['falseshowFooterTitle', 'layout', '3'],
    ['把showFooterTitlefalse', 'layout', '3'],
    ['layout 3，showFooterTitlefalse'],
    ['layout 3，offshowFooterTitle'],
    ['run the end-to-end test to generate the PDF, layout 3, showFooterTitlefalse'],
    ['跑端到端测试生成 PDF，layout 3，showFooterTitlefalse'],
  ];
  for (const argv of unchecked) {
    const { parsed, job } = jobFor(argv);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.rows, null, argv.join(' | '));
    assert.equal(job.settings.trace, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' | '));
    assert.equal(job.settings.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.defaults.showFooterTitle, true, argv.join(' | '));
    assert.equal(job.settings.effective.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.mono, false, argv.join(' | '));
    assert.equal(parsed.request.showFooterTitle, false, argv.join(' | '));
    assert.equal(parsed.request.input, argv[0] === 'hanzi-1000-v6.json' ? 'hanzi-1000-v6.json' : undefined, argv.join(' | '));
    assert.equal(job.inputDefaulted, argv[0] !== 'hanzi-1000-v6.json', argv.join(' | '));
    assert.equal(job.selection.selected, 1000, argv.join(' | '));
    assert.equal(job.output, fullOut, argv.join(' | '));
  }

  const agree = jobFor(['layout', '3', '页脚标题关闭', 'off']);
  assert.equal(agree.job.settings.showFooterTitle, false);
  assert.equal(agree.job.inputDefaulted, true);
  assert.equal(agree.job.settings.cols, null);

  const withCols = jobFor(['页脚标题关闭', 'layout', '3', '每行', '5']);
  assert.equal(withCols.job.settings.showFooterTitle, false);
  assert.equal(withCols.job.settings.cols, 5);
  assert.equal(withCols.job.settings.rows, null);
  assert.equal(withCols.job.settings.trace, null);
  assert.equal(withCols.job.inputDefaulted, true);

  const inkOn = [
    ['黑白省墨打开', 'layout', '3'],
    ['黑白省墨', '打开', 'layout', '3'],
    ['切换黑白省墨打印模式打开', 'layout', '3'],
    ['切换黑白省墨打印模式', '打开', 'layout', '3'],
  ];
  for (const argv of inkOn) {
    const { parsed, job } = jobFor(argv);
    assert.equal(job.inputDefaulted, true, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.mono, true, argv.join(' | '));
    assert.equal(parsed.request.mono, true, argv.join(' | '));
    assert.equal(job.settings.showFooterTitle, true, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.selection.selected, 1000, argv.join(' | '));
  }

  const inkOff = jobFor(['黑白省墨关闭', 'layout', '3']);
  assert.equal(inkOff.job.settings.mono, false);
  assert.equal(inkOff.parsed.request.mono, false);
  assert.equal(inkOff.job.settings.showFooterTitle, true);
  assert.equal(inkOff.job.inputDefaulted, true);
  assert.equal(inkOff.job.settings.cols, null);
  const monoGlued = jobFor(['monooff', 'layout', '3']);
  assert.equal(monoGlued.job.settings.mono, false);
  assert.equal(monoGlued.parsed.request.mono, false);
  assert.equal(monoGlued.job.settings.showFooterTitle, true);
  assert.equal(monoGlued.job.inputDefaulted, true);
  assert.equal(monoGlued.job.settings.cols, null);
  const settingMonoGlued = jobFor(['setting-monooff', 'layout', '3']);
  assert.equal(settingMonoGlued.job.settings.mono, false);
  assert.equal(settingMonoGlued.job.inputDefaulted, true);
  assert.equal(settingMonoGlued.job.settings.showFooterTitle, true);
  const monoVerbFirst = jobFor(['offmono', 'layout', '3']);
  assert.equal(monoVerbFirst.job.settings.mono, false);
  assert.equal(monoVerbFirst.job.inputDefaulted, true);
  assert.equal(monoVerbFirst.job.settings.showFooterTitle, true);
  const noMonoStill = jobFor(['no-mono', 'layout', '3']);
  assert.equal(noMonoStill.job.settings.mono, false);
  assert.equal(noMonoStill.parsed.request.mono, false);
  assert.equal(noMonoStill.job.inputDefaulted, true);
  assert.equal(noMonoStill.job.settings.showFooterTitle, true);
  const quotedNoMono = jobFor(['layout 3，no-mono']);
  assert.equal(quotedNoMono.job.settings.mono, false);
  assert.equal(quotedNoMono.job.inputDefaulted, true);
  assert.equal(quotedNoMono.job.settings.showFooterTitle, true);

  const stillOn = jobFor(['页脚标题', 'layout', '3']);
  assert.equal(stillOn.job.settings.showFooterTitle, true);
  assert.equal(stillOn.job.inputDefaulted, true);
  assert.equal(stillOn.job.settings.cols, null);

  const digitStaysLayout = jobFor(['1', '页脚标题']);
  assert.equal(digitStaysLayout.job.settings.layout, 1);
  assert.equal(digitStaysLayout.job.settings.showFooterTitle, true);
  assert.equal(digitStaysLayout.job.inputDefaulted, true);
  assert.equal(digitStaysLayout.job.settings.cols, null);

  const flagWins = jobFor(['页脚标题关闭', '--footer-title', 'layout', '3']);
  assert.equal(flagWins.job.settings.showFooterTitle, true);
  assert.equal(flagWins.job.inputDefaulted, true);
  assert.equal(flagWins.job.settings.cols, null);

  const conflict = parseCliArgs(['layout', '3', '页脚标题关闭', 'true'], { cwd: outside });
  assert.equal(conflict.mode, 'error');
  assert.match(conflict.errors[0], /conflicting footer-title/);
  assert.doesNotMatch(conflict.errors[0], /input not found/);
  const quotedConflict = parseCliArgs(['页脚标题关闭 --footer-title layout 3'], { cwd: outside });
  assert.equal(quotedConflict.mode, 'error');
  assert.match(quotedConflict.errors[0], /conflicting footer-title/);
  assert.doesNotMatch(quotedConflict.errors[0], /input not found/);

  const bareVerb = buildPrintJob(parseCliArgs(['layout', '3', '关掉'], { cwd: outside }).request, { cwd: outside });
  assert.equal(bareVerb.ok, false);
  assert.match(bareVerb.errors.join('\n'), /关掉/);
  assert.match(bareVerb.errors.join('\n'), /input not found/);
  assert.equal(bareVerb.settings.showFooterTitle, true);
  assert.equal(bareVerb.settings.cols, null);

  const bareOpen = buildPrintJob(parseCliArgs(['layout', '3', '打开'], { cwd: outside }).request, { cwd: outside });
  assert.equal(bareOpen.ok, false);
  assert.match(bareOpen.errors.join('\n'), /打开/);
  assert.match(bareOpen.errors.join('\n'), /input not found/);
  assert.equal(bareOpen.settings.mono, false);

  const panel = buildPrintJob(parseCliArgs(['layout', '3', '关闭面板'], { cwd: outside }).request, { cwd: outside });
  assert.equal(panel.ok, false);
  assert.match(panel.errors.join('\n'), /关闭面板/);
  assert.equal(panel.settings.showFooterTitle, true);

  const gluedNotVerb = buildPrintJob(
    parseCliArgs(['layout', '3', 'showFooterTitleoffline'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(gluedNotVerb.ok, false);
  assert.match(gluedNotVerb.errors.join('\n'), /showFooterTitleoffline/);
  assert.doesNotMatch(gluedNotVerb.errors.join('\n'), /showFooterTitlefalse/);
  assert.equal(gluedNotVerb.settings.showFooterTitle, true);
  const offline = buildPrintJob(
    parseCliArgs(['layout', '3', 'offline'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(offline.ok, false);
  assert.match(offline.errors.join('\n'), /offline/);
  assert.equal(offline.settings.showFooterTitle, true);
  assert.equal(offline.settings.mono, false);
  const quotedOffline = jobFor(['layout 3，offline']);
  assert.equal(quotedOffline.job.settings.showFooterTitle, true);
  assert.equal(quotedOffline.job.settings.mono, false);
  assert.equal(quotedOffline.job.inputDefaulted, true);
  assert.equal(quotedOffline.job.settings.cols, null);
  const gluedConflict = parseCliArgs(['layout', '3', 'showFooterTitlefalse', 'true'], { cwd: outside });
  assert.equal(gluedConflict.mode, 'error');
  assert.match(gluedConflict.errors[0], /conflicting footer-title/);
  assert.doesNotMatch(gluedConflict.errors[0], /input not found/);
  const gluedQuotedConflict = parseCliArgs(['showFooterTitlefalse --footer-title layout 3'], { cwd: outside });
  assert.equal(gluedQuotedConflict.mode, 'error');
  assert.match(gluedQuotedConflict.errors[0], /conflicting footer-title/);

  const bareTitle = buildPrintJob(
    parseCliArgs(['layout', '3', '在页脚显示字库标题'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(bareTitle.ok, false);
  assert.match(bareTitle.errors.join('\n'), /在页脚显示字库标题/);
  assert.equal(bareTitle.settings.showFooterTitle, true);

  const noVerb = buildPrintJob(
    parseCliArgs(['layout', '3', '把', '页脚标题'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(noVerb.ok, false);
  assert.match(noVerb.errors.join('\n'), /把/);
  assert.equal(noVerb.settings.showFooterTitle, true);

  const extra = buildPrintJob(
    parseCliArgs(['layout', '3', '页脚标题关闭', 'extra'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(extra.ok, false);
  assert.match(extra.errors.join('\n'), /extra/);
  assert.match(extra.errors.join('\n'), /input not found/);
  assert.equal(extra.settings.showFooterTitle, false);

  const missingLayout = parseCliArgs(['页脚标题关闭'], { cwd: outside });
  assert.equal(missingLayout.mode, 'run');
  assert.equal(missingLayout.request.input, undefined);
  assert.equal(missingLayout.request.showFooterTitle, false);
  const missingBuilt = buildPrintJob(missingLayout.request, { cwd: outside });
  assert.equal(missingBuilt.ok, false);
  assert.match(missingBuilt.errors.join('\n'), /layout/);
  assert.doesNotMatch(missingBuilt.errors.join('\n'), /input not found/);
  assert.doesNotMatch(missingBuilt.errors.join('\n'), /页脚标题关闭/);

  const buried = parseCliArgs(['生成 PDF，页脚标题关闭'], { cwd: outside });
  assert.equal(buried.mode, 'run');
  assert.equal(buried.request.showFooterTitle, false);
  assert.equal(buried.request.input, undefined);
  const buriedBuilt = buildPrintJob(buried.request, { cwd: outside });
  assert.equal(buriedBuilt.ok, false);
  assert.match(buriedBuilt.errors.join('\n'), /layout/);
  assert.doesNotMatch(buriedBuilt.errors.join('\n'), /input not found/);
  assert.doesNotMatch(buriedBuilt.errors.join('\n'), /生成/);

  assert.equal(resolveE2eEntry(['--e2e', '页脚标题关闭']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '页脚标题', '关掉']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '黑白省墨打开']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', '页脚标题关闭', 'true']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'showFooterTitlefalse']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'offshowFooterTitle']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'layout 3，showFooterTitlefalse']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');

  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT, 'layout', '3', '页脚标题关闭', 'showFooterTitlefalse', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(body.settings.showFooterTitle, false);
  assert.equal(body.settings.defaults.showFooterTitle, true);
  assert.equal(body.settings.mono, false);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    'showFooterTitlefalse', 'layout', '3', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.inputDefaulted, true);
  assert.equal(npmBody.input, EXAMPLE_ABS);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.settings.showFooterTitle, false);
  assert.equal(npmBody.settings.mono, false);
  assert.equal(npmBody.selection.selected, 1);
  assert.equal(npmBody.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const noLayout = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--', '页脚标题关闭',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(noLayout.status, 2, noLayout.stderr || noLayout.stdout);
  const noLayoutBody = JSON.parse(noLayout.stdout);
  assert.equal(noLayoutBody.ok, false);
  assert.match(noLayoutBody.errors.join('\n'), /layout/);
  assert.doesNotMatch(noLayoutBody.errors.join('\n'), /页脚标题关闭/);
  assert.doesNotMatch(noLayoutBody.errors.join('\n'), /input not found/);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
});

test('print CLI: showFooterTitle-off is the checkbox with a hyphen before the verb, not a filename', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-label-hyphen-'));
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  const html = readFileSync(join(REPO_ROOT, 'printer/index.html'), 'utf8');
  assert.match(html, /id="setting-footer-title"/);
  assert.match(html, /id="setting-mono"/);
  assert.match(formatHelp(), /showFooterTitle-off/);
  assert.match(formatHelp(), /setting-footer-title-off/);
  assert.match(formatHelp(), /layout 3，showFooterTitle-off/);
  assert.match(formatHelp(), /showFooterTitle-offline/);
  assert.match(formatHelp(), /layout 3，showFooterTitle-offline/);
  assert.match(formatHelp(), /does not print with the footer left on/);
  assert.match(formatHelp(), /off-showFooterTitle/);
  assert.match(describePrintConfig().example.note, /setting-footer-title-off/);
  assert.match(describePrintConfig().example.note, /layout 3，showFooterTitle-off/);
  assert.match(describePrintConfig().example.note, /layout 3，showFooterTitle-offline/);
  assert.match(describePrintConfig().example.note, /does not print with the footer left on/);
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--footer-title')).description,
    /layout 3，showFooterTitle-offline/,
  );
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--mono')).description,
    /layout 3，mono-offline/,
  );
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /layout 3，showFooterTitle-offline/);
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--mono')).description,
    /mono-off/,
  );
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /setting-footer-title-off/);
  JSON.parse(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'));

  function jobFor(argv) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', `${argv.join(' | ')}: ${(parsed.errors || []).join('; ')}`);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    return { parsed, job };
  }

  const unchecked = [
    ['showFooterTitle-off', 'layout', '3'],
    ['layout', '3', 'showFooterTitle-off'],
    ['showFooterTitle-Off', 'layout', '3'],
    ['showFooterTitle--off', 'layout', '3'],
    ['showFooterTitle-off,', 'layout', '3'],
    ['setting-footer-title-off', 'layout', '3'],
    ['setting-footer-title-false', 'layout', '3'],
    ['show-footer-title-off', 'layout', '3'],
    ['footer-title-off', 'layout', '3'],
    ['footerTitle-off', 'layout', '3'],
    ['页脚标题-关闭', 'layout', '3'],
    ['页脚标题-关掉', 'layout', '3'],
    ['在页脚显示字库标题-关闭', 'layout', '3'],
    ['把showFooterTitle-off', 'layout', '3'],
    ['把', 'showFooterTitle-off', 'layout', '3'],
    ['请showFooterTitle-off', 'layout', '3'],
    ['layout 3，showFooterTitle-off'],
    ['layout 3，setting-footer-title-off'],
    ['layout 3, showFooterTitle-off'],
    ['run the end-to-end test to generate the PDF, layout 3, showFooterTitle-off'],
    ['跑端到端测试生成 PDF，layout 3，setting-footer-title-off'],
    ['run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF,', 'layout', '3', 'showFooterTitle-off'],
    ['hanzi-1000-v6.json', 'showFooterTitle-off', 'layout', '3'],
    ['3 字/页', 'setting-footer-title-off'],
  ];
  for (const argv of unchecked) {
    const { parsed, job } = jobFor(argv);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.rows, null, argv.join(' | '));
    assert.equal(job.settings.trace, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' | '));
    assert.equal(job.settings.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.defaults.showFooterTitle, true, argv.join(' | '));
    assert.equal(job.settings.effective.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.mono, false, argv.join(' | '));
    assert.equal(parsed.request.showFooterTitle, false, argv.join(' | '));
    assert.equal(parsed.request.input, argv[0] === 'hanzi-1000-v6.json' ? 'hanzi-1000-v6.json' : undefined, argv.join(' | '));
    assert.equal(job.inputDefaulted, argv[0] !== 'hanzi-1000-v6.json', argv.join(' | '));
    assert.equal(job.selection.selected, 1000, argv.join(' | '));
    assert.equal(job.output, fullOut, argv.join(' | '));
  }

  const agree = jobFor(['layout', '3', 'showFooterTitle-off', 'off']);
  assert.equal(agree.job.settings.showFooterTitle, false);
  assert.equal(agree.job.inputDefaulted, true);
  assert.equal(agree.job.settings.cols, null);

  const bareId = jobFor(['setting-footer-title', 'layout', '3']);
  assert.equal(bareId.job.settings.showFooterTitle, true);
  assert.equal(bareId.parsed.request.showFooterTitle, true);
  assert.equal(bareId.job.inputDefaulted, true);
  assert.equal(bareId.job.settings.cols, null);

  const inkOff = jobFor(['mono-off', 'layout', '3']);
  assert.equal(inkOff.job.settings.mono, false);
  assert.equal(inkOff.parsed.request.mono, false);
  assert.equal(inkOff.job.settings.showFooterTitle, true);
  assert.equal(inkOff.job.inputDefaulted, true);
  assert.equal(inkOff.job.settings.cols, null);
  const settingMono = jobFor(['setting-mono-off', 'layout', '3']);
  assert.equal(settingMono.job.settings.mono, false);
  assert.equal(settingMono.parsed.request.mono, false);
  assert.equal(settingMono.job.settings.showFooterTitle, true);
  assert.equal(settingMono.job.inputDefaulted, true);
  const inkOn = jobFor(['黑白省墨-打开', 'layout', '3']);
  assert.equal(inkOn.job.settings.mono, true);
  assert.equal(inkOn.parsed.request.mono, true);
  assert.equal(inkOn.job.settings.showFooterTitle, true);
  assert.equal(inkOn.job.settings.cols, null);
  assert.equal(inkOn.job.inputDefaulted, true);

  const ranged = jobFor(['layout', '3', '序号', '1', '-', '12', 'showFooterTitle-off']);
  assert.equal(ranged.job.settings.showFooterTitle, false);
  assert.equal(ranged.job.selection.selected, 12);
  assert.equal(ranged.job.settings.cols, null);
  assert.equal(ranged.job.inputDefaulted, true);

  const noMonoStill = jobFor(['no-mono', 'layout', '3']);
  assert.equal(noMonoStill.job.settings.mono, false);
  assert.equal(noMonoStill.parsed.request.mono, false);
  assert.equal(noMonoStill.job.settings.showFooterTitle, true);
  assert.equal(noMonoStill.job.inputDefaulted, true);

  const flagWins = jobFor(['showFooterTitle-off', '--footer-title', 'layout', '3']);
  assert.equal(flagWins.job.settings.showFooterTitle, true);
  assert.equal(flagWins.job.inputDefaulted, true);
  assert.equal(flagWins.job.settings.cols, null);

  const conflict = parseCliArgs(['layout', '3', 'showFooterTitle-off', 'true'], { cwd: outside });
  assert.equal(conflict.mode, 'error');
  assert.match(conflict.errors[0], /conflicting footer-title/);
  assert.doesNotMatch(conflict.errors[0], /input not found/);
  const quotedConflict = parseCliArgs(['showFooterTitle-off --footer-title layout 3'], { cwd: outside });
  assert.equal(quotedConflict.mode, 'error');
  assert.match(quotedConflict.errors[0], /conflicting footer-title/);
  assert.doesNotMatch(quotedConflict.errors[0], /input not found/);

  const notVerb = buildPrintJob(
    parseCliArgs(['layout', '3', 'showFooterTitle-offline'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(notVerb.ok, false);
  assert.match(notVerb.errors.join('\n'), /showFooterTitle-offline/);
  assert.doesNotMatch(notVerb.errors.join('\n'), /showFooterTitle-off(?!line)/);
  assert.equal(notVerb.settings.showFooterTitle, true);
  const monoNotVerb = buildPrintJob(
    parseCliArgs(['layout', '3', 'mono-offline'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(monoNotVerb.ok, false);
  assert.match(monoNotVerb.errors.join('\n'), /mono-offline/);
  assert.equal(monoNotVerb.settings.mono, false);
  assert.equal(monoNotVerb.settings.showFooterTitle, true);
  const verbFirst = jobFor(['layout', '3', 'off-showFooterTitle']);
  assert.equal(verbFirst.job.settings.showFooterTitle, false);
  assert.equal(verbFirst.job.inputDefaulted, true);
  assert.equal(verbFirst.job.settings.cols, null);
  const quotedNotVerb = parseCliArgs(['layout 3，showFooterTitle-offline'], { cwd: outside });
  assert.equal(quotedNotVerb.mode, 'error');
  assert.match(quotedNotVerb.errors[0], /showFooterTitle-offline/);
  assert.match(quotedNotVerb.errors[0], /not a checkbox verb/);
  assert.match(quotedNotVerb.errors[0], /does not print with the footer left on/);
  assert.match(quotedNotVerb.errors[0], /footer-title/);
  assert.equal(quotedNotVerb.request, undefined);
  const quotedGluedId = parseCliArgs(['layout 3，showFooterTitleoffline'], { cwd: outside });
  assert.equal(quotedGluedId.mode, 'error');
  assert.match(quotedGluedId.errors[0], /showFooterTitleoffline/);
  assert.match(quotedGluedId.errors[0], /does not print with the footer left on/);
  const quotedMono = parseCliArgs(['layout 3，mono-offline'], { cwd: outside });
  assert.equal(quotedMono.mode, 'error');
  assert.match(quotedMono.errors[0], /mono-offline/);
  assert.match(quotedMono.errors[0], /does not print with the box left unchanged/);
  const quotedSetting = parseCliArgs(['layout 3，setting-footer-title-offline'], { cwd: outside });
  assert.equal(quotedSetting.mode, 'error');
  assert.match(quotedSetting.errors[0], /setting-footer-title-offline/);
  assert.match(quotedSetting.errors[0], /footer-title/);
  const quotedZero = parseCliArgs(['layout 3，showFooterTitle0'], { cwd: outside });
  assert.equal(quotedZero.mode, 'error');
  assert.match(quotedZero.errors[0], /showFooterTitle0/);
  const quotedSentence = parseCliArgs(['run the end-to-end test to generate the PDF, layout 3, showFooterTitle-offline'], { cwd: outside });
  assert.equal(quotedSentence.mode, 'error');
  assert.match(quotedSentence.errors[0], /showFooterTitle-offline/);
  assert.doesNotMatch(quotedSentence.errors[0], /input not found/);
  const quotedCn = parseCliArgs(['跑端到端测试生成 PDF，layout 3，showFooterTitle-offline'], { cwd: outside });
  assert.equal(quotedCn.mode, 'error');
  assert.match(quotedCn.errors[0], /showFooterTitle-offline/);
  const quotedJob = parseCliArgs(['printer/spec/print-job.example.json，showFooterTitle-offline'], { cwd: outside });
  assert.equal(quotedJob.mode, 'error');
  assert.match(quotedJob.errors[0], /showFooterTitle-offline/);
  const quotedBa = parseCliArgs(['layout 3，把showFooterTitle-offline'], { cwd: outside });
  assert.equal(quotedBa.mode, 'error');
  assert.match(quotedBa.errors[0], /把showFooterTitle-offline/);
  const glueWord = jobFor(['layout 3，monochrome']);
  assert.equal(glueWord.job.settings.showFooterTitle, true);
  assert.equal(glueWord.job.settings.mono, false);
  assert.equal(glueWord.job.inputDefaulted, true);
  assert.equal(glueWord.job.settings.cols, null);

  const beforeRefused = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const refused = spawnSync(process.execPath, [
    SCRIPT, 'layout 3，showFooterTitle-offline', '--limit', '1',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.notEqual(refused.status, 0, refused.stdout || refused.stderr);
  const refusedBody = JSON.parse(refused.stdout);
  assert.equal(refusedBody.ok, false);
  assert.match(refusedBody.errors.join('\n'), /showFooterTitle-offline/);
  assert.match(refusedBody.errors.join('\n'), /does not print with the footer left on/);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeRefused);
  const npmRefused = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    'layout 3，showFooterTitle-offline', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npmRefused.status, 2, npmRefused.stderr || npmRefused.stdout);
  const npmRefusedBody = JSON.parse(npmRefused.stdout);
  assert.equal(npmRefusedBody.ok, false);
  assert.match(npmRefusedBody.errors.join('\n'), /showFooterTitle-offline/);
  assert.doesNotMatch(npmRefusedBody.errors.join('\n'), /input not found/);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeRefused);

  const missingLayout = parseCliArgs(['showFooterTitle-off'], { cwd: outside });
  assert.equal(missingLayout.mode, 'run');
  assert.equal(missingLayout.request.input, undefined);
  assert.equal(missingLayout.request.showFooterTitle, false);
  const missingBuilt = buildPrintJob(missingLayout.request, { cwd: outside });
  assert.equal(missingBuilt.ok, false);
  assert.match(missingBuilt.errors.join('\n'), /layout/);
  assert.doesNotMatch(missingBuilt.errors.join('\n'), /input not found/);
  assert.doesNotMatch(missingBuilt.errors.join('\n'), /showFooterTitle-off/);

  const buried = parseCliArgs(['生成 PDF，showFooterTitle-off'], { cwd: outside });
  assert.equal(buried.mode, 'run');
  assert.equal(buried.request.showFooterTitle, false);
  assert.equal(buried.request.input, undefined);
  const buriedBuilt = buildPrintJob(buried.request, { cwd: outside });
  assert.equal(buriedBuilt.ok, false);
  assert.match(buriedBuilt.errors.join('\n'), /layout/);
  assert.doesNotMatch(buriedBuilt.errors.join('\n'), /input not found/);
  assert.doesNotMatch(buriedBuilt.errors.join('\n'), /生成/);

  assert.equal(resolveE2eEntry(['--e2e', 'showFooterTitle-off']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'setting-footer-title-off']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'layout 3，showFooterTitle-off']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');

  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT, 'layout', '3', 'showFooterTitle-off', 'setting-footer-title-off', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.settings.effective.trace, SPECS[3].defTrace);
  assert.equal(body.settings.showFooterTitle, false);
  assert.equal(body.settings.defaults.showFooterTitle, true);
  assert.equal(body.settings.mono, false);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    'setting-footer-title-off', 'layout', '3', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.inputDefaulted, true);
  assert.equal(npmBody.input, EXAMPLE_ABS);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.settings.showFooterTitle, false);
  assert.equal(npmBody.settings.mono, false);
  assert.equal(npmBody.selection.selected, 1);
  assert.equal(npmBody.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const noLayout = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--', 'showFooterTitle-off',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(noLayout.status, 2, noLayout.stderr || noLayout.stdout);
  const noLayoutBody = JSON.parse(noLayout.stdout);
  assert.equal(noLayoutBody.ok, false);
  assert.match(noLayoutBody.errors.join('\n'), /layout/);
  assert.doesNotMatch(noLayoutBody.errors.join('\n'), /showFooterTitle-off/);
  assert.doesNotMatch(noLayoutBody.errors.join('\n'), /input not found/);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
});

test('print CLI: showFooterTitle -off is the checkbox, not -o plus a file named ff', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-split-hyphen-'));
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  const stray = join(outside, 'ff');
  assert.match(formatHelp(), /showFooterTitle -off/);
  assert.match(formatHelp(), /file named `ff`/);
  assert.match(formatHelp(), /layout 3，showFooterTitle -off/);
  assert.match(formatHelp(), /A bare `-off` is still `-o ff`/);
  assert.match(formatHelp(), /showFooterTitle -offline/);
  assert.match(describePrintConfig().example.note, /showFooterTitle -off/);
  assert.match(describePrintConfig().example.note, /not output `ffline`/);
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--footer-title')).description,
    /showFooterTitle -off/,
  );
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--mono')).description,
    /mono -off/,
  );
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /showFooterTitle -off/);
  JSON.parse(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'));

  function jobFor(argv) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', `${argv.join(' | ')}: ${(parsed.errors || []).join('; ')}`);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    return { parsed, job };
  }

  const unchecked = [
    ['layout', '3', 'showFooterTitle', '-off'],
    ['showFooterTitle', '-off', 'layout', '3'],
    ['showFooterTitle', '-Off', 'layout', '3'],
    ['showFooterTitle', '--off', 'layout', '3'],
    ['showFooterTitle', '-off,', 'layout', '3'],
    ['showFooterTitle,', '-off', 'layout', '3'],
    ['setting-footer-title', '-off', 'layout', '3'],
    ['setting-footer-title', '-false', 'layout', '3'],
    ['footer-title', '-off', 'layout', '3'],
    ['页脚标题', '-关闭', 'layout', '3'],
    ['页脚标题', '-关掉', 'layout', '3'],
    ['在页脚显示字库标题', '-关闭', 'layout', '3'],
    ['把', 'showFooterTitle', '-off', 'layout', '3'],
    ['把', '页脚标题', '-关闭', 'layout', '3'],
    ['关闭', '页脚标题', '-off', 'layout', '3'],
    ['layout 3，showFooterTitle -off'],
    ['layout 3, showFooterTitle -off'],
    ['layout 3，setting-footer-title -off'],
    ['run the end-to-end test to generate the PDF, layout 3, showFooterTitle -off'],
    ['跑端到端测试生成 PDF，layout 3，showFooterTitle -off'],
    ['run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF,', 'layout', '3', 'showFooterTitle', '-off'],
    ['hanzi-1000-v6.json', 'showFooterTitle', '-off', 'layout', '3'],
    ['3 字/页', 'showFooterTitle', '-off'],
  ];
  for (const argv of unchecked) {
    const { parsed, job } = jobFor(argv);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.rows, null, argv.join(' | '));
    assert.equal(job.settings.trace, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' | '));
    assert.equal(job.settings.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.defaults.showFooterTitle, true, argv.join(' | '));
    assert.equal(job.settings.effective.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.mono, false, argv.join(' | '));
    assert.equal(parsed.request.showFooterTitle, false, argv.join(' | '));
    assert.equal(parsed.request.input, argv[0] === 'hanzi-1000-v6.json' ? 'hanzi-1000-v6.json' : undefined, argv.join(' | '));
    assert.equal(job.inputDefaulted, argv[0] !== 'hanzi-1000-v6.json', argv.join(' | '));
    assert.equal(job.selection.selected, 1000, argv.join(' | '));
    assert.equal(parsed.request.output, undefined, argv.join(' | '));
    assert.equal(job.output, fullOut, argv.join(' | '));
    assert.notEqual(job.output, stray, argv.join(' | '));
  }

  const agree = jobFor(['layout', '3', 'showFooterTitle', '-off', 'off']);
  assert.equal(agree.job.settings.showFooterTitle, false);
  assert.equal(agree.job.inputDefaulted, true);
  assert.equal(agree.job.settings.cols, null);
  assert.equal(agree.job.output, fullOut);

  const inkOff = jobFor(['mono', '-off', 'layout', '3']);
  assert.equal(inkOff.job.settings.mono, false);
  assert.equal(inkOff.parsed.request.mono, false);
  assert.equal(inkOff.job.settings.showFooterTitle, true);
  assert.equal(inkOff.job.output, fullOut);
  assert.equal(inkOff.job.inputDefaulted, true);
  assert.equal(inkOff.job.settings.cols, null);
  const inkOn = jobFor(['黑白省墨', '-打开', 'layout', '3']);
  assert.equal(inkOn.job.settings.mono, true);
  assert.equal(inkOn.parsed.request.mono, true);
  assert.equal(inkOn.job.settings.showFooterTitle, true);
  assert.equal(inkOn.job.settings.cols, null);
  assert.equal(inkOn.job.output, fullOut);

  const ranged = jobFor(['layout', '3', '序号', '1', '-', '12', 'showFooterTitle', '-off']);
  assert.equal(ranged.job.settings.showFooterTitle, false);
  assert.equal(ranged.job.selection.selected, 12);
  assert.equal(ranged.job.settings.cols, null);
  assert.equal(ranged.job.output, join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-12.pdf'));
  assert.equal(ranged.parsed.request.output, undefined);

  const realOutput = jobFor(['layout', '3', 'showFooterTitle', '-o', 'out.pdf']);
  assert.equal(realOutput.job.settings.showFooterTitle, true);
  assert.equal(realOutput.parsed.request.output, 'out.pdf');
  assert.equal(realOutput.job.output, join(outside, 'out.pdf'));
  assert.equal(realOutput.job.inputDefaulted, true);
  assert.equal(realOutput.job.settings.cols, null);

  const both = jobFor(['layout', '3', 'showFooterTitle', '-off', '-o', 'out.pdf']);
  assert.equal(both.job.settings.showFooterTitle, false);
  assert.equal(both.parsed.request.output, 'out.pdf');
  assert.equal(both.job.output, join(outside, 'out.pdf'));
  assert.equal(both.job.settings.cols, null);

  const flagWins = jobFor(['showFooterTitle', '-off', '--footer-title', 'layout', '3']);
  assert.equal(flagWins.job.settings.showFooterTitle, true);
  assert.equal(flagWins.parsed.request.output, undefined);
  assert.equal(flagWins.job.output, fullOut);
  assert.equal(flagWins.job.inputDefaulted, true);

  const conflict = parseCliArgs(['layout', '3', 'showFooterTitle', '-off', 'true'], { cwd: outside });
  assert.equal(conflict.mode, 'error');
  assert.match(conflict.errors[0], /conflicting footer-title/);
  assert.equal(conflict.request, undefined);
  const quotedConflict = parseCliArgs(['showFooterTitle -off --footer-title layout 3'], { cwd: outside });
  assert.equal(quotedConflict.mode, 'error');
  assert.match(quotedConflict.errors[0], /conflicting footer-title/);

  const bareOff = parseCliArgs(['layout', '3', '-off'], { cwd: outside });
  assert.equal(bareOff.mode, 'run');
  assert.equal(bareOff.request.output, 'ff');
  assert.equal(bareOff.request.showFooterTitle, undefined);
  const bareBuilt = buildPrintJob(bareOff.request, { cwd: outside });
  assert.equal(bareBuilt.ok, true);
  assert.equal(bareBuilt.output, stray);
  assert.equal(bareBuilt.settings.showFooterTitle, true);
  assert.equal(bareBuilt.settings.cols, null);

  const notVerbParsed = parseCliArgs(['layout', '3', 'showFooterTitle', '-offline'], { cwd: outside });
  assert.equal(notVerbParsed.request.output, undefined);
  const notVerb = buildPrintJob(notVerbParsed.request, { cwd: outside });
  assert.equal(notVerb.ok, false);
  assert.match(notVerb.errors.join('\n'), /offline/);
  assert.doesNotMatch(notVerb.errors.join('\n'), /[/\\]ffline/);
  assert.equal(notVerbParsed.request.showFooterTitle, true);
  assert.equal(notVerbParsed.request.input, 'offline');
  assert.notEqual(notVerb.output, join(outside, 'ffline'));
  assert.doesNotMatch(notVerb.output, /[/\\]ffline$/);
  const quotedSpaced = parseCliArgs(['layout 3，showFooterTitle -offline'], { cwd: outside });
  assert.equal(quotedSpaced.mode, 'error');
  assert.match(quotedSpaced.errors[0], /unknown option/);
  assert.match(quotedSpaced.errors[0], /-offline/);
  const quotedGlued = parseCliArgs(['layout 3，showFooterTitle-offline'], { cwd: outside });
  assert.equal(quotedGlued.mode, 'error');
  assert.match(quotedGlued.errors[0], /showFooterTitle-offline/);
  assert.match(quotedGlued.errors[0], /does not print with the footer left on/);
  assert.equal(quotedGlued.request, undefined);
  assert.equal(resolveE2eEntry(['--e2e', 'layout 3，showFooterTitle-offline']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'layout 3，showFooterTitleoffline']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'layout 3，mono-offline']).action, 'print');

  const verbFirst = jobFor(['layout', '3', 'off-showFooterTitle']);
  assert.equal(verbFirst.job.settings.showFooterTitle, false);
  assert.equal(verbFirst.job.inputDefaulted, true);
  assert.equal(verbFirst.job.settings.cols, null);

  const missingLayout = parseCliArgs(['showFooterTitle', '-off'], { cwd: outside });
  assert.equal(missingLayout.mode, 'run');
  assert.equal(missingLayout.request.output, undefined);
  assert.equal(missingLayout.request.showFooterTitle, false);
  assert.equal(missingLayout.request.input, undefined);
  const missingBuilt = buildPrintJob(missingLayout.request, { cwd: outside });
  assert.equal(missingBuilt.ok, false);
  assert.match(missingBuilt.errors.join('\n'), /layout/);
  assert.doesNotMatch(missingBuilt.errors.join('\n'), /input not found/);

  assert.equal(resolveE2eEntry(['--e2e', 'showFooterTitle', '-off', 'layout', '3']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'layout 3，showFooterTitle -off']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'showFooterTitle', '-off']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');

  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT, 'layout', '3', 'showFooterTitle', '-off', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.settings.showFooterTitle, false);
  assert.equal(body.settings.mono, false);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, limitedOut);
  assert.equal(existsSync(stray), false);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    'showFooterTitle', '-off', 'layout', '3', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.settings.showFooterTitle, false);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.output, limitedOut);
  assert.equal(existsSync(stray), false);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
});

test('print CLI: showFooterTitle - off is the checkbox, not an unknown option -', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-lone-hyphen-'));
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  const stray = join(outside, 'ff');
  assert.match(formatHelp(), /showFooterTitle - off/);
  assert.match(formatHelp(), /layout 3，showFooterTitle - off/);
  assert.match(formatHelp(), /A bare `- off` with no label is still an unknown option/);
  assert.match(formatHelp(), /not an unknown option `-`/);
  assert.match(describePrintConfig().example.note, /showFooterTitle - off/);
  assert.match(describePrintConfig().example.note, /layout 3，showFooterTitle - off/);
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--footer-title')).description,
    /showFooterTitle - off/,
  );
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--mono')).description,
    /mono - off/,
  );
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /showFooterTitle - off/);
  JSON.parse(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'));

  function jobFor(argv) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', `${argv.join(' | ')}: ${(parsed.errors || []).join('; ')}`);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    return { parsed, job };
  }

  const unchecked = [
    ['layout', '3', 'showFooterTitle', '-', 'off'],
    ['showFooterTitle', '-', 'off', 'layout', '3'],
    ['showFooterTitle', '-', 'Off', 'layout', '3'],
    ['showFooterTitle', '--', 'off', 'layout', '3'],
    ['showFooterTitle', '–', 'off', 'layout', '3'],
    ['showFooterTitle', '-', 'off,', 'layout', '3'],
    ['showFooterTitle,', '-', 'off', 'layout', '3'],
    ['showFooterTitle', '-,', 'off', 'layout', '3'],
    ['setting-footer-title', '-', 'off', 'layout', '3'],
    ['setting-footer-title', '-', 'false', 'layout', '3'],
    ['footer-title', '-', 'off', 'layout', '3'],
    ['页脚标题', '-', '关闭', 'layout', '3'],
    ['页脚标题', '-', '关掉', 'layout', '3'],
    ['在页脚显示字库标题', '-', '关闭', 'layout', '3'],
    ['把', 'showFooterTitle', '-', 'off', 'layout', '3'],
    ['把', '页脚标题', '-', '关闭', 'layout', '3'],
    ['turn', 'showFooterTitle', '-', 'off', 'layout', '3'],
    ['请', 'showFooterTitle', '-', 'off', 'layout', '3'],
    ['关闭', '页脚标题', '-', 'off', 'layout', '3'],
    ['layout 3，showFooterTitle - off'],
    ['layout 3, showFooterTitle - off'],
    ['layout 3，setting-footer-title - off'],
    ['run the end-to-end test to generate the PDF, layout 3, showFooterTitle - off'],
    ['跑端到端测试生成 PDF，layout 3，showFooterTitle - off'],
    ['run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF,', 'layout', '3', 'showFooterTitle', '-', 'off'],
    ['hanzi-1000-v6.json', 'showFooterTitle', '-', 'off', 'layout', '3'],
    ['3 字/页', 'showFooterTitle', '-', 'off'],
  ];
  for (const argv of unchecked) {
    const { parsed, job } = jobFor(argv);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.rows, null, argv.join(' | '));
    assert.equal(job.settings.trace, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' | '));
    assert.equal(job.settings.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.defaults.showFooterTitle, true, argv.join(' | '));
    assert.equal(job.settings.effective.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.mono, false, argv.join(' | '));
    assert.equal(parsed.request.showFooterTitle, false, argv.join(' | '));
    assert.equal(parsed.request.input, argv[0] === 'hanzi-1000-v6.json' ? 'hanzi-1000-v6.json' : undefined, argv.join(' | '));
    assert.equal(job.inputDefaulted, argv[0] !== 'hanzi-1000-v6.json', argv.join(' | '));
    assert.equal(job.selection.selected, 1000, argv.join(' | '));
    assert.equal(parsed.request.output, undefined, argv.join(' | '));
    assert.equal(job.output, fullOut, argv.join(' | '));
    assert.notEqual(job.output, stray, argv.join(' | '));
  }

  const agree = jobFor(['layout', '3', 'showFooterTitle', '-', 'off', 'off']);
  assert.equal(agree.job.settings.showFooterTitle, false);
  assert.equal(agree.job.inputDefaulted, true);
  assert.equal(agree.job.settings.cols, null);
  assert.equal(agree.job.output, fullOut);

  const inkOff = jobFor(['mono', '-', 'off', 'layout', '3']);
  assert.equal(inkOff.job.settings.mono, false);
  assert.equal(inkOff.parsed.request.mono, false);
  assert.equal(inkOff.job.settings.showFooterTitle, true);
  assert.equal(inkOff.job.output, fullOut);
  assert.equal(inkOff.job.inputDefaulted, true);
  assert.equal(inkOff.job.settings.cols, null);
  const inkOn = jobFor(['黑白省墨', '-', '打开', 'layout', '3']);
  assert.equal(inkOn.job.settings.mono, true);
  assert.equal(inkOn.parsed.request.mono, true);
  assert.equal(inkOn.job.settings.showFooterTitle, true);
  assert.equal(inkOn.job.settings.cols, null);
  assert.equal(inkOn.job.output, fullOut);

  const ranged = jobFor(['layout', '3', '序号', '1', '-', '12', 'showFooterTitle', '-', 'off']);
  assert.equal(ranged.job.settings.showFooterTitle, false);
  assert.equal(ranged.job.selection.selected, 12);
  assert.equal(ranged.job.settings.cols, null);
  assert.equal(ranged.job.output, join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-12.pdf'));
  assert.equal(ranged.parsed.request.output, undefined);

  const realOutput = jobFor(['layout', '3', 'showFooterTitle', '-o', 'out.pdf']);
  assert.equal(realOutput.job.settings.showFooterTitle, true);
  assert.equal(realOutput.parsed.request.output, 'out.pdf');
  assert.equal(realOutput.job.output, join(outside, 'out.pdf'));
  assert.equal(realOutput.job.inputDefaulted, true);
  assert.equal(realOutput.job.settings.cols, null);

  const both = jobFor(['layout', '3', 'showFooterTitle', '-', 'off', '-o', 'out.pdf']);
  assert.equal(both.job.settings.showFooterTitle, false);
  assert.equal(both.parsed.request.output, 'out.pdf');
  assert.equal(both.job.output, join(outside, 'out.pdf'));
  assert.equal(both.job.settings.cols, null);

  const flagWins = jobFor(['showFooterTitle', '-', 'off', '--footer-title', 'layout', '3']);
  assert.equal(flagWins.job.settings.showFooterTitle, true);
  assert.equal(flagWins.parsed.request.output, undefined);
  assert.equal(flagWins.job.output, fullOut);
  assert.equal(flagWins.job.inputDefaulted, true);

  const conflict = parseCliArgs(['layout', '3', 'showFooterTitle', '-', 'off', 'true'], { cwd: outside });
  assert.equal(conflict.mode, 'error');
  assert.match(conflict.errors[0], /conflicting footer-title/);
  assert.equal(conflict.request, undefined);
  const quotedConflict = parseCliArgs(['showFooterTitle - off --footer-title layout 3'], { cwd: outside });
  assert.equal(quotedConflict.mode, 'error');
  assert.match(quotedConflict.errors[0], /conflicting footer-title/);
  assert.doesNotMatch(quotedConflict.errors[0], /unknown option/);

  const bareHyphen = parseCliArgs(['layout', '3', '-', 'off'], { cwd: outside });
  assert.equal(bareHyphen.mode, 'error');
  assert.match(bareHyphen.errors[0], /unknown option/);
  assert.match(bareHyphen.errors[0], /"-"/);
  assert.equal(bareHyphen.request, undefined);
  const spacedOutput = parseCliArgs(['layout', '3', 'showFooterTitle', '-', 'o', 'out.pdf'], { cwd: outside });
  assert.equal(spacedOutput.mode, 'error');
  assert.match(spacedOutput.errors[0], /unknown option/);
  assert.equal(spacedOutput.request, undefined);

  const notVerb = parseCliArgs(['layout', '3', 'showFooterTitle', '-', 'offline'], { cwd: outside });
  assert.equal(notVerb.mode, 'error');
  assert.match(notVerb.errors[0], /unknown option/);
  assert.match(notVerb.errors[0], /"-"/);
  assert.equal(notVerb.request, undefined);
  const quotedNotVerb = parseCliArgs(['layout 3，showFooterTitle - offline'], { cwd: outside });
  assert.equal(quotedNotVerb.mode, 'error');
  assert.match(quotedNotVerb.errors[0], /unknown option/);
  assert.match(quotedNotVerb.errors[0], /"-"/);

  const missingLayout = parseCliArgs(['showFooterTitle', '-', 'off'], { cwd: outside });
  assert.equal(missingLayout.mode, 'run');
  assert.equal(missingLayout.request.output, undefined);
  assert.equal(missingLayout.request.showFooterTitle, false);
  assert.equal(missingLayout.request.input, undefined);
  const missingBuilt = buildPrintJob(missingLayout.request, { cwd: outside });
  assert.equal(missingBuilt.ok, false);
  assert.match(missingBuilt.errors.join('\n'), /layout/);
  assert.doesNotMatch(missingBuilt.errors.join('\n'), /input not found/);
  assert.doesNotMatch(missingBuilt.errors.join('\n'), /unknown option/);

  const buried = parseCliArgs(['生成 PDF，showFooterTitle - off'], { cwd: outside });
  assert.equal(buried.mode, 'run');
  assert.equal(buried.request.showFooterTitle, false);
  assert.equal(buried.request.input, undefined);
  const buriedBuilt = buildPrintJob(buried.request, { cwd: outside });
  assert.equal(buriedBuilt.ok, false);
  assert.match(buriedBuilt.errors.join('\n'), /layout/);
  assert.doesNotMatch(buriedBuilt.errors.join('\n'), /input not found/);
  assert.doesNotMatch(buriedBuilt.errors.join('\n'), /unknown option/);

  assert.equal(resolveE2eEntry(['--e2e', 'showFooterTitle', '-', 'off', 'layout', '3']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'layout 3，showFooterTitle - off']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'showFooterTitle', '-', 'off']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');

  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT, 'layout', '3', 'showFooterTitle', '-', 'off', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.settings.showFooterTitle, false);
  assert.equal(body.settings.mono, false);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, limitedOut);
  assert.equal(existsSync(stray), false);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    'showFooterTitle', '-', 'off', 'layout', '3', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.settings.showFooterTitle, false);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.output, limitedOut);
  assert.equal(existsSync(stray), false);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
});

test('print CLI: off-showFooterTitle unchecks the footer and does not read no-mono as no plus mono', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-verb-hyphen-'));
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  assert.match(formatHelp(), /layout 3，off-showFooterTitle/);
  assert.match(formatHelp(), /hyphen before the label/);
  assert.match(formatHelp(), /not `no` plus a label/);
  assert.match(formatHelp(), /off-line/);
  assert.match(formatHelp(), /off-showFooterTitlexyz/);
  assert.match(formatHelp(), /does not print with the footer left on/);
  assert.match(describePrintConfig().example.note, /layout 3，off-showFooterTitle/);
  assert.match(describePrintConfig().example.note, /not `no` plus a label/);
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--footer-title')).description,
    /layout 3，off-showFooterTitle/,
  );
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--mono')).description,
    /layout 3，off-mono/,
  );
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /layout 3，off-showFooterTitle/);
  JSON.parse(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'));

  function jobFor(argv) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', `${argv.join(' | ')}: ${(parsed.errors || []).join('; ')}`);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    return { parsed, job };
  }

  const unchecked = [
    ['off-showFooterTitle', 'layout', '3'],
    ['layout', '3', 'off-showFooterTitle'],
    ['OFF-showFooterTitle', 'layout', '3'],
    ['off--showFooterTitle', 'layout', '3'],
    ['off-showFooterTitle,', 'layout', '3'],
    ['off-setting-footer-title', 'layout', '3'],
    ['false-showFooterTitle', 'layout', '3'],
    ['uncheck-showFooterTitle', 'layout', '3'],
    ['off-页脚标题', 'layout', '3'],
    ['关闭-页脚标题', 'layout', '3'],
    ['off-在页脚显示字库标题', 'layout', '3'],
    ['把off-showFooterTitle', 'layout', '3'],
    ['turn', 'off-showFooterTitle', 'layout', '3'],
    ['layout 3，off-showFooterTitle'],
    ['layout 3, off-showFooterTitle'],
    ['run the end-to-end test to generate the PDF, layout 3, off-showFooterTitle'],
    ['跑端到端测试生成 PDF，layout 3，off-showFooterTitle'],
    ['run', 'the', 'end-to-end', 'test', 'to', 'generate', 'the', 'PDF,', 'layout', '3', 'off-showFooterTitle'],
    ['hanzi-1000-v6.json', 'off-showFooterTitle', 'layout', '3'],
    ['3 字/页', 'off-showFooterTitle'],
    ['layout 3，no-footer-title'],
  ];
  for (const argv of unchecked) {
    const { parsed, job } = jobFor(argv);
    assert.equal(job.settings.layout, 3, argv.join(' | '));
    assert.equal(job.input, EXAMPLE_ABS, argv.join(' | '));
    assert.equal(job.settings.cols, null, argv.join(' | '));
    assert.equal(job.settings.rows, null, argv.join(' | '));
    assert.equal(job.settings.trace, null, argv.join(' | '));
    assert.equal(job.settings.effective.cols, SPECS[3].cols, argv.join(' | '));
    assert.equal(job.settings.effective.trace, SPECS[3].defTrace, argv.join(' | '));
    assert.equal(job.settings.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.defaults.showFooterTitle, true, argv.join(' | '));
    assert.equal(job.settings.effective.showFooterTitle, false, argv.join(' | '));
    assert.equal(job.settings.mono, false, argv.join(' | '));
    assert.equal(parsed.request.showFooterTitle, false, argv.join(' | '));
    assert.equal(parsed.request.input, argv[0] === 'hanzi-1000-v6.json' ? 'hanzi-1000-v6.json' : undefined, argv.join(' | '));
    assert.equal(job.inputDefaulted, argv[0] !== 'hanzi-1000-v6.json', argv.join(' | '));
    assert.equal(job.selection.selected, 1000, argv.join(' | '));
    assert.equal(job.output, fullOut, argv.join(' | '));
  }

  const inkOff = jobFor(['off-mono', 'layout', '3']);
  assert.equal(inkOff.job.settings.mono, false);
  assert.equal(inkOff.parsed.request.mono, false);
  assert.equal(inkOff.job.settings.showFooterTitle, true);
  assert.equal(inkOff.job.inputDefaulted, true);
  assert.equal(inkOff.job.settings.cols, null);
  const inkOn = jobFor(['on-黑白省墨', 'layout', '3']);
  assert.equal(inkOn.job.settings.mono, true);
  assert.equal(inkOn.job.settings.showFooterTitle, true);
  assert.equal(inkOn.job.inputDefaulted, true);
  assert.equal(inkOn.job.settings.cols, null);

  const noMonoStill = jobFor(['no-mono', 'layout', '3']);
  assert.equal(noMonoStill.job.settings.mono, false);
  assert.equal(noMonoStill.parsed.request.mono, false);
  assert.equal(noMonoStill.job.settings.showFooterTitle, true);
  assert.equal(noMonoStill.job.inputDefaulted, true);
  const noMonoCase = jobFor(['No-Mono', 'layout', '3']);
  assert.equal(noMonoCase.job.settings.mono, false);
  assert.equal(noMonoCase.job.settings.showFooterTitle, true);
  const quotedNoMono = jobFor(['layout 3，no-mono']);
  assert.equal(quotedNoMono.job.settings.mono, false);
  assert.equal(quotedNoMono.job.settings.showFooterTitle, true);
  assert.equal(quotedNoMono.job.inputDefaulted, true);
  const flagNotVerb = parseCliArgs(['layout', '3', 'no-mono', 'true'], { cwd: outside });
  assert.equal(flagNotVerb.mode, 'error');
  assert.match(flagNotVerb.errors[0], /does not turn the box on/);
  assert.doesNotMatch(flagNotVerb.errors[0], /conflicting mono values: no/);
  const flagEq = parseCliArgs(['layout', '3', 'no-mono=true'], { cwd: outside });
  assert.equal(flagEq.mode, 'error');
  assert.match(flagEq.errors[0], /does not turn the box on/);

  const agree = jobFor(['layout', '3', 'off-showFooterTitle', 'off']);
  assert.equal(agree.job.settings.showFooterTitle, false);
  assert.equal(agree.job.inputDefaulted, true);
  assert.equal(agree.job.settings.cols, null);
  const ranged = jobFor(['layout', '3', '序号', '1', '-', '12', 'off-showFooterTitle']);
  assert.equal(ranged.job.settings.showFooterTitle, false);
  assert.equal(ranged.job.selection.selected, 12);
  assert.equal(ranged.job.settings.cols, null);
  const flagWins = jobFor(['off-showFooterTitle', '--footer-title', 'layout', '3']);
  assert.equal(flagWins.job.settings.showFooterTitle, true);
  assert.equal(flagWins.job.inputDefaulted, true);
  assert.equal(flagWins.job.settings.cols, null);
  const conflict = parseCliArgs(['layout', '3', 'off-showFooterTitle', 'true'], { cwd: outside });
  assert.equal(conflict.mode, 'error');
  assert.match(conflict.errors[0], /conflicting footer-title/);
  assert.doesNotMatch(conflict.errors[0], /input not found/);
  const quotedConflict = parseCliArgs(['off-showFooterTitle --footer-title layout 3'], { cwd: outside });
  assert.equal(quotedConflict.mode, 'error');
  assert.match(quotedConflict.errors[0], /conflicting footer-title/);

  const offLine = buildPrintJob(
    parseCliArgs(['layout', '3', 'off-line'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(offLine.ok, false);
  assert.match(offLine.errors.join('\n'), /off-line/);
  assert.match(offLine.errors.join('\n'), /input not found/);
  assert.equal(offLine.settings.showFooterTitle, true);
  const quotedOffLine = jobFor(['layout 3，off-line']);
  assert.equal(quotedOffLine.job.settings.showFooterTitle, true);
  assert.equal(quotedOffLine.job.inputDefaulted, true);
  assert.equal(quotedOffLine.job.settings.cols, null);
  const quotedMonoGlue = jobFor(['layout 3，off-monochrome']);
  assert.equal(quotedMonoGlue.job.settings.mono, false);
  assert.equal(quotedMonoGlue.job.settings.showFooterTitle, true);
  assert.equal(quotedMonoGlue.job.inputDefaulted, true);
  const offline = buildPrintJob(
    parseCliArgs(['layout', '3', 'offline'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(offline.ok, false);
  assert.match(offline.errors.join('\n'), /offline/);
  assert.equal(offline.settings.showFooterTitle, true);
  const junk = buildPrintJob(
    parseCliArgs(['layout', '3', 'off-showFooterTitlexyz'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(junk.ok, false);
  assert.match(junk.errors.join('\n'), /off-showFooterTitlexyz/);
  assert.match(junk.errors.join('\n'), /input not found/);
  assert.equal(junk.settings.showFooterTitle, true);
  const quotedJunk = parseCliArgs(['layout 3，off-showFooterTitlexyz'], { cwd: outside });
  assert.equal(quotedJunk.mode, 'error');
  assert.match(quotedJunk.errors[0], /off-showFooterTitlexyz/);
  assert.match(quotedJunk.errors[0], /not a checkbox label/);
  assert.match(quotedJunk.errors[0], /does not print with the footer left on/);
  assert.equal(quotedJunk.request, undefined);
  const quotedBa = parseCliArgs(['layout 3，把off-showFooterTitlexyz'], { cwd: outside });
  assert.equal(quotedBa.mode, 'error');
  assert.match(quotedBa.errors[0], /把off-showFooterTitlexyz/);
  assert.match(quotedBa.errors[0], /does not print with the footer left on/);
  const splitHyphen = parseCliArgs(['layout', '3', 'off', '-', 'showFooterTitle'], { cwd: outside });
  assert.equal(splitHyphen.mode, 'error');
  assert.match(splitHyphen.errors[0], /unknown option/);
  assert.equal(splitHyphen.request, undefined);

  const missingLayout = parseCliArgs(['off-showFooterTitle'], { cwd: outside });
  assert.equal(missingLayout.mode, 'run');
  assert.equal(missingLayout.request.showFooterTitle, false);
  assert.equal(missingLayout.request.input, undefined);
  const missingBuilt = buildPrintJob(missingLayout.request, { cwd: outside });
  assert.equal(missingBuilt.ok, false);
  assert.match(missingBuilt.errors.join('\n'), /layout/);
  assert.doesNotMatch(missingBuilt.errors.join('\n'), /input not found/);
  assert.doesNotMatch(missingBuilt.errors.join('\n'), /off-showFooterTitle/);
  const buried = parseCliArgs(['生成 PDF，off-showFooterTitle'], { cwd: outside });
  assert.equal(buried.mode, 'run');
  assert.equal(buried.request.showFooterTitle, false);
  assert.equal(buried.request.input, undefined);
  const buriedBuilt = buildPrintJob(buried.request, { cwd: outside });
  assert.equal(buriedBuilt.ok, false);
  assert.match(buriedBuilt.errors.join('\n'), /layout/);
  assert.doesNotMatch(buriedBuilt.errors.join('\n'), /input not found/);

  assert.equal(resolveE2eEntry(['--e2e', 'off-showFooterTitle']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'layout 3，off-showFooterTitle']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'layout 3，off-showFooterTitlexyz']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');

  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const dry = spawnSync(process.execPath, [
    SCRIPT, 'layout', '3', 'off-showFooterTitle', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const body = JSON.parse(dry.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.layout, 3);
  assert.equal(body.inputDefaulted, true);
  assert.equal(body.input, EXAMPLE_ABS);
  assert.equal(body.settings.cols, null);
  assert.equal(body.settings.effective.cols, SPECS[3].cols);
  assert.equal(body.settings.showFooterTitle, false);
  assert.equal(body.settings.defaults.showFooterTitle, true);
  assert.equal(body.settings.mono, false);
  assert.equal(body.selection.selected, 1);
  assert.equal(body.output, limitedOut);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const quotedDry = spawnSync(process.execPath, [
    SCRIPT, 'layout 3，off-showFooterTitle', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.equal(quotedDry.status, 0, quotedDry.stderr || quotedDry.stdout);
  const quotedBody = JSON.parse(quotedDry.stdout);
  assert.equal(quotedBody.ok, true);
  assert.equal(quotedBody.dryRun, true);
  assert.equal(quotedBody.settings.showFooterTitle, false);
  assert.equal(quotedBody.settings.cols, null);
  assert.equal(quotedBody.selection.selected, 1);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);

  const refused = spawnSync(process.execPath, [
    SCRIPT, 'layout 3，off-showFooterTitlexyz', '--limit', '1',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.notEqual(refused.status, 0, refused.stdout || refused.stderr);
  const refusedBody = JSON.parse(refused.stdout);
  assert.equal(refusedBody.ok, false);
  assert.match(refusedBody.errors.join('\n'), /off-showFooterTitlexyz/);
  assert.match(refusedBody.errors.join('\n'), /does not print with the footer left on/);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    'layout 3，off-showFooterTitle', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 0, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, true);
  assert.equal(npmBody.dryRun, true);
  assert.equal(npmBody.layout, 3);
  assert.equal(npmBody.settings.showFooterTitle, false);
  assert.equal(npmBody.settings.cols, null);
  assert.equal(npmBody.selection.selected, 1);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
});

test('print CLI: quoted offline-showFooterTitle is not dropped and does not print with the footer on', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-offline-label-'));
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  assert.match(formatHelp(), /layout 3，offline-showFooterTitle/);
  assert.match(formatHelp(), /not `off` plus a label/);
  assert.match(formatHelp(), /offline-showFooterTitlexyz/);
  assert.match(describePrintConfig().example.note, /layout 3，offline-showFooterTitle/);
  assert.match(describePrintConfig().example.note, /not `off` plus a label/);
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--footer-title')).description,
    /layout 3，offline-showFooterTitle/,
  );
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--mono')).description,
    /layout 3，offline-mono/,
  );
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /layout 3，offline-showFooterTitle/);
  JSON.parse(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'));

  function jobFor(argv) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', `${argv.join(' | ')}: ${(parsed.errors || []).join('; ')}`);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    return { parsed, job };
  }

  const quoted = [
    ['layout 3，offline-showFooterTitle'],
    ['layout 3, offline-showFooterTitle'],
    ['layout 3，OFFLINE-showFooterTitle'],
    ['layout 3，offline--showFooterTitle'],
    ['layout 3，offline-页脚标题'],
    ['layout 3，offline-setting-footer-title'],
    ['layout 3，把offline-showFooterTitle'],
    ['layout 3，请offline-showFooterTitle'],
    ['layout 3，offline-showFooterTitlexyz'],
    ['layout 3，offline-mono'],
    ['layout 3，online-黑白省墨'],
    ['layout 3，关闭面板-页脚标题'],
    ['run the end-to-end test to generate the PDF, layout 3, offline-showFooterTitle'],
    ['跑端到端测试生成 PDF，layout 3，offline-showFooterTitle'],
    ['printer/spec/print-job.example.json，offline-showFooterTitle'],
  ];
  for (const argv of quoted) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'error', argv.join(' | '));
    assert.equal(parsed.request, undefined, argv.join(' | '));
    assert.match(parsed.errors[0], /not ignored/, argv.join(' | '));
    assert.match(parsed.errors[0], /plus a label/, argv.join(' | '));
    assert.doesNotMatch(parsed.errors[0], /input not found/, argv.join(' | '));
    if (argv[0].includes('offline-mono') || argv[0].includes('黑白省墨')) {
      assert.match(parsed.errors[0], /box left unchanged/, argv.join(' | '));
    } else {
      assert.match(parsed.errors[0], /footer left on/, argv.join(' | '));
    }
  }

  const separate = buildPrintJob(
    parseCliArgs(['layout', '3', 'offline-showFooterTitle'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(separate.ok, false);
  assert.match(separate.errors.join('\n'), /offline-showFooterTitle/);
  assert.match(separate.errors.join('\n'), /input not found/);
  assert.equal(separate.settings.showFooterTitle, true);
  assert.equal(separate.settings.cols, null);

  const stillDropped = jobFor(['layout 3，offline']);
  assert.equal(stillDropped.job.settings.showFooterTitle, true);
  assert.equal(stillDropped.job.settings.mono, false);
  assert.equal(stillDropped.job.inputDefaulted, true);
  assert.equal(stillDropped.job.settings.cols, null);
  const noHyphen = parseCliArgs(['layout 3，offlineshowFooterTitle'], { cwd: outside });
  assert.equal(noHyphen.mode, 'error');
  assert.match(noHyphen.errors[0], /offlineshowFooterTitle/);
  assert.match(noHyphen.errors[0], /footer left on/);
  assert.match(noHyphen.errors[0], /no hyphen/);
  const immediate = parseCliArgs(['layout 3，off-line-showFooterTitle'], { cwd: outside });
  assert.equal(immediate.mode, 'error');
  assert.match(immediate.errors[0], /off-line-showFooterTitle/);
  assert.match(immediate.errors[0], /hyphen is immediate/);
  assert.match(immediate.errors[0], /footer left on/);
  assert.equal(immediate.request, undefined);
  const real = jobFor(['layout 3，off-showFooterTitle']);
  assert.equal(real.job.settings.showFooterTitle, false);
  assert.equal(real.job.settings.cols, null);
  assert.equal(real.job.inputDefaulted, true);
  const flag = jobFor(['layout 3，no-mono']);
  assert.equal(flag.job.settings.mono, false);
  assert.equal(flag.parsed.request.mono, false);
  assert.equal(flag.job.settings.showFooterTitle, true);
  assert.equal(flag.job.settings.cols, null);

  const buried = parseCliArgs(['生成 PDF，offline-showFooterTitle'], { cwd: outside });
  assert.equal(buried.mode, 'run');
  assert.equal(buried.request.showFooterTitle, undefined);
  const buriedBuilt = buildPrintJob(buried.request, { cwd: outside });
  assert.equal(buriedBuilt.ok, false);
  assert.match(buriedBuilt.errors.join('\n'), /offline-showFooterTitle/);
  assert.match(buriedBuilt.errors.join('\n'), /input not found/);

  const splitHyphen = parseCliArgs(['layout', '3', 'off', '-', 'showFooterTitle'], { cwd: outside });
  assert.equal(splitHyphen.mode, 'error');
  assert.match(splitHyphen.errors[0], /unknown option/);
  assert.equal(splitHyphen.request, undefined);

  assert.equal(resolveE2eEntry(['--e2e', 'layout 3，offline-showFooterTitle']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'layout 3，offline-showFooterTitlexyz']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');

  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const refused = spawnSync(process.execPath, [
    SCRIPT, 'layout 3，offline-showFooterTitle', '--limit', '1',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.notEqual(refused.status, 0, refused.stdout || refused.stderr);
  const refusedBody = JSON.parse(refused.stdout);
  assert.equal(refusedBody.ok, false);
  assert.match(refusedBody.errors.join('\n'), /offline-showFooterTitle/);
  assert.match(refusedBody.errors.join('\n'), /not off plus a label/);
  assert.match(refusedBody.errors.join('\n'), /does not print with the footer left on/);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    'layout 3，offline-showFooterTitle', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 2, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, false);
  assert.match(npmBody.errors.join('\n'), /offline-showFooterTitle/);
  assert.match(npmBody.errors.join('\n'), /does not print with the footer left on/);
  assert.doesNotMatch(npmBody.errors.join('\n'), /input not found/);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);
});

test('print CLI: quoted offlineshowFooterTitle is not dropped and does not print with the footer on', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-offline-glued-'));
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  assert.match(formatHelp(), /layout 3，offlineshowFooterTitle/);
  assert.match(formatHelp(), /glued to a label/);
  assert.match(formatHelp(), /no hyphen/);
  assert.match(formatHelp(), /offlineshowFooterTitlexyz/);
  assert.match(describePrintConfig().example.note, /layout 3，offlineshowFooterTitle/);
  assert.match(describePrintConfig().example.note, /no hyphen/);
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--footer-title')).description,
    /layout 3，offlineshowFooterTitle/,
  );
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--mono')).description,
    /layout 3，online黑白省墨/,
  );
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /layout 3，offlineshowFooterTitle/);
  JSON.parse(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'));

  function jobFor(argv) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', `${argv.join(' | ')}: ${(parsed.errors || []).join('; ')}`);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    return { parsed, job };
  }

  const quoted = [
    ['layout 3，offlineshowFooterTitle'],
    ['layout 3, offlineshowFooterTitle'],
    ['layout 3，OFFLINESHOWFOOTERTITLE'],
    ['layout 3，offlineshowFooterTitlexyz'],
    ['layout 3，offshowFooterTitlexyz'],
    ['layout 3，offlinefooter-title'],
    ['layout 3，把offlineshowFooterTitle'],
    ['layout 3，请offlineshowFooterTitle'],
    ['layout 3，关闭面板页脚标题'],
    ['layout 3，online黑白省墨'],
    ['run the end-to-end test to generate the PDF, layout 3, offlineshowFooterTitle'],
    ['跑端到端测试生成 PDF，layout 3，offlineshowFooterTitle'],
    ['printer/spec/print-job.example.json，offlineshowFooterTitle'],
  ];
  for (const argv of quoted) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'error', argv.join(' | '));
    assert.equal(parsed.request, undefined, argv.join(' | '));
    assert.match(parsed.errors[0], /glued to a label/, argv.join(' | '));
    assert.match(parsed.errors[0], /no hyphen/, argv.join(' | '));
    assert.match(parsed.errors[0], /not ignored/, argv.join(' | '));
    assert.doesNotMatch(parsed.errors[0], /input not found/, argv.join(' | '));
    if (argv[0].includes('黑白省墨')) {
      assert.match(parsed.errors[0], /box left unchanged/, argv.join(' | '));
    } else {
      assert.match(parsed.errors[0], /footer left on/, argv.join(' | '));
    }
  }

  const separate = buildPrintJob(
    parseCliArgs(['layout', '3', 'offlineshowFooterTitle'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(separate.ok, false);
  assert.match(separate.errors.join('\n'), /offlineshowFooterTitle/);
  assert.match(separate.errors.join('\n'), /input not found/);
  assert.equal(separate.settings.showFooterTitle, true);
  assert.equal(separate.settings.cols, null);

  const stillDropped = jobFor(['layout 3，offline']);
  assert.equal(stillDropped.job.settings.showFooterTitle, true);
  assert.equal(stillDropped.job.settings.mono, false);
  assert.equal(stillDropped.job.inputDefaulted, true);
  const shortMono = jobFor(['layout 3，offlinemono']);
  assert.equal(shortMono.job.settings.mono, false);
  assert.equal(shortMono.job.settings.showFooterTitle, true);
  assert.equal(shortMono.job.inputDefaulted, true);
  const monoWord = jobFor(['layout 3，offmonochrome']);
  assert.equal(monoWord.job.settings.mono, false);
  assert.equal(monoWord.job.inputDefaulted, true);
  const immediate = parseCliArgs(['layout 3，off-line-showFooterTitle'], { cwd: outside });
  assert.equal(immediate.mode, 'error');
  assert.match(immediate.errors[0], /hyphen is immediate/);
  assert.match(immediate.errors[0], /footer left on/);
  assert.equal(immediate.request, undefined);
  const real = jobFor(['layout 3，offshowFooterTitle']);
  assert.equal(real.job.settings.showFooterTitle, false);
  assert.equal(real.job.settings.cols, null);
  assert.equal(real.job.inputDefaulted, true);
  const realCase = jobFor(['layout 3，OFFSHOWFOOTERTITLE']);
  assert.equal(realCase.job.settings.showFooterTitle, false);
  const realCn = jobFor(['layout 3，关掉页脚标题']);
  assert.equal(realCn.job.settings.showFooterTitle, false);
  const hyphenReal = jobFor(['layout 3，off-showFooterTitle']);
  assert.equal(hyphenReal.job.settings.showFooterTitle, false);
  const flag = jobFor(['layout 3，no-mono']);
  assert.equal(flag.job.settings.mono, false);
  assert.equal(flag.job.settings.showFooterTitle, true);

  const buried = parseCliArgs(['生成 PDF，offlineshowFooterTitle'], { cwd: outside });
  assert.equal(buried.mode, 'run');
  assert.equal(buried.request.showFooterTitle, undefined);
  const buriedBuilt = buildPrintJob(buried.request, { cwd: outside });
  assert.equal(buriedBuilt.ok, false);
  assert.match(buriedBuilt.errors.join('\n'), /offlineshowFooterTitle/);
  assert.match(buriedBuilt.errors.join('\n'), /input not found/);

  const splitHyphen = parseCliArgs(['layout', '3', 'off', '-', 'showFooterTitle'], { cwd: outside });
  assert.equal(splitHyphen.mode, 'error');
  assert.match(splitHyphen.errors[0], /unknown option/);
  assert.equal(splitHyphen.request, undefined);

  assert.equal(resolveE2eEntry(['--e2e', 'layout 3，offlineshowFooterTitle']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'layout 3，offlineshowFooterTitlexyz']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');

  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const refused = spawnSync(process.execPath, [
    SCRIPT, 'layout 3，offlineshowFooterTitle', '--limit', '1',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.notEqual(refused.status, 0, refused.stdout || refused.stderr);
  const refusedBody = JSON.parse(refused.stdout);
  assert.equal(refusedBody.ok, false);
  assert.match(refusedBody.errors.join('\n'), /offlineshowFooterTitle/);
  assert.match(refusedBody.errors.join('\n'), /glued to a label/);
  assert.match(refusedBody.errors.join('\n'), /does not print with the footer left on/);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    'layout 3，offlineshowFooterTitle', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 2, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, false);
  assert.match(npmBody.errors.join('\n'), /offlineshowFooterTitle/);
  assert.match(npmBody.errors.join('\n'), /does not print with the footer left on/);
  assert.doesNotMatch(npmBody.errors.join('\n'), /input not found/);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);
});

test('print CLI: quoted off-line-showFooterTitle is not dropped and does not print with the footer on', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hanzi-print-immediate-hyphen-'));
  const fullOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3.pdf');
  const limitedOut = join(REPO_ROOT, 'printer', 'output', 'hanzi-1000-v6-layout-3-r1-1.pdf');
  assert.match(formatHelp(), /layout 3，off-line-showFooterTitle/);
  assert.match(formatHelp(), /hyphen is immediate/);
  assert.match(formatHelp(), /off-line-showFooterTitlexyz/);
  assert.match(formatHelp(), /off-lineshowFooterTitle/);
  assert.match(describePrintConfig().example.note, /layout 3，off-line-showFooterTitle/);
  assert.match(describePrintConfig().example.note, /hyphen is immediate/);
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--footer-title')).description,
    /layout 3，off-line-showFooterTitle/,
  );
  assert.match(
    describePrintConfig().options.find((opt) => opt.flag.startsWith('--mono')).description,
    /layout 3，off-line-mono/,
  );
  assert.match(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'), /layout 3，off-line-showFooterTitle/);
  JSON.parse(readFileSync(join(REPO_ROOT, EXAMPLE_JOB), 'utf8'));

  function jobFor(argv) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'run', `${argv.join(' | ')}: ${(parsed.errors || []).join('; ')}`);
    const job = buildPrintJob(parsed.request, { cwd: outside });
    assert.equal(job.ok, true, `${argv.join(' | ')}: ${job.errors.join('; ')}`);
    return { parsed, job };
  }

  const quoted = [
    ['layout 3，off-line-showFooterTitle'],
    ['layout 3, off-line-showFooterTitle'],
    ['layout 3，OFF-LINE-SHOWFOOTERTITLE'],
    ['layout 3，off-line-showFooterTitlexyz'],
    ['layout 3，off-lineshowFooterTitle'],
    ['layout 3，off-lineshowFooterTitlexyz'],
    ['layout 3，off--line-showFooterTitle'],
    ['layout 3，off－line－showFooterTitle'],
    ['layout 3，把off-line-showFooterTitle'],
    ['layout 3，请off-line-showFooterTitle'],
    ['layout 3，off-line-setting-footer-title'],
    ['layout 3，off-line-页脚标题'],
    ['layout 3，off-line-在页脚显示字库标题'],
    ['layout 3，off-line-mono'],
    ['layout 3，on-line-黑白省墨'],
    ['layout 3，off-line-showFooterTitle --limit 6'],
    ['run the end-to-end test to generate the PDF, layout 3, off-line-showFooterTitle'],
    ['跑端到端测试生成 PDF，layout 3，off-line-showFooterTitle'],
    ['printer/spec/print-job.example.json，off-line-showFooterTitle'],
  ];
  for (const argv of quoted) {
    const parsed = parseCliArgs(argv, { cwd: outside });
    assert.equal(parsed.mode, 'error', argv.join(' | '));
    assert.equal(parsed.request, undefined, argv.join(' | '));
    assert.match(parsed.errors[0], /hyphen is immediate/, argv.join(' | '));
    assert.match(parsed.errors[0], /not ignored/, argv.join(' | '));
    assert.doesNotMatch(parsed.errors[0], /input not found/, argv.join(' | '));
    assert.doesNotMatch(parsed.errors[0], /no hyphen/, argv.join(' | '));
    if (argv[0].includes('mono') || argv[0].includes('黑白省墨')) {
      assert.match(parsed.errors[0], /box left unchanged/, argv.join(' | '));
    } else {
      assert.match(parsed.errors[0], /footer left on/, argv.join(' | '));
    }
  }

  const separate = buildPrintJob(
    parseCliArgs(['layout', '3', 'off-line-showFooterTitle'], { cwd: outside }).request,
    { cwd: outside },
  );
  assert.equal(separate.ok, false);
  assert.match(separate.errors.join('\n'), /off-line-showFooterTitle/);
  assert.match(separate.errors.join('\n'), /input not found/);
  assert.equal(separate.settings.showFooterTitle, true);
  assert.equal(separate.settings.cols, null);

  const stillLine = jobFor(['layout 3，off-line']);
  assert.equal(stillLine.job.settings.showFooterTitle, true);
  assert.equal(stillLine.job.settings.mono, false);
  assert.equal(stillLine.job.inputDefaulted, true);
  assert.equal(stillLine.job.settings.cols, null);
  const monoWord = jobFor(['layout 3，off-monochrome']);
  assert.equal(monoWord.job.settings.mono, false);
  assert.equal(monoWord.job.settings.showFooterTitle, true);
  assert.equal(monoWord.job.inputDefaulted, true);
  const monoJunk = jobFor(['layout 3，off-line-monochrome']);
  assert.equal(monoJunk.job.settings.mono, false);
  assert.equal(monoJunk.job.settings.showFooterTitle, true);
  assert.equal(monoJunk.job.inputDefaulted, true);
  const shortMono = jobFor(['layout 3，offlinemono']);
  assert.equal(shortMono.job.settings.mono, false);
  assert.equal(shortMono.job.inputDefaulted, true);
  const onlineMono = jobFor(['layout 3，onlinemono']);
  assert.equal(onlineMono.job.settings.mono, false);
  assert.equal(onlineMono.job.inputDefaulted, true);
  const real = jobFor(['layout 3，off-showFooterTitle']);
  assert.equal(real.job.settings.showFooterTitle, false);
  assert.equal(real.job.settings.cols, null);
  assert.equal(real.job.inputDefaulted, true);
  const realMono = jobFor(['layout 3，off-mono']);
  assert.equal(realMono.job.settings.mono, false);
  assert.equal(realMono.job.settings.showFooterTitle, true);
  const inkOn = jobFor(['layout 3，on-黑白省墨']);
  assert.equal(inkOn.job.settings.mono, true);
  assert.equal(inkOn.job.settings.showFooterTitle, true);
  const flag = jobFor(['layout 3，no-mono']);
  assert.equal(flag.job.settings.mono, false);
  assert.equal(flag.job.settings.showFooterTitle, true);

  const oldJunk = parseCliArgs(['layout 3，offline-showFooterTitle'], { cwd: outside });
  assert.equal(oldJunk.mode, 'error');
  assert.match(oldJunk.errors[0], /plus a label/);
  assert.doesNotMatch(oldJunk.errors[0], /hyphen is immediate/);
  const oldGlued = parseCliArgs(['layout 3，offlineshowFooterTitle'], { cwd: outside });
  assert.equal(oldGlued.mode, 'error');
  assert.match(oldGlued.errors[0], /no hyphen/);
  assert.doesNotMatch(oldGlued.errors[0], /hyphen is immediate/);
  const oldPrefix = parseCliArgs(['layout 3，off-showFooterTitlexyz'], { cwd: outside });
  assert.equal(oldPrefix.mode, 'error');
  assert.match(oldPrefix.errors[0], /not a checkbox label/);
  assert.doesNotMatch(oldPrefix.errors[0], /hyphen is immediate/);

  const buried = parseCliArgs(['生成 PDF，off-line-showFooterTitle'], { cwd: outside });
  assert.equal(buried.mode, 'run');
  assert.equal(buried.request.showFooterTitle, undefined);
  const buriedBuilt = buildPrintJob(buried.request, { cwd: outside });
  assert.equal(buriedBuilt.ok, false);
  assert.match(buriedBuilt.errors.join('\n'), /off-line-showFooterTitle/);
  assert.match(buriedBuilt.errors.join('\n'), /input not found/);

  const splitHyphen = parseCliArgs(['layout', '3', 'off', '-', 'showFooterTitle'], { cwd: outside });
  assert.equal(splitHyphen.mode, 'error');
  assert.match(splitHyphen.errors[0], /unknown option/);
  assert.equal(splitHyphen.request, undefined);

  assert.equal(resolveE2eEntry(['--e2e', 'layout 3，off-line-showFooterTitle']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e', 'layout 3，off-line-showFooterTitlexyz']).action, 'print');
  assert.equal(resolveE2eEntry(['--e2e']).action, 'test');

  const beforeFull = existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0;
  const beforeLimited = existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0;
  const refused = spawnSync(process.execPath, [
    SCRIPT, 'layout 3，off-line-showFooterTitle', '--limit', '1',
  ], { cwd: outside, encoding: 'utf8', timeout: 20000 });
  assert.notEqual(refused.status, 0, refused.stdout || refused.stderr);
  const refusedBody = JSON.parse(refused.stdout);
  assert.equal(refusedBody.ok, false);
  assert.match(refusedBody.errors.join('\n'), /off-line-showFooterTitle/);
  assert.match(refusedBody.errors.join('\n'), /hyphen is immediate/);
  assert.match(refusedBody.errors.join('\n'), /does not print with the footer left on/);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);

  const npm = spawnSync('npm', [
    '--prefix', REPO_ROOT, 'run', '--silent', 'test:e2e', '--',
    'layout 3，off-line-showFooterTitle', '--limit', '1', '--dry-run',
  ], { cwd: outside, encoding: 'utf8', timeout: 60000 });
  assert.equal(npm.status, 2, npm.stderr || npm.stdout);
  const npmBody = JSON.parse(npm.stdout);
  assert.equal(npmBody.ok, false);
  assert.match(npmBody.errors.join('\n'), /off-line-showFooterTitle/);
  assert.match(npmBody.errors.join('\n'), /does not print with the footer left on/);
  assert.doesNotMatch(npmBody.errors.join('\n'), /input not found/);
  assert.equal(existsSync(fullOut) ? statSync(fullOut).mtimeMs : 0, beforeFull);
  assert.equal(existsSync(limitedOut) ? statSync(limitedOut).mtimeMs : 0, beforeLimited);
});

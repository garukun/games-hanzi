/**
 * Print-job configuration derived from the workbench itself.
 *
 * Layout defaults and limits come from `layout.js` SPECS — the same numbers the
 * toolbar uses when the user picks 1/2/3/4 characters per page. Agents should
 * read `describePrintConfig()` (CLI `--describe`) instead of hard-coding them.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PER_PAGE_OPTIONS, SPECS, pageCount } from './layout.js';
import { parseDataset } from './schema.js';

export const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
/** Canonical dataset the workbench loads by default and the e2e suite prints. */
export const EXAMPLE_INPUT = 'printer/spec/data/hanzi-1000-v6.json';
/** App-published layout-3 job. A CLI argument, same as `--config`, not a character dataset. */
export const EXAMPLE_JOB = 'printer/spec/print-job.example.json';
/** Agent-generated PDFs. Kept out of printer/e2e/output so tests are not the printer. */
export const DEFAULT_OUTPUT_DIR = join(REPO_ROOT, 'printer', 'output');
/** Absolute entry. Relative `printer/scripts/print-pdf.mjs` only exists from the repo root. */
export const PRINT_SCRIPT = fileURLToPath(new URL('../scripts/print-pdf.mjs', import.meta.url));

export const NPM_FLAG_WARNING =
  'Do not append CLI flags to npm. npm rejects --limit, --output, --config, --describe, and --layout. npm consumes --dry-run; this script then dry-runs and does not write the PDF. Put flags on jobs[].argv. That argv is absolute and works from any cwd, including printer/. A no-flag layout 2 or layout 3 job is `npm --prefix <repo> run --silent print:layout-3` (the app supplies the dataset and Tianzige defaults).';

/** Shown when npm ate `--dry-run` and the script refused to print. */
export const NPM_SWALLOWED_DRY_RUN =
  'npm consumed --dry-run (npm_config_dry_run). No PDF was written. npm still rejects --limit, --output, and --describe unless they follow --; put those flags on jobs[].argv.';

/**
 * npm 12 treats `--dry-run` as its own flag, still runs the script, and does not
 * forward the flag. `npm_config_dry_run=true` is the only signal. Honor it only
 * when this process is the print lifecycle script — a child of `npm test` can
 * inherit the variable and must still be able to write a PDF.
 */
export function npmSwallowedDryRun(env = process.env, scriptPath = process.argv[1]) {
  const dry = env?.npm_config_dry_run;
  if (dry !== 'true' && dry !== '1' && dry !== true) return false;
  const lifecycle = String(env?.npm_lifecycle_script || '');
  if (!lifecycle.includes('print-pdf.mjs')) return false;
  if (!scriptPath) return false;
  return String(scriptPath).split(/[/\\]/).pop() === 'print-pdf.mjs';
}

function shellToken(value) {
  const text = String(value);
  if (text.length > 0 && /^[A-Za-z0-9_./:+@=-]+$/.test(text)) return text;
  const q = "'";
  return q + text.replaceAll(q, q + '"' + q + '"' + q) + q;
}

/**
 * Cwd-independent invocation. `quotedPhrase` is the one-argv form `"layout 3"`.
 * Extra flags belong on this argv, never on the npm script.
 */
export function printInvoke(layout, { quotedPhrase = false, extraArgs = [] } = {}) {
  const layoutArgs = quotedPhrase ? [`layout ${layout}`] : ['layout', String(layout)];
  const argv = [process.execPath, PRINT_SCRIPT, ...layoutArgs, ...extraArgs];
  return {
    argv,
    command: argv.map(shellToken).join(' '),
    npm: `npm --prefix ${shellToken(REPO_ROOT)} run --silent print:layout-${layout}`,
  };
}

/**
 * Chromium `page.pdf()` options. The e2e exporters import this object
 * (`printer/e2e/print.spec.mjs`, `r150l3.spec.mjs`) so CLI output stays the
 * browser Save-to-PDF result, not a reimplemented renderer.
 */
export const PDF_EXPORT = Object.freeze({
  format: 'Letter',
  printBackground: true,
  preferCSSPageSize: true,
});

export function layoutDescriptor(perPage) {
  const spec = SPECS[perPage];
  if (!spec) return null;
  return {
    layout: perPage,
    charsPerPage: perPage,
    description: `${perPage} Chinese character${perPage === 1 ? '' : 's'} per US Letter page`,
    defaults: {
      cols: spec.cols,
      rows: spec.defRows,
      trace: spec.defTrace,
      mono: false,
      showFooterTitle: true,
    },
    limits: {
      cols: { min: spec.minCols, max: spec.maxCols },
      rows: { min: 1, note: 'Upper bound is whatever still fits the page at the chosen column count.' },
      trace: { min: 0, max: 'rows' },
    },
    words: { maxWords: spec.maxWords, budget: spec.budget },
  };
}

/** `layout-3`, `layout_3`, `layout3`, or a bare `3`. Not a filename. */
const JOB_TOKEN = /^(?:layout[-_]?)([1-4])$/i;

/**
 * App-published print jobs. Geometry is not copied here: cols/rows/trace stay
 * omitted so the workbench SPECS apply, the same way the toolbar does.
 */
const LAYOUT_WORD = Object.freeze(['one', 'two', 'three', 'four']);

/**
 * Workbench group label, exactly as `printer/index.html` writes
 * `aria-label="每页字数"` on the 1/2/3/4 字/页 control.
 */
export const WORKBENCH_PER_PAGE_GROUP = '每页字数';

/** Measure-word form of the toolbar button (`3 字/页` → `3个字/页`). Not a filename. */
export function measureWordLayoutLabel(layout) {
  return `${layout}个字/页`;
}

/** Words an agent may say for this layout. Same published job; not filenames. */
export function layoutPhrases(layout) {
  const word = LAYOUT_WORD[layout - 1];
  return [
    `layout ${layout}`,
    workbenchLayoutLabel(layout),
    measureWordLayoutLabel(layout),
    `${WORKBENCH_PER_PAGE_GROUP} ${layout}`,
    `${layout} per page`,
    `${layout} chars per page`,
    `chars per page ${layout}`,
    `${word} per page`,
    `${word} Chinese characters on the page`,
  ];
}

export function publishedPrintJobs() {
  const base = basename(EXAMPLE_INPUT, '.json');
  return PER_PAGE_OPTIONS.map((layout) => ({
    id: `layout-${layout}`,
    layout,
    label: workbenchLayoutLabel(layout),
    phrases: layoutPhrases(layout),
    charsPerPage: layout,
    input: EXAMPLE_INPUT,
    output: `printer/output/${base}-layout-${layout}.pdf`,
    ...printInvoke(layout),
    legacyNpm: `npm --prefix ${shellToken(REPO_ROOT)} run --silent test:e2e -- layout ${layout}`,
    grid: 'omitted; workbench SPECS apply',
    flags: 'Append --limit/--output/--dry-run to argv, not to npm. See NPM_FLAG_WARNING in --describe.',
    ...(layout === 3 ? { config: EXAMPLE_JOB, configArgv: printJobFileArgv() } : {}),
  }));
}

/** Absolute argv for the app-published job file. Works from any cwd. */
export function printJobFileArgv(jobFile = join(REPO_ROOT, EXAMPLE_JOB)) {
  return [process.execPath, PRINT_SCRIPT, jobFile];
}

export function publishedPrintJob(layout) {
  const n = Number(layout);
  return publishedPrintJobs().find((job) => job.layout === n) || null;
}

function unquoteToken(value) {
  const text = String(value).trim();
  const quoted = text.match(/^(['"])(.*)\1$/);
  return quoted ? quoted[2].trim() : text;
}

/** Workbench toolbar label, exactly as `printer/index.html` writes it (`3 字/页`). */
export function workbenchLayoutLabel(layout) {
  return `${layout} 字/页`;
}

function layoutDigit(value) {
  const text = tokenText(value);
  if (/^[1-4]$/.test(text)) return Number(text);
  const zh = { 一: 1, 二: 2, 三: 3, 四: 4 }[text];
  if (zh) return zh;
  const en = LAYOUT_WORD.indexOf(text.toLowerCase());
  return en >= 0 ? en + 1 : null;
}

/** `three` / `三` → `3` so every layout regex can stay digit-based. */
function normalizeNumberWords(text) {
  return text
    .replace(/\b(one|two|three|four)\b/gi, (word) => String(layoutDigit(word)))
    .replace(/[一二三四]/g, (word) => String(layoutDigit(word)));
}

/**
 * Whole-token layout phrases, first match wins. Number words are already digits.
 * A phrase with no count (`chars per page`) does not match; bare `3` is layoutDigit.
 */
const LAYOUT_TOKEN_PATTERNS = [
  [/^layout\s+([1-4])$/i, (m) => Number(m[1])],
  [/^layout\s*[:=]\s*([1-4])$/i, (m) => Number(m[1])],
  [JOB_TOKEN, (m) => Number(m[1])],
  [/^print:layout-([1-4])$/i, (m) => Number(m[1])],
  [/^(?:data-)?per[-\s]?pages?(?:\s*[:=-]\s*|\s+)([1-4])$/i, (m) => Number(m[1])],
  [/^([1-4])[-\s]*per[-\s]?pages?$/i, (m) => Number(m[1])],
  [/^([1-4])\s*字\s*[/\uff0f]\s*页$/, (m) => Number(m[1])],
  [/^每页\s*([1-4])\s*个?\s*字$/, (m) => Number(m[1])],
  [/^([1-4])\s*字\s*每\s*页$/, (m) => Number(m[1])],
  [/^([1-4])\s*个\s*字\s*[/\uff0f]\s*页$/, (m) => Number(m[1])],
  [/^([1-4])\s*个\s*字\s*每\s*页$/, (m) => Number(m[1])],
  [/^(?:每页\s*字数\s*[:=\uff1a]?\s*([1-4])|([1-4])\s*每页\s*字数)$/, (m) => Number(m[1] || m[2])],
  [/^(?:([1-4])\s+)?(?:chinese\s+)?(?:characters?|chars)\s+per\s+pages?(?:\s+([1-4]))?$/i, (m) => (m[1] || m[2] ? Number(m[1] || m[2]) : null)],
  [/^([1-4])\s*(?:chinese\s+)?(?:characters?|chars?)\s*[/\uff0f]\s*pages?$/i, (m) => Number(m[1])],
  [/^(?:([1-4])\s+)?(?:chinese\s+)?(?:characters?|chars?)\s+on\s+(?:the|a|each|every)\s+pages?(?:\s+([1-4]))?$/i, (m) => (m[1] || m[2] ? Number(m[1] || m[2]) : null)],
];

/**
 * Parse a layout phrase. Bare `3` and the workbench's own words are the same
 * published job: `layout 3`, `3 字/页`, `每页3字`, `per-page 3`,
 * `3 per page`, `layout three`, `three Chinese characters on the page`,
 * `3 chars per page`, `chars per page 3`, the measure-word button `3个字/页`,
 * and the workbench group label `每页字数 3`.
 */
export function parseLayoutToken(value) {
  if (value == null || value === '') return null;
  // `layout-3,` and `layout 3,` are the phrase, not a different token.
  const text = normalizeNumberWords(tokenText(value).replace(/\s+/g, ' ').trim());
  if (!text) return null;
  const bare = layoutDigit(text);
  if (bare) return bare;
  for (const [pattern, pick] of LAYOUT_TOKEN_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const layout = pick(match);
    if (layout) return layout;
  }
  return null;
}

/** Incomplete layout wording that is still not a dataset filename. End-anchored so `每页字数 please` is not one phrase. */
const LAYOUT_ATTEMPT = [
  /^layout(?:$|[\s\-_=:]*\d*)$/i,
  /^(?:data-)?per[-\s]?pages?(?:$|[\s\-_=:]*\d*)$/i,
  /^[1-4一二三四]\s*字/,
  /^[1-4一二三四]\s*个\s*字/,
  /^每页(?:\s*字数(?:\s*[:=\uff1a]?\s*\d*)?|\s*\d+|\s*[1-4一二三四]\s*个?\s*字|\s*个?\s*字)?$/,
  /^print:layout(?:$|-\d*)$/i,
];

/** A layout phrase an agent might pass as one argv, not a dataset filename. */
function isLayoutAttempt(token) {
  const text = unquoteToken(token);
  if (!text || /^[1-4]$/.test(text) || /^[一二三四]$/.test(text)) return false;
  if (parseLayoutToken(text) != null) return true;
  return LAYOUT_ATTEMPT.some((pattern) => pattern.test(text));
}

/** Words copied from the old “run the e2e test, layout 3” instruction. Not dataset paths. */
const INSTRUCTION_FILLERS = new Set([
  'a', 'an', 'and', 'app', 'aria-label', 'as', 'browser', 'button', 'buttons', 'call', 'called', 'click', 'clicking',
  'config', 'configuration', 'configurations', 'dataset', 'e2e', 'end', 'end-to-end', 'example', 'file',
  'files', 'for', 'from', 'generate', 'give', 'given', 'giving', 'input', 'json', 'just', 'node', 'npm', 'of', 'option',
  'options', 'or', 'pdf', 'please', 'print', 'run', 'sheet', 'sheets', 'some', 'such', 'suite',
  'test', 'test:e2e', 'tests', 'the', 'then', 'to', 'use', 'using', 'via', 'with', 'workflow', 'workbench',
]);

const LABEL_FRAGMENTS = new Set(['字/页', '字／页', '字', '页', '个', '个字', '每页', '字每页', '每页字数']);

/** Leftover words from `3 per page` / `three Chinese characters on the page`. Not a dataset. */
const LAYOUT_PROSE = new Set([
  'per', 'page', 'pages', 'character', 'characters', 'char', 'chars', 'chinese', 'on', 'each', 'every',
]);

function wordToken(token) {
  if (token == null) return '';
  return tokenText(token).toLowerCase();
}

function isLayoutProse(token) {
  return LAYOUT_PROSE.has(wordToken(token));
}

/**
 * `per page` or `per page 3` starting at tokens[index].
 * That tail is the layout phrase, not a --chars value. `per` alone is not.
 */
function perPageTail(tokens, index) {
  if (wordToken(tokens[index]) !== 'per') return 0;
  const page = wordToken(tokens[index + 1]);
  if (page !== 'page' && page !== 'pages') return 0;
  return tokens[index + 2] != null && layoutDigit(tokens[index + 2]) ? 3 : 2;
}

/** Inline `chars per page 3` is the layout phrase, not a character list. */
function isCharsPerPageValue(value) {
  const text = tokenText(value).replace(/\s+/g, ' ').trim();
  return /^per\s+pages?(?:\s+(?:[1-4]|one|two|three|four|[一二三四]))?$/i.test(text);
}

/**
 * `--chars per page 3` is the layout phrase. parseArgs would otherwise take
 * `per` as the character filter and leave `page` as the dataset filename.
 * A real filter (`--chars 一,二`, `--chars=per`) is left alone.
 */
function shieldCharsPerPage(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (typeof arg === 'string' && /^--chars$/i.test(arg) && perPageTail(argv, i + 1)) {
      out.push('chars');
      continue;
    }
    out.push(arg);
  }
  return out;
}

function isInstructionFiller(token) {
  const text = tokenText(token);
  if (!text || /[/\\.]/.test(text)) return false;
  return INSTRUCTION_FILLERS.has(text.toLowerCase());
}

/** A comma or period left as its own argv after a shell split. Not a dataset. */
function isSentencePunctuation(token) {
  const raw = unquoteToken(token);
  return raw.length > 0 && tokenText(token) === '';
}

function stripResolvedNoise(tokens) {
  return tokens.filter((token) => {
    if (isSentencePunctuation(token)) return false;
    const text = tokenText(token);
    return !isInstructionFiller(token) && !LABEL_FRAGMENTS.has(text);
  });
}

function isPositionalPath(token) {
  return /[/\\.]/.test(unquoteToken(token));
}

function badLayout(shown) {
  return `layout must be 1, 2, 3, or 4 (characters per page), not "${shown}"`;
}

function phraseWindow(text) {
  if (!text || /^[1-4]$/.test(text) || /^[一二三四]$/.test(text)) return null;
  const layout = parseLayoutToken(text);
  if (layout) return { layout };
  if (isLayoutAttempt(text)) {
    return {
      error: `${badLayout(text)}. Say layout 2, layout 3, or ${workbenchLayoutLabel(3)}.`,
    };
  }
  return null;
}

/** `aria-label="每页字数"` copied from the workbench is the group label, not a filename. */
function workbenchWord(token) {
  let text = tokenText(token);
  const attr = text.match(/^aria-label\s*[:=\uff1a]\s*(.+)$/i);
  if (!attr) return text;
  return trimSentencePunct(attr[1].replace(/^["']|["']$/g, ''));
}

function findPhraseSpan(tokens) {
  // "three Chinese characters on the page" is 6 tokens once a quoted sentence is split.
  // A larger join that only starts like a layout (`3 字/页 每行 5`, `3 字/页 please`) is not a
  // failed phrase. Keep searching so the real label can match. Return a layout error
  // only when no smaller window was a layout — `per page` or `每页字数` with no count still fails.
  const max = Math.min(6, tokens.length);
  let deferredError = null;
  for (let size = max; size >= 1; size--) {
    for (let i = 0; i <= tokens.length - size; i++) {
      const parts = tokens.slice(i, i + size).map((token) => workbenchWord(token));
      const joined = parts.join(' ');
      const compact = parts.join('');
      const joinedHit = phraseWindow(joined);
      if (joinedHit?.layout) return { layout: joinedHit.layout, start: i, size };
      if (joinedHit?.error && !deferredError) deferredError = { ...joinedHit, start: i, size };
      if (compact === joined) continue;
      const compactHit = phraseWindow(compact);
      // Compact-only errors (`per`+`page` → `perpage`) are not a phrase the user typed.
      if (compactHit?.layout) return { layout: compactHit.layout, start: i, size };
    }
  }
  return deferredError;
}

function withoutSpan(tokens, span) {
  return tokens.slice(0, span.start).concat(tokens.slice(span.start + span.size));
}

/**
 * `per page` or the workbench group `每页字数` with no count is incomplete.
 * After a real layout it is leftover wording, not a second job.
 */
function isNumberlessLayoutLabelError(hit) {
  if (!hit?.error) return false;
  if (/not "(?:data-)?per[-\s]?pages?"\./i.test(hit.error)) return true;
  return /not "每页\s*字数"\./.test(hit.error);
}

function dropConsumedPhrase(tokens, extra) {
  if (!extra) return tokens;
  if (extra.layout) return withoutSpan(tokens, extra);
  if (extra.error && isNumberlessLayoutLabelError(extra) && Number.isInteger(extra.start) && extra.size) {
    return withoutSpan(tokens, extra);
  }
  return tokens;
}

/** Human wording that names a layout inside one argv, not a dataset filename. */
export const PRINT_INSTRUCTION = 'run the end-to-end test to generate the PDF, layout 3';

/** A layout cue anywhere in a quoted sentence, including a count-less `每页字数` or `layout 5`. */
const LAYOUT_CUES = [
  /[1-4一二三四]\s*个\s*字\s*[/\uff0f]\s*页/,
  /每页\s*字数/,
  /[1-4一二三四]\s*个\s*字\s*每\s*页/,
  /layout\s*[-_:=]?\s*[1-4\u4e00\u4e8c\u4e09\u56db]/i,
  /layout\s*[-_:=]?\s*\d+/i,
  /\blayout\s+(?:one|two|three|four)\b/i,
  /[1-4\u4e00\u4e8c\u4e09\u56db]\s*字\s*[/\uff0f]\s*页/,
  /每页\s*[1-4\u4e00\u4e8c\u4e09\u56db]/,
  /[1-4\u4e00\u4e8c\u4e09\u56db]\s*字\s*每\s*页/,
  /per[-\s]?pages?\s*[-_:=]?\s*[1-4]/i,
  /\b(?:one|two|three|four|[1-4])[-\s]*per[-\s]?pages?\b/i,
  /(?:characters?|chars)\s+per\s+pages?/i,
  /\b(?:one|two|three|four|[1-4])\s*(?:chinese\s+)?(?:characters?|chars?)\s*[/\uff0f]\s*pages?\b/i,
  /\b(?:one|two|three|four|[1-4])\s+(?:chinese\s+)?(?:characters?|chars?)\s+on\s+(?:the|a|each|every)\s+pages?\b/i,
  /\b(?:characters?|chars?)\s+on\s+(?:the|a|each|every)\s+pages?\s+(?:one|two|three|four|[1-4])\b/i,
];

function hasLayoutCue(text) {
  return LAYOUT_CUES.some((pattern) => pattern.test(text));
}

function trimSentencePunct(part) {
  if (!part) return '';
  let text = part.replace(/[,，;；。、！？!?]+$/u, '');
  if (/\.json$/i.test(text)) return text;
  if (/\.$/.test(text) && !/\.[A-Za-z0-9]+$/.test(text)) text = text.replace(/\.$/, '');
  if (/[:：]$/.test(text) && !/layout[:：][1-4\u4e00\u4e8c\u4e09\u56db]$/i.test(text)) text = text.replace(/[:：]$/, '');
  return text;
}

/** Unquote and drop trailing sentence punctuation, so a split argv `PDF,` is `PDF`. */
function tokenText(token) {
  return trimSentencePunct(unquoteToken(token));
}

const INSTRUCTION_BREAK = /[\s,，;；。、！？!?]+/;

function splitInstruction(text) {
  return text
    .split(INSTRUCTION_BREAK)
    .map((part) => trimSentencePunct(part.replace(/^[("“‘']+/, '').replace(/[)"”’']+$/u, '')))
    .filter(Boolean);
}

function embedsDatasetPath(text) {
  return text.includes('print-job.example.json') || /\.json\b/i.test(text);
}

/**
 * A quoted human instruction is one argv. Split it so phrase detection can see
 * `layout 3` across words. A token with no spaces stays a filename or a layout
 * token. A sentence with no layout cue and no dataset path stays one filename.
 */
function expandInstructionPositionals(positionals) {
  const tokens = [];
  let expanded = false;
  for (const token of positionals) {
    const text = unquoteToken(token);
    const splittable = INSTRUCTION_BREAK.test(text) && parseLayoutToken(text) == null;
    const instruction = splittable && (hasLayoutCue(text) || instructionHasCheckbox(text) || (embedsDatasetPath(text) && (
      text.includes('print-job.example.json')
      || splitInstruction(text).some((part) => isInstructionFiller(part))
    )));
    if (!instruction) {
      tokens.push(token);
      continue;
    }
    expanded = true;
    tokens.push(...splitInstruction(text));
  }
  return { tokens, expanded };
}

const CN_NUMBERS = {
  一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6',
  七: '7', 八: '8', 九: '9', 十: '10', 十一: '11', 十二: '12',
};

function configNumberToken(token) {
  const text = tokenText(token);
  if (/^\d+$/.test(text)) return text;
  return CN_NUMBERS[text] || null;
}

/** Quoted-instruction flags and node:util parseArgs, one row each. Not filenames.
 * Columns: name, parseArgs type, short, extra, key override.
 * extra is 'int', a boolean flag value, 'skip', or 'skip-value'.
 * A null type is recognized only inside a quoted instruction (setting-* and npm --silent/--prefix).
 */
const CLI_OPTS = [
  ['input', 'string', 'i'],
  ['layout', 'string', 'l'],
  ['job', 'string'],
  ['per-page', 'string'],
  ['cols', 'string', null, 'int'],
  ['rows', 'string', null, 'int'],
  ['trace', 'string', null, 'int'],
  ['range', 'string'],
  ['limit', 'string', null, 'int'],
  ['chars', 'string'],
  ['output', 'string', 'o'],
  ['config', 'string'],
  ['mono', 'boolean', null, true],
  ['no-mono', 'boolean', null, false, 'mono'],
  ['footer-title', 'boolean', null, true],
  ['no-footer-title', 'boolean', null, false, 'footer-title'],
  ['setting-mono', null, null, true, 'mono'],
  ['setting-footer-title', null, null, true, 'footer-title'],
  ['strict', 'boolean', null, true],
  ['dry-run', 'boolean', null, true],
  ['describe', 'boolean', null, true],
  ['help', 'boolean', 'h', true],
  ['silent', null, null, 'skip'],
  ['e2e', 'boolean', null, 'skip'],
  ['prefix', null, null, 'skip-value'],
];

const DASHED_OPTIONS = {};
const PARSE_OPTIONS = {};
for (const [name, type, short, extra, key] of CLI_OPTS) {
  if (type) PARSE_OPTIONS[name] = short ? { type, short } : { type };
  let spec;
  if (extra === 'skip' || extra === 'skip-value') {
    spec = { skip: true };
    if (extra === 'skip-value') spec.takesValue = true;
  } else {
    spec = { key: key || name };
    if (extra === 'int') spec.kind = 'int';
    if (extra === true || extra === false) {
      spec.flag = true;
      spec.value = extra;
    }
  }
  DASHED_OPTIONS[`--${name}`] = spec;
  if (short) DASHED_OPTIONS[`-${short}`] = spec;
}

const INT_BARE = [
  ['cols', 'cols'],
  ['rows', 'rows'],
  ['trace', 'trace'],
  ['limit', 'limit'],
  ['每行', 'cols'],
  ['总行', 'rows'],
  ['描红', 'trace'],
];

const TEXT_BARE = [
  ['range', 'range', 'range'],
  ['序号', 'range', 'range'],
  ['选取', 'range', 'range'],
  ['output', 'output', 'output'],
  ['chars', 'chars', 'chars'],
];

const BOOL_BARE = [
  ['mono', 'mono', true],
  ['no-mono', 'mono', false],
  ['strict', 'strict', true],
  ['dry-run', 'dry-run', true],
  ['黑白省墨', 'mono', true],
  ['页脚标题', 'footer-title', true],
  ['footer-title', 'footer-title', true],
  ['footerTitle', 'footer-title', true],
  ['show-footer-title', 'footer-title', true],
  ['showFooterTitle', 'footer-title', true],
  ['setting-mono', 'mono', true],
  ['setting-footer-title', 'footer-title', true],
];

/** Values written after a workbench checkbox. A path or any other word is not one. */
const CHECKBOX_WORD_VALUES = Object.freeze({
  true: true,
  false: false,
  1: true,
  0: false,
  yes: true,
  no: false,
  on: true,
  off: false,
  checked: true,
  unchecked: false,
  是: true,
  否: false,
  开: true,
  关: false,
  开启: true,
  关闭: false,
});

function isCheckboxKey(key) {
  return key === 'mono' || key === 'footer-title';
}

function checkboxPositiveFlag(key) {
  return key === 'mono' ? '--mono' : '--footer-title';
}

function checkboxNegativeFlag(key) {
  return key === 'mono' ? '--no-mono' : '--no-footer-title';
}

function checkboxFlagFor(key, on) {
  return on ? checkboxPositiveFlag(key) : checkboxNegativeFlag(key);
}

/** `false`, `off,`, `关` → boolean. Not a dataset filename. */
function checkboxWordValue(token) {
  if (token == null) return null;
  const text = tokenText(token);
  if (!text || /[/\\.]/.test(text)) return null;
  if (Object.prototype.hasOwnProperty.call(CHECKBOX_WORD_VALUES, text)) return CHECKBOX_WORD_VALUES[text];
  const lower = text.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(CHECKBOX_WORD_VALUES, lower)) return CHECKBOX_WORD_VALUES[lower];
  return null;
}

function checkboxWordError(label, raw, { negative = false, key = 'footer-title' } = {}) {
  if (negative) {
    return `${label} does not turn the box on. Pass ${checkboxPositiveFlag(key)} to check it.`;
  }
  return `${label} must be true or false (or on/off), not "${raw}". Use ${checkboxNegativeFlag(key)} to uncheck.`;
}

/**
 * Title attributes on the same checkboxes (`printer/index.html`). A verb may
 * precede them. A bare title is not a check — the span and id are.
 */
const CHECKBOX_TITLE_LABELS = Object.freeze([
  ['在页脚显示字库标题', 'footer-title'],
  ['切换黑白省墨打印模式', 'mono'],
]);

/**
 * A word before the workbench label sets that box. Longest first so
 * `关闭页脚标题` is 关闭, not 关, and `unchecked` is not `uncheck`.
 * Digits are not verbs: `1` is a layout. A bare 关闭 is not a value.
 */
const CHECKBOX_LEADING = Object.freeze([
  ['取消勾选', false],
  ['不勾选', false],
  ['不显示', false],
  ['unchecked', false],
  ['uncheck', false],
  ['disable', false],
  ['checked', true],
  ['enable', true],
  ['关闭', false],
  ['关掉', false],
  ['开启', true],
  ['打开', true],
  ['勾选', true],
  ['显示', true],
  ['false', false],
  ['true', true],
  ['check', true],
  ['off', false],
  ['yes', true],
  ['no', false],
  ['on', true],
  ['关', false],
  ['开', true],
  ['否', false],
  ['是', true],
].sort((a, b) => b[0].length - a[0].length));

/** `turn off` / `请 关闭` are one verb when a label follows. Not a filename. */
const CHECKBOX_VERB_GLUE = new Set(['turn', 'switch', 'toggle', '请', '把', '将']);

/** `把` / `将` / `turn` introduce the label; the verb comes after it. Longest first. */
const OBJECT_VERB_MARKERS = Object.freeze(['请把', '请将', '把', '将', 'turn', 'switch', 'toggle']);

/** Workbench checkbox id or title. A path-like token is not a label. Titles are included; every caller needs them. */
function checkboxLabelMatch(text) {
  const trimmed = tokenText(text ?? '');
  if (!trimmed || /[/\\.]/.test(trimmed)) return null;
  for (const [name, key, value] of BOOL_BARE) {
    if (!isCheckboxKey(key) || value !== true) continue;
    if (trimmed.toLowerCase() === name.toLowerCase()) return { name, key };
  }
  for (const [name, key] of CHECKBOX_TITLE_LABELS) {
    if (trimmed === name) return { name, key };
  }
  return null;
}

/** The published bare flag. Not `no` plus the `mono` label. */
function isPublishedNegationWord(text) {
  return tokenText(text ?? '').toLowerCase() === 'no-mono';
}

/** ASCII hyphen, en dash, em dash, and fullwidth hyphen. Same set every checkbox phrase uses. */
const HYPHENS = '-\u2013\u2014\uFF0D';
const LABEL_EDGE = /[\s:=\uff1a\uff0c,]/;
/** Space, colon, or comma between a label and the next word. A hyphen is not one; see LABEL_VERB_SEP. */
const WORD_SEP = /^[\s:=：，,]+/;

function isHyphenChar(ch) {
  return HYPHENS.includes(ch);
}

function startsWithHyphen(text) {
  return text.length > 0 && isHyphenChar(text[0]);
}

function hyphenIndex(text) {
  for (let i = 0; i < text.length; i++) {
    if (isHyphenChar(text[i])) return i;
  }
  return -1;
}

/** A space, colon, comma, or hyphen at either end of a remainder. `mono` needs one so `monochrome` is not a label. */
function hasLabelEdge(text, atEnd = false) {
  if (!text) return false;
  const ch = atEnd ? text[text.length - 1] : text[0];
  return LABEL_EDGE.test(ch) || isHyphenChar(ch);
}

/** First matching checkbox verb that is a proper prefix, not the verb alone. */
function forLeadingVerbs(text, fn) {
  const lower = text.toLowerCase();
  for (const [verb] of CHECKBOX_LEADING) {
    const verbLower = verb.toLowerCase();
    if (!lower.startsWith(verbLower) || lower.length === verbLower.length) continue;
    const hit = fn(verb, text.slice(verb.length));
    if (hit) return hit;
  }
  return null;
}

const OBJECT_MARKER_PREFIX = /^(?:请把|请将|请|把|将)/;

function plainCheckboxToken(text) {
  const trimmed = tokenText(text ?? '');
  if (!trimmed || /[/\\.]/.test(trimmed) || trimmed.startsWith('-')) return null;
  return trimmed;
}

/** Try the body, then the same text with a leading 把 / 请 marker stripped. */
function withMarkerStripped(text, body) {
  const trimmed = plainCheckboxToken(text);
  if (!trimmed) return null;
  const direct = body(trimmed);
  if (direct) return direct;
  const stripped = trimmed.replace(OBJECT_MARKER_PREFIX, '');
  if (!stripped || stripped === trimmed) return null;
  return body(stripped);
}

function quotedCheckboxMiss(token, near, diagnosis, use) {
  const shown = tokenText(token);
  const left = near.key === 'footer-title'
    ? 'does not print with the footer left on'
    : 'does not print with the box left unchanged';
  return `${shown} ${diagnosis}, so ${near.key} is not left unchanged. A quoted layout 3，${shown} ${left}. Use ${use} or ${checkboxNegativeFlag(near.key)}.`;
}

/** Hyphen(s) before a label: `off-showFooterTitle`, `关闭-页脚标题`. Not `offline`. */
function hyphenBeforeLabel(rest) {
  const text = String(rest ?? '');
  let i = 0;
  while (i < text.length && isHyphenChar(text[i])) i += 1;
  if (i === 0 || i === text.length) return null;
  return text.slice(i);
}

function leadingCheckboxVerb(token) {
  const raw = plainCheckboxToken(token);
  if (!raw) return null;
  const stripped = raw.replace(OBJECT_MARKER_PREFIX, '');
  const candidates = stripped && stripped !== raw ? [stripped, raw] : [raw];
  for (const text of candidates) {
    // Exact `no-mono` is the flag. A hyphen before another label is not that flag.
    if (isPublishedNegationWord(text)) continue;
    const lower = text.toLowerCase();
    for (const [verb, on] of CHECKBOX_LEADING) {
      const verbLower = verb.toLowerCase();
      if (lower === verbLower) return { on, rest: '', verb };
      if (!lower.startsWith(verbLower)) continue;
      let rest = text.slice(verb.length);
      const sep = rest.match(WORD_SEP);
      if (sep) rest = rest.slice(sep[0].length);
      else {
        const afterHyphen = hyphenBeforeLabel(rest);
        if (afterHyphen != null) {
          // `off-showFooterTitle` is the verb plus a label. `offline` has no hyphen.
          // `off-line` is not a label. Exact `no-mono` was skipped above.
          if (!checkboxLabelMatch(afterHyphen)) continue;
          rest = afterHyphen;
        } else if (/^[A-Za-z]/.test(verb) && /^[A-Za-z-]/.test(rest)) {
          // `offline` is not off plus a label. A glued id is `offshowFooterTitle`.
          if (!checkboxLabelMatch(rest)) continue;
        }
      }
      if (rest) return { on, rest, verb };
    }
  }
  return null;
}

function checkboxVerbConflict(key, verb, raw) {
  return `conflicting ${key} values: ${verb}, ${tokenText(raw)}`;
}

/** Verb then label (`关闭页脚标题`, `off-showFooterTitle`). A bare verb is left alone. A following boolean must agree. */
function takeLeadingCheckbox(tokens, index) {
  const head = tokenText(tokens[index] ?? '').toLowerCase();
  let glue = 0;
  let verbAt = index;
  if (CHECKBOX_VERB_GLUE.has(head)) {
    glue = 1;
    verbAt = index + 1;
    if (tokens[verbAt] == null) return null;
  }
  const hit = leadingCheckboxVerb(tokens[verbAt]);
  if (!hit) return null;
  const label = hit.rest
    ? checkboxLabelMatch(hit.rest)
    : checkboxLabelMatch(tokens[verbAt + 1]);
  if (!label) return null;
  const valueAt = hit.rest ? verbAt + 1 : verbAt + 2;
  const word = checkboxWordValue(tokens[valueAt]);
  if (word != null && word !== hit.on) {
    return { error: checkboxVerbConflict(label.key, hit.verb, tokens[valueAt]) };
  }
  const labelTokens = hit.rest ? 1 : 2;
  return {
    key: label.key,
    value: hit.on,
    consumed: glue + labelTokens + (word == null ? 0 : 1),
  };
}

function checkboxLabelNames() {
  const names = [];
  for (const [name, key, value] of BOOL_BARE) {
    if (isCheckboxKey(key) && value === true) names.push(name);
  }
  for (const [name] of CHECKBOX_TITLE_LABELS) names.push(name);
  return names.sort((a, b) => b.length - a.length);
}

/** A token that is only the verb (`关闭`, `off`), not `关闭面板` or a label. */
function pureCheckboxVerb(token) {
  const hit = leadingCheckboxVerb(token);
  if (!hit || hit.rest) return null;
  return hit;
}

/** Space, colon, comma, or hyphen between a label and the verb after it. The hyphen inside `setting-footer-title` is matched first. */
const LABEL_VERB_SEP = /^[\s:=：，,\-]+/;

/** Longest checkbox label that is a proper prefix. `fn(name, nameLower, rest)` returns the first hit. */
function forLabelPrefixes(text, fn) {
  const trimmed = plainCheckboxToken(text);
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  for (const name of checkboxLabelNames()) {
    const nameLower = name.toLowerCase();
    if (lower.length <= nameLower.length || !lower.startsWith(nameLower)) continue;
    const hit = fn(name, nameLower, trimmed.slice(name.length));
    if (hit) return hit;
  }
  return null;
}

function splitLabelSep(rest) {
  const sep = rest.match(LABEL_VERB_SEP);
  return sep ? { hadSep: true, rest: rest.slice(sep[0].length) } : { hadSep: false, rest };
}

/** Label plus a verb (`页脚标题关闭`, `showFooterTitle-off`). `showFooterTitle-offline` is not a verb. */
function labelVerbSuffix(text) {
  return forLabelPrefixes(text, (name, _nameLower, rawRest) => {
    const { rest } = splitLabelSep(rawRest);
    if (!rest) return null;
    const verb = pureCheckboxVerb(rest);
    if (!verb) return null;
    const label = checkboxLabelMatch(name);
    if (!label) return null;
    return { key: label.key, value: verb.on, verb: verb.verb };
  });
}

/** A remainder that tried to set the box but is not exactly a checkbox verb. */
function failedCheckboxVerb(rest) {
  if (!rest) return false;
  if (checkboxWordValue(rest) != null) return true;
  const lower = rest.toLowerCase();
  for (const [verb] of CHECKBOX_LEADING) {
    const verbLower = verb.toLowerCase();
    if (lower.startsWith(verbLower) && lower.length > verb.length) return true;
  }
  return false;
}

/** Label plus a non-verb (`showFooterTitle-offline`). `mono` needs a separator so `monochrome` is not this. */
function labelNonVerbBody(text) {
  const trimmed = plainCheckboxToken(text);
  if (!trimmed || labelVerbSuffix(trimmed)) return null;
  return forLabelPrefixes(trimmed, (name, nameLower, rawRest) => {
    const { hadSep, rest } = splitLabelSep(rawRest);
    if (rest && pureCheckboxVerb(rest)) return null;
    // `mono` is a prefix of ordinary words (`monochrome`). Longer labels are ids.
    if (!(hadSep || failedCheckboxVerb(rest) || (nameLower !== 'mono' && rest))) return null;
    const label = checkboxLabelMatch(name);
    if (!label) return null;
    return { key: label.key, name, rest };
  });
}

/** Label plus a non-verb, including `把` / `请` glued in front. Not a filename when a quoted instruction would drop it. */
function labelNonVerbAttempt(text) {
  const trimmed = plainCheckboxToken(text);
  if (!trimmed) return null;
  const direct = labelNonVerbBody(trimmed);
  if (direct) return direct;
  if (trimmed.startsWith('请') && trimmed.length > 1) {
    const rest = trimmed.slice(1).replace(WORD_SEP, '');
    const viaPlease = rest ? labelNonVerbBody(rest) : null;
    if (viaPlease) return viaPlease;
  }
  const marked = objectVerbMarker(trimmed);
  if (marked?.rest) return labelNonVerbBody(marked.rest);
  return null;
}

/**
 * Quoted verb-first near-miss. `hyphen-non-label` is not gated on openVerbJunk:
 * that gate calls this kind. A Chinese verb can have a non-label rest
 * (`关闭面板-页脚标题`); that is junk-hyphen, not hyphen-non-label.
 */
function verbFirstMiss(text, kind) {
  if (!text || isPublishedNegationWord(text)) return null;
  if (kind === 'hyphen-non-label') {
    if (leadingCheckboxVerb(text)?.rest) return null;
  } else if (!openVerbJunk(text)) {
    return null;
  } else if (kind === 'no-hyphen' && (verbJunkHyphenLabelBody(text) || labelNonVerbBody(text))) {
    return null;
  } else if (
    kind === 'immediate-hyphen'
    && (verbJunkHyphenLabelBody(text) || verbJunkNoHyphenLabelBody(text) || labelNonVerbBody(text))
  ) {
    return null;
  }
  return forLeadingVerbs(text, (verb, afterVerb) => {
    if (kind === 'hyphen-non-label') {
      const after = hyphenBeforeLabel(afterVerb);
      if (after == null || checkboxLabelMatch(after)) return null;
      // Longer than the label (`off-showFooterTitlexyz`). An exact label is the real phrase.
      const label = labelAttemptAfterHyphen(after);
      if (!label || label.name.length >= after.length) return null;
      return { key: label.key, name: label.name, rest: after.slice(label.name.length) };
    }
    if (kind === 'junk-hyphen') {
      // Immediate hyphen is the real phrase, `off-line`, or immediate-hyphen junk.
      if (startsWithHyphen(afterVerb)) return null;
      const hyphenAt = hyphenIndex(afterVerb);
      if (hyphenAt <= 0) return null;
      const afterHyphen = hyphenBeforeLabel(afterVerb.slice(hyphenAt));
      const attempt = afterHyphen && labelAttemptAfterHyphen(afterHyphen);
      if (!attempt) return null;
      return { key: attempt.key, name: attempt.name, verb, rest: afterVerb.slice(0, hyphenAt) };
    }
    if (kind === 'no-hyphen') {
      if (startsWithHyphen(afterVerb)) return null;
      const attempt = labelInsideRemainder(afterVerb);
      if (!attempt) return null;
      return { key: attempt.key, name: attempt.name, verb, rest: attempt.before || attempt.after };
    }
    if (!startsWithHyphen(afterVerb)) return null;
    const afterHyphen = hyphenBeforeLabel(afterVerb);
    if (!afterHyphen || checkboxLabelMatch(afterHyphen)) return null;
    const attempt = labelInsideRemainder(afterHyphen);
    if (!attempt?.before) return null;
    return { key: attempt.key, name: attempt.name, verb, rest: attempt.before };
  });
}

/** `off-showFooterTitlexyz`. `offline` has no hyphen. Exact `no-mono` is the flag. */
function leadingHyphenNonLabelBody(text) {
  return verbFirstMiss(text, 'hyphen-non-label');
}

/** A label, or a longer word that starts with one, after a hyphen. `mono` is too short for `monochrome`. */
function labelAttemptAfterHyphen(suffix) {
  const exact = checkboxLabelMatch(suffix);
  if (exact) return exact;
  return forLabelPrefixes(suffix, (name, nameLower, extra) => {
    if (nameLower === 'mono' && !hasLabelEdge(extra)) return null;
    return checkboxLabelMatch(name);
  });
}

/** Published phrase: a verb then an actual label (`off-showFooterTitle`, `关闭-页脚标题`). */
function realLeadingCheckbox(text) {
  const hit = leadingCheckboxVerb(text);
  // Chinese verbs return a rest even when it is not a label (`关闭面板-页脚标题`).
  // Only an actual label is the published phrase (`关闭-页脚标题`, `off-showFooterTitle`).
  return Boolean(hit?.rest && checkboxLabelMatch(hit.rest));
}

/** A verb-first token that is not already a published checkbox phrase. */
function openVerbJunk(text) {
  if (!text || isPublishedNegationWord(text)) return false;
  return !realLeadingCheckbox(text) && !leadingHyphenNonLabelBody(text) && !labelVerbSuffix(text);
}

/** `offline-showFooterTitle`. Immediate hyphen is not this; `off-line` stays a filename. */
function verbJunkHyphenLabelBody(text) {
  return verbFirstMiss(text, 'junk-hyphen');
}

/** A workbench label inside a remainder, not the exact label. `mono` needs a delimiter so `offmonochrome` is not a failed label. */
function labelInsideRemainder(rest) {
  if (!rest) return null;
  const lower = rest.toLowerCase();
  for (const name of checkboxLabelNames()) {
    const nameLower = name.toLowerCase();
    const at = lower.indexOf(nameLower);
    if (at < 0) continue;
    const extraBefore = rest.slice(0, at);
    const extraAfter = rest.slice(at + name.length);
    if (!extraBefore && !extraAfter) continue;
    if (nameLower === 'mono') {
      const beforeOk = extraBefore === '' || hasLabelEdge(extraBefore, true);
      const afterOk = extraAfter === '' || hasLabelEdge(extraAfter);
      if (!beforeOk || !afterOk) continue;
    }
    const label = checkboxLabelMatch(name);
    if (!label) continue;
    return { key: label.key, name: label.name, before: extraBefore, after: extraAfter };
  }
  return null;
}

/** `offlineshowFooterTitle`. A hyphen after the verb is junk-hyphen or immediate-hyphen, not this. */
function verbJunkNoHyphenLabelBody(text) {
  return verbFirstMiss(text, 'no-hyphen');
}

/** `off-line-showFooterTitle`. The hyphen is immediate, then junk, then the label. */
function verbImmediateHyphenJunkLabelBody(text) {
  return verbFirstMiss(text, 'immediate-hyphen');
}

function objectVerbMarker(token) {
  const text = plainCheckboxToken(token);
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const marker of OBJECT_VERB_MARKERS) {
    if (lower === marker) return { rest: '', marker };
    if (!lower.startsWith(marker)) continue;
    const rest = text.slice(marker.length).replace(WORD_SEP, '');
    if (!rest) return { rest: '', marker };
    // `turn off` is glue plus a verb, not `turn` plus a label. Chinese markers have no word boundary.
    if (/^[A-Za-z]/.test(marker) && /^[A-Za-z]/.test(rest)) continue;
    return { rest, marker };
  }
  return null;
}

/** A label with the verb glued on, or the verb in the next token. verbOffset is 1 when the verb is separate. */
function labelThenVerb(labelText, nextVerbToken) {
  const inline = labelText ? labelVerbSuffix(labelText) : null;
  if (inline) return { hit: inline, verbOffset: 0 };
  const label = checkboxLabelMatch(labelText);
  const verb = pureCheckboxVerb(nextVerbToken);
  if (!label || !verb) return null;
  return { hit: { key: label.key, value: verb.on, verb: verb.verb }, verbOffset: 1 };
}

function agreeingCheckboxValue(tokens, index, on, key, verb) {
  const word = checkboxWordValue(tokens[index]);
  if (word == null) return { extra: 0 };
  if (word !== on) return { error: checkboxVerbConflict(key, verb, tokens[index]) };
  return { extra: 1 };
}

/** Phrase plus a following boolean that must agree. `consumed` does not include that word. */
function agreedCheckbox(tokens, hit, verbAt, consumed) {
  const agree = agreeingCheckboxValue(tokens, verbAt, hit.value, hit.key, hit.verb);
  if (agree.error) return agree;
  return { key: hit.key, value: hit.value, consumed: consumed + agree.extra };
}

/** Marker, label, then verb (`把页脚标题关闭`). A marker with no verb is left alone. A following boolean must agree. */
function takeBaCheckbox(tokens, index) {
  let i = index;
  let prefix = 0;
  const head = tokenText(tokens[i] ?? '');
  if (head === '请') {
    if (tokens[i + 1] == null || !objectVerbMarker(tokens[i + 1])) return null;
    prefix = 1;
    i += 1;
  }
  const marked = objectVerbMarker(tokens[i]);
  if (!marked) return null;
  const taken = marked.rest
    ? labelThenVerb(marked.rest, tokens[i + 1])
    : labelThenVerb(tokens[i + 1], tokens[i + 2]);
  if (!taken) return null;
  const verbAt = (marked.rest ? i + 1 : i + 2) + taken.verbOffset;
  return agreedCheckbox(tokens, taken.hit, verbAt, prefix + (verbAt - i));
}

/** Label then verb (`页脚标题关闭`, `showFooterTitle-off`). A non-verb is labelNonVerbAttempt, not this. A following boolean must agree. */
function takeLabelVerb(tokens, index) {
  const text = plainCheckboxToken(tokens[index]);
  if (!text) return null;
  if (text.startsWith('请') && text.length > 1) {
    const rest = text.slice(1).replace(WORD_SEP, '');
    const inline = rest ? labelVerbSuffix(rest) : null;
    if (inline) return agreedCheckbox(tokens, inline, index + 1, 1);
  }
  if (text === '请') {
    const taken = labelThenVerb(tokens[index + 1], tokens[index + 2]);
    if (!taken) return null;
    return agreedCheckbox(tokens, taken.hit, index + 2 + taken.verbOffset, 2 + taken.verbOffset);
  }
  const taken = labelThenVerb(text, tokens[index + 1]);
  if (!taken) return null;
  return agreedCheckbox(tokens, taken.hit, index + 1 + taken.verbOffset, 1 + taken.verbOffset);
}

function takeCheckboxPhrase(tokens, index) {
  return takeLeadingCheckbox(tokens, index) || takeBaCheckbox(tokens, index) || takeLabelVerb(tokens, index);
}

/** A quoted `把 页脚标题 关闭`, `关闭 页脚标题`, or `页脚标题关闭` is the checkbox, not one filename. */
function instructionHasCheckbox(text) {
  if (!INSTRUCTION_BREAK.test(text)) return false;
  const parts = rewriteSplitLabelHyphens(splitInstruction(text), { verbsOnly: true });
  return parts.some((_, index) => takeCheckboxPhrase(parts, index));
}

function checkboxAssignment(text, name) {
  if (text.length <= name.length) return null;
  if (text.slice(0, name.length).toLowerCase() !== name.toLowerCase()) return null;
  const rest = text.slice(name.length);
  if (!/^[=:：]/.test(rest)) return null;
  return rest.replace(/^[=:：]\s*/, '');
}

/**
 * A word on a checkbox flag. `optional` is a following argv: a non-word is left alone.
 * An attached non-word on a negative flag does not take a value. On a positive flag it
 * must be true or false. Bare `no-mono=maybe` is not this path.
 * @returns {{ value: boolean } | { error: string } | null}
 */
function readCheckboxFlagValue(label, key, flagOn, raw, { optional = false } = {}) {
  const word = checkboxWordValue(raw);
  if (word == null) {
    if (optional) return null;
    if (!flagOn) {
      return { error: `${label} does not take a value. To check the box, pass ${checkboxPositiveFlag(key)}.` };
    }
    return { error: checkboxWordError(label, raw, { key }) };
  }
  if (!flagOn && word === true) {
    return { error: checkboxWordError(label, raw, { negative: true, key }) };
  }
  return { value: flagOn ? word : false };
}

/** `--mono`, `--no-mono`, `--setting-footer-title`, with or without `=value`. */
const CHECKBOX_FLAG_ARG = /^(--(?:no-|setting-)?)(mono|footer-title)(?:=(.*))?$/i;

/**
 * Node's parseArgs rejects `--footer-title=false` and leaves a following `false`
 * as a filename while checking the box. Rewrite those to `--no-footer-title` /
 * `--no-mono` before parseArgs. A token with whitespace is a quoted instruction.
 * A bare `false` is not rewritten.
 */
function rewriteCheckboxFlags(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const match = typeof arg === 'string' && !/\s/.test(arg) ? arg.match(CHECKBOX_FLAG_ARG) : null;
    if (!match) {
      out.push(arg);
      continue;
    }
    const key = match[2].toLowerCase();
    const negative = match[1].toLowerCase().startsWith('--no-');
    const attached = match[3];
    const hasValue = attached !== undefined;
    const label = negative ? `--no-${key}` : (hasValue ? arg.slice(0, arg.indexOf('=')) : arg);
    const read = readCheckboxFlagValue(label, key, !negative, hasValue ? attached : argv[i + 1], {
      optional: !hasValue,
    });
    if (read?.error) return read;
    const on = read ? (negative ? false : read.value) : !negative;
    out.push(checkboxFlagFor(key, on));
    if (read && !hasValue) i += 1;
  }
  return { argv: out };
}

function dashedOption(head) {
  return DASHED_OPTIONS[head] || DASHED_OPTIONS[head.toLowerCase()] || null;
}

/** Dash, tilde, comma, colon, or 到/至 stuck to a range endpoint. */
const RANGE_GAP = '-－–—~～到至,:\uff0c';
const RANGE_PARTIAL = new RegExp(`^(\\d+)\\s*([${RANGE_GAP}])$`);
const RANGE_STUCK = new RegExp(`^([${RANGE_GAP}])\\s*(\\d+)$`);

/** Workbench 序号 picker. `1到12` and a split `1 - 12` are the same --range value. */
function normalizeRangeToken(value) {
  const text = tokenText(value).replace(/[－–—~～到至]/g, '-');
  const match = text.match(/^(\d+)\s*[-:,，]\s*(\d+)$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}

function isRangeDash(token) {
  const text = tokenText(token);
  return text === '-' || text === '–' || text === '—' || text === '－'
    || text === '~' || text === '～' || text === ',' || text === '，'
    || text === '到' || text === '至';
}

function isWorkbenchRangeLabel(name) {
  return name === '序号' || name === '选取';
}

function rangeExpect(name, value) {
  const shown = value == null || value === '' ? '(missing)' : value;
  return `${name} is the workbench 序号 picker, same as --range. Expected 1-12 or 1 - 12, not "${shown}".`;
}

function looksLikeRangeAttempt(token) {
  if (token == null) return false;
  const text = tokenText(token);
  if (!text) return false;
  if (isRangeDash(token)) return true;
  if (configNumberToken(text) != null || normalizeRangeToken(text)) return true;
  return /^\d/.test(text);
}

/**
 * A range value starting at `tokens[start]`. The toolbar writes the hyphen as its
 * own word (`1 - 12`); a stuck `1-` / `-12` and `1到12` are the same picker.
 */
function takeRangeTokens(tokens, start) {
  const first = tokens[start];
  if (first == null) return null;
  const firstText = tokenText(first);
  const whole = normalizeRangeToken(firstText);
  if (whole) return { value: whole, consumed: 1 };

  const second = tokens[start + 1];
  const partial = firstText.match(RANGE_PARTIAL);
  if (partial && second != null) {
    const end = configNumberToken(tokenText(second));
    if (end) return { value: `${partial[1]}-${end}`, consumed: 2 };
  }

  const startNum = configNumberToken(firstText);
  if (startNum == null || second == null) return null;
  const secondText = tokenText(second);
  const stuck = secondText.match(RANGE_STUCK);
  if (stuck) return { value: `${startNum}-${stuck[2]}`, consumed: 2 };
  if (!isRangeDash(second)) return null;
  const third = tokens[start + 2];
  if (third == null) return null;
  const end = configNumberToken(tokenText(third));
  if (!end) return null;
  return { value: `${startNum}-${end}`, consumed: 3 };
}

function rangeHead(token) {
  const text = tokenText(token);
  const match = text.match(/^(--range|range|序号|选取)(?=$|[\s:=：，,])/i);
  if (!match) return null;
  const inline = text.slice(match[1].length).replace(WORD_SEP, '');
  return { name: match[1], inline: inline || null };
}

/**
 * Join the toolbar hyphen (`序号 1 - 12`, `--range 1 - 12`) before parseArgs sees `-`
 * as an unknown option. A value that is already one token is left alone.
 */
export function joinSplitRanges(tokens) {
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const head = rangeHead(tokens[i]);
    out.push(tokens[i]);
    i += 1;
    if (!head || head.inline) continue;
    const taken = takeRangeTokens(tokens, i);
    if (!taken || taken.consumed < 2) continue;
    out.push(taken.value);
    i += taken.consumed;
  }
  return out;
}

/**
 * `showFooterTitle -off` and `showFooterTitle - off` are the checkbox, not `-o` plus a file.
 * A bare `-off` stays `-o ff`. A non-verb `-offline` becomes a filename before parseArgs,
 * but stays an unknown option inside a quoted instruction (`verbsOnly`) so the box is not left on.
 */
function rewriteSplitLabelHyphens(tokens, { verbsOnly = false } = {}) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const splitVerb = loneHyphenVerbAfterLabel(tokens, i);
    if (splitVerb) {
      out.push(tokens[i], splitVerb);
      i += 2;
      continue;
    }
    const rewritten = rewriteHyphenAfterLabel(tokens[i], tokens[i + 1], verbsOnly);
    out.push(tokens[i]);
    if (!rewritten) continue;
    out.push(rewritten);
    i += 1;
  }
  return out;
}

/** A checkbox label token. A path, a dash-option, or a non-label is not one. */
function checkboxLabelToken(token) {
  const labelText = plainCheckboxToken(token);
  return labelText ? checkboxLabelMatch(labelText) : null;
}

/** `showFooterTitle - off`: the hyphen is its own word, then a checkbox verb. Not an unknown option `-`. */
function loneHyphenVerbAfterLabel(tokens, index) {
  if (!isLoneHyphenToken(tokens[index + 1]) || !checkboxLabelToken(tokens[index])) return null;
  const verbToken = tokens[index + 2];
  if (verbToken == null || !pureCheckboxVerb(verbToken)) return null;
  return verbToken;
}

function isLoneHyphenToken(token) {
  const text = tokenText(token ?? '');
  return text.length > 0 && [...text].every(isHyphenChar);
}

function rewriteHyphenAfterLabel(labelToken, verbToken, verbsOnly) {
  if (verbToken == null || !checkboxLabelToken(labelToken)) return null;
  const tail = hyphenVerbTail(verbToken);
  if (!tail) return null;
  if (tail.verb) return tail.verb;
  if (verbsOnly || !tail.outputCluster) return null;
  return tail.rest;
}

function hyphenVerbTail(token) {
  const text = tokenText(token ?? '');
  if (!text || dashedOption(text) || dashedOption(text.toLowerCase())) return null;
  const rest = hyphenBeforeLabel(text);
  if (!rest) return null;
  const verb = pureCheckboxVerb(rest);
  return {
    rest,
    verb: verb ? verb.verb : null,
    outputCluster: /^-o./i.test(text),
  };
}

function splitNamed(token, name) {
  if (token.toLowerCase() === name.toLowerCase()) return { inline: null };
  if (!token.toLowerCase().startsWith(name.toLowerCase())) return null;
  const rawRest = token.slice(name.length);
  if (!rawRest) return { inline: null };
  if (!/^[\s:=：，,\d一二三四五六七八九十]/.test(rawRest)) return null;
  const inline = rawRest.trim().replace(/^[:=：，,]\s*/, '');
  return inline ? { inline } : { inline: null };
}

function validBareValue(kind, token) {
  if (!token || String(token).startsWith('-')) return false;
  const text = tokenText(token);
  if (!text || text.startsWith('-')) return false;
  if (kind === 'int') return configNumberToken(text) != null;
  if (kind === 'range') return normalizeRangeToken(text) != null;
  if (kind === 'output') return /[/\\.]/.test(text);
  if (kind === 'chars') return !INSTRUCTION_FILLERS.has(text.toLowerCase());
  return false;
}

function matchBare(token) {
  const text = tokenText(token);
  for (const [name, key, value] of BOOL_BARE) {
    if (isCheckboxKey(key)) {
      const assigned = checkboxAssignment(text, name);
      if (assigned != null) {
        const word = checkboxWordValue(assigned);
        if (word == null) return { error: checkboxWordError(name, assigned, { key }) };
        if (value === false && word === true) return { error: checkboxWordError(name, assigned, { negative: true, key }) };
        return { key, flag: true, value: value === false ? false : word, name };
      }
    }
    if (text.toLowerCase() === name.toLowerCase()) return { key, flag: true, value, name };
  }
  for (const [name, key] of INT_BARE) {
    const split = splitNamed(text, name);
    if (!split) continue;
    if (split.inline == null) return { key, kind: 'int' };
    const n = configNumberToken(split.inline);
    if (!n) return null;
    return { key, inline: n };
  }
  for (const [name, key, kind] of TEXT_BARE) {
    const split = splitNamed(text, name);
    if (!split) continue;
    if (split.inline == null) return { key, kind, name };
    if (kind === 'range') {
      const normalized = normalizeRangeToken(split.inline);
      if (!normalized) return { key, kind, name, error: rangeExpect(name, split.inline) };
      return { key, kind, name, inline: normalized };
    }
    if (kind === 'chars' && isCharsPerPageValue(split.inline)) return null;
    if (!validBareValue(kind, split.inline)) return null;
    return { key, kind, name, inline: split.inline };
  }
  return null;
}

function peelEmbeddedOptions(tokens) {
  const embedded = {};
  const rest = [];
  const put = (key, value) => {
    if (Object.prototype.hasOwnProperty.call(embedded, key) && String(embedded[key]) !== String(value)) {
      return { error: `conflicting ${key} values: ${embedded[key]}, ${value}` };
    }
    embedded[key] = value;
    return null;
  };
  let i = 0;
  // A following checkbox word is consumed here. `continue` still advances i, so this skips only the word.
  const takeCheckboxWord = (label, key, flagOn) => {
    const read = readCheckboxFlagValue(label, key, flagOn, tokens[i + 1], { optional: true });
    if (read?.error) return read;
    if (!read) return null;
    const conflict = put(key, read.value);
    if (conflict) return conflict;
    i += 1;
    return { ok: true };
  };
  for (; i < tokens.length; i++) {
    const raw = unquoteToken(tokens[i]);
    if (raw === '--') continue;
    const eq = raw.match(/^(-{1,2}[A-Za-z][\w-]*)=(.*)$/);
    const head = eq ? eq[1] : raw;
    const spec = head.startsWith('-') ? dashedOption(head) : null;
    if (head.startsWith('-') && !spec) {
      return { error: `unknown option "${head}" in a layout instruction. See --describe.` };
    }
    if (spec?.skip) {
      if (spec.takesValue && !eq) {
        const next = tokens[i + 1];
        if (next == null || unquoteToken(next).startsWith('-')) {
          return { error: `missing value for ${head} in a layout instruction` };
        }
        i += 1;
      }
      continue;
    }
    if (spec) {
      // `--chars per page 3` inside a quoted instruction is the layout phrase.
      if (spec.key === 'chars' && !eq && perPageTail(tokens, i + 1)) {
        rest.push('chars');
        continue;
      }
      let value = eq ? eq[2] : null;
      if (spec.flag && value == null && isCheckboxKey(spec.key)) {
        const taken = takeCheckboxWord(head, spec.key, spec.value !== false);
        if (taken?.error) return taken;
        if (taken) continue;
      }
      if (spec.flag && value == null) {
        const conflict = put(spec.key, spec.value);
        if (conflict) return conflict;
        continue;
      }
      if (spec.key === 'range' && value == null) {
        const taken = takeRangeTokens(tokens, i + 1);
        if (!taken) {
          return { error: rangeExpect(head, tokens[i + 1] == null ? '' : unquoteToken(tokens[i + 1])) };
        }
        value = taken.value;
        i += taken.consumed;
      } else if (value == null) {
        const next = tokens[i + 1];
        if (next == null || (unquoteToken(next).startsWith('-') && !/^-\d+$/.test(unquoteToken(next)))) {
          return { error: `missing value for ${head} in a layout instruction` };
        }
        value = unquoteToken(next);
        i += 1;
        if ((spec.key === 'job' || spec.key === 'layout' || spec.key === 'per-page') && /^layout$/i.test(value)) {
          const after = tokens[i + 1];
          if (after && layoutDigit(after)) {
            value = `layout ${layoutDigit(unquoteToken(after))}`;
            i += 1;
          }
        }
      }
      if (value != null) value = trimSentencePunct(String(value));
      if (spec.key === 'range') {
        const normalized = normalizeRangeToken(value);
        if (!normalized) return { error: rangeExpect(head, value) };
        value = normalized;
      }
      if (spec.kind === 'int') {
        const n = configNumberToken(value);
        if (!n) return { error: `${spec.key} must be an integer in a layout instruction, not "${value}"` };
        value = n;
      }
      if (spec.flag) {
        if (isCheckboxKey(spec.key)) {
          const read = readCheckboxFlagValue(head, spec.key, spec.value !== false, value);
          if (read.error) return read;
          value = read.value;
        } else if (!/^(true|false|1|0|yes|no|on|off)$/i.test(String(value))) {
          return { error: `${head} must be a boolean in a layout instruction, not "${value}"` };
        } else {
          value = /^(true|1|yes|on)$/i.test(String(value));
        }
      }
      const conflict = put(spec.key, value);
      if (conflict) return conflict;
      continue;
    }
    const phraseHit = takeCheckboxPhrase(tokens, i);
    if (phraseHit?.error) return { error: phraseHit.error };
    if (phraseHit) {
      const conflict = put(phraseHit.key, phraseHit.value);
      if (conflict) return conflict;
      i += phraseHit.consumed - 1;
      continue;
    }
    const bare = matchBare(raw);
    if (bare?.error) return { error: bare.error };
    if (bare?.flag) {
      if (isCheckboxKey(bare.key)) {
        const taken = takeCheckboxWord(bare.name, bare.key, bare.value !== false);
        if (taken?.error) return taken;
        if (taken) continue;
      }
      const conflict = put(bare.key, bare.value);
      if (conflict) return conflict;
      continue;
    }
    if (bare?.inline != null) {
      const conflict = put(bare.key, bare.inline);
      if (conflict) return conflict;
      continue;
    }
    if (bare?.kind === 'range') {
      const taken = takeRangeTokens(tokens, i + 1);
      if (taken) {
        i += taken.consumed;
        const conflict = put(bare.key, taken.value);
        if (conflict) return conflict;
        continue;
      }
      if (looksLikeRangeAttempt(tokens[i + 1])) {
        return { error: rangeExpect(bare.name, unquoteToken(tokens[i + 1])) };
      }
      // The label and the 选取 button do not change the selection until a range is given.
      if (isWorkbenchRangeLabel(bare.name)) continue;
      rest.push(tokens[i]);
      continue;
    }
    if (bare) {
      // `chars per page 3` is the layout phrase, not --chars per plus a file named page.
      if (bare.key === 'chars' && bare.inline == null && perPageTail(tokens, i + 1)) {
        rest.push(tokens[i]);
        continue;
      }
      const next = tokens[i + 1] != null ? unquoteToken(tokens[i + 1]) : null;
      if (!validBareValue(bare.kind, next)) {
        rest.push(tokens[i]);
        continue;
      }
      const value = bare.kind === 'int' ? configNumberToken(next) : tokenText(next);
      i += 1;
      const conflict = put(bare.key, value);
      if (conflict) return conflict;
      continue;
    }
    rest.push(tokens[i]);
  }
  return { embedded, rest };
}

function takeLayout(embedded) {
  const raw = embedded.layout ?? embedded['per-page'] ?? embedded.job;
  delete embedded.layout;
  delete embedded['per-page'];
  delete embedded.job;
  if (raw == null || raw === '') return { layout: null };
  const layout = parseLayoutToken(raw);
  if (!layout) {
    return { error: `${badLayout(raw)}. Say layout 2 or layout 3.` };
  }
  return { layout };
}

function isPrintScriptPath(token) {
  const text = unquoteToken(token).replaceAll('\\', '/');
  if (!text) return false;
  if (text === PRINT_SCRIPT) return true;
  return /(?:^|\/)print-pdf\.mjs$/i.test(text);
}

function finishLayout(layout, tokens, extra) {
  if (extra?.error && !isNumberlessLayoutLabelError(extra)) return extra;
  if (extra?.layout && extra.layout !== layout) {
    return { error: `conflicting layout values: ${layout}, ${extra.layout}` };
  }
  return { layout, rest: dropConsumedPhrase(tokens, extra) };
}

function layoutPhraseFromTokens(tokens) {
  const pos = [...tokens];
  for (let i = 0; i < pos.length - 1; i++) {
    if (!/^layout$/i.test(unquoteToken(pos[i]))) continue;
    const next = layoutDigit(pos[i + 1]);
    if (!next) return { error: badLayout(pos[i + 1]) };
    pos.splice(i, 2);
    return finishLayout(next, pos, findPhraseSpan(pos));
  }
  if (pos.some((token) => /^layout$/i.test(unquoteToken(token)))) {
    return { error: 'usage: layout 2 or layout 3 (characters per US Letter page)' };
  }
  const span = findPhraseSpan(pos);
  if (span?.error) return span;
  if (!span) return { layout: null, rest: pos };
  const rest = withoutSpan(pos, span);
  return finishLayout(span.layout, rest, findPhraseSpan(rest));
}

/**
 * A flag-first quoted command (`--dry-run layout 3`) is one positional, not an
 * unknown option. Prefix a filler so parseArgs does not consume it.
 */
function shieldFlagFirstInstruction(argv) {
  return argv.map((arg) => {
    if (typeof arg !== 'string' || !arg.startsWith('-') || !INSTRUCTION_BREAK.test(arg)) return arg;
    const text = unquoteToken(arg);
    if (!hasLayoutCue(text) && !embedsDatasetPath(text) && !instructionHasCheckbox(text)) return arg;
    return `print ${text}`;
  });
}

/**
 * Pull a layout phrase out of positionals so it is not treated as an input
 * filename. Workbench labels, per-page wording, quoted instructions, checkbox
 * verbs, and the 序号 picker are configuration, not a dataset. Quoted near-misses
 * error instead of being dropped; those sentences live in QUOTED_CHECKBOX_MISS.
 */
export function extractLayoutPhrase(positionals) {
  const expanded = expandInstructionPositionals(positionals);
  const peeled = peelEmbeddedOptions(rewriteSplitLabelHyphens(joinSplitRanges(expanded.tokens), { verbsOnly: true }));
  if (peeled.error) return peeled;
  const embedded = peeled.embedded;
  const phrase = layoutPhraseFromTokens(peeled.rest);
  if (phrase.error) return phrase;
  const flagged = takeLayout(embedded);
  if (flagged.error) return flagged;
  if (phrase.layout && flagged.layout && phrase.layout !== flagged.layout) {
    return { error: `conflicting layout values: ${phrase.layout}, ${flagged.layout}` };
  }
  const layout = phrase.layout ?? flagged.layout ?? null;
  const withoutScript = phrase.rest.filter((token) => !isPrintScriptPath(token));
  if (expanded.expanded) {
    const misses = [
      [labelNonVerbAttempt, (token, near) => quotedCheckboxMiss(token, near, 'is not a checkbox verb. It is not ignored', `${near.name}-off`)],
      [(token) => withMarkerStripped(token, leadingHyphenNonLabelBody), (token, near) => quotedCheckboxMiss(token, near, 'is not a checkbox label. It is not ignored', `off-${near.name}`)],
      [(token) => withMarkerStripped(token, verbJunkHyphenLabelBody), (token, near) => quotedCheckboxMiss(token, near, `is not ${near.verb} plus a label. It is not ignored`, `${near.verb}-${near.name}`)],
      [(token) => withMarkerStripped(token, verbJunkNoHyphenLabelBody), (token, near) => quotedCheckboxMiss(token, near, `is not ${near.verb} glued to a label. It has no hyphen, and it is not ignored`, `${near.verb}${near.name}`)],
      [(token) => withMarkerStripped(token, verbImmediateHyphenJunkLabelBody), (token, near) => quotedCheckboxMiss(token, near, `is not ${near.verb} plus a label. The hyphen is immediate, then junk, then the label. It is not ignored`, `${near.verb}-${near.name}`)],
    ];
    for (const token of withoutScript) {
      for (const [detect, explain] of misses) {
        const near = detect(token);
        if (near) return { error: explain(token, near) };
      }
    }
  }
  if (!expanded.expanded) {
    const rest = stripResolvedNoise(withoutScript).filter((token) => !layout || !isLayoutProse(token));
    return { layout, rest, embedded };
  }
  const rest = withoutScript.filter(isPositionalPath);
  if (!layout && rest.length === 0 && Object.keys(embedded).length === 0) {
    return { layout: null, rest: positionals };
  }
  return { layout, rest, embedded };
}

/** Long quoted-layout frames. Shorter sentences stay inline; these are the ones that repeat. */
const quotedLayout = (token, clause) => `A quoted \`layout 3，${token}\` ${clause}`;
const notDropped = (token, where) => quotedLayout(token, `is not dropped and does not print with the ${where}`);
const quotedUncheck = (token) => quotedLayout(token, 'unchecks the box; it does not leave the box on');
const stillFile = (token) => `Separate argv \`${token}\` is still a filename`;
const fileKept = (token, where) => notDropped(token, where) + '. ' + stillFile(token);
const FOOTER_LEFT = 'footer left on';
const BOX_LEFT = 'box left unchanged';

/** Quoted checkbox near-misses. The opening is also the footer-title option. */
const QUOTED_GLUED_OPEN = '. `showFooterTitlefalse` and `offshowFooterTitle` are that checkbox with no separator and are not a filename. '
  + quotedUncheck('showFooterTitlefalse')
  + '. Separate argv `showFooterTitleoffline` and a bare `offline` are still filenames. '
  + notDropped('showFooterTitleoffline', FOOTER_LEFT) + '. ';
const QUOTED_SHOW_OFF_REST = ' are not a filename. ' + quotedUncheck('showFooterTitle-off') + '. '
  + stillFile('showFooterTitle-offline') + '. ' + notDropped('showFooterTitle-offline', FOOTER_LEFT);
const QUOTED_GLUED_CHECKBOX_MISS = QUOTED_GLUED_OPEN
  + '`monooff` unchecks 黑白省墨 the same way. `no-mono` is still that flag. `showFooterTitle-off` and `setting-footer-title-off` are that checkbox with a hyphen before the verb. They'
  + QUOTED_SHOW_OFF_REST
  + '. `mono-off` unchecks 黑白省墨 the same way';
const QUOTED_HYPHEN_LABEL_MISS = '. `off-showFooterTitle` unchecks 页脚标题 with a hyphen before the label and is not a filename. '
  + quotedUncheck('off-showFooterTitle')
  + '. `no-mono` is still that flag, not `no` plus a label. `offline` and `off-line` are still filenames. '
  + notDropped('off-showFooterTitlexyz', FOOTER_LEFT)
  + '. Separate argv `showFooterTitle -off` is that same checkbox, not `-o` plus a file named `ff`, and it does not leave the box checked. A quoted `layout 3，showFooterTitle -off` unchecks the box too. A bare `-off` is still `-o ff`. Separate argv `showFooterTitle - off`, with the hyphen as its own word, is that same checkbox, not an unknown option `-`, and it does not leave the box checked. A quoted `layout 3，showFooterTitle - off` unchecks the box too. A bare `- off` with no label is still an unknown option. Separate argv `showFooterTitle -offline` is a filename, not output `ffline`. `offline-showFooterTitle` is not `off` plus a label. '
  + fileKept('offline-showFooterTitle', FOOTER_LEFT)
  + '. A bare `offline` is still a filename. A quoted `layout 3，offline-showFooterTitlexyz` is not dropped either. `offlineshowFooterTitle` is not `off` glued to a label. It has no hyphen. '
  + fileKept('offlineshowFooterTitle', FOOTER_LEFT)
  + '. A quoted `layout 3，offlineshowFooterTitlexyz` is not dropped either. `off-line-showFooterTitle` is not `off` plus a label. The hyphen is immediate, then junk, then the label. '
  + fileKept('off-line-showFooterTitle', FOOTER_LEFT)
  + '. A quoted `layout 3，off-line-showFooterTitlexyz` is not dropped either. `off-lineshowFooterTitle` has no second hyphen. '
  + notDropped('off-lineshowFooterTitle', FOOTER_LEFT)
  + '. `off-line` and `off-monochrome` are still filenames.';
const QUOTED_CHECKBOX_MISS = QUOTED_GLUED_CHECKBOX_MISS + QUOTED_HYPHEN_LABEL_MISS;

/** Shared by example.note and --help. */
const VERB_BEFORE_CHECKBOX = ' checkbox, not a filename and not a checked box: `关闭 页脚标题`, `关闭页脚标题`, `不显示 页脚标题`, `uncheck 页脚标题`, `off 页脚标题`, and `turn off 页脚标题` uncheck 页脚标题. `开启 黑白省墨` and `打开 黑白省墨` check 黑白省墨. The workbench title is that label when a verb precedes it (`关闭 在页脚显示字库标题`). A bare `关闭` is still a filename. `关闭 页脚标题 true` conflicts. `把 页脚标题 关闭`, `把页脚标题关闭`, `将 黑白省墨 打开`, and `turn 页脚标题 off` put the verb after the label. They are that checkbox, not a file named 把. `把 页脚标题` without a verb still leaves 把 as a filename. `页脚标题关闭`, `页脚标题 关掉`, and `页脚标题off` ';
/** Shared by example.note and --help. */
const LAYOUT_PHRASE_NOT_FILTER = ', not a --chars filter and not a file named page. `--chars 一,二` still selects those characters. `chars per` without page is still the filter. `3个字/页` and the workbench aria-label `每页字数 3` are that layout phrase too';
/** Shared by example.note and the footer-title option. */
const TITLE_VERB_AFTER = '. `在页脚显示字库标题 关闭` is the workbench title with the verb after it. ' + quotedUncheck('页脚标题关闭') + '. A bare `关掉` is still a filename. `页脚标题关闭 true` conflicts';
/** Shared by example.note and --help. */
const CHECKBOX_FALSE_VALUES = ' --footer-title false, --footer-title=off, --mono=off, 页脚标题 off, showFooterTitle false, and setting-footer-title false uncheck the box. ';

export function describePrintConfig() {
  const jobs = publishedPrintJobs();
  const layout3 = jobs.find((job) => job.layout === 3);
  return {
    tool: 'hanzi-print',
    exampleInput: EXAMPLE_INPUT,
    script: PRINT_SCRIPT,
    npmFlagWarning: NPM_FLAG_WARNING,
    recoversNpmDryRun: true,
    example: {
      input: EXAMPLE_INPUT,
      layout: 3,
      command: layout3.command,
      argv: layout3.argv,
      quoted: printInvoke(3, { quotedPhrase: true }).command,
      npm: layout3.npm,
      configFile: EXAMPLE_JOB,
      configArgv: printJobFileArgv(),
      configCommand: printJobFileArgv().map(shellToken).join(' '),
      instruction: PRINT_INSTRUCTION,
      instructionArgv: [process.execPath, PRINT_SCRIPT, PRINT_INSTRUCTION],
      note: 'Pass the layout the way a person says it, or the way the workbench button is labeled: `layout 3` and `3 字/页` are the same published job. `3 per page`, `layout three`, and `three Chinese characters on the page` are that job too (layout 2 is two per page) — see jobs[].phrases. They are not a filename. A single quoted instruction is that job too: example.instruction (`run the end-to-end test to generate the PDF, layout 3`), not a missing filename. Copy jobs[].argv or example.instructionArgv — both are absolute and work from any cwd. The app supplies the example dataset and that layout’s Tianzige defaults. `printer/spec/print-job.example.json` is that configuration: pass the file itself (example.configArgv), `--config`, or the bare name `print-job.example.json`. It is not a character dataset. A dataset JSON such as hanzi-1000-v6.json stays an input, and that bare name is the published example file from any cwd (a same-named file in the cwd wins). `npm run test:e2e layout 3` prints that job; `npm run test:e2e` with no layout is still visual regression, not a printer. Inside a quoted instruction or as separate argv, `--limit`, `--dry-run`, `--output`, `cols`/`rows`/`trace`, `limit 6`, the workbench labels `每行`/`总行`/`描红`/`黑白省墨`, and the 序号 picker (`序号 1-12`, `选取 1 - 6`) are options, not a dataset filename. The hyphen between those two inputs is not an option. A bare 选取 does not change the selection. Words after `3 字/页` do not turn that button label into a bad layout phrase. Other non-path words, including a Chinese instruction or the `print-pdf.mjs` path, are ignored so the example dataset stays selected. Do not append flags to npm. The same words as separate argv are that job too: a comma stuck to PDF, or file, is glue, not a missing filename, and a comma stuck to an existing path such as printer/spec/data/hanzi-1000-v6.json, or to the bare name hanzi-1000-v6.json, is that file. --no-mono and --no-footer-title are the workbench checkboxes as separate argv, not unknown options. --no-footer-title unchecks 页脚标题 (default on). A value on the checkbox is that value, not a filename and not a checked box:' + CHECKBOX_FALSE_VALUES + 'A bare false is still a filename. --footer-title=maybe is an error. --no-footer-title does not take a value. Passing --footer-title and --no-footer-title together still conflicts. `chars per page 3`, `3 chars per page`, and `--chars per page 3` are that layout phrase (jobs[].phrases)' + LAYOUT_PHRASE_NOT_FILTER + ' (jobs[].phrases), not a missing filename. `每页字数` with no count is an incomplete layout, not a second job. A verb before a workbench checkbox is that' + VERB_BEFORE_CHECKBOX + 'are that checkbox with no 把. They uncheck 页脚标题 and are not a filename. `黑白省墨打开` and `黑白省墨 打开` check 黑白省墨' + TITLE_VERB_AFTER + QUOTED_CHECKBOX_MISS,
    },
    jobs,
    pdf: {
      ...PDF_EXPORT,
      engine: 'chromium page.pdf()',
      equivalentTo: 'printer/e2e/print.spec.mjs exportPdfBuffer',
    },
    layouts: Object.fromEntries(PER_PAGE_OPTIONS.map((n) => [String(n), layoutDescriptor(n)])),
    options: [
      {
        flag: '--input <file>',
        required: false,
        description: `Dataset JSON. Default: ${EXAMPLE_INPUT} (the workbench and e2e example). Relative paths are tried from the cwd, then the repo root. The bare name hanzi-1000-v6.json, or spec/data/hanzi-1000-v6.json, is that published file from any cwd. A same-named file in the cwd wins.`,
      },
      {
        flag: 'layout <1|2|3|4>',
        required: true,
        description: 'Characters per US Letter page. The workbench button (`3 字/页`, `3个字/页`, `每页3字`, `每页字数 3`, `per-page 3`), `3 per page`, `3 chars per page`, `chars per page 3`, and `three Chinese characters on the page` are the same phrase as `layout 3` (see jobs[].phrases). They are not a --chars filter and not a file named page. Omitting cols/rows/trace uses that layout’s app defaults, matching the toolbar.',
      },
      {
        flag: '--job <layout-N>',
        description: 'App-published job id (`layout-2`, `layout-3`, or 3). Same as the positional phrase. See jobs in --describe.',
      },
      {
        flag: '--layout <1|2|3|4>',
        description: 'Alias of the layout phrase. Also --per-page, or a bare positional 3.',
      },
      {
        flag: '--cols <n>',
        description: 'Tianzige columns. Omitted = layout default. Clamped to the layout min/max.',
      },
      {
        flag: '--rows <n>',
        description: 'Tianzige rows. Omitted = layout default. The sheet clamps this to what fits.',
      },
      {
        flag: '--trace <n>',
        description: 'Dashed tracing rows. Omitted = layout default. Clamped to 0..rows.',
      },
      {
        flag: '--mono / --no-mono',
        description: 'Monochrome ink-saving theme (workbench 黑白省墨, id setting-mono). Default off. --no-mono is a real flag, not an unknown option. --mono false, --mono=off, and 黑白省墨 off uncheck it; they are not a filename and do not leave the box checked. 开启 黑白省墨 and 打开 黑白省墨 check it and are not a filename. 关闭 黑白省墨 unchecks it. A bare 关闭 is still a filename. `把 黑白省墨 关闭` and `将黑白省墨打开` put the verb after the label and are not a file named 把. `把 黑白省墨` without a verb still leaves 把 as a filename. `黑白省墨打开` and `黑白省墨 打开` check it with no 把 and are not a filename. A bare `打开` is still a filename. `monooff` and `offmono` uncheck it with no separator and are not a filename. `mono-off` and `setting-mono-off` uncheck it with a hyphen before the verb and are not a filename. Separate argv `mono -off` is that same checkbox, not `-o` plus a file named `ff`, and it does not leave the box checked. A bare `-off` is still `-o ff`. Separate argv `mono - off`, with the hyphen as its own word, is that same checkbox, not an unknown option `-`. A bare `- off` with no label is still an unknown option. `offline` is still a filename. '
          + notDropped('mono-offline', BOX_LEFT)
          + '. `off-mono` unchecks it with a hyphen before the label and is not a filename. '
          + quotedUncheck('off-mono')
          + '. `off-line` is still a filename. `no-mono` is still that flag, not `no` plus a label. `offline-mono` is not `off` plus a label. '
          + fileKept('offline-mono', BOX_LEFT)
          + '. Passing both forms conflicts. `online黑白省墨` is not `on` glued to a label. It has no hyphen. '
          + fileKept('online黑白省墨', BOX_LEFT)
          + '. `off-line-mono` is not `off` plus a label. The hyphen is immediate, then junk, then the label. '
          + fileKept('off-line-mono', BOX_LEFT)
          + '. `on-line-黑白省墨` is the same. `off-monochrome` is still a filename.',
      },
      {
        flag: '--footer-title / --no-footer-title',
        description: 'Dataset title in the page footer (workbench 页脚标题, id setting-footer-title). Default on. --no-footer-title unchecks it and is a real flag, not an unknown option. --footer-title false, --footer-title=off, 页脚标题 off, and showFooterTitle false uncheck it; they are not a filename and do not leave the box checked. A verb before the label unchecks it too: 关闭 页脚标题, 关闭页脚标题, 不显示 页脚标题, and uncheck 页脚标题 are not a filename and do not leave the box checked. 关闭 在页脚显示字库标题 is the workbench title with that verb. A bare 关闭 is still a filename. 关闭 页脚标题 true conflicts. `把 页脚标题 关闭` and `把页脚标题关闭` put the verb after the label and are not a file named 把. `turn 页脚标题 off` is the same order. `把 页脚标题` without a verb still leaves 把 as a filename. `页脚标题关闭`, `页脚标题 关掉`, and `页脚标题off` are that checkbox with no 把. They are not a filename and do not leave the box checked' + TITLE_VERB_AFTER + QUOTED_GLUED_OPEN + '`showFooterTitle-off` and `setting-footer-title-off` are that checkbox with a hyphen before the verb and' + QUOTED_SHOW_OFF_REST + QUOTED_HYPHEN_LABEL_MISS + ' A bare false is still a filename. Passing both forms conflicts.',
      },
      {
        flag: '--range <start-end>',
        description: '1-based inclusive character indexes in dataset order. The workbench 序号 picker is this option: 序号 1-12, 选取 1-24, or 序号 1 - 12. The hyphen between those inputs is not an option. A bare 选取 does not change the selection.',
      },
      {
        flag: '--limit <n>',
        description: 'Shorthand for --range 1-n.',
      },
      {
        flag: '--chars <a,b,c>',
        description: 'Print only these characters, in dataset order rather than the order listed. `chars per page 3` and `--chars per page 3` are the layout phrase, not this filter and not a file named page. A real filter is `--chars 一,二`. `chars per` without page is still this filter.',
      },
      {
        flag: '--output <file>',
        description: 'PDF path. Default: printer/output/<input>-layout-<n>.pdf in the repo, not the e2e directory. A printer/... path (the example job and --describe) is always resolved from the repo root, from any cwd. Any other relative path is resolved from the cwd.',
      },
      {
        flag: '--config <file>',
        description: 'JSON job. Passing printer/spec/print-job.example.json, or the bare name print-job.example.json, is the same file from any cwd. A character dataset JSON stays an input. Flags override file values. Unknown keys are ignored.',
      },
      {
        flag: '--strict',
        description: 'Fail if the dataset has validation errors. Without this, the sheet still prints, as in the workbench.',
      },
      {
        flag: '--dry-run',
        description: 'Resolve config and validate JSON without launching a browser. Pass this on the node argv. If npm consumes --dry-run, the script dry-runs and does not write the PDF.',
      },
      {
        flag: '--describe',
        description: 'Print this schema as JSON and exit.',
      },
    ],
  };
}

export function formatHelp(desc = describePrintConfig()) {
  const lines = [
    'Hanzi practice-sheet PDF CLI',
    '',
    'Prints a US Letter PDF via Chromium page.pdf(), the same call the e2e suite uses',
    '(format Letter, printBackground, preferCSSPageSize). Layout defaults come from the app.',
    '',
    'Usage (absolute argv — any working directory):',
    `  ${desc.example.command}`,
    `  ${desc.example.quoted}`,
    `  ${desc.example.npm}`,
    `  ${desc.example.configCommand}`,
    `  ${desc.example.command} --limit 24 --dry-run`,
    '',
    'Relative forms only work from one directory:',
    '  repo root:  node printer/scripts/print-pdf.mjs layout 3',
    '  printer/:   node scripts/print-pdf.mjs layout 3',
    '  printer/:   node printer/scripts/print-pdf.mjs does not exist there.',
    '',
    `Omitting --input prints ${desc.example.input}. The app supplies cols/rows/trace for that layout.`,
    'Say `layout 2` or `layout 3`, the workbench label `3 字/页`, `3个字/页`, the group label `每页字数 3`, `3 per page`, `3 chars per page`, `chars per page 3`, or `three Chinese characters on the page`. jobs[].phrases lists them. That is the configuration, not a --chars filter and not a file named page.',
    'The old human instruction is one argument, not a filename:',
    `  ${desc.example.instructionArgv.map(shellToken).join(' ')}`,
    'Those words as separate argv are the same job. A comma stuck to PDF, or file, is glue, not a filename.',
    'Options inside that argument apply and are not a filename: --limit 6, --dry-run, cols 5, 每行 5, 总行 3, 描红 1.',
    'The same option words as separate argv are not a filename either: layout 3 limit 6, cols 5, 3 字/页 每行 5, 黑白省墨. Words after 3 字/页 stay the button label. Unknown words such as extra still are a missing file.',
    'The workbench 序号 picker is --range, not a filename: 序号 1-12, 选取 1-24, or 序号 1 - 12. That hyphen is the picker, not an option. A bare 选取 does not change the selection.',
    'The workbench checkboxes are flags: --mono checks 黑白省墨, --no-mono leaves it off, and --no-footer-title unchecks 页脚标题 (default on). Those --no- flags are separate argv, not unknown options.' + CHECKBOX_FALSE_VALUES + 'They are not a filename and do not leave the box checked. A bare false is still a filename. --footer-title=maybe is an error. Passing both forms conflicts.',
    'A verb before that label is the' + VERB_BEFORE_CHECKBOX + 'uncheck 页脚标题 with no 把 and are not a filename. `黑白省墨打开` checks 黑白省墨. ' + quotedUncheck('页脚标题关闭') + '. A bare `关掉` is still a filename' + QUOTED_CHECKBOX_MISS,
    '`chars per page 3`, `3 chars per page`, and `--chars per page 3` are the layout phrase' + LAYOUT_PHRASE_NOT_FILTER + ', not a missing filename. `每页字数` with no count is an incomplete layout, not a second job.',
    'The app-published job file is an argument, not a dataset: printer/spec/print-job.example.json, or the bare name print-job.example.json (absolute path in example.configArgv). A character dataset JSON stays an input. The bare name hanzi-1000-v6.json is the published example dataset from any cwd; a same-named file in the cwd wins.',
    'The old printer command also works: `npm run test:e2e layout 3` prints the published job. `npm run test:e2e` with no layout is visual regression only.',
    desc.npmFlagWarning,
    '',
    'Options:',
    ...desc.options.map((opt) => `  ${opt.flag.padEnd(36)} ${opt.description}`),
    '',
    'Layout defaults (from the workbench):',
  ];
  for (const layout of Object.values(desc.layouts)) {
    const d = layout.defaults;
    const lim = layout.limits.cols;
    lines.push(
      `  layout ${layout.layout}: ${layout.charsPerPage} char/page, cols=${d.cols}, rows=${d.rows}, trace=${d.trace} (cols ${lim.min}-${lim.max})`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function optInt(value, name) {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n)) {
    throw new TypeError(`${name} must be an integer`);
  }
  return n;
}

function optBool(value, name) {
  if (value == null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new TypeError(`${name} must be a boolean`);
}

export function parseRange(value) {
  if (value == null || value === '') return null;
  if (Array.isArray(value)) {
    if (value.length !== 2) throw new TypeError('range must be [start, end]');
    return normalizeRange(value[0], value[1]);
  }
  const text = String(value).trim();
  const normalized = normalizeRangeToken(text);
  if (!normalized) throw new TypeError(`invalid range "${text}" (expected 1-24)`);
  const match = normalized.match(/^(\d+)-(\d+)$/);
  return normalizeRange(match[1], match[2]);
}

function normalizeRange(startRaw, endRaw) {
  const start = Number(startRaw);
  const end = Number(endRaw);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
    throw new TypeError('range bounds must be positive integers');
  }
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

export function parseChars(value) {
  if (value == null || value === '') return null;
  const list = Array.isArray(value) ? value : String(value).split(/[,，\s]+/);
  const chars = [];
  for (const item of list) {
    const ch = [...String(item).trim()][0];
    if (ch) chars.push(ch);
  }
  return chars.length ? chars : null;
}

/**
 * App-published files an agent names by basename. `hanzi-1000-v6.json` is the
 * example dataset; `print-job.example.json` is the layout-3 job. A missing name
 * is not rewritten — only a file that actually lives here is used.
 */
function publishedPathCandidates(input) {
  const text = String(input).replaceAll('\\', '/').replace(/^\.\//, '');
  if (!text || isAbsolute(text) || text === 'printer' || text.startsWith('printer/')) return [];
  const base = basename(text);
  if (!base || base === '.' || base === '..') return [];
  const bare = !text.includes('/');
  const alias = /^(?:spec\/data|spec|data)\/[^/]+$/.test(text);
  if (!bare && !alias) return [];
  const candidates = [];
  if (alias) candidates.push(join(REPO_ROOT, 'printer', text));
  candidates.push(join(REPO_ROOT, 'printer', 'spec', 'data', base));
  candidates.push(join(REPO_ROOT, 'printer', 'spec', base));
  return candidates;
}

function resolveExistingPathOnce(input, cwd) {
  if (isAbsolute(input)) return { path: input, tried: [input], exists: existsSync(input) };
  const fromCwd = resolve(cwd, input);
  const fromRepo = resolve(REPO_ROOT, input);
  if (existsSync(fromCwd)) return { path: fromCwd, tried: [fromCwd], exists: true };
  if (fromRepo !== fromCwd && existsSync(fromRepo)) return { path: fromRepo, tried: [fromCwd, fromRepo], exists: true };
  const tried = fromRepo === fromCwd ? [fromCwd] : [fromCwd, fromRepo];
  for (const candidate of publishedPathCandidates(input)) {
    if (candidate !== fromCwd && candidate !== fromRepo && existsSync(candidate)) {
      return { path: candidate, tried: [...tried, candidate], exists: true };
    }
  }
  return { path: fromCwd, tried, exists: false };
}

/**
 * Resolve a path that must already exist. Relative paths are tried from `cwd`,
 * then from the repo root, so `printer/spec/data/hanzi-1000-v6.json` works
 * whether the agent started at the repo or in `printer/`. A bare name the app
 * publishes (`hanzi-1000-v6.json`, `print-job.example.json`, `spec/data/...`)
 * is that file from any cwd; a same-named file in the cwd still wins. A trailing
 * comma or period (`file.json,`) is the same path when that exact name is missing
 * and the path without it exists. A missing name is returned unchanged.
 */
export function resolveExistingPath(input, cwd = process.cwd()) {
  if (!input) return { path: null, tried: [] };
  const direct = resolveExistingPathOnce(String(input), cwd);
  if (direct.exists) return { path: direct.path, tried: direct.tried };
  const trimmed = trimSentencePunct(String(input).trim());
  if (trimmed && trimmed !== String(input)) {
    const alt = resolveExistingPathOnce(trimmed, cwd);
    if (alt.exists) return { path: alt.path, tried: [...direct.tried, ...alt.tried] };
  }
  return { path: direct.path, tried: direct.tried };
}

/**
 * PDF destination. Bare names (`-o out.pdf`) stay relative to cwd so an agent
 * can drop a file next to itself. Paths the app publishes (`printer/output/...`
 * in the example job and `--describe`) are anchored at the repo root — the file
 * does not exist yet, so the input exists-then-fallback rule cannot be reused,
 * and resolving those strings from cwd writes `printer/printer/output` when the
 * agent was started inside `printer/`.
 */
export function resolveOutputPath(output, cwd = process.cwd()) {
  if (!output) return null;
  if (isAbsolute(output)) return output;
  const spec = String(output).replace(/^\.\//, '');
  const repoRelative = spec === 'printer' || spec.startsWith('printer/') || spec.startsWith('printer\\');
  if (repoRelative) return resolve(REPO_ROOT, spec);
  return resolve(cwd, spec);
}

function defaultOutputPath(inputPath, layout, range, chars) {
  const base = basename(inputPath || 'dataset', '.json').replace(/[^\w.\u4e00-\u9fff-]+/g, '-');
  let suffix = '';
  if (range) suffix += `-r${range.start}-${range.end}`;
  else if (chars) suffix += `-chars${chars.length}`;
  return join(DEFAULT_OUTPUT_DIR, `${base}-layout-${layout}${suffix}.pdf`);
}

function issueSummary(doc) {
  const issues = doc?.issues || [];
  return {
    ok: Boolean(doc?.ok),
    totalChars: doc?.characters?.length || 0,
    errors: issues.filter((issue) => issue.level === 'error').length,
    warnings: issues.filter((issue) => issue.level === 'warning').length,
    issues: issues.slice(0, 20).map((issue) => ({
      level: issue.level,
      code: issue.code,
      message: issue.message,
    })),
  };
}

/**
 * Merge CLI flags, an optional config file, and the dataset into one job.
 * Does not launch a browser.
 */
export function buildPrintJob(raw, { cwd = process.cwd(), readText } = {}) {
  const errors = [];
  const warnings = [];
  let layout;
  try {
    const rawLayout = raw.layout ?? raw.perPage;
    if (rawLayout == null || rawLayout === '') {
      layout = undefined;
    } else {
      const fromPhrase = parseLayoutToken(rawLayout);
      if (fromPhrase != null) {
        layout = fromPhrase;
      } else if (/^layout\b/i.test(unquoteToken(rawLayout))) {
        errors.push(badLayout(unquoteToken(rawLayout)));
      } else {
        layout = optInt(rawLayout, 'layout');
      }
    }
  } catch (err) {
    errors.push(err.message);
  }
  if (layout == null && !errors.some((message) => message.startsWith('layout'))) {
    errors.push(`--layout is required (1, 2, 3, or 4 characters per page). Example: layout 3 or ${workbenchLayoutLabel(3)} (dataset defaults to ${EXAMPLE_INPUT})`);
  } else if (layout != null && !PER_PAGE_OPTIONS.includes(layout)) {
    errors.push(`layout must be one of ${PER_PAGE_OPTIONS.join(', ')} (characters per US Letter page)`);
  }

  let cols;
  let rows;
  let trace;
  let mono;
  let showFooterTitle;
  let range;
  let chars;
  try {
    cols = optInt(raw.cols, 'cols');
    rows = optInt(raw.rows, 'rows');
    trace = optInt(raw.trace, 'trace');
    mono = optBool(raw.mono, 'mono');
    showFooterTitle = optBool(raw.showFooterTitle ?? raw.footerTitle, 'showFooterTitle');
    const limit = optInt(raw.limit, 'limit');
    if (raw.range != null && raw.range !== '' && limit != null) {
      errors.push('pass only one of --range and --limit');
    }
    range = raw.range != null && raw.range !== '' ? parseRange(raw.range) : limit != null ? { start: 1, end: limit } : null;
    chars = parseChars(raw.chars);
    if (chars && range) errors.push('pass only one of --chars and --range/--limit');
  } catch (err) {
    errors.push(err.message);
  }

  const inputDefaulted = !raw.input && raw.datasetText == null;
  const inputSpec = raw.input || (inputDefaulted ? EXAMPLE_INPUT : null);
  const resolvedInput = inputSpec ? resolveExistingPath(inputSpec, cwd) : { path: null, tried: [] };
  const inputPath = resolvedInput.path;
  if (inputPath && raw.datasetText == null && !existsSync(inputPath)) {
    errors.push(`input not found: ${resolvedInput.tried.join(' or ')}`);
  }

  const descriptor = layout != null ? layoutDescriptor(layout) : null;
  if (descriptor && cols != null) {
    const clamped = Math.min(descriptor.limits.cols.max, Math.max(descriptor.limits.cols.min, cols));
    if (clamped !== cols) {
      warnings.push(`cols ${cols} clamped to ${clamped} for layout ${layout} (allowed ${descriptor.limits.cols.min}-${descriptor.limits.cols.max})`);
      cols = clamped;
    }
  }
  if (rows != null && rows < 1) {
    errors.push('rows must be >= 1');
  }
  if (trace != null && trace < 0) {
    errors.push('trace must be >= 0');
  }
  if (descriptor && rows != null && trace != null && trace > rows) {
    warnings.push(`trace ${trace} exceeds rows ${rows}; the sheet clamps trace to the row count`);
  }

  let datasetText = raw.datasetText ?? null;
  let doc = null;
  if (errors.length === 0) {
    try {
      if (datasetText == null) {
        datasetText = (readText || ((path) => readFileSync(path, 'utf8')))(inputPath);
      }
      doc = parseDataset(datasetText);
    } catch (err) {
      errors.push(`failed to read input: ${err.message}`);
    }
  }

  const validation = issueSummary(doc);
  if (doc && !doc.ok) {
    errors.push(validation.issues.find((issue) => issue.level === 'error')?.message || 'dataset has no printable characters');
  }
  if (doc && raw.strict && validation.errors > 0) {
    errors.push(`strict validation failed with ${validation.errors} error(s)`);
  }

  let selected = doc ? doc.characters.map((item) => item.char) : [];
  if (doc && chars) {
    const known = new Set(doc.characters.map((item) => item.char));
    const missing = chars.filter((ch) => !known.has(ch));
    if (missing.length) warnings.push(`characters not in dataset, skipped: ${missing.join(' ')}`);
    const want = new Set(chars);
    selected = doc.characters.filter((item) => want.has(item.char)).map((item) => item.char);
  } else if (doc && range) {
    selected = doc.characters.slice(range.start - 1, range.end).map((item) => item.char);
    if (range.start > doc.characters.length) {
      errors.push(`range starts at ${range.start} but the dataset has only ${doc.characters.length} characters`);
    }
  }
  if (doc && selected.length === 0 && errors.length === 0) {
    errors.push('no characters selected');
  }

  const output = raw.output
    ? resolveOutputPath(raw.output, cwd)
    : defaultOutputPath(inputPath, layout || 0, range, chars);

  const settings = descriptor
    ? {
        layout,
        perPage: layout,
        cols: cols ?? null,
        rows: rows ?? null,
        trace: trace ?? null,
        mono: mono ?? descriptor.defaults.mono,
        showFooterTitle: showFooterTitle ?? descriptor.defaults.showFooterTitle,
        defaults: descriptor.defaults,
        effective: {
          cols: cols ?? descriptor.defaults.cols,
          rows: rows ?? descriptor.defaults.rows,
          trace: trace ?? descriptor.defaults.trace,
          mono: mono ?? descriptor.defaults.mono,
          showFooterTitle: showFooterTitle ?? descriptor.defaults.showFooterTitle,
        },
      }
    : null;

  const ok = errors.length === 0;
  const failedValidation = Boolean(doc) && (selected.length === 0 || !doc.ok || (raw.strict && validation.errors > 0));
  return {
    ok,
    code: ok ? 0 : failedValidation ? 3 : 2,
    errors,
    warnings,
    input: inputPath,
    inputDefaulted,
    output,
    job: layout ? `layout-${layout}` : null,
    datasetText: ok ? datasetText : null,
    strict: Boolean(raw.strict),
    range: range || null,
    chars: chars || null,
    settings,
    selection: {
      total: doc?.characters?.length || 0,
      selected: selected.length,
      chars: selected,
    },
    expectedPages: settings ? pageCount(selected.length, layout) : 0,
    validation,
    jobs: layout == null || !PER_PAGE_OPTIONS.includes(layout) ? publishedPrintJobs() : undefined,
  };
}

/**
 * A print-job object has a layout and no character groups. Dataset JSON
 * (`groups` / `characters`, including hanzi-1000-v6.json) is not a job.
 */
export function isPrintJobConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.groups != null || value.characters != null) return false;
  const layout = value.layout ?? value.perPage ?? value.job;
  return layout != null && String(layout).trim() !== '';
}

function isPublishedJobSpec(token) {
  const text = unquoteToken(token).replace(/^\.\//, '').replaceAll('\\', '/');
  if (text === EXAMPLE_JOB) return true;
  return isAbsolute(text) && resolve(text) === resolve(REPO_ROOT, EXAMPLE_JOB);
}

/**
 * Pull a print-job JSON out of positionals so it is configuration, not a dataset
 * filename. The app-published path is always a config, even if it is missing.
 * A character dataset stays in `rest` and remains the input.
 */
export function takePositionalPrintJob(positionals, cwd = process.cwd()) {
  const rest = [];
  let job = null;
  let jobPath = null;
  for (const token of positionals) {
    const spec = unquoteToken(token);
    const resolved = resolveExistingPath(spec, cwd);
    const published = isPublishedJobSpec(spec);
    const exists = Boolean(resolved.path) && existsSync(resolved.path);
    if (!exists) {
      if (published) return { error: `config not found: ${resolved.tried.join(' or ')}` };
      rest.push(token);
      continue;
    }
    if (!/\.json$/i.test(spec)) {
      rest.push(token);
      continue;
    }
    let value;
    try {
      value = JSON.parse(readFileSync(resolved.path, 'utf8'));
    } catch (err) {
      if (published) return { error: `config is not valid JSON: ${err.message}` };
      rest.push(token);
      continue;
    }
    if (!isPrintJobConfig(value)) {
      if (published) {
        return { error: `${EXAMPLE_JOB} must be a print-job object with layout, not a character dataset` };
      }
      rest.push(token);
      continue;
    }
    if (job) return { error: `pass only one print-job JSON (${jobPath} and ${resolved.path})` };
    job = value;
    jobPath = resolved.path;
  }
  return { job, jobPath, rest };
}

/**
 * Positionals: `file.json`, `3`, or `file.json 3`.
 * A lone 1–4 is layout so `print-pdf.mjs 3` uses the app example dataset.
 */
function applyPositionals(positionals, values) {
  const pos = [...positionals];
  let input;
  let layout;
  const asLayout = (token) => {
    const n = layoutDigit(token);
    return n ? String(n) : null;
  };
  if (!values.input && pos[0] && !asLayout(pos[0])) {
    input = pos.shift();
  }
  if (!values.layout && !values['per-page'] && pos[0]) {
    const n = asLayout(pos[0]);
    if (n) {
      layout = n;
      pos.shift();
    }
  }
  if (pos.length) {
    return { error: `unexpected argument${pos.length > 1 ? 's' : ''}: ${pos.join(' ')}` };
  }
  return { input, layout };
}

/**
 * Node's parseArgs does not treat `--no-mono` as the negation of `mono`.
 * The workbench checkboxes are published as `--mono` / `--no-mono` and
 * `--footer-title` / `--no-footer-title`, so those flags are real options.
 * Both forms together conflict. `--footer-title false` is rewritten to
 * `--no-footer-title` before this runs, so an agreeing false is not a conflict.
 * A bare `no-mono` word is peeled earlier.
 */
function applyPublishedNegations(values) {
  for (const key of ['mono', 'footer-title']) {
    if (!values[`no-${key}`]) continue;
    if (values[key] === true) return `conflicting ${key} values: --${key} and --no-${key}`;
    values[key] = false;
  }
  return null;
}

function cliError(message) {
  return { mode: 'error', code: 2, errors: [message] };
}

/** `--help` / `--describe` can arrive as flags or as words peeled out of a quoted instruction. */
function flaggedMode(values) {
  if (values.help) return { mode: 'help' };
  if (values.describe) return { mode: 'describe' };
  return null;
}

export function parseCliArgs(argv, { cwd = process.cwd() } = {}) {
  argv = rewriteSplitLabelHyphens(shieldCharsPerPage(joinSplitRanges(shieldFlagFirstInstruction(argv))));
  const rewritten = rewriteCheckboxFlags(argv);
  if (rewritten.error) return cliError(rewritten.error);
  argv = rewritten.argv;
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: PARSE_OPTIONS,
    }));
  } catch (err) {
    return cliError(err.message);
  }

  const early = flaggedMode(values);
  if (early) return early;

  const phrase = extractLayoutPhrase(positionals);
  if (phrase.error) return cliError(phrase.error);
  if (phrase.embedded) {
    for (const [key, value] of Object.entries(phrase.embedded)) {
      if (values[key] == null) values[key] = value;
    }
  }
  const negated = applyPublishedNegations(values);
  if (negated) return cliError(negated);
  const afterPhrase = flaggedMode(values);
  if (afterPhrase) return afterPhrase;

  let file = {};
  if (values.config) {
    const resolvedConfig = resolveExistingPath(values.config, cwd);
    if (!existsSync(resolvedConfig.path)) {
      return cliError(`config not found: ${resolvedConfig.tried.join(' or ')}`);
    }
    try {
      file = JSON.parse(readFileSync(resolvedConfig.path, 'utf8'));
    } catch (err) {
      return cliError(`config is not valid JSON: ${err.message}`);
    }
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      return cliError('config must be a JSON object');
    }
    if (!isPrintJobConfig(file) && (file.groups != null || file.characters != null)) {
      return cliError('config must be a print-job object with layout, not a character dataset');
    }
  }

  if (values.job && /^layout$/i.test(unquoteToken(values.job)) && /^[1-4]$/.test(unquoteToken(phrase.rest[0] || ''))) {
    values.job = `layout ${unquoteToken(phrase.rest.shift())}`;
  }
  const positionalJob = takePositionalPrintJob(phrase.rest, cwd);
  if (positionalJob.error) return cliError(positionalJob.error);
  if (values.config && positionalJob.job) {
    return cliError(`pass only one config: --config or a print-job JSON argument such as ${EXAMPLE_JOB}`);
  }
  if (positionalJob.job) file = positionalJob.job;

  const request = { ...file };
  const positional = applyPositionals(positionalJob.rest, values);
  if (positional.error) return cliError(positional.error);

  let jobLayout = null;
  if (values.job) {
    jobLayout = parseLayoutToken(values.job);
    if (!jobLayout) {
      return cliError(`unknown job "${values.job}". Expected layout-2 or layout-3 (see --describe).`);
    }
  }
  const chosen = [jobLayout, phrase.layout, values.layout || values['per-page'] || positional.layout]
    .filter((value) => value != null && value !== '')
    .map((value) => String(parseLayoutToken(value) ?? value));
  const unique = new Set(chosen);
  if (unique.size > 1) return cliError(`conflicting layout values: ${[...unique].join(', ')}`);

  if (values.input || positional.input) request.input = values.input || positional.input;
  if (chosen.length) request.layout = chosen[0];
  if (jobLayout || phrase.layout) request.job = `layout-${request.layout}`;

  for (const key of ['cols', 'rows', 'trace', 'mono', 'range', 'limit', 'chars']) {
    if (values[key] != null) request[key] = values[key];
  }
  if (values['footer-title'] != null) request.showFooterTitle = values['footer-title'];
  if (values.output) request.output = values.output;
  if (values.strict) request.strict = true;

  return {
    mode: values['dry-run'] ? 'dry-run' : 'run',
    request,
  };
}

/**
 * `npm run test:e2e` is the command agents used to generate a PDF.
 * With a layout phrase it is the published print job. With no layout, and only
 * when the caller passed `--e2e`, it remains the visual-regression suite.
 * A workbench checkbox flag (`--mono`, `--no-mono`, `--no-footer-title`) is still
 * the printer, so the suite does not start.
 */
export function resolveE2eEntry(argv) {
  const parsed = parseCliArgs(argv);
  if (parsed.mode === 'help' || parsed.mode === 'describe' || parsed.mode === 'dry-run') {
    return { action: 'print' };
  }
  if (parsed.mode === 'error') {
    const msg = (parsed.errors || []).join('\n');
    if (/layout|per-page|字\/页|unknown job|conflicting layout|print-job|\bconfig\b|序号|选取|\brange\b|footer-title|\bmono\b/i.test(msg)) return { action: 'print' };
    if (argv.some((arg) => hasLayoutCue(unquoteToken(String(arg))) || parseLayoutToken(arg) != null)) return { action: 'print' };
    return { action: 'test' };
  }
  const req = parsed.request || {};
  const printish = ['layout', 'input', 'output', 'cols', 'rows', 'trace', 'limit', 'range', 'chars', 'job', 'strict', 'mono', 'showFooterTitle']
    .some((key) => req[key] != null && req[key] !== '');
  return { action: printish ? 'print' : 'test' };
}

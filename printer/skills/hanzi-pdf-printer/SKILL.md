---
name: hanzi-pdf-printer
description: >-
  Generate, configure, and verify US Letter Chinese character (Hanzi) practice-sheet
  and Tianzige worksheet PDFs using `printer/scripts/print-pdf.mjs`. Use this skill
  whenever the user asks to print or export Hanzi worksheets to PDF, run the printer
  CLI, select page layouts (`1..4` characters/page, `1..4 字/页`), customize Tianzige
  grids (`cols`/`每行`, `rows`/`总行`, `trace`/`描红`, `mono`/`黑白省墨`,
  `footer-title`/`页脚标题`), filter characters (`--range`/`序号`, `--limit`, `--chars`),
  or verify visual and semantic parity between CLI-generated PDFs and the `printer`
  webapp E2E test suite.
---

# Hanzi Practice-Sheet PDF Printer Skill

This skill teaches an AI agent how to deterministically generate US Letter (`8.5 × 11 in` / `612 × 792 pt`) Chinese character practice-sheet PDFs via `printer/scripts/print-pdf.mjs` and verify 100% visual and semantic parity against the browser workbench E2E pipeline (`printer/e2e/print.spec.mjs`).

---

## 0. Installation via `npx skills add`

This skill is compatible with the standard [`skills.sh`](https://skills.sh) ecosystem and can be installed into any supported agent (Antigravity, Cursor, Claude Code, Cline, etc.):

```bash
# Install to current project (.agents/skills/, .cursor/skills/, etc.)
npx skills add . -s hanzi-pdf-printer -y

# Install globally across all user agents
npx skills add . -s hanzi-pdf-printer -g -y

# Or install from remote GitHub repository
npx skills add <owner/repo> -s hanzi-pdf-printer -y
```

---

## 1. Critical Guardrails (Read First)

1. **Never use bare `npm run test:e2e` to generate a deliverable PDF**:
   - `npm run test:e2e` (with no layout argument) launches `printer/e2e/print.spec.mjs`, which runs 10 visual-regression tests on synthetic fixtures and writes test artifacts to `printer/e2e/output/`.
2. **Never append CLI flags (`--limit`, `--output`, `--dry-run`, `--describe`, `--cols`, etc.) to `npm run`**:
   - `npm` rejects flags like `--limit` or `--output` unless separated by `--`, and `npm` swallows `--dry-run` (`npm_config_dry_run`), causing `print-pdf.mjs` to only preview without writing a PDF.
   - Only use `npm --prefix <repo_root> run --silent print:layout-<1|2|3|4>` when running a **zero-flag** default published job.
   - Whenever any flag or custom path is needed, invoke `node` directly with `print-pdf.mjs`.
3. **Never hardcode `cols`, `rows`, or `trace` unless the user explicitly asks to override them**:
   - Omitting `--cols`, `--rows`, and `--trace` lets the workbench's own `SPECS` defaults from `printer/js/layout.js` apply automatically—matching what happens when a user clicks `1 字/页`..`4 字/页` in the UI toolbar.
4. **Distinguish Character Datasets (`--input`) from Print-Job Configs (`--config`)**:
   - A character dataset JSON has `groups` / `characters` (default: `printer/spec/data/hanzi-1000-v6.json`) → pass via `--input <path>`.
   - A print-job config JSON has `layout` and no `groups` (e.g. `printer/spec/print-job.example.json`) → pass via `--config <path>` (or as a positional argument), **never** via `--input`.

---

## 2. Standard 4-Step Workflow

### Step 1: Discover Canonical Schema & Absolute `argv` (`--describe`)

Locate the `print-pdf.mjs` script from the monorepo root (or inspect via `--describe`):

```bash
# From repository root:
node printer/scripts/print-pdf.mjs --describe

# Or from inside printer/ directory:
node scripts/print-pdf.mjs --describe
```

- `jobs[].argv` gives the cwd-independent `[node, "/abs/path/to/printer/scripts/print-pdf.mjs", "layout", "<N>"]` invocation that works from any working directory.
- `layouts["1".."4"].defaults` lists the exact workbench `cols`, `rows`, `trace`, `mono`, and `showFooterTitle` defaults.

### Step 2: Translate User Intent into Canonical CLI Flags

Always translate natural-language instructions, Chinese/English workbench labels, or legacy E2E phrasings into explicit canonical flags on `print-pdf.mjs`:

| Category | User Phrasing / Workbench Label | Canonical CLI Flag | Notes |
| :--- | :--- | :--- | :--- |
| **Layout (Required)** | `layout 3`, `3 字/页`, `3个字/页`, `每页3字`, `每页字数 3`, `3 per page`, `3 chars per page`, `chars per page 3`, `three Chinese characters on the page` | `--layout <1\|2\|3\|4>` | `1`, `2`, `3`, or `4` characters per US Letter page |
| **Dataset Input** | Omitted / default built-in 1000 chars (`hanzi-1000-v6.json`) | *(omit `--input`)* | Defaults to `printer/spec/data/hanzi-1000-v6.json` |
| **Custom Dataset** | Custom JSON with `groups` / `characters` | `--input <file.json>` | Relative paths check `cwd` first, then repo root |
| **Job Config File** | `printer/spec/print-job.example.json` or JSON with `layout` | `--config <job.json>` | Flags on CLI override values inside `--config` |
| **Index Range** | `序号 1-12`, `选取 1 - 24`, `range 1-12` | `--range <start-end>` | 1-based inclusive character index range in dataset order |
| **First N Chars** | `limit 6`, `前 24 个字` | `--limit <N>` | Shorthand for `--range 1-N` (mutually exclusive with `--range`) |
| **Specific Chars** | `只印 一,二,三` | `--chars <c1,c2,...>` | Prints matching characters in dataset order (mutually exclusive with `--range`/`--limit`) |
| **Grid Columns** | `每行 5`, `cols 5` | `--cols <N>` | Clamped to layout `minCols..maxCols`; omit for layout default |
| **Grid Rows** | `总行 3`, `rows 3` | `--rows <N>` | Clamped to what fits on page; omit for layout default |
| **Tracing Rows** | `描红 1`, `trace 1` | `--trace <N>` | Light-grey dashed centerline rows (`0..rows`); omit for default |
| **Monochrome** | `黑白省墨`, `开启 黑白省墨`, `将黑白省墨打开` | `--mono` / `--no-mono` | Default is `--no-mono` (colour themes active) |
| **Footer Title** | `关闭 页脚标题`, `把页脚标题关闭`, `页脚标题关闭`, `showFooterTitlefalse`, `showFooterTitle-off` | `--no-footer-title` / `--footer-title` | Default is `--footer-title` (shows `meta.title` in page footer) |
| **Output Path** | `-o <path>`, `--output <path>` | `--output <file.pdf>` | Default: `printer/output/<dataset>-layout-<N>[...].pdf`. Paths starting with `printer/` resolve from repo root; other relative paths resolve from `cwd`. |

For the complete natural-language alias table, layout `SPECS` limits, and JSON schemas, read [`references/cli-options-and-aliases.md`](./references/cli-options-and-aliases.md).

### Step 3: Run Pre-Flight Validation (`--dry-run`)

Before launching headless Chromium (especially on custom datasets or complex option combinations), run with `--dry-run`:

```bash
node printer/scripts/print-pdf.mjs \
  --layout 3 \
  --range 1-12 \
  --output /tmp/preview-check.pdf \
  --dry-run
```

Verify the JSON emitted on `stdout`:
- `"ok": true` and `"errors": []`
- `"selection": { "total": 1000, "selected": 12 }`
- `"expectedPages": 4`
- `"settings.effective"` matches the intended `cols`, `rows`, `trace`, `mono`, and `showFooterTitle`.

### Step 4: Generate the PDF & Inspect the Result

Run the command without `--dry-run`:

```bash
node printer/scripts/print-pdf.mjs \
  --layout 3 \
  --range 1-12 \
  --output /abs/or/relative/output.pdf
```

Confirm from the JSON output on `stdout`:
- `"ok": true`, `"dryRun": false`, and `"bytes" > 0`
- `"applied.selected"` equals `"selection.selected"`
- `"applied.pages"` equals `"expectedPages"`
- `"applied.settings.cellMm" >= 21.4` (for default large Tianzige layouts).

---

## 3. E2E Visual & Semantic Parity Verification

The PDF generated by `printer/scripts/print-pdf.mjs` uses the exact same Chromium `page.pdf(PDF_EXPORT)` pipeline (`format: 'Letter'`, `printBackground: true`, `preferCSSPageSize: true`) after `window.__hanziPrintPrepare()` as the webapp UI.

When asked to verify that an agent-generated PDF is in full visual and semantic parity with the webapp E2E test flow, use the bundled self-contained verifier [`scripts/verify-pdf-parity.mjs`](./scripts/verify-pdf-parity.mjs):

### Mode A: Generate Reference PDF via Live Webapp UI E2E & Compare Page-by-Page

Drives the real `printer/index.html` UI via Playwright (uploading dataset, clicking `[data-testid="per-page-N"]`, setting `#setting-cols`, `#setting-rows`, `#setting-trace`, `#setting-mono`, `#setting-footer-title`, and applying range/character selection), exports the E2E reference PDF into an isolated temp folder, and compares every page against `--agent-pdf`:

```bash
node ./scripts/verify-pdf-parity.mjs \
  --agent-pdf /tmp/agent-output.pdf \
  --run-webapp-e2e \
  --input printer/spec/data/hanzi-1000-v6.json \
  --layout 3 \
  --range 1-12 \
  --report-dir /tmp/parity-report
```

### Mode B: Compare Two Existing PDFs Directly

Compares an agent-generated PDF against an existing E2E-generated PDF:

```bash
node ./scripts/verify-pdf-parity.mjs \
  --agent-pdf /tmp/agent-output.pdf \
  --e2e-pdf /tmp/webapp-e2e.pdf \
  --report-dir /tmp/parity-report
```

### What `verify-pdf-parity.mjs` Verifies

1. **Semantic Parity (`pdfjs-dist`)**:
   - Identical `numPages`.
   - Every page has US Letter dimensions (`612 × 792 pt`, tolerance `< 1 pt`).
   - Embedded `LXGW WenKai` font (`/WenKai|g_d/i`) is present in both PDFs.
   - Normalized text stream and page number footer (`- p -`) match on every single page.
2. **Visual Screenshot Parity (`@napi-rs/canvas` + `pixelmatch`)**:
   - Renders every page (`1..N`) of both PDFs at `2×` scale (`1224 × 1584 px` PNG).
   - Writes `page-XX-agent.png`, `page-XX-e2e.png`, `page-XX-diff.png`, and `parity-report.json` to `--report-dir` (defaults to a fresh `os.tmpdir()` directory).
   - Asserts `mismatchRatio < 0.005` (`< 0.5%` pixel diff) on every page.

---

## 4. Subagent & Monorepo Isolation Rules

Whenever spawning subagents or running tests to evaluate PDF generation:
- **Workspace Isolation**: Use isolated subagent workspaces (`Workspace: "branch"`) so parallel or experimental runs cannot interfere with the primary working tree.
- **Output Isolation**: Always pass `--output /tmp/<unique-dir>/...` and `--report-dir /tmp/<unique-dir>/...` (via `os.tmpdir()`) during testing so `printer/output/`, `printer/e2e/output/`, and `git status` remain completely clean and idempotent.

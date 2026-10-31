# Hanzi Learning & Practice Suite (泡泡国学堂 & 汉字描红字帖打印工作台)

This repository houses two isolated applications for early Chinese literacy and handwriting practice:

1. **泡泡国学堂 · 听音找字 (`game/`)** — A single-file, zero-dependency interactive audio-recognition bubble game for young children (`game/qwen.html`, built to `game/build/index.html`).
2. **汉字描红字帖打印工作台 (`printer/`)** — An offline-capable web workbench for generating, customizing, and printing US Letter (8.5 × 11 in) Tianzige (田字格) handwriting practice sheets (`printer/index.html`).

---

## Quick Start

### Prerequisites
- **Node.js** (v20+ recommended; uses the built-in `node --test` runner)
- **Playwright Chromium** (only required for end-to-end PDF verification tests)
- **Python 3 + `fonttools` + `brotli`** (only required if regenerating the subsetted WOFF2 font via `npm run print:assets`)

Install dependencies:
```bash
npm install
```

### Key Commands

| Command | Application | Description |
| :--- | :--- | :--- |
| `npm run build` | **Game (`game/`)** | Validates module markers in `game/qwen.html` and copies it to `game/build/index.html`. |
| `npm run check:build` | **Game (`game/`)** | Exits non-zero if `game/build/index.html` is out of sync with `game/qwen.html`. |
| `npm test` | **Both** | Runs all unit tests across `game/tests/` and `printer/tests/` using `node --test`. |
| `npm run test:game` | **Game (`game/`)** | Runs only the 18 game unit test suites in `game/tests/`. |
| `npm run test:printer` | **Printer (`printer/`)** | Runs only the printer unit test suites in `printer/tests/`. |
| `npm run print:layout-3` | **Printer (`printer/`)** | Prints the app-published layout-3 job (3 characters per page, also `3 per page` / `chars per page 3` / `three Chinese characters on the page`; `chars per page 3` is not a `--chars` filter) from `printer/spec/data/hanzi-1000-v6.json` with workbench Tianzige defaults. `print:layout-2` is the same for 2 per page. No extra flags — npm rejects `--limit` and turns `--dry-run` into a preview that does not write a PDF. |
| `node printer/scripts/print-pdf.mjs --describe` | **Printer (`printer/`)** | Prints `jobs[].argv`, an absolute node command that works from any cwd, including `printer/`. Put `--limit`, `--output`, and `--dry-run` on that argv, not on npm. |
| `npm run print:dev` | **Printer (`printer/`)** | Starts a zero-dependency local dev server at `http://127.0.0.1:4173/printer/index.html`. |
| `npm run print:assets` | **Printer (`printer/`)** | Downloads and builds offline stroke shards, Fluent Emoji SVGs, and subsetted fonts into `printer/assets/`. |
| `npm run test:e2e` | **Printer (`printer/`)** | Visual regression only when no layout is given. `npm run test:e2e layout 3` (or `layout 2`) prints the published job instead — the old “run the e2e test, layout 3” instruction. One quoted argument, `run the end-to-end test to generate the PDF, layout 3`, is that same job (`example.instructionArgv` from `--describe`), not a missing filename. The same words as separate argv are that job too: a comma stuck to `PDF,` is glue, not a missing file. `序号 1-12` is the workbench picker, not a filename. `--no-footer-title` unchecks 页脚标题 and is a real flag, not an unknown option; `--footer-title false` and `setting-footer-title false` uncheck it too and are not a filename. `关闭 页脚标题` and `关闭页脚标题` uncheck it too and are not a file named 关闭. `把 页脚标题 关闭` and `把页脚标题关闭` put the verb after the label and are not a file named 把. `页脚标题关闭` and `页脚标题 关掉` are that checkbox with no 把 and are not a filename; a quoted `layout 3，页脚标题关闭` unchecks the box instead of leaving it on. `showFooterTitlefalse` and `offshowFooterTitle` are that checkbox with no separator and are not a filename; a quoted `layout 3，showFooterTitlefalse` unchecks the box instead of leaving it on. Separate argv `showFooterTitleoffline` and a bare `offline` are still filenames. A quoted `layout 3，showFooterTitleoffline` is not dropped and does not print with the footer left on. `no-mono` is still that flag. `showFooterTitle-off` and `setting-footer-title-off` are that checkbox with a hyphen before the verb and are not a filename; a quoted `layout 3，showFooterTitle-off` unchecks the box instead of leaving it on. Separate argv `showFooterTitle-offline` is still a filename. A quoted `layout 3，showFooterTitle-offline` is not dropped and does not print with the footer left on. `mono-off` unchecks 黑白省墨 the same way. `off-showFooterTitle` unchecks 页脚标题 with a hyphen before the label and is not a filename. A quoted `layout 3，off-showFooterTitle` unchecks the box; it does not leave the box on. `no-mono` is still that flag, not `no` plus a label. `offline` and `off-line` are still filenames. A quoted `layout 3，off-showFooterTitlexyz` is not dropped and does not print with the footer left on. Separate argv `showFooterTitle -off` is that same checkbox, not `-o` plus a file named `ff`, and it does not leave the box checked. A quoted `layout 3，showFooterTitle -off` unchecks the box too. A bare `-off` is still `-o ff`. Separate argv `showFooterTitle - off`, with the hyphen as its own word, is that same checkbox, not an unknown option `-`, and it does not leave the box checked. A quoted `layout 3，showFooterTitle - off` unchecks the box too. A bare `- off` with no label is still an unknown option. Separate argv `showFooterTitle -offline` is a filename, not output `ffline`. `offline-showFooterTitle` is not `off` plus a label. A quoted `layout 3，offline-showFooterTitle` is not dropped and does not print with the footer left on. Separate argv `offline-showFooterTitle` is still a filename. A bare `offline` is still a filename. A quoted `layout 3，offline-showFooterTitlexyz` is not dropped either. `offlineshowFooterTitle` is not `off` glued to a label. It has no hyphen. A quoted `layout 3，offlineshowFooterTitle` is not dropped and does not print with the footer left on. Separate argv `offlineshowFooterTitle` is still a filename. A quoted `layout 3，offlineshowFooterTitlexyz` is not dropped either. `off-line-showFooterTitle` is not `off` plus a label. The hyphen is immediate, then junk, then the label. A quoted `layout 3，off-line-showFooterTitle` is not dropped and does not print with the footer left on. Separate argv `off-line-showFooterTitle` is still a filename. A quoted `layout 3，off-line-showFooterTitlexyz` is not dropped either. `off-lineshowFooterTitle` has no second hyphen. A quoted `layout 3，off-lineshowFooterTitle` is not dropped and does not print with the footer left on. `off-line` and `off-monochrome` are still filenames. `chars per page 3` and `--chars per page 3` are that layout phrase, not a `--chars` filter and not a file named page. A checkbox flag with no layout is still the printer, not this suite. |
| `npm run test:e2e:cli` | **Printer (`printer/`)** | Checks the print CLI against that same e2e browser print path. |

---

## Repository Directory Structure

The repository isolates the two applications into dedicated top-level directories (`game/` and `printer/`):

```text
.
├── package.json              # Root workspace scripts & shared devDependencies
├── .gitignore                # Ignores generated build/output/cache directories
├── README.md                 # Repository overview and navigation guide
│
├── game/                     # App 1: 泡泡国学堂 (Single-file interactive literacy game)
│   ├── qwen.html             # Single-file source of truth for 泡泡国学堂
│   ├── gemini.html           # Earlier prototype ("汉字大冒险") kept for reference
│   ├── build.mjs             # Verifies module markers in qwen.html & outputs game/build/index.html
│   ├── build/
│   │   └── index.html        # Generated static deployable artifact (gitignored)
│   └── tests/                # 18 unit test suites slicing marker blocks out of qwen.html
│       ├── board.test.js
│       ├── faces.test.js
│       ├── fullscreen.test.js
│       ├── help.test.js
│       ├── hit.test.js
│       ├── hud.test.js
│       ├── ink.test.js
│       ├── inset.test.js
│       ├── learned.test.js
│       ├── locked.test.js
│       ├── pace.test.js
│       ├── palette.test.js
│       ├── pinyin.test.js
│       ├── praise.test.js
│       ├── prompt.test.js
│       ├── pulse.test.js
│       ├── review.test.js
│       ├── score.test.js
│       ├── tap.test.js
│       └── voice.test.js
│
└── printer/                  # App 2: 汉字描红字帖打印工作台 (US Letter worksheet generator)
    ├── package.json          # Marks printer/ as ESM ("type": "module")
    ├── index.html            # Workbench UI entry point (US Letter 3-column layout)
    ├── css/                  # Design tokens (tokens.css), workbench UI (app.css), & @media print rules (sheet.css)
    ├── js/                   # Modular ESM source (main, layout, schema, store, preview, editor, print, etc.)
    ├── data/                 # Curated 1000-char illustration mappings & Fluent Emoji search catalog
    ├── assets/               # Offline-vendored assets: Make Me a Hanzi shards, SVG emojis, & LXGW WenKai font subset
    ├── spec/                 # Specifications & character datasets
    │   ├── data/             # 1000-character datasets (hanzi-1000-v1..v6.json, hanzi-seed.json)
    │   └── example-ui-design/# Reference UI/sheet design images (.avif)
    ├── scripts/              # Printer tooling scripts
    │   ├── print-pdf.mjs     # Agent CLI: layout (+ optional JSON) → US Letter PDF via page.pdf()
    │   ├── serve.mjs         # Zero-dependency static HTTP server for development and E2E tests
    │   └── print-assets.mjs  # Offline asset pipeline (Make Me a Hanzi + Fluent Emoji + font subsetter)
    ├── tests/                # Printer unit tests
    │   ├── print-layout.test.js  # US Letter geometry & pagination tests
    │   └── print-schema.test.js  # Dataset validation, overrides, & illustration resolution tests
    └── e2e/                  # End-to-End PDF verification suite
        ├── print.spec.mjs    # Playwright + pdfjs-dist + pixelmatch PDF inspection tests
        ├── helpers/pdf.mjs   # PDF text extraction, rasterization, and connected-component blob analysis
        ├── golden/           # Committed visual regression baseline PNGs for 1/2/3/4 chars-per-page
        └── output/           # Generated test PDFs and PNG renders (gitignored)
```

---

## How Each Application Works

### 1. 泡泡国学堂 (`game/`) — Single-File Literacy Game

**Architecture:**
- The entire application (HTML, CSS, SVG scene, Web Audio synthesizer, Web Speech / neural TTS engine, and 12-level vocabulary pool) lives inside [`game/qwen.html`](file:///Users/gjiang/developments/garukun/games/hanzi/game/qwen.html).
- Internal subsystems are structured as self-contained IIFE modules wrapped in comment markers:
  - `PALETTE` — WCAG-verified bubble color pairs and contrast calculations
  - `VOICE ENGINE` — Keyless neural TTS ladder with Web Speech API fallback and audio prefetching
  - `FACES` / `PRAISE` / `PROMPT` / `PACE` — Pedagogical pacing, streak celebrations, and visual feedback
  - `BOARD` / `HIT` — Viewport-adaptive bubble radius calculation, lattice-fallback non-overlapping spawn placement, and touch hit-testing
  - `LEARNED` / `PULSE` / `SCORE` / `REVIEW` / `HELP` / `FULLSCREEN` — HUD state, star ratings, and learned-word review drawer
  - `PINYIN` — Tone-mark validation and hint/reveal formatting

**How Testing & Building Works:**
- Unit tests in `game/tests/*.test.js` read [`game/qwen.html`](file:///Users/gjiang/developments/garukun/games/hanzi/game/qwen.html) as text, slice out the code between `/* ==== <MODULE> START ==== */` and `/* ==== <MODULE> END ==== */`, and evaluate the module inside a clean Node `vm` context.
- [`game/build.mjs`](file:///Users/gjiang/developments/garukun/games/hanzi/game/build.mjs) asserts that every start/end marker is intact (preventing silent test coverage gaps) before copying `game/qwen.html` to `game/build/index.html`.

---

### 2. 汉字描红字帖打印工作台 (`printer/`) — Practice-Sheet Workbench

**Generate a PDF:** `npm run print:layout-3` (or `print:layout-2`). The workbench button label is the same job: `3 字/页`. So are `3个字/页`, the group label `每页字数 3` (aria-label on that control), `3 per page`, `3 chars per page`, `chars per page 3`, and `three Chinese characters on the page` (`jobs[].phrases` from `--describe`). `chars per page 3` is not a `--chars` filter and not a file named page; `--chars 一,二` still selects those characters. The app supplies the example dataset (`printer/spec/data/hanzi-1000-v6.json`) and that layout's Tianzige defaults — do not invent cols/rows/trace. If the instruction is still “run the e2e test, layout 3”, `npm run test:e2e layout 3` prints that job; `npm run test:e2e` with no layout is visual regression only. Do not append flags to those npm scripts: npm rejects `--limit`. If npm consumes `--dry-run`, the CLI previews and does not write the PDF. `node printer/scripts/print-pdf.mjs --describe` prints `jobs[].argv`, an absolute command that works from any working directory; add `--limit`, `--output`, or `--dry-run` there. A quoted `"layout 3"` is the same published job, not a filename. So is the old instruction split into argv words: a comma stuck to `PDF,` or `file,` is glue, and a comma stuck to `printer/spec/data/hanzi-1000-v6.json,` is that file. Options inside that sentence (`--limit 6`, `cols 5`, `每行 5`) and Chinese wording such as `跑端到端测试生成 PDF，layout 3` are the same job, not a missing file. The same option words as separate argv (`layout 3 limit 6`, `3 字/页 每行 5`, `黑白省墨`) are configuration too, not a missing file. The workbench 序号 picker is `--range`: `序号 1-12` and `选取 1 - 6` (that hyphen is not an option). A bare 选取 does not change the selection. `--no-mono` and `--no-footer-title` are the workbench checkboxes as real flags, not unknown options; `--no-footer-title` unchecks 页脚标题 (default on). `--footer-title false`, `--mono=off`, and `showFooterTitle false` uncheck the box too. They are not a filename and do not leave it checked. A bare `false` is still a filename. `关闭 页脚标题`, `关闭页脚标题`, and `turn off 页脚标题` uncheck 页脚标题 and are not a file named 关闭; `开启 黑白省墨` checks 黑白省墨. A bare `关闭` is still a filename. `把 页脚标题 关闭`, `把页脚标题关闭`, and `turn 页脚标题 off` put the verb after the label and are not a file named 把; `把 页脚标题` without a verb still leaves 把 as a filename. `页脚标题关闭`, `页脚标题 关掉`, and `黑白省墨打开` are that checkbox with no 把; a quoted `layout 3，页脚标题关闭` unchecks the box instead of leaving it on. A bare `关掉` is still a filename. `showFooterTitlefalse` and `offshowFooterTitle` are that checkbox with no separator and are not a filename; a quoted `layout 3，showFooterTitlefalse` unchecks the box instead of leaving it on. Separate argv `showFooterTitleoffline` and a bare `offline` are still filenames. A quoted `layout 3，showFooterTitleoffline` is not dropped and does not print with the footer left on. `monooff` unchecks 黑白省墨 the same way. `no-mono` is still that flag. `showFooterTitle-off` and `setting-footer-title-off` are that checkbox with a hyphen before the verb and are not a filename; a quoted `layout 3，showFooterTitle-off` unchecks the box instead of leaving it on. Separate argv `showFooterTitle-offline` is still a filename. A quoted `layout 3，showFooterTitle-offline` is not dropped and does not print with the footer left on. `mono-off` unchecks 黑白省墨 the same way. `off-showFooterTitle` unchecks 页脚标题 with a hyphen before the label and is not a filename. A quoted `layout 3，off-showFooterTitle` unchecks the box; it does not leave the box on. `no-mono` is still that flag, not `no` plus a label. `offline` and `off-line` are still filenames. A quoted `layout 3，off-showFooterTitlexyz` is not dropped and does not print with the footer left on. Separate argv `showFooterTitle -off` is that same checkbox, not `-o` plus a file named `ff`, and it does not leave the box checked. A quoted `layout 3，showFooterTitle -off` unchecks the box too. A bare `-off` is still `-o ff`. Separate argv `showFooterTitle - off`, with the hyphen as its own word, is that same checkbox, not an unknown option `-`, and it does not leave the box checked. A quoted `layout 3，showFooterTitle - off` unchecks the box too. A bare `- off` with no label is still an unknown option. Separate argv `showFooterTitle -offline` is a filename, not output `ffline`. `offline-showFooterTitle` is not `off` plus a label. A quoted `layout 3，offline-showFooterTitle` is not dropped and does not print with the footer left on. Separate argv `offline-showFooterTitle` is still a filename. A bare `offline` is still a filename. A quoted `layout 3，offline-showFooterTitlexyz` is not dropped either. `offlineshowFooterTitle` is not `off` glued to a label. It has no hyphen. A quoted `layout 3，offlineshowFooterTitle` is not dropped and does not print with the footer left on. Separate argv `offlineshowFooterTitle` is still a filename. A quoted `layout 3，offlineshowFooterTitlexyz` is not dropped either. `off-line-showFooterTitle` is not `off` plus a label. The hyphen is immediate, then junk, then the label. A quoted `layout 3，off-line-showFooterTitle` is not dropped and does not print with the footer left on. Separate argv `off-line-showFooterTitle` is still a filename. A quoted `layout 3，off-line-showFooterTitlexyz` is not dropped either. `off-lineshowFooterTitle` has no second hyphen. A quoted `layout 3，off-lineshowFooterTitle` is not dropped and does not print with the footer left on. `off-line` and `off-monochrome` are still filenames. `printer/spec/print-job.example.json` is that configuration and can be passed as the argument (same as `--config`); the bare name `print-job.example.json` is that file from any cwd. A character dataset such as `hanzi-1000-v6.json` stays an input, and that bare name is the published example file from any cwd (a same-named file in the cwd wins). `printer/...` paths in the example job resolve from the repo root. The e2e suite only checks the browser print path.

**Architecture:**
- Written in vanilla ES Modules (`printer/js/*.js`) with zero runtime framework dependencies.
- **Data & Schema ([`printer/js/schema.js`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/js/schema.js)):** Loads up to 1,000 characters grouped by category (defaults to [`printer/spec/data/hanzi-1000-v6.json`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/spec/data/hanzi-1000-v6.json)). Validates duplicates, missing pinyin, and example words.
- **Stroke & Radical Shards ([`printer/js/hanzi-data.js`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/js/hanzi-data.js)):** Character stroke paths and Kangxi radicals from *Make Me a Hanzi* are pre-sharded by `(codePoint >> 6).toString(16)` into `printer/assets/hanzi/<hex>.json` for instant offline lookup, with a CDN fallback (`hanzi-writer-data`) for rare characters.
- **Illustrations ([`printer/js/illustration.js`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/js/illustration.js)):** Every character resolves to a visual aid on its practice card:
  1. Custom user override (`upload` PNG, `emoji` + count, or `glyph`),
  2. Curated mapping in [`printer/data/illustrations.json`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/data/illustrations.json) backed by offline-vendored Microsoft Fluent Emoji Flat SVGs (`printer/assets/emoji/*.svg`), or
  3. 3D sticker color-glyph fallback.
- **US Letter Page Geometry ([`printer/js/layout.js`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/js/layout.js) & [`printer/css/sheet.css`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/css/sheet.css)):** Supports 1, 2, 3, or 4 characters per US Letter page (`215.9mm × 279.4mm` / `612pt × 792pt`), dynamically sizing progressive stroke-order ribbons and Tianzige (田字格) grids (red model glyph in column 0, configurable light-grey tracing rows, and blank practice rows).
- **State & Persistence ([`printer/js/store.js`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/js/store.js) & [`printer/js/editor.js`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/js/editor.js)):** Per-character edits (pinyin, words, radical, stroke count, emoji/image swap) are keyed by dataset hash in IndexedDB/localStorage and can be exported back into a standalone merged JSON file.

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
| `npm run print:dev` | **Printer (`printer/`)** | Starts a zero-dependency local dev server at `http://127.0.0.1:4173/printer/index.html`. |
| `npm run print:assets` | **Printer (`printer/`)** | Downloads and builds offline stroke shards, Fluent Emoji SVGs, and subsetted fonts into `printer/assets/`. |
| `npm run test:e2e` | **Printer (`printer/`)** | Launches headless Chromium via Playwright to render, export, and pixel-verify US Letter PDFs (`printer/e2e/print.spec.mjs`). |

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

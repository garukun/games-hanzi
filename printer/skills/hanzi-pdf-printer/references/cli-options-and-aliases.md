# CLI Options, Layout Defaults & Natural-Language Alias Reference

This reference documents the complete option surface of [`printer/scripts/print-pdf.mjs`](../../../scripts/print-pdf.mjs) and [`printer/js/print-config.js`](../../../js/print-config.js).

---

## 1. Layout `SPECS` Defaults & Limits

Defined in [`printer/js/layout.js`](../../../js/layout.js). When `--cols`, `--rows`, or `--trace` are omitted, the workbench automatically applies these per-layout defaults:

| Layout (`--layout`) | Workbench Button | Orientation / Card Mode | Default `cols` (`每行`) | Allowed `cols` (`min..max`) | Default `rows` (`总行`) | Default `trace` (`描红`) | Max Words (`budget`) | Default Cell Size |
| :---: | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **`1`** | `1 字/页` | Full page (`col` / `wide` card) | `6` | `2..12` | `4` | `2` | `3` (`10` chars) | `~29.66 mm` |
| **`2`** | `2 字/页` | Side-by-side 2 columns (`col` / `tall` card) | `4` | `2..10` | `6` | `2` | `2` (`8` chars) | `~21.71 mm` |
| **`3`** | `3 字/页` | 3 horizontal bands (`row` / left info + right grid) | `5` | `2..10` | `3` | `1` | `2` (`6` chars) | `~21.86 mm` |
| **`4`** | `4 字/页` | `2 × 2` quad grid (`col` / `tall` card) | `4` | `2..10` | `3` | `1` | `2` (`8` chars) | `~21.45 mm` |

- **Default Checkboxes (all layouts)**:
  - `mono` (`黑白省墨`): `false` (rotates 4 colour themes: blue, orange, green, purple)
  - `showFooterTitle` (`页脚标题`): `true` (renders `meta.title` in the bottom-left footer of each page)

---

## 2. Canonical CLI Flags vs. Supported Phrases & Aliases

While [`print-config.js`](../../../js/print-config.js) parses all of the phrases below (whether passed as separate `argv` tokens or inside a single quoted instruction), **agents should translate them to the canonical flags in the right-hand column**:

### 2.1 Layout Phrases
| Accepted Input Forms in `print-config.js` | Canonical Flag |
| :--- | :--- |
| `layout 3`, `"layout 3"`, `layout=3`, `layout:3`, `layout-3`, `layout_3`, `layout3`, `--job layout-3`, `print:layout-3`, `3` | `--layout 3` |
| `3 字/页`, `3个字/页`, `每页3字`, `每页 3 个字`, `3字每页`, `每页字数 3`, `aria-label="每页字数" 3` | `--layout 3` |
| `per-page 3`, `data-per-page=3`, `3-per-page`, `3 per page` | `--layout 3` |
| `3 chars per page`, `chars per page 3`, `--chars per page 3`, `3 characters per page` | `--layout 3` |
| `three per page`, `layout three`, `three Chinese characters on the page`, `三字/页` | `--layout 3` |
| `"run the end-to-end test to generate the PDF, layout 3"`, `"跑端到端测试生成 PDF，layout 3"` | `--layout 3` |

*(Works identically for `1`/`one`/`一`, `2`/`two`/`二`, `3`/`three`/`三`, and `4`/`four`/`四`.)*

### 2.2 Grid & Selection Phrases
| Accepted Input Forms in `print-config.js` | Canonical Flag |
| :--- | :--- |
| `--cols 5`, `cols 5`, `cols=5`, `每行 5`, `每行=5`, `每行 五` | `--cols 5` |
| `--rows 3`, `rows 3`, `rows=3`, `总行 3`, `总行=3` | `--rows 3` |
| `--trace 1`, `trace 1`, `trace=1`, `描红 1`, `描红=1` | `--trace 1` |
| `--range 1-12`, `range 1-12`, `序号 1-12`, `序号 1 - 12`, `选取 1-12`, `选取 1 - 12` | `--range 1-12` |
| `--limit 6`, `limit 6`, `limit=6` | `--limit 6` |
| `--chars 一,二,三`, `chars 一,二,三` | `--chars 一,二,三` |

### 2.3 Workbench Checkboxes (`mono` & `footer-title`)
| Accepted Input Forms in `print-config.js` | Canonical Flag |
| :--- | :--- |
| `--mono`, `--mono true`, `--mono=on`, `mono`, `黑白省墨`, `开启 黑白省墨`, `打开 黑白省墨`, `将 黑白省墨 打开`, `黑白省墨打开`, `setting-mono true` | `--mono` |
| `--no-mono`, `--mono false`, `--mono=off`, `no-mono`, `黑白省墨 off`, `关闭 黑白省墨`, `把 黑白省墨 关闭`, `monooff`, `offmono`, `mono-off`, `off-mono`, `setting-mono-off` | `--no-mono` |
| `--footer-title`, `--footer-title true`, `--footer-title=on`, `页脚标题`, `开启 页脚标题`, `显示 页脚标题` | `--footer-title` |
| `--no-footer-title`, `--footer-title false`, `--footer-title=off`, `页脚标题 off`, `关闭 页脚标题`, `关闭页脚标题`, `不显示 页脚标题`, `uncheck 页脚标题`, `turn off 页脚标题`, `关闭 在页脚显示字库标题`, `把 页脚标题 关闭`, `把页脚标题关闭`, `turn 页脚标题 off`, `页脚标题关闭`, `页脚标题 关掉`, `页脚标题off`, `showFooterTitle false`, `showFooterTitlefalse`, `offshowFooterTitle`, `showFooterTitle-off`, `setting-footer-title-off`, `off-showFooterTitle`, `showFooterTitle -off`, `showFooterTitle - off` | `--no-footer-title` |

---

## 3. Input & Output Path Resolution Rules

1. **Input Dataset (`--input`) & Config (`--config`)**:
   - Absolute paths are used directly.
   - Relative paths are checked relative to `process.cwd()` first, then relative to `REPO_ROOT`.
   - Published bare filenames (`hanzi-1000-v6.json`, `spec/data/hanzi-1000-v6.json`, `print-job.example.json`) resolve automatically from `printer/spec/data/` or `printer/spec/` if no same-named file exists in `process.cwd()`.
2. **Output PDF (`--output`)**:
   - Omitted: writes to `<REPO_ROOT>/printer/output/<inputBase>-layout-<N>[-r<start>-<end>|-chars<count>].pdf`.
   - Starts with `printer/` (e.g. `printer/output/custom.pdf`): always anchored to `<REPO_ROOT>` regardless of `process.cwd()`, preventing `printer/printer/output/...` when invoked from inside `printer/`.
   - Any other relative path (e.g. `./out.pdf` or `out.pdf`): resolved relative to `process.cwd()`.
   - Absolute path (e.g. `/tmp/hanzi-job/out.pdf`): used as-is.

---

## 4. JSON Schemas

### 4.1 Character Dataset JSON (`--input`)
Must contain `groups` (or top-level `characters`):

```json
{
  "meta": {
    "title": "端到端测试字帖（12字全类型覆盖）",
    "description": "可选描述"
  },
  "groups": [
    {
      "category": "1. 测试生字组",
      "characters": [
        { "char": "一", "pinyin": "yī", "words": ["一个", "一天", "一月", "一生"] },
        { "char": "四", "pinyin": "sì", "words": ["四季", "四方", "四个", "四月"] }
      ]
    }
  ]
}
```

### 4.2 Print-Job Configuration JSON (`--config`)
Must contain `layout` (or `perPage` / `job`) and **no** `groups` or `characters` array (see [`printer/spec/print-job.example.json`](../../../spec/print-job.example.json)):

```json
{
  "input": "printer/spec/data/hanzi-1000-v6.json",
  "layout": 3,
  "limit": 24,
  "cols": 5,
  "rows": 3,
  "trace": 1,
  "mono": false,
  "showFooterTitle": true,
  "output": "printer/output/hanzi-1000-v6-layout-3.pdf"
}
```
*(Any explicit CLI flags passed alongside `--config` override the corresponding keys in the config file.)*

---

## 5. Exit Codes & Diagnostics

| Exit Code | Meaning | Typical Cause |
| :---: | :--- | :--- |
| **`0`** | Success | PDF written (or `--dry-run` / `--describe` / `--help` succeeded) |
| **`2`** | CLI Usage / Config Error | Missing `--layout`, conflicting flags (`--mono` + `--no-mono`, `--range` + `--limit`, `--chars` + `--range`), unknown option, or missing `--input` / `--config` file |
| **`3`** | Dataset / Selection Validation Error | Malformed dataset JSON (`INVALID_JSON`), `0` characters selected (`no characters selected`), or `--strict` triggered on dataset validation issues |
| **`1`** | Runtime Execution Error | Chromium launch failure or DOM rendering timeout |

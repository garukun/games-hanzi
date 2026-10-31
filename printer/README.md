# 汉字字帖打印工作台 (`printer/`)

面向低龄儿童的汉字启蒙字帖生成与打印工具。支持 **US Letter (8.5 × 11 in)** 纸张排版、**1 / 2 / 3 / 4 字每页** 密度切换、**大号稀疏田字格（可调列数/行数）**、**分步笔顺丝带**、**淡灰虚线单线描红** 以及 **全离线 PDF 打印导出**。

---

## 1. 目录与文件命名说明

项目结构采用自解释的语义化目录与文件名，避免晦涩的编码缩写：

```text
printer/
├── index.html                          # 打印工作台主入口页面
├── package.json                        # NPM 脚本配置（启动服务、构建资源、单元与 E2E 测试）
├── css/
│   └── print.css                       # 屏幕工作台 UI 样式 + @media print 精确毫米级打印样式
├── js/
│   ├── main.js                         # 应用入口：状态绑定、工具栏交互、打印触发与模态框控制
│   ├── layout.js                       # US Letter 页面几何计算（1~4字/页布局、田字格尺寸与间距）
│   ├── render-sheet.js                 # 字帖 SVG/HTML 渲染器（范字、笔顺丝带、淡灰虚线描红、空白田字格）
│   ├── hanzi-data.js                   # 汉字笔画与中轴线双层按需加载器（Core 1000 + Extended GB2312）
│   ├── illustration.js                 # 汉字配图解析器（Fluent Emoji SVG 图标或彩色字形回退）
│   ├── schema.js                       # 字库 JSON 校验、解析与自定义覆盖导出
│   └── store.js                        # localStorage 本地持久化（排版设置、自定义字库与单字微调）
├── spec/
│   └── data/
│       └── hanzi-1000-v6.json          # 内置核心启蒙字库（1,000 个高频汉字、拼音、组词、分类）
├── data/
│   ├── illustrations.src.txt           # 1,000 字配图人工映射源文件（可读文本格式，供开发维护）
│   ├── illustrations.json              # 构建生成的汉字 -> Emoji ID 映射表
│   └── emoji-catalog.json              # 内置 Emoji 搜索选择器目录（含中英文关键词）
├── assets/
│   ├── strokes/                        # 【汉字笔画与虚线中轴线离线数据包】（见第 2、3 节详解）
│   │   ├── hanzi-strokes-core-1000.json        # Tier 1：内置 1,000 核心字笔画包（首屏仅加载此文件）
│   │   └── hanzi-strokes-extended-gb2312.json  # Tier 2：其余 2,757 个 GB2312 一级汉字扩展包（按需懒加载）
│   ├── emoji/                          # 离线矢量配图（Fluent Emoji Flat SVG，如 pineapple.svg）
│   └── fonts/
│       └── LXGWWenKai-subset.woff2     # 霞鹜文楷子集字体（覆盖 GB2312 + 拼音符号，供标题/组词/回退使用）
├── scripts/
│   ├── print-pdf.mjs                   # 字帖 PDF CLI（layout + 可选 JSON → Chromium page.pdf()）
│   ├── serve.mjs                       # 零依赖本地静态开发服务器（内置 Gzip 动态压缩）
│   └── print-assets.mjs                # 离线资产打包脚本（从 Make Me a Hanzi / Fluent Emoji 生成数据包）
├── tests/                              # Node 单元测试（版面几何、田字格尺寸、字库校验、双层笔画加载）
└── e2e/                                # Playwright + Chromium 真实 PDF 打印与像素级视觉回归测试
```

---

## 2. 为什么除了 `.woff2` 字体，还需要 `assets/strokes/*.json`？

普通字体文件（如 `LXGWWenKai-subset.woff2`）只包含每个汉字合成后的**整体外轮廓**，无法得知“第一笔写哪、第二笔写哪”以及“每一笔的书写走向”。

而在儿童字帖的打印页面中，有三项核心教学元素依赖**逐笔矢量数据**（源自开源项目 [Make Me a Hanzi](https://github.com/skishore/makemeahanzi)）：

1. **分步笔顺丝带（Progressive Stroke-Order Ribbon）**：
   顶部的笔顺分解格需要按 `1..N` 步逐笔累加渲染：第 `k` 格将前 `k-1` 笔涂成浅灰，第 `k` 笔高亮为深墨色，帮助孩子看清每一笔的先后顺序。
2. **单线虚线描红（Light-Grey Dashed Centerline Tracing）**：
   字体轮廓一旦加上 `stroke-dasharray`，会在笔画四周画出“空心双线虚线框”，低龄儿童极易把一笔描成两笔。因此我们在构建阶段对每笔的骨架点（Medians）进行去毛刺与二次贝塞尔平滑（[`cleanStrokeMedians`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/js/hanzi-data.js#L30-L81) + [`smoothMedianToPath`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/js/hanzi-data.js#L84-L110)），生成单条中心引导路径 `m`，实现**极浅字形底衬 + 淡灰圆头单线虚线**的科学描红效果。
3. **部首与精确笔画数元数据**：
   提供每个字的康熙部首（`r`）与总笔画数（`n`）。

### 单字数据结构注解

```json
{
  "人": {
    "s": [
      "M 526 710 Q 546 730 ... Z",
      "M 472 511 Q 599 361 ... Z"
    ],
    "m": [
      "M 521 756 Q 536 720 490 618 ... L 114 148",
      "M 475 489 Q 577 353 696 239 ... L 921 142"
    ],
    "r": "人",
    "n": 2
  }
}
```

- `s` (**strokes**)：每一笔的闭合外轮廓 SVG `<path d="...">`（坐标空间 `1024 × 1024`），用于范字、笔顺丝带及描红极浅底影。
- `m` (**medians**)：每一笔平滑后的**单线中心轨迹** SVG `<path d="...">`，用于田字格内的**淡灰虚线描红引导线**。
- `r` (**radical**)：部首（如 `"人"`）。
- `n` (**number of strokes**)：总笔画数（如 `2`）。

---

## 3. 打包策略与离线使用的 Performance Analysis（性能对比分析）

我们对汉字笔画数据的 **4 种打包与分片方案** 进行了实测对比（覆盖内置 1,000 核心字 + 2,757 个 GB2312 扩展字，共计 **3,757 个汉字**）：

| 方案 | 仓库文件数 | 文件名可读性 | 首屏 HTTP 请求数 | 首屏原始传输量 | 首屏 Gzip 传输量 | JSON 解析耗时 | 离线可用性 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **方案 A：旧版 Unicode 16 进制分片**<br>(`assets/hanzi/138.json`..`27d.json`) | 297 个 | ❌ 差（16进制码位难以直观理解） | **242 次请求** | **8.58 MB**<br>*(含 71% 无关字浪费)* | ~3.40 MB | ~28 ms + 242 次 I/O 调度 | ✅ 3,757 字离线 |
| **方案 B：单字单文件**<br>(`assets/strokes/人.json` 等) | 3,757 个 | ⚠️ 文件过多，Git 树膨胀 | **1,000 次请求** | 2.49 MB | ~1.15 MB | 浏览器连接池严重队头阻塞 | ✅ 3,757 字离线 |
| **方案 C：全量单文件包**<br>(`hanzi-strokes-all.json`) | 1 个 | ✅ 直观 | 1 次请求 | 10.36 MB | 4.09 MB | ~31 ms | ✅ 3,757 字离线 |
| **方案 D（当前采用）：双层词频分层包**<br>(`core-1000` + `extended-gb2312`) | **2 个** | ✅ **语义清晰直观** | **1 次请求** | **2.49 MB**<br>*(减少 71%)* | **0.99 MB**<br>*(Brotli 0.82 MB)* | **~8 ms** | ✅ **3,757 字全离线** + CDN 兜底 |

### 核心结论：为什么旧版 296 个 Hex 分片反而更慢？

1. **Unicode 编码局部性陷阱（Locality Failure）**：
   Unicode 中日韩统一表意文字（`U+4E00`–`U+9FA5`）是按**康熙字典部首 + 笔画数**排列的，而非按常用字词频排列。内置字库 `hanzi-1000-v6.json` 的 1,000 个常用字均匀散落在 **296 个分片中的 242 个文件（占 81.8%）** 里。
2. **放大 3.4 倍的无效传输与请求风暴**：
   启动加载默认 1,000 字时，旧方案发起了 **242 个并发请求**，把散落在这些分片里的生僻字一并拉取下来，实际下载了 **8.58 MB** 数据才拿到所需的 **2.49 MB** 常用字数据。
3. **双层词频分层（Tiered Frequency Split）兼顾开发可读性与生产极致性能**：
   - **第一层 [`hanzi-strokes-core-1000.json`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/assets/strokes/hanzi-strokes-core-1000.json)**：精确对应 `spec/data/hanzi-1000-v6.json` 的 1,000 个启蒙汉字。应用启动只需 **1 次请求**，配合 [`scripts/serve.mjs`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/scripts/serve.mjs) 的 Gzip 传输仅 **0.99 MB**，内存 `JSON.parse` 仅需 **~8 ms**。
   - **第二层 [`hanzi-strokes-extended-gb2312.json`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/assets/strokes/hanzi-strokes-extended-gb2312.json)**：包含其余 **2,757 个 GB2312 一级汉字**。默认启动时 **0 字节加载**；仅当家长或老师导入自定义字表且包含核心 1,000 字以外的汉字时，才由 [`ensureHanziData`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/js/hanzi-data.js#L207-L263) 自动懒加载一次。
   - **第三层 CDN 与字体回退**：若遇到超出 3,757 字范围的罕见字，在线环境下自动查询 `hanzi-writer-data` CDN，完全断网时无缝回退至内嵌的 `LXGWWenKai` 楷体字形渲染，确保任何情况下打印不中断。

---

## 4. 开发环境 vs. 生产/使用环境工作流

### 开发环境（侧重可读性与可调试性）

- **可读源文件**：
  - 核心字库配置：[`spec/data/hanzi-1000-v6.json`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/spec/data/hanzi-1000-v6.json)（格式化缩进 JSON，直观查看分组、拼音与词组）。
  - 配图映射表：[`data/illustrations.src.txt`](file:///Users/gjiang/developments/garukun/games/hanzi/printer/data/illustrations.src.txt)（纯文本 `汉字:emoji*数量` 语法，支持 `#` 注释）。
- **格式化输出笔画 JSON（便于排查特定汉字的笔画与虚线轨迹）**：
  ```bash
  npm --prefix printer run build:strokes:pretty
  # 等价于：node printer/scripts/print-assets.mjs strokes --pretty
  ```
  该命令会将 `assets/strokes/hanzi-strokes-core-1000.json` 与 `hanzi-strokes-extended-gb2312.json` 以 2 空格缩进格式输出，方便直接用编辑器搜索任意汉字（如 `"水"`）查看其 `s` 与 `m` 路径。

### 打印 PDF（给人或 AI agent 的 CLI）

字帖 PDF 仍由工作台页面经 Chromium `page.pdf()` 导出，选项与 `e2e/print.spec.mjs` 相同（`format: Letter`、`printBackground`、`preferCSSPageSize`），不另写一套渲染器。排版默认值来自应用自身的 `js/layout.js`，用 `--describe` 查看，不要手写。

```bash
# 仓库根目录：无额外参数的已发布任务。应用自己提供字库和田字格默认值。
npm run print:layout-3
npm run print:layout-2
# 工作台按钮「3 字/页」和旧指令「跑 e2e，layout 3」是同一个已发布任务：
npm run test:e2e layout 3
node printer/scripts/print-pdf.mjs "3 字/页" --limit 24 --dry-run
# 拆开的应用选项同样不是文件名：layout 3 limit 6、3 字/页 每行 5、黑白省墨、序号 1-12
node printer/scripts/print-pdf.mjs layout 3 limit 6 --dry-run
node printer/scripts/print-pdf.mjs "3 字/页" 每行 5 黑白省墨 --dry-run
node printer/scripts/print-pdf.mjs layout 3 序号 1 - 12 --dry-run
node printer/scripts/print-pdf.mjs layout 3 --no-footer-title --dry-run
node printer/scripts/print-pdf.mjs layout 3 关闭 页脚标题 --dry-run
node printer/scripts/print-pdf.mjs layout 3 把 页脚标题 关闭 --dry-run
node printer/scripts/print-pdf.mjs layout 3 页脚标题关闭 --dry-run
node printer/scripts/print-pdf.mjs "layout 3，页脚标题关闭" --dry-run
node printer/scripts/print-pdf.mjs layout 3 showFooterTitlefalse --dry-run
node printer/scripts/print-pdf.mjs "layout 3，showFooterTitlefalse" --dry-run
node printer/scripts/print-pdf.mjs layout 3 showFooterTitle-off --dry-run
node printer/scripts/print-pdf.mjs layout 3 showFooterTitle -off --dry-run
node printer/scripts/print-pdf.mjs "layout 3，showFooterTitle -off" --dry-run
node printer/scripts/print-pdf.mjs layout 3 showFooterTitle - off --dry-run
node printer/scripts/print-pdf.mjs "layout 3，showFooterTitle - off" --dry-run
node printer/scripts/print-pdf.mjs layout 3 off-showFooterTitle --dry-run
node printer/scripts/print-pdf.mjs "layout 3，off-showFooterTitle" --dry-run
node printer/scripts/print-pdf.mjs "layout 3，setting-footer-title-off" --dry-run
# 应用发布的任务文件本身就是参数（等价于 --config），不是字库：
node printer/scripts/print-pdf.mjs printer/spec/print-job.example.json --limit 24 --dry-run
# 任意工作目录（含 printer/）：先取绝对 argv，再把 flag 加在 node 上，不要加在 npm 上。
node printer/scripts/print-pdf.mjs --describe
# jobs[].argv 形如：<node> <abs>/printer/scripts/print-pdf.mjs layout 3
# 在 printer/ 目录里相对路径是 node scripts/print-pdf.mjs，不是 node printer/scripts/print-pdf.mjs。
node scripts/print-pdf.mjs layout 3 --limit 24 --dry-run
```

`"layout 3"` 作为一个参数、`layout 3` 作为两个参数、`layout=3` 都是同一个应用发布的任务，不是输入文件名。整句旧指令作为同一个参数也是这个任务，不是缺失的文件名：`run the end-to-end test to generate the PDF, layout 3`（`--describe` 的 `example.instructionArgv`）。拆成多个参数也一样：逗号粘在 `PDF,` 或 `file,` 上仍是说明文字，不是文件名；粘在已存在的 `printer/spec/data/hanzi-1000-v6.json,` 上则仍是那个文件。句中的 `--limit`、`--dry-run`、`cols` 和工作台标签「每行 / 总行 / 描红」是选项，不是文件名；拆成多个参数也一样（`layout 3 limit 6`、`3 字/页 每行 5`、`黑白省墨`），不是缺失的文件名；工作台「序号」选取也一样（`序号 1-12`、`选取 1 - 6`），中间的连字符不是选项，单独的「选取」不会改变选择；`--no-mono` 与 `--no-footer-title` 是工作台复选框的真正 flag，不是未知选项，`--no-footer-title` 会取消页脚标题（默认开启）；`--footer-title false`、`--mono=off`、`页脚标题 off` 和 `setting-footer-title false` 也会取消勾选，不是文件名，也不会把复选框留在勾选状态；单独的 `false` 仍是文件名；标签前的动词也一样：`关闭 页脚标题`、`关闭页脚标题`、`不显示 页脚标题` 会取消页脚标题，不是名为「关闭」的文件，也不会留在勾选状态；`开启 黑白省墨` 会勾选黑白省墨；单独的 `关闭` 仍是文件名；`把 页脚标题 关闭`、`把页脚标题关闭`、`将 黑白省墨 打开` 和 `turn 页脚标题 off` 是动词在标签后面的同一复选框，不是名为「把」的文件；单独的 `把 页脚标题`（后面没有动词）仍把「把」当作文件名；`页脚标题关闭`、`页脚标题 关掉` 和 `页脚标题off` 是动词在标签后面、前面没有「把」的同一复选框，会取消页脚标题，不是文件名，也不会留在勾选状态；`黑白省墨打开` 会勾选黑白省墨；整句 `layout 3，页脚标题关闭` 会取消勾选，不会静默留在开启；单独的 `关掉` 仍是文件名；`showFooterTitlefalse` 和 `offshowFooterTitle` 是没有分隔符的同一复选框，不是文件名；整句 `layout 3，showFooterTitlefalse` 会取消勾选，不会静默留在开启；单独的 `showFooterTitleoffline` 和 `offline` 仍是文件名；整句 `layout 3，showFooterTitleoffline` 不会被丢掉，也不会在页脚仍开启时打印；`monooff` 同样会取消黑白省墨；`no-mono` 仍是那个 flag；`showFooterTitle-off` 和 `setting-footer-title-off` 是动词前有连字符的同一复选框，不是文件名；整句 `layout 3，showFooterTitle-off` 会取消勾选，不会静默留在开启；单独的 `showFooterTitle-offline` 仍是文件名；整句 `layout 3，showFooterTitle-offline` 不会被丢掉，也不会在页脚仍开启时打印；`mono-off` 同样会取消黑白省墨；`off-showFooterTitle` 是标签前有连字符的同一复选框，会取消页脚标题，不是文件名；整句 `layout 3，off-showFooterTitle` 会取消勾选，不会静默留在开启；`no-mono` 仍是那个 flag，不是 `no` 加标签；`offline` 和 `off-line` 仍是文件名；整句 `layout 3，off-showFooterTitlexyz` 不会被丢掉，也不会在页脚仍开启时打印；拆开的 `showFooterTitle -off` 也是同一复选框，不是 `-o` 加上名为 ff 的文件，也不会把页脚留在勾选；整句 `layout 3，showFooterTitle -off` 会取消勾选；单独的 `-off` 仍是 `-o ff`；连字符单独成词的 `showFooterTitle - off` 也是同一复选框，不是未知选项 `-`，也不会把页脚留在勾选；整句 `layout 3，showFooterTitle - off` 会取消勾选；前面没有标签的 `- off` 仍是未知选项；拆开的 `showFooterTitle -offline` 仍是文件名，不是输出 `ffline`；`offline-showFooterTitle` 不是 `off` 加标签。整句 `layout 3，offline-showFooterTitle` 不会被丢掉，也不会在页脚仍开启时打印。单独的 `offline-showFooterTitle` 仍是文件名。单独的 `offline` 仍是文件名。整句 `layout 3，offline-showFooterTitlexyz` 也不会被丢掉；`offlineshowFooterTitle` 不是 `off` 直接粘上标签，中间没有连字符。整句 `layout 3，offlineshowFooterTitle` 不会被丢掉，也不会在页脚仍开启时打印。单独的 `offlineshowFooterTitle` 仍是文件名。整句 `layout 3，offlineshowFooterTitlexyz` 也不会被丢掉；`off-line-showFooterTitle` 不是 `off` 加标签。连字符紧挨着动词，然后是杂字，然后才是标签。整句 `layout 3，off-line-showFooterTitle` 不会被丢掉，也不会在页脚仍开启时打印。单独的 `off-line-showFooterTitle` 仍是文件名。整句 `layout 3，off-line-showFooterTitlexyz` 也不会被丢掉。`off-lineshowFooterTitle` 没有第二个连字符。整句 `layout 3，off-lineshowFooterTitle` 也不会被丢掉，也不会在页脚仍开启时打印。`off-line` 和 `off-monochrome` 仍是文件名；`3个字/页` 和工作台分组 `aria-label`「每页字数 3」也是这个排版说法（`jobs[].phrases`），不是缺失的文件名；单独的「每页字数」是未完成的排版，不是第二个任务。`chars per page 3`、`3 chars per page` 和 `--chars per page 3` 是这个排版说法（`jobs[].phrases`），不是 `--chars` 筛选，也不是名为 page 的文件；`--chars 一,二` 仍然只印这些字；单独的 `chars per`（后面没有 page）仍是筛选；`跑端到端测试生成 PDF，layout 3` 同样是这个任务。`printer/spec/print-job.example.json` 本身就是 CLI 参数（等价于 `--config`），不是字库；只写文件名 `print-job.example.json` 也是这个任务文件。`hanzi-1000-v6.json` 这种字库 JSON 仍然是输入，且只写这个文件名就会找到应用发布的示例字库（任意 cwd；cwd 里的同名文件优先）。省略 layout 时，错误 JSON 里带上应用自己的 `jobs` 表（含绝对 `argv`）。不要把 `--limit`、`--output`、`--dry-run` 直接接在 `npm run` 后面：npm 会拒绝 `--limit`；`--dry-run` 会被 npm 吃掉，CLI 据此只做预览、不写 PDF。

`printer/` 开头的输入和输出路径都从仓库根目录解析，不依赖当前工作目录（在 `printer/` 里执行也不会写成 `printer/printer/output`）。`-o out.pdf` 这种不带 `printer/` 前缀的相对路径仍相对 cwd。

对人说「layout 3」「layout 2」、工作台按钮「3 字/页」、「3个字/页」、分组标签「每页字数 3」、「3 per page」、「3 chars per page」、「chars per page 3」或「three Chinese characters on the page」时，运行 `npm run print:layout-3` 或 `--describe` 里的 `argv`（`jobs[].phrases` 列出这些说法）。`chars per page 3` 不是 `--chars` 筛选。若仍沿用旧指令去跑端到端测试，`npm run test:e2e layout 3` 会打印同一个已发布任务；把整句 `run the end-to-end test to generate the PDF, layout 3` 当作一个参数同样会打印，不会去找同名文件。拆成 `run the end-to-end test to generate the PDF, layout 3` 多个参数也一样，逗号粘在 `PDF,` 上不会变成缺失的文件名。不带 layout 的 `npm run test:e2e` 才是视觉回归。`npm run test:e2e:cli` 用示例字库对照原来的浏览器点击布局、再 `page.pdf()` 的结果。

### 生产与使用环境（侧重可用性、离线能力与加载性能）

- **生成紧凑版生产资源包**：
  ```bash
  npm --prefix printer run build:strokes
  # 等价于：node printer/scripts/print-assets.mjs strokes
  ```
- **启动支持 Gzip 压缩的本地工作台服务**：
  ```bash
  npm --prefix printer start
  # 默认监听 http://127.0.0.1:4173/printer/index.html
  ```
- **打印字帖（不是 E2E）**：在仓库根目录运行 `npm run print:layout-3`（或 `print:layout-2`）。任意目录用 `--describe` 的绝对 `argv`。不要把 CLI flag 接在 npm 后面。
- **运行单元测试与 Chromium 视觉回归（不要用它来生成要交付的 PDF）**：
  ```bash
  npm --prefix printer test
  npm --prefix printer run test:e2e
  ```


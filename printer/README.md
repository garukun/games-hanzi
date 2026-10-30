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
- **运行单元测试与 Chromium 真实打印 E2E 验证**：
  ```bash
  npm --prefix printer test
  npm --prefix printer run test:e2e
  ```


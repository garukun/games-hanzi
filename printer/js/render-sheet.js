/**
 * SVG & DOM sheet renderer for US Letter Hanzi practice pages.
 *
 * Uses per-unit SVG `<symbol>` definitions so each character's stroke geometry is
 * defined once and referenced via `<use>` across the main character box, 3D glyph art,
 * and all Tianzige practice cells.
 */

import {
  PAGE,
  BODY,
  UNITS_H,
  unitSlots,
  unitGeometry,
  strokeSteps,
  countGrid,
  themeFor,
} from './layout.js';

/** `+(n).toFixed(2)`, not layout.js `Math.round(n * 100) / 100`. PDF coords depend on that. */
const n2 = (n) => +n.toFixed(2);
const KAI_FONT = "'LXGW WenKai','Kaiti SC',STKaiti,KaiTi,serif";
const HANZI_XFORM = 'scale(1,-1) translate(0,-900)';
const GRID_HAIR = 'stroke="#cbd5e1" stroke-width="0.22" stroke-dasharray="1.3,1.0"';
const TRACE_INK = ' fill="#e5e8ed" stroke="#9399a3" stroke-width="18" stroke-dasharray="28,44" stroke-linecap="round" stroke-linejoin="round"';

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pathTags(ds, attrs = '') {
  const extra = attrs ? ` ${attrs}` : '';
  return ds.map((d) => `<path d="${d}"${extra}/>`).join('');
}

function hanziSymbol(id, inner) {
  return `<symbol id="${id}" viewBox="0 0 1024 1024">${inner}</symbol>`;
}

function hanziGroup(inner, attrs = '') {
  return `<g transform="${HANZI_XFORM}"${attrs}>${inner}</g>`;
}

function kaiText(char, attrs = '') {
  return `<text x="512" y="800" text-anchor="middle" font-family="${KAI_FONT}" font-size="820"${attrs}>${escapeHtml(char)}</text>`;
}

function boxPos(rect) {
  return `left:${rect.x}mm;top:${rect.y}mm;width:${rect.w}mm;height:${rect.h}mm`;
}

/** Build the reusable `<symbol>` markup for a character in 1024×1024 coordinate space. */
function buildCharSymbol(symId, item) {
  if (Array.isArray(item.strokePaths) && item.strokePaths.length > 0) {
    return hanziSymbol(symId, hanziGroup(pathTags(item.strokePaths)));
  }
  return hanziSymbol(symId, kaiText(item.char));
}

/** Build the light-grey dashed tracing `<symbol>` markup in 1024×1024 coordinate space. */
function buildTraceSymbol(traceSymId, item) {
  const hasStrokes = Array.isArray(item.strokePaths) && item.strokePaths.length > 0;
  const hasMedians = Array.isArray(item.medianPaths) && item.medianPaths.length > 0;
  if (hasMedians) {
    const silhouette = hasStrokes
      ? `<g class="trace-silhouette" fill="#e5e8ed">${pathTags(item.strokePaths)}</g>`
      : '';
    const centerline = `<g class="trace-centerline" fill="none" stroke="#9399a3" stroke-width="28" stroke-dasharray="28,54" stroke-linecap="round" stroke-linejoin="round">${pathTags(item.medianPaths)}</g>`;
    return hanziSymbol(traceSymId, hanziGroup(silhouette + centerline));
  }
  if (hasStrokes) return hanziSymbol(traceSymId, hanziGroup(pathTags(item.strokePaths), TRACE_INK));
  return hanziSymbol(traceSymId, kaiText(item.char, TRACE_INK));
}

/** Render the illustration card interior (`.unit-art`) for `emoji`, `glyph`, or `upload`. */
function renderIllustrationArt(item, geom, theme, symId, gradId) {
  const ill = item.illustration;
  const artW = geom.art.w;
  const artH = geom.art.h;
  const squareSide = Math.round(Math.min(artW, artH) * 0.84 * 100) / 100;
  const stageLeft = Math.round(((artW - squareSide) / 2) * 100) / 100;
  const stageTop = Math.round(((artH - squareSide) / 2) * 100) / 100;

  let innerHtml = '';
  if (ill.type === 'emoji') {
    const cells = countGrid(ill.count || 1);
    const padFactor = (ill.count || 1) > 1 ? 0.74 : 0.88;
    innerHtml = cells
      .map((cell, idx) => {
        const iconSize = n2(cell.s * padFactor);
        const offset = n2((cell.s - iconSize) / 2);
        const left = n2(cell.x + offset);
        const top = n2(cell.y + offset);
        return `<img class="art-emoji-icon" data-emoji-id="${escapeHtml(ill.id)}" data-emoji-index="${idx}" src="${escapeHtml(ill.src)}" alt="${escapeHtml(item.char)}" style="left:${left}%;top:${top}%;width:${iconSize}%;height:${iconSize}%;" decoding="sync" loading="eager" />`;
      })
      .join('');
  } else if (ill.type === 'upload') {
    innerHtml = `<img class="art-upload-img" src="${escapeHtml(ill.src)}" alt="${escapeHtml(item.char)}" decoding="sync" loading="eager" />`;
  } else {
    // 3D sticker colour-glyph illustration (matches 正 / 反 in example-ui-design/3.avif)
    innerHtml = `
      <svg class="art-glyph-svg" viewBox="0 0 1024 1024" aria-label="${escapeHtml(item.char)}">
        <ellipse cx="512" cy="915" rx="330" ry="52" fill="${theme.light}" />
        <use href="#${symId}" transform="translate(38,44)" fill="${theme.dark}" opacity="0.88" />
        <use href="#${symId}" fill="url(#${gradId})" stroke="#ffffff" stroke-width="44" stroke-linejoin="round" style="paint-order:stroke fill;" />
      </svg>`;
  }

  return `
    <div class="unit-art"
         data-illustration-slot="${escapeHtml(item.char)}"
         data-illustration-type="${escapeHtml(ill.type)}"
         data-illustration-count="${ill.count || 1}"
         style="${boxPos(geom.art)};">
      <div class="art-stage" style="left:${stageLeft}mm;top:${stageTop}mm;width:${squareSide}mm;height:${squareSide}mm;">
        ${innerHtml}
      </div>
    </div>`;
}

/** Render the progressive stroke-order ribbon (`.unit-stroke`). */
function renderStrokeRibbon(item, geom, theme) {
  const { spec } = geom;
  const labelW = spec.labelW;
  const padX = 1.2;
  const padY = 1.1;
  const innerW = n2(geom.stroke.w - labelW - padX * 1.5);
  const innerH = n2(geom.stroke.h - padY * 2);

  const hasPaths = Array.isArray(item.strokePaths) && item.strokePaths.length > 0;
  const count = hasPaths ? item.strokePaths.length : Math.max(1, item.strokes || 1);
  const stepLayout = strokeSteps(count, innerW - 3.2, innerH - 2.2, spec.stepMax, 0.35);
  const stepSize = stepLayout.size;

  let stepsHtml = '';
  if (hasPaths) {
    for (let k = 1; k <= count; k++) {
      const prevPaths = pathTags(item.strokePaths.slice(0, k - 1), 'fill="#94a3b8"');
      const curPath = pathTags([item.strokePaths[k - 1]], `fill="${theme.main}"`);
      stepsHtml += `<svg class="stroke-step" data-step="${k}" viewBox="0 0 1024 1024" style="width:${stepSize}mm;height:${stepSize}mm;">${hanziGroup(prevPaths + curPath)}</svg>`;
    }
  } else {
    stepsHtml = `<div class="stroke-fallback-note" style="font-size:${Math.max(2.4, spec.fs * 0.8)}mm;color:${theme.ink};">${escapeHtml(item.char)}（共 ${count} 画）</div>`;
  }

  return `
    <div class="unit-stroke"
         data-stroke-ribbon="${escapeHtml(item.char)}"
         data-stroke-steps="${count}"
         style="${boxPos(geom.stroke)};background:${theme.light};">
      <div class="stroke-label" style="width:${labelW}mm;color:${theme.dark};font-size:${Math.max(2.6, spec.fs * 0.88)}mm;">
        <span>笔</span><span>顺</span>
      </div>
      <div class="stroke-track" style="width:${innerW}mm;height:${innerH}mm;border-color:${theme.mid};grid-template-columns:repeat(${stepLayout.perRow},${stepSize}mm);grid-auto-rows:${stepSize}mm;">
        ${stepsHtml}
      </div>
    </div>`;
}

/** Render the Tianzige practice grid (`.unit-grid`) with model col 0 and dashed light-grey tracing rows. */
function renderPracticeGrid(item, geom, symId, traceSymId) {
  const { x, y, w, h, cols, rows, cell, colGap = 0, rowGap = 0, trace } = geom.grid;
  const borderInset = 0.14;
  const boxSide = n2(cell - borderInset * 2);
  const glyphSize = n2(cell * 0.78);
  const glyphPad = n2((cell - glyphSize) / 2);

  const cellsSvg = [];
  for (let r = 0; r < rows; r++) {
    const ry = n2(r * (cell + rowGap));
    const midY = n2(ry + cell / 2);

    for (let c = 0; c < cols; c++) {
      const cx = n2(c * (cell + colGap));
      const midX = n2(cx + cell / 2);
      const role = c === 0 ? 'model' : r < trace ? 'trace' : 'blank';

      // Individual square Tianzige box + dashed crosshairs + character glyph
      cellsSvg.push(
        `<g class="grid-cell" data-cell="${r}-${c}" data-row="${r}" data-col="${c}" data-role="${role}">`,
        `<rect x="${n2(cx + borderInset)}" y="${n2(ry + borderInset)}" width="${boxSide}" height="${boxSide}" rx="0.6" fill="#ffffff" stroke="#8a94a4" stroke-width="0.28"/>`,
        `<line x1="${n2(cx + 0.25)}" y1="${midY}" x2="${n2(cx + cell - 0.25)}" y2="${midY}" ${GRID_HAIR}/>`,
        `<line x1="${midX}" y1="${n2(ry + 0.25)}" x2="${midX}" y2="${n2(ry + cell - 0.25)}" ${GRID_HAIR}/>`,
      );
      if (role === 'model' || role === 'trace') {
        const gx = n2(cx + glyphPad);
        const gy = n2(ry + glyphPad);
        cellsSvg.push(
          role === 'model'
            ? `<use class="glyph-model" href="#${symId}" x="${gx}" y="${gy}" width="${glyphSize}" height="${glyphSize}" fill="#c4302b"/>`
            : `<use class="glyph-trace" data-trace-style="dashed" href="#${traceSymId}" x="${gx}" y="${gy}" width="${glyphSize}" height="${glyphSize}"/>`,
        );
      }
      cellsSvg.push(`</g>`);
    }
  }

  return `
    <div class="unit-grid"
         data-grid-char="${escapeHtml(item.char)}"
         data-grid-rows="${rows}"
         data-grid-cols="${cols}"
         data-grid-trace="${trace}"
         data-grid-cell-mm="${cell}"
         style="left:${x}mm;top:${y}mm;width:${w}mm;height:${h}mm;">
      <svg class="unit-grid-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        ${cellsSvg.join('')}
      </svg>
    </div>`;
}

/** Render one character unit (`.char-unit`) inside a page. */
export function renderCharUnitHtml(item, slot, unitIdx, pageIdx, settings) {
  const perPage = settings.perPage || 2;
  const geom = unitGeometry(perPage, slot, {
    cols: settings.cols ?? undefined,
    rows: settings.rows ?? undefined,
    trace: settings.trace ?? undefined,
  });
  const theme = themeFor(item.index ?? pageIdx * perPage + unitIdx, settings.mono);
  const uid = `p${pageIdx}u${unitIdx}`;
  const symId = `hz-sym-${uid}`;
  const traceSymId = `hz-trace-${uid}`;
  const gradId = `hz-grad-${uid}`;

  const gb = geom.glyphBox;
  const pyH = geom.pinyinH;
  const mainBoxH = n2(gb.h - pyH);
  const mainGlyphSide = n2(Math.min(gb.w, mainBoxH) * 0.84);
  const mainGlyphX = n2((gb.w - mainGlyphSide) / 2);
  const mainGlyphY = n2((mainBoxH - mainGlyphSide) / 2);
  const tagStyle = `border-color:${theme.main};color:${theme.dark};`;

  const fs = geom.spec.fs;
  const wordsHtml = item.pickedWords
    .map((w) => `<span class="word-item" data-word="${escapeHtml(w)}">${escapeHtml(w)}</span>`)
    .join('<span class="word-sep"> </span>');

  return `
    <section class="char-unit ${item.isEdited ? 'is-edited' : ''}"
             data-char="${escapeHtml(item.char)}"
             data-char-index="${item.index}"
             data-theme="${theme.id}"
             style="${boxPos(slot)};--theme-main:${theme.main};--theme-dark:${theme.dark};--theme-mid:${theme.mid};--theme-light:${theme.light};--theme-soft:${theme.soft};--theme-ink:${theme.ink};">
      <svg class="unit-defs-svg" width="0" height="0" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;">
        <defs>
          <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${theme.main}" />
            <stop offset="100%" stop-color="${theme.dark}" />
          </linearGradient>
          ${buildCharSymbol(symId, item)}
          ${buildTraceSymbol(traceSymId, item)}
        </defs>
      </svg>

      <!-- Top-left Pinyin 4-line grid + Large Main Character Tianzige -->
      <div class="unit-glyph-box" style="${boxPos(gb)};border-color:${theme.dark};">
        <div class="unit-pinyin-box" style="height:${pyH}mm;border-bottom-color:${theme.dark};">
          <div class="pinyin-line pinyin-line-1" style="border-color:${theme.mid};"></div>
          <div class="pinyin-line pinyin-line-2" style="border-color:${theme.mid};"></div>
          <span class="unit-pinyin" data-field="pinyin" style="font-size:${n2(pyH * 0.52)}mm;">${escapeHtml(item.pinyin)}</span>
        </div>
        <div class="unit-main-char-box" style="height:${mainBoxH}mm;">
          <svg class="unit-main-char-svg" viewBox="0 0 ${gb.w} ${mainBoxH}">
            <line x1="0" y1="${n2(mainBoxH / 2)}" x2="${gb.w}" y2="${n2(mainBoxH / 2)}" stroke="${theme.mid}" stroke-width="0.28" stroke-dasharray="1.6,1.2"/>
            <line x1="${n2(gb.w / 2)}" y1="0" x2="${n2(gb.w / 2)}" y2="${mainBoxH}" stroke="${theme.mid}" stroke-width="0.28" stroke-dasharray="1.6,1.2"/>
            <use class="glyph-main" href="#${symId}" x="${mainGlyphX}" y="${mainGlyphY}" width="${mainGlyphSide}" height="${mainGlyphSide}" fill="#141b24"/>
          </svg>
        </div>
      </div>

      <!-- Top-right Illustration + Metadata Card -->
      <div class="unit-card" style="${boxPos(geom.card)};border-color:${theme.main};">
        ${renderIllustrationArt(item, geom, theme, symId, gradId)}
        <div class="unit-info" style="${boxPos(geom.info)};background:${theme.light};border-Color:${theme.mid};font-size:${fs}mm;color:${theme.ink};">
          <div class="info-row info-row-meta">
            <span class="meta-pair">
              <span class="meta-tag" style="${tagStyle}">部首</span>
              <span class="meta-val" data-field="radical">${escapeHtml(item.radical)}</span>
            </span>
            <span class="meta-pair">
              <span class="meta-tag" style="${tagStyle}">笔画</span>
              <span class="meta-val" data-field="strokes">${item.strokes}</span>
            </span>
          </div>
          <div class="info-row info-row-words">
            <span class="meta-tag" style="${tagStyle}">组词</span>
            <span class="meta-val meta-words" data-field="words">${wordsHtml}</span>
          </div>
        </div>
      </div>

      <!-- Middle Stroke-Order Ribbon -->
      ${renderStrokeRibbon(item, geom, theme)}

      <!-- Bottom Tianzige Practice Grid -->
      ${renderPracticeGrid(item, geom, symId, traceSymId)}
    </section>`;
}

/** Render the inner HTML of a `.sheet-page` for `pageItems` (1..4 character objects). */
export function renderPageInnerHtml(pageItems, pageIdx, totalPages, settings, docTitle = '') {
  const perPage = settings.perPage || 2;
  const slots = unitSlots(perPage);
  const unitsHtml = pageItems
    .map((item, i) => renderCharUnitHtml(item, slots[i], i, pageIdx, settings))
    .join('');

  const pageCharsList = pageItems.map((c) => c.char).join(' ');
  const titleText = settings.showFooterTitle && docTitle ? escapeHtml(docTitle) : '';

  return `
    <div class="sheet-body" style="width:${BODY.w}mm;height:${BODY.h}mm;">
      <div class="sheet-units" style="width:${BODY.w}mm;height:${UNITS_H}mm;">
        ${unitsHtml}
      </div>
      <footer class="sheet-footer" style="height:${BODY.footer}mm;">
        <span class="footer-chars" data-page-chars="${escapeHtml(pageItems.map((c) => c.char).join(','))}">本页生字：${escapeHtml(pageCharsList)}</span>
        <span class="footer-page-num" data-page-num="${pageIdx + 1}">- ${pageIdx + 1} -</span>
        <span class="footer-title">${titleText}</span>
      </footer>
    </div>`;
}

/** Create a `.sheet-page` wrapper element (either hydrated or deferred for off-screen virtualization). */
export function createPageElement(doc, pageItems, pageIdx, totalPages, settings, docTitle = '', hydrateImmediately = false) {
  const article = doc.createElement('article');
  article.className = 'sheet-page';
  article.dataset.pageIndex = String(pageIdx);
  article.dataset.pageNumber = String(pageIdx + 1);
  article.dataset.perPage = String(settings.perPage || 2);
  article.dataset.chars = pageItems.map((c) => c.char).join(',');
  article.style.width = `${PAGE.w}mm`;
  article.style.height = `${PAGE.h}mm`;

  // Apply content-visibility: auto class only to pages strictly below the initial fold (pageIdx >= 2)
  if (pageIdx >= 2) {
    article.classList.add('sheet-page-deferred');
  }

  if (hydrateImmediately) {
    article.innerHTML = renderPageInnerHtml(pageItems, pageIdx, totalPages, settings, docTitle);
    article.dataset.hydrated = 'true';
  } else {
    article.dataset.hydrated = 'false';
    article.innerHTML = `<div class="sheet-placeholder">第 ${pageIdx + 1} / ${totalPages} 页（${escapeHtml(pageItems.map((c) => c.char).join(' '))}）</div>`;
  }
  return article;
}

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

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build the reusable `<symbol>` markup for a character in 1024×1024 coordinate space. */
function buildCharSymbol(symId, item) {
  if (Array.isArray(item.strokePaths) && item.strokePaths.length > 0) {
    const paths = item.strokePaths.map((d) => `<path d="${d}"/>`).join('');
    return `<symbol id="${symId}" viewBox="0 0 1024 1024"><g transform="scale(1,-1) translate(0,-900)">${paths}</g></symbol>`;
  }
  return `<symbol id="${symId}" viewBox="0 0 1024 1024"><text x="512" y="800" text-anchor="middle" font-family="'LXGW WenKai','Kaiti SC',STKaiti,KaiTi,serif" font-size="820">${escapeHtml(item.char)}</text></symbol>`;
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
        const iconSize = +(cell.s * padFactor).toFixed(2);
        const offset = +((cell.s - iconSize) / 2).toFixed(2);
        const left = +(cell.x + offset).toFixed(2);
        const top = +(cell.y + offset).toFixed(2);
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
         style="left:${geom.art.x}mm;top:${geom.art.y}mm;width:${artW}mm;height:${artH}mm;">
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
  const innerW = +(geom.stroke.w - labelW - padX * 1.5).toFixed(2);
  const innerH = +(geom.stroke.h - padY * 2).toFixed(2);

  const hasPaths = Array.isArray(item.strokePaths) && item.strokePaths.length > 0;
  const count = hasPaths ? item.strokePaths.length : Math.max(1, item.strokes || 1);
  const stepLayout = strokeSteps(count, innerW - 3.2, innerH - 2.2, spec.stepMax, 0.35);
  const stepSize = stepLayout.size;

  let stepsHtml = '';
  if (hasPaths) {
    for (let k = 1; k <= count; k++) {
      const prevPaths = item.strokePaths
        .slice(0, k - 1)
        .map((d) => `<path d="${d}" fill="#94a3b8"/>`)
        .join('');
      const curPath = `<path d="${item.strokePaths[k - 1]}" fill="${theme.main}"/>`;
      stepsHtml += `<svg class="stroke-step" data-step="${k}" viewBox="0 0 1024 1024" style="width:${stepSize}mm;height:${stepSize}mm;"><g transform="scale(1,-1) translate(0,-900)">${prevPaths}${curPath}</g></svg>`;
    }
  } else {
    stepsHtml = `<div class="stroke-fallback-note" style="font-size:${Math.max(2.4, spec.fs * 0.8)}mm;color:${theme.ink};">${escapeHtml(item.char)}（共 ${count} 画）</div>`;
  }

  return `
    <div class="unit-stroke"
         data-stroke-ribbon="${escapeHtml(item.char)}"
         data-stroke-steps="${count}"
         style="left:${geom.stroke.x}mm;top:${geom.stroke.y}mm;width:${geom.stroke.w}mm;height:${geom.stroke.h}mm;background:${theme.light};">
      <div class="stroke-label" style="width:${labelW}mm;color:${theme.dark};font-size:${Math.max(2.6, spec.fs * 0.88)}mm;">
        <span>笔</span><span>顺</span>
      </div>
      <div class="stroke-track" style="width:${innerW}mm;height:${innerH}mm;border-color:${theme.mid};grid-template-columns:repeat(${stepLayout.perRow},${stepSize}mm);grid-auto-rows:${stepSize}mm;">
        ${stepsHtml}
      </div>
    </div>`;
}

/** Render the Tianzige practice grid (`.unit-grid`) with model col 0 and tracing rows. */
function renderPracticeGrid(item, geom, symId) {
  const { x, y, w, h, cols, rows, cell, trace } = geom.grid;
  const rowInset = 0.35; // subtle separation between horizontal row strips, matching workbook
  const boxH = +(cell - rowInset * 2).toFixed(2);
  const glyphSize = +(boxH * 0.78).toFixed(2);
  const glyphPadX = +((cell - glyphSize) / 2).toFixed(2);
  const glyphPadY = +(rowInset + (boxH - glyphSize) / 2).toFixed(2);

  const cellsSvg = [];
  for (let r = 0; r < rows; r++) {
    const ry = +(r * cell + rowInset).toFixed(2);
    const midY = +(ry + boxH / 2).toFixed(2);

    // Outer row background + horizontal dashed centerline across the entire row
    cellsSvg.push(
      `<rect x="0.15" y="${ry}" width="${+(w - 0.3).toFixed(2)}" height="${boxH}" fill="#ffffff" stroke="#8a94a4" stroke-width="0.28"/>`,
      `<line x1="0.2" y1="${midY}" x2="${+(w - 0.2).toFixed(2)}" y2="${midY}" stroke="#cbd5e1" stroke-width="0.2" stroke-dasharray="1.1,0.9"/>`,
    );

    for (let c = 0; c < cols; c++) {
      const cx = +(c * cell).toFixed(2);
      const midX = +(cx + cell / 2).toFixed(2);
      const role = c === 0 ? 'model' : r < trace ? 'trace' : 'blank';

      // Vertical cell divider + vertical dashed centerline
      if (c > 0) {
        cellsSvg.push(
          `<line x1="${cx}" y1="${ry}" x2="${cx}" y2="${+(ry + boxH).toFixed(2)}" stroke="#94a3b8" stroke-width="0.24"/>`,
        );
      }
      cellsSvg.push(
        `<line x1="${midX}" y1="${ry}" x2="${midX}" y2="${+(ry + boxH).toFixed(2)}" stroke="#cbd5e1" stroke-width="0.2" stroke-dasharray="1.1,0.9"/>`,
      );

      // Cell hitbox for DOM/PDF coordinate inspection + character glyph
      cellsSvg.push(
        `<g class="grid-cell" data-cell="${r}-${c}" data-row="${r}" data-col="${c}" data-role="${role}">`,
        `<rect x="${cx}" y="${ry}" width="${cell}" height="${boxH}" fill="transparent"/>`,
      );
      if (role === 'model') {
        cellsSvg.push(
          `<use class="glyph-model" href="#${symId}" x="${+(cx + glyphPadX).toFixed(2)}" y="${+(r * cell + glyphPadY).toFixed(2)}" width="${glyphSize}" height="${glyphSize}" fill="#c4302b"/>`,
        );
      } else if (role === 'trace') {
        cellsSvg.push(
          `<use class="glyph-trace" href="#${symId}" x="${+(cx + glyphPadX).toFixed(2)}" y="${+(r * cell + glyphPadY).toFixed(2)}" width="${glyphSize}" height="${glyphSize}" fill="#b6beca"/>`,
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
    rows: settings.rows ?? undefined,
    trace: settings.trace ?? undefined,
  });
  const theme = themeFor(item.index ?? pageIdx * perPage + unitIdx, settings.mono);
  const uid = `p${pageIdx}u${unitIdx}`;
  const symId = `hz-sym-${uid}`;
  const gradId = `hz-grad-${uid}`;

  const gb = geom.glyphBox;
  const pyH = geom.pinyinH;
  const mainBoxH = +(gb.h - pyH).toFixed(2);
  const mainGlyphSide = +(Math.min(gb.w, mainBoxH) * 0.84).toFixed(2);
  const mainGlyphX = +((gb.w - mainGlyphSide) / 2).toFixed(2);
  const mainGlyphY = +((mainBoxH - mainGlyphSide) / 2).toFixed(2);

  const fs = geom.spec.fs;
  const wordsHtml = item.pickedWords
    .map((w) => `<span class="word-item" data-word="${escapeHtml(w)}">${escapeHtml(w)}</span>`)
    .join('<span class="word-sep"> </span>');

  return `
    <section class="char-unit ${item.isEdited ? 'is-edited' : ''}"
             data-char="${escapeHtml(item.char)}"
             data-char-index="${item.index}"
             data-theme="${theme.id}"
             style="left:${slot.x}mm;top:${slot.y}mm;width:${slot.w}mm;height:${slot.h}mm;--theme-main:${theme.main};--theme-dark:${theme.dark};--theme-mid:${theme.mid};--theme-light:${theme.light};--theme-soft:${theme.soft};--theme-ink:${theme.ink};">
      <svg class="unit-defs-svg" width="0" height="0" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;">
        <defs>
          <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${theme.main}" />
            <stop offset="100%" stop-color="${theme.dark}" />
          </linearGradient>
          ${buildCharSymbol(symId, item)}
        </defs>
      </svg>

      <!-- Top-left Pinyin 4-line grid + Large Main Character Tianzige -->
      <div class="unit-glyph-box" style="left:${gb.x}mm;top:${gb.y}mm;width:${gb.w}mm;height:${gb.h}mm;border-color:${theme.dark};">
        <div class="unit-pinyin-box" style="height:${pyH}mm;border-bottom-color:${theme.dark};">
          <div class="pinyin-line pinyin-line-1" style="border-color:${theme.mid};"></div>
          <div class="pinyin-line pinyin-line-2" style="border-color:${theme.mid};"></div>
          <span class="unit-pinyin" data-field="pinyin" style="font-size:${+(pyH * 0.52).toFixed(2)}mm;">${escapeHtml(item.pinyin)}</span>
        </div>
        <div class="unit-main-char-box" style="height:${mainBoxH}mm;">
          <svg class="unit-main-char-svg" viewBox="0 0 ${gb.w} ${mainBoxH}">
            <line x1="0" y1="${+(mainBoxH / 2).toFixed(2)}" x2="${gb.w}" y2="${+(mainBoxH / 2).toFixed(2)}" stroke="${theme.mid}" stroke-width="0.28" stroke-dasharray="1.6,1.2"/>
            <line x1="${+(gb.w / 2).toFixed(2)}" y1="0" x2="${+(gb.w / 2).toFixed(2)}" y2="${mainBoxH}" stroke="${theme.mid}" stroke-width="0.28" stroke-dasharray="1.6,1.2"/>
            <use class="glyph-main" href="#${symId}" x="${mainGlyphX}" y="${mainGlyphY}" width="${mainGlyphSide}" height="${mainGlyphSide}" fill="#141b24"/>
          </svg>
        </div>
      </div>

      <!-- Top-right Illustration + Metadata Card -->
      <div class="unit-card" style="left:${geom.card.x}mm;top:${geom.card.y}mm;width:${geom.card.w}mm;height:${geom.card.h}mm;border-color:${theme.main};">
        ${renderIllustrationArt(item, geom, theme, symId, gradId)}
        <div class="unit-info" style="left:${geom.info.x}mm;top:${geom.info.y}mm;width:${geom.info.w}mm;height:${geom.info.h}mm;background:${theme.light};border-Color:${theme.mid};font-size:${fs}mm;color:${theme.ink};">
          <div class="info-row info-row-meta">
            <span class="meta-pair">
              <span class="meta-tag" style="border-color:${theme.main};color:${theme.dark};">部首</span>
              <span class="meta-val" data-field="radical">${escapeHtml(item.radical)}</span>
            </span>
            <span class="meta-pair">
              <span class="meta-tag" style="border-color:${theme.main};color:${theme.dark};">笔画</span>
              <span class="meta-val" data-field="strokes">${item.strokes}</span>
            </span>
          </div>
          <div class="info-row info-row-words">
            <span class="meta-tag" style="border-color:${theme.main};color:${theme.dark};">组词</span>
            <span class="meta-val meta-words" data-field="words">${wordsHtml}</span>
          </div>
        </div>
      </div>

      <!-- Middle Stroke-Order Ribbon -->
      ${renderStrokeRibbon(item, geom, theme)}

      <!-- Bottom Tianzige Practice Grid -->
      ${renderPracticeGrid(item, geom, symId)}
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

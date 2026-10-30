/**
 * Paginated Letter-size sheet preview with IntersectionObserver virtualization.
 *
 * Keeps DOM size small even when 1000 characters (250–1000 pages) are loaded:
 *   - Pages 0 and 1 hydrate immediately for sub-second first-paint.
 *   - Off-screen pages use `content-visibility: auto` + `contain-intrinsic-size`
 *     and lazy-hydrate when scrolling near the viewport.
 */

import { paginate } from './layout.js';
import { createPageElement, renderPageInnerHtml } from './render-sheet.js';

export function createSheetPreview(containerEl, store) {
  let pagesData = [];
  let pageElements = [];
  let docTitle = '';
  let observer = null;
  let forceAllHydrated = false;

  function hydratePage(idx) {
    const el = pageElements[idx];
    if (!el || el.dataset.hydrated === 'true') return;
    const items = pagesData[idx];
    if (!items) return;
    el.innerHTML = renderPageInnerHtml(items, idx, pagesData.length, store.state.settings, docTitle);
    el.dataset.hydrated = 'true';
    highlightActiveChar(el);
  }

  function dehydratePage(idx) {
    if (forceAllHydrated || idx < 2) return;
    const el = pageElements[idx];
    if (!el || el.dataset.hydrated !== 'true') return;
    const items = pagesData[idx];
    el.dataset.hydrated = 'false';
    el.innerHTML = `<div class="sheet-placeholder">第 ${idx + 1} / ${pagesData.length} 页（${items.map((c) => c.char).join(' ')}）</div>`;
  }

  function highlightActiveChar(root = containerEl) {
    const active = store.state.activeChar;
    for (const unit of root.querySelectorAll('.char-unit')) {
      unit.classList.toggle('is-selected', unit.dataset.char === active);
    }
  }

  function setupObserver() {
    if (observer) observer.disconnect();
    if (typeof IntersectionObserver === 'undefined') {
      // Fallback: hydrate all
      for (let i = 0; i < pageElements.length; i++) hydratePage(i);
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = Number(entry.target.dataset.pageIndex);
          if (entry.isIntersecting) {
            // Hydrate this page and its immediate neighbors for smooth scrolling
            for (let k = Math.max(0, idx - 1); k <= Math.min(pageElements.length - 1, idx + 2); k++) {
              hydratePage(k);
            }
          } else if (!forceAllHydrated && pageElements.length > 24 && idx >= 4) {
            dehydratePage(idx);
          }
        }
      },
      {
        root: containerEl.closest('.preview-scroll') || null,
        rootMargin: '900px 0px 900px 0px',
      },
    );
    for (const el of pageElements) observer.observe(el);
  }

  function renderAll({ hydrateAll = false } = {}) {
    forceAllHydrated = hydrateAll;
    const resolved = store.getSelectedResolvedChars();
    const perPage = store.state.settings.perPage || 2;
    pagesData = paginate(resolved, perPage);
    docTitle = store.state.doc?.meta?.title || '';

    containerEl.style.setProperty('--sheet-zoom', String(store.state.settings.zoom || 0.72));
    containerEl.innerHTML = '';
    pageElements = [];

    if (pagesData.length === 0) {
      containerEl.innerHTML = `<div class="preview-empty">请至少选择 1 个汉字进行排版预览</div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    // Immediately hydrate the first 3 pages (or all if total pages <= 16 or hydrateAll is set)
    const eagerCount = hydrateAll || pagesData.length <= 16 ? pagesData.length : 3;
    for (let i = 0; i < pagesData.length; i++) {
      const el = createPageElement(
        document,
        pagesData[i],
        i,
        pagesData.length,
        store.state.settings,
        docTitle,
        i < eagerCount,
      );
      pageElements.push(el);
      frag.appendChild(el);
    }
    containerEl.appendChild(frag);
    highlightActiveChar(containerEl);
    setupObserver();
  }

  /** Fast targeted update when a single character's override changes. */
  function updateCharOnPage(ch) {
    if (!ch) return renderAll({ hydrateAll: forceAllHydrated });
    const perPage = store.state.settings.perPage || 2;
    const resolved = store.getSelectedResolvedChars();
    pagesData = paginate(resolved, perPage);

    for (let i = 0; i < pagesData.length; i++) {
      if (pagesData[i].some((c) => c.char === ch)) {
        const el = pageElements[i];
        if (el) {
          el.innerHTML = renderPageInnerHtml(pagesData[i], i, pagesData.length, store.state.settings, docTitle);
          el.dataset.hydrated = 'true';
          highlightActiveChar(el);
        }
      }
    }
  }

  /** Hydrate all pages in non-blocking batches before printing / PDF export. */
  async function hydrateAllPages({ onProgress, batchSize = 25 } = {}) {
    forceAllHydrated = true;
    const total = pageElements.length;
    for (let i = 0; i < total; i += batchSize) {
      const end = Math.min(total, i + batchSize);
      for (let j = i; j < end; j++) {
        hydratePage(j);
      }
      if (onProgress) onProgress(end, total);
      if (end < total) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (onProgress) onProgress(total, total);
  }

  function scrollToPage(pageOneBased) {
    const idx = Math.max(0, Math.min(pageElements.length - 1, pageOneBased - 1));
    hydratePage(idx);
    pageElements[idx]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function scrollToChar(ch) {
    const idx = pagesData.findIndex((p) => p.some((c) => c.char === ch));
    if (idx >= 0) {
      hydratePage(idx);
      pageElements[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Click delegation on character units to open editor
  containerEl.addEventListener('click', (e) => {
    const unit = e.target.closest('.char-unit');
    if (!unit) return;
    const ch = unit.dataset.char;
    if (ch) store.setActiveChar(ch);
  });

  return {
    renderAll,
    updateCharOnPage,
    hydrateAllPages,
    highlightActiveChar,
    scrollToPage,
    scrollToChar,
    getPageCount: () => pagesData.length,
    getPagesData: () => pagesData,
  };
}

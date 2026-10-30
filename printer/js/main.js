/**
 * Main application entrypoint for the Hanzi practice-sheet workbench (`printer/index.html`).
 */

import { SPECS, unitSlots, unitGeometry, pageCount } from './layout.js';
import { ensureHanziData } from './hanzi-data.js';
import { loadIllustrationAssets } from './illustration.js';
import { createPrintStore } from './store.js';
import { createSheetPreview } from './preview.js';
import { setupCharacterEditor } from './editor.js';
import { setupPrintController } from './print.js';
import { escapeHtml } from './render-sheet.js';

const DEFAULT_DATA_URLS = [
  '../spec/data/hanzi-1000-v6.json',
  '../spec/data/hanzi-1000-v5.json',
  '../spec/data/hanzi-1000-v4.json',
];

async function initApp() {
  const store = createPrintStore();
  window.__hanziStore = store;

  const stageEl = document.getElementById('sheet-stage');
  const editorEl = document.getElementById('editor-panel');
  const groupsListEl = document.getElementById('groups-list');
  const validationPanelEl = document.getElementById('validation-panel');
  const summaryStatsEl = document.getElementById('summary-stats');

  const preview = createSheetPreview(stageEl, store);
  const editor = setupCharacterEditor(editorEl, store);
  const printController = setupPrintController({
    preview,
    progressModalEl: document.getElementById('print-progress-modal'),
    progressBarEl: document.getElementById('print-progress-bar'),
    progressTextEl: document.getElementById('print-progress-text'),
  });

  // 1. Load static illustration map + emoji catalog
  await loadIllustrationAssets();

  // Helper to ingest a raw JSON string or object
  async function ingestDataset(rawInput, { selectFirstN = null } = {}) {
    document.body.dataset.datasetReady = 'false';
    const t0 = performance.now();
    const doc = await store.loadDataset(rawInput);
    if (doc.characters.length > 0) {
      await ensureHanziData(doc.characters.map((c) => c.char));
    }
    if (selectFirstN && doc.characters.length > selectFirstN) {
      store.setSelection(doc.characters.slice(0, selectFirstN).map((c) => c.char));
    }
    const elapsedMs = Math.round(performance.now() - t0);
    document.body.dataset.lastLoadMs = String(elapsedMs);

    syncToolbarFromState();
    renderValidationPanel();
    renderGroupsSidebar();
    preview.renderAll();
    editor.render();
    updateSummaryBar();

    document.body.dataset.ingestSeq = String(Number(document.body.dataset.ingestSeq || 0) + 1);
    document.body.dataset.datasetReady = 'true';
  }

  window.__hanziIngestDataset = ingestDataset;

  // 2. Render validation panel
  function renderValidationPanel() {
    const rep = store.getValidationReport();
    if (!store.state.doc) {
      validationPanelEl.innerHTML = '';
      return;
    }
    const errCount = rep.issues.filter((i) => i.level === 'error').length;
    const warnCount = rep.issues.filter((i) => i.level === 'warning').length;
    const statusClass = !rep.ok || errCount > 0 ? 'status-error' : warnCount > 0 ? 'status-warn' : 'status-ok';
    const statusLabel =
      !rep.ok || errCount > 0
        ? `发现 ${errCount} 个错误${warnCount ? `、${warnCount} 个警告` : ''}`
        : warnCount > 0
          ? `校验通过（含 ${warnCount} 条提示）`
          : `校验通过 · ${rep.totalChars} 字完整就绪`;

    const issuesHtml =
      rep.issues.length > 0
        ? `<ul class="validation-issues" id="validation-issues-list" data-testid="validation-issues-list">
            ${rep.issues
              .slice(0, 30)
              .map(
                (iss) =>
                  `<li class="issue-item issue-${escapeHtml(iss.level)}" data-issue-code="${escapeHtml(iss.code)}">
                    <span class="issue-badge">${iss.level === 'error' ? '错误' : '提示'}</span>
                    <span class="issue-msg">${escapeHtml(iss.message)}</span>
                  </li>`,
              )
              .join('')}
          </ul>`
        : '';

    validationPanelEl.innerHTML = `
      <div class="validation-card ${statusClass}" data-validation-ok="${rep.ok}" data-issue-count="${rep.issues.length}">
        <div class="validation-head">
          <span class="validation-dot"></span>
          <strong class="validation-status" data-testid="validation-status">${escapeHtml(statusLabel)}</strong>
        </div>
        <div class="validation-meta">
          ${escapeHtml(store.state.doc.meta?.title || '未命名汉字集')}
        </div>
        ${issuesHtml}
      </div>`;
  }

  // 3. Render groups & character chips in left sidebar
  function renderGroupsSidebar() {
    const doc = store.state.doc;
    if (!doc || doc.groups.length === 0) {
      groupsListEl.innerHTML = `<div class="sidebar-empty">暂无字库数据，请上传 JSON 文件</div>`;
      return;
    }

    const q = (store.state.searchQuery || '').trim().toLowerCase();
    const sel = store.state.selectedChars;
    const active = store.state.activeChar;

    groupsListEl.innerHTML = doc.groups
      .map((g) => {
        const filtered = q
          ? g.characters.filter(
              (c) =>
                c.char.includes(q) ||
                c.pinyin.toLowerCase().includes(q) ||
                c.words.some((w) => w.includes(q)),
            )
          : g.characters;

        if (q && filtered.length === 0) return '';

        const selectedInGroup = g.characters.filter((c) => sel.has(c.char)).length;
        const allChecked = selectedInGroup === g.characters.length && g.characters.length > 0;

        const chipsHtml = filtered
          .map((c) => {
            const isSel = sel.has(c.char);
            const isAct = active === c.char;
            const isEd = Boolean(store.state.overrides[c.char]);
            return `
              <div class="char-chip ${isSel ? 'is-checked' : ''} ${isAct ? 'is-active' : ''} ${isEd ? 'is-edited' : ''}"
                   data-char="${escapeHtml(c.char)}"
                   title="${escapeHtml(c.char)} (${escapeHtml(c.pinyin)}) - 点击微调，勾选框控制是否打印">
                <input type="checkbox"
                       class="chip-check"
                       data-char="${escapeHtml(c.char)}"
                       ${isSel ? 'checked' : ''}
                       aria-label="选择 ${escapeHtml(c.char)}" />
                <button type="button" class="chip-label" data-char="${escapeHtml(c.char)}">${escapeHtml(c.char)}</button>
              </div>`;
          })
          .join('');

        return `
          <details class="group-item" data-group-index="${g.index}" ${g.index < 2 || q ? 'open' : ''}>
            <summary class="group-summary">
              <input type="checkbox"
                     class="group-check"
                     data-testid="group-check-${g.index}"
                     data-group-index="${g.index}"
                     ${allChecked ? 'checked' : ''} />
              <span class="group-title">${escapeHtml(g.category)}</span>
              <span class="group-count">${selectedInGroup}/${g.characters.length}</span>
            </summary>
            <div class="group-chips">${chipsHtml}</div>
          </details>`;
      })
      .join('');
  }

  // Event delegation on groups list
  groupsListEl.addEventListener('change', (e) => {
    const groupChk = e.target.closest('.group-check');
    if (groupChk) {
      const gi = Number(groupChk.dataset.groupIndex);
      store.toggleGroupSelection(gi, groupChk.checked);
      return;
    }
    const chipChk = e.target.closest('.chip-check');
    if (chipChk) {
      store.toggleCharSelection(chipChk.dataset.char, chipChk.checked);
    }
  });

  groupsListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-label');
    if (!btn) return;
    const ch = btn.dataset.char;
    if (!ch) return;
    if (!store.state.selectedChars.has(ch)) {
      store.toggleCharSelection(ch, true);
    }
    store.setActiveChar(ch);
    preview.scrollToChar(ch);
  });

  // 4. Sync toolbar controls with store.state.settings
  function syncToolbarFromState() {
    const { perPage, rows, trace, mono, showFooterTitle, zoom } = store.state.settings;
    const spec = SPECS[perPage] || SPECS[2];
    const slot0 = unitSlots(perPage)[0];
    const geom = unitGeometry(perPage, slot0, { rows: rows ?? undefined, trace: trace ?? undefined });

    for (const btn of document.querySelectorAll('[data-per-page]')) {
      btn.classList.toggle('is-active', Number(btn.dataset.perPage) === perPage);
    }

    const rowsInput = document.getElementById('setting-rows');
    const traceInput = document.getElementById('setting-trace');
    if (rowsInput) {
      rowsInput.max = String(geom.grid.maxRows);
      rowsInput.value = String(geom.grid.rows);
    }
    if (traceInput) {
      traceInput.max = String(geom.grid.rows);
      traceInput.value = String(geom.grid.trace);
    }

    const monoChk = document.getElementById('setting-mono');
    if (monoChk) monoChk.checked = Boolean(mono);

    const footerChk = document.getElementById('setting-footer-title');
    if (footerChk) footerChk.checked = Boolean(showFooterTitle);

    const zoomInput = document.getElementById('setting-zoom');
    if (zoomInput) zoomInput.value = String(Math.round((zoom || 0.72) * 100));
  }

  function updateSummaryBar() {
    const selCount = store.state.selectedChars.size;
    const totalCount = store.state.doc?.characters.length || 0;
    const perPage = store.state.settings.perPage || 2;
    const pCount = pageCount(selCount, perPage);
    const editCount = Object.keys(store.state.overrides).length;
    if (summaryStatsEl) {
      summaryStatsEl.textContent = `已选 ${selCount} / ${totalCount} 字 · 共 ${pCount} 页（每页 ${perPage} 字）${editCount ? ` · 已微调 ${editCount} 字` : ''}`;
    }
    const pageJump = document.getElementById('page-jump-input');
    if (pageJump) {
      pageJump.max = String(Math.max(1, pCount));
    }
  }

  // Subscribe to store changes
  store.subscribe((state, reason, detail) => {
    if (reason === 'settings') {
      syncToolbarFromState();
      preview.renderAll();
      if (state.activeChar) editor.render();
      updateSummaryBar();
    } else if (reason === 'selection') {
      renderGroupsSidebar();
      preview.renderAll();
      updateSummaryBar();
    } else if (reason === 'activeChar') {
      renderGroupsSidebar();
      preview.highlightActiveChar();
      editor.render();
    } else if (reason === 'override') {
      renderGroupsSidebar();
      preview.updateCharOnPage(detail?.char);
      editor.render();
      updateSummaryBar();
    }
  });

  // 5. Wire toolbar & sidebar events
  for (const btn of document.querySelectorAll('[data-per-page]')) {
    btn.addEventListener('click', () => {
      store.updateSettings({ perPage: Number(btn.dataset.perPage) });
    });
  }

  document.getElementById('setting-rows')?.addEventListener('change', (e) => {
    store.updateSettings({ rows: Number(e.target.value) });
  });
  document.getElementById('setting-trace')?.addEventListener('change', (e) => {
    store.updateSettings({ trace: Number(e.target.value) });
  });
  document.getElementById('setting-mono')?.addEventListener('change', (e) => {
    store.updateSettings({ mono: e.target.checked });
  });
  document.getElementById('setting-footer-title')?.addEventListener('change', (e) => {
    store.updateSettings({ showFooterTitle: e.target.checked });
  });
  document.getElementById('setting-zoom')?.addEventListener('input', (e) => {
    const z = Math.min(1.2, Math.max(0.4, Number(e.target.value) / 100));
    store.state.settings.zoom = z;
    stageEl.style.setProperty('--sheet-zoom', String(z));
  });

  // File upload
  document.getElementById('json-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await ingestDataset(text);
    e.target.value = '';
  });

  // Drag & drop JSON anywhere
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.name.endsWith('.json')) return;
    const text = await file.text();
    await ingestDataset(text);
  });

  // Load default 1000-character dataset
  async function loadDefaultDataset() {
    for (const url of DEFAULT_DATA_URLS) {
      try {
        const res = await fetch(new URL(url, import.meta.url));
        if (res.ok) {
          const text = await res.text();
          await ingestDataset(text);
          return;
        }
      } catch {
        /* try next */
      }
    }
  }

  document.getElementById('btn-load-default')?.addEventListener('click', loadDefaultDataset);

  // Selection controls
  document.getElementById('btn-select-all')?.addEventListener('click', () => {
    if (!store.state.doc) return;
    store.setSelection(store.state.doc.characters.map((c) => c.char));
  });
  document.getElementById('btn-select-none')?.addEventListener('click', () => {
    store.setSelection([]);
  });
  document.getElementById('btn-select-range')?.addEventListener('click', () => {
    const s = Number(document.getElementById('range-start')?.value || 1);
    const e = Number(document.getElementById('range-end')?.value || 12);
    store.selectRange(s, e);
  });

  document.getElementById('char-search-input')?.addEventListener('input', (e) => {
    store.state.searchQuery = e.target.value;
    renderGroupsSidebar();
  });

  document.getElementById('page-jump-input')?.addEventListener('change', (e) => {
    preview.scrollToPage(Number(e.target.value || 1));
  });

  // Export merged JSON
  document.getElementById('btn-export-json')?.addEventListener('click', () => {
    const merged = store.exportMerged();
    if (!merged) return;
    const jsonText = JSON.stringify(merged, null, 2);
    window.__hanziExportedJson = jsonText;
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hanzi-print-merged.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  // Print / Export PDF
  document.getElementById('btn-print-pdf')?.addEventListener('click', () => {
    printController.triggerPrint();
  });

  // Load default dataset on startup
  await loadDefaultDataset();
}

initApp();

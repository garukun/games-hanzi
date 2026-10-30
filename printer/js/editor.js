/**
 * Per-character fine-tuning editor drawer.
 *
 * Allows editing pinyin, words (inline & display selection), radical/stroke overrides,
 * and swapping illustrations (Fluent Emoji search, count 1–10, 3D colour-glyph, or file upload).
 */

import { escapeHtml } from './render-sheet.js';
import { renderEmojiPickerResults, readFileAsDataUrl } from './picker.js';

export function setupCharacterEditor(panelEl, store) {
  let currentPickerQuery = '';

  function render() {
    const ch = store.state.activeChar;
    if (!ch) {
      panelEl.innerHTML = `
        <div class="editor-placeholder">
          <div class="editor-placeholder-icon">✎</div>
          <h3>逐字微调面板</h3>
          <p>点击左侧预览纸张上的任意汉字卡片，即可在此修改拼音、组词、部首笔画或更换插图。</p>
          <div class="editor-global-actions">
            <button type="button" class="btn btn-secondary" id="btn-editor-undo" data-testid="btn-undo" ${store.state.undoStack.length === 0 ? 'disabled' : ''}>
              ↶ 撤销上一步修改 (${store.state.undoStack.length})
            </button>
          </div>
        </div>`;
      panelEl.querySelector('#btn-editor-undo')?.addEventListener('click', () => {
        store.undoLastOverride();
      });
      return;
    }

    const item = store.resolveCharItem(ch);
    if (!item) return;

    const ill = item.illustration;
    const displaySet = new Set(item.display_words && item.display_words.length ? item.display_words : item.pickedWords);

    panelEl.innerHTML = `
      <div class="editor-header">
        <div class="editor-char-badge">${escapeHtml(item.char)}</div>
        <div class="editor-title-meta">
          <div class="editor-char-title">
            <strong>「${escapeHtml(item.char)}」微调</strong>
            ${item.isEdited ? '<span class="badge-edited" data-testid="badge-edited">已修改</span>' : '<span class="badge-default">默认</span>'}
          </div>
          <div class="editor-category">${escapeHtml(item.category)} · 第 ${item.index + 1} 字</div>
        </div>
        <button type="button" class="btn-icon" id="btn-close-editor" title="关闭面板" aria-label="关闭面板">✕</button>
      </div>

      <div class="editor-toolbar">
        <button type="button" class="btn btn-sm btn-secondary" id="btn-undo-edit" data-testid="btn-undo" ${store.state.undoStack.length === 0 ? 'disabled' : ''}>
          ↶ 撤销 (${store.state.undoStack.length})
        </button>
        <button type="button" class="btn btn-sm btn-secondary" id="btn-reset-char" data-testid="btn-reset-char" ${!item.isEdited ? 'disabled' : ''}>
          ↺ 恢复本字默认
        </button>
      </div>

      <div class="editor-body">
        <!-- Pinyin, Radical, Strokes -->
        <section class="editor-section">
          <h4>基础属性</h4>
          <div class="editor-grid-3">
            <label class="field-label">
              <span>拼音</span>
              <input type="text" id="edit-pinyin" data-testid="edit-pinyin" value="${escapeHtml(item.pinyin)}" />
            </label>
            <label class="field-label">
              <span>部首</span>
              <input type="text" id="edit-radical" data-testid="edit-radical" value="${escapeHtml(item.radical)}" />
            </label>
            <label class="field-label">
              <span>笔画数</span>
              <input type="number" id="edit-strokes" data-testid="edit-strokes" min="1" max="40" value="${item.strokes}" />
            </label>
          </div>
        </section>

        <!-- Words -->
        <section class="editor-section">
          <div class="section-head">
            <h4>组词编排</h4>
            <span class="section-hint">勾选优先显示的词，或直接修改词条文字</span>
          </div>
          <div class="words-list" id="edit-words-list">
            ${item.words
              .map(
                (w, idx) => `
              <div class="word-edit-row" data-word-idx="${idx}">
                <input type="checkbox"
                       class="word-display-check"
                       data-testid="word-check-${idx}"
                       data-idx="${idx}"
                       title="在字帖卡片上显示此词"
                       ${displaySet.has(w) ? 'checked' : ''} />
                <input type="text"
                       class="word-text-input"
                       data-testid="edit-word-item-${idx}"
                       data-idx="${idx}"
                       value="${escapeHtml(w)}" />
                <button type="button" class="btn-word-act" data-act="up" data-idx="${idx}" title="上移" ${idx === 0 ? 'disabled' : ''}>↑</button>
                <button type="button" class="btn-word-act" data-act="down" data-idx="${idx}" title="下移" ${idx === item.words.length - 1 ? 'disabled' : ''}>↓</button>
                <button type="button" class="btn-word-act btn-word-del" data-act="del" data-idx="${idx}" title="删除">✕</button>
              </div>`,
              )
              .join('')}
          </div>
          <div class="word-add-row">
            <input type="text" id="edit-new-word" data-testid="edit-new-word" placeholder="输入新组词（如：${escapeHtml(item.char)}…）" />
            <button type="button" class="btn btn-sm btn-primary" id="btn-add-word" data-testid="btn-add-word">＋ 添加</button>
          </div>
        </section>

        <!-- Illustration -->
        <section class="editor-section">
          <div class="section-head">
            <h4>插图设置</h4>
            <span class="section-hint">当前：${ill.type === 'emoji' ? `图标 (${ill.id}${ill.count > 1 ? ' ×' + ill.count : ''})` : ill.type === 'glyph' ? '彩色立体字' : '自定义图片'}</span>
          </div>

          <div class="ill-mode-tabs">
            <button type="button" class="ill-tab ${ill.type === 'emoji' ? 'is-active' : ''}" data-mode="emoji" data-testid="ill-mode-emoji">Fluent 图标</button>
            <button type="button" class="ill-tab ${ill.type === 'glyph' ? 'is-active' : ''}" data-mode="glyph" data-testid="ill-mode-glyph">彩色立体字</button>
            <label class="ill-tab ${ill.type === 'upload' ? 'is-active' : ''}" data-testid="ill-mode-upload">
              <span>上传图片</span>
              <input type="file" id="edit-image-upload" data-testid="edit-image-upload" accept="image/*" hidden />
            </label>
          </div>

          ${
            ill.type === 'emoji'
              ? `
            <div class="ill-count-row">
              <label for="edit-emoji-count">图标重复数量（1–10）：</label>
              <input type="number" id="edit-emoji-count" data-testid="edit-emoji-count" min="1" max="10" value="${ill.count || 1}" />
            </div>`
              : ''
          }

          <div class="emoji-picker-box">
            <input type="search"
                   id="emoji-search-input"
                   data-testid="emoji-search-input"
                   placeholder="搜索图标（如：苹果、菠萝、狗、太阳、apple…）"
                   value="${escapeHtml(currentPickerQuery)}" />
            <div class="emoji-picker-grid" id="emoji-picker-grid" data-testid="emoji-picker-grid"></div>
          </div>
        </section>
      </div>
    `;

    // Wire events
    panelEl.querySelector('#btn-close-editor')?.addEventListener('click', () => store.setActiveChar(null));
    panelEl.querySelector('#btn-undo-edit')?.addEventListener('click', () => store.undoLastOverride());
    panelEl.querySelector('#btn-reset-char')?.addEventListener('click', () => store.resetCharOverride(ch));

    // Pinyin, Radical, Strokes
    panelEl.querySelector('#edit-pinyin')?.addEventListener('change', (e) => {
      const val = e.target.value.trim();
      if (val) store.updateCharOverride(ch, { pinyin: val });
    });
    panelEl.querySelector('#edit-radical')?.addEventListener('change', (e) => {
      const val = e.target.value.trim();
      if (val) store.updateCharOverride(ch, { radical: val });
    });
    panelEl.querySelector('#edit-strokes')?.addEventListener('change', (e) => {
      const val = Number(e.target.value);
      if (Number.isFinite(val) && val > 0) store.updateCharOverride(ch, { strokes: Math.round(val) });
    });

    // Word text edits & display checkboxes
    const commitWordsChange = (nextWords, nextDisplay) => {
      store.updateCharOverride(ch, {
        words: nextWords,
        display_words: nextDisplay && nextDisplay.length > 0 ? nextDisplay : undefined,
      });
    };

    for (const input of panelEl.querySelectorAll('.word-text-input')) {
      input.addEventListener('change', () => {
        const idx = Number(input.dataset.idx);
        const val = input.value.trim();
        if (!val) return;
        const oldWord = item.words[idx];
        const nextWords = [...item.words];
        nextWords[idx] = val;
        const curDisplay = [...displaySet].map((w) => (w === oldWord ? val : w));
        commitWordsChange(nextWords, curDisplay);
      });
    }

    for (const chk of panelEl.querySelectorAll('.word-display-check')) {
      chk.addEventListener('change', () => {
        const selected = [];
        for (const row of panelEl.querySelectorAll('.word-edit-row')) {
          const c = row.querySelector('.word-display-check');
          const t = row.querySelector('.word-text-input');
          if (c?.checked && t?.value.trim()) selected.push(t.value.trim());
        }
        commitWordsChange([...item.words], selected);
      });
    }

    for (const btn of panelEl.querySelectorAll('.btn-word-act')) {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        const act = btn.dataset.act;
        const nextWords = [...item.words];
        if (act === 'up' && idx > 0) {
          [nextWords[idx - 1], nextWords[idx]] = [nextWords[idx], nextWords[idx - 1]];
        } else if (act === 'down' && idx < nextWords.length - 1) {
          [nextWords[idx + 1], nextWords[idx]] = [nextWords[idx], nextWords[idx + 1]];
        } else if (act === 'del' && nextWords.length > 1) {
          nextWords.splice(idx, 1);
        }
        const nextDisplay = [...displaySet].filter((w) => nextWords.includes(w));
        commitWordsChange(nextWords, nextDisplay);
      });
    }

    const addNewWord = () => {
      const inp = panelEl.querySelector('#edit-new-word');
      const val = inp?.value.trim();
      if (!val) return;
      const nextWords = [...item.words, val];
      const nextDisplay = [...displaySet, val];
      inp.value = '';
      commitWordsChange(nextWords, nextDisplay);
    };
    panelEl.querySelector('#btn-add-word')?.addEventListener('click', addNewWord);
    panelEl.querySelector('#edit-new-word')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addNewWord();
      }
    });

    // Illustration modes
    panelEl.querySelector('[data-mode="glyph"]')?.addEventListener('click', () => {
      store.updateCharOverride(ch, { image: { type: 'glyph', glyph: true } });
    });
    panelEl.querySelector('[data-mode="emoji"]')?.addEventListener('click', () => {
      if (ill.type !== 'emoji') {
        store.updateCharOverride(ch, { image: { type: 'emoji', id: 'red-apple', count: 1 } });
      }
    });

    panelEl.querySelector('#edit-emoji-count')?.addEventListener('change', (e) => {
      const count = Math.min(10, Math.max(1, Math.round(Number(e.target.value) || 1)));
      if (ill.type === 'emoji') {
        store.updateCharOverride(ch, { image: { type: 'emoji', id: ill.id, count } });
      }
    });

    panelEl.querySelector('#edit-image-upload')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const dataUrl = await readFileAsDataUrl(file);
      await store.updateCharOverride(ch, { image: { type: 'upload', src: dataUrl } });
    });

    const pickerGrid = panelEl.querySelector('#emoji-picker-grid');
    const searchInput = panelEl.querySelector('#emoji-search-input');
    const onEmojiSelect = (spec) => {
      const count = ill.type === 'emoji' ? ill.count || 1 : 1;
      store.updateCharOverride(ch, {
        image: spec.type === 'emoji' ? { type: 'emoji', id: spec.id, count } : spec,
      });
    };

    if (pickerGrid) {
      renderEmojiPickerResults(pickerGrid, currentPickerQuery, ill.id, onEmojiSelect);
    }
    searchInput?.addEventListener('input', (e) => {
      currentPickerQuery = e.target.value;
      if (pickerGrid) {
        renderEmojiPickerResults(pickerGrid, currentPickerQuery, ill.id, onEmojiSelect);
      }
    });
  }

  return { render };
}

/**
 * Fluent Emoji (Flat SVG) picker & custom image uploader component.
 */

import {
  searchEmojiCatalog,
  getEmojiCatalog,
  isVendoredEmoji,
  catalogThumbUrl,
} from './illustration.js';
import { escapeHtml } from './render-sheet.js';

export function renderEmojiPickerResults(gridEl, query, activeId, onSelect) {
  const results = searchEmojiCatalog(query, getEmojiCatalog(), 48);
  if (results.length === 0) {
    gridEl.innerHTML = `<div class="picker-empty">未找到匹配的图标，可尝试其他中英文关键词</div>`;
    return;
  }

  gridEl.innerHTML = results
    .map((entry) => {
      const isSelected = entry.id === activeId;
      const thumb = catalogThumbUrl(entry, './assets/emoji/');
      const title = `${entry.z ? entry.z.split(' ')[0] + ' · ' : ''}${entry.n}`;
      return `
        <button type="button"
                class="emoji-pick-btn ${isSelected ? 'is-active' : ''}"
                data-emoji-id="${escapeHtml(entry.id)}"
                title="${escapeHtml(title)}">
          <img src="${escapeHtml(thumb)}" alt="${escapeHtml(entry.n)}" loading="lazy" />
          <span class="emoji-pick-label">${escapeHtml(entry.z ? entry.z.split(' ')[0] : entry.n)}</span>
        </button>`;
    })
    .join('');

  for (const btn of gridEl.querySelectorAll('.emoji-pick-btn')) {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.emojiId;
      const entry = getEmojiCatalog().find((e) => e.id === id);
      if (!entry) return;
      if (isVendoredEmoji(id)) {
        onSelect({ type: 'emoji', id });
        return;
      }
      // Non-vendored icon: try to inline as data URL so PDF export stays self-contained
      try {
        const res = await fetch(catalogThumbUrl(entry));
        if (res.ok) {
          const svgText = await res.text();
          const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgText)}`;
          onSelect({ type: 'upload', src: dataUrl });
          return;
        }
      } catch {
        /* fallback to id */
      }
      onSelect({ type: 'emoji', id });
    });
  }
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

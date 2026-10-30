/**
 * Reactive state store + IndexedDB / localStorage persistence for the Hanzi print workbench.
 *
 * Keyed by `doc.fileHash` so edits to a dataset survive page reloads and can be undone or
 * exported back into a standalone JSON file.
 */

import { SPECS, pickWords } from './layout.js';
import { parseDataset, exportDatasetJson, normalizeImageSpec } from './schema.js';
import { getCachedHanzi } from './hanzi-data.js';
import { resolveIllustration, getIllustrationMap } from './illustration.js';

const DB_NAME = 'hanzi-print-db';
const DB_VERSION = 1;
const STORE_NAME = 'overrides';
const LS_PREFIX = 'hanzi-print:ov:';
const LS_SETTINGS = 'hanzi-print:settings:v2';

function openIdb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet(key) {
  const db = await openIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet(key, val) {
  const db = await openIdb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(val, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function lsGet(key) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function lsSet(key, val) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* quota or private mode */
  }
}

export function createPrintStore(initialSettings = {}) {
  const savedSettings = lsGet(LS_SETTINGS) || {};
  const state = {
    doc: null,
    charByHan: new Map(),
    overrides: {},
    undoStack: [],
    selectedChars: new Set(),
    activeChar: null,
    searchQuery: '',
    settings: {
      perPage: 2,
      cols: null,
      rows: null,
      trace: null,
      mono: false,
      showFooterTitle: true,
      zoom: 0.72,
      ...savedSettings,
      ...initialSettings,
    },
  };

  const listeners = new Set();
  const notify = (reason = 'update', detail = {}) => {
    for (const fn of listeners) fn(state, reason, detail);
  };

  function persistOverridesSync() {
    if (!state.doc?.fileHash) return null;
    const key = state.doc.fileHash;
    const copy = JSON.parse(JSON.stringify(state.overrides));
    lsSet(LS_PREFIX + key, copy);
    return { key, copy };
  }

  async function persistOverrides() {
    const res = persistOverridesSync();
    if (res) await idbSet(res.key, res.copy);
  }

  async function loadDataset(input, { keepSelection = false } = {}) {
    const doc = parseDataset(input);
    state.doc = doc;
    state.charByHan = new Map(doc.characters.map((c) => [c.char, c]));
    state.undoStack = [];

    // Restore persisted overrides from localStorage immediately, then check IndexedDB.
    const lsOv = lsGet(LS_PREFIX + doc.fileHash);
    state.overrides = lsOv && typeof lsOv === 'object' ? lsOv : {};
    const idbOv = await idbGet(doc.fileHash);
    if (idbOv && typeof idbOv === 'object' && Object.keys(idbOv).length >= Object.keys(state.overrides).length) {
      state.overrides = idbOv;
      lsSet(LS_PREFIX + doc.fileHash, idbOv);
    }

    if (!keepSelection || state.selectedChars.size === 0) {
      state.selectedChars = new Set(doc.characters.map((c) => c.char));
    } else {
      const valid = new Set();
      for (const ch of state.selectedChars) {
        if (state.charByHan.has(ch)) valid.add(ch);
      }
      state.selectedChars = valid.size > 0 ? valid : new Set(doc.characters.map((c) => c.char));
    }

    if (state.activeChar && !state.charByHan.has(state.activeChar)) {
      state.activeChar = null;
    }

    notify('dataset', { doc });
    return doc;
  }

  function updateSettings(patch) {
    let perPageChanged = false;
    if (patch.perPage !== undefined && Number(patch.perPage) !== state.settings.perPage) {
      perPageChanged = true;
    }
    Object.assign(state.settings, patch);
    if (perPageChanged && patch.cols === undefined && patch.rows === undefined && patch.trace === undefined) {
      state.settings.cols = null;
      state.settings.rows = null;
      state.settings.trace = null;
    }
    lsSet(LS_SETTINGS, state.settings);
    notify('settings', { patch });
  }

  function setSelection(charsIterable) {
    const next = new Set();
    for (const ch of charsIterable) {
      if (state.charByHan.has(ch)) next.add(ch);
    }
    state.selectedChars = next;
    notify('selection');
  }

  function toggleGroupSelection(groupIndex, checked) {
    const g = state.doc?.groups?.[groupIndex];
    if (!g) return;
    for (const c of g.characters) {
      if (checked) state.selectedChars.add(c.char);
      else state.selectedChars.delete(c.char);
    }
    notify('selection', { groupIndex, checked });
  }

  function toggleCharSelection(ch, checked) {
    if (!state.charByHan.has(ch)) return;
    const shouldAdd = checked !== undefined ? checked : !state.selectedChars.has(ch);
    if (shouldAdd) state.selectedChars.add(ch);
    else state.selectedChars.delete(ch);
    notify('selection', { char: ch });
  }

  function selectRange(startOneBased, endOneBased) {
    if (!state.doc) return;
    const lo = Math.max(1, Math.min(startOneBased, endOneBased)) - 1;
    const hi = Math.min(state.doc.characters.length, Math.max(startOneBased, endOneBased)) - 1;
    const next = new Set();
    for (let i = lo; i <= hi; i++) {
      next.add(state.doc.characters[i].char);
    }
    state.selectedChars = next;
    notify('selection', { range: [lo + 1, hi + 1] });
  }

  function setActiveChar(ch) {
    state.activeChar = ch && state.charByHan.has(ch) ? ch : null;
    notify('activeChar', { char: state.activeChar });
  }

  async function updateCharOverride(ch, patch) {
    if (!state.charByHan.has(ch)) return;
    const prev = state.overrides[ch] ? JSON.parse(JSON.stringify(state.overrides[ch])) : null;
    state.undoStack.push({ char: ch, prev });
    if (state.undoStack.length > 50) state.undoStack.shift();

    const cur = { ...(state.overrides[ch] || {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) {
        delete cur[k];
      } else if (k === 'image') {
        cur.image = normalizeImageSpec(v);
      } else {
        cur[k] = v;
      }
    }
    if (Object.keys(cur).length === 0) {
      delete state.overrides[ch];
    } else {
      state.overrides[ch] = cur;
    }
    const sync = persistOverridesSync();
    notify('override', { char: ch });
    if (sync) await idbSet(sync.key, sync.copy);
  }

  async function resetCharOverride(ch) {
    if (!state.overrides[ch]) return;
    const prev = JSON.parse(JSON.stringify(state.overrides[ch]));
    state.undoStack.push({ char: ch, prev });
    delete state.overrides[ch];
    const sync = persistOverridesSync();
    notify('override', { char: ch });
    if (sync) await idbSet(sync.key, sync.copy);
  }

  async function undoLastOverride() {
    const last = state.undoStack.pop();
    if (!last) return null;
    if (last.prev) {
      state.overrides[last.char] = last.prev;
    } else {
      delete state.overrides[last.char];
    }
    const sync = persistOverridesSync();
    notify('override', { char: last.char, undo: true });
    if (sync) await idbSet(sync.key, sync.copy);
    return last.char;
  }

  async function clearAllOverrides() {
    state.overrides = {};
    state.undoStack = [];
    const sync = persistOverridesSync();
    notify('override', { all: true });
    if (sync) await idbSet(sync.key, sync.copy);
  }

  function resolveCharItem(ch, assetBase = './assets/emoji/') {
    const base = state.charByHan.get(ch);
    if (!base) return null;
    const ov = state.overrides[ch] || {};
    const hz = getCachedHanzi(ch);
    const spec = SPECS[state.settings.perPage] || SPECS[2];

    const pinyin = ov.pinyin !== undefined ? ov.pinyin : base.pinyin;
    const words = Array.isArray(ov.words) ? ov.words : base.words;
    const displayWords = ov.display_words !== undefined ? ov.display_words : base.display_words;
    const pickedWords = pickWords(words, displayWords, spec);

    const radical = ov.radical || base.radical || hz.r || '—';
    const strokes =
      Number(ov.strokes) > 0
        ? Number(ov.strokes)
        : Number(base.strokes) > 0
          ? Number(base.strokes)
          : hz.n > 0
            ? hz.n
            : 1;

    const customImage = ov.image !== undefined ? ov.image : base.image || null;
    const illustration = resolveIllustration(ch, customImage, getIllustrationMap(), assetBase);

    return {
      char: ch,
      index: base.index,
      groupIndex: base.groupIndex,
      category: base.category,
      pinyin,
      words,
      display_words: displayWords,
      pickedWords,
      radical,
      strokes,
      strokePaths: hz.s,
      medianPaths: hz.m,
      fallbackFont: Boolean(hz.fallback),
      illustration,
      isEdited: Object.keys(ov).length > 0,
    };
  }

  function getSelectedResolvedChars(assetBase = './assets/emoji/') {
    if (!state.doc) return [];
    const out = [];
    for (const c of state.doc.characters) {
      if (state.selectedChars.has(c.char)) {
        out.push(resolveCharItem(c.char, assetBase));
      }
    }
    return out;
  }

  function getValidationReport() {
    if (!state.doc) return { ok: false, issues: [], fallbackChars: [] };
    const issues = [...state.doc.issues];
    const fallbackChars = [];
    for (const c of state.doc.characters) {
      const hz = getCachedHanzi(c.char);
      if (hz.fallback) {
        fallbackChars.push(c.char);
      }
    }
    if (fallbackChars.length > 0) {
      issues.push({
        level: 'warning',
        code: 'FALLBACK_FONT',
        char: fallbackChars[0],
        message: `${fallbackChars.length} 个字缺少笔画矢量数据（${fallbackChars.slice(0, 10).join('、')}${fallbackChars.length > 10 ? '…' : ''}），已自动使用内置霞鹜文楷字体渲染`,
      });
    }
    return {
      ok: state.doc.ok,
      issues,
      fallbackChars,
      totalChars: state.doc.characters.length,
      rawCount: state.doc.rawCount,
      duplicateCount: state.doc.duplicateCount || 0,
    };
  }

  function exportMerged() {
    if (!state.doc) return null;
    return exportDatasetJson(state.doc, state.overrides);
  }

  return {
    state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    loadDataset,
    updateSettings,
    setSelection,
    toggleGroupSelection,
    toggleCharSelection,
    selectRange,
    setActiveChar,
    updateCharOverride,
    resetCharOverride,
    undoLastOverride,
    clearAllOverrides,
    resolveCharItem,
    getSelectedResolvedChars,
    getValidationReport,
    exportMerged,
  };
}

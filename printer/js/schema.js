/**
 * Schema parsing, validation, deterministic hashing, and JSON merge/export
 * for the Hanzi practice-sheet printing app.
 *
 * Compatible with spec/data/hanzi-1000-v4/v5/v6.json and extended optional fields:
 *   - radical: string
 *   - strokes: number
 *   - display_words: string[]
 *   - image: { emoji?: string, e?: string, count?: number, n?: number, glyph?: boolean, g?: number, src?: string }
 */

import { MAX_CHARS } from './layout.js';

/** Fast deterministic FNV-1a hex hash for keying per-file overrides. */
export function hashString(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c ^ (i & 0xff);
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** Normalize an image descriptor from either compact (`{e, n, g}`) or verbose (`{emoji, count, glyph, src}`) form. */
export function normalizeImageSpec(img) {
  if (!img || typeof img !== 'object') return null;
  if (typeof img.src === 'string' && img.src.trim()) {
    return { type: 'upload', src: img.src.trim() };
  }
  if (img.glyph || img.g) {
    return { type: 'glyph', glyph: true };
  }
  const rawId = img.id || img.emoji || img.e;
  if (typeof rawId === 'string' && rawId.trim()) {
    const id = rawId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const count = Number(img.count ?? img.n ?? 1);
    const n = Number.isFinite(count) ? Math.min(10, Math.max(1, Math.round(count))) : 1;
    return n > 1 ? { type: 'emoji', id, count: n } : { type: 'emoji', id, count: 1 };
  }
  return null;
}

/** Convert a normalized image spec back to the clean JSON schema format for export. */
export function serializeImageSpec(spec) {
  if (!spec || typeof spec !== 'object') return undefined;
  if (spec.type === 'upload' && spec.src) return { src: spec.src };
  if (spec.type === 'glyph' || spec.glyph || spec.g) return { glyph: true };
  const id = spec.id || spec.emoji || spec.e;
  if (id) {
    const count = Number(spec.count ?? spec.n ?? 1);
    return count > 1 ? { emoji: id, count } : { emoji: id };
  }
  return undefined;
}

/**
 * Parse and validate a Hanzi JSON dataset.
 * @param {string|object} input Raw JSON text or parsed object
 * @returns {{
 *   ok: boolean,
 *   meta: object,
 *   groups: Array<{category:string, index:number, characters:Array<object>}>,
 *   characters: Array<object>,
 *   issues: Array<{level:'error'|'warning'|'info', code:string, char?:string, message:string}>,
 *   fileHash: string,
 *   rawCount: number
 * }}
 */
export function parseDataset(input) {
  const issues = [];
  let rawObj = null;

  if (typeof input === 'string') {
    try {
      rawObj = JSON.parse(input);
    } catch (err) {
      return {
        ok: false,
        meta: {},
        groups: [],
        characters: [],
        issues: [{ level: 'error', code: 'INVALID_JSON', message: `JSON 格式错误：${err.message}` }],
        fileHash: 'invalid',
        rawCount: 0,
      };
    }
  } else if (input && typeof input === 'object') {
    rawObj = input;
  } else {
    return {
      ok: false,
      meta: {},
      groups: [],
      characters: [],
      issues: [{ level: 'error', code: 'INVALID_JSON', message: '输入数据为空或不是有效 JSON 对象' }],
      fileHash: 'invalid',
      rawCount: 0,
    };
  }

  const meta = rawObj.meta && typeof rawObj.meta === 'object' ? { ...rawObj.meta } : { title: '汉字描红字帖' };
  let rawGroups = [];
  if (Array.isArray(rawObj.groups)) {
    rawGroups = rawObj.groups;
  } else if (Array.isArray(rawObj.characters)) {
    rawGroups = [{ category: meta.title || '默认分组', characters: rawObj.characters }];
  } else {
    return {
      ok: false,
      meta,
      groups: [],
      characters: [],
      issues: [{ level: 'error', code: 'MISSING_GROUPS', message: '缺少 groups 或 characters 字段' }],
      fileHash: 'invalid',
      rawCount: 0,
    };
  }

  const seen = new Map();
  const duplicateChars = new Set();
  const groups = [];
  const characters = [];
  let rawCount = 0;

  rawGroups.forEach((g, gi) => {
    if (!g || typeof g !== 'object') return;
    const category = typeof g.category === 'string' && g.category.trim() ? g.category.trim() : `第 ${gi + 1} 组`;
    const list = Array.isArray(g.characters) ? g.characters : [];
    if (!Array.isArray(g.characters)) {
      issues.push({ level: 'warning', code: 'MISSING_GROUP_CHARS', message: `分组「${category}」缺少 characters 数组` });
    }
    const groupChars = [];

    list.forEach((item, ci) => {
      rawCount++;
      if (!item || typeof item !== 'object') {
        issues.push({ level: 'error', code: 'INVALID_CHAR_ITEM', message: `${category} 第 ${ci + 1} 项不是有效对象` });
        return;
      }
      const ch = typeof item.char === 'string' ? item.char.trim() : '';
      if (!ch) {
        issues.push({ level: 'error', code: 'MISSING_CHAR', message: `${category} 第 ${ci + 1} 项缺少 char 字段` });
        return;
      }
      const glyphs = [...ch];
      const han = glyphs[0];
      if (glyphs.length !== 1) {
        issues.push({
          level: 'warning',
          code: 'MULTI_CHAR',
          char: han,
          message: `字符「${ch}」长度超过 1，已取首字「${han}」`,
        });
      }

      if (seen.has(han)) {
        duplicateChars.add(han);
        issues.push({
          level: 'warning',
          code: 'DUPLICATE_CHAR',
          char: han,
          message: `重复汉字「${han}」（首次出现于 ${seen.get(han)}，再次出现于 ${category}）`,
        });
        return;
      }

      if (characters.length >= MAX_CHARS) {
        return;
      }
      seen.set(han, category);

      const pinyin = typeof item.pinyin === 'string' ? item.pinyin.trim() : '';
      if (!pinyin) {
        issues.push({
          level: 'warning',
          code: 'MISSING_PINYIN',
          char: han,
          message: `汉字「${han}」缺少拼音（pinyin）字段`,
        });
      }

      let words = [];
      if (Array.isArray(item.words)) {
        words = item.words.map((w) => (typeof w === 'string' ? w.trim() : '')).filter(Boolean);
      } else {
        issues.push({
          level: 'warning',
          code: 'MISSING_WORDS',
          char: han,
          message: `汉字「${han}」缺少组词（words）数组`,
        });
      }
      if (words.length === 0) {
        issues.push({
          level: 'warning',
          code: 'EMPTY_WORDS',
          char: han,
          message: `汉字「${han}」没有任何组词`,
        });
      } else {
        const badWords = words.filter((w) => !w.includes(han));
        if (badWords.length > 0) {
          issues.push({
            level: 'warning',
            code: 'WORD_MISSING_CHAR',
            char: han,
            message: `汉字「${han}」的组词未包含本字：${badWords.join('、')}`,
          });
        }
      }

      const displayWords = Array.isArray(item.display_words)
        ? item.display_words.map((w) => (typeof w === 'string' ? w.trim() : '')).filter(Boolean)
        : undefined;
      const radical = typeof item.radical === 'string' && item.radical.trim() ? item.radical.trim() : undefined;
      const strokes =
        Number.isFinite(Number(item.strokes)) && Number(item.strokes) > 0 ? Math.round(Number(item.strokes)) : undefined;
      const image = normalizeImageSpec(item.image);

      const record = {
        index: characters.length,
        groupIndex: groups.length,
        category,
        char: han,
        pinyin,
        words,
        ...(displayWords ? { display_words: displayWords } : {}),
        ...(radical ? { radical } : {}),
        ...(strokes ? { strokes } : {}),
        ...(image ? { image } : {}),
      };
      characters.push(record);
      groupChars.push(record);
    });

    if (groupChars.length > 0) {
      groups.push({ category, index: groups.length, characters: groupChars });
    }
  });

  if (rawCount > MAX_CHARS) {
    issues.unshift({
      level: 'error',
      code: 'MAX_CHARS_EXCEEDED',
      message: `汉字数量超过 ${MAX_CHARS} 字上限（输入共 ${rawCount} 项，已仅保留前 ${characters.length} 个不重复字）`,
    });
  }

  if (characters.length === 0) {
    issues.push({ level: 'error', code: 'EMPTY_DATASET', message: '未解析到任何有效汉字' });
  }

  const canonical = JSON.stringify({
    t: meta.title || '',
    c: characters.map((c) => [c.char, c.pinyin, c.words]),
  });
  const fileHash = hashString(canonical);

  return {
    ok: characters.length > 0,
    meta,
    groups,
    characters,
    issues,
    fileHash,
    rawCount,
    duplicateCount: duplicateChars.size,
  };
}

/**
 * Merge user per-character overrides back into a clean dataset JSON object ready for download/re-upload.
 * @param {ReturnType<typeof parseDataset>} doc
 * @param {Record<string, object>} overrides
 */
export function exportDatasetJson(doc, overrides = {}) {
  const outGroups = doc.groups.map((g) => ({
    category: g.category,
    characters: g.characters.map((c) => {
      const ov = overrides[c.char] || {};
      const pinyin = ov.pinyin !== undefined ? ov.pinyin : c.pinyin;
      const words = Array.isArray(ov.words) ? [...ov.words] : [...c.words];
      const displayWords =
        ov.display_words !== undefined
          ? ov.display_words
          : c.display_words
            ? [...c.display_words]
            : undefined;
      const radical = ov.radical !== undefined ? ov.radical : c.radical;
      const strokes = ov.strokes !== undefined ? ov.strokes : c.strokes;
      const imgSpec = ov.image !== undefined ? normalizeImageSpec(ov.image) : c.image;
      const serializedImg = serializeImageSpec(imgSpec);

      const entry = {
        char: c.char,
        pinyin,
        words,
      };
      if (Array.isArray(displayWords) && displayWords.length > 0) entry.display_words = displayWords;
      if (radical) entry.radical = radical;
      if (Number.isFinite(strokes) && strokes > 0) entry.strokes = Number(strokes);
      if (serializedImg) entry.image = serializedImg;
      return entry;
    }),
  }));

  return {
    meta: {
      ...doc.meta,
      total_characters: doc.characters.length,
    },
    groups: outGroups,
  };
}

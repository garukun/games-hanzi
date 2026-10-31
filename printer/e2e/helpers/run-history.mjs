/**
 * Local run-history cache for E2E random character sampling.
 *
 * Persists previously generated characters in `printer/e2e/output/run-history.json`
 * so subsequent E2E runs avoid picking repeated characters until the 1,000-character
 * curriculum pool is exhausted (at which point it wraps around cleanly).
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRINTER_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DEFAULT_HISTORY_PATH = join(PRINTER_ROOT, 'e2e', 'output', 'run-history.json');

// Pre-seed with characters from earlier 24-character runs so they are not repeated either.
const INITIAL_SEED_CHARS = [
  // Prior run 1 (24 chars)
  '朝', '数', '岗', '解', '城', '摘', '齐', '末', '已', '伙', '芽', '谦',
  '举', '夕', '晃', '贺', '饱', '箱', '妹', '秒', '丢', '考', '哨', '伯',
  // Prior run 2 (24 chars)
  '支', '转', '让', '院', '寸', '音', '自', '懒', '弯', '贝', '文', '白',
  '床', '尊', '果', '岭', '驶', '休', '纸', '晒', '砚', '物', '桥', '怪',
];

/** Generate a random 4-character lowercase hex run ID (e.g. "a4f9"). */
export function generateRunId() {
  return randomBytes(2).toString('hex');
}

/** Load or initialize the local run history JSON file. */
export function loadRunHistory(historyPath = DEFAULT_HISTORY_PATH) {
  if (existsSync(historyPath)) {
    try {
      const parsed = JSON.parse(readFileSync(historyPath, 'utf8'));
      if (parsed && Array.isArray(parsed.usedCharacters) && Array.isArray(parsed.runs)) {
        return parsed;
      }
    } catch {
      /* fall through to re-init */
    }
  }
  const initial = {
    updatedAt: new Date().toISOString(),
    totalUniqueUsed: new Set(INITIAL_SEED_CHARS).size,
    usedCharacters: [...new Set(INITIAL_SEED_CHARS)],
    runs: [
      {
        runId: 'seed',
        prefix: 'r24l3-seed',
        timestamp: new Date().toISOString(),
        layout: 3,
        count: new Set(INITIAL_SEED_CHARS).size,
        characters: [...new Set(INITIAL_SEED_CHARS)],
        note: 'Pre-seeded from prior 24-character E2E runs',
      },
    ],
  };
  mkdirSync(dirname(historyPath), { recursive: true });
  writeFileSync(historyPath, JSON.stringify(initial, null, 2));
  return initial;
}

/**
 * Sample `count` random characters from `allChars` while avoiding characters
 * already recorded in `run-history.json`.
 *
 * If fewer than `count` unused characters remain in the 1,000-character pool,
 * all remaining unused characters are selected first and the pool wraps around
 * to fill the remainder without duplicating within the current run.
 */
export function sampleNonRepeatingChars(allChars, count, { prefix = 'r150l3', layout = 3, historyPath = DEFAULT_HISTORY_PATH } = {}) {
  const history = loadRunHistory(historyPath);
  const existingRunIds = new Set(history.runs.map((r) => r.runId));
  let runId = generateRunId();
  while (existingRunIds.has(runId)) {
    runId = generateRunId();
  }

  const usedSet = new Set(history.usedCharacters);
  const unusedPool = allChars.filter((c) => !usedSet.has(c.char));

  const shuffle = (arr) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  let picked = [];
  let wrappedPool = false;
  if (unusedPool.length >= count) {
    picked = shuffle(unusedPool).slice(0, count);
  } else {
    wrappedPool = true;
    const remainderNeeded = count - unusedPool.length;
    const pickedCharsSet = new Set(unusedPool.map((c) => c.char));
    const recycledPool = shuffle(allChars.filter((c) => !pickedCharsSet.has(c.char))).slice(0, remainderNeeded);
    picked = [...shuffle(unusedPool), ...recycledPool];
    // Reset usedSet to only the recycled chars + newly picked after wrap-around
    usedSet.clear();
  }

  for (const item of picked) {
    usedSet.add(item.char);
  }

  return {
    runId,
    prefix,
    runTag: `${prefix}-${runId}`,
    layout,
    picked,
    wrappedPool,
    previouslyUsedCount: history.usedCharacters.length,
    remainingUnusedAfterRun: allChars.length - usedSet.size,
    commitRun(outputFiles = []) {
      const updatedHistory = {
        updatedAt: new Date().toISOString(),
        totalUniqueUsed: usedSet.size,
        remainingInPool: allChars.length - usedSet.size,
        usedCharacters: [...usedSet],
        runs: [
          ...history.runs,
          {
            runId,
            prefix,
            runTag: `${prefix}-${runId}`,
            timestamp: new Date().toISOString(),
            layout,
            count: picked.length,
            wrappedPool,
            characters: picked.map((c) => c.char),
            outputFiles,
          },
        ],
      };
      mkdirSync(dirname(historyPath), { recursive: true });
      writeFileSync(historyPath, JSON.stringify(updatedHistory, null, 2));
      return updatedHistory;
    },
  };
}


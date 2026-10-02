#!/usr/bin/env node
/**
 * The game ships as one self-contained HTML file. qwen.html is the source of
 * truth; this copies it into build/ where it can be served as a static site.
 *
 *   node build.mjs          # write build/index.html
 *   node build.mjs --check  # exit 1 if build/index.html is stale
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const SRC = join(root, 'qwen.html');
const OUT_DIR = join(root, 'build');
const OUT = join(OUT_DIR, 'index.html');

const html = readFileSync(SRC, 'utf8');

// The tests extract these blocks, so a missing marker means tests would silently
// stop covering the shipped code.
for (const marker of [
  'VOICE ENGINE START',
  'VOICE ENGINE END',
  'FACES START',
  'FACES END',
  'PRAISE START',
  'PRAISE END',
  'PROMPT START',
  'PROMPT END',
  'PACE START',
  'PACE END',
  'LEARNED START',
  'LEARNED END',
  'PULSE START',
  'PULSE END',
]) {
  if (!html.includes(marker)) {
    console.error(`build: ${SRC} is missing the "${marker}" marker that the tests rely on`);
    process.exit(1);
  }
}

const check = process.argv.includes('--check');
if (check) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== html) {
    console.error('build: build/index.html is out of date — run `node build.mjs`');
    process.exit(1);
  }
  console.log('build: up to date');
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, html);
  console.log(`build: wrote ${OUT} (${(html.length / 1024).toFixed(1)} kB)`);
}

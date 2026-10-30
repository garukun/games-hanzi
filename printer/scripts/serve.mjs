#!/usr/bin/env node
/**
 * Zero-dependency static file server for developing and testing the Hanzi print tool.
 *
 *   node scripts/serve.mjs [port]   # default port 4173, serves repo root
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

export function startStaticServer({ port = 0, root = ROOT } = {}) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/printer/index.html';
      else if (pathname.endsWith('/')) pathname += 'index.html';

      const safePath = normalize(join(root, pathname));
      if (!safePath.startsWith(root)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      const info = await stat(safePath);
      const target = info.isDirectory() ? join(safePath, 'index.html') : safePath;
      const buf = await readFile(target);
      const ext = extname(target).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(buf);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolvePromise({
        server,
        port: addr.port,
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const requestedPort = Number(process.argv[2] || process.env.PORT || 4173);
  const { url } = await startStaticServer({ port: requestedPort });
  console.log(`Hanzi print workbench running at ${url}/printer/index.html`);
}

/**
 * PDF inspection & raster verification helpers for E2E tests.
 *
 * Uses `pdfjs-dist` + `@napi-rs/canvas` + `pngjs` + `pixelmatch` to:
 *   1. Parse generated PDF buffers (page count, 612×792 pt US Letter size, text stream, embedded fonts).
 *   2. Rasterize PDF pages to PNG and crop regions by PDF point coordinates (derived from DOM mm/px rects).
 *   3. Verify illustration slot non-emptiness, saturation, connected-component icon count (e.g. 四 -> 4 pineapples),
 *      Tianzige red model vs grey trace pixels, and visual regression diffs.
 */

import { createCanvas, Image, ImageData } from '@napi-rs/canvas';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Provide Image / ImageData globals if pdfjs-dist needs them in Node
if (typeof globalThis.Image === 'undefined') globalThis.Image = Image;
if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = ImageData;

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    const context = canvas.getContext('2d');
    return { canvas, context };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = Math.ceil(width);
    canvasAndContext.canvas.height = Math.ceil(height);
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

/**
 * Load a PDF buffer with pdfjs-dist.
 * @param {Buffer|Uint8Array} pdfBuffer
 */
export async function openPdfDocument(pdfBuffer) {
  // Copy into a standalone Uint8Array so pdfjs worker transfer does not detach the caller's Buffer
  const data = new Uint8Array(pdfBuffer);
  const loadingTask = pdfjsLib.getDocument({
    data,
    canvasFactory: new NodeCanvasFactory(),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  return loadingTask.promise;
}

/**
 * Extract metadata, page sizes, text items, and font info from a PDF buffer.
 * @param {Buffer|Uint8Array} pdfBuffer
 * @param {{ maxPagesToExtractText?: number }} opts
 */
export async function inspectPdfTextAndMeta(pdfBuffer, opts = {}) {
  const pdf = await openPdfDocument(pdfBuffer);
  const numPages = pdf.numPages;
  const maxTextPages = opts.maxPagesToExtractText ?? numPages;
  const pages = [];
  const fontNames = new Set();

  for (let p = 1; p <= numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    let text = '';
    let items = [];
    if (p <= maxTextPages) {
      const tc = await page.getTextContent();
      items = tc.items.map((it) => ({
        str: it.str,
        fontName: it.fontName,
        x: it.transform?.[4] ?? 0,
        y: it.transform?.[5] ?? 0,
      }));
      text = items.map((i) => i.str).join(' ');
      for (const style of Object.values(tc.styles || {})) {
        if (style?.fontFamily) fontNames.add(style.fontFamily);
      }
      for (const it of items) {
        if (it.fontName) fontNames.add(it.fontName);
      }
    }
    pages.push({
      pageNumber: p,
      widthPt: Math.round(vp.width * 100) / 100,
      heightPt: Math.round(vp.height * 100) / 100,
      text,
      items,
    });
  }

  return {
    numPages,
    pages,
    fontNames: [...fontNames],
  };
}

/**
 * Render a single 1-based PDF page to an RGBA image `{ width, height, data, pngBuffer }`.
 * Default `scale = 2` renders a 612×792 pt US Letter page at 1224×1584 px (144 DPI).
 */
export async function renderPdfPageToImage(pdfBuffer, pageNumber = 1, scale = 2) {
  const pdf = await openPdfDocument(pdfBuffer);
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const factory = new NodeCanvasFactory();
  const { canvas, context } = factory.create(viewport.width, viewport.height);

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: context,
    viewport,
    canvasFactory: factory,
  }).promise;

  const imgData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pngBuffer = canvas.toBuffer('image/png');
  return {
    width: canvas.width,
    height: canvas.height,
    scale,
    data: imgData.data, // Uint8ClampedArray RGBA
    pngBuffer,
  };
}

/**
 * Crop a rectangular region specified in PDF points `{ xPt, yPt, wPt, hPt }`
 * (measured from the top-left of the page) out of a rendered page image.
 */
export function cropPdfRegion(renderedPage, rectPt, insetPt = 1.5) {
  const { width, height, scale, data } = renderedPage;
  const x0 = Math.max(0, Math.floor((rectPt.xPt + insetPt) * scale));
  const y0 = Math.max(0, Math.floor((rectPt.yPt + insetPt) * scale));
  const x1 = Math.min(width, Math.ceil((rectPt.xPt + rectPt.wPt - insetPt) * scale));
  const y1 = Math.min(height, Math.ceil((rectPt.yPt + rectPt.hPt - insetPt) * scale));
  const cw = Math.max(1, x1 - x0);
  const ch = Math.max(1, y1 - y0);

  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcRow = ((y0 + y) * width + x0) * 4;
    const dstRow = y * cw * 4;
    out.set(data.subarray(srcRow, srcRow + cw * 4), dstRow);
  }
  return { width: cw, height: ch, data: out };
}

/**
 * Compute pixel statistics and a deterministic perceptual/pixel hash for a cropped region.
 */
export function analyzeRegionPixels(crop) {
  const { width, height, data } = crop;
  const total = width * height;
  let nonWhite = 0;
  let colored = 0;
  let redPixels = 0;
  let greyPixels = 0;
  let darkPixels = 0;
  let satSum = 0;

  // FNV-1a hash over 16-level quantized pixels
  let h = 0x811c9dc5;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;

    h ^= ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    h = Math.imul(h, 0x01000193) >>> 0;

    if (r < 245 || g < 245 || b < 245) {
      nonWhite++;
      satSum += max > 0 ? chroma / max : 0;
      if (chroma >= 24) colored++;
      if (r - g > 35 && r - b > 35 && r > 110) redPixels++;
      if (chroma <= 18 && r >= 130 && r <= 230) greyPixels++;
      if (max < 70) darkPixels++;
    }
  }

  return {
    total,
    nonWhite,
    nonWhiteRatio: nonWhite / total,
    coloredRatio: nonWhite > 0 ? colored / nonWhite : 0,
    meanSaturation: nonWhite > 0 ? satSum / nonWhite : 0,
    redPixels,
    redRatio: nonWhite > 0 ? redPixels / nonWhite : 0,
    greyPixels,
    greyRatio: nonWhite > 0 ? greyPixels / nonWhite : 0,
    darkPixels,
    hash: h.toString(16).padStart(8, '0'),
  };
}

/**
 * Count distinct connected icon blobs inside an illustration crop.
 * Uses a small morphological dilation (`dilationRadius` px) to merge sub-parts of a single flat icon
 * while keeping separated icons in a `countGrid` distinct.
 */
export function countIllustrationBlobs(crop, { dilationRadius = 2, minAreaRatio = 0.008 } = {}) {
  const { width: w, height: h, data } = crop;
  const rawMask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      // Foreground pixel (non-white)
      if (r < 242 || g < 242 || b < 242) {
        rawMask[y * w + x] = 1;
      }
    }
  }

  // Dilate mask by `dilationRadius`
  const mask = new Uint8Array(w * h);
  const rad = dilationRadius;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!rawMask[y * w + x]) continue;
      for (let dy = -rad; dy <= rad; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -rad; dx <= rad; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w) mask[ny * w + nx] = 1;
        }
      }
    }
  }

  const visited = new Uint8Array(w * h);
  const minPixels = Math.max(12, Math.floor(w * h * minAreaRatio));
  const blobs = [];
  const queue = new Int32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || visited[i]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    visited[i] = 1;
    let area = 0;

    while (head < tail) {
      const cur = queue[head++];
      area++;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const neighbors = [
        cy > 0 ? cur - w : -1,
        cy + 1 < h ? cur + w : -1,
        cx > 0 ? cur - 1 : -1,
        cx + 1 < w ? cur + 1 : -1,
      ];
      for (const nb of neighbors) {
        if (nb >= 0 && mask[nb] && !visited[nb]) {
          visited[nb] = 1;
          queue[tail++] = nb;
        }
      }
    }
    if (area >= minPixels) {
      blobs.push(area);
    }
  }

  return blobs.length;
}

/**
 * Compare two PNG buffers using `pixelmatch`, returning the mismatch ratio (`0..1`).
 */
export function comparePngBuffers(bufA, bufB) {
  const imgA = PNG.sync.read(bufA);
  const imgB = PNG.sync.read(bufB);
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    return { mismatchRatio: 1, diffPixels: imgA.width * imgA.height };
  }
  const diff = new PNG({ width: imgA.width, height: imgA.height });
  const diffPixels = pixelmatch(imgA.data, imgB.data, diff.data, imgA.width, imgA.height, {
    threshold: 0.12,
  });
  return {
    diffPixels,
    mismatchRatio: diffPixels / (imgA.width * imgA.height),
    diffPngBuffer: PNG.sync.write(diff),
  };
}

/** Create a small solid-colour PNG buffer (for testing custom image upload). */
export function createSolidPngBuffer(width = 64, height = 64, [r, g, b, a = 255] = [20, 180, 90, 255]) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Leave a 6px white margin so it looks like an icon
      const isBorder = x < 6 || y < 6 || x >= width - 6 || y >= height - 6;
      const idx = (y * width + x) * 4;
      png.data[idx] = isBorder ? 255 : r;
      png.data[idx + 1] = isBorder ? 255 : g;
      png.data[idx + 2] = isBorder ? 255 : b;
      png.data[idx + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

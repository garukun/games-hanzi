/**
 * Print & PDF preparation pipeline.
 *
 * Ensures every page in the document is hydrated, all custom web fonts are ready,
 * and every illustration image (`<img>`) is decoded before calling `window.print()`
 * or `page.pdf()` in Playwright E2E tests.
 */

export function setupPrintController({ preview, progressModalEl, progressBarEl, progressTextEl }) {
  let preparing = false;

  async function prepareAllPagesForPrint({ showModal = false } = {}) {
    if (preparing) return;
    preparing = true;
    document.body.dataset.printReady = 'false';

    if (showModal && progressModalEl) {
      progressModalEl.hidden = false;
    }

    try {
      await preview.hydrateAllPages({
        batchSize: 30,
        onProgress(done, total) {
          if (progressBarEl) {
            const pct = total > 0 ? Math.round((done / total) * 100) : 100;
            progressBarEl.style.width = `${pct}%`;
          }
          if (progressTextEl) {
            progressTextEl.textContent = `正在准备打印页面：${done} / ${total} 页…`;
          }
        },
      });

      // Wait for embedded LXGW WenKai font
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      // Wait for all illustration images to finish loading/decoding
      const imgs = [...document.querySelectorAll('.sheet-page img')];
      await Promise.all(
        imgs.map((img) => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          if (typeof img.decode === 'function') {
            return img.decode().catch(() => {});
          }
          return new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          });
        }),
      );

      document.body.dataset.printReady = 'true';
    } finally {
      if (showModal && progressModalEl) {
        progressModalEl.hidden = true;
      }
      preparing = false;
    }
  }

  async function triggerPrint() {
    await prepareAllPagesForPrint({ showModal: true });
    window.print();
  }

  // Synchronous hook for Ctrl+P / beforeprint
  window.addEventListener('beforeprint', () => {
    preview.hydrateAllPages({ batchSize: 1000 });
    document.body.dataset.printReady = 'true';
  });

  // Expose helper for Playwright E2E PDF verification
  window.__hanziPrintPrepare = () => prepareAllPagesForPrint({ showModal: false });

  return {
    prepareAllPagesForPrint,
    triggerPrint,
  };
}

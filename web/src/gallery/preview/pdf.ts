// pdf.js, loaded on demand so the gallery's first paint does not carry it. Scripts inside a PDF
// never run: isEvalSupported is off, XFA forms are off and no annotation layer is drawn (only
// the page's canvas is). The worker is bundled from the package, never fetched from elsewhere.
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

let lib: Promise<typeof import("pdfjs-dist")> | undefined;

export function pdfjs() {
  lib ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    return m;
  });
  return lib;
}

export type { PDFDocumentProxy, PDFPageProxy };

/** Opens a document from bytes already checked by `fetchChecked`. */
export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const m = await pdfjs();
  return m.getDocument({
    data,
    isEvalSupported: false,
    enableXfa: false,
    // Nothing is fetched on the document's behalf: no fonts or maps from a CDN.
    disableAutoFetch: true,
    disableStream: true,
    useSystemFonts: true,
  }).promise;
}

/** The most pixels one page's canvas may hold (as pdf.js's maxCanvasPixels): past it memory runs
 * out on long or zoomed documents, and iOS Safari draws blank canvases. */
export const MAX_CANVAS_PIXELS = 16_000_000;

/**
 * Device pixels per PDF point for a page of `size` points drawn at `scale` CSS pixels per point
 * on a screen of `ratio`: as sharp as the screen allows, but never more than `max` pixels.
 * CSS then shows the canvas at its display size, so a capped page is only a little softer.
 */
export function backingScale(
  size: { width: number; height: number },
  scale: number,
  ratio: number,
  max = MAX_CANVAS_PIXELS,
): number {
  const wanted = scale * ratio;
  const area = size.width * size.height;
  if (area <= 0 || area * wanted * wanted <= max) return wanted;
  return Math.sqrt(max / area);
}

/**
 * Draws one page into a canvas at `scale` CSS pixels per PDF point, sharp on dense screens up to
 * MAX_CANVAS_PIXELS. Answers a cancel function; the canvas is sized before drawing starts.
 */
export function drawPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
): { done: Promise<void>; cancel(): void } {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const shown = page.getViewport({ scale });
  const view = page.getViewport({
    scale: backingScale(page.getViewport({ scale: 1 }), scale, ratio),
  });
  canvas.width = Math.floor(view.width);
  canvas.height = Math.floor(view.height);
  canvas.style.width = `${Math.floor(shown.width)}px`;
  canvas.style.height = `${Math.floor(shown.height)}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx)
    return { done: Promise.reject(new Error("no canvas")), cancel() {} };
  // annotationMode 0 (DISABLE): forms, links and widgets are not drawn or wired up.
  const task = page.render({
    canvasContext: ctx,
    viewport: view,
    annotationMode: 0,
  });
  return { done: task.promise, cancel: () => task.cancel() };
}

/** Gives a canvas's memory back; its box keeps its size, so the layout does not move. */
export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

"use client";

// A PDF in the viewer, drawn by pdf.js into canvases: the pages in a scrolling column, a strip
// of small pages beside them (the first 50) and zoom. Only pixels are drawn; there is no
// annotation or text layer, so nothing in the file can be clicked, filled in or run.
// ArrowLeft and ArrowRight belong to the viewer (they move between files); PageUp and PageDown
// move between pages here.
import { useEffect, useRef, useState } from "react";
import {
  drawPage,
  openPdf,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "./pdf";
import p from "./preview.module.css";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
/** CSS pixels per PDF point at 100%: an A4 page is about 740 px wide. */
const BASE = 1.25;
const STRIP_SCALE = 0.16;
const STRIP_MAX = 50;

/** One page; drawn once it comes near the visible part of the column. */
function Page({
  doc,
  number,
  scale,
  root,
  onSeen,
  strip = false,
}: {
  doc: PDFDocumentProxy;
  number: number;
  scale: number;
  root: HTMLElement | null;
  onSeen?: (n: number) => void;
  strip?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    let live = true;
    doc.getPage(number).then(
      (pg) => live && setPage(pg),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [doc, number]);

  useEffect(() => {
    const el = box.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setNear(true);
      },
      { root, rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    const el = box.current;
    if (!el || !root || !onSeen) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) onSeen(number);
      },
      // The page that crosses the middle of the column is the current one.
      { root, rootMargin: "-50% 0px -50% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [root, onSeen, number]);

  useEffect(() => {
    if (!page || !near || !canvas.current) return;
    const draw = drawPage(page, canvas.current, scale);
    draw.done.catch(() => {});
    return () => draw.cancel();
  }, [page, near, scale]);

  const size = page?.getViewport({ scale });
  return (
    <div
      ref={box}
      className={strip ? p.stripPage : p.page}
      data-page={number}
      style={
        size
          ? { width: Math.floor(size.width), height: Math.floor(size.height) }
          : undefined
      }
    >
      <canvas ref={canvas} aria-hidden="true" className={p.canvas} />
    </div>
  );
}

export function PdfView({ blob, name }: { blob: Blob; name: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(2); // index into ZOOMS: 100%
  const [current, setCurrent] = useState(1);
  const [column, setColumn] = useState<HTMLDivElement | null>(null);
  const [strip, setStrip] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let live = true;
    let opened: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const d = await openPdf(await blob.arrayBuffer());
        if (!live) return void d.destroy();
        opened = d;
        setDoc(d);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
      void opened?.destroy();
    };
  }, [blob]);

  const pages = doc?.numPages ?? 0;

  function goTo(n: number) {
    const to = Math.min(Math.max(n, 1), pages);
    column
      ?.querySelector<HTMLElement>(`[data-page="${to}"]`)
      ?.scrollIntoView({ block: "start" });
    setCurrent(to);
  }
  const goRef = useRef(goTo);
  useEffect(() => {
    goRef.current = goTo;
  });
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  // PageUp / PageDown step through the pages wherever the focus is in the viewer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "PageDown" && e.key !== "PageUp") return;
      e.preventDefault();
      goRef.current(currentRef.current + (e.key === "PageDown" ? 1 : -1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Keep the current page's thumbnail in sight in the strip.
  useEffect(() => {
    strip
      ?.querySelector<HTMLElement>(`[data-strip="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [strip, current]);

  if (failed)
    return (
      <p role="alert" className={p.note}>
        Couldn&apos;t draw this PDF.
      </p>
    );
  if (!doc)
    return (
      <p role="status" className={p.note}>
        Opening…
      </p>
    );

  const scale = ZOOMS[zoom]! * BASE;
  return (
    <div className={p.pdf}>
      <nav
        ref={setStrip}
        aria-label="Pages"
        className={p.strip}
        data-pages={pages}
      >
        {Array.from({ length: Math.min(pages, STRIP_MAX) }, (_, i) => (
          <button
            key={i + 1}
            type="button"
            className={p.stripButton}
            data-strip={i + 1}
            aria-current={current === i + 1 ? "page" : undefined}
            aria-label={`Page ${i + 1}`}
            onClick={() => goTo(i + 1)}
          >
            <Page
              doc={doc}
              number={i + 1}
              scale={STRIP_SCALE}
              root={strip}
              strip
            />
            <span aria-hidden="true" className={p.stripNumber}>
              {i + 1}
            </span>
          </button>
        ))}
      </nav>
      <div className={p.pdfMain}>
        <div className={p.pdfBar} role="toolbar" aria-label="PDF">
          <p className={p.pageCount} aria-live="polite">
            Page <span data-testid="pdf-current">{current}</span> of{" "}
            <span data-testid="pdf-pages">{pages}</span>
          </p>
          <div className={p.zoom}>
            <button
              type="button"
              className={p.tool}
              aria-label="Zoom out"
              aria-disabled={zoom === 0}
              onClick={() => setZoom((z) => Math.max(z - 1, 0))}
            >
              −
            </button>
            <button
              type="button"
              className={p.tool}
              aria-label={`Zoom ${Math.round(ZOOMS[zoom]! * 100)}%, reset to 100%`}
              onClick={() => setZoom(2)}
            >
              {Math.round(ZOOMS[zoom]! * 100)}%
            </button>
            <button
              type="button"
              className={p.tool}
              aria-label="Zoom in"
              aria-disabled={zoom === ZOOMS.length - 1}
              onClick={() => setZoom((z) => Math.min(z + 1, ZOOMS.length - 1))}
            >
              +
            </button>
          </div>
        </div>
        <div
          ref={setColumn}
          className={p.column}
          role="document"
          aria-label={name}
          tabIndex={0}
        >
          {Array.from({ length: pages }, (_, i) => (
            <Page
              key={i + 1}
              doc={doc}
              number={i + 1}
              scale={scale}
              root={column}
              onSeen={setCurrent}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

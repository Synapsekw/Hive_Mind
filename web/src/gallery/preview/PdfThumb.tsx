"use client";

// A PDF card's thumbnail: page 1, drawn by pdf.js once the card scrolls into view. At most four
// are drawn at once, and a drawn page is kept (as an image) by file for as long as the page is
// open, so scrolling back or re-filtering draws nothing again. On any failure it draws nothing
// and the card keeps its type tile.
import { useEffect, useRef, useState } from "react";
import { PDF_THUMB_MAX } from "../kind";
import { fetchChecked } from "./fetchChecked";
import { drawPage, openPdf } from "./pdf";
import p from "./preview.module.css";

const AT_ONCE = 4;
const WIDTH = 320; // CSS pixels: the widest a card's tile is drawn
const cache = new Map<string, string | null>(); // null: tried and failed
let running = 0;
const waiting: (() => void)[] = [];

async function inTurn<T>(job: () => Promise<T>): Promise<T> {
  if (running >= AT_ONCE) await new Promise<void>((go) => waiting.push(go));
  running += 1;
  try {
    return await job();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

async function render(url: string): Promise<string | null> {
  const got = await fetchChecked(url, "pdf", PDF_THUMB_MAX);
  if (!got.ok) return null;
  const doc = await openPdf(await got.blob.arrayBuffer());
  try {
    const page = await doc.getPage(1);
    const scale = WIDTH / page.getViewport({ scale: 1 }).width;
    const canvas = document.createElement("canvas");
    await drawPage(page, canvas, scale).done;
    return canvas.toDataURL("image/png");
  } finally {
    void doc.destroy();
  }
}

export function PdfThumb({
  fileId,
  url,
  onDrawn,
}: {
  fileId: string;
  url: string;
  /** Called once the page image is in, so the card can drop its type tile. */
  onDrawn?: () => void;
}) {
  const [src, setSrc] = useState<string | null>(
    () => cache.get(fileId) ?? null,
  );
  const box = useRef<HTMLSpanElement>(null);
  const told = useRef(onDrawn);
  told.current = onDrawn;
  useEffect(() => {
    if (src) told.current?.();
  }, [src]);

  useEffect(() => {
    if (cache.has(fileId)) return setSrc(cache.get(fileId) ?? null);
    const el = box.current;
    if (!el) return;
    let live = true;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void inTurn(async () => {
        // Scrolled past before its turn came: leave it for when it is seen again.
        if (!live) return;
        let made: string | null = null;
        try {
          made = await render(url);
        } catch {
          made = null;
        }
        cache.set(fileId, made);
        if (live) setSrc(made);
      });
    });
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [fileId, url]);

  return (
    <span ref={box} aria-hidden="true" className={p.thumbBox}>
      {src && <img src={src} alt="" className={p.thumb} />}
    </span>
  );
}

"use client";

// The gallery over the fixture with stand-in actions: each records its call on
// `window.__galleryCalls` (for the browser tests) and answers from the fixture, with links that
// need neither storage nor the network. With `fail`, opening and downloading answer nothing and
// a delete is refused. With `mislabel`, a PDF's link answers with a web page, as a file whose
// declared type lies would.
import { fixtureMore } from "../../../gallery/fixture";
import { Gallery } from "../../../gallery/Gallery";
import type {
  GalleryData,
  GalleryFile,
  LegacyActions,
} from "../../../gallery/types";

declare global {
  interface Window {
    __galleryCalls?: { name: string; args: unknown[] }[];
  }
}

function record(name: string, args: unknown[]) {
  (window.__galleryCalls ??= []).push({ name, args });
}

/** For an image too large to have a thumbnail: one pixel, as the fixture's thumbnails are. */
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOomrQAAAM2Aa03DvZDAAAAAElFTkSuQmCC";

/**
 * The image a file opens as: its thumbnail, drawn up to the size of a photo. The fixture's
 * thumbnails are one pixel each, which would leave the viewer looking empty; the link is still
 * a PNG data link made from the thumbnail alone.
 */
function photo(thumb: string, tall: boolean): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = tall ? 1000 : 1600;
      canvas.height = tall ? 1400 : 1000;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(thumb);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(thumb);
    img.src = thumb;
  });
}

/** A minimal one-page PDF with a line of text, as a data link. */
function pdf(title: string): string {
  const text = title.replace(/[^\w .-]/g, "");
  const stream = `BT /F1 20 Tf 56 760 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return `data:application/pdf;base64,${btoa(out)}`;
}

/** What a mislabelled "PDF" really holds: a page with a script. It must never be drawn. */
const PAGE = `data:text/html,${encodeURIComponent(
  "<title>pwned</title><h1>mislabelled page</h1><script>try{top.document.title='pwned'}catch(e){}</script>",
)}`;

export function DevGallery({
  data,
  now,
  fail,
  mislabel,
}: {
  data: GalleryData;
  now: number;
  fail: boolean;
  mislabel: boolean;
}) {
  const find = (id: string): GalleryFile | undefined =>
    [...data.files, ...fixtureMore(now).files].find((f) => f.id === id);

  // Gallery v2: replaced in Task 8 (stand-ins for the v2 actions arrive with the new screen)
  const actions: LegacyActions = {
    openFile: async (id) => {
      record("openFile", [id]);
      const file = find(id);
      if (fail || !file) return null;
      if (file.kind === "pdf")
        return { url: mislabel ? PAGE : pdf(file.name), kind: "pdf" };
      if (file.kind === "image")
        return {
          url: await photo(file.thumb ?? PIXEL, file.name.includes("plan")),
          kind: "image",
        };
      return { url: "data:text/plain,not%20shown", kind: file.kind };
    },
    downloadFile: async (id) => {
      record("downloadFile", [id]);
      const file = find(id);
      if (fail || !file) return null;
      return { url: `data:text/plain,${encodeURIComponent(file.name)}` };
    },
    deleteFile: async (id) => {
      record("deleteFile", [id]);
      return fail ? { ok: false } : { ok: true };
    },
    loadMore: async (cursor) => {
      record("loadMore", [cursor]);
      return fail ? null : fixtureMore(now);
    },
  };
  return <Gallery data={data} now={now} actions={actions} />;
}

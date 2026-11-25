"use client";

// The gallery over the fixture with stand-in actions: each records its call on
// `window.__galleryCalls` (for the browser tests) and answers from the fixture, with links that
// need no storage: images are data links and PDFs, CSV and text files open the samples under
// /dev/ (web/public/dev). With `fail`, opening and downloading answer nothing and a delete is
// refused. With `mislabel`, a PDF's link answers with a web page, as a file whose declared type
// lies would. With `everyFile`, every file opens in the viewer, as the v2 screen will do.
import { fixtureMore } from "../../../gallery/fixture";
import { Gallery } from "../../../gallery/Gallery";
import { SAMPLES } from "./samples";
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

/** What a mislabelled "PDF" really holds: a page with a script, declared as a PDF. It must
 * never be drawn. */
const PAGE = `data:application/pdf,${encodeURIComponent(
  "<title>pwned</title><h1>mislabelled page</h1><script>try{top.document.title='pwned'}catch(e){}</script>",
)}`;

export function DevGallery({
  data,
  now,
  fail,
  mislabel,
  everyFile,
}: {
  data: GalleryData;
  now: number;
  fail: boolean;
  mislabel: boolean;
  everyFile: boolean;
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
        return { url: mislabel ? PAGE : SAMPLES.pdf, kind: "pdf" };
      if (file.kind === "csv") return { url: SAMPLES.csv, kind: "csv" };
      if (file.kind === "text") return { url: SAMPLES.text, kind: "text" };
      if (file.kind === "image")
        return {
          url: await photo(file.thumb ?? PIXEL, file.name.includes("plan")),
          kind: "image",
        };
      return null;
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
  return (
    <Gallery
      data={data}
      now={now}
      actions={actions}
      viewable={everyFile ? () => true : undefined}
    />
  );
}

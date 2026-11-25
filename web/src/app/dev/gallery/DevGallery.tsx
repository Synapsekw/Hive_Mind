"use client";

// The gallery over the fixture with stand-in actions: each records its call on
// `window.__galleryCalls` (for the browser tests) and answers from the fixture, with links that
// need no storage: images are data links and PDFs, CSV and text files open the samples under
// /dev/ (web/public/dev); uploads PUT to /dev/upload-sink, which throws the bytes away.
//   fail      every action answers nothing: no link, no page, { ok: false }
//   mislabel  a PDF's link answers with a web page, as a file whose declared type lies would
//   everyFile every file opens in the viewer (the viewer's tests)
//   slowStart startUpload answers after 1.5 s
//   failFinish the first finishUpload answers null, as a refused record after a stored PUT
//   many      the server also holds the 250-PDF archive, so a filtered answer pages
//   slowPage  loadPage answers after 1.5 s
// loadPage answers as the server does: every filter, newest first, 200 a page after the cursor.
import { useRef } from "react";
import { applyFilters, DEFAULT_FILTERS } from "../../../gallery/filters";
import {
  fixtureArchive,
  fixtureGallery,
  fixtureMore,
} from "../../../gallery/fixture";
import { Gallery } from "../../../gallery/Gallery";
import { fileKind } from "../../../gallery/kind";
import { mimeFor } from "../../../gallery/mime";
import type {
  GalleryActions,
  GalleryData,
  GalleryFile,
  GallerySession,
  NoteChoice,
} from "../../../gallery/types";
import { SAMPLES } from "./samples";

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

/** The Uploads note every person has, as the server makes it on a first upload. */
const UPLOADS = {
  id: "00000000-0000-4000-8000-000000000d07",
  title: "Uploads",
};

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

let made = 0;
const newId = (tag: string) =>
  `00000000-0000-4000-8000-${tag}${String(++made).padStart(12 - tag.length, "0")}`;

export function DevGallery({
  data,
  now,
  fail,
  mislabel,
  everyFile,
  slowStart,
  failFinish,
  many,
  slowPage,
}: {
  data: GalleryData;
  now: number;
  fail: boolean;
  mislabel: boolean;
  everyFile: boolean;
  slowStart: boolean;
  failFinish: boolean;
  many: boolean;
  slowPage: boolean;
}) {
  const everything = (): GalleryFile[] => [
    ...fixtureGallery(now).files,
    ...fixtureMore(now).files,
    ...(many ? fixtureArchive(now) : []),
  ];
  const find = (id: string): GalleryFile | undefined =>
    everything().find((f) => f.id === id);
  // The person's own notes: the home notes of their files and sessions, and Uploads.
  const myNotes = (): NoteChoice[] => {
    const seen = new Map<string, string>([[UPLOADS.id, UPLOADS.title]]);
    for (const f of everything())
      if (f.mine && f.note) seen.set(f.note.id, f.note.title);
    for (const s of data.sessions)
      if (s.mine && s.note) seen.set(s.note.id, s.note.title);
    return [...seen].map(([id, title]) => ({ id, title, path: `${title}.md` }));
  };
  const ok = () => (fail ? { ok: false as const } : { ok: true as const });
  const uploads = useRef(new Map<string, string | null>()).current; // batch -> folder
  const finishRefused = useRef(false);

  const actions: GalleryActions = {
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
      return ok();
    },
    loadPage: async (filter, cursor) => {
      record("loadPage", [filter, cursor]);
      if (slowPage) await new Promise((go) => setTimeout(go, 1500));
      if (fail) return null;
      const sessions = new Map<string, GallerySession>(
        data.sessions.map((s) => [s.id, s]),
      );
      const from = filter.from ? Date.parse(filter.from) : -Infinity;
      const to = filter.to ? Date.parse(filter.to) : Infinity;
      const all = applyFilters(
        everything(),
        {
          ...DEFAULT_FILTERS,
          kinds: filter.kinds,
          session: filter.session,
          owner: filter.owner,
          agent: filter.agent,
        },
        sessions,
        () => new Set(),
        now,
      )
        .filter((f) => {
          const t = Date.parse(f.created_at);
          return (
            t >= from &&
            t < to &&
            (!filter.folder || f.folders.includes(filter.folder))
          );
        })
        .sort(
          (a, b) =>
            b.created_at.localeCompare(a.created_at) ||
            b.id.localeCompare(a.id),
        )
        .filter(
          (f) =>
            !cursor ||
            f.created_at < cursor.created_at ||
            (f.created_at === cursor.created_at && f.id < cursor.id),
        );
      const files = all.slice(0, 200);
      const last = files[files.length - 1];
      return {
        files,
        sessions: [],
        next:
          all.length > 200 && last
            ? { created_at: last.created_at, id: last.id }
            : null,
      };
    },
    setHome: async (fileId, noteId) => {
      record("setHome", [fileId, noteId]);
      return ok();
    },
    findMyNotes: async (query) => {
      record("findMyNotes", [query]);
      if (fail) return [];
      const needle = query.trim().toLowerCase();
      return myNotes().filter((n) => n.title.toLowerCase().includes(needle));
    },
    createFolder: async (name, parentId) => {
      record("createFolder", [name, parentId]);
      if (fail) return null;
      return { id: newId("6"), name, parent_id: parentId };
    },
    renameFolder: async (id, name) => {
      record("renameFolder", [id, name]);
      return ok();
    },
    deleteFolder: async (id) => {
      record("deleteFolder", [id]);
      return ok();
    },
    addToFolder: async (folderId, fileIds) => {
      record("addToFolder", [folderId, fileIds]);
      return ok();
    },
    removeFromFolder: async (folderId, fileId) => {
      record("removeFromFolder", [folderId, fileId]);
      return ok();
    },
    startUpload: async (req) => {
      record("startUpload", [req]);
      if (slowStart) await new Promise((go) => setTimeout(go, 1500));
      if (fail) return null;
      const batch = newId("5");
      uploads.set(batch, req.folderId);
      const taken = new Set<string>();
      const slots = req.files.map(({ name }) => {
        // The server keeps names unique within a batch: "a.png", "a (2).png".
        let stored = name;
        for (let n = 2; taken.has(stored); n++)
          stored = name.replace(/(\.[^.]*)?$/, (ext) => ` (${n})${ext}`);
        taken.add(stored);
        return {
          name: stored,
          url: `/dev/upload-sink?name=${encodeURIComponent(stored)}`,
        };
      });
      return { batch, slots, noteId: req.noteId ?? UPLOADS.id };
    },
    finishUpload: async (batch, name, noteId, folderId) => {
      record("finishUpload", [batch, name, noteId, folderId]);
      if (fail || !uploads.has(batch)) return null;
      if (failFinish && !finishRefused.current) {
        finishRefused.current = true;
        return null;
      }
      const note = myNotes().find((n) => n.id === noteId);
      const kind = fileKind(name, mimeFor(name));
      return {
        id: newId("f"),
        name,
        kind,
        size: 1024,
        created_at: new Date(now).toISOString(),
        owner: "Danijel",
        owner_id: "m-me",
        mine: true,
        note: note ? { id: note.id, title: note.title } : null,
        sharing: "private",
        thumb: kind === "image" ? PIXEL : null,
        session_id: batch,
        refs: [],
        folders: folderId ? [folderId] : [],
      };
    },
    endUpload: async (batch, noteId) => {
      record("endUpload", [batch, noteId]);
      return ok();
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

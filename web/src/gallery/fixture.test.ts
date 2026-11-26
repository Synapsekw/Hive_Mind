import { describe, expect, it } from "vitest";
import {
  ARCHIVE_SIZE,
  fixtureArchive,
  fixtureGallery,
  fixtureMore,
} from "./fixture";
import { fileKind, PDF_VIEW_MAX, THUMB_MAX } from "./kind";
import type { GalleryFile, Kind } from "./types";

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const KINDS: Kind[] = [
  "image",
  "pdf",
  "slides",
  "sheet",
  "doc",
  "text",
  "csv",
  "other",
];
const time = (f: GalleryFile) => new Date(f.created_at).getTime();

describe("fixtureGallery", () => {
  const { files, next } = fixtureGallery(NOW);

  it("is deterministic", () => {
    expect(fixtureGallery(NOW)).toEqual(fixtureGallery(NOW));
  });

  it("has 20 files with unique ids, newest first", () => {
    expect(files).toHaveLength(20);
    expect(new Set(files.map((f) => f.id)).size).toBe(20);
    for (const f of files) expect(f.id).toMatch(UUID);
    for (let i = 1; i < files.length; i++) {
      expect(time(files[i]!)).toBeLessThan(time(files[i - 1]!));
    }
    expect(time(files[0]!)).toBeLessThan(NOW);
  });

  it("dates follow the clock it is given", () => {
    const later = fixtureGallery(NOW + 86_400_000).files;
    expect(time(later[0]!) - time(files[0]!)).toBe(86_400_000);
  });

  it("has at least one file of each kind", () => {
    for (const kind of KINDS) {
      expect(files.some((f) => f.kind === kind)).toBe(true);
    }
  });

  it("has files of three people, at least 3 of them not the caller's", () => {
    expect(files.filter((f) => !f.mine).length).toBeGreaterThanOrEqual(3);
    expect(new Set(files.map((f) => f.owner))).toEqual(
      new Set(["Danijel", "Ahmed", "Sara"]),
    );
    for (const f of files) expect(f.mine).toBe(f.owner === "Danijel");
  });

  it("has every kind of sharing, each consistent with its owner and note", () => {
    expect(files.some((f) => f.sharing === "through-note")).toBe(true);
    expect(files.some((f) => f.sharing === "private")).toBe(true);
    expect(files.some((f) => f.sharing === "shared-with-me")).toBe(true);
    for (const f of files) {
      expect(f.sharing === "shared-with-me").toBe(!f.mine);
      if (f.sharing !== "private") expect(f.note).not.toBeNull();
      if (f.note) expect(f.note.id).toMatch(UUID);
    }
    expect(files.some((f) => f.mine && f.note === null)).toBe(true);
  });

  it("has one pdf too large for the viewer", () => {
    expect(
      files.filter((f) => f.kind === "pdf" && f.size > PDF_VIEW_MAX),
    ).toHaveLength(1);
    expect(files.some((f) => f.kind === "pdf" && f.size <= PDF_VIEW_MAX)).toBe(
      true,
    );
  });

  it("gives a thumbnail to images only, and only up to the cap", () => {
    for (const f of files) {
      if (f.thumb === null) continue;
      expect(f.thumb.startsWith("data:image/png;base64,")).toBe(true);
      expect(f.kind).toBe("image");
      expect(f.size).toBeLessThanOrEqual(THUMB_MAX);
    }
    expect(files.filter((f) => f.thumb !== null).length).toBeGreaterThan(0);
    for (const f of files) {
      if (f.kind === "image" && f.size <= THUMB_MAX) {
        expect(f.thumb).not.toBeNull();
      }
    }
  });

  it("names its files so that the kind follows from the name", () => {
    for (const f of files) {
      if (["image", "pdf", "text", "csv"].includes(f.kind)) continue; // these need the declared type too
      expect(fileKind(f.name, null)).toBe(f.kind);
    }
  });

  it("has sessions, folders, references and every kind", () => {
    const d = fixtureGallery(NOW);
    expect(d.sessions.length).toBeGreaterThanOrEqual(3);
    expect(d.sessions.some((s) => s.agent === "Browser upload")).toBe(true);
    expect(d.folders.some((f) => f.parent_id !== null)).toBe(true);
    expect(d.files.some((f) => f.refs.length > 0)).toBe(true);
    expect(d.files.some((f) => f.session_id === null)).toBe(true);
    const kinds = new Set(d.files.map((f) => f.kind));
    for (const k of [
      "image",
      "pdf",
      "slides",
      "sheet",
      "doc",
      "text",
      "csv",
      "other",
    ])
      expect(kinds.has(k as never)).toBe(true);
    for (const f of d.files)
      for (const id of f.folders)
        expect(d.folders.some((x) => x.id === id)).toBe(true);
    for (const f of d.files)
      if (f.session_id)
        expect(d.sessions.some((s) => s.id === f.session_id)).toBe(true);
  });

  it("says more exist, from its last file on", () => {
    const last = files[files.length - 1]!;
    expect(next).toEqual({ created_at: last.created_at, id: last.id });
  });
});

describe("fixtureMore", () => {
  it("is 4 older files and the end of the list", () => {
    const first = fixtureGallery(NOW).files;
    const more = fixtureMore(NOW);
    expect(more.next).toBeNull();
    expect(more.files).toHaveLength(4);
    const oldest = Math.min(...first.map(time));
    for (const f of more.files) expect(time(f)).toBeLessThan(oldest);
    for (let i = 1; i < more.files.length; i++) {
      expect(time(more.files[i]!)).toBeLessThan(time(more.files[i - 1]!));
    }
    const ids = new Set([...first, ...more.files].map((f) => f.id));
    expect(ids.size).toBe(24);
    for (const f of more.files) {
      if (f.thumb !== null) {
        expect(f.thumb.startsWith("data:image/png;base64,")).toBe(true);
        expect(f.kind).toBe("image");
      }
    }
  });
});

describe("fixtureArchive", () => {
  const archive = fixtureArchive(NOW);
  const rest = [...fixtureGallery(NOW).files, ...fixtureMore(NOW).files];

  it("holds more than a page of PDFs, older than every other file, with unique uuids", () => {
    expect(archive).toHaveLength(ARCHIVE_SIZE);
    expect(ARCHIVE_SIZE).toBeGreaterThan(200);
    expect(new Set(archive.map((f) => f.id)).size).toBe(ARCHIVE_SIZE);
    for (const f of archive) {
      expect(f.id).toMatch(UUID);
      expect(f.kind).toBe(fileKind(f.name, "application/pdf"));
    }
    const oldest = Math.min(...rest.map(time));
    for (let i = 0; i < archive.length; i++) {
      expect(time(archive[i]!)).toBeLessThan(oldest);
      if (i) expect(time(archive[i]!)).toBeLessThan(time(archive[i - 1]!));
    }
    const ids = new Set(rest.map((f) => f.id));
    expect(archive.some((f) => ids.has(f.id))).toBe(false);
  });
});

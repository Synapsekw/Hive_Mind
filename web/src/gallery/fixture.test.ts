import { describe, expect, it } from "vitest";
import { fixtureGallery, fixtureMore } from "./fixture";
import { fileKind, PDF_VIEW_MAX, THUMB_MAX } from "./kind";
import type { GalleryFile, Kind } from "./types";

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const KINDS: Kind[] = ["image", "pdf", "slides", "sheet", "doc", "other"];
const time = (f: GalleryFile) => new Date(f.created_at).getTime();

describe("fixtureGallery", () => {
  const { files, next } = fixtureGallery(NOW);

  it("is deterministic", () => {
    expect(fixtureGallery(NOW)).toEqual(fixtureGallery(NOW));
  });

  it("has 14 files with unique ids, newest first", () => {
    expect(files).toHaveLength(14);
    expect(new Set(files.map((f) => f.id)).size).toBe(14);
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
      if (f.kind === "image" || f.kind === "pdf") continue; // these need the declared type too
      expect(fileKind(f.name, null)).toBe(f.kind);
    }
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
    expect(ids.size).toBe(18);
    for (const f of more.files) {
      if (f.thumb !== null) {
        expect(f.thumb.startsWith("data:image/png;base64,")).toBe(true);
        expect(f.kind).toBe("image");
      }
    }
  });
});

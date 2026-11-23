import { describe, expect, it } from "vitest";
import { PDF_VIEW_MAX } from "./kind";
import { defaultTab, tabCounts, viewable, visibleFiles } from "./select";
import type { GalleryFile } from "./types";

let seq = 0;
function file(over: Partial<GalleryFile> = {}): GalleryFile {
  seq += 1;
  return {
    id: `id-${seq}`,
    name: "Proposal.pdf",
    kind: "pdf",
    size: 1000,
    created_at: "2026-11-03T09:00:00.000Z",
    owner: "Danijel",
    mine: true,
    note: null,
    sharing: "private",
    thumb: null,
    ...over,
  };
}

const FILES: GalleryFile[] = [
  file({ name: "Proposal - Harbour.pdf" }),
  file({ name: "pricing.xlsx", kind: "sheet", mine: false, owner: "Ahmed" }),
  file({ name: "Kickoff deck.pptx", kind: "slides" }),
  file({
    name: "harbour-photo.png",
    kind: "image",
    mine: false,
    owner: "Sara",
  }),
  file({ name: "notes.md", kind: "doc" }),
];
const names = (fs: GalleryFile[]) => fs.map((f) => f.name);

describe("visibleFiles", () => {
  it("keeps the caller's files on Mine", () => {
    expect(names(visibleFiles(FILES, "mine", ""))).toEqual([
      "Proposal - Harbour.pdf",
      "Kickoff deck.pptx",
      "notes.md",
    ]);
  });

  it("keeps other people's files on Shared with me", () => {
    expect(names(visibleFiles(FILES, "shared", ""))).toEqual([
      "pricing.xlsx",
      "harbour-photo.png",
    ]);
  });

  it("keeps everything on All, in the order given", () => {
    expect(visibleFiles(FILES, "all", "")).toEqual(FILES);
  });

  it("filters by a case-insensitive part of the name", () => {
    expect(names(visibleFiles(FILES, "all", "HARBOUR"))).toEqual([
      "Proposal - Harbour.pdf",
      "harbour-photo.png",
    ]);
    expect(names(visibleFiles(FILES, "mine", "harbour"))).toEqual([
      "Proposal - Harbour.pdf",
    ]);
    expect(names(visibleFiles(FILES, "all", ".p"))).toEqual([
      "Proposal - Harbour.pdf",
      "Kickoff deck.pptx",
      "harbour-photo.png",
    ]);
  });

  it("trims the filter, and an empty one keeps all", () => {
    expect(names(visibleFiles(FILES, "all", "  deck  "))).toEqual([
      "Kickoff deck.pptx",
    ]);
    expect(visibleFiles(FILES, "all", "   ")).toEqual(FILES);
  });

  it("matches the name only, not the owner", () => {
    expect(visibleFiles(FILES, "all", "ahmed")).toEqual([]);
  });

  it("treats the filter as text, not a pattern", () => {
    expect(visibleFiles(FILES, "all", ".*")).toEqual([]);
    expect(visibleFiles(FILES, "all", "(")).toEqual([]);
  });

  it("does not change the list it was given", () => {
    const before = [...FILES];
    visibleFiles(FILES, "shared", "p");
    expect(FILES).toEqual(before);
  });
});

describe("tabCounts", () => {
  it("counts what is loaded per tab", () => {
    expect(tabCounts(FILES)).toEqual({ mine: 3, shared: 2, all: 5 });
    expect(tabCounts([])).toEqual({ mine: 0, shared: 0, all: 0 });
  });
});

describe("defaultTab", () => {
  it("is Mine when the caller has a file, else All", () => {
    expect(defaultTab(FILES)).toBe("mine");
    expect(defaultTab(FILES.filter((f) => !f.mine))).toBe("all");
    expect(defaultTab([])).toBe("all");
  });
});

describe("viewable", () => {
  it("is true for an image of any size", () => {
    expect(viewable(file({ kind: "image", size: 1 }))).toBe(true);
    expect(viewable(file({ kind: "image", size: PDF_VIEW_MAX * 4 }))).toBe(
      true,
    );
  });

  it("is true for a pdf up to the cap and false beyond it", () => {
    expect(viewable(file({ kind: "pdf", size: PDF_VIEW_MAX }))).toBe(true);
    expect(viewable(file({ kind: "pdf", size: 0 }))).toBe(true);
    expect(viewable(file({ kind: "pdf", size: PDF_VIEW_MAX + 1 }))).toBe(false);
  });

  it("is false for everything else", () => {
    for (const kind of ["slides", "sheet", "doc", "other"] as const) {
      expect(viewable(file({ kind, size: 10 }))).toBe(false);
    }
  });
});

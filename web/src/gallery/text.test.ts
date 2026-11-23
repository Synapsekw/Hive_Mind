import { describe, expect, it } from "vitest";
import { metaLine, sharingText, sizeText } from "./text";
import type { GalleryFile } from "./types";

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);

function file(over: Partial<GalleryFile> = {}): GalleryFile {
  return {
    id: "00000000-0000-4000-8000-000000000f01",
    name: "Proposal.pdf",
    kind: "pdf",
    size: 1258291,
    created_at: "2026-11-03T09:00:00.000Z",
    owner: "Danijel",
    mine: true,
    note: null,
    sharing: "private",
    thumb: null,
    ...over,
  };
}

describe("sizeText", () => {
  it.each([
    [0, ""],
    [1, "1 B"],
    [512, "512 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [348160, "340 KB"],
    [1024 * 1024 - 1, "1 MB"],
    [1024 * 1024, "1 MB"],
    [1258291, "1.2 MB"],
    [31 * 1024 * 1024, "31 MB"],
    [1.5 * 1024 * 1024 * 1024, "1.5 GB"],
  ])("%d → %j", (bytes, text) => {
    expect(sizeText(bytes)).toBe(text);
  });

  it("is empty for a size that is not a size", () => {
    expect(sizeText(-1)).toBe("");
    expect(sizeText(Number.NaN)).toBe("");
    expect(sizeText(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("sharingText", () => {
  it("says Private", () => {
    expect(sharingText(file())).toBe("Private");
    expect(
      sharingText(file({ note: { id: "n", title: "Draft" } })), // a private note
    ).toBe("Private");
  });

  it("names the note a file is shared through", () => {
    expect(
      sharingText(
        file({
          sharing: "through-note",
          note: { id: "n", title: "Harbour Logistics proposal" },
        }),
      ),
    ).toBe("Shared through Harbour Logistics proposal");
  });

  it("copes with a shared file whose note is missing", () => {
    expect(sharingText(file({ sharing: "through-note", note: null }))).toBe(
      "Shared through a note",
    );
  });

  it("names the owner of a file shared with the caller", () => {
    expect(
      sharingText(
        file({ sharing: "shared-with-me", mine: false, owner: "Ahmed" }),
      ),
    ).toBe("Shared with you by Ahmed");
  });
});

describe("metaLine", () => {
  it("is type, size and date", () => {
    expect(metaLine(file(), NOW)).toBe("PDF · 1.2 MB · 3 Nov");
  });

  it("gives the year of a file from another year", () => {
    expect(
      metaLine(file({ created_at: "2025-12-31T23:59:59.000Z" }), NOW),
    ).toBe("PDF · 1.2 MB · 31 Dec 2025");
  });

  it("formats the date in UTC", () => {
    expect(
      metaLine(file({ created_at: "2026-11-03T23:30:00.000-05:00" }), NOW),
    ).toBe("PDF · 1.2 MB · 4 Nov");
  });

  it("leaves out what it does not know", () => {
    expect(metaLine(file({ size: 0 }), NOW)).toBe("PDF · 3 Nov");
    expect(metaLine(file({ size: 0, created_at: "never" }), NOW)).toBe("PDF");
    expect(
      metaLine(file({ kind: "other", name: "LICENSE", size: 512 }), NOW),
    ).toBe("FILE · 512 B · 3 Nov");
  });
});

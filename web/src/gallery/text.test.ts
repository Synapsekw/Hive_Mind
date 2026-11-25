import { describe, expect, it } from "vitest";
import {
  folderPath,
  metaLine,
  sharingText,
  sizeText,
  spanText,
  uploadTitle,
  whoCanRead,
} from "./text";
import type { GalleryFile, GallerySession } from "./types";

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);

function file(over: Partial<GalleryFile> = {}): GalleryFile {
  return {
    id: "00000000-0000-4000-8000-000000000f01",
    name: "Proposal.pdf",
    kind: "pdf",
    size: 1258291,
    created_at: "2026-11-03T09:00:00.000Z",
    owner: "Danijel",
    owner_id: "m-me",
    mine: true,
    note: null,
    sharing: "private",
    thumb: null,
    session_id: null,
    refs: [],
    folders: [],
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

describe("whoCanRead", () => {
  const note = { id: "n1", title: "Harbour proposal" };
  it("names the owner for a file shared with the caller", () => {
    expect(whoCanRead(file({ mine: false, owner: "Ahmed" }))).toBe(
      "Shared with you by Ahmed.",
    );
  });
  it("says only you when there is no home note", () => {
    expect(whoCanRead(file({ note: null }))).toBe(
      "Only you. It has no home note.",
    );
  });
  it("follows a shared note", () => {
    expect(whoCanRead(file({ note, sharing: "through-note" }))).toBe(
      "Whoever can read “Harbour proposal”.",
    );
  });
  it("follows a private note", () => {
    expect(whoCanRead(file({ note, sharing: "private" }))).toBe(
      "Only you, for now: it follows “Harbour proposal”, which is private.",
    );
  });
});

describe("spanText", () => {
  const session = (over: Partial<GallerySession>): GallerySession => ({
    id: "s",
    title: "t",
    agent: "a",
    started_at: "2026-11-22T09:00:00.000Z",
    ended_at: "2026-11-22T10:20:00.000Z",
    note: null,
    mine: true,
    ...over,
  });
  it("gives one day and two times for a session within a day", () => {
    expect(spanText(session({}), NOW)).toBe("22 Nov, 09:00–10:20");
  });
  it("gives both days for a session that runs past midnight", () => {
    expect(
      spanText(session({ ended_at: "2026-11-23T01:05:00.000Z" }), NOW),
    ).toBe("22 Nov 09:00 – 23 Nov 01:05");
  });
  it("says from when an open session runs", () => {
    expect(spanText(session({ ended_at: null }), NOW)).toBe(
      "22 Nov, from 09:00",
    );
  });
  it("carries the year of an older session", () => {
    expect(
      spanText(
        session({
          started_at: "2025-03-01T08:00:00.000Z",
          ended_at: "2025-03-01T08:30:00.000Z",
        }),
        NOW,
      ),
    ).toBe("1 Mar 2025, 08:00–08:30");
  });
  it("is empty for a date that is not one", () => {
    expect(spanText(session({ started_at: "nope" }), NOW)).toBe("");
  });
});

describe("uploadTitle", () => {
  it("names an upload batch by its UTC day", () => {
    expect(uploadTitle("2026-11-22T23:30:00.000Z")).toBe("Upload · 2026-11-22");
  });
});

describe("folderPath", () => {
  const folders = [
    { id: "a", name: "Harbour", parent_id: null },
    { id: "b", name: "Proposals", parent_id: "a" },
  ];
  it("names a sub-folder with its parent", () => {
    expect(folderPath("b", folders)).toBe("Harbour / Proposals");
    expect(folderPath("a", folders)).toBe("Harbour");
  });
  it("is empty for a folder that is gone", () => {
    expect(folderPath("z", folders)).toBe("");
  });
});

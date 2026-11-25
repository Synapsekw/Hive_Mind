import { describe, expect, it } from "vitest";
import cases from "../../../tests/fixtures/kind-cases.json";
import {
  fileKind,
  kindLabel,
  PDF_THUMB_MAX,
  PDF_VIEW_MAX,
  TEXT_VIEW_MAX,
  THUMB_MAX,
} from "./kind";

describe("fileKind", () => {
  it.each(cases)("$name $mime is $kind", ({ name, mime, kind }) => {
    expect(fileKind(name, mime)).toBe(kind);
  });
});

describe("kindLabel", () => {
  it("is the extension in capitals, PDF for pdf, FILE when there is none", () => {
    expect(kindLabel("pdf", "x.PDF")).toBe("PDF");
    expect(kindLabel("slides", "d.pptx")).toBe("PPTX");
    expect(kindLabel("other", "noext")).toBe("FILE");
  });
});

describe("the caps", () => {
  it("are 2 MB, 5 MB, 25 MB and 512 KB", () => {
    expect(THUMB_MAX).toBe(2 * 1024 * 1024);
    expect(PDF_THUMB_MAX).toBe(5 * 1024 * 1024);
    expect(PDF_VIEW_MAX).toBe(25 * 1024 * 1024);
    expect(TEXT_VIEW_MAX).toBe(512 * 1024);
  });
});

import { describe, expect, it } from "vitest";
import { fileKind, kindLabel, PDF_VIEW_MAX, THUMB_MAX } from "./kind";

describe("the caps", () => {
  it("are 2 MB for thumbnails and 25 MB for the PDF viewer", () => {
    expect(THUMB_MAX).toBe(2 * 1024 * 1024);
    expect(PDF_VIEW_MAX).toBe(25 * 1024 * 1024);
  });
});

describe("fileKind", () => {
  it.each([
    ["a.png", "image/png"],
    ["a.jpg", "image/jpeg"],
    ["a.jpeg", "image/jpeg"],
    ["a.gif", "image/gif"],
    ["a.webp", "image/webp"],
    ["a.avif", "image/avif"],
    ["A.PNG", "image/png"],
    ["a.png", "IMAGE/PNG"],
    ["a.png", "image/png; charset=binary"],
    ["site.photo.v2.jpg", "image/jpeg"],
  ])("%s declared %s is an image", (name, mime) => {
    expect(fileKind(name, mime)).toBe("image");
  });

  it("a .pdf declared application/pdf is a pdf", () => {
    expect(fileKind("a.pdf", "application/pdf")).toBe("pdf");
    expect(fileKind("Proposal v3.PDF", "application/pdf")).toBe("pdf");
  });

  it.each([
    ["a.pptx", "slides"],
    ["a.xlsx", "sheet"],
    ["a.csv", "sheet"],
    ["a.docx", "doc"],
    ["a.md", "doc"],
    ["a.txt", "doc"],
  ] as const)("%s is %s whatever the declared type", (name, kind) => {
    expect(fileKind(name, "application/octet-stream")).toBe(kind);
    expect(fileKind(name, "text/html")).toBe(kind);
    expect(fileKind(name, null)).toBe(kind);
  });

  it.each([
    ["a.png", "text/html"],
    ["a.html", "image/png"],
    ["a.pdf", "text/html"],
    ["a.png", null],
    ["a.pdf", null],
    ["a.svg", "image/svg+xml"],
    ["a.svg", "image/png"],
    ["noext", "image/png"],
    ["a.pdf.html", "application/pdf"],
    ["a.png", "image/jpeg"],
    ["a.jpg", "image/png"],
    ["a.png", "application/pdf"],
    ["a.pdf", "image/png"],
    ["a.png.", "image/png"],
    ["png", "image/png"],
    ["", "image/png"],
    ["a.zip", "application/zip"],
  ] as const)("%s declared %s is other", (name, mime) => {
    expect(fileKind(name, mime)).toBe("other");
  });

  it("does not fall for a name that is a property of every object", () => {
    expect(fileKind("a.constructor", "image/png")).toBe("other");
    expect(fileKind("a.__proto__", "image/png")).toBe("other");
    expect(fileKind("a.toString", null)).toBe("other");
  });
});

describe("kindLabel", () => {
  it("is the extension in capitals", () => {
    expect(kindLabel("pdf", "x.pdf")).toBe("PDF");
    expect(kindLabel("image", "x.jpeg")).toBe("JPEG");
    expect(kindLabel("image", "x.PNG")).toBe("PNG");
    expect(kindLabel("slides", "Kickoff deck.pptx")).toBe("PPTX");
    expect(kindLabel("other", "x.zip")).toBe("ZIP");
    expect(kindLabel("other", "x.7z")).toBe("7Z");
  });

  it("is FILE without a usable extension", () => {
    expect(kindLabel("other", "x")).toBe("FILE");
    expect(kindLabel("other", "x.")).toBe("FILE");
    expect(kindLabel("other", "")).toBe("FILE");
    expect(kindLabel("other", "x.sqlite")).toBe("FILE"); // six characters
    expect(kindLabel("other", "x.a-b")).toBe("FILE");
    expect(kindLabel("other", "x.<b>")).toBe("FILE");
    expect(kindLabel("other", "x.tar gz")).toBe("FILE");
    expect(kindLabel("other", "x.žip")).toBe("FILE");
  });
});

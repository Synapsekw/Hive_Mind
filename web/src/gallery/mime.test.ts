import { expect, it } from "vitest";
import { mimeFor } from "./mime";

it("maps known extensions in any case and defaults to octet-stream", () => {
  expect(mimeFor("A.PDF")).toBe("application/pdf");
  expect(mimeFor("p.webp")).toBe("image/webp");
  expect(mimeFor("n.csv")).toBe("text/csv");
  expect(mimeFor("x.exe")).toBe("application/octet-stream");
  expect(mimeFor("noext")).toBe("application/octet-stream");
});

it("stores anything a browser would render as a page as a plain byte stream", () => {
  // A stored type of text/html or image/svg+xml would make the storage link serve a live page.
  for (const name of [
    "site.html",
    "SITE.HTM",
    "logo.svg",
    "page.xhtml",
    "feed.xml",
    "a.xht",
    "b.svgz",
  ])
    expect(mimeFor(name)).toBe("application/octet-stream");
});

import { expect, it } from "vitest";
import { mimeFor } from "./mime";

it("maps known extensions in any case and defaults to octet-stream", () => {
  expect(mimeFor("A.PDF")).toBe("application/pdf");
  expect(mimeFor("p.webp")).toBe("image/webp");
  expect(mimeFor("n.csv")).toBe("text/csv");
  expect(mimeFor("x.exe")).toBe("application/octet-stream");
  expect(mimeFor("noext")).toBe("application/octet-stream");
});

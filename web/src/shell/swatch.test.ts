import { describe, expect, it } from "vitest";
import { swatch } from "./swatch";

describe("swatch", () => {
  it("is the theme's card and its freshest colour, split on the diagonal", () => {
    expect(swatch("honey")).toBe(
      "linear-gradient(135deg, #0c0c0d 0 50%, #ffd98a 50% 100%)",
    );
    expect(swatch("paper")).toBe(
      "linear-gradient(135deg, #f8f6f1 0 50%, #1d1a16 50% 100%)",
    );
  });

  it("falls back to the first theme for an unknown id", () => {
    expect(swatch("nope")).toBe(swatch("honey"));
  });
});

import { describe, expect, it } from "vitest";
import { colourLiterals } from "../theme/lint";

describe("brand", () => {
  it("has no colour literals", () => {
    expect(colourLiterals("src/brand")).toEqual([]);
  });
});

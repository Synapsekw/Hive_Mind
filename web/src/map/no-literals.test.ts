import { describe, expect, it } from "vitest";
import { colourLiterals } from "../theme/lint";

describe("the map", () => {
  it("writes no colour literal; every colour comes from a token", () => {
    expect(colourLiterals("src/map")).toEqual([]);
  });
});

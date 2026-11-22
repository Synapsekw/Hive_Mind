import { describe, expect, it } from "vitest";
import { colourLiterals } from "../theme/lint";

describe("the app folder", () => {
  it("writes no colour literal outside globals.css", () => {
    for (const hit of colourLiterals("src/app"))
      expect(hit.file.endsWith("globals.css")).toBe(true);
  });
});

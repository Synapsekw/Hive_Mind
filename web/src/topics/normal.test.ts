import { describe, expect, it } from "vitest";
import { normal } from "./normal";

describe("normal", () => {
  it("ignores case, accents and the space, dash and underscore between words", () => {
    expect(normal("Zain DragonFly")).toBe("zain dragonfly");
    expect(normal("zain-dragonfly")).toBe("zain dragonfly");
    expect(normal("  ZAIN_dragonfly ")).toBe("zain dragonfly");
    expect(normal("Café Zürich")).toBe("cafe zurich");
  });

  it("keeps & and + so a short company name stays itself", () => {
    expect(normal("e&")).toBe("e&");
    expect(normal("C++ notes")).toBe("c++ notes");
  });

  it("turns punctuation into one space and trims", () => {
    expect(normal("Zain: proposal (v2).")).toBe("zain proposal v2");
    expect(normal("#vendor")).toBe("vendor");
    expect(normal("...")).toBe("");
  });
});

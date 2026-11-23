import { describe, expect, it } from "vitest";
import { cleanEmail, cleanName, cleanNewAgent } from "./validate";

const W1 = "00000000-0000-4000-8000-000000000b01";

describe("cleanName", () => {
  it("trims and keeps a name", () => {
    expect(cleanName("  Claude Code  ")).toBe("Claude Code");
  });

  it("keeps 60 characters and refuses 61", () => {
    expect(cleanName("a".repeat(60))).toBe("a".repeat(60));
    expect(cleanName("a".repeat(61))).toBeNull();
  });

  it("counts the length after trimming", () => {
    expect(cleanName(`  ${"a".repeat(60)}  `)).toBe("a".repeat(60));
  });

  it.each([
    ["an empty string", ""],
    ["spaces only", "   "],
    ["a tab and a line break", "\t\n"],
    ["a number", 7],
    ["null", null],
    ["undefined", undefined],
    ["an object", { name: "x" }],
    ["a list", ["x"]],
  ])("refuses %s", (_name, v) => {
    expect(cleanName(v)).toBeNull();
  });
});

describe("cleanEmail", () => {
  it("keeps a valid address", () => {
    expect(cleanEmail("ahmed@example.com")).toBe("ahmed@example.com");
  });

  it("trims and lowers upper case", () => {
    expect(cleanEmail("  Ahmed@Example.COM ")).toBe("ahmed@example.com");
  });

  it("keeps 254 characters and refuses 255", () => {
    const at = "@example.com";
    const ok = "a".repeat(254 - at.length) + at;
    expect(ok).toHaveLength(254);
    expect(cleanEmail(ok)).toBe(ok);
    expect(cleanEmail(`a${ok}`)).toBeNull();
  });

  it.each([
    ["an empty string", ""],
    ["spaces only", "   "],
    ["no @", "ahmed.example.com"],
    ["two @", "ahmed@@example.com"],
    ["two @ apart", "ahmed@example@com"],
    ["a space inside", "ah med@example.com"],
    ["a tab inside", "ahmed@exa\tmple.com"],
    ["a line break inside", "ahmed@example.com\nx"],
    ["nothing before the @", "@example.com"],
    ["nothing after the @", "ahmed@"],
    ["a number", 7],
    ["null", null],
    ["undefined", undefined],
    ["an object", { email: "ahmed@example.com" }],
  ])("refuses %s", (_name, v) => {
    expect(cleanEmail(v)).toBeNull();
  });
});

describe("cleanNewAgent", () => {
  const good = {
    name: "Claude Code",
    workspaceId: W1,
    provider: "Claude Code",
    trustTier: "vendor",
  };

  it("keeps a valid agent", () => {
    expect(cleanNewAgent(good)).toEqual(good);
  });

  it("trims the name", () => {
    expect(cleanNewAgent({ ...good, name: "  Laptop " })?.name).toBe("Laptop");
  });

  it.each(["Claude", "ChatGPT", "Claude Code", "Codex CLI", "Other"])(
    "accepts the provider %s",
    (provider) => {
      expect(cleanNewAgent({ ...good, provider })?.provider).toBe(provider);
    },
  );

  it.each(["vendor", "self_hosted"])("accepts the tier %s", (trustTier) => {
    expect(cleanNewAgent({ ...good, trustTier })?.trustTier).toBe(trustTier);
  });

  it.each([
    ["an empty name", { name: "  " }],
    ["a name of 61 characters", { name: "a".repeat(61) }],
    ["a name that is a number", { name: 7 }],
    ["a workspace that is not a uuid", { workspaceId: "main" }],
    ["a workspace with a filter appended", { workspaceId: `${W1},id.eq.x` }],
    ["a missing workspace", { workspaceId: undefined }],
    ["an unknown provider", { provider: "Gemini" }],
    ["a provider in the wrong case", { provider: "claude" }],
    ["a provider that is a number", { provider: 1 }],
    ["an unknown tier", { trustTier: "trusted" }],
    ["a missing tier", { trustTier: undefined }],
  ])("refuses %s", (_name, over) => {
    expect(cleanNewAgent({ ...good, ...over })).toBeNull();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "agent"],
    ["a number", 3],
    ["a list", [good]],
  ])("refuses %s", (_name, v) => {
    expect(cleanNewAgent(v)).toBeNull();
  });

  it("drops fields the contract does not name", () => {
    const out = cleanNewAgent({
      ...good,
      memberId: "someone-else",
      token: "hive_x",
      p_trust_tier: "vendor",
    });
    expect(Object.keys(out!).sort()).toEqual(
      ["name", "provider", "trustTier", "workspaceId"].sort(),
    );
  });
});

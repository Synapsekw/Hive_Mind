import { describe, expect, it } from "vitest";
import {
  FAILED,
  MAX_NAME,
  checkNew,
  createFailure,
  hiveButtonLabel,
  hiveList,
  trimName,
} from "./hiveText";

describe("the hive switcher's words", () => {
  it("names the hive on the button", () => {
    expect(hiveButtonLabel("Keystone Studio")).toBe("Hive: Keystone Studio");
  });

  it("says one line for each refusal", () => {
    expect(createFailure("name")).toBe("A hive name is 1 to 60 characters.");
    expect(createFailure("display-name")).toBe(
      "Your name is 1 to 60 characters.",
    );
    expect(createFailure("limit")).toBe("You already own 5 hives.");
    expect(createFailure("failed")).toBe("That didn't work. Try again.");
  });

  it("falls back to the usual failure line for a reason it does not know", () => {
    expect(createFailure("other" as never)).toBe(FAILED);
  });
});

describe("the new hive check", () => {
  it("trims what the database trims and nothing else", () => {
    expect(trimName(" \t\n\r\f\vvault v\v\f\r\n\t ")).toBe("vault v");
    expect(trimName(" x ")).toBe(" x ");
  });

  it("accepts 1 to 60 characters after trimming", () => {
    expect(checkNew("a", "b")).toBeNull();
    expect(checkNew("a".repeat(MAX_NAME), "b".repeat(MAX_NAME))).toBeNull();
    expect(checkNew(`  ${"a".repeat(MAX_NAME)}  `, "b")).toBeNull();
  });

  it("refuses an empty or over-long hive name", () => {
    expect(checkNew("", "Mara")).toBe("name");
    expect(checkNew(" \t\n", "Mara")).toBe("name");
    expect(checkNew("a".repeat(MAX_NAME + 1), "Mara")).toBe("name");
  });

  it("refuses an empty or over-long name in the hive", () => {
    expect(checkNew("Atlas", "")).toBe("display-name");
    expect(checkNew("Atlas", "  ")).toBe("display-name");
    expect(checkNew("Atlas", "a".repeat(MAX_NAME + 1))).toBe("display-name");
  });

  it("names the hive name first when both are wrong", () => {
    expect(checkNew("", "")).toBe("name");
  });

  it("counts characters, not code units", () => {
    expect(checkNew("🐝".repeat(MAX_NAME), "Mara")).toBeNull();
    expect(checkNew("🐝".repeat(MAX_NAME + 1), "Mara")).toBe("name");
  });
});

describe("the list of hives", () => {
  const a = { id: "a", name: "Atlas", role: "owner", current: false };
  const b = { id: "b", name: "Beacon", role: "member", current: true };

  it("is the account's list when it carries one", () => {
    expect(
      hiveList({ hive: "Beacon", role: "member", hiveId: "b", hives: [a, b] }),
    ).toEqual([a, b]);
  });

  it("is the one hive on show when the account carries no list", () => {
    expect(hiveList({ hive: "Atlas", role: "owner" })).toEqual([
      { id: "", name: "Atlas", role: "owner", current: true },
    ]);
    expect(
      hiveList({ hive: "Atlas", role: "owner", hiveId: "a", hives: [] }),
    ).toEqual([{ id: "a", name: "Atlas", role: "owner", current: true }]);
  });
});

import { describe, expect, it } from "vitest";
import {
  folderSentence,
  noteSentence,
  people,
  releaseSentence,
} from "./sentences";
import type { Mark } from "./marks";

const none = { follows: 0, own_setting: 0, under_nested_rule: 0, held: 0 };

describe("people", () => {
  it("joins one, two and three names", () => {
    expect(people(["Ahmed"])).toBe("Ahmed");
    expect(people(["Ahmed", "Sara"])).toBe("Ahmed and Sara");
    expect(people(["Ahmed", "Sara", "Lina"])).toBe("Ahmed, Sara and Lina");
  });
});

describe("noteSentence", () => {
  const base = { hive: "Synapse", hiveSize: 3, names: [], folderRule: null };
  it("private", () => {
    expect(
      noteSentence({
        ...base,
        choice: { visibility: "private", shared_with: [] },
      }),
    ).toBe(
      "Only you will be able to read this note, and anyone whose link to it you accepted.",
    );
  });
  it("group", () => {
    expect(
      noteSentence({
        ...base,
        choice: { visibility: "group", shared_with: [] },
      }),
    ).toBe("Everyone in Synapse (3 people) will be able to read this note.");
  });
  it("group in a hive of one", () => {
    expect(
      noteSentence({
        ...base,
        hiveSize: 1,
        choice: { visibility: "group", shared_with: [] },
      }),
    ).toBe(
      "Everyone in Synapse will be able to read this note. You are the only member so far.",
    );
  });
  it("members", () => {
    expect(
      noteSentence({
        ...base,
        names: ["Ahmed", "Sara"],
        choice: { visibility: "members", shared_with: ["a", "s"] },
      }),
    ).toBe("Ahmed and Sara will be able to read this note.");
  });
  it("same as folder", () => {
    const folderRule: Mark = { kind: "group", from: null, label: "Everyone" };
    expect(
      noteSentence({
        ...base,
        folderRule,
        choice: { visibility: null, shared_with: [] },
      }),
    ).toBe("This note will follow its folder: Everyone.");
  });
  it("same as folder with no rule falls back to Private", () => {
    expect(
      noteSentence({
        ...base,
        choice: { visibility: null, shared_with: [] },
      }),
    ).toBe("This note will follow its folder: Private.");
  });
});

describe("folderSentence", () => {
  const base = { folder: "clients", hive: "Synapse", hiveSize: 3, names: [] };
  const group = { visibility: "group" as const, shared_with: [] };
  it("group", () => {
    expect(
      folderSentence({
        ...base,
        choice: group,
        preview: { ...none, follows: 10 },
      }),
    ).toBe(
      "Everyone in Synapse (3 people) will be able to read the 10 notes in clients, and any note added there later, including by your agent.",
    );
  });
  it("singular and zero follows", () => {
    expect(
      folderSentence({
        ...base,
        choice: group,
        preview: { ...none, follows: 1 },
      }),
    ).toContain("read the 1 note in clients,");
    expect(folderSentence({ ...base, choice: group, preview: none })).toContain(
      "read the 0 notes in clients,",
    );
  });
  it("each tail alone", () => {
    const head = folderSentence({ ...base, choice: group, preview: none });
    expect(
      folderSentence({
        ...base,
        choice: group,
        preview: { ...none, own_setting: 3 },
      }),
    ).toBe(`${head} 3 notes with their own setting are not affected.`);
    expect(
      folderSentence({
        ...base,
        choice: group,
        preview: { ...none, under_nested_rule: 5 },
      }),
    ).toBe(`${head} 5 notes in folders with their own rule are not affected.`);
    expect(
      folderSentence({
        ...base,
        choice: group,
        preview: { ...none, held: 2 },
      }),
    ).toBe(`${head} 2 held notes stay hidden until you release them.`);
  });
  it("all three tails together", () => {
    const s = folderSentence({
      ...base,
      choice: group,
      preview: { follows: 10, own_setting: 3, under_nested_rule: 5, held: 2 },
    });
    expect(s).toBe(
      "Everyone in Synapse (3 people) will be able to read the 10 notes in clients, and any note added there later, including by your agent. 3 notes with their own setting are not affected. 5 notes in folders with their own rule are not affected. 2 held notes stay hidden until you release them.",
    );
  });
  it("singular tails", () => {
    const head = folderSentence({ ...base, choice: group, preview: none });
    const one = (k: keyof typeof none) =>
      folderSentence({
        ...base,
        choice: group,
        preview: { ...none, [k]: 1 },
      });
    expect(one("own_setting")).toBe(
      `${head} 1 note with its own setting is not affected.`,
    );
    expect(one("under_nested_rule")).toBe(
      `${head} 1 note in a folder with its own rule is not affected.`,
    );
    expect(
      one("held").endsWith(" 1 held note stays hidden until you release it."),
    ).toBe(true);
  });
  it("no rule, singular", () => {
    expect(
      folderSentence({
        ...base,
        choice: { visibility: null, shared_with: [] },
        preview: { ...none, follows: 1 },
      }),
    ).toBe(
      "clients will have no rule of its own. Its 1 note follows the folder above, or your default setting.",
    );
  });
  it("group in a hive of one", () => {
    expect(
      folderSentence({
        ...base,
        hiveSize: 1,
        choice: group,
        preview: { ...none, follows: 2 },
      }),
    ).toBe(
      "Everyone in Synapse will be able to read the 2 notes in clients, and any note added there later, including by your agent. You are the only member so far.",
    );
  });
  it("members", () => {
    expect(
      folderSentence({
        ...base,
        names: ["Ahmed"],
        choice: { visibility: "members", shared_with: ["a"] },
        preview: { ...none, follows: 4, held: 2 },
      }),
    ).toBe(
      "Ahmed will be able to read the 4 notes in clients, and any note added there later, including by your agent. 2 held notes stay hidden until you release them.",
    );
  });
  it("private", () => {
    const choice = { visibility: "private" as const, shared_with: [] };
    expect(
      folderSentence({
        ...base,
        choice,
        preview: { ...none, follows: 4, own_setting: 3 },
      }),
    ).toBe(
      "The 4 notes in clients will be readable only by you, and so will any note added there later. A note linked with a colleague's note stays readable to that colleague. 3 notes with their own setting are not affected.",
    );
    expect(
      folderSentence({
        ...base,
        choice,
        preview: { ...none, follows: 1 },
      }),
    ).toContain("The 1 note in clients will be");
  });
  it("no rule", () => {
    expect(
      folderSentence({
        ...base,
        choice: { visibility: null, shared_with: [] },
        preview: { ...none, follows: 6 },
      }),
    ).toBe(
      "clients will have no rule of its own. Its 6 notes follow the folder above, or your default setting.",
    );
  });
});

describe("releaseSentence", () => {
  it("names the sharing setting", () => {
    expect(
      releaseSentence({ kind: "group", from: null, label: "Everyone" }),
    ).toBe(
      "This note was written by a self-hosted agent. Releasing it makes it follow its sharing setting: Everyone.",
    );
  });
});

import { describe, expect, it } from "vitest";
import { prepare, prose, topicsFor } from "./match";
import type { Kind, Topic } from "./types";

const topic = (
  id: string,
  kind: Kind,
  name: string,
  aliases: string[] = [],
): Topic => ({
  id,
  kind,
  name,
  aliases,
});
const note = (
  path: string,
  over: { title?: string; body?: string; frontmatter?: unknown } = {},
) => ({
  path,
  title: over.title ?? "Untitled",
  body: over.body ?? "",
  frontmatter: over.frontmatter ?? {},
});

const ZAIN = topic("z", "client", "Zain", ["ZainTech"]);
const TERRA = topic("t", "vendor", "Terra Drone");
const ready = prepare([ZAIN, TERRA]);

describe("an index alias", () => {
  const saved = prepare([topic("z", "client", "Zain", ["_Index", "ZainTech"])]);

  it("gives a topic only the keys of its name and its real aliases", () => {
    expect(saved[0]!.keys).toEqual(["zain", "zaintech"]);
  });

  it("does not match a note titled Sessions index", () => {
    expect(
      topicsFor(note("Sessions/a.md", { title: "Sessions index" }), saved),
    ).toEqual([]);
  });

  it("gives a topic named Index no keys, so it matches nothing", () => {
    const idx = prepare([topic("i", "subject", "Index")]);
    expect(idx[0]!.keys).toEqual([]);
    expect(
      topicsFor(note("a.md", { title: "Index", body: "the index" }), idx),
    ).toEqual([]);
  });
});

describe("prose", () => {
  it("drops fenced code blocks and inline code", () => {
    expect(prose("a\n```\nZain\n```\nb `Zain` c\n~~~\nZain\n~~~\nd")).toBe(
      "a\nb   c\nd",
    );
  });

  it("treats a fence that never closes as code to the end", () => {
    expect(prose("a\n```\nZain\nmore")).toBe("a");
  });
});

describe("topicsFor", () => {
  it("gives 1 to the note that proposes the topic itself", () => {
    expect(
      topicsFor(
        note("Employers/Zain/_Index.md", {
          frontmatter: { type: "client-entity" },
        }),
        ready,
      ),
    ).toEqual([{ id: "z", confidence: 1 }]);
  });

  it("gives 0.9 for a folder in the path, by name or alias, and not for the file's own name", () => {
    expect(topicsFor(note("sources/zain/vendors/x.md"), ready)).toEqual([
      { id: "z", confidence: 0.9 },
    ]);
    expect(topicsFor(note("outputs/ZainTech/deck.md"), ready)).toEqual([
      { id: "z", confidence: 0.9 },
    ]);
    expect(topicsFor(note("notes/zain.md"), ready)).toEqual([]);
  });

  it("gives 0.9 for a tag, with dashes read as spaces", () => {
    expect(
      topicsFor(
        note("a.md", { frontmatter: { tags: ["terra-drone", "kuwait"] } }),
        ready,
      ),
    ).toEqual([{ id: "t", confidence: 0.9 }]);
  });

  it("gives 0.7 for whole words in the title", () => {
    expect(
      topicsFor(note("a.md", { title: "Zain: proposal v2" }), ready),
    ).toEqual([{ id: "z", confidence: 0.7 }]);
    expect(topicsFor(note("a.md", { title: "Zainab's notes" }), ready)).toEqual(
      [],
    );
  });

  it("gives 0.5 for whole words in the text, outside code, for names of four characters or more", () => {
    expect(
      topicsFor(note("a.md", { body: "Met Terra Drone today." }), ready),
    ).toEqual([{ id: "t", confidence: 0.5 }]);
    expect(
      topicsFor(note("a.md", { body: "```\nTerra Drone\n```" }), ready),
    ).toEqual([]);
    const short = prepare([
      topic("e", "client", "e&"),
      topic("o", "client", "Oxy"),
    ]);
    expect(topicsFor(note("a.md", { body: "e& and Oxy" }), short)).toEqual([]);
    expect(topicsFor(note("a.md", { title: "Oxy deck" }), short)).toEqual([
      { id: "o", confidence: 0.7 },
    ]);
  });

  it("keeps the strongest signal of a topic, once", () => {
    expect(
      topicsFor(
        note("sources/zain/x.md", { title: "Zain", body: "Zain Zain" }),
        ready,
      ),
    ).toEqual([{ id: "z", confidence: 0.9 }]);
  });

  it("keeps five topics: strongest first, then by kind, then by name", () => {
    const many = prepare([
      topic("s1", "subject", "Alpha"),
      topic("v1", "vendor", "Bravo"),
      topic("c2", "client", "Delta"),
      topic("c1", "client", "Charlie"),
      topic("p1", "person", "Echo"),
      topic("s2", "subject", "Foxtrot"),
      topic("x", "client", "Golf"),
      topic("pa", "partner", "Hotel"),
      topic("so", "solution", "India"),
    ]);
    const hits = topicsFor(
      note("Golf/a.md", {
        body: "Alpha Bravo Charlie Delta Echo Foxtrot Hotel India",
      }),
      many,
    );
    expect(hits.map((h) => h.id)).toEqual(["x", "c1", "c2", "pa", "v1"]);
    expect(hits[0]!.confidence).toBe(0.9);
  });

  it("never matches a topic whose name is under three characters", () => {
    expect(
      topicsFor(
        note("ab/x.md", { title: "ab" }),
        prepare([topic("a", "client", "AB")]),
      ),
    ).toEqual([]);
  });
});

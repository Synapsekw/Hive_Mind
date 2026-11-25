import { describe, expect, it } from "vitest";
import { candidates, headOf, proposalOf } from "./candidates";
import type { NoteHead } from "./types";

const head = (path: string, over: Partial<NoteHead> = {}): NoteHead => ({
  path,
  title: path,
  type: null,
  aliases: [],
  tags: [],
  ...over,
});

describe("headOf", () => {
  it("reads type, aliases and tags from the fields, and nothing else", () => {
    expect(
      headOf("a/Zain.md", "Zain Group", {
        type: "client-entity",
        aliases: ["ZainTech", 7, "  Zain KSA "],
        tags: ["kuwait", null, "#vendor"],
        secret: "x",
      }),
    ).toEqual({
      path: "a/Zain.md",
      title: "Zain Group",
      type: "client-entity",
      aliases: ["ZainTech", "Zain KSA"],
      tags: ["kuwait", "#vendor"],
    });
  });

  it("gives empty lists for fields that are missing or the wrong shape", () => {
    for (const f of [
      null,
      undefined,
      "x",
      [],
      { type: 3, aliases: "a", tags: {} },
    ])
      expect(headOf("a.md", "A", f)).toEqual(head("a.md", { title: "A" }));
  });

  it("drops an empty text and one over 80 characters, and keeps at most 20 aliases and 50 tags", () => {
    const h = headOf("a.md", "A", {
      aliases: [
        "",
        "x".repeat(81),
        ...Array.from({ length: 30 }, (_, i) => `al${i}`),
      ],
      tags: Array.from({ length: 60 }, (_, i) => `t${i}`),
    });
    expect(h.aliases).toHaveLength(20);
    expect(h.aliases[0]).toBe("al0");
    expect(h.tags).toHaveLength(50);
  });
});

describe("proposalOf", () => {
  it.each([
    ["client", "client"],
    ["client-entity", "client"],
    ["partner-entity", "partner"],
    ["partner", "partner"],
    ["project", "project"],
    ["internal-project", "project"],
    ["person", "person"],
    ["product", "product"],
    ["vendor", "vendor"],
    ["concept", "subject"],
    ["cluster-topic", "subject"],
    ["category", "solution"],
    ["solution", "solution"],
    [" Vendor ", "vendor"],
  ])("a note of type %s proposes a %s named after its file", (type, kind) => {
    expect(proposalOf(head("Knowledge/x/Terra Drone.md", { type }))).toEqual({
      kind,
      name: "Terra Drone",
      aliases: ["Knowledge/x/Terra Drone.md"],
    });
  });

  it("takes the folder's name for an index file, and the title and aliases as aliases", () => {
    for (const file of ["_Index.md", "index.md", "README.md"])
      expect(
        proposalOf(
          head(`Employers/Zain/${file}`, {
            type: "client-entity",
            title: "Zain Group",
            aliases: ["ZainTech", "zain group", "ZAIN"],
          }),
        ),
      ).toEqual({
        kind: "client",
        name: "Zain",
        aliases: ["Zain Group", "ZainTech"],
      });
  });

  it("proposes a folder with an _Index note and no type: a client under Employers, else a subject", () => {
    expect(
      proposalOf(head("Employers/Orbit/_Index.md", { title: "Orbit" })),
    ).toEqual({
      kind: "client",
      name: "Orbit",
      aliases: [],
    });
    expect(
      proposalOf(head("clients/Acme/_index.md", { title: "Acme" }))?.kind,
    ).toBe("client");
    expect(
      proposalOf(head("Decisions/_Index.md", { title: "Decisions" }))?.kind,
    ).toBe("subject");
    // Only _Index does this; a README with no type proposes nothing.
    expect(proposalOf(head("outputs/decks/README.md"))).toBeNull();
  });

  it("proposes nothing for other types, templates, short names, long names and a root index", () => {
    expect(proposalOf(head("Sessions/a.md", { type: "session" }))).toBeNull();
    expect(proposalOf(head("a.md"))).toBeNull();
    expect(
      proposalOf(head("Templates/vendor.md", { type: "vendor" })),
    ).toBeNull();
    expect(
      proposalOf(head("x/templates/y/Acme.md", { type: "vendor" })),
    ).toBeNull();
    expect(proposalOf(head("v/AB.md", { type: "vendor" }))).toBeNull();
    expect(
      proposalOf(head(`v/${"x".repeat(81)}.md`, { type: "vendor" })),
    ).toBeNull();
    expect(proposalOf(head("_Index.md", { type: "vendor" }))).toBeNull();
    expect(
      proposalOf(head("v/toString.md", { type: "constructor" })),
    ).toBeNull();
  });
});

describe("proposalOf: a file name is never an alias", () => {
  it.each([
    ["Employers/Zain/_Index.md", "_Index"],
    ["Employers/Zain/README.md", "README"],
    ["Employers/Zain/index.md", "index"],
  ])("%s titled %s proposes Zain with no aliases", (path, title) => {
    expect(proposalOf(head(path, { type: "client-entity", title }))).toEqual({
      kind: "client",
      name: "Zain",
      aliases: [],
    });
  });

  it("never takes index or readme from the title or the aliases field", () => {
    expect(
      proposalOf(
        head("Employers/Zain/_Index.md", {
          type: "client-entity",
          title: "Index",
          aliases: ["README", "ZainTech"],
        }),
      )?.aliases,
    ).toEqual(["ZainTech"]);
  });

  it("takes no alias that is the note's own file stem in another spelling", () => {
    for (const title of ["terra drone", "Terra-Drone", "Terra Drone"])
      expect(
        proposalOf(head("v/Terra Drone.md", { type: "vendor", title }))
          ?.aliases,
      ).toEqual([]);
  });

  it("still keeps a real title that differs", () => {
    expect(
      proposalOf(
        head("Employers/Orbit/_Index.md", {
          type: "client-entity",
          title: "Orbit Aerospace",
        }),
      )?.aliases,
    ).toEqual(["Orbit Aerospace"]);
  });
});

describe("headOf: a plain-string tags field", () => {
  it("splits a string on commas and white space", () => {
    expect(headOf("a.md", "A", { tags: "zain" }).tags).toEqual(["zain"]);
    expect(headOf("a.md", "A", { tags: "kuwait, vendor" }).tags).toEqual([
      "kuwait",
      "vendor",
    ]);
    expect(headOf("a.md", "A", { tags: " a  b,\nc ,, " }).tags).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("drops items over 80 characters, caps at 50, and does not do this for aliases", () => {
    const long = "x".repeat(81);
    expect(headOf("a.md", "A", { tags: `ok ${long}` }).tags).toEqual(["ok"]);
    const many = Array.from({ length: 60 }, (_, i) => `t${i}`).join(" ");
    expect(headOf("a.md", "A", { tags: many }).tags).toHaveLength(50);
    expect(headOf("a.md", "A", { aliases: "ZainTech" }).aliases).toEqual([]);
  });
});

describe("candidates", () => {
  it("merges two notes that propose the same kind and name, ignoring case and accents", () => {
    const out = candidates([
      head("a/Zain.md", {
        type: "client",
        title: "Zain",
        aliases: ["ZainTech"],
      }),
      head("b/zain.md", { type: "client-entity", title: "Zain Group" }),
      head("c/Zain.md", { type: "vendor", title: "Zain" }),
    ]);
    expect(out).toEqual([
      {
        kind: "client",
        name: "Zain",
        aliases: ["ZainTech", "Zain Group"],
        notes: 2,
      },
      { kind: "vendor", name: "Zain", aliases: [], notes: 1 },
    ]);
  });

  it("proposes a tag on five or more notes as a subject, unless a candidate already has the name", () => {
    const tagged = (n: number, tag: string) =>
      Array.from({ length: n }, (_, i) =>
        head(`s/${tag}-${i}.md`, { tags: [tag] }),
      );
    const out = candidates([
      head("v/Terra Drone.md", { type: "vendor", title: "Terra Drone" }),
      ...tagged(5, "terra-drone"),
      ...tagged(5, "#flare-stack"),
      ...tagged(4, "rare"),
      ...tagged(6, "ab"),
    ]);
    expect(out).toEqual([
      { kind: "vendor", name: "Terra Drone", aliases: [], notes: 1 },
      { kind: "subject", name: "flare-stack", aliases: [], notes: 5 },
    ]);
  });

  it("counts a tag once per note and ignores the tags of templates", () => {
    const out = candidates([
      ...Array.from({ length: 4 }, (_, i) =>
        head(`s/${i}.md`, { tags: ["ops", "Ops"] }),
      ),
      head("Templates/t.md", { tags: ["ops"] }),
    ]);
    expect(out).toEqual([]);
  });

  it("keeps a partner and a vendor of the same name as two candidates, partner first", () => {
    const out = candidates([
      head("Knowledge/Vendors/Qualcomm.md", { type: "vendor" }),
      head("Employers/Zain/Partners/Qualcomm.md", { type: "partner-entity" }),
    ]);
    expect(out.map((c) => `${c.kind}:${c.name}`)).toEqual([
      "partner:Qualcomm",
      "vendor:Qualcomm",
    ]);
  });

  it("orders by kind, then by name", () => {
    const out = candidates([
      head("x/Beta.md", { type: "concept", title: "Beta" }),
      head("x/Rov.md", { type: "category", title: "Rov" }),
      head("x/Qual.md", { type: "partner-entity", title: "Qual" }),
      head("x/Zed.md", { type: "client", title: "Zed" }),
      head("x/Alpha.md", { type: "client", title: "Alpha" }),
      head("x/Mid.md", { type: "vendor", title: "Mid" }),
    ]);
    expect(out.map((c) => `${c.kind}:${c.name}`)).toEqual([
      "client:Alpha",
      "client:Zed",
      "partner:Qual",
      "vendor:Mid",
      "solution:Rov",
      "subject:Beta",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  MAX_TARGETS,
  buildIndex,
  looksLikeFile,
  resolveTarget,
  wikiTargets,
  type Indexed,
} from "./wikilinks";

/** Notes named by their paths alone: each one's id is its path with "id:" in front. */
function indexOf(...paths: string[]) {
  return buildIndex(paths.map((path): Indexed => ({ id: `id:${path}`, path })));
}

describe("wikiTargets: the forms of a reference", () => {
  it("reads a plain reference", () => {
    expect(wikiTargets("see [[A]] here", {})).toEqual(["A"]);
  });

  it("drops the shown text after a pipe", () => {
    expect(wikiTargets("[[A|b]]", {})).toEqual(["A"]);
  });

  it("drops a heading", () => {
    expect(wikiTargets("[[A#h]]", {})).toEqual(["A"]);
  });

  it("drops a block id", () => {
    expect(wikiTargets("[[A#^id]]", {})).toEqual(["A"]);
  });

  it("reads an embed", () => {
    expect(wikiTargets("![[A]]", {})).toEqual(["A"]);
  });

  it("trims white space around the target", () => {
    expect(wikiTargets("[[ A ]]", {})).toEqual(["A"]);
  });

  it("ends the target at an escaped pipe in a table row", () => {
    expect(wikiTargets("| one | [[A\\|b]] |\n| --- | --- |", {})).toEqual([
      "A",
    ]);
  });

  it("reads several references on one line, in order", () => {
    expect(wikiTargets("[[B]] then [[A]] then [[C|c]]", {})).toEqual([
      "B",
      "A",
      "C",
    ]);
  });
});

describe("wikiTargets: what is skipped", () => {
  it("skips a reference to a heading of the same note", () => {
    expect(wikiTargets("[[#h]]", {})).toEqual([]);
  });

  it("skips empty brackets", () => {
    expect(wikiTargets("[[]]", {})).toEqual([]);
  });

  it("skips a target that is only white space before the pipe", () => {
    expect(wikiTargets("[[ | x]]", {})).toEqual([]);
  });

  it("skips a target with a line break", () => {
    expect(wikiTargets("[[A\nB]]", {})).toEqual([]);
    expect(wikiTargets("[[A\r\nB]]", {})).toEqual([]);
    expect(wikiTargets("[[A\rB]]", {})).toEqual([]);
  });

  it("keeps a target that looks like a file: a note may be named so", () => {
    expect(wikiTargets("[[pic.png]]", {})).toEqual(["pic.png"]);
    expect(wikiTargets("![[doc.pdf]]", {})).toEqual(["doc.pdf"]);
    expect(wikiTargets("![[files/Doc.PDF#page=2]]", {})).toEqual([
      "files/Doc.PDF",
    ]);
    expect(
      wikiTargets("[[Node.js]] [[claude.ai]] [[Report 2026.Q4]]", {}),
    ).toEqual(["Node.js", "claude.ai", "Report 2026.Q4"]);
  });

  it("keeps a name with dots that is not an extension", () => {
    expect(wikiTargets("[[Meeting 2026.11.24]]", {})).toEqual([
      "Meeting 2026.11.24",
    ]);
  });

  it("keeps a path that ends in .md", () => {
    expect(wikiTargets("[[a/b.md]]", {})).toEqual(["a/b.md"]);
    expect(wikiTargets("[[a/B.MD]]", {})).toEqual(["a/B.MD"]);
  });

  it("keeps a target with a dotted folder", () => {
    expect(wikiTargets("[[v1.png/notes]]", {})).toEqual(["v1.png/notes"]);
  });
});

describe("looksLikeFile", () => {
  it("says yes to an image, a PDF and any other extension", () => {
    for (const target of [
      "pic.png",
      "doc.pdf",
      "files/Doc.PDF",
      "a/b/clip.mp4",
      "Node.js",
      "claude.ai",
      "Report 2026.Q4",
      "archive.tar.gz",
      "data.jsonl",
    ])
      expect(looksLikeFile(target), target).toBe(true);
  });

  it("says no to a note's name, with .md or without", () => {
    for (const target of ["A", "a/b", "a/b.md", "a/B.MD", "Plan v2", ""])
      expect(looksLikeFile(target), target).toBe(false);
  });

  it("says no to dots that end in no extension", () => {
    for (const target of [
      "Meeting 2026.11.24",
      "v1.2",
      "ends with a dot.",
      "a.toolong",
      "e.g. this",
      "a.b-c",
    ])
      expect(looksLikeFile(target), target).toBe(false);
  });

  it("looks at the last part only", () => {
    expect(looksLikeFile("v1.png/notes")).toBe(false);
    expect(looksLikeFile("notes/v1.png")).toBe(true);
  });

  it("never throws, whatever it is given", () => {
    for (const v of [null, undefined, 7, {}, ["a.png"]])
      expect(looksLikeFile(v as never)).toBe(false);
  });
});

describe("wikiTargets: code in the text", () => {
  it("skips a block fenced with backticks and reads on after it", () => {
    const body = "[[before]]\n```js\n[[inside]]\n```\n[[after]]\n";
    expect(wikiTargets(body, {})).toEqual(["before", "after"]);
  });

  it("skips a block fenced with tildes and reads on after it", () => {
    const body = "~~~\n[[inside]]\n~~~\n[[after]]\n";
    expect(wikiTargets(body, {})).toEqual(["after"]);
  });

  it("skips a fence indented by up to three spaces, not by four", () => {
    expect(wikiTargets("   ```\n[[inside]]\n   ```\n[[after]]", {})).toEqual([
      "after",
    ]);
    expect(wikiTargets("    ```\n[[kept]]\n", {})).toEqual(["kept"]);
  });

  it("skips an unclosed fence to the end", () => {
    expect(wikiTargets("[[before]]\n```\n[[inside]]\n[[more]]", {})).toEqual([
      "before",
    ]);
  });

  it("does not close a backtick fence with tildes", () => {
    expect(wikiTargets("```\n~~~\n[[inside]]\n```\n[[after]]", {})).toEqual([
      "after",
    ]);
  });

  it("skips inline code and reads the rest of the line", () => {
    expect(wikiTargets("write `[[inside]]` or [[after]]", {})).toEqual([
      "after",
    ]);
  });

  it("skips inline code fenced with two backticks", () => {
    expect(wikiTargets("``a ` [[inside]]`` and [[after]]", {})).toEqual([
      "after",
    ]);
  });

  it("reads past a lone backtick", () => {
    expect(wikiTargets("a ` lone tick and [[A]]", {})).toEqual(["A"]);
  });

  it("does not let inline code run over a line break", () => {
    expect(wikiTargets("one ` two\n[[A]] three ` four", {})).toEqual(["A"]);
  });
});

describe("wikiTargets: fields", () => {
  it("reads text values at any depth", () => {
    const frontmatter = { related: ["[[one]]", { deep: "see [[two|x]]" }] };
    expect(wikiTargets("", frontmatter)).toEqual(["one", "two"]);
  });

  it("reads the text first, then the fields", () => {
    expect(wikiTargets("[[body]]", { up: "[[field]]" })).toEqual([
      "body",
      "field",
    ]);
  });

  it("still reads a text value that holds a fenced block", () => {
    const frontmatter = { note: "```\n[[inside]]\n```\nand `[[ticked]]`" };
    expect(wikiTargets("", frontmatter)).toEqual(["inside", "ticked"]);
  });

  it("ignores numbers, null and dates without throwing", () => {
    const frontmatter = {
      n: 1.5,
      none: null,
      yes: true,
      when: new Date(0),
      list: [1, null, undefined, "[[kept]]"],
    };
    expect(wikiTargets("", frontmatter)).toEqual(["kept"]);
  });

  it("does not throw on fields nested 40 deep", () => {
    let deep: unknown = "[[bottom]]";
    for (let i = 0; i < 40; i++) deep = { inner: deep };
    expect(wikiTargets("", { deep, near: "[[near]]" })).toEqual(["near"]);
  });

  it("does not throw on fields that hold themselves", () => {
    const loop: Record<string, unknown> = { text: "[[A]]" };
    loop.self = loop;
    loop.list = [loop, loop];
    expect(wikiTargets("", loop)).toEqual(["A"]);
  });

  it("does not throw on a field that throws when read", () => {
    const trap = {
      get bad(): string {
        throw new Error("no");
      },
    };
    expect(wikiTargets("[[A]]", trap)).toEqual(["A"]);
  });

  it("ignores fields that are not a set of fields, a list or text", () => {
    expect(wikiTargets("", 42)).toEqual([]);
    expect(wikiTargets("", new Map([["a", "[[A]]"]]))).toEqual([]);
    expect(wikiTargets("", "[[alone]]")).toEqual(["alone"]);
  });
});

describe("wikiTargets: distinct targets and limits", () => {
  it("collapses the same target in another case or with .md to the first spelling", () => {
    expect(wikiTargets("[[Note]] [[note]] [[NOTE.md]] [[Note|x]]", {})).toEqual(
      ["Note"],
    );
    expect(wikiTargets("[[a/b.md]] [[A/B]]", { r: "[[a/B]]" })).toEqual([
      "a/b.md",
    ]);
  });

  it("takes at most 2,000 distinct targets", () => {
    const body = Array.from({ length: 2500 }, (_, i) => `[[n${i}]]`).join(" ");
    const found = wikiTargets(body, { more: "[[field]]" });
    expect(MAX_TARGETS).toBe(2000);
    expect(found).toHaveLength(2000);
    expect(found[0]).toBe("n0");
    expect(found[1999]).toBe("n1999");
  });

  it("gives nothing for a text that is not text", () => {
    expect(wikiTargets(undefined as never, null)).toEqual([]);
    expect(wikiTargets(42 as never, undefined)).toEqual([]);
  });

  it("stays quick on a long line of brackets and backticks", () => {
    const body =
      "[[".repeat(50_000) + "`".repeat(50_000) + " `` ` ".repeat(20_000);
    expect(wikiTargets(body, {})).toEqual([]);
  });
});

describe("resolveTarget: a bare name", () => {
  const index = indexOf("Home.md", "Decisions/Pricing.md", "People/Ana.md");

  it("finds a note by its file name", () => {
    expect(resolveTarget(index, "Home.md", "Pricing")).toBe(
      "id:Decisions/Pricing.md",
    );
  });

  it("ignores case", () => {
    expect(resolveTarget(index, "Home.md", "pRICING")).toBe(
      "id:Decisions/Pricing.md",
    );
  });

  it("takes a target that ends in .md", () => {
    expect(resolveTarget(index, "Home.md", "Pricing.md")).toBe(
      "id:Decisions/Pricing.md",
    );
    expect(resolveTarget(index, "Home.md", "ana.MD")).toBe("id:People/Ana.md");
  });

  it("gives null for a name no note has", () => {
    expect(resolveTarget(index, "Home.md", "Nobody")).toBeNull();
    expect(resolveTarget(index, "Home.md", "")).toBeNull();
    expect(resolveTarget(index, "Home.md", ".md")).toBeNull();
  });

  it("does not treat a backslash as a separator", () => {
    expect(resolveTarget(index, "Home.md", "Decisions\\Pricing")).toBeNull();
  });

  it("finds a name whose accented letters are written the other way", () => {
    // A file name from macOS can hold "c" + a combining caron where the text holds "č".
    const accented = indexOf("Ljudi/Milič.md");
    expect(resolveTarget(accented, "Home.md", "Milič")).toBe(
      "id:Ljudi/Milič.md",
    );
    expect(wikiTargets("[[Milič]] [[Milič]]", {})).toEqual(["Milič"]);
  });

  it("counts its notes", () => {
    expect(index.size).toBe(3);
    expect(buildIndex([]).size).toBe(0);
  });
});

describe("resolveTarget: more than one note with the name", () => {
  it("prefers the linking note's own folder to a shallower one", () => {
    const index = indexOf("Note.md", "a/b/Note.md", "a/b/From.md");
    expect(resolveTarget(index, "a/b/From.md", "Note")).toBe("id:a/b/Note.md");
  });

  it("prefers a shallower note to a deeper one", () => {
    const index = indexOf("a/b/Note.md", "zzzzzzzzzz/Note.md", "From.md");
    expect(resolveTarget(index, "x/From.md", "Note")).toBe(
      "id:zzzzzzzzzz/Note.md",
    );
  });

  it("prefers the shorter path at the same depth", () => {
    const index = indexOf("aaaa/Note.md", "zz/Note.md");
    expect(resolveTarget(index, "From.md", "Note")).toBe("id:zz/Note.md");
  });

  it("falls back to plain string order", () => {
    const index = indexOf("bb/Note.md", "ab/Note.md", "ba/Note.md");
    expect(resolveTarget(index, "From.md", "Note")).toBe("id:ab/Note.md");
  });

  it("gives the same answer whatever order the notes came in", () => {
    const index = indexOf("ba/Note.md", "ab/Note.md", "bb/Note.md");
    expect(resolveTarget(index, "From.md", "Note")).toBe("id:ab/Note.md");
  });

  it("lets the first path by string order win when two differ only by case", () => {
    const index = indexOf("a/note.md", "a/Note.md");
    expect(resolveTarget(index, "From.md", "/a/note")).toBe("id:a/Note.md");
    expect(resolveTarget(index, "From.md", "a/NOTE")).toBe("id:a/Note.md");
  });
});

describe("resolveTarget: a target with a folder", () => {
  it("prefers the exact path from the root to a note whose path ends with it", () => {
    const index = indexOf("b/Note.md", "a/b/Note.md", "a/b/From.md");
    expect(resolveTarget(index, "a/b/From.md", "b/Note")).toBe("id:b/Note.md");
  });

  it("finds a note whose path ends with the target", () => {
    const index = indexOf("x/a/b/Note.md", "Other.md");
    expect(resolveTarget(index, "Other.md", "b/Note")).toBe("id:x/a/b/Note.md");
    expect(resolveTarget(index, "Other.md", "A/B/note.md")).toBe(
      "id:x/a/b/Note.md",
    );
  });

  it("matches the end of a path at a folder boundary only", () => {
    const index = indexOf("ab/Note.md");
    expect(resolveTarget(index, "From.md", "b/Note")).toBeNull();
  });

  it("takes the closest of several notes whose path ends with the target", () => {
    const index = indexOf("x/y/b/Note.md", "z/b/Note.md", "q/b/From.md");
    expect(resolveTarget(index, "From.md", "b/Note")).toBe("id:z/b/Note.md");
    expect(resolveTarget(index, "x/y/b/From.md", "b/Note")).toBe(
      "id:x/y/b/Note.md",
    );
  });

  it("reads a leading slash as the path from the root", () => {
    const index = indexOf("b/Note.md", "a/b/Note.md", "Top.md");
    expect(resolveTarget(index, "a/From.md", "/b/Note")).toBe("id:b/Note.md");
    expect(resolveTarget(index, "a/From.md", "/Top.md")).toBe("id:Top.md");
  });

  it("does not look for the end of a path when the target begins with a slash", () => {
    const index = indexOf("a/b/Note.md");
    expect(resolveTarget(index, "From.md", "/b/Note")).toBeNull();
    expect(resolveTarget(index, "From.md", "/Note")).toBeNull();
  });
});

describe("resolveTarget: a relative target", () => {
  const index = indexOf(
    "x.md",
    "a/x.md",
    "a/b/x.md",
    "a/b/From.md",
    "a/c/y.md",
  );

  it("resolves ./ from the linking note's folder", () => {
    expect(resolveTarget(index, "a/b/From.md", "./x")).toBe("id:a/b/x.md");
  });

  it("resolves ../ from the linking note's folder", () => {
    expect(resolveTarget(index, "a/b/From.md", "../x")).toBe("id:a/x.md");
    expect(resolveTarget(index, "a/b/From.md", "../c/Y.md")).toBe(
      "id:a/c/y.md",
    );
    expect(resolveTarget(index, "a/b/From.md", "../../x")).toBe("id:x.md");
  });

  it("gives null when the target leaves the root", () => {
    expect(resolveTarget(index, "a/From.md", "../../x")).toBeNull();
    expect(resolveTarget(index, "From.md", "../x")).toBeNull();
  });

  it("must equal a path: it does not fall back to the file name", () => {
    expect(resolveTarget(index, "a/b/From.md", "./y")).toBeNull();
    expect(resolveTarget(index, "a/b/From.md", "../")).toBeNull();
  });
});

describe("resolveTarget: edges", () => {
  it("gives a note its own id when the target means the note itself", () => {
    const index = indexOf("a/Self.md", "Self.md");
    expect(resolveTarget(index, "a/Self.md", "Self")).toBe("id:a/Self.md");
  });

  it("does not throw on what is not an index or not text", () => {
    expect(resolveTarget({ size: 0 }, "a.md", "a")).toBeNull();
    expect(resolveTarget(null as never, "a.md", "a")).toBeNull();
    const index = indexOf("a.md");
    expect(resolveTarget(index, undefined as never, "a")).toBe("id:a.md");
    expect(resolveTarget(index, "a.md", undefined as never)).toBeNull();
    expect(buildIndex([null as never, { id: 1, path: 2 } as never]).size).toBe(
      0,
    );
    expect(buildIndex(undefined as never).size).toBe(0);
  });
});

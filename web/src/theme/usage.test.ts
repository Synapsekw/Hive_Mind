import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs in web/.
const SRC = resolve("src");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(ts|tsx|css)$/.test(entry.name) && !/\.test\./.test(entry.name)
      ? [path]
      : [];
  });
}

const name = (path: string) => relative(SRC, path).split(sep).join("/");
const all = files(SRC).map((path) => ({
  file: name(path),
  src: readFileSync(path, "utf8"),
}));
const outsideTheme = all.filter((f) => !f.file.startsWith("theme/"));

// The first look's tokens and font. None may come back.
const OLD = [
  "--panel",
  "--text",
  "--text-2",
  "--text-quiet",
  "--accent",
  "--fill-1",
  "--fill-2",
  "--soft",
  "--raised",
];

/** Custom properties a source declares: `--name:` in CSS, or a quoted "--name" in TypeScript. */
function declared(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/(--[a-z][a-z0-9-]*)\s*:/g)) out.add(m[1]!);
  for (const m of src.matchAll(/["'`](--[a-z][a-z0-9-]*)["'`]/g))
    out.add(m[1]!);
  return out;
}

describe("token usage under web/src", () => {
  it("names no token or font of the old look", () => {
    const hits: string[] = [];
    for (const { file, src } of all) {
      for (const old of OLD)
        if (new RegExp(`${old}(?![a-z0-9-])`).test(src))
          hits.push(`${file}: ${old}`);
      if (src.includes("GeistSans")) hits.push(`${file}: GeistSans`);
    }
    expect(hits).toEqual([]);
  });

  it("reads only custom properties that are defined", () => {
    const shared = new Set<string>();
    for (const { file, src } of all)
      if (
        file === "theme/themes.generated.css" ||
        file === "app/globals.css" ||
        file === "app/layout.tsx"
      )
        for (const d of declared(src)) shared.add(d);
    expect(shared.has("--fg")).toBe(true);

    const hits: string[] = [];
    for (const { file, src } of outsideTheme) {
      const own = declared(src);
      // A property set from a component (style={{ "--x": … }}) and read in its stylesheet.
      const sibling = new Set<string>();
      const folder = file.slice(0, file.lastIndexOf("/") + 1);
      for (const other of all)
        if (other.file.startsWith(folder) && /\.tsx?$/.test(other.file))
          for (const d of declared(other.src)) sibling.add(d);
      for (const m of src.matchAll(/var\(\s*(--[a-z][a-z0-9-]*)/g)) {
        const used = m[1]!;
        // `var(--hue-${n})`: a name finished at run time; --hue-1 to --hue-8 are generated.
        if (used === "--hue-" && shared.has("--hue-1")) continue;
        if (!shared.has(used) && !own.has(used) && !sibling.has(used))
          hits.push(`${file}: ${used}`);
      }
    }
    expect([...new Set(hits)]).toEqual([]);
  });

  it("uses no glass and no theme scope", () => {
    const hits: string[] = [];
    for (const { file, src } of all) {
      if (file === "theme/usage.test.ts") continue;
      for (const gone of [
        "backdrop-filter",
        "data-scope",
        "data-reach",
        "data-dots",
        "--wash",
        "--bloom",
        "--rings-hub",
        "--rings-glow",
      ])
        if (src.includes(gone)) hits.push(`${file}: ${gone}`);
    }
    expect(hits).toEqual([]);
  });
});

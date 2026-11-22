import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// A colour written as a literal: #rgb, #rgba, #rrggbb, #rrggbbaa, or a colour function.
const LITERAL =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?|oklch)\(/i;

/** Blanks out comments (keeping newlines so line numbers hold); strings are kept. */
function stripComments(src: string, css: boolean): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\" && next !== undefined) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (!css && ch === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") out.push(...files(path));
    } else if (
      /\.(ts|tsx|css)$/.test(entry.name) &&
      !/\.test\./.test(entry.name)
    ) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Colour literals in the `.ts`, `.tsx` and `.css` files under `dir` (resolved from the working
 * directory, which is `web/` under Vitest), skipping `*.test.*` files and comments. `file` is
 * relative to `dir`, with forward slashes; one entry per offending line.
 */
export function colourLiterals(
  dir: string,
): { file: string; line: number; text: string }[] {
  const root = resolve(dir);
  const found: { file: string; line: number; text: string }[] = [];
  for (const path of files(root).sort()) {
    const src = readFileSync(path, "utf8");
    const raw = src.split("\n");
    const clean = stripComments(src, path.endsWith(".css")).split("\n");
    clean.forEach((text, i) => {
      if (LITERAL.test(text))
        found.push({
          file: relative(root, path).split(sep).join("/"),
          line: i + 1,
          text: raw[i]!.trim(),
        });
    });
  }
  return found;
}

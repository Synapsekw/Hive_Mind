import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// A colour written as a literal: #rgb, #rgba, #rrggbb, #rrggbbaa, or a colour function.
const LITERAL =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?|oklch)\(/i;

/**
 * The text of each line that is code, or "" for a line that is entirely a comment: a line whose
 * first non-blank characters are `//` (not in CSS), or a line inside a `/* … *\/` block that
 * starts at the beginning of a line (after the block closes, the rest of that line is code).
 * Nothing else is treated as a comment: JSX text like "Don't" or "a // b" cannot be told from
 * code without parsing, so such lines are scanned whole. A false positive in a comment is
 * acceptable; a missed literal is not.
 */
function codeLines(src: string, css: boolean): string[] {
  let inBlock = false;
  return src.split("\n").map((line) => {
    let rest = line;
    if (!inBlock) {
      const t = rest.trimStart();
      if (!css && t.startsWith("//")) return "";
      if (!t.startsWith("/*")) return rest;
      inBlock = true;
      rest = t.slice(2);
    }
    const close = rest.indexOf("*/");
    if (close === -1) return "";
    inBlock = false;
    // Whatever follows the block's end on that line is scanned as code.
    return rest.slice(close + 2);
  });
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
 * directory, which is `web/` under Vitest), skipping `*.test.*` files and lines that are
 * entirely a comment (see `codeLines`). `file` is relative to `dir`, with forward slashes; one
 * entry per offending line.
 */
export function colourLiterals(
  dir: string,
): { file: string; line: number; text: string }[] {
  const root = resolve(dir);
  const found: { file: string; line: number; text: string }[] = [];
  for (const path of files(root).sort()) {
    const src = readFileSync(path, "utf8");
    const raw = src.split("\n");
    const clean = codeLines(src, path.endsWith(".css"));
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

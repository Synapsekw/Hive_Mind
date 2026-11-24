// One markdown file, read as a note: the TypeScript port of `parseNote` in
// `scripts/import-vault.mjs`. The two must answer the same for the same file; `parse.test.ts`
// runs both over one table of cases. Runs in the browser: no `node:` import.
import { parse as parseYaml } from "yaml";

export type Parsed = {
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  warning?: string;
};

const FRONTMATTER = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/;

/** The last part of a "/" separated path, as `basename` of `node:path` answers it. */
function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

export function parseNote(raw: string, relPath: string): Parsed {
  const text = raw
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replaceAll("\u0000", "");
  const fallbackTitle = basename(relPath).replace(/\.md$/i, "");
  const plain = (warning?: string): Parsed => ({
    title: fallbackTitle,
    frontmatter: {},
    body: text,
    ...(warning ? { warning } : {}),
  });

  const m = FRONTMATTER.exec(text);
  if (!m) return plain();

  let data: unknown;
  try {
    data = parseYaml(m[1] ?? "") ?? {};
  } catch (e) {
    const said = e instanceof Error ? e.message : String(e);
    return plain(
      `unreadable frontmatter, kept as text: ${said.split("\n")[0]}`,
    );
  }
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return plain("frontmatter is not a set of fields, kept as text");

  // Only what JSON can hold goes into the database.
  const frontmatter = JSON.parse(JSON.stringify(data)) as Record<
    string,
    unknown
  >;
  const title =
    typeof frontmatter.title === "string" && frontmatter.title.trim()
      ? frontmatter.title.trim()
      : fallbackTitle;
  return {
    title,
    frontmatter,
    body: text.slice(m[0].length).replace(/^\n+/, ""),
  };
}

// What the sync leaves out: any path part starting with "." (.obsidian, .git, .trash,
// .DS_Store), video files, and what `.hivesyncignore` at the vault's root names. The ignore
// file is a subset of gitignore: blank lines and `#` comments are skipped, `!` lines are
// ignored (nothing is re-included), a trailing `/` means a folder, a pattern holding a `/` is
// anchored at the root, `*` stays inside one part, `**` crosses parts, `?` is one character.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const VIDEO = new Set([
  "mp4",
  "mov",
  "m4v",
  "webm",
  "mkv",
  "avi",
  "wmv",
  "flv",
  "mpg",
  "mpeg",
  "3gp",
]);

export type Ignore = (path: string) => boolean;

type Rule = { re: RegExp; dirOnly: boolean; anchored: boolean };

function toRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      const atStart = i === 0 || glob[i - 1] === "/";
      if (atStart && glob[i + 2] === "/") {
        // "**/" at the start or after a "/": any number of leading folders, or none.
        re += "(?:.*/)?";
        i += 2;
      } else if (atStart && i + 2 === glob.length && i > 0) {
        // Trailing "/**": everything inside (the "/" is already in `re`).
        re += ".*";
        i++;
      } else {
        // Any other "**" acts like "*".
        re += "[^/]*";
        i++;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function parseIgnore(text: string): Ignore {
  const rules: Rule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes("/");
    line = line.replace(/^\/+/, "");
    if (line) rules.push({ re: toRegex(line), dirOnly, anchored });
  }
  return (path) => {
    const parts = path.split("/");
    for (const r of rules) {
      for (let i = 1; i <= parts.length; i++) {
        if (r.dirOnly && i === parts.length) continue;
        const candidate = r.anchored
          ? parts.slice(0, i).join("/")
          : parts[i - 1]!;
        if (r.re.test(candidate)) return true;
      }
    }
    return false;
  };
}

export function loadIgnore(root: string): Ignore {
  try {
    return parseIgnore(readFileSync(join(root, ".hivesyncignore"), "utf8"));
  } catch {
    return parseIgnore("");
  }
}

export function isSkipped(path: string, ignore: Ignore): boolean {
  const parts = path.split("/");
  if (parts.some((p) => p.startsWith("."))) return true;
  const name = parts[parts.length - 1]!;
  const dot = name.lastIndexOf(".");
  if (dot > 0 && VIDEO.has(name.slice(dot + 1).toLowerCase())) return true;
  return ignore(path);
}

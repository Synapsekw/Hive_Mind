// The `[[wiki links]]` of one note, and which note each one means. The rules are the spec's
// "What counts as a reference" and "Which note a target means"
// (`docs/superpowers/specs/2026-11-24-wiki-links-design.md`). Pure, and it never throws: the text
// and the fields were written by other people and other programs. Runs in the browser: no `node:`
// import.

export const MAX_TARGETS = 2000;

/** How deep the fields are walked. Deeper values are ignored. */
const MAX_DEPTH = 32;

const REFERENCE = /\[\[([^\[\]\n\r]+)\]\]/g;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** What follows the last dot of a file name, when it is an extension. */
const EXTENSION = /^[a-z0-9]{1,5}$/i;

/** One form for comparing: lower case, one way of writing an accented letter, no trailing `.md`. */
function fold(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\.md$/, "");
}

/** The target of one reference, given the text between the brackets; null when it is skipped. */
function targetOf(inner: string): string | null {
  const cut = inner.search(/[|#]/);
  let target = cut === -1 ? inner : inner.slice(0, cut);
  // Inside a table Obsidian writes the pipe as `\|`.
  if (cut !== -1 && inner[cut] === "|" && target.endsWith("\\"))
    target = target.slice(0, -1);
  target = target.trim();
  if (!target) return null;

  // An image, a PDF: the last part has an extension that is not `.md`. "Meeting 2026.11.24" has
  // a dot and no extension, so an extension is 1 to 5 letters or digits with a letter among them.
  const name = target.slice(target.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot !== -1) {
    const ext = name.slice(dot + 1);
    if (EXTENSION.test(ext) && /[a-z]/i.test(ext) && ext.toLowerCase() !== "md")
      return null;
  }
  return target;
}

/** One line with its inline code (`…`, ``…``) blanked out. A run of backticks that nothing on
 * the line closes is ordinary text. */
function withoutInlineCode(line: string): string {
  if (!line.includes("`")) return line;
  const runs: { at: number; length: number }[] = [];
  for (let i = 0; i < line.length;) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    let end = i;
    while (line[end] === "`") end++;
    runs.push({ at: i, length: end - i });
    i = end;
  }

  let out = "";
  let from = 0;
  // Lengths no later run closes: nothing further along the line will close them either.
  const unclosed = new Set<number>();
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i];
    if (unclosed.has(open.length)) continue;
    let close = i + 1;
    while (close < runs.length && runs[close].length !== open.length) close++;
    if (close === runs.length) {
      unclosed.add(open.length);
      continue;
    }
    out += line.slice(from, open.at) + " ";
    from = runs[close].at + runs[close].length;
    i = close;
  }
  return out + line.slice(from);
}

/** The lines of a note's text that are not in a fenced code block, without their inline code. */
function* proseLines(body: string): Generator<string> {
  let fence: string | null = null;
  for (const line of body.split(/\r\n?|\n/)) {
    const m =
      line.includes("```") || line.includes("~~~") ? FENCE.exec(line) : null;
    if (fence !== null) {
      if (m && m[1][0] === fence) fence = null;
      continue;
    }
    // "```js" opens a block; "```code```" on one line is inline code.
    if (m && !(m[1][0] === "`" && line.slice(m[0].length).includes("`"))) {
      fence = m[1][0];
      continue;
    }
    yield withoutInlineCode(line);
  }
}

/** Every text value in the fields, to MAX_DEPTH. Only plain sets of fields and lists are
 * entered; a value already seen is not entered twice. */
function* textsIn(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): Generator<string> {
  if (typeof value === "string") {
    yield value;
    return;
  }
  if (typeof value !== "object" || value === null || depth >= MAX_DEPTH) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) yield* textsIn(item, depth + 1, seen);
    return;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return;
  for (const key of Object.keys(value))
    yield* textsIn((value as Record<string, unknown>)[key], depth + 1, seen);
}

/** Distinct targets in first-seen order, at most MAX_TARGETS. Never throws, whatever it is given. */
export function wikiTargets(body: string, frontmatter: unknown): string[] {
  const found: string[] = [];
  const have = new Set<string>();
  /** Takes the references of one text; false once the note has its full count. */
  const take = (text: string): boolean => {
    for (const m of text.matchAll(REFERENCE)) {
      const target = targetOf(m[1]);
      if (target === null) continue;
      const key = fold(target);
      if (have.has(key)) continue;
      have.add(key);
      found.push(target);
      if (found.length >= MAX_TARGETS) return false;
    }
    return true;
  };

  try {
    if (typeof body === "string")
      for (const line of proseLines(body)) if (!take(line)) return found;
    // Fields are not markdown, so nothing is skipped there.
    for (const text of textsIn(frontmatter, 0, new WeakSet()))
      if (!take(text)) return found;
  } catch {
    // A field that throws when it is read: keep what was found before it.
  }
  return found;
}

export type Indexed = { id: string; path: string };

/** The notes of one workspace, ready for `resolveTarget`. Opaque apart from its size. */
export type Index = { readonly size: number };

type Entry = {
  id: string;
  /** The path as the note has it; ties are broken on it. */
  path: string;
  /** The folded path. */
  key: string;
  /** The folded folder, "" at the root. */
  folder: string;
  depth: number;
};

type Built = Index & {
  byPath: Map<string, Entry>;
  byName: Map<string, Entry[]>;
};

/** A path folded for comparing, without the slashes in front of it. */
function pathKey(path: string): string {
  return fold(path.replace(/^\/+/, ""));
}

function folderOf(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash === -1 ? "" : key.slice(0, slash);
}

export function buildIndex(notes: readonly Indexed[]): Index {
  const byPath = new Map<string, Entry>();
  const byName = new Map<string, Entry[]>();
  let size = 0;
  for (const note of Array.isArray(notes)
    ? (notes as readonly Indexed[])
    : []) {
    if (
      typeof note !== "object" ||
      note === null ||
      typeof note.id !== "string" ||
      typeof note.path !== "string"
    )
      continue;
    const key = pathKey(note.path);
    const entry: Entry = {
      id: note.id,
      path: note.path,
      key,
      folder: folderOf(key),
      depth: key.split("/").length - 1,
    };
    size++;
    // Two paths that differ only by case: the first by plain string order has the full path.
    const there = byPath.get(key);
    if (!there || entry.path < there.path) byPath.set(key, entry);
    const name = key.slice(key.lastIndexOf("/") + 1);
    const named = byName.get(name);
    if (named) named.push(entry);
    else byName.set(name, [entry]);
  }
  const built: Built = { size, byPath, byName };
  return built;
}

/** The closest of the candidates to a note in `folder`: in that folder; then fewest folders
 * deep; then shortest path; then first by plain string order. */
function closest(candidates: Entry[], folder: string): Entry | null {
  let best: Entry | null = null;
  for (const c of candidates) {
    if (best === null || isCloser(c, best, folder)) best = c;
  }
  return best;
}

function isCloser(a: Entry, b: Entry, folder: string): boolean {
  const aHere = a.folder === folder;
  const bHere = b.folder === folder;
  if (aHere !== bHere) return aHere;
  if (a.depth !== b.depth) return a.depth < b.depth;
  if (a.path.length !== b.path.length) return a.path.length < b.path.length;
  return a.path < b.path;
}

/** The id of the note `target` means for a note at `fromPath`, or null. */
export function resolveTarget(
  index: Index,
  fromPath: string,
  target: string,
): string | null {
  const built = index as Built | null;
  if (
    !built ||
    !(built.byPath instanceof Map) ||
    !(built.byName instanceof Map) ||
    typeof target !== "string"
  )
    return null;

  const t = fold(target.trim());
  if (!t) return null;
  const folder = folderOf(
    pathKey(typeof fromPath === "string" ? fromPath : ""),
  );

  // From the linking note's folder; the result must be a note's path.
  if (t.startsWith("./") || t.startsWith("../")) {
    const parts = folder ? folder.split("/") : [];
    for (const part of t.split("/")) {
      if (part === "" || part === ".") continue;
      if (part !== "..") parts.push(part);
      else if (parts.pop() === undefined) return null;
    }
    return built.byPath.get(parts.join("/"))?.id ?? null;
  }

  // From the root.
  if (t.startsWith("/"))
    return built.byPath.get(t.replace(/^\/+/, ""))?.id ?? null;

  // With a folder: the path itself, failing that the paths that end with it.
  if (t.includes("/")) {
    const exact = built.byPath.get(t);
    if (exact) return exact.id;
    const named = built.byName.get(t.slice(t.lastIndexOf("/") + 1)) ?? [];
    const end = "/" + t;
    return (
      closest(
        named.filter((e) => e.key.endsWith(end)),
        folder,
      )?.id ?? null
    );
  }

  // A bare name.
  return closest(built.byName.get(t) ?? [], folder)?.id ?? null;
}

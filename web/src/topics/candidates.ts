// What a note proposes as a topic, and the candidate list of many notes. Pure: it reads a
// note's path, title and three of its fields, never its text.
import { normal } from "./normal";
import {
  KINDS,
  MAX_ALIASES,
  MAX_HEAD_TAGS,
  MAX_NAME,
  type Candidate,
  type Kind,
  type NoteHead,
  type Proposal,
} from "./types";

/** A tag must be on this many notes to be proposed as a subject. */
export const TAG_NOTES = 5;
/** A name shorter than this, once normalised, is no topic and matches nothing. */
export const MIN_NAME = 3;

const TYPE_KIND: Record<string, Kind> = {
  client: "client",
  "client-entity": "client",
  "partner-entity": "client",
  project: "project",
  "internal-project": "project",
  person: "person",
  product: "product",
  vendor: "vendor",
  concept: "subject",
  "cluster-topic": "subject",
  category: "subject",
};
const INDEX = /^(_index|index|readme)$/i;
const FOLDER_INDEX = /^_index$/i;
const CLIENT_FOLDERS = new Set(["employers", "clients", "customers"]);

function texts(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter((x) => x.length >= 1 && x.length <= MAX_NAME)
    .slice(0, max);
}

/** Obsidian lets `tags` be one string: split it on commas and white space. */
function tagList(v: unknown): unknown {
  return typeof v === "string" ? v.split(/[\s,]+/) : v;
}

/** What the rules read of a note. */
export function headOf(
  path: string,
  title: string,
  frontmatter: unknown,
): NoteHead {
  const f =
    typeof frontmatter === "object" &&
    frontmatter !== null &&
    !Array.isArray(frontmatter)
      ? (frontmatter as Record<string, unknown>)
      : {};
  return {
    path,
    title,
    type: typeof f.type === "string" ? f.type : null,
    aliases: texts(f.aliases, MAX_ALIASES),
    tags: texts(tagList(f.tags), MAX_HEAD_TAGS),
  };
}

const inTemplates = (parts: string[]) =>
  parts.some((p) => normal(p) === "templates");

/** The topic this note says it is, or null. */
export function proposalOf(h: NoteHead): Proposal | null {
  const parts = h.path.split("/");
  if (inTemplates(parts)) return null;
  const file = parts[parts.length - 1]!.replace(/\.md$/i, "");
  const folder = parts.length >= 2 ? parts[parts.length - 2]! : null;
  const type = h.type === null ? "" : h.type.trim().toLowerCase();
  const typed = Object.hasOwn(TYPE_KIND, type) ? TYPE_KIND[type]! : null;

  let kind: Kind;
  let name: string;
  if (typed !== null) {
    kind = typed;
    if (INDEX.test(file)) {
      if (folder === null) return null;
      name = folder;
    } else name = file;
  } else if (FOLDER_INDEX.test(file) && folder !== null) {
    const above = parts.length >= 3 ? normal(parts[parts.length - 3]!) : "";
    kind = CLIENT_FOLDERS.has(above) ? "client" : "subject";
    name = folder;
  } else return null;

  name = name.trim();
  const key = normal(name);
  if (name.length > MAX_NAME || key.length < MIN_NAME) return null;

  // A file name is no other name for a topic, and neither is "index" or "readme".
  const seen = new Set([key, normal(file), "index", "readme"]);
  const aliases: string[] = [];
  for (const a of [h.title.trim(), ...h.aliases]) {
    const k = normal(a);
    if (a.length > MAX_NAME || k.length < MIN_NAME || seen.has(k)) continue;
    seen.add(k);
    aliases.push(a);
    if (aliases.length >= MAX_ALIASES) break;
  }
  return { kind, name, aliases };
}

/** Every topic the notes propose, merged, with the tags used on five or more notes. */
export function candidates(heads: NoteHead[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  const tags = new Map<string, { text: string; notes: number }>();
  for (const h of heads) {
    const p = proposalOf(h);
    if (p) {
      const key = `${p.kind}|${normal(p.name)}`;
      const old = byKey.get(key);
      if (!old) byKey.set(key, { ...p, aliases: [...p.aliases], notes: 1 });
      else {
        old.notes += 1;
        const seen = new Set([normal(old.name), ...old.aliases.map(normal)]);
        for (const a of p.aliases) {
          if (old.aliases.length >= MAX_ALIASES || seen.has(normal(a)))
            continue;
          seen.add(normal(a));
          old.aliases.push(a);
        }
      }
    }
    if (inTemplates(h.path.split("/"))) continue;
    const own = new Map<string, string>();
    for (const t of h.tags) {
      const text = t.replace(/^#+/, "").trim();
      const k = normal(text);
      if (k.length >= MIN_NAME && !own.has(k)) own.set(k, text);
    }
    for (const [k, text] of own) {
      const old = tags.get(k);
      if (old) old.notes += 1;
      else tags.set(k, { text, notes: 1 });
    }
  }

  const known = new Set<string>();
  for (const c of byKey.values()) {
    known.add(normal(c.name));
    for (const a of c.aliases) known.add(normal(a));
  }
  for (const [k, t] of tags) {
    if (t.notes < TAG_NOTES || known.has(k)) continue;
    byKey.set(`subject|${k}`, {
      kind: "subject",
      name: t.text,
      aliases: [],
      notes: t.notes,
    });
  }

  return [...byKey.values()].sort(
    (a, b) =>
      KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

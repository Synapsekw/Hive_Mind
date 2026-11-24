// Which topics a note is attached to. Pure. A note's text is compared with topic names and
// nothing else is done with it.
import { headOf, MIN_NAME, proposalOf } from "./candidates";
import { normal } from "./normal";
import {
  KINDS,
  MAX_TOPICS_PER_NOTE,
  type Hit,
  type Kind,
  type Topic,
} from "./types";

/** A name must be this long, once normalised, to be looked for in a note's text. */
const MIN_IN_TEXT = 4;

/** A topic ready for comparing: its own name's key, and the keys of its name and aliases. */
export type Ready = {
  id: string;
  kind: Kind;
  name: string;
  own: string;
  keys: string[];
};

export function prepare(topics: Topic[]): Ready[] {
  return topics.map((t) => {
    const own = normal(t.name);
    const keys = [...new Set([own, ...t.aliases.map(normal)])].filter(
      (k) => k.length >= MIN_NAME,
    );
    return { id: t.id, kind: t.kind, name: t.name, own, keys };
  });
}

/** A note's text without its fenced code blocks and inline code. */
export function prose(body: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length)
        fence = null;
      continue;
    }
    if (m) {
      fence = m[1]!;
      continue;
    }
    out.push(line.replace(/`[^`\n]*`/g, " "));
  }
  return out.join("\n");
}

/** Up to five topics for one note, strongest first. */
export function topicsFor(
  note: { path: string; title: string; body: string; frontmatter: unknown },
  ready: Ready[],
): Hit[] {
  const head = headOf(note.path, note.title, note.frontmatter);
  const own = proposalOf(head);
  const ownKey = own ? `${own.kind}|${normal(own.name)}` : null;
  const folders = new Set(note.path.split("/").slice(0, -1).map(normal));
  const tags = new Set(head.tags.map(normal));
  const title = ` ${normal(note.title)} `;
  const text = ` ${normal(prose(note.body))} `;

  const found: { t: Ready; confidence: number }[] = [];
  for (const t of ready) {
    if (t.keys.length === 0) continue;
    let confidence = 0;
    if (ownKey === `${t.kind}|${t.own}`) confidence = 1;
    else if (t.keys.some((k) => folders.has(k) || tags.has(k)))
      confidence = 0.9;
    else if (t.keys.some((k) => title.includes(` ${k} `))) confidence = 0.7;
    else if (
      t.keys.some((k) => k.length >= MIN_IN_TEXT && text.includes(` ${k} `))
    )
      confidence = 0.5;
    if (confidence > 0) found.push({ t, confidence });
  }
  found.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      KINDS.indexOf(a.t.kind) - KINDS.indexOf(b.t.kind) ||
      (a.t.name < b.t.name ? -1 : a.t.name > b.t.name ? 1 : 0),
  );
  return found
    .slice(0, MAX_TOPICS_PER_NOTE)
    .map(({ t, confidence }) => ({ id: t.id, confidence }));
}

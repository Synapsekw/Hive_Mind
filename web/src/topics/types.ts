// Shapes shared by everything about topics. Types and constants only: safe to import anywhere.
export const KINDS = [
  "client",
  "partner",
  "project",
  "vendor",
  "product",
  "solution",
  "person",
  "subject",
] as const;
export type Kind = (typeof KINDS)[number];

export const MAX_NAME = 80;
export const MAX_ALIASES = 20;
export const MAX_HEAD_TAGS = 50;
export const MAX_TOPICS_PER_NOTE = 5;
/** The most candidates one save request carries. */
export const SAVE_CHUNK = 200;

/** A topic of the hive, as the database holds it. */
export type Topic = { id: string; kind: Kind; name: string; aliases: string[] };
/** What the rules read of a note to find topics: never its text. */
export type NoteHead = {
  path: string;
  title: string;
  type: string | null;
  aliases: string[];
  tags: string[];
};
export type Proposal = { kind: Kind; name: string; aliases: string[] };
/** A proposed topic and how many notes proposed it. */
export type Candidate = Proposal & { notes: number };
export type Hit = { id: string; confidence: number };

/**
 * One attach step. `attached`, `already` and `none` count NOTES and add up to `scanned`: a note
 * that gained a topic in this step, one that already had one, one left with none. `failed`
 * counts pairs that could not be saved. `topics`: the hive's topics.
 */
export type AttachResult =
  | {
      ok: true;
      next: string | null;
      total: number;
      scanned: number;
      attached: number;
      already: number;
      none: number;
      failed: number;
      topics: number;
    }
  | { ok: false };

/** One scan step over a workspace of the owner's. */
export type ScanResult =
  { ok: true; heads: NoteHead[]; next: string | null } | { ok: false };
export type TopicsSaved = { ok: true; saved: number } | { ok: false };
/** A topic as Settings lists it; `notes` is null when the count could not be read. */
export type TopicRow = {
  id: string;
  kind: Kind;
  name: string;
  notes: number | null;
};

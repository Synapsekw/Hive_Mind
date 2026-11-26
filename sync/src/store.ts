// What a run asks of the hive. The shapes are the JSON of the database's sync_* functions
// (supabase/migrations/*_vault_sync.sql); rest-store.ts speaks them over the REST API, the
// tests' stand-in keeps them in memory.
export type ManifestEntry = {
  path: string;
  sha256: string;
  size: number;
  home?: string;
};
export type Moved = { from: string; to: string };
export type PlanResult = {
  new: string[];
  changed: string[];
  moved: Moved[];
  gone: string[];
  rehome: { path: string; home: string }[];
  kept: number;
};
export type NoteUp = {
  path: string;
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
  sha256: string;
  from?: string;
  created_at?: string;
  updated_at?: string;
};
export type FileUp = {
  path: string;
  name: string;
  size: number;
  sha256: string;
  mime: string;
  home: string;
  storage_path?: string;
  from?: string;
};
export type PutResult = {
  written: { path: string; id: string }[];
  failed: { path: string; code: string }[];
};
export type Counts = {
  added: number;
  changed: number;
  moved: number;
  deleted: number;
  skipped: number;
  too_big: number;
};

export interface Store {
  openRun(confirm: boolean): Promise<{ runId: string; storagePrefix: string }>;
  /** One page of the manifest; the last page answers the plan, the others null. */
  plan(
    runId: string,
    page: ManifestEntry[],
    last: boolean,
  ): Promise<PlanResult | null>;
  putNotes(runId: string, notes: NoteUp[]): Promise<PutResult>;
  linkNotes(runId: string, pairs: Moved[]): Promise<number>;
  /** Stores an object; one that is already there counts as stored. */
  upload(
    storagePath: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void>;
  putFiles(runId: string, files: FileUp[]): Promise<PutResult>;
  deletePaths(
    runId: string,
    paths: string[],
  ): Promise<{ deleted: number; refused: number }>;
  finish(
    runId: string,
    counts: Counts,
    tooBig: string[],
    error: string | null,
  ): Promise<void>;
}

/** The key was refused or revoked: stop, and say so once. */
export class KeyRefused extends Error {}
/** The hive could not be reached or answered an error: the next run tries again. */
export class Unreachable extends Error {}
/** The vault folder is missing or unreadable: nothing is compared. */
export class FolderMissing extends Error {}

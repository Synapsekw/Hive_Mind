// The gallery's filter model. Pure: chips, scope, folder and view are client state backed by the
// URL, and over the loaded files they make no request. `needsServer` says when the loaded set
// cannot answer (more exist and a server-side filter is on).
import { PDF_VIEW_MAX } from "./kind";
import type {
  DatePreset,
  Filters,
  GalleryFile,
  GalleryFolder,
  GallerySession,
  Kind,
  Scope,
  ServerFilter,
  View,
} from "./types";

const KINDS: Kind[] = [
  "image",
  "pdf",
  "slides",
  "sheet",
  "doc",
  "text",
  "csv",
  "other",
];
const VIEWS: View[] = ["session", "grid"];
const SCOPES: Scope[] = ["all", "mine", "shared"];
const DATES: DatePreset[] = ["any", "today", "week", "month", "range"];
const DAY = 86_400_000;
// Ids are uuids in the database; the filter model only needs a safe token (tests use short ids).
const ID = /^[0-9A-Za-z_-]{1,64}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_FILTERS: Filters = {
  view: "session",
  scope: "all",
  folder: null,
  kinds: [],
  date: "any",
  from: null,
  to: null,
  session: null,
  agent: null,
  owner: null,
  q: "",
};

const pick = <T extends string>(
  v: string | null,
  all: readonly T[],
  d: T,
): T => (v !== null && (all as readonly string[]).includes(v) ? (v as T) : d);
const id = (v: string | null) => (v && ID.test(v) ? v : null);

/** A real calendar day as YYYY-MM-DD (rejects 2026-13-45 and 2026-02-31). */
function realDay(v: string): boolean {
  if (!YMD.test(v) || !Number.isFinite(Date.parse(v))) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

export function fromQuery(p: URLSearchParams): Filters {
  const kinds = (p.get("kinds") ?? "")
    .split(",")
    .filter((k): k is Kind => (KINDS as string[]).includes(k));
  let date = pick(p.get("date"), DATES, "any");
  const from = p.get("from"),
    to = p.get("to");
  const range =
    date === "range" &&
    from &&
    to &&
    realDay(from) &&
    realDay(to) &&
    from <= to;
  if (date === "range" && !range) date = "any";
  return {
    view: pick(p.get("view"), VIEWS, "session"),
    scope: pick(p.get("scope"), SCOPES, "all"),
    folder: id(p.get("folder")),
    kinds,
    date,
    from: range ? from : null,
    to: range ? to : null,
    session: id(p.get("session")),
    agent: (p.get("agent") ?? "").slice(0, 80) || null,
    owner: id(p.get("owner")),
    q: (p.get("q") ?? "").slice(0, 200),
  };
}

export function toQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.view !== "session") p.set("view", f.view);
  if (f.scope !== "all") p.set("scope", f.scope);
  if (f.folder) p.set("folder", f.folder);
  if (f.kinds.length) p.set("kinds", f.kinds.join(","));
  if (f.date !== "any") p.set("date", f.date);
  if (f.date === "range" && f.from && f.to) {
    p.set("from", f.from);
    p.set("to", f.to);
  }
  if (f.session) p.set("session", f.session);
  if (f.agent) p.set("agent", f.agent);
  if (f.owner) p.set("owner", f.owner);
  if (f.q) p.set("q", f.q);
  return p.toString();
}

const startOfDay = (t: number) => Math.floor(t / DAY) * DAY;

export function dateBounds(
  f: Filters,
  now: number,
): { from: number; to: number } | null {
  const end = startOfDay(now) + DAY;
  switch (f.date) {
    case "today":
      return { from: end - DAY, to: end };
    case "week":
      return { from: end - 7 * DAY, to: end };
    case "month":
      return { from: end - 30 * DAY, to: end };
    case "range":
      return f.from && f.to
        ? {
            from: Date.parse(`${f.from}T00:00:00Z`),
            to: Date.parse(`${f.to}T00:00:00Z`) + DAY,
          }
        : null;
    default:
      return null;
  }
}

export function applyFilters(
  files: GalleryFile[],
  f: Filters,
  sessions: Map<string, GallerySession>,
  folderFiles: (folderId: string) => Set<string>,
  now: number,
): GalleryFile[] {
  const needle = f.q.trim().toLowerCase();
  const bounds = dateBounds(f, now);
  const inFolder = f.folder ? folderFiles(f.folder) : null;
  return files.filter((x) => {
    if (f.scope === "mine" && !x.mine) return false;
    if (f.scope === "shared" && x.mine) return false;
    if (inFolder && !inFolder.has(x.id)) return false;
    if (f.kinds.length && !f.kinds.includes(x.kind)) return false;
    if (bounds) {
      const t = Date.parse(x.created_at);
      if (!(t >= bounds.from && t < bounds.to)) return false;
    }
    if (f.session && x.session_id !== f.session) return false;
    if (
      f.agent &&
      (x.session_id ? sessions.get(x.session_id)?.agent : undefined) !== f.agent
    )
      return false;
    if (f.owner && x.owner_id !== f.owner) return false;
    if (needle && !x.name.toLowerCase().includes(needle)) return false;
    return true;
  });
}

const rank = (g: { session: GallerySession | "vault" | null }) =>
  g.session === null ? 2 : g.session === "vault" ? 1 : 0;
const started = (g: { session: GallerySession | "vault" | null }) =>
  typeof g.session === "object" && g.session ? g.session.started_at : "";

export type SessionGroup = {
  session: GallerySession | "vault" | null;
  files: GalleryFile[];
};

/** Newest session first; then files a vault sync keeps and no session saved; then the rest. */
export function groupBySession(
  files: GalleryFile[],
  sessions: Map<string, GallerySession>,
): SessionGroup[] {
  const groups = new Map<string | null, GalleryFile[]>();
  for (const x of files) {
    const key =
      x.session_id && sessions.has(x.session_id)
        ? x.session_id
        : x.mine && x.fromVault
          ? "vault"
          : null;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(x);
  }
  return [...groups.entries()]
    .map(([key, list]): SessionGroup => ({
      session: key === "vault" ? "vault" : key ? sessions.get(key)! : null,
      files: list,
    }))
    .sort((a, b) => rank(a) - rank(b) || started(b).localeCompare(started(a)));
}

export function needsServer(f: Filters, complete: boolean): boolean {
  if (complete) return false;
  return (
    f.kinds.length > 0 ||
    f.date !== "any" ||
    !!f.session ||
    !!f.agent ||
    !!f.owner ||
    !!f.folder
  );
}

/** Every filter `needsServer` counts, as the server applies it (scope and name stay here). */
export function toServerFilter(f: Filters, now: number): ServerFilter {
  const b = dateBounds(f, now);
  return {
    kinds: f.kinds,
    session: f.session,
    owner: f.owner,
    agent: f.agent,
    folder: f.folder,
    from: b ? new Date(b.from).toISOString() : null,
    to: b ? new Date(b.to).toISOString() : null,
  };
}

export function folderTree(folders: GalleryFolder[]) {
  const byName = (a: GalleryFolder, b: GalleryFolder) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  return folders
    .filter((x) => x.parent_id === null)
    .sort(byName)
    .map((folder) => ({
      folder,
      children: folders.filter((c) => c.parent_id === folder.id).sort(byName),
    }));
}

export function scopeCounts(files: GalleryFile[]): Record<Scope, number> {
  const mine = files.filter((x) => x.mine).length;
  return { all: files.length, mine, shared: files.length - mine };
}

export function viewable(f: GalleryFile): boolean {
  return (
    f.kind === "image" ||
    f.kind === "text" ||
    f.kind === "csv" ||
    (f.kind === "pdf" && f.size <= PDF_VIEW_MAX)
  );
}

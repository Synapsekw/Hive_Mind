"use client";

// The vault over the fixture with stand-in actions: each records its call on
// `window.__vaultCalls` (for the browser tests) and answers as the database would. A deleted
// note or an ended link leaves this page's sample data until the page is loaded again; a
// colleague's note that was read only through that link goes with it. With `fail`, every write
// is refused and the folder count is unavailable; with `slow`, deleting and unlinking take over
// a second.
// The import's stand-ins keep what was imported in memory, per workspace, so a second import
// answers "unchanged". `failbatch` refuses a batch by its number ("2"), or every batch ("all");
// `taken` and `limit` refuse a new workspace with that reason; with `slow` a batch takes most
// of a second.
import { useMemo, useRef, useState } from "react";
import { fixturePreview } from "../../../vault/fixture";
import type {
  BatchResult,
  ImportActions,
  Outcome,
} from "../../../import/types";
import type { VaultActions, VaultData } from "../../../vault/types";
import { Vault } from "../../../vault/Vault";

declare global {
  interface Window {
    __vaultCalls?: { name: string; args: unknown[] }[];
  }
}

/** How long `deleteNote` and `unlink` take with `slow`: long enough to press something meanwhile. */
const SLOW_WAIT = 1200;

/** How long an import batch takes with `slow`. */
const SLOW_BATCH = 900;

export type ImportFlags = {
  failbatch: string | null;
  taken: boolean;
  limit: boolean;
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function record(name: string, args: unknown[]) {
  (window.__vaultCalls ??= []).push({ name, args });
}

export function DevVault({
  data: sample,
  now,
  fail,
  slow,
  importFlags,
}: {
  data: VaultData;
  now: number;
  fail: boolean;
  slow: boolean;
  importFlags: ImportFlags;
}) {
  // Workspaces made by an import here, and what each workspace was sent, by path.
  const [madeWorkspaces, setMadeWorkspaces] = useState<
    readonly { id: string; name: string }[]
  >([]);
  const imported = useRef(new Map<string, string>());
  const batchNo = useRef(0);
  const [deleted, setDeleted] = useState<readonly string[]>([]);
  const [unlinked, setUnlinked] = useState<readonly string[]>([]);
  // The sample data without the notes deleted and the links ended here; asking for a deleted
  // note finds nothing, and neither does a colleague's note whose only link was ended.
  const data = useMemo<VaultData>(() => {
    if (
      deleted.length === 0 &&
      unlinked.length === 0 &&
      madeWorkspaces.length === 0
    )
      return sample;
    let open = sample.open;
    let closed: string | null = null;
    if (open && "note" in open) {
      const links = open.links.filter((l) => !unlinked.includes(l.id));
      if (deleted.includes(open.note.id)) open = { missing: true };
      else if (open.note.access === "link" && links.length === 0) {
        closed = open.note.id;
        open = { missing: true };
      } else open = { ...open, links };
    }
    return {
      ...sample,
      workspaces: [...sample.workspaces, ...madeWorkspaces],
      notes: sample.notes.filter(
        (n) => !deleted.includes(n.id) && n.id !== closed,
      ),
      open,
    };
  }, [sample, deleted, unlinked, madeWorkspaces]);
  const answer = async () =>
    fail ? { ok: false as const } : { ok: true as const };
  const actions: VaultActions = {
    saveNote: (noteId, choice) => {
      record("saveNote", [noteId, choice]);
      return answer();
    },
    saveFolder: (workspaceId, path, choice) => {
      record("saveFolder", [workspaceId, path, choice]);
      return answer();
    },
    release: (noteId) => {
      record("release", [noteId]);
      return answer();
    },
    deleteNote: async (noteId) => {
      record("deleteNote", [noteId]);
      if (slow) await wait(SLOW_WAIT);
      if (!fail) setDeleted((ids) => [...ids, noteId]);
      return answer();
    },
    unlink: async (linkId) => {
      record("unlink", [linkId]);
      if (slow) await wait(SLOW_WAIT);
      if (!fail) setUnlinked((ids) => [...ids, linkId]);
      return answer();
    },
    preview: async (workspaceId, path) => {
      record("preview", [workspaceId, path]);
      return fail ? null : fixturePreview(data, path);
    },
  };
  const importer: ImportActions = {
    createWorkspace: async (name) => {
      record("createWorkspace", [name]);
      if (importFlags.taken) return { ok: false, reason: "taken" };
      if (importFlags.limit) return { ok: false, reason: "limit" };
      if (fail) return { ok: false, reason: "failed" };
      const id = `imported-${madeWorkspaces.length + 1}`;
      setMadeWorkspaces((list) => [...list, { id, name }]);
      return { ok: true, id };
    },
    importBatch: async (workspaceId, notes): Promise<BatchResult> => {
      record("importBatch", [workspaceId, notes]);
      batchNo.current += 1;
      const no = batchNo.current;
      if (slow) await wait(SLOW_BATCH);
      if (
        importFlags.failbatch === "all" ||
        importFlags.failbatch === String(no)
      )
        return { ok: false };
      return {
        ok: true,
        outcomes: notes.map((n) => {
          const key = `${workspaceId}\n${n.path}`;
          const sent = JSON.stringify([n.title, n.body, n.frontmatter]);
          const before = imported.current.get(key);
          imported.current.set(key, sent);
          const outcome: Outcome =
            before === undefined
              ? "created"
              : before === sent
                ? "unchanged"
                : "updated";
          return { path: n.path, outcome };
        }),
      };
    },
  };
  return <Vault data={data} now={now} actions={actions} importer={importer} />;
}

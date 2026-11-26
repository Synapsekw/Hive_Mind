// The Store over Supabase's REST API and Storage, as the sync identity. Every permission is the
// database's: this file only carries the calls. An error keeps the function's name, the status
// and the database's error code, never its message (which may quote a path).
import type {
  Counts,
  FileUp,
  ManifestEntry,
  Moved,
  NoteUp,
  PlanResult,
  PutResult,
  Store,
} from "./store.ts";
import { KeyRefused, Unreachable } from "./store.ts";

type Session = { token(): Promise<string> };

export function restStore(
  cfg: { url: string; anonKey: string },
  session: Session,
  fetchFn: typeof fetch = fetch,
): Store {
  const base = cfg.url.replace(/\/+$/, "");
  const headers = async (extra: Record<string, string>) => ({
    apikey: cfg.anonKey,
    Authorization: `Bearer ${await session.token()}`,
    ...extra,
  });
  const rpc = async <T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> => {
    let res: Response;
    try {
      res = await fetchFn(`${base}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: await headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(args),
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      if (e instanceof KeyRefused) throw e;
      throw new Unreachable(`${name} could not be reached`);
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => {});
      throw new KeyRefused(`${name} refused the sync key`);
    }
    if (!res.ok) {
      let code = "";
      try {
        const body = (await res.json()) as { code?: unknown };
        if (typeof body.code === "string" && /^[0-9A-Z]{5}$/.test(body.code))
          code = ` (${body.code})`;
      } catch {
        // No code to keep.
      }
      throw new Unreachable(`${name} answered ${res.status}${code}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  };

  return {
    async openRun(confirm) {
      const r = await rpc<{ run_id: string; storage_prefix: string }>(
        "sync_open_run",
        { p_confirm: confirm },
      );
      return { runId: r.run_id, storagePrefix: r.storage_prefix };
    },
    async plan(runId, page: ManifestEntry[], last) {
      const r = await rpc<PlanResult | { received: number }>("sync_plan", {
        p_run: runId,
        p_entries: page,
        p_last: last,
      });
      return last ? (r as PlanResult) : null;
    },
    putNotes: (runId, notes: NoteUp[]) =>
      rpc<PutResult>("sync_put_notes", { p_run: runId, p_notes: notes }),
    linkNotes: (runId, pairs: Moved[]) =>
      rpc<number>("sync_link_notes", { p_run: runId, p_pairs: pairs }),
    putFiles: (runId, files: FileUp[]) =>
      rpc<PutResult>("sync_put_files", { p_run: runId, p_files: files }),
    deletePaths: (runId, paths) =>
      rpc<{ deleted: number; refused: number }>("sync_delete", {
        p_run: runId,
        p_paths: paths,
      }),
    async finish(runId, counts: Counts, tooBig, error) {
      await rpc<null>("sync_finish", {
        p_run: runId,
        p_counts: counts,
        p_too_big: tooBig,
        p_error: error,
      });
    },
    async upload(storagePath, bytes, contentType) {
      const path = storagePath.split("/").map(encodeURIComponent).join("/");
      let res: Response;
      try {
        res = await fetchFn(`${base}/storage/v1/object/files/${path}`, {
          method: "POST",
          headers: await headers({
            "Content-Type": contentType,
            "x-upsert": "false",
          }),
          body: bytes as BodyInit,
          redirect: "error",
          signal: AbortSignal.timeout(600_000),
        });
      } catch (e) {
        if (e instanceof KeyRefused) throw e;
        throw new Unreachable("an upload could not be sent");
      }
      if (res.ok) {
        await res.body?.cancel().catch(() => {});
        return;
      }
      // Storage reports its own status in the body, often inside a 400.
      let inner = "";
      let error = "";
      try {
        const body = (await res.json()) as {
          statusCode?: unknown;
          error?: unknown;
        };
        inner = String(body.statusCode ?? "");
        error = String(body.error ?? "");
      } catch {
        // Not JSON.
      }
      // The same path and content, stored by an earlier run.
      if (res.status === 409 || inner === "409") return;
      if (
        res.status === 401 ||
        res.status === 403 ||
        inner === "401" ||
        inner === "403" ||
        error === "InvalidJWT"
      )
        throw new KeyRefused("an upload was refused");
      // This one file is bad (an invalid key or name, too big): the run goes on without it.
      // Storage wraps faults that hit every file (a missing bucket, a bad token) in a 400 too, so
      // a 400 counts as this file's only when its own body says 400 or 413. Anything else is the
      // hive's trouble, and the run stops to try again later.
      if (
        res.status === 413 ||
        (res.status === 400 && (inner === "400" || inner === "413"))
      )
        throw new Error(`an upload answered ${res.status}`);
      throw new Unreachable(`an upload answered ${res.status}`);
    },
  };
}

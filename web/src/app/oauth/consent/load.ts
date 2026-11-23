// What the approval window shows, given a client signed in as the person: the request's details
// from the auth server, the person's own hive (one indexed read) and their workspaces in it
// (indexed on `member_id`, 50 at most).
//
// A request the auth server answers with only a return address is one it approved by itself,
// because the person approved this app before. The window is not shown and nothing is recorded
// here: the browser goes straight back, and the hive is not read at all. That is safe because
// the pass the app is then handed decides nothing: at every call the database (`connector_login`)
// asks for a connected agent the person has not revoked and works out the app's trust again, so
// a pass for an app that was revoked in Settings, or was never connected, is refused.
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownHive } from "../../own-hive";
import type { Workspace } from "./ConsentForm";
import { readDetails, type Details } from "./decide";

type Db = Pick<SupabaseClient, "from" | "auth">;
type Res = { data: unknown; error: { code?: string; message: string } | null };

export type Loaded =
  | {
      state: "form";
      details: Extract<Details, { kind: "ask" }>;
      workspaces: Workspace[];
    }
  | { state: "answered"; redirect: string }
  | { state: "expired" }
  | { state: "no-hive" }
  | { state: "error" };

function toWorkspaces(data: unknown): Workspace[] | null {
  if (!Array.isArray(data)) return null;
  const out: Workspace[] = [];
  for (const row of data) {
    if (typeof row !== "object" || row === null) return null;
    const { id, name } = row as Record<string, unknown>;
    if (typeof id !== "string" || typeof name !== "string") return null;
    out.push({ id, name });
  }
  return out;
}

export async function loadConsent(
  db: Db,
  authorizationId: string,
): Promise<Loaded> {
  const read = (await db.auth.oauth.getAuthorizationDetails(
    authorizationId,
  )) as Res;
  if (read.error) {
    console.error(
      "authorization details failed",
      read.error.code,
      read.error.message,
    );
    return { state: "expired" };
  }
  const details = readDetails(read.data);
  if (!details) {
    console.error("authorization details have an unexpected shape");
    return { state: "error" };
  }
  if (details.kind === "answered")
    return { state: "answered", redirect: details.redirect };

  const hive = await ownHive(db);
  if (hive === "error") return { state: "error" };
  if (hive === null) return { state: "no-hive" };

  const res = (await db
    .from("workspaces")
    .select("id, name")
    .eq("member_id", hive.memberId)
    .order("created_at")
    .limit(50)) as Res;
  if (res.error) {
    console.error("workspaces query failed", res.error.code, res.error.message);
    return { state: "error" };
  }
  const workspaces = toWorkspaces(res.data);
  if (!workspaces || workspaces.length === 0) {
    console.error("workspaces answer is empty or has an unexpected shape");
    return { state: "error" };
  }
  return { state: "form", details, workspaces };
}

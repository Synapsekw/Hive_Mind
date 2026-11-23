// The approval window. The auth server sends the person's browser here when an app (Claude,
// ChatGPT) asks to connect: `/oauth/consent?authorization_id=…`. The proxy has already made sure
// the person is signed in, returning here afterwards.
//
// One server render: the request's details, the person's own hive (one indexed read) and their
// workspaces in it (indexed on `member_id`, 50 at most). Choosing a workspace costs nothing;
// approving or denying is one server action.
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "../../../lib/supabase/server";
import { ownHive } from "../../own-hive";
import { decide } from "./actions";
import { ConsentForm, type Workspace } from "./ConsentForm";
import { isAuthorizationId, readDetails, type Details } from "./decide";
import { Frame, Line } from "./Frame";
import { COULD_NOT_LOAD, EXPIRED, NO_HIVE, NOTHING_TO_APPROVE } from "./text";

// Reads the session cookie, so never prerendered.
export const dynamic = "force-dynamic";

type Res = { data: unknown; error: { code?: string; message: string } | null };

type Loaded =
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

async function load(
  db: SupabaseClient,
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

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const raw = Array.isArray(q.authorization_id)
    ? q.authorization_id[0]
    : q.authorization_id;
  if (!isAuthorizationId(raw)) return <Line>{NOTHING_TO_APPROVE}</Line>;

  let loaded: Loaded;
  try {
    loaded = await load(await createServerSupabase(), raw);
  } catch (e) {
    console.error("consent page failed", e instanceof Error ? e.name : "");
    loaded = { state: "error" };
  }

  // Approved before: straight back to the app. (`redirect` throws, so it stays out of the try.)
  if (loaded.state === "answered") redirect(loaded.redirect);
  if (loaded.state === "expired") return <Line>{EXPIRED}</Line>;
  if (loaded.state === "no-hive") return <Line>{NO_HIVE}</Line>;
  if (loaded.state === "error") return <Line>{COULD_NOT_LOAD}</Line>;

  const { details, workspaces } = loaded;
  const initial = workspaces.find((w) => w.name === "Main") ?? workspaces[0]!;
  return (
    <Frame>
      <ConsentForm
        authorizationId={raw}
        appName={details.name}
        host={details.host}
        workspaces={workspaces}
        initialWorkspaceId={initial.id}
        decide={decide}
      />
    </Frame>
  );
}

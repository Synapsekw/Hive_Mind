// The approval window. The auth server sends the person's browser here when an app (Claude,
// ChatGPT) asks to connect: `/oauth/consent?authorization_id=…`. The proxy has already made sure
// the person is signed in, returning here afterwards.
//
// One server render: the request's details, the person's own hive (one indexed read) and their
// workspaces in it (indexed on `member_id`, 50 at most), read in `load.ts`. Choosing a workspace
// costs nothing; approving or denying is one server action. The app's name and the host it
// returns to are shown for the person to read; neither decides how far the app is trusted.
import { redirect } from "next/navigation";
import { createServerSupabase } from "../../../lib/supabase/server";
import { decide } from "./actions";
import { ConsentForm } from "./ConsentForm";
import { isAuthorizationId } from "./decide";
import { loadConsent, type Loaded } from "./load";
import { Frame, Line } from "./Frame";
import { COULD_NOT_LOAD, EXPIRED, NO_HIVE, NOTHING_TO_APPROVE } from "./text";

// Reads the session cookie, so never prerendered.
export const dynamic = "force-dynamic";

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
    loaded = await loadConsent(await createServerSupabase(), raw);
  } catch (e) {
    console.error("consent page failed", e instanceof Error ? e.name : "");
    loaded = { state: "error" };
  }

  // Approved before: straight back to the app, recording nothing. What the app's pass may do is
  // decided by the database at every call. (`redirect` throws, so it stays out of the try.)
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

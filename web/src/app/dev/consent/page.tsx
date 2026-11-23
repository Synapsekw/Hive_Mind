import { notFound } from "next/navigation";
import { Frame, Line } from "../../oauth/consent/Frame";
import {
  COULD_NOT_LOAD,
  EXPIRED,
  NO_HIVE,
  NOTHING_TO_APPROVE,
} from "../../oauth/consent/text";
import { DevConsent } from "./DevConsent";

// A development page: the approval window over fixtures, with no database and no auth server.
// Never served in production.
//   ?state=ok       the form; Approve and Deny answer the fixture return address (the default)
//   ?state=error    the form; every decision is refused
//   ?state=nohive   the line for a person who is in no hive
//   ?state=none     the line for a visit with nothing to approve
//   ?state=expired  the line for a request that is gone
//   ?state=failed   the line for a request that could not be loaded
//   ?state=deny     where the fixture returns after Deny
//   ?state=approved where the fixture returns after Approve (&workspace=<id>)
//   ?app=…&host=…   another app name and return host on the form (both are only shown)
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const WORKSPACES = [
  { id: "00000000-0000-4000-8000-000000000b02", name: "Client notes" },
  { id: "00000000-0000-4000-8000-000000000b01", name: "Main" },
  { id: "00000000-0000-4000-8000-000000000b03", name: "Research" },
];

export default async function DevConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await searchParams;
  const state = one(q.state) ?? "ok";

  if (state === "nohive") return <Line>{NO_HIVE}</Line>;
  if (state === "none") return <Line>{NOTHING_TO_APPROVE}</Line>;
  if (state === "expired") return <Line>{EXPIRED}</Line>;
  if (state === "failed") return <Line>{COULD_NOT_LOAD}</Line>;
  if (state === "deny") return <Line>Fixture: the app was told no.</Line>;
  if (state === "approved") {
    const workspace = WORKSPACES.find((w) => w.id === one(q.workspace));
    return (
      <Line>Fixture: approved for {workspace?.name ?? "no workspace"}.</Line>
    );
  }

  return (
    <Frame>
      <DevConsent
        appName={one(q.app) ?? "Claude"}
        host={one(q.host) ?? "claude.ai"}
        workspaces={WORKSPACES}
        initialWorkspaceId={
          (WORKSPACES.find((w) => w.name === "Main") ?? WORKSPACES[0]!).id
        }
        fail={state === "error"}
      />
    </Frame>
  );
}

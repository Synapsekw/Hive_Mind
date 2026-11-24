"use client";

// The approval window's form with a stand-in decision: nothing is approved anywhere. Each call
// is recorded on `window.__consentCalls` for the browser tests. With `fail`, every decision is
// refused; otherwise it answers a return address on this same development page.
import { ConsentForm, type Workspace } from "../../oauth/consent/ConsentForm";
import type { Decision, Outcome } from "../../oauth/consent/decide";

declare global {
  interface Window {
    __consentCalls?: { decision: string; args: unknown[] }[];
  }
}

/** Not a real request: the auth server has never seen it. */
const DEV_AUTHORIZATION = "dev-authorization";
const WAIT = 150;

export function DevConsent({
  appName,
  host,
  workspaces,
  initialWorkspaceId,
  fail,
}: {
  appName: string;
  host: string;
  workspaces: Workspace[];
  initialWorkspaceId: string;
  fail: boolean;
}) {
  async function decide(
    authorizationId: string,
    decision: Decision,
    workspaceId: string,
  ): Promise<Outcome> {
    (window.__consentCalls ??= []).push({
      decision,
      args: [authorizationId, workspaceId],
    });
    await new Promise<void>((resolve) => setTimeout(resolve, WAIT));
    if (fail) return { ok: false };
    return {
      ok: true,
      redirect:
        decision === "approve"
          ? `/dev/consent?state=approved&workspace=${workspaceId}`
          : "/dev/consent?state=deny",
    };
  }

  return (
    <ConsentForm
      authorizationId={DEV_AUTHORIZATION}
      appName={appName}
      host={host}
      hiveName="Synapse"
      workspaces={workspaces}
      initialWorkspaceId={initialWorkspaceId}
      decide={decide}
    />
  );
}

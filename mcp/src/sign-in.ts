// Exchanges the agent token for a one-hour identity at the agent-session
// function. This file imports nothing and uses only erasable TypeScript, so
// the tests load it from source. No message built here may carry the agent
// token or the access token.

export interface Session {
  agent_id: string;
  user_id: string;
  member_id: string;
  workspace_id: string;
  hive_id: string;
  trust_tier: "vendor" | "self_hosted";
}

export interface SignedIn {
  accessToken: string;
  /** Seconds since the epoch, as the function states it. */
  expiresAt: number;
  me: Session;
}

const FAILED = "Hive sign-in failed: ";
const ID_FIELDS = [
  "agent_id",
  "user_id",
  "member_id",
  "workspace_id",
  "hive_id",
] as const;

const text = (v: unknown): v is string => typeof v === "string" && v !== "";

function parse(body: unknown): SignedIn | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return;
  const b = body as Record<string, unknown>;
  if (!text(b.access_token)) return;
  if (!Number.isSafeInteger(b.expires_at) || (b.expires_at as number) <= 0)
    return;
  if (!ID_FIELDS.every((k) => text(b[k]))) return;
  if (b.trust_tier !== "vendor" && b.trust_tier !== "self_hosted") return;
  return {
    accessToken: b.access_token,
    expiresAt: b.expires_at as number,
    me: {
      agent_id: b.agent_id as string,
      user_id: b.user_id as string,
      member_id: b.member_id as string,
      workspace_id: b.workspace_id as string,
      hive_id: b.hive_id as string,
      trust_tier: b.trust_tier,
    },
  };
}

export async function signIn(
  { url, anonKey, token }: { url: string; anonKey: string; token: string },
  fetchFn: typeof fetch = fetch,
): Promise<SignedIn> {
  let res: Response;
  try {
    res = await fetchFn(
      `${url.replace(/\/+$/, "")}/functions/v1/agent-session`,
      {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        // The agent token goes to this address and nowhere it points to.
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    // The cause is dropped on purpose: it can quote the request.
    throw new Error(`${FAILED}the hive is not reachable`);
  }

  if (res.status === 401)
    throw new Error(`${FAILED}unknown, expired or revoked token`);
  if (res.status === 404)
    throw new Error(
      `${FAILED}the agent-session function is not deployed on this project. ` +
        "See docs/hosted-db-bringup.md.",
    );
  if (res.status !== 200) throw new Error(`${FAILED}${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const signedIn = parse(body);
  if (!signedIn)
    throw new Error(`${FAILED}unexpected answer from agent-session`);
  return signedIn;
}

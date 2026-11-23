import { describe, expect, it, vi } from "vitest";
import { decideIn, returnHost, safeReturn } from "./decide";

const USER = "00000000-0000-4000-8000-000000000001";
const W1 = "00000000-0000-4000-8000-000000000b01";
const AUTH = "auth_abc-123";
const BACK = "https://claude.ai/api/mcp/auth_callback?code=c1&state=s1";

type Err = { message: string; code?: string };

/** An access token whose payload names `sub`; the signature is never read here. */
function token(sub: string) {
  const part = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ sub })}.sig`;
}

const DETAILS = {
  authorization_id: AUTH,
  redirect_uri: "https://Claude.AI/api/mcp/auth_callback",
  client: { id: "client-a", name: "Claude", uri: "", logo_uri: "" },
  user: { id: USER, email: "me@example.com" },
  scope: "openid",
};

function stub(
  opts: {
    session?: boolean;
    details?: { data: unknown; error: Err | null };
    rpc?: { data: unknown; error: Err | null };
    approve?: { data: unknown; error: Err | null };
    deny?: { data: unknown; error: Err | null };
  } = {},
) {
  const steps: string[] = [];
  const oauth = {
    getAuthorizationDetails: vi.fn(async (_id: string) => {
      steps.push("details");
      return opts.details ?? { data: DETAILS, error: null };
    }),
    approveAuthorization: vi.fn(async (_id: string, _o?: unknown) => {
      steps.push("approve");
      return opts.approve ?? { data: { redirect_url: BACK }, error: null };
    }),
    denyAuthorization: vi.fn(async (_id: string, _o?: unknown) => {
      steps.push("deny");
      return (
        opts.deny ?? {
          data: { redirect_url: `${BACK}&error=access_denied` },
          error: null,
        }
      );
    }),
  };
  const auth = {
    getSession: vi.fn(async () => ({
      data: {
        session: opts.session === false ? null : { access_token: token(USER) },
      },
      error: null,
    })),
    oauth,
  };
  const rpc = vi.fn(async (_name: string, _args: unknown) => {
    steps.push("connect");
    return opts.rpc ?? { data: "agent-1", error: null };
  });
  // The stand-in has only what `decideIn` may touch.
  const db = { auth, rpc } as unknown as Parameters<typeof decideIn>[0];
  return { db, oauth, rpc, steps };
}

const approve = { authorizationId: AUTH, decision: "approve", workspaceId: W1 };
const deny = { authorizationId: AUTH, decision: "deny", workspaceId: W1 };

describe("decideIn: approve", () => {
  it("reads the details, connects the app with their values, approves, and answers the return address", async () => {
    const t = stub();
    expect(await decideIn(t.db, approve)).toEqual({ ok: true, redirect: BACK });
    expect(t.steps).toEqual(["details", "connect", "approve"]);
    expect(t.oauth.getAuthorizationDetails).toHaveBeenCalledWith(AUTH);
    expect(t.rpc).toHaveBeenCalledWith("connect_app", {
      p_client_id: "client-a",
      p_name: "Claude",
      p_redirect_host: "claude.ai",
      p_workspace: W1,
    });
    expect(t.oauth.approveAuthorization).toHaveBeenCalledWith(AUTH, {
      skipBrowserRedirect: true,
    });
  });

  it("takes nothing but the workspace and the decision from the caller", async () => {
    const t = stub();
    const forged = {
      ...approve,
      p_client_id: "evil",
      p_name: "Evil",
      p_redirect_host: "claude.ai",
      clientId: "evil",
      name: "Evil",
      host: "claude.ai",
    };
    await decideIn(t.db, forged);
    expect(t.rpc.mock.calls[0]![1]).toEqual({
      p_client_id: "client-a",
      p_name: "Claude",
      p_redirect_host: "claude.ai",
      p_workspace: W1,
    });
  });

  it("does not approve when connecting the app fails", async () => {
    const t = stub({ rpc: { data: null, error: { message: "refused" } } });
    expect(await decideIn(t.db, approve)).toEqual({ ok: false });
    expect(t.steps).toEqual(["details", "connect"]);
    expect(t.oauth.approveAuthorization).not.toHaveBeenCalled();
  });

  it("does not approve when connecting the app throws", async () => {
    const t = stub();
    t.rpc.mockRejectedValue(new Error("network"));
    expect(await decideIn(t.db, approve)).toEqual({ ok: false });
    expect(t.oauth.approveAuthorization).not.toHaveBeenCalled();
  });

  it("connects nothing when the details cannot be read", async () => {
    const t = stub({ details: { data: null, error: { message: "gone" } } });
    expect(await decideIn(t.db, approve)).toEqual({ ok: false });
    expect(t.steps).toEqual(["details"]);
  });

  it.each([
    ["no client", { ...DETAILS, client: undefined }],
    ["a client without an id", { ...DETAILS, client: { name: "Claude" } }],
    ["an empty client id", { ...DETAILS, client: { id: "", name: "Claude" } }],
    ["neither a request nor a return address", { scope: "openid" }],
    ["not an object", "nonsense"],
  ])("connects nothing when the details have %s", async (_n, data) => {
    const t = stub({ details: { data, error: null } });
    expect(await decideIn(t.db, approve)).toEqual({ ok: false });
    expect(t.steps).toEqual(["details"]);
  });

  it("goes straight back when the request was already approved, connecting nothing", async () => {
    const t = stub({ details: { data: { redirect_url: BACK }, error: null } });
    expect(await decideIn(t.db, approve)).toEqual({ ok: true, redirect: BACK });
    expect(t.steps).toEqual(["details"]);
  });

  it("answers not ok when approving fails or answers no usable address", async () => {
    for (const approveAnswer of [
      { data: null, error: { message: "no" } },
      { data: {}, error: null },
      { data: { redirect_url: "javascript:alert(1)" }, error: null },
      { data: { redirect_url: "not an address" }, error: null },
    ]) {
      const t = stub({ approve: approveAnswer });
      expect(await decideIn(t.db, approve)).toEqual({ ok: false });
    }
  });

  it("sends an empty host when the return address does not parse", async () => {
    const t = stub({
      details: { data: { ...DETAILS, redirect_uri: "nonsense" }, error: null },
    });
    await decideIn(t.db, approve);
    expect(t.rpc.mock.calls[0]![1]).toMatchObject({ p_redirect_host: "" });
  });

  it("names an app that gave no name after its host, and cuts a long name", async () => {
    const unnamed = stub({
      details: {
        data: { ...DETAILS, client: { id: "client-a", name: "  " } },
        error: null,
      },
    });
    await decideIn(unnamed.db, approve);
    expect(unnamed.rpc.mock.calls[0]![1]).toMatchObject({
      p_name: "claude.ai",
    });

    const long = stub({
      details: {
        data: { ...DETAILS, client: { id: "client-a", name: "x".repeat(500) } },
        error: null,
      },
    });
    await decideIn(long.db, approve);
    expect(long.rpc.mock.calls[0]![1]).toMatchObject({
      p_name: "x".repeat(120),
    });
  });
});

describe("decideIn: deny", () => {
  it("calls only the denial and answers its return address", async () => {
    const t = stub();
    expect(await decideIn(t.db, deny)).toEqual({
      ok: true,
      redirect: `${BACK}&error=access_denied`,
    });
    expect(t.steps).toEqual(["deny"]);
    expect(t.oauth.denyAuthorization).toHaveBeenCalledWith(AUTH, {
      skipBrowserRedirect: true,
    });
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("needs no workspace", async () => {
    const t = stub();
    const res = await decideIn(t.db, { ...deny, workspaceId: undefined });
    expect(res.ok).toBe(true);
  });

  it("answers not ok when the denial fails", async () => {
    const t = stub({ deny: { data: null, error: { message: "no" } } });
    expect(await decideIn(t.db, deny)).toEqual({ ok: false });
  });
});

describe("decideIn: refusals before any call", () => {
  it.each([
    ["an empty id", { ...approve, authorizationId: "" }],
    ["an id that is not text", { ...approve, authorizationId: 7 }],
    ["an id with a slash", { ...approve, authorizationId: "a/b" }],
    ["an id with a space", { ...approve, authorizationId: "a b" }],
    ["an overlong id", { ...approve, authorizationId: "a".repeat(201) }],
    ["a workspace that is not a uuid", { ...approve, workspaceId: "main" }],
    ["no workspace on approve", { ...approve, workspaceId: undefined }],
    ["an unknown decision", { ...approve, decision: "maybe" }],
    ["nothing", null],
  ])("%s", async (_name, input) => {
    const t = stub();
    expect(await decideIn(t.db, input)).toEqual({ ok: false });
    expect(t.steps).toEqual([]);
  });

  it("no session", async () => {
    const t = stub({ session: false });
    expect(await decideIn(t.db, approve)).toEqual({ ok: false });
    expect(await decideIn(t.db, deny)).toEqual({ ok: false });
    expect(t.steps).toEqual([]);
  });
});

describe("returnHost", () => {
  it.each([
    ["https://Claude.AI/cb", "claude.ai"],
    ["https://x.claude.ai:8443/cb?a=1", "x.claude.ai"],
    ["http://localhost:6274/oauth/callback", "localhost"],
    ["cursor://anysphere.cursor-mcp/oauth/callback", "anysphere.cursor-mcp"],
    ["https://user:pw@claude.ai.evil.com/", "claude.ai.evil.com"],
    ["nonsense", ""],
    ["", ""],
    [undefined, ""],
    [7, ""],
  ])("%s -> %s", (uri, host) => {
    expect(returnHost(uri)).toBe(host);
  });
});

describe("safeReturn", () => {
  it("keeps web and app addresses", () => {
    expect(safeReturn(BACK)).toBe(BACK);
    expect(safeReturn("http://localhost:6274/cb?code=1")).toBe(
      "http://localhost:6274/cb?code=1",
    );
    expect(safeReturn("cursor://x/cb?code=1")).toBe("cursor://x/cb?code=1");
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,x",
    "vbscript:x",
    "blob:https://x/y",
    "file:///etc/passwd",
    "/relative",
    "",
    7,
    null,
  ])("refuses %s", (v) => {
    expect(safeReturn(v)).toBeNull();
  });
});

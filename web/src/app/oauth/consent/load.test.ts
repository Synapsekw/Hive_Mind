import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConsent } from "./load";

const USER = "00000000-0000-4000-8000-000000000001";
const HIVE = "00000000-0000-4000-8000-000000000a01";
const MEMBER = "00000000-0000-4000-8000-000000000c01";
const W1 = "00000000-0000-4000-8000-000000000b01";
const W2 = "00000000-0000-4000-8000-000000000b02";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const AUTH = "auth_abc-123";
const BACK = "https://claude.ai/api/mcp/auth_callback?code=c1&state=s1";

type Err = { message: string; code?: string };
type Res = { data: unknown; error: Err | null };

const DETAILS = {
  authorization_id: AUTH,
  redirect_uri: "https://Claude.AI/api/mcp/auth_callback",
  client: { id: CLIENT, name: "Claude", uri: "", logo_uri: "" },
  user: { id: USER, email: "me@example.com" },
  scope: "openid",
};

/** An access token whose payload names `sub`; the signature is never read here. */
function token(sub: string) {
  const part = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ sub })}.sig`;
}

function stub(
  opts: {
    details?: Res;
    members?: Res;
    workspaces?: Res;
  } = {},
) {
  const tables: string[] = [];
  const filters: [string, unknown[]][] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"])
      chain[m] = (...args: unknown[]) => {
        if (table === "workspaces") filters.push([m, args]);
        return chain;
      };
    const answer: Res =
      table === "members"
        ? (opts.members ?? {
            data: [{ id: MEMBER, hive_id: HIVE, hive: { name: "Synapse" } }],
            error: null,
          })
        : (opts.workspaces ?? {
            data: [
              { id: W2, name: "Client notes" },
              { id: W1, name: "Main" },
            ],
            error: null,
          });
    chain.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(answer).then(res, rej);
    return chain;
  });
  const oauth = {
    getAuthorizationDetails: vi.fn(
      async (_id: string) => opts.details ?? { data: DETAILS, error: null },
    ),
    approveAuthorization: vi.fn(),
    denyAuthorization: vi.fn(),
  };
  const auth = {
    getSession: vi.fn(async () => ({
      data: { session: { access_token: token(USER) } },
      error: null,
    })),
    oauth,
  };
  const rpc = vi.fn();
  const db = { from, auth, rpc } as unknown as Parameters<
    typeof loadConsent
  >[0];
  return { db, from, oauth, rpc, tables, filters };
}

afterEach(() => vi.restoreAllMocks());

describe("loadConsent: a request still to be answered", () => {
  it("answers the form: the app, the host it returns to and the person's workspaces", async () => {
    const t = stub();
    expect(await loadConsent(t.db, AUTH)).toEqual({
      state: "form",
      details: {
        kind: "ask",
        clientId: CLIENT,
        name: "Claude",
        host: "claude.ai",
      },
      workspaces: [
        { id: W2, name: "Client notes" },
        { id: W1, name: "Main" },
      ],
    });
    expect(t.oauth.getAuthorizationDetails).toHaveBeenCalledWith(AUTH);
    expect(t.tables).toEqual(["members", "workspaces"]);
    // The person's own workspaces only, and a bounded read.
    expect(t.filters).toContainEqual(["eq", ["member_id", MEMBER]]);
    expect(t.filters).toContainEqual(["limit", [50]]);
  });

  it("decides nothing: no approval, no denial, no write", async () => {
    const t = stub();
    await loadConsent(t.db, AUTH);
    expect(t.oauth.approveAuthorization).not.toHaveBeenCalled();
    expect(t.oauth.denyAuthorization).not.toHaveBeenCalled();
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("says so when the person is in no hive", async () => {
    const t = stub({ members: { data: [], error: null } });
    expect(await loadConsent(t.db, AUTH)).toEqual({ state: "no-hive" });
    expect(t.tables).toEqual(["members"]);
  });

  it.each([
    [
      "the hive cannot be read",
      { members: { data: null, error: { message: "x" } } },
    ],
    [
      "the workspaces cannot be read",
      { workspaces: { data: null, error: { message: "x" } } },
    ],
    ["there is no workspace", { workspaces: { data: [], error: null } }],
    [
      "a workspace row is malformed",
      { workspaces: { data: [{ id: W1 }], error: null } },
    ],
  ])("answers an error when %s", async (_n, opts) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub(opts);
    expect(await loadConsent(t.db, AUTH)).toEqual({ state: "error" });
  });
});

describe("loadConsent: a request the auth server approved by itself", () => {
  it("answers the return address and reads nothing of the hive", async () => {
    const t = stub({ details: { data: { redirect_url: BACK }, error: null } });
    expect(await loadConsent(t.db, AUTH)).toEqual({
      state: "answered",
      redirect: BACK,
    });
    expect(t.from).not.toHaveBeenCalled();
    expect(t.rpc).not.toHaveBeenCalled();
    expect(t.oauth.approveAuthorization).not.toHaveBeenCalled();
  });

  it.each([
    ["a script", "javascript:alert(1)"],
    ["a data address", "data:text/html,x"],
    ["a relative address", "/settings"],
    ["nothing", ""],
    ["not text", 7],
  ])("never sends the browser to %s", async (_n, redirect_url) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ details: { data: { redirect_url }, error: null } });
    expect(await loadConsent(t.db, AUTH)).toEqual({ state: "error" });
    expect(t.from).not.toHaveBeenCalled();
  });
});

describe("loadConsent: a request that cannot be read", () => {
  it("is expired when the auth server refuses it, logging code and message only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      details: { data: null, error: { message: "not found", code: "404" } },
    });
    expect(await loadConsent(t.db, AUTH)).toEqual({ state: "expired" });
    expect(error).toHaveBeenCalledWith(
      "authorization details failed",
      "404",
      "not found",
    );
    expect(t.from).not.toHaveBeenCalled();
  });

  it.each([
    ["no client", { ...DETAILS, client: undefined }],
    ["an empty client id", { ...DETAILS, client: { id: "", name: "Claude" } }],
    ["neither a request nor a return address", { scope: "openid" }],
    ["not an object", "nonsense"],
  ])("is an error when the details have %s", async (_n, data) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ details: { data, error: null } });
    expect(await loadConsent(t.db, AUTH)).toEqual({ state: "error" });
    expect(t.from).not.toHaveBeenCalled();
  });
});

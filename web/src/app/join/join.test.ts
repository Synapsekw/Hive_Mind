import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptIn, continueIn, signedInAs, viewOf, waitingIn } from "./join";

const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8";
const INVITATION = "00000000-0000-4000-8000-00000000d001";
const HIVE = "00000000-0000-4000-8000-000000000a01";

type Err = { message: string; code?: string; details?: string };
type Res = { data: unknown; error: Err | null };

function stub(opts: { verify?: Res | (() => never); rpc?: Res } = {}) {
  const verifyOtp = vi.fn(async (_args: unknown) =>
    typeof opts.verify === "function"
      ? opts.verify()
      : (opts.verify ?? { data: {}, error: null }),
  );
  const rpc = vi.fn(
    async (_name: string, _args?: unknown) =>
      opts.rpc ?? { data: [], error: null },
  );
  const db = { auth: { verifyOtp }, rpc } as never;
  return { db, verifyOtp, rpc };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: INVITATION,
  hive_name: "Synapse",
  invited_by: "Danijel",
  expires_at: "2026-12-07T10:00:00+00:00",
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("viewOf: what a visit to /join shows, spending nothing", () => {
  it("is the Continue button for a link with a token and a type", () => {
    expect(viewOf({ token_hash: TOKEN, type: "invite" })).toEqual({
      kind: "continue",
      tokenHash: TOKEN,
      type: "invite",
    });
    expect(viewOf({ token_hash: TOKEN, type: "magiclink" })).toEqual({
      kind: "continue",
      tokenHash: TOKEN,
      type: "magiclink",
    });
  });

  it.each([
    ["another type", { token_hash: TOKEN, type: "recovery" }],
    ["the email type", { token_hash: TOKEN, type: "email" }],
    ["no type", { token_hash: TOKEN }],
    ["a short token", { token_hash: "abc", type: "invite" }],
    [
      "a token of 201 characters",
      { token_hash: "a".repeat(201), type: "invite" },
    ],
    ["a token with other marks", { token_hash: `${TOKEN}<x>`, type: "invite" }],
    ["an empty token", { token_hash: "", type: "invite" }],
    ["a repeated token", { token_hash: [TOKEN, TOKEN], type: "invite" }],
    ["a repeated type", { token_hash: TOKEN, type: ["invite", "invite"] }],
  ])("is the expired line for a link with %s", (_n, query) => {
    expect(viewOf(query)).toEqual({ kind: "expired" });
  });

  it("is the expired line after a refused Continue", () => {
    expect(viewOf({ error: "expired" })).toEqual({ kind: "expired" });
  });

  it("is the list otherwise", () => {
    expect(viewOf({})).toEqual({ kind: "list", switched: false });
    expect(viewOf({ error: "other", x: "1" })).toEqual({
      kind: "list",
      switched: false,
    });
  });

  it("is the list with its notice after Continue replaced another person's session", () => {
    expect(viewOf({ switched: "1" })).toEqual({ kind: "list", switched: true });
    expect(viewOf({ switched: "yes" })).toEqual({
      kind: "list",
      switched: false,
    });
    expect(viewOf({ switched: ["1", "1"] })).toEqual({
      kind: "list",
      switched: false,
    });
  });
});

describe("continueIn: Continue spends the emailed link", () => {
  it.each(["invite", "magiclink"])(
    "verifies a %s link once, with the token and its type only",
    async (type) => {
      const t = stub();
      expect(await continueIn(t.db, TOKEN, type)).toBe("ok");
      expect(t.verifyOtp).toHaveBeenCalledTimes(1);
      expect(t.verifyOtp).toHaveBeenCalledWith({ type, token_hash: TOKEN });
      expect(t.rpc).not.toHaveBeenCalled();
    },
  );

  it("takes a token of 20 and of 200 URL-safe characters", async () => {
    for (const token of ["aZ0_-".repeat(4), "a".repeat(200)]) {
      const t = stub();
      expect(await continueIn(t.db, token, "invite")).toBe("ok");
    }
  });

  it.each([
    ["type recovery", TOKEN, "recovery"],
    ["type email", TOKEN, "email"],
    ["type signup", TOKEN, "signup"],
    ["type email_change", TOKEN, "email_change"],
    ["a type in capitals", TOKEN, "INVITE"],
    ["no type", TOKEN, null],
    ["a type that is not text", TOKEN, { toString: (): string => "invite" }],
    ["a token of 19 characters", "a".repeat(19), "invite"],
    ["a token of 201 characters", "a".repeat(201), "invite"],
    ["a token with a dot", `${TOKEN}.x`, "invite"],
    ["a token with a space", `${TOKEN} `, "invite"],
    ["a token with a slash", `${TOKEN}/x`, "invite"],
    ["a token with a line break", `${TOKEN}\n`, "invite"],
    ["no token", null, "invite"],
    ["a token that is not text", 12345678901234567890, "invite"],
    ["a file in place of the token", new Blob(["x"]), "invite"],
  ])(
    "is expired for %s, asking the auth server nothing",
    async (_n, token, type) => {
      const t = stub();
      expect(await continueIn(t.db, token, type)).toBe("expired");
      expect(t.verifyOtp).not.toHaveBeenCalled();
    },
  );

  it("is expired when the auth server refuses, logging code and message only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      verify: {
        data: null,
        error: { message: "Email link is invalid", code: "otp_expired" },
      },
    });
    expect(await continueIn(t.db, TOKEN, "invite")).toBe("expired");
    expect(log).toHaveBeenCalledWith(
      "invitation link refused",
      "otp_expired",
      "Email link is invalid",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  it("is expired when the client throws, logging only the name of what was thrown", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      verify: () => {
        throw new TypeError(`fetch failed for ${TOKEN}`);
      },
    });
    expect(await continueIn(t.db, TOKEN, "invite")).toBe("expired");
    expect(log).toHaveBeenCalledWith("invitation link failed", "TypeError");
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });
});

describe("waitingIn: the invitations waiting for the signed-in person", () => {
  it("asks my_invitations once, with no arguments, and maps the rows", async () => {
    const t = stub({
      rpc: {
        data: [
          row(),
          row({ id: HIVE, hive_name: "Atlas", invited_by: "Mira" }),
        ],
        error: null,
      },
    });
    expect(await waitingIn(t.db)).toEqual([
      {
        id: INVITATION,
        hiveName: "Synapse",
        invitedBy: "Danijel",
        expiresAt: "2026-12-07T10:00:00+00:00",
      },
      {
        id: HIVE,
        hiveName: "Atlas",
        invitedBy: "Mira",
        expiresAt: "2026-12-07T10:00:00+00:00",
      },
    ]);
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("my_invitations");
    expect(t.verifyOtp).not.toHaveBeenCalled();
  });

  it("is an empty list when nothing waits", async () => {
    expect(await waitingIn(stub().db)).toEqual([]);
  });

  it("keeps 20 at most", async () => {
    const data = Array.from({ length: 30 }, () => row());
    const got = await waitingIn(stub({ rpc: { data, error: null } }).db);
    expect(got).toHaveLength(20);
  });

  it("cuts other people's words to 80 characters and drops marks that hide or reorder text", async () => {
    const t = stub({
      rpc: {
        data: [
          row({
            hive_name: `  ${"h".repeat(200)}`,
            invited_by: "Da‮nij\u0000el⁦\n",
          }),
        ],
        error: null,
      },
    });
    const got = await waitingIn(t.db);
    expect(got).not.toBe("error");
    const [first] = got as Exclude<typeof got, "error">;
    expect(first!.hiveName).toBe("h".repeat(80));
    expect(first!.invitedBy).toBe("Danijel");
  });

  it("takes an inviter who is gone as an empty name", async () => {
    const t = stub({ rpc: { data: [row({ invited_by: "" })], error: null } });
    expect(await waitingIn(t.db)).toMatchObject([{ invitedBy: "" }]);
  });

  it.each([
    ["not a list", { id: INVITATION }],
    ["nothing", null],
    ["a row that is not an object", ["x"]],
    ["an id that is not a uuid", [row({ id: "x" })]],
    ["a hive name that is not text", [row({ hive_name: 7 })]],
    ["an inviter that is a number", [row({ invited_by: 7 })]],
    ["no inviter name at all", [row({ invited_by: null })]],
    ["an expiry that is not a date", [row({ expires_at: "soon" })]],
    ["no expiry", [row({ expires_at: undefined })]],
  ])("is an error when the answer is %s", async (_n, data) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await waitingIn(stub({ rpc: { data, error: null } }).db)).toBe(
      "error",
    );
    expect(log).toHaveBeenCalledWith(
      "my_invitations answer has an unexpected shape",
    );
  });

  it("is an error when the database refuses, logging code and message only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      rpc: {
        data: null,
        error: {
          message: "sign in as a person",
          code: "P0001",
          details: "secret payload",
        },
      },
    });
    expect(await waitingIn(t.db)).toBe("error");
    expect(log).toHaveBeenCalledWith(
      "my_invitations failed",
      "P0001",
      "sign in as a person",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret payload");
  });

  it("is an error when the client throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await waitingIn({} as never)).toBe("error");
  });
});

describe("acceptIn: Join", () => {
  it("calls accept_invitation with the invitation's id and nothing else", async () => {
    const t = stub({ rpc: { data: HIVE, error: null } });
    expect(await acceptIn(t.db, INVITATION)).toEqual({ ok: true });
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("accept_invitation", {
      p_invitation: INVITATION,
    });
  });

  it.each([
    ["not a uuid", "x"],
    ["nothing", undefined],
    ["a number", 7],
    ["an object", { id: INVITATION }],
  ])("refuses an id that is %s without asking the database", async (_n, id) => {
    const t = stub();
    expect(await acceptIn(t.db, id)).toEqual({ ok: false });
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("answers no when the database refuses, logging code and message only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      rpc: {
        data: null,
        error: { message: "invitation not found", code: "P0001" },
      },
    });
    expect(await acceptIn(t.db, INVITATION)).toEqual({ ok: false });
    expect(log).toHaveBeenCalledWith(
      "accept_invitation failed",
      "P0001",
      "invitation not found",
    );
  });

  it("answers no when the client throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await acceptIn({} as never, INVITATION)).toEqual({ ok: false });
  });
});

describe("signedInAs: whose invitations the page is about to show", () => {
  const as = (answer: unknown) => {
    const getUser = vi.fn(async () => answer);
    return { db: { auth: { getUser } } as never, getUser };
  };
  const user = (email: unknown) => ({ data: { user: { email } }, error: null });

  it("is the address the auth server answers for the session, asked once", async () => {
    const t = as(user("me@example.com"));
    expect(await signedInAs(t.db)).toEqual({ email: "me@example.com" });
    expect(t.getUser).toHaveBeenCalledTimes(1);
  });

  it("cuts the address to 254 characters and drops marks that hide or reorder text", async () => {
    const long = `${"a".repeat(300)}@example.com`;
    expect(await signedInAs(as(user(long)).db)).toEqual({
      email: long.slice(0, 254),
    });
    expect(
      await signedInAs(as(user(" me\u202E@exam\u0000ple.com\n")).db),
    ).toEqual({
      email: "me@example.com",
    });
  });

  it.each([
    ["no address", undefined],
    ["an address that is not text", 7],
  ])(
    "is signed in with an empty address for a user with %s",
    async (_n, email) => {
      expect(await signedInAs(as(user(email)).db)).toEqual({ email: "" });
    },
  );

  it.each([
    ["no user", { data: { user: null }, error: null }],
    ["a refusal", { data: { user: null }, error: { message: "x" } }],
    ["an answer with no data", {}],
  ])("is nobody for %s", async (_n, answer) => {
    expect(await signedInAs(as(answer).db)).toBeNull();
  });

  it("is nobody when the client throws, logging only the name of what was thrown", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const getUser = vi.fn(async () => {
      throw new TypeError("fetch failed for me@example.com");
    });
    expect(await signedInAs({ auth: { getUser } } as never)).toBeNull();
    expect(log).toHaveBeenCalledWith("join session read failed", "TypeError");
    expect(JSON.stringify(log.mock.calls)).not.toContain("me@");
  });
});

describe("continueIn: a link opened by someone who is already signed in", () => {
  const A = "00000000-0000-4000-8000-0000000000a1";
  const B = "00000000-0000-4000-8000-0000000000b2";

  /** `before` is who the browser holds; `after` is who the link signs in. */
  function two(opts: {
    before: string | null;
    after: string | null;
    verifyNames?: boolean;
    refuse?: boolean;
  }) {
    const steps: string[] = [];
    let now = opts.before;
    const getUser = vi.fn(async () => {
      steps.push("who");
      return { data: { user: now ? { id: now } : null }, error: null };
    });
    const verifyOtp = vi.fn(async (_a: unknown) => {
      steps.push("verify");
      if (opts.refuse)
        return { data: { user: null }, error: { message: "expired" } };
      now = opts.after;
      return {
        data: { user: opts.verifyNames === false ? null : { id: opts.after } },
        error: null,
      };
    });
    return { db: { auth: { getUser, verifyOtp } } as never, steps, getUser };
  }

  it("says switched when the link signs in a different person", async () => {
    const t = two({ before: A, after: B });
    expect(await continueIn(t.db, TOKEN, "invite")).toBe("switched");
    // Who is signed in is read before the link is spent.
    expect(t.steps.slice(0, 2)).toEqual(["who", "verify"]);
  });

  it("asks who is signed in afterwards when the answer to the link does not say", async () => {
    const t = two({ before: A, after: B, verifyNames: false });
    expect(await continueIn(t.db, TOKEN, "magiclink")).toBe("switched");
    expect(t.steps).toEqual(["who", "verify", "who"]);
  });

  it("is plain ok for the same person, and for a browser that held no session", async () => {
    expect(
      await continueIn(two({ before: A, after: A }).db, TOKEN, "invite"),
    ).toBe("ok");
    expect(
      await continueIn(two({ before: null, after: B }).db, TOKEN, "invite"),
    ).toBe("ok");
  });

  it("is plain ok when nobody can be named afterwards", async () => {
    const t = two({ before: A, after: null, verifyNames: false });
    expect(await continueIn(t.db, TOKEN, "invite")).toBe("ok");
  });

  it("is expired, not switched, when the link is refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = two({ before: A, after: B, refuse: true });
    expect(await continueIn(t.db, TOKEN, "invite")).toBe("expired");
  });

  it("does not ask who is signed in for a link it will not spend", async () => {
    const t = two({ before: A, after: B });
    expect(await continueIn(t.db, "x", "invite")).toBe("expired");
    expect(await continueIn(t.db, TOKEN, "recovery")).toBe("expired");
    expect(t.steps).toEqual([]);
  });

  it("still spends the link when the session cannot be read first", async () => {
    const t = two({ before: A, after: B });
    t.getUser.mockRejectedValueOnce(new Error("network"));
    expect(await continueIn(t.db, TOKEN, "invite")).toBe("ok");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NEW_COOKIE,
  isNew,
  newCookie,
  noNewCookie,
  setPasswordIn,
} from "./password";

const PASSWORD = "correct horse battery";
const USER = "00000000-0000-4000-8000-0000000000a1";

function stub(
  opts: {
    user?: unknown;
    update?: unknown | (() => never);
    getUserThrows?: boolean;
  } = {},
) {
  const steps: string[] = [];
  const getUser = vi.fn(async () => {
    steps.push("who");
    if (opts.getUserThrows) throw new TypeError(`network ${PASSWORD}`);
    return {
      data: { user: opts.user === undefined ? { id: USER } : opts.user },
      error: null,
    };
  });
  const updateUser = vi.fn(async (_a: unknown) => {
    steps.push("update");
    return typeof opts.update === "function"
      ? (opts.update as () => never)()
      : (opts.update ?? { data: { user: { id: USER } }, error: null });
  });
  const rpc = vi.fn();
  const from = vi.fn();
  const db = { auth: { getUser, updateUser }, rpc, from } as never;
  return { db, getUser, updateUser, rpc, from, steps };
}

afterEach(() => vi.restoreAllMocks());

describe("the cookie that marks a person who has just opened a first invitation", () => {
  it("is short-lived, unreadable by scripts, and sent only to the Join pages", () => {
    expect(NEW_COOKIE).toBe("hm_new");
    expect(newCookie(true)).toEqual({
      name: "hm_new",
      value: "1",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/join",
      maxAge: 3600,
    });
    expect(newCookie(false).secure).toBe(false);
  });

  it("is taken away by the same cookie with no life left", () => {
    expect(noNewCookie(true)).toEqual({
      name: "hm_new",
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/join",
      maxAge: 0,
    });
  });

  it("counts only when its value is the one that was set", () => {
    const jar = (value?: string) => ({
      get: (name: string) =>
        value === undefined || name !== "hm_new" ? undefined : { value },
    });
    expect(isNew(jar("1"))).toBe(true);
    expect(isNew(jar("0"))).toBe(false);
    expect(isNew(jar(""))).toBe(false);
    expect(isNew(jar())).toBe(false);
  });
});

describe("setPasswordIn", () => {
  it("sets the signed-in person's own password, and nothing else", async () => {
    const t = stub();
    expect(await setPasswordIn(t.db, PASSWORD, PASSWORD)).toEqual({ ok: true });
    expect(t.steps).toEqual(["who", "update"]);
    expect(t.updateUser).toHaveBeenCalledTimes(1);
    expect(t.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
    expect(t.rpc).not.toHaveBeenCalled();
    expect(t.from).not.toHaveBeenCalled();
  });

  it.each([
    ["short", "abc", "abc"],
    ["long", "a".repeat(73), "a".repeat(73)],
    ["different", PASSWORD, `${PASSWORD}!`],
    ["short", undefined, undefined],
    ["short", new Blob(["x"]), new Blob(["x"])],
  ])(
    "answers %s without asking the auth server anything",
    async (reason, password, repeat) => {
      const t = stub();
      expect(await setPasswordIn(t.db, password, repeat)).toEqual({
        ok: false,
        reason,
      });
      expect(t.steps).toEqual([]);
    },
  );

  it.each([
    ["nobody is signed in", { user: null }],
    ["the session cannot be read", { getUserThrows: true }],
    ["the user has no id", { user: {} }],
  ])("fails, changing nothing, when %s", async (_n, opts) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub(opts);
    expect(await setPasswordIn(t.db, PASSWORD, PASSWORD)).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(t.updateUser).not.toHaveBeenCalled();
  });

  it("answers refused when the auth server refuses, logging a fixed phrase, the code and the status only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      update: {
        data: { user: null },
        error: {
          message: `Password ${PASSWORD} is known to be weak`,
          code: "weak_password",
          status: 422,
          reasons: ["pwned"],
        },
      },
    });
    expect(await setPasswordIn(t.db, PASSWORD, PASSWORD)).toEqual({
      ok: false,
      reason: "refused",
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "password change refused",
      "weak_password",
      422,
    );
    const said = JSON.stringify(log.mock.calls);
    expect(said).not.toContain(PASSWORD);
    expect(said).not.toContain("known to be weak");
    expect(said).not.toContain("pwned");
  });

  it("fails when the client throws, logging only the name of what was thrown", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      update: () => {
        throw new TypeError(`fetch failed with body ${PASSWORD}`);
      },
    });
    expect(await setPasswordIn(t.db, PASSWORD, PASSWORD)).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(log).toHaveBeenCalledWith("password change failed", "TypeError");
    expect(JSON.stringify(log.mock.calls)).not.toContain(PASSWORD);
  });

  it("answers nothing that carries the password or the auth server's words", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = stub({
      update: { data: null, error: { message: `no: ${PASSWORD}`, code: "x" } },
    });
    for (const t of [stub(), refused]) {
      const answer = JSON.stringify(
        await setPasswordIn(t.db, PASSWORD, PASSWORD),
      );
      expect(answer).not.toContain(PASSWORD);
      expect(answer).not.toContain("no:");
    }
  });
});

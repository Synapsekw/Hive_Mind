import { afterEach, describe, expect, it, vi } from "vitest";
import { claimIn } from "./claim";

type Res = { data: unknown; error: { message: string; code?: string } | null };

function stub(answer: Res | (() => never)) {
  const rpc = vi.fn(async (_name: string, _args?: unknown) =>
    typeof answer === "function" ? answer() : answer,
  );
  return { db: { rpc } as never, rpc };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("claimIn", () => {
  it("calls claim_invitations with no arguments and answers the number joined", async () => {
    const t = stub({ data: 2, error: null });
    expect(await claimIn(t.db)).toBe(2);
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("claim_invitations");
  });

  it("answers 0 when nothing was joined, saying nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await claimIn(stub({ data: 0, error: null }).db)).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });

  it("answers 0 when the database refuses, logging code and message only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      data: 3,
      error: {
        message: "sign in as a person",
        code: "P0001",
        details: "secret payload",
      } as never,
    });
    expect(await claimIn(t.db)).toBe(0);
    expect(log).toHaveBeenCalledWith(
      "claim_invitations failed",
      "P0001",
      "sign in as a person",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret payload");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "2"],
    ["a list", [1]],
    ["an object", { n: 1 }],
    ["a negative number", -1],
    ["a fraction", 1.5],
    ["not a number", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
  ])("answers 0 when the function returned %s", async (_name, data) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await claimIn(stub({ data, error: null }).db)).toBe(0);
  });

  it("answers 0 when the client throws, logging only the name of what was thrown", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub(() => {
      throw new TypeError("fetch failed for someone@example.com");
    });
    await expect(claimIn(t.db)).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith("claim_invitations failed", "TypeError");
    expect(JSON.stringify(log.mock.calls)).not.toContain("someone@");
  });

  it("answers 0 when the client throws something that is not an error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub(() => {
      throw "boom";
    });
    await expect(claimIn(t.db)).resolves.toBe(0);
  });

  it("answers 0 for a client without rpc", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(claimIn({} as never)).resolves.toBe(0);
  });
});

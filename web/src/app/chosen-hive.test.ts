import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import {
  HIVE_COOKIE,
  chosenHiveId,
  hiveCookie,
  noHiveCookie,
} from "./chosen-hive";

const HIVE = "00000000-0000-4000-8000-000000000b01";

function jar(value?: string) {
  const get = vi.fn((name: string) =>
    value !== undefined && name === HIVE_COOKIE ? { name, value } : undefined,
  );
  mocks.cookies.mockResolvedValue({ get });
  return { get };
}

afterEach(() => vi.resetAllMocks());

describe("chosenHiveId", () => {
  it("is the id the hm_hive cookie holds", async () => {
    const j = jar(HIVE);
    expect(await chosenHiveId()).toBe(HIVE);
    expect(j.get).toHaveBeenCalledWith("hm_hive");
  });

  it("answers the id in lower case, however it was written", async () => {
    jar("00000000-0000-4000-8000-000000000B01");
    expect(await chosenHiveId()).toBe(HIVE);
  });

  it.each([
    ["no cookie", undefined],
    ["an empty value", ""],
    ["a word", "synapse"],
    ["an id with more after it", `${HIVE}x`],
    ["a path", "/settings"],
  ])("is null for %s", async (_n, value) => {
    jar(value);
    expect(await chosenHiveId()).toBeNull();
  });

  it("is null outside a request, where there are no cookies", async () => {
    mocks.cookies.mockRejectedValue(new Error("outside a request scope"));
    expect(await chosenHiveId()).toBeNull();
    mocks.cookies.mockImplementation(() => {
      throw new Error("outside a request scope");
    });
    expect(await chosenHiveId()).toBeNull();
  });
});

describe("the cookie", () => {
  it("lasts a year, is sent to every page, and no script can read it", () => {
    expect(hiveCookie(HIVE, false)).toEqual({
      name: "hm_hive",
      value: HIVE,
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 31536000,
    });
  });

  it("is Secure in production", () => {
    expect(hiveCookie(HIVE, true).secure).toBe(true);
    expect(noHiveCookie(true).secure).toBe(true);
  });

  it("is taken away by the same cookie with no value and no life", () => {
    expect(noHiveCookie(false)).toEqual({
      name: "hm_hive",
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 0,
    });
  });
});

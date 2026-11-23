import { describe, expect, it } from "vitest";
import { afterSignIn, confirmAddress } from "./next";

const ORIGIN = "https://hive.example";
const CONSENT = "/oauth/consent?authorization_id=x";

describe("confirmAddress: where the emailed link lands", () => {
  it("is the plain confirm address with no next", () => {
    expect(confirmAddress(ORIGIN, "/")).toBe(`${ORIGIN}/auth/confirm`);
  });

  it("carries a same-site next, encoded", () => {
    expect(confirmAddress(ORIGIN, CONSENT)).toBe(
      `${ORIGIN}/auth/confirm?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dx`,
    );
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil", "/a\tb"])(
    "drops a next that is not a path on this site: %s",
    (next) => {
      expect(confirmAddress(ORIGIN, next)).toBe(`${ORIGIN}/auth/confirm`);
    },
  );
});

describe("afterSignIn: where a password sign-in goes", () => {
  it("is home with no next", () => {
    expect(afterSignIn(null)).toBe("/");
    expect(afterSignIn(undefined)).toBe("/");
  });

  it("is the same-site next", () => {
    expect(afterSignIn(CONSENT)).toBe(CONSENT);
  });

  it.each(["https://evil.example", "//evil.example", "javascript:alert(1)"])(
    "is home for %s",
    (next) => {
      expect(afterSignIn(next)).toBe("/");
    },
  );

  it("takes the first of a repeated next", () => {
    expect(afterSignIn([CONSENT, "/vault"])).toBe(CONSENT);
  });
});

import { describe, expect, it } from "vitest";
import {
  IN_THIS_BROWSER,
  SIGNED_IN_NOW,
  SIGN_OUT_AND_CONTINUE,
  STAY_AS,
  SWITCHED,
  SWITCH_WARNING,
  invitedBy,
  passwordMessage,
  openUntil,
} from "./text";

describe("the Join page's sentences", () => {
  it("names who invited", () => {
    expect(invitedBy("Danijel")).toBe("Invited by Danijel");
  });

  it("names the day an invitation lapses, in UTC whatever the reader's clock", () => {
    expect(openUntil("2026-12-07T23:30:00+00:00")).toBe(
      "Open until 7 December",
    );
    expect(openUntil("2026-12-07T00:30:00+02:00")).toBe(
      "Open until 6 December",
    );
  });

  it("warns, in the agreed words, that Continue signs in someone else", () => {
    expect(
      `${SIGNED_IN_NOW} ana@example.com ${IN_THIS_BROWSER} ${SWITCH_WARNING}`,
    ).toBe(
      "You are signed in as ana@example.com in this browser. Continuing signs this browser out of that account and signs in the address this invitation was sent to. If you did not expect an invitation, do not continue.",
    );
    expect(SIGN_OUT_AND_CONTINUE).toBe("Sign out and continue");
    expect(`${STAY_AS} ana@example.com`).toBe(
      "Stay signed in as ana@example.com",
    );
    expect(SWITCHED).toBe("You are now signed in with a different account.");
  });

  it("says nothing for a time it cannot read", () => {
    expect(openUntil("soon")).toBe("");
  });
});

describe("the password step's sentences", () => {
  it("has the agreed words for each reason", () => {
    expect(passwordMessage("short")).toBe("Use at least 10 characters.");
    expect(passwordMessage("long")).toBe("That password is too long.");
    expect(passwordMessage("different")).toBe(
      "The two passwords are not the same.",
    );
    expect(passwordMessage("refused")).toBe(
      "That password was not accepted. Try a different one.",
    );
    expect(passwordMessage("failed")).toMatch(/skip for now/);
  });
});

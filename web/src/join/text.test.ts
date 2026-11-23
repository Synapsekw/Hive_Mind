import { describe, expect, it } from "vitest";
import {
  SIGNED_IN_NOW,
  SWITCHED,
  SWITCH_WARNING,
  invitedBy,
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
    expect(`${SIGNED_IN_NOW} ana@example.com. ${SWITCH_WARNING}`).toBe(
      "You are signed in as ana@example.com. This link signs you in as the person it was sent to. If you did not expect an invitation, do not continue.",
    );
    expect(SWITCHED).toBe("You are now signed in with a different account.");
  });

  it("says nothing for a time it cannot read", () => {
    expect(openUntil("soon")).toBe("");
  });
});

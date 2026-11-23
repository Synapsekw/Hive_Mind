// Sample invitations for the development page and the browser tests. Nothing here is real.
import type { Waiting } from "./types";

export const FIXTURE_WAITING: Waiting[] = [
  {
    id: "00000000-0000-4000-8000-00000000d001",
    hiveName: "Synapse",
    invitedBy: "Danijel",
    expiresAt: "2026-12-07T10:00:00+00:00",
  },
  {
    id: "00000000-0000-4000-8000-00000000d002",
    hiveName: "Atlas Research",
    invitedBy: "Mira",
    expiresAt: "2026-12-02T10:00:00+00:00",
  },
];

/** Shaped like the hashed token of an emailed link; the auth server has never seen it. */
export const FIXTURE_TOKEN =
  "f1x7ure0f1x7ure0f1x7ure0f1x7ure0f1x7ure0f1x7ure0f1x7ure0";

/** The address of the person the fixture is signed in as. */
export const FIXTURE_EMAIL = "ana@example.com";

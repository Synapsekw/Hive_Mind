/** One invitation waiting for the signed-in person's own confirmed address. */
export type Waiting = {
  id: string;
  /** The hive's name: its owner's words. Shown as text only. */
  hiveName: string;
  /** Who invited: that person's own name for themselves. Shown as text only; may be empty. */
  invitedBy: string;
  expiresAt: string;
};

/** What the Join page shows. */
export type JoinView =
  /**
   * An emailed link was opened: one button that spends it. `email` is the address of whoever
   * is signed in already (empty for nobody): pressing the button replaces their session.
   */
  | {
      kind: "continue";
      tokenHash: string;
      type: "invite" | "magiclink";
      email: string;
    }
  /** The link is too old, was used already or is not a link at all. */
  | { kind: "expired" }
  /**
   * Signed in: the invitations waiting, possibly none, and the address of the person signed
   * in (empty when it is not known). Shown as text only. `switched` when Continue has just
   * replaced another person's session.
   */
  | { kind: "list"; waiting: Waiting[]; email: string; switched: boolean }
  /** Signed in, but the invitations could not be read. */
  | { kind: "error" };

/** Whether Join worked. Nothing else comes back: the map is read again from the database. */
export type Joined = { ok: boolean };

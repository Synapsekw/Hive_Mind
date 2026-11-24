// What the Join page does, given a client that carries the visitor's cookies.
//
// An invitation email holds one link to `/join?token_hash=…&type=…`. Opening it spends nothing:
// `viewOf` only decides what to draw. The link is spent by `continueIn`, which the Continue
// button's server action calls, so a mail scanner that pre-opens the link cannot use it up.
// Once signed in, `waitingIn` lists the invitations for the person's own confirmed address and
// `acceptIn` joins one. The database decides whose invitations they are and whether joining is
// allowed; nothing here checks membership.
//
// A log line carries an error's code and message, or the name of what was thrown. Never the
// token, an address or a row.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Waiting } from "../../join/types";
import { isUuid } from "../vault/validate";

type Res = { data: unknown; error: { code?: string; message: string } | null };
type Query = Record<string, string | string[] | undefined>;

export type LinkType = "invite" | "magiclink";

/** The page before anything is read from the database. */
export type Visit =
  | { kind: "continue"; tokenHash: string; type: LinkType }
  | { kind: "expired" }
  | { kind: "list"; switched: boolean };

/** The hashed token of an emailed link: 20 to 200 URL-safe characters. */
const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;
const MOST = 20;
const NAME_MAX = 80;
/** The longest address an email can have. */
const EMAIL_MAX = 254;
/** Control characters and the marks that hide text or change its direction. */
const UNSEEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

function isToken(v: unknown): v is string {
  return typeof v === "string" && TOKEN.test(v);
}

function isLinkType(v: unknown): v is LinkType {
  return v === "invite" || v === "magiclink";
}

/**
 * What a visit shows, from its query alone. A visit that names a token is either the Continue
 * button or, when the token or its type is not one an invitation carries, the expired line.
 */
export function viewOf(query: Query): Visit {
  if (query.token_hash !== undefined) {
    return isToken(query.token_hash) && isLinkType(query.type)
      ? { kind: "continue", tokenHash: query.token_hash, type: query.type }
      : { kind: "expired" };
  }
  if (query.error === "expired") return { kind: "expired" };
  // Only a notice on the list: it opens nothing, and a visitor with no session never sees it.
  return { kind: "list", switched: query.switched === "1" };
}

/** The id of whoever the auth server says is signed in; null for nobody or when it cannot say. */
async function userIdIn(
  db: Pick<SupabaseClient, "auth">,
): Promise<string | null> {
  try {
    const { data } = await db.auth.getUser();
    const id: unknown = data?.user?.id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/** Signs this browser out and nothing more; a failure is left for the caller's answer to carry. */
async function signOutIn(db: Pick<SupabaseClient, "auth">): Promise<void> {
  try {
    await db.auth.signOut({ scope: "local" });
  } catch {
    // Nothing more can be done from here.
  }
}

/**
 * Spends the emailed link and signs its holder in, in place of any session the browser held.
 * Anything but an invitation's own two link types and a well-formed token is expired, and the
 * auth server is not asked.
 *
 * A link can be opened by a person who is signed in as someone else (by mistake, or crafted
 * to move them into another account), so which account ends up signed in must never be in
 * doubt. In order:
 *   1. Who is signed in is read, to be able to say afterwards whether the account changed.
 *   2. This browser is signed out (this browser only: the person's other devices stay signed
 *      in). The link is then verified over a clean set of cookies, so no piece of the old
 *      session can survive beside the new one. The button that leads here says "Sign out and
 *      continue" whenever somebody is signed in. A link that turns out to have expired
 *      therefore leaves nobody signed in, and the page says the link has expired.
 *   3. The link is verified, which signs its own person in.
 *   4. The auth server is asked who is signed in. It must be the person the link's answer
 *      named. If it is anyone else, or nobody, the browser is signed out again and the answer
 *      is "expired": better no session than an unexpected one.
 * "switched" says the person signed in now is not the one signed in before, so the next page
 * can tell them. The same person is plain "ok".
 *
 * The proxy must not write session cookies on the request that runs this (it does not: see
 * `proxy.ts`). Two writers of the same cookies in one response is how the old account once
 * stayed signed in after a link was spent.
 */
export async function continueIn(
  db: Pick<SupabaseClient, "auth">,
  tokenHash: unknown,
  type: unknown,
): Promise<"ok" | "switched" | "expired"> {
  if (!isToken(tokenHash) || !isLinkType(type)) return "expired";
  try {
    const before = await userIdIn(db);
    // Always, not only when somebody could be named: cookies of a session that can no longer
    // be read are cleared the same way.
    await signOutIn(db);
    const { data, error } = await db.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) {
      console.error("invitation link refused", error.code, error.message);
      return "expired";
    }
    const named: unknown = data?.user?.id;
    const now = await userIdIn(db);
    if (typeof named !== "string" || !named || now !== named) {
      console.error("invitation link did not sign its own person in");
      await signOutIn(db);
      return "expired";
    }
    return before && before !== named ? "switched" : "ok";
  } catch (e) {
    console.error("invitation link failed", e instanceof Error ? e.name : "");
    return "expired";
  }
}

/**
 * Who the page is about to show invitations for: the address of the session, as the auth server
 * answers it (not read from the cookie). Shown so that a person whose session Continue replaced
 * can see whose invitations these are. Null when nobody is signed in.
 */
export async function signedInAs(
  db: Pick<SupabaseClient, "auth">,
): Promise<{ email: string } | null> {
  try {
    const { data } = await db.auth.getUser();
    const user = data?.user;
    if (!user) return null;
    const email: unknown = user.email;
    return {
      email:
        typeof email === "string"
          ? email.replace(UNSEEN, "").trim().slice(0, EMAIL_MAX)
          : "",
    };
  } catch (e) {
    console.error("join session read failed", e instanceof Error ? e.name : "");
    return null;
  }
}

/** Another person's words, made safe to show in one line: trimmed, unseen marks out, cut short. */
function shown(v: string): string {
  return v.replace(UNSEEN, "").trim().slice(0, NAME_MAX);
}

function toWaiting(v: unknown): Waiting | null {
  if (typeof v !== "object" || v === null) return null;
  const { id, hive_name, invited_by, expires_at } = v as Record<
    string,
    unknown
  >;
  if (!isUuid(id) || typeof hive_name !== "string") return null;
  // Empty when the inviter is no longer a member; never missing.
  if (typeof invited_by !== "string") return null;
  if (typeof expires_at !== "string" || Number.isNaN(Date.parse(expires_at)))
    return null;
  return {
    id,
    hiveName: shown(hive_name),
    invitedBy: shown(invited_by),
    expiresAt: expires_at,
  };
}

/** The open invitations for the signed-in person's own address, 20 at most; "error" otherwise. */
export async function waitingIn(
  db: Pick<SupabaseClient, "rpc">,
): Promise<Waiting[] | "error"> {
  try {
    const res = (await db.rpc("my_invitations")) as Res;
    if (res.error) {
      console.error("my_invitations failed", res.error.code, res.error.message);
      return "error";
    }
    const rows = Array.isArray(res.data)
      ? res.data.slice(0, MOST).map(toWaiting)
      : null;
    if (!rows || rows.some((r) => r === null)) {
      console.error("my_invitations answer has an unexpected shape");
      return "error";
    }
    return rows as Waiting[];
  } catch (e) {
    console.error("my_invitations failed", e instanceof Error ? e.name : "");
    return "error";
  }
}

/**
 * Joins the hive of one invitation. The database refuses one that is not the caller's. On
 * success `hiveId` is the joined hive's id as `accept_invitation` answers it (lower case), or
 * null when the answer is not an id: the person has joined either way.
 */
export async function acceptIn(
  db: Pick<SupabaseClient, "rpc">,
  id: unknown,
): Promise<{ ok: false } | { ok: true; hiveId: string | null }> {
  if (!isUuid(id)) return { ok: false };
  try {
    const res = (await db.rpc("accept_invitation", {
      p_invitation: id,
    })) as Res;
    if (res.error) {
      console.error(
        "accept_invitation failed",
        res.error.code,
        res.error.message,
      );
      return { ok: false };
    }
    return {
      ok: true,
      hiveId: isUuid(res.data) ? res.data.toLowerCase() : null,
    };
  } catch (e) {
    console.error("accept_invitation failed", e instanceof Error ? e.name : "");
    return { ok: false };
  }
}

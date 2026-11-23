// What the approval window's server action does, given a client signed in as the person. An app
// (Claude, ChatGPT) asked to connect; the person approves or denies.
//
// Approve: the request is read again from the auth server, here, and the app is recorded by the
// id that answer names. The browser sends only the request's id, the decision and the chosen
// workspace. The database (`connect_app`) is given the app's id and the workspace and nothing
// else: it looks the app up in the auth server's own record, takes its name from there, checks
// that the workspace is the person's own, and works out how far the app is trusted from every
// address the app registered. The name and the host this file reads are for the window to show.
// Only when `connect_app` has succeeded is the request approved, so an app is never approved
// without being recorded. Deny records nothing.
//
// A request the auth server answers with only a return address was approved before (the person
// already approved this app, or pressed twice). The browser is sent back and nothing is recorded:
// what the app's pass may do is decided by the database at every call, which refuses a pass whose
// app the person has not connected here or has revoked.
//
// Only an error's code and message are logged, never an address that carries a code.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sessionUserId } from "../../own-hive";
import { isUuid } from "../../vault/validate";

type Db = Pick<SupabaseClient, "rpc" | "auth">;
type Res = { data: unknown; error: { code?: string; message: string } | null };

export type Decision = "approve" | "deny";
export type Outcome = { ok: true; redirect: string } | { ok: false };

/** What the auth server says about a request: still to be answered, or answered already. */
export type Details =
  | {
      kind: "ask";
      clientId: string;
      /** The name the app gave itself, or its host when it gave none. Never empty. Shown only. */
      name: string;
      /**
       * The lower-cased host the app returns to; empty when its address does not parse. Shown
       * only: it takes no part in how far the app is trusted.
       */
      host: string;
    }
  | { kind: "answered"; redirect: string };

const NO: Outcome = { ok: false };
const NAME_MAX = 120;
const CLIENT_MAX = 200;
/** A request id is an opaque token: letters, digits and the marks tokens are made of. */
const ID = /^[A-Za-z0-9._~-]{1,200}$/;
/** Schemes a browser would run or open locally instead of going somewhere. */
const NOT_AN_ADDRESS = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "blob:",
  "file:",
  "about:",
]);

export function isAuthorizationId(v: unknown): v is string {
  return typeof v === "string" && ID.test(v);
}

/** The lower-cased host of an address, without its port; empty when it does not parse. */
export function returnHost(uri: unknown): string {
  if (typeof uri !== "string") return "";
  try {
    return new URL(uri).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** An address the browser may be sent to after the decision: absolute, and not a script. */
export function safeReturn(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    return NOT_AN_ADDRESS.has(new URL(v).protocol) ? null : v;
  } catch {
    return null;
  }
}

/**
 * The auth server's answer about one request, checked. An answer that carries no
 * `authorization_id` but a return address means the request was answered before. Null when the
 * answer has an unexpected shape.
 */
export function readDetails(data: unknown): Details | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.authorization_id === undefined || d.authorization_id === null) {
    const redirect = safeReturn(d.redirect_url);
    return redirect ? { kind: "answered", redirect } : null;
  }
  if (typeof d.client !== "object" || d.client === null) return null;
  const { id, name } = d.client as Record<string, unknown>;
  if (typeof id !== "string" || id.length < 1 || id.length > CLIENT_MAX)
    return null;
  const host = returnHost(d.redirect_uri);
  const given = typeof name === "string" ? name.trim().slice(0, NAME_MAX) : "";
  return { kind: "ask", clientId: id, name: given || host || id, host };
}

function failed(what: string, res: Res): boolean {
  if (!res.error) return false;
  console.error(`${what} failed`, res.error.code, res.error.message);
  return true;
}

function back(what: string, res: Res): Outcome {
  if (failed(what, res)) return NO;
  const redirect = safeReturn(
    (res.data as { redirect_url?: unknown } | null)?.redirect_url,
  );
  if (!redirect) {
    console.error(`${what} answered no usable return address`);
    return NO;
  }
  return { ok: true, redirect };
}

/** Never opens the address from here: the screen does, once it has the answer. */
const STAY = { skipBrowserRedirect: true };

export async function decideIn(db: Db, input: unknown): Promise<Outcome> {
  try {
    if (typeof input !== "object" || input === null) return NO;
    const { authorizationId, decision, workspaceId } = input as Record<
      string,
      unknown
    >;
    if (!isAuthorizationId(authorizationId)) return NO;
    if (decision !== "approve" && decision !== "deny") return NO;
    if (decision === "approve" && !isUuid(workspaceId)) return NO;
    if (!(await sessionUserId(db))) return NO;

    if (decision === "deny") {
      return back(
        "deny",
        (await db.auth.oauth.denyAuthorization(authorizationId, STAY)) as Res,
      );
    }

    const read = (await db.auth.oauth.getAuthorizationDetails(
      authorizationId,
    )) as Res;
    if (failed("authorization details", read)) return NO;
    const details = readDetails(read.data);
    if (!details) {
      console.error("authorization details have an unexpected shape");
      return NO;
    }
    // Answered before (a second press, another tab): nothing to record, only the way back.
    if (details.kind === "answered")
      return { ok: true, redirect: details.redirect };

    const connected = (await db.rpc("connect_app", {
      p_client_id: details.clientId,
      p_workspace: workspaceId,
    })) as Res;
    if (failed("connect_app", connected)) return NO;

    return back(
      "approve",
      (await db.auth.oauth.approveAuthorization(authorizationId, STAY)) as Res,
    );
  } catch (e) {
    console.error("consent decision failed", e instanceof Error ? e.name : "");
    return NO;
  }
}

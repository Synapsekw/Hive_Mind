// invite-email: an invitation's id in, one invitation email out.
//
// The database decides whether the caller may send for this invitation: the
// function calls `invitation_to_email` with the caller's own session and gets
// the address back, or a refusal it passes on. With the project's secret key
// it then asks Supabase Auth for a sign-in link without having Auth send
// anything, and mails that link through Resend.
//
// The request carries an id and nothing else: the address comes from the
// database, the site from a function secret, the words from this file. The
// email names no hive and no person, since those are words an owner chose.
// Nothing here logs or returns an address, a token, the bearer or a key, and
// the answer never says which kind of link was made.
//
// Web platform only (Request, Response, fetch, URL), so the same file runs in
// the Edge runtime and under `node --test`.

export type Env = {
  url: string;
  anonKey: string;
  secretKey: string | undefined;
  resendKey: string | undefined;
  from: string | undefined;
  siteUrl: string | undefined;
};

type LinkType = "invite" | "magiclink";

const MAX_BODY_BYTES = 2048;
// Per call. The web app that calls this has ten seconds in all.
const TIMEOUT_MS = 5_000;
const RESEND_URL = "https://api.resend.com/emails";

const BAD_REQUEST = "send a JSON body with an invitation";
const SIGN_IN = "sign in";
const NOT_ALLOWED = "not allowed";
const WAIT = "wait before sending again";
const SPENT = "too many emails for this invitation";
const NOT_SENT = "the email could not be sent";
const NOT_SET_UP = "email is not set up";

const SUBJECT = "You have been invited to a hive on Hive Mind";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A session's access token is a JWT; this only keeps anything else out of a
// header. Whether it is a valid session is the database's question.
const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{20,8192})$/;
// What the Join page accepts as a token: 20 to 200 URL-safe characters.
const TOKEN_HASH = /^[A-Za-z0-9_-]{20,200}$/;
// One plain address, as the database accepts them: one @, no whitespace, no
// control character, 254 at most (a dot in the domain is not required). On top
// of that a comma, an angle bracket or a quote is refused, so what is handed
// to the mail service can never read as a list or a display name.
const ADDRESS = /^[^\s@<>,"]+@[^\s@<>,"]+$/;
const ADDRESS_MAX = 254;
const FROM_MAX = 320;
const CONTROL = /[\u0000-\u001f\u007f]/;

function answer(
  status: number,
  body: unknown,
  extra?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

// A failure is logged as one fixed phrase: never an address, a token, a key,
// another service's own words or an exception's message.
function fail(
  status: number,
  error: string,
  reason: string,
  extra?: Record<string, string>,
): Response {
  console.error(`invite-email: ${reason}`);
  return answer(status, { error }, extra);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function drop(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}

async function jsonOf(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

// The body as text, or the status to refuse it with. The cap is on the bytes
// actually read; Content-Length is only a way to refuse sooner.
async function readBody(req: Request): Promise<string | 400 | 413> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return 413;
  if (req.body === null) return 400;

  const reader = req.body.getReader();
  const bytes = new Uint8Array(MAX_BODY_BYTES);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return 413;
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, length),
    );
  } catch {
    return 400;
  }
}

// Exactly `{ "invitation": "<uuid>" }`. Any other key is refused, so a request
// has nowhere to put an address, a link type or a site of its own.
function invitationFrom(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== "invitation") return null;
  const id = parsed.invitation;
  if (typeof id !== "string" || id.length !== 36) return null;
  const lower = id.toLowerCase();
  return UUID.test(lower) ? lower : null;
}

// The site the link points to, as an origin with no trailing slash: https
// (or http on localhost, for development), and nothing after the host. The
// sign-in token is sent there, so a secret that is anything else is refused.
function siteFrom(raw: string | undefined): string | null {
  if (!raw || raw.length > 200 || /\s/.test(raw) || CONTROL.test(raw)) {
    return null;
  }
  if (/[?#@\\]/.test(raw)) return null;
  let site: URL;
  try {
    site = new URL(raw);
  } catch {
    return null;
  }
  const local = site.protocol === "http:" && site.hostname === "localhost";
  if (site.protocol !== "https:" && !local) return null;
  if (site.username || site.password || site.search || site.hash) return null;
  if (site.pathname !== "/" || !site.hostname) return null;
  return site.origin;
}

function addressFrom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length > ADDRESS_MAX || CONTROL.test(value)) return null;
  return ADDRESS.test(value) ? value : null;
}

// Auth's "this address already has a confirmed account". Its body is
// `{ code: 422, error_code: "email_exists", msg }`; with a newer API version
// header it is `{ code: "email_exists", message }`, and the code is also sent
// as the `x-sb-error-code` header. All three are read.
function saysExists(res: Response, body: unknown): boolean {
  if (res.status !== 422 && res.status !== 400) return false;
  if (res.headers.get("x-sb-error-code") === "email_exists") return true;
  if (!isRecord(body)) return false;
  if (body.error_code === "email_exists" || body.code === "email_exists") {
    return true;
  }
  return [body.msg, body.message].some(
    (m) => typeof m === "string" && m.includes("already been registered"),
  );
}

// What is used of a generate_link answer: the token hash and the account's
// id, or null when either is missing or unusable. Auth puts both at the top
// level; the client libraries show them under `properties` and `user`, so both
// places are read. Nothing else is used: not the link Auth built, not the
// six-digit code, not what Auth knows about the person.
type Made = { tokenHash: string; userId: string };

function madeFrom(body: unknown, type: LinkType): Made | null {
  if (!isRecord(body)) return null;
  const source =
    typeof body.hashed_token === "string"
      ? body
      : isRecord(body.properties)
        ? body.properties
        : null;
  if (source === null) return null;
  // A link of another kind than the one asked for is not put in an email.
  const kind = source.verification_type;
  if (kind !== undefined && kind !== type) return null;
  const tokenHash = source.hashed_token;
  if (typeof tokenHash !== "string" || !TOKEN_HASH.test(tokenHash)) return null;

  const id =
    typeof body.id === "string"
      ? body.id
      : isRecord(body.user)
        ? body.user.id
        : undefined;
  if (typeof id !== "string" || id.length !== 36) return null;
  const userId = id.toLowerCase();
  if (!UUID.test(userId)) return null;
  return { tokenHash, userId };
}

// A password nobody knows: 32 random bytes as base64url, then one character
// of each kind so a project's password rules cannot refuse it. It is sent to
// Auth once and kept nowhere.
function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const random = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${random}aA1!`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The whole email. Everything in it is fixed but the link, and the link is
// the site secret plus a token hash checked against TOKEN_HASH.
function emailFor(link: string): { text: string; html: string } {
  const intro =
    "You have been invited to a hive on Hive Mind, a shared memory for a small team.";
  const after =
    "The link signs you in. After that you see which hive it is and who invited you, and you choose whether to join. Nobody is added to a hive, and nothing is shared, until you press Join.";
  const once =
    "The link works once and for a limited time. If it has expired, ask the person who invited you to send it again.";
  const ignore =
    "If you were not expecting an invitation, you can ignore this email.";

  const text = [
    intro,
    `Open invitation:\n${link}`,
    after,
    once,
    ignore,
    "",
  ].join("\n\n");

  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(SUBJECT)}</title>`,
    "</head>",
    "<body style=\"margin:0;padding:24px;background:#ffffff;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;\">",
    '<div style="max-width:520px;margin:0 auto;">',
    `<p>${escapeHtml(intro)}</p>`,
    `<p style="margin:28px 0;"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Open invitation</a></p>`,
    `<p>${escapeHtml(after)}</p>`,
    `<p>${escapeHtml(once)}</p>`,
    `<p style="color:#555555;">${escapeHtml(ignore)}</p>`,
    "</div>",
    "</body>",
    "</html>",
    "",
  ].join("\n");

  return { text, html };
}

/**
 * Answer one request.
 */
export async function handle(
  req: Request,
  env: Env,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (req.method !== "POST") {
    return fail(405, "use POST", "not a POST", { Allow: "POST" });
  }

  const body = await readBody(req);
  if (body === 413) return fail(413, "request too large", "body too large");
  if (body === 400) return fail(400, BAD_REQUEST, "unreadable body");
  const invitation = invitationFrom(body);
  if (invitation === null) {
    return fail(400, BAD_REQUEST, "no usable invitation in body");
  }

  const bearer = BEARER.exec(req.headers.get("authorization") ?? "")?.[1];
  if (bearer === undefined) return fail(401, SIGN_IN, "no bearer");

  // Everything is checked before the database is asked, so a function that
  // cannot send never uses up one of an invitation's emails.
  const base = env.url.replace(/\/+$/, "");
  if (!base || !env.anonKey) {
    return fail(503, NOT_SET_UP, "project address or key missing");
  }
  const { secretKey, resendKey, from } = env;
  if (!secretKey) return fail(503, NOT_SET_UP, "secret key missing");
  if (!resendKey) return fail(503, NOT_SET_UP, "mail key missing");
  if (!from || from.length > FROM_MAX || CONTROL.test(from)) {
    return fail(503, NOT_SET_UP, "sender missing or unusable");
  }
  const site = siteFrom(env.siteUrl);
  if (site === null) {
    return fail(503, NOT_SET_UP, "site address missing or unusable");
  }

  // 1. The database, as the caller: may this person send for this invitation,
  //    and to which address?
  let email: string | null;
  try {
    const res = await fetchFn(`${base}/rest/v1/rpc/invitation_to_email`, {
      method: "POST",
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_invitation: invitation }),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 400) {
      // The function raised. Only the two limits are told apart; the
      // database's words are compared, never passed on.
      const raised = await jsonOf(res);
      const message = isRecord(raised) ? raised.message : undefined;
      if (message === WAIT) {
        return fail(429, WAIT, "invitation_to_email answered wait");
      }
      if (message === SPENT) {
        return fail(409, SPENT, "invitation_to_email answered too many");
      }
      return fail(403, NOT_ALLOWED, "invitation_to_email refused");
    }
    if (res.status === 401) {
      await drop(res);
      return fail(401, SIGN_IN, "the session was not accepted");
    }
    if (res.status === 403) {
      await drop(res);
      return fail(403, NOT_ALLOWED, "invitation_to_email answered 403");
    }
    if (res.status !== 200) {
      await drop(res);
      return fail(502, NOT_SENT, `invitation_to_email answered ${res.status}`);
    }
    email = addressFrom(await jsonOf(res));
  } catch {
    return fail(502, NOT_SENT, "invitation_to_email could not be reached");
  }
  if (email === null) {
    return fail(
      502,
      NOT_SENT,
      "invitation_to_email returned no usable address",
    );
  }

  // 2. Supabase Auth, with the secret key: a sign-in link it does not send.
  //    `invite` for an address with no confirmed account; an address with one
  //    is refused for that, and gets `magiclink` instead.
  const adminHeaders = {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  };
  const makeLink = async (
    type: LinkType,
  ): Promise<Made | "exists" | number | null> => {
    const res = await fetchFn(`${base}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ type, email }),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await jsonOf(res);
    if (res.status === 200) return madeFrom(body, type);
    if (type === "invite" && saysExists(res, body)) return "exists";
    return res.status;
  };

  let type: LinkType = "invite";
  let made: Made | "exists" | number | null;
  try {
    made = await makeLink(type);
    if (made === "exists") {
      type = "magiclink";
      made = await makeLink(type);
    }
  } catch {
    return fail(502, NOT_SENT, "generate_link could not be reached");
  }
  if (typeof made === "number") {
    return fail(502, NOT_SENT, `generate_link answered ${made}`);
  }
  if (made === null || made === "exists") {
    return fail(502, NOT_SENT, "generate_link returned no usable link");
  }

  // 2b. An account that is not confirmed yet may have been registered by
  //     someone else, with a password they know. Before its owner is let in,
  //     that password is replaced by one nobody knows. A confirmed person's
  //     own password (`magiclink`) is never touched. Auth withdraws an
  //     account's open links when its password is set, so the link that is
  //     mailed is made afterwards, and must be for the same account.
  if (type === "invite") {
    const userId = made.userId;
    try {
      const res = await fetchFn(`${base}/auth/v1/admin/users/${userId}`, {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({ password: randomPassword() }),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await drop(res);
      if (res.status !== 200) {
        return fail(
          502,
          NOT_SENT,
          `setting the password answered ${res.status}`,
        );
      }
    } catch {
      return fail(502, NOT_SENT, "the password could not be set");
    }

    try {
      made = await makeLink(type);
    } catch {
      return fail(502, NOT_SENT, "generate_link could not be reached again");
    }
    if (typeof made === "number") {
      return fail(502, NOT_SENT, `generate_link then answered ${made}`);
    }
    if (made === null || made === "exists" || made.userId !== userId) {
      return fail(
        502,
        NOT_SENT,
        "generate_link returned no usable second link",
      );
    }
  }
  const tokenHash = made.tokenHash;

  // 3. Resend, with its own key: one email, to the one address.
  const link = `${site}/join?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`;
  const { text, html } = emailFor(link);
  try {
    const res = await fetchFn(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: SUBJECT,
        text,
        html,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await drop(res);
    if (!res.ok) {
      return fail(502, NOT_SENT, `the mail service answered ${res.status}`);
    }
  } catch {
    return fail(502, NOT_SENT, "the mail service could not be reached");
  }

  return answer(200, { ok: true });
}

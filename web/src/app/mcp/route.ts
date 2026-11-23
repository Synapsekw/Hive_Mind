// The address an app (Claude, ChatGPT) is given: `https://<site>/mcp`. This route decides
// nothing and holds no secret. Without a pass it answers 401 and names the document that says
// where to sign in; with one it forwards the request to the connector function and returns the
// answer. The connector and the database decide what the pass may do.
//
// What is forwarded: the method, the body (2 MB at most) and five headers. Cookies are never
// forwarded, so the person's own session cannot reach the connector, and no header or query of
// the request chooses where it goes: only `HIVE_CONNECTOR_URL` does. Nothing is logged.
import { metadataAddress } from "./origin";

// Reads the request's headers and an environment variable, so never prerendered or cached.
export const dynamic = "force-dynamic";

const MAX_BODY = 2 * 1024 * 1024;
const FORWARDED = [
  "authorization",
  "content-type",
  "accept",
  "mcp-protocol-version",
  "mcp-session-id",
];
/** The connector's headers that are returned; anything else (cookies included) is dropped. */
const RETURNED = ["content-type", "mcp-session-id", "mcp-protocol-version"];

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

const challenge = (request: Request) =>
  `Bearer resource_metadata="${metadataAddress(request)}"`;

/** True when the header carries a bearer pass with something in it. */
function hasPass(request: Request): boolean {
  return /^Bearer\s+\S/i.test(request.headers.get("authorization") ?? "");
}

/** The connector's address from the environment; null unless it is a web address. */
function connectorAddress(): string | null {
  const raw = process.env.HIVE_CONNECTOR_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** The body, read up to the cap; "too-large" as soon as it passes it. */
async function readBody(
  request: Request,
): Promise<ArrayBuffer | undefined | "too-large"> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY) return "too-large";
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => {});
      return "too-large";
    }
    chunks.push(value);
  }
  if (size === 0) return undefined;
  const whole = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    whole.set(chunk, at);
    at += chunk.byteLength;
  }
  return whole.buffer;
}

async function forward(request: Request): Promise<Response> {
  if (!hasPass(request)) {
    return json(
      401,
      { error: "sign in to the hive" },
      { "www-authenticate": challenge(request) },
    );
  }
  const address = connectorAddress();
  if (!address) return json(503, { error: "the connector is not set up" });

  let body: ArrayBuffer | undefined | "too-large";
  try {
    body = await readBody(request);
  } catch {
    return json(400, { error: "the request could not be read" });
  }
  if (body === "too-large") return json(413, { error: "request too large" });

  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  let answer: Response;
  try {
    answer = await fetch(address, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    // Not the error's text: it can name an inner address.
    return json(502, { error: "the connector could not be reached" });
  }

  const returned = new Headers({ "cache-control": "no-store" });
  for (const name of RETURNED) {
    const value = answer.headers.get(name);
    if (value !== null) returned.set(name, value);
  }
  if (answer.status === 401)
    returned.set("www-authenticate", challenge(request));
  // 204, 205 and 304 may not carry a body.
  const empty = [204, 205, 304].includes(answer.status);
  return new Response(empty ? null : await answer.arrayBuffer(), {
    status: answer.status,
    headers: returned,
  });
}

export const GET = forward;
export const POST = forward;
export const DELETE = forward;

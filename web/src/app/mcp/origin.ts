// The site's own public address, as the visitor typed it. Behind a host's proxy the request's
// URL can name an inner address, so the forwarded scheme and host come first, each taken only
// when it has the plain shape of one; otherwise the request's own URL decides. The answer is
// only ever written back to the caller (a header, a metadata document). It never chooses where
// a request is sent.

const HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::\d{1,5})?$/i;

/** The first value of a header that a chain of proxies may have appended to. */
function first(value: string | null): string {
  return (value ?? "").split(",")[0]!.trim();
}

export function siteOrigin(request: Request): string {
  const own = new URL(request.url);
  const proto = first(request.headers.get("x-forwarded-proto")).toLowerCase();
  const host = first(request.headers.get("x-forwarded-host"));
  if (!HOST.test(host)) return own.origin;
  const scheme =
    proto === "http" || proto === "https" ? proto : own.protocol.slice(0, -1);
  return `${scheme}://${host.toLowerCase()}`;
}

/** Where the document that names the sign-in server is. */
export function metadataAddress(request: Request): string {
  return `${siteOrigin(request)}/.well-known/oauth-protected-resource`;
}

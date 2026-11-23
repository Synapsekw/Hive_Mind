import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { safeNext } from "./lib/safe-next";

const OPEN = [/^\/login(\/|$)/, /^\/auth(\/|$)/];
// The fixture map under /dev is open in development only; in production it needs a sign-in.
if (process.env.NODE_ENV !== "production") OPEN.push(/^\/dev(\/|$)/);

// What a connecting app calls with its own pass, or with none: these never carry a person's
// session, so they pass straight through and the session cookies are not read or refreshed.
const MACHINE = [/^\/mcp(\/|$)/, /^\/\.well-known(\/|$)/];
// The approval window for a connecting app: a visitor is sent to sign in and comes back to the
// same address, query included.
const RETURNS = /^\/oauth\/consent(\/|$)/;
// The Join page. A visitor with no session may see it only when the address carries an emailed
// link's token (the page then shows one button, and spends nothing until it is pressed) or says
// that a link has expired. Any other visit is sent to sign in and comes back to the plain page:
// nothing of the query is carried along.
const JOIN = /^\/join\/?$/;
const JOIN_AFTER_SIGN_IN = `/login?next=${encodeURIComponent("/join")}`;

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (MACHINE.some((re) => re.test(pathname))) {
    return NextResponse.next({ request });
  }
  const isJoin = JOIN.test(pathname);
  const isOpen = OPEN.some((re) => re.test(pathname));
  const isLogin = /^\/login(\/|$)/.test(pathname);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Not configured: let the login page render (it explains what is missing).
  if (!url || !key) {
    if (isOpen) return NextResponse.next({ request });
    return NextResponse.redirect(new URL("/login", request.url));
  }

  let response = NextResponse.next({ request });
  // Cache headers @supabase/ssr asks for when it writes auth cookies, so no shared cache
  // stores one person's session for another.
  const headers: Record<string, string> = {};
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, cacheHeaders) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        Object.assign(headers, cacheHeaders);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [k, v] of Object.entries(headers)) {
          response.headers.set(k, v);
        }
      },
    },
  });

  // Refreshes the session and validates it with the auth server.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirect = (to: string) => {
    const res = NextResponse.redirect(new URL(to, request.url));
    // Carry refreshed session cookies and their cache headers onto the redirect.
    for (const cookie of response.cookies.getAll()) {
      res.cookies.set(cookie);
    }
    for (const [k, v] of Object.entries(headers)) {
      res.headers.set(k, v);
    }
    return res;
  };

  if (!user && isJoin) {
    const query = request.nextUrl.searchParams;
    if (query.has("token_hash") || query.get("error") === "expired")
      return response;
    return redirect(JOIN_AFTER_SIGN_IN);
  }
  if (!user && !isOpen) {
    return redirect(
      RETURNS.test(pathname)
        ? `/login?next=${encodeURIComponent(pathname + search)}`
        : "/login",
    );
  }
  // Signed in already: on to where the sign-in page was asked to return, a path on this site.
  if (user && isLogin) {
    return redirect(safeNext(request.nextUrl.searchParams.get("next")));
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff2?)$).*)",
  ],
};

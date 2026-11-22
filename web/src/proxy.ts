import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const OPEN = [/^\/login(\/|$)/, /^\/auth(\/|$)/];
// The fixture map under /dev is open in development only; in production it needs a sign-in.
if (process.env.NODE_ENV !== "production") OPEN.push(/^\/dev(\/|$)/);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
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

  if (!user && !isOpen) return redirect("/login");
  if (user && isLogin) return redirect("/");
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff2?)$).*)",
  ],
};

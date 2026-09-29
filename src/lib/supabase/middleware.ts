import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Public paths that never require a session. Everything else redirects to /login. */
const PUBLIC = [/^\/login$/, /^\/not-registered$/, /^\/auth\//, /^\/api\/cron\//, /^\/_next\//, /^\/favicon/, /^\/icon/, /^\/robots/];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() validates the JWT with the Auth server (never trust getSession() on the server).
  // If the Auth server can't be reached, treat the visitor as signed out rather than failing the request.
  const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((re) => re.test(path));

  if (!data.user && !isPublic) {
    // Browser fetches to our own API (streaming AI) need a machine-readable answer, not a redirect to an HTML login page.
    if (path.startsWith("/api/")) return NextResponse.json({ message: "You're signed out. Sign in again." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const dest = request.nextUrl.clone();
    dest.pathname = "/login";
    dest.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    const redirect = NextResponse.redirect(dest);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  return response;
}

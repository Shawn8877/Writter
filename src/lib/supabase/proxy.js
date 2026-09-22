import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { getSupabaseConfig } from "./config";

function protectedPath(pathname) {
  return ["/dashboard", "/create", "/novel"].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

function noStore(response) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

function loginRedirect(request, response, reason) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (reason) url.searchParams.set("reason", reason);
  const redirect = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = response.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return noStore(redirect);
}

export async function updateSession(request) {
  let response = noStore(NextResponse.next({ request }));
  const config = getSupabaseConfig();
  if (!config) {
    return protectedPath(request.nextUrl.pathname)
      ? loginRedirect(request, response, "setup")
      : response;
  }
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers = {}) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        const previousCookies = response.cookies.getAll();
        response = noStore(NextResponse.next({ request }));
        previousCookies.forEach((cookie) => response.cookies.set(cookie));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });
  // Verify with Auth, not the untrusted user in getSession(). Keep this call
  // immediately after client creation so refreshed cookies stay in sync.
  let user = null;
  let unavailable = false;
  try {
    const { data, error } = await supabase.auth.getUser();
    user = error ? null : data.user;
    unavailable = Boolean(error && (!error.status || error.status >= 500));
  } catch {
    unavailable = true;
  }
  if (!user && protectedPath(request.nextUrl.pathname)) {
    return loginRedirect(request, response, unavailable ? "unavailable" : undefined);
  }
  return noStore(response);
}

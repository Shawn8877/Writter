import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/server/request-origin";

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const supabase = await createSupabaseServerClient();
  let destination = supabase ? "/login?error=confirmation" : "/login?reason=setup";
  if (supabase && code && code.length < 4096) {
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) destination = "/dashboard";
    } catch { /* Redirect to a safe, generic error page. */ }
  }
  // Ignore arbitrary next/redirect parameters: no open redirects or token leaks.
  const response = NextResponse.redirect(new URL(destination, requestOrigin(request)));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/server/request-origin";

export async function GET(request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const supabase = await createSupabaseServerClient();
  let destination = supabase ? "/login?error=confirmation" : "/login?reason=setup";
  if (supabase && tokenHash && tokenHash.length < 4096 && ["email", "signup"].includes(type)) {
    try {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (!error) destination = "/dashboard";
    } catch { /* Do not expose authentication details in the redirect URL. */ }
  }
  const response = NextResponse.redirect(new URL(destination, requestOrigin(request)));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

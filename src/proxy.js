import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request) {
  return updateSession(request);
}

export const config = {
  matcher: ["/dashboard/:path*", "/create/:path*", "/novel/:path*", "/login", "/register", "/auth/:path*", "/api/:path*"],
};

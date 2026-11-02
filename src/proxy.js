import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request) {
  // Block before App Router streaming can turn a notFound page into HTTP 200.
  if (request.nextUrl.pathname.startsWith("/dev/") && process.env.NODE_ENV !== "development") {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/dashboard/:path*", "/create/:path*", "/novel/:path*", "/dev/:path*", "/login", "/register", "/auth/:path*", "/api/:path*"],
};

// Public project configuration only. Access to data is enforced by RLS.
export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey || anonKey.startsWith("sb_secret_")) return null;
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    // Catch accidentally configured legacy service-role JWTs as well.
    if (anonKey.startsWith("eyJ")) {
      const payload = JSON.parse(atob(anonKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.role !== "anon") return null;
    }
    return { url: parsed.origin, anonKey };
  } catch {
    return null;
  }
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseConfig());
}

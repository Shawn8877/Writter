import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const getServerAuth = cache(async () => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { supabase: null, user: null, reason: "setup" };
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      const unavailable = error && (!error.status || error.status >= 500);
      return { supabase, user: null, reason: unavailable ? "unavailable" : "unauthorized" };
    }
    return { supabase, user: data.user, reason: null };
  } catch {
    return { supabase, user: null, reason: "unavailable" };
  }
});

export async function getOptionalUser() {
  return (await getServerAuth()).user;
}

export async function getApiAuth() {
  const { supabase, user, reason } = await getServerAuth();
  const headers = { "Cache-Control": "private, no-store" };
  if (reason === "setup") return { supabase, user, error: Response.json({ error: "请先配置 Supabase。", code: "SUPABASE_NOT_CONFIGURED" }, { status: 503, headers }) };
  if (reason === "unavailable") return { supabase, user, error: Response.json({ error: "账号服务暂时不可用，请稍后重试。", code: "AUTH_UNAVAILABLE" }, { status: 503, headers }) };
  if (!user) return { supabase, user, error: Response.json({ error: "请先登录。", code: "UNAUTHORIZED" }, { status: 401, headers }) };
  return { supabase, user, error: null };
}

export async function requireUser() {
  const { user, reason } = await getServerAuth();
  if (!user) redirect(reason === "setup" || reason === "unavailable" ? `/login?reason=${reason}` : "/login");
  return user;
}

// Explicit ownership filtering complements database RLS. No service-role key.
export const requireNovelAccess = cache(async (id) => {
  const user = await requireUser();
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const { supabase } = await getServerAuth();
  const { data, error } = await supabase.from("novels").select("id, user_id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error) throw new Error("暂时无法读取小说，请检查数据库配置后重试。");
  if (!data) notFound();
  return { user, novel: data };
});

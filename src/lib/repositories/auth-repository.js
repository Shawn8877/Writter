import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

function client() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error("账号服务尚未配置，请先完成 Supabase 配置。");
  return supabase;
}

function authError(error) {
  const messages = {
    invalid_credentials: "邮箱或密码不正确，请重新输入。",
    email_not_confirmed: "请先打开注册确认邮件，验证邮箱后再登录。",
    user_already_exists: "这个邮箱已注册，请直接登录。",
    email_exists: "这个邮箱已注册，请直接登录。",
    weak_password: "密码强度不足，请使用更长且包含字母和数字的密码。",
    over_email_send_rate_limit: "确认邮件发送过于频繁，请稍后再试。",
    over_request_rate_limit: "操作过于频繁，请稍后再试。",
    signup_disabled: "当前暂未开放注册。",
  };
  return new Error(messages[error?.code] || (error?.status === 429 ? "操作过于频繁，请稍后再试。" : "账号服务暂时无法完成操作，请检查网络后重试。"));
}

function credentials(email, password, registering = false) {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error("请输入有效的邮箱地址。");
  if (typeof password !== "string" || !password || password.length > 256 || (registering && password.length < 8)) throw new Error(registering ? "密码需为 8 至 256 个字符。" : "请输入有效密码。");
  return { email: email.trim(), password };
}

export const authRepository = {
  isConfigured: isSupabaseConfigured,

  async getUser() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      if (error.name === "AuthSessionMissingError" || error.status === 401 || error.status === 403) return null;
      throw authError(error);
    }
    return data.user;
  },

  subscribe(callback) {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return () => {};
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // UI identity only. APIs always revalidate the user on the server.
      callback(session?.user ?? null, event);
    });
    return () => data.subscription.unsubscribe();
  },

  async signIn({ email, password }) {
    const { data, error } = await client().auth.signInWithPassword(credentials(email, password));
    if (error) throw authError(error);
    return data.user;
  },

  async signUp({ email, password, displayName }) {
    const values = credentials(email, password, true);
    const { data, error } = await client().auth.signUp({
      ...values,
      options: {
        data: { display_name: (displayName || "").trim().slice(0, 80) },
        emailRedirectTo: new URL("/auth/callback", window.location.origin).href,
      },
    });
    if (error) throw authError(error);
    return { user: data.user, needsConfirmation: !data.session };
  },

  async signOut() {
    const { error } = await client().auth.signOut({ scope: "local" });
    if (error) throw authError(error);
  },
};

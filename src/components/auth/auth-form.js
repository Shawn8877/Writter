"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ArrowRight, BookOpen, Mail, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Field } from "@/components/ui";
import { authRepository } from "@/lib/repositories/auth-repository";

const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function AuthForm({ mode, initialError = "", serviceUnavailable = false }) {
  const registering = mode === "register";
  const configured = authRepository.isConfigured();
  const hydrated = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(initialError);
  const [confirmationEmail, setConfirmationEmail] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (pending || !configured || !hydrated) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const email = String(values.get("email") || "");
    const password = String(values.get("password") || "");
    setError("");
    if (registering && password !== values.get("confirmation")) {
      setError("两次输入的密码不一致。");
      return;
    }
    setPending(true);
    try {
      if (registering) {
        const result = await authRepository.signUp({ email, password, displayName: String(values.get("displayName") || "") });
        if (result.needsConfirmation) {
          form.reset();
          setConfirmationEmail(email.trim());
          setPending(false);
          return;
        }
      } else {
        await authRepository.signIn({ email, password });
      }
      // Cookies must reach a fresh server request before protected content loads.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Revalidate the new session with a complete server navigation.
      window.location.assign("/dashboard");
    } catch (failure) {
      setError(failure.message || "暂时无法完成操作，请稍后重试。");
      setPending(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="auth-page page-container">
        <section className="auth-introduction">
          <div className="section-kicker">YOUR NEXT CHAPTER</div>
          <h1>{registering ? "每一个世界，\n都从你开始。" : "欢迎回来，\n故事还在继续。"}</h1>
          <p>让创意有处安放，让每一章都留下痕迹。<br />登录你的创作空间，接续未完的世界。</p>
          <div className="auth-benefit"><BookOpen size={19} /><span>设定、人物与正文，在同一个创作空间</span></div>
          <div className="auth-benefit"><ShieldCheck size={19} /><span>作品与长期记忆，仅属于你的账号</span></div>
        </section>
        <section className="auth-card panel" aria-labelledby="auth-title">
          <div className="section-kicker">NOVELAI STUDIO</div>
          <h2 id="auth-title">{registering ? "创建创作账号" : "登录工作室"}</h2>
          <p className="auth-card-subtitle">{registering ? "为你的下一个故事，留一个位置。" : "用邮箱和密码，回到你的作品。"}</p>

          {!configured && <div className="auth-notice" role="status"><strong>账号服务尚未配置</strong><p>请先按照项目配置指南连接 Supabase，再登录或注册。已有浏览器草稿仍然保留。</p></div>}
          {serviceUnavailable && configured && <p className="auth-notice" role="status">账号服务暂时不可用，请检查网络后重试。</p>}

          {confirmationEmail ? (
            <div className="auth-confirmation" role="status">
              <Mail size={30} />
              <h3>下一步，确认你的邮箱</h3>
              <p>请检查 <strong>{confirmationEmail}</strong> 的收件箱与垃圾邮件，打开确认链接后即可进入工作室。若该邮箱已注册，请直接登录。</p>
              <Link href="/login" className="button button-primary">前往登录<ArrowRight size={16} /></Link>
            </div>
          ) : (
            <form method="post" onSubmit={submit} aria-busy={pending || !hydrated}>
              <fieldset className="auth-fields" disabled={pending || !hydrated}>
              {registering && <Field label="笔名" htmlFor="display-name" hint="可以稍后再决定。"><input id="display-name" name="displayName" autoComplete="nickname" maxLength={80} placeholder="故事里的你" disabled={pending} /></Field>}
              <Field label="邮箱" htmlFor="auth-email"><input id="auth-email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" disabled={pending} /></Field>
              <Field label="密码" htmlFor="auth-password" hint={registering ? "至少 8 个字符，建议同时包含字母和数字。" : undefined}><input id="auth-password" name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 8 : undefined} maxLength={256} required placeholder={registering ? "设置登录密码" : "输入你的密码"} disabled={pending} /></Field>
              {registering && <Field label="确认密码" htmlFor="auth-confirmation"><input id="auth-confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={256} required placeholder="再次输入密码" disabled={pending} /></Field>}
              {error && <p className="field-error auth-form-error" role="alert">{error}</p>}
              <button type="submit" className="button button-primary auth-submit" disabled={pending || !configured || !hydrated}>{pending ? "请稍候…" : registering ? "创建账号" : "登录"}<ArrowRight size={16} /></button>
              <p className="auth-switch">{registering ? "已有账号？" : "还没有账号？"}<Link href={registering ? "/login" : "/register"}>{registering ? "直接登录" : "注册账号"}</Link></p>
              </fieldset>
              <noscript><p className="auth-notice">请启用 JavaScript 后登录，账号信息不会通过地址栏提交。</p></noscript>
            </form>
          )}
        </section>
      </main>
    </>
  );
}

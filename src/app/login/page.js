import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { getOptionalUser } from "@/lib/auth/server";

export const metadata = { title: "登录" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }) {
  if (await getOptionalUser()) redirect("/dashboard");
  const params = await searchParams;
  const initialError = params.error === "confirmation" ? "确认链接无效或已过期，请重新注册获取邮件，或在邮箱验证后直接登录。" : "";
  return <AuthForm mode="login" initialError={initialError} serviceUnavailable={params.reason === "unavailable"} />;
}

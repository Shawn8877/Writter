import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { getOptionalUser } from "@/lib/auth/server";

export const metadata = { title: "注册" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await getOptionalUser()) redirect("/dashboard");
  return <AuthForm mode="register" />;
}

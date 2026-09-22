import { requireUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function CreateLayout({ children }) {
  await requireUser();
  return children;
}

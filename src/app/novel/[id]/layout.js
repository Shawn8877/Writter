import { NovelShell } from "@/components/novel/novel-shell";
import { requireNovelAccess } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function NovelLayout({ children, params }) {
  const { id } = await params;
  await requireNovelAccess(id);
  return <NovelShell id={id}>{children}</NovelShell>;
}

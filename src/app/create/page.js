import { SiteHeader } from "@/components/site-header";
import { CreateNovelForm } from "@/components/create/create-novel-form";

export const metadata = { title: "创建小说" };
export default function CreatePage() {
  return (
    <>
      <SiteHeader />
      <CreateNovelForm />
    </>
  );
}

import { Suspense } from "react";
import { ChaptersView } from "@/components/novel/chapters-view";
import { LoadingState } from "@/components/ui";
export const metadata = { title: "章节管理" };
export default function ChaptersPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ChaptersView />
    </Suspense>
  );
}

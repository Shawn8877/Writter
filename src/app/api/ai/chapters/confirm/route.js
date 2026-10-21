import { after } from "next/server";
import { createBuilderHandler } from "@/lib/ai/route-handler";
import { confirmChapterPreview } from "@/lib/ai/services/chapter-workflow";
import { updateChapterMemory } from "@/lib/ai/services/chapter-memory-service";
import { updateChapterReview } from "@/lib/ai/services/chapter-review-service";
export const runtime = "nodejs";
export const maxDuration = 900;
export const POST = createBuilderHandler(async (supabase, body) => {
  const saved = await confirmChapterPreview(supabase, body);
  after(async () => {
    const memory = await updateChapterMemory(supabase, { novelId: saved.novelId, chapterId: saved.chapter.id });
    if (memory.status === "succeeded") await updateChapterReview(supabase, { novelId: saved.novelId, chapterId: saved.chapter.id });
  });
  return saved;
}, 4096);

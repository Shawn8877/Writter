import { after } from "next/server";
import { createBuilderHandler } from "@/lib/ai/route-handler";
import { confirmChapterPreview } from "@/lib/ai/services/chapter-workflow";
import { updateChapterMemory } from "@/lib/ai/services/chapter-memory-service";
export const runtime = "nodejs";
export const maxDuration = 300;
export const POST = createBuilderHandler(async (supabase, body) => {
  const saved = await confirmChapterPreview(supabase, body);
  after(() => updateChapterMemory(supabase, { novelId: saved.novelId, chapterId: saved.chapter.id }));
  return saved;
}, 4096);

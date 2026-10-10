import { createBuilderHandler } from "@/lib/ai/route-handler";
import { confirmChapterPreview } from "@/lib/ai/services/chapter-workflow";
export const runtime = "nodejs";
export const POST = createBuilderHandler(confirmChapterPreview, 4096);

import { createBuilderHandler } from "@/lib/ai/route-handler";
import { confirmNovelPlan } from "@/lib/ai/services/builder-workflow";
import { AI_LIMITS } from "@/lib/ai/config";

export const runtime = "nodejs";
export const POST = createBuilderHandler(confirmNovelPlan, AI_LIMITS.maxPreviewBytes);

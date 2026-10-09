import { createBuilderHandler } from "@/lib/ai/route-handler";
import { generatePreview } from "@/lib/ai/services/builder-workflow";
import { AI_LIMITS } from "@/lib/ai/config";

export const runtime = "nodejs";
export const maxDuration = 300;
export const POST = createBuilderHandler(generatePreview, AI_LIMITS.maxInputBytes);

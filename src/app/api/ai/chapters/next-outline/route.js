import { z } from "zod";
import { createBuilderHandler } from "@/lib/ai/route-handler";
import { AiError } from "@/lib/ai/errors";
import { generateNextOutline, confirmNextOutline } from "@/lib/ai/services/chapter-outline-service";

export const runtime = "nodejs";
export const maxDuration = 300;
const generateSchema = z.object({ action: z.literal("generate"), requestId: z.uuid(), novelId: z.uuid(), chapterNumber: z.number().int().min(1).max(10000) }).strict();
const confirmSchema = z.object({ action: z.literal("confirm"), generationId: z.uuid() }).strict();
export const POST = createBuilderHandler(async (supabase, body) => {
  const generated = generateSchema.safeParse(body);
  if (generated.success) return generateNextOutline(supabase, generated.data);
  const confirmed = confirmSchema.safeParse(body);
  if (confirmed.success) return confirmNextOutline(supabase, confirmed.data.generationId);
  throw new AiError("INVALID_INPUT", "大纲请求无效。", 400);
}, 4096);

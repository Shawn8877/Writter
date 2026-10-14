import { after } from "next/server";
import { z } from "zod";
import { getApiAuth } from "@/lib/auth/server";
import { createBuilderHandler } from "@/lib/ai/route-handler";
import { AiError, aiErrorResponse } from "@/lib/ai/errors";
import { acknowledgeChapterMemoryReview, getChapterMemoryStatus, updateChapterMemory } from "@/lib/ai/services/chapter-memory-service";
export const runtime = "nodejs";
export const maxDuration = 300;
const schema = z.object({ novelId: z.uuid(), chapterId: z.uuid() }).strict();
const postSchema = z.union([
  schema.extend({ action: z.literal("retry").optional() }).strict(),
  schema.extend({ action: z.literal("acknowledge"), expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict(),
]);
function parse(body, inputSchema = schema) { const r = inputSchema.safeParse(body); if (!r.success) throw new AiError("INVALID_INPUT", "章节编号或操作参数无效。", 400); return r.data; }
export async function GET(request) {
  try {
    const auth = await getApiAuth(); if (auth.error) return auth.error;
    const input = parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await getChapterMemoryStatus(auth.supabase, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return aiErrorResponse(error, crypto.randomUUID()); }
}
export const POST = createBuilderHandler(async (supabase, body) => {
  const input = parse(body, postSchema);
  if (input.action === "acknowledge") return acknowledgeChapterMemoryReview(supabase, input);
  const status = await getChapterMemoryStatus(supabase, input);
  if (status.status === "none") throw new AiError("NOT_FOUND", "本章尚无自动分析任务。", 404);
  if (["succeeded", "running", "needs_review", "reviewed"].includes(status.status)) return status;
  after(() => updateChapterMemory(supabase, { ...input, retry: true }));
  return { status: "pending" };
}, 4096);

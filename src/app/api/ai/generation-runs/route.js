import { z } from "zod";
import { getApiAuth } from "@/lib/auth/server";
import { createBuilderHandler } from "@/lib/ai/route-handler";
import { AiError, aiErrorResponse } from "@/lib/ai/errors";
import { getLatestGenerationRun, startGenerationRun } from "@/lib/ai/services/generation-run-service";

export const runtime = "nodejs";
const inputSchema = z.object({ novelId: z.uuid(), count: z.union([z.literal(1),z.literal(3),z.literal(5),z.literal(10)]), mode: z.enum(["next","continuous"]) }).strict();
export const POST = createBuilderHandler(async (supabase, body) => {
  const result = inputSchema.safeParse(body);
  if (!result.success) throw new AiError("INVALID_INPUT", "请选择 1、3、5 或 10 章。", 400);
  return startGenerationRun(supabase, result.data);
}, 4096);

export async function GET(request) {
  try {
    const auth = await getApiAuth(); if (auth.error) return auth.error;
    const novelId = z.uuid().safeParse(new URL(request.url).searchParams.get("novelId"));
    if (!novelId.success) throw new AiError("INVALID_INPUT", "小说编号无效。", 400);
    return Response.json(await getLatestGenerationRun(auth.supabase, novelId.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return aiErrorResponse(error, crypto.randomUUID()); }
}

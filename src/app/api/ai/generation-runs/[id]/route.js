import { z } from "zod";
import { getApiAuth } from "@/lib/auth/server";
import { AiError, aiErrorResponse } from "@/lib/ai/errors";
import { reconcileGenerationRun } from "@/lib/ai/services/generation-run-service";

export const runtime = "nodejs";
export async function GET(_request, { params }) {
  try {
    const auth = await getApiAuth(); if (auth.error) return auth.error;
    const parsed = z.uuid().safeParse((await params).id);
    if (!parsed.success) throw new AiError("INVALID_INPUT", "任务编号无效。", 400);
    return Response.json(await reconcileGenerationRun(auth.supabase, parsed.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return aiErrorResponse(error, crypto.randomUUID()); }
}

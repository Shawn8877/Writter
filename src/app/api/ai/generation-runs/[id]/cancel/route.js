import { z } from "zod";
import { getApiAuth } from "@/lib/auth/server";
import { readJson, RepositoryError } from "@/lib/server/supabase-repository";
import { AiError, aiErrorResponse } from "@/lib/ai/errors";
import { cancelGenerationRun } from "@/lib/ai/services/generation-run-service";

export const runtime = "nodejs";
export async function POST(request, { params }) {
  try {
    const auth = await getApiAuth(); if (auth.error) return auth.error;
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) throw new AiError("INVALID_INPUT", "任务编号无效。", 400);
    const body = await readJson(request, 4096);
    if (Object.keys(body).length) throw new AiError("INVALID_INPUT", "取消操作无效。", 400);
    return Response.json(await cancelGenerationRun(auth.supabase, id.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return aiErrorResponse(error instanceof RepositoryError ? new AiError(error.code, error.message, error.status) : error, crypto.randomUUID()); }
}

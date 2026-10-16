import { after } from "next/server";
import { z } from "zod";
import { getApiAuth } from "@/lib/auth/server";
import { readJson, RepositoryError } from "@/lib/server/supabase-repository";
import { AiError, aiErrorResponse } from "@/lib/ai/errors";
import { claimGenerationStep, processGenerationStep } from "@/lib/ai/services/generation-run-service";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request, { params }) {
  try {
    const auth = await getApiAuth(); if (auth.error) return auth.error;
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) throw new AiError("INVALID_INPUT", "任务编号无效。", 400);
    const input = z.object({ manualApprove: z.boolean().optional() }).strict().safeParse(await readJson(request, 4096));
    if (!input.success) throw new AiError("INVALID_INPUT", "任务操作无效。", 400);
    const claim = await claimGenerationStep(auth.supabase, id.data, input.data);
    if (["generate","confirm","memory"].includes(claim.action)) after(() => processGenerationStep(auth.supabase, claim));
    return Response.json(claim.run, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return aiErrorResponse(error instanceof RepositoryError ? new AiError(error.code, error.message, error.status) : error, crypto.randomUUID()); }
}

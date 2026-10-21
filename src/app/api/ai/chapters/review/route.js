import { after } from "next/server";
import { z } from "zod";
import { getApiAuth } from "@/lib/auth/server";
import { createBuilderHandler } from "@/lib/ai/route-handler";
import { AiError, aiErrorResponse } from "@/lib/ai/errors";
import { listChapterReviews, setReviewFindingDecision, prepareChapterReview, executeChapterReview } from "@/lib/ai/services/chapter-review-service";

export const runtime = "nodejs";
export const maxDuration = 600;
const target = z.object({ novelId: z.uuid(), chapterId: z.uuid() }).strict();
const operation = z.union([
  target.extend({ action: z.literal("review") }).strict(),
  z.object({ action: z.literal("decision"), reviewId: z.uuid(), findingIndex: z.number().int().min(0).max(23), decision: z.enum(["accepted", "ignored"]) }).strict(),
  z.object({ action: z.literal("acknowledge"), reviewId: z.uuid() }).strict(),
]);

export async function GET(request) {
  try {
    const auth = await getApiAuth(); if (auth.error) return auth.error;
    const parsed = target.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new AiError("INVALID_INPUT", "章节编号无效。", 400);
    return Response.json(await listChapterReviews(auth.supabase, parsed.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return aiErrorResponse(error, crypto.randomUUID()); }
}

export const POST = createBuilderHandler(async (supabase, body) => {
  const parsed = operation.safeParse(body);
  if (!parsed.success) throw new AiError("INVALID_INPUT", "审核操作无效。", 400);
  const input = parsed.data;
  if (input.action === "decision") return setReviewFindingDecision(supabase, input);
  if (input.action === "acknowledge") return setReviewFindingDecision(supabase, { reviewId: input.reviewId, findingIndex: 0, decision: "acknowledged" });
  const claim = await prepareChapterReview(supabase, { ...input, manual: true });
  if (claim.started) after(() => executeChapterReview(supabase, claim));
  return { status: claim.status, reviewId: claim.reviewId };
}, 4096);

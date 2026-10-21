import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { getAiConfig } from "../config.js";
import { createDeepSeekClient } from "../deepseek.js";
import { AiError, normalizeAiError } from "../errors.js";
import { buildChapterReviewContext } from "../context/chapter-review-context-builder.js";
import { chapterReviewSchema, chapterReviewJsonSchema } from "../schemas/chapter-review-schema.js";
import { chapterReviewMessages, CHAPTER_REVIEW_PROMPT_VERSION } from "../prompts/chapter-review-analyzer.js";
import { chapterDatabaseError } from "./chapter-context.js";
import { matchedEvidence } from "./evidence.js";

const checked = (result) => { chapterDatabaseError(result.error); return result.data; };
const prose = (value) => typeof value === "string" ? value : value && typeof value === "object" ? Object.values(value).map(prose).join("\n") : "";
const sourceText = (context, item) => {
  const array = { character: context.characters, world: context.world, memory: context.memories, foreshadowing: context.unresolvedForeshadowing, timeline: context.timeline }[item.source];
  if (array) return array.filter((row) => row.id === item.sourceId).map(prose).join("\n");
  const object = { chapter: { id: context.chapter.id, content: context.chapter.content }, bible: context.bible, outline: { id: context.chapter.id, outline: context.chapter.outline }, previous_chapter: context.previousChapter,
    previous_summary: context.previousSummary, recent_summary: context.recentSummaries.find((row) => row.id === item.sourceId) }[item.source];
  const id = item.source === "bible" ? context.novel.id : object?.id || object?.chapter_id;
  if (item.sourceId && item.sourceId !== id) return "";
  if (item.source === "chapter" || item.source === "previous_chapter") return object?.content || "";
  if (item.source === "outline") return object?.outline || "";
  return object ? prose(object) : "";
};
const invalidReview = (code, path, message) => {
  const error = new AiError("INVALID_AI_OUTPUT", message);
  error.validationIssues = [{ code, path }];
  return error;
};

export function validateChapterReview(result, context) {
  const parsed = chapterReviewSchema.parse(result);
  for (const [findingIndex, finding] of parsed.findings.entries()) {
    for (const [key, rows] of [["relatedMemoryId",context.memories],["relatedCharacterId",context.characters],["relatedChapterId",[context.chapter,context.previousChapter,...context.recentSummaries].filter(Boolean)]]) {
      if (finding[key] && !rows.some((row) => row.id === finding[key])) throw new AiError("INVALID_AI_OUTPUT", "审核引用不属于当前小说上下文。");
    }
    if (finding.severity === "critical" && parsed.status !== "critical") throw new AiError("INVALID_AI_OUTPUT", "审核结果状态与严重问题不一致。");
    for (const [evidenceIndex, evidence] of finding.evidence.entries()) {
      const haystack = sourceText(context, evidence);
      const excerpt = matchedEvidence(haystack, evidence.excerpt);
      if (!excerpt) throw invalidReview("evidence_not_found", ["findings",findingIndex,"evidence",evidenceIndex], "审核证据不属于提供的小说资料。");
      evidence.excerpt = excerpt;
    }
    if (["high", "critical"].includes(finding.severity) && !finding.evidence.some((item) => item.source === "chapter")) throw new AiError("INVALID_AI_OUTPUT", "高风险问题缺少本章正文证据。");
  }
  if (parsed.status === "passed" && (parsed.overallScore < 90 || parsed.findings.some((item) => ["high", "critical"].includes(item.severity)))) throw new AiError("INVALID_AI_OUTPUT", "审核通过状态与分数或发现不一致。");
  if (parsed.status === "critical" && !parsed.findings.some((item) => item.severity === "critical")) throw new AiError("INVALID_AI_OUTPUT", "严重状态缺少具体问题证据。");
  return parsed;
}

export async function analyzeChapterReview(context, { config = getAiConfig(), client = createDeepSeekClient(config) } = {}) {
  let metadata;
  try {
    const response = await client.responses.create({ model: config.model, input: chapterReviewMessages(context), stream: false,
      reasoning: { effort: "low" }, max_output_tokens: 10000,
      text: { format: { type: "json_schema", name: "chapter_review", schema: chapterReviewJsonSchema, strict: true } } });
    metadata = { model: response.model || config.model, inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null,
      providerRequestId: response._request_id || response.id || null };
    if (response.status !== "completed" || !response.output_text || Buffer.byteLength(response.output_text, "utf8") > 100000) throw new AiError("INVALID_AI_OUTPUT", "AI 编辑审核结果不完整，请重试。");
    let json;
    try { json = JSON.parse(response.output_text); } catch { throw new AiError("INVALID_AI_OUTPUT", "AI 编辑审核结果格式无效，请重试。"); }
    return { result: validateChapterReview(json, context), ...metadata };
  } catch (error) { const safe = normalizeAiError(error); safe.metadata = metadata; throw safe; }
}

export async function prepareChapterReview(supabase, input, dependencies = {}) {
  const config = (dependencies.getConfig || getAiConfig)();
  const prepared = await (dependencies.context || buildChapterReviewContext)(supabase, input);
  const lease = randomUUID();
  const contentHash = createHash("md5").update(prepared.context.chapter.content).digest("hex");
  // A report may commit just before the run worker disconnects. Reuse that
  // report on recovery, including an explicitly retried (manual) report.
  if (input.generationRunId && !input.manual) {
    const completed = checked(await supabase.from("chapter_reviews").select("id,status")
      .eq("generation_run_id", input.generationRunId).eq("chapter_id", input.chapterId)
      .eq("content_hash", contentHash).eq("chapter_revision", prepared.chapterRevision).eq("novel_revision", prepared.novelRevision)
      .in("status", ["passed","needs_review","critical"]).order("created_at", { ascending: false }).limit(1));
    if (completed[0]) return { started: false, status: completed[0].status, reviewId: completed[0].id };
  }
  const begun = checked(await supabase.rpc("studio_begin_chapter_review", {
    p_novel_id: input.novelId, p_chapter_id: input.chapterId, p_chapter_version_id: prepared.chapterVersionId,
    p_chapter_revision: prepared.chapterRevision, p_content_hash: contentHash, p_lease_token: lease,
    p_novel_revision: prepared.novelRevision,
    p_model: config.model, p_prompt_version: CHAPTER_REVIEW_PROMPT_VERSION, p_manual: input.manual === true,
    p_generation_run_id: input.generationRunId || null,
  }));
  return { ...begun, lease, config, context: prepared.context };
}

export async function executeChapterReview(supabase, claim, dependencies = {}) {
  if (!claim.started) return { status: claim.status, reviewId: claim.reviewId };
  const { reviewId, lease, config, context } = claim;
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now(); let metadata = {};
    try {
      const analyzed = await (dependencies.analyze || analyzeChapterReview)(context, { config });
      metadata = analyzed;
      return checked(await supabase.rpc("studio_finish_chapter_review", {
        p_review_id: reviewId, p_lease_token: lease, p_result: analyzed.result, p_error_type: null,
        p_metrics: { model: analyzed.model, inputTokens: analyzed.inputTokens, outputTokens: analyzed.outputTokens,
          providerRequestId: analyzed.providerRequestId, latencyMs: Date.now() - started },
      }));
    } catch (error) {
      const safe = normalizeAiError(error); metadata = safe.metadata || metadata;
      const failed = await supabase.rpc("studio_finish_chapter_review", { p_review_id: reviewId, p_lease_token: lease, p_result: null,
        p_error_type: safe.code, p_metrics: { model: metadata.model || config.model, inputTokens: metadata.inputTokens ?? null,
          outputTokens: metadata.outputTokens ?? null, providerRequestId: metadata.providerRequestId || null, latencyMs: Date.now() - started } });
      console.warn("[chapter-review]", JSON.stringify({ code: safe.code, persisted: !failed.error, attempt: attempt + 1, ...(safe.validationIssues ? { validationIssues: safe.validationIssues } : {}) }));
      if (attempt === 0 && !failed.error && ["INVALID_AI_OUTPUT","AI_TIMEOUT","AI_NETWORK_ERROR","AI_INCOMPLETE"].includes(safe.code)) {
        const retry = await supabase.rpc("studio_retry_chapter_review", { p_review_id: reviewId, p_lease_token: lease });
        if (!retry.error && retry.data?.started) continue;
      }
      return { status: "failed", errorType: safe.code, reviewId };
    }
  }
}

export async function updateChapterReview(supabase, input, dependencies = {}) {
  try {
    if (!input.generationRunId && !input.manual) {
      const active = checked(await supabase.from("generation_runs").select("id").eq("novel_id", input.novelId).in("status", ["running","paused","failed"]).limit(1));
      if (active.length) return { status: "deferred" };
    }
    return await executeChapterReview(supabase, await prepareChapterReview(supabase, input, dependencies), dependencies);
  } catch (error) {
    const safe = normalizeAiError(error);
    console.warn("[chapter-review]", JSON.stringify({ code: safe.code }));
    return { status: "failed", errorType: safe.code };
  }
}

export async function listChapterReviews(supabase, { novelId, chapterId }) {
  const chapter = checked(await supabase.from("chapters").select("id,content,revision").eq("novel_id", novelId).eq("id", chapterId).maybeSingle());
  if (!chapter) throw new AiError("NOT_FOUND", "章节不存在或不属于当前账号。", 404);
  const reviews = checked(await supabase.from("chapter_reviews").select("id,chapter_version_id,status,overall_score,summary,result_json,model,prompt_version,input_tokens,output_tokens,latency_ms,error_type,manual,author_acknowledged,created_at,updated_at,content_hash")
    .eq("novel_id", novelId).eq("chapter_id", chapterId).order("created_at", { ascending: false }).limit(30));
  const contentHash = createHash("md5").update(chapter.content).digest("hex");
  return { chapterRevision: chapter.revision, reviews: reviews.map(({ content_hash, ...review }) => ({ ...review,
    status: review.status === "running" && Date.now() - new Date(review.updated_at).getTime() > 300000 ? "failed" : review.status,
    currentContent: content_hash === contentHash })) };
}

export async function setReviewFindingDecision(supabase, { reviewId, findingIndex, decision }) {
  return checked(await supabase.rpc("studio_decide_review_finding", { p_review_id: reviewId, p_finding_index: findingIndex, p_decision: decision }));
}

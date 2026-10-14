import "server-only";
import { randomUUID } from "node:crypto";
import { getAiConfig } from "../config.js";
import { createDeepSeekClient } from "../deepseek.js";
import { AiError, normalizeAiError } from "../errors.js";
import { chapterMemorySchema, chapterMemoryJsonSchema } from "../schemas/chapter-memory-schema.js";
import { chapterMemoryMessages } from "../prompts/chapter-memory-analyzer.js";
import { buildChapterMemoryContext } from "../context/chapter-memory-context-builder.js";
import { prepareChapterMemoryResult } from "./chapter-memory-mapper.js";
import { chapterDatabaseError } from "./chapter-context.js";
import { inputHash } from "./builder-workflow.js";

export async function analyzeChapterMemory(context, { config = getAiConfig(), client = createDeepSeekClient(config) } = {}) {
  let metadata;
  try {
    const response = await client.responses.create({ model: config.model, input: chapterMemoryMessages(context), stream: false,
      reasoning: { effort: "low" }, max_output_tokens: 16000,
      text: { format: { type: "json_schema", name: "chapter_memory_analysis", schema: chapterMemoryJsonSchema, strict: true } } });
    metadata = { model: response.model || config.model, inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null, providerRequestId: response._request_id || response.id || null };
    if (response.output?.some((item) => item.content?.some((part) => part.type === "refusal"))) throw new AiError("AI_REFUSAL", "AI 无法分析当前正文，请检查内容后重试。", 422);
    if (response.status !== "completed") throw new AiError("AI_INCOMPLETE", "本章分析未完成，请重试。");
    if (!response.output_text || Buffer.byteLength(response.output_text, "utf8") > 100000) {
      const error = new AiError("INVALID_AI_OUTPUT", "章节分析结果无效，请重试。");
      error.validationIssues = [{ code: response.output_text ? "output_too_large" : "empty_output", path: [] }];
      throw error;
    }
    let parsed;
    try { parsed = JSON.parse(response.output_text); } catch {
      const error = new AiError("INVALID_AI_OUTPUT", "章节分析结果格式无效，请重试。");
      error.validationIssues = [{ code: "invalid_json", path: [] }];
      throw error;
    }
    const result = chapterMemorySchema.parse(parsed);
    return { result: prepareChapterMemoryResult(result, context), ...metadata };
  } catch (error) { const safe = normalizeAiError(error); safe.metadata = metadata; throw safe; }
}

export async function updateChapterMemory(supabase, input, dependencies = {}) {
  let generationId; let lease; let config; let metadata; const started = Date.now();
  try {
    config = (dependencies.getConfig || getAiConfig)();
    const prepared = await (dependencies.context || buildChapterMemoryContext)(supabase, input);
    lease = randomUUID();
    const begun = await supabase.rpc("studio_begin_chapter_memory", {
      p_novel_id: input.novelId, p_chapter_id: input.chapterId, p_novel_revision: prepared.novelRevision, p_chapter_revision: prepared.chapterRevision,
      p_lease_token: lease, p_model: config.model, p_input_hash: inputHash(prepared.context), p_retry: input.retry === true,
    });
    chapterDatabaseError(begun.error);
    if (!begun.data.started) return begun.data;
    generationId = begun.data.generationId;
    const analysed = await (dependencies.analyze || analyzeChapterMemory)(prepared.context, { config });
    metadata = analysed;
    const finished = await supabase.rpc("studio_finish_chapter_memory", {
      p_generation_id: generationId, p_lease_token: lease, p_result: analysed.result, p_error_type: null,
      p_metrics: { model: analysed.model, inputTokens: analysed.inputTokens, outputTokens: analysed.outputTokens, providerRequestId: analysed.providerRequestId, latencyMs: Date.now() - started },
    });
    chapterDatabaseError(finished.error);
    return finished.data;
  } catch (error) {
    const failure = normalizeAiError(error);
    metadata ||= failure.metadata || {};
    const marked = generationId ? await supabase.rpc("studio_finish_chapter_memory", {
      p_generation_id: generationId, p_lease_token: lease, p_result: null, p_error_type: failure.code,
      p_metrics: { model: metadata.model || config.model, inputTokens: metadata.inputTokens ?? null, outputTokens: metadata.outputTokens ?? null, providerRequestId: metadata.providerRequestId || null, latencyMs: Date.now() - started },
    }) : await supabase.rpc("studio_fail_idle_chapter_memory", { p_novel_id: input.novelId, p_chapter_id: input.chapterId, p_error_type: failure.code });
    // Log only safe codes. Lost database connectivity is recovered by lease expiry + explicit retry.
    console.warn("[chapter-memory]", JSON.stringify({ code: failure.code, persisted: !marked.error, ...(failure.validationIssues ? { validationIssues: failure.validationIssues } : {}) }));
    return { status: "failed", errorType: failure.code };
  }
}

export async function getChapterMemoryStatus(supabase, { novelId, chapterId }) {
  const chapter = await supabase.from("chapters").select("id,revision").eq("novel_id", novelId).eq("id", chapterId).maybeSingle();
  chapterDatabaseError(chapter.error);
  if (!chapter.data) throw new AiError("NOT_FOUND", "章节不存在或不属于当前账号。", 404);
  const result = await supabase.from("chapter_memory_jobs").select("status,error_type,updated_at,generation_id").eq("novel_id", novelId).eq("chapter_id", chapterId).maybeSingle();
  chapterDatabaseError(result.error);
  if (!result.data) return { status: "none", chapterRevision: chapter.data.revision };
  const row = result.data;
  const expired = ["pending", "running"].includes(row.status) && Date.now() - new Date(row.updated_at).getTime() > 300000;
  return { status: expired ? "failed" : row.status, errorType: expired ? "LEASE_EXPIRED" : row.error_type, updatedAt: row.updated_at, chapterRevision: chapter.data.revision };
}

export async function acknowledgeChapterMemoryReview(supabase, { novelId, chapterId, expectedRevision }) {
  const result = await supabase.rpc("studio_acknowledge_chapter_memory", {
    p_novel_id: novelId, p_chapter_id: chapterId, p_expected_revision: expectedRevision,
  });
  chapterDatabaseError(result.error);
  return result.data;
}

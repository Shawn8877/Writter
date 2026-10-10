import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getAiConfig } from "../config.js";
import { AiError, normalizeAiError } from "../errors.js";
import { inputHash } from "./builder-workflow.js";
import { buildChapterContext, chapterDatabaseError } from "./chapter-context.js";
import { writeChapter } from "./chapter-writer-service.js";
import { chapterFromRow } from "@/lib/server/supabase-repository";

const requestSchema = z.object({ requestId: z.uuid(), novelId: z.uuid(), chapterId: z.uuid(), expectedRevision: z.number().int().positive() }).strict();
export function validateChapterRequest(body) {
  const result = requestSchema.safeParse(body);
  if (!result.success) throw new AiError("INVALID_INPUT", "章节请求无效，请刷新页面后重试。", 400);
  return result.data;
}
export async function generateChapterPreview(supabase, body, emit = () => {}, dependencies = {}) {
  const input = validateChapterRequest(body);
  const config = (dependencies.getConfig || getAiConfig)();
  emit({ type: "stage", stage: "preparing" });
  const prepared = await (dependencies.context || buildChapterContext)(supabase, input);
  const lease = randomUUID();
  const { data: generationId, error } = await supabase.rpc("studio_begin_chapter_generation", {
    p_request_id: input.requestId, p_lease_token: lease, p_input_hash: inputHash(prepared.context), p_model: config.model,
    p_novel_id: input.novelId, p_chapter_id: input.chapterId, p_novel_revision: prepared.novelRevision, p_chapter_revision: prepared.chapterRevision,
  });
  chapterDatabaseError(error);
  emit({ type: "stage", stage: "generating" });
  const start = Date.now(); let result; let failure;
  try { result = await (dependencies.write || writeChapter)(prepared.context, { config }); }
  catch (error) { failure = normalizeAiError(error); }
  const metadata = result || failure?.metadata || {};
  const finished = await supabase.rpc("studio_finish_chapter_generation", {
    p_generation_id: generationId, p_lease_token: lease, p_status: failure ? "failed" : "succeeded", p_model: metadata.model || config.model,
    p_input_tokens: metadata.inputTokens ?? null, p_output_tokens: metadata.outputTokens ?? null, p_latency_ms: Date.now() - start,
    p_provider_request_id: metadata.providerRequestId || failure?.providerRequestId || null, p_error_type: failure?.code || null, p_content: result?.content || null,
  });
  chapterDatabaseError(finished.error);
  if (!finished.data) throw new AiError("GENERATION_EXPIRED", "生成记录已过期，未保存章节。请重试。", 409);
  if (failure) throw failure;
  return { generationId, content: result.content, wordCount: result.wordCount, lengthWarning: result.lengthWarning,
    usage: { provider: "deepseek", model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens } };
}
export async function confirmChapterPreview(supabase, body) {
  const parsed = z.object({ generationId: z.uuid() }).strict().safeParse(body);
  if (!parsed.success) throw new AiError("INVALID_INPUT", "预览编号无效。", 400);
  const { data, error } = await supabase.rpc("studio_confirm_chapter_generation", { p_generation_id: parsed.data.generationId });
  chapterDatabaseError(error);
  return { ...data, chapter: chapterFromRow(data.chapter) };
}

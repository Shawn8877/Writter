import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getAiConfig } from "../config.js";
import { AiError } from "../errors.js";
import { BUILDER_SCHEMA_VERSION, buildRequestSchema, confirmRequestSchema, parseNovelPlan } from "../schemas/novel-builder-schema.js";
import { buildNovelPlan } from "./novel-builder-service.js";
import { mapNovelBundle } from "./novel-bundle-mapper.js";

export const inputHash = (input) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
function validate(schema, value, message = "请检查创意、字段长度和篇幅：AI 构建支持 8–2000 章、1000–1000 万字，每章 100–50000 字。") {
  const result = schema.safeParse(value);
  if (!result.success) throw new AiError("INVALID_INPUT", message, 400);
  return result.data;
}
function databaseError(error) {
  if (!error) return;
  if (error.code === "PT429") throw new AiError("BUILD_RATE_LIMIT", "每小时最多构建 6 次，请稍后再试。", 429);
  if (error.code === "PT409" && error.message === "AI_BUSY") throw new AiError("BUILD_IN_PROGRESS", "你已有一个方案正在构建，请等待它完成。", 409);
  if (error.code === "PT409" && error.message === "DUPLICATE_REQUEST") throw new AiError("DUPLICATE_REQUEST", "这次构建请求已经提交过，未再次调用 AI。请等待结果，或明确重新生成。", 409);
  if (error.code === "PT409") throw new AiError("ALREADY_CONFIRMED", "这份方案已确认且对应小说已删除，不能重复创建。", 409);
  if (["P0002", "42501"].includes(error.code)) throw new AiError("GENERATION_NOT_FOUND", "方案不存在、尚未完成或不属于当前账号。请重新登录并检查。", 404);
  if (["23514", "23502", "22P02", "22023"].includes(error.code)) throw new AiError("INVALID_BUNDLE", "方案数据不完整，尚未保存任何小说。请检查后重试。", 400);
  throw new AiError("AI_DATABASE_ERROR", "云端保存暂时失败，请保留当前预览后重试。", 503);
}

export async function generatePreview(supabase, body, dependencies = {}) {
  const { input, requestId } = validate(buildRequestSchema, body);
  const config = (dependencies.getConfig || getAiConfig)();
  const leaseToken = randomUUID();
  const { data: generationId, error } = await supabase.rpc("studio_begin_ai_generation", {
    p_request_id: requestId, p_lease_token: leaseToken, p_input_hash: inputHash(input), p_model: config.model, p_schema_version: BUILDER_SCHEMA_VERSION,
  });
  databaseError(error);
  const startedAt = Date.now();
  let result;
  let failure;
  try { result = await (dependencies.build || buildNovelPlan)(input, { config }); }
  catch (error) { failure = error; }
  const metadata = result || failure?.metadata || {};
  const finished = await supabase.rpc("studio_finish_ai_generation", {
    p_generation_id: generationId, p_lease_token: leaseToken, p_status: failure ? "failed" : "succeeded",
    p_model: metadata.model || config.model, p_input_tokens: metadata.inputTokens ?? null, p_output_tokens: metadata.outputTokens ?? null,
    p_latency_ms: Date.now() - startedAt, p_provider_request_id: metadata.providerRequestId || failure?.providerRequestId || null, p_error_type: failure?.code || (failure ? "AI_UNAVAILABLE" : null),
  });
  // Do not show a usable preview unless its completion is durably recorded.
  databaseError(finished.error);
  if (!finished.data) throw new AiError("BUILD_EXPIRED", "构建记录已过期，请重新生成。", 409);
  if (failure) throw failure;
  return { generationId, requestId, input, plan: result.plan, schemaVersion: BUILDER_SCHEMA_VERSION, usage: { model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens } };
}

export async function confirmNovelPlan(supabase, body) {
  const parsed = validate(confirmRequestSchema, body, "方案字段不完整或长度超限，请检查修改内容后重试。");
  let plan;
  try { plan = parseNovelPlan(parsed.plan, parsed.input); }
  catch { throw new AiError("INVALID_PLAN", "方案中的人物、能力或章节阶段不一致，请检查修改后重试。", 400); }
  const { data, error } = await supabase.rpc("create_ai_novel_bundle", { p_generation_id: parsed.generationId, p_input_hash: inputHash(parsed.input), p_bundle: mapNovelBundle(plan, parsed.input) });
  databaseError(error);
  return { novelId: data };
}

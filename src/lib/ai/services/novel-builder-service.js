import "server-only";
import { getAiConfig } from "../config.js";
import { createDeepSeekClient } from "../deepseek.js";
import { AiError, normalizeAiError } from "../errors.js";
import { builderMessages } from "../prompts/novel-builder.js";
import { builderInputSchema, novelBuilderJsonSchema, parseNovelPlan, BUILDER_SCHEMA_VERSION } from "../schemas/novel-builder-schema.js";

export async function buildNovelPlan(input, { config = getAiConfig(), client = createDeepSeekClient(config) } = {}) {
  const validated = builderInputSchema.parse(input);
  let metadata;
  try {
    const response = await client.responses.create({
      model: config.model, input: builderMessages(validated),
      max_output_tokens: config.maxOutputTokens, stream: false,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "novel_builder", schema: novelBuilderJsonSchema, strict: true } },
    });
    metadata = { model: response.model || config.model, inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null, providerRequestId: response._request_id || response.id || null, schemaVersion: BUILDER_SCHEMA_VERSION };
    if (response.output?.some((item) => item.type === "message" && item.content?.some((part) => part.type === "refusal"))) throw new AiError("AI_REFUSAL", "AI 无法按当前创意构建方案，请调整创意后重试。", 422);
    if (response.status !== "completed") throw new AiError("AI_INCOMPLETE", "AI 方案未完整生成，请稍后重新构建。");
    const content = response.output_text;
    if (typeof content !== "string" || !content.trim() || Buffer.byteLength(content, "utf8") > (config.maxPreviewBytes || 500000)) throw new AiError("INVALID_AI_OUTPUT", "AI 未返回完整方案，请重新生成。");
    return { plan: parseNovelPlan(JSON.parse(content), validated), ...metadata };
  } catch (error) {
    const safe = normalizeAiError(error);
    safe.metadata = metadata;
    if (metadata?.providerRequestId) safe.providerRequestId = metadata.providerRequestId;
    throw safe;
  }
}

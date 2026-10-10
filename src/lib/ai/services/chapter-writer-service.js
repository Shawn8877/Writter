import "server-only";
import { getAiConfig } from "../config.js";
import { createDeepSeekClient } from "../deepseek.js";
import { AiError, normalizeAiError } from "../errors.js";
import { chapterMessages } from "../prompts/chapter-writer.js";

export async function writeChapter(context, { config = getAiConfig(), client = createDeepSeekClient(config) } = {}) {
  let metadata;
  try {
    const response = await client.responses.create({ model: config.model, input: chapterMessages(context), stream: false,
      reasoning: { effort: "low" }, max_output_tokens: Math.min(24000, Math.max(6000, context.novel.chapter_word_target * 3 + 4000)) });
    metadata = { model: response.model || config.model, inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null, providerRequestId: response._request_id || response.id || null };
    if (response.output?.some((item) => item.content?.some((part) => part.type === "refusal"))) throw new AiError("AI_REFUSAL", "AI 无法按当前大纲创作，请调整大纲后重试。", 422);
    if (response.status !== "completed") throw new AiError("AI_INCOMPLETE", "本章未完整生成，未保存正文。请稍后重试。");
    const content = response.output_text?.trim();
    if (!content || Buffer.byteLength(content, "utf8") > 120000) throw new AiError("INVALID_AI_OUTPUT", "AI 未返回有效的完整正文，未保存章节。");
    const wordCount = [...content.replace(/\s/g, "")].length;
    const target = context.novel.chapter_word_target;
    const lengthWarning = wordCount < target * 0.8 || wordCount > target * 1.2 ? `本次生成 ${wordCount} 字，超出目标 ${target} 字的 ±20% 范围，请核对后决定是否保存。` : null;
    return { content, wordCount, lengthWarning, ...metadata };
  } catch (error) { const safe = normalizeAiError(error); safe.metadata = metadata; if (metadata?.providerRequestId) safe.providerRequestId = metadata.providerRequestId; throw safe; }
}

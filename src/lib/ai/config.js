import "server-only";
import { AiError } from "./errors.js";

export const AI_LIMITS = Object.freeze({ timeoutMs: 240000, maxOutputTokens: 24000, maxInputBytes: 20000, maxPreviewBytes: 500000 });
export function getAiConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new AiError("AI_NOT_CONFIGURED", "AI 服务尚未配置，请管理员在服务器设置 OpenAI 密钥。", 503);
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-6.1-sol";
  const proxyUrl = process.env.OPENAI_PROXY_URL?.trim() || undefined;
  return { apiKey, model, proxyUrl, ...AI_LIMITS };
}

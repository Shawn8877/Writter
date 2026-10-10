import "server-only";
import { AiError } from "./errors.js";

export const AI_LIMITS = Object.freeze({ timeoutMs: 240000, maxOutputTokens: 24000, maxInputBytes: 20000, maxPreviewBytes: 500000 });
export function getAiConfig() {
  if (process.env.AI_PROVIDER && process.env.AI_PROVIDER.trim() !== "deepseek") throw new AiError("AI_PROVIDER_UNAVAILABLE", "当前版本仅接入 DeepSeek，请管理员将 AI_PROVIDER 设置为 deepseek。", 503);
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new AiError("AI_NOT_CONFIGURED", "AI 服务尚未配置，请管理员在服务器设置 DeepSeek 密钥。", 503);
  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash";
  const proxyUrl = process.env.DEEPSEEK_PROXY_URL?.trim() || undefined;
  return { provider: "deepseek", apiKey, model, proxyUrl, ...AI_LIMITS };
}

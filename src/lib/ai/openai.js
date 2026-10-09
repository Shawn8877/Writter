import "server-only";
import OpenAI from "openai";
import { fetch as proxyFetch, ProxyAgent } from "undici";
import { getAiConfig } from "./config.js";
import { AiError } from "./errors.js";

// Reuse proxy connections across requests. Only the OpenAI client uses these.
const proxyAgents = new Map();

function proxyOptions(proxyUrl) {
  if (!proxyUrl) return {};
  let url;
  try {
    url = new URL(proxyUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid proxy protocol");
  } catch {
    throw new AiError("AI_PROXY_CONFIG_ERROR", "AI 代理配置无效，请管理员检查服务器设置。", 503);
  }
  if (!proxyAgents.has(url.href)) proxyAgents.set(url.href, new ProxyAgent(url.href));
  return { fetch: proxyFetch, fetchOptions: { dispatcher: proxyAgents.get(url.href) } };
}

export function createOpenAIClient(config = getAiConfig()) {
  return new OpenAI({ apiKey: config.apiKey, baseURL: "https://api.openai.com/v1", timeout: config.timeoutMs, maxRetries: 0, ...proxyOptions(config.proxyUrl) });
}

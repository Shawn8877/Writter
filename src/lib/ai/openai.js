import "server-only";
import OpenAI from "openai";
import { getAiConfig } from "./config.js";

export function createOpenAIClient(config = getAiConfig()) {
  return new OpenAI({ apiKey: config.apiKey, baseURL: "https://api.openai.com/v1", timeout: config.timeoutMs, maxRetries: 0 });
}

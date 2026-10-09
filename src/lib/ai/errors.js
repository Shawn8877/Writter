import "server-only";

export class AiError extends Error {
  constructor(code, message, status = 502) { super(message); this.name = "AiError"; this.code = code; this.status = status; }
}
export function normalizeAiError(error) {
  if (error instanceof AiError) return error;
  let result;
  if (error?.name === "ZodError" || error instanceof SyntaxError) result = new AiError("INVALID_AI_OUTPUT", "AI 返回的方案不够完整，请重新生成。");
  else if (error?.name === "APIConnectionTimeoutError" || error?.name === "AbortError") result = new AiError("AI_TIMEOUT", "构建时间较长，本次请求已超时。请稍后重试。", 504);
  else if (error?.status === 401 || error?.status === 403) result = new AiError("AI_AUTH_ERROR", "AI 服务认证失败，请管理员检查密钥和模型权限。", 503);
  else if (error?.status === 429) result = new AiError("AI_RATE_LIMIT", "AI 服务繁忙或额度不足，请稍后重试。", 429);
  else if (error?.status === 404 || error?.code === "model_not_found") result = new AiError("AI_MODEL_UNAVAILABLE", "配置的 AI 模型暂不可用，请管理员检查模型设置。", 503);
  else if (error?.status === 400) result = new AiError("AI_REQUEST_REJECTED", "AI 服务未接受本次构建请求，请管理员检查模型配置。", 503);
  else if (error?.name === "APIConnectionError" || error instanceof TypeError) result = new AiError("AI_NETWORK_ERROR", "暂时无法连接 AI 服务，请稍后重试。", 503);
  else result = new AiError("AI_UNAVAILABLE", "AI 构建暂时失败，请稍后重试。", 503);
  result.providerRequestId = error?.request_id || null;
  return result;
}
export function aiErrorResponse(error, requestId) {
  const known = error instanceof AiError;
  const code = known ? error.code : "REQUEST_FAILED";
  // Never log prompts, model text, key material, raw provider errors or SQL.
  console.error("[novel-builder]", JSON.stringify({ requestId, errorType: code, providerRequestId: known ? error.providerRequestId || null : null }));
  return Response.json({ error: known ? error.message : "请求失败，请稍后重试。", code, requestId }, { status: known ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}

// TEST PROCESS ONLY. Production does not import this module or accept a mock mode.
if (process.env.NOVELAI_AI_FIXTURE !== "1") throw new Error("AI fixture preload requires explicit test opt-in");
const upstream = process.env.NOVELAI_AI_FIXTURE_URL;
if (!/^http:\/\/127\.0\.0\.1:\d+\/responses$/.test(upstream || "")) throw new Error("Fixture must be a loopback server");
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  if (new URL(url).hostname === "api.openai.com") throw new Error("OpenAI must never be called by DeepSeek tests");
  if (new URL(url).hostname === "api.deepseek.com") {
    if (url !== "https://api.deepseek.com/responses") throw new Error("Unexpected DeepSeek test endpoint");
    const headers = new Headers(init?.headers || input?.headers);
    headers.delete("authorization");
    return originalFetch(upstream, { ...init, headers });
  }
  return originalFetch(input, init);
};

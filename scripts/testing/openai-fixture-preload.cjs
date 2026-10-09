// TEST PROCESS ONLY. Production does not import this module or accept a mock mode.
if (process.env.NOVELAI_OPENAI_FIXTURE !== "1") throw new Error("OpenAI fixture preload requires explicit test opt-in");
const upstream = process.env.NOVELAI_OPENAI_FIXTURE_URL;
if (!/^http:\/\/127\.0\.0\.1:\d+\/responses$/.test(upstream || "")) throw new Error("Fixture must be a loopback server");
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  if (url.startsWith("https://api.openai.com/")) {
    if (url !== "https://api.openai.com/v1/responses") throw new Error("Unexpected OpenAI test endpoint");
    const headers = new Headers(init?.headers || input?.headers);
    headers.delete("authorization");
    return originalFetch(upstream, { ...init, headers });
  }
  return originalFetch(input, init);
};

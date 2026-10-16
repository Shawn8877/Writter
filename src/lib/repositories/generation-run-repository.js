async function json(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "操作失败，请稍后重试。");
  return body;
}
const post = (path, body = {}) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(json);
export const generationRunRepository = {
  latest: (novelId) => fetch(`/api/ai/generation-runs?novelId=${encodeURIComponent(novelId)}`, { cache: "no-store" }).then(json),
  get: (id) => fetch(`/api/ai/generation-runs/${encodeURIComponent(id)}`, { cache: "no-store" }).then(json),
  start: (novelId, count, mode) => post("/api/ai/generation-runs", { novelId, count, mode }),
  advance: (id, manualApprove = false) => post(`/api/ai/generation-runs/${encodeURIComponent(id)}/advance`, { manualApprove }),
  retry: (id) => post(`/api/ai/generation-runs/${encodeURIComponent(id)}/retry`),
  cancel: (id) => post(`/api/ai/generation-runs/${encodeURIComponent(id)}/cancel`),
  generateOutline: (novelId, chapterNumber) => post("/api/ai/chapters/next-outline", { action: "generate", requestId: crypto.randomUUID(), novelId, chapterNumber }),
  confirmOutline: (generationId) => post("/api/ai/chapters/next-outline", { action: "confirm", generationId }),
};

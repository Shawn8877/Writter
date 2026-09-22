export async function studioRequest(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "保存失败，请检查网络后重试。");
    error.status = response.status;
    error.code = result.code || "REQUEST_FAILED";
    throw error;
  }
  return result;
}

export const cloudNovelRepository = {
  async list() { return (await studioRequest("/api/novels")).novels; },
  async get(id) { return (await studioRequest(`/api/novels/${encodeURIComponent(id)}`)).novel; },
  async create(draft) { return (await studioRequest("/api/novels", { method: "POST", body: JSON.stringify(draft) })).novel; },
  async update(previous, next) { return (await studioRequest(`/api/novels/${encodeURIComponent(previous.id)}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: previous.revision, novel: next }) })).novel; },
  async remove(id, revision) { await studioRequest(`/api/novels/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ expectedRevision: revision }) }); },
};

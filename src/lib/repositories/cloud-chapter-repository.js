import { studioRequest } from "./cloud-novel-repository";

export const cloudChapterRepository = {
  async save(novelId, chapterId, values, expectedRevision, { createVersion = false } = {}) {
    return studioRequest(`/api/chapters/${encodeURIComponent(chapterId)}`, { method: "POST", body: JSON.stringify({ novelId, values, expectedRevision, createVersion }) });
  },
  async versions(novelId, chapterId) {
    return (await studioRequest(`/api/chapters/${encodeURIComponent(chapterId)}/versions?novelId=${encodeURIComponent(novelId)}`)).versions;
  },
};

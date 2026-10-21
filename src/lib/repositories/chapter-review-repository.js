async function read(response) { const data = await response.json(); if (!response.ok) throw new Error(data.error || "AI 编辑审核暂时不可用。"); return data; }
const base = "/api/ai/chapters/review";
export const chapterReviewRepository = {
  list: (novelId, chapterId) => fetch(`${base}?novelId=${encodeURIComponent(novelId)}&chapterId=${encodeURIComponent(chapterId)}`, { cache: "no-store" }).then(read),
  review: (novelId, chapterId) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review", novelId, chapterId }) }).then(read),
  decide: (reviewId, findingIndex, decision) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "decision", reviewId, findingIndex, decision }) }).then(read),
  acknowledge: (reviewId) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "acknowledge", reviewId }) }).then(read),
};

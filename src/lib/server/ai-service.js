import "server-only";

// Legacy chapter/outline contract. Novel Builder uses /api/ai/novels/build.
export const AI_ACTIONS = [
  "build-novel",
  "generate-outline",
  "generate-chapter",
  "next-chapter",
  "regenerate",
  "expand",
  "polish",
  "revise-plot",
  "extract-memory",
];

/**
 * Future server pipeline: authenticate -> authorize novel -> assemble context ->
 * generate -> validate -> stage memory changes -> save chapter and memory revision.
 * @param {{action: string, novelId?: string, chapterId?: string, instructions?: string}} request
 */
export async function generateStory(request) {
  if (!AI_ACTIONS.includes(request.action))
    return { code: "INVALID_ACTION", message: "不支持的创作操作。" };
  return {
    code: "AI_NOT_CONNECTED",
    message: request.action === "build-novel" ? "请从创建小说页面使用 AI 构建，并在预览后确认保存。" : "此项 AI 创作功能尚未开放，当前不会生成或改写内容。",
  };
}

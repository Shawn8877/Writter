import "server-only";

// Phase 1 contract only. No SDK, API key lookup, model invocation or external request.
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
    message: "AI 功能尚未接入，当前仅提供创作界面预览。",
  };
}

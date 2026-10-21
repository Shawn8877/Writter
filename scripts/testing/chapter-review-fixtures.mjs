export function reviewFixture() {
  const result = { overallScore: 96, status: "passed", summary: "本章遵循现有设定并完成关键剧情，未发现有证据的事实冲突。", findings: [], suggestions: [] };
  for (const key of ["characterConsistency","worldConsistency","abilityConsistency","timelineConsistency","relationshipConsistency","foreshadowing","outlineExecution","plotProgression","repetitionRisk","fillerRisk","transitionQuality","bibleConsistency","memoryConsistency"]) result[key] = { score: 96, assessment: "已依据提供资料核对，未发现明确冲突。" };
  result.repetitionRisk.score=4; result.fillerRisk.score=4;
  return result;
}
export const reviewDependencies = {
  getConfig: () => ({ model: "deepseek-flash", apiKey: "fixture-only", timeoutMs: 1000 }),
  analyze: async () => ({ result: reviewFixture(), model: "deepseek-flash", inputTokens: 200, outputTokens: 150, providerRequestId: "fixture_review" }),
};

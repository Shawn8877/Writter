import assert from "node:assert/strict";
import { distribution, summarizeNovelHealth } from "../src/lib/diagnostics/novel-health.js";

assert.deepEqual(distribution([]), { count: 0, mean: null, p50: null, p95: null, max: null });
assert.equal(distribution(Array.from({ length: 20 }, (_, i) => i + 1)).p95, 19);
const result = summarizeNovelHealth({
  chapters: [{ id: "one", sort_order: 1, word_count: 3000 }, { id: "two", sort_order: 2, word_count: 0 }, { id: "eleven", sort_order: 11, word_count: 2900 }],
  memory_items: [{ content: "同一事实。", status: "active", memory_type: "plot" }, { content: "同一事实", status: "resolved", memory_type: "foreshadowing" }],
  characters: [{ id: "a" }], timeline_events: [],
  chapter_reviews: [
    { chapter_id: "one", created_at: "2026-01-01", status: "critical", overall_score: 20, result_json: { findings: [{ category: "world", severity: "critical" }] } },
    { chapter_id: "one", created_at: "2026-01-02", status: "passed", overall_score: 92, result_json: { fillerRisk: { score: 10 }, repetitionRisk: { score: 12 }, findings: [] } },
    { chapter_id: "one", created_at: "2026-01-03", status: "failed", overall_score: null },
    { chapter_id: "eleven", created_at: "2026-01-04", status: "needs_review", overall_score: 80, result_json: { fillerRisk: { score: 30 }, repetitionRisk: { score: 25 }, findings: [{ category: "timeline", severity: "high" }] } },
  ],
  ai_generation_logs: [
    { chapter_id: "one", generation_type: "chapter_generation", status: "failed", input_tokens: null, output_tokens: null, latency_ms: 500 },
    { chapter_id: "one", generation_type: "chapter_generation", status: "succeeded", input_tokens: 100, output_tokens: 50, latency_ms: 1000 },
    { chapter_id: "two", generation_type: "chapter_generation", status: "failed", input_tokens: null, output_tokens: null, latency_ms: null },
  ],
});
assert.equal(result.chapters, 2, "Planned empty chapters are not completed prose");
assert.equal(result.totalWords, 5900);
assert.equal(result.reviews.averageScore, 86, "One latest successful report per chapter, without hiding failed attempts");
assert.equal(result.stages[0].averageFillerRisk, 10);
assert.equal(result.stages[1].severity.high, 1);
assert.equal(result.stages[2].averageScore, null, "Missing stages are not zero quality");
assert.equal(result.generation.attempts, 3);
assert.equal(result.generation.failed, 2);
assert.equal(result.generation.missingUsage, 2, "Unknown failed usage is explicit");
assert.equal(result.stages[0].attempts, 3, "A failed planned chapter still belongs to its stage");
assert.equal(result.stages[0].failedAttempts, 2);
assert.equal(result.stages[0].chapters, 1, "The failed planned chapter is not counted as saved prose");
assert.equal(result.memory.exactDuplicates, 1);
assert.equal(result.memory.unresolvedForeshadowing, 0, "Resolved clues are not unresolved");
console.log("PASS: novel health counts, latest reports, stage risks, latency and unknown usage");

// Pure statistics shared by the development page and saved stress-test reports.
const sum = (rows, field) => rows.reduce((n, row) => n + (Number(row[field]) || 0), 0);
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const quantile = (p) => sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
  return { count: sorted.length, mean: mean(sorted), p50: quantile(0.5), p95: quantile(0.95), max: sorted.at(-1) ?? null };
}
export function summarizeNovelHealth(data) {
  const chapters = data.chapters.filter(row => row.word_count > 0).sort((a, b) => a.sort_order - b.sort_order);
  // Failed generation can belong to a planned chapter with no saved prose.
  // Include its attempt in stage failure rates without counting it as written.
  const chapterNumbers = new Map(data.chapters.map(row => [row.id, row.sort_order]));
  const logs = data.ai_generation_logs || [];
  const reviews = new Map();
  for (const row of [...(data.chapter_reviews || [])].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (["passed", "needs_review", "critical"].includes(row.status)) reviews.set(row.chapter_id, row);
  }
  const stage = (from, to) => {
    const inStage = (id) => chapterNumbers.get(id) >= from && chapterNumbers.get(id) <= to;
    const selected = [...reviews.values()].filter(row => inStage(row.chapter_id));
    const selectedLogs = logs.filter(row => inStage(row.chapter_id));
    const findings = selected.flatMap(row => row.result_json?.findings || []);
    return { from, to, chapters: chapters.filter(c => inStage(c.id)).length, averageScore: mean(selected.map(r => r.overall_score)),
      averageFillerRisk: mean(selected.map(r => r.result_json?.fillerRisk?.score).filter(Number.isFinite)),
      averageRepetitionRisk: mean(selected.map(r => r.result_json?.repetitionRisk?.score).filter(Number.isFinite)),
      severity: Object.fromEntries(["critical", "high", "medium", "low", "info"].map(level => [level, findings.filter(f => f.severity === level).length])),
      failedAttempts: selectedLogs.filter(l => l.status === "failed").length, attempts: selectedLogs.length };
  };
  const memories = data.memory_items || [];
  const normalized = memories.map(m => (m.content || "").normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, ""));
  const exactDuplicates = normalized.length - new Set(normalized).size;
  return { chapters: chapters.length, plannedChapters: data.chapters.length, totalWords: sum(chapters, "word_count"),
    memory: { total: memories.length, active: memories.filter(m => m.status === "active").length, resolved: memories.filter(m => m.status === "resolved").length,
      obsolete: memories.filter(m => m.status === "obsolete").length, exactDuplicates, exactDuplicateRatio: memories.length ? exactDuplicates / memories.length : 0,
      unresolvedForeshadowing: memories.filter(m => m.status === "active" && m.memory_type === "foreshadowing").length },
    characters: data.characters?.length || 0, timeline: data.timeline_events?.length || 0,
    reviews: { count: reviews.size, averageScore: mean([...reviews.values()].map(r => r.overall_score)),
      criticalChapters: [...reviews.values()].filter(r => r.status === "critical").length,
      categories: Object.fromEntries(["character", "world", "ability", "timeline", "relationship", "foreshadowing", "outline", "plot", "repetition", "filler", "transition", "bible", "memory"].map(category => [category, [...reviews.values()].flatMap(r => r.result_json?.findings || []).filter(f => f.category === category).length])) },
    generation: { attempts: logs.length, failed: logs.filter(l => l.status === "failed").length, inputTokens: sum(logs, "input_tokens"), outputTokens: sum(logs, "output_tokens"),
      missingUsage: logs.filter(l => l.input_tokens === null || l.output_tokens === null).length,
      byType: Object.fromEntries(["chapter_generation", "chapter_memory_analysis", "chapter_review"].map(type => {
        const selected = logs.filter(l => l.generation_type === type);
        return [type, { attempts: selected.length, failed: selected.filter(l => l.status === "failed").length, inputTokens: sum(selected, "input_tokens"), outputTokens: sum(selected, "output_tokens"),
          meanInputTokens: mean(selected.map(l => l.input_tokens).filter(Number.isFinite)), meanOutputTokens: mean(selected.map(l => l.output_tokens).filter(Number.isFinite)), latencyMs: distribution(selected.map(l => l.latency_ms)) }];
      })) },
    stages: [[1, 10], [11, 25], [26, 50], [51, 100]].map(([from, to]) => stage(from, to)),
    trend: chapters.map(chapter => ({ number: chapter.sort_order, words: chapter.word_count, score: reviews.get(chapter.id)?.overall_score ?? null,
      status: reviews.get(chapter.id)?.status || "pending", writerInputTokens: logs.filter(l => l.chapter_id === chapter.id && l.generation_type === "chapter_generation" && l.status === "succeeded").at(-1)?.input_tokens ?? null,
      stageLatencyMs: sum(logs.filter(l => l.chapter_id === chapter.id), "latency_ms") })) };
}

import { z } from "zod";

const text = (max = 1200) => z.string().trim().min(1).max(max);
const evidence = z.object({ source: z.enum(["chapter", "bible", "character", "world", "memory", "timeline", "foreshadowing", "outline", "previous_chapter", "previous_summary", "recent_summary"]), sourceId: z.uuid().nullable(), excerpt: text(500) }).strip();
const metric = z.object({ score: z.number().int().min(0).max(100).describe("质量分：0极差，100极好，越高越好。"), assessment: text(500) }).strip();
const riskMetric = z.object({ score: z.number().int().min(0).max(100).describe("风险强度：0表示没有风险，100表示极高风险；轻微或没有问题应给低分，不能按质量分打高分。"), assessment: text(500) }).strip();
export const reviewCategories = ["character", "world", "ability", "timeline", "relationship", "foreshadowing", "outline", "plot", "repetition", "filler", "transition", "bible", "memory"];
export const chapterReviewSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  status: z.enum(["passed", "needs_review", "critical"]),
  summary: text(1000),
  characterConsistency: metric,
  worldConsistency: metric,
  abilityConsistency: metric,
  timelineConsistency: metric,
  relationshipConsistency: metric,
  foreshadowing: metric,
  outlineExecution: metric,
  plotProgression: metric,
  repetitionRisk: riskMetric,
  fillerRisk: riskMetric,
  transitionQuality: metric,
  bibleConsistency: metric,
  memoryConsistency: metric,
  findings: z.array(z.object({
    category: z.enum(reviewCategories), severity: z.enum(["info", "low", "medium", "high", "critical"]),
    // A cross-chapter finding can need current/previous prose, outline, Bible
    // and timeline together. Keep a finite bound without discarding evidence.
    title: text(120), description: text(1000), evidence: z.array(evidence).min(1).max(8),
    relatedMemoryId: z.uuid().nullable(), relatedCharacterId: z.uuid().nullable(), relatedChapterId: z.uuid().nullable(), suggestion: text(700),
  }).strip()).max(24),
  suggestions: z.array(text(500)).max(12),
}).strip();
export const chapterReviewJsonSchema = z.toJSONSchema(chapterReviewSchema, { target: "draft-7" });

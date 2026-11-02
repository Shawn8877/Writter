import { AiError } from "../errors.js";
import { isProtectedMemory } from "../context/memory-selection.js";
import { chapterReviewJsonSchema } from "../schemas/chapter-review-schema.js";
import { chapterReviewMessages } from "../prompts/chapter-review-analyzer.js";
import { reviewEvidenceCatalog, reviewEvidenceSchema, groupReviewEvidence } from "./review-evidence.js";

export const REVIEW_REQUEST_BYTES = 180000;

// Budget the actual wire request, including evidence IDs and schema. Optional
// candidates are already ranked; never truncate prose or protected facts.
export function prepareChapterReviewInput(context, { model, reasoningEffort = "low" }) {
  const memories = [...context.memories];
  for (;;) {
    const selected = { ...context, memories, unresolvedForeshadowing: memories.filter(row => row.memory_type === "foreshadowing") };
    const passages = reviewEvidenceCatalog(selected);
    const schema = reviewEvidenceSchema(chapterReviewJsonSchema, passages);
    const input = chapterReviewMessages({ novel: selected.novel, chapter: { id: selected.chapter.id, title: selected.chapter.title, sort_order: selected.chapter.sort_order },
      characterStatus: selected.characters.map(({ id, name, is_alive }) => ({ id, name, is_alive })), evidencePassages: groupReviewEvidence(passages) });
    const request = { model, input, stream: false, reasoning: { effort: reasoningEffort }, max_output_tokens: 16000,
      ...(reasoningEffort === "none" ? { temperature: 0 } : {}),
      text: { format: { type: "json_schema", name: "chapter_review", schema, strict: true } } };
    const bytes = Buffer.byteLength(JSON.stringify(request), "utf8");
    if (bytes <= REVIEW_REQUEST_BYTES) return { request, passages, context: selected, bytes, omittedMemories: context.memories.length - memories.length };
    const removable = memories.findLastIndex(row => !isProtectedMemory(row));
    if (removable < 0) throw new AiError("CONTEXT_TOO_LARGE", "审核必需的正文、核心资料和重要伏笔已超出容量，请先核对整理。没有调用 AI。", 413);
    memories.splice(removable, 1);
  }
}

import { AiError } from "../errors.js";
import { currentMemoryContext } from "./context-projection.js";

export const MEMORY_MODEL_LIMIT = 120;
export const MEMORY_MODEL_BYTES = 60000;
const coreTypes = new Set(["rule", "ability", "secret", "world"]);
export const isProtectedMemory = row => row.status === "active" && row.importance >= 4 && (coreTypes.has(row.memory_type) || row.memory_type === "foreshadowing");
const normalize = value => (value || "").normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const words = text => new Set([...segmenter.segment(text)].filter(s => s.isWordLike && s.segment.length >= 2).map(s => s.segment));

// All durable rows stay available to the server-side merger. Only a bounded,
// relevant subset is sent to extraction; retired rows never displace active ones.
export function selectMemoryContext(memories, chapter, { limit = MEMORY_MODEL_LIMIT, maxBytes = MEMORY_MODEL_BYTES, deferProtectedBytes = false } = {}) {
  const chapterText = normalize(`${chapter.outline || ""}\n${chapter.content || ""}`);
  const candidates = memories.map((row, index) => {
    const active = row.status === "active";
    const title = normalize(row.title);
    const terms = words(`${row.title} ${row.content.slice(0, 160)}`);
    const overlap = [...terms].filter(term => chapterText.includes(normalize(term))).length / Math.max(1, terms.size);
    const protectedFact = isProtectedMemory(row);
    const score = row.importance * 4 + overlap * 8 + (title.length >= 4 && chapterText.includes(title) ? 12 : 0);
    return { row, index, active, protectedFact, score, time: Date.parse(row.updated_at || "") || 0 };
  }).sort((a, b) => Number(b.protectedFact) - Number(a.protectedFact) || Number(b.active) - Number(a.active) || b.score - a.score || b.time - a.time || a.index - b.index);
  const selected = []; let bytes = 2;
  for (const candidate of candidates) {
    const row = currentMemoryContext(candidate.row);
    const size = Buffer.byteLength(JSON.stringify(row), "utf8") + (selected.length ? 1 : 0);
    // Review has a second, exact wire budget. Its candidate byte allowance may
    // defer protected facts to that guard; the count limit remains hard.
    if (selected.length >= limit || (bytes + size > maxBytes && !(deferProtectedBytes && candidate.protectedFact))) {
      if (candidate.protectedFact) throw new AiError("CONTEXT_TOO_LARGE", "重要规则或未解决伏笔已超出分析容量，请先核对整理。历史记录未删除。", 413);
      continue;
    }
    selected.push(row); bytes += size;
  }
  return selected;
}

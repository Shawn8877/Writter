import { AiError } from "../errors.js";

const relatedSources = {
  relatedMemoryId: ["memory"],
  relatedCharacterId: ["character"],
  relatedChapterId: ["chapter", "previous_chapter", "recent_summary"],
};

// The model selects server-issued passages instead of retyping quotes and UUIDs.
// All stored excerpts still pass the ordinary exact-source validation.
export function reviewEvidenceCatalog(context) {
  const sources = [
    ["chapter", context.chapter.id, { content: context.chapter.content }],
    ["outline", context.chapter.id, { outline: context.chapter.outline }],
    ["bible", context.novel.id, context.bible],
    ["previous_chapter", context.previousChapter?.id, { content: context.previousChapter?.content }],
    ["previous_summary", context.previousSummary?.chapter_id, context.previousSummary],
    ...context.recentSummaries.map(row => ["recent_summary", row.id, row]),
    ...context.characters.map(row => ["character", row.id, row]),
    ...context.world.map(row => ["world", row.id, row]),
    // Type/status describe a record, not evidence of a story event. Emitting
    // them as individual passages added 200 redundant IDs at 100 memories.
    ...context.memories.map(row => ["memory", row.id, { title: row.title, content: row.content }, {
      memoryType: row.memory_type, status: row.status, sourceChapterId: row.chapter_id || null,
      analysisChapterId: row.analysisChapterId || null,
      derivedFromCurrentChapter: row.chapter_id === context.chapter.id || row.analysisChapterId === context.chapter.id,
    }]),
    ...context.timeline.map(row => ["timeline", row.id, row, {
      sourceChapterId: row.chapter_id || null, derivedFromCurrentChapter: row.chapter_id === context.chapter.id,
    }]),
  ];
  const passages = [];
  for (const [source, sourceId, record, attributes] of sources) {
    if (!sourceId || !record) continue;
    const seen = new Set();
    function collect(value, field) {
      if (typeof value === "string") {
        if (/^[\da-f]{8}-[\da-f-]{27}$/i.test(value) || !value.trim()) return;
        for (const paragraph of value.split(/\n+/).filter(text => text.trim())) {
          for (let offset = 0; offset < paragraph.length; offset += 480) {
            const excerpt = paragraph.slice(offset, offset + 480).trim();
            if (!excerpt || seen.has(excerpt)) continue;
            seen.add(excerpt);
            passages.push({ id: `R${passages.length + 1}`, source, sourceId, field, excerpt, ...(attributes ? { attributes } : {}) });
          }
        }
      } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) collect(child, field ? `${field}.${key}` : key);
      }
    }
    collect(record, "");
  }
  return passages;
}

export function reviewEvidenceSchema(schema, passages) {
  const copy = structuredClone(schema);
  copy.properties.findings.items.properties.evidence.items = { type: "string", enum: passages.map(p => p.id) };
  // Related links are redundant with the evidence sources. Only the server
  // derives them, so the model cannot invent a second set of record IDs.
  for (const field of Object.keys(relatedSources)) {
    delete copy.properties.findings.items.properties[field];
    copy.properties.findings.items.required = copy.properties.findings.items.required.filter(key => key !== field);
  }
  return copy;
}

export function groupReviewEvidence(passages) {
  const groups = new Map();
  for (const { id, source, sourceId, field, excerpt, attributes } of passages) {
    const key = `${source}:${sourceId}`;
    if (!groups.has(key)) groups.set(key, { source, sourceId, ...attributes, passages: [] });
    // Fixed columns preserve all excerpts and fields without repeating object
    // property names hundreds of times in the provider input.
    groups.get(key).passages.push([id, field, excerpt]);
  }
  return [...groups.values()];
}

export function resolveReviewEvidence(result, passages) {
  if (!Array.isArray(result?.findings)) throw new AiError("INVALID_AI_OUTPUT", "审核结果缺少问题列表。");
  const byId = new Map(passages.map(p => [p.id,p]));
  return { ...result, findings: result.findings.map(finding => {
    if (!Array.isArray(finding?.evidence)) throw new AiError("INVALID_AI_OUTPUT", "审核结果缺少证据列表。");
    const evidence = finding.evidence.map(item => {
      const passage = byId.get(typeof item === "string" ? item : item?.evidenceId);
      if (!passage) throw new AiError("INVALID_AI_OUTPUT", "审核引用了未提供的证据编号，未保存报告。");
      return { source: passage.source, sourceId: passage.sourceId, excerpt: passage.excerpt };
    });
    // A navigation link points to the first cited record of its type, never a
    // guessed entity from prose. All citations remain in evidence for review.
    const related = Object.fromEntries(Object.entries(relatedSources).map(([field, sources]) => [field,
      evidence.find(item => sources.includes(item.source))?.sourceId || null]));
    return { ...finding, evidence, ...related };
  }) };
}

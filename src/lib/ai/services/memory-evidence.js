import { AiError } from "../errors.js";
import { currentCharacterContext } from "../context/context-projection.js";
import { selectMemoryContext } from "../context/memory-selection.js";

export function memoryEvidenceCatalog(content) {
  const passages = [];
  for (const paragraph of content.split(/\n+/).filter(part => part.trim())) {
    for (let offset = 0; offset < paragraph.length; offset += 480) {
      passages.push({ id: `E${passages.length + 1}`, text: paragraph.slice(offset,offset + 480) });
    }
  }
  return passages;
}

export function memoryEvidenceSchema(schema, passages) {
  const copy = structuredClone(schema);
  const ids = passages.map(passage => passage.id);
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.properties?.evidence) node.properties.evidence = { type: "string", enum: ids };
    for (const value of Object.values(node)) visit(value);
  }
  visit(copy);
  return copy;
}

// Audit history and old evidence are needed when merging durable rows, not when
// asking the model to identify current facts. Keep the original context intact.
export function chapterMemoryModelContext(context) {
  // The complete ordered prose is already present in evidencePassages. Avoid
  // copying it a second time; the durable context still keeps the original text.
  const { content: _prose, ...chapter } = context.chapter;
  const memories = selectMemoryContext(context.memories, context.chapter);
  return { ...context, chapter, characters: context.characters.map(currentCharacterContext), memories };
}

export function memoryReferenceSchema(schema, memories) {
  const copy = structuredClone(schema);
  // Existing rows are updated through one ID-only channel. Requiring an ID in
  // a second, typed array made the real model reclassify plot rows as items.
  // Keep legacy IDs subject to the mapper's strict checks, never repair them.
  for (const field of ["newFacts", "worldUpdates", "abilityChanges", "items", "foreshadowingAdded"]) {
    const item = copy.properties[field].items;
    delete item.properties.existingMemoryId;
    item.required = item.required.filter(key => key !== "existingMemoryId");
  }
  // Existing facts have an authoritative database type. Do not ask the model
  // to reclassify them while choosing a reference ID.
  const active = memories.filter(m => m.status === "active").map(m => m.id);
  if (active.length) copy.properties.memoryUpdates.items.properties.memoryId = { type: "string", enum: active };
  else copy.properties.memoryUpdates.maxItems = 0;
  const unresolved = memories.filter(m => m.memory_type === "foreshadowing" && m.status === "active").map(m => m.id);
  if (unresolved.length) copy.properties.foreshadowingResolved.items.properties.memoryId = { type: "string", enum: unresolved };
  else copy.properties.foreshadowingResolved.maxItems = 0;
  return copy;
}

export function resolveMemoryEvidence(result, passages) {
  const byId = new Map(passages.map(passage => [passage.id,passage.text]));
  for (const [key,items] of Object.entries(result)) {
    if (!Array.isArray(items)) continue;
    for (const [index,item] of items.entries()) {
      if (!byId.has(item.evidence)) {
        const error = new AiError("INVALID_AI_OUTPUT", "记忆分析引用了未提供的证据编号，未更新记忆。");
        error.validationIssues = [{ code: "unknown_evidence_id", path: [key,index,"evidence"] }];
        throw error;
      }
      item.evidence = byId.get(item.evidence);
    }
  }
  return result;
}

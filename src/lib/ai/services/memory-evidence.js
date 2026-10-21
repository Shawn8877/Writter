import { AiError } from "../errors.js";

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

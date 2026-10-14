import "server-only";
import { AiError } from "../errors.js";
import { chapterMemorySchema } from "../schemas/chapter-memory-schema.js";

const normalized = (s) => s.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
function similarity(a, b) {
  const grams = (s) => { const normalizedText = normalized(s); return new Set([...normalizedText].slice(1).map((_, i) => normalizedText.slice(i, i + 2))); };
  const aa = grams(a); const bb = grams(b);
  return aa.size && bb.size ? [...aa].filter((v) => bb.has(v)).length / Math.max(aa.size, bb.size) : 0;
}
function sameSubject(a, b) {
  const [shorter, longer] = [normalized(a), normalized(b)].sort((x, y) => x.length - y.length);
  return shorter.length >= 4 && longer.startsWith(`${shorter}的`);
}
function invalid(code, path = []) { const error = new AiError("INVALID_AI_OUTPUT", "章节分析含无效引用或缺少正文证据，未更新记忆，请重试。", 422); error.validationIssues = [{ code, path }]; throw error; }
const combine = (old, next) => !old ? next : normalized(old).includes(normalized(next)) ? old : `${old}\n${next}`;
const unique = (items) => [...new Map(items.map((item) => [JSON.stringify(item), item])).values()];

export function prepareChapterMemoryResult(raw, context) {
  const result = chapterMemorySchema.parse(raw);
  const prose = context.chapter.content.replace(/\s/g, "");
  for (const [key, items] of Object.entries(result)) {
    if (key === "chapterSummary") continue;
    for (const [index, item] of items.entries()) if (!prose.includes(item.evidence.replace(/\s/g, ""))) invalid("evidence_not_found", [key, index, "evidence"]);
  }
  const characters = structuredClone(context.characters);
  const touched = new Set();
  const findCharacter = (name) => {
    const matches = characters.filter((c) => c.name === name || c.aliases?.includes(name));
    if (matches.length > 1) invalid("ambiguous_character");
    return matches[0];
  };
  for (const item of result.newCharacters) {
    if (!prose.includes(item.name)) invalid("invented_character_name", ["newCharacters"]);
    if (findCharacter(item.name)) continue;
    const row = { id: null, name: item.name, role: item.role, description: item.description, aliases: [], current_state: {}, relationships: [], abilities: [] };
    characters.push(row); touched.add(row);
  }
  const requiredCharacter = (name) => { const c = findCharacter(name); if (!c) invalid("unknown_character"); touched.add(c); return c; };
  for (const item of result.characterChanges) {
    const c = requiredCharacter(item.characterName);
    const previous = typeof c.current_state === "object" && !Array.isArray(c.current_state) ? c.current_state || {} : { description: String(c.current_state || "") };
    const { isAlive, ...state } = item.newState;
    if (isAlive !== null) c.is_alive = isAlive;
    c.current_state = { ...previous, ...Object.fromEntries(Object.entries(state).filter(([, v]) => v !== null)),
      recentChanges: unique([...(previous.recentChanges || []), { chapterId: context.chapter.id, type: item.changeType, description: item.description }]).slice(-20) };
  }
  for (const item of result.relationshipChanges) {
    const c = requiredCharacter(item.characterName); if (!findCharacter(item.targetName)) invalid("unknown_relationship_target");
    c.relationships = unique([...(Array.isArray(c.relationships) ? c.relationships : []), { name: item.targetName, description: item.description, chapterId: context.chapter.id }]);
  }
  for (const item of result.abilityChanges) {
    const c = requiredCharacter(item.characterName);
    const abilities = Array.isArray(c.abilities) ? c.abilities : [];
    const existing = abilities.find((a) => typeof a === "object" && normalized(a.name || a.title || "") === normalized(item.title));
    if (existing) existing.description = combine(existing.description || existing.content || "", item.description);
    else abilities.push({ name: item.title, description: item.description });
    c.abilities = unique(abilities);
  }
  const memories = structuredClone(context.memories);
  const changed = new Set();
  const saveFact = (item, type) => {
    let row = item.existingMemoryId ? memories.find((m) => m.id === item.existingMemoryId) : null;
    if (item.existingMemoryId && (!row || row.memory_type !== type)) invalid("unknown_memory_reference", [type]);
    if (!row) row = memories.find((m) => m.memory_type === type && (normalized(m.title) === normalized(item.title) || similarity(m.content, item.description) >= 0.72 || ((similarity(m.title, item.title) >= 0.65 || sameSubject(m.title, item.title)) && similarity(m.content, item.description) >= 0.35)));
    if (!row) { row = { id: null, memory_type: type, title: item.title, content: "", importance: item.importance, status: "active", metadata: {} }; memories.push(row); }
    // Never resurrect resolved or obsolete facts automatically.
    if (row.status !== "active") return;
    const previous = { sourceType: row.source_type || "chapter", sourceId: row.source_id || context.chapter.id, content: row.content };
    row.content = combine(row.content, item.description);
    if (row.content.length > 8000) throw new AiError("MEMORY_TOO_LARGE", "部分记忆过长，请整理后重新分析。", 413);
    row.importance = Math.max(row.importance, item.importance);
    row.metadata = { ...(row.metadata || {}), history: unique([...(row.metadata?.history || []), ...(previous.content ? [previous] : [])]).slice(-20), lastEvidence: item.evidence, analysisChapterId: context.chapter.id };
    changed.add(row);
  };
  for (const item of result.newFacts) saveFact(item, item.memoryType);
  for (const item of result.worldUpdates) saveFact(item, "world");
  for (const item of result.abilityChanges) saveFact(item, "ability");
  for (const item of result.items) saveFact(item, "item");
  for (const item of result.foreshadowingAdded) saveFact(item, "foreshadowing");
  for (const item of result.keyEvents.filter((i) => i.importance >= 4)) saveFact(item, "plot");
  for (const item of result.foreshadowingResolved) {
    const row = memories.find((m) => m.id === item.memoryId && m.memory_type === "foreshadowing");
    if (!row || row.status === "obsolete") invalid("invalid_foreshadowing_reference");
    if (row.status === "resolved") continue;
    row.metadata = { ...row.metadata, resolution: { chapterId: context.chapter.id, description: item.description, evidence: item.evidence }, originalSource: { type: row.source_type, id: row.source_id } };
    row.status = "resolved"; changed.add(row);
  }
  const payload = { ...result, characters: [...touched], memories: [...changed],
    newInformation: [...result.newFacts, ...result.worldUpdates, ...result.abilityChanges, ...result.items],
    nextChapterRequirements: result.nextChapterRequirements.map((i) => i.requirement) };
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 150000) throw new AiError("MEMORY_TOO_LARGE", "本章提取结果过多，未更新记忆，请重试。", 413);
  return payload;
}

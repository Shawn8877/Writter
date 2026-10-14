import { z } from "zod";

// JSON Schema still sends additionalProperties:false. On receipt, project onto
// this allowlist: provider-added annotations cannot change identity/base fields.
// Missing fields, wrong types, oversized arrays and invalid evidence still fail.

const text = (max = 1200) => z.string().trim().min(1).max(max);
const evidence = text(500);
const importance = z.number().int().min(1).max(5);
const factFields = { title: text(100), description: text(), importance, evidence, existingMemoryId: z.uuid().nullable() };
const fact = z.object(factFields).strip();
const list = (schema, max = 12) => z.array(schema).max(max);
export const chapterMemorySchema = z.object({
  chapterSummary: z.string().trim().min(100).max(300),
  keyEvents: list(z.object({ title: text(100), description: text(), importance, evidence }).strip(), 8),
  characterChanges: list(z.object({ characterName: text(80), changeType: z.enum(["new", "growth", "relationship", "status_change", "knowledge_change"]), description: text(), newState: z.object({ description: text(), location: text(200).nullable(), health: text(200).nullable(), activity: text(300).nullable(), isAlive: z.boolean().nullable() }).strip(), evidence }).strip()),
  newCharacters: list(z.object({ name: text(80), role: text(80), description: text(), evidence }).strip(), 8),
  relationshipChanges: list(z.object({ characterName: text(80), targetName: text(80), description: text(), evidence }).strip()),
  newFacts: list(z.object({ ...factFields, memoryType: z.enum(["character", "relationship", "world", "ability", "item", "secret", "rule", "plot", "location", "other"]) }).strip()),
  worldUpdates: list(fact, 8),
  timelineEvents: list(z.object({ title: text(100), description: text(), importance, eventTime: z.string().max(100), evidence }).strip(), 8),
  abilityChanges: list(z.object({ ...factFields, characterName: text(80) }).strip(), 8),
  items: list(fact, 8),
  foreshadowingAdded: list(fact, 8),
  foreshadowingResolved: list(z.object({ memoryId: z.uuid(), description: text(), evidence }).strip(), 8),
  nextChapterRequirements: list(z.object({ requirement: text(500), evidence }).strip(), 10),
}).strip();
export const chapterMemoryJsonSchema = z.toJSONSchema(chapterMemorySchema, { target: "draft-7" });

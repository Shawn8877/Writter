import { z } from "zod";

export const BUILDER_SCHEMA_VERSION = "novel-builder-v1";
export const MEMORY_TYPES = ["character", "relationship", "world", "timeline", "location", "item", "ability", "secret", "foreshadowing", "plot", "rule", "other"];
const text = (max = 600) => z.string().trim().min(1).max(max);
const list = (max = 10) => z.array(text()).max(max);
const object = (shape) => z.strictObject(shape);
const optionalInput = (max) => z.string().trim().max(max).optional().default("");

export const builderInputSchema = object({
  genre: z.enum(["都市", "玄幻", "仙侠", "科幻", "历史", "悬疑", "末世", "游戏", "言情", "其他"]),
  premise: text(500), style: text(120), protagonistHint: z.string().trim().max(1000),
  targetWordCount: z.number().int().min(1000).max(10000000),
  targetChapterCount: z.number().int().min(8).max(2000),
  chapterWordTarget: z.number().int().min(100).max(50000),
  audience: optionalInput(100), pace: optionalInput(100), romanceLevel: optionalInput(100),
  darknessLevel: optionalInput(100), specialRequirements: optionalInput(1500),
});
export const buildRequestSchema = object({ requestId: z.uuid(), input: builderInputSchema });

const relationship = object({ from: text(40), to: text(40), relationship: text(), conflict: text() });
const namedEntry = object({ name: text(80), description: text(800), storyRole: text() });
const antagonist = object({ name: text(40), identity: text(), motivation: text(), conflict: text(), escalation: text() }).nullable();
export const storyStageSchema = object({
  stageNumber: z.number().int().min(1).max(12), title: text(80),
  approxStartChapter: z.number().int().min(1).max(2000), approxEndChapter: z.number().int().min(1).max(2000),
  objective: text(), mainConflict: text(), majorEvents: z.array(text()).min(2).max(5),
  characterNames: z.array(text(40)).min(1).max(10),
  characterGrowth: text(), stakes: text(), turningPoint: text(), endingHook: text(),
});

// This is the exact schema sent through Responses Structured Outputs. Cross-field
// semantics are checked separately, so the JSON Schema stays SDK-compatible.
export const novelBuilderSchema = object({
  title: text(80), alternativeTitles: z.array(text(80)).min(2).max(4), synopsis: text(2000), shortPitch: text(200),
  genre: text(40), subgenres: list(4), targetAudience: text(200), tone: text(200), writingStyle: text(500),
  corePremise: text(1200), coreSellingPoints: z.array(text(300)).min(3).max(8), mainConflict: text(1200), storyThemes: z.array(text(200)).min(1).max(6),
  protagonist: object({
    name: text(40), aliases: z.array(text(40)).max(5), age: text(40), gender: text(40), appearance: text(),
    personality: text(), background: text(1000), initialStatus: text(), goal: text(), motivation: text(),
    strengths: z.array(text(200)).min(1).max(5), weaknesses: z.array(text(200)).min(1).max(5),
    internalConflict: text(), externalConflict: text(), growthArc: text(1000), abilities: list(6), relationships: list(8),
  }),
  majorCharacters: z.array(object({
    name: text(40), role: text(80), age: text(40), gender: text(40), personality: text(), background: text(),
    goal: text(), motivation: text(), relationshipToProtagonist: text(), conflictWithProtagonist: text(),
    growthDirection: text(), importantSecrets: list(3), initialState: text(),
  })).min(5).max(10),
  antagonists: object({ earlyStageAntagonist: antagonist, midStageAntagonist: antagonist, longTermAntagonist: antagonist }),
  world: object({
    setting: text(1000), era: text(200), mainLocations: z.array(namedEntry).min(2).max(6), organizations: z.array(namedEntry).max(5),
    socialRules: z.array(text()).min(1).max(6), economicRules: z.array(text()).min(1).max(6),
    technologyOrMagicRules: z.array(text()).min(1).max(6), importantConcepts: z.array(namedEntry).max(5),
  }),
  powerSystem: object({
    enabled: z.boolean(), name: text(80).nullable(), description: text(1000).nullable(),
    rules: list(6), limitations: list(6), growthPath: list(6), costs: list(6), forbiddenUses: list(6),
  }),
  relationships: z.array(relationship).min(3).max(15),
  storyStages: z.array(storyStageSchema).min(8).max(12),
  romanceDirection: text(1000), endingDirection: text(1200), forbiddenChanges: z.array(text()).min(3).max(12),
  seedMemories: z.array(object({ type: z.enum(MEMORY_TYPES), title: text(100), content: text(1000), importance: z.number().int().min(1).max(5), characterNames: z.array(text(40)).max(10) })).min(10).max(30),
});

export function parseNovelPlan(value, input) {
  const plan = novelBuilderSchema.parse(value);
  const issues = [];
  const issue = (path, message) => issues.push({ code: "custom", path, message });
  if (plan.genre !== input.genre) issue(["genre"], "题材必须与输入一致");
  const names = [plan.protagonist.name, ...plan.majorCharacters.map((person) => person.name)];
  if (new Set(names).size !== names.length) issue(["majorCharacters"], "人物姓名不可重复，主角不可重复出现在配角列表");
  const knownNames = new Set([...names, ...Object.values(plan.antagonists).filter(Boolean).map((person) => person.name)]);
  if (Object.values(plan.antagonists).some((person) => person?.name === plan.protagonist.name)) issue(["antagonists"], "主角不能同时被登记为反派");
  for (const [index, relation] of plan.relationships.entries()) {
    if (!knownNames.has(relation.from) || !knownNames.has(relation.to) || relation.from === relation.to) issue(["relationships", index], "关系必须引用已定义的不同人物或对手");
  }
  let nextChapter = 1;
  plan.storyStages.forEach((stage, index) => {
    if (stage.stageNumber !== index + 1 || stage.approxStartChapter !== nextChapter || stage.approxEndChapter < stage.approxStartChapter || stage.approxEndChapter > input.targetChapterCount) issue(["storyStages", index], "阶段须按顺序连续覆盖目标章节，不能重叠或倒序");
    nextChapter = stage.approxEndChapter + 1;
    if (!stage.characterNames.includes(plan.protagonist.name) || stage.characterNames.some((name) => !knownNames.has(name))) issue(["storyStages", index, "characterNames"], "阶段必须使用主角及已定义人物的规范姓名");
  });
  plan.seedMemories.forEach((memory, index) => {
    if (memory.characterNames.some((name) => !knownNames.has(name))) issue(["seedMemories", index, "characterNames"], "记忆人物必须使用已定义的规范姓名");
  });
  if (!plan.seedMemories.some((memory) => memory.type === "character" && memory.characterNames.includes(plan.protagonist.name) && `${memory.title}${memory.content}`.includes(plan.protagonist.name))) issue(["seedMemories"], "初始记忆必须包含主角身份事实及规范姓名");
  // Catch explicit contradictory identity assertions in prose; general narrative
  // continuity still requires human review and later memory tooling.
  for (const match of JSON.stringify(plan).matchAll(/主角(?:名叫|叫做|姓名为|名为|叫)([\p{Script=Han}]{2,4})(?=[，。；、\s"：])/gu)) {
    if (match[1] !== plan.protagonist.name && !plan.protagonist.aliases.includes(match[1])) issue(["protagonist"], "正文设定中的主角姓名与人物档案不一致");
  }
  if (nextChapter !== input.targetChapterCount + 1) issue(["storyStages"], "故事阶段未覆盖全部目标章节");
  const power = plan.powerSystem;
  if (power.enabled && (!power.name || !power.description || [power.rules, power.limitations, power.growthPath, power.costs, power.forbiddenUses].some((items) => !items.length))) issue(["powerSystem"], "特殊机制须包含边界、成长和代价");
  if (!power.enabled && (power.name !== null || power.description !== null || [power.rules, power.limitations, power.growthPath, power.costs, power.forbiddenUses].some((items) => items.length))) issue(["powerSystem"], "没有特殊能力时不得附加能力体系");
  if (plan.coreSellingPoints.some((point) => /^(剧情精彩|人物丰满|情节跌宕|引人入胜)[。！!]*$/.test(point))) issue(["coreSellingPoints"], "卖点需要具体描述");
  if (issues.length) throw new z.ZodError(issues);
  return plan;
}

export const confirmRequestSchema = object({ generationId: z.uuid(), input: builderInputSchema, plan: novelBuilderSchema });

import "server-only";
import { BUILDER_SCHEMA_VERSION } from "../schemas/novel-builder-schema.js";

const lines = (values) => values.filter(Boolean).join("\n");
export function mapNovelBundle(plan, input) {
  const hero = plan.protagonist;
  const power = plan.powerSystem;
  const powerDescription = power.enabled ? lines([power.name, power.description, ...["rules", "limitations", "growthPath", "costs", "forbiddenUses"].map((key, index) => `${["规则", "限制", "成长路径", "代价", "禁止用途"][index]}：${power[key].join("；")}`)]) : "本故事没有超能力、修炼或特殊系统。";
  const relations = (name) => plan.relationships.filter((item) => item.from === name || item.to === name);
  const characters = [{
    name: hero.name, aliases: hero.aliases, role: "主角", age: hero.age, gender: hero.gender,
    description: lines([hero.background, `内在冲突：${hero.internalConflict}`, `外在冲突：${hero.externalConflict}`]),
    personality: hero.personality, appearance: hero.appearance, background: hero.background,
    goals: lines([`目标：${hero.goal}`, `动机：${hero.motivation}`, `成长：${hero.growthArc}`]),
    relationships: [...relations(hero.name), ...hero.relationships.map((description) => ({ description }))], abilities: hero.abilities,
    current_state: { description: hero.initialStatus, strengths: hero.strengths, weaknesses: hero.weaknesses, growthArc: hero.growthArc }, traits: ["主角"], color: "gold",
  }, ...plan.majorCharacters.map((person) => ({
    name: person.name, aliases: [], role: "重要配角", age: person.age, gender: person.gender,
    description: lines([`身份：${person.role}`, person.background, `与主角的关系：${person.relationshipToProtagonist}`, `与主角的冲突：${person.conflictWithProtagonist}`]),
    personality: person.personality, appearance: "", background: person.background,
    goals: lines([`目标：${person.goal}`, `动机：${person.motivation}`, `成长：${person.growthDirection}`]),
    relationships: relations(person.name), abilities: [], current_state: { description: person.initialState, importantSecrets: person.importantSecrets, growthDirection: person.growthDirection }, traits: [person.role], color: "green",
  }))];
  const opposition = Object.entries(plan.antagonists).filter(([, person]) => person);
  for (const [stage, person] of opposition) {
    const existing = characters.find((item) => item.name === person.name);
    if (existing) {
      existing.current_state.antagonistStages = [...(existing.current_state.antagonistStages || []), { stage, ...person }];
      existing.role = "主要反派";
    } else characters.push({
      name: person.name, aliases: [], role: "主要反派", age: "待定", gender: "待定",
      description: lines([person.identity, `冲突：${person.conflict}`, `递进：${person.escalation}`]), personality: "", appearance: "", background: person.identity,
      goals: person.motivation, relationships: relations(person.name), abilities: [], current_state: { description: person.conflict, antagonistStages: [{ stage, ...person }] }, traits: ["对手"], color: "gold",
    });
  }
  const worldEntries = [
    { category: "history", name: "时代与故事舞台", content: lines([plan.world.era, plan.world.setting]), metadata: {} },
    ...[["mainLocations", "location"], ["organizations", "organization"], ["importantConcepts", "concept"]].flatMap(([key, category]) => plan.world[key].map((item) => ({ category, name: item.name, content: lines([item.description, `故事作用：${item.storyRole}`]), metadata: {} }))),
    ...[["socialRules", "社会规则"], ["economicRules", "经济规则"], ["technologyOrMagicRules", "技术与世界边界"]].map(([key, name]) => ({ category: "rule", name, content: plan.world[key].join("\n"), metadata: {} })),
    ...(power.enabled ? [{ category: "system", name: power.name, content: powerDescription, metadata: { enabled: true } }] : []),
  ];
  return {
    novel: { title: plan.title, description: plan.synopsis, genre: input.genre, style: plan.writingStyle, premise: plan.corePremise, protagonist: lines([hero.name, hero.background, hero.goal]), target_word_count: input.targetWordCount, target_chapter_count: input.targetChapterCount, chapter_word_target: input.chapterWordTarget },
    bible: {
      core_premise: plan.corePremise, synopsis: plan.synopsis, world_rules: [...plan.world.socialRules, ...plan.world.economicRules, ...plan.world.technologyOrMagicRules],
      story_tone: plan.tone, writing_style: plan.writingStyle, protagonist_arc: `${hero.name}：${hero.growthArc}`, main_conflict: plan.mainConflict, power_system: powerDescription,
      romance_direction: plan.romanceDirection, ending_direction: plan.endingDirection, forbidden_changes: plan.forbiddenChanges,
      storyline: plan.storyStages.map((stage) => `${stage.stageNumber}. ${stage.title}（第 ${stage.approxStartChapter}–${stage.approxEndChapter} 章）：${stage.objective}`).join("\n"),
      antagonist: opposition.map(([stage, person]) => `${{ earlyStageAntagonist: "前期", midStageAntagonist: "中期", longTermAntagonist: "长期" }[stage]}：${person.name}，${person.conflict}`).join("\n") || "冲突主要来自关系或环境，没有固定反派。",
      story_stages: plan.storyStages,
      builder_metadata: { schemaVersion: BUILDER_SCHEMA_VERSION, alternativeTitles: plan.alternativeTitles, shortPitch: plan.shortPitch, subgenres: plan.subgenres, targetAudience: plan.targetAudience, coreSellingPoints: plan.coreSellingPoints, storyThemes: plan.storyThemes },
    },
    characters, world_entries: worldEntries,
    memory_items: plan.seedMemories.map((item) => ({ memory_type: item.type, title: item.title, content: item.content, importance: item.importance, character_names: item.characterNames })),
  };
}

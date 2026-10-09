// Explicit synthetic fixtures. These are never imported by application code.
export function builderInput(genre = "都市", chapters = 100) {
  return { genre, premise: genre === "都市" ? "一个医疗器械销售靠专业知识和团队协作解决客户难题，逐步创业。" : `${genre}题材的普通青年在代价与责任中成长。`, style: "冷峻写实", protagonistHint: "27 岁，执行力强，经济困难。", targetWordCount: chapters * 3000, targetChapterCount: chapters, chapterWordTarget: 3000, audience: "成年读者", pace: "逐步递进", romanceLevel: "慢热", darknessLevel: "有希望", specialRequirements: genre === "玄幻" ? "修炼需要代价" : "没有特殊能力" };
}
export function novelPlan(input = builderInput()) {
  const fantasy = input.genre === "玄幻";
  const names = ["许知远", "周岚", "宋宁", "林晓", "吴山"];
  const plan = {
    title: `${input.genre} · 长路微光`, alternativeTitles: ["一步向前", "远方仍有灯"], synopsis: "林舟在一次工作危机后重新寻找自己的位置，在行业规则、伙伴分歧和个人选择中，建立值得信赖的团队。",
    shortPitch: "普通人从解决一个具体难题开始，学会承担更大的责任。", genre: input.genre, subgenres: ["成长"], targetAudience: "喜欢人物成长的成年读者", tone: "写实中保留希望", writingStyle: "节奏明快，以行动和对白塑造人物。",
    corePremise: input.premise, coreSellingPoints: ["从小订单到团队创业的职业成长", "专业知识与真实沟通破解信息差", "伙伴的独立目标导致持续利益冲突"], mainConflict: "个人诚信和组织生存不断碰撞，主角必须建立可持续的规则。", storyThemes: ["责任", "选择的代价"],
    protagonist: { name: "林舟", aliases: [], age: "27 岁", gender: "男", appearance: "衣着整洁，神情疲惫。", personality: "执行力强，但不愿求助。", background: "从普通销售岗位起步，背负家庭债务。", initialStatus: "经济困难，面临一次重要考验。", goal: "帮助家人并建立可信赖的团队。", motivation: "不愿重复上一代的无力与失信。", strengths: ["执行力", "观察细节"], weaknesses: ["过度承担", "沟通迟缓"], internalConflict: "独自承担与相信他人之间的矛盾。", externalConflict: "短期生存压力与长期信誉相冲突。", growthArc: "从独自解题走向培养团队与维护规则。", abilities: fantasy ? ["基础感知，使用后疲劳"] : ["需求分析", "沟通协调"], relationships: ["周岚是共同承担风险的伙伴。"] },
    majorCharacters: names.map((name, index) => ({ name, role: index ? "合作伙伴" : "行业对手", age: `${28 + index} 岁`, gender: index % 2 ? "女" : "男", personality: "重视承诺，也坚持自身利益。", background: "经历过行业变化，对未来有自己的判断。", goal: `守护第 ${index + 1} 项独立事业。`, motivation: "不愿让家人的付出付诸东流。", relationshipToProtagonist: "因具体合作与主角相识。", conflictWithProtagonist: "对风险分配与决策权存在分歧。", growthDirection: "学会坦诚表达边界与责任。", importantSecrets: ["曾经的一次失误尚未公开。"], initialState: "谨慎观望，尚未建立信任。" })),
    antagonists: { earlyStageAntagonist: { name: "许知远", identity: "资源更多的行业对手", motivation: "保住所在组织的份额。", conflict: "争夺同一关键机会。", escalation: "从单次竞争发展为规则争议。" }, midStageAntagonist: null, longTermAntagonist: null },
    world: { setting: "一座产业转型中的城市，机会伴随着不确定性。", era: fantasy ? "架空纪元" : "当代", mainLocations: [{ name: "旧街工作室", description: "团队最初落脚的狭小空间。", storyRole: "人物共同承担风险的起点。" }, { name: "城市会展中心", description: "行业供需集中交流的场所。", storyRole: "竞争与合作交织的舞台。" }], organizations: [{ name: "启明团队", description: "重视信誉但资源有限的新团队。", storyRole: "主角成长的组织载体。" }], socialRules: ["信任依赖可核验的长期行动。"], economicRules: ["资源有限，承诺必须考虑成本。"], technologyOrMagicRules: [fantasy ? "使用力量消耗体力，需要恢复。" : "不存在超能力，信息须经过现实验证。"], importantConcepts: [{ name: "信誉账本", description: "记录承诺与兑现过程。", storyRole: "贯穿全书的责任象征。" }] },
    powerSystem: fantasy ? { enabled: true, name: "感知修行", description: "通过训练改善观察能力。", rules: ["只能感知附近的变化"], limitations: ["无法预知未来"], growthPath: ["从注意细节到整合信息"], costs: ["体力消耗"], forbiddenUses: ["不能凭空改变事实"] } : { enabled: false, name: null, description: null, rules: [], limitations: [], growthPath: [], costs: [], forbiddenUses: [] },
    relationships: names.slice(0, 3).map((name) => ({ from: "林舟", to: name, relationship: "因竞争或合作形成联系。", conflict: "各自的目标并不总是一致。" })),
    storyStages: Array.from({ length: 10 }, (_, index) => ({ stageNumber: index + 1, title: `成长阶段 ${index + 1}`, approxStartChapter: Math.floor(input.targetChapterCount * index / 10) + 1, approxEndChapter: Math.floor(input.targetChapterCount * (index + 1) / 10), objective: `承担第 ${index + 1} 层责任。`, mainConflict: "目标提升后，旧有解决方式开始失效。", majorEvents: ["发现当前规则中的具体矛盾。", "与伙伴做出代价更高的选择。"], characterGrowth: "从解决个人问题向组织责任迈进。", stakes: `损失会影响 ${index + 1} 个相关群体。`, turningPoint: "一个被忽略的承诺改变局面。", endingHook: index === 9 ? "完成阶段目标，保留更广阔的未来。" : "新职责带来下一层挑战。" })),
    romanceDirection: "慢热且相互尊重，双方保持独立事业。", endingDirection: "主角与团队形成可持续的合作规则，接受成长中的损失。", forbiddenChanges: ["主角不能突然放弃诚信。", "成长必须有可解释的代价。", fantasy ? "能力不能预知未来。" : "世界没有超自然体系。"],
    seedMemories: Array.from({ length: 12 }, (_, index) => ({ type: ["character", "relationship", "world", "timeline", "location", "item", "ability", "secret", "foreshadowing", "plot", "rule", "other"][index], title: `初始事实 ${index + 1}`, content: `开篇已经确定的第 ${index + 1} 项约束：承诺需要通过行动兑现。`, importance: index % 5 + 1 })),
  };
  plan.storyStages.forEach((stage) => { stage.characterNames = [plan.protagonist.name]; });
  plan.seedMemories.forEach((memory) => { memory.characterNames = memory.type === "character" ? [plan.protagonist.name] : []; });
  plan.seedMemories[0].title = "林舟的初始身份";
  plan.seedMemories[0].content = "主角名叫林舟，27 岁，从经济困难的普通岗位起步。";
  return plan;
}
export function responseFixture(plan, model = "test-fixture-model") {
  return { id: "resp_fixture_only", object: "response", created_at: 1, status: "completed", model, output: [{ type: "message", id: "msg_fixture", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(plan), annotations: [] }] }], usage: { input_tokens: 1200, output_tokens: 5800, total_tokens: 7000 }, error: null, incomplete_details: null };
}

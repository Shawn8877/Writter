import { chapterFixtureRows } from "./chapter-fixtures.mjs";

export const memoryProse = "林舟在上海旧钟表店获得了预见能力。他只能看见未来二十四小时，超过这个上限就是一片漆黑。他试着看得更远，却立刻流鼻血，只好坐在柜台旁休息。许青仍在上海档案馆，通过电话提醒他停止尝试。店主周伯递来纸巾，说明停走的挂钟只是电池没电。林舟将编号十七的铜钥匙收入口袋，却不知道钥匙能打开哪一扇门。";
export function memoryFixtureRows(userId, target = 1600) {
  const seed = chapterFixtureRows(userId, target);
  seed.rows = seed.rows.filter(([t]) => t !== "memory_items");
  for (const [table, row] of seed.rows) {
    if (table === "novels") { row.title = "Phase 3C_1 验收 · 二十四小时"; row.premise = "林舟在上海旧钟表店首次获得只能预见未来24小时的能力，逐步调查编号十七的钥匙。"; }
    if (table === "novel_bible") row.builder_metadata = { continuityRequirements: ["能力永远不能预见超过24小时", "不要编造绝对日期", "不要新增其他能力"] };
    if (table === "characters" && row.name === "林舟") { row.abilities = []; row.current_state = { location: "上海旧钟表店", health: "正常", description: "尚未获得能力" }; row.age = "26"; row.background = "普通修表师"; }
    if (table === "chapters" && row.id === seed.previousId) {
      row.content = ""; row.summary = ""; row.status = "planned"; row.title = "第一章：二十四小时";
      row.outline = "林舟在上海旧钟表店首次获得只能预见未来24小时的能力。通过眼前小事的兑现确认能力；必须在正文明确写出这句角色对白：‘我的能力最多只能预见未来二十四小时，无法看到一年后。’通过测试发现超过24小时完全无画面，尝试越界立刻流鼻血，不能暗示上限会扩展。许青始终在上海档案馆电话协助。店主周伯递纸巾，双方认识。林舟拿到编号十七的铜钥匙，但不知道钥匙对应什么门，留下明确悬念。结尾林舟停止使用能力，坐在柜台旁休息，钥匙放入口袋。不得跨城，不编造日期，无其他超能力。";
    }
    if (table === "chapters" && row.id === seed.chapterId) {
      row.title = "第二章：十七号钥匙";
      row.outline = "紧接上章林舟坐在上海旧钟表店柜台旁休息。他与许青电话核对线索，仍受预见24小时的硬性上限与上一章发现的代价限制，不再逞强。店主周伯带他查验店内十七号储物柜，铜钥匙成功开锁，明确回收钥匙对应何处的悬念；柜内仅发现一本普通维修账册。保持前章章末状态连续，不揭幕后主使，不转移到其他城市，不预见一年后的事件。不要创造新能力或编造日期。";
    }
  }
  return { ...seed, firstId: seed.previousId, secondId: seed.chapterId };
}
export async function seedMemorySql(db, userId) {
  const seed = memoryFixtureRows(userId);
  for (const [table, row] of seed.rows) { const values = Object.values(row).map((v) => typeof v === "object" ? JSON.stringify(v) : v); await db.query(`insert into ${table}(${Object.keys(row).join(",")}) values(${values.map((_, i) => `$${i + 1}`).join(",")})`, values); }
  return seed;
}
export function memoryAnalysisFixture(context) {
  const ability = context.memories.find((m) => m.memory_type === "ability");
  const clue = context.memories.find((m) => m.memory_type === "foreshadowing" && m.title === "停走的挂钟");
  return {
    chapterSummary: "林舟在上海旧钟表店首次获得只能预见未来二十四小时的能力。他试图看得更远时流鼻血，坐在柜台旁休息。许青留在上海档案馆，通过电话劝他停止尝试。店主周伯递来纸巾，解释挂钟停走是因为电池没电。林舟收好编号十七的铜钥匙，但尚不知道它对应哪扇门。",
    keyEvents: [{ title: "获得有限预见能力", description: "林舟在上海旧钟表店首次获得预见能力。", importance: 4, evidence: "林舟在上海旧钟表店获得了预见能力。" }],
    characterChanges: [{ characterName: "林舟", changeType: "growth", description: "获得预见能力，越界尝试后流鼻血。", newState: { description: "在柜台旁休息，停止使用能力。", location: "上海旧钟表店柜台旁", health: "流鼻血", activity: "休息", isAlive: null }, evidence: "他试着看得更远，却立刻流鼻血，只好坐在柜台旁休息。" }],
    newCharacters: [{ name: "周伯", role: "重要配角", description: "上海旧钟表店店主，给林舟递来纸巾。", evidence: "店主周伯递来纸巾" }],
    relationshipChanges: [{ characterName: "林舟", targetName: "周伯", description: "接受周伯递来的纸巾。", evidence: "店主周伯递来纸巾" }],
    newFacts: [], worldUpdates: [],
    timelineEvents: [{ title: "林舟获得预见能力", description: "林舟在旧钟表店获得能力，尝试越界后流鼻血。", importance: 5, eventTime: "", evidence: "林舟在上海旧钟表店获得了预见能力。" }],
    abilityChanges: [{ characterName: "林舟", title: "二十四小时预见", description: "林舟只能预见未来24小时，尝试超出上限会流鼻血。", importance: 5, evidence: "他只能看见未来二十四小时，超过这个上限就是一片漆黑。他试着看得更远，却立刻流鼻血", existingMemoryId: ability?.id || null }],
    items: [{ title: "十七号铜钥匙", description: "林舟持有编号十七的铜钥匙。", importance: 4, evidence: "林舟将编号十七的铜钥匙收入口袋", existingMemoryId: null }],
    foreshadowingAdded: [{ title: "钥匙对应何处", description: "编号十七的铜钥匙对应的门尚未查明。", importance: 4, evidence: "却不知道钥匙能打开哪一扇门", existingMemoryId: null }],
    foreshadowingResolved: clue ? [{ memoryId: clue.id, description: "挂钟停走是因为电池没电。", evidence: "说明停走的挂钟只是电池没电" }] : [],
    nextChapterRequirements: [{ requirement: "林舟的预见上限仍是24小时，越界尝试会流鼻血；下一章从休息衔接。", evidence: "他只能看见未来二十四小时，超过这个上限就是一片漆黑。他试着看得更远，却立刻流鼻血，只好坐在柜台旁休息。" }],
  };
}

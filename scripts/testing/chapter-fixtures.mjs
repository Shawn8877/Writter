import { randomUUID } from "node:crypto";

// Explicit fiction for acceptance; never used as production model output.
export function chapterFixtureRows(userId, target = 1200) {
  const novelId = randomUUID(); const volumeId = randomUUID(); const previousId = randomUUID(); const chapterId = randomUUID();
  const previousContent = "上海，周二晚上九点。林舟站在旧钟表店门口，收到许青从上海档案馆发来的照片。照片里是一枚编号十七的铜钥匙。林舟预见明晚九点之前店内有人取走这把钥匙，但更远的未来只有一片漆黑。他的能力最多看见未来二十四小时，无法跨越这个界限。许青仍在上海档案馆，没有出发去北京。林舟按住耳机，推开了钟表店的玻璃门。";
  const outline = "承接上一章林舟推开上海旧钟表店玻璃门的一刻。林舟在店内核对编号十七的铜钥匙，许青一直留在上海档案馆通过电话协助。两人用预见的局部线索核对出入记录，发现今夜记录被人改过。本章仅调查今晚至明晚的线索，能力上限始终为未来24小时。结尾听见店里封闭房间传出钟声，留下调查悬念。不要揭露幕后主使，不要离开上海，不要让许青到北京，不要新增能力。";
  const rows = [
    ["novels", { id: novelId, user_id: userId, title: "Phase 3C_0 验收 · 二十四小时之外", genre: "悬疑", style: "克制、紧凑的都市悬疑，第三人称", premise: "林舟只能预见未来24小时，与档案员许青调查被篡改的钟表店记录。", protagonist: "林舟", target_word_count: target * 100, target_chapter_count: 100, chapter_word_target: target }],
    ["volumes", { id: volumeId, novel_id: novelId, title: "第一卷：旧钟声", summary: "在上海查清铜钥匙与被篡改记录的联系，不揭露幕后主使。", sort_order: 1, chapter_range: "1–20" }],
    ["novel_bible", { novel_id: novelId, core_premise: "林舟只能预见未来24小时，许青用档案知识协助调查。", main_conflict: "有限预见与人为伪造线索之间的冲突。", world_rules: ["林舟最多预见未来24小时，绝不可升级。", "现实中国，地点转移需要明确交通与时间。"], power_system: "仅有预见24小时的能力，不存在读心、瞬移、系统或战斗能力。", forbidden_changes: ["不能预见超过24小时的未来", "不得更改姓名", "许青本章一直在上海档案馆，不能突然出现在北京"], writing_style: "以具体动作和对话推进，避免空泛解释。", builder_metadata: { continuityRequirements: ["直接衔接推开玻璃门", "编号十七铜钥匙仍在店中", "幕后主使以后揭露"] } }],
    ["characters", { novel_id: novelId, name: "林舟", role: "主角", personality: "谨慎、善于核对细节", relationships: [{ name: "许青", relation: "信任的调查搭档" }], abilities: ["最多预见未来24小时"], current_state: { location: "上海旧钟表店门口", health: "正常" } }],
    ["characters", { novel_id: novelId, name: "许青", role: "重要配角", personality: "严谨的档案员", abilities: ["普通人的档案整理知识"], current_state: { location: "上海档案馆", activity: "通过电话协助林舟" } }],
    ["world_entries", { novel_id: novelId, category: "rule", name: "二十四小时上限", content: "林舟只能看到未来24小时内的片段，不能预见25小时及更远的未来。" }],
    ["world_entries", { novel_id: novelId, category: "location", name: "上海旧钟表店", content: "故事当前场景，有一间尚未打开的封闭房间。" }],
    ["world_entries", { novel_id: novelId, category: "location", name: "上海档案馆", content: "许青本章全程所在的地点。" }],
    ["chapters", { id: previousId, novel_id: novelId, volume_id: volumeId, title: "第一章：玻璃门", sort_order: 1, content: previousContent, summary: "林舟得知十七号铜钥匙的线索，在周二21时推开上海钟表店玻璃门。许青在上海档案馆电话协助。", status: "draft" }],
    ["chapters", { id: chapterId, novel_id: novelId, volume_id: volumeId, title: "第二章：被改动的时间", sort_order: 2, outline, status: "planned" }],
    ["memory_items", { novel_id: novelId, chapter_id: previousId, memory_type: "ability", title: "不可突破的预见上限", content: "林舟只能预见未来24小时，这是永久上限。", importance: 5, status: "active", source_type: "manual" }],
    ["memory_items", { novel_id: novelId, chapter_id: previousId, memory_type: "location", title: "许青的当前位置", content: "许青在上海档案馆，本章通过电话协助，没有去北京的行程。", importance: 5, status: "active", source_type: "manual" }],
  ];
  return { novelId, chapterId, previousId, volumeId, previousContent, rows };
}
export async function seedChapterSql(db, userId, target) {
  const fixture = chapterFixtureRows(userId, target);
  for (const [table, row] of fixture.rows) {
    const columns = Object.keys(row); const values = Object.values(row).map((v) => typeof v === "object" ? JSON.stringify(v) : v);
    await db.query(`insert into public.${table}(${columns.join(",")}) values(${values.map((_, i) => `$${i + 1}`).join(",")})`, values);
  }
  return fixture;
}

export const MEMORY_TYPES = [
  ["character", "人物记忆"], ["relationship", "人物关系"], ["plot", "剧情记忆"],
  ["foreshadowing", "伏笔"], ["world", "世界观"], ["location", "地点"],
  ["item", "物品"], ["ability", "能力"], ["secret", "秘密"],
  ["rule", "规则"], ["timeline", "时间事件"], ["other", "其他"],
];
export const MEMORY_STATUSES = [["active", "有效"], ["resolved", "已回收"], ["obsolete", "已失效"]];
export function memorySource(entry, novel) {
  let chapterId = entry.chapterId || entry.sourceChapterId;
  if (entry.sourceType === "chapter") chapterId = entry.sourceId;
  if (entry.sourceType === "character") {
    const person = novel.characters.find((item) => item.id === entry.sourceId);
    return { label: `人物档案 · ${person?.name || "来源未找到"}`, chapterId: chapterId || person?.sourceChapterId, href: `/novel/${novel.id}/characters` };
  }
  if (entry.sourceType === "world_entry") {
    const setting = novel.world.find((item) => item.id === entry.sourceId);
    return { label: `世界设定 · ${setting?.title || "来源未找到"}`, chapterId: chapterId || setting?.sourceChapterId, href: `/novel/${novel.id}/world` };
  }
  const chapter = novel.chapters.find((item) => item.id === chapterId);
  return { chapterId, label: chapter ? `第 ${chapter.number} 章 · ${chapter.title}` : entry.sourceType === "ai" ? "AI 构建 · 已确认的初始记忆" : "手动记录", href: chapter ? `/novel/${novel.id}/chapters?chapter=${chapter.id}` : null };
}

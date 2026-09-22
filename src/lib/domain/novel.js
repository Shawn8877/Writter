export const GENRES = [
  "都市",
  "玄幻",
  "仙侠",
  "科幻",
  "历史",
  "悬疑",
  "末世",
  "游戏",
  "言情",
  "其他",
];
export const STYLES = [
  "细腻沉浸",
  "热血爽文",
  "轻松幽默",
  "悬念迭起",
  "古典诗意",
  "冷峻写实",
];
export const MEMORY_MODULES = [
  { key: "bible", name: "核心设定", en: "Novel Bible" },
  { key: "characters", name: "人物档案", en: "Characters" },
  { key: "world", name: "世界规则", en: "World" },
  { key: "timeline", name: "故事时间线", en: "Timeline" },
  { key: "locations", name: "地点", en: "Locations" },
  { key: "items", name: "重要物品", en: "Items" },
  { key: "abilities", name: "能力体系", en: "Abilities" },
  { key: "foreshadowing", name: "伏笔", en: "Foreshadowing" },
  { key: "chapterSummaries", name: "章节摘要", en: "Chapter Summaries" },
];

/**
 * @typedef {Object} Novel
 * @property {string} id
 * @property {string} title
 * @property {string} genre
 * @property {string} idea
 * @property {string} style
 * @property {string} protagonist
 * @property {number} targetWords
 * @property {number} targetChapters
 * @property {number} wordsPerChapter
 * @property {Object} bible Core setting, conflict, antagonist, storyline and romance.
 * @property {Object} outline Master outline and ordered volumes.
 * @property {Array} chapters Each chapter has outline, body, summary, volumeId and status.
 * @property {Object} memory Nine memory modules; entries retain sourceChapterId and updatedAt.
 * @property {boolean} isDemo
 */

export function countWords(text = "") {
  return text.replace(/\s/g, "").length;
}
export function novelWordCount(novel) {
  if (novel.stats) return novel.stats.wordCount;
  return novel.chapters.reduce(
    (sum, chapter) => sum + countWords(chapter.body),
    0,
  );
}
export function formatNumber(number = 0) {
  return new Intl.NumberFormat("zh-CN").format(number);
}
export function formatDate(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
  }).format(new Date(date));
}
export function validateNovelInput(input) {
  const errors = {};
  if (!GENRES.includes(input.genre)) errors.genre = "请选择小说类型";
  if (typeof input.idea !== "string" || !input.idea.trim()) errors.idea = "写下你的一句话创意";
  if (input.idea?.length > 500) errors.idea = "请将创意控制在 500 字以内";
  if (!STYLES.includes(input.style)) errors.style = "请选择写作风格";
  for (const [key, label, max] of [
    ["targetWords", "目标字数", 10000000],
    ["targetChapters", "目标章节数", 10000],
    ["wordsPerChapter", "单章字数", 50000],
  ]) {
    if (
      !Number.isInteger(Number(input[key])) ||
      Number(input[key]) < 1 ||
      Number(input[key]) > max
    )
      errors[key] = `${label}须为 1–${formatNumber(max)} 的整数`;
  }
  return errors;
}

export function createNovelDraft(input) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  return {
    id,
    title: "未命名小说",
    genre: input.genre,
    idea: input.idea.trim(),
    style: input.style,
    protagonist: input.protagonist.trim(),
    targetWords: Number(input.targetWords),
    targetChapters: Number(input.targetChapters),
    wordsPerChapter: Number(input.wordsPerChapter),
    status: "创意草稿",
    isDemo: false,
    cover: "ink",
    createdAt: now,
    updatedAt: now,
    bible: {
      synopsis: "",
      conflict: "",
      storyline: "",
      antagonist: "",
      romance: "",
    },
    outline: { master: "", volumes: [] },
    chapters: [],
    characters: [],
    world: [],
    timeline: [],
    memory: {
      locations: [],
      items: [],
      abilities: [],
      foreshadowing: [],
      chapterSummaries: [],
    },
  };
}

import { demoNovels } from "@/lib/mock/novels";

const STORAGE_KEY = "novelai-studio:novels:v1";

function isValidNovel(novel) {
  return (
    novel &&
    typeof novel.id === "string" &&
    typeof novel.title === "string" &&
    typeof novel.idea === "string" &&
    typeof novel.genre === "string" &&
    typeof novel.protagonist === "string" &&
    Number.isFinite(novel.targetWords) &&
    novel.targetWords > 0 &&
    Number.isFinite(novel.targetChapters) &&
    novel.targetChapters > 0 &&
    Number.isFinite(novel.wordsPerChapter) &&
    novel.wordsPerChapter > 0 &&
    Number.isFinite(Date.parse(novel.updatedAt)) &&
    novel.bible &&
    typeof novel.bible === "object" &&
    novel.outline &&
    typeof novel.outline.master === "string" &&
    Array.isArray(novel.outline.volumes) &&
    ["chapters", "characters", "world", "timeline"].every((key) =>
      Array.isArray(novel[key]),
    ) &&
    novel.chapters.every(
      (chapter) =>
        typeof chapter.id === "string" && typeof chapter.body === "string",
    ) &&
    novel.memory &&
    [
      "locations",
      "items",
      "abilities",
      "foreshadowing",
      "chapterSummaries",
    ].every((key) => Array.isArray(novel.memory[key]))
  );
}

// The UI depends on this repository boundary, never on a database SDK.
export const localNovelRepository = {
  load() {
    if (typeof window === "undefined") return { novels: [], error: null };
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored)
        return {
          novels: structuredClone(demoNovels),
          error: null,
          revision: null,
        };
      const data = JSON.parse(stored);
      if (
        data.version !== 1 ||
        !Array.isArray(data.novels) ||
        !data.novels.every(isValidNovel)
      )
        throw new Error("Invalid local data");
      return { novels: data.novels, error: null, revision: stored };
    } catch {
      return {
        novels: structuredClone(demoNovels),
        error:
          "本地数据无法读取，已展示示例作品。为避免覆盖原数据，本次暂不保存；请检查浏览器存储设置。",
      };
    }
  },
  save(novels, expectedRevision) {
    let current;
    try {
      current = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      throw new Error("浏览器存储不可用，当前修改尚未保存。请复制内容备份。");
    }
    if (current !== expectedRevision)
      throw new Error(
        "其他标签页已更新作品，已阻止覆盖。当前修改尚未保存，请先复制修改内容，再刷新以读取最新版本。",
      );
    const nextRevision = JSON.stringify({ version: 1, novels });
    try {
      window.localStorage.setItem(STORAGE_KEY, nextRevision);
    } catch {
      throw new Error(
        "本地保存失败，浏览器存储可能已满或被禁用。内容仍保留在当前页面，请先复制备份。",
      );
    }
    return nextRevision;
  },
};

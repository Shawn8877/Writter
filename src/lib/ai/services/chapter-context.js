import "server-only";
import { AiError } from "../errors.js";

export const CHAPTER_CONTEXT_BYTES = 180000;
export function chapterDatabaseError(error) {
  if (!error) return;
  const messages = {
    CONTENT_EXISTS: "本章已有正文，不能直接覆盖。重新生成功能将在后续阶段开放。",
    CONTEXT_CHANGED: "小说设定或章节已变化，请刷新页面后重新生成。当前正文未被覆盖。",
    DUPLICATE_REQUEST: "这次请求已提交，未再次调用 AI。请等待结果或明确重新生成。",
    AI_BUSY: "已有 AI 任务正在运行，请等待它完成。",
  };
  if (error.code === "PT429") throw new AiError("AI_RATE_LIMIT", "每小时最多生成 6 次（与小说构建共用），请稍后再试。", 429);
  if (error.code === "PT409") throw new AiError(error.message in messages ? error.message : "CONTEXT_CHANGED", messages[error.message] || messages.CONTEXT_CHANGED, 409);
  if (["P0002", "42501"].includes(error.code)) throw new AiError("NOT_FOUND", "章节不存在或不属于当前账号。", 404);
  throw new AiError("AI_DATABASE_ERROR", "读取或保存云端数据失败，请保留预览并稍后重试。", 503);
}
async function data(query) { const result = await query; chapterDatabaseError(result.error); return result.data; }
const fields = (row, names) => row && Object.fromEntries(names.map((key) => [key, row[key]]));
export async function buildChapterContext(supabase, { novelId, chapterId, expectedRevision }) {
  const novel = await data(supabase.from("novels").select("id,title,genre,style,premise,protagonist,master_outline,chapter_word_target,revision").eq("id", novelId).maybeSingle());
  const chapter = await data(supabase.from("chapters").select("id,title,content,outline,sort_order,volume_id,revision").eq("novel_id", novelId).eq("id", chapterId).maybeSingle());
  if (!novel || !chapter) throw new AiError("NOT_FOUND", "章节不存在或不属于当前账号。", 404);
  if (chapter.content !== "") throw new AiError("CONTENT_EXISTS", "本章已有正文，不能直接覆盖。重新生成功能将在后续阶段开放。", 409);
  if (chapter.revision !== expectedRevision) throw new AiError("CONTEXT_CHANGED", "章节已变化，请刷新后重试。", 409);
  if (!chapter.outline.trim()) throw new AiError("OUTLINE_REQUIRED", "请先填写并保存本章大纲，再生成正文。", 400);
  if (novel.chapter_word_target < 100 || novel.chapter_word_target > 6000) throw new AiError("CHAPTER_TARGET_LIMIT", "当前单章生成支持 100–6000 字，请先调整小说的单章目标字数。", 400);
  const [bible, characters, world, memories, previous, volume] = await Promise.all([
    data(supabase.from("novel_bible").select("*").eq("novel_id", novelId).maybeSingle()),
    data(supabase.from("characters").select("name,aliases,role,personality,description,background,goals,relationships,abilities,current_state,is_alive").eq("novel_id", novelId).order("created_at").limit(81)),
    data(supabase.from("world_entries").select("category,name,content,metadata").eq("novel_id", novelId).order("created_at").limit(121)),
    data(supabase.from("memory_items").select("memory_type,title,content,importance,metadata,chapter_id").eq("novel_id", novelId).eq("status", "active").order("importance", { ascending: false }).order("created_at", { ascending: false }).limit(80)),
    data(supabase.from("chapters").select("id,title,sort_order,summary").eq("novel_id", novelId).lt("sort_order", chapter.sort_order).order("sort_order", { ascending: false }).limit(5)),
    chapter.volume_id ? data(supabase.from("volumes").select("title,summary,chapter_range,beats").eq("novel_id", novelId).eq("id", chapter.volume_id).maybeSingle()) : null,
  ]);
  if (!bible || ![bible.core_premise, bible.synopsis, bible.main_conflict].some((v) => v?.trim())) throw new AiError("BIBLE_REQUIRED", "请先完善小说核心设定，再生成章节。", 400);
  if (characters.length > 80 || world.length > 120) throw new AiError("CONTEXT_TOO_LARGE", "人物或世界观资料超出本阶段容量，请精简相关资料后再试。", 413);
  const summaries = previous.length ? await data(supabase.from("chapter_summaries").select("chapter_id,summary,key_events,character_changes,new_information,foreshadowing_added,foreshadowing_resolved").eq("novel_id", novelId).in("chapter_id", previous.map((c) => c.id))) : [];
  const previousChapter = previous.length ? await data(supabase.from("chapters").select("title,content,sort_order").eq("novel_id", novelId).eq("id", previous[0].id).maybeSingle()) : null;
  const context = {
    novel: fields(novel, ["title", "genre", "style", "premise", "protagonist", "master_outline", "chapter_word_target"]),
    bible: fields(bible, ["core_premise", "world_rules", "story_tone", "writing_style", "protagonist_arc", "main_conflict", "power_system", "romance_direction", "ending_direction", "forbidden_changes", "synopsis", "storyline", "antagonist", "story_stages"]),
    chapter: fields(chapter, ["title", "outline", "sort_order"]), volume, characters, world, memories,
    previousChapter,
    recentSummaries: previous.map((c) => ({ title: c.title, number: c.sort_order, summary: c.summary, ...summaries.find((s) => s.chapter_id === c.id) })).reverse(),
    continuityRequirements: bible.builder_metadata?.continuityRequirements || bible.builder_metadata?.specialRequirements || [],
  };
  const contextBytes = Buffer.byteLength(JSON.stringify(context), "utf8");
  if (contextBytes > CHAPTER_CONTEXT_BYTES) throw new AiError("CONTEXT_TOO_LARGE", "章节上下文过长，请精简设定、重要记忆或上一章正文后重试。没有调用 AI。", 413);
  return { context, novelRevision: novel.revision, chapterRevision: chapter.revision, contextBytes };
}

import "server-only";
import { AiError } from "../errors.js";
import { chapterDatabaseError } from "../services/chapter-context.js";

const take = async (query) => { const result = await query; chapterDatabaseError(result.error); return result.data; };
const LIMIT = 180000;

export async function buildChapterReviewContext(supabase, { novelId, chapterId }) {
  const [novel, chapter] = await Promise.all([
    take(supabase.from("novels").select("id,title,genre,master_outline,revision").eq("id", novelId).maybeSingle()),
    take(supabase.from("chapters").select("id,title,outline,outline_approved_at,content,sort_order,revision").eq("novel_id", novelId).eq("id", chapterId).maybeSingle()),
  ]);
  if (!novel || !chapter) throw new AiError("NOT_FOUND", "章节不存在或不属于当前账号。", 404);
  if (!chapter.content?.trim()) throw new AiError("CONTENT_REQUIRED", "请先保存章节正文。", 400);
  const previous = chapter.sort_order > 1 ? await take(supabase.from("chapters").select("id,title,content,sort_order").eq("novel_id", novelId).eq("sort_order", chapter.sort_order - 1).maybeSingle()) : null;
  const [bible, characters, world, memories, timeline, recentChapters, previousSummary, versions] = await Promise.all([
    take(supabase.from("novel_bible").select("core_premise,world_rules,protagonist_arc,main_conflict,power_system,forbidden_changes,synopsis,storyline,antagonist").eq("novel_id", novelId).maybeSingle()),
    take(supabase.from("characters").select("id,name,role,description,personality,background,goals,current_state,relationships,abilities,is_alive").eq("novel_id", novelId).order("updated_at", { ascending: false }).limit(60)),
    take(supabase.from("world_entries").select("id,category,name,content,metadata").eq("novel_id", novelId).order("updated_at", { ascending: false }).limit(80)),
    take(supabase.from("memory_items").select("id,memory_type,title,content,importance,status,metadata,chapter_id").eq("novel_id", novelId).eq("status", "active").order("importance", { ascending: false }).order("updated_at", { ascending: false }).limit(100)),
    take(supabase.from("timeline_events").select("id,chapter_id,event_time,title,description,characters").eq("novel_id", novelId).order("created_at", { ascending: false }).limit(40)),
    take(supabase.from("chapters").select("id,title,sort_order").eq("novel_id", novelId).lt("sort_order", chapter.sort_order).order("sort_order", { ascending: false }).limit(5)),
    previous ? take(supabase.from("chapter_summaries").select("chapter_id,summary,key_events,next_chapter_requirements").eq("chapter_id", previous.id).maybeSingle()) : Promise.resolve(null),
    take(supabase.from("chapter_versions").select("id,content,created_at").eq("chapter_id", chapterId).order("created_at", { ascending: false }).limit(1)),
  ]);
  const summaryIds = recentChapters.map((item) => item.id);
  const summaries = summaryIds.length ? await take(supabase.from("chapter_summaries").select("chapter_id,summary,key_events").in("chapter_id", summaryIds)) : [];
  const version = versions[0]?.content === chapter.content ? versions[0].id : null;
  const context = { novel, bible, chapter: { ...chapter, outline: chapter.outline_approved_at ? chapter.outline : "" }, previousChapter: previous,
    previousSummary, recentSummaries: recentChapters.map((item) => ({ ...item, ...(summaries.find((s) => s.chapter_id === item.id) || {}) })),
    characters, world, memories, timeline, unresolvedForeshadowing: memories.filter((item) => item.memory_type === "foreshadowing"),
  };
  if (Buffer.byteLength(JSON.stringify(context), "utf8") > LIMIT) throw new AiError("CONTEXT_TOO_LARGE", "审核上下文过长，请先整理本章或重要设定。没有调用 AI。", 413);
  return { context, novelRevision: novel.revision, chapterRevision: chapter.revision, chapterVersionId: version };
}

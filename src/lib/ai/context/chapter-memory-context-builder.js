import "server-only";
import { AiError } from "../errors.js";
import { chapterDatabaseError, CHAPTER_CONTEXT_BYTES } from "../services/chapter-context.js";
import { chapterMemoryModelContext } from "../services/memory-evidence.js";

async function data(query) { const r = await query; chapterDatabaseError(r.error); return r.data; }
async function mergeMemories(supabase, novelId) {
  const rows = [];
  // Same 10,000-record collection boundary as the ordinary novel repository.
  // This is a server merge index, never an unbounded model prompt.
  for (let from = 0; from <= 10000; from += 500) {
    const page = await data(supabase.from("memory_items").select("id,memory_type,title,content,importance,status,metadata,chapter_id,source_type,source_id,updated_at")
      .eq("novel_id", novelId).order("id").range(from, Math.min(from + 499, 10000)));
    rows.push(...page);
    if (rows.length > 10000) throw new AiError("CONTEXT_TOO_LARGE", "小说记忆已超过当前资料集合容量，请先核对整理。", 413);
    if (page.length < 500) return rows;
  }
  return rows;
}
export async function buildChapterMemoryContext(supabase, { novelId, chapterId }) {
  const novel = await data(supabase.from("novels").select("id,title,revision").eq("id", novelId).maybeSingle());
  const chapter = await data(supabase.from("chapters").select("id,title,outline,content,sort_order,revision").eq("novel_id", novelId).eq("id", chapterId).maybeSingle());
  if (!novel || !chapter) throw new AiError("NOT_FOUND", "章节不存在或不属于当前账号。", 404);
  if (!chapter.content.trim()) throw new AiError("CONTENT_REQUIRED", "请先保存章节正文。", 400);
  const [bible, characters, memories] = await Promise.all([
    data(supabase.from("novel_bible").select("core_premise,world_rules,protagonist_arc,main_conflict,power_system,forbidden_changes,synopsis").eq("novel_id", novelId).maybeSingle()),
    data(supabase.from("characters").select("id,name,aliases,role,description,current_state,relationships,abilities,is_alive").eq("novel_id", novelId).order("created_at").limit(81)),
    // Include resolved entries too: matching must not silently reopen old foreshadowing.
    mergeMemories(supabase, novelId),
  ]);
  if (characters.length > 80) throw new AiError("CONTEXT_TOO_LARGE", "人物数量超出当前分析容量，请整理后重试。", 413);
  const context = { novel: { title: novel.title }, bible, chapter, characters, memories };
  if (Buffer.byteLength(JSON.stringify(chapterMemoryModelContext(context)), "utf8") > CHAPTER_CONTEXT_BYTES) throw new AiError("CONTEXT_TOO_LARGE", "本章分析资料过长，请整理后重试。", 413);
  return { context, novelRevision: novel.revision, chapterRevision: chapter.revision };
}

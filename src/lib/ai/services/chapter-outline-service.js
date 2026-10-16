import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getAiConfig } from "../config.js";
import { createDeepSeekClient } from "../deepseek.js";
import { AiError, normalizeAiError } from "../errors.js";
import { inputHash } from "./builder-workflow.js";
import { chapterDatabaseError } from "./chapter-context.js";
import { chapterFromRow } from "@/lib/server/supabase-repository";

const outlineSchema = z.object({ title: z.string().trim().min(1).max(100), outline: z.string().trim().min(40).max(15000) }).strict();
const responseSchema = { type: "object", additionalProperties: false, required: ["title", "outline"], properties: {
  title: { type: "string" }, outline: { type: "string" },
} };
const data = (result) => { chapterDatabaseError(result.error); return result.data; };

export async function buildNextOutlineContext(supabase, { novelId, chapterNumber }) {
  const novel = data(await supabase.from("novels").select("id,title,genre,style,premise,protagonist,master_outline,chapter_word_target,revision").eq("id", novelId).maybeSingle());
  if (!novel) throw new AiError("NOT_FOUND", "小说不存在或不属于当前账号。", 404);
  const [bible, chapters, characters, world, memories] = await Promise.all([
    supabase.from("novel_bible").select("core_premise,synopsis,main_conflict,storyline,story_stages,power_system,world_rules,forbidden_changes,protagonist_arc,romance_direction").eq("novel_id", novelId).maybeSingle(),
    supabase.from("chapters").select("id,title,outline,content,summary,sort_order,revision,volume_id").eq("novel_id", novelId).lt("sort_order", chapterNumber + 1).order("sort_order", { ascending: false }).limit(8),
    supabase.from("characters").select("name,role,goals,relationships,abilities,current_state,is_alive").eq("novel_id", novelId).limit(80),
    supabase.from("world_entries").select("category,name,content").eq("novel_id", novelId).limit(60),
    supabase.from("memory_items").select("memory_type,title,content,importance,status").eq("novel_id", novelId).eq("status", "active").order("importance", { ascending: false }).limit(60),
  ]);
  for (const result of [bible, chapters, characters, world, memories]) chapterDatabaseError(result.error);
  if (!bible.data || ![bible.data.core_premise,bible.data.synopsis,bible.data.main_conflict].some((v) => v?.trim())) throw new AiError("BIBLE_REQUIRED", "请先完善小说核心设定。", 409);
  const current = chapters.data.find((chapter) => chapter.sort_order === chapterNumber);
  if (current?.content?.trim() || current?.outline?.trim()) throw new AiError("OUTLINE_EXISTS", "本章已有正文或大纲，请先核对现有内容。", 409);
  const lastWritten = chapters.data.filter((chapter) => chapter.content.trim()).at(0);
  const summaries = chapters.data.filter((chapter) => chapter.sort_order<chapterNumber).slice(0,5);
  const summaryRows = summaries.length ? data(await supabase.from("chapter_summaries").select("chapter_id,summary,next_chapter_requirements").eq("novel_id", novelId).in("chapter_id", summaries.map((chapter) => chapter.id))) : [];
  const context = {
    novel: { title: novel.title, genre: novel.genre, style: novel.style, premise: novel.premise, protagonist: novel.protagonist, masterOutline: novel.master_outline },
    bible: bible.data,
    chapterNumber,
    plannedEarlierChapters: chapters.data.filter((chapter) => chapter.sort_order<chapterNumber).map((chapter) => ({ number: chapter.sort_order, title: chapter.title, outline: chapter.outline })),
    previousWrittenChapter: lastWritten ? { number: lastWritten.sort_order, title: lastWritten.title, content: lastWritten.content } : null,
    recentSummaries: summaries.map((chapter) => ({ number: chapter.sort_order, title: chapter.title, summary: summaryRows.find((row) => row.chapter_id===chapter.id)?.summary || chapter.summary, nextRequirements: summaryRows.find((row) => row.chapter_id===chapter.id)?.next_chapter_requirements || [] })),
    characters: characters.data, world: world.data, memories: memories.data,
  };
  if (Buffer.byteLength(JSON.stringify(context), "utf8")>120000) throw new AiError("CONTEXT_TOO_LARGE", "大纲上下文过长，请精简前一章或世界资料。", 413);
  return { context, novelRevision: novel.revision, chapterRevision: current?.revision ?? null };
}

export async function generateNextOutline(supabase, input, dependencies = {}) {
  const config = (dependencies.getConfig || getAiConfig)();
  const prepared = await (dependencies.context || buildNextOutlineContext)(supabase, input);
  const lease = randomUUID();
  const generationId = data(await supabase.rpc("studio_begin_outline_generation", {
    p_request_id: input.requestId, p_lease_token: lease, p_input_hash: inputHash(prepared.context), p_model: config.model,
    p_novel_id: input.novelId, p_chapter_number: input.chapterNumber, p_novel_revision: prepared.novelRevision, p_chapter_revision: prepared.chapterRevision,
  }));
  const started = Date.now(); let result; let failure;
  try {
    result = await (dependencies.generate || (async () => {
      const client = createDeepSeekClient(config);
      const response = await client.responses.create({ model: config.model, stream: false, reasoning: { effort: "low" }, max_output_tokens: 4000,
        input: [
          { role: "system", content: "你是中文长篇网络小说的大纲编辑。根据给定小说设定和最新剧情，为指定章节规划有因果、冲突、场景、人物动机、结尾推进的详细章节大纲。不得改变 Novel Bible 核心规则，不得让已死亡人物无故复活。只输出指定 JSON。" },
          { role: "user", content: JSON.stringify(prepared.context) },
        ], text: { format: { type: "json_schema", name: "next_chapter_outline", schema: responseSchema, strict: true } },
      });
      if (response.status!=="completed" || !response.output_text) throw new AiError("INVALID_AI_OUTPUT", "AI 未返回完整大纲，请重试。", 502);
      const parsed = outlineSchema.parse(JSON.parse(response.output_text));
      return { ...parsed, model: response.model || config.model, inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null, providerRequestId: response._request_id || response.id || null };
    }))();
    result = { ...result, ...outlineSchema.parse({ title: result.title, outline: result.outline }) };
  } catch (error) { failure = normalizeAiError(error); }
  const metadata = result || failure?.metadata || {};
  const finished = data(await supabase.rpc("studio_finish_outline_generation", {
    p_generation_id: generationId, p_lease_token: lease, p_status: failure ? "failed" : "succeeded",
    p_model: metadata.model || config.model, p_input_tokens: metadata.inputTokens ?? null, p_output_tokens: metadata.outputTokens ?? null,
    p_latency_ms: Date.now()-started, p_provider_request_id: metadata.providerRequestId || failure?.providerRequestId || null,
    p_error_type: failure?.code || null, p_chapter_number: input.chapterNumber, p_title: result?.title || null, p_outline: result?.outline || null,
  }));
  if (!finished) throw new AiError("GENERATION_EXPIRED", "大纲预览已过期，请重试。", 409);
  if (failure) throw failure;
  return { generationId, chapterNumber: input.chapterNumber, title: result.title, outline: result.outline,
    usage: { provider: "deepseek", model: metadata.model || config.model, inputTokens: metadata.inputTokens, outputTokens: metadata.outputTokens } };
}

export async function confirmNextOutline(supabase, generationId) {
  const result = data(await supabase.rpc("studio_confirm_outline_generation", { p_generation_id: generationId }));
  return { chapter: chapterFromRow(result.chapter), replayed: result.replayed };
}

import "server-only";
import { randomUUID } from "node:crypto";
import { AiError, normalizeAiError } from "../errors.js";
import { chapterDatabaseError } from "./chapter-context.js";
import { generateChapterPreview, confirmChapterPreview } from "./chapter-workflow.js";
import { updateChapterMemory } from "./chapter-memory-service.js";

const db = (result) => { chapterDatabaseError(result.error); return result.data; };
const RUN_FIELDS = "id,novel_id,mode,start_chapter,target_chapters,current_index,status,stage,lease_at,cancel_requested,error_type,created_at,updated_at,completed_at";

function runError(error) {
  if (!error) return;
  const messages = {
    EARLIER_CHAPTER_EMPTY: "前面还有未写完的章节，请先完成它们。",
    BIBLE_REQUIRED: "请先完善小说核心设定。",
    CHARACTERS_REQUIRED: "请先完善主要人物。",
    MEMORY_NOT_READY: "之前章节的记忆尚未完成，请先完成或重试记忆分析。",
    OUTLINE_REQUIRED: "当前章节缺少已确认的大纲。",
    CONTENT_EXISTS: "目标章节已有正文，任务已停止以保护原文。",
    AI_BUSY: "当前已有 AI 创作正在进行，请等待。",
    INVALID_STATE: "任务状态已变化，请刷新后重试。",
  };
  if (error.code === "PT409" && messages[error.message]) throw new AiError(error.message, messages[error.message], 409);
  chapterDatabaseError(error);
}
const checked = (result) => { runError(result.error); return result.data; };

export async function startGenerationRun(supabase, { novelId, count, mode }) {
  const result = await supabase.rpc("studio_start_generation_run", { p_novel_id: novelId, p_count: count, p_mode: mode });
  const started = checked(result);
  if (!started.runId) return started;
  return { ...started, run: await getGenerationRun(supabase, started.runId) };
}

export async function getGenerationRun(supabase, runId) {
  const result = await supabase.from("generation_runs").select(RUN_FIELDS).eq("id", runId).maybeSingle();
  const run = db(result);
  if (!run) throw new AiError("NOT_FOUND", "任务不存在或不属于当前账号。", 404);
  const items = db(await supabase.from("generation_run_chapters").select("chapter_id,chapter_number,position,generation_id,status,error_type,updated_at")
    .eq("run_id", runId).order("position"));
  const current = items[run.current_index];
  let preview = null;
  if (run.mode === "next" && run.stage === "preview" && current?.generation_id) {
    const row = db(await supabase.from("ai_chapter_previews").select("content").eq("generation_id", current.generation_id).maybeSingle());
    if (row) preview = { generationId: current.generation_id, content: row.content, chapterNumber: current.chapter_number };
  }
  return { id: run.id, novelId: run.novel_id, mode: run.mode, startChapter: run.start_chapter,
    targetChapters: run.target_chapters, currentIndex: run.current_index, status: run.status, stage: run.stage,
    errorType: run.error_type, updatedAt: run.updated_at, leaseAt: run.lease_at, cancelRequested: run.cancel_requested, completedAt: run.completed_at,
    chapters: items.map((item) => ({ chapterId: item.chapter_id, number: item.chapter_number, status: item.status, errorType: item.error_type })), preview };
}

export async function getLatestGenerationRun(supabase, novelId) {
  const novel = db(await supabase.from("novels").select("id").eq("id", novelId).maybeSingle());
  if (!novel) throw new AiError("NOT_FOUND", "小说不存在或不属于当前账号。", 404);
  const latest = db(await supabase.from("generation_runs").select("id").eq("novel_id", novelId).order("created_at", { ascending: false }).limit(1).maybeSingle());
  return latest ? getGenerationRun(supabase, latest.id) : null;
}

async function basicConsistencyCheck(supabase, run) {
  const current = run.chapters[run.currentIndex];
  if (!current) throw new AiError("INVALID_STATE", "任务当前章节不存在。", 409);
  const [chapter, characters, bible, preceding] = await Promise.all([
    supabase.from("chapters").select("outline,content,sort_order,outline_approved_at").eq("id", current.chapterId).eq("novel_id", run.novelId).maybeSingle(),
    supabase.from("characters").select("name,is_alive,current_state").eq("novel_id", run.novelId).limit(81),
    supabase.from("novel_bible").select("core_premise,synopsis,main_conflict,forbidden_changes").eq("novel_id", run.novelId).maybeSingle(),
    supabase.from("chapters").select("content").eq("novel_id", run.novelId).eq("sort_order", current.number - 1).maybeSingle(),
  ]);
  for (const result of [chapter, characters, bible, preceding]) chapterDatabaseError(result.error);
  if (!chapter.data || !chapter.data.outline?.trim() || !chapter.data.outline_approved_at) throw new AiError("OUTLINE_REQUIRED", "第" + current.number + "章缺少已确认的大纲。", 409);
  if (chapter.data.content.trim()) throw new AiError("CONTENT_EXISTS", "第" + current.number + "章已有正文，不能覆盖。", 409);
  if (!bible.data || ![bible.data.core_premise, bible.data.synopsis, bible.data.main_conflict].some((value) => value?.trim())) throw new AiError("BIBLE_REQUIRED", "小说核心设定缺失。", 409);
  if (!characters.data?.length || characters.data.length > 80) throw new AiError("CHARACTERS_REQUIRED", "人物资料缺失或过多，请先核对。", 409);
  if (current.number > 1 && !preceding.data?.content?.trim()) throw new AiError("PREVIOUS_CHAPTER_REQUIRED", "上一章尚无正文，请先完成。", 409);
  // Conservative hard contradiction only: an explicitly forbidden resurrection
  // paired with a dead named character described as alive. Ambiguous plots are
  // left to author review rather than inventing certainty from heuristics.
  const forbidsResurrection = JSON.stringify(bible.data.forbidden_changes || []).includes("禁止复活");
  if (forbidsResurrection && characters.data.some((person) => !person.is_alive && chapter.data.outline.includes(person.name) && /复活|死而复生|仍然活着/.test(chapter.data.outline))) {
    throw new AiError("CONSISTENCY_REVIEW", `第${current.number}章大纲与人物死亡状态及 Novel Bible 的禁止复活规则冲突，请重新规划。`, 409);
  }
}

export async function claimGenerationStep(supabase, runId, { manualApprove = false } = {}) {
  const run = await getGenerationRun(supabase, runId);
  if (run.status !== "running") return { action: "wait", run };
  if (run.stage === "ready") {
    try { await basicConsistencyCheck(supabase, run); }
    catch (error) {
      if (["CONSISTENCY_REVIEW","OUTLINE_REQUIRED","CONTENT_EXISTS","BIBLE_REQUIRED","CHARACTERS_REQUIRED","PREVIOUS_CHAPTER_REQUIRED"].includes(error.code)) {
        checked(await supabase.rpc("studio_pause_generation_run", { p_run_id: runId, p_error_type: error.code }));
        return { action: "paused", run: await getGenerationRun(supabase, runId) };
      }
      throw error;
    }
  }
  const claim = checked(await supabase.rpc("studio_claim_generation_step", {
    p_run_id: runId, p_lease_token: randomUUID(), p_request_id: randomUUID(), p_manual_approve: manualApprove,
  }));
  return { ...claim, run: await getGenerationRun(supabase, runId) };
}

async function finish(supabase, claim, action, generationId = null, errorType = null) {
  return checked(await supabase.rpc("studio_finish_generation_step", {
    p_run_id: claim.runId, p_lease_token: claim.leaseToken, p_action: action,
    p_generation_id: generationId, p_error_type: errorType,
  }));
}

// One invocation performs at most one provider call. The run and lease live in
// Postgres, so browser disconnection cannot erase committed chapter progress.
export async function processGenerationStep(supabase, claim, dependencies = {}) {
  if (!["generate", "confirm", "memory"].includes(claim.action)) return;
  try {
    if (claim.action === "generate") {
      const result = await (dependencies.generate || generateChapterPreview)(supabase, {
        requestId: claim.requestId, novelId: claim.novelId, chapterId: claim.chapterId, expectedRevision: claim.chapterRevision,
      }, () => {}, dependencies.chapter || {});
      return finish(supabase, claim, "generated", result.generationId);
    }
    if (claim.action === "confirm") {
      await (dependencies.confirm || confirmChapterPreview)(supabase, { generationId: claim.generationId });
      return finish(supabase, claim, "confirmed");
    }
    const result = await (dependencies.memory || updateChapterMemory)(supabase,
      { novelId: claim.novelId, chapterId: claim.chapterId, retry: true }, dependencies.memoryDependencies || {});
    if (result.status !== "succeeded") throw new AiError(result.errorType || "MEMORY_NOT_READY", "章节记忆未完成，请重试。", 409);
    return finish(supabase, claim, "memory_succeeded");
  } catch (error) {
    const failure = normalizeAiError(error);
    try { await finish(supabase, claim, "failed", null, failure.code); }
    catch (persistError) { console.error("[generation-run]", JSON.stringify({ code: "PERSIST_FAILED", step: claim.action, errorType: normalizeAiError(persistError).code })); }
    console.warn("[generation-run]", JSON.stringify({ code: failure.code, step: claim.action }));
    return { status: "failed", errorType: failure.code };
  }
}

export async function reconcileGenerationRun(supabase, runId) {
  checked(await supabase.rpc("studio_reconcile_generation_run", { p_run_id: runId }));
  return getGenerationRun(supabase, runId);
}

export async function cancelGenerationRun(supabase, runId) {
  checked(await supabase.rpc("studio_cancel_generation_run", { p_run_id: runId }));
  return getGenerationRun(supabase, runId);
}

export async function retryGenerationRun(supabase, runId) {
  checked(await supabase.rpc("studio_retry_generation_run", { p_run_id: runId }));
  return getGenerationRun(supabase, runId);
}

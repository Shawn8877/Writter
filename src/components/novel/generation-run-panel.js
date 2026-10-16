"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Circle, LoaderCircle, Sparkles, X } from "lucide-react";
import { Modal } from "@/components/ui";
import { useStudio } from "@/components/studio-provider";
import { generationRunRepository as api } from "@/lib/repositories/generation-run-repository";

const stageNames = { ready: "准备上下文", generating: "AI 正在创作", preview: "正文已生成，等待确认", saving: "正在保存正文和版本", analyzing: "正在分析章节并更新记忆", completed: "本次创作完成" };
const itemNames = { pending: "等待", generating: "正在生成", generated: "正文已生成", analyzing: "正在更新记忆", completed: "已完成", failed: "失败" };
const errorNames = { AI_RATE_LIMIT: "当前每小时 AI 调用额度已用完，请稍后重试。", AI_CREDITS_EXHAUSTED: "DeepSeek 余额不足，请充值后重试。", AI_TIMEOUT: "AI 请求超时，可从失败章节重试。", LEASE_EXPIRED: "上次任务中断，请检查该章并重试。", CONSISTENCY_REVIEW: "当前大纲与小说设定冲突，请调整后继续。", MEMORY_NOT_READY: "章节记忆未完成，请重试记忆分析。", CONTENT_EXISTS: "目标章节已有正文，未进行覆盖。", OUTLINE_REQUIRED: "当前章缺少已确认大纲，请补充后继续。", BIBLE_REQUIRED: "小说核心设定缺失，请补充后继续。", CHARACTERS_REQUIRED: "人物资料缺失，请补充后继续。", PREVIOUS_CHAPTER_REQUIRED: "上一章尚未完成，请先核对。" };

export function GenerationRunPanel({ novel, onViewChapter }) {
  const { notify, refreshNovel } = useStudio();
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(null);
  const [count, setCount] = useState(3);
  const [missing, setMissing] = useState([]);
  const [outlinePreview, setOutlinePreview] = useState(null);
  const [dismissedPreview, setDismissedPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [autoDrive, setAutoDrive] = useState(false);
  const polling = useRef(false);
  const action = useRef(false);
  const completed = useRef(0);
  const lastWritten = Math.max(0, ...novel.chapters.filter((chapter) => chapter.body?.trim()).map((chapter) => chapter.number));
  const nextNumber = lastWritten + 1;

  const read = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const latest = await api.latest(novel.id);
      setRun(latest);
      setOffline(false);
      if (latest) {
        const countDone = latest.chapters.filter((chapter) => chapter.status === "completed").length;
        if (countDone > completed.current || latest.status === "completed" && completed.current !== countDone) {
          completed.current = countDone;
          await refreshNovel(novel.id);
        }
      }
    } catch (problem) {
      if (problem instanceof TypeError) setOffline(true);
      else setError(problem.message);
    } finally { polling.current = false; setLoading(false); }
  }, [novel.id, refreshNovel]);

  useEffect(() => { const initial = setTimeout(() => { void read(); }, 0); const timer = setInterval(() => { void read(); }, 3000); return () => { clearTimeout(initial); clearInterval(timer); }; }, [read]);
  useEffect(() => {
    if (!autoDrive || !run || run.status !== "running" || run.leaseAt || run.cancelRequested && run.stage !== "analyzing" || !["ready","analyzing"].includes(run.stage) && !(run.mode === "continuous" && run.stage === "preview") || action.current || offline) return;
    action.current = true;
    api.advance(run.id).then(setRun).catch((problem) => setError(problem.message)).finally(() => { action.current = false; });
  }, [run, autoDrive, offline]);

  async function start(mode, total) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await api.start(novel.id, total, mode);
      if (result.status === "outlines_required") {
        setMissing(result.missingOutlines || []);
        setDialog("missing");
      } else if (result.status === "blocked") {
        setError(`第${result.existingContent?.join("、")}章已有正文，任务没有启动。`);
        setDialog(null);
      } else {
        setRun(result.run);
        setAutoDrive(true);
        setDialog(null);
        if (result.existing) notify("已找到这本小说的现有任务。", "success");
      }
    } catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }

  async function generateOutline() {
    if (!missing.length || busy) return;
    setBusy(true); setError("");
    try { setOutlinePreview(await api.generateOutline(novel.id, missing[0])); }
    catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }
  async function approveOutline() {
    if (!outlinePreview || busy) return;
    setBusy(true); setError("");
    try {
      await api.confirmOutline(outlinePreview.generationId);
      await refreshNovel(novel.id);
      const remaining = missing.slice(1);
      setMissing(remaining);
      setOutlinePreview(null);
      if (!remaining.length) { setDialog(null); notify("缺失大纲已确认，可以开始创作。", "success"); }
    } catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }
  async function operate(kind) {
    if (!run || busy) return;
    setBusy(true); setError("");
    try {
      const result = kind === "cancel" ? await api.cancel(run.id) : kind === "retry" ? await api.retry(run.id) : await api.advance(run.id, true);
      setRun(result);
      if (kind !== "cancel") setAutoDrive(true);
      if (kind === "cancel") notify(result.cancelRequested && result.status === "running" ? "当前章完成记忆更新后将停止。" : "任务已取消，已保存的章节仍然保留。", "success");
    } catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }
  const active = run && ["pending","running","paused","failed"].includes(run.status);
  const current = run?.chapters[run.currentIndex];

  return <section id="generation-run-panel" className="panel p-5 sm:p-6" aria-label="AI 连续创作">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs tracking-[0.2em] text-amber-300/70">AI WRITING ENGINE</p><h2 className="mt-2 text-xl font-semibold text-white">下一章与连续创作</h2>
        <p className="mt-2 text-sm text-slate-400">从最后一章正文继续。每章独立保存版本，完成记忆分析后再写下一章。</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="button button-primary button-small" disabled={busy || !!active} onClick={() => start("next",1)}><ArrowRight size={15} />生成下一章</button>
        <button type="button" className="button button-ghost button-small" disabled={busy || !!active} onClick={() => setDialog("settings")}><Sparkles size={15} />连续创作</button>
      </div>
    </div>
    {!active && !run && !loading && <p className="mt-4 text-sm text-slate-400">预计下一章：第{nextNumber}章。正文生成后会先显示预览，由你确认保存。</p>}
    {offline && <p className="mt-4 field-hint" role="status">网络暂时中断，页面保留当前进度；连接恢复后会重新读取任务。</p>}
    {error && <p className="mt-4 field-error" role="alert">{error}</p>}
    {run && <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><strong className="text-sm text-white">{run.mode === "next" ? "生成下一章" : "连续创作"} · {run.chapters.filter((chapter) => chapter.status === "completed").length} / {run.targetChapters}</strong>
        <p className="mt-1 text-sm text-slate-400" role="status">{run.status === "completed" ? run.mode === "next" ? "下一章已完成" : "连续创作完成" : run.status === "cancelled" ? "任务已取消" : run.status === "failed" ? `第${current?.number}章失败：${errorNames[run.errorType] || run.errorType || "请重试"}` : run.status === "paused" ? `第${current?.number}章暂停：${errorNames[run.errorType] || "请核对大纲"}` : run.cancelRequested ? `第${current?.number}章 · 完成记忆后取消` : `第${current?.number}章 · ${stageNames[run.stage] || "进行中"}`}</p></div>
        <div className="flex flex-wrap gap-2">
          {run.status === "running" && !autoDrive && (run.stage !== "preview" || run.mode === "continuous") && <button type="button" className="button button-primary button-small" onClick={() => setAutoDrive(true)}>继续任务</button>}
          {run.mode === "next" && run.stage === "preview" && run.preview && dismissedPreview === run.preview.generationId && <button type="button" className="button button-primary button-small" onClick={() => setDismissedPreview(null)}>查看正文预览</button>}
          {["failed","paused"].includes(run.status) && <button type="button" className="button button-primary button-small" disabled={busy} onClick={() => operate("retry")}>重试第{current?.number}章</button>}
          {["running","failed","paused"].includes(run.status) && !run.cancelRequested && <button type="button" className="button button-ghost button-small" disabled={busy} onClick={() => operate("cancel")}><X size={14} />取消任务</button>}
          {run.status === "completed" && <button type="button" className="button button-ghost button-small" onClick={() => onViewChapter(run.chapters.at(-1)?.chapterId)}>查看章节</button>}
        </div>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-3">{run.chapters.map((chapter) => <li key={chapter.chapterId} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300">
        {chapter.status === "completed" ? <Check size={15} className="text-emerald-400" /> : chapter.status === "generating" || chapter.status === "analyzing" ? <LoaderCircle size={15} className="loading-spinner text-amber-300" /> : <Circle size={15} className="text-slate-500" />}
        第{chapter.number}章 · {itemNames[chapter.status] || chapter.status}
      </li>)}</ol>
    </div>}
    {dialog === "settings" && <Modal title="连续创作" onClose={() => !busy && setDialog(null)}><p className="field-hint">将从第{nextNumber}章开始，选择本次生成数量。</p>
      <div className="mt-4 flex gap-3">{[3,5,10].map((value) => <label key={value} className="button button-ghost"><input type="radio" name="chapter-count" checked={count===value} onChange={() => setCount(value)} />{value}章</label>)}</div>
      <p className="mt-4 text-sm text-slate-300">预计生成第{nextNumber}～{nextNumber+count-1}章；单章约{novel.wordsPerChapter}字。预计正文 {count} 次、记忆分析 {count} 次 AI 调用。</p>
      <p className="mt-2 field-hint">如果需要补大纲，每章会额外消耗一次 AI 调用。实际费用取决于模型 Token 使用量。</p>
      <div className="chapter-recovery-actions"><button type="button" className="button button-ghost" onClick={() => setDialog(null)}>取消</button><button type="button" className="button button-primary" onClick={() => setDialog("confirm")}>继续</button></div>
    </Modal>}
    {dialog === "confirm" && <Modal title="确认连续创作" onClose={() => !busy && setDialog("settings")}><p className="text-sm text-slate-200">你即将连续生成 {count} 章。预计消耗 AI 额度；每章都会独立保存正文、创建版本并更新小说记忆。是否继续？</p>
      <div className="chapter-recovery-actions"><button type="button" className="button button-ghost" onClick={() => setDialog("settings")}>取消</button><button type="button" className="button button-primary" disabled={busy} onClick={() => start("continuous",count)}>{busy ? "正在检查…" : "开始"}</button></div>
    </Modal>}
    {dialog === "missing" && <Modal title="缺少已确认的大纲" onClose={() => !busy && setDialog(null)}><p className="text-sm text-slate-200">第{missing.join("、")}章尚无大纲。请逐章生成预览并确认，大纲齐备后再开始创作。</p>
      {!outlinePreview && <div className="chapter-recovery-actions"><button type="button" className="button button-ghost" onClick={() => setDialog(null)}>稍后处理</button><button type="button" className="button button-primary" disabled={busy} onClick={generateOutline}>{busy ? "生成中…" : `生成第${missing[0]}章大纲`}</button></div>}
      {outlinePreview && <><h3 className="mt-4 text-lg text-white">第{outlinePreview.chapterNumber}章 · {outlinePreview.title}</h3><textarea className="chapter-copy-input mt-3" readOnly rows={13} value={outlinePreview.outline} aria-label="大纲预览" />
        <div className="chapter-recovery-actions"><button type="button" className="button button-ghost" disabled={busy} onClick={() => setOutlinePreview(null)}>暂不保存</button><button type="button" className="button button-primary" disabled={busy} onClick={approveOutline}>{busy ? "正在保存…" : "确认大纲"}</button></div></>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </Modal>}
    {run?.mode === "next" && run.stage === "preview" && run.preview && dismissedPreview !== run.preview.generationId && <Modal title={`第${run.preview.chapterNumber}章 · 正文预览`} onClose={() => setDismissedPreview(run.preview.generationId)}><p className="field-hint">确认后才会保存正文、创建 AI 版本并分析章节记忆。</p><textarea className="chapter-copy-input mt-3" readOnly rows={18} value={run.preview.content} aria-label="下一章正文预览" />
      <div className="chapter-recovery-actions"><button type="button" className="button button-ghost" onClick={() => setDismissedPreview(run.preview.generationId)}>稍后确认</button><button type="button" className="button button-primary" disabled={busy} onClick={() => operate("confirm")}>{busy ? "正在保存…" : "确认保存正文"}</button></div>
    </Modal>}
  </section>;
}

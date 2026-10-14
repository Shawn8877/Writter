"use client";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Check, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useStudio } from "@/components/studio-provider";
import { Modal } from "@/components/ui";

const reasons = {
  CONTEXT_CHANGED: "分析期间正文或设定发生了变化，请基于最新内容重新分析。",
  AI_RATE_LIMIT: "本小时 AI 调用次数已用完，请稍后重试。",
  AI_BUSY: "其他 AI 任务正在运行，请等待完成后重试。",
  LATER_MEMORY_EXISTS: "后续章节已建立记忆，请人工核对旧章节，避免覆盖后续人物状态。",
  LEASE_EXPIRED: "上次分析已中断，可以重新尝试。",
  MEMORY_REVIEW_REQUIRED: "正文与原分析已不一致，请人工核对摘要、人物、时间线和记忆。",
};
export function ChapterMemoryStatus({ novelId, chapterId, revision, hasContent, onStatus }) {
  const { refreshNovel } = useStudio();
  const refresh = useRef(refreshNovel); useEffect(() => { refresh.current = refreshNovel; }, [refreshNovel]);
  const [state, setState] = useState({ status: "none" });
  const [cycle, setCycle] = useState(0); const [error, setError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false); const [reviewChecked, setReviewChecked] = useState(false); const [acknowledging, setAcknowledging] = useState(false);
  const lock = useRef(false); const retryTime = useRef(0); const lastUpdated = useRef(null);
  const refreshed = useRef(null);
  const url = `/api/ai/chapters/memory?${new URLSearchParams({ novelId, chapterId })}`;
  useEffect(() => {
    let cancelled = false; let timer; const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const next = await response.json();
        if (!response.ok) throw new Error(next.error || "暂时无法读取记忆分析状态。");
        if (cancelled) return;
        if (retryTime.current && Date.now() - retryTime.current < 15000 && next.updatedAt === lastUpdated.current && !["succeeded", "running"].includes(next.status)) {
          timer = setTimeout(poll, 2000); return;
        }
        retryTime.current = 0; lastUpdated.current = next.updatedAt;
        setState(next); onStatus?.(next.status); setError("");
        if (["succeeded", "reviewed"].includes(next.status) && refreshed.current !== next.updatedAt) {
          refreshed.current = next.updatedAt;
          void refresh.current(novelId).catch(() => { if (!cancelled) setError("记忆已更新，页面刷新失败，请刷新页面查看。"); });
        }
        if (["pending", "running"].includes(next.status)) timer = setTimeout(poll, 2500);
      } catch (e) { if (!cancelled) setError(e instanceof TypeError ? "网络中断，正文已保存。恢复连接后可刷新分析状态。" : e.message); }
    }
    void poll();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [url, novelId, revision, hasContent, cycle, onStatus]);
  async function retry() {
    if (lock.current) return;
    lock.current = true; setError("");
    try {
      const response = await fetch("/api/ai/chapters/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ novelId, chapterId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "暂时无法重新分析。");
      retryTime.current = Date.now(); setState(result); setCycle((v) => v + 1);
    } catch (e) { setError(e instanceof TypeError ? "网络异常，请稍后重试。" : e.message); }
    finally { lock.current = false; }
  }
  async function acknowledge() {
    if (!reviewChecked || lock.current) return;
    lock.current = true; setAcknowledging(true); setError("");
    try {
      const response = await fetch("/api/ai/chapters/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ novelId, chapterId, action: "acknowledge", expectedRevision: state.chapterRevision }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "暂时无法确认核对结果。");
      setState(result); onStatus?.(result.status); setReviewOpen(false); setCycle((v) => v + 1);
    } catch (e) { setError(e instanceof TypeError ? "网络异常，请稍后重试。" : e.message); }
    finally { lock.current = false; setAcknowledging(false); }
  }
  if (state.status === "none" && !error) return null;
  const working = ["pending", "running"].includes(state.status);
  return <div className="chapter-memory-status" data-testid="chapter-memory-status">
    <p role="status" aria-live="polite">
      {working ? <><LoaderCircle size={14} className="loading-spinner" />正文已保存 · 正在分析章节…</>
        : state.status === "succeeded" ? <><Check size={14} />正文已保存 · 记忆已更新</>
          : state.status === "reviewed" ? <><Check size={14} />正文已保存 · 记忆已人工核对</>
          : state.status === "needs_review" ? "正文已修改，请人工核对记忆后继续。"
          : state.status === "stale" ? "正文已修改，记忆需要重新分析。"
            : state.status === "failed" ? "正文已保存，记忆更新失败，请稍后重试" : "正文已保存"}
    </p>
    {working && <span className="field-hint">你可以继续阅读本章。修改正文后，需要基于最新内容重新分析。</span>}
    {reasons[state.errorType] && <p className="field-hint">{reasons[state.errorType]}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    {["failed", "stale"].includes(state.status) && <button className="button button-ghost button-small" onClick={retry}><RotateCcw size={13} />重试记忆更新</button>}
    {state.status === "needs_review" && <><p className="field-hint">旧分析可能包含已失效的事实。核对摘要、人物状态、时间线和伏笔，修正后再确认。</p><button className="button button-ghost button-small" onClick={() => { setReviewChecked(false); setReviewOpen(true); }}>核对记忆后继续</button></>}
    {error && <button className="button button-ghost button-small" onClick={() => setCycle((v) => v + 1)}>刷新分析状态</button>}
    {reviewOpen && <Modal title="确认已核对章节记忆" onClose={() => { if (!acknowledging) setReviewOpen(false); }}>
      <p>请先根据修改后的正文核对章节摘要、人物状态、时间线与伏笔，并在<Link href={`/novel/${novelId}/memory`}>记忆中心</Link>删除或修正不再成立的事实。历史章节修改还需核对后续章节的连续性。</p>
      <p className="field-hint">确认后使用你核对过的资料继续创作。本操作不会调用 AI、自动修复记忆或重新生成正文。</p>
      <label><input type="checkbox" checked={reviewChecked} disabled={acknowledging} onChange={(event) => setReviewChecked(event.target.checked)} />我已核对并修正受影响的记忆与连续性资料</label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button button-ghost" disabled={acknowledging} onClick={() => setReviewOpen(false)}>取消</button><button className="button button-primary" disabled={!reviewChecked || acknowledging} onClick={acknowledge}>{acknowledging ? "正在确认…" : "确认已核对记忆"}</button></div>
    </Modal>}
  </div>;
}

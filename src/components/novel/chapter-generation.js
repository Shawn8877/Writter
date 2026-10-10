"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, LoaderCircle } from "lucide-react";
import { Modal } from "@/components/ui";
import { useStudio } from "@/components/studio-provider";
import { generateChapter, confirmChapter } from "@/lib/repositories/chapter-generation-repository";

const labels = { preparing: "准备上下文…", generating: "正在生成正文…", saving: "正在保存…", done: "生成完成" };
export function ChapterGeneration({ novelId, chapterId, revision, disabled, hasContent, onActiveChange, onSaved }) {
  const { notify } = useStudio();
  const [stage, setStage] = useState("idle");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const lock = useRef(false); const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const working = ["preparing", "generating", "saving"].includes(stage);
  async function generate() {
    if (lock.current || disabled) return;
    if (hasContent) { notify("本章已有正文，不能直接覆盖。重新生成功能将在后续阶段开放。", "error"); return; }
    lock.current = true; onActiveChange(true); setError(""); setStage("preparing");
    try {
      const result = await generateChapter({ requestId: crypto.randomUUID(), novelId, chapterId, expectedRevision: revision }, (next) => { if (mounted.current) setStage(next); });
      if (mounted.current) { setPreview(result); setStage("preview"); }
    } catch (error) {
      if (mounted.current) { setError(error instanceof TypeError ? "网络连接中断，请检查网络后重试。" : error.message); setStage("error"); onActiveChange(false); }
    } finally { lock.current = false; }
  }
  async function confirm() {
    if (lock.current || !preview) return;
    lock.current = true; setError(""); setStage("saving");
    try {
      const saved = await confirmChapter(preview.generationId);
      if (mounted.current) { onSaved(saved); setPreview(null); setStage("done"); onActiveChange(false); notify("本章已生成并保存，已创建 AI 版本记录。", "success"); }
    } catch (error) { if (mounted.current) { setError(error instanceof TypeError ? "网络异常，预览已保留，请重试保存。" : error.message); setStage("preview"); } }
    finally { lock.current = false; }
  }
  function close() {
    if (working || lock.current) return;
    if (!window.confirm("这份预览尚未写入章节。确定关闭？再次生成会产生新的 API 用量。")) return;
    setPreview(null); setError(""); setStage("idle"); onActiveChange(false);
  }
  return <>
    <button type="button" className="button button-primary button-small" disabled={disabled || working || !!preview} onClick={generate}>
      {working ? <LoaderCircle size={15} className="loading-spinner" /> : <Sparkles size={15} />}生成本章
    </button>
    {stage !== "idle" && stage !== "preview" && stage !== "error" && <span role="status" aria-live="polite" className="field-hint">{labels[stage]}</span>}
    {error && !preview && <p className="field-error" role="alert">{error}</p>}
    {preview && <Modal title="AI 章节预览" onClose={close}>
      <p className="field-hint">已生成 {preview.wordCount} 字。确认后才会写入本章，并创建 AI 版本记录。</p>
      {preview.lengthWarning && <p className="field-error" role="alert">{preview.lengthWarning}</p>}
      <label className="sr-only" htmlFor="generated-chapter-preview">生成正文预览</label>
      <textarea id="generated-chapter-preview" className="chapter-copy-input" readOnly value={preview.content} rows={18} />
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="chapter-recovery-actions">
        <button type="button" className="button button-ghost" disabled={working} onClick={close}>暂不保存</button>
        <button type="button" className="button button-primary" disabled={working} onClick={confirm}>
          {working && <LoaderCircle size={15} className="loading-spinner" />}{stage === "saving" ? "正在保存…" : "确认保存正文"}
        </button>
      </div>
    </Modal>}
  </>;
}

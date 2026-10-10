"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Save, ArrowRight, RotateCcw, Expand, WandSparkles,
  GitBranch, FileText, Check, AlignLeft, BookOpen, History,
  Copy, CloudUpload, LoaderCircle,
} from "lucide-react";
import { AiButton, Badge, Modal } from "@/components/ui";
import { useStudio } from "@/components/studio-provider";
import { useNovel } from "./novel-context";
import { ChapterVersions } from "./chapter-versions";
import { ChapterGeneration } from "./chapter-generation";
import { countWords, formatNumber } from "@/lib/domain/novel";
import { useUnsavedChanges } from "@/lib/hooks/use-unsaved-changes";
import { chapterDraftCache } from "@/lib/repositories/chapter-draft-cache";
import { cloudChapterRepository } from "@/lib/repositories/cloud-chapter-repository";

const FIELDS = ["title", "outline", "body", "summary"];
// A returning editor waits for a save already started by its previous instance.
const pendingSaves = new Map();
function contentOf(chapter) {
  return Object.fromEntries(FIELDS.map((field) => [field, chapter[field] || ""]));
}
function sameContent(left, right) {
  return FIELDS.every((field) => left[field] === right[field]);
}
function initialState(chapter) {
  const content = contentOf(chapter);
  return {
    draft: content, saved: content, revision: chapter.revision ?? 0,
    status: "loading", ready: false, conflict: false, cacheError: false,
    cacheToken: null, restored: false,
  };
}

export function ChapterEditor({ chapter, onDirtyChange }) {
  const { novel } = useNovel();
  const { user, notify, acceptChapter, refreshNovel } = useStudio();
  const userId = user?.id;
  const novelId = novel.id;
  const chapterId = chapter.id;
  const scope = `${userId}:${novelId}:${chapterId}`;
  const [initialChapter] = useState(chapter);
  const [view, setView] = useState(() => initialState(chapter));
  const live = useRef(initialState(chapter));
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const [tab, setTab] = useState("正文");
  const [showVersions, setShowVersions] = useState(false);
  const [recovery, setRecovery] = useState(null);
  const [copyText, setCopyText] = useState(null);
  const [aiActive, setAiActive] = useState(false);
  const aiLock = useRef(false);
  const dirty = !sameContent(view.draft, view.saved);
  const draft = view.draft;
  const busy = view.status === "saving" || view.status === "reloading";

  const publish = useCallback((patch) => {
    live.current = { ...live.current, ...patch };
    if (mounted.current) setView(live.current);
  }, []);

  useUnsavedChanges(dirty || aiActive, aiActive ? "AI 正在生成或有未确认的预览，离开会关闭当前预览。确定离开吗？" : undefined);
  useEffect(() => { onDirtyChange(dirty || aiActive); }, [dirty, aiActive, onDirtyChange]);

  function setGenerationActive(active) { aiLock.current = active; setAiActive(active); }
  function acceptGenerated(result) {
    const saved = contentOf(result.chapter);
    chapterDraftCache.remove(userId, novelId, chapterId);
    publish({ draft: saved, saved, revision: result.chapter.revision, status: "saved", conflict: false, cacheToken: null, cacheError: false, restored: false });
    acceptChapter(novelId, result.chapter, result.novelRevision);
    setTab("正文");
  }

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    async function restore() {
      const active = pendingSaves.get(scope);
      const result = active ? await active : null;
      // Read recovery only after hydration, and only for this authenticated user.
      await Promise.resolve();
      if (cancelled || !userId) return;
      const remote = result?.chapter || initialChapter;
      const saved = contentOf(remote);
      const revision = remote.revision ?? 0;
      const entry = chapterDraftCache.read(userId, novelId, chapterId);
      if (entry && !sameContent(entry.content, saved)) {
        const cached = chapterDraftCache.write(userId, novelId, chapterId, entry.content, entry.baseRevision);
        const conflict = entry.baseRevision !== revision;
        publish({
          draft: entry.content, saved, revision: entry.baseRevision, ready: true,
          cacheToken: cached?.snapshotId, cacheError: !cached, restored: true,
          conflict, status: conflict ? "conflict" : "pending",
        });
      } else {
        if (entry) chapterDraftCache.remove(userId, novelId, chapterId);
        publish({ draft: saved, saved, revision, ready: true, status: "saved" });
      }
    }
    void restore();
    return () => { cancelled = true; mounted.current = false; };
  }, [userId, novelId, chapterId, scope, initialChapter, publish]);

  const save = useCallback(async (createVersion = false) => {
    const current = live.current;
    if (!current.ready || current.conflict || inFlight.current || aiLock.current || !userId) return;
    if (!current.draft.title.trim()) {
      if (createVersion) notify("请为这一章填写标题。", "error");
      return;
    }
    if (!createVersion && sameContent(current.draft, current.saved)) return;
    const rawSnapshot = { ...current.draft };
    const snapshot = { ...rawSnapshot, title: rawSnapshot.title.trim() };
    const revision = current.revision;
    const cached = current.cacheToken ? null : chapterDraftCache.write(userId, novelId, chapterId, rawSnapshot, revision);
    const snapshotId = current.cacheToken || cached?.snapshotId;
    inFlight.current = true;
    publish({ status: "saving" });
    const task = (async () => {
      try {
        const result = await cloudChapterRepository.save(
          novelId, chapterId, snapshot, revision, { createVersion },
        );
        const saved = contentOf(result.chapter);
        const nextRevision = result.chapter.revision;
        const unchangedSinceRequest = sameContent(live.current.draft, rawSnapshot);
        // Acknowledge the exact request, never a newer draft typed while saving.
        chapterDraftCache.acknowledge(userId, novelId, chapterId, snapshotId, revision, nextRevision);
        const nextDraft = unchangedSinceRequest ? saved : live.current.draft;
        const fullySaved = sameContent(nextDraft, saved);
        if (fullySaved && (!snapshotId || !unchangedSinceRequest)) {
          // The entire latest editor content is now durable, including a revert
          // typed during the request or a draft that exceeded local capacity.
          chapterDraftCache.remove(userId, novelId, chapterId);
        }
        publish({
          saved, draft: nextDraft, revision: nextRevision,
          cacheToken: fullySaved ? null : live.current.cacheToken,
          cacheError: fullySaved ? false : live.current.cacheError,
          status: fullySaved ? "saved" : "pending",
          restored: false,
        });
        acceptChapter(novelId, result.chapter, result.novelRevision);
        if (createVersion && mounted.current) notify("章节已保存，并创建了一个手动版本。", "success");
        return result;
      } catch (error) {
        const conflict = error.status === 409 || error.code === "CONFLICT" || error.code === "REVISION_CONFLICT";
        publish({ status: conflict ? "conflict" : "error", conflict });
        if (mounted.current && createVersion) {
          notify(conflict ? "云端章节已被其他页面或设备修改，请先处理冲突。" : live.current.cacheError ? "保存失败，浏览器临时草稿也不可用，请立即复制内容。" : "保存失败，本地草稿已保留。", "error");
        }
        return null;
      } finally {
        inFlight.current = false;
      }
    })();
    pendingSaves.set(scope, task);
    void task.then(() => {
      if (pendingSaves.get(scope) === task) pendingSaves.delete(scope);
    });
    return task;
  }, [userId, novelId, chapterId, scope, publish, acceptChapter, notify]);

  useEffect(() => {
    if (!view.ready || view.conflict || view.status !== "pending" || !dirty || !draft.title.trim()) return;
    const timer = window.setTimeout(() => { void save(false); }, 1000);
    return () => window.clearTimeout(timer);
  }, [view.ready, view.conflict, view.status, dirty, draft, save]);

  useEffect(() => {
    const retryOnline = () => {
      if (live.current.status === "error" && !live.current.conflict) void save(false);
    };
    window.addEventListener("online", retryOnline);
    return () => window.removeEventListener("online", retryOnline);
  }, [save]);

  useEffect(() => {
    let cancelled = false;
    // An aggregate refresh must never replace an editor that has local changes.
    queueMicrotask(() => {
      const current = live.current;
      const revision = chapter.revision ?? 0;
      if (cancelled || !current.ready || inFlight.current || revision <= current.revision) return;
      if (!sameContent(current.draft, current.saved)) {
        publish({ conflict: true, status: "conflict" });
      } else {
        const content = contentOf(chapter);
        chapterDraftCache.remove(userId, novelId, chapterId);
        publish({ draft: content, saved: content, revision, status: "saved", conflict: false, cacheToken: null });
      }
    });
    return () => { cancelled = true; };
  }, [chapter, publish, userId, novelId, chapterId]);

  function change(field, value) {
    const current = live.current;
    const next = { ...current.draft, [field]: value };
    if (!inFlight.current && !current.conflict && sameContent(next, current.saved)) {
      chapterDraftCache.remove(userId, novelId, chapterId);
      publish({ draft: next, cacheToken: null, status: "saved" });
      onDirtyChange(false);
      return;
    }
    const cached = chapterDraftCache.write(userId, novelId, chapterId, next, current.revision);
    publish({
      draft: next, cacheToken: cached?.snapshotId, cacheError: !cached,
      status: current.conflict ? "conflict" : inFlight.current ? "saving" : "pending",
    });
    onDirtyChange(!sameContent(next, current.saved));
  }

  async function copyDraft() {
    const current = live.current.draft;
    const text = `${current.title}\n\n${current.body}\n\n【本章大纲】\n${current.outline}\n\n【章节摘要】\n${current.summary}`;
    try {
      await navigator.clipboard.writeText(text);
      notify("当前草稿已复制。", "success");
    } catch {
      setCopyText(text);
    }
  }

  async function reloadRemote() {
    if (inFlight.current) return;
    if (!window.confirm("重新加载会放弃编辑区中尚未同步的修改。请先复制需要保留的草稿，确定加载云端内容吗？")) return;
    publish({ status: "reloading" });
    try {
      const remoteNovel = await refreshNovel(novelId);
      const remote = remoteNovel?.chapters.find((item) => item.id === chapterId);
      if (!remote) throw new Error("这一章已不存在，请重新打开小说。");
      const content = contentOf(remote);
      chapterDraftCache.remove(userId, novelId, chapterId);
      publish({
        draft: content, saved: content, revision: remote.revision ?? 0,
        conflict: false, status: "saved", cacheToken: null, restored: false,
      });
      onDirtyChange(false);
    } catch (error) {
      publish({ status: live.current.conflict ? "conflict" : "error" });
      notify(error.message || "加载失败，当前草稿仍已保留。", "error");
    }
  }

  function openRecovery() {
    setRecovery({
      entries: chapterDraftCache.list(userId, novelId, chapterId)
        .filter((entry) => !sameContent(entry.content, live.current.saved) && !sameContent(entry.content, live.current.draft)),
      legacy: chapterDraftCache.hasLegacy(novelId, chapterId),
    });
  }

  function restoreEntry(entry) {
    if (inFlight.current) return;
    if (!window.confirm("将这份本地草稿放入编辑区？当前未保存的内容会被替换，请先复制需要保留的内容。")) return;
    const revision = entry.baseRevision;
    const cached = chapterDraftCache.write(userId, novelId, chapterId, entry.content, revision);
    const conflict = revision !== (chapter.revision ?? 0);
    publish({
      draft: entry.content, revision, cacheToken: cached?.snapshotId,
      cacheError: !cached, restored: true, conflict,
      status: conflict ? "conflict" : "pending",
    });
    setRecovery(null);
  }

  function importLegacy() {
    if (!window.confirm("旧版草稿没有账号信息。仅当这份草稿属于你时才继续导入；它会替换编辑区内容，请先复制当前修改。导入不会自动写入云端。确定继续吗？")) return;
    const content = chapterDraftCache.readLegacy(novelId, chapterId);
    if (!content) { notify("未找到可恢复的旧版草稿。", "error"); return; }
    const cached = chapterDraftCache.write(userId, novelId, chapterId, content, 0);
    publish({ draft: content, revision: 0, cacheToken: cached?.snapshotId, cacheError: !cached, restored: true, conflict: true, status: "conflict" });
    setRecovery(null);
  }

  const failureText = view.cacheError ? "保存失败，请立即复制当前草稿" : "保存失败，本地草稿已保留";
  const statusText = view.conflict ? "发现云端版本冲突"
    : view.status === "saving" ? "正在保存…"
      : view.status === "reloading" || !view.ready ? "正在加载…"
        : view.status === "error" ? failureText
          : dirty ? "等待自动保存" : "已保存";

  return (
    <div className="chapter-editor">
      <div className="editor-meta">
        <span>第 {chapter.number} 章</span>
        <Badge tone={draft.body ? "green" : "neutral"}>{draft.body ? (dirty ? "草稿" : chapter.status || "草稿") : "待创作"}</Badge>
        <span className={`editor-save-status ${view.conflict || view.status === "error" ? "editor-save-error" : ""}`} role="status" aria-live="polite">
          {view.status === "saved" && !dirty && <Check size={12} />}
          {busy && <LoaderCircle size={12} className="loading-spinner" />}
          {statusText}
        </span>
      </div>
      {view.cacheError && <div className="chapter-save-alert" role="alert">浏览器临时草稿保存不可用。请先复制重要内容，确认云端已保存后再关闭页面。</div>}
      {view.restored && !view.conflict && <p className="chapter-recovery-note">已恢复本地草稿，正在继续同步。</p>}
      {(view.conflict || view.status === "error") && (
        <div className="chapter-save-alert" role="alert">
          <p>{view.conflict ? "云端章节与本地草稿的版本不同，自动保存已暂停。先复制草稿，再加载云端内容进行核对。" : `${failureText}。检查网络后可以重试。`}</p>
          <div className="chapter-recovery-actions">
            <button className="button button-ghost button-small" onClick={copyDraft}><Copy size={13} />复制草稿</button>
            {view.conflict ? <button className="button button-ghost button-small" onClick={reloadRemote} disabled={busy}>加载云端内容</button>
              : <button className="button button-ghost button-small" onClick={() => { void save(false); }} disabled={busy}><CloudUpload size={13} />重试保存</button>}
          </div>
        </div>
      )}
      <label className="sr-only" htmlFor="chapter-title">章节标题</label>
      <input id="chapter-title" className="chapter-title-input" value={draft.title} maxLength={100}
        disabled={!view.ready || view.status === "reloading" || aiActive}
        onChange={(event) => change("title", event.target.value)} placeholder="为这一章起个名字" />
      <div className="chapter-ai-toolbar">
        <ChapterGeneration novelId={novelId} chapterId={chapterId} revision={view.revision}
          disabled={!view.ready || busy || dirty || view.conflict} hasContent={draft.body !== ""}
          onActiveChange={setGenerationActive} onSaved={acceptGenerated} />
        <AiButton className="button button-ghost button-small" icon={ArrowRight}>生成下一章</AiButton>
        <AiButton className="button button-ghost button-small" icon={RotateCcw}>重新生成</AiButton>
      </div>
      <div className="editor-tabs-row">
        <div className="content-tabs editor-tabs" role="group" aria-label="章节内容分类">
          {[["正文", AlignLeft], ["本章大纲", FileText], ["章节摘要", BookOpen]].map(([name, Icon]) => (
            <button key={name} onClick={() => setTab(name)} className={tab === name ? "selected" : ""} aria-pressed={tab === name}><Icon size={13} />{name}</button>
          ))}
        </div>
      </div>
      {tab === "正文" && <>
        <div className="editing-tools">
          <AiButton className="editing-tool" icon={Expand}>扩写</AiButton>
          <AiButton className="editing-tool" icon={WandSparkles}>润色</AiButton>
          <AiButton className="editing-tool" icon={GitBranch}>修改剧情</AiButton>
          <span>正文编辑</span>
        </div>
        <label className="sr-only" htmlFor="chapter-body">章节正文</label>
        <textarea id="chapter-body" className="manuscript-input" value={draft.body}
          disabled={!view.ready || view.status === "reloading" || aiActive}
          onChange={(event) => change("body", event.target.value)}
          placeholder="故事将从这里展开。可以手动写下正文，也可以先保存本章大纲，再点击生成本章。" />
      </>}
      {tab === "本章大纲" && <div className="chapter-meta-editor">
        <h3>这一章，要发生什么？</h3><p>记录目标、冲突、关键事件与章末悬念。</p>
        <label className="sr-only" htmlFor="chapter-outline">本章大纲</label>
        <textarea id="chapter-outline" value={draft.outline} rows={12} disabled={!view.ready || view.status === "reloading" || aiActive}
          onChange={(event) => change("outline", event.target.value)} placeholder="写下这一章的故事走向…" />
      </div>}
      {tab === "章节摘要" && <div className="chapter-meta-editor">
        <h3>为下一章，留下一份记忆。</h3><p>摘要由你手动填写，保存后会同步到小说记忆。AI 自动总结尚未接入。</p>
        <label className="sr-only" htmlFor="chapter-summary">章节摘要</label>
        <textarea id="chapter-summary" value={draft.summary} rows={12} disabled={!view.ready || view.status === "reloading" || aiActive}
          onChange={(event) => change("summary", event.target.value)} placeholder="本章发生了什么？人物有哪些变化？留下了什么伏笔？" />
      </div>}
      <div className="editor-footer">
        <span>{formatNumber(countWords(draft.body))} 字 <small>/ 目标 {formatNumber(novel.wordsPerChapter)} 字</small></span>
        <div className="chapter-save-actions">
          <button className="button button-ghost button-small" onClick={() => setShowVersions(true)} disabled={!view.ready}><History size={14} />版本记录</button>
          <button className="button button-primary button-small" onClick={() => { void save(true); }} disabled={!view.ready || busy || aiActive || view.conflict || !draft.title.trim()}><Save size={14} />保存版本</button>
        </div>
      </div>
      <div className="chapter-editor-notes">
        <p className="editor-notice">修改后自动保存；AI 生成先预览，确认后保存正文和版本。其他 AI 操作尚未接入。</p>
        <button className="chapter-local-recovery" onClick={openRecovery} disabled={!view.ready || busy || aiActive}>本地恢复</button>
      </div>
      {showVersions && <ChapterVersions novelId={novelId} chapterId={chapterId} onClose={() => setShowVersions(false)} />}
      {copyText !== null && <Modal title="复制当前草稿" onClose={() => setCopyText(null)}>
        <p className="field-hint">请选择下方内容并复制。</p>
        <textarea className="chapter-copy-input" aria-label="待复制的章节草稿" readOnly value={copyText} onFocus={(event) => event.target.select()} rows={15} />
      </Modal>}
      {recovery && <Modal title="本地草稿恢复" onClose={() => setRecovery(null)}>
        <p className="field-hint">这里仅列出当前账号在本浏览器中保留的其他草稿。版本不同的草稿需要先核对云端内容。</p>
        {recovery.entries.length ? <div className="chapter-recovery-list">{recovery.entries.map((entry) => (
          <button key={entry.snapshotId} onClick={() => restoreEntry(entry)}>
            <strong>{entry.content.title || "未命名章节"}</strong>
            <span>{new Date(entry.updatedAt).toLocaleString("zh-CN")} · {formatNumber(countWords(entry.content.body))} 字</span>
            <p>{entry.content.body.slice(0, 100) || "无正文，包含其他章节修改。"}</p>
          </button>
        ))}</div> : <p className="chapter-recovery-empty">没有其他可恢复的本地草稿。</p>}
        {recovery.legacy && <button className="button button-ghost button-small" onClick={importLegacy}>导入旧版无账号草稿</button>}
      </Modal>}
    </div>
  );
}

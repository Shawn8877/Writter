"use client";

import Link from "next/link";
import { useState } from "react";
import { Database, Plus, Pencil, Trash2, Link2 } from "lucide-react";
import { useNovel } from "./novel-context";
import { useStudio } from "@/components/studio-provider";
import { PageHeading, Badge, EmptyState, Modal } from "@/components/ui";
import { RecordForm } from "./record-form";
import { MEMORY_TYPES, MEMORY_STATUSES, memorySource } from "@/lib/domain/memory";

export function MemoryView() {
  const { novel, update } = useNovel();
  const { notify } = useStudio();
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const entries = novel.memory.entries || [];
  const visible = entries.filter((entry) => filter === "all" || entry.type === filter);
  const sources = [
    { value: "manual", label: "手动记录（无外部来源）" },
    ...novel.chapters.map((chapter) => ({ value: `chapter:${chapter.id}`, label: `章节 · 第 ${chapter.number} 章 ${chapter.title}` })),
    ...novel.characters.map((person) => ({ value: `character:${person.id}`, label: `人物 · ${person.name}` })),
    ...novel.world.map((setting) => ({ value: `world_entry:${setting.id}`, label: `世界设定 · ${setting.title}` })),
  ];
  const fields = [
    { key: "title", label: "记忆标题", required: true, maxLength: 200 },
    { key: "type", label: "记忆类型", options: MEMORY_TYPES.map(([value, label]) => ({ value, label })), defaultValue: filter === "all" ? "character" : filter },
    { key: "content", label: "记忆内容", type: "textarea", rows: 5, required: true },
    { key: "importance", label: "重要程度", options: [1,2,3,4,5].map((value) => ({ value: String(value), label: `${value} / 5${value === 5 ? " · 核心设定" : ""}` })), defaultValue: "3" },
    { key: "status", label: "记忆状态", options: MEMORY_STATUSES.map(([value, label]) => ({ value, label })), defaultValue: "active" },
    { key: "sourceReference", label: "资料来源", options: sources, defaultValue: "manual", hint: "来源只能选择这部小说内的章节、人物或世界设定。" },
  ];
  async function save(values) {
    const [sourceType, sourceId] = values.sourceReference.split(":");
    const entry = { ...editing, id: editing.id || crypto.randomUUID(), title: values.title, content: values.content, type: values.type, importance: Number(values.importance), status: values.status, sourceType, sourceId: sourceId || null, chapterId: sourceType === "chapter" ? sourceId : null, sourceChapterId: sourceType === "chapter" ? sourceId : null };
    await update((previous) => ({ ...previous, memory: { ...previous.memory, entries: editing.id ? previous.memory.entries.map((item) => item.id === entry.id ? entry : item) : [...previous.memory.entries, entry] } }));
  }
  async function remove() {
    if (busy) return;
    setBusy(true);
    try { await update((previous) => ({ ...previous, memory: { ...previous.memory, entries: previous.memory.entries.filter((item) => item.id !== deleting.id) } })); setDeleting(null); notify("记忆已删除。", "success"); }
    catch (error) { notify(error.message, "error"); }
    finally { setBusy(false); }
  }
  return <><PageHeading eyebrow="A TRACEABLE STORY MEMORY" title="记忆中心" description="记录故事里的事实，也记住这些事实从何而来。"><button className="button button-primary button-small" onClick={() => setEditing({})}><Plus size={15} />新增记忆</button></PageHeading><div className="world-banner panel"><Database size={38} strokeWidth={1.3} /><div><span className="section-kicker">{entries.length} 条长期记忆</span><h2>每一个设定，都有来处。</h2><p>当前由你手动维护。AI 提取与自动更新仍未接入。</p></div></div><div className="memory-filter" role="group" aria-label="记忆分类">{[["all", "全部"], ...MEMORY_TYPES].map(([value, label]) => <button key={value} className={filter === value ? "selected" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="world-records">{visible.map((entry) => {
    const source = memorySource(entry, novel);
    const chapter = novel.chapters.find((item) => item.id === source.chapterId);
    return <article className="world-record panel" key={entry.id}><div className="memory-detail"><div className="memory-row-heading"><h3>{entry.title}</h3><Badge>{MEMORY_TYPES.find(([type]) => type === entry.type)?.[1] || entry.type}</Badge><Badge tone={entry.status === "resolved" ? "green" : entry.status === "obsolete" ? "neutral" : "gold"}>{MEMORY_STATUSES.find(([status]) => status === entry.status)?.[1]}</Badge><span className="muted text-xs">重要度 {entry.importance}/5</span><div className="memory-actions"><button className="icon-button" onClick={() => setEditing(entry)} aria-label={`编辑记忆 ${entry.title}`}><Pencil size={14} /></button><button className="icon-button" onClick={() => setDeleting(entry)} aria-label={`删除记忆 ${entry.title}`}><Trash2 size={14} /></button></div></div><p>{entry.content}</p><div className="memory-source"><Link2 size={13} />来源：{source.href ? <Link href={source.href}>{source.label}</Link> : source.label}{chapter && entry.sourceType !== "chapter" && <Link href={`/novel/${novel.id}/chapters?chapter=${chapter.id}`}> · 第 {chapter.number} 章</Link>}</div></div></article>;
  })}</div>{visible.length === 0 && <EmptyState icon={Database} title="还没有这类记忆" description="从一个重要的事实开始，记录它的内容、状态与来源。"><button className="button button-ghost" onClick={() => setEditing({})}><Plus size={15} />记录第一条记忆</button></EmptyState>}{editing && <RecordForm title={editing.id ? "编辑长期记忆" : "新增长期记忆"} fields={fields} record={{ ...editing, importance: String(editing.importance || 3), sourceReference: editing.sourceId ? `${editing.sourceType}:${editing.sourceId}` : "manual" }} onSave={save} onClose={() => setEditing(null)} />}{deleting && <Modal title={`删除记忆「${deleting.title}」？`} onClose={() => { if (!busy) setDeleting(null); }}><p className="migration-notice">将永久删除这条记忆。作为来源的章节、人物或世界设定会继续保留。</p><div className="modal-actions"><button className="button button-ghost" onClick={() => setDeleting(null)} disabled={busy}>取消</button><button className="button button-danger" onClick={remove} disabled={busy}>确认删除记忆</button></div></Modal>}</>;
}

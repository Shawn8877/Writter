"use client";

import { useState } from "react";
import { Plus, History, Pencil, CalendarDays, BookOpen } from "lucide-react";
import { useNovel } from "./novel-context";
import { PageHeading, Badge, EmptyState } from "@/components/ui";
import { RecordForm } from "./record-form";

const kinds = ["世界历史", "人物背景", "正文事件", "计划事件"];
const fields = [
  {
    key: "time",
    label: "故事内时间",
    placeholder: "例如：永夜 700 年 · 第一夜",
    required: true,
  },
  { key: "title", label: "事件名称", required: true },
  { key: "kind", label: "事件类型", options: kinds, defaultValue: "计划事件" },
  { key: "description", label: "事件描述", type: "textarea", rows: 5 },
];
export function TimelineView() {
  const { novel, update } = useNovel();
  const [filter, setFilter] = useState("全部事件");
  const [editing, setEditing] = useState(null);
  const events = novel.timeline.filter(
    (event) => filter === "全部事件" || event.kind === filter,
  );
  function save(values) {
    const event = {
      ...editing,
      ...values,
      id: editing.id || crypto.randomUUID(),
      sourceChapterId: editing.sourceChapterId || null,
      updatedAt: new Date().toISOString(),
    };
    return update((previous) => ({
      ...previous,
      timeline: editing.id
        ? previous.timeline.map((item) => (item.id === event.id ? event : item))
        : [...previous.timeline, event],
    }));
  }
  return (
    <>
      <PageHeading
        eyebrow="EVERY MOMENT MATTERS"
        title="故事时间线"
        description="把每一个重要时刻，放回它在故事中的位置。"
      >
        <button
          className="button button-primary button-small"
          onClick={() => setEditing({})}
        >
          <Plus size={15} />
          新增事件
        </button>
      </PageHeading>
      <div className="timeline-summary panel">
        <CalendarDays size={23} strokeWidth={1.4} />
        <div>
          <strong>{novel.timeline.length} 个故事节点</strong>
          <span>从世界的过去，到角色尚未抵达的未来。</span>
        </div>
        <Badge>按记录顺序展示</Badge>
      </div>
      <div
        className="content-tabs timeline-tabs"
        role="group"
        aria-label="事件类型"
      >
        {["全部事件", ...kinds].map((kind) => (
          <button
            key={kind}
            className={filter === kind ? "selected" : ""}
            aria-pressed={filter === kind}
            onClick={() => setFilter(kind)}
          >
            {kind}
          </button>
        ))}
      </div>
      <div className="timeline-list">
        {events.map((event) => (
          <article
            key={event.id}
            className={`timeline-event ${event.kind === "计划事件" ? "planned" : ""}`}
          >
            <div className="timeline-dot" />
            <span className="timeline-time">{event.time}</span>
            <div className="timeline-event-card panel">
              <div>
                <Badge
                  tone={
                    event.kind === "正文事件"
                      ? "gold"
                      : event.kind === "计划事件"
                        ? "neutral"
                        : "green"
                  }
                >
                  {event.kind}
                </Badge>
                <button
                  className="icon-button"
                  onClick={() => setEditing(event)}
                  aria-label={`编辑事件 ${event.title}`}
                >
                  <Pencil size={14} />
                </button>
              </div>
              <h3>{event.title}</h3>
              <p>{event.description || "暂无事件描述。"}</p>
              <span className="record-source">
                <BookOpen size={12} />
                {event.sourceChapterId
                  ? `关联第 ${novel.chapters.find((chapter) => chapter.id === event.sourceChapterId)?.number || "—"} 章`
                  : "背景与规划 · 手动记录"}
              </span>
            </div>
          </article>
        ))}
      </div>
      {!events.length && (
        <EmptyState
          icon={History}
          title="这一刻，等待被记录"
          description={
            filter === "全部事件"
              ? "从故事开端记录第一个重要事件。"
              : "当前分类还没有事件，试试其他分类。"
          }
        >
          <button
            className="button button-ghost"
            onClick={() => setEditing({})}
          >
            <Plus size={15} />
            记录事件
          </button>
        </EmptyState>
      )}
      <div className="memory-notice">
        <History size={15} />
        <p>
          故事时间可以使用自定义历法。当前按记录顺序展示，未来将从章节自动提取事件并追踪时间一致性。
        </p>
      </div>
      {editing && (
        <RecordForm
          title={editing.id ? "编辑故事事件" : "新增故事事件"}
          fields={fields}
          record={editing}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

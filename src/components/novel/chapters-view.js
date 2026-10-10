"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Plus, FileText, BookOpen, Check } from "lucide-react";
import { useNovel } from "./novel-context";
import { PageHeading, EmptyState } from "@/components/ui";
import { RecordForm } from "./record-form";
import { ChapterEditor } from "./chapter-editor";
import { countWords } from "@/lib/domain/novel";

export function ChaptersView() {
  const { novel, update } = useNovel();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState(
    () => searchParams.get("chapter") || novel.chapters[0]?.id,
  );
  const [adding, setAdding] = useState(false);
  const [dirty, setDirty] = useState(false);
  const selected =
    novel.chapters.find((chapter) => chapter.id === selectedId) ||
    novel.chapters[0];
  function mayLeave() {
    if (!dirty) return true;
    if (!window.confirm("章节有未完成操作、未同步的修改或未确认的 AI 预览，确定切换吗？"))
      return false;
    return true;
  }
  function select(id) {
    if (id === selected?.id || !mayLeave()) return;
    setDirty(false);
    setSelectedId(id);
  }
  async function addChapter(values) {
    const chapter = {
      id: crypto.randomUUID(),
      number: Math.max(0, ...novel.chapters.map((item) => item.number)) + 1,
      title: values.title,
      outline: values.outline,
      volumeId: novel.outline.volumes[0]?.id || null,
      body: "",
      summary: "",
      status: "待创作",
      revision: 0,
      updatedAt: new Date().toISOString(),
    };
    await update((previous) => ({
      ...previous,
      chapters: [...previous.chapters, chapter],
    }));
    setSelectedId(chapter.id);
    setDirty(false);
  }
  return (
    <>
      <PageHeading
        eyebrow="WHERE THE STORY COMES ALIVE"
        title="章节管理"
        description="让每一次落笔，都成为故事向前的一步。"
      >
        <button
          className="button button-ghost button-small"
          onClick={() => {
            if (mayLeave()) setAdding(true);
          }}
        >
          <Plus size={15} />
          新增章节
        </button>
      </PageHeading>
      {novel.chapters.length ? (
        <div className="chapters-workbench panel">
          <aside className="chapter-list">
            <div className="chapter-list-heading">
              <BookOpen size={14} />
              <span>全部章节</span>
              <small>{novel.chapters.length}</small>
            </div>
            <nav aria-label="章节列表">
              {novel.chapters.map((chapter) => (
                <button
                  key={chapter.id}
                  onClick={() => select(chapter.id)}
                  className={selected?.id === chapter.id ? "selected" : ""}
                  aria-current={
                    selected?.id === chapter.id ? "true" : undefined
                  }
                >
                  <span className="chapter-list-number">
                    {String(chapter.number).padStart(2, "0")}
                  </span>
                  <span>
                    <strong>{chapter.title}</strong>
                    <small>
                      {chapter.body
                        ? `${countWords(chapter.body)} 字 · ${chapter.status || "草稿"}`
                        : "待创作"}
                    </small>
                  </span>
                  {chapter.body && <Check size={12} />}
                </button>
              ))}
            </nav>
            <button
              className="chapter-add-button"
              onClick={() => {
                if (mayLeave()) setAdding(true);
              }}
            >
              <Plus size={14} />
              新增章节
            </button>
          </aside>
          <ChapterEditor
            key={selected.id}
            chapter={selected}
            onDirtyChange={setDirty}
          />
        </div>
      ) : (
        <EmptyState
          icon={FileText}
          title="你的第一章，即将开始"
          description="先创建章节，写下大纲；也可以直接把脑海中的第一幕记录下来。"
        >
          <button
            className="button button-primary"
            onClick={() => setAdding(true)}
          >
            <Plus size={16} />
            创建第一章
          </button>
        </EmptyState>
      )}
      {adding && (
        <RecordForm
          title="新增章节"
          fields={[
            { key: "title", label: "章节标题", required: true, maxLength: 100 },
            { key: "outline", label: "本章大纲", type: "textarea", rows: 5 },
          ]}
          onSave={addChapter}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

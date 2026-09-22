"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Plus,
  Pencil,
  Network,
  BookOpen,
  ArrowUpRight,
  ChevronDown,
  Layers3,
} from "lucide-react";
import { useNovel } from "./novel-context";
import { PageHeading, Badge, AiButton, EmptyState } from "@/components/ui";
import { RecordForm } from "./record-form";

export function OutlineView() {
  const { novel, update } = useNovel();
  const [tab, setTab] = useState("小说总纲");
  const [editing, setEditing] = useState(null);
  const [expanded, setExpanded] = useState(novel.outline.volumes[0]?.id);
  function save(values) {
    return update((previous) => {
      if (editing.kind === "master")
        return {
          ...previous,
          outline: { ...previous.outline, master: values.master },
        };
      const record = {
        ...editing.record,
        ...values,
        id: editing.record?.id || crypto.randomUUID(),
        status: editing.record?.status || "规划中",
        beats: values.beatsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      };
      delete record.beatsText;
      return {
        ...previous,
        outline: {
          ...previous.outline,
          volumes: editing.record
            ? previous.outline.volumes.map((volume) =>
                volume.id === record.id ? record : volume,
              )
            : [...previous.outline.volumes, record],
        },
      };
    });
  }
  return (
    <>
      <PageHeading
        eyebrow="STORY ARCHITECTURE"
        title="小说大纲"
        description="从全书主线到每章细节，为灵感铺好前行的路。"
      >
        <AiButton className="button button-primary button-small">
          AI 生成大纲
        </AiButton>
      </PageHeading>
      <div className="outline-flow panel">
        <span>
          <Network size={16} />
          小说总纲
        </span>
        <i />
        <span>
          <Layers3 size={16} />
          分卷大纲
        </span>
        <i />
        <span>
          <BookOpen size={16} />
          章节大纲
        </span>
      </div>
      <div className="content-tabs" role="group" aria-label="大纲层级">
        {["小说总纲", "分卷大纲", "章节大纲"].map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={tab === item ? "selected" : ""}
            aria-pressed={tab === item}
          >
            {item}
            {item === "分卷大纲" && <span>{novel.outline.volumes.length}</span>}
          </button>
        ))}
      </div>
      {tab === "小说总纲" && (
        <div className="outline-master panel">
          <div className="section-heading">
            <h2>
              <Network size={18} />
              故事总纲
            </h2>
            <button
              className="text-link"
              onClick={() => setEditing({ kind: "master" })}
            >
              <Pencil size={14} />
              编辑
            </button>
          </div>
          {novel.outline.master ? (
            <div className="prose-text">{novel.outline.master}</div>
          ) : (
            <EmptyState
              icon={Network}
              title="先为故事画一张地图"
              description="写下故事的起点、转折与终点，逐步构建小说总纲。"
            >
              <button
                className="button button-ghost"
                onClick={() => setEditing({ kind: "master" })}
              >
                <Pencil size={15} />
                编写总纲
              </button>
            </EmptyState>
          )}
          <div className="outline-summary">
            <span>
              预计篇幅
              <strong>
                {(novel.targetWords / 10000).toLocaleString("zh-CN")} 万字
              </strong>
            </span>
            <span>
              计划章节<strong>{novel.targetChapters} 章</strong>
            </span>
            <span>
              分卷规划<strong>{novel.outline.volumes.length} 卷</strong>
            </span>
          </div>
        </div>
      )}
      {tab === "分卷大纲" && (
        <div className="volume-list">
          {novel.outline.volumes.map((volume, index) => (
            <section className="volume-card panel" key={volume.id}>
              <button
                className="volume-heading"
                onClick={() =>
                  setExpanded(expanded === volume.id ? null : volume.id)
                }
                aria-expanded={expanded === volume.id}
              >
                <span className="volume-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <strong>{volume.title}</strong>
                  <small>{volume.range}</small>
                </span>
                <Badge tone={volume.status === "创作中" ? "green" : "neutral"}>
                  {volume.status}
                </Badge>
                <ChevronDown
                  size={17}
                  className={expanded === volume.id ? "rotated" : ""}
                />
              </button>
              {expanded === volume.id && (
                <div className="volume-details">
                  <p>{volume.summary}</p>
                  <h4>关键剧情节点</h4>
                  <ol>
                    {volume.beats.map((beat, beatIndex) => (
                      <li key={beatIndex}>{beat}</li>
                    ))}
                  </ol>
                  <button
                    className="text-link"
                    onClick={() =>
                      setEditing({ kind: "volume", record: volume })
                    }
                  >
                    <Pencil size={13} />
                    编辑分卷
                  </button>
                </div>
              )}
            </section>
          ))}
          <button
            className="add-dashed"
            onClick={() => setEditing({ kind: "volume" })}
          >
            <Plus size={17} />
            新增分卷
          </button>
        </div>
      )}
      {tab === "章节大纲" && (
        <div className="chapter-outline-list">
          {novel.chapters.length ? (
            novel.chapters.map((chapter) => (
              <Link
                className="panel chapter-outline-card"
                key={chapter.id}
                href={`/novel/${novel.id}/chapters?chapter=${chapter.id}`}
              >
                <div>
                  <span className="chapter-number">
                    {String(chapter.number).padStart(2, "0")}
                  </span>
                  <h3>{chapter.title}</h3>
                  <Badge>{chapter.status}</Badge>
                  <ArrowUpRight size={16} />
                </div>
                <p>{chapter.outline || "这一章的大纲尚未写下。"}</p>
              </Link>
            ))
          ) : (
            <EmptyState
              title="章节大纲等待展开"
              description="先进入章节管理，创建第一章并写下本章计划。"
            >
              <Link
                className="button button-ghost"
                href={`/novel/${novel.id}/chapters`}
              >
                前往章节管理 <ArrowUpRight size={15} />
              </Link>
            </EmptyState>
          )}
        </div>
      )}
      {editing && (
        <RecordForm
          title={
            editing.kind === "master"
              ? "编辑小说总纲"
              : editing.record
                ? "编辑分卷"
                : "新增分卷"
          }
          record={
            editing.kind === "master"
              ? { master: novel.outline.master }
              : {
                  ...editing.record,
                  beatsText: editing.record?.beats.join("\n") || "",
                }
          }
          fields={
            editing.kind === "master"
              ? [
                  {
                    key: "master",
                    label: "小说总纲",
                    type: "textarea",
                    rows: 12,
                    required: true,
                    maxLength: 30000,
                  },
                ]
              : [
                  { key: "title", label: "分卷名称", required: true },
                  {
                    key: "range",
                    label: "计划章节范围",
                    placeholder: "例如：第 1–40 章",
                  },
                  { key: "summary", label: "本卷故事", type: "textarea" },
                  {
                    key: "beatsText",
                    label: "关键剧情节点",
                    type: "textarea",
                    hint: "每行一个剧情节点。",
                  },
                ]
          }
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

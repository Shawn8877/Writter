"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Pencil,
  BookOpen,
  Feather,
  Users,
  Layers3,
  Target,
  Route,
  Flame,
  Heart,
  Shield,
  Sparkles,
  Database,
  Globe2,
} from "lucide-react";
import { useNovel } from "./novel-context";
import { PageHeading, Badge, AiButton } from "@/components/ui";
import {
  MEMORY_MODULES,
  formatNumber,
  novelWordCount,
} from "@/lib/domain/novel";
import { RecordForm } from "./record-form";
import { BibleDetails } from "./bible-details";

const bibleFields = [
  { key: "synopsis", label: "小说简介", type: "textarea" },
  { key: "conflict", label: "核心冲突", type: "textarea" },
  { key: "storyline", label: "故事主线", type: "textarea" },
  { key: "antagonist", label: "主要反派", type: "textarea" },
  { key: "romance", label: "感情线", type: "textarea" },
  { key: "corePremise", label: "核心设定", type: "textarea" },
  { key: "storyTone", label: "故事基调", type: "textarea" },
  { key: "writingStyle", label: "写作风格", type: "textarea" },
  { key: "protagonistArc", label: "主角成长", type: "textarea" },
  { key: "powerSystem", label: "能力体系", type: "textarea" },
  { key: "endingDirection", label: "结局方向", type: "textarea" },
];

export function OverviewView() {
  const { novel, update } = useNovel();
  const [editing, setEditing] = useState(null);
  const base = `/novel/${novel.id}`;
  const chapter = novel.chapters.find((item) => item.body) || novel.chapters[0];
  const stats = [
    [Feather, "累计字数", formatNumber(novelWordCount(novel)), "字"],
    [BookOpen, "章节", novel.chapters.length, "章"],
    [Users, "故事人物", novel.characters.length, "位"],
    [Layers3, "计划分卷", novel.outline.volumes.length, "卷"],
  ];
  function memoryCount(key) {
    if (key === "bible")
      return Object.entries(novel.bible).filter(([key, value]) => key !== "id" && (Array.isArray(value) ? value.length > 0 : Boolean(value))).length;
    return (novel[key] || novel.memory[key] || []).length;
  }
  return (
    <>
      <PageHeading
        eyebrow="STORY OVERVIEW"
        title="作品概览"
        description="在这里，看见你的故事全貌。"
      >
        <button
          className="button button-small button-ghost"
          onClick={() => setEditing("novel")}
        >
          <Pencil size={14} />
          编辑作品
        </button>
      </PageHeading>
      <section className="novel-identity panel">
        <div className={`identity-cover cover-${novel.cover}`}>
          <span>NOVELAI</span>
          <strong>{novel.title}</strong>
          <BookOpen size={23} strokeWidth={1.2} />
        </div>
        <div className="identity-info">
          <div className="flex flex-wrap gap-2">
            <Badge tone="gold">{novel.genre}</Badge>
            <Badge>{novel.style}</Badge>
            <Badge tone="green">{novel.status}</Badge>
          </div>
          <h2>{novel.title}</h2>
          <p>{novel.idea}</p>
          <div className="identity-target">
            <Target size={13} />
            目标 {formatNumber(novel.targetWords)} 字<span>·</span>
            {novel.targetChapters} 章<span>·</span>每章{" "}
            {formatNumber(novel.wordsPerChapter)} 字
          </div>
        </div>
      </section>
      <div className="overview-stats">
        {stats.map(([Icon, label, value, unit]) => (
          <div key={label}>
            <span>
              <Icon size={15} />
              {label}
            </span>
            <strong>
              {value}
              <small>{unit}</small>
            </strong>
          </div>
        ))}
      </div>
      <Link href={`${base}/chapters`} className="continue-writing">
        <div className="continue-icon">
          <Feather size={23} strokeWidth={1.5} />
        </div>
        <div>
          <span>{chapter ? "回到你的故事" : "故事，从第一章开始"}</span>
          <h3>
            {chapter
              ? `第 ${chapter.number} 章 · ${chapter.title}`
              : "准备好写下第一段了吗？"}
          </h3>
        </div>
        <span className="continue-link">
          {chapter ? "继续创作" : "进入章节"}
          <ArrowRight size={17} />
        </span>
      </Link>
      <div className="section-heading">
        <h2>
          <Sparkles size={18} />
          小说核心设定 <span>Novel Bible</span>
        </h2>
        <button className="text-link" onClick={() => setEditing("bible")}>
          编辑设定 <Pencil size={13} />
        </button>
      </div>
      <section className="bible-grid">
        <div className="panel bible-card full-width">
          <div className="bible-card-label">
            <BookOpen size={16} />
            小说简介
          </div>
          <p>
            {novel.bible.synopsis ||
              "还没有小说简介。把创意中的悬念与主角的目标写下来，让读者走进你的故事。"}
          </p>
        </div>
        {[
          [Flame, "核心冲突", novel.bible.conflict],
          [Route, "故事主线", novel.bible.storyline],
          [Shield, "主要反派", novel.bible.antagonist],
          [Heart, "感情线", novel.bible.romance],
        ].map(([Icon, label, content]) => (
          <div className="panel bible-card" key={label}>
            <div className="bible-card-label">
              <Icon size={16} />
              {label}
            </div>
            <p className={!content ? "placeholder-text" : ""}>
              {content || "尚未设定，等待你的下一个灵感。"}
            </p>
          </div>
        ))}
      </section>
      <BibleDetails bible={novel.bible} metadata={novel.builderMetadata} />
      <div className="story-shortcuts">
        <Link href={`${base}/characters`}>
          <Users size={17} />
          <span>
            <strong>主角与重要人物</strong>
            <small>{novel.protagonist || "为这个世界写下第一个人物。"}</small>
          </span>
          <ArrowRight size={15} />
        </Link>
        <Link href={`${base}/world`}>
          <Globe2 size={17} />
          <span>
            <strong>世界观与能力体系</strong>
            <small>
              {novel.world.length} 条世界设定 · {novel.memory.abilities.length}{" "}
              项能力
            </small>
          </span>
          <ArrowRight size={15} />
        </Link>
      </div>
      <div className="section-heading">
        <h2>
          <Database size={18} />
          小说记忆 <span>Story Memory</span>
        </h2>
        <Badge>手动维护</Badge>
      </div>
      <div className="memory-module-grid">
        {MEMORY_MODULES.map((module) => (
          <div key={module.key}>
            <strong>{memoryCount(module.key)}</strong>
            <span>{module.name}</span>
            <small>{module.en}</small>
          </div>
        ))}
      </div>
      <div className="memory-notice">
        <Sparkles size={15} />
        <p>
          人物、伏笔与章节摘要将为后续章节提供上下文。当前记忆由你手动维护，AI
          自动提取将在后续阶段接入。
        </p>
      </div>
      <div className="overview-ai-action">
        <AiButton>AI 完善小说设定</AiButton>
      </div>
      {editing && (
        <RecordForm
          title={editing === "bible" ? "编辑小说核心设定" : "编辑作品信息"}
          record={editing === "bible" ? novel.bible : novel}
          fields={
            editing === "bible"
              ? bibleFields
              : [
                  {
                    key: "title",
                    label: "小说书名",
                    required: true,
                    maxLength: 80,
                  },
                  {
                    key: "idea",
                    label: "一句话创意",
                    type: "textarea",
                    required: true,
                    maxLength: 1200,
                  },
                  {
                    key: "protagonist",
                    label: "主角设定",
                    type: "textarea",
                    maxLength: 2000,
                  },
                ]
          }
          onSave={(values) =>
            update((previous) =>
              editing === "bible"
                ? { ...previous, bible: { ...previous.bible, ...values } }
                : { ...previous, ...values },
            )
          }
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

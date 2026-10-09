"use client";

import { useState } from "react";
import {
  Globe2,
  MapPin,
  Gem,
  Zap,
  Fingerprint,
  Plus,
  Pencil,
  BookOpen,
} from "lucide-react";
import { useNovel } from "./novel-context";
import { PageHeading, Badge, AiButton, EmptyState } from "@/components/ui";
import { RecordForm } from "./record-form";

const tabs = [
  { key: "world", label: "世界设定", icon: Globe2 },
  { key: "locations", label: "地点", icon: MapPin },
  { key: "items", label: "重要物品", icon: Gem },
  { key: "abilities", label: "能力体系", icon: Zap },
  { key: "foreshadowing", label: "伏笔", icon: Fingerprint },
];
export function WorldView() {
  const { novel, update } = useNovel();
  const [tab, setTab] = useState("world");
  const [editing, setEditing] = useState(null);
  const current = tabs.find((item) => item.key === tab);
  const records = tab === "world" ? novel.world : novel.memory[tab];
  const fields =
    tab === "world"
      ? [
          { key: "title", label: "设定名称", required: true },
          {
            key: "category",
            label: "设定分类",
            defaultValue: "世界规则",
            options: ["时代背景", "核心规则", "组织势力", "世界规则", "地点", "能力体系", "重要概念", "阵营", "重要物品", "其他"],
          },
          {
            key: "body",
            label: "设定内容",
            type: "textarea",
            rows: 6,
            required: true,
          },
        ]
      : [
          { key: "name", label: `${current.label}名称`, required: true },
          { key: "description", label: "详细描述", type: "textarea", rows: 5 },
          ...(tab === "foreshadowing"
            ? [
                {
                  key: "status",
                  label: "伏笔状态",
                  options: ["未回收", "已回收", "已失效"],
                  defaultValue: "未回收",
                },
                {
                  key: "resolution",
                  label: "回收记录",
                  type: "textarea",
                  rows: 3,
                  hint: "记录在哪一章、通过什么事件回收。",
                },
              ]
            : []),
        ];
  function save(values) {
    const record = {
      ...editing,
      ...values,
      id: editing.id || crypto.randomUUID(),
      sourceChapterId: editing.sourceChapterId || null,
      updatedAt: new Date().toISOString(),
    };
    const list = editing.id
      ? records.map((item) => (item.id === record.id ? record : item))
      : [...records, record];
    return update((previous) =>
      tab === "world"
        ? { ...previous, world: list }
        : { ...previous, memory: { ...previous.memory, [tab]: list } },
    );
  }
  const Icon = current.icon;
  return (
    <>
      <PageHeading
        eyebrow="WORLD BUILDING"
        title="世界观"
        description="为想象建立规则，让每一个细节都有所依循。"
      >
        <button
          className="button button-primary button-small"
          onClick={() => setEditing({})}
        >
          <Plus size={15} />
          新增{current.label}
        </button>
      </PageHeading>
      <div className="world-banner panel">
        <Globe2 size={42} strokeWidth={1} />
        <div>
          <span className="section-kicker">THE RULES OF YOUR WORLD</span>
          <h2>一个自洽的世界，容得下无限的故事。</h2>
          <p>时代、秩序、地点与力量，共同构成故事的底色。</p>
        </div>
      </div>
      <div
        className="content-tabs world-tabs"
        role="group"
        aria-label="世界观分类"
      >
        {tabs.map(({ key, label, icon: TabIcon }) => (
          <button
            key={key}
            className={tab === key ? "selected" : ""}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
          >
            <TabIcon size={14} />
            {label}
            <span>
              {(key === "world" ? novel.world : novel.memory[key]).length}
            </span>
          </button>
        ))}
      </div>
      <div className="world-records">
        {records.map((record) => (
          <article className="world-record panel" key={record.id}>
            <div className="world-record-icon">
              <Icon size={20} strokeWidth={1.5} />
            </div>
            <div className="world-record-body">
              <div className="world-record-heading">
                <h3>{record.title || record.name}</h3>
                {record.category && <Badge>{record.category}</Badge>}
                {record.status && (
                  <Badge tone={record.status === "已回收" ? "green" : record.status === "已失效" ? "neutral" : "gold"}>
                    {record.status}
                  </Badge>
                )}
                <button
                  className="icon-button"
                  onClick={() => setEditing(record)}
                  aria-label={`编辑${record.title || record.name}`}
                >
                  <Pencil size={14} />
                </button>
              </div>
              <p>{record.body || record.description || "暂无详细描述。"}</p>
              {record.resolution && (
                <p className="resolution-note">回收记录：{record.resolution}</p>
              )}
              <div className="record-source">
                <BookOpen size={12} />
                {record.sourceChapterId
                  ? `来源：第 ${novel.chapters.find((chapter) => chapter.id === record.sourceChapterId)?.number || "—"} 章`
                  : "故事设定 · 手动维护"}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!records.length && (
        <EmptyState
          icon={Icon}
          title={`还没有${current.label}`}
          description={`把重要的${current.label}记录下来，让后续创作有据可依。`}
        >
          <button
            className="button button-ghost"
            onClick={() => setEditing({})}
          >
            <Plus size={15} />
            添加{current.label}
          </button>
        </EmptyState>
      )}
      <div className="page-bottom-note">
        <AiButton className="button button-ghost button-small">
          AI 完善世界观
        </AiButton>
        <p>当前内容均为手动维护，AI 自动提取与一致性检查尚未接入。</p>
      </div>
      {editing && (
        <RecordForm
          title={`${editing.id ? "编辑" : "新增"}${current.label}`}
          fields={fields}
          record={editing}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

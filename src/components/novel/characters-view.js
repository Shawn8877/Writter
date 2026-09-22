"use client";

import { useState } from "react";
import { Plus, Search, Users, ArrowUpRight, UserRound } from "lucide-react";
import { useNovel } from "./novel-context";
import { PageHeading, Badge, AiButton, EmptyState } from "@/components/ui";
import { RecordForm } from "./record-form";

const fields = [
  { key: "name", label: "人物姓名", required: true, maxLength: 40 },
  {
    key: "role",
    label: "人物身份",
    options: ["主角", "女主角", "重要配角", "主要反派", "其他"],
    defaultValue: "重要配角",
  },
  { key: "age", label: "年龄", placeholder: "例如：19 岁" },
  { key: "description", label: "人物简介", type: "textarea" },
  { key: "traitsText", label: "性格标签", hint: "用中文或英文逗号分隔。" },
  { key: "motivation", label: "核心动机", type: "textarea", rows: 2 },
  { key: "state", label: "当前状态", type: "textarea", rows: 2 },
];
export function CharactersView() {
  const { novel, update } = useNovel();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const characters = novel.characters.filter((person) =>
    `${person.name}${person.role}${person.description}`.includes(query.trim()),
  );
  function save(values) {
    const person = {
      ...editing,
      ...values,
      id: editing.id || crypto.randomUUID(),
      initials: values.name.slice(-1),
      color: editing.color || "gold",
      traits: values.traitsText
        .split(/[,，]/)
        .map((trait) => trait.trim())
        .filter(Boolean),
      sourceChapterId: editing.sourceChapterId || null,
      updatedAt: new Date().toISOString(),
    };
    delete person.traitsText;
    return update((previous) => ({
      ...previous,
      characters: editing.id
        ? previous.characters.map((item) =>
            item.id === person.id ? person : item,
          )
        : [...previous.characters, person],
    }));
  }
  return (
    <>
      <PageHeading
        eyebrow="THE PEOPLE IN YOUR WORLD"
        title="人物管理"
        description="赋予每个人物，值得被记住的灵魂。"
      >
        <button
          className="button button-primary button-small"
          onClick={() => setEditing({})}
        >
          <Plus size={16} />
          新增人物
        </button>
      </PageHeading>
      <div className="page-toolbar">
        <div className="toolbar-count">
          <Users size={17} />
          全部人物 <span>{novel.characters.length}</span>
        </div>
        <div className="search-input">
          <Search size={15} />
          <input
            aria-label="搜索人物"
            value={query}
            placeholder="搜索人物姓名或身份…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <div className="character-grid">
        {characters.map((person) => (
          <button
            className="character-card panel"
            key={person.id}
            onClick={() => setEditing(person)}
            aria-label={`编辑人物 ${person.name}`}
          >
            <div className="character-card-top">
              <div className={`character-avatar avatar-${person.color}`}>
                {person.initials}
              </div>
              <div>
                <h3>{person.name}</h3>
                <span>{person.age || "年龄未设定"}</span>
              </div>
              <ArrowUpRight size={16} />
            </div>
            <Badge
              tone={
                person.role === "主角"
                  ? "gold"
                  : person.role === "主要反派"
                    ? "rose"
                    : "neutral"
              }
            >
              {person.role}
            </Badge>
            <p>{person.description || "这个人物的故事，等待你来书写。"}</p>
            <div className="character-traits">
              {person.traits.map((trait, index) => (
                <span key={`${trait}-${index}`}>{trait}</span>
              ))}
            </div>
            <div className="character-state">
              <span>当前状态</span>
              <p>{person.state || "尚未记录"}</p>
            </div>
          </button>
        ))}
      </div>
      {characters.length === 0 && (
        <EmptyState
          icon={UserRound}
          title={query ? "没有找到这个人物" : "谁将走进你的故事？"}
          description={
            query
              ? "试试其他姓名或身份关键词。"
              : "从主角开始，记录身份、动机与当前状态。"
          }
        >
          {!query && (
            <button
              className="button button-ghost"
              onClick={() => setEditing({})}
            >
              <Plus size={16} />
              创建第一个人物
            </button>
          )}
        </EmptyState>
      )}
      <div className="page-bottom-note">
        <AiButton className="button button-ghost button-small">
          AI 设计人物
        </AiButton>
        <p>人物状态当前由你维护，后续将支持从章节中自动提取与更新。</p>
      </div>
      {editing && (
        <RecordForm
          title={editing.id ? `编辑人物 · ${editing.name}` : "新增人物"}
          fields={fields}
          record={{ ...editing, traitsText: editing.traits?.join("，") || "" }}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

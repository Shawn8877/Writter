"use client";

import { useState } from "react";
import {
  Sparkles,
  ArrowUp,
  BookOpen,
  Users,
  Globe2,
  ChevronRight,
  LockKeyhole,
  X,
} from "lucide-react";
import { useStudio } from "@/components/studio-provider";
import { useNovel } from "./novel-context";

export function AiAssistant({ onClose }) {
  const { novel } = useNovel();
  const { notify } = useStudio();
  const [prompt, setPrompt] = useState("");
  return (
    <aside className="ai-assistant" aria-label="AI 创作助手">
      <div className="assistant-heading">
        <span>
          <Sparkles size={17} />
          创作助手
        </span>
        <div>
          <span className="preview-label">预览</span>
          {onClose && (
            <button
              className="icon-button assistant-close"
              aria-label="关闭 AI 助手"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>
      <div className="assistant-body">
        <div className="assistant-welcome-icon">
          <Sparkles size={24} strokeWidth={1.4} />
        </div>
        <h3>
          每个好故事，
          <br />
          都值得被写完。
        </h3>
        <p>
          从此刻的灵感出发，
          <br />
          一起探索故事的更多可能。
        </p>
        <div className="assistant-quick-actions">
          {["帮我完善核心冲突", "设计一个意外转折", "梳理人物之间的关系"].map(
            (text) => (
              <button key={text} onClick={() => setPrompt(text)}>
                {text}
                <ChevronRight size={13} />
              </button>
            ),
          )}
        </div>
        <div className="assistant-context">
          <span className="section-kicker">当前故事上下文</span>
          {[
            [BookOpen, "核心设定", novel.bible.synopsis || novel.bible.corePremise || novel.bible.conflict ? "已建立" : "待完善"],
            [Users, "人物档案", `${novel.characters.length} 位人物`],
            [Globe2, "世界观", `${novel.world.length} 条设定`],
          ].map(([Icon, label, value]) => (
            <div key={label}>
              <Icon size={14} />
              <span>{label}</span>
              <small>{value}</small>
            </div>
          ))}
          <p>“生成本章”会读取已保存的设定与记忆，生成后请审阅确认。</p>
        </div>
      </div>
      <div className="assistant-composer">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            notify(
              "AI 助手尚未接入。你的指令尚未发送，当前不会调用任何 AI 服务。",
            );
          }}
        >
          <label className="sr-only" htmlFor="assistant-prompt">
            给 AI 的创作指令
          </label>
          <textarea
            id="assistant-prompt"
            rows={3}
            placeholder="描述你的想法，或想调整的剧情…"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={2000}
          />
          <div>
            <span>
              <Sparkles size={11} />
              AI 创作指令
            </span>
            <button
              type="submit"
              disabled={!prompt.trim()}
              aria-label="发送创作指令（功能预览）"
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </form>
        <p>
          <LockKeyhole size={11} />
          此助手为预览 · 不会发送这里的指令
        </p>
      </div>
    </aside>
  );
}

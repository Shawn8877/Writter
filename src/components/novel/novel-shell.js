"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  LayoutDashboard,
  Network,
  Users,
  Globe2,
  History,
  FileText,
  Sparkles,
  ChevronRight,
  HardDrive,
  Database,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { useStudio } from "@/components/studio-provider";
import { Badge, EmptyState, LoadingState } from "@/components/ui";
import { formatNumber, novelWordCount } from "@/lib/domain/novel";
import { NovelContext } from "./novel-context";
import { AiAssistant } from "./ai-assistant";
import { AuthControls } from "@/components/auth/auth-controls";

const navigation = [
  { path: "", label: "作品概览", icon: LayoutDashboard },
  { path: "/outline", label: "小说大纲", icon: Network },
  { path: "/characters", label: "人物管理", icon: Users },
  { path: "/world", label: "世界观", icon: Globe2 },
  { path: "/timeline", label: "时间线", icon: History },
  { path: "/chapters", label: "章节管理", icon: FileText },
  { path: "/memory", label: "记忆", icon: Database },
];

export function NovelShell({ id, children }) {
  const { novels, ready, updateNovel, storageError, refreshNovels, notify } = useStudio();
  const pathname = usePathname();
  const [assistantOpen, setAssistantOpen] = useState(false);
  if (!ready) return <LoadingState />;
  if (storageError) return <EmptyState title="暂时无法打开创作空间" description={storageError}><button className="button button-primary" onClick={() => refreshNovels().catch((error) => notify(error.message, "error"))}>重新加载</button></EmptyState>;
  const novel = novels.find((item) => item.id === id);
  if (!novel)
    return (
      <div className="missing-novel">
        <Brand />
        <EmptyState
          title="这个故事还未写下"
          description="小说可能已被删除，或当前账号没有访问权限。"
        >
          <Link className="button button-primary" href="/dashboard">
            返回我的作品 <ArrowLeft size={16} />
          </Link>
        </EmptyState>
      </div>
    );
  const words = novelWordCount(novel);
  const progress = Math.min(100, (words / novel.targetWords) * 100);
  const current = navigation.find(
    (item) => `/novel/${id}${item.path}` === pathname,
  );
  return (
    <NovelContext.Provider
      value={{ novel, update: (updater) => updateNovel(id, updater) }}
    >
      <div className="studio-shell">
        <aside className="studio-sidebar">
          <div className="sidebar-brand">
            <Brand compact />
          </div>
          <Link href="/dashboard" className="sidebar-back">
            <ArrowLeft size={14} />
            返回作品库
          </Link>
          <div className="sidebar-book">
            <div className={`book-mini cover-${novel.cover}`}>
              <BookOpen size={22} strokeWidth={1.3} />
            </div>
            <div>
              <h2>{novel.title}</h2>
              <span>
                {novel.genre} · {novel.style}
              </span>
            </div>
          </div>
          <span className="sidebar-section-label">创作空间</span>
          <nav aria-label="小说功能导航">
            {navigation.map(({ path, label, icon: Icon }) => (
              <Link
                key={path}
                href={`/novel/${id}${path}`}
                className={pathname === `/novel/${id}${path}` ? "active" : ""}
                aria-current={
                  pathname === `/novel/${id}${path}` ? "page" : undefined
                }
              >
                <Icon size={17} strokeWidth={1.7} />
                <span>{label}</span>
                {path === "/chapters" && <small>{novel.chapters.length}</small>}
              </Link>
            ))}
          </nav>
          <div className="sidebar-progress">
            <div>
              <span>创作进度</span>
              <span>{progress.toFixed(1)}%</span>
            </div>
            <div className="progress-track">
              <span style={{ width: `${progress}%` }} />
            </div>
            <strong>
              {formatNumber(words)}{" "}
              <small>/ {formatNumber(novel.targetWords)} 字</small>
            </strong>
            <p>每一页，都离你的世界更近一步。</p>
          </div>
          <div className="sidebar-bottom">
            <HardDrive size={15} />
            <div>
              云端创作空间
              <span>
                正式内容云端保存 · 本地保护草稿
              </span>
            </div>
          </div>
        </aside>
        <div className="workspace-main">
          <header className="workspace-topbar">
            <div className="breadcrumbs">
              <Link href="/dashboard">我的作品</Link>
              <ChevronRight size={13} />
              <span>{novel.title}</span>
              <ChevronRight size={13} />
              <span>{current?.label}</span>
            </div>
            <div className="workspace-top-actions">
              <Badge tone="green">
                云端作品
              </Badge>
              <AuthControls />
              <button
                className="assistant-toggle icon-button"
                onClick={() => setAssistantOpen(!assistantOpen)}
                aria-label="打开 AI 助手"
              >
                <Sparkles size={19} />
              </button>
            </div>
          </header>
          {storageError && (
            <div role="alert" className="storage-banner">
              {storageError}
            </div>
          )}
          <main className="workspace-content">{children}</main>
        </div>
        <div
          className={
            assistantOpen ? "assistant-wrapper is-open" : "assistant-wrapper"
          }
        >
          <AiAssistant onClose={() => setAssistantOpen(false)} />
        </div>
        {assistantOpen && (
          <button
            className="assistant-backdrop"
            aria-label="关闭 AI 助手"
            onClick={() => setAssistantOpen(false)}
          />
        )}
      </div>
    </NovelContext.Provider>
  );
}

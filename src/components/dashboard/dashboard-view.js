"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Plus,
  Search,
  BookOpen,
  Feather,
  Layers3,
  ArrowRight,
  Sparkles,
  HardDrive,
  Trash2,
} from "lucide-react";
import { useStudio } from "@/components/studio-provider";
import { EmptyState, LoadingState, PageHeading, Modal } from "@/components/ui";
import { LegacyImport } from "./legacy-import";
import { NovelCard } from "./novel-card";
import { formatNumber, novelWordCount } from "@/lib/domain/novel";

export function DashboardView() {
  const { novels, ready, storageError, refreshNovels, removeNovel, notify } = useStudio();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部作品");
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  async function confirmDelete() {
    if (busy || !deleting) return;
    setBusy(true);
    try { await removeNovel(deleting.id); setDeleting(null); notify("小说及其云端资料已删除。", "success"); }
    catch (error) { notify(error.message, "error"); }
    finally { setBusy(false); }
  }
  if (!ready) return <LoadingState />;
  const visible = novels.filter(
    (novel) =>
      (filter === "全部作品" ||
        (filter === "创作中" ? novel.statusCode !== "archived" && novel.statusCode !== "completed" : novel.statusCode === "archived")) &&
      `${novel.title} ${novel.genre} ${novel.idea}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const stats = [
    { icon: BookOpen, label: "小说作品", value: novels.length, unit: "部" },
    {
      icon: Feather,
      label: "累计创作",
      value: formatNumber(
        novels.reduce((sum, novel) => sum + novelWordCount(novel), 0),
      ),
      unit: "字",
    },
    {
      icon: Layers3,
      label: "已有章节",
      value: novels.reduce((sum, novel) => sum + novel.chapters.length, 0),
      unit: "章",
    },
  ];
  return (
    <main className="dashboard page-container">
      <PageHeading
        eyebrow="YOUR WRITING SPACE"
        title="每一个世界，都从这里生长。"
        description="拾起上次的灵感，或者开启一个全新的故事。"
      >
        <LegacyImport />
        <Link className="button button-primary" href="/create">
          <Plus size={17} />
          创建小说
        </Link>
      </PageHeading>
      {storageError && <div className="cloud-error panel" role="alert"><p>{storageError}</p><button className="button button-ghost button-small" onClick={() => refreshNovels().catch((error) => notify(error.message, "error"))}>重新加载</button></div>}
      <div className="dashboard-stats">
        {stats.map(({ icon: Icon, label, value, unit }) => (
          <div className="stat-item" key={label}>
            <span className="stat-icon">
              <Icon size={21} strokeWidth={1.4} />
            </span>
            <div>
              <span className="stat-label">{label}</span>
              <p>
                <strong>{value}</strong>
                <span>{unit}</span>
              </p>
            </div>
          </div>
        ))}
        <div className="stats-note">
          <Sparkles size={20} />
          <div>
            想象力没有字数上限<span>让每一天的灵感，都成为故事的一部分。</span>
          </div>
        </div>
      </div>
      <div className="library-toolbar">
        <div className="filter-tabs" role="group" aria-label="作品分类">
          {["全部作品", "创作中", "已归档"].map((name) => (
            <button
              key={name}
              aria-pressed={filter === name}
              className={filter === name ? "selected" : ""}
              onClick={() => setFilter(name)}
            >
              {name}
              {name === "全部作品" && <span>{novels.length}</span>}
            </button>
          ))}
        </div>
        <div className="search-input">
          <Search size={16} />
          <input
            aria-label="搜索作品"
            placeholder="搜索书名、题材或灵感…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <div className="novels-grid">
        {visible.map((novel) => (
          <div className="novel-card-container" key={novel.id}><NovelCard novel={novel} /><button className="icon-button novel-card-delete" onClick={() => setDeleting(novel)} aria-label={`删除小说 ${novel.title}`}><Trash2 size={14} /></button></div>
        ))}
        {!query && filter !== "已归档" && (
          <Link href="/create" className="new-novel-card">
            <span className="new-novel-icon">
              <Plus size={25} strokeWidth={1.3} />
            </span>
            <h3>下一个世界，等你落笔</h3>
            <p>从一个小小的想法开始</p>
            <span className="text-link">
              创建新小说 <ArrowRight size={15} />
            </span>
          </Link>
        )}
      </div>
      {visible.length === 0 && (query || filter === "已归档") && (
        <EmptyState
          title="还没有找到这个故事"
          description="试试其他关键词，或开始创作你的第一部小说。"
        />
      )}
      <div className="local-note">
        <HardDrive size={14} />
        <span>
          作品保存在当前账号的云端空间，未保存正文由本地草稿保护。AI 功能仍未接入。
        </span>
      </div>
      {deleting && <Modal title={`删除《${deleting.title}》？`} onClose={() => { if (!busy) setDeleting(null); }}><p className="migration-notice">这将删除小说及其章节、历史版本、人物、世界观和记忆。此操作无法撤销，其他作品不受影响。</p><div className="modal-actions"><button className="button button-ghost" onClick={() => setDeleting(null)} disabled={busy}>保留作品</button><button className="button button-danger" onClick={confirmDelete} disabled={busy}>{busy ? "正在删除…" : "确认删除小说"}</button></div></Modal>}
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import { History, LoaderCircle } from "lucide-react";
import { Modal } from "@/components/ui";
import { formatNumber } from "@/lib/domain/novel";
import { cloudChapterRepository } from "@/lib/repositories/cloud-chapter-repository";

const SOURCE_LABELS = {
  manual: "手动保存", ai_generated: "AI 生成", ai_regenerated: "AI 重新生成",
  ai_expanded: "AI 扩写", ai_polished: "AI 润色", ai_rewritten: "AI 改写",
};

export function ChapterVersions({ novelId, chapterId, onClose }) {
  const [versions, setVersions] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    cloudChapterRepository.versions(novelId, chapterId)
      .then((items) => {
        if (cancelled) return;
        setVersions(items);
        setSelectedId(items[0]?.id || null);
        setError("");
      })
      .catch((reason) => {
        if (!cancelled) setError(reason.message || "版本记录暂时无法加载。");
      });
    return () => { cancelled = true; };
  }, [novelId, chapterId, attempt]);
  const selected = versions?.find((version) => version.id === selectedId);
  return (
    <Modal title="版本记录" onClose={onClose}>
      <p className="field-hint">自动保存不创建版本。点击“保存版本”会保留一份正文快照；历史版本仅供查看。</p>
      {error ? <div className="chapter-save-alert" role="alert">
        <p>{error}</p>
        <button className="button button-ghost button-small" onClick={() => { setError(""); setVersions(null); setAttempt((value) => value + 1); }}>重新加载</button>
      </div> : versions === null ? <p className="chapter-version-loading" role="status"><LoaderCircle className="loading-spinner" size={16} />正在加载版本…</p>
        : !versions.length ? <div className="chapter-versions-empty"><History size={25} /><p>还没有保存过历史版本。</p></div>
          : <div className="chapter-versions">
            <div className="chapter-version-list" role="group" aria-label="历史版本">
              {versions.map((version) => <button key={version.id}
                className={selectedId === version.id ? "selected" : ""}
                aria-pressed={selectedId === version.id} onClick={() => setSelectedId(version.id)}>
                <strong>{new Date(version.createdAt).toLocaleString("zh-CN")}</strong>
                <span>{SOURCE_LABELS[version.source] || version.source} · {formatNumber(version.wordCount)} 字</span>
              </button>)}
            </div>
            {selected && <div className="chapter-version-preview">
              <h3>历史正文</h3>
              <p>{SOURCE_LABELS[selected.source] || selected.source} · {new Date(selected.createdAt).toLocaleString("zh-CN")}</p>
              <div className="chapter-version-body" tabIndex={0}>{selected.content || "这个版本尚无正文。"}</div>
            </div>}
          </div>}
    </Modal>
  );
}

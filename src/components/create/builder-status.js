"use client";
import { useEffect, useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";

const messages = ["准备中…", "正在构建故事世界…", "正在设计人物…", "正在规划长篇故事…"];
export function BuilderStatus() {
  const [step, setStep] = useState(0);
  useEffect(() => { const timer = setInterval(() => setStep((value) => Math.min(value + 1, messages.length - 1)), 9000); return () => clearInterval(timer); }, []);
  return <div className="builder-status panel" role="status" aria-live="polite">
    <Sparkles size={26} /><h2><LoaderCircle size={20} className="loading-spinner" />{messages[step]}</h2>
    <p>正在等待 AI 返回完整方案，通常需要几分钟。完成后可以先预览、修改，再决定是否保存。</p>
    <small>以上文字是单次构建请求的等待提示，不代表各步骤已独立完成。请保持页面打开。</small>
  </div>;
}
export function BuilderError({ error }) {
  if (!error) return null;
  return <div className="builder-error" role="alert"><strong>本次操作未完成</strong><p>{error.message}</p>{error.requestId && <small>问题编号：{error.requestId}</small>}</div>;
}

"use client";

import { useEffect, useRef } from "react";
import { BookOpen, Sparkles, X, LoaderCircle } from "lucide-react";
import { useStudio } from "./studio-provider";

export function AiButton({
  children,
  className = "button button-ghost",
  icon: Icon = Sparkles,
}) {
  const { notify } = useStudio();
  return (
    <button
      type="button"
      className={className}
      onClick={() =>
        notify(
          `「${typeof children === "string" ? children : "AI 创作"}」尚未接入 AI。当前仅预览操作入口，不会生成或改写内容。`,
        )
      }
    >
      <Icon size={16} />
      {children}
    </button>
  );
}

export function LoadingState() {
  return (
    <div className="empty-state" role="status">
      <LoaderCircle size={24} className="loading-spinner" />
      <p>正在打开创作空间…</p>
    </div>
  );
}
export function EmptyState({
  icon: Icon = BookOpen,
  title,
  description,
  children,
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={29} strokeWidth={1.3} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function PageHeading({ eyebrow, title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="section-kicker">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  );
}
export function Badge({ children, tone = "neutral" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Field({ label, hint, error, htmlFor, children }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Modal({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <h2 id="modal-title">{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="关闭弹窗"
          >
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

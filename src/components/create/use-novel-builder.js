"use client";

import { useEffect, useRef, useState } from "react";

export function useNovelBuilder() {
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const pending = useRef(false);
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!preview || savedId) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [preview, savedId]);

  async function request(url, body, timeout) {
    const abort = new AbortController(); controller.current = abort;
    const timer = setTimeout(() => abort.abort(), timeout);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: abort.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(result.error || "请求未完成，请稍后重试。");
        error.requestId = result.requestId; error.code = result.code; throw error;
      }
      return result;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("等待超时。请求可能仍在处理，请稍后重试；确认保存可安全重试。");
      if (error instanceof TypeError) throw new Error("网络连接中断。请保留当前页面，恢复网络后重试。");
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function generate(input) {
    if (pending.current || savedId) return;
    pending.current = true; setStatus("generating"); setError(null);
    try {
      const result = await request("/api/ai/novels/build", { requestId: crypto.randomUUID(), input }, 290000);
      setPreview(result); setStatus("preview");
    } catch (error) { setError({ message: error.message, requestId: error.requestId }); setStatus(preview ? "preview" : "failed"); }
    finally { pending.current = false; }
  }
  async function confirm() {
    if (pending.current || !preview || savedId) return null;
    pending.current = true; setStatus("confirming"); setError(null);
    try {
      const { novelId } = await request("/api/novels/ai-confirm", { generationId: preview.generationId, input: preview.input, plan: preview.plan }, 60000);
      setSavedId(novelId); setStatus("saved"); return novelId;
    } catch (error) { setError({ message: error.message, requestId: error.requestId }); setStatus("preview"); return null; }
    finally { pending.current = false; }
  }
  function edit(key, value) { if (!pending.current && !savedId) setPreview((previous) => ({ ...previous, plan: { ...previous.plan, [key]: value } })); }
  function cancel() { if (!pending.current) { setPreview(null); setError(null); setStatus("idle"); } }
  return { preview, status, error, savedId, busy: status === "generating" || status === "confirming", generate, confirm, edit, cancel };
}

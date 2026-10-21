"use client";

import { useCallback, useEffect, useState } from "react";
import { chapterReviewRepository as api } from "@/lib/repositories/chapter-review-repository";

const labels = { passed: "通过", needs_review: "需要人工审阅", critical: "严重问题", running: "审核中", failed: "审核失败", stale: "正文或设定已变化" };
const severities = { critical: "严重", high: "高", medium: "中", low: "低", info: "提示" };
const sources = { chapter: "本章正文", bible: "核心设定", outline: "本章大纲", previous_chapter: "上一章", previous_summary: "上一章摘要", recent_summary: "近期章节摘要", character: "人物资料", world: "世界资料", memory: "小说记忆", foreshadowing: "伏笔", timeline: "时间线" };
const metrics = { characterConsistency: "人物一致性", worldConsistency: "世界观", abilityConsistency: "能力规则", timelineConsistency: "时间线", relationshipConsistency: "人物关系", foreshadowing: "伏笔", outlineExecution: "大纲执行", plotProgression: "剧情推进", repetitionRisk: "重复风险", fillerRisk: "水文风险", transitionQuality: "上一章衔接", bibleConsistency: "核心设定", memoryConsistency: "记忆事实" };

export function ChapterReviewPanel({ novelId, chapterId, hasContent, dirty }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("all");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reload = useCallback(async () => { if (hasContent) {
    const value = await api.list(novelId, chapterId);
    setData(value);
    if (pending && value.reviews?.[0]?.id !== pending && value.reviews?.[0]?.status !== "running") setPending(false);
  } }, [novelId, chapterId, hasContent, pending]);
  useEffect(() => { let mounted = true; api.list(novelId, chapterId).then((value) => { if (mounted) setData(value); }).catch((problem) => { if (mounted) setError(problem.message); });
    return () => { mounted = false; }; }, [novelId, chapterId]);
  useEffect(() => { if (!hasContent) return; const timer = setInterval(() => { void reload().catch(() => {}); }, pending || data?.reviews?.[0]?.status === "running" ? 3000 : 12000);
    return () => clearInterval(timer); }, [hasContent, pending, data?.reviews, reload]);
  const reviews = data?.reviews || [];
  const review = reviews.find((item) => item.id === selected) || reviews[0];
  const findings = (review?.result_json?.findings || []).filter((item) => filter === "all" || item.severity === filter);

  async function start() {
    if (busy || dirty || !hasContent) return;
    setBusy(true); setError("");
    try { await api.review(novelId, chapterId); setSelected(null); setPending(reviews[0]?.id || "none"); } catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }
  async function decide(index, decision) {
    setBusy(true); setError("");
    try { await api.decide(review.id, index, decision); await reload(); } catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }
  return <section className="panel mt-5 p-5" aria-label="AI 编辑审核">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs tracking-[0.2em] text-amber-300/70">AI EDITOR</p><h3 className="mt-1 text-lg font-semibold text-white">AI 编辑审核</h3></div>
      <button type="button" className="button button-ghost button-small" disabled={!hasContent || dirty || busy || pending} onClick={start}>{busy ? "提交中…" : reviews.length ? "重新审核" : "审核本章"}</button></div>
    <p className="mt-2 text-sm text-slate-400">审核只给出证据和建议，不会修改正文或小说设定。重新审核会产生一次模型调用并保留旧记录。</p>
    {dirty && <p className="field-hint mt-2">请先等待正文保存，再审核当前版本。</p>}
    {pending && <p className="field-hint mt-2" role="status">审核已提交，正在等待结果…</p>}
    {error && <p className="field-error mt-2" role="alert">{error}</p>}
    {!review && hasContent && <p className="mt-3 text-sm text-slate-400">尚无审核记录。</p>}
    {review && <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-baseline gap-3"><strong className="text-2xl text-white">{review.overall_score ?? "—"}<span className="text-sm text-slate-400"> / 100</span></strong>
        <span className={review.status === "critical" ? "text-rose-300" : review.status === "passed" ? "text-emerald-300" : "text-amber-300"}>{labels[review.status] || review.status}</span>
        {!review.currentContent && <span className="text-xs text-amber-300">对应旧正文版本</span>}</div>
      {review.status === "critical" && <p className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">存在严重一致性问题，请人工审阅。正文仍已保存。</p>}
      {review.status === "failed" && <p className="field-error">正文已保存，AI 编辑审核暂时失败。可重新审核。</p>}
      {review.summary && <p className="text-sm text-slate-200">{review.summary}</p>}
      {review.result_json && <><div className="grid gap-2 sm:grid-cols-2">{Object.entries(metrics).map(([key, label]) => <div key={key} className="rounded-xl border border-white/10 p-2 text-xs text-slate-300"><strong>{label} · {review.result_json[key]?.score ?? "—"}</strong><p className="mt-1 text-slate-400">{review.result_json[key]?.assessment}</p></div>)}</div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="问题等级筛选">{[["all","全部"],["critical","Critical"],["high","High"],["medium","Medium"],["low","Low"]].map(([value,label]) => <button key={value} type="button" className={`button button-small ${filter === value ? "button-primary" : "button-ghost"}`} onClick={() => setFilter(value)}>{label}</button>)}</div>
        {findings.length ? findings.map((finding) => { const index = review.result_json.findings.indexOf(finding); const decision = review.result_json.authorDecisions?.[String(index)]; return <article key={index} className="rounded-xl border border-white/10 p-3 text-sm text-slate-300">
          <p><strong className={finding.severity === "critical" || finding.severity === "high" ? "text-rose-300" : "text-amber-300"}>{severities[finding.severity] || finding.severity}</strong> · {finding.title}</p>
          <p className="mt-2">{finding.description}</p><ul className="mt-2 space-y-1 text-xs text-slate-400">{finding.evidence.map((item, i) => <li key={i}>{sources[item.source] || item.source}：「{item.excerpt}」</li>)}</ul>
          <p className="mt-2 text-xs text-slate-300">建议：{finding.suggestion}</p><div className="mt-2 flex gap-2">{decision ? <span className="text-xs text-emerald-300">已{decision === "ignored" ? "忽略" : "接受建议"}</span> : <><button type="button" className="button button-ghost button-small" disabled={busy} onClick={() => decide(index,"accepted")}>接受建议</button><button type="button" className="button button-ghost button-small" disabled={busy} onClick={() => decide(index,"ignored")}>忽略</button></>}</div>
        </article>; }) : <p className="text-sm text-slate-400">当前筛选没有问题。</p>}
        {!!review.result_json.suggestions?.length && <div className="text-sm text-slate-300"><strong>编辑建议</strong><ul className="mt-2 list-disc space-y-1 pl-5">{review.result_json.suggestions.map((item,i) => <li key={i}>{item}</li>)}</ul></div>}
      </>}
      {reviews.length > 1 && <div><label className="text-sm text-slate-300" htmlFor="review-history">审核历史</label><select id="review-history" className="form-input mt-2" value={review.id} onChange={(event) => setSelected(event.target.value)}>{reviews.map((item) => <option key={item.id} value={item.id}>{new Date(item.created_at).toLocaleString("zh-CN")} · {item.overall_score ?? "—"} · {labels[item.status] || item.status}</option>)}</select></div>}
    </div>}
  </section>;
}

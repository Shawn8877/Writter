"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, RefreshCw, Sparkles } from "lucide-react";
import { Field, Modal, Badge } from "@/components/ui";
import { BuilderError, BuilderStatus } from "./builder-status";

const labels = {
  characterNames: "涉及人物",
  name: "名称", aliases: "别名", age: "年龄", gender: "性别", appearance: "外貌", personality: "性格", background: "背景", initialStatus: "初始状态", goal: "目标", motivation: "动机", strengths: "优势", weaknesses: "弱点", internalConflict: "内在冲突", externalConflict: "外在冲突", growthArc: "成长弧线", abilities: "能力", relationships: "关系", role: "身份", relationshipToProtagonist: "与主角的关系", conflictWithProtagonist: "与主角的冲突", growthDirection: "成长方向", importantSecrets: "重要秘密", initialState: "初始状态", identity: "身份与定位", conflict: "冲突", escalation: "冲突递进", description: "说明", storyRole: "故事作用", setting: "故事舞台", era: "时代", mainLocations: "主要地点", organizations: "组织势力", socialRules: "社会规则", economicRules: "经济规则", technologyOrMagicRules: "技术与世界边界", importantConcepts: "重要概念", rules: "运行规则", limitations: "能力限制", growthPath: "成长路径", costs: "代价", forbiddenUses: "禁止用途", from: "人物", to: "关联对象", relationship: "关系", objective: "阶段目标", mainConflict: "主要冲突", majorEvents: "关键事件", characterGrowth: "人物成长", stakes: "风险与代价", turningPoint: "转折", endingHook: "后续钩子",
};
const memoryLabels = { character: "人物", relationship: "关系", world: "世界", timeline: "时间线", location: "地点", item: "物品", ability: "能力", secret: "秘密", foreshadowing: "伏笔", plot: "剧情", rule: "规则", other: "其他" };
function Facts({ value }) {
  if (value === null || value === undefined) return <p className="builder-muted">未设置</p>;
  if (Array.isArray(value)) return value.length ? <ul className="builder-facts-list">{value.map((item, index) => <li key={index}><Facts value={item} /></li>)}</ul> : <p className="builder-muted">无</p>;
  if (typeof value === "object") return <dl className="builder-facts">{Object.entries(value).map(([key, item]) => <div key={key}><dt>{labels[key] || key}</dt><dd><Facts value={item} /></dd></div>)}</dl>;
  return <p>{value}</p>;
}
function Section({ title, children, open = false }) {
  return <details className="builder-section panel" open={open}><summary>{title}</summary><div className="builder-section-content">{children}</div></details>;
}
export function StoryStages({ stages }) {
  return <div className="builder-stages">{stages.map(({ stageNumber, title, approxStartChapter, approxEndChapter, ...fields }) => <article key={stageNumber} className="builder-stage"><div className="builder-stage-title"><span>{String(stageNumber).padStart(2, "0")}</span><h3>{title}</h3><Badge>第 {approxStartChapter}–{approxEndChapter} 章</Badge></div><Facts value={fields} /></article>)}</div>;
}
export function NovelPlanPreview({ builder, onConfirm }) {
  const [dialog, setDialog] = useState(null);
  const heading = useRef(null);
  const generationId = builder.preview.generationId;
  useEffect(() => { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }, [generationId]);
  const plan = builder.preview.plan;
  const edits = [["title", "书名", 80, 1], ["synopsis", "小说简介", 2000, 5], ["corePremise", "核心设定", 1200, 4], ["mainConflict", "核心冲突", 1200, 4], ["endingDirection", "结局方向", 1200, 4]];
  return <section className="builder-preview" aria-label="AI 小说方案预览">
    <div className="builder-preview-heading"><span className="section-kicker">YOUR STORY BLUEPRINT</span><h1 ref={heading} tabIndex={-1}>AI 小说方案预览</h1><p>方案已完成。先读一读这个世界，再决定它的开始。</p><div className="builder-tags"><Badge tone="gold">{plan.genre}</Badge><Badge>{builder.preview.input.targetChapterCount} 章规划</Badge><Badge>{plan.majorCharacters.length + 1} 位核心人物</Badge><Badge>{plan.seedMemories.length} 条初始记忆</Badge></div></div>
    <BuilderError error={builder.error} />
    {builder.status === "generating" && <BuilderStatus />}
    {builder.savedId ? <div className="builder-saved panel" role="status"><Check size={22} /><div><h2>小说已保存到云端</h2><p>人物、世界、核心设定与初始记忆已一起创建。</p></div><Link className="button button-primary" href={`/novel/${builder.savedId}`}>进入工作台 <ArrowRight size={16} /></Link></div> : <div className="builder-actions panel"><p>尚未创建小说。你可以修改下方五项核心内容，其余设定可在保存后继续编辑。</p><div><button className="button button-ghost" disabled={builder.busy} onClick={() => setDialog("cancel")}>取消</button><button className="button button-ghost" disabled={builder.busy} onClick={() => setDialog("regenerate")}><RefreshCw size={15} />重新生成</button><button className="button button-primary" disabled={builder.busy || edits.some(([key]) => !plan[key].trim())} onClick={onConfirm}>{builder.status === "confirming" ? "正在保存…" : "确认创建"}<ArrowRight size={16} /></button></div></div>}
    <fieldset disabled={builder.busy || Boolean(builder.savedId)} className="builder-fieldset builder-edit-fields panel">
      <legend>可修改的核心内容</legend>{edits.map(([key, label, maxLength, rows]) => <Field key={key} label={label} htmlFor={`plan-${key}`}>{rows === 1 ? <input id={`plan-${key}`} value={plan[key]} maxLength={maxLength} required onChange={(event) => builder.edit(key, event.target.value)} /> : <textarea id={`plan-${key}`} value={plan[key]} maxLength={maxLength} rows={rows} required onChange={(event) => builder.edit(key, event.target.value)} />}</Field>)}
    </fieldset>
    <Section title="故事定位与核心卖点" open><p className="builder-pitch">{plan.shortPitch}</p><dl className="builder-facts"><div><dt>备选书名</dt><dd>{plan.alternativeTitles.join(" / ")}</dd></div><div><dt>细分题材</dt><dd>{plan.subgenres.join("、") || "未细分"}</dd></div><div><dt>目标读者</dt><dd>{plan.targetAudience}</dd></div><div><dt>情绪基调</dt><dd>{plan.tone}</dd></div><div><dt>写作风格</dt><dd>{plan.writingStyle}</dd></div></dl><h3>核心卖点</h3><Facts value={plan.coreSellingPoints} /><h3>故事主题</h3><Facts value={plan.storyThemes} /></Section>
    <Section title={`主角 · ${plan.protagonist.name}`} open><Facts value={plan.protagonist} /></Section>
    <Section title={`核心人物 · ${plan.majorCharacters.length} 位`}><div className="builder-character-grid">{plan.majorCharacters.map((person) => <article key={person.name}><h3>{person.name}</h3><Facts value={person} /></article>)}</div></Section>
    <Section title="分阶段对手与阻力">{[["earlyStageAntagonist", "前期对手"], ["midStageAntagonist", "中期对手"], ["longTermAntagonist", "长期对手"]].map(([key, label]) => <article key={key}><h3>{label}</h3>{plan.antagonists[key] ? <Facts value={plan.antagonists[key]} /> : <p>此阶段没有固定对手，冲突由故事情境推动。</p>}</article>)}</Section>
    <Section title="世界观与运行规则"><Facts value={plan.world} /></Section>
    <Section title="能力体系与边界">{plan.powerSystem.enabled ? <Facts value={Object.fromEntries(Object.entries(plan.powerSystem).filter(([key]) => key !== "enabled"))} /> : <p>本故事没有超能力、修炼或特殊系统。</p>}</Section>
    <Section title="人物关系与感情线"><Facts value={plan.relationships} /><h3>感情线方向</h3><p>{plan.romanceDirection}</p></Section>
    <Section title={`宏观故事阶段 · ${plan.storyStages.length} 个`} open><p className="builder-muted">这是长篇故事的宏观骨架，详细分卷、章节大纲与正文将在后续阶段展开。</p><StoryStages stages={plan.storyStages} /></Section>
    <Section title="不可随意改变的设定"><Facts value={plan.forbiddenChanges} /></Section>
    <Section title={`初始记忆 · ${plan.seedMemories.length} 条`}><div className="builder-memory-list">{plan.seedMemories.map((item, index) => <article key={index}><div><h3>{item.title}</h3><Badge>{memoryLabels[item.type]}</Badge><small>重要度 {item.importance}/5</small></div><p>{item.content}</p>{item.characterNames.length > 0 && <small>涉及人物：{item.characterNames.join("、")}</small>}</article>)}</div></Section>
    <p className="builder-muted builder-preview-note"><Sparkles size={14} />此方案只保留在当前页面，刷新会丢失未确认内容。生成模型：{builder.preview.usage?.model || "OpenAI"}</p>
    {dialog && <Modal title={dialog === "regenerate" ? "重新生成完整方案？" : "取消这份方案？"} onClose={() => setDialog(null)}><p>{dialog === "regenerate" ? "将再次调用 AI，产生新的完整方案和调用费用。成功后替换当前预览与手工修改，已保存的小说不受影响；生成失败时会保留当前预览。" : "未保存的方案与手工修改将被丢弃，创意表单会保留。"}</p><div className="modal-actions"><button className="button button-ghost" onClick={() => setDialog(null)}>继续查看</button><button className="button button-primary" onClick={() => { setDialog(null); if (dialog === "regenerate") void builder.generate(builder.preview.input); else builder.cancel(); }}>{dialog === "regenerate" ? "生成新的完整方案" : "丢弃预览"}</button></div></Modal>}
  </section>;
}

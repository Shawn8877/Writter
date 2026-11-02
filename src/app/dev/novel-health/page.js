import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadNovelHealth } from "@/lib/diagnostics/load-novel-health";

export const dynamic = "force-dynamic";
export default async function NovelHealthPage({ searchParams }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const supabase = await createSupabaseServerClient();
  if (!supabase) notFound();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { novelId } = await searchParams;
  const { data: novels, error } = await supabase.from("novels").select("id,title").eq("user_id", user.id).order("updated_at", { ascending: false });
  if (error) throw new Error("暂时无法加载作品列表。");
  const selected = novels.find(novel => novel.id === novelId);
  if (novelId && !selected) notFound();
  const health = selected ? await loadNovelHealth(supabase, selected.id, user.id) : null;
  const number = value => value === null ? "—" : Math.round(value).toLocaleString("zh-CN");
  return <main className="mx-auto max-w-6xl space-y-6 p-8">
    <h1 className="text-2xl font-semibold">作品健康指标 · 开发验收</h1>
    <p className="text-sm text-muted">仅开发环境开放。按当前账号权限读取；评分及风险来自 AI 审核，仍需独立抽检。</p>
    <form className="flex gap-3">
      <select name="novelId" defaultValue={selected?.id || ""} aria-label="选择测试作品" className="max-w-xl rounded border border-white/20 bg-black p-2">
        <option value="" disabled>选择作品</option>{novels.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}
      </select><button className="rounded border border-white/20 px-4" type="submit">读取指标</button>
    </form>
    {health && <>
      <Link href={`/novel/${health.novel.id}/chapters`} className="underline">打开 {health.novel.title}</Link>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">{[
        ["已写章节", health.chapters], ["已保存字数", health.totalWords], ["Memory", health.memory.total], ["Active Memory", health.memory.active],
        ["审核平均分", health.reviews.averageScore], ["Critical 章节", health.reviews.criticalChapters], ["失败尝试", health.generation.failed], ["未回收伏笔", health.memory.unresolvedForeshadowing],
        ["输入 Token", health.generation.inputTokens], ["输出 Token", health.generation.outputTokens], ["人物", health.characters], ["时间线事件", health.timeline],
      ].map(([label, value]) => <div key={label} className="rounded border border-white/10 p-4"><dt className="text-sm opacity-70">{label}</dt><dd className="mt-2 text-2xl">{number(value)}</dd></div>)}</dl>
      <p className="text-sm opacity-70">尝试次数含调用前校验失败，不等于实际 API 调用次数。缺少用量记录：{health.generation.missingUsage} 次；无用量的失败请求不按零成本推断。耗时为已记录步骤耗时，不含作者暂停时间。</p>
      <div className="overflow-auto"><table className="w-full text-left text-sm"><caption className="mb-3 text-left">分阶段质量趋势</caption><thead><tr>{["章节", "已写", "平均评分", "Critical", "High", "水文风险", "重复风险"].map(v => <th key={v} className="p-2">{v}</th>)}</tr></thead>
        <tbody>{health.stages.map(s => <tr key={s.from} className="border-t border-white/10">{[`${s.from}–${s.to}`, s.chapters, number(s.averageScore), s.severity.critical, s.severity.high, number(s.averageFillerRisk), number(s.averageRepetitionRisk)].map((v, i) => <td key={i} className="p-2">{v}</td>)}</tr>)}</tbody></table></div>
      <div className="overflow-auto"><table className="w-full text-left text-sm"><caption className="mb-3 text-left">用量与耗时</caption><thead><tr>{["步骤", "尝试", "失败", "平均耗时秒", "P95 秒", "输入 Token", "输出 Token"].map(v => <th key={v} className="p-2">{v}</th>)}</tr></thead><tbody>{Object.entries(health.generation.byType).map(([type, m]) => <tr key={type} className="border-t border-white/10">{[{ chapter_generation: "正文", chapter_memory_analysis: "记忆", chapter_review: "审核" }[type], m.attempts, m.failed, m.latencyMs.mean === null ? "—" : number(m.latencyMs.mean / 1000), m.latencyMs.p95 === null ? "—" : number(m.latencyMs.p95 / 1000), number(m.inputTokens), number(m.outputTokens)].map((v, i) => <td key={i} className="p-2">{v}</td>)}</tr>)}</tbody></table></div>
      <details><summary className="cursor-pointer">逐章 Context Token 与评分</summary><pre className="mt-3 overflow-auto rounded bg-black/40 p-4 text-xs">{JSON.stringify(health.trend, null, 2)}</pre></details>
    </>}
  </main>;
}

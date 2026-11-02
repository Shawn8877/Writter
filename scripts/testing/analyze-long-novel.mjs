import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { summarizeNovelHealth, distribution } from "../../src/lib/diagnostics/novel-health.js";

const folder = process.argv[2];
assert.match(folder || "", /^artifacts\/phase4a\/stress-[\dTZ-]+$/);
const files = (await readdir(folder)).filter(file => file.startsWith("snapshot-") && file.endsWith(".json"));
const snapshots = await Promise.all(files.map(async file => ({ file, data: JSON.parse(await readFile(`${folder}/${file}`, "utf8")) })));
snapshots.sort((a, b) => a.data.at.localeCompare(b.data.at));
const snapshot = snapshots.at(-1);
assert.ok(snapshot, "A saved database snapshot is required");
const data = snapshot.data;
const plan = JSON.parse(await readFile(`${folder}/plan.json`, "utf8"));
const jsonLines = async (name) => (await readFile(`${folder}/${name}.jsonl`, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
const contexts = await jsonLines("contexts");
const requests = await jsonLines("database-requests");
const steps = await jsonLines("steps");
const providerCalls = await jsonLines("provider-calls");
const modelInputs = await jsonLines("model-inputs");
const health = summarizeNovelHealth(data);
const chapters = data.chapters.filter(c => c.content.trim()).sort((a, b) => a.sort_order - b.sort_order);
const chapterById = new Map(chapters.map(c => [c.id, c]));
const normal = (text) => text.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");
const grams = (text) => { const s = normal(text); return new Set(Array.from({ length: Math.max(s.length - 2, 0) }, (_, i) => s.slice(i, i + 3))); };
const similarity = (a, b) => { const common = [...a].filter(g => b.has(g)).length; return common / Math.max(1, Math.min(a.size, b.size)); };
const gramsets = data.memory_items.map(m => grams(m.content));
const duplicateCandidates = [];
for (let i = 0; i < gramsets.length; i++) for (let j = i + 1; j < gramsets.length; j++) {
  const score = similarity(gramsets[i], gramsets[j]);
  if (score >= 0.55) duplicateCandidates.push({ first: data.memory_items[i].id, second: data.memory_items[j].id, similarity: score, firstText: data.memory_items[i].content, secondText: data.memory_items[j].content });
}
const seededOrder = [...data.memory_items].sort((a, b) => {
  const hash = id => createHash("sha256").update(`phase4a-memory-audit-v1:${id}`).digest("hex");
  return hash(a.id).localeCompare(hash(b.id));
});
const sample = seededOrder.slice(0, 50).map(m => {
  const chapter = chapterById.get(m.metadata?.analysisChapterId || m.chapter_id);
  const evidence = m.metadata?.lastEvidence || "";
  return { id: m.id, type: m.memory_type, importance: m.importance, status: m.status, content: m.content, evidence, chapter: chapter?.sort_order,
    exactEvidencePresent: !!evidence && !!chapter?.content.includes(evidence), classification: "pending_independent_inspection", reason: "" };
});
const group = (items, key) => Object.groupBy(items, key);
const labelCounts = (patterns, extract) => Object.fromEntries(Object.entries(patterns).map(([label, re]) => [label, chapters.filter(c => re.test(extract(c))).map(c => c.sort_order)]));
const openings = labelCounts({ nextMorning: /第二天|次日|翌日|清晨|早上|早晨/, backToCompany: /回到.{0,8}(公司|办公室)/, phone: /[手屏]机|手机|电话/ }, c => c.content.slice(0, 120));
const endings = labelCounts({ phone: /手机.{0,10}(响|震)|电话.{0,10}响/, door: /门.{0,10}(打开|推开)/, stranger: /神秘人|陌生人/, smirk: /嘴角.{0,6}(扬|勾)/ }, c => c.content.slice(-250));
// The real corpus repeats next-day work lists more often than stock cliffhangers.
// These are lexical candidates with an explicit window, not semantic verdicts.
const workflowEndings = { windowCharacters: 600, matches: labelCounts({
  nextDayPlan: /明天.{0,35}(上午|中午|下午|要做|发|写|去|带|拿|送|装)/,
  listOrRecap: /清单|备忘录|过了一遍|理了一遍|列出来|排.{0,5}(明天|日程)/,
}, c => c.content.slice(-600)) };
const summaryWindows = [5, 10, 20].map(size => {
  const selected = chapters.slice(-size).map(c => ({ number: c.sort_order, summary: data.chapter_summaries.find(s => s.chapter_id === c.id)?.summary || c.summary }));
  const pairs = [];
  for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) pairs.push({ chapters: [selected[i].number, selected[j].number], lexicalSimilarity: similarity(grams(selected[i].summary), grams(selected[j].summary)) });
  return { size, summaries: selected, mostSimilar: pairs.sort((a, b) => b.lexicalSimilarity - a.lexicalSimilarity).slice(0, 5), semanticVerdict: "pending_independent_inspection" };
});
const patterns = { ability: /预见|预知|十秒|两次|二十四|24小时|彩票|股价/, age: /\d{2}岁|二十七|二十八|四十六/, knowledge: /知道.{0,15}(能力|预见)|能力.{0,15}(知道|秘密)|知情|告诉.{0,10}(苏宁|赵驰|韩世衡)/, timeline: /\d{4}年|[一二三四五六七八九十\d]+月[一二三四五六七八九十\d]+[日号]|周[一二三四五六日天]/, travel: /上海|北京|苏州|宁波|乘.{0,5}(车|机)|到达|抵达/ };
const evidence = chapters.map(c => ({ number: c.sort_order, items: Object.fromEntries(Object.entries(patterns).map(([key, pattern]) => [key, c.content.split(/(?<=[。！？])/u).filter(s => pattern.test(s)).map(s => s.trim())])) }));
const analysis = { generatedAt: new Date().toISOString(), snapshot: snapshot.file, ...health,
  providerTelemetry: { startedAt: providerCalls[0]?.at || null, observedCalls: providerCalls.length,
    completed: providerCalls.filter(c => c.status === "completed").length,
    incomplete: providerCalls.filter(c => c.status === "incomplete").length,
    failed: providerCalls.filter(c => c.status === "failed").length,
    generationLogsWithPositiveUsage: data.ai_generation_logs.filter(l => l.input_tokens > 0 || l.output_tokens > 0).length,
    note: "Provider telemetry was introduced after the initial calls. Do not equate generation log count with paid calls: pre-call validation failures also produce logs. Missing usage is unknown, not zero." },
  modelInputs,
  chineseCharacters: chapters.reduce((sum, c) => sum + (c.content.match(/\p{Script=Han}/gu)?.length || 0), 0),
  lengthOutside2500To3500: chapters.filter(c => c.word_count < 2500 || c.word_count > 3500).map(c => ({ number: c.sort_order, words: c.word_count })),
  contexts: contexts.map(({ memoryIds: _ids, ...rest }) => rest),
  growth: snapshots.filter(s => /^snapshot-(initial|chapter-\d+|checkpoint-\d+)\.json$/.test(s.file)).map(s => ({ snapshot: s.file, at: s.data.at, written: s.data.chapters.filter(c => c.word_count > 0).length, memory: s.data.memory_items.length, active: s.data.memory_items.filter(m => m.status === "active").length, characters: s.data.characters.length })),
  database: Object.fromEntries(Object.entries(group(requests.filter(r => r.path.startsWith("/rest/")), r => `${r.method || "GET"} ${r.path}`)).map(([path, values]) => [path, { requests: values.length, failed: values.filter(v => v.status === 0 || v.status >= 400).length, latencyMs: distribution(values.map(v => v.elapsedMs)) }])),
  stepLatency: Object.fromEntries(Object.entries(group(steps, s => s.action)).map(([action, values]) => [action, distribution(values.map(v => v.elapsedMs))])),
  duplicateCandidates, openings, endings, workflowEndings, summaryWindows,
  goldenFacts: plan.goldenFacts.map(f => ({ ...f, status: "WARNING", reason: "待独立结合正文、Memory与Review核验，未命中关键词不能证明无违规。" })),
  foreshadowingPlan: plan.foreshadowingPlan,
};
await writeFile(`${folder}/health.json`, JSON.stringify(analysis, null, 2));
await writeFile(`${folder}/golden-evidence.json`, JSON.stringify(evidence, null, 2));
// Never overwrite independent classifications when refreshing numeric reports.
const preserveSample = async name => writeFile(`${folder}/${name}`, JSON.stringify(sample, null, 2), { flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
await preserveSample("memory-sample.json");
await preserveSample(`memory-sample-${snapshot.file}`);
await writeFile(`${folder}/trend.csv`, "chapter,words,score,writer_input_tokens,active_step_ms\n" + health.trend.map(t => [t.number, t.words, t.score ?? "", t.writerInputTokens ?? "", t.stageLatencyMs].join(",")).join("\n"));
console.log(JSON.stringify({ snapshot: snapshot.file, chapters: health.chapters, words: health.totalWords, memory: health.memory, generation: health.generation, stages: health.stages, duplicateCandidates: duplicateCandidates.length }, null, 2));

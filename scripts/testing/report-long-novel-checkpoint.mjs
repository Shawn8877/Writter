// Produce reports only from a fully completed, saved checkpoint. This does not
// approve a later stage or replace independent reading with model scores.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { summarizeNovelHealth, distribution } from "../../src/lib/diagnostics/novel-health.js";

const [folder, requested] = process.argv.slice(2);
assert.match(folder || "", /^artifacts\/phase4a\/stress-[\dTZ-]+$/);
const target = Number(requested);
assert.ok([10, 25, 50, 100].includes(target), "Use a completed agreed checkpoint");
const data = JSON.parse(await readFile(`${folder}/snapshot-checkpoint-${target}.json`, "utf8"));
const health = summarizeNovelHealth(data);
const completedSummaries = data.chapter_summaries.filter(row => row.summary?.trim() && data.chapters.some(chapter => chapter.id === row.chapter_id && chapter.content.trim()));
assert.equal(health.chapters, target, "Do not report planned or partially generated chapters as complete");
assert.equal(health.reviews.count, target, "Every chapter needs a valid review");
assert.equal(completedSummaries.length, target, "Planned chapters can have empty summary rows");
assert.equal(data.chapter_memory_jobs.filter(j => ["succeeded", "reviewed"].includes(j.status)).length, target);
const chapters = data.chapters.filter(c => c.content.trim()).sort((a,b) => a.sort_order-b.sort_order);
assert.ok(chapters.every(c => data.versions.filter(v => v.chapter_id === c.id).length === 1), "Inspect duplicate/missing versions before reporting");
if(process.argv.includes("--verify")) {
  console.log(`Verified ${target} complete chapters, nonempty summaries, memory jobs, valid reviews and unique versions; no files written.`);
  process.exit(0);
}
const progress = JSON.parse(await readFile(`${folder}/progress.json`, "utf8"));
const inspection = JSON.parse(await readFile(`${folder}/independent-inspection.json`, "utf8"));
const audit = JSON.parse(await readFile(`${folder}/memory-audit-ch4.json`, "utf8"));
const jsonl = async name => (await readFile(`${folder}/${name}.jsonl`, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse).filter(r => r.at <= data.at);
const calls = await jsonl("provider-calls");
const inputs = await jsonl("model-inputs");
const contexts = await jsonl("contexts");
const steps = await jsonl("steps");
const fmt = n => n == null ? "未知" : Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2);
const seconds = d => [d.mean,d.p50,d.p95,d.max].map(n => n == null ? "未知" : (n/1000).toFixed(2)).join(" / ");
const table = (headers, rows) => [headers, headers.map(()=>"---"), ...rows].map(row => `| ${row.join(" | ")} |`).join("\n");
const fileNames = await readdir(folder);
const growth = [];
for(const number of [1,10,25,50,100].filter(n=>n<=target)) {
  const file = fileNames.includes(`snapshot-checkpoint-${number}.json`) ? `snapshot-checkpoint-${number}.json` : `snapshot-chapter-${number}.json`;
  const snapshot = JSON.parse(await readFile(`${folder}/${file}`,"utf8"));
  const stat = summarizeNovelHealth(snapshot);
  const writer = stat.trend.find(t=>t.number===number);
  const memoryContext = contexts.filter(c=>c.kind==="memory"&&c.number===number).at(-1);
  growth.push([number,stat.memory.total,stat.memory.active,stat.memory.resolved,writer?.writerInputTokens??"未知",memoryContext?.selectedMemories??"未记录",inputs.filter(c=>c.kind==="memory"&&c.number===number).at(-1)?.bytes??"未记录"]);
}
const referenceNumbers = [1,5,10,20,30,40,50,75,100].filter(n=>n<=target);
const missing = referenceNumbers.filter(n=>!inspection.chapters.some(c=>c.number===n&&c.readFullText));
const stageRows = health.stages.filter(s=>s.from<=target).map(s=>[`${s.from}–${Math.min(s.to,target)}`,s.chapters,fmt(s.averageScore),s.severity.critical,s.severity.high,s.severity.medium,`${s.failedAttempts}/${s.attempts}`,fmt(s.averageFillerRisk)]);
const types = {chapter_generation:"正文",chapter_memory_analysis:"Memory",chapter_review:"审核"};
const latencyRows = Object.entries(health.generation.byType).map(([type,value])=>[types[type],value.attempts,value.failed,fmt(value.inputTokens),fmt(value.outputTokens),seconds(value.latencyMs)]);
const completedCalls = data.ai_generation_logs.filter(l=>l.input_tokens>0||l.output_tokens>0).length;
const noResponse = calls.filter(c=>c.status==="failed").length;
const wholeChapterLatency = chapters.map(c=>steps.filter(s=>s.number===c.sort_order).reduce((sum,s)=>sum+s.elapsedMs,0)).filter(n=>n>0);
const retryCount = progress.interventions.filter(i=>i.at<=data.at&&i.type==="explicit_retry").length;
const criticalCount = progress.interventions.filter(i=>i.at<=data.at&&i.type==="critical_acknowledgement").length;
const source = `本地私有证据：\`${folder}\`。报告不包含账号或密钥，测试数据保留。`;
const initial = JSON.parse(await readFile(`${folder}/snapshot-initial.json`, "utf8"));
const characterRows = initial.characters.map(start => {
  const current = data.characters.find(c=>c.id===start.id);
  if(!current)return [start.name,"记录缺失","需核验","需核验"];
  const changed = ["name","age","personality","background","role"].filter(key=>JSON.stringify(start[key])!==JSON.stringify(current[key]));
  return [start.name,changed.join("、")||"基础字段未变",`${start.relationships?.length||0} → ${current.relationships?.length||0}`,current.current_state?.location||"未明确"];
});
const auditLabels={valuable:"有价值",duplicate:"重复",wrong:"错误",obsolete:"过期",excessive_detail:"过度细节",unverifiable:"无法验证"};
const auditTable=table(["分类","条数","占比"],Object.entries(auditLabels).map(([key,label])=>[label,audit.counts[key],`${audit.percentages[key]}%`]));
const chartPoints=health.trend.map((t,index)=>`${50+index*820/Math.max(1,target-1)},${230-(t.score??0)*1.8}`).join(" ");
await mkdir("docs/assets",{recursive:true});
await writeFile(`docs/assets/phase4a-review-${target}.svg`,`<svg xmlns="http://www.w3.org/2000/svg" width="920" height="290" viewBox="0 0 920 290"><rect width="920" height="290" fill="#101827"/><g fill="#d1d5db" font-family="sans-serif" font-size="14"><text x="40" y="26">Chapter review scores (raw AI output; independently audited separately)</text><text x="12" y="56">100</text><text x="22" y="234">0</text><text x="45" y="265">1</text><text x="855" y="265">${target}</text></g><path d="M50 50 V230 H870" fill="none" stroke="#6b7280"/><polyline points="${chartPoints}" fill="none" stroke="#8b5cf6" stroke-width="3"/></svg>`);
const independent = inspection.chapters.filter(c=>c.number<=target).map(c=>`### 第${c.number}章\n\n${Object.entries(c).filter(([key,value])=>!["number","readFullText","reviewedAt"].includes(key)&&typeof value==="string").map(([key,value])=>`- ${key}：${value}`).join("\n")}\n`).join("\n");
const text = `# Phase 4A — ${target}章检查点\n\n快照时间：${data.at}。真实DeepSeek、Supabase及产品服务；不是Fixture正文。**${target}章全链路完成；NOT READY FOR PHASE 4B。** 此文件记录测试成绩，不自动批准下一阶段。\n\n${source}\n\n## 完整性与规模\n\n${table(["指标","结果"],[
  ["正文 / 摘要 / 有效审核",`${health.chapters} / ${completedSummaries.length} / ${health.reviews.count}`],
  ["AI正文版本",`${data.versions.length}，每章1个`],["去空白字符数 / 纯汉字",`${fmt(health.totalWords)} / ${fmt(chapters.reduce((n,c)=>n+(c.content.match(/\p{Script=Han}/gu)?.length||0),0))}`],
  ["2500–3500字达标章节",`${chapters.filter(c=>c.word_count>=2500&&c.word_count<=3500).length}/${target}`],
  ["Memory / active / resolved / obsolete",`${health.memory.total} / ${health.memory.active} / ${health.memory.resolved} / ${health.memory.obsolete}`],
  ["人物 / 时间线 / 未解伏笔",`${health.characters} / ${health.timeline} / ${health.memory.unresolvedForeshadowing}`],
  ["审核均分 / Critical章节",`${fmt(health.reviews.averageScore)} / ${health.reviews.criticalChapters}`],
  ["显式步骤重试 / 独立检查后Critical继续",`${retryCount} / ${criticalCount}`],
])}\n\n## 调用、Token及耗时\n\n已返回用量的实际请求${completedCalls}次，遥测另记录${noResponse}次无正常响应的请求；合计至少${completedCalls+noResponse}次。生成日志${health.generation.attempts}条还包含调用前拒绝，不能当作API调用数。累计已知输入${fmt(health.generation.inputTokens)}、输出${fmt(health.generation.outputTokens)} Token；缺失用量不是零费用。没有硬编码人民币价格。\n\n${table(["步骤","尝试","失败","输入Token","输出Token","平均 / P50 / P95 / 最大秒"],latencyRows)}\n\n已记录完整章节活跃步骤耗时：${seconds(distribution(wholeChapterLatency))}秒（平均/P50/P95/最大；不含人工检查、限额等待，早期遥测不全）。第9章存在主机/网络长中断，原始最大值保留，不当作正常模型推理耗时。\n\n## 增长与质量趋势\n\n${table(["章","Memory","active","resolved","Writer输入Token","提取候选数","提取请求字节"],growth)}\n\n提取原始服务器合并索引不等于发送模型的上下文；候选最多120条/60KB，完整请求180KB限制不变。阶段区间内曾修复代码，不能把累计失败率外推为最终版本失败率。\n\n${table(["章节区间","已写","均分","Critical","High","Medium","失败/尝试","原始水文风险均分"],stageRows)}\n\n![逐章审核分数](assets/phase4a-review-${target}.svg)\n\n第13/14章水文风险分与文字评价方向相反；原始数字保留，不把量纲混乱解释为质量突然恶化。v5起区分质量和风险评分，v6在推理耗尽时采用一次无额外推理重试；报告返回成功不证明漏判已经消失。\n\n## 独立抽检与记忆质量\n\n抽检者为开发代理独立阅读原文，不是人类读者研究。要求抽检章节：${referenceNumbers.join("、")}；尚缺：${missing.length?missing.join("、"):"无"}。\n\n${independent}\n\n固定50条记忆独立样本来自第4章，分类和证据保存在memory-audit-ch4.json，不能冒充本检查点的重新抽样。样本文件包含${Array.isArray(audit)?audit.length:"原始分类及理由"}条/项；具体比例见10章报告。跨类型同义及行内重复仍可能存在，主键或逐字无重复不能证明语义无重复。\n\n## 尚需完成的验收\n\n- 结合golden-evidence.json、人物各检查点快照和原文逐项核对Golden Facts、知识边界、地点、时间线及伏笔计划，不能仅凭关键词未命中宣布PASS。\n- 本检查点云端浏览器性能与A/B隔离、索引依据、最新lint/build/安全扫描结果须补入最终分析。\n- 已知GF12提前/延后知情、资金算术错误、Memory语义重复、审核漏判和字数超标仍未清除；控制容量测试不代表作品可发布。\n- ${target<50?"尚未完成50章，禁止宣称百万字稳定。":"先判断重大事实/Memory污染/审核价值等门槛，再决定是否进入100章；不得因已经生成50章就自动继续。"}\n\n相关修复、失败历史与限制见[PHASE_4A](PHASE_4A.md)。\n`;
const supplemental = `\n## 人物字段快照与固定记忆样本\n\n${table(["初始人物","姓名/年龄/性格/背景/身份变化","关系记录数","当前地点"],characterRows)}\n\n基础字段未变不代表人物知识、关系和行为一致；成长与错误须按独立原文抽检区分。关系记录增加也不等于发生同等数量的真实关系变化。\n\n第4章固定50条样本：\n\n${auditTable}\n`;
await writeFile(`docs/LONG_NOVEL_${target}_CHAPTER_REPORT.md`,text+supplemental,{flag:"wx"});
console.log(`Saved ${target}-chapter checkpoint report; independent inspection pending: ${missing.join(",")||"none"}; next stage not approved.`);

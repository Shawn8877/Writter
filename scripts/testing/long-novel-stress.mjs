// Real hosted acceptance: no provider fixtures or stress-specific product paths.
// Stop at each checkpoint, failed step, or Critical review. Resume is explicit.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, appendFile, open, unlink } from "node:fs/promises";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { longNovelPlan } from "./long-novel-plan.mjs";
import { startGenerationRun, getGenerationRun, claimGenerationStep, processGenerationStep, reconcileGenerationRun, retryGenerationRun, continueCriticalGenerationRun } from "../../src/lib/ai/services/generation-run-service.js";
import { buildChapterContext } from "../../src/lib/ai/services/chapter-context.js";
import { buildChapterMemoryContext } from "../../src/lib/ai/context/chapter-memory-context-builder.js";
import { buildChapterReviewContext } from "../../src/lib/ai/context/chapter-review-context-builder.js";
import { analyzeChapterMemory } from "../../src/lib/ai/services/chapter-memory-service.js";
import { chapterMemoryModelContext } from "../../src/lib/ai/services/memory-evidence.js";
import { analyzeChapterReview } from "../../src/lib/ai/services/chapter-review-service.js";
import { writeChapter } from "../../src/lib/ai/services/chapter-writer-service.js";
import { createDeepSeekClient } from "../../src/lib/ai/deepseek.js";

const args = process.argv.slice(2);
const value = (key) => args.includes(key) ? args[args.indexOf(key) + 1] : null;
assert.ok(args.includes("--real-ai-cloud") && args.includes("--allow-cloud-test-writes"), "Explicit real AI and cloud write flags required");
const target = Number(value("--to") || 10);
assert.ok([10, 25, 50, 100].includes(target), "Use the agreed stage checkpoints");
const folder = value("--resume") || `artifacts/phase4a/stress-${new Date().toISOString().replace(/[:.]/g, "-")}`;
assert.match(folder, /^artifacts\/phase4a\/stress-[\dTZ-]+$/);
nextEnv.loadEnvConfig(process.cwd(), true);
assert.ok(process.env.DEEPSEEK_API_KEY, "Configure the existing DeepSeek key locally");
await mkdir(folder, { recursive: true });
const lock = await open(`${folder}/runner.lock`, "wx").catch(() => { throw new Error("Another runner may own this novel; inspect the lock before resuming"); });
await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
let client, report, currentStep = null;
const persist = () => writeFile(`${folder}/progress.json`, JSON.stringify(report, null, 2));
const record = (file, item) => appendFile(`${folder}/${file}.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...item }) + "\n");
const checked = (result) => { if (result.error) throw new Error(`Database request failed: ${result.error.code || "unavailable"}`); return result.data; };
const stoppedChapter = run => run.chapters[run.errorType === "REVIEW_CRITICAL" ? run.currentIndex - 1 : run.currentIndex]?.number;
async function rows(table, fields = "*") {
  const result = [];
  for (let from = 0; ; from += 500) {
    const page = checked(await client.from(table).select(fields).eq("novel_id", report.novelId).order(table === "chapter_memory_jobs" ? "chapter_id" : "id").range(from, from + 499));
    result.push(...page);
    if (page.length < 500) return result;
  }
}
async function snapshot(label) {
  const tables = ["chapters", "characters", "memory_items", "timeline_events", "chapter_summaries", "chapter_memory_jobs", "chapter_reviews", "ai_generation_logs", "generation_runs"];
  const safeFields = { chapter_memory_jobs: "novel_id,chapter_id,status,error_type,updated_at,generation_id",
    chapter_reviews: "id,novel_id,chapter_id,status,overall_score,result_json,error_type,created_at,updated_at,manual,author_acknowledged,input_tokens,output_tokens,latency_ms",
    ai_generation_logs: "id,novel_id,chapter_id,generation_type,status,error_type,model,input_tokens,output_tokens,latency_ms,created_at,completed_at",
    generation_runs: "id,novel_id,status,stage,start_chapter,target_chapters,current_index,error_type,created_at,updated_at,completed_at" };
  const data = Object.fromEntries(await Promise.all(tables.map(async table => [table, await rows(table, safeFields[table] || "*")])));
  const written = data.chapters.filter(c => c.content?.trim()).sort((a, b) => a.sort_order - b.sort_order);
  data.versions = written.length ? checked(await client.from("chapter_versions").select("id,chapter_id,source,word_count,created_at").in("chapter_id", written.map(c => c.id))) : [];
  data.at = new Date().toISOString();
  await writeFile(`${folder}/snapshot-${label}.json`, JSON.stringify(data, null, 2));
  const logs = data.ai_generation_logs;
  report.metrics = { writtenChapters: written.length, totalWords: written.reduce((sum, c) => sum + c.word_count, 0), memory: data.memory_items.length,
    activeMemory: data.memory_items.filter(m => m.status === "active").length, characters: data.characters.length, timeline: data.timeline_events.length,
    calls: logs.length, failedCalls: logs.filter(l => l.status === "failed").length, inputTokens: logs.reduce((s, l) => s + (l.input_tokens || 0), 0), outputTokens: logs.reduce((s, l) => s + (l.output_tokens || 0), 0) };
  await persist();
  return data;
}
const measuredContext = (kind, builder) => async (supabase, input) => {
  const began = Date.now();
  const prepared = await builder(supabase, input);
  const context = prepared.context;
  const modelContext = kind === "memory" ? chapterMemoryModelContext(context) : context;
  await record("contexts", { kind, chapterId: input.chapterId, number: context.chapter.sort_order, elapsedMs: Date.now() - began,
    bytes: Buffer.byteLength(JSON.stringify(context)), memories: context.memories?.length || 0, characters: context.characters?.length || 0,
    selectedMemories: modelContext.memories?.length || 0, modelContextBytes: Buffer.byteLength(JSON.stringify(modelContext)),
    selectedMemoryIds: modelContext.memories?.map(m => m.id).filter(Boolean) || [],
    memoryIds: context.memories?.map(m => m.id).filter(Boolean) || [], memoryStatuses: context.memories?.reduce((out, m) => ({ ...out, [m.status || "active"]: (out[m.status || "active"] || 0) + 1 }), {}) });
  return prepared;
};
const measuredModel = (kind, analyze) => async (context, { config, ...options }) => {
  const provider = createDeepSeekClient(config);
  const client = { responses: { create: async (...input) => {
    const began = Date.now();
    const modelData = JSON.parse(input[0].input[1].content);
    await record("model-inputs", { kind, number: context.chapter.sort_order, reasoningEffort: input[0].reasoning?.effort,
      selectedMemoryCount: kind === "review" ? modelData.evidencePassages.filter(group => group.source === "memory").length : modelData.memories?.length,
      bytes: Buffer.byteLength(JSON.stringify(input[0])), inputBytes: Buffer.byteLength(JSON.stringify(input[0].input)), schemaBytes: Buffer.byteLength(JSON.stringify(input[0].text?.format?.schema || {})) });
    try {
      const response = await provider.responses.create(...input);
      await record("provider-calls", { kind, number: context.chapter.sort_order, status: response.status, elapsedMs: Date.now() - began, usage: response.usage });
      // Private test-novel evidence only; never config, credentials or headers.
      await writeFile(`${folder}/response-${context.chapter.sort_order}-${kind}-${Date.now()}.json`, JSON.stringify({ status: response.status, output: response.output_text, usage: response.usage }, null, 2));
      return response;
    } catch (error) {
      await record("provider-calls", { kind, number: context.chapter.sort_order, status: "failed", elapsedMs: Date.now() - began, httpStatus: error.status || null });
      throw error;
    }
  } } };
  return analyze(context, { config, client, ...options });
};
try {
  const accounts = JSON.parse(await readFile(".tools/cloud-test-accounts.json", "utf8"));
  assert.equal(accounts.disposableTestProject, true);
  assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${accounts.projectRef}.supabase.co`);
  const rawFetch = globalThis.fetch;
  client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: true },
    global: { fetch: async (input, init) => {
      const began = Date.now(); const url = new URL(typeof input === "string" ? input : input.url || String(input));
      try {
        const response = await rawFetch(input, init);
        if (url.pathname.startsWith("/rest/")) await record("database-requests", { path: url.pathname, method: init?.method || "GET", status: response.status, elapsedMs: Date.now() - began, step: currentStep });
        return response;
      } catch (error) { await record("database-requests", { path: url.pathname, status: 0, elapsedMs: Date.now() - began, step: currentStep }); throw error; }
    } },
  });
  const signed = await client.auth.signInWithPassword({ email: accounts.a.email, password: accounts.a.password });
  assert.ifError(signed.error);
  if (value("--resume")) {
    report = JSON.parse(await readFile(`${folder}/progress.json`, "utf8"));
    if (target > 10) assert.ok(report.checkpoints?.[target === 25 ? "10" : target === 50 ? "25" : "50"]?.approved, "Previous checkpoint must be reviewed and explicitly approved");
  } else {
    assert.equal(target, 10, "Start with Stage A");
    const plan = longNovelPlan(signed.data.user.id);
    report = { phase: "4A", scope: "real DeepSeek + hosted Supabase + unchanged product services", novelId: plan.novelId, startedAt: new Date().toISOString(), status: "seeding", runIds: [], checkpoints: {}, interventions: [] };
    await writeFile(`${folder}/plan.json`, JSON.stringify(plan, null, 2));
    await persist();
    for (const [table, values] of plan.rows) checked(await client.from(table).insert(values));
    await snapshot("initial");
  }
  report.status = "running"; report.target = target; delete report.failure; await persist();
  console.log(`Stress test: ${folder}; target ${target}; novel ${report.novelId}`);
  let run = report.runIds.length ? await reconcileGenerationRun(client, report.runIds.at(-1)) : null;
  if (run?.status === "paused" && args.includes("--ack-critical")) {
    assert.ok(value("--reason")?.trim(), "Record the inspected Critical decision");
    report.interventions.push({ at: new Date().toISOString(), type: "critical_acknowledgement", runId: run.id, chapter: stoppedChapter(run), reason: value("--reason") });
    await persist(); run = await continueCriticalGenerationRun(client, run.id);
  }
  if (run?.status === "failed" && args.includes("--retry")) {
    report.interventions.push({ at: new Date().toISOString(), type: "explicit_retry", runId: run.id, chapter: run.chapters[run.currentIndex]?.number, errorType: run.errorType });
    await persist(); run = await retryGenerationRun(client, run.id);
  }
  if (run?.status === "running") { delete report.stop; await persist(); }
  const dependencies = { chapter: { context: measuredContext("writer", buildChapterContext), write: measuredModel("writer", writeChapter) },
    memoryDependencies: { context: measuredContext("memory", buildChapterMemoryContext), analyze: measuredModel("memory", analyzeChapterMemory) },
    reviewDependencies: { context: measuredContext("review", buildChapterReviewContext), analyze: measuredModel("review", analyzeChapterReview) } };
  while (true) {
    if (!run || run.status === "completed") {
      const data = await snapshot(run ? `run-${run.id}` : "ready");
      const complete = data.generation_runs.filter(r => r.status === "completed").reduce((n, r) => n + r.target_chapters, 0);
      if (complete >= target) {
        report.status = "checkpoint_pending"; report.checkpoints[String(target)] = { completedAt: new Date().toISOString(), approved: false, metrics: report.metrics };
        await snapshot(`checkpoint-${target}`); console.log(`CHECKPOINT ${target}: ${JSON.stringify(report.metrics)}`); break;
      }
      const count = Math.min(10, target - complete);
      assert.ok([3, 5, 10].includes(count), "Use product-supported continuous batch sizes");
      const started = await startGenerationRun(client, { novelId: report.novelId, count, mode: "continuous" });
      assert.ok(started.runId, "Existing outlines must be ready");
      run = started.run; report.runIds.push(run.id); await persist();
    }
    if (run.status !== "running") {
      report.status = run.status; report.stop = { runId: run.id, chapter: stoppedChapter(run), stage: run.stage, errorType: run.errorType };
      await snapshot(`stopped-${Date.now()}`); console.log(`STOP: ${JSON.stringify(report.stop)}`); break;
    }
    const claim = await claimGenerationStep(client, run.id);
    currentStep = { runId: run.id, number: run.chapters[run.currentIndex]?.number, action: claim.action };
    report.currentStep = { ...currentStep, startedAt: new Date().toISOString() }; await persist();
    if (["wait", "paused"].includes(claim.action)) {
      report.status = "needs_inspection"; report.stop = currentStep; await snapshot(`waiting-${Date.now()}`); console.log(`WAIT: ${JSON.stringify(currentStep)}`); break;
    }
    console.log(`START ${currentStep.number} ${claim.action}`);
    const began = Date.now();
    const result = await processGenerationStep(client, claim, dependencies);
    await record("steps", { ...currentStep, elapsedMs: Date.now() - began, result });
    run = await getGenerationRun(client, run.id);
    console.log(`DONE ${currentStep.number} ${claim.action}: ${run.status}/${run.stage}`);
    if (claim.action === "review" || run.status !== "running") await snapshot(`chapter-${currentStep.number}`);
  }
} catch (error) {
  if (report) { report.status = "interrupted"; report.failure = { at: new Date().toISOString(), step: currentStep, code: error.code || null, message: error.message }; await persist(); }
  console.error(`Stress test interrupted: ${error.code || error.message}`); process.exitCode = 1;
} finally {
  await client?.auth.stopAutoRefresh(); await lock.close(); await unlink(`${folder}/runner.lock`);
}

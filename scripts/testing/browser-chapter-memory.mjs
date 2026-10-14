// Explicit fixture by default. --real-ai-cloud performs two paid chapter calls
// and two paid analyses on the existing disposable A/B Supabase accounts.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile, open } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { startSupabaseFixture } from "./supabase-fixture.mjs";
import { memoryFixtureRows, seedMemorySql, memoryProse, memoryAnalysisFixture } from "./chapter-memory-fixtures.mjs";
import { responseFixture, novelPlan, builderInput } from "./novel-builder-fixtures.mjs";
import { buildChapterContext } from "../../src/lib/ai/services/chapter-context.js";
import { inputHash } from "../../src/lib/ai/services/builder-workflow.js";

const real = process.argv.includes("--real-ai-cloud");
if (real) assert.ok(process.argv.includes("--allow-cloud-test-writes"));
nextEnv.loadEnvConfig(process.cwd(), true);
const port = real ? 3000 : 43070; const base = `http://127.0.0.1:${port}`;
const resumeIndex = process.argv.indexOf("--resume");
const resume = resumeIndex >= 0 ? process.argv[resumeIndex + 1] : null;
if (resume) assert.ok(real && /^artifacts\/phase3c1\/browser-real-[\dTZ-]+$/.test(resume), "Resume only a known real acceptance folder");
const previousReport = resume ? JSON.parse(await readFile(`${resume}/results.json`, "utf8")) : null;
const folder = resume || `artifacts/phase3c1/browser-${real ? "real" : "fixture"}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
await mkdir(folder, { recursive: true });
const report = { ...previousReport, status: "running", realDeepSeek: real, checks: [], errors: [], chapters: previousReport?.chapters || [] };
if (previousReport) { report.previousFailure = previousReport.failure; delete report.failure; delete report.failedStage; }
let fixture; let provider; let child; let log; let browser; let page; let stage = "setup"; let expectedFailure = false; let memoryCalls = 0; let writerCalls = 0;
const persist = () => writeFile(`${folder}/results.json`, JSON.stringify(report, null, 2));
async function check(name, fn) { stage = name; await fn(); report.checks.push(name); await persist(); console.log(`PASS: ${name}`); }
try {
  const accounts = real ? JSON.parse(await readFile(".tools/cloud-test-accounts.json", "utf8")) : { a: { email: "memory-a@example.invalid", password: "BrowserMemoryFixtureA1!" }, b: { email: "memory-b@example.invalid", password: "BrowserMemoryFixtureB1!" } };
  if (real && (process.argv.includes("--actor-b") || previousReport?.ownerTestAccount === "b")) { [accounts.a, accounts.b] = [accounts.b, accounts.a]; report.ownerTestAccount = "b"; }
  if (real) { assert.equal(accounts.disposableTestProject, true); assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${accounts.projectRef}.supabase.co`); }
  if (!real) {
    fixture = await startSupabaseFixture({ port: port + 1, appPort: port, quiet: true });
    provider = createServer(async (request, response) => {
      let raw = ""; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw); const context = JSON.parse(body.input[1].content); const result = responseFixture(novelPlan(builderInput()));
      if (body.text?.format?.name === "chapter_memory_analysis") {
        memoryCalls++; assert.equal(body.text.format.type, "json_schema"); assert.equal(body.text.format.strict, true);
        result.output[0].content[0].text = JSON.stringify(memoryCalls === 1 ? {} : memoryAnalysisFixture(context));
      } else { writerCalls++; result.output[0].content[0].text = memoryProse; }
      await new Promise((r) => setTimeout(r, 3000)); response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(result));
    });
    await new Promise((r) => provider.listen(port + 2, "127.0.0.1", r));
    log = await open(`${folder}/server.log`, "a");
    child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", log.fd, log.fd], env: { ...process.env,
      NODE_OPTIONS: `--require "${fileURLToPath(new URL("./provider-fixture-preload.cjs", import.meta.url)).replaceAll("\\", "/")}"`,
      NOVELAI_TEST_MODE: "1", NOVELAI_AI_FIXTURE: "1", NOVELAI_AI_FIXTURE_URL: `http://127.0.0.1:${port + 2}/responses`,
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port + 1}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "testanon-fixture-only", AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "fixture-only", DEEPSEEK_MODEL: "deepseek-flash", DEEPSEEK_PROXY_URL: "", OPENAI_API_KEY: "" } });
    for (let i = 0; ; i++) { try { if ((await fetch(base + "/login")).ok) break; } catch {} if (i > 90 || child.exitCode !== null) throw new Error("Test app not ready"); await new Promise((r) => setTimeout(r, 1000)); }
  }
  const clients = {}; const ids = {};
  for (const actor of ["a", "b"]) {
    clients[actor] = createClient(real ? process.env.NEXT_PUBLIC_SUPABASE_URL : `http://127.0.0.1:${port + 1}`, real ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : "testanon-fixture-only", { auth: { persistSession: false, autoRefreshToken: false } });
    const auth = await clients[actor].auth[real ? "signInWithPassword" : "signUp"]({ email: accounts[actor].email, password: accounts[actor].password }); assert.ifError(auth.error); ids[actor] = auth.data.user.id;
  }
  const seed = previousReport ? { novelId: previousReport.novelId, firstId: previousReport.firstId, secondId: previousReport.secondId } : real ? memoryFixtureRows(ids.a) : await seedMemorySql(fixture.db, ids.a);
  if (real && !resume) for (const [table, row] of seed.rows) { const r = await clients.a.from(table).insert(row); assert.ifError(r.error); }
  if (!real) await fixture.db.query("insert into memory_items(novel_id,memory_type,title,content,importance) values($1,'foreshadowing','停走的挂钟','挂钟为何停走？',3)", [seed.novelId]);
  report.novelId = seed.novelId; report.firstId = seed.firstId; report.secondId = seed.secondId; await persist();
  const rows = async (table, column = "novel_id", value = seed.novelId, fields = "*") => {
    if (!real) return (await fixture.db.query(`select ${fields} from ${table} where ${column}=$1`, [value])).rows;
    const r = await clients.a.from(table).select(fields).eq(column, value); assert.ifError(r.error); return r.data;
  };
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); ctx.setDefaultTimeout(45000); page = await ctx.newPage();
  page.on("pageerror", (e) => report.errors.push({ stage, message: e.message }));
  page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !(expectedFailure && m.text().includes("Failed to load resource"))) report.errors.push({ stage, message: m.text() }); });
  page.on("request", (r) => { if (["api.deepseek.com", "api.openai.com"].includes(new URL(r.url()).hostname)) report.errors.push({ stage, message: "Browser called AI provider directly" }); });
  page.on("response", (r) => { if (r.status() >= 400 && !expectedFailure) report.errors.push({ stage, status: r.status(), path: new URL(r.url()).pathname }); });
  page.on("dialog", (d) => d.dismiss());
  async function login(actor, p = page) { await p.goto(base + "/login"); await p.getByLabel("邮箱", { exact: true }).fill(accounts[actor].email); await p.getByLabel("密码", { exact: true }).fill(accounts[actor].password); await p.getByRole("button", { name: "登录", exact: true }).click(); await p.waitForURL(base + "/dashboard"); }
  const api = (path, body, context = ctx) => context.request.post(base + path, { headers: { "Content-Type": "application/json", Origin: base }, data: body });
  const chapterUrl = (id) => `${base}/novel/${seed.novelId}/chapters?chapter=${id}`;
  async function generateAndSave(id) {
    await page.goto(chapterUrl(id)); await page.locator("#chapter-body:not([disabled])").waitFor();
    if (resume) {
      const existing = (await rows("chapters", "id", id))[0];
      if (existing.content) {
        const status = (await rows("chapter_memory_jobs", "chapter_id", id))[0];
        if (["failed", "stale"].includes(status?.status)) {
          await page.getByRole("button", { name: "重试记忆更新", exact: true }).click();
          await page.getByText("正文已保存 · 正在分析章节…", { exact: true }).waitFor();
        }
        assert.equal((await rows("chapter_versions", "chapter_id", id)).length, 1);
        return existing.content;
      }
    }
    await page.getByRole("button", { name: "生成本章", exact: true }).click();
    await page.getByRole("heading", { name: "AI 章节预览", exact: true }).waitFor({ timeout: 300000 });
    const prose = await page.locator("#generated-chapter-preview").inputValue(); assert.ok(prose.length);
    await page.getByRole("button", { name: "确认保存正文", exact: true }).click();
    await page.getByRole("heading", { name: "AI 章节预览", exact: true }).waitFor({ state: "hidden" });
    await page.getByText("正文已保存 · 正在分析章节…", { exact: true }).waitFor();
    assert.equal(await page.locator("#chapter-body").isEnabled(), true); assert.equal(await page.locator("#chapter-body").inputValue(), prose);
    assert.equal((await rows("chapter_versions", "chapter_id", id)).length, 1);
    await writeFile(`${folder}/${id}.txt`, prose); report.chapters.push({ id, wordCount: [...prose.replace(/\s/g, "")].length }); await persist();
    return prose;
  }
  await check("anonymous memory status and retry are rejected", async () => {
    assert.equal((await ctx.request.get(`${base}/api/ai/chapters/memory?novelId=${seed.novelId}&chapterId=${seed.firstId}`)).status(), 401);
    assert.equal((await api("/api/ai/chapters/memory", { novelId: seed.novelId, chapterId: seed.firstId })).status(), 401);
    assert.equal((await api("/api/ai/chapters/memory", { novelId: seed.novelId, chapterId: seed.firstId, action: "acknowledge", expectedRevision: 1 })).status(), 401);
  });
  await login("a"); let firstProse;
  await check("first chapter is saved with one AI version and remains readable while automatic analysis runs", async () => { firstProse = await generateAndSave(seed.firstId); });
  if (!real) await check("invalid analysis preserves prose/version and an explicit retry succeeds", async () => {
    await page.getByText("正文已保存，记忆更新失败，请稍后重试", { exact: true }).waitFor();
    assert.equal(await page.locator("#chapter-body").inputValue(), firstProse); assert.equal((await rows("chapter_versions", "chapter_id", seed.firstId)).length, 1);
    await page.getByRole("button", { name: "重试记忆更新", exact: true }).click();
    await page.getByText("正文已保存 · 正在分析章节…", { exact: true }).waitFor();
  });
  await check("memory analysis persists summary, chapter-linked facts, character state and timeline", async () => {
    await page.getByTestId("chapter-memory-status").filter({ hasText: /记忆已更新|记忆更新失败/ }).waitFor({ timeout: 300000 });
    assert.ok((await page.getByTestId("chapter-memory-status").innerText()).includes("记忆已更新"), "Memory analysis failed; saved prose is retained");
    const summaries = await rows("chapter_summaries", "chapter_id", seed.firstId); assert.equal(summaries.length, 1); assert.ok(summaries[0].summary.length >= 100 && summaries[0].summary.length <= 300); assert.ok(summaries[0].next_chapter_requirements.length);
    const memories = await rows("memory_items"); assert.ok(memories.some((m) => m.memory_type === "ability" && /24|二十四/.test(m.content))); assert.ok(memories.some((m) => m.memory_type === "foreshadowing" && m.status === "active"));
    assert.ok(memories.every((m) => m.source_type === "chapter" && m.source_id === m.chapter_id && [seed.firstId, seed.secondId].includes(m.source_id)));
    const characters = await rows("characters"); const hero = characters.find((c) => c.name === "林舟"); assert.equal(hero.age, "26"); assert.equal(hero.background, "普通修表师"); assert.ok(hero.current_state.description);
    assert.ok((await rows("timeline_events")).some((t) => t.chapter_id === seed.firstId));
    const snapshotName = resume && (await rows("chapters", "id", seed.secondId))[0].content ? "resumed-first-memory" : "first-memory";
    await writeFile(`${folder}/${snapshotName}.json`, JSON.stringify({ summaries, memories, characters, timeline: await rows("timeline_events") }, null, 2));
    await page.getByRole("button", { name: "章节摘要", exact: true }).click(); await page.getByText("当前章节摘要", { exact: true }).waitFor(); await page.screenshot({ path: `${folder}/summary.png` });
    await api("/api/ai/chapters/memory", { novelId: seed.novelId, chapterId: seed.firstId }); if (!real) assert.equal(memoryCalls, 2);
  });
  await check("second chapter context uses freshly persisted memory, state, summary and next-chapter requirements", async () => {
    const second = (await rows("chapters", "id", seed.secondId))[0];
    const context = resume && second.content ? JSON.parse(await readFile(`${folder}/second-context.json`, "utf8")) : (await buildChapterContext(clients.a, { novelId: seed.novelId, chapterId: seed.secondId, expectedRevision: 1 })).context;
    assert.ok(context.memories.some((m) => m.memory_type === "ability" && /24|二十四/.test(m.content))); assert.ok(context.continuityRequirements.length > 3); assert.ok(context.recentSummaries[0].summary.length >= 100); assert.ok(context.unresolvedForeshadowing.length);
    assert.ok(context.characters.find((c) => c.name === "林舟").current_state.description);
    report.secondContextHash = inputHash(context); await writeFile(`${folder}/second-context.json`, JSON.stringify(context, null, 2));
  });
  if (real) await check("real second chapter generation used that exact context and completes its own memory update", async () => {
    const prose = await generateAndSave(seed.secondId);
    await page.getByTestId("chapter-memory-status").filter({ hasText: /记忆已更新|记忆更新失败/ }).waitFor({ timeout: 300000 });
    assert.ok((await page.getByTestId("chapter-memory-status").innerText()).includes("记忆已更新"), "Second memory analysis failed; saved prose is retained");
    const logs = await rows("ai_generation_logs", "chapter_id", seed.secondId, "id,generation_type,input_hash,status,model,input_tokens,output_tokens,latency_ms,error_type");
    assert.equal(logs.find((l) => l.generation_type === "chapter_generation").input_hash, report.secondContextHash);
    const job = (await rows("chapter_memory_jobs", "chapter_id", seed.secondId))[0];
    assert.equal(job.status, "succeeded"); assert.equal(logs.find((l) => l.id === job.generation_id)?.status, "succeeded");
    report.secondChapterLogs = logs; report.requiresHumanSemanticReview = true; report.secondChapterRepeatsExplicitBound = /24|二十四/.test(prose);
    await writeFile(`${folder}/second-memory.json`, JSON.stringify({ memories: await rows("memory_items"), summaries: await rows("chapter_summaries"), characters: await rows("characters"), timeline: await rows("timeline_events") }, null, 2));
  });
  await check("refresh, summary, characters, timeline, memory, dashboard and create routes render without console errors", async () => {
    for (const path of [`/novel/${seed.novelId}`, `/novel/${seed.novelId}/outline`, `/novel/${seed.novelId}/characters`, `/novel/${seed.novelId}/world`, `/novel/${seed.novelId}/timeline`, `/novel/${seed.novelId}/memory`, "/dashboard", "/create"]) { const response = await page.goto(base + path); assert.equal(response.status(), 200); await page.locator("h1").first().waitFor(); }
    await page.goto(`${base}/novel/${seed.novelId}/world`);
    for (const label of ["世界设定", "地点", "重要物品", "能力体系", "伏笔"]) {
      await page.getByRole("group", { name: "世界观分类" }).getByRole("button", { name: new RegExp(`^${label}`) }).click();
      await page.getByRole("button", { name: `新增${label}`, exact: true }).waitFor();
    }
    await page.locator(".resolution-note").first().waitFor();
    assert.equal((await page.locator(".resolution-note").first().innerText()).includes("[object Object]"), false);
    await page.goto(chapterUrl(seed.firstId)); await page.locator("#chapter-body:not([disabled])").waitFor(); assert.equal(await page.locator("#chapter-body").inputValue(), firstProse); await page.getByText("正文已保存 · 记忆已更新", { exact: true }).waitFor();
    await page.screenshot({ path: `${folder}/saved.png` });
  });
  await check("B cannot read or retry A memory jobs; no duplicate versions or browser provider calls", async () => {
    const bc = await browser.newContext(); const bp = await bc.newPage(); await login("b", bp);
    assert.equal((await bc.request.get(`${base}/api/ai/chapters/memory?novelId=${seed.novelId}&chapterId=${seed.firstId}`)).status(), 404);
    assert.equal((await api("/api/ai/chapters/memory", { novelId: seed.novelId, chapterId: seed.firstId }, bc)).status(), 404);
    assert.equal((await api("/api/ai/chapters/memory", { novelId: seed.novelId, chapterId: seed.firstId, action: "acknowledge", expectedRevision: 1 }, bc)).status(), 404);
    const r = await clients.b.from("chapter_memory_jobs").select("chapter_id").eq("novel_id", seed.novelId); assert.ifError(r.error); assert.deepEqual(r.data, []); await bc.close();
    assert.equal((await rows("chapter_versions", "chapter_id", seed.firstId)).length, 1); if (!real) { assert.equal(writerCalls, 1); assert.equal(memoryCalls, 2); }
  });
  if (!real) await check("edited analysed prose requires explicit human review; acknowledgement preserves versions and releases the next chapter", async () => {
    const revised = `${firstProse} 林舟把纸巾放在柜台上。`;
    await page.locator("#chapter-body").fill(revised);
    await page.getByText("正文已修改，请人工核对记忆后继续。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "重试记忆更新", exact: true }).count(), 0);
    assert.equal((await api("/api/ai/chapters/memory", { novelId: seed.novelId, chapterId: seed.firstId, action: "acknowledge", expectedRevision: 1 })).status(), 409);
    await page.getByRole("button", { name: "章节摘要", exact: true }).click();
    const manualSummary = "人工核对：本章能力与钥匙事实保留，纸巾已放在柜台上。";
    await page.locator("#chapter-summary").fill(manualSummary);
    for (let i = 0; ; i++) { if ((await rows("chapters", "id", seed.firstId))[0].summary === manualSummary) break; if (i > 40) assert.fail("Manual summary was not saved"); await new Promise((resolve) => setTimeout(resolve, 100)); }
    await page.reload();
    await page.getByRole("button", { name: "核对记忆后继续", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "确认已核对记忆", exact: true }).isDisabled(), true);
    await page.getByLabel("我已核对并修正受影响的记忆与连续性资料").check();
    await page.getByRole("button", { name: "确认已核对记忆", exact: true }).click();
    await page.getByText("正文已保存 · 记忆已人工核对", { exact: true }).waitFor();
    await page.reload(); await page.getByText("正文已保存 · 记忆已人工核对", { exact: true }).waitFor();
    assert.equal(await page.locator("#chapter-body").inputValue(), revised);
    assert.equal((await rows("chapter_versions", "chapter_id", seed.firstId)).length, 1); assert.equal(memoryCalls, 2);
    const context = (await buildChapterContext(clients.a, { novelId: seed.novelId, chapterId: seed.secondId, expectedRevision: 1 })).context;
    assert.equal(context.recentSummaries[0].summary, manualSummary); assert.equal(context.recentSummaries[0].next_chapter_requirements, undefined);
    await page.screenshot({ path: `${folder}/manual-review.png` });
  });
  report.analysisLogs = await rows("ai_generation_logs", "novel_id", seed.novelId, "id,generation_type,status,model,input_tokens,output_tokens,latency_ms,error_type");
  assert.deepEqual(report.errors, []); report.status = "passed";
} catch (error) {
  report.status = "failed"; report.failedStage = stage; report.failure = { name: error.name, message: "Acceptance failed; secrets and raw network payloads omitted.", location: error.stack?.split("\n").find((line) => line.includes("browser-chapter-memory.mjs:"))?.trim() };
  console.error(`FAIL: ${stage}: ${error.name}`); await page?.screenshot({ path: `${folder}/failure.png`, fullPage: true }).catch(() => {}); process.exitCode = 1;
} finally {
  await persist(); await browser?.close();
  if (child) { const exit = new Promise((resolve) => child.once("exit", resolve)); child.kill(); await Promise.race([exit, new Promise((r) => setTimeout(r, 3000))]); }
  if (provider) await new Promise((resolve) => provider.close(resolve)); await fixture?.close(); await log?.close(); console.log(`Evidence: ${folder}/results.json`);
}

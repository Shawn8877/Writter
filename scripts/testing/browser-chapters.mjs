// Default: isolated SQL/Auth and provider fixture. Explicit flag: one real paid
// chapter request through the browser and hosted Supabase, under disposable A/B.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile, open } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { startSupabaseFixture } from "./supabase-fixture.mjs";
import { chapterFixtureRows, seedChapterSql } from "./chapter-fixtures.mjs";
import { responseFixture, novelPlan, builderInput } from "./novel-builder-fixtures.mjs";

const real = process.argv.includes("--real-ai-cloud");
if (real) assert.ok(process.argv.includes("--allow-cloud-test-writes"), "Cloud writes require explicit opt-in");
nextEnv.loadEnvConfig(process.cwd(), true);
const port = real ? 3000 : 43050; const base = `http://127.0.0.1:${port}`;
const folder = `artifacts/phase3c0/browser-${real ? "real" : "fixture"}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
await mkdir(folder, { recursive: true });
const report = { status: "running", realDeepSeek: real, scope: real ? "real DeepSeek + hosted Supabase + browser" : "explicit provider/Auth fixtures + local PostgreSQL + browser", checks: [], errors: [] };
let fixture; let provider; let child; let log; let browser; let page; let stage = "setup"; let expectedFailure = false; let generateCalls = 0; let providerCalls = 0;
const persist = () => writeFile(`${folder}/results.json`, JSON.stringify(report, null, 2));
async function check(name, run) { stage = name; await run(); report.checks.push(name); await persist(); console.log(`PASS: ${name}`); }
try {
  const accounts = real ? JSON.parse(await readFile(".tools/cloud-test-accounts.json", "utf8")) : { a: { email: "chapter-a@example.invalid", password: "LocalBrowserFixtureA1!" }, b: { email: "chapter-b@example.invalid", password: "LocalBrowserFixtureB2!" } };
  if (real) { assert.equal(accounts.disposableTestProject, true); assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${accounts.projectRef}.supabase.co`); }
  if (!real) {
    fixture = await startSupabaseFixture({ port: port + 1, appPort: port, quiet: true });
    provider = createServer(async (request, response) => {
      assert.equal(request.url, "/responses"); assert.equal(request.headers.authorization, undefined); providerCalls++;
      let raw = ""; for await (const chunk of request) raw += chunk;
      const input = JSON.parse(raw); assert.equal(input.model, "deepseek-flash"); assert.equal(input.stream, false);
      const context = JSON.parse(input.input[1].content); assert.equal(context.characters[0].name, "林舟"); assert.ok(context.previousChapter.content.includes("玻璃门"));
      const result = responseFixture(novelPlan(builderInput()));
      result.output[0].content[0].text = "林舟推开玻璃门，许青的声音从耳机中传来。她仍在上海档案馆。他只能预见未来二十四小时，绝不能越过那道界线。铜钥匙安静地躺在柜台上，编号十七。他们逐项核对今夜的记录，发现时间被人改动。封闭的房间里响起一声钟鸣。\n\n".repeat(10);
      await new Promise((resolve) => setTimeout(resolve, 2500)); response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(result));
    });
    await new Promise((resolve) => provider.listen(port + 2, "127.0.0.1", resolve));
    log = await open(`${folder}/server.log`, "a");
    child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: process.cwd(), windowsHide: true, stdio: ["ignore", log.fd, log.fd], env: { ...process.env,
        NODE_OPTIONS: `--require "${fileURLToPath(new URL("./provider-fixture-preload.cjs", import.meta.url)).replaceAll("\\", "/")}"`,
        NOVELAI_TEST_MODE: "1", NOVELAI_AI_FIXTURE: "1", NOVELAI_AI_FIXTURE_URL: `http://127.0.0.1:${port + 2}/responses`,
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port + 1}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "testanon-fixture-only",
        AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "fixture-only", DEEPSEEK_MODEL: "deepseek-flash", DEEPSEEK_PROXY_URL: "", OPENAI_API_KEY: "", OPENAI_PROXY_URL: "" },
    });
    for (let i = 0; ; i++) { try { if ((await fetch(base + "/login")).ok) break; } catch {} if (i > 90 || child.exitCode !== null) throw new Error("Test app not ready"); await new Promise((r) => setTimeout(r, 1000)); }
  }
  const clients = {}; const identities = {};
  for (const actor of ["a", "b"]) {
    clients[actor] = createClient(real ? process.env.NEXT_PUBLIC_SUPABASE_URL : `http://127.0.0.1:${port + 1}`, real ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : "testanon-fixture-only", { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await clients[actor].auth[real ? "signInWithPassword" : "signUp"]({ email: accounts[actor].email, password: accounts[actor].password }); assert.ifError(result.error); identities[actor] = result.data.user.id;
  }
  let seed;
  if (real) {
    seed = chapterFixtureRows(identities.a, 3000);
    for (const [table, row] of seed.rows) { const r = await clients.a.from(table).insert(row); assert.ifError(r.error); }
  } else seed = await seedChapterSql(fixture.db, identities.a, 1200);
  report.novelId = seed.novelId; report.chapterId = seed.chapterId; await persist();
  const chapterRow = async () => real ? (await clients.a.from("chapters").select("*").eq("id", seed.chapterId).single()).data : (await fixture.db.query("select * from chapters where id=$1", [seed.chapterId])).rows[0];
  const versions = async () => real ? (await clients.a.from("chapter_versions").select("*").eq("chapter_id", seed.chapterId)).data : (await fixture.db.query("select * from chapter_versions where chapter_id=$1", [seed.chapterId])).rows;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); ctx.setDefaultTimeout(45000);
  page = await ctx.newPage();
  page.on("pageerror", (e) => report.errors.push({ stage, message: e.message }));
  page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !(expectedFailure && m.text().includes("Failed to load resource"))) report.errors.push({ stage, message: m.text() }); });
  page.on("request", (r) => { if (r.url() === base + "/api/ai/chapters/generate") generateCalls++; if (["api.deepseek.com", "api.openai.com"].includes(new URL(r.url()).hostname)) report.errors.push({ stage, message: "Browser requested provider directly" }); });
  page.on("response", (r) => { if (r.status() >= 400 && !expectedFailure) report.errors.push({ stage, status: r.status(), path: new URL(r.url()).pathname }); });
  page.on("dialog", (d) => d.type() === "beforeunload" ? d.accept() : d.dismiss());
  async function login(actor, p = page) { await p.goto(base + "/login"); await p.getByLabel("邮箱", { exact: true }).fill(accounts[actor].email); await p.getByLabel("密码", { exact: true }).fill(accounts[actor].password); await p.getByRole("button", { name: "登录", exact: true }).click(); await p.waitForURL(base + "/dashboard"); }
  const api = (path, body, context = ctx) => context.request.post(base + path, { headers: { "Content-Type": "application/json", Origin: base }, data: body });
  const chapterPath = `/novel/${seed.novelId}/chapters?chapter=${seed.chapterId}`;
  await check("anonymous API requests are rejected before generation", async () => { for (const endpoint of ["generate", "confirm"]) assert.equal((await api(`/api/ai/chapters/${endpoint}`, {})).status(), 401); });
  await login("a"); await page.goto(base + chapterPath); await page.locator("#chapter-body:not([disabled])").waitFor();
  let preview;
  await check("generate button starts real route stages, prevents double clicks and renders preview without overwriting chapter", async () => {
    const start = Date.now();
    const button = page.getByRole("button", { name: "生成本章", exact: true }); await button.click();
    await page.getByText("正在生成正文…", { exact: true }).waitFor({ timeout: 45000 });
    assert.equal(await button.isDisabled(), true); await button.evaluate((el) => el.click()); assert.equal(await page.locator("#chapter-body").isDisabled(), true);
    const concurrent = await api("/api/ai/chapters/generate", { requestId: randomUUID(), novelId: seed.novelId, chapterId: seed.chapterId, expectedRevision: 1 });
    assert.ok((await concurrent.text()).includes("AI_BUSY"));
    await page.getByRole("heading", { name: "AI 章节预览", exact: true }).waitFor({ timeout: 300000 });
    const stored = real ? (await clients.a.from("ai_chapter_previews").select("generation_id,content").eq("chapter_id", seed.chapterId).single()).data : (await fixture.db.query("select generation_id,content from ai_chapter_previews where chapter_id=$1", [seed.chapterId])).rows[0];
    assert.ok(stored, "No durable preview");
    const fields = "id,model,input_tokens,output_tokens,latency_ms,status,provider,generation_type,novel_id,chapter_id";
    const generation = real ? (await clients.a.from("ai_generation_logs").select(fields).eq("id", stored.generation_id).single()).data : (await fixture.db.query(`select ${fields} from ai_generation_logs where id=$1`, [stored.generation_id])).rows[0];
    preview = { generationId: stored.generation_id, content: stored.content, wordCount: [...stored.content.replace(/\s/g, "")].length };
    report.generationId = preview.generationId; report.generationLog = generation; report.latencyMs = Date.now() - start; report.wordCount = preview.wordCount; await persist();
    assert.equal(await page.locator("#generated-chapter-preview").inputValue(), preview.content); assert.equal((await chapterRow()).content, ""); assert.equal((await versions()).length, 0);
    assert.equal(generateCalls, 1); if (!real) assert.equal(providerCalls, 1);
    await writeFile(`${folder}/generated-chapter.txt`, preview.content); await page.screenshot({ path: `${folder}/preview.png` });
  });
  if (!real) await check("offline confirmation retains preview and offers safe retry", async () => {
    expectedFailure = true; await ctx.setOffline(true); await page.getByRole("button", { name: "确认保存正文", exact: true }).click();
    await page.getByText("网络异常，预览已保留，请重试保存。", { exact: true }).waitFor(); assert.equal(await page.locator("#generated-chapter-preview").inputValue(), preview.content); assert.equal((await chapterRow()).content, "");
    await ctx.setOffline(false); expectedFailure = false;
  });
  await check("confirm writes generated body and exactly one ai_generated version; repeated confirmation is idempotent", async () => {
    await page.getByRole("button", { name: "确认保存正文", exact: true }).click();
    await page.getByRole("heading", { name: "AI 章节预览", exact: true }).waitFor({ state: "hidden" });
    assert.equal(await page.locator("#chapter-body").inputValue(), preview.content);
    const row = await chapterRow(); assert.equal(row.content, preview.content); assert.equal(row.status, "generated"); assert.equal(row.word_count, preview.wordCount); assert.ok(row.revision > 1);
    const retries = await Promise.all([api("/api/ai/chapters/confirm", { generationId: preview.generationId }), api("/api/ai/chapters/confirm", { generationId: preview.generationId })]);
    for (const r of retries) assert.equal(r.status(), 200);
    const history = await versions(); assert.equal(history.length, 1); assert.equal(history[0].source, "ai_generated"); assert.equal(history[0].content, preview.content); report.versionId = history[0].id;
    await page.getByRole("button", { name: "版本记录", exact: true }).click(); await page.getByText(/^AI 生成 ·/).first().waitFor(); await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    await page.screenshot({ path: `${folder}/saved.png` });
  });
  await check("refresh and logout/login preserve body; existing-content button never pays for a second generation", async () => {
    await page.reload(); await page.locator("#chapter-body:not([disabled])").waitFor(); assert.equal(await page.locator("#chapter-body").inputValue(), preview.content);
    await page.getByRole("button", { name: "生成本章", exact: true }).click(); await page.getByText("本章已有正文，不能直接覆盖。重新生成功能将在后续阶段开放。", { exact: true }).waitFor(); assert.equal(generateCalls, 1);
    await page.getByRole("button", { name: "退出", exact: true }).click(); await page.waitForURL(base + "/"); await login("a"); await page.goto(base + chapterPath);
    await page.locator("#chapter-body:not([disabled])").waitFor(); assert.equal(await page.locator("#chapter-body").inputValue(), preview.content);
  });
  await check("B cannot generate A chapter or confirm A preview", async () => {
    const bc = await browser.newContext(); const bp = await bc.newPage(); await login("b", bp);
    const denied = await api("/api/ai/chapters/generate", { requestId: randomUUID(), novelId: seed.novelId, chapterId: seed.chapterId, expectedRevision: 1 }, bc); assert.ok((await denied.text()).includes("NOT_FOUND"));
    assert.equal((await api("/api/ai/chapters/confirm", { generationId: preview.generationId }, bc)).status(), 404);
    if (real) {
      for (const table of ["ai_chapter_previews", "ai_generation_logs"]) { const r = await clients.b.from(table).select(table === "ai_generation_logs" ? "id" : "generation_id").eq(table === "ai_generation_logs" ? "id" : "generation_id", preview.generationId); assert.ifError(r.error); assert.deepEqual(r.data, []); }
      const r = await clients.a.from("ai_generation_logs").select("id,generation_type,provider,model,status,input_tokens,output_tokens,latency_ms,novel_id,chapter_id,error_type").eq("id", preview.generationId).single(); assert.ifError(r.error); report.generationLog = r.data; assert.equal(r.data.status, "succeeded"); assert.equal(r.data.generation_type, "chapter_generation"); assert.equal(r.data.provider, "deepseek");
    }
    await bc.close();
  });
  assert.deepEqual(report.errors, []); report.status = "passed";
} catch (error) {
  report.status = "failed"; report.failedStage = stage; report.failure = { name: error.name, message: "Acceptance failed; request credentials and raw network errors omitted.", stackLocation: error.stack?.split("\n").find((line) => line.includes("browser-chapters.mjs:"))?.trim() }; console.error(`FAIL: ${stage}: ${error.name}`);
  await page?.screenshot({ path: `${folder}/failure.png`, fullPage: true }).catch(() => {}); process.exitCode = 1;
} finally {
  await persist(); await browser?.close();
  if (child) { const exit = new Promise((resolve) => child.once("exit", resolve)); child.kill(); await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 3000))]); }
  if (provider) await new Promise((resolve) => provider.close(resolve)); await fixture?.close(); await log?.close();
  console.log(`Evidence: ${folder}/results.json`);
}

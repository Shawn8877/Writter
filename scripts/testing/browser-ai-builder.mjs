// Entire browser workflow with isolated Auth/SQL + explicit OpenAI transport
// fixtures. No real API key is read, no request is sent to OpenAI.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile, open } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { startSupabaseFixture } from "./supabase-fixture.mjs";
import { novelPlan, responseFixture } from "./novel-builder-fixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const port = Number(process.env.AI_BROWSER_TEST_PORT || 43020);
const base = `http://127.0.0.1:${port}`;
const folder = `artifacts/phase3a/browser-fixture-${new Date().toISOString().replace(/[:.]/g, "-")}`;
await mkdir(folder, { recursive: true });
const report = { scope: "browser + Responses SDK with explicit OpenAI fixture + PGlite SQL; NOT real OpenAI or hosted Supabase", checks: [], errors: [], status: "running" };
const fixture = await startSupabaseFixture({ port: port + 1, appPort: port, quiet: true });
let providerMode = "success"; let providerCalls = 0;
const ai = createServer(async (request, response) => {
  assert.equal(request.url, "/responses"); assert.equal(request.headers.authorization, undefined);
  let raw = ""; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw); providerCalls++;
  assert.equal(body.text.format.type, "json_schema"); assert.equal(body.text.format.strict, true);
  await new Promise((resolve) => setTimeout(resolve, 400));
  response.setHeader("Content-Type", "application/json"); response.setHeader("x-request-id", "req_browser_fixture");
  if (providerMode === "rate") { response.statusCode = 429; return response.end(JSON.stringify({ error: { type: "rate_limit_error", message: "fixture rate limit" } })); }
  if (providerMode === "credits") { response.statusCode = 429; return response.end(JSON.stringify({ error: { type: "insufficient_quota", code: "credit_balance_exhausted", message: "fixture empty balance" } })); }
  const result = responseFixture(novelPlan(JSON.parse(body.input[1].content)));
  if (providerMode === "refusal") result.output[0].content = [{ type: "refusal", refusal: "fixture refusal" }];
  if (providerMode === "invalid") result.output[0].content[0].text = "{}";
  response.end(JSON.stringify(result));
});
await new Promise((resolve) => ai.listen(port + 2, "127.0.0.1", resolve));
const log = await open(`${folder}/server.log`, "a");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: root, windowsHide: true, stdio: ["ignore", log.fd, log.fd],
  env: { ...process.env, NODE_OPTIONS: `--require "${fileURLToPath(new URL("./openai-fixture-preload.cjs", import.meta.url)).replaceAll("\\", "/")}"`, NOVELAI_TEST_MODE: "1", NOVELAI_OPENAI_FIXTURE: "1", NOVELAI_OPENAI_FIXTURE_URL: `http://127.0.0.1:${port + 2}/responses`, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port + 1}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "testanon-fixture-only", OPENAI_API_KEY: "fixture-only-never-real", OPENAI_MODEL: "gpt-6.1-sol", OPENAI_PROXY_URL: "" },
});
let browser; let stage = "start"; let expectedFailure = false;
async function check(name, run) { stage = name; await run(); report.checks.push(name); await writeFile(`${folder}/results.json`, JSON.stringify(report, null, 2)); console.log(`PASS: ${name}`); }
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(base + "/login")).ok) break; } catch { /* Starting test server. */ }
    if (attempt > 90 || child.exitCode !== null) throw new Error("Fixture app did not become ready; inspect server.log");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(45000);
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push({ stage, message: error.message }));
  page.on("console", (message) => { if (["error", "warning"].includes(message.type()) && !(expectedFailure && message.text().includes("Failed to load resource"))) report.errors.push({ stage, message: message.text() }); });
  page.on("request", (request) => { if (request.url().includes("api.openai.com")) report.errors.push({ stage, message: "Browser attempted OpenAI request" }); });
  page.on("dialog", (dialog) => dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss());
  const api = async (path, data, actor = context) => { const r = await actor.request.fetch(base + path, { method: data ? "POST" : "GET", headers: { "Content-Type": "application/json", Origin: base }, data }); return { status: r.status(), data: await r.json() }; };
  const accounts = { a: { email: "builder-a@example.invalid", password: "FixturePasswordForLocalA1!" }, b: { email: "builder-b@example.invalid", password: "FixturePasswordForLocalB2!" } };
  for (const account of Object.values(accounts)) {
    const client = createClient(`http://127.0.0.1:${port + 1}`, "testanon-fixture-only", { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await client.auth.signUp(account); assert.ifError(error);
  }
  async function login(actor, p = page) {
    await p.goto(base + "/login"); await p.getByLabel("邮箱", { exact: true }).fill(accounts[actor].email); await p.getByLabel("密码", { exact: true }).fill(accounts[actor].password); await p.getByRole("button", { name: "登录", exact: true }).click(); await p.waitForURL(base + "/dashboard");
  }
  await check("build and confirm API reject anonymous sessions", async () => {
    for (const path of ["/api/ai/novels/build", "/api/novels/ai-confirm"]) assert.equal((await api(path, {})).status, 401);
  });
  await check("login and registration cannot submit credentials before JavaScript is ready", async () => {
    const noScript = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await noScript.newPage();
    for (const path of ["/login", "/register"]) {
      await staticPage.goto(base + path);
      assert.equal(await staticPage.locator("form").getAttribute("method"), "post");
      assert.equal(await staticPage.getByLabel("密码", { exact: true }).isDisabled(), true);
      assert.equal(await staticPage.locator("button[type=submit]").isDisabled(), true);
      assert.equal(new URL(staticPage.url()).search, "");
    }
    await noScript.close();
  });
  await login("a");
  let preview, novelId;
  await check("urban input generates structured preview without creating any novel; repeat clicks disabled", async () => {
    await page.goto(base + "/create"); await page.getByRole("button", { name: "都市", exact: true }).click();
    await page.locator("#idea").fill("一个医疗器械销售靠专业知识创业，不要超能力。"); await page.locator("#targetChapters").fill("100");
    const response = page.waitForResponse((r) => r.url() === base + "/api/ai/novels/build");
    await page.getByRole("button", { name: "AI 构建小说", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "正在构建…", exact: true }).isDisabled(), true);
    preview = await (await response).json();
    await page.getByRole("heading", { name: "AI 小说方案预览", exact: true }).waitFor();
    assert.equal((await api("/api/novels")).data.novels.length, 0); assert.equal(providerCalls, 1); assert.equal(preview.plan.powerSystem.enabled, false);
    await page.screenshot({ path: `${folder}/preview-desktop.png`, fullPage: true });
  });
  await check("regenerate asks first; failure preserves current preview and manual edits", async () => {
    await page.locator("#plan-title").fill("人工修改 · 微光之路");
    await page.getByRole("button", { name: "重新生成", exact: true }).click(); await page.getByRole("button", { name: "继续查看", exact: true }).click(); assert.equal(providerCalls, 1);
    providerMode = "refusal"; expectedFailure = true;
    await page.getByRole("button", { name: "重新生成", exact: true }).click(); await page.getByRole("button", { name: "生成新的完整方案", exact: true }).click();
    await page.getByText("AI 无法按当前创意构建方案，请调整创意后重试。", { exact: true }).waitFor();
    assert.equal(await page.locator("#plan-title").inputValue(), "人工修改 · 微光之路"); assert.equal(providerCalls, 2); expectedFailure = false;
    providerMode = "success";
  });
  await check("mobile preview stays inside viewport and exposes required editable fields", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    for (const key of ["title", "synopsis", "corePremise", "mainConflict", "endingDirection"]) assert.equal(await page.locator(`#plan-${key}`).isEditable(), true);
    await page.screenshot({ path: `${folder}/preview-mobile.png` }); await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check("failed cloud confirmation preserves preview; retry atomically creates one bundle", async () => {
    await fetch(`http://127.0.0.1:${port + 1}/__fixture/fail-next`, { method: "POST", body: JSON.stringify({ path: "/rest/v1/rpc/create_ai_novel_bundle", count: 1, status: 503 }) });
    expectedFailure = true;
    await page.getByRole("button", { name: "确认创建", exact: true }).click(); await page.getByText("云端保存暂时失败，请保留当前预览后重试。", { exact: true }).waitFor();
    assert.equal((await api("/api/novels")).data.novels.length, 0); expectedFailure = false;
    await page.locator("#plan-mainConflict").fill("在诚信与生存之间建立新的合作规则。");
    const saved = page.waitForResponse((r) => r.url() === base + "/api/novels/ai-confirm");
    await page.getByRole("button", { name: "确认创建", exact: true }).click();
    novelId = (await (await saved).json()).novelId; await page.waitForURL(base + `/novel/${novelId}`);
    await page.getByRole("main").getByRole("heading", { name: "人工修改 · 微光之路", exact: true }).waitFor();
    const duplicate = await api("/api/novels/ai-confirm", { generationId: preview.generationId, input: preview.input, plan: preview.plan }); assert.equal(duplicate.status, 200); assert.equal(duplicate.data.novelId, novelId);
    assert.equal((await api("/api/novels")).data.novels.length, 1);
  });
  await check("characters, world, memory, Bible, story stages and empty chapter are available immediately", async () => {
    const novel = (await api(`/api/novels/${novelId}`)).data.novel;
    assert.equal(novel.characters.length, 6); assert.equal(novel.world.length, 8); assert.equal(novel.memory.entries.length, 12); assert.equal(novel.outline.storyStages.length, 10); assert.equal(novel.chapters[0].body, ""); assert.ok(novel.bible.protagonistArc.startsWith("林舟"));
    for (const path of ["characters", "world", "memory", "outline", "timeline", "chapters"]) {
      assert.equal((await page.goto(base + `/novel/${novelId}/${path}`)).status(), 200);
      if (path === "characters") await page.getByRole("heading", { name: "林舟", exact: true }).waitFor();
      if (path === "world") await page.getByRole("heading", { name: "旧街工作室", exact: true }).waitFor();
      if (path === "outline") { await page.getByRole("button", { name: "故事阶段", exact: true }).click(); await page.getByRole("heading", { name: "成长阶段 10", exact: true }).waitFor(); }
      await page.screenshot({ path: `${folder}/${path}.png`, fullPage: true });
    }
    await page.goto(base + `/novel/${novelId}`);
    await page.getByText("完整核心设定与创作约束", { exact: true }).click();
    await page.getByText(novel.bible.endingDirection, { exact: true }).waitFor();
    await page.getByText(novel.bible.forbiddenChanges[0], { exact: true }).waitFor();
    await page.screenshot({ path: `${folder}/overview.png`, fullPage: true });
  });
  await check("B cannot access or confirm A preview and novel", async () => {
    const other = await browser.newContext(); const otherPage = await other.newPage(); await login("b", otherPage);
    assert.equal((await api(`/api/novels/${novelId}`, undefined, other)).status, 404);
    assert.equal((await api("/api/novels/ai-confirm", { generationId: preview.generationId, input: preview.input, plan: preview.plan }, other)).status, 404);
    assert.equal((await api("/api/novels", undefined, other)).data.novels.length, 0); await other.close();
  });
  await check("cancel discards only preview, keeps form and previously saved novel", async () => {
    await page.goto(base + "/create"); await page.locator("#idea").fill("另一个尚未保存的故事。");
    await page.getByRole("button", { name: "AI 构建小说", exact: true }).click(); await page.getByRole("heading", { name: "AI 小说方案预览", exact: true }).waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click(); await page.getByRole("button", { name: "丢弃预览", exact: true }).click();
    assert.equal(await page.locator("#idea").inputValue(), "另一个尚未保存的故事。"); assert.equal((await api("/api/novels")).data.novels.length, 1);
  });
  await check("rate-limit, exhausted credits and invalid structured output are honest errors with no new novel", async () => {
    expectedFailure = true;
    for (const [mode, message] of [["rate", "AI 服务繁忙或额度不足，请稍后重试。"], ["invalid", "AI 返回的方案不够完整，请重新生成。"], ["credits", "OpenAI API 余额不足，请管理员充值后再试。"]]) {
      providerMode = mode; await page.getByRole("button", { name: "AI 构建小说", exact: true }).click(); await page.getByText(message, { exact: true }).waitFor();
      assert.equal((await api("/api/novels")).data.novels.length, 1);
    }
    expectedFailure = false;
  });
  await check("ordinary manual creation remains usable even when AI fails", async () => {
    await page.getByRole("button", { name: "创建小说", exact: true }).click(); await page.waitForURL(/\/novel\/[a-f0-9-]+$/);
    const result = (await api("/api/novels")).data.novels; assert.equal(result.length, 2); assert.equal(result.find((item) => item.id !== novelId).characters.length, 0);
  });
  assert.deepEqual(report.errors, []); report.status = "passed";
} catch (error) { report.status = "failed"; report.failure = { stage, message: error.message }; await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: `${folder}/failure.png` }); throw error; }
finally {
  await writeFile(`${folder}/results.json`, JSON.stringify(report, null, 2));
  await browser?.close(); child.kill();
  await new Promise((resolve) => ai.close(resolve)); await fixture.close(); await log.close();
}

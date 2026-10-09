// Hosted Supabase/browser acceptance. Default uses a clearly labelled plan
// fixture. --real-ai opts into exactly one paid build through the actual route.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { generatePreview } from "../../src/lib/ai/services/builder-workflow.js";
import { novelPlan } from "./novel-builder-fixtures.mjs";

assert.ok(process.argv.includes("--allow-cloud-test-writes"), "Explicit cloud test-write opt-in required");
nextEnv.loadEnvConfig(process.cwd(), true);
const realAI = process.argv.includes("--real-ai");
if (realAI) assert.ok(process.env.DEEPSEEK_API_KEY?.trim(), "DEEPSEEK_API_KEY is not configured; no real AI request was made");
const settings = JSON.parse(await readFile(".tools/cloud-test-accounts.json", "utf8"));
assert.equal(settings.disposableTestProject, true); assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${settings.projectRef}.supabase.co`);
const base = process.env.NOVELAI_BROWSER_BASE || "http://localhost:3000";
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const folder = `artifacts/phase3a/browser-cloud-${new Date().toISOString().replace(/[:.]/g, "-")}`;
await mkdir(folder, { recursive: true });
const report = { status: "running", realOpenAI: false, realDeepSeek: realAI, provider: "deepseek", scope: realAI ? "one real DeepSeek build + browser + hosted Supabase" : "explicit generated-plan fixture + browser + hosted Supabase; NOT real AI", projectRef: settings.projectRef, checks: [], errors: [] };
const clients = {};
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
let expectedFailure = false; let stage = "login";
async function check(name, run) { stage = name; await run(); report.checks.push(name); await writeFile(`${folder}/results.json`, JSON.stringify(report, null, 2)); console.log(`PASS: ${name}`); }
try {
  for (const actor of ["a", "b"]) {
    clients[actor] = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await clients[actor].auth.signInWithPassword({ email: settings[actor].email, password: settings[actor].password }); assert.ifError(error);
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); ctx.setDefaultTimeout(45000);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => report.errors.push({ stage, message: e.message }));
  page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !(expectedFailure && m.text().includes("Failed to load resource"))) report.errors.push({ stage, message: m.text() }); });
  page.on("request", (r) => { if (["api.openai.com", "api.deepseek.com"].includes(new URL(r.url()).hostname)) report.errors.push({ stage, message: "AI provider requested from browser" }); });
  page.on("dialog", (d) => d.type() === "beforeunload" ? d.accept() : d.dismiss());
  const api = async (path, body, context = ctx) => { const response = await context.request.fetch(base + path, { method: body ? "POST" : "GET", headers: { Origin: base, "Content-Type": "application/json" }, data: body }); return { status: response.status(), data: await response.json() }; };
  async function login(actor, p) { await p.goto(base + "/login"); await p.getByLabel("邮箱", { exact: true }).fill(settings[actor].email); await p.getByLabel("密码", { exact: true }).fill(settings[actor].password); await p.getByRole("button", { name: "登录", exact: true }).click(); await p.waitForURL(base + "/dashboard"); }
  await login("a", page); await page.goto(base + "/create");
  await page.getByRole("button", { name: "都市", exact: true }).click(); await page.locator("#idea").fill("一个普通医疗器械销售靠行业知识、团队合作和真实客户需求逐步创业。不设置超能力。");
  await page.locator("#targetChapters").fill("100"); await page.locator("#targetWords").fill("300000"); await page.locator("#wordsPerChapter").fill("3000");
  if (!realAI && !process.env.DEEPSEEK_API_KEY?.trim()) await check("real build endpoint honestly reports missing key without creating a novel", async () => {
    expectedFailure = true;
    await page.getByRole("button", { name: "AI 构建小说", exact: true }).click(); await page.getByText("AI 服务尚未配置，请管理员在服务器设置 DeepSeek 密钥。", { exact: true }).waitFor(); expectedFailure = false;
  });
  let preview; let buildCalls = 0;
  if (!realAI) await page.route(base + "/api/ai/novels/build", async (route) => {
    buildCalls++;
    try {
      const data = await generatePreview(clients.a, route.request().postDataJSON(), { getConfig: () => ({ model: "fixture-only-cloud-acceptance" }), build: async (input) => ({ plan: novelPlan(input), model: "fixture-only-cloud-acceptance", inputTokens: 1200, outputTokens: 5800 }) });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    } catch (error) { await route.fulfill({ status: error.status || 500, contentType: "application/json", body: JSON.stringify({ error: error.message, code: error.code }) }); }
  });
  const before = (await api("/api/novels")).data.novels.length;
  await check(realAI ? "one real DeepSeek build renders editable preview" : "explicit plan fixture renders preview; hosted generation log exists but no novel yet", async () => {
    const started = Date.now(); const received = page.waitForResponse((r) => r.url() === base + "/api/ai/novels/build", { timeout: 300000 });
    await page.getByRole("button", { name: "AI 构建小说", exact: true }).click(); const response = await received;
    const data = await response.json();
    if (response.status() !== 200) report.buildError = { status: response.status(), code: data.code, requestId: data.requestId };
    assert.equal(response.status(), 200, `Build failed: ${data.code || response.status()}`); preview = data; report.generationId = preview.generationId; report.usage = preview.usage; report.latencyMs = Date.now() - started;
    await page.getByRole("heading", { name: "AI 小说方案预览", exact: true }).waitFor();
    assert.equal(preview.plan.powerSystem.enabled, false); assert.equal((await api("/api/novels")).data.novels.length, before);
    const log = await clients.a.from("ai_generation_logs").select("id,status,model,input_tokens,output_tokens").eq("id", preview.generationId).single(); assert.ifError(log.error); assert.equal(log.data.status, "succeeded"); report.generationLog = log.data;
    await page.screenshot({ path: `${folder}/preview.png` });
  });
  let novelId; const editedTitle = `Phase 3A ${realAI ? "真实 AI" : "样例"}验收 · ${new Date().toISOString().slice(0, 10)}`;
  await check("edit preview, confirm through real API, open new workspace without reload", async () => {
    await page.locator("#plan-title").fill(editedTitle); await page.locator("#plan-endingDirection").fill("团队建立长期合作规则，人物完成成长并保留未来空间。");
    const response = page.waitForResponse((r) => r.url() === base + "/api/novels/ai-confirm"); await page.getByRole("button", { name: "确认创建", exact: true }).click();
    const saved = await response; assert.equal(saved.status(), 200); novelId = (await saved.json()).novelId; report.novelId = novelId;
    await page.waitForURL(base + `/novel/${novelId}`); await page.getByRole("main").getByRole("heading", { name: editedTitle, exact: true }).waitFor(); await page.screenshot({ path: `${folder}/overview.png`, fullPage: true });
  });
  await check("hosted relational data, Bible, memory and story stages are correct", async () => {
    const n = (await api(`/api/novels/${novelId}`)).data.novel;
    assert.equal(n.title, editedTitle); assert.ok(n.characters.length >= 6); assert.ok(n.world.some((w) => w.categoryCode === "location")); assert.ok(n.world.every((w) => w.categoryCode !== "system")); assert.equal(n.memory.entries.length, preview.plan.seedMemories.length);
    assert.equal(n.bible.endingDirection, "团队建立长期合作规则，人物完成成长并保留未来空间。"); assert.ok(n.bible.protagonistArc.startsWith(preview.plan.protagonist.name)); assert.equal(n.outline.storyStages.length, preview.plan.storyStages.length); assert.equal(n.outline.storyStages.at(-1).approxEndChapter, 100);
    assert.equal(n.chapters.length, 1); assert.equal(n.chapters[0].body, ""); assert.equal(n.chapters[0].status, "待创作"); assert.ok(n.memory.entries.some((m) => m.type === "character" && m.content.includes(preview.plan.protagonist.name)));
    for (const path of ["characters", "world", "memory", "outline", "timeline", "chapters"]) {
      assert.equal((await page.goto(base + `/novel/${novelId}/${path}`)).status(), 200);
      if (path === "characters") await page.getByRole("heading", { name: preview.plan.protagonist.name, exact: true }).waitFor();
      if (path === "outline") { await page.getByRole("button", { name: "故事阶段", exact: true }).click(); await page.getByRole("heading", { name: preview.plan.storyStages.at(-1).title, exact: true }).waitFor(); }
      await page.screenshot({ path: `${folder}/${path}.png` });
    }
  });
  await check("concurrent repeated confirmation creates no duplicates and cannot overwrite edits", async () => {
    const body = { generationId: preview.generationId, input: preview.input, plan: preview.plan };
    const retries = await Promise.all([api("/api/novels/ai-confirm", body), api("/api/novels/ai-confirm", body)]);
    for (const retry of retries) { assert.equal(retry.status, 200); assert.equal(retry.data.novelId, novelId); }
    assert.equal((await api("/api/novels")).data.novels.length, before + 1); assert.equal((await api(`/api/novels/${novelId}`)).data.novel.title, editedTitle);
  });
  await check("real B session cannot read A data, logs or receipt; cannot confirm A generation", async () => {
    const other = await browser.newContext(); const otherPage = await other.newPage(); await login("b", otherPage);
    assert.equal((await api(`/api/novels/${novelId}`, undefined, other)).status, 404);
    assert.equal((await api("/api/novels/ai-confirm", { generationId: preview.generationId, input: preview.input, plan: preview.plan }, other)).status, 404);
    for (const [table, column, id] of [["ai_generation_logs", "id", preview.generationId], ["ai_novel_bundles", "generation_id", preview.generationId], ["novel_bible", "novel_id", novelId], ["characters", "novel_id", novelId], ["world_entries", "novel_id", novelId], ["memory_items", "novel_id", novelId]]) {
      const result = await clients.b.from(table).select(column).eq(column, id); assert.ifError(result.error); assert.deepEqual(result.data, []);
    }
    assert.ok((await clients.a.from("ai_generation_logs").select("lease_token").eq("id", preview.generationId)).error);
    assert.ok((await clients.a.from("ai_generation_logs").delete().eq("id", preview.generationId)).error);
    await other.close();
  });
  if (!realAI) assert.equal(buildCalls, 1);
  assert.deepEqual(report.errors, []); report.status = "passed";
} catch (error) { report.status = "failed"; report.failure = { stage, message: error.message }; throw error; }
finally {
  await writeFile(`${folder}/results.json`, JSON.stringify(report, null, 2)); await browser.close();
  for (const client of Object.values(clients)) await client.auth.signOut({ scope: "local" });
}

// Run against the disposable fixture, never a production Supabase project.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const base = "http://127.0.0.1:43000";
const fixture = "http://127.0.0.1:43001";
const health = await fetch(`${fixture}/__fixture/health`).then((r) => r.json());
assert.equal(health.testOnly, true);
await mkdir("artifacts/phase2", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(60000);
const page = await context.newPage();
const checks = [], errors = [];
let expectedNetworkFailure = false;
function observe(p) {
  p.on("pageerror", (error) => errors.push(error.message));
  p.on("console", (message) => { if (message.type() === "error" && !expectedNetworkFailure) errors.push(message.text()); });
  p.on("dialog", (dialog) => dialog.accept());
}
observe(page);
const pass = (name) => { checks.push(name); console.log(`PASS: ${name}`); };
async function go(path, p = page) { await p.goto(`${base}${path}`, { waitUntil: "domcontentloaded" }); }
async function visible(locator) { await locator.waitFor({ state: "visible" }); }
async function saveModal(p = page) { await p.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click(); await p.getByRole("dialog").waitFor({ state: "hidden" }); }
async function api(path, options = {}, p = page) {
  return p.evaluate(async ({ path, options }) => {
    const r = await fetch(path, { ...options, headers: { "Content-Type": "application/json" } });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  }, { path, options });
}
async function saved(p = page) { await p.waitForFunction(() => document.querySelector(".editor-save-status")?.textContent === "已保存"); }
const email = `author-${Date.now()}@example.test`, password = "FixturePass123!";
let novelId;
try {
  for (const path of ["/dashboard", "/create", "/novel/11111111-1111-4111-8111-111111111111/chapters"]) {
    await go(path); assert.match(page.url(), /\/login/);
  }
  pass("anonymous protected routes redirect to login");
  await go("/register");
  await page.getByLabel("笔名").fill("验收作者");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await page.waitForURL(`${base}/dashboard`);
  await visible(page.getByRole("heading", { name: "每一个世界，都从这里生长。" }));
  pass("register establishes SSR session and dashboard");
  await go("/create");
  await page.locator("#idea").fill("一个守塔人在失去时间的城市里寻找最后一段记忆。");
  await page.locator("#protagonist").fill("守塔人林舟，冷静而坚韧。");
  await page.getByRole("button", { name: "创建小说", exact: true }).click();
  await page.waitForURL(/\/novel\/[0-9a-f-]{36}$/);
  novelId = page.url().split("/").pop();
  await visible(page.getByRole("heading", { name: "作品概览" }));
  await page.getByRole("button", { name: "编辑作品", exact: true }).click();
  await page.getByLabel("小说书名").fill("验收·失时之城"); await saveModal();
  await page.getByRole("button", { name: "编辑设定", exact: true }).click();
  await page.getByLabel("核心冲突").fill("记忆与时间的交换。"); await saveModal();
  await page.reload(); await visible(page.getByRole("main").getByRole("heading", { name: "验收·失时之城", exact: true }));
  pass("create UUID novel, bible, volume, chapter and refresh persistence");

  await go(`/novel/${novelId}/characters`);
  await page.getByRole("button", { name: "新增人物", exact: true }).click();
  await page.getByLabel("人物姓名").fill("林舟");
  await page.getByLabel("当前状态", { exact: true }).fill("刚刚抵达钟楼"); await saveModal();
  await visible(page.getByRole("button", { name: "编辑人物 林舟", exact: true }));
  await go(`/novel/${novelId}/world`);
  await page.getByRole("button", { name: "新增世界设定", exact: true }).click();
  await page.getByLabel("设定名称").fill("失时法则");
  await page.getByLabel("设定内容").fill("每敲响一次钟声，城市失去一段记忆。"); await saveModal();
  await go(`/novel/${novelId}/timeline`);
  await page.getByRole("button", { name: "新增事件", exact: true }).click();
  await page.getByLabel("故事内时间").fill("旧历元年");
  await page.getByLabel("事件名称").fill("第一次钟响"); await saveModal();
  await go(`/novel/${novelId}/outline`);
  await page.getByRole("button", { name: "编写总纲", exact: true }).click();
  await page.getByRole("dialog").getByLabel("小说总纲").fill("林舟发现遗忘的真相，并尝试修复城市。"); await saveModal();
  pass("characters, world, timeline and outline forms persist");

  await go(`/novel/${novelId}/chapters`); await saved();
  const firstChapter = (await api(`/api/novels/${novelId}`)).data.novel.chapters[0].id;
  const body = "风穿过钟楼，林舟在旧钟上找到自己的名字。";
  let saves = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/chapters/")) saves++; });
  await page.getByLabel("章节正文", { exact: true }).fill(body);
  const draftStored = await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("novelai-studio:chapter-draft:v2:") && localStorage[key].includes("旧钟")));
  assert.equal(draftStored, true); await saved(); assert.equal(saves, 1);
  assert.equal((await api(`/api/chapters/${firstChapter}/versions?novelId=${novelId}`)).data.versions.length, 0);
  await page.getByRole("button", { name: "保存版本", exact: true }).click(); await saved();
  await page.getByRole("button", { name: "版本记录", exact: true }).click();
  await visible(page.locator(".chapter-version-body")); assert.equal(await page.locator(".chapter-version-body").textContent(), body);
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page.getByRole("button", { name: "章节摘要", exact: true }).click();
  await page.locator("#chapter-summary").fill("林舟在钟楼发现自己的名字。"); await saved();
  await page.reload(); await saved(); assert.equal(await page.locator("#chapter-body").inputValue(), body);
  const state = (await api(`/api/novels/${novelId}`)).data.novel;
  assert.equal(state.memory.chapterSummaries[0].summary, "林舟在钟楼发现自己的名字。");
  assert.equal(state.stats.wordCount, body.replace(/\s/g, "").length);
  pass("immediate local cache, debounce autosave, refresh, summary, DB stats and explicit version");

  await page.getByRole("button", { name: "新增章节", exact: true }).first().click();
  await page.getByRole("dialog").getByLabel("章节标题").fill("第二次钟响"); await saveModal(); await saved();
  assert.equal(await page.locator("#chapter-title").inputValue(), "第二次钟响");
  pass("new chapter persists and selects correct editor");
  await go(`/novel/${novelId}/memory`);
  await page.getByRole("button", { name: "新增记忆", exact: true }).click();
  await page.getByLabel("记忆标题").fill("钟声的秘密");
  await page.getByLabel("记忆类型").selectOption("secret");
  await page.getByLabel("记忆内容").fill("林舟的名字出现在旧钟上。");
  await page.getByLabel("资料来源").selectOption(`chapter:${firstChapter}`); await saveModal();
  await visible(page.getByRole("heading", { name: "钟声的秘密" }));
  await page.getByRole("button", { name: "编辑记忆 钟声的秘密" }).click();
  await page.getByLabel("重要程度").selectOption("5");
  await page.getByLabel("记忆状态").selectOption("resolved"); await saveModal();
  await page.locator(".memory-source a").click(); await saved();
  assert.equal(await page.locator("#chapter-body").inputValue(), body);
  pass("memory create/edit, type/state/importance and source chapter link");

  // A second tab retains an old chapter revision and must not overwrite tab A.
  const other = await context.newPage(); observe(other);
  await go(`/novel/${novelId}/chapters?chapter=${firstChapter}`, other); await saved(other);
  await page.locator("#chapter-body").fill(body + "云端新内容。"); await saved();
  expectedNetworkFailure = true;
  await other.locator("#chapter-body").fill("另一标签页的旧版本草稿。");
  await visible(other.getByText("发现云端版本冲突", { exact: true }));
  assert.equal((await api(`/api/novels/${novelId}`)).data.novel.chapters[0].body, body + "云端新内容。");
  await other.close(); expectedNetworkFailure = false;
  pass("two tabs conflict without overwriting cloud body");

  // Simulate a failed save, then refresh while offline draft remains recoverable.
  expectedNetworkFailure = true;
  await page.route("**/api/chapters/*", (route) => route.request().method() === "POST" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Injected offline save" }) }) : route.continue());
  await page.locator("#chapter-body").fill("断网时写下的段落，刷新后仍应恢复。");
  await visible(page.getByText("保存失败，本地草稿已保留", { exact: true }));
  await page.reload();
  await visible(page.getByText("保存失败，本地草稿已保留", { exact: true }));
  assert.equal(await page.locator("#chapter-body").inputValue(), "断网时写下的段落，刷新后仍应恢复。");
  await page.unroute("**/api/chapters/*");
  await page.getByRole("button", { name: "重试保存", exact: true }).click(); await saved();
  expectedNetworkFailure = false;
  pass("failed save retains draft through refresh and retries successfully");

  for (const [path, name] of [["", "overview"], ["/outline", "outline"], ["/characters", "characters"], ["/world", "world"], ["/timeline", "timeline"], ["/chapters", "chapters"], ["/memory", "memory"]]) {
    await go(`/novel/${novelId}${path}`); await visible(page.locator(".page-heading h1"));
    if (path === "/chapters") await saved();
    await page.screenshot({ path: `artifacts/phase2/${name}-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `mobile overflow ${path}`);
    if (path === "/chapters" || path === "/memory") await page.screenshot({ path: `artifacts/phase2/${name}-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  pass("all novel routes and mobile viewport have no horizontal overflow");
  await go(`/novel/${novelId}/memory`);
  await page.getByRole("button", { name: "删除记忆 钟声的秘密" }).click();
  await page.getByRole("button", { name: "确认删除记忆" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal((await api(`/api/novels/${novelId}`)).data.novel.memory.entries.length, 0);
  pass("memory delete confirmation persists");

  await go("/dashboard");
  await page.getByRole("button", { name: "退出", exact: true }).click(); await page.waitForURL(base + "/");
  await go("/dashboard"); assert.match(page.url(), /\/login/);
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click(); await page.waitForURL(`${base}/dashboard`);
  await visible(page.getByRole("heading", { name: "验收·失时之城" }));
  pass("logout blocks protected routes; login restores cloud work");

  const accountB = await browser.newContext(); const b = await accountB.newPage(); observe(b);
  await go("/register", b);
  await b.getByLabel("邮箱", { exact: true }).fill(`other-${Date.now()}@example.test`);
  await b.getByLabel("密码", { exact: true }).fill(password); await b.getByLabel("确认密码", { exact: true }).fill(password);
  await b.getByRole("button", { name: "创建账号", exact: true }).click(); await b.waitForURL(`${base}/dashboard`);
  expectedNetworkFailure = true;
  assert.equal((await api(`/api/novels/${novelId}`, {}, b)).status, 404);
  assert.equal((await api(`/api/novels/${novelId}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: 1, novel: { title: "越权修改" } }) }, b)).status, 404);
  assert.equal((await api(`/api/novels/${novelId}`, { method: "DELETE", body: JSON.stringify({ expectedRevision: 1 }) }, b)).status, 404);
  assert.equal((await api(`/api/chapters/${firstChapter}`, { method: "POST", body: JSON.stringify({ novelId, expectedRevision: 1, values: { title: "越权", outline: "", body: "越权正文", summary: "" } }) }, b)).status, 404);
  assert.equal((await api(`/api/chapters/${firstChapter}/versions?novelId=${novelId}`, {}, b)).status, 404);
  const denied = await b.goto(`${base}/novel/${novelId}`);
  // Next.js documents HTTP 200 for streamed notFound(); API denial and absence
  // of protected data are asserted independently of the HTML envelope status.
  assert.ok([200, 404].includes(denied.status()));
  await visible(b.getByRole("heading", { name: "这一页，还没有故事。" }));
  assert.equal(await b.getByText("验收·失时之城", { exact: true }).count(), 0);
  assert.equal(await b.locator(".studio-shell").count(), 0);
  await accountB.close(); expectedNetworkFailure = false;
  pass("another account denied by server API and protected layout");
  await page.getByRole("button", { name: "删除小说 验收·失时之城" }).click();
  await page.getByRole("button", { name: "保留作品" }).click();
  assert.equal((await api(`/api/novels/${novelId}`)).status, 200);
  await page.getByRole("button", { name: "删除小说 验收·失时之城" }).click();
  await page.getByRole("button", { name: "确认删除小说", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal((await api("/api/novels")).data.novels.length, 0);
  pass("cancel and confirm novel deletion with dependent cascade");
  assert.deepEqual(errors, [], "unexpected browser console errors");
  pass("no unexpected browser console or page errors");
} catch (error) {
  console.error(error);
  await page.screenshot({ path: "artifacts/phase2/failure.png", fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile("artifacts/phase2/browser-results.json", JSON.stringify({ checks, errors, passed: !process.exitCode, note: "Auth/PostgREST local fixture, real application and PostgreSQL migration; hosted Supabase not tested." }, null, 2));
  await browser.close();
}

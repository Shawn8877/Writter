// Regression scenarios for races and legacy import in the disposable fixture.
import assert from "node:assert/strict";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const sampleSource = await readFile(new URL("../../src/lib/mock/novels.js", import.meta.url), "utf8");
const { demoNovels } = await import(`data:text/javascript;base64,${Buffer.from(sampleSource).toString("base64")}`);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const base = "http://127.0.0.1:43000";
assert.equal((await fetch("http://127.0.0.1:43001/__fixture/health").then((r) => r.json())).testOnly, true);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(45000);
const page = await context.newPage(), checks = [], errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("dialog", (dialog) => dialog.accept());
const pass = (name) => { checks.push(name); console.log(`PASS: ${name}`); };
const saved = () => page.waitForFunction(() => document.querySelector(".editor-save-status")?.textContent === "已保存");
async function api(path, options = {}) {
  return page.evaluate(async ({ path, options }) => { const r = await fetch(path, { ...options, headers: { "Content-Type": "application/json" } }); return { status: r.status, data: await r.json().catch(() => ({})) }; }, { path, options });
}
async function holdNextSave() {
  let release, reached;
  const gate = new Promise((resolve) => { release = resolve; });
  const arrived = new Promise((resolve) => { reached = resolve; });
  let intercepted = false;
  const handler = async (route) => {
    if (intercepted || route.request().method() !== "POST") return route.continue();
    intercepted = true;
    const response = await route.fetch();
    reached(); await gate; await route.fulfill({ response });
  };
  await page.route("**/api/chapters/*", handler);
  return { arrived, release, remove: () => page.unroute("**/api/chapters/*", handler) };
}
try {
  await page.goto(base + "/register");
  await page.getByLabel("邮箱", { exact: true }).fill(`edge-${Date.now()}@example.test`);
  await page.getByLabel("密码", { exact: true }).fill("FixturePass123!");
  await page.getByLabel("确认密码", { exact: true }).fill("FixturePass123!");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await page.waitForURL(base + "/dashboard");
  const created = await api("/api/novels", { method: "POST", body: JSON.stringify({ title: "并发测试", genre: "玄幻", style: "细腻沉浸", idea: "检验保存期间继续写作", protagonist: "林舟", targetWords: 100000, targetChapters: 50, wordsPerChapter: 2000 }) });
  assert.equal(created.status, 201);
  const novelId = created.data.novel.id, chapterId = created.data.novel.chapters[0].id;
  await page.goto(`${base}/novel/${novelId}/chapters`); await saved();
  let modelRequests = 0;
  page.on("request", (request) => { if (request.url().includes("/api/ai") || request.url().includes("api.openai.com")) modelRequests++; });
  for (const name of ["生成本章", "生成下一章", "重新生成", "扩写", "润色", "修改剧情"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.locator(".toast").filter({ hasText: `「${name}」尚未接入 AI` }).waitFor();
  }
  assert.equal(modelRequests, 0);
  pass("all six chapter AI actions remain UI placeholders with no model requests");
  let held = await holdNextSave();
  await page.locator("#chapter-body").fill("发送中的第一段。"); await held.arrived;
  await page.locator("#chapter-body").fill("发送之后继续输入的完整段落。");
  held.release(); await saved(); await held.remove();
  assert.equal((await api(`/api/novels/${novelId}`)).data.novel.chapters[0].body, "发送之后继续输入的完整段落。");
  pass("new keystrokes survive an earlier in-flight response and reach the database");

  // Start saving, leave the editor, open a form, and simulate another device.
  held = await holdNextSave();
  await page.locator("#chapter-body").fill("这段保存将晚于表单打开返回。"); await held.arrived;
  await page.getByRole("navigation", { name: "小说功能导航" }).getByRole("link", { name: "作品概览" }).click();
  await page.getByRole("button", { name: "编辑作品", exact: true }).click();
  const remote = (await api(`/api/novels/${novelId}`)).data.novel;
  const changed = await api(`/api/novels/${novelId}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: remote.revision, novel: { ...remote, title: "另一设备更新的书名" } }) });
  assert.equal(changed.status, 200);
  held.release();
  await page.locator(".identity-info h2").filter({ hasText: "另一设备更新的书名" }).waitFor();
  await held.remove();
  await page.getByRole("dialog").getByLabel("主角设定").fill("保留这次表单输入。");
  await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "小说内容在编辑期间发生了变化" }).waitFor();
  assert.equal(await page.getByRole("dialog").getByLabel("主角设定").inputValue(), "保留这次表单输入。");
  assert.equal((await api(`/api/novels/${novelId}`)).data.novel.title, "另一设备更新的书名");
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  pass("stale open form cannot use a refreshed revision to overwrite remote metadata");
  await page.goto(`${base}/novel/${novelId}/chapters?chapter=${chapterId}`); await saved();
  assert.equal(await page.locator("#chapter-body").inputValue(), "这段保存将晚于表单打开返回。");
  pass("save completion after editor unmount remains durable");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.ok((await page.getByRole("button", { name: "退出", exact: true }).boundingBox()).height <= 44);
    await page.screenshot({ path: `artifacts/phase2/chapters-mobile-${width}.png`, fullPage: true, caret: "initial" });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  pass("320px and 390px chapter layout keeps logout readable without overflow");

  await page.goto(base + "/dashboard");
  const original = JSON.stringify({ version: 1, novels: [demoNovels[0]] });
  await page.evaluate((text) => localStorage.setItem("novelai-studio:novels:v1", text), original);
  await page.getByRole("button", { name: "导入本地作品" }).click();
  await page.getByRole("button", { name: "确认导入当前账号" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const novels = (await api("/api/novels")).data.novels;
  const imported = novels.find((n) => n.title === demoNovels[0].title);
  assert.ok(imported); assert.notEqual(imported.id, demoNovels[0].id);
  assert.equal(imported.chapters.length, demoNovels[0].chapters.length);
  assert.deepEqual(imported.chapters.map((c) => c.body), demoNovels[0].chapters.map((c) => c.body));
  for (const entry of imported.memory.entries) if (entry.sourceType === "chapter") assert.ok(imported.chapters.some((c) => c.id === entry.sourceId));
  assert.equal(await page.evaluate(() => localStorage.getItem("novelai-studio:novels:v1")), original);
  await page.reload(); await page.getByRole("heading", { name: demoNovels[0].title, exact: true }).waitFor();
  pass("legacy import preserves original, remaps references and persists all chapter text");
  for (const novel of (await api("/api/novels")).data.novels) assert.equal((await api(`/api/novels/${novel.id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision: novel.revision }) })).status, 200);
  assert.deepEqual(errors, []);
  pass("edge scenarios have no browser page or console errors");
} catch (error) {
  console.error(error); process.exitCode = 1;
  await mkdir("artifacts/phase2", { recursive: true });
  await page.screenshot({ path: "artifacts/phase2/edge-failure.png", fullPage: true }).catch(() => {});
} finally {
  await mkdir("artifacts/phase2", { recursive: true });
  await writeFile("artifacts/phase2/edge-results.json", JSON.stringify({ passed: !process.exitCode, checks, errors, note: "Disposable Auth/PostgREST fixture with real SQL/RLS; not hosted Supabase." }, null, 2));
  await browser.close();
}

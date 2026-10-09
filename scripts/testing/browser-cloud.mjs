// Real hosted Supabase + existing ordinary A/B accounts. No fixture server.
import assert from "node:assert/strict";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

assert.ok(process.argv.includes("--allow-cloud-test-writes"), "Explicit test-write opt-in required");
const settings = JSON.parse(await readFile(".tools/cloud-test-accounts.json", "utf8"));
assert.equal(settings.disposableTestProject, true);
const evidenceDir = "artifacts/phase2.5";
const reports = (await readdir(evidenceDir)).filter((name) => /^cloud-.*\.json$/.test(name)).sort().reverse();
let seed;
for (const name of reports) {
  const item = JSON.parse(await readFile(`${evidenceDir}/${name}`, "utf8"));
  if (item.status === "passed-sdk-database-only") { seed = item; break; }
}
assert.ok(seed, "A passing real database run is required before browser acceptance");
assert.equal(seed.projectRef, settings.projectRef);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const base = process.env.NOVELAI_BROWSER_BASE || "http://localhost:3000";
assert.ok(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const folder = `${evidenceDir}/browser-${runId}`;
await mkdir(folder, { recursive: true });
const report = { runId, projectRef: seed.projectRef, seedRun: seed.runId, scope: "real browser UI and hosted Supabase", checks: [], errors: [], status: "running" };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const expectedFailures = new WeakSet();
const contexts = [];
let page, stage = "initialization";
function observe(p) {
  p.on("pageerror", (error) => report.errors.push({ type: "pageerror", message: error.message }));
  p.on("console", (message) => {
    if (["error", "warning"].includes(message.type()) && !expectedFailures.has(p)) report.errors.push({ type: message.type(), message: message.text() });
  });
  p.on("response", (response) => {
    if (response.url().startsWith(base) && response.status() >= 400 && !expectedFailures.has(p)) report.errors.push({ type: "http", status: response.status(), path: new URL(response.url()).pathname });
  });
  p.on("dialog", (dialog) => dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss());
}
async function context() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  ctx.setDefaultTimeout(45000);
  ctx.on("page", observe);
  contexts.push(ctx);
  return ctx;
}
async function persist() { await writeFile(`${folder}/results.json`, JSON.stringify(report, null, 2)); }
async function check(name, action) { stage = name; await action(); report.checks.push(name); await persist(); console.log(`PASS: ${name}`); }
async function go(path, p = page) { const r = await p.goto(base + path, { waitUntil: "domcontentloaded" }); return r; }
async function saved(p = page) { await p.waitForFunction(() => document.querySelector(".editor-save-status")?.textContent === "已保存"); }
async function api(path, options = {}, p = page) {
  const r = await p.context().request.fetch(base + path, { ...options, headers: { "Content-Type": "application/json", Origin: base }, data: options.body });
  return { status: r.status(), data: await r.json().catch(() => ({})) };
}
async function model(p = page) { const r = await api(`/api/novels/${seed.novels.A.id}`, {}, p); assert.equal(r.status, 200); return r.data.novel; }
async function login(actor, p = page) {
  await go("/login", p);
  await p.getByLabel("邮箱", { exact: true }).fill(settings[actor].email);
  await p.getByLabel("密码", { exact: true }).fill(settings[actor].password);
  await p.getByRole("button", { name: "登录", exact: true }).click();
  await p.waitForURL(base + "/dashboard", { timeout: 90000 });
  await p.locator(".dashboard").waitFor();
}
async function saveModal(p = page) {
  await p.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
  await p.getByRole("dialog").waitFor({ state: "hidden" });
}
async function hasDraft(text, p = page) {
  return p.evaluate((text) => Object.keys(localStorage).some((key) => key.startsWith("novelai-studio:chapter-draft:v2:") && JSON.parse(localStorage[key]).content.body === text), text);
}
const novelPath = `/novel/${seed.novels.A.id}`;
const chapterPath = `${novelPath}/chapters?chapter=${seed.novels.A.chapterId}`;
try {
  let ctx = await context(); page = await ctx.newPage();
  await check("public home, login, registration and anonymous protected routes", async () => {
    for (const path of ["/", "/register", "/login"]) { assert.equal((await go(path)).status(), 200); await page.locator("h1,h2").first().waitFor(); }
    // Validate registration UI without creating another account.
    await go("/register");
    await page.getByLabel("邮箱", { exact: true }).fill(settings.a.email);
    await page.getByLabel("密码", { exact: true }).fill("TemporaryValidationOnly1!");
    await page.getByLabel("确认密码", { exact: true }).fill("DifferentValidationOnly2!");
    await page.getByRole("button", { name: "创建账号", exact: true }).click();
    await page.getByText("两次输入的密码不一致。", { exact: true }).waitFor();
    for (const path of ["/dashboard", "/create", chapterPath]) { await go(path); assert.match(page.url(), /\/login/); }
    assert.equal((await api("/api/novels")).status, 401);
  });
  let baseline;
  await check("existing A logs in; complete cloud novel and Dashboard statistics are restored", async () => {
    await login("a"); baseline = await model();
    assert.equal(baseline.chapters.length, 3); assert.equal(baseline.characters.length, 3);
    assert.equal(baseline.world.length, 3); assert.equal(baseline.timeline.length, 3); assert.equal(baseline.memory.entries.length, 3);
    assert.ok(baseline.bible.id); assert.ok((baseline.chapters[0].body.match(/\p{Script=Han}/gu) || []).length >= 800);
    const card = page.locator(`a.novel-card[href="${novelPath}"]`);
    const text = await card.innerText();
    for (const expected of [baseline.title, baseline.genre, baseline.status, "3 章", new Intl.NumberFormat("zh-CN").format(baseline.stats.wordCount)]) assert.ok(text.includes(expected), `Dashboard missing ${expected}`);
    assert.ok(Number.isFinite(Date.parse(baseline.updatedAt)));
    assert.equal(await page.locator(`a.novel-card[href="/novel/${seed.novels.B.id}"]`).count(), 0);
  });
  await check("logout, close page, reopen and log in preserves every cloud field", async () => {
    await page.getByRole("button", { name: "退出", exact: true }).click(); await page.waitForURL(base + "/");
    await page.close(); page = await ctx.newPage(); await login("a");
    assert.deepEqual(await model(), baseline);
  });
  await check("new isolated browser profile with empty localStorage restores the complete novel", async () => {
    await ctx.close(); ctx = await context(); page = await ctx.newPage();
    await go("/login"); assert.equal(await page.evaluate(() => localStorage.length), 0);
    await login("a"); assert.deepEqual(await model(), baseline);
    await go(chapterPath); await saved();
    assert.equal(await page.locator("#chapter-body").inputValue(), baseline.chapters[0].body);
    assert.equal(await hasDraft(baseline.chapters[0].body), false);
  });
  await check("autosave immediately caches input, debounces requests and shows pending/saving/saved", async () => {
    let release, reached;
    const gate = new Promise((r) => { release = r; });
    const arrived = new Promise((r) => { reached = r; });
    let saves = 0;
    const handler = async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      saves++; reached(); await gate; await route.continue();
    };
    await page.route("**/api/chapters/*", handler);
    const initial = await page.locator("#chapter-body").inputValue();
    await page.locator("#chapter-body").fill(initial + "\n自动保存真实验收：");
    await page.locator("#chapter-body").pressSequentially("甲乙丙丁戊己庚辛壬癸", { delay: 30 });
    const text = await page.locator("#chapter-body").inputValue();
    assert.equal(await hasDraft(text), true);
    assert.equal(await page.locator(".editor-save-status").textContent(), "等待自动保存");
    assert.equal(saves, 0);
    await arrived; assert.equal(await page.locator(".editor-save-status").textContent(), "正在保存…");
    release(); await saved(); await page.unroute("**/api/chapters/*", handler);
    assert.equal(saves, 1); assert.equal(await hasDraft(text), false);
    assert.equal((await model()).chapters[0].body, text);
    await page.reload(); await saved(); assert.equal(await page.locator("#chapter-body").inputValue(), text);
  });
  await check("offline failure preserves a local draft, reconnect retries and refresh reads cloud body", async () => {
    const text = (await page.locator("#chapter-body").inputValue()) + "\n断网期间写下的新段落。";
    expectedFailures.add(page); await ctx.setOffline(true);
    await page.locator("#chapter-body").fill(text);
    await page.getByText("保存失败，本地草稿已保留", { exact: true }).waitFor();
    assert.equal(await page.locator("#chapter-body").inputValue(), text); assert.equal(await hasDraft(text), true);
    await ctx.setOffline(false); await saved(); expectedFailures.delete(page);
    assert.equal((await model()).chapters[0].body, text);
    await page.reload(); await saved(); assert.equal(await page.locator("#chapter-body").inputValue(), text);
  });
  await check("failed server save survives page reload and explicit retry", async () => {
    expectedFailures.add(page);
    const handler = (route) => route.request().method() === "POST" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "暂时无法保存，请稍后重试。" }) }) : route.continue();
    await page.route("**/api/chapters/*", handler);
    const text = (await page.locator("#chapter-body").inputValue()) + "\n失败刷新草稿恢复验收。";
    await page.locator("#chapter-body").fill(text);
    await page.getByText("保存失败，本地草稿已保留", { exact: true }).waitFor();
    await page.reload(); await page.getByText("保存失败，本地草稿已保留", { exact: true }).waitFor();
    assert.equal(await page.locator("#chapter-body").inputValue(), text);
    await page.unroute("**/api/chapters/*", handler); await page.getByRole("button", { name: "重试保存", exact: true }).click();
    await saved(); expectedFailures.delete(page); assert.equal((await model()).chapters[0].body, text);
  });
  await check("two windows reject stale revision and preserve both cloud text and conflicting draft", async () => {
    const other = await ctx.newPage(); await go(chapterPath, other); await saved(other);
    const original = await page.locator("#chapter-body").inputValue();
    assert.equal(await other.locator("#chapter-body").inputValue(), original);
    const newer = original + "\n窗口甲的新版本。"; const older = original + "\n窗口乙需要保留的草稿。";
    await page.locator("#chapter-body").fill(newer); await saved();
    expectedFailures.add(other); await other.locator("#chapter-body").fill(older);
    await other.getByText("发现云端版本冲突", { exact: true }).waitFor();
    assert.equal((await model()).chapters[0].body, newer);
    assert.equal(await other.locator("#chapter-body").inputValue(), older); assert.equal(await hasDraft(older, other), true);
    await other.screenshot({ path: `${folder}/conflict.png`, fullPage: true });
    await other.reload(); await other.getByText("发现云端版本冲突", { exact: true }).waitFor();
    assert.equal(await other.locator("#chapter-body").inputValue(), older);
    await other.close();
  });
  await check("real chapter versions are created and visible with content, source, date and word count", async () => {
    const before = (await api(`/api/chapters/${seed.novels.A.chapterId}/versions?novelId=${seed.novels.A.id}`)).data.versions;
    await page.getByRole("button", { name: "保存版本", exact: true }).click(); await saved();
    await page.getByRole("button", { name: "版本记录", exact: true }).click(); await page.locator(".chapter-version-body").waitFor();
    assert.equal(await page.locator(".chapter-version-list button").count(), before.length + 1);
    assert.equal(await page.locator(".chapter-version-body").textContent(), await page.locator("#chapter-body").inputValue());
    await page.screenshot({ path: `${folder}/versions.png`, fullPage: true });
    await page.getByRole("button", { name: "关闭弹窗" }).click();
  });
  await check("memory UI creates, edits, links a real chapter and deletes its test record", async () => {
    await go(novelPath + "/memory"); await page.getByRole("button", { name: "新增记忆", exact: true }).click();
    const title = `浏览器测试记忆 ${runId}`;
    await page.getByLabel("记忆标题").fill(title); await page.getByLabel("记忆内容").fill("钟楼的秘密。");
    await page.getByLabel("记忆类型").selectOption("secret"); await page.getByLabel("资料来源").selectOption(`chapter:${seed.novels.A.chapterId}`); await saveModal();
    await page.getByRole("button", { name: `编辑记忆 ${title}` }).click();
    await page.getByLabel("重要程度").selectOption("5"); await page.getByLabel("记忆状态").selectOption("resolved"); await saveModal();
    const entry = (await model()).memory.entries.find((e) => e.title === title);
    assert.equal(entry.type, "secret"); assert.equal(entry.importance, 5); assert.equal(entry.status, "resolved"); assert.equal(entry.sourceId, seed.novels.A.chapterId);
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await card.locator(".memory-source a").click(); await saved();
    await go(novelPath + "/memory"); await page.getByRole("button", { name: `删除记忆 ${title}` }).click();
    await page.getByRole("button", { name: "确认删除记忆", exact: true }).click(); await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal((await model()).memory.entries.some((e) => e.id === entry.id), false);
  });
  await check("all novel routes render real data without console, hydration or unexpected HTTP errors", async () => {
    for (const path of ["", "/outline", "/characters", "/world", "/timeline", "/chapters", "/memory"]) {
      assert.equal((await go(novelPath + path)).status(), 200);
      await page.locator(".page-heading h1").waitFor();
      if (path === "/chapters") await saved();
      await page.screenshot({ path: `${folder}/${path.slice(1) || "overview"}.png`, fullPage: true });
    }
  });
  await check("Dashboard and all workspaces distinguish loading and server error", async () => {
    let release, reached;
    const gate = new Promise((r) => { release = r; }); const arrived = new Promise((r) => { reached = r; });
    const handler = async (route) => { reached(); await gate; await route.continue(); };
    await page.route("**/api/novels", handler); await go("/dashboard"); await arrived;
    await page.getByText("正在打开创作空间…", { exact: true }).waitFor();
    assert.equal(await page.locator(".novel-card").count(), 0); release(); await page.locator(".novel-card").first().waitFor();
    await page.unroute("**/api/novels", handler);
    const fail = (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "作品暂时无法加载，请稍后重试。", code: "DATABASE_ERROR" }) });
    expectedFailures.add(page); await page.route("**/api/novels", fail);
    for (const path of ["/dashboard", ...["", "/outline", "/characters", "/world", "/timeline", "/chapters", "/memory"].map((s) => novelPath + s)]) {
      await go(path); await page.getByText("作品暂时无法加载，请稍后重试。", { exact: true }).waitFor();
      assert.equal(await page.locator(".novel-card,.chapter-editor").count(), 0);
    }
    await page.unroute("**/api/novels", fail); expectedFailures.delete(page);
    await go("/dashboard"); await page.locator(".dashboard").waitFor();
    await page.getByLabel("搜索作品").fill("不存在的测试书名" + runId); await page.getByRole("heading", { name: "还没有找到这个故事" }).waitFor();
  });
  await check("create page submits a real novel, empty states render and confirmed delete removes it", async () => {
    await go("/create"); await page.locator("#idea").fill("浏览器创建与删除验收 " + runId);
    await page.getByRole("button", { name: "创建小说", exact: true }).click(); await page.waitForURL(/\/novel\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop(); assert.notEqual(id, seed.novels.A.id);
    const created = (await api(`/api/novels/${id}`)).data.novel; assert.ok(created.bible.id); assert.equal(created.chapters.length, 1);
    report.createdNovelId = id;
    for (const path of ["characters", "world", "timeline", "memory", "chapters"]) { await go(`/novel/${id}/${path}`); await page.locator(".page-heading h1").waitFor(); }
    await go("/dashboard"); await page.getByRole("button", { name: `删除小说 ${created.title}`, exact: true }).click();
    await page.getByRole("button", { name: "保留作品", exact: true }).click(); assert.equal((await api(`/api/novels/${id}`)).status, 200);
    await page.getByRole("button", { name: `删除小说 ${created.title}`, exact: true }).click(); await page.getByRole("button", { name: "确认删除小说", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" }); assert.equal((await api(`/api/novels/${id}`)).status, 404);
    report.createdNovelDeleted = true;
  });
  await check("B sees only B novels and cannot open A workspace or history; missing novel has a safe page", async () => {
    const bContext = await context(); const b = await bContext.newPage(); await login("b", b);
    assert.equal(await b.locator(`a.novel-card[href="${novelPath}"]`).count(), 0);
    await b.locator(`a.novel-card[href="/novel/${seed.novels.B.id}"]`).waitFor();
    assert.equal((await api(`/api/chapters/${seed.novels.A.chapterId}/versions?novelId=${seed.novels.A.id}`, {}, b)).status, 404);
    expectedFailures.add(b); await go(novelPath, b); await b.getByRole("heading", { name: "这一页，还没有故事。" }).waitFor();
    assert.equal(await b.locator(".studio-shell").count(), 0); await bContext.close();
    expectedFailures.add(page); await go("/novel/11111111-1111-4111-8111-111111111111"); await page.getByRole("heading", { name: "这一页，还没有故事。" }).waitFor(); expectedFailures.delete(page);
  });
  assert.deepEqual(report.errors, [], "Unexpected browser errors or warnings");
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.failedStage = stage; report.failure = { name: error.name, message: "Browser check failed; sensitive request details omitted." };
  console.error(`FAIL: ${stage}: ${error.name}`);
  await page?.screenshot({ path: `${folder}/failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await persist(); await browser.close(); console.log(`Browser evidence: ${folder}/results.json`);
}

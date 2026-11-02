import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const folder = process.argv[2];
assert.match(folder || "", /^artifacts\/phase4a\/stress-[\dTZ-]+$/);
nextEnv.loadEnvConfig(process.cwd(), true);
const progress = JSON.parse(await readFile(`${folder}/progress.json`, "utf8"));
const accounts = JSON.parse(await readFile(".tools/cloud-test-accounts.json", "utf8"));
assert.equal(accounts.disposableTestProject, true);
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${accounts.projectRef}.supabase.co`);
const production = process.argv.includes("--production");
const base = "http://127.0.0.1:43260";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const report = { mode: production ? "production-access-check" : "development-browser-performance", at: new Date().toISOString(), status: "running", errors: [], warnings: [], pages: [], checks: [] };
const log = await open(`${folder}/browser-server-${stamp}.log`, "a");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", production ? "start" : "dev", "--hostname", "127.0.0.1", "--port", "43260"], { windowsHide: true, stdio: ["ignore", log.fd, log.fd], env: { ...process.env } });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, expectedError = false;
try {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${base}/login`)).ok) break; } catch {}
    assert.equal(child.exitCode, null, "Browser test server exited");
    if (i === 89) throw new Error("Browser test server not ready");
    await pause(1000);
  }
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/api/ai/**", route => {
    if (route.request().method() === "GET") return route.continue();
    report.errors.push("Read-only performance check attempted an AI mutation");
    return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(60000);
  page.on("pageerror", e => { if (!expectedError) report.errors.push(e.message); });
  page.on("console", m => { if (!expectedError && m.type() === "error") report.errors.push(m.text()); if (m.type() === "warning") report.warnings.push(m.text()); });
  page.on("request", r => { if (["api.deepseek.com", "api.openai.com"].includes(new URL(r.url()).hostname)) report.errors.push("Browser called AI provider directly"); });
  const healthUrl = `${base}/dev/novel-health?novelId=${progress.novelId}`;
  if (production) {
    const response = await context.request.get(healthUrl);
    assert.equal(response.status(), 404);
    assert.ok(!(await response.text()).includes("Long Novel Stress Test"));
    report.checks.push("production health route returns 404 without novel data");
  } else {
    await page.goto(healthUrl); await page.waitForURL(/\/login/);
    report.checks.push("anonymous health access requires login");
    const login = async actor => { await page.goto(`${base}/login`); await page.getByLabel("邮箱", { exact: true }).fill(accounts[actor].email); await page.getByLabel("密码", { exact: true }).fill(accounts[actor].password); await page.getByRole("button", { name: "登录", exact: true }).click(); await page.waitForURL(`${base}/dashboard`); };
    await login("a");
    let routes = ["/dashboard", `/novel/${progress.novelId}/memory`, `/novel/${progress.novelId}/timeline`, `/dev/novel-health?novelId=${progress.novelId}`];
    if (process.argv.includes("--all-routes")) {
      routes = ["/", "/create", `/novel/${progress.novelId}`, ...["outline", "characters", "world"].map(section => `/novel/${progress.novelId}/${section}`), ...routes];
    }
    if (process.argv.includes("--include-chapters")) {
      const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      assert.ifError((await client.auth.signInWithPassword({ email: accounts.a.email, password: accounts.a.password })).error);
      const current = await client.from("generation_runs").select("status").eq("novel_id", progress.novelId).order("created_at", { ascending: false }).limit(1);
      assert.ifError(current.error); assert.ok(["completed", "paused", "failed", "cancelled"].includes(current.data[0]?.status), "Inspect only a stopped run, never race the CLI worker");
      routes = [...routes, `/novel/${progress.novelId}/chapters`];
    }
    for (const path of routes) {
      for (let pass = 0; pass < 2; pass++) {
        const requests = []; const responseHandler = r => { if (r.url().includes("/api/")) requests.push({ path: new URL(r.url()).pathname, status: r.status() }); };
        page.on("response", responseHandler);
        const began = Date.now(); const response = await page.goto(`${base}${path}`);
        assert.ok(response.ok(), `Page ${path} returned ${response.status()}`);
        if (path.startsWith("/dev/")) await page.getByText("逐章 Context Token 与评分", { exact: true }).waitFor();
        else await page.locator("main").first().waitFor();
        await page.waitForLoadState("networkidle");
        report.pages.push({ path, pass, elapsedMs: Date.now() - began, requests, transferredBytes: await page.evaluate(() => performance.getEntriesByType("resource").reduce((n, r) => n + r.transferSize, 0)),
          apiResources: await page.evaluate(() => performance.getEntriesByType("resource").filter(r => new URL(r.name).pathname.startsWith("/api/")).map(r => ({ path: new URL(r.name).pathname, transferredBytes: r.transferSize, bodyBytes: r.encodedBodySize }))) });
        page.off("response", responseHandler);
      }
    }
    await page.goto(healthUrl); await page.screenshot({ path: `${folder}/health-${stamp}.png`, fullPage: true });
    await page.reload(); await page.getByText("逐章 Context Token 与评分", { exact: true }).waitFor();
    report.checks.push("owner metrics and refresh render without provider calls");
    await context.clearCookies(); await login("b");
    const denied = await context.request.get(healthUrl);
    // App Router's streamed notFound UI can retain HTTP 200. Assert the actual
    // denied UI and absence of protected data; the JSON API must still be 404.
    assert.ok([200, 404].includes(denied.status()));
    const deniedHtml = await denied.text();
    assert.ok(deniedHtml.includes("这一页，还没有故事。"));
    assert.ok(!deniedHtml.includes("Long Novel Stress Test"));
    const response = await context.request.get(`${base}/api/novels/${progress.novelId}`);
    assert.equal(response.status(), 404);
    report.checks.push("B cannot read A health or novel API");
    await context.clearCookies(); await login("a"); await page.goto(healthUrl); await page.getByText("逐章 Context Token 与评分", { exact: true }).waitFor();
    report.checks.push("new login restores health view");
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  report.status = "passed";
} catch (error) { report.status = "failed"; report.failure = error.message; console.error(error.message); process.exitCode = 1; }
finally {
  await browser?.close(); child.kill();
  for (let i = 0; i < 20 && child.exitCode === null; i++) await pause(200);
  await log.close();
  await writeFile(`${folder}/browser-${stamp}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks, errors: report.errors.length, warnings: report.warnings.length }));
}

// Public/no-configuration smoke checks. Does not start or stop an application.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const base = "http://127.0.0.1:3000";
const artifactDirectory = "artifacts/phase2";
const checks = [];
const consoleErrors = [];
const pageErrors = [];
const requests = new Set();
const screenshots = [];
await mkdir(artifactDirectory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(30000);
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push({ url: page.url(), message: message.text() });
});
page.on("pageerror", (error) => pageErrors.push({ url: page.url(), message: error.message }));
page.on("request", (request) => requests.add(request.url()));

async function run(name, action) {
  try {
    const details = await action();
    checks.push({ name, pass: true, ...(details || {}) });
    console.log(`PASS: ${name}`);
  } catch (error) {
    checks.push({ name, pass: false, error: error.message, url: page.url() });
    console.error(`FAIL: ${name}: ${error.message}`);
  }
}

async function go(path) {
  return page.goto(`${base}${path}`, { waitUntil: "networkidle" });
}

async function screenshot(name) {
  const path = `${artifactDirectory}/${name}.png`;
  await page.screenshot({ path, fullPage: true, caret: "initial" });
  screenshots.push(path);
}

function assertLoginOrigin() {
  const url = new URL(page.url());
  assert.equal(url.pathname, "/login");
  assert.equal(url.origin, base, "Authentication redirects must preserve the browser origin");
  assert.equal(url.searchParams.get("reason"), "setup");
}

try {
  await run("callback origin helper preserves valid Host and rejects URL components", async () => {
    const helper = (await readFile(new URL("../../src/lib/server/request-origin.js", import.meta.url), "utf8")).replace('import "server-only";', "");
    const { requestOrigin } = await import(`data:text/javascript;base64,${Buffer.from(helper).toString("base64")}`);
    const request = (host) => new Request("http://localhost:3000/auth/callback", { headers: host === undefined ? {} : { Host: host } });
    assert.equal(requestOrigin(request("127.0.0.1:3000")), base);
    assert.equal(requestOrigin(request()), "http://localhost:3000");
    assert.equal(requestOrigin(request("[::1]:3000")), "http://[::1]:3000");
    for (const invalid of ["user@attacker.example", "attacker.example/path", "attacker.example?next=x", "attacker.example#fragment", "invalid host", "localhost:99999"]) {
      assert.equal(requestOrigin(request(invalid)), "http://localhost:3000");
    }
  });
  await run("public home renders requested copy and creation links", async () => {
    const response = await go("/");
    assert.equal(response.status(), 200);
    await page.getByRole("heading", { name: /一个想法.*写出一个世界/ }).waitFor({ state: "visible" });
    assert.equal(await page.getByRole("link", { name: "开始创作", exact: true }).first().getAttribute("href"), "/create");
    assert.equal(await page.getByRole("link", { name: "查看作品", exact: true }).getAttribute("href"), "/dashboard");
    await screenshot("public-home-desktop");
  });

  for (const [path, button] of [["/login", "登录"], ["/register", "创建账号"]]) {
    await run(`${path} explains missing configuration and disables submission`, async () => {
      const response = await go(path);
      assert.equal(response.status(), 200);
      await page.locator(".auth-notice:visible strong").filter({ hasText: "账号服务尚未配置" }).waitFor({ state: "visible" });
      assert.equal(await page.getByRole("button", { name: button, exact: true }).isDisabled(), true);
      await page.getByLabel("邮箱", { exact: true }).fill("public-smoke@example.invalid");
      await page.getByLabel("密码", { exact: true }).fill("PublicSmoke123!");
      assert.equal(await page.getByRole("button", { name: button, exact: true }).isDisabled(), true);
    });
  }

  const novel = "/novel/11111111-1111-4111-8111-111111111111";
  for (const path of ["/dashboard", "/create", novel, ...["outline", "characters", "world", "timeline", "chapters", "memory"].map((segment) => `${novel}/${segment}`)]) {
    await run(`unconfigured protected route redirects safely: ${path}`, async () => {
      await go(path);
      assertLoginOrigin();
      await page.locator(".auth-notice:visible strong").filter({ hasText: "账号服务尚未配置" }).waitFor({ state: "visible" });
    });
  }

  for (const path of ["/auth/callback", "/auth/callback?code=invalid-test-code&next=https%3A%2F%2Fattacker.example", "/auth/confirm?token_hash=invalid-test-token&type=email", "/auth/confirm?token_hash=invalid-test-token&type=recovery"]) {
    await run(`invalid callback stays on safe login: ${path}`, async () => {
      await go(path);
      assertLoginOrigin();
      await page.locator(".auth-notice:visible strong").filter({ hasText: "账号服务尚未配置" }).waitFor({ state: "visible" });
    });
  }

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/", "/login", "/register"]) {
      await run(`mobile ${width}px ${path} has no horizontal overflow`, async () => {
        await go(path);
        await page.getByRole("heading").first().waitFor({ state: "visible" });
        const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(dimensions.scroll <= dimensions.viewport + 1, JSON.stringify(dimensions));
        await screenshot(`public-${path === "/" ? "home" : path.slice(1)}-${width}`);
        return dimensions;
      });
    }
  }

  await run("public navigation has no page errors or console errors", async () => {
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
  });
  await run("unconfigured public app makes no Supabase/OpenAI calls", async () => {
    assert.deepEqual([...requests].filter((url) => /supabase\.(co|com)|api\.openai\.com/i.test(url)), []);
  });
} finally {
  await writeFile(`${artifactDirectory}/public-results.json`, JSON.stringify({
    base, checkedAt: new Date().toISOString(), checks, consoleErrors, pageErrors, screenshots,
    passed: checks.filter((check) => check.pass).length,
    failed: checks.filter((check) => !check.pass).length,
  }, null, 2));
  await browser.close();
}
if (checks.some((check) => !check.pass)) process.exitCode = 1;

// Scan only application/source files and browser bundles; never print secrets.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import nextEnv from "@next/env";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
const sources = git("ls-files", "--cached", "--others", "--exclude-standard").split(/\r?\n/).filter(Boolean);
assert.ok(!sources.includes(".env.local"), ".env.local must not be tracked");
assert.equal(git("check-ignore", ".env.local"), ".env.local");
assert.equal(git("check-ignore", ".tools/cloud-test-accounts.json"), ".tools/cloud-test-accounts.json");
const sensitiveValues = [];
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
if (process.env.OPENAI_API_KEY?.trim()) sensitiveValues.push(process.env.OPENAI_API_KEY.trim());
try {
  const accounts = JSON.parse(await readFile(".tools/cloud-test-accounts.json", "utf8"));
  for (const actor of [accounts.a, accounts.b]) if (actor?.password) sensitiveValues.push(actor.password);
} catch (error) { if (error.code !== "ENOENT") throw error; }
const patterns = [
  ["Supabase management token", /sbp_[a-f0-9]{30,}/],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{20,}/],
  ["OpenAI secret key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/],
  ["Database URL with password", /postgres(?:ql)?:\/\/[^\s/:]+:[^\s/@]{4,}@/],
];
const issues = [];
async function scan(path) {
  if (/\.(png|jpe?g|ico|woff2?|pdf)$/i.test(path)) return;
  const text = await readFile(path, "utf8");
  for (const [name, pattern] of patterns) if (pattern.test(text)) issues.push({ path, issue: name });
  if (sensitiveValues.some((value) => text.includes(value))) issues.push({ path, issue: "Actual configured key or test account password" });
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try { if (JSON.parse(Buffer.from(match[1], "base64url").toString()).role === "service_role") issues.push({ path, issue: "Service-role JWT" }); }
    catch { /* Non-JWT text. */ }
  }
}
async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await walk(path)); else files.push(path);
  }
  return files;
}
const bundles = await walk(".next/static");
for (const path of [...sources, ...bundles]) await scan(path);
await mkdir("artifacts/phase2.5", { recursive: true });
await writeFile("artifacts/phase2.5/security.json", JSON.stringify({ sourceFiles: sources.length, browserAssets: bundles.length, envIgnored: true, accountsIgnored: true, issues }, null, 2));
assert.deepEqual(issues, [], "Secret scan found sensitive data; inspect paths, never print values");
console.log(`PASS: ${sources.length} source files and ${bundles.length} browser assets; no known account passwords or privileged keys; local environment/credentials ignored.`);

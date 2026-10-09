import assert from "node:assert/strict";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import OpenAI from "openai";
import { builderInput, novelPlan, responseFixture } from "./testing/novel-builder-fixtures.mjs";
import { builderInputSchema, parseNovelPlan, BUILDER_SCHEMA_VERSION } from "../src/lib/ai/schemas/novel-builder-schema.js";
import { buildNovelPlan } from "../src/lib/ai/services/novel-builder-service.js";
import { mapNovelBundle } from "../src/lib/ai/services/novel-bundle-mapper.js";
import { generatePreview, confirmNovelPlan, inputHash } from "../src/lib/ai/services/builder-workflow.js";
import { getAiConfig } from "../src/lib/ai/config.js";
import { createDeepSeekClient } from "../src/lib/ai/deepseek.js";
import { normalizeAiError } from "../src/lib/ai/errors.js";
import { createBuilderHandler } from "../src/lib/ai/route-handler.js";

const results = [];
async function check(name, run) { await run(); results.push(name); console.log(`PASS: ${name}`); }
const config = { model: "deepseek-flash", maxOutputTokens: 24000 };
const clientFor = (body, inspect = () => {}) => {
  const client = createDeepSeekClient({ ...config, apiKey: "fixture-only", timeoutMs: 1000 });
  client.fetch = async (url, options) => { inspect(url, JSON.parse(options.body), options); return Response.json(body, { headers: { "x-request-id": "req_fixture_only" } }); };
  return client;
};
const input = builderInput();
await check("4 genres × 100/300/800 chapters use DeepSeek Responses schema output and server validation", async () => {
  for (const genre of ["都市", "玄幻", "悬疑", "言情"]) for (const count of [100, 300, 800]) {
    const input = builderInput(genre, count); const fixture = novelPlan(input);
    const result = await buildNovelPlan(input, { config, client: clientFor(responseFixture(fixture), (url, body) => {
      assert.equal(String(url), "https://api.deepseek.com/responses"); assert.equal(body.text.format.type, "json_schema"); assert.equal(body.text.format.strict, true); assert.equal(body.text.format.schema.additionalProperties, false); assert.equal(body.reasoning.effort, "low"); assert.equal(body.stream, false); assert.equal(body.max_output_tokens, 24000); assert.equal(body.model, "deepseek-flash"); assert.equal(body.input[1].role, "user"); assert.equal(JSON.parse(body.input[1].content).targetChapterCount, count); assert.ok(body.input[0].content.includes("JSON Schema")); assert.equal(body.store, undefined);
    }) });
    assert.equal(result.plan.storyStages.at(-1).approxEndChapter, count); assert.equal(result.plan.powerSystem.enabled, genre === "玄幻"); assert.equal(result.inputTokens, 1200); assert.equal(result.providerRequestId, "req_fixture_only");
  }
});
await check("input length, numeric bounds, unknown fields, empty premise rejected", () => {
  for (const change of [{ premise: " " }, { premise: "字".repeat(501) }, { targetChapterCount: 7 }, { targetChapterCount: 2001 }, { targetWordCount: 10000001 }, { chapterWordTarget: 50001 }, { targetChapterCount: "100" }, { protagonistHint: "字".repeat(1001) }, { specialRequirements: "字".repeat(1501) }, { user_id: randomUUID() }]) assert.equal(builderInputSchema.safeParse({ ...input, ...change }).success, false);
});
await check("cross-field validation catches overlaps, gaps, missing final chapters, identity errors and illegal powers", () => {
  const mutations = [
    (p) => { p.storyStages[1].approxStartChapter = 1; }, (p) => { p.storyStages[1].approxStartChapter++; }, (p) => { p.storyStages.at(-1).approxEndChapter--; },
    (p) => { p.majorCharacters[0].name = p.protagonist.name; }, (p) => { p.relationships[0].to = "没有定义的人"; },
    (p) => { p.powerSystem.enabled = true; }, (p) => { p.powerSystem.name = "强行加入的系统"; }, (p) => { p.seedMemories[0].importance = 6; },
    (p) => { p.coreSellingPoints[0] = "剧情精彩"; }, (p) => { p.genre = "玄幻"; }, (p) => { p.protagonist.name = ""; }, (p) => { p.majorCharacters.pop(); },
    (p) => { p.storyStages[0].characterNames = ["错误姓名"]; }, (p) => { p.seedMemories[0].characterNames = ["错误姓名"]; }, (p) => { p.corePremise = "主角名叫王强，仍然是同一个人。"; },
  ];
  for (const mutate of mutations) { const plan = novelPlan(input); mutate(plan); assert.throws(() => parseNovelPlan(plan, input)); }
});
await check("provider errors are translated without leaking internal messages", async () => {
  for (const [error, code] of [[{ status: 401 }, "AI_AUTH_ERROR"], [{ status: 429 }, "AI_RATE_LIMIT"], [{ status: 404 }, "AI_MODEL_UNAVAILABLE"], [{ name: "APIConnectionTimeoutError" }, "AI_TIMEOUT"], [{ name: "APIConnectionError" }, "AI_NETWORK_ERROR"], [{ status: 400 }, "AI_REQUEST_REJECTED"]]) {
    const result = normalizeAiError({ ...error, message: "private internal SQL and credentials", request_id: "req-safe" }); assert.equal(result.code, code); assert.ok(!result.message.includes("private")); assert.equal(result.providerRequestId, "req-safe");
  }
  const refused = responseFixture(novelPlan(input)); refused.output[0].content = [{ type: "refusal", refusal: "no" }];
  await assert.rejects(buildNovelPlan(input, { config, client: clientFor(refused) }), (e) => e.code === "AI_REFUSAL");
  const truncated = responseFixture(novelPlan(input)); truncated.status = "incomplete"; truncated.incomplete_details = { reason: "max_output_tokens" };
  await assert.rejects(buildNovelPlan(input, { config, client: clientFor(truncated) }), (e) => e.code === "AI_INCOMPLETE");
  const malformed = responseFixture(novelPlan(input)); malformed.output[0].content[0].text = "{bad json";
  await assert.rejects(buildNovelPlan(input, { config, client: clientFor(malformed) }), (e) => e.code === "INVALID_AI_OUTPUT");
  const missing = responseFixture(novelPlan(input)); missing.output = [];
  await assert.rejects(buildNovelPlan(input, { config, client: clientFor(missing) }), (e) => e.code === "INVALID_AI_OUTPUT");
});
await check("missing key fails honestly before database reservation or provider call", async () => {
  const previous = process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_API_KEY;
  try { assert.throws(getAiConfig, (e) => e.code === "AI_NOT_CONFIGURED"); await assert.rejects(generatePreview({ rpc: () => assert.fail("must not reserve") }, { requestId: randomUUID(), input }), (e) => e.code === "AI_NOT_CONFIGURED"); }
  finally { if (previous !== undefined) process.env.DEEPSEEK_API_KEY = previous; }
});
await check("DeepSeek configuration never falls back to old OpenAI keys or proxies", async () => {
  const names = ["DEEPSEEK_API_KEY", "DEEPSEEK_MODEL", "DEEPSEEK_PROXY_URL", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_PROXY_URL"];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    names.forEach((name) => delete process.env[name]);
    process.env.OPENAI_API_KEY = "old-provider-fixture"; process.env.OPENAI_PROXY_URL = "http://127.0.0.1:1";
    assert.throws(getAiConfig, (e) => e.code === "AI_NOT_CONFIGURED");
    process.env.DEEPSEEK_API_KEY = "deepseek-fixture";
    const settings = getAiConfig(); assert.equal(settings.apiKey, "deepseek-fixture"); assert.equal(settings.model, "deepseek-flash"); assert.equal(settings.proxyUrl, undefined);
    const client = createDeepSeekClient(settings);
    client.fetch = async (url, options) => {
      assert.equal(new URL(url).origin, "https://api.deepseek.com"); assert.equal(new Headers(options.headers).get("authorization"), "Bearer deepseek-fixture");
      return Response.json(responseFixture(novelPlan(input)));
    };
    await buildNovelPlan(input, { config: settings, client });
  } finally { for (const name of names) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; } }
});
await check("DeepSeek empty, oversized, fenced or semantically invalid JSON never becomes a preview", async () => {
  const wrong = novelPlan(input); wrong.storyStages[1].approxStartChapter = 1;
  for (const content of [null, "", "   ", "{}", "[]", "```json\n{}\n```", "x".repeat(500001), JSON.stringify(wrong)]) {
    const response = responseFixture(novelPlan(input)); response.output[0].content[0].text = content;
    await assert.rejects(buildNovelPlan(input, { config, client: clientFor(response) }), (e) => e.code === "INVALID_AI_OUTPUT" && e.metadata.inputTokens === 1200);
  }
  for (const status of ["incomplete", "failed", "in_progress"]) {
    const response = responseFixture(novelPlan(input)); response.status = status;
    await assert.rejects(buildNovelPlan(input, { config, client: clientFor(response) }), (e) => e.code === "AI_INCOMPLETE");
  }
});
await check("real SDK connection, timeout and HTTP errors retain safe classification and request IDs", async () => {
  for (const [failure, code] of [
    [new TypeError("private connection detail"), "AI_NETWORK_ERROR"],
    [Object.assign(new Error("private timeout detail"), { name: "AbortError" }), "AI_TIMEOUT"],
  ]) {
    const client = new OpenAI({ apiKey: "fixture-only", maxRetries: 0, fetch: async () => { throw failure; } });
    await assert.rejects(buildNovelPlan(input, { config, client }), (error) => error.code === code && !error.message.includes("private"));
  }
  const client = new OpenAI({ apiKey: "fixture-only", maxRetries: 0, fetch: async () => Response.json({ error: { message: "private provider detail", code: "invalid_api_key" } }, { status: 401, headers: { "x-request-id": "req_sdk_auth" } }) });
  await assert.rejects(buildNovelPlan(input, { config, client }), (error) => error.code === "AI_AUTH_ERROR" && error.providerRequestId === "req_sdk_auth" && !error.message.includes("private"));
  const emptyBalanceClient = new OpenAI({ apiKey: "fixture-only", maxRetries: 0, fetch: async () => Response.json({ error: { message: "private billing detail" } }, { status: 402, headers: { "x-request-id": "req_sdk_balance" } }) });
  await assert.rejects(buildNovelPlan(input, { config, client: emptyBalanceClient }), (e) => e.code === "AI_CREDITS_EXHAUSTED" && e.status === 402 && e.message.includes("DeepSeek") && e.providerRequestId === "req_sdk_balance");
  for (const [providerCode, code] of [["insufficient_quota", "AI_QUOTA_EXCEEDED"]]) {
    const client = new OpenAI({ apiKey: "fixture-only", maxRetries: 0, fetch: async () => Response.json({ error: { message: "private billing detail", code: providerCode, type: "insufficient_quota" } }, { status: 429, headers: { "x-request-id": "req_sdk_quota" } }) });
    await assert.rejects(buildNovelPlan(input, { config, client }), (error) => error.code === code && error.status === 429 && error.providerRequestId === "req_sdk_quota" && !error.message.includes("private"));
  }
});
await check("both route handlers authenticate before body parsing or workflow", async () => {
  for (const workflow of [generatePreview, confirmNovelPlan]) {
    const handler = createBuilderHandler(workflow, 20000, { authenticate: async () => ({ error: Response.json({ code: "UNAUTHORIZED" }, { status: 401 }) }), read: () => assert.fail("not authenticated") });
    assert.equal((await handler(new Request("http://localhost/api", { method: "POST" }))).status, 401);
  }
});

const db = new PGlite();
const a = randomUUID(), b = randomUUID();
const rpcArgs = {
  studio_begin_ai_generation: ["p_request_id", "p_lease_token", "p_input_hash", "p_model", "p_schema_version"],
  studio_finish_ai_generation: ["p_generation_id", "p_lease_token", "p_status", "p_model", "p_input_tokens", "p_output_tokens", "p_latency_ms", "p_provider_request_id", "p_error_type"],
  create_ai_novel_bundle: ["p_generation_id", "p_input_hash", "p_bundle"],
};
const supabase = { async rpc(name, values) { try { const args = rpcArgs[name]; const result = await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as data`, args.map((key) => values[key] !== null && typeof values[key] === "object" ? JSON.stringify(values[key]) : values[key] ?? null)); return { data: result.rows[0].data, error: null }; } catch (error) { return { data: null, error }; } } };
async function login(id) { await db.exec("reset role; set role authenticated"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); }
const fixtureBuild = async (value) => ({ plan: novelPlan(value), model: "fixture-only", inputTokens: 1200, outputTokens: 5800 });
const deps = { getConfig: () => config, build: fixtureBuild };
let preview, novelId;
try {
  await db.exec("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;");
  for (const file of (await readdir("supabase/migrations")).filter((file) => file.endsWith(".sql")).sort()) await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2)", [a, b]); await login(a);
  await check("generation writes only metadata, not a partial novel", async () => {
    preview = await generatePreview(supabase, { requestId: randomUUID(), input }, deps);
    assert.equal((await db.query("select count(*)::int as count from public.novels")).rows[0].count, 0);
    const log = (await db.query("select status,input_tokens,output_tokens,model from public.ai_generation_logs where id=$1", [preview.generationId])).rows[0];
    assert.deepEqual(log, { status: "succeeded", input_tokens: 1200, output_tokens: 5800, model: "fixture-only" });
  });
  await check("request IDs deduplicate, extra user_id cannot impersonate another owner", async () => {
    await assert.rejects(generatePreview(supabase, { requestId: preview.requestId, input }, deps), (e) => e.code === "DUPLICATE_REQUEST");
    await assert.rejects(confirmNovelPlan(supabase, { generationId: preview.generationId, input, plan: preview.plan, user_id: b }), (e) => e.code === "INVALID_INPUT");
  });
  await check("invalid memory causes complete transactional rollback; preview remains retryable", async () => {
    const bundle = mapNovelBundle(preview.plan, input); bundle.memory_items[0].importance = 9;
    const result = await supabase.rpc("create_ai_novel_bundle", { p_generation_id: preview.generationId, p_input_hash: inputHash(input), p_bundle: bundle }); assert.ok(result.error);
    for (const table of ["novels", "characters", "world_entries", "novel_bible", "memory_items", "ai_novel_bundles"]) assert.equal((await db.query(`select count(*)::int as count from public.${table}`)).rows[0].count, 0);
  });
  await check("confirmed edited plan persists Bible, characters, world, memories, stages and empty first chapter atomically", async () => {
    preview.plan.title = "人工确认的新书名"; preview.plan.mainConflict = "人工修订后的核心冲突";
    ({ novelId } = await confirmNovelPlan(supabase, { generationId: preview.generationId, input, plan: preview.plan }));
    const novel = (await db.query("select user_id,title from public.novels where id=$1", [novelId])).rows[0]; assert.equal(novel.user_id, a); assert.equal(novel.title, preview.plan.title);
    const bible = (await db.query("select * from public.novel_bible where novel_id=$1", [novelId])).rows[0]; assert.equal(bible.main_conflict, preview.plan.mainConflict); assert.equal(bible.story_stages.length, 10); assert.equal(bible.forbidden_changes.length, 3);
    for (const [table, count] of [["characters", 6], ["world_entries", 8], ["memory_items", 12], ["volumes", 1], ["chapters", 1], ["novel_bible", 1]]) assert.equal((await db.query(`select count(*)::int as count from public.${table} where novel_id=$1`, [novelId])).rows[0].count, count);
    const chapter = (await db.query("select status,content from public.chapters where novel_id=$1", [novelId])).rows[0]; assert.deepEqual(chapter, { status: "planned", content: "" });
  });
  await check("repeated confirmation returns same novel; changed input hash cannot replay", async () => {
    assert.equal((await confirmNovelPlan(supabase, { generationId: preview.generationId, input, plan: { ...preview.plan, title: "重复点击不能覆盖" } })).novelId, novelId);
    assert.equal((await db.query("select title from public.novels where id=$1", [novelId])).rows[0].title, preview.plan.title);
    await assert.rejects(confirmNovelPlan(supabase, { generationId: preview.generationId, input: { ...input, premise: "偷换创意" }, plan: preview.plan }), (e) => e.code === "GENERATION_NOT_FOUND");
  });
  await check("B cannot read or confirm A generation, see A receipt, or write A bundle", async () => {
    await login(b);
    for (const table of ["ai_generation_logs", "ai_novel_bundles", "novels", "characters", "world_entries", "memory_items"]) assert.equal((await db.query(`select count(id)::int as count from public.${table === "ai_novel_bundles" ? "ai_novel_bundles" : table}`.replace("count(id)", table === "ai_novel_bundles" ? "count(generation_id)" : "count(id)"))).rows[0].count, 0);
    await assert.rejects(confirmNovelPlan(supabase, { generationId: preview.generationId, input, plan: preview.plan }), (e) => e.code === "GENERATION_NOT_FOUND");
    await assert.rejects(db.query("insert into public.ai_novel_bundles(generation_id,user_id,novel_id) values($1,$2,$3)", [preview.generationId, a, novelId]));
    await login(a);
  });
  await check("leases are unreadable, logs immutable to REST and concurrency survives worker boundaries", async () => {
    await assert.rejects(db.query("select lease_token from public.ai_generation_logs"));
    await assert.rejects(db.query("update public.ai_generation_logs set status='failed'"));
    await assert.rejects(db.query("delete from public.ai_generation_logs"));
    const lease = randomUUID(); const requestId = randomUUID();
    const started = await supabase.rpc("studio_begin_ai_generation", { p_request_id: requestId, p_lease_token: lease, p_input_hash: inputHash(input), p_model: config.model, p_schema_version: BUILDER_SCHEMA_VERSION }); assert.ifError(started.error);
    await assert.rejects(generatePreview(supabase, { requestId: randomUUID(), input }, deps), (e) => e.code === "BUILD_IN_PROGRESS");
    const finishArgs = { p_generation_id: started.data, p_lease_token: randomUUID(), p_status: "failed", p_model: config.model, p_input_tokens: null, p_output_tokens: null, p_latency_ms: 1, p_provider_request_id: null, p_error_type: "TEST_FAILURE" };
    assert.equal((await supabase.rpc("studio_finish_ai_generation", finishArgs)).data, false);
    assert.equal((await supabase.rpc("studio_finish_ai_generation", { ...finishArgs, p_lease_token: lease })).data, true);
  });
  await check("failed provider calls release the lease, record failure, and never fake a preview", async () => {
    await assert.rejects(generatePreview(supabase, { requestId: randomUUID(), input }, { ...deps, build: async () => { throw normalizeAiError({ status: 429 }); } }), (e) => e.code === "AI_RATE_LIMIT");
    assert.equal((await db.query("select count(*)::int as count from public.ai_generation_logs where status='running'")).rows[0].count, 0);
  });
  await check("hourly rate limit cannot be reset by caller", async () => {
    for (let i = 0; i < 3; i++) await generatePreview(supabase, { requestId: randomUUID(), input }, deps);
    await assert.rejects(generatePreview(supabase, { requestId: randomUUID(), input }, deps), (e) => e.code === "BUILD_RATE_LIMIT");
  });
  await check("novel deletion cascades normally; its confirmed preview cannot create a duplicate", async () => {
    await db.query("delete from public.novels where id=$1", [novelId]);
    assert.equal((await db.query("select novel_id from public.ai_novel_bundles where generation_id=$1", [preview.generationId])).rows[0].novel_id, null);
    await assert.rejects(confirmNovelPlan(supabase, { generationId: preview.generationId, input, plan: preview.plan }), (e) => e.code === "ALREADY_CONFIRMED");
  });
} finally { await db.close(); }
await mkdir("artifacts/phase3a", { recursive: true });
await writeFile("artifacts/phase3a/unit-database.json", JSON.stringify({ status: "passed", realOpenAI: false, checkedAt: new Date().toISOString(), checks: results }, null, 2));
console.log(`PASS: ${results.length} Phase 3A groups. All provider data in this suite are fixtures, not live AI.`);

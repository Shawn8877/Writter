import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { startSupabaseFixture } from "./testing/supabase-fixture.mjs";
import { seedMemorySql, memoryProse, memoryAnalysisFixture } from "./testing/chapter-memory-fixtures.mjs";
import { responseFixture, novelPlan, builderInput } from "./testing/novel-builder-fixtures.mjs";
import { buildChapterMemoryContext } from "../src/lib/ai/context/chapter-memory-context-builder.js";
import { analyzeChapterMemory, updateChapterMemory, getChapterMemoryStatus } from "../src/lib/ai/services/chapter-memory-service.js";
import { prepareChapterMemoryResult } from "../src/lib/ai/services/chapter-memory-mapper.js";
import { buildChapterContext } from "../src/lib/ai/services/chapter-context.js";
import { createDeepSeekClient } from "../src/lib/ai/deepseek.js";
import { AiError } from "../src/lib/ai/errors.js";

const fixture = await startSupabaseFixture({ port: 43071, quiet: true }); const db = fixture.db; const results = [];
const config = { model: "deepseek-flash", apiKey: "fixture-only", timeoutMs: 1000 };
const deps = { getConfig: () => config, analyze: async (ctx) => ({ result: prepareChapterMemoryResult(memoryAnalysisFixture(ctx), ctx), model: config.model, inputTokens: 1200, outputTokens: 700, providerRequestId: "req_memory_fixture" }) };
async function check(name, fn) { await fn(); results.push(name); console.log(`PASS: ${name}`); }
async function queryAs(id, sql, values = []) { await db.exec("begin; set local role authenticated"); try { await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]); const r = await db.query(sql, values); await db.exec("commit"); return r; } catch (e) { await db.exec("rollback"); throw e; } }
try {
  const a = createClient("http://127.0.0.1:43071", "testanon"); const b = createClient("http://127.0.0.1:43071", "testanon");
  const aa = await a.auth.signUp({ email: "memory-a@example.invalid", password: "LocalMemoryFixtureA1!" }); assert.ifError(aa.error);
  const bb = await b.auth.signUp({ email: "memory-b@example.invalid", password: "LocalMemoryFixtureB1!" }); assert.ifError(bb.error);
  const seed = await seedMemorySql(db, aa.data.user.id); const input = { novelId: seed.novelId, chapterId: seed.firstId };
  await db.query("update chapters set content=$1,status='generated' where id=$2", [memoryProse, seed.firstId]);
  await db.query("insert into chapter_versions(chapter_id,content,source) values($1,$2,'ai_generated')", [seed.firstId, memoryProse]);
  const abilityId = randomUUID(); const clueId = randomUUID();
  await db.query("insert into memory_items(id,novel_id,memory_type,title,content,importance) values($1,$2,'ability','二十四小时预见','林舟最多预见24小时，不能突破上限。',5),($3,$2,'foreshadowing','停走的挂钟','挂钟为何停走？',3)", [abilityId, seed.novelId, clueId]);
  let prepared;
  await check("saved AI version queues independent analysis; context excludes other chapter prose and RLS denies B", async () => {
    assert.equal((await getChapterMemoryStatus(a, input)).status, "pending");
    prepared = await buildChapterMemoryContext(a, input); assert.equal(prepared.context.chapter.content, memoryProse); assert.equal(prepared.context.previousChapter, undefined);
    await assert.rejects(buildChapterMemoryContext(b, input), (e) => e.code === "NOT_FOUND");
    await assert.rejects(getChapterMemoryStatus(b, input), (e) => e.code === "NOT_FOUND");
    assert.equal((await queryAs(bb.data.user.id, "select * from chapter_memory_jobs")).rows.length, 0);
    await assert.rejects(queryAs(aa.data.user.id, "update chapter_memory_jobs set status='succeeded'"));
    await assert.rejects(buildChapterContext(a, { novelId: seed.novelId, chapterId: seed.secondId, expectedRevision: 1 }), (e) => e.code === "MEMORY_NOT_READY");
  });
  await check("native strict JSON Schema; invalid schema, foreign references and invented evidence fail before writes", async () => {
    const response = responseFixture(novelPlan(builderInput())); response.output[0].content[0].text = JSON.stringify(memoryAnalysisFixture(prepared.context));
    const client = createDeepSeekClient(config); client.fetch = async (url, options) => { const body = JSON.parse(options.body); assert.equal(body.text.format.type, "json_schema"); assert.equal(body.text.format.strict, true); assert.equal(body.text.format.name, "chapter_memory_analysis"); assert.ok(body.text.format.schema.required.includes("nextChapterRequirements")); return Response.json(response); };
    const r = await analyzeChapterMemory(prepared.context, { config, client }); assert.ok(r.result.chapterSummary.length >= 100);
    const annotated = memoryAnalysisFixture(prepared.context); annotated.characterChanges[0].newState.age = "999"; annotated.characterChanges[0].newState.name = "伪造姓名";
    const projected = prepareChapterMemoryResult(annotated, prepared.context);
    assert.equal(projected.characters.find((c) => c.name === "林舟").current_state.age, undefined);
    assert.equal(projected.characters.some((c) => c.name === "伪造姓名"), false);
    const duplicated = memoryAnalysisFixture(prepared.context);
    duplicated.newFacts.push({ ...duplicated.items[0], memoryType: "item", title: "十七号铜钥匙的持有者" });
    assert.equal(prepareChapterMemoryResult(duplicated, prepared.context).memories.filter((m) => m.memory_type === "item").length, 1);
    const bad = memoryAnalysisFixture(prepared.context); bad.items[0].evidence = "正文没有的万能钥匙";
    assert.throws(() => prepareChapterMemoryResult(bad, prepared.context), (e) => e.code === "INVALID_AI_OUTPUT");
    bad.items[0].evidence = "编号十七的铜钥匙"; bad.items[0].existingMemoryId = randomUUID();
    assert.throws(() => prepareChapterMemoryResult(bad, prepared.context));
    response.output[0].content[0].text = "{}"; await assert.rejects(analyzeChapterMemory(prepared.context, { config, client }));
  });
  await check("provider failure preserves prose and AI version, is logged, and does not auto-retry paid analysis", async () => {
    const failed = await updateChapterMemory(a, input, { ...deps, analyze: async () => { throw new AiError("AI_TIMEOUT", "timeout", 504); } }); assert.equal(failed.status, "failed");
    assert.equal((await db.query("select content from chapters where id=$1", [seed.firstId])).rows[0].content, memoryProse);
    assert.equal((await db.query("select count(*)::int as n from chapter_versions where chapter_id=$1", [seed.firstId])).rows[0].n, 1);
    await updateChapterMemory(a, input, { ...deps, analyze: () => assert.fail("implicit repeat must not call AI") });
  });
  await check("database failure atomically rolls back all memory changes and keeps saved chapter/version", async () => {
    await db.exec("create function test_fail_timeline() returns trigger language plpgsql as $$ begin raise exception 'TEST_FAILURE'; end $$; create trigger test_timeline before insert on timeline_events for each row execute function test_fail_timeline();");
    assert.equal((await updateChapterMemory(a, { ...input, retry: true }, deps)).status, "failed");
    assert.equal((await db.query("select count(*)::int as n from characters where novel_id=$1", [seed.novelId])).rows[0].n, 2);
    assert.equal((await db.query("select content from memory_items where id=$1", [abilityId])).rows[0].content, "林舟最多预见24小时，不能突破上限。");
    await db.exec("drop trigger test_timeline on timeline_events; drop function test_fail_timeline();");
  });
  await check("explicit retry writes summary, state, timeline, source-linked deduplicated memories and resolves historical foreshadowing", async () => {
    assert.equal((await updateChapterMemory(a, { ...input, retry: true }, { ...deps, analyze: async (ctx) => { const result = await deps.analyze(ctx); result.result.timelineEvents = []; return result; } })).status, "succeeded");
    const summary = (await db.query("select * from chapter_summaries where chapter_id=$1", [seed.firstId])).rows[0]; assert.ok(summary.summary.length >= 100 && summary.summary.length <= 300); assert.equal(summary.next_chapter_requirements.length, 1); assert.ok(summary.analysis_content_hash);
    const ability = (await db.query("select * from memory_items where id=$1", [abilityId])).rows[0]; assert.ok(ability.content.includes("不能突破上限")); assert.ok(ability.content.includes("流鼻血")); assert.equal(ability.source_type, "chapter"); assert.equal(ability.source_id, seed.firstId);
    assert.equal((await db.query("select count(*)::int as n from memory_items where novel_id=$1 and memory_type='ability'", [seed.novelId])).rows[0].n, 1);
    assert.equal((await db.query("select status from memory_items where id=$1", [clueId])).rows[0].status, "resolved");
    const c = (await db.query("select * from characters where novel_id=$1 and name='林舟'", [seed.novelId])).rows[0]; assert.equal(c.age, "26"); assert.equal(c.background, "普通修表师"); assert.equal(c.current_state.health, "流鼻血"); assert.equal(c.current_state.location, "上海旧钟表店柜台旁");
    const timeline = (await db.query("select * from timeline_events where novel_id=$1", [seed.novelId])).rows; assert.equal(timeline.length, 1); assert.equal(timeline[0].chapter_id, seed.firstId); assert.equal(timeline[0].event_time, "");
    const logs = (await db.query("select * from ai_generation_logs where chapter_id=$1 order by created_at", [seed.firstId])).rows; assert.equal(logs.length, 3); assert.equal(logs[2].generation_type, "chapter_memory_analysis"); assert.equal(logs[2].input_tokens, 1200);
  });
  await check("repeated analysis is idempotent and next writer reads updated ability/state/summary/requirements and only active foreshadowing", async () => {
    await updateChapterMemory(a, { ...input, retry: true }, { ...deps, analyze: () => assert.fail("duplicate paid call") });
    const ctx = (await buildChapterContext(a, { novelId: seed.novelId, chapterId: seed.secondId, expectedRevision: 1 })).context;
    assert.ok(ctx.memories.find((m) => m.memory_type === "ability").content.includes("流鼻血")); assert.equal(ctx.characters.find((c) => c.name === "林舟").current_state.health, "流鼻血");
    assert.ok(ctx.continuityRequirements.some((s) => s.includes("流鼻血"))); assert.equal(ctx.unresolvedForeshadowing.length, 1); assert.ok(ctx.recentSummaries[0].summary.length >= 100);
    await db.query("update chapters set title=title,summary=summary where id=$1", [seed.firstId]);
    assert.ok((await db.query("select summary from chapter_summaries where chapter_id=$1", [seed.firstId])).rows[0].summary.length >= 100);
  });
  await check("editing analysed prose requires explicit manual review; owner and revision guards protect acknowledgement", async () => {
    await db.query("update chapters set content=content||' 林舟擦去了血迹。' where id=$1", [seed.firstId]);
    const status = await getChapterMemoryStatus(a, input); assert.equal(status.status, "needs_review");
    assert.equal((await db.query("select version_id from chapter_memory_jobs where chapter_id=$1", [seed.firstId])).rows[0].version_id, null);
    await updateChapterMemory(a, { ...input, retry: true }, { ...deps, analyze: () => assert.fail("changed analysed prose must not pay for an append-only re-analysis") });
    assert.equal((await getChapterMemoryStatus(a, input)).status, "needs_review");
    let distantId;
    for (let order = 3; order <= 8; order++) { distantId = randomUUID(); await db.query("insert into chapters(id,novel_id,title,outline,sort_order) values($1,$2,'后续章节','继续调查',$3)", [distantId, seed.novelId, order]); }
    await assert.rejects(buildChapterContext(a, { novelId: seed.novelId, chapterId: distantId, expectedRevision: 1 }), (e) => e.code === "MEMORY_NOT_READY");
    const args = { p_novel_id: seed.novelId, p_chapter_id: seed.firstId, p_expected_revision: status.chapterRevision };
    assert.ok((await b.rpc("studio_acknowledge_chapter_memory", args)).error);
    assert.equal((await a.rpc("studio_acknowledge_chapter_memory", { ...args, p_expected_revision: 1 })).error?.code, "PT409");
    // A later analysed chapter used to make this unrecoverable. The author can
    // now review historical changes without rewinding any later facts.
    await db.query("update chapters set content='后续已核对正文' where id=$1", [seed.secondId]);
    await db.query("insert into chapter_memory_jobs(chapter_id,novel_id,status,content_hash) values($1,$2,'succeeded',md5('后续已核对正文'))", [seed.secondId, seed.novelId]);
    await db.query("update chapters set summary='人工核对后的当前剧情摘要' where id=$1", [seed.firstId]);
    args.p_expected_revision = (await getChapterMemoryStatus(a, input)).chapterRevision;
    const oldSummary = (await db.query("select analysis_content_hash from chapter_summaries where chapter_id=$1", [seed.firstId])).rows[0];
    assert.ifError((await a.rpc("studio_acknowledge_chapter_memory", args)).error);
    assert.equal((await getChapterMemoryStatus(a, input)).status, "reviewed");
    assert.deepEqual((await db.query("select analysis_content_hash from chapter_summaries where chapter_id=$1", [seed.firstId])).rows[0], oldSummary);
    const ctx = (await buildChapterContext(a, { novelId: seed.novelId, chapterId: seed.secondId, expectedRevision: 1 }).catch((error) => { assert.equal(error.code, "CONTENT_EXISTS"); return null; })); assert.equal(ctx, null);
    const future = (await buildChapterContext(a, { novelId: seed.novelId, chapterId: distantId, expectedRevision: 1 })).context; assert.ok(future);
    // Read the next empty chapter immediately after the reviewed one to assert
    // old AI requirements are not silently reused after manual confirmation.
    await db.query("update chapters set content='' where id=$1", [seed.secondId]);
    const next = (await buildChapterContext(a, { novelId: seed.novelId, chapterId: seed.secondId, expectedRevision: 3 })).context;
    assert.equal(next.recentSummaries[0].summary, "人工核对后的当前剧情摘要"); assert.equal(next.recentSummaries[0].key_events, undefined);
    assert.equal(next.continuityRequirements.some((s) => s.includes("下一章从休息衔接")), false);
    await updateChapterMemory(a, { ...input, retry: true }, { ...deps, analyze: () => assert.fail("review acknowledgement must not trigger paid analysis") });
    await db.query("update chapters set content='' where id=$1", [seed.firstId]);
    assert.equal((await getChapterMemoryStatus(a, input)).status, "needs_review");
    assert.ifError((await a.rpc("studio_acknowledge_chapter_memory", { ...args, p_expected_revision: (await getChapterMemoryStatus(a, input)).chapterRevision })).error);
  });
  await check("concurrent first analyses share a lease; editing during analysis rejects stale output and keeps prose", async () => {
    const fresh = await seedMemorySql(db, aa.data.user.id); const freshInput = { novelId: fresh.novelId, chapterId: fresh.firstId };
    await db.query("update chapters set content=$1 where id=$2", [memoryProse, fresh.firstId]);
    await db.query("insert into chapter_versions(chapter_id,content,source) values($1,$2,'ai_generated')", [fresh.firstId, memoryProse]);
    let entered; const ready = new Promise((r) => { entered = r; }); let release; const blocked = new Promise((r) => { release = r; });
    const task = updateChapterMemory(a, freshInput, { ...deps, analyze: async (ctx) => { entered(); await blocked; return deps.analyze(ctx); } }); await ready;
    try {
      assert.equal((await updateChapterMemory(a, { ...freshInput, retry: true }, { ...deps, analyze: () => assert.fail("parallel paid call") })).status, "running");
      await db.query("update chapters set content='用户保留的新正文' where id=$1", [fresh.firstId]);
    } finally { release(); }
    const result = await task; assert.equal(result.errorType, "CONTEXT_CHANGED"); assert.equal((await db.query("select content from chapters where id=$1", [fresh.firstId])).rows[0].content, "用户保留的新正文");
  });
  await mkdir("artifacts/phase3c1", { recursive: true }); await writeFile("artifacts/phase3c1/unit-results.json", JSON.stringify({ status: "passed", scope: "explicit model fixture + real local SQL/RLS", checks: results }, null, 2));
} finally { await fixture.close(); }

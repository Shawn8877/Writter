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
import { memoryEvidenceCatalog, resolveMemoryEvidence, chapterMemoryModelContext, memoryReferenceSchema } from "../src/lib/ai/services/memory-evidence.js";
import { chapterMemoryJsonSchema } from "../src/lib/ai/schemas/chapter-memory-schema.js";
import { selectMemoryContext, MEMORY_MODEL_LIMIT, MEMORY_MODEL_BYTES } from "../src/lib/ai/context/memory-selection.js";

const fixture = await startSupabaseFixture({ port: 43071, quiet: true }); const db = fixture.db; const results = [];
const config = { model: "deepseek-flash", apiKey: "fixture-only", timeoutMs: 1000 };
const deps = { getConfig: () => config, analyze: async (ctx) => {
  const extracted = memoryAnalysisFixture(ctx);
  extracted.characterChanges[0].newState.knowledge = "知道自己的预见上限为未来二十四小时";
  extracted.characterChanges[0].evidence = "林舟在上海旧钟表店获得了预见能力。他只能看见未来二十四小时，超过这个上限就是一片漆黑。他试着看得更远，却立刻流鼻血，只好坐在柜台旁休息。";
  return { result: prepareChapterMemoryResult(extracted, ctx), model: config.model, inputTokens: 1200, outputTokens: 700, providerRequestId: "req_memory_fixture" };
} };
async function check(name, fn) { await fn(); results.push(name); console.log(`PASS: ${name}`); }
async function queryAs(id, sql, values = []) { await db.exec("begin; set local role authenticated"); try { await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]); const r = await db.query(sql, values); await db.exec("commit"); return r; } catch (e) { await db.exec("rollback"); throw e; } }
try {
  const a = createClient("http://127.0.0.1:43071", "testanon"); const b = createClient("http://127.0.0.1:43071", "testanon");
  const aa = await a.auth.signUp({ email: "memory-a@example.invalid", password: "LocalMemoryFixtureA1!" }); assert.ifError(aa.error);
  const bb = await b.auth.signUp({ email: "memory-b@example.invalid", password: "LocalMemoryFixtureB1!" }); assert.ifError(bb.error);
  const seed = await seedMemorySql(db, aa.data.user.id); const input = { novelId: seed.novelId, chapterId: seed.firstId };
  await db.query("update characters set current_state=current_state||'{\"knowledge\":\"尚不知道能力上限\"}'::jsonb where novel_id=$1 and name='林舟'", [seed.novelId]);
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
    const passages=memoryEvidenceCatalog(prepared.context.chapter.content);
    assert.ok(passages.every(passage=>passage.text.length<=480&&prepared.context.chapter.content.includes(passage.text)));
    assert.throws(()=>resolveMemoryEvidence({keyEvents:[{evidence:"E9999"}]},passages));
    const response = responseFixture(novelPlan(builderInput())); response.output[0].content[0].text = JSON.stringify(memoryAnalysisFixture({...prepared.context,evidencePassages:passages}));
    const client = createDeepSeekClient(config); client.fetch = async (url, options) => { const body = JSON.parse(options.body); assert.equal(body.reasoning.effort,"none"); assert.equal(body.max_output_tokens,16000); assert.equal(body.text.format.type, "json_schema"); assert.equal(body.text.format.strict, true); assert.equal(body.text.format.name, "chapter_memory_analysis"); assert.ok(body.text.format.schema.required.includes("nextChapterRequirements")); return Response.json(response); };
    const r = await analyzeChapterMemory(prepared.context, { config, client }); assert.ok(r.result.chapterSummary.length >= 100);
    const annotated = memoryAnalysisFixture(prepared.context); annotated.characterChanges[0].newState.age = "999"; annotated.characterChanges[0].newState.name = "伪造姓名";
    const projected = prepareChapterMemoryResult(annotated, prepared.context);
    assert.equal(projected.characters.find((c) => c.name === "林舟").current_state.age, undefined);
    assert.equal(projected.characters.find((c) => c.name === "林舟").current_state.knowledge, "尚不知道能力上限", "Null knowledge must preserve prior knowledge");
    assert.ok(chapterMemoryJsonSchema.properties.characterChanges.items.properties.newState.required.includes("knowledge"));
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
  await check("existing plot progress uses its durable type; new-item protocol omits IDs and supplied cross-type IDs still fail", async () => {
    const context = structuredClone(prepared.context); const plotId = randomUUID();
    context.memories.push({ id: plotId, memory_type: "plot", title: "铜钥匙保管记录", content: "铜钥匙保管情况待更新。", importance: 4, status: "active", metadata: {} });
    const passages = memoryEvidenceCatalog(context.chapter.content);
    const wire = memoryAnalysisFixture({ ...context, evidencePassages: passages });
    const keyEvidence = passages.find(p => p.text.includes("林舟将编号十七的铜钥匙收入口袋")).id;
    wire.items = [];
    wire.memoryUpdates = [{ memoryId: plotId, description: "林舟将编号十七的铜钥匙收入口袋。", importance: 4, evidence: keyEvidence }];
    const response = responseFixture(wire, config.model);
    const client = createDeepSeekClient(config);
    client.fetch = async (_url, options) => {
      const schema = JSON.parse(options.body).text.format.schema;
      assert.equal(schema.properties.items.items.properties.existingMemoryId, undefined);
      assert.ok(schema.properties.memoryUpdates.items.properties.memoryId.enum.includes(plotId));
      return Response.json(response);
    };
    const result = (await analyzeChapterMemory(context, { config, client })).result;
    const updated = result.memories.find(m => m.id === plotId);
    assert.equal(updated.memory_type, "plot"); assert.equal(updated.title, "铜钥匙保管记录");
    assert.ok(updated.content.includes("铜钥匙保管情况待更新。"));
    assert.equal(result.memories.filter(m => m.id === abilityId).length, 1, "Absent wire IDs still merge the existing ability by its canonical type/name");
    assert.ok(result.characters.find(c => c.name === "林舟").abilities.length > 0, "Ability changes still update the character projection");
    wire.items = [{ title: "铜钥匙", description: "林舟将编号十七的铜钥匙收入口袋。", importance: 4, evidence: keyEvidence, existingMemoryId: plotId }];
    response.output[0].content[0].text = JSON.stringify(wire);
    await assert.rejects(analyzeChapterMemory(context, { config, client }), e => e.code === "INVALID_AI_OUTPUT" && e.validationIssues?.[0]?.code === "unknown_memory_reference");
    assert.equal(context.memories.find(m => m.id === plotId).content, "铜钥匙保管情况待更新。", "Neither success projection nor failure mutates the input history");
  });
  await check("model context omits audit history without mutating merge source; typed references cannot target another category", async () => {
    const context = structuredClone(prepared.context);
    context.memories[0].metadata = { history: [{ content: "old audited fact" }], lastEvidence: "previous chapter evidence" };
    const before = structuredClone(context);
    const reduced = chapterMemoryModelContext(context);
    assert.equal(reduced.memories[0].metadata, undefined);
    assert.equal(reduced.memories.find(m=>m.id===context.memories[0].id).content, context.memories[0].content);
    assert.equal(reduced.chapter.content, undefined, "Ordered evidence carries the complete prose exactly once");
    const mismatched = memoryAnalysisFixture(context);
    mismatched.newFacts.push({ ...mismatched.foreshadowingAdded[0], existingMemoryId: clueId, memoryType: "plot" });
    assert.throws(() => prepareChapterMemoryResult(mismatched, context), e => e.code === "INVALID_AI_OUTPUT", "A candidate hint must never relax reference validation");
    const advanced = memoryAnalysisFixture(context);
    advanced.foreshadowingResolved = [];
    advanced.memoryUpdates = [{ memoryId: clueId, description: "挂钟停走是因为电池没电。", importance: 4, evidence: "说明停走的挂钟只是电池没电" }];
    const clue = prepareChapterMemoryResult(advanced, context).memories.find(m => m.id === clueId);
    assert.equal(clue.status, "active", "Progress on an existing clue must not resolve it");
    assert.ok(clue.content.startsWith("挂钟为何停走？"));
    assert.equal(clue.memory_type, "foreshadowing");
    assert.equal(clue.title, "停走的挂钟");
    advanced.memoryUpdates[0].memoryId = randomUUID();
    assert.throws(() => prepareChapterMemoryResult(advanced, context), e => e.code === "INVALID_AI_OUTPUT");
    advanced.memoryUpdates[0].memoryId = clueId;
    const retired = structuredClone(context);
    retired.memories.find(m => m.id === clueId).status = "resolved";
    assert.throws(() => prepareChapterMemoryResult(advanced, retired), e => e.code === "INVALID_AI_OUTPUT");
    assert.equal(memoryEvidenceCatalog(context.chapter.content).map(p=>p.text).join("").replace(/\s/g,""), context.chapter.content.replace(/\s/g,""));
    assert.deepEqual(context, before, "The durable merge source retains all audit metadata");
    const schema = memoryReferenceSchema(chapterMemoryJsonSchema, context.memories);
    for (const field of ["newFacts", "worldUpdates", "abilityChanges", "items", "foreshadowingAdded"]) {
      assert.equal(schema.properties[field].items.properties.existingMemoryId, undefined);
      assert.ok(!schema.properties[field].items.required.includes("existingMemoryId"));
      assert.equal(schema.properties[field].items.additionalProperties, false);
    }
    assert.ok(schema.properties.memoryUpdates.items.properties.memoryId.enum.includes(clueId));
    assert.equal(memoryReferenceSchema(chapterMemoryJsonSchema, []).properties.memoryUpdates.maxItems, 0);
    assert.deepEqual(schema.properties.foreshadowingResolved.items.properties.memoryId.enum, [clueId]);
    assert.equal(memoryReferenceSchema(chapterMemoryJsonSchema, []).properties.foreshadowingResolved.maxItems, 0);
  });
  await check("more than 500 stored memories use bounded relevant model candidates but full retired history for deduplication", async () => {
    const inserted = (await db.query("insert into memory_items(novel_id,memory_type,title,content,importance,status) select $1,'plot','无关旧事'||n,repeat('其他城市旧项目的日常采购。',30),2,'active' from generate_series(1,520) n returning id", [seed.novelId])).rows.map(r=>r.id);
    const retiredId = randomUUID();
    await db.query("insert into memory_items(id,novel_id,memory_type,title,content,importance,status) values($1,$2,'foreshadowing','钥匙对应何处',$3,3,'resolved')",[retiredId,seed.novelId,"已查清钥匙对应哪扇门，保留历史核验细节。".repeat(100)]);
    try {
      const full = (await buildChapterMemoryContext(a,input)).context;
      const selected = selectMemoryContext(full.memories,full.chapter);
      assert.ok(full.memories.length>500);
      assert.ok(selected.length<=MEMORY_MODEL_LIMIT);
      assert.ok(Buffer.byteLength(JSON.stringify(selected))<=MEMORY_MODEL_BYTES);
      assert.ok(selected.some(m=>m.id===abilityId),"Important ability rules must remain");
      assert.ok(!selected.some(m=>m.id===retiredId),"Retired history must not displace active context");
      const projected = prepareChapterMemoryResult(memoryAnalysisFixture(full),full);
      assert.ok(!projected.memories.some(m=>m.title==="钥匙对应何处"),"Omitted resolved clue must not be recreated or reopened");
      const rules=Array.from({length:121},()=>({id:randomUUID(),memory_type:"rule",title:"有效规则",content:"不得改动",status:"active",importance:5}));
      assert.throws(()=>selectMemoryContext(rules,full.chapter),e=>e.code==="CONTEXT_TOO_LARGE","Never silently drop protected rules to meet a cap");
      const relevant={...full.memories.find(m=>m.id===abilityId),id:randomUUID(),memory_type:"plot",title:"十七号铜钥匙",content:"林舟调查铜钥匙",importance:4};
      const irrelevant={...relevant,id:randomUUID(),title:"火星停车场",content:"宇宙飞船停车费",updated_at:new Date().toISOString()};
      const ranked=selectMemoryContext([irrelevant,relevant],full.chapter);
      assert.equal(ranked[0].id,relevant.id,"Current chapter relevance wins over incidental recency");
    } finally {await db.query("delete from memory_items where id=any($1::uuid[])",[[...inserted,retiredId]]);}
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
    const loadedRevision = (await a.from("novels").select("revision").eq("id", seed.novelId).single()).data.revision;
    assert.equal((await getChapterMemoryStatus(a, input)).novelRevision, loadedRevision);
    await db.query("update novels set title=title||'修订' where id=$1", [seed.novelId]);
    assert.ok((await getChapterMemoryStatus(a, input)).novelRevision > loadedRevision);
    const ctx = (await buildChapterContext(a, { novelId: seed.novelId, chapterId: seed.secondId, expectedRevision: 1 })).context;
    assert.ok(ctx.memories.find((m) => m.memory_type === "ability").content.includes("流鼻血")); assert.equal(ctx.characters.find((c) => c.name === "林舟").current_state.health, "流鼻血");
    assert.equal(ctx.characters.find((c) => c.name === "林舟").current_state.knowledge, "知道自己的预见上限为未来二十四小时", "Persisted knowledge must reach the next chapter writer");
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

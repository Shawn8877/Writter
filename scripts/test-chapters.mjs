import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { startSupabaseFixture } from "./testing/supabase-fixture.mjs";
import { seedChapterSql } from "./testing/chapter-fixtures.mjs";
import { responseFixture, novelPlan, builderInput } from "./testing/novel-builder-fixtures.mjs";
import { buildChapterContext } from "../src/lib/ai/services/chapter-context.js";
import { generateChapterPreview, confirmChapterPreview } from "../src/lib/ai/services/chapter-workflow.js";
import { writeChapter } from "../src/lib/ai/services/chapter-writer-service.js";
import { createDeepSeekClient } from "../src/lib/ai/deepseek.js";
import { AiError } from "../src/lib/ai/errors.js";

const results = []; const fixture = await startSupabaseFixture({ port: 43061, quiet: true }); const db = fixture.db;
const config = { model: "deepseek-flash", apiKey: "fixture-only", timeoutMs: 1000 };
const prose = "林舟推开玻璃门，许青的声音从耳机中传来。她仍在上海档案馆。他只能预见未来二十四小时，绝不能越过那道界线。".repeat(20);
const generated = { content: prose, wordCount: [...prose].length, lengthWarning: null, model: config.model, inputTokens: 1800, outputTokens: 1200, providerRequestId: "req_chapter_fixture" };
const deps = { getConfig: () => config, write: async () => generated };
async function check(name, run) { await run(); results.push(name); console.log(`PASS: ${name}`); }
async function log(id) { return (await db.query("select * from ai_generation_logs where id=$1", [id])).rows[0]; }
async function queryAs(id, sql, values = []) { await db.exec("begin; set local role authenticated"); try { await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]); const r = await db.query(sql, values); await db.exec("commit"); return r; } catch (e) { await db.exec("rollback"); throw e; } }
try {
  const a = createClient("http://127.0.0.1:43061", "testanon"); const b = createClient("http://127.0.0.1:43061", "testanon");
  const aa = await a.auth.signUp({ email: "chapters-a@example.invalid", password: "LocalFixturePassword1!" }); assert.ifError(aa.error);
  const bb = await b.auth.signUp({ email: "chapters-b@example.invalid", password: "LocalFixturePassword2!" }); assert.ifError(bb.error);
  const s = await seedChapterSql(db, aa.data.user.id);
  const input = { novelId: s.novelId, chapterId: s.chapterId, requestId: randomUUID(), expectedRevision: 1 };
  let prepared; let preview;
  await check("context reads Bible, characters, world, active memories, previous full chapter, summaries, volume and continuity requirements", async () => {
    prepared = await buildChapterContext(a, input);
    assert.equal(prepared.context.previousChapter.content, s.previousContent); assert.equal(prepared.context.recentSummaries.length, 1);
    assert.equal(prepared.context.characters.length, 2); assert.equal(prepared.context.world.length, 3); assert.equal(prepared.context.memories.length, 2);
    assert.ok(prepared.context.bible.power_system.includes("24小时")); assert.ok(prepared.context.volume.summary); assert.equal(prepared.context.continuityRequirements.length, 3);
    await assert.rejects(buildChapterContext(b, input), (e) => e.code === "NOT_FOUND");
    await assert.rejects(buildChapterContext(a, { ...input, expectedRevision: 99 }), (e) => e.code === "CONTEXT_CHANGED");
  });
  await check("DeepSeek Responses receives target length and continuity prompt; refuses empty, incomplete or refused text", async () => {
    const response = responseFixture(novelPlan(builderInput())); response.output[0].content[0].text = prose;
    const client = createDeepSeekClient(config);
    client.fetch = async (url, options) => { const body = JSON.parse(options.body); assert.equal(String(url), "https://api.deepseek.com/responses"); assert.ok(body.input[0].content.includes("960–1440")); assert.equal(JSON.parse(body.input[1].content).previousChapter.content, s.previousContent); assert.equal(body.stream, false); return Response.json(response); };
    const result = await writeChapter(prepared.context, { config, client }); assert.equal(result.content, prose);
    client.fetch = async (_url, options) => { assert.equal(JSON.parse(options.body).reasoning.effort,"none"); return Response.json(response); };
    assert.equal((await writeChapter(prepared.context,{config,client,reasoningEffort:"none"})).content,prose);
    for (const mode of ["empty", "refusal", "incomplete"]) {
      const bad = structuredClone(response);
      if (mode === "empty") bad.output[0].content[0].text = " ";
      if (mode === "refusal") bad.output[0].content = [{ type: "refusal", refusal: "fixture" }];
      if (mode === "incomplete") bad.status = "incomplete";
      client.fetch = async () => Response.json(bad);
      await assert.rejects(writeChapter(prepared.context, { config, client }), (e) => ["INVALID_AI_OUTPUT", "AI_REFUSAL", "AI_INCOMPLETE"].includes(e.code));
    }
  });
  await check("preview does not save body; logs real metadata and request IDs; duplicate request never calls writer", async () => {
    const stages = []; preview = await generateChapterPreview(a, input, (e) => stages.push(e.stage), deps);
    assert.deepEqual(stages, ["preparing", "generating"]); assert.equal((await db.query("select content from chapters where id=$1", [s.chapterId])).rows[0].content, "");
    const row = await log(preview.generationId); assert.equal(row.generation_type, "chapter_generation"); assert.equal(row.provider, "deepseek"); assert.equal(row.input_tokens, 1800); assert.equal(row.chapter_id, s.chapterId); assert.equal(row.status, "succeeded");
    await assert.rejects(generateChapterPreview(a, input, () => {}, { ...deps, write: () => assert.fail("duplicate paid call") }), (e) => e.code === "DUPLICATE_REQUEST");
  });
  await check("RLS hides previews/logs; B and direct REST cannot confirm, modify previews or read the server lease", async () => {
    await assert.rejects(confirmChapterPreview(b, { generationId: preview.generationId }), (e) => e.code === "NOT_FOUND");
    assert.equal((await queryAs(bb.data.user.id, "select * from ai_chapter_previews")).rows.length, 0);
    await assert.rejects(queryAs(aa.data.user.id, "select lease_token from ai_generation_logs"));
    await assert.rejects(queryAs(aa.data.user.id, "update ai_chapter_previews set content='forged'"));
    await assert.rejects(confirmChapterPreview(a, { generationId: preview.generationId, content: "forged" }), (e) => e.code === "INVALID_INPUT");
  });
  await check("version insert failure rolls back body and receipt; retry then atomically saves exactly one ai_generated version", async () => {
    await db.exec("create function public.test_block_version() returns trigger language plpgsql as $$ begin raise exception 'test-only failure'; end $$; create trigger test_version_failure before insert on public.chapter_versions for each row execute function public.test_block_version();");
    await assert.rejects(confirmChapterPreview(a, { generationId: preview.generationId }), (e) => e.code === "AI_DATABASE_ERROR");
    assert.equal((await db.query("select content from chapters where id=$1", [s.chapterId])).rows[0].content, "");
    await db.exec("drop trigger test_version_failure on public.chapter_versions; drop function public.test_block_version();");
    const saved = await confirmChapterPreview(a, { generationId: preview.generationId }); assert.equal(saved.chapter.body, prose); assert.equal(saved.chapter.status, "已生成"); assert.ok(saved.chapter.wordCount > 0);
    await Promise.all([confirmChapterPreview(a, { generationId: preview.generationId }), confirmChapterPreview(a, { generationId: preview.generationId })]);
    const versions = await db.query("select * from chapter_versions where chapter_id=$1", [s.chapterId]); assert.equal(versions.rows.length, 1); assert.equal(versions.rows[0].source, "ai_generated");
    await db.query("update chapters set content='作者后续修改' where id=$1", [s.chapterId]);
    assert.equal((await confirmChapterPreview(a, { generationId: preview.generationId })).chapter.body, "作者后续修改");
    await assert.rejects(generateChapterPreview(a, { ...input, requestId: randomUUID() }, () => {}, deps), (e) => e.code === "CONTENT_EXISTS");
  });
  await check("cloud content or Bible changes after preview prevent overwrite and preserve generated preview", async () => {
    const other = await seedChapterSql(db, aa.data.user.id); const request = { ...input, novelId: other.novelId, chapterId: other.chapterId, requestId: randomUUID() };
    const p = await generateChapterPreview(a, request, () => {}, deps);
    await db.query("update novel_bible set main_conflict='新设定' where novel_id=$1", [other.novelId]);
    await assert.rejects(confirmChapterPreview(a, { generationId: p.generationId }), (e) => e.code === "CONTEXT_CHANGED");
    await db.query("update chapters set content='另一设备的新正文' where id=$1", [other.chapterId]);
    await assert.rejects(confirmChapterPreview(a, { generationId: p.generationId }), (e) => e.code === "CONTENT_EXISTS");
    assert.equal((await db.query("select content from ai_chapter_previews where generation_id=$1", [p.generationId])).rows[0].content, prose);
  });
  await check("provider failure records safe code and releases lease; parallel request is blocked before writer", async () => {
    const other = await seedChapterSql(db, aa.data.user.id); const request = { ...input, novelId: other.novelId, chapterId: other.chapterId, requestId: randomUUID() };
    await assert.rejects(generateChapterPreview(a, request, () => {}, { ...deps, write: async () => { throw new AiError("AI_CREDITS_EXHAUSTED", "余额不足", 402); } }), (e) => e.code === "AI_CREDITS_EXHAUSTED");
    const row = (await db.query("select * from ai_generation_logs where request_id=$1", [request.requestId])).rows[0]; assert.equal(row.status, "failed"); assert.equal(row.error_type, "AI_CREDITS_EXHAUSTED");
    let entered; const ready = new Promise((resolve) => { entered = resolve; }); let release; const blocked = new Promise((resolve) => { release = resolve; });
    const running = generateChapterPreview(a, { ...request, requestId: randomUUID() }, () => {}, { ...deps, write: async () => { entered(); await blocked; return generated; } });
    await ready;
    try { await assert.rejects(generateChapterPreview(a, { ...request, requestId: randomUUID() }, () => {}, { ...deps, write: () => assert.fail("parallel paid call") }), (e) => e.code === "AI_BUSY"); } finally { release(); await running; }
  });
  await check("explicit same-input retry after incomplete thinking disables thinking without automatic calls; changed input resets policy", async () => {
    const client=createClient("http://127.0.0.1:43061","testanon",{auth:{persistSession:false}});
    const auth=await client.auth.signUp({email:`${randomUUID()}@example.invalid`,password:"WriterRetryFixture1!"});assert.ifError(auth.error);
    const seed=await seedChapterSql(db,auth.data.user.id);
    const request={novelId:seed.novelId,chapterId:seed.chapterId,expectedRevision:1,requestId:randomUUID()};
    const modes=[];
    const incomplete={...deps,write:async(_ctx,options)=>{modes.push(options.reasoningEffort);const error=new AiError("AI_INCOMPLETE","fixture");error.metadata={model:config.model,inputTokens:30000,outputTokens:13000};throw error;}};
    await assert.rejects(generateChapterPreview(client,request,()=>{},incomplete),e=>e.code==="AI_INCOMPLETE");
    assert.deepEqual(modes,["low"],"Failure cannot trigger an automatic paid retry");
    await assert.rejects(generateChapterPreview(client,request,()=>{},{...deps,write:()=>assert.fail("Duplicate request must not call AI")}),e=>e.code==="DUPLICATE_REQUEST");
    const next=await generateChapterPreview(client,{...request,requestId:randomUUID()},()=>{},{...deps,write:async(_ctx,options)=>{modes.push(options.reasoningEffort);return generated;}});
    assert.deepEqual(modes,["low","none"]);
    await assert.rejects(generateChapterPreview(client,{...request,requestId:randomUUID()},()=>{},incomplete),e=>e.code==="AI_INCOMPLETE");
    await db.query("update novel_bible set main_conflict=main_conflict||' 新的作者设定' where novel_id=$1",[seed.novelId]);
    await generateChapterPreview(client,{...request,requestId:randomUUID()},()=>{},{...deps,write:async(_ctx,options)=>{modes.push(options.reasoningEffort);return generated;}});
    assert.deepEqual(modes,["low","none","low","low"]);
    const rows=(await db.query("select status,input_tokens,output_tokens from ai_generation_logs where novel_id=$1 order by created_at",[seed.novelId])).rows;
    assert.equal(rows.length,4);assert.equal(rows[0].output_tokens,13000);assert.equal(rows[0].status,"failed");
    assert.equal((await db.query("select count(*)::int as n from chapter_versions where chapter_id=$1",[seed.chapterId])).rows[0].n,0);
    assert.ok(next.generationId,"Recovery creates only a preview, never saves body implicitly");
  });
  await check("completed reasoning-only response remains failed; explicit same-input retry recovers once without saving or losing usage", async () => {
    const client = createClient("http://127.0.0.1:43061", "testanon", { auth: { persistSession: false } });
    const auth = await client.auth.signUp({ email: `${randomUUID()}@example.invalid`, password: "EmptyWriterFixture1!" }); assert.ifError(auth.error);
    const seed = await seedChapterSql(db, auth.data.user.id);
    const request = { novelId: seed.novelId, chapterId: seed.chapterId, expectedRevision: 1, requestId: randomUUID() };
    const provider = createDeepSeekClient(config); const modes = [];
    const empty = responseFixture({}, config.model);
    empty.output = [{ type: "reasoning", id: "reasoning_only", summary: [] }];
    empty.usage = { input_tokens: 38009, output_tokens: 8556, output_tokens_details: { reasoning_tokens: 8556 }, total_tokens: 46565 };
    provider.fetch = async (_url, options) => { modes.push(JSON.parse(options.body).reasoning.effort); return Response.json(empty); };
    const actualWriter = { getConfig: () => config, write: (context, options) => writeChapter(context, { ...options, client: provider }) };
    await assert.rejects(generateChapterPreview(client, request, () => {}, actualWriter), e => e.code === "INVALID_AI_OUTPUT");
    assert.deepEqual(modes, ["low"], "No automatic second paid call");
    assert.equal((await db.query("select count(*)::int as n from ai_chapter_previews where chapter_id=$1", [seed.chapterId])).rows[0].n, 0);
    const complete = responseFixture({}, config.model); complete.output[0].content[0].text = prose;
    provider.fetch = async (_url, options) => { modes.push(JSON.parse(options.body).reasoning.effort); return Response.json(complete); };
    const preview = await generateChapterPreview(client, { ...request, requestId: randomUUID() }, () => {}, actualWriter);
    assert.equal(preview.content, prose); assert.deepEqual(modes, ["low", "none"]);
    const logs = (await db.query("select status,error_type,input_tokens,output_tokens from ai_generation_logs where novel_id=$1 order by created_at", [seed.novelId])).rows;
    assert.equal(logs.length, 2); assert.equal(logs[0].status, "failed"); assert.equal(logs[0].error_type, "INVALID_AI_OUTPUT");
    assert.equal(logs[0].input_tokens, 38009); assert.equal(logs[0].output_tokens, 8556);
    assert.equal((await db.query("select content from chapters where id=$1", [seed.chapterId])).rows[0].content, "");
    assert.equal((await db.query("select count(*)::int as n from chapter_versions where chapter_id=$1", [seed.chapterId])).rows[0].n, 0);
  });
  await check("missing outline/Bible, invalid target and oversized context fail before any paid request", async () => {
    const other = await seedChapterSql(db, aa.data.user.id); const request = { ...input, novelId: other.novelId, chapterId: other.chapterId, requestId: randomUUID() };
    await db.query("update novels set chapter_word_target=50000 where id=$1", [other.novelId]);
    await assert.rejects(buildChapterContext(a, request), (e) => e.code === "CHAPTER_TARGET_LIMIT");
    await db.query("update novels set chapter_word_target=1200 where id=$1", [other.novelId]);
    await db.query("update chapters set outline='' where id=$1", [other.chapterId]); request.expectedRevision++;
    await assert.rejects(buildChapterContext(a, request), (e) => e.code === "OUTLINE_REQUIRED");
    await db.query("update chapters set outline='本章大纲' where id=$1", [other.chapterId]); request.expectedRevision++;
    await db.query("update novel_bible set core_premise='',main_conflict='' where novel_id=$1", [other.novelId]);
    await assert.rejects(buildChapterContext(a, request), (e) => e.code === "BIBLE_REQUIRED");
    await db.query("update novel_bible set core_premise=$1 where novel_id=$2", ["设定".repeat(100000), other.novelId]);
    await assert.rejects(buildChapterContext(a, request), (e) => e.code === "CONTEXT_TOO_LARGE");
  });
  await check("historical next-chapter plans expire while summaries, current requirements and stored history remain intact", async () => {
    const seed = await seedChapterSql(db, aa.data.user.id);
    await db.query("update chapters set content='林舟已归还钥匙，抵达档案馆。',summary='钥匙已归还，林舟抵达档案馆。' where id=$1",[seed.chapterId]);
    const oldRequirements=JSON.stringify(["明天必须到钟表店归还钥匙"]);
    const latestRequirements=JSON.stringify(["下一章从档案馆开始"]);
    await db.query("update chapter_summaries set next_chapter_requirements=$1 where chapter_id=$2",[oldRequirements,seed.previousId]);
    await db.query("update chapter_summaries set next_chapter_requirements=$1 where chapter_id=$2",[latestRequirements,seed.chapterId]);
    const nextId=randomUUID();
    await db.query("insert into chapters(id,novel_id,title,outline,sort_order) values($1,$2,'第三章','从档案馆继续查证',3)",[nextId,seed.novelId]);
    const {context}=await buildChapterContext(a,{novelId:seed.novelId,chapterId:nextId,expectedRevision:1});
    assert.equal(context.recentSummaries[0].number,1);
    assert.ok(context.recentSummaries[0].summary);
    assert.equal(context.recentSummaries[0].next_chapter_requirements,undefined);
    assert.deepEqual(context.recentSummaries[1].next_chapter_requirements,["下一章从档案馆开始"]);
    assert.ok(context.continuityRequirements.includes("下一章从档案馆开始"));
    assert.ok(!context.continuityRequirements.includes("明天必须到钟表店归还钥匙"));
    assert.deepEqual((await db.query("select next_chapter_requirements from chapter_summaries where chapter_id=$1",[seed.previousId])).rows[0].next_chapter_requirements,JSON.parse(oldRequirements));
  });
  await check("overlapping clue selections keep every chosen fact once, including clues beyond the dedicated limit", async () => {
    const seed = await seedChapterSql(db, aa.data.user.id);
    for (let i = 0; i < 45; i++) await db.query("insert into memory_items(novel_id,memory_type,title,content,importance,status) values($1,'foreshadowing',$2,$3,4,'active')", [seed.novelId, `待解线索${i}`, `线索${i}的原因尚未揭示。`]);
    await db.query("insert into memory_items(novel_id,memory_type,title,content,importance,status) values($1,'foreshadowing','已解线索','旧事已经查清',5,'resolved')", [seed.novelId]);
    const { context } = await buildChapterContext(a, { novelId: seed.novelId, chapterId: seed.chapterId, expectedRevision: 1 });
    const combined = [...context.memories, ...context.unresolvedForeshadowing];
    assert.equal(context.unresolvedForeshadowing.length, 40);
    assert.equal(context.memories.filter(m => m.memory_type === "foreshadowing").length, 5);
    assert.equal(combined.length, 47, "All 45 active clues and the two core facts remain, with no duplicated query overlap");
    assert.equal(new Set(combined.map(m => m.title)).size, 47);
    assert.ok(combined.every(m => !Object.hasOwn(m, "id")), "Lookup IDs need not increase the model payload");
    assert.ok(!combined.some(m => m.title === "已解线索"));
    assert.equal((await db.query("select count(*)::int as n from memory_items where novel_id=$1", [seed.novelId])).rows[0].n, 48, "Stored active and resolved facts are untouched");
  });
  await mkdir("artifacts/phase3c0", { recursive: true }); await writeFile("artifacts/phase3c0/unit-results.json", JSON.stringify({ status: "passed", scope: "local SQL + explicit model fixture; not real AI", checks: results }, null, 2));
} finally { await fixture.close(); }

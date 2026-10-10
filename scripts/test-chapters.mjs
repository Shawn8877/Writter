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
  await mkdir("artifacts/phase3c0", { recursive: true }); await writeFile("artifacts/phase3c0/unit-results.json", JSON.stringify({ status: "passed", scope: "local SQL + explicit model fixture; not real AI", checks: results }, null, 2));
} finally { await fixture.close(); }

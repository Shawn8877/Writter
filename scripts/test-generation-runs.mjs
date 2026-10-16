import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { startSupabaseFixture } from "./testing/supabase-fixture.mjs";
import { seedChapterSql } from "./testing/chapter-fixtures.mjs";
import { memoryProse, memoryAnalysisFixture } from "./testing/chapter-memory-fixtures.mjs";
import { prepareChapterMemoryResult } from "../src/lib/ai/services/chapter-memory-mapper.js";
import { startGenerationRun, getGenerationRun, claimGenerationStep, processGenerationStep, retryGenerationRun, cancelGenerationRun } from "../src/lib/ai/services/generation-run-service.js";
import { generateNextOutline, confirmNextOutline } from "../src/lib/ai/services/chapter-outline-service.js";
import { AiError } from "../src/lib/ai/errors.js";

const fixture = await startSupabaseFixture({ port: 43081, quiet: true });
const { db } = fixture;
const config = { model: "deepseek-flash", apiKey: "fixture-only", timeoutMs: 1000 };
const writer = { getConfig: () => config, write: async () => ({ content: memoryProse, wordCount: [...memoryProse].length, model: config.model, inputTokens: 850, outputTokens: 600, providerRequestId: "fixture_writer" }) };
const analyzer = { getConfig: () => config, analyze: async (context) => ({ result: prepareChapterMemoryResult(memoryAnalysisFixture(context), context), model: config.model, inputTokens: 700, outputTokens: 450, providerRequestId: "fixture_memory" }) };
const deps = { chapter: writer, memoryDependencies: analyzer };
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS: ${name}`); }
async function account(n) {
  const client = createClient("http://127.0.0.1:43081", "testanon");
  const auth = await client.auth.signUp({ email: `runs-${n}@example.invalid`, password: `LocalRunPassword${n}!` });
  assert.ifError(auth.error);
  return { client, userId: auth.data.user.id };
}
async function setup(client, userId, count) {
  const seed = await seedChapterSql(db, userId);
  const outline = (await db.query("select outline from chapters where id=$1", [seed.chapterId])).rows[0].outline;
  for (let number=3; number<=count+1; number++) await db.query("insert into chapters(novel_id,volume_id,title,outline,sort_order) values($1,$2,$3,$4,$5)", [seed.novelId,seed.volumeId,`第${number}章`,outline,number]);
  return seed;
}
async function step(client, runId, expected) {
  const claim = await claimGenerationStep(client, runId);
  assert.equal(claim.action, expected);
  await processGenerationStep(client, claim, deps);
  return getGenerationRun(client, runId);
}
try {
  const a = await account(1);
  const first = await setup(a.client, a.userId, 3);
  await check("missing outlines block paid calls and AI outline preview requires explicit confirmation", async () => {
    await db.query("update chapters set outline='' where id=$1", [first.chapterId]);
    const missing = await startGenerationRun(a.client, { novelId: first.novelId, count: 3, mode: "continuous" });
    assert.equal(missing.status, "outlines_required"); assert.deepEqual(missing.missingOutlines, [2]);
    const preview = await generateNextOutline(a.client, { novelId: first.novelId, chapterNumber: 2, requestId: randomUUID() }, {
      getConfig: () => config,
      generate: async () => ({ title: "第二章：钟声", outline: "林舟与许青继续核对十七号钥匙。他在上海钟表店逐项检查出入记录，发现记录中有一段被抹去。周伯说明挂钟为何停走，结尾出现新的疑问，林舟决定调查被抹去的时段。", model: config.model, inputTokens: 100, outputTokens: 100 }),
    });
    assert.equal((await db.query("select outline from chapters where id=$1", [first.chapterId])).rows[0].outline, "");
    await confirmNextOutline(a.client, preview.generationId);
    assert.ok((await db.query("select outline_approved_at from chapters where id=$1", [first.chapterId])).rows[0].outline_approved_at);
  });
  let run3;
  await check("duplicate start and cross-account RLS protect one durable run", async () => {
    const started = await startGenerationRun(a.client, { novelId: first.novelId, count: 3, mode: "continuous" });
    run3 = started.run.id;
    assert.equal((await startGenerationRun(a.client, { novelId: first.novelId, count: 3, mode: "continuous" })).run.id, run3);
    const foreign = await account(2);
    await assert.rejects(getGenerationRun(foreign.client, run3), (e) => e.code === "NOT_FOUND");
    assert.equal((await foreign.client.from("generation_runs").select("id").eq("id",run3)).data.length,0);
    assert.equal((await foreign.client.rpc("studio_cancel_generation_run", {p_run_id:run3})).error?.code,"P0002");
    assert.ok((await a.client.from("generation_runs").update({ status:"completed" }).eq("id",run3)).error);
  });
  await check("two concurrent browsers claim only one chapter writer", async () => {
    const [one,two] = await Promise.all([claimGenerationStep(a.client,run3),claimGenerationStep(a.client,run3)]);
    assert.deepEqual([one.action,two.action].sort(),["generate","wait"]);
    await processGenerationStep(a.client,one.action==="generate"?one:two,deps);
    assert.equal((await getGenerationRun(a.client,run3)).stage,"preview");
  });
  await check("second writer failure retries only that chapter; prior version and memory remain", async () => {
    await step(a.client,run3,"confirm"); await step(a.client,run3,"memory");
    const firstItem = (await getGenerationRun(a.client,run3)).chapters[0];
    const claim = await claimGenerationStep(a.client,run3); assert.equal(claim.action,"generate");
    await processGenerationStep(a.client,claim,{ ...deps, chapter: { ...writer, write: async () => { throw new AiError("AI_TIMEOUT","fixture timeout",504); } } });
    assert.equal((await getGenerationRun(a.client,run3)).status,"failed");
    assert.equal((await db.query("select count(*)::int as n from chapter_versions where chapter_id=$1",[firstItem.chapterId])).rows[0].n,1);
    await retryGenerationRun(a.client,run3);
    assert.equal((await getGenerationRun(a.client,run3)).currentIndex,1);
  });
  await check("continuous 3 chapters complete distinct versions, summaries and fresh memory", async () => {
    for (let index=1; index<3; index++) { await step(a.client,run3,"generate"); await step(a.client,run3,"confirm"); await step(a.client,run3,"memory"); }
    const run = await getGenerationRun(a.client,run3);
    assert.equal(run.status,"completed"); assert.equal(run.chapters.filter((chapter)=>chapter.status==="completed").length,3);
    const versions = (await db.query("select count(*)::int as n from chapter_versions where chapter_id in (select chapter_id from generation_run_chapters where run_id=$1) and source='ai_generated'",[run3])).rows[0].n;
    const summaries = (await db.query("select count(*)::int as n from chapter_summaries where chapter_id in (select chapter_id from generation_run_chapters where run_id=$1) and analysis_content_hash is not null",[run3])).rows[0].n;
    assert.equal(versions,3); assert.equal(summaries,3);
  });
  for (const count of [5,10]) {
    await check(`continuous ${count} chapters use independent writer, version and memory calls`, async () => {
      const user = await account(count);
      const seed = await setup(user.client,user.userId,count);
      const runId = (await startGenerationRun(user.client,{novelId:seed.novelId,count,mode:"continuous"})).run.id;
      for(let index=0; index<count; index++) { await step(user.client,runId,"generate"); await step(user.client,runId,"confirm"); await step(user.client,runId,"memory"); }
      const run = await getGenerationRun(user.client,runId);
      assert.equal(run.status,"completed");
      assert.equal((await db.query("select count(*)::int as n from chapter_versions where chapter_id in (select chapter_id from generation_run_chapters where run_id=$1) and source='ai_generated'",[runId])).rows[0].n,count);
      assert.equal((await db.query("select count(*)::int as n from chapter_memory_jobs where chapter_id in (select chapter_id from generation_run_chapters where run_id=$1) and status='succeeded'",[runId])).rows[0].n,count);
    });
  }
  await check("cancel keeps completed chapters and forbids further work", async () => {
    const user = await account(30); const seed = await setup(user.client,user.userId,3);
    const runId = (await startGenerationRun(user.client,{novelId:seed.novelId,count:3,mode:"continuous"})).run.id;
    await step(user.client,runId,"generate"); await step(user.client,runId,"confirm"); await step(user.client,runId,"memory");
    await cancelGenerationRun(user.client,runId);
    assert.equal((await claimGenerationStep(user.client,runId)).action,"wait");
    assert.equal((await getGenerationRun(user.client,runId)).chapters[0].status,"completed");
  });
  await check("cancel during confirmation finishes that chapter memory before stopping", async () => {
    const user=await account(33); const seed=await setup(user.client,user.userId,3);
    const runId=(await startGenerationRun(user.client,{novelId:seed.novelId,count:3,mode:"continuous"})).run.id;
    await step(user.client,runId,"generate");
    const confirming=await claimGenerationStep(user.client,runId); assert.equal(confirming.action,"confirm");
    const cancelling=await cancelGenerationRun(user.client,runId); assert.equal(cancelling.status,"running"); assert.equal(cancelling.cancelRequested,true);
    await processGenerationStep(user.client,confirming,deps);
    const analyzing=await claimGenerationStep(user.client,runId); assert.equal(analyzing.action,"memory");
    await processGenerationStep(user.client,analyzing,deps);
    const final=await getGenerationRun(user.client,runId); assert.equal(final.status,"cancelled"); assert.equal(final.chapters[0].status,"completed"); assert.equal(final.chapters[1].status,"pending");
  });
  await check("explicit Bible and dead-character conflict pauses before any paid writer call", async () => {
    const user=await account(34); const seed=await setup(user.client,user.userId,3);
    await db.query("update novel_bible set forbidden_changes='[\"禁止复活\"]'::jsonb where novel_id=$1",[seed.novelId]);
    await db.query("update characters set is_alive=false where novel_id=$1 and name='林舟'",[seed.novelId]);
    await db.query("update chapters set outline='林舟复活，仍然活着，去调查铜钥匙。' where id=$1",[seed.chapterId]);
    const runId=(await startGenerationRun(user.client,{novelId:seed.novelId,count:3,mode:"continuous"})).run.id;
    const paused=await claimGenerationStep(user.client,runId); assert.equal(paused.action,"paused"); assert.equal(paused.run.status,"paused");
    assert.equal((await db.query("select count(*)::int as n from ai_generation_logs where novel_id=$1",[seed.novelId])).rows[0].n,0);
    await db.query("update chapters set outline='林舟已死；许青继续核查铜钥匙和钟表店记录。' where id=$1",[seed.chapterId]);
    await retryGenerationRun(user.client,runId);
    assert.equal((await claimGenerationStep(user.client,runId)).action,"generate");
  });
  await check("next chapter keeps preview until explicit confirmation, then updates memory", async () => {
    const user=await account(31); const seed=await setup(user.client,user.userId,1);
    const runId=(await startGenerationRun(user.client,{novelId:seed.novelId,count:1,mode:"next"})).run.id;
    await step(user.client,runId,"generate");
    const preview=await getGenerationRun(user.client,runId);
    assert.equal(preview.stage,"preview"); assert.equal(preview.preview.content,memoryProse);
    assert.equal((await claimGenerationStep(user.client,runId)).action,"wait");
    assert.equal((await db.query("select content from chapters where id=$1",[seed.chapterId])).rows[0].content,"");
    const confirmed=await claimGenerationStep(user.client,runId,{manualApprove:true});
    assert.equal(confirmed.action,"confirm"); await processGenerationStep(user.client,confirmed,deps);
    await step(user.client,runId,"memory");
    assert.equal((await getGenerationRun(user.client,runId)).status,"completed");
  });
  await check("memory failure preserves body and version; retry analyzes without a second writer call", async () => {
    const user=await account(32); const seed=await setup(user.client,user.userId,3);
    const runId=(await startGenerationRun(user.client,{novelId:seed.novelId,count:3,mode:"continuous"})).run.id;
    await step(user.client,runId,"generate"); await step(user.client,runId,"confirm");
    const claim=await claimGenerationStep(user.client,runId); assert.equal(claim.action,"memory");
    await processGenerationStep(user.client,claim,{...deps,memoryDependencies:{...analyzer,analyze:async()=>{throw new AiError("AI_TIMEOUT","fixture timeout",504);}}});
    assert.equal((await getGenerationRun(user.client,runId)).status,"failed");
    assert.equal((await db.query("select count(*)::int as n from chapter_versions where chapter_id=$1",[seed.chapterId])).rows[0].n,1);
    await retryGenerationRun(user.client,runId);
    const retry=await claimGenerationStep(user.client,runId); assert.equal(retry.action,"memory");
    await processGenerationStep(user.client,retry,deps);
    assert.equal((await getGenerationRun(user.client,runId)).chapters[0].status,"completed");
    assert.equal((await db.query("select count(*)::int as n from chapter_versions where chapter_id=$1",[seed.chapterId])).rows[0].n,1);
  });
  console.log(`${checks.length} generation-run acceptance checks passed.`);
} finally { await fixture.close(); }

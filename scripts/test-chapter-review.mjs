import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { startSupabaseFixture } from "./testing/supabase-fixture.mjs";
import { seedChapterSql } from "./testing/chapter-fixtures.mjs";
import { memoryProse, memoryAnalysisFixture } from "./testing/chapter-memory-fixtures.mjs";
import { reviewFixture, reviewDependencies } from "./testing/chapter-review-fixtures.mjs";
import { buildChapterReviewContext } from "../src/lib/ai/context/chapter-review-context-builder.js";
import { updateChapterReview, listChapterReviews, validateChapterReview, analyzeChapterReview, prepareChapterReview, executeChapterReview, setReviewFindingDecision } from "../src/lib/ai/services/chapter-review-service.js";
import { startGenerationRun, claimGenerationStep, processGenerationStep, getGenerationRun, continueCriticalGenerationRun, retryGenerationRun, reconcileGenerationRun } from "../src/lib/ai/services/generation-run-service.js";
import { prepareChapterMemoryResult } from "../src/lib/ai/services/chapter-memory-mapper.js";
import { AiError } from "../src/lib/ai/errors.js";
import { matchedEvidence } from "../src/lib/ai/services/evidence.js";

const fixture = await startSupabaseFixture({ port: 43221, quiet: true });
const { db } = fixture;
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); console.log(`PASS: ${name}`); };
async function setup({ empty = false } = {}) {
  const client = createClient("http://127.0.0.1:43221", "testanon", { auth: { persistSession: false } });
  const auth = await client.auth.signUp({ email: `${randomUUID()}@example.invalid`, password: "ReviewFixtureOnly1!" }); assert.ifError(auth.error);
  const seed = await seedChapterSql(db, auth.data.user.id);
  if (!empty) {
    await db.query("update chapters set content=$1 where id=$2", [memoryProse,seed.chapterId]);
    await db.query("insert into chapter_versions(chapter_id,content,source) values($1,$2,'manual')",[seed.chapterId,memoryProse]);
  }
  return { ...seed, client, userId: auth.data.user.id, input: { novelId: seed.novelId, chapterId: seed.chapterId } };
}
function critical(context, category = "ability") {
  const r = reviewFixture(); r.status="critical"; r.overallScore=45;
  r.findings=[{category,severity:"critical",title:"规则冲突示例",description:"测试审核流程使用的确定性夹具，不代表模型语义判断。",
    evidence:[{source:"chapter",sourceId:context.chapter.id,excerpt:context.chapter.content.slice(0,30)}],
    relatedMemoryId:null,relatedCharacterId:null,relatedChapterId:context.chapter.id,suggestion:"请作者核对设定。"}];
  return r;
}
try {
  await check("quote wrapper normalization preserves exact words and rejects paraphrases or joined excerpts",async()=>{
    const source="许青说：“登记日期是去年十一月。换发日期在今年六月。还要核对原件。”";
    assert.equal(matchedEvidence(source,"“登记日期是去年十一月。换发日期在今年六月。”"),"登记日期是去年十一月。换发日期在今年六月。");
    assert.equal(matchedEvidence(source,"“登记日期是去年十二月。”"),null);
    assert.equal(matchedEvidence(source,"登记日期是去年十一月。还要核对原件。"),null);
    assert.equal(matchedEvidence(source,"登记日期是去年十一月！"),null);
  });
  const a = await setup(); const prepared = await buildChapterReviewContext(a.client,a.input);
  await check("13 metrics and ten issue categories validate; invented evidence and foreign references fail",async()=>{
    assert.equal(validateChapterReview(reviewFixture(),prepared.context).status,"passed");
    for(const category of ["character","world","ability","timeline","relationship","foreshadowing","outline","repetition","filler","transition","plot","bible","memory"]) {
      assert.equal(validateChapterReview(critical(prepared.context,category),prepared.context).findings[0].category,category);
    }
    const fake=critical(prepared.context); fake.findings[0].evidence[0].excerpt="并不存在的事实片段XYZ";
    assert.throws(()=>validateChapterReview(fake,prepared.context));
    const foreign=critical(prepared.context); foreign.findings[0].relatedCharacterId=randomUUID();
    assert.throws(()=>validateChapterReview(foreign,prepared.context));
    const wrongSource=critical(prepared.context);wrongSource.findings[0].evidence[0].sourceId=randomUUID();
    assert.throws(()=>validateChapterReview(wrongSource,prepared.context));
    const idAsProse=critical(prepared.context);idAsProse.findings[0].evidence[0].excerpt=prepared.context.chapter.id;
    assert.throws(()=>validateChapterReview(idAsProse,prepared.context));
    const outlineAsProse=critical(prepared.context);outlineAsProse.findings[0].evidence[0].excerpt="仅存在于大纲的验收句子";
    assert.throws(()=>validateChapterReview(outlineAsProse,{...prepared.context,chapter:{...prepared.context.chapter,outline:"仅存在于大纲的验收句子"}}));
    const noEvidence=critical(prepared.context); noEvidence.findings=[]; assert.throws(()=>validateChapterReview(noEvidence,prepared.context));
  });
  await check("provider receives native strict JSON schema; malformed response is rejected",async()=>{
    let sent;
    const client={responses:{create:async(body)=>{sent=body;return {status:"completed",model:"fixture",output_text:JSON.stringify(reviewFixture()),usage:{input_tokens:1,output_tokens:1}};}}};
    await analyzeChapterReview(prepared.context,{config:reviewDependencies.getConfig(),client});
    assert.equal(sent.text.format.type,"json_schema");assert.equal(sent.text.format.strict,true);assert.equal(sent.text.format.schema.additionalProperties,false);
    client.responses.create=async()=>({status:"completed",output_text:"no json"});
    await assert.rejects(analyzeChapterReview(prepared.context,{config:reviewDependencies.getConfig(),client}));
  });
  await check("bounded context includes current and previous chapter, summaries and approved outline",async()=>{
    assert.ok(prepared.chapterVersionId); assert.equal(prepared.context.chapter.content,memoryProse);
    assert.ok(prepared.context.previousChapter.content);assert.ok(prepared.context.chapter.outline);
    assert.ok(Buffer.byteLength(JSON.stringify(prepared.context))<=180000);
    assert.equal(Object.hasOwn(prepared.context,"allChapters"),false);
  });
  let reviewId;
  await check("automatic review is durable and idempotent across duplicate calls",async()=>{
    let calls=0;
    const dependencies={...reviewDependencies,analyze:async(context)=>{calls++;await new Promise(r=>setTimeout(r,50));return {...await reviewDependencies.analyze(context),result:critical(context)};}};
    const pair=await Promise.all([updateChapterReview(a.client,a.input,dependencies),updateChapterReview(a.client,a.input,dependencies)]);
    assert.equal(calls,1);reviewId=pair.find(r=>r.status==="critical").reviewId;
    assert.equal((await updateChapterReview(a.client,a.input,dependencies)).status,"critical");assert.equal(calls,1);
    assert.equal((await listChapterReviews(a.client,a.input)).reviews.length,1);
  });
  await check("accept and ignore are recorded without modifying chapter, Bible or memory",async()=>{
    const snapshot=async()=>JSON.stringify((await db.query("select content,(select row_to_json(b) from novel_bible b where b.novel_id=c.novel_id) as bible,(select json_agg(m) from memory_items m where m.novel_id=c.novel_id) as memory from chapters c where c.id=$1",[a.chapterId])).rows);
    const before=await snapshot();
    await setReviewFindingDecision(a.client,{reviewId,findingIndex:0,decision:"ignored"});
    assert.equal((await listChapterReviews(a.client,a.input)).reviews[0].result_json.authorDecisions[0],"ignored");
    await setReviewFindingDecision(a.client,{reviewId,findingIndex:0,decision:"accepted"});assert.equal(await snapshot(),before);
  });
  await check("manual re-review retains old report and creates a new version-linked history entry",async()=>{
    const manual=await updateChapterReview(a.client,{...a.input,manual:true},reviewDependencies); assert.equal(manual.status,"passed");assert.notEqual(manual.reviewId,reviewId);
    const rows=(await listChapterReviews(a.client,a.input)).reviews;assert.equal(rows.length,2);assert.ok(rows.every(r=>r.chapter_version_id===prepared.chapterVersionId));
  });
  await check("A/B cannot read, write, decide or claim each other's review IDs, chapter IDs or versions",async()=>{
    const b=await setup();
    for(const [column,id] of [["id",reviewId],["chapter_id",a.chapterId],["novel_id",a.novelId]]) {const q=await b.client.from("chapter_reviews").select("id").eq(column,id);assert.ifError(q.error);assert.equal(q.data.length,0);}
    await assert.rejects(listChapterReviews(b.client,a.input));
    assert.ok((await b.client.rpc("studio_decide_review_finding",{p_review_id:reviewId,p_finding_index:0,p_decision:"ignored"})).error);
    assert.ok((await a.client.from("chapter_reviews").update({status:"passed"}).eq("id",reviewId)).error);
    assert.ok((await a.client.from("chapter_reviews").select("lease_token")).error);
    const own=await buildChapterReviewContext(b.client,b.input);
    const forged=await b.client.rpc("studio_begin_chapter_review",{p_novel_id:b.novelId,p_chapter_id:b.chapterId,p_chapter_version_id:prepared.chapterVersionId,p_chapter_revision:own.chapterRevision,p_content_hash:(await db.query("select md5(content) hash from chapters where id=$1",[b.chapterId])).rows[0].hash,p_lease_token:randomUUID(),p_model:"fixture",p_prompt_version:"v1",p_manual:true,p_generation_run_id:null});
    assert.ok(forged.error);
  });
  await check("review failure retries once, logs both attempts, preserves body and requires explicit re-review",async()=>{
    const f=await setup();let calls=0;
    const failure={...reviewDependencies,analyze:async()=>{calls++;throw new AiError("AI_TIMEOUT","fixture",504);}};
    const result=await updateChapterReview(f.client,f.input,failure);assert.equal(result.status,"failed");assert.equal(calls,2);
    await updateChapterReview(f.client,f.input,failure);assert.equal(calls,2);
    assert.equal((await db.query("select content from chapters where id=$1",[f.chapterId])).rows[0].content,memoryProse);
    assert.equal((await db.query("select count(*)::int n from ai_generation_logs where novel_id=$1 and generation_type='chapter_review'",[f.novelId])).rows[0].n,2);
    assert.equal((await updateChapterReview(f.client,{...f.input,manual:true},reviewDependencies)).status,"passed");
  });
  await check("edited body during analysis marks report stale without publishing old advice",async()=>{
    const s=await setup();const claim=await prepareChapterReview(s.client,s.input,reviewDependencies);
    await db.query("update chapters set content=content||'修订。' where id=$1",[s.chapterId]);
    assert.equal((await executeChapterReview(s.client,claim,reviewDependencies)).status,"stale");
    assert.equal((await listChapterReviews(s.client,s.input)).reviews[0].currentContent,false);
  });
  await check("critical review pauses a continuous run; author override starts next chapter without rewriting",async()=>{
    const r=await setup({empty:true});
    const row=(await db.query("select outline from chapters where id=$1",[r.chapterId])).rows[0];
    for(const n of [3,4]) await db.query("insert into chapters(novel_id,title,outline,sort_order) values($1,$2,$3,$4)",[r.novelId,`第${n}章`,row.outline,n]);
    const id=(await startGenerationRun(r.client,{novelId:r.novelId,count:3,mode:"continuous"})).run.id;
    const deps={chapter:{...reviewDependencies,write:async()=>({content:memoryProse,wordCount:memoryProse.length,model:"fixture"})},memoryDependencies:{...reviewDependencies,analyze:async(context)=>({result:prepareChapterMemoryResult(memoryAnalysisFixture(context),context),model:"fixture"})},reviewDependencies:{...reviewDependencies,analyze:async(context)=>({result:critical(context),model:"fixture"})}};
    for(const action of ["generate","confirm","memory","review"]) {const claim=await claimGenerationStep(r.client,id);assert.equal(claim.action,action);await processGenerationStep(r.client,claim,deps);}
    const paused=await getGenerationRun(r.client,id);assert.equal(paused.status,"paused");assert.equal(paused.errorType,"REVIEW_CRITICAL");assert.equal(paused.currentIndex,1);
    assert.equal((await claimGenerationStep(r.client,id)).action,"wait");
    await continueCriticalGenerationRun(r.client,id);
    assert.equal((await claimGenerationStep(r.client,id)).action,"generate");
    const reviewed=(await r.client.from("chapter_reviews").select("author_acknowledged").eq("generation_run_id",id)).data;assert.equal(reviewed[0].author_acknowledged,true);
    assert.equal((await db.query("select count(*)::int n from chapter_versions where chapter_id=$1",[r.chapterId])).rows[0].n,1);
  });
  await check("interrupted explicit review retry recovers its saved report without another paid call",async()=>{
    const r=await setup({empty:true});
    const id=(await startGenerationRun(r.client,{novelId:r.novelId,count:1,mode:"next"})).run.id;
    const deps={chapter:{...reviewDependencies,write:async()=>({content:memoryProse,wordCount:memoryProse.length,model:"fixture"})},memoryDependencies:{...reviewDependencies,analyze:async(context)=>({result:prepareChapterMemoryResult(memoryAnalysisFixture(context),context),model:"fixture"})}};
    for(const action of ["generate","confirm","memory"]) {const claim=await claimGenerationStep(r.client,id,{manualApprove:true});assert.equal(claim.action,action);await processGenerationStep(r.client,claim,deps);}
    const failure={...reviewDependencies,analyze:async()=>{throw new AiError("AI_TIMEOUT","fixture",504);}};
    await processGenerationStep(r.client,await claimGenerationStep(r.client,id),{reviewDependencies:failure});
    await retryGenerationRun(r.client,id);
    const claim=await claimGenerationStep(r.client,id);assert.equal(claim.manualReview,true);
    const saved=await updateChapterReview(r.client,{...r.input,generationRunId:id,manual:true},reviewDependencies);assert.equal(saved.status,"passed");
    await db.query("update generation_runs set lease_at=clock_timestamp()-interval '6 minutes' where id=$1",[id]);
    await reconcileGenerationRun(r.client,id);
    let extraCalls=0;
    await processGenerationStep(r.client,await claimGenerationStep(r.client,id),{reviewDependencies:{...reviewDependencies,analyze:async()=>{extraCalls++;throw new Error("Must reuse saved report");}}});
    assert.equal(extraCalls,0);assert.equal((await getGenerationRun(r.client,id)).status,"completed");
    assert.equal((await listChapterReviews(r.client,r.input)).reviews.length,2);
  });
  await check("single-next review retry cannot exceed the ordinary six-call hourly allowance",async()=>{
    const r=await setup({empty:true});
    const id=(await startGenerationRun(r.client,{novelId:r.novelId,count:1,mode:"next"})).run.id;
    const deps={chapter:{...reviewDependencies,write:async()=>({content:memoryProse,wordCount:memoryProse.length,model:"fixture"})},memoryDependencies:{...reviewDependencies,analyze:async(context)=>({result:prepareChapterMemoryResult(memoryAnalysisFixture(context),context),model:"fixture"})}};
    for(const action of ["generate","confirm","memory"]) {const claim=await claimGenerationStep(r.client,id,{manualApprove:true});assert.equal(claim.action,action);await processGenerationStep(r.client,claim,deps);}
    await claimGenerationStep(r.client,id);
    const review=await prepareChapterReview(r.client,{...r.input,generationRunId:id},reviewDependencies);
    await db.query("insert into ai_generation_logs(user_id,request_id,lease_token,input_hash,model,schema_version,status) select $1,gen_random_uuid(),gen_random_uuid(),'fixture','fixture','fixture','failed' from generate_series(1,3)",[r.userId]);
    let calls=0;
    await executeChapterReview(r.client,review,{...reviewDependencies,analyze:async()=>{calls++;throw new AiError('AI_TIMEOUT','fixture',504);}});
    assert.equal(calls,1);
    assert.equal((await db.query("select count(*)::int n from ai_generation_logs where user_id=$1",[r.userId])).rows[0].n,6);
  });
  await mkdir("artifacts/phase3d",{recursive:true});await writeFile("artifacts/phase3d/unit-results.json",JSON.stringify({passed:true,checks:results},null,2));
  console.log(`${results.length} chapter-review acceptance groups passed.`);
} finally {await fixture.close();}

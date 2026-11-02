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
import { reviewEvidenceCatalog, resolveReviewEvidence, groupReviewEvidence } from "../src/lib/ai/services/review-evidence.js";
import { currentCharacterContext, currentMemoryContext, summaryContext } from "../src/lib/ai/context/context-projection.js";
import { prepareChapterReviewInput, REVIEW_REQUEST_BYTES } from "../src/lib/ai/services/review-model-input.js";

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
  await check("model projection keeps current facts and constraints without copying audit evidence or mutating rows",async()=>{
    const person={name:"林舟",current_state:{location:"上海",description:"已知铜钥匙编号",recentChanges:[{description:"旧状态"}]}};
    const summary={summary:"查到编号",next_chapter_requirements:[{requirement:"钥匙仍在柜台",evidence:"原文片段"}]};
    const memory={id:randomUUID(),memory_type:"item",title:"铜钥匙",content:"编号十七，仍在柜台",importance:5,status:"active",metadata:{history:["旧记录"]}};
    const before=JSON.stringify([person,summary,memory]);
    assert.equal(currentCharacterContext(person).current_state.location,"上海");
    assert.equal(currentCharacterContext(person).current_state.recentChanges,undefined);
    assert.deepEqual(summaryContext(summary).next_chapter_requirements,[{requirement:"钥匙仍在柜台"}]);
    assert.equal(currentMemoryContext(memory).content,memory.content);assert.equal(currentMemoryContext(memory).metadata,undefined);
    assert.equal(JSON.stringify([person,summary,memory]),before);
  });
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
    assert.match(sent.text.format.schema.properties.fillerRisk.properties.score.description,/0表示没有风险/);
    assert.match(sent.text.format.schema.properties.repetitionRisk.properties.score.description,/100表示极高风险/);
    assert.match(sent.text.format.schema.properties.characterConsistency.properties.score.description,/越高越好/);
    assert.equal(sent.max_output_tokens,16000);
    assert.equal(sent.reasoning.effort,"low");
    assert.equal(sent.temperature,undefined);
    await analyzeChapterReview(prepared.context,{config:reviewDependencies.getConfig(),client,reasoningEffort:"none"});
    assert.equal(sent.reasoning.effort,"none");
    assert.equal(sent.temperature,0);
    client.responses.create=async()=>({status:"incomplete",output_text:JSON.stringify(reviewFixture()),usage:{input_tokens:28247,output_tokens:16000,output_tokens_details:{reasoning_tokens:15900}}});
    await assert.rejects(analyzeChapterReview(prepared.context,{config:reviewDependencies.getConfig(),client}),error=>error.code==="AI_INCOMPLETE"&&error.metadata.inputTokens===28247&&error.metadata.outputTokens===16000);
    client.responses.create=async()=>({status:"completed",output_text:"no json"});
    await assert.rejects(analyzeChapterReview(prepared.context,{config:reviewDependencies.getConfig(),client}));
  });
  await check("review evidence IDs restore exact text and its source; unknown IDs and wrong chapter evidence are rejected",async()=>{
    const before=JSON.stringify(prepared.context);
    const passages=reviewEvidenceCatalog(prepared.context);
    const chapter=passages.find(p=>p.source==="chapter");
    const result=critical(prepared.context);
    result.findings[0].evidence=[chapter.id];
    result.findings[0].relatedChapterId=chapter.id;
    const resolved=resolveReviewEvidence(result,passages);
    assert.equal(validateChapterReview(resolved,prepared.context).findings[0].evidence[0].excerpt,chapter.excerpt);
    assert.equal(resolved.findings[0].evidence[0].sourceId,prepared.context.chapter.id);
    const multi=critical(prepared.context);
    multi.findings[0].relatedChapterId=chapter.id;
    multi.findings[0].evidence=passages.slice(0,5).map(p=>p.id);
    assert.equal(validateChapterReview(resolveReviewEvidence(multi,passages),prepared.context).findings[0].evidence.length,5);
    multi.findings[0].evidence=Array(9).fill(chapter.id);
    assert.throws(()=>validateChapterReview(resolveReviewEvidence(multi,passages),prepared.context),"Evidence lists remain bounded");
    const client={responses:{create:async(body)=>{
      assert.ok(body.text.format.schema.properties.findings.items.properties.evidence.items.enum.includes(chapter.id));
      return {status:"completed",output_text:JSON.stringify(result)};
    }}};
    assert.equal((await analyzeChapterReview(prepared.context,{config:reviewDependencies.getConfig(),client})).result.status,"critical");
    result.findings[0].evidence=[{evidenceId:"R999999"}];
    assert.throws(()=>resolveReviewEvidence(result,passages));
    result.findings[0].evidence=[{evidenceId:passages.find(p=>p.source==="outline").id}];
    assert.throws(()=>validateChapterReview(resolveReviewEvidence(result,passages),prepared.context));
    assert.equal(JSON.stringify(prepared.context),before);
  });
  await check("related navigation links derive only from validated evidence, never model-provided IDs",async()=>{
    const context=structuredClone(prepared.context);
    context.characters=[{id:randomUUID(),name:"测试人物",description:"真实上下文人物"}];
    context.memories=[{id:randomUUID(),title:"测试记忆",content:"已确认事实",status:"active",importance:3,memory_type:"plot"}];
    const input=prepareChapterReviewInput(context,{model:"fixture"});
    const props=input.request.text.format.schema.properties.findings.items.properties;
    const result=critical(context);
    const current=input.passages.find(p=>p.source==="chapter");
    const memory=input.passages.find(p=>p.source==="memory");
    const character=input.passages.find(p=>p.source==="character");
    result.findings[0].evidence=[current.id,memory.id,character.id];
    for(const field of ["relatedMemoryId","relatedCharacterId","relatedChapterId"]) {
      assert.equal(props[field],undefined);
      assert.ok(!input.request.text.format.schema.properties.findings.items.required.includes(field));
      result.findings[0][field]=randomUUID();
    }
    const resolved=validateChapterReview(resolveReviewEvidence(result,input.passages),input.context);
    assert.equal(resolved.findings[0].relatedMemoryId,context.memories[0].id);
    assert.equal(resolved.findings[0].relatedCharacterId,context.characters[0].id);
    assert.equal(resolved.findings[0].relatedChapterId,context.chapter.id);
    const before=JSON.stringify(result);
    for(const value of [randomUUID(),context.memories[0].id,"R999999"]) {
      const invalid=structuredClone(result);invalid.findings[0].evidence=[value];
      assert.throws(()=>resolveReviewEvidence(invalid,input.passages),e=>e.code==="INVALID_AI_OUTPUT");
    }
    const proseOnly=structuredClone(result);proseOnly.findings[0].evidence=[current.id];
    const links=resolveReviewEvidence(proseOnly,input.passages).findings[0];
    assert.equal(links.relatedMemoryId,null);assert.equal(links.relatedCharacterId,null);
    assert.equal(links.relatedChapterId,context.chapter.id);
    const omitted=structuredClone(result);delete omitted.findings[0].suggestion;
    assert.throws(()=>validateChapterReview(resolveReviewEvidence(omitted,input.passages),context),"Do not accept incomplete findings");
    assert.equal(JSON.stringify(result),before);
  });
  await check("bounded context includes current and previous chapter, summaries and approved outline",async()=>{
    assert.ok(prepared.chapterVersionId); assert.equal(prepared.context.chapter.content,memoryProse);
    assert.ok(prepared.context.previousChapter.content);assert.ok(prepared.context.chapter.outline);
    assert.ok(Buffer.byteLength(JSON.stringify(prepared.context))<=180000);
    assert.equal(Object.hasOwn(prepared.context,"allChapters"),false);
  });
  await check("compact review directory preserves every excerpt and source; memory status is metadata rather than fake evidence",async()=>{
    const context=structuredClone(prepared.context);
    context.memories=Array.from({length:100},(_,i)=>({id:randomUUID(),memory_type:"plot",title:`记录${i}`,content:`第${i}条完整事实，含数字和否定：没有转账。`,status:"active"}));
    context.memories[0].chapter_id=context.chapter.id;
    context.memories[1].chapter_id=context.previousChapter.id;
    context.memories[1].analysisChapterId=context.chapter.id;
    context.memories[2].chapter_id=context.previousChapter.id;
    const passages=reviewEvidenceCatalog(context);
    const grouped=groupReviewEvidence(passages);
    assert.equal(passages.filter(p=>p.source==="memory").length,200);
    assert.deepEqual(grouped.flatMap(g=>g.passages.map(([id,field,excerpt])=>({id,field,excerpt,source:g.source,sourceId:g.sourceId}))),passages.map(({id,field,excerpt,source,sourceId})=>({id,field,excerpt,source,sourceId})));
    assert.ok(grouped.filter(g=>g.source==="memory").every(g=>g.status==="active"&&g.memoryType==="plot"));
    const memoryGroups=grouped.filter(g=>g.source==="memory");
    assert.equal(memoryGroups[0].derivedFromCurrentChapter,true);
    assert.equal(memoryGroups[1].derivedFromCurrentChapter,true,"A prior fact updated from this chapter is not independent evidence");
    assert.equal(memoryGroups[1].sourceChapterId,context.previousChapter.id);
    assert.equal(memoryGroups[2].derivedFromCurrentChapter,false);
    const verbose=grouped.map(g=>({...g,passages:g.passages.map(([id,field,excerpt])=>({id,field,excerpt}))}));
    assert.ok(Buffer.byteLength(JSON.stringify(grouped))<Buffer.byteLength(JSON.stringify(verbose)));
  });
  await check("review candidates remain bounded beyond 500 memories while keeping important old clues and source provenance",async()=>{
    const s=await setup();const clueId=randomUUID();
    await db.query("insert into memory_items(id,novel_id,memory_type,title,content,importance,status,chapter_id,metadata) values($1,$2,'foreshadowing','旧挂钟之谜','尚未解答的旧挂钟之谜',5,'active',$3,$4::jsonb)",[clueId,s.novelId,s.previousId,JSON.stringify({analysisChapterId:s.chapterId})]);
    await db.query("insert into memory_items(novel_id,memory_type,title,content,importance,status) select $1,'plot','无关旧事'||n,repeat('其他城市的旧仓库采购。',50),2,'active' from generate_series(1,520) n",[s.novelId]);
    const loaded=(await buildChapterReviewContext(s.client,s.input)).context;
    assert.ok(loaded.memories.length<=100);
    assert.ok(Buffer.byteLength(JSON.stringify(loaded.memories.map(({analysisChapterId:_source,...row})=>row)))<=40000);
    assert.ok(loaded.unresolvedForeshadowing.some(row=>row.id===clueId));
    assert.equal(loaded.memories.find(row=>row.id===clueId).analysisChapterId,s.chapterId);
    assert.ok(!loaded.recentSummaries.some(row=>row.id===s.previousId),"Previous summary has a dedicated source and must not be duplicated");
    assert.equal(loaded.chapter.content,memoryProse);
    assert.ok(loaded.previousChapter.content);
    const group=groupReviewEvidence(reviewEvidenceCatalog(loaded)).find(row=>row.sourceId===clueId);
    assert.equal(group.derivedFromCurrentChapter,true);
    assert.equal((await db.query("select count(*)::int as n from memory_items where novel_id=$1",[s.novelId])).rows[0].n,523,"Selection must not remove historical records");
  });
  await check("protected candidate byte overflow is deferred to the unchanged full request budget",async()=>{
    const s=await setup();
    await db.query("insert into memory_items(novel_id,memory_type,title,content,importance,status) select $1,'rule','重要规则'||n,repeat('不可篡改的核心限制。',65),5,'active' from generate_series(1,22) n",[s.novelId]);
    const loaded=(await buildChapterReviewContext(s.client,s.input)).context;
    assert.ok(Buffer.byteLength(JSON.stringify(loaded.memories))>40000);
    assert.equal(loaded.memories.filter(m=>m.title.startsWith('重要规则')).length,22);
    const preparedInput=prepareChapterReviewInput(loaded,{model:'fixture'});
    assert.ok(preparedInput.bytes<=180000);
    assert.equal(preparedInput.context.memories.filter(m=>m.title.startsWith('重要规则')).length,22);
    for(const m of loaded.memories)if(m.title.startsWith('重要规则'))m.content=Array.from({length:100},(_,i)=>`${i}：${m.content}`).join('\n');
    assert.throws(()=>prepareChapterReviewInput(loaded,{model:'fixture'}),e=>e.code==='CONTEXT_TOO_LARGE');
  });
  let reviewId;
  await check("actual review wire budget drops only optional evidence and rejects oversized protected sources before AI",async()=>{
    const context=structuredClone(prepared.context);
    const core={id:randomUUID(),memory_type:"rule",title:"不得突破预见范围",content:"最多二十四小时",importance:5,status:"active",chapter_id:context.previousChapter.id};
    context.memories=[core,...Array.from({length:100},(_,i)=>({id:randomUUID(),memory_type:"plot",title:`旧事件${i}`,content:`第${i}条采购记录。${"其他地点的采购细节。".repeat(100)}`,importance:2,status:"active"}))];
    const before=structuredClone(context);
    const reduced=prepareChapterReviewInput(context,{model:"fixture"});
    assert.ok(reduced.bytes<=REVIEW_REQUEST_BYTES);assert.ok(reduced.omittedMemories>0);
    assert.equal(reduced.context.memories[0].id,core.id);
    assert.equal(reduced.context.chapter.content,context.chapter.content);
    assert.equal(reduced.context.previousChapter.content,context.previousChapter.content);
    assert.deepEqual(reduced.context.bible,context.bible);
    assert.deepEqual(context,before,"Budgeting cannot remove stored history or mutate the caller");
    assert.equal(reduced.request.text.format.schema.properties.findings.items.properties.relatedMemoryId,undefined);
    assert.ok(!reduced.passages.some(p=>p.sourceId===context.memories.at(-1).id));
    context.bible.world_rules=Array.from({length:300},(_,i)=>`不可删除的核心设定${i}：${"不得随意改变世界规则。".repeat(50)}`).join("\n");
    assert.throws(()=>prepareChapterReviewInput(context,{model:"fixture"}),e=>e.code==="CONTEXT_TOO_LARGE");
    await assert.rejects(analyzeChapterReview(context,{config:reviewDependencies.getConfig(),client:{responses:{create:()=>assert.fail("Oversized mandatory context cannot call AI")}}}),e=>e.code==="CONTEXT_TOO_LARGE");
  });
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
  await check("incomplete thinking uses only the existing retry with reasoning disabled and preserves both attempt metrics",async()=>{
    for(const recover of [true,false]) {
      const s=await setup();const modes=[];
      const result=await updateChapterReview(s.client,s.input,{...reviewDependencies,analyze:async(context,options)=>{
        modes.push(options.reasoningEffort);
        if(modes.length===1||!recover){const error=new AiError("AI_INCOMPLETE","fixture");error.metadata={inputTokens:50000,outputTokens:16000};throw error;}
        return reviewDependencies.analyze(context);
      }});
      assert.deepEqual(modes,["low","none"]);
      assert.equal(result.status,recover?"passed":"failed");
      const logs=(await db.query("select status,input_tokens,output_tokens from ai_generation_logs where chapter_id=$1 and generation_type='chapter_review' order by created_at",[s.chapterId])).rows;
      assert.equal(logs.length,2);assert.equal(logs[0].output_tokens,16000);assert.equal(logs[0].status,"failed");
      assert.equal((await db.query("select count(*)::int as n from chapter_reviews where chapter_id=$1",[s.chapterId])).rows[0].n,1);
      assert.equal((await db.query("select content from chapters where id=$1",[s.chapterId])).rows[0].content,memoryProse);
    }
  });
  await check("temporary 503 backs off once, charges both review attempts and never duplicates a report or version",async()=>{
    const s=await setup();let calls=0;const delays=[];
    const result=await updateChapterReview(s.client,s.input,{...reviewDependencies,wait:async ms=>delays.push(ms),analyze:async()=>{
      if(++calls===1) throw Object.assign(new Error("fixture upstream unavailable"),{status:503});
      return reviewDependencies.analyze();
    }});
    assert.equal(result.status,"passed");assert.equal(calls,2);assert.deepEqual(delays,[1000]);
    assert.equal((await listChapterReviews(s.client,s.input)).reviews.length,1);
    const logs=(await db.query("select status,error_type from ai_generation_logs where novel_id=$1 and generation_type='chapter_review' order by created_at",[s.novelId])).rows;
    assert.equal(logs.length,2);assert.equal(logs[0].error_type,"AI_UPSTREAM_ERROR");assert.equal(logs[1].status,"succeeded");
    assert.equal((await db.query("select count(*)::int n from chapter_versions where chapter_id=$1",[s.chapterId])).rows[0].n,1);
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

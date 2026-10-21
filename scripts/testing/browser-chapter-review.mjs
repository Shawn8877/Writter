// Browser acceptance. Default uses local Postgres/Auth/provider fixtures;
// --real-ai-cloud explicitly spends real DeepSeek calls on disposable cloud data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, open } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { startSupabaseFixture } from "./supabase-fixture.mjs";
import { chapterFixtureRows, seedChapterSql } from "./chapter-fixtures.mjs";
import { memoryProse, memoryAnalysisFixture } from "./chapter-memory-fixtures.mjs";
import { responseFixture, novelPlan, builderInput } from "./novel-builder-fixtures.mjs";
import { reviewFixture } from "./chapter-review-fixtures.mjs";

const real = process.argv.includes("--real-ai-cloud");
const reviewsOnly = process.argv.includes("--reviews-only");
if(reviewsOnly) assert.ok(real,"Reviews-only is for resuming independent real editor checks");
if (real) assert.ok(process.argv.includes("--allow-cloud-test-writes"), "Explicit cloud write flag required");
const resumeIndex=process.argv.indexOf("--resume");
const resume=resumeIndex<0?null:process.argv[resumeIndex+1];
if(resume) assert.ok(real && /^artifacts\/phase3d\/browser-real-[\dTZ-]+$/.test(resume),"Resume requires an existing real acceptance folder");
nextEnv.loadEnvConfig(process.cwd(), true);
if (real) assert.ok(process.env.DEEPSEEK_API_KEY, "Configure DEEPSEEK_API_KEY locally");
const port = real ? 43240 : 43230;
const base = `http://127.0.0.1:${port}`;
const folder = resume || `artifacts/phase3d/browser-${real ? "real" : "fixture"}-${new Date().toISOString().replace(/[:.]/g,"-")}`;
await mkdir(folder,{recursive:true});
const previous=resume?JSON.parse(await readFile(`${folder}/results.json`,"utf8")):null;
const report = { ...previous, scope: real ? "real DeepSeek + hosted Supabase + browser" : "fixture Postgres/Auth/DeepSeek + browser", status: "running", checks: previous?.checks || [], errors: [], metrics: previous?.metrics || [] };
if(previous?.failure) {report.previousFailure=previous.failure; delete report.failure;}
const persist = () => writeFile(`${folder}/results.json`,JSON.stringify(report,null,2));
let fixture, provider, child, log, browser, context, page, stage = "setup", expectedOffline=false;
let writerCalls=0, memoryCalls=0, reviewCalls=0;
async function check(name, fn) { stage=name; await fn(); report.checks.push(name); await persist(); console.log(`PASS: ${name}`); }
const pause=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
try {
  const accounts=real ? JSON.parse(await readFile(".tools/cloud-test-accounts.json","utf8")) : {
    a:{email:"runs-browser-a@example.invalid",password:"LocalBrowserRunA1!"},
    b:{email:"runs-browser-b@example.invalid",password:"LocalBrowserRunB1!"},
  };
  if(real) { assert.equal(accounts.disposableTestProject,true); assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,`${accounts.projectRef}.supabase.co`); }
  if(!real) {
    fixture=await startSupabaseFixture({port:port+1,appPort:port,quiet:true});
    provider=createServer(async (request,response)=>{
      let raw=""; for await(const part of request) raw+=part;
      const body=JSON.parse(raw); const parsed=JSON.parse(body.input[1].content);
      const output=responseFixture(novelPlan(builderInput()));
      if(body.text?.format?.name==="chapter_memory_analysis") { memoryCalls++; output.output[0].content[0].text=JSON.stringify(memoryAnalysisFixture(parsed)); }
      else if(body.text?.format?.name==="chapter_review") {
        reviewCalls++; const reviewed=reviewFixture();
        if(reviewCalls===1) { reviewed.status="critical";reviewed.overallScore=45;reviewed.findings=[{category:"ability",severity:"critical",title:"验收用严重问题",description:"此确定性样例用于验证暂停和作者决定流程。",evidence:[{source:"chapter",sourceId:parsed.chapter.id,excerpt:parsed.chapter.content.slice(0,30)}],relatedMemoryId:null,relatedCharacterId:null,relatedChapterId:parsed.chapter.id,suggestion:"请作者核对后继续。"}]; }
        output.output[0].content[0].text=JSON.stringify(reviewed);
      }
      else { writerCalls++; output.output[0].content[0].text=memoryProse; }
      await pause(900);
      response.setHeader("Content-Type","application/json"); response.end(JSON.stringify(output));
    });
    await new Promise((resolve)=>provider.listen(port+2,"127.0.0.1",resolve));
  }
  log=await open(`${folder}/server.log`,"a");
  child=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--hostname","127.0.0.1","--port",String(port)],{
    cwd:process.cwd(),windowsHide:true,stdio:["ignore",log.fd,log.fd],
    env:{...process.env,...(!real?{
      NODE_OPTIONS:`--require "${fileURLToPath(new URL("./provider-fixture-preload.cjs",import.meta.url)).replaceAll("\\","/")}"`,
      NOVELAI_TEST_MODE:"1",NOVELAI_AI_FIXTURE:"1",NOVELAI_AI_FIXTURE_URL:`http://127.0.0.1:${port+2}/responses`,
      NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${port+1}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:"testanon-fixture-only",
      AI_PROVIDER:"deepseek",DEEPSEEK_API_KEY:"fixture-only",DEEPSEEK_MODEL:"deepseek-flash",DEEPSEEK_PROXY_URL:"",
    }:{})},
  });
  for(let attempt=0;attempt<90;attempt++) { try { if((await fetch(base+"/login")).ok) break; } catch {} if(child.exitCode!==null||attempt===89) throw new Error("Test app not ready"); await pause(1000); }
  const clients={}; const identities={};
  for(const actor of ["a","b"]) {
    clients[actor]=createClient(real?process.env.NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${port+1}`,real?process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY:"testanon-fixture-only",{auth:{persistSession:false,autoRefreshToken:false}});
    const signed=await clients[actor].auth[real?"signInWithPassword":"signUp"]({email:accounts[actor].email,password:accounts[actor].password});
    assert.ifError(signed.error); identities[actor]=signed.data.user.id;
  }
  const seed=resume?{novelId:report.novelId}:real?chapterFixtureRows(identities.a,400):await seedChapterSql(fixture.db,identities.a,400);
  if(!resume) {
    if(real) for(const [table,row] of seed.rows) { const inserted=await clients.a.from(table).insert(row); assert.ifError(inserted.error); }
    const chapter2=seed.rows.find(([table,row])=>table==="chapters"&&row.sort_order===2)[1];
    for(let number=3;number<=4;number++) {
      const outline=number===3?"承接上一章钟表店内的钟声。林舟不使用能力，不移动位置，谨慎检查封闭房间外侧的门牌与积灰，许青仍在上海档案馆电话协助核对门牌档案。找到门牌日期与记录更换日期的矛盾，留下进一步核查方向。不能揭露幕后主使，不开门，不新增能力，不重复上一章查出入记录的过程。": "承接上一章门牌与档案日期矛盾。林舟仍在上海钟表店，不使用能力。许青在档案馆从登记簿找到门牌更换申请缺少签名的明确线索，电话告知林舟。两人决定保留证据等待核实，不开封闭房门，不揭露幕后主使，不复述此前调查，不新增能力。";
      const row={ novel_id:seed.novelId,volume_id:seed.volumeId,title:`第${number}章`,outline:real?outline:chapter2.outline,sort_order:number };
      if(real) assert.ifError((await clients.a.from("chapters").insert(row)).error);
      else await fixture.db.query("insert into chapters(novel_id,volume_id,title,outline,sort_order) values($1,$2,$3,$4,$5)",[row.novel_id,row.volume_id,row.title,row.outline,row.sort_order]);
    }
  }
  report.novelId=seed.novelId; await persist();
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:"playwright");
  browser=await chromium.launch({channel:"chrome",headless:true});
  context=await browser.newContext({viewport:{width:1440,height:1000}}); context.setDefaultTimeout(45000); page=await context.newPage();
  function watch(p) {
    p.on("pageerror",(error)=>report.errors.push({stage,message:error.message}));
    p.on("console",(message)=>{if(message.type()==="error"&&!expectedOffline) report.errors.push({stage,message:message.text()});});
    p.on("request",(request)=>{if(["api.deepseek.com","api.openai.com"].includes(new URL(request.url()).hostname)) report.errors.push({stage,message:"Browser requested provider directly"});});
  }
  watch(page);
  async function login(p,actor) { await p.goto(base+"/login"); await p.getByLabel("邮箱",{exact:true}).fill(accounts[actor].email); await p.getByLabel("密码",{exact:true}).fill(accounts[actor].password); await p.getByRole("button",{name:"登录",exact:true}).click(); await p.waitForURL(base+"/dashboard"); }
  const novelUrl=`${base}/novel/${seed.novelId}/chapters`;
  if(!resume) await check("anonymous run API is rejected",async()=>{assert.equal((await context.request.post(base+"/api/ai/generation-runs",{headers:{Origin:base},data:{novelId:seed.novelId,count:3,mode:"continuous"}})).status(),401);});
  await login(page,"a"); await page.goto(novelUrl);
  if(!reviewsOnly) {
  if(resume) {
    const current=await clients.a.from("generation_runs").select("status,current_index").eq("id",report.runId).single();assert.ifError(current.error);
    if(current.data.status==="failed") {
      const retried=page.waitForResponse(response=>response.url().endsWith(`/generation-runs/${report.runId}/retry`)&&response.request().method()==="POST");
      await page.getByRole("button",{name:/重试第\d+章/}).click();
      assert.ok((await retried).ok(),"Failed step retry must be accepted before navigation");
      report.resumedFailedStep=true;await persist();
    }
  }
  if(!resume) await check("continuous 3 confirmation shows range and call estimate",async()=>{
    await page.getByRole("button",{name:"连续创作",exact:true}).click();
    await page.getByText("预计正文、记忆分析、AI 编辑审核各 3 次调用。").waitFor();
    await page.getByRole("button",{name:"继续",exact:true}).click();
    await page.getByRole("heading",{name:"确认连续创作"}).waitFor();
    assert.equal((await clients.a.from("generation_runs").select("id").eq("novel_id",seed.novelId)).data?.length||0,0);
    await page.getByRole("button",{name:"开始",exact:true}).click();
    await page.getByText("第2章",{exact:false}).first().waitFor();
  });
  let runId=report.runId;
  for(let attempt=0;attempt<30&&!runId;attempt++) {
    const runRows=await clients.a.from("generation_runs").select("id").eq("novel_id",seed.novelId); assert.ifError(runRows.error);
    runId=runRows.data[0]?.id; if(!runId) await pause(500);
  }
  assert.ok(runId); report.runId=runId; await persist();
  if(!resume) await check("duplicate start returns same run and B cannot read or cancel it",async()=>{
    const started=await clients.a.rpc("studio_start_generation_run",{p_novel_id:seed.novelId,p_count:3,p_mode:"continuous"}); assert.ifError(started.error); assert.equal(started.data.runId,runId);
    assert.equal((await clients.b.from("generation_runs").select("id").eq("id",runId)).data.length,0);
    assert.ok((await clients.b.rpc("studio_cancel_generation_run",{p_run_id:runId})).error);
  });
  if(!resume) await check("refresh, offline and closed browser preserve persisted run",async()=>{
    for(let attempt=0;attempt<4;attempt++) {
      if(attempt) await pause(2500);
      await page.reload();
      try { await page.getByRole("heading",{name:"下一章与连续创作"}).waitFor({timeout:15000}); break; }
      catch { if(attempt===3) throw new Error("Cloud novel data remained unavailable after refresh retries"); }
    }
    await page.getByText(/继续任务|AI 正在创作|正在分析章节|AI 编辑正在审核|连续创作完成|章暂停|章失败/).first().waitFor();
    expectedOffline=true; await context.setOffline(true); await pause(4000); assert.ok(await page.getByText("网络暂时中断",{exact:false}).isVisible());
    await context.setOffline(false); expectedOffline=false;
    await page.close(); page=await context.newPage(); watch(page); await page.goto(novelUrl);
    await page.getByText(/继续任务|AI 正在创作|正在分析章节|AI 编辑正在审核|连续创作完成|章暂停|章失败/).first().waitFor();
    const continueButton=page.getByRole("button",{name:"继续任务",exact:true}); if(await continueButton.isVisible()) await continueButton.click();
  });
  await check("three chapters finish with independent versions and memory",async()=>{
    const deadline=Date.now()+(real?900000:180000);
    while(Date.now()<deadline) {
      const state=await clients.a.from("generation_runs").select("status,stage,error_type,current_index").eq("id",runId).single(); assert.ifError(state.error);
      if(state.data.status==="failed") throw new Error(`Run failed at ${state.data.current_index}: ${state.data.error_type}`);
      if(state.data.status==="paused"&&state.data.error_type==="REVIEW_CRITICAL") {
        report.criticalPause=true;
        const prior=(await clients.a.from("generation_run_chapters").select("chapter_id").eq("run_id",runId).eq("position",state.data.current_index-1).single()).data;
        const before=(await clients.a.from("chapters").select("content").eq("id",prior.chapter_id).single()).data.content;
        await page.getByRole("button",{name:"我已审阅，继续创作",exact:true}).click();
        assert.equal((await clients.a.from("chapters").select("content").eq("id",prior.chapter_id).single()).data.content,before);
        report.authorOverride=true;await persist();
      }
      if(state.data.status==="completed") break;
      const resume=page.getByRole("button",{name:"继续任务",exact:true}); if(await resume.isVisible().catch(()=>false)) await resume.click();
      await pause(3000);
    }
    const final=(await clients.a.from("generation_runs").select("status").eq("id",runId).single()).data; assert.equal(final.status,"completed");
    await page.getByText("连续创作完成",{exact:true}).waitFor({timeout:30000});
    const items=await clients.a.from("generation_run_chapters").select("chapter_id,chapter_number,status").eq("run_id",runId).order("position"); assert.ifError(items.error);
    assert.deepEqual(items.data.map((item)=>item.status),["completed","completed","completed"]);
    for(const item of items.data) {
      const chapter=await clients.a.from("chapters").select("content,summary").eq("id",item.chapter_id).single(); assert.ifError(chapter.error); assert.ok(chapter.data.content.length>100);
      const versions=await clients.a.from("chapter_versions").select("id,source").eq("chapter_id",item.chapter_id); assert.ifError(versions.error); assert.equal(versions.data.filter((v)=>v.source==="ai_generated").length,1);
      const memory=await clients.a.from("chapter_memory_jobs").select("status").eq("chapter_id",item.chapter_id).single(); assert.ifError(memory.error); assert.equal(memory.data.status,"succeeded");
      const summary=await clients.a.from("chapter_summaries").select("analysis_content_hash,summary").eq("chapter_id",item.chapter_id).single(); assert.ifError(summary.error); assert.ok(summary.data.analysis_content_hash && summary.data.summary.length>=100);
      const review=await clients.a.from("chapter_reviews").select("id,status,chapter_version_id").eq("chapter_id",item.chapter_id);assert.ifError(review.error);assert.equal(review.data.length,1);assert.ok(["passed","needs_review","critical"].includes(review.data[0].status));assert.ok(review.data[0].chapter_version_id);
    }
    report.writerCalls=writerCalls; report.memoryCalls=memoryCalls;
    const logs=real ? await clients.a.from("ai_generation_logs").select("generation_type,model,input_tokens,output_tokens,latency_ms,status,chapter_id").eq("novel_id",seed.novelId)
      : {data:(await fixture.db.query("select generation_type,model,input_tokens,output_tokens,latency_ms,status,chapter_id from ai_generation_logs where novel_id=$1",[seed.novelId])).rows};
    assert.ifError(logs.error);
    report.metrics=logs.data; assert.equal(logs.data.filter((entry)=>entry.generation_type==="chapter_generation"&&entry.status==="succeeded").length,3);
    assert.equal(logs.data.filter((entry)=>entry.generation_type==="chapter_memory_analysis"&&entry.status==="succeeded").length,3);
    report.reviewCalls=reviewCalls;
    if(real) {
      report.writerCalls=logs.data.filter(entry=>entry.generation_type==="chapter_generation").length;
      report.memoryCalls=logs.data.filter(entry=>entry.generation_type==="chapter_memory_analysis").length;
      report.reviewCalls=logs.data.filter(entry=>entry.generation_type==="chapter_review").length;
    }
    if(!real) {assert.equal(writerCalls,3); assert.equal(memoryCalls,3);assert.equal(reviewCalls,3);assert.ok(report.criticalPause&&report.authorOverride);}
    await page.screenshot({path:`${folder}/completed.png`});
  });
  if(!real) await check("single next chapter shows preview before save and completes memory after confirmation",async()=>{
    const single=await seedChapterSql(fixture.db,identities.b,400);
    const second=await browser.newContext({viewport:{width:1440,height:1000}}); second.setDefaultTimeout(45000);
    const other=await second.newPage();
    other.on("pageerror",(error)=>report.errors.push({stage,message:error.message}));
    try {
      await login(other,"b"); await other.goto(`${base}/novel/${single.novelId}/chapters`);
      await other.getByRole("button",{name:"生成下一章",exact:true}).click();
      await other.getByRole("heading",{name:/第2章.*正文预览/}).waitFor({timeout:90000});
      assert.equal((await fixture.db.query("select content from chapters where id=$1",[single.chapterId])).rows[0].content,"");
      await other.getByRole("button",{name:"确认保存正文",exact:true}).click();
      await other.getByText("下一章已完成",{exact:true}).waitFor({timeout:90000});
      assert.equal((await fixture.db.query("select count(*)::int as n from chapter_versions where chapter_id=$1 and source='ai_generated'",[single.chapterId])).rows[0].n,1);
      assert.equal((await fixture.db.query("select status from chapter_memory_jobs where chapter_id=$1",[single.chapterId])).rows[0].status,"succeeded");
    } finally {await second.close();}
  });
  }
  await check("editor UI supports review, findings, history, refresh, logout and account isolation",async()=>{
    const normal="玻璃门在林舟身后合拢。周二晚上九点零一分，他走到上海旧钟表店的柜台旁，先确认玻璃盒里的铜钥匙刻着十七，再把手机镜头对准当晚的出入登记簿。许青仍在上海档案馆，通过电话逐项念出存档照片上的记录。林舟把上一章预见的局部片段告诉她：明晚九点前有人取走钥匙。因此他们决定先核对今晚可能接触钥匙的人，预见始终没有超出未来二十四小时。他没有立即认定谁在撒谎，而是用铅笔记下两份记录的差异：存档照片中二十点四十分的一行，在店里的簿子上被涂成二十点五十分，旁边还压着尚未干透的墨痕。许青确认照片是当晚拍摄的原件，并提醒他保留原始证据。林舟只拍照，没有涂改登记簿，也没有拿走钥匙。他们由此确定，照片拍下后有人修改过今夜的出入时间，但暂时无法确定修改者身份。林舟说，先查清谁有机会接触登记簿，不要把猜测当事实。电话那头的许青表示同意。林舟刚把两张照片发过去，店里封闭房间内忽然响了一声钟。他停在柜台旁，没有开门，把听见的情况低声告诉许青，准备先核对房间的使用记录。";
    const cases=real?[
      ["normal",normal,[]],
      ["character",normal+"一个从未见过的陌生人走进来。林舟毫无理由地改变了一贯的谨慎作风，未经任何核实便认定对方绝对可靠，主动交出全部调查原件和自己的住址。他明确告诉许青，他没有任何目的、计策、情绪变化或特殊原因，只是决定无条件相信陌生人。",["character"]],
      ["world",normal+"随后林舟确认自己此前的预见限制从来不存在。他没有付出代价，也没有任何条件，直接准确看到了一个月后的完整未来，并瞬间从上海钟表店移动到北京。他明确说明这是真实发生的能力使用，绝非梦境、假象或不可靠叙述。",["world","ability","bible"]],
      ["timeline",normal+"他看了手机，确定此刻是同一周的周一晚上九点零二分，距刚才周二晚上九点零一分只过了一分钟。故事中没有倒叙、时钟损坏或时间旅行。",["timeline"]],
      ["memory",normal+"许青接着确认，她本章从头到尾一直待在北京家中，既没有去过上海档案馆，也没有使用远程档案设备。这是客观事实，不是谎言。",["memory","transition","world","character","timeline"]],
    ]:[["normal",normal,[]]];
    const second=await browser.newContext({viewport:{width:1440,height:1000}});second.setDefaultTimeout(45000);
    const editor=await second.newPage();editor.on("pageerror",e=>report.errors.push({stage,message:e.message}));
    editor.on("console",m=>{if(m.type()==="error")report.errors.push({stage,message:m.text()});});
    await login(editor,"b");report.reviewCases ||= [];
    let last;
    try {
      for(const [name,content,categories] of cases) {
        const completedCase=report.reviewCases.find(item=>item.name===name);
        const revise=real&&name==="normal"&&completedCase?.status!=="passed"&&completedCase&&process.argv.includes("--revise-normal-fixture");
        if(completedCase&&!revise) {
          const found=await clients.b.from("chapter_reviews").select("id,status,result_json,overall_score").eq("id",completedCase.reviewId).single();assert.ifError(found.error);
          if(name==="normal")assert.equal(found.data.status,"passed");
          if(categories.length)assert.ok(found.data.result_json.findings.some(f=>categories.includes(f.category)),`Expected ${name} finding`);
          last={novelId:completedCase.novelId,chapterId:completedCase.chapterId,review:found.data};
          await editor.goto(`${base}/novel/${last.novelId}/chapters?chapter=${last.chapterId}`);
          continue;
        }
        const seedCase=revise?completedCase:chapterFixtureRows(identities.b,400);
        if(revise) {
          assert.ifError((await clients.b.from("chapters").update({content}).eq("id",seedCase.chapterId).eq("novel_id",seedCase.novelId)).error);
          report.reviewCaseRevisions||=[];report.reviewCaseRevisions.push(completedCase);
          report.reviewCases=report.reviewCases.filter(item=>item.name!==name);await persist();
        }
        for(const [table,row] of seedCase.rows||[]) {
          if(table==="novels")row.title=`Phase 3D AI编辑验收 · ${name}`;
          if(table==="chapters"&&row.id===seedCase.chapterId)row.content=content;
          if(real)assert.ifError((await clients.b.from(table).insert(row)).error);
          else {const columns=Object.keys(row),values=Object.values(row).map(v=>typeof v==="object"?JSON.stringify(v):v);await fixture.db.query(`insert into ${table}(${columns.join(",")}) values(${values.map((_,i)=>`$${i+1}`).join(",")})`,values);}
        }
        if(real)assert.ifError((await clients.b.from("chapter_versions").insert({chapter_id:seedCase.chapterId,content,source:"manual"})).error);
        else await fixture.db.query("insert into chapter_versions(chapter_id,content) values($1,$2)",[seedCase.chapterId,content]);
        await editor.goto(`${base}/novel/${seedCase.novelId}/chapters?chapter=${seedCase.chapterId}`);
        const panel=editor.getByRole("region",{name:"AI 编辑审核",exact:true});
        const posted=editor.waitForResponse(response=>response.url().endsWith("/api/ai/chapters/review")&&response.request().method()==="POST");
        await panel.getByRole("button",{name:revise?"重新审核":"审核本章",exact:true}).click();
        assert.ok((await posted).ok(),`Review ${name} must be accepted by server`);
        let row;
        for(let i=0;i<180;i++){const found=await clients.b.from("chapter_reviews").select("id,status,result_json,overall_score").eq("chapter_id",seedCase.chapterId).order("created_at",{ascending:false}).limit(1);assert.ifError(found.error);row=found.data?.[0];if(row&&row.status!=="running")break;await pause(3000);}
        assert.ok(row&&["passed","needs_review","critical"].includes(row.status),`Review ${name} failed: ${row?.status}`);
        report.reviewCases.push({name,novelId:seedCase.novelId,chapterId:seedCase.chapterId,reviewId:row.id,status:row.status,score:row.overall_score,categories:row.result_json.findings.map(f=>f.category)});await persist();
        if(name==="normal")assert.equal(row.status,"passed");
        if(categories.length)assert.ok(row.result_json.findings.some(f=>categories.includes(f.category)),`Expected ${name} finding`);
        await panel.getByRole("button",{name:"重新审核",exact:true}).waitFor();
        await editor.reload();await editor.getByRole("region",{name:"AI 编辑审核",exact:true}).getByText(`${row.overall_score}`,{exact:false}).first().waitFor();
        assert.equal((await clients.b.from("chapters").select("content").eq("id",seedCase.chapterId).single()).data.content,content);
        assert.equal((await clients.a.from("chapter_reviews").select("id").eq("id",row.id)).data.length,0);
        last={...seedCase,review:row};
      }
      const panel=editor.getByRole("region",{name:"AI 编辑审核",exact:true});
      if(last.review.result_json.findings.length) {await panel.getByRole("button",{name:"High",exact:true}).click();await panel.getByRole("button",{name:"全部",exact:true}).click();await panel.getByRole("button",{name:"忽略",exact:true}).first().click();await panel.getByText("已忽略",{exact:true}).first().waitFor();}
      if(real&&report.reviewCaseRevisions?.length) {
        const old=report.reviewCaseRevisions[0];last={novelId:old.novelId,chapterId:old.chapterId,review:{id:old.reviewId}};
        await editor.goto(`${base}/novel/${last.novelId}/chapters?chapter=${last.chapterId}`);
      }
      const history=await clients.b.from("chapter_reviews").select("id,status").eq("chapter_id",last.chapterId);assert.ifError(history.error);
      if(history.data.length===1)await panel.getByRole("button",{name:"重新审核",exact:true}).click();
      for(let i=0;i<180;i++){const rows=(await clients.b.from("chapter_reviews").select("id,status").eq("chapter_id",last.chapterId)).data;if(rows?.length===2&&rows.every(r=>r.status!=="running"))break;await pause(3000);}
      await panel.getByLabel("审核历史",{exact:true}).waitFor();await panel.getByLabel("审核历史",{exact:true}).selectOption(last.review.id);
      await editor.getByRole("button",{name:"退出",exact:true}).click();await editor.waitForURL(base+"/");await login(editor,"b");
      await editor.goto(`${base}/novel/${last.novelId}/chapters?chapter=${last.chapterId}`);await editor.getByLabel("审核历史",{exact:true}).waitFor();
      await editor.screenshot({path:`${folder}/editor-history.png`});
    } finally {await second.close();}
  });
  assert.deepEqual(report.errors,[]);
  report.status=reviewsOnly?"partial":"passed"; await persist(); console.log(`Browser ${reviewsOnly?"editor checks":"acceptance"} passed: ${folder}`);
} catch(error) {report.status="failed"; report.failure={stage,message:error.message}; await persist(); console.error(`Browser acceptance failed at ${stage}: ${error.message}`); process.exitCode=1;}
finally {await browser?.close().catch(()=>{}); if(child) {child.kill(); for(let i=0;i<20&&child.exitCode===null;i++) await pause(200);} await log?.close().catch(()=>{}); await new Promise((resolve)=>provider?.close(resolve)||resolve()); await fixture?.close().catch(()=>{});}

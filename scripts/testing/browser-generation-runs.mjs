// Browser acceptance. Default uses local Postgres/Auth/provider fixtures;
// --real-ai-cloud explicitly spends six DeepSeek calls on disposable cloud data.
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

const real = process.argv.includes("--real-ai-cloud");
if (real) assert.ok(process.argv.includes("--allow-cloud-test-writes"), "Explicit cloud write flag required");
const resumeIndex=process.argv.indexOf("--resume");
const resume=resumeIndex<0?null:process.argv[resumeIndex+1];
if(resume) assert.ok(real && /^artifacts\/phase3c2\/browser-real-[\dTZ-]+$/.test(resume),"Resume requires an existing real acceptance folder");
nextEnv.loadEnvConfig(process.cwd(), true);
if (real) assert.ok(process.env.DEEPSEEK_API_KEY, "Configure DEEPSEEK_API_KEY locally");
const port = real ? 43110 : 43090;
const base = `http://127.0.0.1:${port}`;
const folder = resume || `artifacts/phase3c2/browser-${real ? "real" : "fixture"}-${new Date().toISOString().replace(/[:.]/g,"-")}`;
await mkdir(folder,{recursive:true});
const previous=resume?JSON.parse(await readFile(`${folder}/results.json`,"utf8")):null;
const report = { ...previous, scope: real ? "real DeepSeek + hosted Supabase + browser" : "fixture Postgres/Auth/DeepSeek + browser", status: "running", checks: previous?.checks || [], errors: [], metrics: previous?.metrics || [] };
if(previous?.failure) {report.previousFailure=previous.failure; delete report.failure;}
const persist = () => writeFile(`${folder}/results.json`,JSON.stringify(report,null,2));
let fixture, provider, child, log, browser, context, page, stage = "setup", expectedOffline=false;
let writerCalls=0, memoryCalls=0;
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
      const row={ novel_id:seed.novelId,volume_id:seed.volumeId,title:`第${number}章`,outline:chapter2.outline,sort_order:number };
      if(real) assert.ifError((await clients.a.from("chapters").insert(row)).error);
      else await fixture.db.query("insert into chapters(novel_id,volume_id,title,outline,sort_order) values($1,$2,$3,$4,$5)",[row.novel_id,row.volume_id,row.title,row.outline,row.sort_order]);
    }
  }
  report.novelId=seed.novelId; await persist();
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:"playwright");
  browser=await chromium.launch({channel:"chrome",headless:true});
  context=await browser.newContext({viewport:{width:1440,height:1000}}); context.setDefaultTimeout(45000); page=await context.newPage();
  page.on("pageerror",(error)=>report.errors.push({stage,message:error.message}));
  page.on("console",(message)=>{if(message.type()==="error"&&!expectedOffline) report.errors.push({stage,message:message.text()});});
  page.on("request",(request)=>{if(["api.deepseek.com","api.openai.com"].includes(new URL(request.url()).hostname)) report.errors.push({stage,message:"Browser requested provider directly"});});
  async function login(p,actor) { await p.goto(base+"/login"); await p.getByLabel("邮箱",{exact:true}).fill(accounts[actor].email); await p.getByLabel("密码",{exact:true}).fill(accounts[actor].password); await p.getByRole("button",{name:"登录",exact:true}).click(); await p.waitForURL(base+"/dashboard"); }
  const novelUrl=`${base}/novel/${seed.novelId}/chapters`;
  if(!resume) await check("anonymous run API is rejected",async()=>{assert.equal((await context.request.post(base+"/api/ai/generation-runs",{headers:{Origin:base},data:{novelId:seed.novelId,count:3,mode:"continuous"}})).status(),401);});
  await login(page,"a"); await page.goto(novelUrl);
  if(!resume) await check("continuous 3 confirmation shows range and call estimate",async()=>{
    await page.getByRole("button",{name:"连续创作",exact:true}).click();
    await page.getByText("预计正文 3 次、记忆分析 3 次 AI 调用。").waitFor();
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
  await check("refresh, offline and closed browser preserve persisted run",async()=>{
    for(let attempt=0;attempt<4;attempt++) {
      if(attempt) await pause(2500);
      await page.reload();
      try { await page.getByRole("heading",{name:"下一章与连续创作"}).waitFor({timeout:15000}); break; }
      catch { if(attempt===3) throw new Error("Cloud novel data remained unavailable after refresh retries"); }
    }
    await page.getByText(/继续任务|AI 正在创作|正在分析章节|连续创作完成/).first().waitFor();
    expectedOffline=true; await context.setOffline(true); await pause(4000); assert.ok(await page.getByText("网络暂时中断",{exact:false}).isVisible());
    await context.setOffline(false); expectedOffline=false;
    await page.close(); page=await context.newPage(); await page.goto(novelUrl);
    await page.getByText(/继续任务|AI 正在创作|正在分析章节|连续创作完成/).first().waitFor();
    const continueButton=page.getByRole("button",{name:"继续任务",exact:true}); if(await continueButton.isVisible()) await continueButton.click();
  });
  await check("three chapters finish with independent versions and memory",async()=>{
    const deadline=Date.now()+(real?900000:180000);
    while(Date.now()<deadline) {
      const state=await clients.a.from("generation_runs").select("status,stage,error_type,current_index").eq("id",runId).single(); assert.ifError(state.error);
      if(state.data.status==="failed") throw new Error(`Run failed at ${state.data.current_index}: ${state.data.error_type}`);
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
    }
    report.writerCalls=writerCalls; report.memoryCalls=memoryCalls;
    const logs=real ? await clients.a.from("ai_generation_logs").select("generation_type,model,input_tokens,output_tokens,latency_ms,status,chapter_id").eq("novel_id",seed.novelId)
      : {data:(await fixture.db.query("select generation_type,model,input_tokens,output_tokens,latency_ms,status,chapter_id from ai_generation_logs where novel_id=$1",[seed.novelId])).rows};
    assert.ifError(logs.error);
    report.metrics=logs.data; assert.equal(logs.data.filter((entry)=>entry.generation_type==="chapter_generation"&&entry.status==="succeeded").length,3);
    assert.equal(logs.data.filter((entry)=>entry.generation_type==="chapter_memory_analysis"&&entry.status==="succeeded").length,3);
    if(!real) {assert.equal(writerCalls,3); assert.equal(memoryCalls,3);}
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
  assert.deepEqual(report.errors,[]);
  report.status="passed"; await persist(); console.log(`Browser acceptance passed: ${folder}`);
} catch(error) {report.status="failed"; report.failure={stage,message:error.message}; await persist(); console.error(`Browser acceptance failed at ${stage}: ${error.message}`); process.exitCode=1;}
finally {await browser?.close().catch(()=>{}); if(child) {child.kill(); for(let i=0;i<20&&child.exitCode===null;i++) await pause(200);} await log?.close().catch(()=>{}); await new Promise((resolve)=>provider?.close(resolve)||resolve()); await fixture?.close().catch(()=>{});}

// Explicit conflict fixture for the manuscript; Memory and Review use real
// DeepSeek and hosted Supabase. This does not claim the prose is AI-generated.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { chapterFixtureRows } from "./chapter-fixtures.mjs";
import { startGenerationRun, claimGenerationStep, processGenerationStep, getGenerationRun, cancelGenerationRun, retryGenerationRun } from "../../src/lib/ai/services/generation-run-service.js";

assert.ok(process.argv.includes("--allow-cloud-test-writes"),"Explicit paid cloud acceptance flag required");
nextEnv.loadEnvConfig(process.cwd(),true);
const resumeIndex=process.argv.indexOf("--resume");
const folder=resumeIndex<0?`artifacts/phase3d/critical-real-${new Date().toISOString().replace(/[:.]/g,"-")}`:process.argv[resumeIndex+1];
assert.match(folder,/^artifacts\/phase3d\/critical-real-[\dTZ-]+$/);
await mkdir(folder,{recursive:true});
const report=resumeIndex<0?{scope:"intentional conflict prose + real DeepSeek Memory/Review + hosted Supabase + browser",checks:[],errors:[]}:JSON.parse(await readFile(`${folder}/results.json`,"utf8"));
report.status="running";
const persist=()=>writeFile(`${folder}/results.json`,JSON.stringify(report,null,2));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const base="http://127.0.0.1:43250";
let browser,child,log;
try {
  const accounts=JSON.parse(await readFile(".tools/cloud-test-accounts.json","utf8"));assert.equal(accounts.disposableTestProject,true);
  assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,`${accounts.projectRef}.supabase.co`);
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const signed=await client.auth.signInWithPassword(accounts.a);assert.ifError(signed.error);
  const bad="玻璃门在林舟身后合拢。他确认柜台玻璃盒里的铜钥匙编号十七。许青仍在上海档案馆，通过电话协助核对出入登记，两人发现二十点四十分的记录被改成二十点五十分。封闭房间里响起钟声，林舟没有开门，却突然宣布此前所有能力限制都不成立。他毫无代价地看清了整整一个月之后的全部未来，连每天每人的细节都毫无遗漏，然后立刻瞬间移动到北京，没有乘坐交通工具，也没有经过任何时间。他说明这不是梦境、幻觉、比喻或不可靠叙述，而是真实发生的超能力。许青确认他身体已从上海消失并出现在北京。林舟仍认定自己就是原来的林舟，此过程没有任何伏笔、解释、条件或代价。";
  if(!report.runId) {
    const seed=chapterFixtureRows(signed.data.user.id,400);
    for(const [table,row] of seed.rows) {if(table==="novels")row.title="Phase 3D 严重冲突暂停验收";assert.ifError((await client.from(table).insert(row)).error);}
    const outline=seed.rows.find(([table,row])=>table==="chapters"&&row.id===seed.chapterId)[1].outline;
    for(const number of [3,4])assert.ifError((await client.from("chapters").insert({novel_id:seed.novelId,title:`第${number}章`,sort_order:number,outline})).error);
    const started=await startGenerationRun(client,{novelId:seed.novelId,count:3,mode:"continuous"});
    report.novelId=seed.novelId;report.chapterId=seed.chapterId;report.runId=started.run.id;await persist();
  }
  const initial=await getGenerationRun(client,report.runId);
  if(initial.status==="failed"&&process.argv.includes("--retry-failed"))await retryGenerationRun(client,report.runId);
  for(let i=0;i<4;i++) {
    const state=await getGenerationRun(client,report.runId);
    if(state.status!=="running")break;
    const claim=await claimGenerationStep(client,report.runId);
    assert.ok(["generate","confirm","memory","review"].includes(claim.action));
    const result=await processGenerationStep(client,claim,{chapter:{write:async()=>({content:bad,wordCount:bad.length,model:"fixture-intentional-conflict"})}});
    report.checks.push({step:claim.action,status:result.status});await persist();
    console.log(`Conflict test ${claim.action}: ${result.status}`);
  }
  const paused=await getGenerationRun(client,report.runId);
  assert.equal(paused.status,"paused");assert.equal(paused.errorType,"REVIEW_CRITICAL");assert.equal(paused.currentIndex,1);
  const reviews=await client.from("chapter_reviews").select("id,status,overall_score,model,result_json").eq("generation_run_id",report.runId);assert.ifError(reviews.error);
  const review=reviews.data.find(row=>row.status==="critical");assert.ok(review);assert.notEqual(review.model,"fixture-intentional-conflict");
  report.review={id:review.id,score:review.overall_score,model:review.model,categories:review.result_json.findings.map(f=>f.category)};await persist();
  log=await open(`${folder}/server.log`,"a");
  child=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--hostname","127.0.0.1","--port","43250"],{cwd:process.cwd(),windowsHide:true,stdio:["ignore",log.fd,log.fd],env:{...process.env,NOVELAI_TEST_MODE:"1"}});
  for(let i=0;i<90;i++){try{if((await fetch(base+"/login")).ok)break;}catch{}if(child.exitCode!==null||i===89)throw new Error("Critical test app not ready");await pause(1000);}
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:"playwright");
  browser=await chromium.launch({channel:"chrome",headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});context.setDefaultTimeout(45000);
  let intentionalDisconnect=false;
  const page=await context.newPage();page.on("pageerror",e=>report.errors.push(e.message));
  page.on("console",message=>{if(message.type()==="error"&&!intentionalDisconnect)report.errors.push(message.text());});
  await page.goto(base+"/login");await page.getByLabel("邮箱",{exact:true}).fill(accounts.a.email);await page.getByLabel("密码",{exact:true}).fill(accounts.a.password);await page.getByRole("button",{name:"登录",exact:true}).click();await page.waitForURL(base+"/dashboard");
  await page.goto(`${base}/novel/${report.novelId}/chapters?chapter=${report.chapterId}`);
  await page.getByText("⚠ 严重问题待审阅",{exact:false}).waitFor();
  await page.screenshot({path:`${folder}/critical-pause.png`});
  const before=(await client.from("chapters").select("content").eq("id",report.chapterId).single()).data.content;
  const versionsBefore=(await client.from("chapter_versions").select("id").eq("chapter_id",report.chapterId)).data;
  // Simulate a disconnect for the next advance only. The continue action itself
  // is real; this prevents unnecessary paid prose beyond the verified boundary.
  intentionalDisconnect=true;
  await page.route(`**/generation-runs/${report.runId}/advance`,route=>route.abort("internetdisconnected"));
  const continued=page.waitForResponse(response=>response.url().endsWith(`/generation-runs/${report.runId}/continue`)&&response.request().method()==="POST");
  await page.getByRole("button",{name:"我已审阅，继续创作",exact:true}).click();assert.ok((await continued).ok());
  const resumed=await getGenerationRun(client,report.runId);assert.equal(resumed.status,"running");assert.equal(resumed.currentIndex,1);assert.equal(resumed.stage,"ready");assert.notEqual(resumed.chapters[1].chapterId,report.chapterId);
  assert.equal((await client.from("chapters").select("content").eq("id",report.chapterId).single()).data.content,before);
  assert.deepEqual((await client.from("chapter_versions").select("id").eq("chapter_id",report.chapterId)).data,versionsBefore);
  const acknowledged=await client.from("chapter_reviews").select("author_acknowledged,author_acknowledged_at").eq("id",review.id).single();assert.ifError(acknowledged.error);assert.equal(acknowledged.data.author_acknowledged,true);assert.ok(acknowledged.data.author_acknowledged_at);
  report.checks.push("real critical pause, browser author override, next chapter pointer, unchanged body/version, acknowledged timestamp");
  await cancelGenerationRun(client,report.runId);
  const logs=await client.from("ai_generation_logs").select("generation_type,model,input_tokens,output_tokens,latency_ms,status").eq("novel_id",report.novelId);assert.ifError(logs.error);report.metrics=logs.data;
  assert.deepEqual(report.errors,[]);report.status="passed";delete report.failure;await persist();console.log(`Critical browser acceptance passed: ${folder}`);
} catch(error){report.status="failed";report.failure=error.message;await persist();console.error(error.message);process.exitCode=1;}
finally {await browser?.close().catch(()=>{});if(child){child.kill();for(let i=0;i<20&&child.exitCode===null;i++)await pause(200);}await log?.close().catch(()=>{});}

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Miniflare } from 'miniflare';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
globalThis.__observationEnv={OPENAI_API_KEY:'fixture-only',LUMEN_PROVIDER_MODE:'paid_enabled'};
globalThis.__observationHeaders=new Headers();
registerHooks({resolve(specifier,context,next){
  if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env=globalThis.__observationEnv;',shortCircuit:true};
  if(specifier==='next/headers')return {url:'data:text/javascript,export async function headers(){return globalThis.__observationHeaders;}',shortCircuit:true};
  if(specifier==='next/navigation')return {url:'data:text/javascript,export function redirect(){throw new Error("redirect");}',shortCircuit:true};
  const base=specifier.startsWith('@/')?path.join(root,specifier.slice(2)):specifier.startsWith('.')&&context.parentURL?.startsWith('file:')?fileURLToPath(new URL(specifier,context.parentURL)):null;
  if(base)for(const suffix of ['.ts','/index.ts'])if(existsSync(base+suffix))return {url:pathToFileURL(base+suffix).href,shortCircuit:true};
  return next(specifier,context);
}});
const env=globalThis.__observationEnv,originalFetch=globalThis.fetch;
const obs=await import('../lib/operations-observability.ts');
const ops=await import('../lib/operations-server.ts');
const {tickDueSchedules,enqueueManualSchedule}=await import('../lib/automation-runner.ts');
const {createRun}=await import('../lib/product-jobs.ts');
const {ownedSite}=await import('../lib/product-server.ts');
const {reserveAiUsage,getUsageStatus}=await import('../lib/usage.ts');
const {POST:mcp}=await import('../app/mcp/route.ts');
const {POST:service}=await import('../app/api/operations/tick/route.ts');
const {POST:runNow}=await import('../app/api/operations/run-now/route.ts');
let mf,db,calls=0;
const fixture=()=>Response.json({id:'fixture-'+calls,status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Private fixture answer.',annotations:[]}]}]});
before(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'observability-tests'}});
  env.DB=db=await mf.getD1Database('DB');
  for(const file of readdirSync(path.join(root,'drizzle')).filter(n=>n.endsWith('.sql')).sort())for(const sql of readFileSync(path.join(root,'drizzle',file),'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
  globalThis.fetch=async(url)=>{assert.equal(new URL(url).hostname,'api.openai.com','Only stubbed provider may be requested');calls++;return fixture();};
});
after(async()=>{globalThis.fetch=originalFetch;await mf?.dispose();});
const single=(sql,...args)=>db.prepare(sql).bind(...args).first();
async function workspace(owner,promptCount=1){
  const id=crypto.randomUUID(),date=new Date().toISOString();
  await db.prepare('INSERT INTO sites(id,owner_id,name,domain,tracking_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(id,owner,'Private brand','private.example',crypto.randomUUID(),date,date).run();
  for(let i=0;i<promptCount;i++)await db.prepare('INSERT INTO prompts(id,site_id,text,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),id,'Private fixture question '+i,date).run();
  return {id,owner};
}
async function schedule(w){return ops.createSchedule(w.owner,ops.scheduleInput.parse({siteId:w.id,name:'Private schedule',frequency:'daily',timezone:'UTC',hour:9,minute:0,models:['gpt-4.1-mini']}));}
const due=id=>db.prepare('UPDATE collection_schedules SET next_run_at=? WHERE id=?').bind(Date.now()-60000,id).run();
const blank=id=>({tickId:id,queued:0,processed:0,completed:0,failed:0,blocked:0,continuation:false,retryAfterSeconds:0,skipped:false,executionIds:[],runIds:[]});
async function observation(ownerId,entryPoint='internal',age=0){const input={id:crypto.randomUUID(),ownerId,entryPoint,startedAt:Date.now()-age};assert.equal(await obs.beginTickObservation(input),true);return input;}
function identity(owner){globalThis.__observationHeaders=owner?new Headers({'oai-authenticated-user-id':owner,'oai-authenticated-user-email':owner+'@example.test'}):new Headers();}
async function rpc(args={},headers={}){const response=await mcp(new Request('https://lumen.test/mcp',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'lumen_collect_due',arguments:args}})}));return response.json();}

test('empty tick records correlation, trusted category, duration and no provider work',async()=>{
  const w=await workspace('obs-empty'),before=calls,result=await tickDueSchedules({ownerId:w.owner,entryPoint:'mcp_owner'});
  const history=await obs.readTickHistory(w.owner),tick=history.ticks[0];
  assert.equal(calls,before);assert.equal(tick.id,result.tickId);assert.equal(tick.status,'completed');assert.equal(tick.entryPoint,'mcp_owner');assert.ok(tick.durationMs>=0);assert.ok(tick.finishedAt);assert.equal(tick.processed,0);assert.equal(tick.continuation,false);
  assert.equal(history.window.retentionDays,30);assert.equal(history.includesService,false);
});
test('concurrent observations preserve one dispatch, one reservation and skipped-lock outcome',async()=>{
  const w=await workspace('obs-concurrent'),s=await schedule(w);await due(s.id);const before=calls,previous=globalThis.fetch;let release,start;
  const ready=new Promise(r=>start=r),held=new Promise(r=>release=r);
  globalThis.fetch=async()=>{calls++;start();await held;return fixture();};
  try{
    const first=tickDueSchedules({ownerId:w.owner,entryPoint:'mcp_owner'});await ready;
    const second=await tickDueSchedules({ownerId:w.owner,entryPoint:'mcp_owner'});assert.equal(second.skipped,true);release();const done=await first;
    assert.equal(done.completed,1);assert.equal(calls-before,1);assert.equal((await getUsageStatus(w.owner)).daily.used,1);
    const history=await obs.readTickHistory(w.owner);assert.deepEqual(history.ticks.map(t=>t.status).sort(),['completed','skipped']);
    assert.equal(history.ticks.find(t=>t.skipped).continuation,true);
    await tickDueSchedules({ownerId:w.owner});assert.equal(calls-before,1);assert.equal((await single('SELECT COUNT(*) n FROM scheduled_executions WHERE schedule_id=?',s.id)).n,1);
  }finally{release?.();globalThis.fetch=previous;}
});
test('multi-chunk continuation is observed without adding calls or reserving again',async()=>{
  const w=await workspace('obs-continuation',3),site=await ownedSite(w.id,w.owner);await createRun(site,{mode:'live',models:['gpt-4.1-mini']});const before=calls;
  const first=await tickDueSchedules({ownerId:w.owner}),second=await tickDueSchedules({ownerId:w.owner});
  assert.equal(first.continuation,true);assert.equal(second.continuation,false);assert.equal(calls-before,3);assert.equal((await getUsageStatus(w.owner)).daily.used,3);
  const rows=(await obs.readTickHistory(w.owner)).ticks;assert.equal(rows.find(t=>t.id===first.tickId).continuation,true);assert.equal(rows.find(t=>t.id===second.tickId).completed,1);
});
test('quota-blocked occurrence records blocked separately from dispatcher failure',async()=>{
  const w=await workspace('obs-blocked'),s=await schedule(w);await reserveAiUsage(w.owner,10,'fixture-block:'+crypto.randomUUID());await due(s.id);const before=calls;
  const result=await tickDueSchedules({ownerId:w.owner}),tick=(await obs.readTickHistory(w.owner)).ticks[0];
  assert.equal(result.blocked,1);assert.equal(tick.status,'completed');assert.equal(tick.blocked,1);assert.equal(tick.failed,0);assert.equal(calls,before);
});
test('dispatcher exception stores only allowlisted error code and preserves thrown failure',async()=>{
  const w=await workspace('obs-failure'),s=await schedule(w);await due(s.id);await db.prepare('UPDATE collection_schedules SET models=? WHERE id=?').bind('secret-fixture-malformed-json',s.id).run();const before=calls;
  try{await assert.rejects(()=>tickDueSchedules({ownerId:w.owner}),SyntaxError);const history=await obs.readTickHistory(w.owner);assert.equal(history.ticks[0].status,'failed');assert.equal(history.ticks[0].errorCode,'collection_error');assert.equal(JSON.stringify(history).includes('secret-fixture'),false);assert.equal(calls,before);}finally{await db.prepare('UPDATE collection_schedules SET enabled=0 WHERE id=?').bind(s.id).run();}
});
test('owner history isolates tenant and service telemetry; only exact configured operator sees service totals',async()=>{
  const a=await workspace('obs-alice'),b=await workspace('obs-bob');
  const own=await observation(a.owner,'mcp_owner'),foreign=await observation(b.owner),global=await observation(undefined,'mcp_operator');
  await obs.finishTickObservation(global,{...blank(global.id),processed:2,completed:1,blocked:1});
  env.LUMEN_OPERATOR_USER_ID='obs-operator';
  const privateHistory=await obs.readTickHistory(a.owner);assert.deepEqual(privateHistory.ticks.map(t=>t.id),[own.id]);assert.equal(privateHistory.includesService,false);
  const operatorHistory=await obs.readTickHistory('obs-operator');assert.ok(operatorHistory.ticks.some(t=>t.id===global.id));assert.ok(!operatorHistory.ticks.some(t=>[own.id,foreign.id].includes(t.id)));
  for(const row of operatorHistory.ticks)for(const key of ['ownerId','siteId','executionIds','runIds','headers','message','prompt'])assert.equal(key in row,false);
  assert.equal((await obs.readTickHistory(' obs-operator')).includesService,false);
  await assert.rejects(()=>ops.getOperationsState(a.owner,b.id),error=>error.status===404);delete env.LUMEN_OPERATOR_USER_ID;
});
test('server routes ignore source headers and reject spoofed source arguments before recording',async()=>{
  const w=await workspace('obs-source');identity(w.owner);
  const before=(await single('SELECT count(*) n FROM operation_ticks')).n;
  const rejected=await rpc({entryPoint:'service_bearer'});assert.equal(rejected.error.code,-32602);assert.equal((await single('SELECT count(*) n FROM operation_ticks')).n,before);
  const response=await rpc({}, {'X-Lumen-Entry-Point':'mcp_operator'});assert.equal(response.result.isError,false);assert.equal((await obs.readTickHistory(w.owner)).ticks[0].entryPoint,'mcp_owner');
  env.LUMEN_OPERATOR_USER_ID=w.owner;const global=await rpc();const payload=JSON.parse(global.result.content[0].text);assert.deepEqual(Object.keys(payload).sort(),['blocked','completed','continuation','failed','processed','queued','retryAfterSeconds','scope','skipped'].sort());
  assert.ok((await obs.readTickHistory(w.owner)).ticks.some(t=>t.entryPoint==='mcp_operator'&&t.scope==='service'));
  delete env.LUMEN_OPERATOR_USER_ID;identity(null);
  const denied=await rpc();assert.equal(denied.error.code,-32001);
});
test('authenticated service and immediate-run endpoints annotate their own entry points',async()=>{
  env.LUMEN_AUTOMATION_SECRET='fixture-secret-at-least-thirty-two-characters';
  const request=body=>new Request('https://lumen.test/api/operations/tick',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.LUMEN_AUTOMATION_SECRET},body:JSON.stringify(body)});
  assert.equal((await service(request({entryPoint:'mcp_operator'}))).status,400);
  const response=await service(request({limit:1}));assert.equal(response.status,200);const result=await response.json();assert.equal((await single('SELECT entry_point FROM operation_ticks WHERE id=?',result.tickId)).entry_point,'service_bearer');
  const w=await workspace('obs-run-now'),s=await schedule(w);identity(w.owner);const before=calls;
  const immediate=await runNow(new Request('https://lumen.test/api/operations/run-now',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://lumen.test'},body:JSON.stringify({siteId:w.id,scheduleId:s.id})}));assert.equal(immediate.status,200);const output=await immediate.json();assert.equal((await single('SELECT entry_point FROM operation_ticks WHERE id=?',output.tick.tickId)).entry_point,'run_now_api');assert.equal(calls-before,1);
  delete env.LUMEN_AUTOMATION_SECRET;identity(null);
});
test('readonly state detects time gap without calling tick, writing alerts or collecting AI',async()=>{
  const w=await workspace('obs-health'),s=await schedule(w);const at=Date.now();
  await db.prepare('UPDATE collection_schedules SET next_run_at=? WHERE id=?').bind(at+12*3600000,s.id).run();
  await db.prepare('INSERT INTO operation_heartbeats(id,owner_id,last_started_at,last_finished_at,last_success_at) VALUES (?,?,?,?,?)').bind('owner:'+w.owner,w.owner,new Date(at).toISOString(),new Date(at).toISOString(),new Date(at).toISOString()).run();
  const snapshot=JSON.stringify(await single('SELECT * FROM operation_heartbeats WHERE id=?','owner:'+w.owner)),ticks=(await single('SELECT count(*) n FROM operation_ticks')).n,before=calls,dateNow=Date.now;
  try{assert.equal((await ops.getOperationsState(w.owner,w.id)).health.status,'healthy');Date.now=()=>at+obs.HEARTBEAT_STALE_MS+1;const stale=await ops.getOperationsState(w.owner,w.id);assert.equal(stale.health.status,'attention');assert.equal(stale.health.heartbeatAgeMs,obs.HEARTBEAT_STALE_MS+1);assert.equal(stale.health.checkedAt,new Date(Date.now()).toISOString());assert.equal(stale.alerts.length,0);}finally{Date.now=dateNow;}
  assert.equal(JSON.stringify(await single('SELECT * FROM operation_heartbeats WHERE id=?','owner:'+w.owner)),snapshot);assert.equal((await single('SELECT count(*) n FROM operation_ticks')).n,ticks);assert.equal(calls,before);
});
test('startup remains not observed and overdue schedule state is computed without inserting an alert',async()=>{
  await db.prepare('DELETE FROM operation_heartbeats WHERE id=?').bind('service').run();
  const w=await workspace('obs-startup'),s=await schedule(w),at=Date.now();await db.prepare('UPDATE collection_schedules SET next_run_at=? WHERE id=?').bind(at-3*3600000,s.id).run();
  const state=await ops.getOperationsState(w.owner,w.id);assert.equal(state.health.status,'not_observed');assert.equal(state.health.overdueScheduleCount,1);assert.ok(state.health.oldestDueDelayMs>=3*3600000);assert.equal(state.alerts.length,0);
  await db.prepare('UPDATE collection_schedules SET enabled=0 WHERE id=?').bind(s.id).run();
});
test('a started observation never fabricates success after an interrupted worker',async()=>{
  const input=await observation('obs-interrupted','internal',180000),history=await obs.readTickHistory('obs-interrupted');assert.equal(history.ticks[0].status,'started');assert.equal(history.ticks[0].unfinished,true);assert.equal(history.ticks[0].finishedAt,null);assert.equal(history.ticks[0].durationMs,null);
  await obs.finishTickObservation(input,blank(input.id),'private-untrusted-error');assert.equal((await obs.readTickHistory('obs-interrupted')).ticks[0].errorCode,'collection_error');
});
test('delay summaries use exact queue/completion timestamps, nearest-rank quantiles and explicit sample window',()=>{
  const at=Date.parse('2026-10-19T00:00:00Z');assert.deepEqual(obs.executionDelays(at,'2026-10-19T01:00:00Z','2026-10-19T01:02:00Z'),{queueDelayMs:3600000,completionDelayMs:3720000});
  const rows=[1000,2000,3000,7200000].map((v,i)=>({createdAt:new Date(at+i*1000).toISOString(),queueDelayMs:v,completionDelayMs:i===3?null:v+500}));
  const summary=obs.summarizeExecutionDelays(rows,55,at+5000);assert.equal(summary.queueP50Ms,2000);assert.equal(summary.queueP95Ms,7200000);assert.equal(summary.queueOverOneHourCount,1);assert.equal(summary.completionSampleSize,3);assert.equal(summary.completionP50Ms,2500);assert.equal(summary.truncated,true);assert.equal(summary.includesImmediateRuns,true);assert.equal(summary.observedFrom,rows[0].createdAt);assert.equal(summary.observedTo,rows[3].createdAt);
  assert.equal(obs.summarizeExecutionDelays([],0).queueP50Ms,null);
});
test('workspace execution statistics are limited to its newest 50, with total and observed range',async()=>{
  const w=await workspace('obs-stat-window'),base=Date.now()-3600000;
  const statements=Array.from({length:52},(_,i)=>db.prepare('INSERT INTO scheduled_executions(id,owner_id,site_id,schedule_name,scheduled_for,status,configuration,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),w.owner,w.id,'fixture',base+i*1000,'completed','{}',new Date(base+i*1000+100).toISOString(),new Date(base+i*1000+200).toISOString(),new Date(base+i*1000+200).toISOString()));await db.batch(statements);
  const state=await ops.getOperationsState(w.owner,w.id);assert.equal(state.executions.length,50);assert.equal(state.observability.executionDelays.totalCount,52);assert.equal(state.observability.executionDelays.truncated,true);assert.equal(state.observability.executionDelays.queueP95Ms,100);assert.equal(state.executions[0].completionDelayMs,200);assert.equal(state.observability.executionDelays.observedFrom,new Date(base+2100).toISOString());
});
test('telemetry write failures cannot retry dispatch or change usage and successful execution result',async()=>{
  for(const fail of ['insert','update']){
    const w=await workspace('obs-logging-fails-'+fail),s=await schedule(w);await due(s.id);const before=calls,warnings=[],warn=console.warn;
    env.DB=new Proxy(db,{get(target,property){if(property==='prepare')return sql=>{if(new RegExp(fail+'\\s+(?:into\\s+)?["`]?operation_ticks','i').test(sql))throw new Error('private-telemetry-fixture');return target.prepare(sql);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
    console.warn=(...args)=>warnings.push(args.join(' '));
    try{const result=await tickDueSchedules({ownerId:w.owner});assert.equal(result.completed,1);assert.equal(calls-before,1);}finally{env.DB=db;console.warn=warn;}
    assert.equal((await getUsageStatus(w.owner)).daily.used,1);assert.ok(warnings.length);assert.ok(warnings.every(w=>w==='operation_tick_observation_unavailable'));
    await tickDueSchedules({ownerId:w.owner});assert.equal(calls-before,1);
  }
});
test('read failure reports unavailable instead of fabricated empty success',async()=>{
  env.DB=new Proxy(db,{get(target,property){if(property==='prepare')return sql=>{if(sql.includes('operation_ticks'))throw new Error('private-db-details');return target.prepare(sql);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  try{const result=await obs.readTickHistory('obs-empty');assert.equal(result.available,false);assert.equal(result.window.retainedCount,null);assert.deepEqual(result.ticks,[]);assert.equal(JSON.stringify(result).includes('private-db-details'),false);}finally{env.DB=db;}
});
test('retention removes aged telemetry at tick start, keeps user execution data and limits visible history to 50',async()=>{
  const at=Date.now(),owner='obs-retention',old=crypto.randomUUID(),oldAt=new Date(at-31*86400000).toISOString();
  await db.prepare('INSERT INTO operation_ticks(id,owner_id,entry_point,status,started_at) VALUES (?,?,?,?,?)').bind(old,owner,'internal','completed',oldAt).run();
  const before=(await single('SELECT count(*) n FROM scheduled_executions')).n;
  assert.equal((await obs.readTickHistory(owner)).ticks.length,0);assert.ok(await single('SELECT id FROM operation_ticks WHERE id=?',old),'GET must not delete');
  const date=new Date(at-1000).toISOString();await db.prepare("WITH RECURSIVE seq(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM seq WHERE x<1005) INSERT INTO operation_ticks(id,owner_id,entry_point,status,started_at) SELECT 'retention-'||x,?,'internal','completed',? FROM seq").bind(owner,date).run();
  await observation(owner);assert.equal(await single('SELECT id FROM operation_ticks WHERE id=?',old),null);assert.equal((await single('SELECT count(*) n FROM operation_ticks WHERE owner_id=?',owner)).n,1000);
  const history=await obs.readTickHistory(owner);assert.equal(history.ticks.length,50);assert.equal(history.window.retainedCount,1000);assert.equal(history.window.truncated,true);assert.equal((await single('SELECT count(*) n FROM scheduled_executions')).n,before);
});
test('global telemetry size cap is enforced independently of per-owner caps',async()=>{
  const date=new Date(Date.now()-1000).toISOString();await db.prepare("WITH RECURSIVE seq(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM seq WHERE x<10020) INSERT INTO operation_ticks(id,owner_id,entry_point,status,started_at) SELECT 'global-cap-'||x,'cap-owner-'||x,'internal','completed',? FROM seq").bind(date).run();
  await observation('obs-global-cap');assert.equal((await single('SELECT count(*) n FROM operation_ticks')).n,obs.TICK_GLOBAL_LIMIT);
});

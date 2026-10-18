import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {Miniflare} from 'miniflare';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
registerHooks({resolve(specifier,context,next){
  if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env=globalThis.__opsEnv;',shortCircuit:true};
  if(specifier==='next/headers')return {url:'data:text/javascript,export async function headers(){return globalThis.__opsHeaders;}',shortCircuit:true};
  if(specifier==='next/navigation')return {url:'data:text/javascript,export function redirect(){throw new Error("redirect");}',shortCircuit:true};
  if(specifier.startsWith('@/')){const base=path.join(root,specifier.slice(2));for(const suffix of ['.ts','/index.ts'])if(existsSync(base+suffix))return {url:pathToFileURL(base+suffix).href,shortCircuit:true};}
  if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){const base=fileURLToPath(new URL(specifier,context.parentURL));if(existsSync(base+'.ts'))return {url:pathToFileURL(base+'.ts').href,shortCircuit:true};}
  return next(specifier,context);
}});
globalThis.__opsEnv={OPENAI_API_KEY:'fixture-only',LUMEN_PROVIDER_MODE:'paid_enabled'};globalThis.__opsHeaders=new Headers();
const {nextOccurrence,isValidTimeZone}=await import('../lib/automation-time.ts');
const ops=await import('../lib/operations-server.ts');
const {tickDueSchedules,enqueueManualSchedule}=await import('../lib/automation-runner.ts');
const {createRun}=await import('../lib/product-jobs.ts');
const {getUsageStatus,reserveAiUsage}=await import('../lib/usage.ts');
const {ownedSite}=await import('../lib/product-server.ts');
let mf,db,fetchCalls=0;const originalFetch=globalThis.fetch;
function fixture(){return Response.json({id:'fixture-'+fetchCalls,status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Acme is one option.',annotations:[]}]}]});}
before(async()=>{mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'operations-tests'}});db=globalThis.__opsEnv.DB=await mf.getD1Database('DB');for(const file of readdirSync(path.join(root,'drizzle')).filter(n=>n.endsWith('.sql')).sort())for(const sql of readFileSync(path.join(root,'drizzle',file),'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();globalThis.fetch=async()=>{fetchCalls++;return fixture();};});
after(async()=>{globalThis.fetch=originalFetch;await mf?.dispose();});
async function workspace(owner,count=1){const id=crypto.randomUUID(),date=new Date().toISOString();await db.prepare('INSERT INTO sites(id,owner_id,name,domain,tracking_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(id,owner,'Acme','acme.example',crypto.randomUUID(),date,date).run();const prompts=[];for(let i=0;i<count;i++){const p=crypto.randomUUID();prompts.push(p);await db.prepare('INSERT INTO prompts(id,site_id,text,created_at) VALUES (?,?,?,?)').bind(p,id,'Private prompt '+i,date).run();}return {id,prompts,owner};}
async function schedule(w,overrides={}){return ops.createSchedule(w.owner,ops.scheduleInput.parse({siteId:w.id,name:'Daily research',frequency:'daily',timezone:'Asia/Seoul',hour:9,minute:0,models:['gpt-4.1-mini'],...overrides}));}
async function due(id,time=Date.now()-60000){await db.prepare('UPDATE collection_schedules SET next_run_at=? WHERE id=?').bind(time,id).run();}
async function single(sql,...args){return db.prepare(sql).bind(...args).first();}
function stamp(t,at){return new Date(nextOccurrence(t,Date.parse(at))).toISOString();}

test('wall-clock scheduling supports Seoul, weekly days and DST gaps/folds',()=>{
 assert.equal(stamp({frequency:'daily',timezone:'Asia/Seoul',hour:9,minute:0},'2026-10-18T00:00:00Z'),'2026-10-19T00:00:00.000Z');
 assert.equal(stamp({frequency:'weekly',timezone:'UTC',hour:9,minute:30,weekdays:[1]},'2026-10-18T00:00:00Z'),'2026-10-19T09:30:00.000Z');
 assert.equal(stamp({frequency:'daily',timezone:'America/New_York',hour:2,minute:30},'2026-03-08T00:00:00Z'),'2026-03-09T06:30:00.000Z');
 assert.equal(stamp({frequency:'daily',timezone:'America/New_York',hour:1,minute:30},'2026-11-01T00:00:00Z'),'2026-11-01T05:30:00.000Z');
 assert.equal(stamp({frequency:'daily',timezone:'America/New_York',hour:1,minute:30},'2026-11-01T05:45:00Z'),'2026-11-02T06:30:00.000Z');
 assert.equal(isValidTimeZone('Bad/Zone'),false);assert.throws(()=>nextOccurrence({frequency:'weekly',timezone:'UTC',hour:9,minute:0},Date.now()));
});
test('owner isolation applies to schedule CRUD, state, manual execution and tick',async()=>{
 const a=await workspace('tenant-a'),b=await workspace('tenant-b'),s=await schedule(a);await due(s.id);
 for(const task of [()=>ops.getOperationsState(b.owner,a.id),()=>ops.updateSchedule(b.owner,{siteId:a.id,id:s.id,enabled:false}),()=>enqueueManualSchedule(b.owner,a.id,s.id),()=>ops.deleteSchedule(b.owner,a.id,s.id)])await assert.rejects(task,e=>e.status===404);
 const before=fetchCalls;const r=await tickDueSchedules({ownerId:b.owner});assert.equal(r.processed,0);assert.equal(fetchCalls,before);assert.equal((await single('SELECT count(*) n FROM scheduled_executions WHERE schedule_id=?',s.id)).n,0);
 await ops.deleteSchedule(a.owner,a.id,s.id);
});
test('concurrent tick claims one occurrence, skips backlog and reserves usage once',async()=>{
 const w=await workspace('concurrent'),s=await schedule(w);await due(s.id,Date.now()-7*86400000);const before=fetchCalls;
 const results=await Promise.all([tickDueSchedules({ownerId:w.owner}),tickDueSchedules({ownerId:w.owner})]);assert.equal(results.reduce((n,r)=>n+r.completed,0),1);assert.ok(results.some(r=>r.skipped));assert.equal(fetchCalls-before,1);
 assert.equal((await single('SELECT count(*) n FROM scheduled_executions WHERE schedule_id=?',s.id)).n,1);assert.equal((await getUsageStatus(w.owner)).daily.used,1);assert.ok((await single('SELECT next_run_at FROM collection_schedules WHERE id=?',s.id)).next_run_at>Date.now());
 const again=await tickDueSchedules({ownerId:w.owner});assert.equal(again.processed,0);assert.equal(fetchCalls-before,1);
});
test('global and owner dispatchers cannot both pay for the same scheduled execution',async()=>{
 const w=await workspace('global-owner-race'),s=await schedule(w);await due(s.id);const before=fetchCalls,previous=globalThis.fetch;let begin,finish;const started=new Promise(r=>begin=r),released=new Promise(r=>finish=r);
 globalThis.fetch=async()=>{fetchCalls++;begin();await released;return fixture();};
 try{const owner=tickDueSchedules({ownerId:w.owner});await started;const service=await tickDueSchedules();assert.equal(service.processed,0);finish();const done=await owner;assert.equal(done.completed,1);assert.equal(fetchCalls-before,1);assert.equal((await getUsageStatus(w.owner)).daily.used,1);assert.equal((await single('SELECT count(*) n FROM runs WHERE site_id=?',w.id)).n,1);}finally{finish?.();globalThis.fetch=previous;}
});
test('server resumes a multi-chunk manual run without new usage reservations',async()=>{
 const w=await workspace('manual-resume',3),site=await ownedSite(w.id,w.owner),run=await createRun(site,{mode:'live',models:['gpt-4.1-mini']});const before=fetchCalls;
 const first=await tickDueSchedules({ownerId:w.owner});assert.equal(first.processed,1);assert.equal(first.continuation,true);assert.equal(fetchCalls-before,2);
 const second=await tickDueSchedules({ownerId:w.owner});assert.equal(second.completed,1);assert.equal(second.continuation,false);assert.equal(fetchCalls-before,3);assert.equal((await getUsageStatus(w.owner)).daily.used,3);assert.equal((await single('SELECT status FROM runs WHERE id=?',run.id)).status,'completed');
});
test('crash between manifest creation and execution link reuses the same run and budget',async()=>{
 const w=await workspace('crash-replay',3),s=await schedule(w),e=await enqueueManualSchedule(w.owner,w.id,s.id),site=await ownedSite(w.id,w.owner);await createRun(site,{mode:'live',models:['gpt-4.1-mini']},{idempotencyKey:e.id});const before=fetchCalls;
 const first=await tickDueSchedules({ownerId:w.owner});assert.equal(first.continuation,true);const second=await tickDueSchedules({ownerId:w.owner});assert.equal(second.completed,1);assert.equal(fetchCalls-before,3);assert.equal((await getUsageStatus(w.owner)).daily.used,3);
 assert.equal((await single('SELECT count(*) n FROM runs WHERE site_id=?',w.id)).n,1);assert.equal((await single('SELECT run_id FROM scheduled_executions WHERE id=?',e.id)).run_id,e.id);
});
test('ambiguous dispatched answers are never automatically requested again after lease expiry',async()=>{
 const w=await workspace('stale-dispatch'),s=await schedule(w),e=await enqueueManualSchedule(w.owner,w.id,s.id),site=await ownedSite(w.id,w.owner);await createRun(site,{mode:'live',models:['gpt-4.1-mini']},{idempotencyKey:e.id});
 await db.prepare("UPDATE runs SET status='running',lease_token='dead-worker',lease_until=0 WHERE id=?").bind(e.id).run();await db.prepare("UPDATE answers SET status='processing' WHERE run_id=?").bind(e.id).run();await db.prepare("UPDATE scheduled_executions SET status='running',updated_at=? WHERE id=?").bind(new Date(Date.now()-3600000).toISOString(),e.id).run();const before=fetchCalls;
 const result=await tickDueSchedules({ownerId:w.owner});assert.equal(result.failed,1);assert.equal(fetchCalls,before);const state=await ops.getOperationsState(w.owner,w.id);assert.equal(state.executions[0].status,'failed');assert.ok(state.alerts.some(a=>a.code==='execution_stalled'));assert.equal((await getUsageStatus(w.owner)).daily.used,1);assert.equal(result.continuation,false);
});
test('quota exhaustion blocks an occurrence before provider dispatch and stores curated alerts',async()=>{
 const w=await workspace('exhausted'),s=await schedule(w);await reserveAiUsage(w.owner,10,'fixture:prior-reservations');await due(s.id);const before=fetchCalls,r=await tickDueSchedules({ownerId:w.owner});assert.equal(r.blocked,1);assert.equal(r.continuation,false);assert.equal(fetchCalls,before);const state=await ops.getOperationsState(w.owner,w.id);assert.equal(state.executions[0].status,'blocked');assert.equal(state.executions[0].errorCode,'ai_usage_exhausted');assert.equal(state.health.status,'attention');assert.equal(JSON.stringify(state).includes('Private prompt'),false);assert.equal(JSON.stringify(state).includes('fixture-only'),false);
 await assert.rejects(()=>ops.acknowledgeAlert('attacker',w.id,state.alerts[0].id,'resolved'),e=>e.status===404);await ops.acknowledgeAlert(w.owner,w.id,state.alerts[0].id,'acknowledged');
});
test('provider removal closes unprocessed manual runs rather than looping forever',async()=>{
 const w=await workspace('missing-provider'),site=await ownedSite(w.id,w.owner),run=await createRun(site,{mode:'live',models:['gpt-4.1-mini']});delete globalThis.__opsEnv.OPENAI_API_KEY;const before=fetchCalls;
 try{const r=await tickDueSchedules({ownerId:w.owner});assert.equal(r.failed,1);assert.equal(r.continuation,false);assert.equal(fetchCalls,before);assert.equal((await single('SELECT status FROM runs WHERE id=?',run.id)).status,'failed');assert.equal((await getUsageStatus(w.owner)).daily.used,1);}finally{globalThis.__opsEnv.OPENAI_API_KEY='fixture-only';}
});
test('pausing cancels queued executions and soft deletion preserves history',async()=>{
 const w=await workspace('pause'),s=await schedule(w),e=await enqueueManualSchedule(w.owner,w.id,s.id);await ops.updateSchedule(w.owner,{siteId:w.id,id:s.id,enabled:false});await due(s.id);const before=fetchCalls;const r=await tickDueSchedules({ownerId:w.owner});assert.equal(r.processed,0);assert.equal(fetchCalls,before);assert.equal((await single('SELECT status FROM scheduled_executions WHERE id=?',e.id)).status,'cancelled');await ops.deleteSchedule(w.owner,w.id,s.id);const state=await ops.getOperationsState(w.owner,w.id);assert.equal(state.schedules.length,0);assert.equal(state.executions.length,1);
});
test('schedule planning rejects more than the hard daily free budget',async()=>{
 const w=await workspace('planning',6);await schedule(w);await assert.rejects(()=>schedule(w),e=>e.code==='schedule_budget_exceeded');
});
test('simultaneous schedule enables cannot both pass the planning budget check',async()=>{
 const w=await workspace('planning-race',6);const results=await Promise.allSettled([schedule(w),schedule(w)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal((await single('SELECT count(*) n FROM collection_schedules WHERE owner_id=? AND enabled=1',w.owner)).n,1);
});
test('failed and stale worker heartbeats never report healthy operation',async()=>{
 const w=await workspace('heartbeat-health'),s=await schedule(w);const date=new Date().toISOString();await db.prepare('INSERT INTO operation_heartbeats(id,owner_id,lease_until,last_started_at,last_finished_at,last_error_code) VALUES (?,?,?,?,?,?)').bind('owner:'+w.owner,w.owner,0,date,date,'collection_error').run();assert.equal((await ops.getOperationsState(w.owner,w.id)).health.status,'attention');await db.prepare('UPDATE operation_heartbeats SET last_error_code=NULL,last_started_at=?,last_finished_at=? WHERE id=?').bind(new Date(Date.now()-3*3600000).toISOString(),new Date(Date.now()-3*3600000).toISOString(),'owner:'+w.owner).run();await due(s.id,Date.now()-3*3600000);const state=await ops.getOperationsState(w.owner,w.id);assert.equal(state.health.status,'attention');assert.match(state.health.message,/2시간/);
});
test('service tick requires a dedicated strong bearer and rejects caller-selected owner fields',async()=>{
 const {POST}=await import('../app/api/operations/tick/route.ts');const call=(token,body={})=>POST(new Request('https://lumen.test/api/operations/tick',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}));
 assert.equal((await call()).status,503);globalThis.__opsEnv.LUMEN_AUTOMATION_SECRET='x'.repeat(40);assert.equal((await call()).status,401);assert.equal((await call('wrong')).status,401);assert.equal((await call('x'.repeat(40),{ownerId:'tenant-a'})).status,400);delete globalThis.__opsEnv.LUMEN_AUTOMATION_SECRET;
});
test('legacy queued runs must reserve the current shared free budget before dispatch',async()=>{
 const w=await workspace('legacy-queue'),runId=crypto.randomUUID(),date=new Date().toISOString();await db.prepare('INSERT INTO runs(id,site_id,mode,status,models,total,created_at) VALUES (?,?,?,?,?,?,?)').bind(runId,w.id,'live','queued','["gpt-4.1-mini"]',1,date).run();await db.prepare('INSERT INTO answers(id,site_id,run_id,prompt_id,prompt_text,model,provider,mode,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),w.id,runId,w.prompts[0],'Legacy queued question','gpt-4.1-mini','OpenAI API','live','pending',date).run();assert.equal((await getUsageStatus(w.owner)).daily.used,0);const r=await tickDueSchedules({ownerId:w.owner});assert.equal(r.completed,1);assert.equal((await getUsageStatus(w.owner)).daily.used,1);
});
test('idempotency replay cannot alter models, questions or tenant and never double-reserves',async()=>{
 const w=await workspace('idempotency'),site=await ownedSite(w.id,w.owner),id=crypto.randomUUID();const first=await createRun(site,{mode:'live',models:['gpt-4.1-mini']},{idempotencyKey:id});const replay=await createRun(site,{mode:'live',models:['gpt-4.1-mini']},{idempotencyKey:id});assert.equal(replay.id,first.id);assert.equal((await getUsageStatus(w.owner)).daily.used,1);
 await assert.rejects(()=>createRun(site,{mode:'live',models:['perplexity/sonar']},{idempotencyKey:id}),e=>e.code==='idempotency_conflict');await assert.rejects(()=>createRun(site,{mode:'live',models:['gpt-4.1-mini'],promptIds:[crypto.randomUUID()]},{idempotencyKey:id}),e=>e.code==='idempotency_conflict');const other=await workspace('other-idempotency');await assert.rejects(()=>createRun({...site,id:other.id,ownerId:other.owner},{mode:'live',models:['gpt-4.1-mini']},{idempotencyKey:id}),e=>e.code==='idempotency_conflict');
});

test('schedule end times validate ISO instants, round-trip UTC and reject expired activation',async()=>{
 const w=await workspace('ends-validation');
 for(const endsAt of ['tomorrow','2026-10-18T10:00:00','2026-02-31T10:00:00Z'])assert.equal(ops.scheduleInput.safeParse({siteId:w.id,name:'Invalid',frequency:'daily',timezone:'UTC',hour:1,minute:0,models:['gpt-4.1-mini'],endsAt}).success,false);
 const end=new Date(Date.now()+7*86400000).toISOString(),s=await schedule(w,{endsAt:end});assert.equal(s.endsAt,end);
 const preserved=await ops.updateSchedule(w.owner,{siteId:w.id,id:s.id,name:'Renamed'});assert.equal(preserved.endsAt,end);
 const offset=new Date(Date.now()+2*86400000).toISOString().replace('Z','+00:00');const changed=await ops.updateSchedule(w.owner,{siteId:w.id,id:s.id,endsAt:offset});assert.equal(changed.endsAt,new Date(offset).toISOString());
 assert.equal((await ops.updateSchedule(w.owner,{siteId:w.id,id:s.id,endsAt:null})).endsAt,null);
 const past=new Date(Date.now()-1).toISOString();await assert.rejects(()=>schedule(w,{endsAt:past}),e=>e.code==='schedule_expired');
 const disabled=await schedule(w,{enabled:false,endsAt:past});await assert.rejects(()=>ops.updateSchedule(w.owner,{siteId:w.id,id:disabled.id,enabled:true}),e=>e.code==='schedule_expired');
 await assert.rejects(()=>enqueueManualSchedule(w.owner,w.id,disabled.id),e=>e.code==='schedule_expired');
 await ops.deleteSchedule(w.owner,w.id,s.id);
});
test('exact end boundary disables only owned schedules without queuing or reserving calls',async()=>{
 const w=await workspace('ends-boundary'),other=await workspace('ends-other-owner'),s=await schedule(w),foreign=await schedule(other);const at=Date.now();
 for(const id of [s.id,foreign.id])await db.prepare('UPDATE collection_schedules SET ends_at=?,next_run_at=? WHERE id=?').bind(at,at-1,id).run();
 const before=fetchCalls,realNow=Date.now;Date.now=()=>at;
 try{const r=await tickDueSchedules({ownerId:w.owner});assert.equal(r.queued,0);assert.equal(r.continuation,false);await assert.rejects(()=>enqueueManualSchedule(w.owner,w.id,s.id),e=>e.code==='schedule_expired');}finally{Date.now=realNow;}
 assert.equal(fetchCalls,before);assert.equal((await getUsageStatus(w.owner)).daily.used,0);assert.equal((await single('SELECT enabled,last_status FROM collection_schedules WHERE id=?',s.id)).enabled,0);assert.equal((await single('SELECT enabled FROM collection_schedules WHERE id=?',foreign.id)).enabled,1);
 await tickDueSchedules({ownerId:w.owner});const state=await ops.getOperationsState(w.owner,w.id);assert.equal(state.health.enabledSchedules,0);assert.equal(state.audit.filter(a=>a.action==='schedule_expired').length,1);
 await ops.deleteSchedule(other.owner,other.id,foreign.id);
});
test('expired queued retries cancel immediately even before their retry delay and reserve nothing',async()=>{
 const w=await workspace('ends-retry'),s=await schedule(w),e=await enqueueManualSchedule(w.owner,w.id,s.id);await db.prepare("UPDATE scheduled_executions SET status='running',next_attempt_at=?,error_code='run_in_progress' WHERE id=?").bind(Date.now()+3600000,e.id).run();await db.prepare('UPDATE collection_schedules SET ends_at=? WHERE id=?').bind(Date.now()-1,s.id).run();
 const before=fetchCalls,r=await tickDueSchedules({ownerId:w.owner});assert.equal(r.processed,1);assert.equal(r.continuation,false);assert.equal(fetchCalls,before);assert.equal((await getUsageStatus(w.owner)).daily.used,0);
 const saved=await single('SELECT status,error_code,lease_token,lease_until,next_attempt_at FROM scheduled_executions WHERE id=?',e.id);assert.deepEqual(saved,{status:'cancelled',error_code:'schedule_expired',lease_token:null,lease_until:0,next_attempt_at:0});assert.equal((await ops.getOperationsState(w.owner,w.id)).alerts.length,0);
});
test('expiry respects active execution and provider leases then closes an abandoned manifest without dispatch',async()=>{
 const w=await workspace('ends-lease'),s=await schedule(w),e=await enqueueManualSchedule(w.owner,w.id,s.id),site=await ownedSite(w.id,w.owner);await createRun(site,{mode:'live',models:['gpt-4.1-mini']},{idempotencyKey:e.id});
 await db.prepare("UPDATE scheduled_executions SET status='running',lease_token='existing-worker',lease_until=? WHERE id=?").bind(Date.now()+120000,e.id).run();await db.prepare("UPDATE runs SET status='running',lease_token='existing-provider',lease_until=? WHERE id=?").bind(Date.now()+120000,e.id).run();await db.prepare('UPDATE collection_schedules SET ends_at=? WHERE id=?').bind(Date.now()-1,s.id).run();const before=fetchCalls;
 assert.equal((await tickDueSchedules({ownerId:w.owner})).processed,0);assert.equal((await single('SELECT status FROM scheduled_executions WHERE id=?',e.id)).status,'running');
 await db.prepare('UPDATE scheduled_executions SET lease_until=0 WHERE id=?').bind(e.id).run();assert.equal((await tickDueSchedules({ownerId:w.owner})).processed,0);assert.equal((await single('SELECT status FROM runs WHERE id=?',e.id)).status,'running');
 await db.prepare('UPDATE runs SET lease_until=0 WHERE id=?').bind(e.id).run();const closed=await tickDueSchedules({ownerId:w.owner});assert.equal(closed.processed,1);assert.equal(closed.continuation,false);assert.equal(fetchCalls,before);assert.equal((await single('SELECT status FROM scheduled_executions WHERE id=?',e.id)).status,'cancelled');assert.equal((await single('SELECT status FROM runs WHERE id=?',e.id)).status,'failed');assert.equal((await getUsageStatus(w.owner)).daily.used,1);
});
test('a deadline reached during an in-flight chunk preserves answers and stops the next chunk',async()=>{
 const w=await workspace('ends-inflight',3),s=await schedule(w,{endsAt:new Date(Date.now()+86400000).toISOString()}),e=await enqueueManualSchedule(w.owner,w.id,s.id);const before=fetchCalls,previous=globalThis.fetch;let begin,finish;const started=new Promise(r=>begin=r),released=new Promise(r=>finish=r);let arrivals=0;
 globalThis.fetch=async()=>{fetchCalls++;if(++arrivals===2)begin();await released;return fixture();};
 try{const running=tickDueSchedules({ownerId:w.owner});await started;await db.prepare('UPDATE collection_schedules SET ends_at=? WHERE id=?').bind(Date.now()-1,s.id).run();finish();assert.equal((await running).continuation,true);const next=await tickDueSchedules({ownerId:w.owner});assert.equal(next.continuation,false);assert.equal(fetchCalls-before,2);const run=await single('SELECT status,completed,failed,total FROM runs WHERE id=?',e.id);assert.deepEqual(run,{status:'partial',completed:2,failed:1,total:3});assert.equal((await single('SELECT status,error_code FROM scheduled_executions WHERE id=?',e.id)).error_code,'schedule_expired');assert.equal((await getUsageStatus(w.owner)).daily.used,3);}finally{finish?.();globalThis.fetch=previous;}
});

test('free-policy and eligibility blocks are curated terminal outcomes with no provider dispatch',async()=>{
 const previous=globalThis.__opsEnv.LUMEN_PROVIDER_MODE;globalThis.__opsEnv.GEMINI_API_KEY='fixture-only';
 try{
  const a=await workspace('policy-block'),b=await workspace('eligibility-block'),sa=await schedule(a),sb=await schedule(b,{models:['gemini-3.8-flash']});await due(sa.id);await due(sb.id);
  globalThis.__opsEnv.LUMEN_PROVIDER_MODE='free_only';const before=fetchCalls;
  await assert.rejects(()=>schedule(b,{models:['gemini-3.8-flash']}),e=>e.code==='eligibility_required');
  for(const [w,code] of [[a,'paid_provider_disabled'],[b,'eligibility_required']]){const r=await tickDueSchedules({ownerId:w.owner});assert.equal(r.blocked,1);assert.equal(r.continuation,false);const state=await ops.getOperationsState(w.owner,w.id);assert.equal(state.executions[0].errorCode,code);assert.equal(state.executions[0].status,'blocked');assert.equal((await getUsageStatus(w.owner)).daily.used,0);}
  assert.equal(fetchCalls,before);
 }finally{globalThis.__opsEnv.LUMEN_PROVIDER_MODE=previous;delete globalThis.__opsEnv.GEMINI_API_KEY;}
});

test('normal expiry after a long dispatcher gap never creates a stalled alert',async()=>{
 const w=await workspace('expired-stale'),s=await schedule(w),e=await enqueueManualSchedule(w.owner,w.id,s.id),past=Date.now()-3600000;
 await db.prepare('UPDATE collection_schedules SET ends_at=? WHERE id=?').bind(past,s.id).run();await db.prepare('UPDATE scheduled_executions SET updated_at=? WHERE id=?').bind(new Date(past).toISOString(),e.id).run();const before=fetchCalls;
 const result=await tickDueSchedules({ownerId:w.owner});assert.equal(result.continuation,false);assert.equal(fetchCalls,before);const state=await ops.getOperationsState(w.owner,w.id);assert.equal(state.executions[0].status,'cancelled');assert.equal(state.executions[0].errorCode,'schedule_expired');assert.equal(state.alerts.length,0);assert.equal(state.health.openAlerts,0);assert.equal(state.health.status,'healthy');
});
test('expiry resolves an existing stalled alert without hiding unrelated operational issues',async()=>{
 const w=await workspace('expired-existing-alert'),s=await schedule(w),e=await enqueueManualSchedule(w.owner,w.id,s.id),past=Date.now()-3600000;
 await ops.alert(w.owner,w.id,e.id,'execution_stalled','Delayed','Waiting');await ops.alert(w.owner,w.id,e.id,'provider_fixture_issue','Provider issue','Keep this unresolved');
 await db.prepare("UPDATE operation_alerts SET status='acknowledged' WHERE owner_id=? AND code='execution_stalled'").bind(w.owner).run();await db.prepare('UPDATE collection_schedules SET ends_at=? WHERE id=?').bind(past,s.id).run();await db.prepare('UPDATE scheduled_executions SET updated_at=? WHERE id=?').bind(new Date(past).toISOString(),e.id).run();const before=fetchCalls;
 await tickDueSchedules({ownerId:w.owner});assert.equal(fetchCalls,before);const state=await ops.getOperationsState(w.owner,w.id);assert.equal(state.executions[0].status,'cancelled');assert.equal(state.alerts.find(a=>a.code==='execution_stalled').status,'resolved');assert.equal(state.alerts.find(a=>a.code==='provider_fixture_issue').status,'open');assert.equal(state.health.openAlerts,1);
});

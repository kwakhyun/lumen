import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync,readFileSync,readdirSync } from 'node:fs';
import { fileURLToPath,pathToFileURL } from 'node:url';
import path from 'node:path';
import { Miniflare } from 'miniflare';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
globalThis.__checksEnv={};globalThis.__checksHeaders=new Headers();
registerHooks({resolve(specifier,context,next){
  if(specifier==='cloudflare:workers')return{url:'data:text/javascript,export const env=globalThis.__checksEnv;',shortCircuit:true};
  if(specifier==='next/headers')return{url:'data:text/javascript,export async function headers(){return globalThis.__checksHeaders;}',shortCircuit:true};
  if(specifier==='next/navigation')return{url:'data:text/javascript,export function redirect(){throw new Error("redirect");}',shortCircuit:true};
  const base=specifier.startsWith('@/')?path.join(root,specifier.slice(2)):specifier.startsWith('.')&&context.parentURL?.startsWith('file:')?fileURLToPath(new URL(specifier,context.parentURL)):null;
  if(base)for(const suffix of ['.ts','/index.ts'])if(existsSync(base+suffix))return{url:pathToFileURL(base+suffix).href,shortCircuit:true};
  return next(specifier,context);
}});
let mf,db,impact,service,validation,route,integrity,calls=0;const oldFetch=globalThis.fetch;
before(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'checks-fixtures'}});db=globalThis.__checksEnv.DB=await mf.getD1Database('DB');
  for(const file of readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const statement of readFileSync(path.join(root,'drizzle',file),'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(statement).run();
  globalThis.fetch=async()=>{calls++;throw Error('Deployment checks must not make external requests');};
  impact=await import('../lib/impact-server.ts');service=await import('../lib/impact-check-server.ts');validation=await import('../lib/impact-check-validation.ts');route=await import('../app/api/impact/checks/route.ts');integrity=await import('../lib/impact-check-integrity.ts');
});
after(async()=>{globalThis.fetch=oldFetch;await mf?.dispose();});
const plan=()=>({title:'Frozen timing plan',hypothesis:'More precise sources may increase citations.',changeSummary:'A planned later update.',changedAt:'2020-01-11T00:00:00Z',contentVersion:'planned-v2',beforeStart:'2020-01-01',beforeEnd:'2020-01-10',afterStart:'2020-01-12',afterEnd:'2020-01-21',context:{surface:'ChatGPT web',model:'Unknown',language:'ko',country:'KR',device:'desktop',personalization:'New conversation'},queries:[{id:crypto.randomUUID(),question:'Which service is appropriate for small teams?',arm:'treatment',pageUrl:'https://fixture.example/'},{id:crypto.randomUUID(),question:'How can teams verify source quality?',arm:'control',pageUrl:'https://fixture.example/methodology'}],repetitions:1,currency:'KRW',outcomeDefinition:'Not measured',attributionRule:'Independent reference only'});
async function fixture(owner=crypto.randomUUID()){
  const siteId=crypto.randomUUID(),now=new Date().toISOString();await db.prepare('INSERT INTO sites(id,owner_id,name,domain,tracking_key,created_at,updated_at)VALUES(?,?,?,?,?,?,?)').bind(siteId,owner,'Fixture','fixture.example',crypto.randomUUID(),now,now).run();
  let detail=await impact.createImpact(owner,{action:'create_study',siteId,requestId:crypto.randomUUID(),plan:plan()});
  for(const q of detail.study.plan.queries)detail=await impact.createImpact(owner,{action:'add_search',siteId,studyId:detail.study.id,requestId:crypto.randomUUID(),observation:{phase:'before',queryId:q.id,repetition:1,observedAt:'2020-01-02T12:00:00Z',result:'answer',searchConfirmed:true,answerExcerpt:'An independently observed baseline answer.',brandMention:'absent',citationReview:'complete',evidenceUrl:'',citations:[],notes:'Fixture only'}});
  return{owner,siteId,studyId:detail.study.id,detail};
}
function payload(w){return{label:'Unscheduled deployment spot check',publishedAt:'2020-01-03T12:00:00Z',deploymentRef:'deployment-fixture-17',contentVersion:'commit-fixture',changes:'Clarified the published landing page.',changedUrls:['https://fixture.example/'],context:{...w.detail.study.plan.context},indexingStatus:'unconfirmed',indexingEvidence:'',observations:w.detail.searches.map(s=>({baselineDigest:s.digest,queryId:s.queryId,repetition:s.repetition,observedAt:'2020-01-03T13:00:00Z',result:'answer',searchConfirmed:true,answerExcerpt:'A newly observed search answer.',brandMention:'present',citationReview:'complete',evidenceUrl:'',citations:[{url:'https://fixture.example/',title:'Original citation',relation:'original_citation'}],notes:'Fixture consumer result'}))};}
const body=(w,p=payload(w))=>({siteId:w.siteId,studyId:w.studyId,requestId:crypto.randomUUID(),payload:p});
test('separate append-only check preserves frozen plan, baseline records and planned comparison values',async()=>{
  const w=await fixture(),request=body(w),result=await service.createImpactCheck(w.owner,request);assert.equal(result.cached,false);assert.equal(result.checks.length,1);const check=result.checks[0];assert.equal(check.digest,await integrity.impactCheckDigest(w.detail.study.digest,request.payload));
  const detail=await impact.getImpact(w.owner,w.siteId,w.studyId);assert.deepEqual(detail.study,w.detail.study);assert.deepEqual(detail.searches,w.detail.searches);assert.deepEqual(detail.comparison,w.detail.comparison);assert.equal(detail.checks[0].id,request.requestId);assert.equal(detail.searches.some(s=>s.phase==='after'),false);
  for(const table of ['ai_usage_reservations','collection_schedules','scheduled_executions','runs','impact_outcomes'])assert.equal((await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n,0);assert.equal(calls,0);
});
test('same request is idempotent and conflicting payload cannot mutate a saved check',async()=>{
  const w=await fixture(),request=body(w),first=await service.createImpactCheck(w.owner,request),retry=await service.createImpactCheck(w.owner,request);assert.equal(retry.cached,true);assert.deepEqual(retry.checks,first.checks);
  await assert.rejects(()=>service.createImpactCheck(w.owner,{...request,payload:{...request.payload,label:'Changed result'}}),e=>e.code==='impact_request_conflict');
});
test('only active same-study before records can be attached with matching query and repetition',async()=>{
  const w=await fixture(),other=await fixture(w.owner);
  for(const mutation of [p=>p.observations[0].baselineDigest='a'.repeat(64),p=>p.observations[0].baselineDigest=other.detail.searches[0].digest,p=>p.observations[0].queryId=crypto.randomUUID(),p=>p.observations[0].repetition=2]){const p=payload(w);mutation(p);await assert.rejects(()=>service.createImpactCheck(w.owner,body(w,p)),e=>['impact_check_baseline_unavailable','impact_cohort_mismatch'].includes(e.code));}
  const s=w.detail.searches[0];await impact.voidImpact(w.owner,{action:'void_search',siteId:w.siteId,studyId:w.studyId,id:s.id,reason:'Incorrect initial query assignment'});await assert.rejects(()=>service.createImpactCheck(w.owner,body(w)),e=>e.code==='impact_check_baseline_unavailable');
});
test('later baseline exclusion retains prior checks and idempotent retries for audit',async()=>{
  const w=await fixture(),request=body(w),first=await service.createImpactCheck(w.owner,request),s=w.detail.searches[0];await impact.voidImpact(w.owner,{action:'void_search',siteId:w.siteId,studyId:w.studyId,id:s.id,reason:'Later discovered evidence problem'});
  const current=await service.getImpactChecks(w.owner,w.siteId,w.studyId);assert.deepEqual(current.checks,first.checks);assert.equal((await service.createImpactCheck(w.owner,request)).cached,true);await assert.rejects(()=>service.createImpactCheck(w.owner,{...request,requestId:crypto.randomUUID()}),e=>e.code==='impact_check_baseline_unavailable');
  const baselines=(await impact.getImpact(w.owner,w.siteId,w.studyId)).searches;assert.doesNotThrow(()=>validation.assertImpactCheckMatchesBaselines(w.detail.study.plan,request.payload,baselines,Date.parse(first.checks[0].createdAt),true));
});
test('timeline requires baseline before publication and observations after publication but not in the future',async()=>{
  const w=await fixture();for(const mutation of [p=>p.publishedAt='2020-01-02T12:00:00Z',p=>p.publishedAt='2019-12-31T00:00:00Z',p=>{p.publishedAt='2099-01-01T00:00:00Z';p.observations.forEach(o=>o.observedAt='2099-01-01T01:00:00Z');},p=>p.observations[0].observedAt='2099-01-01T00:00:00Z']){const p=payload(w);mutation(p);await assert.rejects(()=>service.createImpactCheck(w.owner,body(w,p)),e=>e.code==='impact_check_time');}
  for(const mutation of [p=>p.observations[0].observedAt='2020-01-03T11:00:00Z',p=>p.publishedAt='2020-01-03T12:00:00+99:99']){const p=payload(w);mutation(p);assert.equal(validation.impactCheckPayloadSchema.safeParse(p).success,false);}
});
test('search semantics, public URLs, evidence labels and duplicate cells remain strict',async()=>{
  const w=await fixture();for(const mutation of [p=>{p.observations[0].result='error';},p=>p.observations[0].searchConfirmed=false,p=>p.observations[0].answerExcerpt='',p=>p.observations[0].evidenceUrl='https://user:password@fixture.example/',p=>p.changedUrls=['http://127.0.0.1/a'],p=>p.indexingStatus='confirmed',p=>p.observations.push(structuredClone(p.observations[0])),p=>p.observations[0].phase='after',p=>p.ownerId='mallory']){const p=payload(w);mutation(p);assert.equal(validation.impactCheckPayloadSchema.safeParse(p).success,false);}
  const p=payload(w);Object.assign(p.observations[0],{result:'no_ai_answer',answerExcerpt:'',brandMention:'uncertain',citationReview:'not_reviewed',citations:[]});p.indexingStatus='confirmed';p.indexingEvidence='User observed recrawl timestamp.';assert.equal(validation.impactCheckPayloadSchema.safeParse(p).success,true);
});
test('cross-workspace access and request ID collisions cannot expose or replace evidence',async()=>{
  const alice=await fixture(),bob=await fixture();const request=body(alice);await service.createImpactCheck(alice.owner,request);await assert.rejects(()=>service.getImpactChecks(bob.owner,alice.siteId,alice.studyId),e=>e.status===404);await assert.rejects(()=>service.createImpactCheck(bob.owner,{...body(bob),requestId:request.requestId}),e=>e.code==='impact_request_conflict');await assert.rejects(()=>service.createImpactCheck(alice.owner,{...body(alice),studyId:bob.studyId}),e=>e.status===404);
});
test('API requires auth, same origin, strict identifiers and a 96 KiB body limit',async()=>{
  const w=await fixture(),url='https://lumen.test/api/impact/checks',request=(value,origin='https://lumen.test')=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(value)});
  globalThis.__checksHeaders=new Headers();assert.equal((await route.GET(new Request(url+`?siteId=${w.siteId}&studyId=${w.studyId}`))).status,401);assert.equal((await route.POST(request(body(w)))).status,401);
  globalThis.__checksHeaders=new Headers({'oai-authenticated-user-id':w.owner,'oai-authenticated-user-email':'fixture@example.test'});for(const origin of [null,'https://evil.test'])assert.equal((await route.POST(request(body(w),origin))).status,403);assert.equal((await route.POST(request({...body(w),extra:'field'}))).status,400);assert.equal((await route.GET(new Request(url+`?siteId=${w.siteId}&siteId=${w.siteId}&studyId=${w.studyId}`))).status,400);
  const large=body(w);large.payload.observations[0].answerExcerpt='a'.repeat(100*1024);assert.equal((await route.POST(request(large))).status,413);const response=await route.POST(request(body(w)));assert.equal(response.status,201);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal((await route.GET(new Request(url+`?siteId=${w.siteId}&studyId=${w.studyId}`))).status,200);assert.equal(calls,0);
});
test('concurrent inserts at record cap cannot exceed twenty checks per site',async()=>{
  const w=await fixture();await service.createImpactCheck(w.owner,body(w));const row=await db.prepare('SELECT * FROM impact_checks WHERE site_id=?').bind(w.siteId).first();await db.batch(Array.from({length:18},()=>db.prepare('INSERT INTO impact_checks(id,site_id,study_id,payload,created_at,digest)VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),row.site_id,row.study_id,row.payload,row.created_at,row.digest)));
  const results=await Promise.allSettled([service.createImpactCheck(w.owner,body(w)),service.createImpactCheck(w.owner,body(w))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await db.prepare('SELECT count(*) n FROM impact_checks WHERE site_id=?').bind(w.siteId).first()).n,20);
});
test('UTF-8 byte storage cap remains atomic below the record-count limit',async()=>{
  const w=await fixture(),p=payload(w);p.observations=p.observations.slice(0,1);p.changes='가'.repeat(6000);p.observations[0].answerExcerpt='가'.repeat(12000);p.observations[0].notes='가'.repeat(3000);p.indexingEvidence='가'.repeat(2000);p.observations[0].citations=Array.from({length:10},(_,i)=>({url:`https://fixture.example/${i}/${'x'.repeat(1800)}`,title:'가'.repeat(100),relation:'original_citation'}));assert.equal(validation.impactCheckPayloadSchema.safeParse(p).success,true);
  await service.createImpactCheck(w.owner,body(w,p));const row=await db.prepare('SELECT * FROM impact_checks WHERE site_id=?').bind(w.siteId).first(),keys=['id','site_id','study_id','payload','created_at','digest'],overhead=keys.reduce((n,k)=>n+JSON.stringify(k).length+2,2),rowBytes=Buffer.byteLength(JSON.stringify(keys.map(k=>row[k])))+overhead,capacity=Math.floor(1024*1024/rowBytes);assert.ok(capacity<20&&capacity>1);
  await db.batch(Array.from({length:capacity-1},()=>db.prepare('INSERT INTO impact_checks(id,site_id,study_id,payload,created_at,digest)VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),row.site_id,row.study_id,row.payload,row.created_at,row.digest)));
  await assert.rejects(()=>service.createImpactCheck(w.owner,body(w,p)),e=>e.code==='impact_check_reference_or_limit');assert.equal((await db.prepare('SELECT count(*) n FROM impact_checks WHERE site_id=?').bind(w.siteId).first()).n,capacity);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Miniflare } from 'miniflare';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env=globalThis.__impactEnv;', shortCircuit: true };
  if (specifier === 'next/headers') return { url: 'data:text/javascript,export async function headers(){return globalThis.__impactHeaders;}', shortCircuit: true };
  if (specifier === 'next/navigation') return { url: 'data:text/javascript,export function redirect(){throw new Error("redirect");}', shortCircuit: true };
  if (specifier.startsWith('@/')) { const base = path.join(root, specifier.slice(2)); for (const suffix of ['.ts','/index.ts']) if (existsSync(base + suffix)) return { url: pathToFileURL(base + suffix).href, shortCircuit: true }; }
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) { const base = fileURLToPath(new URL(specifier, context.parentURL)); if (existsSync(base + '.ts')) return { url: pathToFileURL(base + '.ts').href, shortCircuit: true }; }
  return next(specifier, context);
} });
globalThis.__impactEnv = {}; globalThis.__impactHeaders = new Headers();
const service = await import('../lib/impact-server.ts');
const metrics = await import('../lib/impact-metrics.ts');
const route = await import('../app/api/impact/route.ts');
let mf, db, calls = 0; const oldFetch = globalThis.fetch;
before(async () => {
  mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: { DB: 'impact-tests' } });
  db = globalThis.__impactEnv.DB = await mf.getD1Database('DB');
  for (const file of readdirSync(path.join(root, 'drizzle')).filter(n => n.endsWith('.sql')).sort()) for (const sql of readFileSync(path.join(root, 'drizzle', file), 'utf8').split('--> statement-breakpoint').filter(s => s.trim())) await db.prepare(sql).run();
  globalThis.fetch = async () => { calls++; throw new Error('Impact studies must never call external APIs'); };
});
after(async () => { globalThis.fetch = oldFetch; await mf?.dispose(); });
async function workspace(owner = 'alice') { const id = crypto.randomUUID(), date = new Date().toISOString(); await db.prepare('INSERT INTO sites(id,owner_id,name,domain,tracking_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(id, owner, 'Acme', 'acme.example', crypto.randomUUID(), date, date).run(); return { id, owner }; }
const validation = await import('../lib/impact-validation.ts');
const { impactDigest } = await import('../lib/impact-integrity.ts');
const plan = () => ({ title:'Product page impact', hypothesis:'Clearer supporting sources may improve citations.', changeSummary:'Publish original comparison with verifiable sources.', changedAt:'2026-01-03T00:00:00Z',contentVersion:'git:abc123',beforeStart:'2026-01-01',beforeEnd:'2026-01-02',afterStart:'2026-01-04',afterEnd:'2026-01-05',context:{surface:'ChatGPT web',model:'shown-model-label',language:'ko',country:'KR',device:'desktop',personalization:'New conversation; memory disabled'},queries:[{id:crypto.randomUUID(),question:'Which product works best for task A?',arm:'treatment',pageUrl:'https://acme.example/compare-a'},{id:crypto.randomUUID(),question:'Which product works best for task B?',arm:'control',pageUrl:'https://acme.example/compare-b'}],repetitions:1,currency:'KRW',outcomeDefinition:'Session with purchase event',attributionRule:'AI referrer sessions landing on assigned page, session source last non-direct'});
const create = async (w, p = plan()) => service.createImpact(w.owner,{action:'create_study',siteId:w.id,requestId:crypto.randomUUID(),plan:p});
const observation = (study,arm='treatment',phase='before', overrides={})=>({phase,queryId:study.plan.queries.find(query=>query.arm===arm).id,repetition:1,observedAt:phase==='before'?'2026-01-01T12:00:00Z':'2026-01-04T12:00:00Z',result:'answer',searchConfirmed:true,answerExcerpt:'Observed consumer answer.',brandMention:'absent',citationReview:'complete',evidenceUrl:'',citations:[],notes:'Manual observation from stated environment.',...overrides});
const outcome = (study,arm='treatment',phase='before',overrides={})=>({arm,phase,source:'ga4_export',sourceId:'properties/123456',reportTimeZone:'UTC',definitionConfirmed:true,sourceRef:'Saved GA4 report export',rangeStart:phase==='before'?study.plan.beforeStart:study.plan.afterStart,rangeEnd:phase==='before'?study.plan.beforeEnd:study.plan.afterEnd,sessions:100,convertingSessions:10,orders:12,revenueMinor:10000,currency:'KRW',notes:'Aggregate only',confounders:'',...overrides});
const search = (w,study,arm,phase,fields={})=>service.createImpact(w.owner,{action:'add_search',siteId:w.id,studyId:study.id,requestId:crypto.randomUUID(),observation:observation(study,arm,phase,fields)});
const aggregate = (w,study,arm,phase,fields={})=>service.createImpact(w.owner,{action:'add_outcome',siteId:w.id,studyId:study.id,requestId:crypto.randomUUID(),outcome:outcome(study,arm,phase,fields)});
test('study is immutable, owner-scoped, idempotent, snapshots brand and never invokes paid or free providers',async()=>{
  const w=await workspace(),request={action:'create_study',siteId:w.id,requestId:crypto.randomUUID(),plan:plan()},first=await service.createImpact(w.owner,request),again=await service.createImpact(w.owner,request);
  assert.equal(first.study.id,again.study.id);assert.equal(first.study.registration,'retrospective');
  await db.prepare('UPDATE sites SET name=? WHERE id=?').bind('Renamed',w.id).run();assert.equal((await service.getImpact(w.owner,w.id,first.study.id)).study.brand.name,'Acme');
  await assert.rejects(()=>service.getImpact('mallory',w.id),e=>e.status===404);
  await assert.rejects(()=>service.createImpact(w.owner,{...request,plan:{...request.plan,title:'Changed'}}),e=>e.code==='impact_request_conflict');
  assert.equal((await service.getImpact(w.owner,w.id)).studies.length,1);assert.equal(calls,0);
  for(const table of ['ai_usage_reservations','collection_schedules','scheduled_executions','runs']) assert.equal((await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n,0);
});
test('search comparison pairs complete cells and keeps no answer, error, unconfirmed and missing distinct',async()=>{
  const w=await workspace(),p=plan();p.repetitions=3;const {study}=await create(w,p);
  await search(w,study,'treatment','before');await search(w,study,'treatment','after',{brandMention:'present'});
  await search(w,study,'treatment','before',{repetition:2,result:'no_ai_answer',answerExcerpt:'',brandMention:'uncertain',citationReview:'not_reviewed'});
  await search(w,study,'treatment','after',{repetition:2,searchConfirmed:false});
  const result=await search(w,study,'treatment','before',{repetition:3,result:'error',answerExcerpt:'',brandMention:'uncertain',citationReview:'not_reviewed'});
  assert.deepEqual(result.comparison.search.mention.treatment,{paired:1,planned:3,before:{numerator:0,denominator:1,rate:0},after:{numerator:1,denominator:1,rate:100},deltaPp:100});
  assert.equal(result.comparison.search.mention.differenceInDifferencesPp,null);
  assert.equal(result.comparison.coverage.treatment.before.noAiAnswer,1);assert.equal(result.comparison.coverage.treatment.before.errors,1);assert.equal(result.comparison.coverage.treatment.after.unconfirmedSearch,1);assert.equal(result.comparison.coverage.treatment.after.missing,1);
  assert.equal(result.comparison.search.mention.control.before.rate,null);
});
test('only reviewed original own-domain citations count; followup SERP and lookalike domains do not',async()=>{
  const w=await workspace(),{study}=await create(w);
  await search(w,study,'treatment','before',{citations:[{url:'https://acme.example/source',title:'Followup',relation:'followup_search'},{url:'https://acme.example.evil.test/source',title:'Wrong domain',relation:'original_citation'}]});
  const result=await search(w,study,'treatment','after',{citations:[{url:'https://docs.acme.example/source',title:'Original source',relation:'original_citation'}]});
  assert.equal(result.comparison.search.citation.treatment.before.numerator,0);assert.equal(result.comparison.search.citation.treatment.after.numerator,1);
  assert.ok(validation.impactSearchSchema.safeParse(observation(study,'control','before',{searchConfirmed:false,citations:[{url:'https://acme.example/a',title:'Bad',relation:'original_citation'}]})).success===false);
});
test('uncertain human labels and unreviewed citations are unmeasured rather than negative',async()=>{
  const w=await workspace(),{study}=await create(w);await search(w,study,'treatment','before',{brandMention:'uncertain',citationReview:'not_reviewed'});const result=await search(w,study,'treatment','after',{brandMention:'present'});
  assert.equal(result.comparison.search.mention.treatment.paired,0);assert.equal(result.comparison.search.citation.treatment.paired,0);assert.equal(result.comparison.search.citation.treatment.deltaPp,null);
});
test('business uses converting sessions, preserves missing data and computes descriptive difference in differences',async()=>{
  const w=await workspace(),{study}=await create(w);
  await aggregate(w,study,'treatment','before',{sessions:100,convertingSessions:10,orders:20,revenueMinor:10000});
  let result=await aggregate(w,study,'treatment','after',{sessions:200,convertingSessions:40,orders:70,revenueMinor:40000});
  assert.equal(result.comparison.business.conversionDifferenceInDifferencesPp,null);assert.equal(result.comparison.business.revenueTotals.control.before,null);
  await aggregate(w,study,'control','before',{sessions:100,convertingSessions:10,revenueMinor:10000});
  result=await aggregate(w,study,'control','after',{sessions:100,convertingSessions:15,revenueMinor:12000});
  assert.equal(result.comparison.business.comparable,true);assert.equal(result.comparison.business.conversionRate.treatment.after,20);assert.equal(result.comparison.business.conversionDifferenceInDifferencesPp,5);
  assert.equal(result.comparison.business.revenueDifferenceInDifferencesMinor,80);assert.equal(result.comparison.business.revenueTotals.treatment.deltaMinor,30000);
  assert.ok(result.comparison.caveats.some(value=>value.includes('인과효과')));
});
test('mixed export sources and zero sessions never produce conversion uplift',async()=>{
  const w=await workspace(),{study}=await create(w);
  for(const arm of ['treatment','control'])for(const phase of ['before','after'])await aggregate(w,study,arm,phase,{source:arm==='treatment'?'ga4_export':'store_export',sessions:0,convertingSessions:0,revenueMinor:null});
  const result=await service.getImpact(w.owner,w.id,study.id);assert.equal(result.comparison.business.comparable,false);assert.equal(result.comparison.business.conversionDifferenceInDifferencesPp,null);assert.equal(result.comparison.business.revenueDifferenceInDifferencesMinor,null);
});
test('duplicate concurrent observations create one active cell; immutable void retains original and permits replacement',async()=>{
  const w=await workspace(),{study}=await create(w),results=await Promise.allSettled([search(w,study,'treatment','before'),search(w,study,'treatment','before')]);
  assert.equal(results.filter(item=>item.status==='fulfilled').length,1);
  const result=await service.getImpact(w.owner,w.id,study.id),original=result.searches[0],payload={action:'void_search',siteId:w.id,studyId:study.id,id:original.id,reason:'Evidence was assigned to the wrong query.'};
  await assert.rejects(()=>service.voidImpact('mallory',payload),e=>e.status===404);
  await service.voidImpact(w.owner,payload);await service.voidImpact(w.owner,payload);
  await assert.rejects(()=>service.voidImpact(w.owner,{...payload,reason:'Altered explanation'}),e=>e.code==='impact_immutable');
  const replaced=await search(w,study,'treatment','before',{brandMention:'present'});assert.equal(replaced.searches.length,2);assert.equal(replaced.searches.filter(row=>!row.voidedAt).length,1);
  const retained=replaced.searches.find(row=>row.id===original.id);assert.equal(retained.answerExcerpt,original.answerExcerpt);assert.equal(retained.digest,original.digest);assert.equal(retained.brandMention,'absent');
});
test('outcome duplicate, correction and idempotent retries preserve original aggregate',async()=>{
  const w=await workspace(),{study}=await create(w),request={action:'add_outcome',siteId:w.id,studyId:study.id,requestId:crypto.randomUUID(),outcome:outcome(study)};
  await service.createImpact(w.owner,request);const retry=await service.createImpact(w.owner,request);assert.equal(retry.outcomes.length,1);
  await assert.rejects(()=>aggregate(w,study,'treatment','before'),e=>e.code==='impact_duplicate_or_limit');
  await service.voidImpact(w.owner,{action:'void_outcome',siteId:w.id,studyId:study.id,id:retry.outcomes[0].id,reason:'Corrected aggregate export.'});
  const result=await aggregate(w,study,'treatment','before',{convertingSessions:11});assert.equal(result.outcomes.length,2);assert.equal(result.outcomes.find(row=>row.voidedAt).convertingSessions,10);
});
test('frozen cohorts, timing, windows, currencies and malformed outcome counts are rejected',async()=>{
  const w=await workspace(),{study}=await create(w);
  await assert.rejects(()=>search(w,study,'treatment','before',{queryId:crypto.randomUUID()}),e=>e.code==='impact_cohort_mismatch');
  await assert.rejects(()=>search(w,study,'treatment','before',{observedAt:'2099-01-01T00:00:00Z'}),e=>e.code==='impact_observation_time');
  await assert.rejects(()=>search(w,study,'treatment','before',{observedAt:'2026-01-03T00:00:00Z'}),e=>e.code==='impact_observation_time');
  await assert.rejects(()=>aggregate(w,study,'treatment','before',{rangeEnd:'2026-01-01'}),e=>e.code==='impact_outcome_window');
  await assert.rejects(()=>aggregate(w,study,'treatment','before',{currency:'USD'}),e=>e.code==='impact_currency');
  assert.equal(validation.impactOutcomeSchema.safeParse(outcome(study,'treatment','before',{convertingSessions:101})).success,false);
  assert.equal(validation.impactOutcomeSchema.safeParse(outcome(study,'treatment','before',{sessions:null,convertingSessions:10})).success,false);
  assert.equal(validation.impactOutcomeSchema.safeParse(outcome(study,'treatment','before',{revenueMinor:0.1})).success,false);
});
test('plan bounds, same-page contamination, unsafe links and invalid dates fail without throwing',()=>{
  for(const patch of [{afterEnd:'2026-01-06'},{beforeStart:'2026-02-30'},{changedAt:'2026-01-05T00:00:00Z'},{repetitions:4}])assert.equal(validation.impactPlanSchema.safeParse({...plan(),...patch}).success,false);
  const p=plan();p.queries[1].pageUrl=p.queries[0].pageUrl+'?source=control';assert.equal(validation.impactPlanSchema.safeParse(p).success,false);
  for(const url of ['javascript:alert(1)','http://127.0.0.1/a','https://user:secret@example.test/a','not a URL']){const q=plan();q.queries[0].pageUrl=url;assert.equal(validation.impactPlanSchema.safeParse(q).success,false);}
});
test('content digests are canonical and do not attest authenticity; field changes invalidate them',async()=>{
  assert.equal(await impactDigest({a:1,b:{x:3,y:4}}),await impactDigest({b:{y:4,x:3},a:1}));
  const w=await workspace(),{study}=await create(w),result=await search(w,study,'treatment','before'),row=result.searches[0];
  assert.equal(study.digest,await impactDigest({metricVersion:study.metricVersion,plan:study.plan,brand:study.brand}));
  const payload=observation(study);assert.equal(row.digest,await impactDigest({studyDigest:study.digest,kind:'add_search',payload}));
  assert.notEqual(row.digest,await impactDigest({studyDigest:study.digest,kind:'add_search',payload:{...payload,brandMention:'present'}}));
});
test('API requires auth, same origin and strict UUIDs and forbids mutating frozen plan',async()=>{
  const w=await workspace(),url='https://lumen.test/api/impact',body={action:'create_study',siteId:w.id,requestId:crypto.randomUUID(),plan:plan()},request=(data,origin='https://lumen.test',method='POST')=>new Request(url,{method,headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(data)});
  globalThis.__impactHeaders=new Headers();assert.equal((await route.GET(new Request(url+'?siteId='+w.id))).status,401);
  globalThis.__impactHeaders=new Headers({'oai-authenticated-user-id':w.owner,'oai-authenticated-user-email':'alice@example.test'});
  assert.equal((await route.POST(request(body,null))).status,403);assert.equal((await route.POST(request(body,'https://evil.test'))).status,403);
  assert.equal((await route.POST(request({...body,ownerId:'bob'}))).status,400);assert.equal((await route.GET(new Request(url+'?siteId=garbage'))).status,400);
  const badUrl=structuredClone(body);badUrl.plan.queries[0].pageUrl='not a URL';assert.equal((await route.POST(request(badUrl))).status,400);
  const created=await route.POST(request(body));assert.equal(created.status,201);assert.equal(created.headers.get('cache-control'),'private, no-store');
  assert.equal((await route.PATCH(request({...body,action:'update_study'},'https://lumen.test','PATCH'))).status,400);
  assert.equal(calls,0);
});
test('cross-workspace study IDs and reused request IDs cannot read or replace evidence',async()=>{
  const alice=await workspace('alice-cross'),bob=await workspace('bob-cross'),{study}=await create(alice);
  await assert.rejects(()=>service.getImpact(bob.owner,bob.id,study.id),e=>e.status===404);
  await assert.rejects(()=>search(bob,study,'treatment','before'),e=>e.status===404);
  const request={action:'create_study',siteId:alice.id,requestId:study.id,plan:study.plan};
  await assert.rejects(()=>service.createImpact(bob.owner,{...request,siteId:bob.id}),e=>e.code==='impact_request_conflict');
});
test('source-comparable zero sessions and unmeasured revenue remain null, while measured zero is retained',async()=>{
  const w=await workspace(),{study}=await create(w);
  for(const arm of ['treatment','control'])for(const phase of ['before','after'])await aggregate(w,study,arm,phase,{sessions:0,convertingSessions:0,revenueMinor:arm==='treatment'?0:null});
  const result=await service.getImpact(w.owner,w.id,study.id);assert.equal(result.comparison.business.comparable,true);assert.equal(result.comparison.business.conversionRate.treatment.before,null);assert.equal(result.comparison.business.revenuePerSession.treatment.before,null);assert.equal(result.comparison.business.revenueTotals.treatment.before,0);assert.equal(result.comparison.business.revenueTotals.control.before,null);
});
test('prospective planning is supported but future observation and incomplete future outcome windows are rejected',async()=>{
  const w=await workspace(),p=plan();Object.assign(p,{beforeStart:'2099-01-01',beforeEnd:'2099-01-02',changedAt:'2099-01-03T00:00:00Z',afterStart:'2099-01-04',afterEnd:'2099-01-05'});const {study}=await create(w,p);assert.equal(study.registration,'prospective');
  await assert.rejects(()=>search(w,study,'treatment','before',{observedAt:'2099-01-01T12:00:00Z'}),e=>e.code==='impact_observation_time');
  await assert.rejects(()=>aggregate(w,study,'treatment','before'),e=>e.code==='impact_outcome_time');
});
test('concurrent creation at workspace capacity cannot exceed fifty studies',async()=>{
  const w=await workspace(),{study}=await create(w),payload=JSON.stringify(study.plan),brand=JSON.stringify(study.brand);
  await db.batch(Array.from({length:48},()=>db.prepare('INSERT INTO impact_studies(id,site_id,plan,brand,metric_version,created_at,digest) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),w.id,payload,brand,study.metricVersion,study.createdAt,study.digest)));
  const results=await Promise.allSettled([create(w),create(w)]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal((await service.getImpact(w.owner,w.id)).studies.length,50);
});
test('different properties do not become comparable merely because both are GA4 exports',async()=>{
  const w=await workspace(),{study}=await create(w);
  for(const arm of ['treatment','control'])for(const phase of ['before','after'])await aggregate(w,study,arm,phase,{sourceId:arm==='treatment'?'properties/123':'properties/456'});
  const result=await service.getImpact(w.owner,w.id,study.id);assert.equal(result.comparison.business.comparable,false);assert.equal(result.comparison.business.conversionDifferenceInDifferencesPp,null);
  for(const invalid of [{sourceId:''},{reportTimeZone:'Asia/Seoul'},{definitionConfirmed:false}])assert.equal(validation.impactOutcomeSchema.safeParse(outcome(study,'treatment','before',invalid)).success,false);
});
test('atomic byte budget rejects concurrent oversized inserts before count cap and retains prior rows',async()=>{
  const w=await workspace(),p=plan();p.repetitions=3;const {study}=await create(w,p);
  // Seed an almost-full immutable history under the exact wire budget. No provider calls.
  const columns=['id','site_id','study_id','phase','query_id','repetition','payload','created_at','digest','voided_at','void_reason'];
  const overhead=columns.reduce((n,key)=>n+JSON.stringify(key).length+2,2),limit=3*1024*1024;
  const make=(payload,voidedAt='2026-01-06T00:00:00.000Z')=>({id:crypto.randomUUID(),site_id:w.id,study_id:study.id,phase:'before',query_id:p.queries[0].id,repetition:1,payload,created_at:'2026-01-06T00:00:00.000Z',digest:'0'.repeat(64),voided_at:voidedAt,void_reason:voidedAt?'Historical excluded observation.':null});
  const large=make(JSON.stringify(observation(study,'treatment','before',{answerExcerpt:'한'.repeat(12000)})));
  const size=row=>Buffer.byteLength(JSON.stringify(columns.map(key=>row[key])))+overhead+(row.voided_at===null?6048:0);
  const incoming=make(JSON.stringify(observation(study)),null);incoming.created_at=new Date().toISOString();
  const allowed=size(incoming),reserveTarget=limit-allowed-1000,fullCount=Math.floor(reserveTarget/size(large));
  const seed=Array.from({length:fullCount},()=>({...large,id:crypto.randomUUID()}));
  const used=seed.reduce((n,row)=>n+size(row),0),filler=make(JSON.stringify(observation(study,'treatment','before',{answerExcerpt:'x'})));
  filler.payload=JSON.stringify(observation(study,'treatment','before',{answerExcerpt:'x'+'한'.repeat(Math.max(0,Math.min(11999,Math.floor((reserveTarget-used-size(filler))/3))))}));
  seed.push(filler);
  await db.batch(seed.map(row=>db.prepare(`INSERT INTO impact_searches(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).bind(...columns.map(key=>row[key]))));
  const result=await Promise.allSettled([search(w,study,'treatment','before'),search(w,study,'treatment','after')]);
  assert.equal(result.filter(row=>row.status==='fulfilled').length,1);
  const counts=await db.prepare('SELECT count(*) n FROM impact_searches WHERE site_id=?').bind(w.id).first();assert.equal(counts.n,seed.length+1);assert.ok(counts.n<5000);
  const current=await db.prepare('SELECT id FROM impact_searches WHERE site_id=? AND voided_at IS NULL').bind(w.id).first();
  // Worst-case escaped exclusion metadata fits the pre-reserved budget.
  await service.voidImpact(w.owner,{action:'void_search',siteId:w.id,studyId:study.id,id:current.id,reason:'x'+String.fromCharCode(0).repeat(998)+'x'});
  const stat=await db.prepare(`SELECT sum(length(CAST(json_array(${columns.join(',')}) AS BLOB))+${overhead}) bytes FROM impact_searches WHERE site_id=?`).bind(w.id).first();assert.ok(stat.bytes<=limit);
});
test('unsupported minor-unit currencies and non-finite offset timestamps are rejected',()=>{
  assert.equal(validation.impactPlanSchema.safeParse({...plan(),currency:'BHD'}).success,false);
  assert.equal(validation.impactPlanSchema.safeParse({...plan(),changedAt:'2026-01-03T00:00:00+99:99'}).success,false);
  const study={plan:plan()};assert.equal(validation.impactSearchSchema.safeParse(observation(study,'treatment','before',{observedAt:'2026-01-01T00:00:00+99:99'})).success,false);
  assert.equal(validation.impactOutcomeSchema.safeParse(outcome(study,'treatment','before',{currency:'KWD'})).success,false);
  assert.throws(()=>validation.assertSearchMatchesPlan(study.plan,observation(study,'treatment','before',{observedAt:'2026-01-01T00:00:00+99:99'})),e=>e.code==='impact_observation_time');
});

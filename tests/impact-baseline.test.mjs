import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Miniflare } from 'miniflare';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__baselineEnv = {}; globalThis.__baselineHeaders = new Headers();
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env=globalThis.__baselineEnv;', shortCircuit: true };
  if (specifier === 'next/headers') return { url: 'data:text/javascript,export async function headers(){return globalThis.__baselineHeaders;}', shortCircuit: true };
  if (specifier === 'next/navigation') return { url: 'data:text/javascript,export function redirect(){throw new Error("redirect");}', shortCircuit: true };
  const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : specifier.startsWith('.') && context.parentURL?.startsWith('file:') ? fileURLToPath(new URL(specifier, context.parentURL)) : null;
  if (base) for (const suffix of ['.ts','/index.ts']) if (existsSync(base + suffix)) return { url: pathToFileURL(base + suffix).href, shortCircuit: true };
  return next(specifier, context);
} });
const env=globalThis.__baselineEnv, oldFetch=globalThis.fetch;
let mf,db,security,ga4,service,impact,route,calls=[];
before(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'baseline-fixtures'}});db=env.DB=await mf.getD1Database('DB');
  for(const file of readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const statement of readFileSync(path.join(root,'drizzle',file),'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(statement).run();
  Object.assign(env,{APP_BASE_URL:'https://lumen.test',GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'fixture',INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,42).toString('base64')});
  security=await import('../lib/integration-security.ts');ga4=await import('../lib/ga4.ts');service=await import('../lib/impact-baseline-server.ts');impact=await import('../lib/impact-server.ts');route=await import('../app/api/impact/baseline/route.ts');
});
beforeEach(async()=>{calls=[];globalThis.fetch=async()=>{throw Error('Unmocked external call forbidden');};globalThis.__baselineHeaders=new Headers();await db.prepare('DELETE FROM quotas').run();});
after(async()=>{globalThis.fetch=oldFetch;await mf?.dispose();});
const plan=()=>({title:'Actual baseline fixture',hypothesis:'A clearer comparison page may improve citations.',changeSummary:'Update comparison page.',changedAt:'2020-01-03T00:00:00Z',contentVersion:'fixture-v1',beforeStart:'2020-01-01',beforeEnd:'2020-01-02',afterStart:'2020-01-04',afterEnd:'2020-01-05',context:{surface:'ChatGPT web',model:'Shown',language:'ko',country:'KR',device:'desktop',personalization:'New chat'},queries:[{id:crypto.randomUUID(),question:'Which product answers comparison questions?',arm:'treatment',pageUrl:'https://fixture.example/a'},{id:crypto.randomUUID(),question:'Which product explains key capabilities?',arm:'control',pageUrl:'https://fixture.example/b'}],repetitions:1,currency:'KRW',outcomeDefinition:'Unmeasured business events',attributionRule:'GA4 reference only, not a treatment outcome'});
async function fixture(owner=crypto.randomUUID(),p=plan()){
  const siteId=crypto.randomUUID(),now=new Date().toISOString();await db.prepare('INSERT INTO sites(id,owner_id,name,domain,tracking_key,created_at,updated_at)VALUES(?,?,?,?,?,?,?)').bind(siteId,owner,'Fixture','fixture.example',crypto.randomUUID(),now,now).run();
  const refresh=await security.encryptSecret('fixture-refresh',`lumen:ga4:${owner}:${siteId}:refresh`),access=await security.encryptSecret('fixture-access',`lumen:ga4:${owner}:${siteId}:access`);
  await db.prepare('INSERT INTO ga4_connections(site_id,owner_id,refresh_cipher,access_cipher,access_expires,status,property_id,property_name,report,last_synced_at,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(siteId,owner,refresh,access,Date.now()+3600000,'connected','1234','Fixture GA4','{"sentinel":"unchanged"}',now,now,now).run();
  const {study}=await impact.createImpact(owner,{action:'create_study',siteId,requestId:crypto.randomUUID(),plan:p});return{owner,siteId,studyId:study.id,study,requestId:crypto.randomUUID()};
}
function reports(options={}){globalThis.fetch=async(url,init)=>{
  calls.push({url,body:init?.body?JSON.parse(init.body):null});
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-refreshed',token_type:'Bearer',expires_in:3600});
  if(url==='https://analyticsadmin.googleapis.com/v1beta/properties/1234')return Response.json({name:'properties/1234',displayName:'Fixture GA4',timeZone:options.timeZone||'Asia/Seoul'});
  assert.equal(url,'https://analyticsdata.googleapis.com/v1beta/properties/1234:runReport');const body=JSON.parse(init.body),ai=body.metrics.length===1;
  if(options.fail)return Response.json({error:{code:503}},{status:503});
  const metadata={timeZone:options.timeZone||'Asia/Seoul',...options.metadata};
  if(options.empty)return Response.json({kind:'analyticsData#runReport',metadata});
  return Response.json({kind:'analyticsData#runReport',metricHeaders:body.metrics.map(m=>({name:m.name,type:'TYPE_INTEGER'})),rows:[{metricValues:(ai?[options.ai??2]:[options.sessions??10,options.views??13]).map(value=>({value:String(value)}))}],rowCount:1,metadata});
};}
const input=w=>({siteId:w.siteId,studyId:w.studyId,requestId:w.requestId});
test('GA4 property calendar caps at yesterday and never fabricates a completed current/future day',()=>{
  const now=Date.parse('2026-10-22T00:30:00Z');
  assert.deepEqual(ga4.ga4BaselineDateRange('Asia/Seoul','2026-10-20','2026-10-25',now),{startDate:'2026-10-20',endDate:'2026-10-21',timeZone:'Asia/Seoul'});
  assert.throws(()=>ga4.ga4BaselineDateRange('Asia/Seoul','2026-10-22','2026-10-25',now),e=>e.code==='ga4_baseline_not_ready');
  for(const [a,b]of[['2026-02-30','2026-03-01'],['2026-03-02','2026-03-01'],['2026-01-01','2026-06-01']])assert.throws(()=>ga4.ga4BaselineDateRange('UTC',a,b,now));
});
test('read-only baseline uses fixed hostname/source filters and stores honest null business fields',async()=>{
  const w=await fixture();reports();const before=await db.prepare('SELECT refresh_cipher,report,last_synced_at,revision FROM ga4_connections WHERE site_id=?').bind(w.siteId).first();
  const result=await service.createImpactBaseline(w.owner,input(w)),p=result.baselines[0].payload;
  assert.equal(result.cached,false);assert.equal(calls.length,3);assert.equal(p.totalSessions,10);assert.equal(p.aiSessions,2);assert.equal(p.totalViews,13);assert.equal(p.timeZone,'Asia/Seoul');assert.equal(p.completeForPlan,false);assert.equal(p.convertingSessions,null);assert.equal(p.orders,null);assert.equal(p.revenueMinor,null);
  assert.deepEqual(calls[1].body.dimensionFilter,{filter:{fieldName:'hostName',inListFilter:{values:['fixture.example','www.fixture.example'],caseSensitive:false}}});assert.deepEqual(calls[2].body.dimensionFilter.andGroup.expressions[0],calls[1].body.dimensionFilter);assert.ok(p.notes.some(note=>note.includes('fixture.example 및 www.fixture.example')&&note.includes('다른 하위 도메인은 포함하지 않으며')));assert.equal(calls[2].body.dimensionFilter.andGroup.expressions[1].filter.fieldName,'sessionSource');assert.equal(calls[2].body.dimensionFilter.andGroup.expressions[1].filter.stringFilter.value,ga4.GA4_BASELINE_SOURCE_PATTERN);
  assert.deepEqual(await db.prepare('SELECT refresh_cipher,report,last_synced_at,revision FROM ga4_connections WHERE site_id=?').bind(w.siteId).first(),before);
  assert.equal((await impact.getImpact(w.owner,w.siteId,w.studyId)).baselines.length,1);
  for(const table of ['ai_usage_reservations','collection_schedules','scheduled_executions','runs','impact_outcomes'])assert.equal((await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n,0);
});
test('same request and same query within 24h return immutable cache without another external call',async()=>{
  const w=await fixture();reports();const first=await service.createImpactBaseline(w.owner,input(w)),digest=first.baselines[0].digest;
  globalThis.fetch=async()=>{throw Error('Cached snapshot must not refresh OAuth or report');};
  for(const requestId of [w.requestId,crypto.randomUUID()]){const result=await service.createImpactBaseline(w.owner,{...input(w),requestId});assert.equal(result.cached,true);assert.equal(result.baselines.length,1);assert.equal(result.baselines[0].digest,digest);}
  const count=await db.prepare('SELECT count FROM quotas WHERE id=?').bind(`impact-ga4-baseline:${w.owner}:${Math.floor(Date.now()/86400000)}`).first();assert.equal(count.count,1);
});
test('expired snapshot refresh creates a new immutable version and retains the original',async()=>{
  const w=await fixture();reports();const first=await service.createImpactBaseline(w.owner,input(w));await db.prepare('UPDATE impact_baselines SET created_at=? WHERE id=?').bind('2020-02-01T00:00:00Z',w.requestId).run();reports({sessions:15});const next=await service.createImpactBaseline(w.owner,{...input(w),requestId:crypto.randomUUID()});assert.equal(next.cached,false);assert.equal(next.baselines.length,2);assert.equal(next.baselines[0].payload.totalSessions,15);assert.equal(next.baselines.find(b=>b.id===w.requestId).digest,first.baselines[0].digest);
});
test('authenticated ownership, strict request schema and same-origin protect baseline import',async()=>{
  const w=await fixture(),url='https://lumen.test/api/impact/baseline',request=(body,origin='https://lumen.test')=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
  assert.equal((await route.GET(new Request(url+`?siteId=${w.siteId}&studyId=${w.studyId}`))).status,401);assert.equal((await route.POST(request(input(w)))).status,401);
  globalThis.__baselineHeaders=new Headers({'oai-authenticated-user-id':w.owner,'oai-authenticated-user-email':'fixture@example.test'});
  assert.equal((await route.POST(request(input(w),'https://evil.test'))).status,403);assert.equal((await route.POST(request({...input(w),ownerId:'mallory'}))).status,400);assert.equal((await route.GET(new Request(url+`?siteId=${w.siteId}&siteId=${w.siteId}&studyId=${w.studyId}`))).status,400);
  await assert.rejects(()=>service.createImpactBaseline('mallory',input(w)),e=>e.status===404);assert.equal(calls.length,0);
  reports();const response=await route.POST(request(input(w)));assert.equal(response.status,201);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
});
test('a refresh reuses the same grant and a concurrent lease blocks duplicate import',async()=>{
  const w=await fixture();await db.prepare('UPDATE ga4_connections SET access_expires=0 WHERE site_id=?').bind(w.siteId).run();const before=await db.prepare('SELECT refresh_cipher FROM ga4_connections WHERE site_id=?').bind(w.siteId).first();
  reports();const mock=globalThis.fetch;globalThis.fetch=async(url,init)=>{if(url==='https://oauth2.googleapis.com/token'){calls.push({url});assert.equal(new URLSearchParams(init.body).get('refresh_token'),'fixture-refresh');return Response.json({access_token:'fixture-refreshed',token_type:'Bearer',expires_in:3600});}return mock(url,init);};
  await service.createImpactBaseline(w.owner,input(w));assert.equal(calls.filter(c=>c.url==='https://oauth2.googleapis.com/token').length,1);assert.equal((await db.prepare('SELECT refresh_cipher FROM ga4_connections WHERE site_id=?').bind(w.siteId).first()).refresh_cipher,before.refresh_cipher);
  const v=await fixture();await db.prepare('UPDATE ga4_connections SET lease_token=?,lease_until=? WHERE site_id=?').bind('existing-lease',Date.now()+60000,v.siteId).run();const n=calls.length;await assert.rejects(()=>service.createImpactBaseline(v.owner,input(v)),e=>e.code==='integration_busy');assert.equal(calls.length,n);
});
test('upstream failure preserves earlier data and releases the lease',async()=>{
  const w=await fixture();reports();await service.createImpactBaseline(w.owner,input(w));await db.prepare('UPDATE impact_baselines SET created_at=? WHERE id=?').bind('2020-02-01T00:00:00Z',w.requestId).run();const before=await db.prepare('SELECT refresh_cipher,report,last_synced_at FROM ga4_connections WHERE site_id=?').bind(w.siteId).first();reports({fail:true});
  await assert.rejects(()=>service.createImpactBaseline(w.owner,{...input(w),requestId:crypto.randomUUID()}),e=>e.code==='integration_upstream_error');assert.equal((await service.getImpactBaselines(w.owner,w.siteId,w.studyId)).baselines.length,1);assert.deepEqual(await db.prepare('SELECT refresh_cipher,report,last_synced_at FROM ga4_connections WHERE site_id=?').bind(w.siteId).first(),before);assert.equal((await db.prepare('SELECT lease_token FROM ga4_connections WHERE site_id=?').bind(w.siteId).first()).lease_token,null);
});
test('legitimate empty reports retain zero and quality flags without inferring revenue',async()=>{
  const w=await fixture();reports({empty:true,metadata:{subjectToThresholding:true,emptyReason:'Data threshold applied'}});const {payload}= (await service.createImpactBaseline(w.owner,input(w))).baselines[0];assert.equal(payload.totalSessions,0);assert.equal(payload.aiSessions,0);assert.equal(payload.revenueMinor,null);assert.equal(payload.dataQuality.subjectToThresholding,true);assert.ok(payload.dataQuality.emptyReasons.length>0);
  assert.throws(()=>ga4.mapGa4BaselineAggregate({},['sessions'],'UTC'),e=>e.code==='integration_response_invalid');
  assert.throws(()=>ga4.mapGa4BaselineAggregate({kind:'analyticsData#runReport',metadata:{timeZone:'Asia/Seoul'}},['sessions'],'UTC'),e=>e.code==='ga4_report_changed');
});
test('inconsistent or fractional counts do not create a baseline',async()=>{
  for(const options of [{ai:11,sessions:10},{sessions:2.5}]){const w=await fixture();reports(options);await assert.rejects(()=>service.createImpactBaseline(w.owner,input(w)));assert.equal((await service.getImpactBaselines(w.owner,w.siteId,w.studyId)).baselines.length,0);}
});
test('storage cap and daily owner/global limits stop external calls',async()=>{
  const w=await fixture();reports();await service.createImpactBaseline(w.owner,input(w));const original=await db.prepare('SELECT * FROM impact_baselines WHERE id=?').bind(w.requestId).first();await db.prepare('UPDATE impact_baselines SET created_at=? WHERE id=?').bind('2020-01-01T00:00:00Z',w.requestId).run();await db.batch(Array.from({length:99},()=>db.prepare('INSERT INTO impact_baselines(id,site_id,study_id,query_key,payload,created_at,digest)VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),w.siteId,w.studyId,original.query_key,original.payload,'2020-01-01T00:00:00Z',original.digest)));const n=calls.length;await assert.rejects(()=>service.createImpactBaseline(w.owner,{...input(w),requestId:crypto.randomUUID()}),e=>e.code==='impact_baseline_limit');assert.equal(calls.length,n);
  for(const [kind,count,owner] of [['impact-ga4-baseline',4,'limited-owner'],['impact-ga4-baseline-global',40,'service']]){const v=await fixture('limited-owner'),slot=Math.floor(Date.now()/86400000);await db.prepare('INSERT OR REPLACE INTO quotas(id,count,expires_at)VALUES(?,?,?)').bind(`${kind}:${owner}:${slot}`,count,(slot+1)*86400000).run();const countBefore=calls.length;await assert.rejects(()=>service.createImpactBaseline(v.owner,input(v)),e=>e.code==='quota_exceeded');assert.equal(calls.length,countBefore);await db.prepare('DELETE FROM quotas').run();}
});
test('revoked baseline refresh retains encrypted credentials and previous snapshots for diagnosis',async()=>{
  const w=await fixture();await db.prepare('UPDATE ga4_connections SET access_expires=0 WHERE site_id=?').bind(w.siteId).run();const before=await db.prepare('SELECT refresh_cipher,access_cipher,report FROM ga4_connections WHERE site_id=?').bind(w.siteId).first();globalThis.fetch=async()=>Response.json({error:'invalid_grant'},{status:400});
  await assert.rejects(()=>service.createImpactBaseline(w.owner,input(w)),e=>e.code==='oauth_revoked');const after=await db.prepare('SELECT refresh_cipher,access_cipher,report,status,lease_token FROM ga4_connections WHERE site_id=?').bind(w.siteId).first();assert.deepEqual({refresh_cipher:after.refresh_cipher,access_cipher:after.access_cipher,report:after.report},before);assert.equal(after.status,'reconnect_required');assert.equal(after.lease_token,null);
});
test('disconnect during import fences the result and never recreates credentials or stores a baseline',async()=>{
  const w=await fixture();reports();const mock=globalThis.fetch;let begin,finish;const begun=new Promise(resolve=>begin=resolve),gate=new Promise(resolve=>finish=resolve);globalThis.fetch=async(url,init)=>{if(url.includes(':runReport')&&JSON.parse(init.body).metrics.length===1){begin();await gate;}return mock(url,init);};
  const pending=service.createImpactBaseline(w.owner,input(w));await begun;await ga4.disconnectGa4(w.owner,w.siteId);finish();await assert.rejects(()=>pending,e=>e.code==='integration_changed');assert.equal((await service.getImpactBaselines(w.owner,w.siteId,w.studyId)).baselines.length,0);assert.equal((await ga4.ga4Status(w.owner,w.siteId)).connected,false);
});

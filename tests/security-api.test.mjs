import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Miniflare } from 'miniflare';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__securityEnv = {}; globalThis.__securityHeaders = new Headers();
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return {url:'data:text/javascript,export const env=globalThis.__securityEnv;',shortCircuit:true};
  if (specifier === 'next/headers') return {url:'data:text/javascript,export async function headers(){return globalThis.__securityHeaders;}',shortCircuit:true};
  if (specifier === 'next/navigation') return {url:'data:text/javascript,export function redirect(){throw Error("redirect")}',shortCircuit:true};
  const base = specifier.startsWith('@/') ? path.join(root,specifier.slice(2)) : specifier.startsWith('.') && context.parentURL?.startsWith('file:') ? fileURLToPath(new URL(specifier,context.parentURL)) : null;
  if (base) for (const suffix of ['.ts','/index.ts']) if (existsSync(base+suffix)) return {url:pathToFileURL(base+suffix).href,shortCircuit:true};
  return next(specifier,context);
}});
let mf,db,service,validation,route,integrity,calls=0;
const oldFetch=globalThis.fetch;
export const evidence=()=>({schemaVersion:1,collector:'lumen-public-web/1',targetOrigin:'https://fixture.example',observedAt:'2020-01-01T00:00:00Z',authorization:'owner_or_authorized',home:{status:200,error:null,bodyComplete:true,contentType:'html',headers:{hsts:'missing',csp:'missing',nosniff:false,framing:'missing',referrer:'missing'},cookies:{total:0,missingSecure:0,missingHttpOnly:0,missingSameSite:0},html:{title:true,canonical:'self',indexing:'allowed',mixedContent:false}},robots:{status:200,error:null,bodyComplete:true,rules:{Googlebot:'allowed',bingbot:'allowed','OAI-SearchBot':'allowed',PerplexityBot:'allowed'}},sitemap:{status:200,error:null,bodyComplete:true,format:'urlset',sameOriginUrls:3,otherOriginUrls:0}});
before(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'security-fixtures'}});db=globalThis.__securityEnv.DB=await mf.getD1Database('DB');
  for (const file of readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort()) for (const statement of readFileSync(path.join(root,'drizzle',file),'utf8').split('--> statement-breakpoint').filter(s=>s.trim())) await db.prepare(statement).run();
  globalThis.fetch=async()=>{calls++;throw Error('Security imports must never make network requests');};
  service=await import('../lib/security-server.ts');validation=await import('../lib/security-validation.ts');route=await import('../app/api/security-checks/route.ts');integrity=await import('../lib/security-integrity.ts');
});
after(async()=>{globalThis.fetch=oldFetch;await mf?.dispose();});
async function fixture(owner=crypto.randomUUID(),mode='live',domain='fixture.example'){
 const siteId=crypto.randomUUID(),date=new Date().toISOString();await db.prepare('INSERT INTO sites(id,owner_id,name,domain,mode,tracking_key,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?)').bind(siteId,owner,'Fixture',domain,mode,crypto.randomUUID(),date,date).run();return{siteId,owner};
}
const body=(w,ev=evidence())=>({action:'import',siteId:w.siteId,requestId:crypto.randomUUID(),evidence:ev});
const taskBody=(w,check,finding)=>({action:'create_task',siteId:w.siteId,checkId:check.id,findingId:finding.id});
test('imports retain immutable facts, recompute findings, and make no outbound calls or AI reservations',async()=>{
 const w=await fixture(),request=body(w),result=await service.createSecurityCheck(w.owner,request);assert.equal(result.cached,false);assert.equal(result.checks.length,1);assert.deepEqual(result.checks[0].evidence,request.evidence);assert.equal(result.checks[0].digest,await integrity.securityEvidenceDigest(request.evidence));assert.ok(result.checks[0].findings.some(f=>f.state==='attention'));
 assert.deepEqual((await service.getSecurityChecks(w.owner,w.siteId)).checks,result.checks);assert.equal(calls,0);
 for(const table of ['ai_usage_reservations','collection_schedules','runs'])assert.equal((await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n,0);
});
test('same request is idempotent; changed evidence and cross-workspace IDs cannot replace a result',async()=>{
 const alice=await fixture(),bob=await fixture(),request=body(alice),first=await service.createSecurityCheck(alice.owner,request);const retry=await service.createSecurityCheck(alice.owner,request);assert.equal(retry.cached,true);assert.deepEqual(retry.checks,first.checks);
 await assert.rejects(()=>service.getSecurityChecks(bob.owner,alice.siteId),e=>e.status===404);
 await assert.rejects(()=>service.createSecurityCheck(bob.owner,request),e=>e.status===404);
 await assert.rejects(()=>service.createSecurityCheck(bob.owner,{...body(bob),requestId:request.requestId}),e=>e.code==='security_request_conflict');
 const changed=structuredClone(request);changed.evidence.home.headers.hsts='enabled';await assert.rejects(()=>service.createSecurityCheck(alice.owner,changed),e=>e.code==='security_request_conflict');
 assert.deepEqual((await service.getSecurityChecks(alice.owner,alice.siteId)).checks,first.checks);
});
test('domain matching is exact after URL normalization, future observations and demo imports fail',async()=>{
 const w=await fixture();for(const targetOrigin of ['https://www.fixture.example','https://other.fixture.example','https://fixture.example.attacker.test'])await assert.rejects(()=>service.createSecurityCheck(w.owner,body(w,{...evidence(),targetOrigin})),e=>e.code==='security_domain_mismatch');
 await assert.rejects(()=>service.createSecurityCheck(w.owner,body(w,{...evidence(),observedAt:'2099-01-01T00:00:00Z'})),e=>e.code==='security_future_observation');
 const demo=await fixture(undefined,'demo');await assert.rejects(()=>service.createSecurityCheck(demo.owner,body(demo)),e=>e.code==='security_live_required');
});
test('strict observations reject raw secrets, invented proof and incomplete page claims',()=>{
 for(const mutate of [e=>e.rawHeaders={'Set-Cookie':'secret'},e=>e.home.html.script='secret',e=>e.authorization='third_party',e=>e.collector='unknown',e=>e.home.status=null,e=>e.home.error='timeout',e=>e.home.bodyComplete=false,e=>e.home.contentType='other',e=>e.home.cookies.missingSecure=1,e=>e.home.headers=null,e=>e.home.status=302,e=>e.robots.bodyComplete=false,e=>e.sitemap.error='body_limit',e=>e.sitemap.format='unknown',e=>e.observedAt='2020-01-01T01:00:00+99:99']){const ev=evidence();mutate(ev);assert.equal(validation.securityEvidenceSchema.safeParse(ev).success,false);}
 for(const targetOrigin of ['http://fixture.example','https://fixture.example/','https://user:password@fixture.example','https://fixture.example:8443','https://fixture.example?secret=1','https://127.0.0.1','https://host.local','https://localhost'])assert.equal(validation.securityEvidenceSchema.safeParse({...evidence(),targetOrigin}).success,false);
 const unknown=evidence();unknown.home={status:null,error:'dns_blocked',bodyComplete:false,contentType:'unknown',headers:null,cookies:null,html:null};unknown.robots={status:403,error:null,bodyComplete:false,rules:{Googlebot:'unknown',bingbot:'unknown','OAI-SearchBot':'unknown',PerplexityBot:'unknown'}};unknown.sitemap={status:200,error:'body_limit',bodyComplete:false,format:'unknown',sameOriginUrls:0,otherOriginUrls:0};assert.equal(validation.securityEvidenceSchema.safeParse(unknown).success,true);
});
test('API requires authentication, owned site, same-origin POST, bounded JSON and no-store on every response',async()=>{
 const w=await fixture(),url='https://lumen.test/api/security-checks',post=(data,origin='https://lumen.test',extra={})=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{}),...extra},body:typeof data==='string'?data:JSON.stringify(data)});
 globalThis.__securityHeaders=new Headers();for(const response of [await route.GET(new Request(url+'?siteId='+w.siteId)),await route.POST(post(body(w)))]){assert.equal(response.status,401);assert.match(response.headers.get('Cache-Control'),/no-store/);}
 globalThis.__securityHeaders=new Headers({'oai-authenticated-user-id':w.owner,'oai-authenticated-user-email':'fixture@example.test'});
 for(const origin of [null,'https://evil.test'])assert.equal((await route.POST(post(body(w),origin))).status,403);
 assert.equal((await route.POST(post(body(w),'https://lumen.test',{'Sec-Fetch-Site':'cross-site'}))).status,403);
 for(const suffix of [`?siteId=${w.siteId}&siteId=${w.siteId}`,`?siteId=${w.siteId}&url=https://evil.test`,'?siteId=invalid'])assert.equal((await route.GET(new Request(url+suffix))).status,400);
 assert.equal((await route.POST(post({...body(w),findings:[]}))).status,400);assert.equal((await route.POST(post(body(w),'https://lumen.test',{'Content-Type':'text/plain'}))).status,415);
 assert.equal((await route.POST(post('{'))).status,400);assert.equal((await route.POST(post(JSON.stringify(body(w))+' '.repeat(32768)))).status,413);
 const response=await route.POST(post(body(w)));assert.equal(response.status,201);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal((await route.GET(new Request(url+'?siteId='+w.siteId))).status,200);
});
test('concurrent import at twenty-record limit inserts one, and duplicate race has one immutable row',async()=>{
 const w=await fixture(),request=body(w);const results=await Promise.all([service.createSecurityCheck(w.owner,request),service.createSecurityCheck(w.owner,request)]);assert.equal(results.filter(r=>r.cached===false).length,1);
 const row=await db.prepare('SELECT * FROM security_checks WHERE site_id=?').bind(w.siteId).first();await db.batch(Array.from({length:18},()=>db.prepare('INSERT INTO security_checks(id,site_id,evidence,digest,created_at)VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),w.siteId,row.evidence,row.digest,row.created_at)));
 const capped=await Promise.allSettled([service.createSecurityCheck(w.owner,body(w)),service.createSecurityCheck(w.owner,body(w))]);assert.equal(capped.filter(r=>r.status==='fulfilled').length,1);assert.equal(capped.find(r=>r.status==='rejected').reason.code,'security_storage_limit');assert.equal((await db.prepare('SELECT count(*) n FROM security_checks WHERE site_id=?').bind(w.siteId).first()).n,20);
});
test('atomic owner import quota and defensive total-byte bound reject overfill',async()=>{
 const w=await fixture(),other=await fixture(w.owner),slot=Math.floor(Date.now()/60000);await db.prepare('INSERT INTO quotas(id,count,expires_at)VALUES(?,?,?)').bind(`security-import:${w.owner}:${slot}`,29,(slot+1)*60000).run();
 const results=await Promise.allSettled([service.createSecurityCheck(w.owner,body(w)),service.createSecurityCheck(other.owner,body(other))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'quota_exceeded');
 const large=await fixture();await db.prepare('INSERT INTO security_checks(id,site_id,evidence,digest,created_at)VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),large.siteId,JSON.stringify(evidence())+' '.repeat(1024*1024),'a'.repeat(64),new Date().toISOString()).run();await assert.rejects(()=>service.createSecurityCheck(large.owner,body(large)),e=>e.code==='security_storage_limit');
});
test('only attention findings become deduplicated existing-workflow tasks, preserving edited task status',async()=>{
 const w=await fixture(),check=(await service.createSecurityCheck(w.owner,body(w))).checks[0],attention=check.findings.find(f=>f.state==='attention'),pass=check.findings.find(f=>f.state==='pass');
 await assert.rejects(()=>service.createSecurityCheck(w.owner,taskBody(w,check,pass)),e=>e.code==='security_finding_not_actionable');
 const results=await Promise.all([service.createSecurityCheck(w.owner,taskBody(w,check,attention)),service.createSecurityCheck(w.owner,taskBody(w,check,attention))]);assert.equal(new Set(results.map(r=>r.taskId)).size,1);assert.equal(results.filter(r=>r.cached===false).length,1);
 const id=results[0].taskId;await db.prepare("UPDATE tasks SET status='done',title='Operator edited title' WHERE id=?").bind(id).run();assert.equal((await service.createSecurityCheck(w.owner,taskBody(w,check,attention))).cached,true);assert.equal((await db.prepare('SELECT status FROM tasks WHERE id=?').bind(id).first()).status,'done');
 const other=await fixture();await assert.rejects(()=>service.createSecurityCheck(other.owner,{...taskBody(other,check,attention)}),e=>e.status===404);
 assert.equal(validation.securityPostSchema.safeParse({...taskBody(w,check,attention),title:'Injected title'}).success,false);
});
test('concurrent task creation cannot exceed the shared hundred-task cap',async()=>{
 const w=await fixture(),check=(await service.createSecurityCheck(w.owner,body(w))).checks[0],findings=check.findings.filter(f=>f.state==='attention');assert.ok(findings.length>=2);
 const at=new Date().toISOString();await db.batch(Array.from({length:99},()=>db.prepare('INSERT INTO tasks(id,site_id,title,description,status,priority,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),w.siteId,'Existing task','','todo','medium',at,at)));
 const results=await Promise.allSettled(findings.slice(0,2).map(f=>service.createSecurityCheck(w.owner,taskBody(w,check,f))));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'security_task_limit');assert.equal((await db.prepare('SELECT count(*) n FROM tasks WHERE site_id=?').bind(w.siteId).first()).n,100);assert.equal(calls,0);
});

test('actual collector output matches the import contract for complete, redirected, failed and truncated observations',async()=>{
 const {evidenceFromResponses}=await import('../scripts/collect-security-evidence.mjs');
 const complete=[{status:200,error:null,bodyComplete:true,headers:{'content-type':'text/html'},body:'<html><head><title>Fixture</title><link rel="canonical" href="https://fixture.example/"></head><body>Fixture</body></html>'},{status:200,error:null,bodyComplete:true,headers:{'content-type':'text/plain'},body:'User-agent: *\nAllow: /'},{status:200,error:null,bodyComplete:true,headers:{'content-type':'application/xml'},body:'<urlset><url><loc>https://fixture.example/</loc></url></urlset>'}];
 for(const results of [complete,[{status:302,error:null,bodyComplete:false,headers:{},body:''},complete[1],complete[2]],complete.map(()=>({status:null,error:'dns_failed',bodyComplete:false,headers:{},body:''})),complete.map(()=>({status:200,error:'body_limit',bodyComplete:false,headers:{},body:''}))])assert.equal(validation.securityEvidenceSchema.safeParse(evidenceFromResponses('https://fixture.example',results,'2020-01-01T00:00:00Z')).success,true);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Miniflare } from 'miniflare';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
registerHooks({resolve(specifier,context,next){
  if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env=globalThis.__lumenTestEnv;',shortCircuit:true};
  if(specifier==='next/headers')return {url:'data:text/javascript,export async function headers(){return globalThis.__lumenTestHeaders;}',shortCircuit:true};
  if(specifier==='next/navigation')return {url:'data:text/javascript,export function redirect(){throw new Error("redirect");}',shortCircuit:true};
  if(specifier.startsWith('@/')){const base=path.join(root,specifier.slice(2));for(const suffix of ['.ts','/index.ts'])if(existsSync(base+suffix))return {url:pathToFileURL(base+suffix).href,shortCircuit:true};}
  if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){const base=fileURLToPath(new URL(specifier,context.parentURL));if(existsSync(base+'.ts'))return {url:pathToFileURL(base+'.ts').href,shortCircuit:true};}
  return next(specifier,context);
}});
const {computeMetrics,extractMentions,domainMatches,normalizeDomain,csvCell,trafficSource}=await import('../lib/metrics.ts');
const {parseProviderResponse}=await import('../lib/providers-response.ts');
const {assertSameOrigin,readJson,siteInput}=await import('../lib/product-validation.ts');
let mf,route;globalThis.__lumenTestEnv={LUMEN_PROVIDER_MODE:'paid_enabled'};globalThis.__lumenTestHeaders=new Headers();
const origin='https://lumen.test';
async function call(method,url,body,user='alice'){
  globalThis.__lumenTestHeaders=new Headers(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':`${user}@example.test`}:{});
  const req=new Request(origin+'/api/'+url,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const response=await route[method](req,{params:Promise.resolve({path:url.split('?')[0].split('/')})});
  const data=response.headers.get('Content-Type')?.includes('json')?await response.json():await response.text();return {response,data};
}
before(async()=>{
  mf=new Miniflare({modules:true,script:'export default { fetch(){ return new Response("ok"); } }',d1Databases:{DB:'lumen-security-test'}});
  globalThis.__lumenTestEnv.DB=await mf.getD1Database('DB');
  for(const file of readdirSync(path.join(root,'drizzle')).filter(name=>name.endsWith('.sql')).sort())for(const statement of readFileSync(path.join(root,'drizzle',file),'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await globalThis.__lumenTestEnv.DB.prepare(statement).run();
  route=await import('../app/api/[[...path]]/route.ts');
});
after(async()=>{await mf?.dispose();});

test('host checks reject suffix impersonation and normalize public domains',()=>{
  assert.equal(domainMatches('docs.brand.com','brand.com'),true);assert.equal(domainMatches('brand.com.attacker.test','brand.com'),false);assert.equal(domainMatches('notbrand.com','brand.com'),false);
  assert.equal(normalizeDomain('https://www.Example.com/path'),'example.com');assert.equal(normalizeDomain('https://example.com@evil.test'),null); // credentials must be rejected
});
test('domain validation blocks private endpoints and credentials',()=>{for(const d of ['localhost','127.0.0.1','10.2.0.5','192.168.1.2','172.16.2.3','https://user:pass@example.com','https://[::1]'])assert.equal(normalizeDomain(d),null);});
test('mention extraction respects word boundaries and rank is tracked-brand order',()=>{
  const mentions=extractMentions('Multilinear is not a brand. Acme follows Linear.',[],[{name:'Linear',domain:'linear.app'},{name:'Acme',domain:'acme.com'}]);assert.equal(mentions[0].firstPosition,41);assert.equal(mentions[1].rank,1);assert.equal(mentions[0].rank,2);
  assert.equal(extractMentions('Multilinear',['https://linear.app'].map(url=>({url,domain:'linear.app'})),[{name:'Linear',domain:'linear.app'}])[0].mentioned,false);
});
test('hidden citation targets and tracking query strings never create brand mentions',()=>{
  const brands=[{name:'OpenAI',domain:'openai.com'}];
  for(const text of ['...([ai.google.dev](https://ai.google.dev/gemini-api/docs?utm_source=openai))','Gemini: https://ai.google.dev/docs?utm_source=openai#OpenAI','See [Gemini](https://ai.google.dev/openai/comparison).']){const own=extractMentions(text,[],brands)[0];assert.equal(own.mentioned,false);assert.equal(own.cited,false);}
  assert.equal(extractMentions('Compare [OpenAI](https://example.com).',[],brands)[0].mentioned,true);
  assert.equal(extractMentions('Learn more at https://openai.com/products?source=google.',[],brands)[0].mentioned,true);
});
test('Korean brand particles do not cause false missing mentions',()=>{for(const text of ['루멘은 유용합니다.','루멘을 추천합니다.','루멘이라는 도구','루멘입니다.'])assert.equal(extractMentions(text,[],[{name:'루멘',domain:'lumen.example'}])[0].mentioned,true);assert.equal(extractMentions('Notion은 협업 도구입니다.',[],[{name:'Notion',domain:'notion.so'}])[0].mentioned,true);assert.equal(extractMentions('Notionally',[],[{name:'Notion',domain:'notion.so'}])[0].mentioned,false);});
test('provider citations only use typed annotations; text URLs cannot fabricate citations',()=>{
  const r=parseProviderResponse({id:'resp_test',output:[{type:'message',content:[{type:'output_text',text:'See https://fake.test. Real source.',annotations:[{type:'url_citation',url:'https://docs.acme.com/guide',title:'Guide',start_index:22,end_index:34},{type:'url_citation',url:'javascript:alert(1)'},{type:'text',url:'https://invented.test'}]}]}],usage:{input_tokens:10,output_tokens:20}});
  assert.equal(r.citations.length,1);assert.equal(r.citations[0].domain,'docs.acme.com');assert.equal(r.citations[0].provenance,'provider_annotation');assert.equal(r.providerResponseId,'resp_test');assert.equal(r.inputTokens,10);
});
test('metric denominators exclude failures, deduplicate mentions, and distinguish coverage',()=>{
  const base={status:'completed',model:'gpt-4.1-mini',mode:'live',createdAt:'2026-10-18T00:00:00Z',completedAt:null,citations:[]};
  const a={...base,promptId:'p1',citations:[{domain:'acme.com',url:'https://acme.com/',provenance:'provider_annotation'}],mentions:[{domain:'acme.com',mentioned:true,cited:true,rank:2},{domain:'rival.com',mentioned:true,cited:false,rank:1}]};
  const b={...base,promptId:'p1',mentions:[{domain:'acme.com',mentioned:false,cited:false,rank:null},{domain:'rival.com',mentioned:true,cited:true,rank:1}]};
  const m=computeMetrics({name:'Acme',domain:'acme.com'},[{name:'Rival',domain:'rival.com'}],[a,b,{...base,promptId:'p2',status:'failed',mentions:[]}],[{id:'p1',active:true},{id:'p2',active:true}]);
  assert.equal(m.answerCount,2);assert.equal(m.coverage,50);assert.equal(m.mentionRate,50);assert.equal(m.citationRate,50);assert.equal(m.shareOfVoice,33.3);assert.equal(m.averageRank,2);
});
test('CSV export neutralizes spreadsheet formulas and preserves quotes',()=>{for(const value of ['=HYPERLINK("https://evil.test")',' +SUM(1,2)','@CMD','-1+2','\t=CMD'])assert.match(csvCell(value),/^"'/);assert.equal(csvCell('a"b'),'"a""b"');});
test('traffic source checks do not trust lookalike domains',()=>{assert.equal(trafficSource('https://chatgpt.com/ref'),'ChatGPT');assert.equal(trafficSource('https://chatgpt.com.evil.test'),'Other');});
test('CSRF denies absent or foreign origins and malformed JSON is bounded',async()=>{
  assert.throws(()=>assertSameOrigin(new Request(origin+'/api/demo',{method:'POST'})),/application/);
  assert.throws(()=>assertSameOrigin(new Request(origin+'/api/demo',{method:'POST',headers:{Origin:'https://attacker.test'}})),/application/);
  await assert.rejects(()=>readJson(new Request(origin,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"a":"'+'x'.repeat(100)+'"}'}),siteInput,20),/too large/);
});
let siteId,promptId;
test('API requires identity before workspace access',async()=>{const r=await call('GET','bootstrap',undefined,null);assert.equal(r.response.status,401);assert.equal(r.data.code,'unauthenticated');});
test('create tenant-owned live workspace and prompts',async()=>{
  const r=await call('POST','sites',{name:'Acme',domain:'acme.com',industry:'Software'});assert.equal(r.response.status,201);assert.equal(r.data.site.mode,'live');assert.equal('ownerId' in r.data.site,false);siteId=r.data.site.id;
  const p=await call('POST',`sites/${siteId}/prompts`,{text:'What are the best collaboration platforms?'});assert.equal(p.response.status,201);promptId=p.data.prompt.id;
});
test('cross-tenant reads and writes are rejected before provider calls',async()=>{
  const before=await globalThis.__lumenTestEnv.DB.prepare('SELECT count(*) n FROM quotas').first();
  const read=await call('GET',`sites/${siteId}/state`,undefined,'bob');assert.equal(read.response.status,404);
  const write=await call('PATCH',`sites/${siteId}/prompts/${promptId}`,{text:'Changed by attacker'},'bob');assert.equal(write.response.status,404);
  const cost=await call('POST',`sites/${siteId}/runs`,{models:['gpt-4.1-mini'],mode:'live'},'bob');assert.equal(cost.response.status,404);
  const runCount=await globalThis.__lumenTestEnv.DB.prepare('SELECT count(*) n FROM runs').first();assert.equal(runCount.n,0);assert.ok(before.n>=0);
});
test('provider unavailable returns explicit 503 without fake run',async()=>{const r=await call('POST',`sites/${siteId}/runs`,{models:['gpt-4.1-mini'],mode:'live'});assert.equal(r.response.status,503);assert.equal(r.data.code,'provider_unavailable');});
test('a real response fixture persists original text and annotation provenance',async()=>{
  globalThis.__lumenTestEnv.OPENAI_API_KEY='unit-test-value';const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(init.body);assert.equal(body.store,false);assert.equal(body.tools[0].type,'web_search');assert.equal(body.input,'What are the best collaboration platforms?');calls++;return Response.json({id:'resp_fixture',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Acme is one option. Compare pricing and fit.',annotations:[{type:'url_citation',url:'https://acme.com/product',title:'Product',start_index:0,end_index:18}]}]}],usage:{input_tokens:60,output_tokens:20}});};
  try{
    const created=await call('POST',`sites/${siteId}/runs`,{models:['gpt-4.1-mini'],mode:'live'});assert.equal(created.response.status,201);
    const processed=await call('POST',`sites/${siteId}/runs/${created.data.run.id}/process`);assert.equal(processed.response.status,200);assert.equal(processed.data.run.status,'completed');assert.equal(processed.data.answers[0].providerResponseId,'resp_fixture');assert.equal(processed.data.answers[0].citations[0].provenance,'provider_annotation');assert.equal(calls,1);
    const repeated=await call('POST',`sites/${siteId}/runs/${created.data.run.id}/process`);assert.equal(repeated.data.run.status,'completed');assert.equal(calls,1);
  }finally{globalThis.fetch=originalFetch;delete globalThis.__lumenTestEnv.OPENAI_API_KEY;}
});
test('demo seed is persistent, synthetic and isolated from live runs',async()=>{
  const r=await call('POST','demo');assert.equal(r.response.status,201);const id=r.data.site.id;
  const state=await call('GET',`sites/${id}/state`);assert.equal(state.response.status,200);assert.equal(state.data.answers.length,252);assert.ok(state.data.answers.every(a=>a.mode==='demo'&&a.providerResponseId===null));assert.ok(state.data.answers.flatMap(a=>a.citations).every(c=>c.provenance==='synthetic'));assert.equal(state.data.personas.length,2);
  const second=await call('POST','demo');assert.equal(second.data.site.id,id);
  const mixed=await call('POST',`sites/${id}/runs`,{mode:'live',models:['gpt-4.1-mini']});assert.equal(mixed.response.status,400);assert.equal(mixed.data.code,'mode_mismatch');
});
test('cross-site child IDs cannot mutate another workspace',async()=>{
  const other=await call('POST','sites',{name:'Other',domain:'other.example'});const r=await call('PATCH',`sites/${other.data.site.id}/prompts/${promptId}`,{text:'Incorrectly scoped'});assert.equal(r.response.status,404);
});
test('unconfigured optional providers remain unavailable',async()=>{for(const model of ['gemini-3.8-flash','perplexity/sonar']){const r=await call('POST',`sites/${siteId}/runs`,{mode:'live',models:[model]});assert.equal(r.response.status,503);assert.equal(r.data.code,'provider_unavailable');}});
test('configured Gemini and Perplexity dispatch independently without an OpenAI key',async()=>{
  globalThis.__lumenTestEnv.GEMINI_API_KEY='unit-test-value';globalThis.__lumenTestEnv.PERPLEXITY_API_KEY='unit-test-value';const previous=globalThis.fetch;const visited=[];
  globalThis.fetch=async(url,init)=>{visited.push(url);const body=JSON.parse(init.body);
    if(url.includes('generativelanguage.googleapis.com')){assert.equal(body.tools,undefined);assert.match(body.systemInstruction.parts[0].text,/Web search is unavailable/);return Response.json({responseId:'gemini_fixture',candidates:[{finishReason:'STOP',content:{parts:[{text:'Acme is a collaboration platform.'}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:20}});}
    assert.equal(url,'https://api.perplexity.ai/v1/agent');assert.equal(body.model,'perplexity/sonar');assert.equal(body.store,false);return Response.json({id:'sonar_fixture',status:'completed',model:'perplexity/sonar',output:[{type:'search_results',results:[{id:1,url:'https://acme.com/product',title:'Product'}]},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'Acme is an option.[1]',annotations:[]}]}],usage:{input_tokens:10,output_tokens:20}});
  };
  try{const created=await call('POST',`sites/${siteId}/runs`,{mode:'live',models:['gemini-3.8-flash','perplexity/sonar']});assert.equal(created.response.status,201);const result=await call('POST',`sites/${siteId}/runs/${created.data.run.id}/process`);assert.equal(result.response.status,200);assert.equal(result.data.run.status,'completed');assert.equal(visited.length,2);assert.equal(result.data.answers.find(a=>a.model==='gemini-3.8-flash').citations.length,0);assert.equal(result.data.answers.find(a=>a.model==='perplexity/sonar').citations[0].domain,'acme.com');assert.equal(result.data.answers.find(a=>a.model==='perplexity/sonar').provider,'Perplexity API');}
  finally{globalThis.fetch=previous;delete globalThis.__lumenTestEnv.GEMINI_API_KEY;delete globalThis.__lumenTestEnv.PERPLEXITY_API_KEY;}
});
test('incomplete provider output is failed and excluded from completed answers',async()=>{
  globalThis.__lumenTestEnv.OPENAI_API_KEY='unit-test-value';const previous=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({id:'resp_incomplete',status:'incomplete',output:[{type:'message',content:[{type:'output_text',text:'Acme partial answer',annotations:[]}]}]});
  try{const r=await call('POST',`sites/${siteId}/runs`,{models:['gpt-4.1-mini'],mode:'live'});const done=await call('POST',`sites/${siteId}/runs/${r.data.run.id}/process`);assert.equal(done.data.run.status,'failed');assert.equal(done.data.answers[0].status,'failed');assert.equal(done.data.answers[0].text,'');assert.match(done.data.answers[0].error,/did not complete/);}finally{globalThis.fetch=previous;delete globalThis.__lumenTestEnv.OPENAI_API_KEY;}
});
test('persistent lease blocks overlapping workers and fences stale answer writes',async()=>{
  globalThis.__lumenTestEnv.OPENAI_API_KEY='unit-test-value';const previous=globalThis.fetch;let begin,finish;const started=new Promise(r=>begin=r),release=new Promise(r=>finish=r);let calls=0;
  globalThis.fetch=async()=>{calls++;begin();await release;return Response.json({id:'resp_stale',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Acme stale answer',annotations:[]}]}]});};
  try{const created=await call('POST',`sites/${siteId}/runs`,{models:['gpt-4.1-mini'],mode:'live'});const runId=created.data.run.id;
    const first=call('POST',`sites/${siteId}/runs/${runId}/process`);await started;
    const overlapping=await call('POST',`sites/${siteId}/runs/${runId}/process`);assert.equal(overlapping.response.status,409);assert.equal(calls,1);
    await globalThis.__lumenTestEnv.DB.prepare('UPDATE runs SET lease_token=?,lease_until=? WHERE id=?').bind('new-owner',Date.now()+120000,runId).run();finish();
    const stale=await first;assert.equal(stale.response.status,409);const answer=await globalThis.__lumenTestEnv.DB.prepare('SELECT text,status FROM answers WHERE run_id=?').bind(runId).first();assert.equal(answer.text,'');assert.equal(answer.status,'processing');
    await globalThis.__lumenTestEnv.DB.prepare('UPDATE runs SET lease_until=0 WHERE id=?').bind(runId).run();const resumed=await call('POST',`sites/${siteId}/runs/${runId}/process`);assert.equal(resumed.data.run.status,'failed');assert.equal(calls,1);
  }finally{finish?.();globalThis.fetch=previous;delete globalThis.__lumenTestEnv.OPENAI_API_KEY;}
});
test('quota reservations are atomic across concurrent callers',async()=>{const {quota}=await import('../lib/product-server.ts');const results=await Promise.allSettled(Array.from({length:8},()=>quota('budget-user','test-budget',2)));assert.equal(results.filter(r=>r.status==='fulfilled').length,2);});
test('traffic ingestion enforces origin boundaries and drops URL query strings',async()=>{
  const info=await call('GET',`sites/${siteId}`),key=info.data.site.trackingKey;
  async function collect(originHeader,page){return route.POST(new Request(`${origin}/api/collect?key=${key}`,{method:'POST',headers:{Origin:originHeader,'Content-Type':'application/json'},body:JSON.stringify({page,referrer:'https://chatgpt.com/c/private-conversation'})}),{params:Promise.resolve({path:['collect']})});}
  const denied=await collect('https://acme.com.attacker.test','https://acme.com.attacker.test/page');assert.equal(denied.status,403);
  const accepted=await collect('https://acme.com','https://acme.com/guides?email=private@example.com');assert.equal(accepted.status,204);assert.equal(accepted.headers.get('Access-Control-Allow-Origin'),'https://acme.com');
  const state=await call('GET',`sites/${siteId}/state`);assert.equal(state.data.traffic.aiVisits,1);assert.equal(state.data.traffic.pages[0].path,'/guides');
});
test('full CSV export streams beyond the displayed evidence limit',async()=>{
  const created=await call('POST','sites',{name:'Bulk',domain:'bulk.example'}),bulk=created.data.site.id;const db=globalThis.__lumenTestEnv.DB;
  for(let r=0;r<35;r++){const runId=crypto.randomUUID(),date=new Date(Date.now()-r*1000).toISOString();await db.prepare('INSERT INTO runs (id,site_id,mode,status,models,total,completed,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(runId,bulk,'live','completed','["gpt-4.1-mini"]',30,30,date,date).run();await db.batch(Array.from({length:30},(_,i)=>db.prepare('INSERT INTO answers (id,site_id,run_id,prompt_id,prompt_text,model,provider,mode,status,text,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),bulk,runId,crypto.randomUUID(),'A bulk question','gpt-4.1-mini','Fixture','live','completed',`evidence-${r*30+i}`,date)));}
  const state=await call('GET',`sites/${bulk}/state`);assert.equal(state.data.answers.length,1000);assert.equal(state.data.dataWindow.totalAnswers,1050);assert.equal(state.data.dataWindow.truncated,true);
  const exported=await call('GET',`sites/${bulk}/export`);assert.equal(exported.response.status,200);assert.equal((exported.data.match(/"evidence-\d+"/g)||[]).length,1050);await call('DELETE',`sites/${bulk}`);
});
test('current cohort is re-evaluated from original evidence after brand changes',async()=>{await call('PATCH',`sites/${siteId}`,{name:'Compare',domain:'newbrand.example'});const state=await call('GET',`sites/${siteId}/state`);const answer=state.data.answers.find(a=>a.providerResponseId==='resp_fixture');assert.equal(answer.mentions[0].mentioned,true);assert.equal(answer.mentions[0].domain,'newbrand.example');});
test('site removal cascades persisted child data',async()=>{const deleted=await call('DELETE',`sites/${siteId}`);assert.equal(deleted.response.status,200);const row=await globalThis.__lumenTestEnv.DB.prepare('SELECT count(*) n FROM prompts WHERE site_id=?').bind(siteId).first();assert.equal(row.n,0);});

test('free-service consent is tenant bound and all generation routes use Gemini without paid fallback',async()=>{
 const e=globalThis.__lumenTestEnv,previous=globalThis.fetch;e.LUMEN_PROVIDER_MODE='free_only';e.GEMINI_API_KEY='fixture-only';e.OPENAI_API_KEY='fixture-paid-must-not-run';let calls=0;
 const eligibility=await import('../app/api/eligibility/route.ts');
 try {
  const made=await call('POST','sites',{name:'Free Fixture',domain:'free.example'});const id=made.data.site.id;
  const blocked=await call('POST',`sites/${id}/assistant`,{message:'Explain the metrics'});assert.equal(blocked.data.code,'eligibility_required');assert.equal(calls,0);
  const before=await e.DB.prepare('SELECT COUNT(*) n FROM ai_usage_reservations').first();
  const bad=await eligibility.POST(new Request(origin+'/api/eligibility',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({adult:false,korea:true,business:true,understandsDataUse:true})}));assert.equal(bad.status,400);
  const accepted=await eligibility.POST(new Request(origin+'/api/eligibility',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({adult:true,korea:true,business:true,understandsDataUse:true})}));assert.equal(accepted.status,200);
  assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM ai_usage_reservations').first()).n,before.n);
  globalThis.__lumenTestHeaders=new Headers({'oai-authenticated-user-id':'different','oai-authenticated-user-email':'different@example.test'});assert.equal((await(await eligibility.GET()).json()).eligible,false);
  globalThis.fetch=async(url,init)=>{calls++;assert.match(url,/^https:\/\/generativelanguage.googleapis.com\//);const body=JSON.parse(init.body);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:body.generationConfig.responseMimeType?JSON.stringify({prompts:[{text:'Which tools help brands?',topic:'Tools',intent:'comparison'}]}):'Fixture draft based on the supplied evidence.'}]}}]});};
  for(const [resource,body] of [['prompts/generate',{count:1}],['documents',{kind:'content',topic:'Brand visibility',format:'article'}],['assistant',{message:'Explain the metrics'}]]){
   const result=await call('POST',`sites/${id}/${resource}`,body);assert.ok([200,201].includes(result.response.status),JSON.stringify(result.data));
  }
  assert.equal(calls,3);
  const paid=await call('POST',`sites/${id}/runs`,{mode:'live',models:['gpt-4.1-mini']});assert.equal(paid.data.code,'paid_provider_disabled');assert.equal(calls,3);
 } finally {e.LUMEN_PROVIDER_MODE='paid_enabled';delete e.GEMINI_API_KEY;delete e.OPENAI_API_KEY;globalThis.fetch=previous;}
});

async function expiryFixture({answers=1,endsAt=Date.now()-3600000,linkByRun=false}={}){
 const db=globalThis.__lumenTestEnv.DB,owner='expiry-'+crypto.randomUUID(),site=crypto.randomUUID(),run=crypto.randomUUID(),schedule=crypto.randomUUID(),execution=linkByRun?crypto.randomUUID():run,at=new Date().toISOString();
 await db.prepare('INSERT INTO sites(id,owner_id,name,domain,tracking_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(site,owner,'Expiry Fixture','expiry.example',crypto.randomUUID(),at,at).run();
 await db.prepare("INSERT INTO runs(id,site_id,mode,status,models,total,created_at) VALUES(?,?,'live','running',?,?,?)").bind(run,site,'["gemini-3.8-flash"]',answers,at).run();
 for(let i=0;i<answers;i++)await db.prepare("INSERT INTO answers(id,site_id,run_id,prompt_id,prompt_text,model,provider,mode,status,created_at) VALUES(?,?,?,?,?,'gemini-3.8-flash','Gemini API','live','pending',?)").bind(crypto.randomUUID(),site,run,crypto.randomUUID(),'A persisted scheduled question '+i,at).run();
 await db.prepare("INSERT INTO collection_schedules(id,owner_id,site_id,name,enabled,frequency,timezone,hour,minute,models,next_run_at,ends_at,created_at,updated_at) VALUES(?,?,?,'Ends at deadline',1,'daily','Asia/Seoul',9,0,?,1,?,?,?)").bind(schedule,owner,site,'["gemini-3.8-flash"]',endsAt,at,at).run();
 await db.prepare("INSERT INTO scheduled_executions(id,owner_id,site_id,schedule_id,schedule_name,scheduled_for,status,run_id,configuration,created_at,updated_at) VALUES(?,?,?,?,'Ends at deadline',1,'running',?,?,?,?)").bind(execution,owner,site,schedule,linkByRun?run:null,'{"models":["gemini-3.8-flash"],"promptIds":null}',at,at).run();
 const {acceptEligibility}=await import('../lib/eligibility.ts');await acceptEligibility(owner);return{owner,site,run,schedule,execution};
}
test('direct resume of an expired scheduled run rejects both execution links before reserving or dispatching',async()=>{
 const e=globalThis.__lumenTestEnv,previous=globalThis.fetch;e.LUMEN_PROVIDER_MODE='free_only';e.GEMINI_API_KEY='fixture-only';let calls=0;globalThis.fetch=async()=>{calls++;throw Error('An expired schedule must not dispatch')};
 try{for(const linkByRun of [false,true]){const f=await expiryFixture({linkByRun});const result=await call('POST',`sites/${f.site}/runs/${f.run}/process`,{},f.owner);assert.equal(result.response.status,409);assert.equal(result.data.code,'schedule_expired');assert.equal((await e.DB.prepare('SELECT count(*) n FROM ai_usage_reservations WHERE owner_id=?').bind(f.owner).first()).n,0);assert.equal((await e.DB.prepare('SELECT status FROM answers WHERE run_id=?').bind(f.run).first()).status,'pending');}assert.equal(calls,0);}
 finally{e.LUMEN_PROVIDER_MODE='paid_enabled';delete e.GEMINI_API_KEY;globalThis.fetch=previous;}
});
test('deadline crossed during a chunk blocks the next dispatch but preserves the in-flight answer',async()=>{
 const e=globalThis.__lumenTestEnv,previous=globalThis.fetch,realNow=Date.now;const start=realNow();e.LUMEN_PROVIDER_MODE='free_only';e.GEMINI_API_KEY='fixture-only';let calls=0;
 try{const f=await expiryFixture({answers:2,endsAt:start+2000,linkByRun:true});globalThis.fetch=async(url)=>{assert.match(url,/^https:\/\/generativelanguage.googleapis.com\//);calls++;Date.now=()=>start+3000;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'In-flight answer retained after the deadline.'}]}}]});};
  const result=await call('POST',`sites/${f.site}/runs/${f.run}/process`,{},f.owner);assert.equal(result.response.status,200);assert.equal(calls,1);assert.equal(result.data.run.status,'partial');assert.equal(result.data.run.completed,1);assert.equal(result.data.run.failed,1);assert.equal(result.data.answers.find(a=>a.status==='completed').text,'In-flight answer retained after the deadline.');assert.match(result.data.answers.find(a=>a.status==='failed').error,/종료 시각/);assert.equal((await e.DB.prepare('SELECT units FROM ai_usage_reservations WHERE owner_id=?').bind(f.owner).first()).units,2);
 }finally{Date.now=realNow;e.LUMEN_PROVIDER_MODE='paid_enabled';delete e.GEMINI_API_KEY;globalThis.fetch=previous;}
});

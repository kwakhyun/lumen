import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync, chmodSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Miniflare } from 'miniflare';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env=globalThis.__backupTestEnv;', shortCircuit: true };
  if (specifier === 'next/headers') return { url: 'data:text/javascript,export async function headers(){return globalThis.__backupTestHeaders;}', shortCircuit: true };
  if (specifier === 'next/navigation') return { url: 'data:text/javascript,export function redirect(){throw new Error("redirect");}', shortCircuit: true };
  if (specifier.startsWith('@/')) { const base = path.join(root, specifier.slice(2)); for (const suffix of ['.ts', '/index.ts']) if (existsSync(base + suffix)) return { url: pathToFileURL(base + suffix).href, shortCircuit: true }; }
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) { const base = fileURLToPath(new URL(specifier, context.parentURL)); if (existsSync(base + '.ts')) return { url: pathToFileURL(base + '.ts').href, shortCircuit: true }; }
  return next(specifier, context);
} });
const format = await import('../lib/backup-format.ts');
const { restoreToEmptyDatabase, RESTORE_OWNER } = await import('../lib/backup-restore.ts');
let mf, db, route, exported;
const ids = Object.fromEntries(['site','other','prompt','deletedPrompt','run','pendingRun','answer','pendingAnswer','document','task','persona','traffic','competitor','schedule','alert','audit'].map(key => [key,crypto.randomUUID()]));
const at = '2026-10-18T09:00:00.000Z';
globalThis.__backupTestEnv = {};
globalThis.__backupTestHeaders = new Headers();
async function migrate(target) { for (const file of readdirSync(path.join(root, 'drizzle')).filter(f => f.endsWith('.sql')).sort()) for (const statement of readFileSync(path.join(root, 'drizzle', file), 'utf8').split('--> statement-breakpoint').filter(s => s.trim())) await target.prepare(statement).run(); }
async function insert(table, row) { const keys = Object.keys(row); return db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).bind(...keys.map(key=>row[key])).run(); }
async function call(siteId=ids.site,user='alice',extra='') { globalThis.__backupTestHeaders=new Headers(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'}:{}); return route.GET(new Request(`https://lumen.test/api/backup?siteId=${siteId}${extra}`)); }
async function resign(input) { const {integrity,...payload}=input; return {...payload,integrity:{algorithm:'SHA-256',digest:await format.sha256(format.canonicalJson(payload))}}; }
before(async()=>{
  mf = new Miniflare({ modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'backup-source',RESTORE:'backup-target'} });
  db = await mf.getD1Database('DB'); globalThis.__backupTestEnv.DB=db; await migrate(db);
  route = await import('../app/api/backup/route.ts');
  for(const [id,owner,name] of [[ids.site,'alice','generation-0'],[ids.other,'bob','private-other-tenant']]) await insert('sites',{id,owner_id:owner,name,domain:owner+'.example',tracking_key:'secret_tracking_'+owner,mode:'live',created_at:at,updated_at:at});
  await insert('prompts',{id:ids.prompt,site_id:ids.site,text:'Private question',created_at:at});
  await insert('competitors',{id:ids.competitor,site_id:ids.site,name:'Rival',domain:'rival.example',created_at:at});
  await insert('runs',{id:ids.run,site_id:ids.site,mode:'live',status:'completed',models:'["gpt-4.1-mini"]',total:1,completed:1,created_at:at,completed_at:at,lease_token:'secret_run_lease',lease_until:12345});
  await insert('runs',{id:ids.pendingRun,site_id:ids.site,mode:'live',status:'running',models:'["gemini-3.8-flash"]',total:1,created_at:at,lease_token:'secret_running_lease',lease_until:9999999999999});
  await insert('answers',{id:ids.answer,site_id:ids.site,run_id:ids.run,prompt_id:ids.prompt,prompt_text:'Private question',model:'gpt-4.1-mini',provider:'OpenAI API',mode:'live',status:'completed',text:'Private original answer',mentions:JSON.stringify([{id:ids.site,ownerId:'secret_nested_owner',trackingKey:'secret_nested_tracking',description:'secret_nested_description',createdAt:at,name:'Own brand',domain:'alice.example',mentioned:true,firstPosition:0,rank:1,cited:false},{id:ids.competitor,siteId:ids.site,createdAt:at,name:'Rival',domain:'rival.example',mentioned:false,firstPosition:null,rank:null,cited:false}]),created_at:at,completed_at:at});
  await insert('answers',{id:ids.pendingAnswer,site_id:ids.site,run_id:ids.pendingRun,prompt_id:ids.deletedPrompt,prompt_text:'Historical deleted question',model:'gemini-3.8-flash',provider:'Gemini API',mode:'live',status:'processing',created_at:at});
  await insert('documents',{id:ids.document,site_id:ids.site,kind:'content',title:'Evidence',content:'generation-0',mode:'live',created_at:at});
  await insert('tasks',{id:ids.task,site_id:ids.site,title:'Private task',created_at:at,updated_at:at});
  await insert('personas',{id:ids.persona,site_id:ids.site,name:'Researcher',created_at:at});
  await insert('traffic',{id:ids.traffic,site_id:ids.site,day:'2026-10-17',source:'ChatGPT',path:'/',visits:2});
  await insert('collection_schedules',{id:ids.schedule,owner_id:'alice',site_id:ids.site,name:'Daily',enabled:1,frequency:'daily',timezone:'Asia/Seoul',hour:9,minute:0,models:'["gemini-3.8-flash"]',prompt_ids:JSON.stringify([ids.prompt]),next_run_at:1,created_at:at,updated_at:at});
  await insert('scheduled_executions',{id:ids.pendingRun,owner_id:'alice',site_id:ids.site,schedule_id:ids.schedule,schedule_name:'Daily',scheduled_for:1,status:'running',run_id:ids.pendingRun,configuration:JSON.stringify({models:['gemini-3.8-flash'],promptIds:[ids.prompt]}),total:1,lease_token:'secret_execution_lease',lease_until:9999999999999,created_at:at,updated_at:at});
  await insert('operation_alerts',{id:ids.alert,owner_id:'alice',site_id:ids.site,execution_id:ids.pendingRun,dedupe_key:'secret_not_exported_dedupe',severity:'warning',code:'collection',title:'Check',message:'Check execution',created_at:at,updated_at:at});
  await insert('operation_audit',{id:ids.audit,owner_id:'alice',site_id:ids.site,action:'schedule_created',subject_id:ids.schedule,summary:'Created',created_at:at});
  await insert('ga4_connections',{site_id:ids.site,owner_id:'alice',refresh_cipher:'secret_refresh_cipher',access_cipher:'secret_access_cipher',status:'connected',property_id:'559446838',property_name:'Lumen',report:JSON.stringify({startDate:'2026-09-18',endDate:'2026-10-17',totalSessions:0,totalUsers:0,totalViews:0,aiSessions:0,rows:[],dataQuality:{subjectToThresholding:false,dataLossFromOtherRow:false,sampled:false},timeZone:'Asia/Seoul'}),last_synced_at:at,lease_token:'secret_ga4_lease',created_at:at,updated_at:at});
  await insert('ai_eligibility',{owner_id:'alice',version:'secret_eligibility_version',accepted_at:at});
  await insert('quotas',{id:'secret_quota',count:1,expires_at:123});
  await insert('ai_usage_buckets',{id:'secret_usage',count:1,expires_at:123});
  await insert('ai_usage_reservations',{id:'secret_reservation',owner_id:'alice',operation:'private',units:1,claim_token:'secret_claim',created_at:at});
  await insert('oauth_states',{state_hash:'secret_state',owner_id:'alice',site_id:ids.site,verifier_cipher:'secret_verifier',redirect_uri:'https://lumen.test/callback',expires_at:123});
  await insert('operation_heartbeats',{id:'owner:alice',owner_id:'alice',lease_token:'secret_heartbeat'});
});
after(async()=>{await mf?.dispose();});
test('backup requires authenticated owner and rejects scope overrides',async()=>{assert.equal((await call(ids.site,null)).status,401);assert.equal((await call(ids.site,'bob')).status,404);assert.equal((await call(ids.site,'alice','&ownerId=bob')).status,400);assert.equal((await call(ids.site,'alice','&siteId='+ids.other)).status,400);});
test('complete owner snapshot explicitly excludes secrets and has verified digest',async()=>{
  const before = await db.prepare('SELECT count(*) AS n FROM quotas').first();
  const result = await call();assert.equal(result.status,200);assert.match(result.headers.get('Content-Disposition'),/^attachment/);assert.equal(result.headers.get('Cache-Control'),'private, no-store');
  const text=await result.text();assert.doesNotMatch(text,/secret_|private-other-tenant|owner_id|tracking_key|lease_token|refresh_cipher|access_cipher|claim_token|verifier_cipher/);
  exported=await format.validateBackup(JSON.parse(text));assert.equal(Object.keys(exported.tables).length,14);assert.equal(exported.counts.answers,2);assert.equal(exported.tables.answers.find(a=>a.status==='completed').text,'Private original answer');assert.equal((await db.prepare('SELECT count(*) AS n FROM quotas').first()).n,before.n);
});
test('legacy full-brand mentions are projected to metric fields without changing historical values',async()=>{
 const backup=await(await call()).json();const answer=backup.tables.answers.find(a=>a.status==='completed');const mentions=JSON.parse(answer.mentions);
 assert.deepEqual(mentions,[{name:'Own brand',domain:'alice.example',mentioned:true,firstPosition:0,rank:1,cited:false},{name:'Rival',domain:'rival.example',mentioned:false,firstPosition:null,rank:null,cited:false}]);
 const stored=JSON.parse((await db.prepare('SELECT mentions FROM answers WHERE id=?').bind(ids.answer).first()).mentions);assert.equal(stored[0].trackingKey,'secret_nested_tracking');
 const {extractMentions}=await import('../lib/metrics.ts');const future=extractMentions('Own brand',[],[{id:ids.site,ownerId:'secret_future_owner',trackingKey:'secret_future_tracking',name:'Own brand',domain:'alice.example'}]);
 assert.deepEqual(Object.keys(future[0]).sort(),['name','domain','mentioned','firstPosition','rank','cited'].sort());assert.doesNotMatch(JSON.stringify(future),/secret_|trackingKey|ownerId/);
 const hostile=structuredClone(backup);hostile.tables.answers.find(a=>a.status==='completed').mentions=JSON.stringify([{...mentions[0],ownerId:'secret_import_injection'}]);await assert.rejects(format.validateBackup(await resign(hostile)),e=>e.code==='backup_invalid');
});
test('invalid stored mention values fail with code/path diagnostics only',async()=>{
 const original=(await db.prepare('SELECT mentions FROM answers WHERE id=?').bind(ids.answer).first()).mentions;
 try{for(const invalid of ['secret_malformed_json',JSON.stringify(['secret_invalid_scalar']),JSON.stringify([{name:'secret_invalid_value',domain:'alice.example',mentioned:'secret_invalid_boolean',firstPosition:null,rank:null,cited:false,trackingKey:'secret_do_not_return'}])]){await db.prepare('UPDATE answers SET mentions=? WHERE id=?').bind(invalid,ids.answer).run();
 const response=await call();assert.equal(response.status,400);const error=await response.json();assert.equal(error.code,'backup_invalid');assert.ok(error.issues.some(issue=>issue.path.at(-1)==='mentions'));assert.ok(error.issues.every(issue=>Object.keys(issue).sort().join(',')==='code,path'));assert.doesNotMatch(JSON.stringify(error),/secret_|trackingKey|ownerId/);
 }}finally{await db.prepare('UPDATE answers SET mentions=? WHERE id=?').bind(original,ids.answer).run();}
});
test('snapshot batch sees parent and content from one transaction during concurrent writes',async()=>{
  for(let n=1;n<=5;n++){
    const write=db.batch([db.prepare('UPDATE sites SET name=? WHERE id=?').bind('generation-'+n,ids.site),db.prepare('UPDATE documents SET content=? WHERE id=?').bind('generation-'+n,ids.document)]);
    const read=call().then(r=>r.json());const [,backup]=await Promise.all([write,read]);assert.equal(backup.tables.sites[0].name,backup.tables.documents[0].content);
  }
});
test('invalid digest, extra credential fields, missing rows and foreign parents fail validation',async()=>{
  const tampered=structuredClone(exported);tampered.tables.sites[0].name='Changed';await assert.rejects(format.validateBackup(tampered),e=>e.code==='backup_digest_mismatch');
  const extra=structuredClone(exported);extra.tables.ga4_connections[0].access_cipher='secret';await assert.rejects(format.validateBackup(await resign(extra)),e=>e.code==='backup_invalid');
  const missing=structuredClone(exported);missing.tables.answers.pop();missing.counts.answers--;await assert.rejects(format.validateBackup(await resign(missing)),/count is incomplete/);
  const cross=structuredClone(exported);cross.tables.tasks[0].site_id=ids.other;await assert.rejects(format.validateBackup(await resign(cross)),/workspace boundary/);
  const foreign=structuredClone(exported);foreign.tables.answers[0].run_id=crypto.randomUUID();await assert.rejects(format.validateBackup(await resign(foreign)),/parent run/);
});
test('restore creates non-executable copy, remaps shared and deleted-question IDs, preserves all data',async()=>{
  const target=await mf.getD1Database('RESTORE');await migrate(target);const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('No external requests allowed')};
  try {const summary=await restoreToEmptyDatabase(target,exported);assert.equal(summary.foreignKeyViolations,0);assert.equal(summary.integrity,'ok');assert.equal(summary.stoppedAnswers,1);assert.equal(summary.stoppedExecutions,1);assert.equal(summary.externalCalls,0);
    const site=await target.prepare('SELECT * FROM sites').first();assert.notEqual(site.id,ids.site);assert.equal(site.owner_id,RESTORE_OWNER);assert.notEqual(site.tracking_key,'secret_tracking_alice');
    const schedule=await target.prepare('SELECT * FROM collection_schedules').first();assert.equal(schedule.enabled,0);
    const execution=await target.prepare('SELECT * FROM scheduled_executions').first();assert.equal(execution.id,execution.run_id);assert.notEqual(execution.id,ids.pendingRun);assert.equal(execution.status,'cancelled');assert.equal(execution.lease_token,null);
    assert.equal((await target.prepare("SELECT count(*) AS n FROM runs WHERE status IN ('queued','running')").first()).n,0);
    const ga4=await target.prepare('SELECT * FROM ga4_connections').first();assert.equal(ga4.status,'disconnected');assert.equal(ga4.refresh_cipher,null);assert.equal(JSON.parse(ga4.report).timeZone,'Asia/Seoul');
    assert.equal((await target.prepare('SELECT count(*) AS n FROM ai_usage_reservations').first()).n,0);
    await assert.rejects(restoreToEmptyDatabase(target,exported),e=>e.code==='restore_target_not_empty');
  }finally{globalThis.fetch=originalFetch;}
});
test('row and byte overflow return errors with no attachment or partial backup',async()=>{
  const rows=Array.from({length:101},()=>({id:crypto.randomUUID(),site_id:ids.site,name:'Extra',created_at:at}));
  for(const row of rows)await insert('personas',row);
  const overRows=await call();assert.equal(overRows.status,413);assert.equal(overRows.headers.get('Content-Disposition'),null);assert.equal((await overRows.json()).code,'backup_too_large');
  await db.prepare('DELETE FROM personas WHERE id<>?').bind(ids.persona).run();
  await db.prepare('UPDATE documents SET content=? WHERE id=?').bind('x'.repeat(600000),ids.document).run();
  const extra=crypto.randomUUID();await insert('documents',{id:extra,site_id:ids.site,kind:'content',title:'Large',content:'x'.repeat(600000),mode:'live',created_at:at});
  const overBytes=await call();assert.equal(overBytes.status,413);assert.equal((await overBytes.json()).code,'backup_too_large');
  await db.prepare('DELETE FROM documents WHERE id=?').bind(extra).run();await db.prepare('UPDATE documents SET content=? WHERE id=?').bind('generation-5',ids.document).run();
});
test('local CLI creates private persisted D1 and prints only count/digest verification',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'lumen-backup-test-')),input=path.join(dir,'backup.json'),output=path.join(dir,'restore');
  try{writeFileSync(input,JSON.stringify(exported),{mode:0o600});const result=await promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/verify-backup.mjs','--input',input,'--output',output],{cwd:root,timeout:60000});const summary=JSON.parse(result.stdout);assert.equal(summary.integrity,'ok');assert.equal(summary.sourceDigest,exported.integrity.digest);assert.doesNotMatch(result.stdout,/Private|secret_|prompt_text|owner_id/);assert.equal(statSync(output).mode&0o777,0o700);assert.equal(statSync(path.join(output,'verification.json')).mode&0o777,0o600);
    await assert.rejects(promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/verify-backup.mjs','--input',input,'--output',output],{cwd:root,timeout:60000}),error=>error.stderr.includes('restore_target_exists'));
    chmodSync(input,0o644);await assert.rejects(promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/verify-backup.mjs','--input',input,'--output',path.join(dir,'unsafe')],{cwd:root,timeout:60000}),error=>error.stderr.includes('backup_permissions'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

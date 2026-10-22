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
const { impactBaselineQueryKey:baselineQueryKey } = await import('../lib/impact-baseline-integrity.ts');
const { impactCheckDigest } = await import('../lib/impact-check-integrity.ts');
const { securityEvidenceDigest } = await import('../lib/security-integrity.ts');
let mf, db, route, exported;
const ids = Object.fromEntries(['site','other','prompt','deletedPrompt','run','pendingRun','followupRun','otherRun','answer','pendingAnswer','followupAnswer','document','task','persona','traffic','competitor','schedule','alert','audit','experiment','otherExperiment','study','search','outcome','baseline','check','security','treatmentQuery','controlQuery'].map(key => [key,crypto.randomUUID()]));
const at = '2026-10-18T09:00:00.000Z';
globalThis.__backupTestEnv = {};
globalThis.__backupTestHeaders = new Headers();
async function migrate(target) { for (const file of readdirSync(path.join(root, 'drizzle')).filter(f => f.endsWith('.sql')).sort()) for (const statement of readFileSync(path.join(root, 'drizzle', file), 'utf8').split('--> statement-breakpoint').filter(s => s.trim())) await target.prepare(statement).run(); }
async function insert(table, row) { const keys = Object.keys(row); return db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).bind(...keys.map(key=>row[key])).run(); }
async function call(siteId=ids.site,user='alice',extra='') { globalThis.__backupTestHeaders=new Headers(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'}:{}); return route.GET(new Request(`https://lumen.test/api/backup?siteId=${siteId}${extra}`)); }
async function resign(input) { const {integrity,...payload}=input; return {...payload,integrity:{algorithm:'SHA-256',digest:await format.sha256(format.canonicalJson(payload))}}; }
async function historicalCopy(input, version) { const copy=structuredClone(input);copy.version=version;copy.schemaMigrations=structuredClone(version===1?format.LEGACY_BACKUP_MIGRATIONS:version===2?format.V2_BACKUP_MIGRATIONS:version===3?format.V3_BACKUP_MIGRATIONS:version===4?format.V4_BACKUP_MIGRATIONS:format.V5_BACKUP_MIGRATIONS);const names=version===1?format.LEGACY_BACKUP_TABLE_NAMES:version===2?format.V2_BACKUP_TABLE_NAMES:version===3?format.V3_BACKUP_TABLE_NAMES:version===4?format.V4_BACKUP_TABLE_NAMES:format.V5_BACKUP_TABLE_NAMES;for(const name of Object.keys(copy.tables))if(!names.includes(name)){delete copy.tables[name];delete copy.counts[name];}return resign(copy); }
const legacyCopy=input=>historicalCopy(input,1);
const impactPlan = {title:'Content evidence fixture',hypothesis:'Clear comparison information may increase search citations.',changeSummary:'Explain product limits on the treatment page.',changedAt:'2026-10-03T00:00:00.000Z',contentVersion:'fixture-v1',beforeStart:'2026-10-01',beforeEnd:'2026-10-02',afterStart:'2026-10-04',afterEnd:'2026-10-05',context:{surface:'ChatGPT search',model:'observed version',language:'ko',country:'KR',device:'desktop',personalization:'signed out'},queries:[{id:ids.treatmentQuery,question:'Which comparison tool fits a small team?',arm:'treatment',pageUrl:'https://alice.example/comparison'},{id:ids.controlQuery,question:'How to choose a monitoring tool for teams?',arm:'control',pageUrl:'https://alice.example/monitoring'}],repetitions:1,currency:'KRW',outcomeDefinition:'Sessions with at least one completed purchase',attributionRule:'Same AI referral sources, landing pages in each arm, UTC'};
const impactObservation={phase:'before',queryId:ids.treatmentQuery,repetition:1,observedAt:'2026-10-01T01:00:00.000Z',result:'answer',searchConfirmed:true,answerExcerpt:'A synthetic test excerpt.',brandMention:'absent',citationReview:'complete',evidenceUrl:'https://example.com/fixture',citations:[{url:'https://alice.example/comparison',title:'Follow-up result',relation:'followup_search'}],notes:'Local fixture only'};
const impactOutcome={arm:'treatment',phase:'before',source:'ga4_export',sourceId:'fixture-property',reportTimeZone:'UTC',definitionConfirmed:true,sourceRef:'fixture-export',rangeStart:'2026-10-01',rangeEnd:'2026-10-02',sessions:100,convertingSessions:2,orders:null,revenueMinor:null,currency:'KRW',notes:'Local fixture only',confounders:''};
const impactBaseline={source:'ga4_api',metricVersion:'ga4-baseline-v1',propertyId:'559446838',propertyName:'Own property',fetchedAt:at,requestedStartDate:'2026-10-01',requestedEndDate:'2026-10-02',startDate:'2026-10-01',endDate:'2026-10-02',timeZone:'Asia/Seoul',hostName:'alice.example',totalSessions:12,aiSessions:2,totalViews:18,convertingSessions:null,orders:null,revenueMinor:null,sourcePattern:'chatgpt|perplexity',scope:'tracked_site_sessions',completeForPlan:false,dataQuality:{subjectToThresholding:false,dataLossFromOtherRow:false,sampled:false,truncated:false,emptyReasons:[]},notes:['Local fixture only; does not establish purchase measurement.']};
const checkPayload=baselineDigest=>{const {phase,...observation}=impactObservation;return {label:'Post-publication fixture',publishedAt:'2026-10-01T02:00:00.000Z',deploymentRef:'fixture-deployment-v1',contentVersion:'fixture-content-v2',changes:'Clarify the product limits before the planned intervention.',changedUrls:['https://alice.example/comparison'],context:{...impactPlan.context},indexingStatus:'unconfirmed',indexingEvidence:'',observations:[{...observation,baselineDigest,observedAt:'2026-10-01T03:00:00.000Z',answerExcerpt:'Synthetic immediate observation, outside the planned after window.'}]};};
const securityEvidence = {schemaVersion:1,collector:'lumen-public-web/1',targetOrigin:'https://alice.example',observedAt:at,authorization:'owner_or_authorized',home:{status:null,error:'tls_or_network',bodyComplete:false,contentType:'unknown',headers:null,cookies:null,html:null},robots:{status:403,error:null,bodyComplete:false,rules:{Googlebot:'unknown',bingbot:'unknown','OAI-SearchBot':'unknown',PerplexityBot:'unknown'}},sitemap:{status:404,error:null,bodyComplete:false,format:'unknown',sameOriginUrls:0,otherOriginUrls:0}};
const experimentSnapshot = {version:'lumen-experiment-v1',mode:'live',brands:[{name:'Own brand',domain:'alice.example'}],cells:[{question:'Private question',model:'gpt-4.1-mini',provider:'OpenAI API',status:'completed',mentioned:true,cited:false}],capturedAt:at};
before(async()=>{
  mf = new Miniflare({ modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'backup-source',RESTORE:'backup-target',DOMAIN_CHANGE:'backup-domain-target'} });
  db = await mf.getD1Database('DB'); globalThis.__backupTestEnv.DB=db; await migrate(db);
  route = await import('../app/api/backup/route.ts');
  for(const [id,owner,name] of [[ids.site,'alice','generation-0'],[ids.other,'bob','private-other-tenant']]) await insert('sites',{id,owner_id:owner,name,domain:owner+'.example',tracking_key:'secret_tracking_'+owner,mode:'live',created_at:at,updated_at:at});
  await insert('prompts',{id:ids.prompt,site_id:ids.site,text:'Private question',created_at:at});
  await insert('competitors',{id:ids.competitor,site_id:ids.site,name:'Rival',domain:'rival.example',created_at:at});
  await insert('runs',{id:ids.run,site_id:ids.site,mode:'live',status:'completed',models:'["gpt-4.1-mini"]',total:1,completed:1,created_at:at,completed_at:at,lease_token:'secret_run_lease',lease_until:12345});
  await insert('runs',{id:ids.pendingRun,site_id:ids.site,mode:'live',status:'running',models:'["gemini-3.8-flash"]',total:1,created_at:at,lease_token:'secret_running_lease',lease_until:9999999999999});
  await insert('runs',{id:ids.followupRun,site_id:ids.site,mode:'live',status:'completed',models:'["gpt-4.1-mini"]',total:1,completed:1,created_at:at,completed_at:at});
  await insert('runs',{id:ids.otherRun,site_id:ids.other,mode:'live',status:'completed',models:'["gpt-4.1-mini"]',total:0,created_at:at,completed_at:at});
  await insert('answers',{id:ids.answer,site_id:ids.site,run_id:ids.run,prompt_id:ids.prompt,prompt_text:'Private question',model:'gpt-4.1-mini',provider:'OpenAI API',mode:'live',status:'completed',text:'Private original answer',mentions:JSON.stringify([{id:ids.site,ownerId:'secret_nested_owner',trackingKey:'secret_nested_tracking',description:'secret_nested_description',createdAt:at,name:'Own brand',domain:'alice.example',mentioned:true,firstPosition:0,rank:1,cited:false},{id:ids.competitor,siteId:ids.site,createdAt:at,name:'Rival',domain:'rival.example',mentioned:false,firstPosition:null,rank:null,cited:false}]),created_at:at,completed_at:at});
  await insert('answers',{id:ids.pendingAnswer,site_id:ids.site,run_id:ids.pendingRun,prompt_id:ids.deletedPrompt,prompt_text:'Historical deleted question',model:'gemini-3.8-flash',provider:'Gemini API',mode:'live',status:'processing',created_at:at});
  await insert('answers',{id:ids.followupAnswer,site_id:ids.site,run_id:ids.followupRun,prompt_id:ids.prompt,prompt_text:'Private question',model:'gpt-4.1-mini',provider:'OpenAI API',mode:'live',status:'completed',text:'Private follow-up answer',created_at:at,completed_at:at});
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
  await insert('operation_ticks',{id:'secret_runtime_tick',owner_id:'alice',entry_point:'secret_runtime_entry',status:'completed',started_at:at,finished_at:at});
  await insert('improvement_experiments',{id:ids.experiment,site_id:ids.site,title:'Evidence comparison',hypothesis:'A direct answer improves citations.',intervention:'Publish the direct answer.',metric:'citationRate',target_delta:10,status:'reviewed',baseline_run_id:ids.run,followup_run_id:ids.followupRun,baseline_snapshot:JSON.stringify(experimentSnapshot),followup_snapshot:JSON.stringify({...experimentSnapshot,cells:[{...experimentSnapshot.cells[0],cited:true}]}),notes:'Keep frozen evidence.',created_at:at,updated_at:at});
  await insert('improvement_experiments',{id:ids.otherExperiment,site_id:ids.other,title:'private-other-tenant',hypothesis:'Another private hypothesis.',intervention:'Keep other tenant separate.',metric:'mentionRate',target_delta:5,status:'draft',baseline_run_id:ids.otherRun,baseline_snapshot:JSON.stringify(experimentSnapshot),notes:'private-other-tenant',created_at:at,updated_at:at});
  const {impactDigest}=await import('../lib/impact-integrity.ts'),brand={name:'Own brand',domain:'alice.example'},studyDigest=await impactDigest({metricVersion:'lumen-impact-v1',plan:impactPlan,brand});
  await insert('impact_studies',{id:ids.study,site_id:ids.site,plan:JSON.stringify(impactPlan),brand:JSON.stringify(brand),metric_version:'lumen-impact-v1',created_at:at,digest:studyDigest});
  await insert('impact_searches',{id:ids.search,site_id:ids.site,study_id:ids.study,phase:'before',query_id:ids.treatmentQuery,repetition:1,payload:JSON.stringify(impactObservation),created_at:at,digest:await impactDigest({studyDigest,kind:'add_search',payload:impactObservation})});
  await insert('impact_outcomes',{id:ids.outcome,site_id:ids.site,study_id:ids.study,arm:'treatment',phase:'before',payload:JSON.stringify(impactOutcome),created_at:at,digest:await impactDigest({studyDigest,kind:'add_outcome',payload:impactOutcome})});
  const queryKey=await baselineQueryKey(impactBaseline);
  await insert('impact_baselines',{id:ids.baseline,site_id:ids.site,study_id:ids.study,query_key:queryKey,payload:JSON.stringify(impactBaseline),created_at:at,digest:await impactDigest({studyDigest,kind:'ga4_baseline',queryKey,payload:impactBaseline})});
  const payload=checkPayload(await impactDigest({studyDigest,kind:'add_search',payload:impactObservation}));
  await insert('impact_checks',{id:ids.check,site_id:ids.site,study_id:ids.study,payload:JSON.stringify(payload),created_at:at,digest:await impactCheckDigest(studyDigest,payload)});
  await insert('security_checks',{id:ids.security,site_id:ids.site,evidence:JSON.stringify(securityEvidence),created_at:at,digest:await securityEvidenceDigest(securityEvidence)});
});
after(async()=>{await mf?.dispose();});
test('backup requires authenticated owner and rejects scope overrides',async()=>{assert.equal((await call(ids.site,null)).status,401);assert.equal((await call(ids.site,'bob')).status,404);assert.equal((await call(ids.site,'alice','&ownerId=bob')).status,400);assert.equal((await call(ids.site,'alice','&siteId='+ids.other)).status,400);});
test('complete owner snapshot explicitly excludes secrets and has verified digest',async()=>{
  const before = await db.prepare('SELECT count(*) AS n FROM quotas').first();
  const result = await call();assert.equal(result.status,200);assert.match(result.headers.get('Content-Disposition'),/^attachment/);assert.equal(result.headers.get('Cache-Control'),'private, no-store');
  const text=await result.text();assert.doesNotMatch(text,/secret_|private-other-tenant|owner_id|tracking_key|lease_token|refresh_cipher|access_cipher|claim_token|verifier_cipher/);
  exported=await format.validateBackup(JSON.parse(text));assert.equal(exported.version,6);assert.equal(Object.keys(exported.tables).length,21);assert.equal(exported.counts.security_checks,1);assert.equal(exported.counts.answers,3);assert.equal(exported.counts.improvement_experiments,1);assert.equal(exported.counts.impact_baselines,1);assert.equal(exported.counts.impact_checks,1);assert.equal(exported.tables.answers.find(a=>a.id===ids.answer).text,'Private original answer');assert.equal((await db.prepare('SELECT count(*) AS n FROM quotas').first()).n,before.n);
});
test('legacy full-brand mentions are projected to metric fields without changing historical values',async()=>{
 const backup=await(await call()).json();const answer=backup.tables.answers.find(a=>a.id===ids.answer);const mentions=JSON.parse(answer.mentions);
 assert.deepEqual(mentions,[{name:'Own brand',domain:'alice.example',mentioned:true,firstPosition:0,rank:1,cited:false},{name:'Rival',domain:'rival.example',mentioned:false,firstPosition:null,rank:null,cited:false}]);
 const stored=JSON.parse((await db.prepare('SELECT mentions FROM answers WHERE id=?').bind(ids.answer).first()).mentions);assert.equal(stored[0].trackingKey,'secret_nested_tracking');
 const {extractMentions}=await import('../lib/metrics.ts');const future=extractMentions('Own brand',[],[{id:ids.site,ownerId:'secret_future_owner',trackingKey:'secret_future_tracking',name:'Own brand',domain:'alice.example'}]);
 assert.deepEqual(Object.keys(future[0]).sort(),['name','domain','mentioned','firstPosition','rank','cited'].sort());assert.doesNotMatch(JSON.stringify(future),/secret_|trackingKey|ownerId/);
 const hostile=structuredClone(backup);hostile.tables.answers.find(a=>a.id===ids.answer).mentions=JSON.stringify([{...mentions[0],ownerId:'secret_import_injection'}]);await assert.rejects(format.validateBackup(await resign(hostile)),e=>e.code==='backup_invalid');
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
test('V1 keeps its exact historical envelope and manifest while unsupported schema prefixes fail',async()=>{
  const legacy=await legacyCopy(exported),before=format.canonicalJson(legacy);const validated=await format.validateBackup(legacy);
  assert.equal(format.canonicalJson(validated),before);assert.equal(validated.version,1);assert.equal(validated.tables.improvement_experiments,undefined);assert.equal(validated.schemaMigrations.length,3);
  for(const change of [
    value=>{value.schemaMigrations.pop();},
    value=>{value.schemaMigrations[0].sha256='0'.repeat(64);},
    value=>{value.schemaMigrations.reverse();},
    value=>{value.schemaMigrations.push({name:'9999_untrusted.sql',sha256:'0'.repeat(64)});},
    value=>{value.tables.improvement_experiments=[];value.counts.improvement_experiments=0;},
    value=>{value.version=7;},
  ]) {const invalid=structuredClone(legacy);change(invalid);await assert.rejects(format.validateBackup(await resign(invalid)),e=>['backup_invalid','backup_schema_unsupported'].includes(e.code));}
  const omitted=structuredClone(exported);delete omitted.tables.improvement_experiments;delete omitted.counts.improvement_experiments;await assert.rejects(format.validateBackup(await resign(omitted)),e=>e.code==='backup_invalid');
  const wrongCurrent=structuredClone(exported);wrongCurrent.schemaMigrations=structuredClone(format.LEGACY_BACKUP_MIGRATIONS);await assert.rejects(format.validateBackup(await resign(wrongCurrent)),e=>['backup_invalid','backup_schema_unsupported'].includes(e.code));
});
test('experiment snapshot allowlist, run references and frozen cohort are validated',async()=>{
  const rejectedChanges=[
    row=>{row.baseline_run_id=ids.otherRun;},
    row=>{row.followup_run_id=crypto.randomUUID();},
    row=>{row.followup_run_id=null;},
    row=>{row.followup_snapshot=null;row.followup_run_id=null;},
    row=>{row.target_delta=101;},
    row=>{const snapshot=JSON.parse(row.baseline_snapshot);snapshot.cells[0].prompt_id=ids.prompt;row.baseline_snapshot=JSON.stringify(snapshot);},
    row=>{const snapshot=JSON.parse(row.baseline_snapshot);snapshot.access_cipher='secret_never_allowed';row.baseline_snapshot=JSON.stringify(snapshot);},
    row=>{const snapshot=JSON.parse(row.baseline_snapshot);snapshot.cells.push(snapshot.cells[0]);row.baseline_snapshot=JSON.stringify(snapshot);},
    row=>{const snapshot=JSON.parse(row.baseline_snapshot);snapshot.mode='demo';row.baseline_snapshot=JSON.stringify(snapshot);},
    row=>{const snapshot=JSON.parse(row.followup_snapshot);snapshot.brands[0].domain='changed.example';row.followup_snapshot=JSON.stringify(snapshot);},
    row=>{const snapshot=JSON.parse(row.followup_snapshot);snapshot.cells[0].provider='Different provider';row.followup_snapshot=JSON.stringify(snapshot);},
  ];
  for(const change of rejectedChanges){const invalid=structuredClone(exported);change(invalid.tables.improvement_experiments[0]);await assert.rejects(format.validateBackup(await resign(invalid)),e=>e.code==='backup_invalid');}
  for(const status of ['draft','observing']){const reopened=structuredClone(exported);reopened.tables.improvement_experiments[0].status=status;assert.equal((await format.validateBackup(await resign(reopened))).tables.improvement_experiments[0].status,status);}
});
test('V2 exact historical envelope remains supported and gains no impact rows',async()=>{
  const copy=await historicalCopy(exported,2),original=format.canonicalJson(copy);
  assert.equal(format.canonicalJson(await format.validateBackup(copy)),original);
  assert.equal(copy.schemaMigrations.length,4);assert.equal(copy.tables.impact_studies,undefined);
  const invalid=structuredClone(copy);invalid.tables.impact_studies=[];invalid.counts.impact_studies=0;
  await assert.rejects(format.validateBackup(await resign(invalid)),e=>e.code==='backup_invalid');
});
test('V3 keeps its historical evidence envelope and migration checksums without baseline rows',async()=>{
  const copy=await historicalCopy(exported,3),original=format.canonicalJson(copy);
  assert.equal(format.canonicalJson(await format.validateBackup(copy)),original);
  assert.equal(copy.schemaMigrations.length,5);assert.equal(Object.keys(copy.tables).length,18);assert.equal(copy.tables.impact_baselines,undefined);
  assert.equal(copy.tables.impact_studies[0].digest,exported.tables.impact_studies[0].digest);
  for(const mutate of [
    value=>{value.tables.impact_baselines=[];value.counts.impact_baselines=0;},
    value=>{value.schemaMigrations.push(format.BACKUP_MIGRATIONS.at(-1));},
    value=>{value.schemaMigrations[4].sha256='0'.repeat(64);},
  ]){const invalid=structuredClone(copy);mutate(invalid);await assert.rejects(format.validateBackup(await resign(invalid)),e=>['backup_invalid','backup_schema_unsupported'].includes(e.code));}
});
test('V4 remains exact and never acquires deployment-check records or later migrations',async()=>{
  const copy=await historicalCopy(exported,4),original=format.canonicalJson(copy);
  assert.equal(format.canonicalJson(await format.validateBackup(copy)),original);
  assert.equal(copy.schemaMigrations.length,6);assert.equal(Object.keys(copy.tables).length,19);assert.equal(copy.tables.impact_checks,undefined);assert.equal(copy.counts.impact_baselines,1);
  for(const mutate of [
    value=>{value.tables.impact_checks=[];value.counts.impact_checks=0;},
    value=>{value.schemaMigrations.push(format.BACKUP_MIGRATIONS.at(-1));},
    value=>{value.schemaMigrations[5].sha256='0'.repeat(64);},
  ]){const invalid=structuredClone(copy);mutate(invalid);await assert.rejects(format.validateBackup(await resign(invalid)),e=>['backup_invalid','backup_schema_unsupported'].includes(e.code));}
});
test('V5 retains its exact historical tables, manifest and original digest',async()=>{
  const copy=await historicalCopy(exported,5),original=format.canonicalJson(copy);
  assert.equal(format.canonicalJson(await format.validateBackup(copy)),original);assert.equal(copy.schemaMigrations.length,7);assert.equal(Object.keys(copy.tables).length,20);assert.equal(copy.tables.security_checks,undefined);
  for(const mutate of [value=>{value.tables.security_checks=[];value.counts.security_checks=0;},value=>{value.schemaMigrations.push(format.BACKUP_MIGRATIONS.at(-1));}]){const invalid=structuredClone(copy);mutate(invalid);await assert.rejects(format.validateBackup(await resign(invalid)),e=>['backup_invalid','backup_schema_unsupported'].includes(e.code));}
});
test('V6 security evidence checks chronology, integrity and strict fact allowlists',async()=>{
  for(const mutate of [row=>{row.digest='0'.repeat(64);},row=>{row.created_at='2026-10-18T08:59:59.000Z';},row=>{row.site_id=ids.other;},row=>{row.raw_headers='secret';},row=>{const evidence=JSON.parse(row.evidence);evidence.raw_body='secret';row.evidence=JSON.stringify(evidence);},row=>{const evidence=JSON.parse(row.evidence);evidence.targetOrigin='https://www.alice.example';row.evidence=JSON.stringify(evidence);},row=>{const evidence=JSON.parse(row.evidence);evidence.observedAt='2099-01-01T00:00:00Z';row.evidence=JSON.stringify(evidence);},row=>{const evidence=JSON.parse(row.evidence);evidence.robots.rules.Googlebot='allowed';row.evidence=JSON.stringify(evidence);}]){const copy=structuredClone(exported);mutate(copy.tables.security_checks[0]);await assert.rejects(format.validateBackup(await resign(copy)),e=>e.code==='backup_invalid');}
  const changed=structuredClone(exported);const row=changed.tables.security_checks[0],evidence=JSON.parse(row.evidence);evidence.home.error='dns_failed';row.evidence=JSON.stringify(evidence);await assert.rejects(format.validateBackup(await resign(changed)),e=>e.code==='backup_invalid');
  const excessive=structuredClone(exported);excessive.tables.security_checks=Array.from({length:21},()=>({...excessive.tables.security_checks[0],id:crypto.randomUUID()}));excessive.counts.security_checks=21;await assert.rejects(format.validateBackup(await resign(excessive)),e=>e.code==='backup_invalid');
});
test('historical security origins survive an owned brand domain edit, export and isolated restore',async()=>{
  const previous=(await db.prepare('SELECT domain FROM sites WHERE id=?').bind(ids.site).first()).domain;
  try {
    await db.prepare('UPDATE sites SET domain=? WHERE id=?').bind('new.alice.example',ids.site).run();
    const response=await call();assert.equal(response.status,200);const backup=await format.validateBackup(await response.json());
    assert.equal(backup.tables.sites[0].domain,'new.alice.example');assert.equal(JSON.parse(backup.tables.security_checks[0].evidence).targetOrigin,'https://alice.example');
    const target=await mf.getD1Database('DOMAIN_CHANGE');await migrate(target);const summary=await restoreToEmptyDatabase(target,backup);assert.equal(summary.integrity,'ok');assert.equal(summary.counts.security_checks,1);assert.equal((await target.prepare('SELECT domain FROM sites').first()).domain,'new.alice.example');
    assert.equal(JSON.parse((await target.prepare('SELECT evidence FROM security_checks').first()).evidence).targetOrigin,'https://alice.example');
  } finally {await db.prepare('UPDATE sites SET domain=? WHERE id=?').bind(previous,ids.site).run();}
});
test('V5 check references and chronology reject invalid records even with recomputed content hashes',async()=>{
  const changes=[
    p=>{p.observations[0].baselineDigest='0'.repeat(64);},
    p=>{p.observations[0].queryId=ids.controlQuery;},
    p=>{p.observations[0].repetition=2;},
    p=>{p.publishedAt=impactObservation.observedAt;},
    p=>{p.publishedAt='2026-10-01T00:59:59.000Z';},
    p=>{p.observations[0].observedAt='2026-10-01T01:59:59.000Z';},
    p=>{p.observations[0].observedAt='2026-10-18T09:00:00.001Z';},
    p=>{p.observations[0].phase='after';},
    p=>{p.refresh_cipher='secret_never_export';},
  ];
  for(const change of changes){const copy=structuredClone(exported),row=copy.tables.impact_checks[0],payload=JSON.parse(row.payload);change(payload);row.payload=JSON.stringify(payload);row.digest=await impactCheckDigest(copy.tables.impact_studies[0].digest,payload);await assert.rejects(format.validateBackup(await resign(copy)),e=>e.code==='backup_invalid');}
  const missing=structuredClone(exported);missing.tables.impact_checks[0].study_id=crypto.randomUUID();await assert.rejects(format.validateBackup(await resign(missing)),e=>e.code==='backup_invalid');
  const tampered=structuredClone(exported),row=tampered.tables.impact_checks[0],payload=JSON.parse(row.payload);payload.changes='Content was modified without updating its evidence hash.';row.payload=JSON.stringify(payload);await assert.rejects(format.validateBackup(await resign(tampered)),e=>e.code==='backup_invalid');
  const voided=structuredClone(exported);voided.tables.impact_searches[0].voided_at='2026-10-18T09:01:00.000Z';voided.tables.impact_searches[0].void_reason='Excluded after the deployment check; preserve both original records.';
  const validated=await format.validateBackup(await resign(voided));assert.equal(validated.tables.impact_checks[0].digest,exported.tables.impact_checks[0].digest);
  const {impactDigest}=await import('../lib/impact-integrity.ts'),after=structuredClone(exported),afterPayload={...impactObservation,phase:'after',observedAt:'2026-10-04T01:00:00.000Z'};
  const afterDigest=await impactDigest({studyDigest:after.tables.impact_studies[0].digest,kind:'add_search',payload:afterPayload});
  after.tables.impact_searches.push({...after.tables.impact_searches[0],id:crypto.randomUUID(),phase:'after',payload:JSON.stringify(afterPayload),digest:afterDigest});after.counts.impact_searches++;
  const check=JSON.parse(after.tables.impact_checks[0].payload);check.publishedAt='2026-10-04T02:00:00.000Z';check.observations[0].observedAt='2026-10-04T03:00:00.000Z';check.observations[0].baselineDigest=afterDigest;
  after.tables.impact_checks[0].payload=JSON.stringify(check);after.tables.impact_checks[0].digest=await impactCheckDigest(after.tables.impact_studies[0].digest,check);await assert.rejects(format.validateBackup(await resign(after)),e=>e.code==='backup_invalid');
  const overRows=structuredClone(exported);overRows.tables.impact_checks=Array.from({length:21},()=>({...exported.tables.impact_checks[0],id:crypto.randomUUID()}));overRows.counts.impact_checks=21;await assert.rejects(format.validateBackup(await resign(overRows)),e=>e.code==='backup_invalid');
  const overBytes=structuredClone(exported),largePayload=JSON.parse(exported.tables.impact_checks[0].payload);largePayload.changes='x'.repeat(6000);largePayload.observations[0].answerExcerpt='x'.repeat(12000);largePayload.observations[0].citations=Array.from({length:25},(_,i)=>({url:`https://example.com/${i}/${'x'.repeat(1500)}`,title:'x'.repeat(300),relation:'original_citation'}));
  overBytes.tables.impact_checks=Array.from({length:20},()=>({...exported.tables.impact_checks[0],id:crypto.randomUUID(),payload:JSON.stringify(largePayload)}));overBytes.counts.impact_checks=20;await assert.rejects(format.validateBackup(await resign(overBytes)),e=>e.code==='backup_too_large');
});
test('V4 validates baseline payload, frozen window, parent, query fingerprint and immutable digest',async()=>{
  const changes=[
    copy=>{copy.tables.impact_baselines[0].study_id=crypto.randomUUID();},
    copy=>{copy.tables.impact_baselines[0].site_id=ids.other;},
    copy=>{copy.tables.impact_baselines[0].query_key='0'.repeat(64);},
    copy=>{copy.tables.impact_baselines[0].digest='0'.repeat(64);},
    copy=>{copy.tables.impact_baselines[0].created_at='2026-10-18T08:59:59.000Z';},
    copy=>{copy.tables.impact_baselines[0].refresh_cipher='secret_never_export';},
    ...[
      p=>{p.totalSessions=13;},
      p=>{p.sourcePattern='different-filter';},
      p=>{p.timeZone='UTC';},
      p=>{p.requestedStartDate=p.startDate='2026-09-30';},
      p=>{p.requestedEndDate='2026-10-03';},
      p=>{p.aiSessions=13;},
      p=>{p.orders=0;},
      p=>{p.revenueMinor=0;},
      p=>{p.completeForPlan=true;},
      p=>{p.access_cipher='secret_never_export';},
    ].map(change=>copy=>{const row=copy.tables.impact_baselines[0],payload=JSON.parse(row.payload);change(payload);row.payload=JSON.stringify(payload);}),
  ];
  for(const change of changes){const copy=structuredClone(exported);change(copy);await assert.rejects(format.validateBackup(await resign(copy)),e=>e.code==='backup_invalid');}
  // All snapshots are retained: identical queries at different times are not duplicate cells.
  const repeat=structuredClone(exported);repeat.tables.impact_baselines.push({...repeat.tables.impact_baselines[0],id:crypto.randomUUID()});repeat.counts.impact_baselines++;
  assert.equal((await format.validateBackup(await resign(repeat))).counts.impact_baselines,2);
  const overBytes=structuredClone(exported),largePayload={...impactBaseline,notes:Array.from({length:12},()=> 'x'.repeat(1000))};
  overBytes.tables.impact_baselines=Array.from({length:45},()=>({...exported.tables.impact_baselines[0],id:crypto.randomUUID(),payload:JSON.stringify(largePayload)}));overBytes.counts.impact_baselines=45;
  await assert.rejects(format.validateBackup(await resign(overBytes)),e=>e.code==='backup_too_large');
});
test('impact backup preserves immutable evidence and rejects tampered content, links and duplicate cells',async()=>{
  assert.equal(exported.counts.impact_studies,1);assert.equal(exported.counts.impact_searches,1);assert.equal(exported.counts.impact_outcomes,1);
  const changes=[
    copy=>{copy.tables.impact_searches[0].study_id=crypto.randomUUID();},
    copy=>{copy.tables.impact_searches[0].query_id=crypto.randomUUID();},
    copy=>{copy.tables.impact_searches[0].voided_at=at;},
    copy=>{const row=copy.tables.impact_searches[0];const payload=JSON.parse(row.payload);payload.answerExcerpt='Tampered';row.payload=JSON.stringify(payload);},
    copy=>{const row=copy.tables.impact_studies[0];const plan=JSON.parse(row.plan);plan.title='Tampered title';row.plan=JSON.stringify(plan);},
    copy=>{copy.tables.impact_searches.push({...copy.tables.impact_searches[0],id:crypto.randomUUID()});copy.counts.impact_searches++;},
    copy=>{copy.tables.impact_outcomes[0].arm='control';},
  ];
  for(const change of changes){const copy=structuredClone(exported);change(copy);await assert.rejects(format.validateBackup(await resign(copy)),e=>e.code==='backup_invalid');}
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
    const experiment=await target.prepare('SELECT * FROM improvement_experiments').first();assert.notEqual(experiment.id,ids.experiment);assert.equal(experiment.site_id,site.id);assert.equal(experiment.status,'reviewed');assert.notEqual(experiment.baseline_run_id,ids.run);assert.notEqual(experiment.followup_run_id,ids.followupRun);assert.notEqual(experiment.baseline_run_id,experiment.followup_run_id);assert.equal(JSON.parse(experiment.baseline_snapshot).cells[0].question,'Private question');assert.equal(JSON.parse(experiment.followup_snapshot).cells[0].cited,true);
    assert.equal((await target.prepare('SELECT count(*) AS n FROM runs WHERE id IN (?,?)').bind(experiment.baseline_run_id,experiment.followup_run_id).first()).n,2);
    assert.equal((await target.prepare('SELECT count(*) AS n FROM operation_ticks').first()).n,0);
    const impact=await target.prepare('SELECT * FROM impact_studies').first(),search=await target.prepare('SELECT * FROM impact_searches').first();assert.notEqual(impact.id,ids.study);assert.equal(search.study_id,impact.id);assert.equal(search.query_id,ids.treatmentQuery);assert.equal(JSON.parse(search.payload).queryId,ids.treatmentQuery);assert.equal(JSON.parse(search.payload).citations[0].relation,'followup_search');assert.equal(search.digest,exported.tables.impact_searches[0].digest);
    const baseline=await target.prepare('SELECT * FROM impact_baselines').first();assert.notEqual(baseline.id,ids.baseline);assert.equal(baseline.site_id,site.id);assert.equal(baseline.study_id,impact.id);assert.equal(baseline.payload,exported.tables.impact_baselines[0].payload);assert.equal(baseline.query_key,exported.tables.impact_baselines[0].query_key);assert.equal(baseline.digest,exported.tables.impact_baselines[0].digest);assert.equal(JSON.parse(baseline.payload).orders,null);assert.equal(JSON.parse(baseline.payload).timeZone,'Asia/Seoul');
    const check=await target.prepare('SELECT * FROM impact_checks').first();assert.notEqual(check.id,ids.check);assert.equal(check.site_id,site.id);assert.equal(check.study_id,impact.id);assert.equal(check.payload,exported.tables.impact_checks[0].payload);assert.equal(check.digest,exported.tables.impact_checks[0].digest);assert.equal(JSON.parse(check.payload).observations[0].baselineDigest,search.digest);
    const security=await target.prepare('SELECT * FROM security_checks').first();assert.notEqual(security.id,ids.security);assert.equal(security.site_id,site.id);assert.equal(security.evidence,exported.tables.security_checks[0].evidence);assert.equal(security.digest,exported.tables.security_checks[0].digest);
    const restoredTables={};for(const name of format.BACKUP_TABLE_NAMES){const columns=Object.keys(format.BACKUP_TABLES[name].schema.shape);restoredTables[name]=(await target.prepare(`SELECT ${columns.map(column=>`"${column}"`).join(',')} FROM "${name}"`).all()).results;}
    assert.equal((await format.createBackup(site.id,restoredTables)).counts.impact_checks,1);

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
    const legacy=await legacyCopy(exported),legacyInput=path.join(dir,'legacy.json'),legacyOutput=path.join(dir,'legacy-restore');writeFileSync(legacyInput,JSON.stringify(legacy),{mode:0o600});const legacyResult=await promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/verify-backup.mjs','--input',legacyInput,'--output',legacyOutput],{cwd:root,timeout:60000});const legacySummary=JSON.parse(legacyResult.stdout);assert.equal(legacySummary.sourceDigest,legacy.integrity.digest);assert.equal(legacySummary.integrity,'ok');assert.equal(legacySummary.counts.improvement_experiments,0);assert.equal(legacySummary.rowCount,summary.rowCount-7);assert.equal(legacySummary.foreignKeyViolations,0);assert.equal(legacySummary.externalCalls,0);assert.doesNotMatch(legacyResult.stdout,/Private|secret_|prompt_text|owner_id/);
    const previous=await historicalCopy(exported,2),previousInput=path.join(dir,'v2.json'),previousOutput=path.join(dir,'v2-restore');writeFileSync(previousInput,JSON.stringify(previous),{mode:0o600});const previousResult=await promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/verify-backup.mjs','--input',previousInput,'--output',previousOutput],{cwd:root,timeout:60000});const previousSummary=JSON.parse(previousResult.stdout);assert.equal(previousSummary.integrity,'ok');assert.equal(previousSummary.counts.impact_studies,0);assert.equal(previousSummary.rowCount,summary.rowCount-6);
    const v3=await historicalCopy(exported,3),v3Input=path.join(dir,'v3.json'),v3Output=path.join(dir,'v3-restore');writeFileSync(v3Input,JSON.stringify(v3),{mode:0o600});const v3Result=await promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/verify-backup.mjs','--input',v3Input,'--output',v3Output],{cwd:root,timeout:60000});const v3Summary=JSON.parse(v3Result.stdout);assert.equal(v3Summary.integrity,'ok');assert.equal(v3Summary.sourceDigest,v3.integrity.digest);assert.equal(v3Summary.counts.impact_studies,1);assert.equal(v3Summary.counts.impact_baselines,0);assert.equal(v3Summary.rowCount,summary.rowCount-3);assert.equal(v3Summary.foreignKeyViolations,0);assert.equal(v3Summary.externalCalls,0);
    const v5=await historicalCopy(exported,5),v5Input=path.join(dir,'v5.json'),v5Output=path.join(dir,'v5-restore');writeFileSync(v5Input,JSON.stringify(v5),{mode:0o600});const v5Result=await promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/verify-backup.mjs','--input',v5Input,'--output',v5Output],{cwd:root,timeout:60000});const v5Summary=JSON.parse(v5Result.stdout);assert.equal(v5Summary.integrity,'ok');assert.equal(v5Summary.sourceDigest,v5.integrity.digest);assert.equal(v5Summary.counts.impact_checks,1);assert.equal(v5Summary.counts.security_checks,0);assert.equal(v5Summary.rowCount,summary.rowCount-1);assert.equal(v5Summary.foreignKeyViolations,0);assert.equal(v5Summary.externalCalls,0);
    const v4=await historicalCopy(exported,4),v4Input=path.join(dir,'v4.json'),v4Output=path.join(dir,'v4-restore');writeFileSync(v4Input,JSON.stringify(v4),{mode:0o600});const v4Result=await promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/verify-backup.mjs','--input',v4Input,'--output',v4Output],{cwd:root,timeout:60000});const v4Summary=JSON.parse(v4Result.stdout);assert.equal(v4Summary.integrity,'ok');assert.equal(v4Summary.sourceDigest,v4.integrity.digest);assert.equal(v4Summary.counts.impact_baselines,1);assert.equal(v4Summary.counts.impact_checks,0);assert.equal(v4Summary.rowCount,summary.rowCount-2);assert.equal(v4Summary.foreignKeyViolations,0);assert.equal(v4Summary.externalCalls,0);
    await assert.rejects(promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/verify-backup.mjs','--input',input,'--output',output],{cwd:root,timeout:60000}),error=>error.stderr.includes('restore_target_exists'));
    chmodSync(input,0o644);await assert.rejects(promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/verify-backup.mjs','--input',input,'--output',path.join(dir,'unsafe')],{cwd:root,timeout:60000}),error=>error.stderr.includes('backup_permissions'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

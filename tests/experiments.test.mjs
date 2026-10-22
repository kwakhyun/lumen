import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Miniflare } from 'miniflare';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env=globalThis.__experimentEnv;', shortCircuit: true };
  if (specifier === 'next/headers') return { url: 'data:text/javascript,export async function headers(){return globalThis.__experimentHeaders;}', shortCircuit: true };
  if (specifier === 'next/navigation') return { url: 'data:text/javascript,export function redirect(){throw new Error("redirect");}', shortCircuit: true };
  if (specifier.startsWith('@/')) { const base = path.join(root, specifier.slice(2)); for (const suffix of ['.ts','/index.ts']) if (existsSync(base + suffix)) return { url: pathToFileURL(base + suffix).href, shortCircuit: true }; }
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) { const base = fileURLToPath(new URL(specifier, context.parentURL)); if (existsSync(base + '.ts')) return { url: pathToFileURL(base + '.ts').href, shortCircuit: true }; }
  return next(specifier, context);
} });
globalThis.__experimentEnv = {}; globalThis.__experimentHeaders = new Headers();
const service = await import('../lib/experiments-server.ts');
const metrics = await import('../lib/experiment-metrics.ts');
const route = await import('../app/api/experiments/route.ts');
let mf, db, calls = 0; const oldFetch = globalThis.fetch;
before(async () => {
  mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: { DB: 'experiment-tests' } });
  db = globalThis.__experimentEnv.DB = await mf.getD1Database('DB');
  for (const file of readdirSync(path.join(root, 'drizzle')).filter(n => n.endsWith('.sql')).sort()) for (const sql of readFileSync(path.join(root, 'drizzle', file), 'utf8').split('--> statement-breakpoint').filter(s => s.trim())) await db.prepare(sql).run();
  globalThis.fetch = async () => { calls++; throw new Error('Experiments must never call external APIs'); };
});
after(async () => { globalThis.fetch = oldFetch; await mf?.dispose(); });
async function workspace(owner = 'alice') { const id = crypto.randomUUID(), date = new Date().toISOString(); await db.prepare('INSERT INTO sites(id,owner_id,name,domain,tracking_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(id, owner, 'Acme', 'acme.example', crypto.randomUUID(), date, date).run(); return { id, owner }; }
async function run(w, day = 1, cells = [{ text: 'Acme', status: 'completed' }], overrides = {}) {
  const id = crypto.randomUUID(), at = `2026-10-${String(day).padStart(2,'0')}T01:00:00.000Z`, completed = cells.filter(c => c.status === 'completed').length;
  await db.prepare('INSERT INTO runs(id,site_id,mode,status,models,total,completed,failed,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id,w.id,overrides.mode || 'live',overrides.status || (completed === cells.length ? 'completed' : 'partial'),'["gemini-3.8-flash"]',cells.length,completed,cells.length-completed,at,at).run();
  for (const [index, cell] of cells.entries()) await db.prepare('INSERT INTO answers(id,site_id,run_id,prompt_id,prompt_text,model,provider,mode,status,text,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),w.id,id,crypto.randomUUID(),cell.question || `Question ${index}`,cell.model || 'gemini-3.8-flash',cell.provider || 'Gemini API',overrides.mode || 'live',cell.status,cell.text,at,at).run();
  return id;
}
const input = (w, id) => ({siteId:w.id,title:'Measure product page',hypothesis:'Clearer product detail will improve brand mentions.',intervention:'Update the product comparison page.',metric:'mentionRate',targetDelta:10,baselineRunId:id});
test('owned experiment CRUD is passive, snapshots brands, enforces optimistic edits', async () => {
  const w = await workspace(), baseline = await run(w), item = await service.createExperiment(w.owner,input(w,baseline));
  await assert.rejects(() => service.getExperiments('mallory',w.id),e=>e.status===404);
  await assert.rejects(() => service.updateExperiment('mallory',{siteId:w.id,id:item.id,expectedUpdatedAt:item.updatedAt,notes:'bad'}),e=>e.status===404);
  await db.prepare('UPDATE sites SET name=? WHERE id=?').bind('Renamed',w.id).run();
  const followup = await run(w,2), saved = await service.updateExperiment(w.owner,{siteId:w.id,id:item.id,expectedUpdatedAt:item.updatedAt,followupRunId:followup,status:'reviewed',notes:'Observed only.'});
  assert.equal(saved.baselineSnapshot.brands[0].name,'Acme'); assert.equal(saved.followupSnapshot.brands[0].name,'Acme'); assert.equal(saved.comparison.before,100); assert.equal(saved.comparison.after,100);
  await assert.rejects(()=>service.updateExperiment(w.owner,{siteId:w.id,id:item.id,expectedUpdatedAt:item.updatedAt,notes:'stale'}),e=>e.code==='experiment_conflict');
  assert.equal((await service.getExperiments(w.owner,w.id)).experiments.length,1); assert.equal(calls,0);
  for (const table of ['ai_usage_reservations','collection_schedules','scheduled_executions']) assert.equal((await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n,0);
});
test('same run, out-of-order evidence, foreign evidence and premature review are rejected',async()=>{
  const w=await workspace(),foreign=await workspace('bob'),baseline=await run(w,3),item=await service.createExperiment(w.owner,input(w,baseline));
  const edit = fields => service.updateExperiment(w.owner,{siteId:w.id,id:item.id,expectedUpdatedAt:item.updatedAt,...fields});
  await assert.rejects(()=>edit({followupRunId:baseline}),e=>e.code==='experiment_same_run');
  const earlier=await run(w,2);await assert.rejects(()=>edit({followupRunId:earlier}),e=>e.code==='experiment_run_order');
  const other=await run(foreign,4);await assert.rejects(()=>edit({followupRunId:other}),e=>e.status===404);
  await assert.rejects(()=>edit({status:'reviewed'}),e=>e.code==='experiment_evidence_required');
});
test('changed question, model, provider and live/demo cohorts cannot be compared',async()=>{
  const w=await workspace(),baseline=await run(w),item=await service.createExperiment(w.owner,input(w,baseline));
  for (const patch of [{question:'Changed question'},{model:'changed-model'},{provider:'Other API'}]) {
    const later=await run(w,2,[{text:'Acme',status:'completed',...patch}]);
    await assert.rejects(()=>service.updateExperiment(w.owner,{siteId:w.id,id:item.id,expectedUpdatedAt:item.updatedAt,followupRunId:later}),e=>e.code==='experiment_cohort_mismatch');
  }
  const sample=await run(w,3,undefined,{mode:'demo'});await assert.rejects(()=>service.createExperiment(w.owner,input(w,sample)),e=>e.code==='experiment_mode_mismatch');
  await assert.rejects(()=>service.updateExperiment(w.owner,{siteId:w.id,id:item.id,expectedUpdatedAt:item.updatedAt,followupRunId:sample}),e=>e.code==='experiment_cohort_mismatch');
});
test('comparison uses paired successes, shows excluded failures, and never invents zero for no overlap',async()=>{
  const w=await workspace(),baseline=await run(w,1,[{text:'No own brand',status:'completed'},{text:'',status:'failed'}]),item=await service.createExperiment(w.owner,input(w,baseline));
  const later=await run(w,2,[{text:'Acme',status:'completed'},{text:'Acme',status:'completed'}]);
  const updated=await service.updateExperiment(w.owner,{siteId:w.id,id:item.id,expectedUpdatedAt:item.updatedAt,followupRunId:later});
  assert.deepEqual([updated.comparison.paired,updated.comparison.total,updated.comparison.before,updated.comparison.after,updated.comparison.delta],[1,2,0,100,100]);
  assert.equal(updated.comparison.baselineFailed,1);assert.ok(updated.comparison.caveats.some(x=>x.includes('편향')));
  const swapped=structuredClone(updated.followupSnapshot);swapped.cells[0].status='failed';swapped.cells[1].status='completed';
  const none=metrics.compareExperiment(item.baselineSnapshot,swapped,'mentionRate',10);assert.equal(none.paired,0);assert.equal(none.delta,null);assert.equal(none.targetObserved,false);
});
test('ungrounded citations, incomplete runs and ambiguous duplicate question cohorts are rejected',async()=>{
  const w=await workspace(),baseline=await run(w);
  await assert.rejects(()=>service.createExperiment(w.owner,{...input(w,baseline),metric:'citationRate'}),e=>e.code==='experiment_citation_unavailable');
  const busy=await run(w,2,undefined,{status:'running'});await assert.rejects(()=>service.createExperiment(w.owner,input(w,busy)),e=>e.code==='experiment_run_incomplete');
  const duplicate=await run(w,3,[{question:'Duplicate',text:'Acme',status:'completed'},{question:'Duplicate',text:'Acme',status:'completed'}]);await assert.rejects(()=>service.createExperiment(w.owner,input(w,duplicate)),e=>e.code==='experiment_duplicate_cohort');
});
test('rounded presentation cannot change the exact target verdict',()=>{
  const before={version:'lumen-experiment-v1',mode:'live',brands:[{name:'Acme',domain:'acme.example'}],capturedAt:new Date().toISOString(),cells:Array.from({length:34},(_,index)=>({question:'Question '+index,model:'gemini-3.8-flash',provider:'Gemini API',status:'completed',mentioned:index===0,cited:false}))};
  const after=structuredClone(before);after.cells[1].mentioned=true;
  const comparison=metrics.compareExperiment(before,after,'mentionRate',3);
  assert.equal(comparison.before,2.9);assert.equal(comparison.after,5.9);assert.equal(comparison.delta,2.9);assert.equal(comparison.targetObserved,false);
});
test('experiment routes enforce authentication, same origin, strict inputs and bounded scope',async()=>{
  const w=await workspace(),baseline=await run(w),url='https://lumen.test/api/experiments';
  const request=(body,origin='https://lumen.test')=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  globalThis.__experimentHeaders=new Headers();assert.equal((await route.GET(new Request(url+'?siteId='+w.id))).status,401);
  globalThis.__experimentHeaders=new Headers({'oai-authenticated-user-id':w.owner,'oai-authenticated-user-email':'alice@example.test'});
  assert.equal((await route.POST(request(input(w,baseline),null))).status,403);assert.equal((await route.POST(request(input(w,baseline),'https://evil.test'))).status,403);
  assert.equal((await route.POST(request({...input(w,baseline),ownerId:'bob'}))).status,400);
  assert.equal((await route.POST(request({...input(w,baseline),targetDelta:0}))).status,400);
  assert.equal((await route.GET(new Request(url+'?siteId='+w.id+'&ownerId=bob'))).status,400);
  const response=await route.POST(request(input(w,baseline)));assert.equal(response.status,201);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(calls,0);
});

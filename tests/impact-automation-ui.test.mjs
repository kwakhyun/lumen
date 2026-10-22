import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) { const base = fileURLToPath(new URL(specifier, context.parentURL)); if (existsSync(base + '.ts')) return { url: pathToFileURL(base + '.ts').href, shortCircuit: true }; }
  return next(specifier, context);
} });
const { prepareImpactImport, saveImpactImport, beforeSearchBaseline } = await import('../components/dashboard/impact-automation.ts');
const study = () => ({ id: crypto.randomUUID(), siteId:crypto.randomUUID(), brand:{name:'Acme',domain:'acme.example'}, plan:{beforeStart:'2026-01-01',beforeEnd:'2026-01-07',afterStart:'2026-01-09',afterEnd:'2026-01-15',repetitions:2,queries:[{id:crypto.randomUUID(),question:'Which product is best?',arm:'treatment'},{id:crypto.randomUUID(),question:'How to measure visibility?',arm:'control'}]} });
const observation = (s, values = {}) => ({phase:'before',queryId:s.plan.queries[0].id,repetition:1,observedAt:'2026-01-03T01:00:00Z',result:'answer',searchConfirmed:true,answerExcerpt:'Observed answer.',brandMention:'absent',citationReview:'complete',evidenceUrl:'',citations:[],notes:'',...values});
const pack = rows => JSON.stringify({observations:rows});

test('structured import validates every row, bounded bytes, plan and unknown keys before saving', () => {
  const s=study(), raw=pack([observation(s)]), rows=prepareImpactImport(raw,s);
  assert.equal(rows.length,1); assert.equal(rows[0].saved,false); assert.match(rows[0].requestId,/^[\da-f-]{36}$/);
  assert.throws(()=>prepareImpactImport('not json',s),/JSON/);
  assert.throws(()=>prepareImpactImport(JSON.stringify({observations:[],extra:true}),s),/최상위/);
  assert.throws(()=>prepareImpactImport(pack([]),s),/1~20/);
  assert.throws(()=>prepareImpactImport(pack(Array(21).fill(observation(s))),s),/1~20/);
  assert.throws(()=>prepareImpactImport('가'.repeat(22000),s),/64 KiB/);
  assert.throws(()=>prepareImpactImport(pack([observation(s,{queryId:crypto.randomUUID()})]),s),/계획/);
  assert.throws(()=>prepareImpactImport(pack([observation(s,{observedAt:'2026-02-01T00:00:00Z'})]),s),/기간/);
  assert.throws(()=>prepareImpactImport(pack([observation(s,{unknown:'discard me'})]),s),/관측/);
  assert.throws(()=>prepareImpactImport(pack([observation(s,{searchConfirmed:false,citations:[{url:'https://acme.example/source',title:'Original',relation:'original_citation'}]})]),s),/검색 사용/);
});

test('import retains explicit retry IDs and rejects duplicate cells, request IDs and future observations', () => {
  const s=study(), id=crypto.randomUUID(), row=observation(s,{requestId:id});
  assert.equal(prepareImpactImport(pack([row]),s)[0].requestId,id);
  assert.throws(()=>prepareImpactImport(pack([row,observation(s,{repetition:2,requestId:id})]),s),/requestId.*중복/);
  assert.throws(()=>prepareImpactImport(pack([row,observation(s)]),s),/회차.*중복/);
  assert.throws(()=>prepareImpactImport(pack([observation(s,{requestId:'bad'})]),s),/UUID/);
  assert.throws(()=>prepareImpactImport(pack([observation(s)]),s,()=>crypto.randomUUID(),Date.parse('2026-01-02T00:00:00Z')),/미래/);
});

test('bulk import stops on first error and retry skips successful rows with stable IDs', async () => {
  const s=study(), rows=prepareImpactImport(pack([observation(s),observation(s,{repetition:2})]),s), firstCalls=[], retryCalls=[];
  const first=await saveImpactImport(rows,async row=>{firstCalls.push(row.requestId);if(row.observation.repetition===2)throw Error('Connection interrupted');return row;},()=>{});
  assert.equal(first.rows[0].saved,true);assert.equal(first.rows[1].saved,false);assert.match(first.error,/2번째/);
  const retry=await saveImpactImport(first.rows,async row=>{retryCalls.push(row.requestId);return row;},()=>{});
  assert.deepEqual(firstCalls,rows.map(row=>row.requestId));assert.deepEqual(retryCalls,[rows[1].requestId]);assert.equal(retry.error,'');assert.ok(retry.rows.every(row=>row.saved));
  assert.ok(rows.every(row=>!row.saved),'caller source rows are not mutated');
});

test('ambiguous first response preserves request ID for server idempotency', async () => {
  const s=study(), rows=prepareImpactImport(pack([observation(s)]),s);let calls=0;
  const first=await saveImpactImport(rows,async()=>{calls++;throw Error('Saved server-side but response lost');},()=>{});
  assert.equal(first.rows[0].requestId,rows[0].requestId);assert.equal(first.rows[0].saved,false);
  const next=await saveImpactImport(first.rows,async row=>{calls++;assert.equal(row.requestId,rows[0].requestId);return {};},()=>{});
  assert.equal(calls,2);assert.equal(next.rows[0].saved,true);
});

test('before baseline uses known confirmed observations independently of after records and preserves null', () => {
  const s=study(), row=observation(s), result=beforeSearchBaseline(s,[row]);
  assert.deepEqual(result.treatment.mention,{numerator:0,denominator:1,rate:0});
  assert.deepEqual(result.control.mention,{numerator:0,denominator:0,rate:null});
  assert.equal(result.treatment.recorded,1);assert.equal(result.treatment.planned,2);
  const missing=beforeSearchBaseline(s,[{...row,brandMention:'uncertain',citationReview:'not_reviewed'}]);
  assert.equal(missing.treatment.mention.rate,null);assert.equal(missing.treatment.citation.rate,null);
  for (const patch of [{voidedAt:'2026-01-04T00:00:00Z'},{phase:'after'},{result:'error'},{result:'no_ai_answer'},{searchConfirmed:false}]) assert.equal(beforeSearchBaseline(s,[{...row,...patch}]).treatment.mention.rate,null);
});

test('before citation baseline counts original own-domain links only', () => {
  const s=study(), row=observation(s);
  const check=link=>beforeSearchBaseline(s,[{...row,citations:[link]}]).treatment.citation.numerator;
  assert.equal(check({url:'https://docs.acme.example/source',relation:'original_citation'}),1);
  assert.equal(check({url:'https://acme.example.evil.test/source',relation:'original_citation'}),0);
  assert.equal(check({url:'https://acme.example/source',relation:'followup_search'}),0);
  assert.equal(check({url:'not a url',relation:'original_citation'}),0);
});

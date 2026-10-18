import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Miniflare } from 'miniflare';

// Real route + scheduler + isolated local D1. Gateway identity is the only stub;
// these tests do not assert that a directly exposed Worker authenticates headers.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__mcpEnv = { LUMEN_PROVIDER_MODE: 'paid_enabled' }; globalThis.__mcpHeaders = new Headers();
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env=globalThis.__mcpEnv;', shortCircuit: true };
  if (specifier === 'next/headers') return { url: 'data:text/javascript,export async function headers(){return globalThis.__mcpHeaders;}', shortCircuit: true };
  if (specifier === 'next/navigation') return { url: 'data:text/javascript,export function redirect(){throw new Error("redirect");}', shortCircuit: true };
  const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : specifier.startsWith('.') && context.parentURL?.startsWith('file:') ? fileURLToPath(new URL(specifier, context.parentURL)) : null;
  if (base) for (const suffix of ['.ts', '/index.ts']) if (existsSync(base + suffix)) return { url: pathToFileURL(base + suffix).href, shortCircuit: true };
  return next(specifier, context);
} });
const env = globalThis.__mcpEnv, originalFetch = globalThis.fetch;
let mf, db, route, aliceSite, bobSite, bobSchedule, bobRun, bobExecution;
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error('External calls are forbidden in MCP tests'); };
function identity(owner = 'alice') { globalThis.__mcpHeaders = owner ? new Headers({ 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@example.test` }) : new Headers(); }
async function send(input, options = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...options.headers });
  const response = await route.POST(new Request('https://lumen.test/mcp', { method: 'POST', headers, body: typeof input === 'string' ? input : JSON.stringify(input) }));
  const text = await response.text(); return { response, body: text ? JSON.parse(text) : null };
}
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const call = (name, args = {}) => send(rpc('tools/call', { name, arguments: args }));
const data = result => JSON.parse(result.body.result.content[0].text);
before(async () => {
  mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("fixture")}}', d1Databases: { DB: 'mcp-fixtures' } });
  db = env.DB = await mf.getD1Database('DB');
  for (const file of readdirSync(path.join(root, 'drizzle')).filter(f => f.endsWith('.sql')).sort()) for (const statement of readFileSync(path.join(root, 'drizzle', file), 'utf8').split('--> statement-breakpoint').filter(s => s.trim())) await db.prepare(statement).run();
  route = await import('../app/mcp/route.ts');
  const date = new Date().toISOString(); aliceSite = crypto.randomUUID(); bobSite = crypto.randomUUID(); bobSchedule = crypto.randomUUID(); bobRun = crypto.randomUUID(); bobExecution = crypto.randomUUID();
  for (const [id, owner] of [[aliceSite, 'alice'], [bobSite, 'bob']]) await db.prepare('INSERT INTO sites (id,owner_id,name,domain,tracking_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(id, owner, `${owner} workspace`, `${owner}.example`, `${owner}-private-tracking-key`, date, date).run();
  await db.prepare('INSERT INTO operation_audit (id,owner_id,site_id,action,summary,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), 'bob', bobSite, 'fixture', 'bob-private-audit', date).run();
  await db.prepare('INSERT INTO collection_schedules (id,owner_id,site_id,name,frequency,timezone,hour,minute,models,next_run_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(bobSchedule, 'bob', bobSite, 'bob-private-schedule', 'daily', 'UTC', 1, 0, '["gpt-5-mini"]', 1, date, date).run();
  await db.prepare('INSERT INTO runs (id,site_id,mode,status,models,total,created_at) VALUES (?,?,?,?,?,?,?)').bind(bobRun, bobSite, 'live', 'queued', '["gpt-5-mini"]', 1, date).run();
  const bobPrompt=crypto.randomUUID();await db.prepare('INSERT INTO prompts(id,site_id,text,created_at) VALUES (?,?,?,?)').bind(bobPrompt,bobSite,'bob-private-prompt',date).run();
  await db.prepare('INSERT INTO answers(id,site_id,run_id,prompt_id,prompt_text,model,provider,mode,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),bobSite,bobRun,bobPrompt,'bob-private-prompt','gpt-5-mini','Fixture','live','pending',date).run();
  await db.prepare('INSERT INTO scheduled_executions (id,owner_id,site_id,schedule_name,scheduled_for,configuration,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(bobExecution, 'bob', bobSite, 'bob pending execution', 1, JSON.stringify({ models: ['gpt-5-mini'], promptIds: null }), date, '2000-01-01T00:00:00.000Z').run();
});
after(async () => { assert.equal(externalCalls, 0, 'No real provider or external HTTP calls'); globalThis.fetch = originalFetch; await mf?.dispose(); });

test('discovery, listing and tools all require gateway identity', async () => {
  identity(null);
  for (const method of ['server/discover', 'tools/list', 'tools/call']) {
    const result = await send(rpc(method, { name: 'lumen_workspaces', arguments: {} }));
    assert.equal(result.response.status, 401); assert.equal(result.body.error.code, -32001); assert.equal(result.body.result, undefined);
  }
  globalThis.__mcpHeaders = new Headers({ 'oai-authenticated-user-id': 'alice' });
  assert.equal((await send(rpc('tools/list'))).response.status, 401);
});
test('cross-origin browser requests are rejected and same-origin/server requests work', async () => {
  identity();
  for (const origin of ['https://evil.test', 'null', 'https://lumen.test.evil.test']) {
    const result = await send(rpc('tools/list'), { headers: { Origin: origin } }); assert.equal(result.response.status, 403); assert.equal(result.body.error.code, -32001);
  }
  assert.equal((await send(rpc('tools/list'), { headers: { Origin: 'https://lumen.test' } })).response.status, 200);
  assert.equal((await send(rpc('tools/list'))).response.status, 200);
});
test('body size is bounded by received bytes and malformed transport failures retain HTTP errors', async () => {
  identity();
  const large = await send(' '.repeat(32769), { headers: { 'Content-Length': '1' } });
  assert.equal(large.response.status, 413); assert.equal(large.body.error.code, -32600); assert.equal(large.body.result, undefined);
  const invalid = await send('{"fixture-secret":'); assert.equal(invalid.response.status, 400); assert.equal(invalid.body.error.code, -32700); assert.equal(JSON.stringify(invalid.body).includes('fixture-secret'), false);
  for (const type of ['application/jsonp', 'text/plain']) assert.equal((await send(rpc('ping'), { headers: { 'Content-Type': type } })).response.status, 415);
  assert.equal((await send(rpc('ping'), { headers: { 'Content-Type': 'application/json; charset=utf-8' } })).response.status, 200);
});
test('JSON-RPC envelope and unsupported protocol versions fail before dispatch', async () => {
  identity();
  for (const input of [[], null, { jsonrpc: '1.0', id: 1, method: 'ping' }, { ...rpc('ping'), ownerId: 'bob' }, { jsonrpc: '2.0', method: 'tools/list' }]) {
    const result = await send(input); assert.equal(result.response.status, 400); assert.equal(result.body.error.code, -32600);
  }
  const unsupported = await send(rpc('ping'), { headers: { 'MCP-Protocol-Version': '1900-01-01' } }); assert.equal(unsupported.response.status, 400);
  for (const version of ['2026-07-28', '2025-03-26']) assert.equal((await send(rpc('ping'), { headers: { 'MCP-Protocol-Version': version } })).body.result !== undefined, true);
});
test('Sites discovery advertises the required version and tools expose bounded schemas', async () => {
  identity(); const discovery = await send(rpc('server/discover', {})); assert.deepEqual(discovery.body.result.supportedVersions, ['2026-07-28']); assert.deepEqual(discovery.body.result.capabilities, { tools: {} });
  const listed = await send(rpc('tools/list')); assert.deepEqual(listed.body.result.tools.map(t => t.name), ['lumen_workspaces', 'lumen_operations', 'lumen_collect_due']);
  const collect = listed.body.result.tools.find(t => t.name === 'lumen_collect_due'); assert.equal(collect.inputSchema.additionalProperties, false); assert.equal(collect.inputSchema.properties.limit.maximum, 2); assert.equal(collect.annotations.readOnlyHint, false);
  assert.equal(listed.response.headers.get('cache-control'), 'no-store'); assert.equal(listed.response.headers.get('x-content-type-options'), 'nosniff');
});
test('legacy initialize negotiates supported versions and notifications return only 202', async () => {
  identity();
  for (const version of ['2025-03-26', '2026-07-28', 'unknown']) {
    const initialized = await send(rpc('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'fixture', version: '1' } }));
    assert.equal(initialized.body.result.protocolVersion, version === 'unknown' ? '2025-03-26' : version);
  }
  const notification = await send({ jsonrpc: '2.0', method: 'notifications/initialized' }); assert.equal(notification.response.status, 202); assert.equal(notification.body, null);
  assert.equal((await send(rpc('notifications/initialized'))).response.status, 400);
  assert.equal((await send(rpc('initialize', {}))).body.error.code, -32602);
});
test('bad method and tool parameters yield protocol errors and never invoke tools', async () => {
  identity();
  const unknown = await send(rpc('unavailable/method', {}, 'request-id')); assert.equal(unknown.body.error.code, -32601); assert.equal(unknown.body.id, 'request-id');
  const malformed = [rpc('tools/list', []), rpc('ping', { ownerId: 'bob' }), rpc('tools/call', {}), rpc('tools/call', { name: 'unknown' })];
  for (const input of malformed) { const result = await send(input); assert.equal(result.body.error.code, -32602); assert.equal(result.body.result, undefined); }
  for (const [name, args] of [['lumen_operations', { siteId: 'invalid' }], ['lumen_workspaces', []], ['lumen_collect_due', { limit: 0 }], ['lumen_collect_due', { limit: 3 }], ['lumen_collect_due', { limit: '1' }]]) assert.equal((await call(name, args)).body.error.code, -32602);
});
test('owner and execution overrides are rejected for every tool', async () => {
  identity();
  for (const [name, args] of [['lumen_workspaces', { ownerId: 'bob' }], ['lumen_operations', { siteId: aliceSite, ownerId: 'bob' }], ['lumen_collect_due', { ownerId: 'bob' }], ['lumen_collect_due', { executionId: bobExecution }], ['lumen_collect_due', { siteId: bobSite }]]) {
    const result = await call(name, args); assert.equal(result.body.error.code, -32602); assert.equal(result.body.result, undefined);
  }
});
test('workspace discovery and operation details isolate tenants and redact internal fields', async () => {
  identity(); const list = await call('lumen_workspaces'); assert.equal(list.body.result.isError, false); assert.deepEqual(data(list).workspaces, [{ id: aliceSite, name: 'alice workspace', domain: 'alice.example', mode: 'live' }]);
  assert.equal(JSON.stringify(list.body).includes('private-tracking-key'), false); assert.equal(data(list).usage.plan, 'free');
  const own = await call('lumen_operations', { siteId: aliceSite }); assert.equal(own.body.result.isError, false); assert.deepEqual(data(own).audit, []);
  const other = await call('lumen_operations', { siteId: bobSite }); assert.equal(other.response.status, 200); assert.equal(other.body.result.isError, true); assert.equal(data(other).code, 'not_found'); assert.equal(JSON.stringify(other.body).includes('bob-private'), false);
  identity('bob'); const bob = await call('lumen_workspaces'); assert.deepEqual(data(bob).workspaces.map(s => s.id), [bobSite]); identity();
});
test('collection tick cannot enqueue, resume, alert, or consume budget for another owner', async () => {
  identity(); const before = await db.prepare('SELECT * FROM collection_schedules WHERE id=?').bind(bobSchedule).first();
  const tick = await call('lumen_collect_due', { limit: 2 }); assert.equal(tick.body.result.isError, false); const result = data(tick); assert.equal(result.queued, 0); assert.equal(result.processed, 0); assert.equal(result.continuation, false);
  assert.deepEqual(await db.prepare('SELECT * FROM collection_schedules WHERE id=?').bind(bobSchedule).first(), before);
  assert.equal((await db.prepare('SELECT status FROM runs WHERE id=?').bind(bobRun).first()).status, 'queued');
  const execution = await db.prepare('SELECT status,attempts FROM scheduled_executions WHERE id=?').bind(bobExecution).first(); assert.deepEqual(execution, { status: 'queued', attempts: 0 });
  assert.equal((await db.prepare('SELECT count(*) n FROM operation_alerts').first()).n, 0); assert.equal((await db.prepare('SELECT count(*) n FROM ai_usage_reservations').first()).n, 0);
  assert.deepEqual((await db.prepare('SELECT id FROM operation_heartbeats').all()).results, [{ id: 'owner:alice' }]);
});
test('internal tool failures are sanitized tool errors and preserve the request id', async () => {
  identity(); delete env.DB;
  try { const failed = await send(rpc('tools/call', { name: 'lumen_workspaces' }, 'failing-id')); assert.equal(failed.response.status, 200); assert.equal(failed.body.id, 'failing-id'); assert.equal(failed.body.result.isError, true); assert.equal(data(failed).code, 'internal_error'); assert.equal(JSON.stringify(failed.body).includes('hosting.json'), false); }
  finally { env.DB = db; }
});

test('operator authority requires exact trusted identity and cannot be supplied by parameters or HTTP headers',async()=>{
 identity();
 for(const configured of ['', ' alice', 'alice ', 'ALICE', 'alice@example.test', 'bob']){
  env.LUMEN_OPERATOR_USER_ID=configured;const result=data(await call('lumen_collect_due'));assert.equal(result.scope,undefined);assert.equal(result.queued,0);assert.equal(result.processed,0);
 }
 env.LUMEN_OPERATOR_USER_ID='operator';
 const spoofed=await send(rpc('tools/call',{name:'lumen_collect_due',arguments:{}}),{headers:{'oai-authenticated-user-id':'operator','oai-authenticated-user-email':'operator@example.test','x-lumen-operator-user-id':'operator'}});assert.equal(data(spoofed).scope,undefined);assert.equal(data(spoofed).processed,0);
 for(const args of [{scope:'service'},{global:true},{operator:true},{ownerId:undefined,scope:'global'}])assert.equal((await call('lumen_collect_due',args)).body.error.code,-32602);
 assert.equal((await db.prepare('SELECT status FROM runs WHERE id=?').bind(bobRun).first()).status,'queued');delete env.LUMEN_OPERATOR_USER_ID;
});
test('configured operator advances other tenants while returning only aggregate counts',async()=>{
 identity();env.LUMEN_OPERATOR_USER_ID='alice';
 try{
  const tick=await call('lumen_collect_due',{limit:2});assert.equal(tick.body.result.isError,false);const result=data(tick);assert.equal(result.scope,'service');assert.ok(result.queued>0);assert.ok(result.processed>0);
  assert.deepEqual(Object.keys(result).sort(),['scope','queued','processed','completed','failed','blocked','continuation','retryAfterSeconds','skipped'].sort());
  for(const value of [bobSite,bobSchedule,bobRun,bobExecution,'bob-private','bob pending execution','Private prompt'])assert.equal(JSON.stringify(tick.body).includes(value),false);
  assert.equal((await db.prepare('SELECT status FROM runs WHERE id=?').bind(bobRun).first()).status,'failed');assert.ok((await db.prepare('SELECT next_run_at FROM collection_schedules WHERE id=?').bind(bobSchedule).first()).next_run_at>Date.now());
  const denied=await call('lumen_operations',{siteId:bobSite});assert.equal(denied.body.result.isError,true);assert.equal(data(denied).code,'not_found');assert.deepEqual(data(await call('lumen_workspaces')).workspaces.map(s=>s.id),[aliceSite]);
  const heartbeat=await db.prepare('SELECT owner_id,last_success_at FROM operation_heartbeats WHERE id=?').bind('service').first();assert.equal(heartbeat.owner_id,null);assert.ok(heartbeat.last_success_at);
 }finally{delete env.LUMEN_OPERATOR_USER_ID;}
});
test('operator failures never expose tenant-specific errors or identifiers',async()=>{
 identity();env.LUMEN_OPERATOR_USER_ID='alice';delete env.DB;
 try{const result=await call('lumen_collect_due');assert.equal(result.body.result.isError,true);assert.deepEqual(data(result),{error:'Lumen could not complete this collection tick.',code:'collection_error'});}finally{env.DB=db;delete env.LUMEN_OPERATOR_USER_ID;}
});

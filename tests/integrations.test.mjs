import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Miniflare } from 'miniflare';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__integrationEnv = {}; globalThis.__integrationHeaders = new Headers();
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env=globalThis.__integrationEnv;', shortCircuit: true };
  if (specifier === 'next/headers') return { url: 'data:text/javascript,export async function headers(){return globalThis.__integrationHeaders;}', shortCircuit: true };
  if (specifier === 'next/navigation') return { url: 'data:text/javascript,export function redirect(){throw new Error("redirect");}', shortCircuit: true };
  const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : specifier.startsWith('.') && context.parentURL?.startsWith('file:') ? fileURLToPath(new URL(specifier, context.parentURL)) : null;
  if (base) for (const suffix of ['.ts', '/index.ts']) if (existsSync(base + suffix)) return { url: pathToFileURL(base + suffix).href, shortCircuit: true };
  return next(specifier, context);
} });
const env = globalThis.__integrationEnv;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Unmocked network request is forbidden'); };
let mf, db, security, usage, ga4, route, siteId;
const scope = 'https://www.googleapis.com/auth/analytics.readonly';
const tokens = { access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'Bearer', expires_in: 3600, scope };
before(async () => {
  mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("fixture")}}', d1Databases: { DB: 'integration-fixtures' } });
  db = env.DB = await mf.getD1Database('DB');
  for (const file of readdirSync(path.join(root, 'drizzle')).filter(f => f.endsWith('.sql')).sort()) for (const statement of readFileSync(path.join(root, 'drizzle', file), 'utf8').split('--> statement-breakpoint').filter(s => s.trim())) await db.prepare(statement).run();
  Object.assign(env, { APP_BASE_URL: 'https://lumen.test', GOOGLE_CLIENT_ID: 'fixture-client', GOOGLE_CLIENT_SECRET: 'fixture-secret', INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 42).toString('base64') });
  security = await import('../lib/integration-security.ts'); usage = await import('../lib/usage.ts'); ga4 = await import('../lib/ga4.ts'); route = await import('../app/api/integrations/ga4/[siteId]/[action]/route.ts');
  siteId = crypto.randomUUID(); await db.prepare('INSERT INTO sites (id,owner_id,name,domain,tracking_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(siteId, 'alice', 'Fixture', 'fixture.example', crypto.randomUUID(), new Date().toISOString(), new Date().toISOString()).run();
});
after(async () => { globalThis.fetch = originalFetch; await mf?.dispose(); });
async function resetUsage() { await db.batch([db.prepare('DELETE FROM ai_usage_reservations'), db.prepare('DELETE FROM ai_usage_buckets')]); for (const key of Object.keys(env).filter(k => k.startsWith('AI_'))) delete env[key]; }
async function authorize() { globalThis.fetch = async url => { assert.equal(url, 'https://oauth2.googleapis.com/token'); return Response.json(tokens); }; const started = await ga4.startGa4Connection('alice', siteId); const state = new URL(started.url).searchParams.get('state'); await ga4.finishGa4Connection('alice', state, 'fixture-code', false); }
test('AES-GCM encrypts randomly and binds tenant/workspace/purpose, detects tampering and supports explicit previous-key rotation', async () => {
  const a = await security.encryptSecret('fixture-token', 'alice/site/refresh'), b = await security.encryptSecret('fixture-token', 'alice/site/refresh'); assert.notEqual(a, b); assert.equal(a.includes('fixture-token'), false);
  assert.equal(await security.decryptSecret(a, 'alice/site/refresh'), 'fixture-token'); await assert.rejects(() => security.decryptSecret(a, 'bob/site/refresh'), { code: 'integration_credentials_invalid' });
  const parts = a.split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1); await assert.rejects(() => security.decryptSecret(parts.join('.'), 'alice/site/refresh'));
  env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS = env.INTEGRATION_ENCRYPTION_KEY; env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64'); assert.equal(await security.decryptSecret(a, 'alice/site/refresh'), 'fixture-token');
  env.INTEGRATION_ENCRYPTION_KEY = env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS; delete env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS;
});
test('20 concurrent unique calls reserve exactly the user daily allowance in all four buckets', async () => {
  await resetUsage(); const result = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => usage.reserveAiUsage('budget-user', 1, `generation:${i}`)));
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 10); assert.ok(result.filter(r => r.status === 'rejected').every(r => r.reason.code === 'ai_usage_exhausted'));
  const status = await usage.getUsageStatus('budget-user'); for (const window of [status.daily, status.monthly, status.serviceDaily, status.serviceMonthly]) assert.equal(window.used, 10);
  assert.equal(status.available, 0); assert.equal(status.timezone, 'UTC'); assert.match(status.daily.resetsAt, /T00:00:00\.000Z$/);
});
test('concurrent idempotent reservation charges once and mismatched units cannot reuse it', async () => {
  await resetUsage(); await Promise.all(Array.from({ length: 12 }, () => usage.reserveAiUsage('idempotent', 3, 'analysis:stable-run')));
  const status = await usage.getUsageStatus('idempotent'); assert.equal(status.daily.used, 3); assert.equal(status.serviceMonthly.used, 3);
  await assert.rejects(() => usage.reserveAiUsage('idempotent', 2, 'analysis:stable-run'), { code: 'usage_reservation_conflict' });
});
test('global and monthly ceilings reject atomically without consuming other buckets', async () => {
  await resetUsage(); env.AI_GLOBAL_DAILY_LIMIT = '5';
  const result = await Promise.allSettled([usage.reserveAiUsage('first', 4, 'analysis:first'), usage.reserveAiUsage('second', 4, 'analysis:second')]); assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  const a = await usage.getUsageStatus('first'), b = await usage.getUsageStatus('second'); assert.equal(a.daily.used + b.daily.used, 4); assert.equal(a.serviceDaily.used, 4);
  await resetUsage(); env.AI_USER_MONTHLY_LIMIT = '2'; await usage.reserveAiUsage('month', 2, 'generation:first'); await assert.rejects(() => usage.reserveAiUsage('month', 1, 'generation:second'), { code: 'ai_usage_exhausted' }); const status = await usage.getUsageStatus('month'); assert.equal(status.daily.used, 2); assert.equal(status.serviceDaily.used, 2);
  env.AI_USER_DAILY_LIMIT = '999'; assert.equal((await usage.getUsageStatus('month')).daily.limit, 10); env.AI_USER_DAILY_LIMIT = 'garbage'; assert.equal((await usage.getUsageStatus('month')).daily.limit, 0); await resetUsage();
});
test('OAuth is read-only PKCE with opaque hashed state, wrong tenant cannot consume it, and callback is single use', async () => {
  const started = await ga4.startGa4Connection('alice', siteId), url = new URL(started.url), state = url.searchParams.get('state');
  assert.equal(url.searchParams.get('scope'), scope); assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('access_type'), 'offline');
  const stored = await db.prepare('SELECT * FROM oauth_states').first(); assert.notEqual(stored.state_hash, state); const verifier = await security.decryptSecret(stored.verifier_cipher, `lumen:ga4:alice:${siteId}:state:${stored.state_hash}`); assert.equal(await security.hash(verifier), url.searchParams.get('code_challenge'));
  await assert.rejects(() => ga4.finishGa4Connection('bob', state, 'code', false), { code: 'oauth_state_invalid' });
  let calls = 0; globalThis.fetch = async (_url, init) => { calls++; const params = new URLSearchParams(init.body); assert.equal(params.get('code_verifier'), verifier); assert.equal(params.get('redirect_uri'), 'https://lumen.test/api/integrations/ga4/callback'); return Response.json(tokens); };
  await ga4.finishGa4Connection('alice', state, 'code', false); await assert.rejects(() => ga4.finishGa4Connection('alice', state, 'code', false), { code: 'oauth_state_invalid' }); assert.equal(calls, 1);
  const row = await db.prepare('SELECT * FROM ga4_connections WHERE site_id=?').bind(siteId).first(); assert.ok(!row.refresh_cipher.includes(tokens.refresh_token)); const status = await ga4.ga4Status('alice', siteId); assert.equal(status.connected, true); assert.equal(JSON.stringify(status).includes('fixture-access'), false);
});
test('OAuth expiration and denied consent fail without exchanging credentials', async () => {
  const { url } = await ga4.startGa4Connection('alice', siteId), state = new URL(url).searchParams.get('state'); await db.prepare('UPDATE oauth_states SET expires_at=1').run();
  globalThis.fetch = async () => { throw new Error('Must not send an expired state'); }; await assert.rejects(() => ga4.finishGa4Connection('alice', state, 'code', false), { code: 'oauth_state_invalid' });
  const second = await ga4.startGa4Connection('alice', siteId), denied = new URL(second.url).searchParams.get('state'); await assert.rejects(() => ga4.finishGa4Connection('alice', denied, null, true), { code: 'oauth_denied' }); assert.equal((await db.prepare('SELECT count(*) n FROM oauth_states').first()).n, 0);
});
test('disconnect while authorization code exchange is in flight cannot resurrect credentials', async () => {
  const { url } = await ga4.startGa4Connection('alice', siteId), state = new URL(url).searchParams.get('state'); let begin, finish; const begun = new Promise(r => begin = r), gate = new Promise(r => finish = r);
  globalThis.fetch = async () => { begin(); await gate; return Response.json(tokens); };
  const pending = ga4.finishGa4Connection('alice', state, 'code', false); await begun; await ga4.disconnectGa4('alice', siteId); finish(); await assert.rejects(pending, { code: 'integration_changed' }); assert.equal((await ga4.ga4Status('alice', siteId)).connected, false);
});
test('refresh tokens stay encrypted and missing rotation retains the existing refresh token', async () => {
  await authorize(); await db.prepare('UPDATE ga4_connections SET access_expires=0 WHERE site_id=?').bind(siteId).run(); let refreshes = 0;
  globalThis.fetch = async (url, init) => { if (url === 'https://oauth2.googleapis.com/token') { refreshes++; assert.equal(new URLSearchParams(init.body).get('refresh_token'), 'fixture-refresh'); return Response.json({ access_token: 'refreshed-access', token_type: 'Bearer', expires_in: 3600 }); }
    assert.match(url, /analyticsadmin\.googleapis\.com\/v1beta\/accountSummaries/); assert.equal(init.headers.Authorization, 'Bearer refreshed-access'); return Response.json({ accountSummaries: [{ displayName: 'Account', propertySummaries: [{ property: 'properties/1234', displayName: 'Property' }] }], nextPageToken: 'next-fixture-page' }); };
  const properties = await ga4.listGa4Properties('alice', siteId); assert.deepEqual(properties.properties, [{ id: '1234', name: 'Property', accountName: 'Account' }]); assert.equal(properties.nextPageToken, 'next-fixture-page'); assert.equal(refreshes, 1);
  const row = await db.prepare('SELECT refresh_cipher,access_cipher FROM ga4_connections WHERE site_id=?').bind(siteId).first(); assert.equal(await security.decryptSecret(row.refresh_cipher, `lumen:ga4:alice:${siteId}:refresh`), 'fixture-refresh'); assert.ok(!row.access_cipher.includes('refreshed-access'));
});
test('revoked refresh clears usable credentials and exposes reconnect state', async () => {
  await db.prepare('UPDATE ga4_connections SET access_expires=0 WHERE site_id=?').bind(siteId).run(); globalThis.fetch = async () => Response.json({ error: 'invalid_grant', error_description: 'private fixture detail' }, { status: 400 });
  await assert.rejects(() => ga4.listGa4Properties('alice', siteId), { code: 'oauth_revoked' }); const status = await ga4.ga4Status('alice', siteId); assert.equal(status.reconnectRequired, true); assert.equal(status.connected, false); assert.equal(status.error.includes('private'), false);
});
test('a refresh lease prevents duplicate token refresh and disconnect fences the pending write', async () => {
  await authorize(); await db.prepare('UPDATE ga4_connections SET access_expires=0 WHERE site_id=?').bind(siteId).run();
  let begin, finish, calls = 0; const begun = new Promise(r => begin = r), gate = new Promise(r => finish = r);
  globalThis.fetch = async () => { calls++; begin(); await gate; return Response.json({ access_token: 'stale-refresh-result', token_type: 'Bearer', expires_in: 3600 }); };
  const pending = ga4.listGa4Properties('alice', siteId); await begun;
  await assert.rejects(() => ga4.listGa4Properties('alice', siteId), { code: 'integration_busy' });
  await ga4.disconnectGa4('alice', siteId); finish(); await assert.rejects(pending, { code: 'integration_changed' });
  assert.equal(calls, 1); assert.equal((await ga4.ga4Status('alice', siteId)).connected, false);
});
test('property selection verifies Google access and rejects cross-tenant requests before network', async () => {
  await authorize(); let calls = 0; globalThis.fetch = async url => { calls++; assert.equal(url, 'https://analyticsadmin.googleapis.com/v1beta/properties/1234'); return Response.json({ name: 'properties/1234', displayName: 'Selected property' }); };
  await assert.rejects(() => ga4.selectGa4Property('bob', siteId, '1234'), { code: 'not_found' }); assert.equal(calls, 0);
  const status = await ga4.selectGa4Property('alice', siteId, '1234'); assert.equal(status.propertyId, '1234'); assert.equal(status.propertyName, 'Selected property');
});
function reportFixture(dimensions, metrics, rows, metadata = {}) { return { dimensionHeaders: dimensions.map(name => ({ name })), metricHeaders: metrics.map(name => ({ name })), rows: rows.map(([d, m]) => ({ dimensionValues: d.map(value => ({ value })), metricValues: m.map(value => ({ value: String(value) })) })), rowCount: rows.length, metadata }; }
test('GA4 import persists aggregate snapshot, totalUsers uses a separate query and quality flags survive', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10); let calls = 0;
  globalThis.fetch = async (url, init) => { calls++; assert.equal(url, 'https://analyticsdata.googleapis.com/v1beta/properties/1234:runReport'); const body = JSON.parse(init.body); assert.equal(body.dateRanges[0].endDate, yesterday);
    if (body.dimensions) { assert.deepEqual(body.orderBys[0], { dimension: { dimensionName: 'date' } }); return Response.json(reportFixture(['date', 'sessionSource', 'sessionMedium'], ['sessions', 'screenPageViews'], [[[yesterday.replaceAll('-', ''), 'chatgpt.com', 'referral'], [4, 7]], [[yesterday.replaceAll('-', ''), 'google', 'organic'], [8, 13]]], { subjectToThresholding: true })); }
    if (body.dimensionFilter) return Response.json(reportFixture([], ['sessions'], [[[], [4]]]));
    return Response.json(reportFixture([], ['sessions', 'totalUsers', 'screenPageViews'], [[[], [12, 9, 20]]], { timeZone: 'Asia/Seoul', dataLossFromOtherRow: false })); };
  const status = await ga4.syncGa4('alice', siteId, 7); assert.equal(calls, 3); assert.equal(status.report.totalUsers, 9); assert.equal(status.report.totalSessions, 12); assert.equal(status.report.aiSessions, 4); assert.equal(status.report.dataQuality.subjectToThresholding, true); assert.equal(status.report.timeZone, 'Asia/Seoul'); assert.equal(status.report.rows[0].users, undefined);
});
test('failed imports retain previous complete snapshot and reject partial/oversized data', async () => {
  const before = (await ga4.ga4Status('alice', siteId)).report;
  globalThis.fetch = async () => Response.json({ rowCount: 10001, rows: [] }); await assert.rejects(() => ga4.syncGa4('alice', siteId, 90), { code: 'ga4_report_too_large' });
  assert.deepEqual((await ga4.ga4Status('alice', siteId)).report, before);
  globalThis.fetch = async () => Response.json({ rowCount: 50, rows: [] }); await assert.rejects(() => ga4.syncGa4('alice', siteId, 7), { code: 'integration_response_invalid' });
  assert.deepEqual((await ga4.ga4Status('alice', siteId)).report, before);
});
test('GA4 mutation route requires identity and same-origin JSON, status never crosses tenants', async () => {
  const params = { params: Promise.resolve({ siteId, action: 'disconnect' }) };
  globalThis.__integrationHeaders = new Headers(); const none = await route.POST(new Request('https://lumen.test/api/test', { method: 'POST' }), params); assert.equal(none.status, 401);
  globalThis.__integrationHeaders = new Headers({ 'oai-authenticated-user-id': 'alice', 'oai-authenticated-user-email': 'alice@example.test' });
  const foreign = await route.POST(new Request('https://lumen.test/api/test', { method: 'POST', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: '{}' }), params); assert.equal(foreign.status, 403);
  await assert.rejects(() => ga4.ga4Status('bob', siteId), { code: 'not_found' });
  await ga4.disconnectGa4('alice', siteId); const status = await ga4.ga4Status('alice', siteId); assert.equal(status.connected, false); assert.equal(status.report, null);
});
test('OAuth callback preserves fixed workspace redirect, rejects tenant mismatch and never reflects code/state', async () => {
  const callback = await import('../app/api/integrations/ga4/callback/route.ts');
  const started = await ga4.startGa4Connection('alice', siteId), state = new URL(started.url).searchParams.get('state');
  const request = () => new Request(`https://lumen.test/api/integrations/ga4/callback?state=${state}&code=private-fixture-code&return_to=https://evil.test`);
  globalThis.__integrationHeaders = new Headers(); assert.equal((await callback.GET(request())).status, 401);
  globalThis.__integrationHeaders = new Headers({ 'oai-authenticated-user-id': 'bob', 'oai-authenticated-user-email': 'bob@example.test' });
  const wrong = await callback.GET(request()); assert.equal(wrong.status, 303); assert.equal(wrong.headers.get('location'), 'https://lumen.test/dashboard/traffic?ga4=error');
  globalThis.__integrationHeaders = new Headers({ 'oai-authenticated-user-id': 'alice', 'oai-authenticated-user-email': 'alice@example.test' });
  let calls = 0; globalThis.fetch = async () => { calls++; return Response.json(tokens); };
  const result = await callback.GET(request()); assert.equal(result.status, 303); assert.equal(result.headers.get('location'), `https://lumen.test/dashboard/traffic?ga4=connected&site=${siteId}`); assert.equal(result.headers.get('referrer-policy'), 'no-referrer'); assert.equal(result.headers.get('cache-control'), 'no-store');
  const replay = await callback.GET(request()); assert.equal(replay.headers.get('location'), 'https://lumen.test/dashboard/traffic?ga4=error'); assert.equal(calls, 1);
});
test('tampered cached access credentials require reconnection without outbound calls', async () => {
  await db.prepare('UPDATE ga4_connections SET access_cipher=? WHERE site_id=?').bind('v1.invalid.invalid', siteId).run();
  globalThis.fetch = async () => { throw new Error('Corrupted credentials must not be sent'); };
  await assert.rejects(() => ga4.listGa4Properties('alice', siteId), { code: 'integration_credentials_invalid' });
  const status = await ga4.ga4Status('alice', siteId); assert.equal(status.connected, false); assert.equal(status.reconnectRequired, true);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Miniflare } from 'miniflare';

// This journey uses a new in-memory D1 database, invented accounts and static
// provider responses. It never loads env files or forwards a request to an API.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://onboarding.example.test';
const model = 'gemini-3.8-flash';
const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const question = '작은 디자인 팀을 위한 협업 도구를 추천해 주세요.';
const answerText = 'Onboard Fixture는 작은 디자인 팀이 비교해 볼 수 있는 협업 도구입니다. 실제 요구사항에 맞는지 확인하세요.';
const testEnv = {
  LUMEN_PROVIDER_MODE: 'free_only',
  GEMINI_API_KEY: 'onboarding-fixture-only',
  // Configured paid adapters must still be blocked in free mode.
  OPENAI_API_KEY: 'paid-fixture-must-never-run',
  PERPLEXITY_API_KEY: 'paid-fixture-must-never-run',
};
globalThis.__lumenOnboardingEnv = testEnv;
globalThis.__lumenOnboardingHeaders = new Headers();
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env=globalThis.__lumenOnboardingEnv;', shortCircuit: true };
    if (specifier === 'next/headers') return { url: 'data:text/javascript,export async function headers(){return globalThis.__lumenOnboardingHeaders;}', shortCircuit: true };
    if (specifier === 'next/navigation') return { url: 'data:text/javascript,export function redirect(){throw new Error("Unexpected redirect in API fixture");}', shortCircuit: true };
    if (specifier.startsWith('@/')) {
      const base = path.join(root, specifier.slice(2));
      for (const suffix of ['.ts', '/index.ts']) if (existsSync(base + suffix)) return { url: pathToFileURL(base + suffix).href, shortCircuit: true };
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const base = fileURLToPath(new URL(specifier, context.parentURL));
      if (existsSync(base + '.ts')) return { url: pathToFileURL(base + '.ts').href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

let mf, route, eligibilityRoute, usageRoute;
let fixtureOutcome = 'success';
const requests = [];
const unexpectedRequests = [];
const originalFetch = globalThis.fetch;
const owner = 'onboarding-new-user';
function identify(user = owner) {
  globalThis.__lumenOnboardingHeaders = new Headers({ 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@example.test` });
}
async function call(method, resource, body, user = owner) {
  identify(user);
  const request = new Request(`${origin}/api/${resource}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = resource === 'eligibility'
    ? await eligibilityRoute[method](request)
    : resource === 'usage'
      ? await usageRoute[method](request)
      : await route[method](request, { params: Promise.resolve({ path: resource.split('/') }) });
  return { status: response.status, data: await response.json() };
}
async function reservations(user = owner) {
  return (await testEnv.DB.prepare('SELECT count(*) AS count, coalesce(sum(units),0) AS units FROM ai_usage_reservations WHERE owner_id=?').bind(user).first());
}
before(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch(){return new Response("fixture only");} }', d1Databases: { DB: `onboarding-${crypto.randomUUID()}` } });
  testEnv.DB = await mf.getD1Database('DB');
  for (const file of readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort()) {
    for (const statement of readFileSync(path.join(root, 'drizzle', file), 'utf8').split('--> statement-breakpoint').filter(sql => sql.trim())) await testEnv.DB.prepare(statement).run();
  }
  globalThis.fetch = async (url, init) => {
    // No fallback to originalFetch, even for an unexpected URL.
    if (String(url) !== endpoint) { unexpectedRequests.push(String(url)); throw new Error('External request blocked by onboarding fixture'); }
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), body });
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['x-goog-api-key'], testEnv.GEMINI_API_KEY);
    assert.equal(init.redirect, 'manual');
    assert.equal(body.contents[0].parts[0].text, question);
    assert.equal(body.tools, undefined);
    assert.match(body.systemInstruction.parts[0].text, /Web search is unavailable/);
    if (fixtureOutcome === 'rate-limit') return new Response('private fixture error must not reach users', { status: 429 });
    return Response.json({ responseId: 'onboarding-static-fixture', candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: answerText }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 24 } });
  };
  route = await import('../app/api/[[...path]]/route.ts');
  eligibilityRoute = await import('../app/api/eligibility/route.ts');
  usageRoute = await import('../app/api/usage/route.ts');
});
after(async () => {
  globalThis.fetch = originalFetch;
  await mf?.dispose();
  delete globalThis.__lumenOnboardingEnv;
  delete globalThis.__lumenOnboardingHeaders;
});

test('new free user reaches a first saved answer without paid calls or duplicate collection', async t => {
  let siteId, promptId, firstRunId, firstAnswerId;
  await t.test('brand and manual question registration need no provider request or AI allowance', async () => {
    const start = await call('GET', 'bootstrap');
    assert.equal(start.status, 200);
    assert.deepEqual(start.data.sites, []);
    assert.deepEqual(start.data.providers.filter(provider => provider.available).map(provider => provider.model), [model]);
    assert.equal((await call('GET', 'eligibility')).data.eligible, false);
    const invalid = await call('POST', 'sites', { name: 'Onboard Fixture', domain: 'not-a-domain' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.code, 'invalid_input');
    const made = await call('POST', 'sites', { name: 'Onboard Fixture', domain: 'https://www.Onboard.example/product?source=welcome' });
    assert.equal(made.status, 201);
    assert.equal(made.data.site.domain, 'onboard.example');
    assert.equal(made.data.site.description, '');
    assert.equal(made.data.site.industry, '');
    assert.equal(made.data.site.mode, 'live');
    siteId = made.data.site.id;
    const added = await call('POST', `sites/${siteId}/prompts`, { text: question });
    assert.equal(added.status, 201);
    assert.equal(added.data.prompt.text, question);
    assert.equal(added.data.prompt.active, true);
    promptId = added.data.prompt.id;
    const state = await call('GET', `sites/${siteId}/state`);
    assert.equal(state.data.prompts.length, 1);
    assert.deepEqual(state.data.answers, []);
    assert.deepEqual(state.data.runs, []);
    assert.deepEqual(await reservations(), { count: 0, units: 0 });
    const usage = (await call('GET', 'usage')).data;
    assert.equal(usage.available, 10);
    assert.equal(usage.daily.used, 0);
    assert.equal(usage.serviceDaily.used, 0);
    assert.equal(requests.length, 0);
  });

  await t.test('first collection requires explicit complete consent, without spending an allowance', async () => {
    const blocked = await call('POST', `sites/${siteId}/runs`, { mode: 'live', models: [model], promptIds: [promptId] });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.code, 'eligibility_required');
    const incomplete = await call('POST', 'eligibility', { adult: true, korea: true, business: true, understandsDataUse: false });
    assert.equal(incomplete.status, 400);
    assert.equal((await call('GET', 'eligibility')).data.eligible, false);
    const accepted = await call('POST', 'eligibility', { adult: true, korea: true, business: true, understandsDataUse: true });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.eligible, true);
    assert.ok(accepted.data.acceptedAt);
    assert.deepEqual(await reservations(), { count: 0, units: 0 });
    assert.equal(requests.length, 0);
  });

  await t.test('configured paid models remain blocked before reservation or dispatch', async () => {
    for (const paidModel of ['gpt-4.1-mini', 'perplexity/sonar']) {
      const blocked = await call('POST', `sites/${siteId}/runs`, { mode: 'live', models: [paidModel], promptIds: [promptId] });
      assert.equal(blocked.data.code, 'paid_provider_disabled');
      assert.notEqual(blocked.status, 201);
    }
    assert.deepEqual(await reservations(), { count: 0, units: 0 });
    assert.equal(requests.length, 0);
  });

  await t.test('one selected question reserves once, preserves the response, and resumes idempotently', async () => {
    const made = await call('POST', `sites/${siteId}/runs`, { mode: 'live', models: [model], promptIds: [promptId] });
    assert.equal(made.status, 201);
    firstRunId = made.data.run.id;
    assert.equal(made.data.run.status, 'queued');
    assert.equal(made.data.run.total, 1);
    assert.equal(requests.length, 0);
    assert.deepEqual(await reservations(), { count: 1, units: 1 });
    const result = await call('POST', `sites/${siteId}/runs/${firstRunId}/process`);
    assert.equal(result.status, 200);
    assert.equal(result.data.run.status, 'completed');
    assert.equal(result.data.run.completed, 1);
    assert.equal(result.data.run.failed, 0);
    assert.equal(result.data.answers.length, 1);
    const answer = result.data.answers[0];
    firstAnswerId = answer.id;
    assert.equal(answer.text, answerText);
    assert.equal(answer.promptId, promptId);
    assert.equal(answer.model, model);
    assert.equal(answer.providerResponseId, 'onboarding-static-fixture');
    assert.deepEqual(answer.citations, []);
    assert.equal(answer.mentions[0].mentioned, true);
    assert.equal(requests.length, 1);
    const repeat = await call('POST', `sites/${siteId}/runs/${firstRunId}/process`);
    assert.equal(repeat.data.run.status, 'completed');
    assert.equal(requests.length, 1);
    assert.deepEqual(await reservations(), { count: 1, units: 1 });
    const state = (await call('GET', `sites/${siteId}/state`)).data;
    assert.equal(state.answers.length, 1);
    assert.equal(state.answers[0].id, firstAnswerId);
    assert.equal(state.metrics.answerCount, 1);
    assert.equal(state.metrics.mentionRate, 100);
    assert.equal(state.metrics.citationRate, null);
    assert.equal(state.metrics.citationEligibleAnswerCount, 0);
    assert.equal(state.metrics.citationExcludedAnswerCount, 1);
    const usage = (await call('GET', 'usage')).data;
    assert.equal(usage.available, 9);
    assert.equal(usage.daily.used, 1);
    assert.equal(usage.monthly.used, 1);
    assert.equal(usage.serviceDaily.used, 1);
  });

  await t.test('another new user cannot inherit consent, access answers, or spend the first user allowance', async () => {
    const other = 'onboarding-other-user';
    assert.deepEqual((await call('GET', 'bootstrap', undefined, other)).data.sites, []);
    assert.equal((await call('GET', 'eligibility', undefined, other)).data.eligible, false);
    for (const [method, resource, body] of [
      ['GET', `sites/${siteId}/state`],
      ['POST', `sites/${siteId}/runs/${firstRunId}/process`],
      ['POST', `sites/${siteId}/runs`, { mode: 'live', models: [model], promptIds: [promptId] }],
    ]) {
      const response = await call(method, resource, body, other);
      assert.equal(response.status, 404);
      assert.equal(response.data.code, 'not_found');
    }
    const usage = (await call('GET', 'usage', undefined, other)).data;
    assert.equal(usage.daily.used, 0);
    assert.equal(usage.monthly.used, 0);
    assert.equal(usage.serviceDaily.used, 1);
    assert.deepEqual(await reservations(other), { count: 0, units: 0 });
    assert.deepEqual(await reservations(), { count: 1, units: 1 });
    assert.equal(requests.length, 1);
  });

  await t.test('provider failure retains earlier evidence and its reserved allowance without retry or fallback', async () => {
    fixtureOutcome = 'rate-limit';
    const made = await call('POST', `sites/${siteId}/runs`, { mode: 'live', models: [model], promptIds: [promptId] });
    assert.equal(made.status, 201);
    const failedRunId = made.data.run.id;
    const result = await call('POST', `sites/${siteId}/runs/${failedRunId}/process`);
    assert.equal(result.status, 200);
    assert.equal(result.data.run.status, 'failed');
    assert.equal(result.data.run.completed, 0);
    assert.equal(result.data.run.failed, 1);
    assert.equal(result.data.answers[0].status, 'failed');
    assert.equal(result.data.answers[0].text, '');
    assert.ok(result.data.answers[0].error);
    assert.doesNotMatch(result.data.answers[0].error, /private fixture error/);
    assert.equal(requests.length, 2);
    const repeat = await call('POST', `sites/${siteId}/runs/${failedRunId}/process`);
    assert.equal(repeat.data.run.status, 'failed');
    assert.equal(requests.length, 2);
    const state = (await call('GET', `sites/${siteId}/state`)).data;
    assert.equal(state.answers.length, 2);
    assert.equal(state.answers.find(answer => answer.id === firstAnswerId).text, answerText);
    assert.equal(state.answers.filter(answer => answer.status === 'completed').length, 1);
    assert.equal(state.metrics.answerCount, 0);
    assert.equal(state.metrics.failedAnswerCount, 1);
    assert.equal(state.metrics.citationRate, null);
    assert.equal(state.metrics.series.reduce((sum, point) => sum + point.answerCount, 0), 1);
    assert.deepEqual(await reservations(), { count: 2, units: 2 });
    const usage = (await call('GET', 'usage')).data;
    assert.equal(usage.daily.used, 2);
    assert.equal(usage.serviceDaily.used, 2);
    assert.equal(usage.available, 8);
    assert.deepEqual(unexpectedRequests, []);
    assert.equal(requests.every(request => request.url === endpoint), true);
  });
});

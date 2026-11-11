import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Miniflare } from 'miniflare';

// Isolated in-memory database and intercepted provider requests only. No env files
// or real credentials are loaded, and unexpected network requests never forward.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://analysis-scope.example.test';
const model = 'gemini-3.8-flash';
const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const providerText = '검토가 필요한 분석 초안입니다. 제공된 답변을 확인하세요.';
const env = { LUMEN_PROVIDER_MODE: 'free_only', GEMINI_API_KEY: 'analysis-scope-fixture-only' };
globalThis.__lumenAnalysisEnv = env;
globalThis.__lumenAnalysisHeaders = new Headers();
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/lib/runtime-env') return { url: 'data:text/javascript,export const env=globalThis.__lumenAnalysisEnv;', shortCircuit: true };
    if (specifier === 'next/headers') return { url: 'data:text/javascript,export async function headers(){return globalThis.__lumenAnalysisHeaders;}', shortCircuit: true };
    if (specifier === 'next/navigation') return { url: 'data:text/javascript,export function redirect(){throw new Error("Unexpected redirect in analysis fixture");}', shortCircuit: true };
    if (specifier === '@/app/chatgpt-auth') return {url:pathToFileURL(path.join(root,'tests/fixtures/legacy-auth.ts')).href,shortCircuit:true};
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

let mf, route, acceptEligibility;
const requests = [], unexpectedRequests = [];
const originalFetch = globalThis.fetch;
async function call(method, resource, body, owner) {
  globalThis.__lumenAnalysisHeaders = new Headers({ 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@example.test` });
  const request = new Request(`${origin}/api/${resource}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await route[method](request, { params: Promise.resolve({ path: resource.split('/') }) });
  return { status: response.status, data: await response.json() };
}
async function insert(table, row) {
  const columns = Object.keys(row);
  await env.DB.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).bind(...Object.values(row)).run();
}
async function reservations(owner) {
  return (await env.DB.prepare('SELECT count(*) AS count, coalesce(sum(units),0) AS units FROM ai_usage_reservations WHERE owner_id=?').bind(owner).first());
}
before(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch(){return new Response("fixture only");} }', d1Databases: { DB: `analysis-scope-${crypto.randomUUID()}` } });
  env.DB = await mf.getD1Database('DB');
  for (const file of readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort()) {
    for (const statement of readFileSync(path.join(root, 'drizzle', file), 'utf8').split('--> statement-breakpoint').filter(sql => sql.trim())) await env.DB.prepare(statement).run();
  }
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://api.openai.com/v1/responses' && env.LUMEN_PROVIDER_MODE === 'paid_enabled') {
      const body = JSON.parse(init.body);
      requests.push({ body, context: JSON.parse(body.input) });
      return Response.json({ model: 'gpt-6.1-terra', status: 'completed', output: [{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: providerText }] }] });
    }
    if (String(url) !== endpoint) { unexpectedRequests.push(String(url)); throw new Error('Unexpected external request blocked by analysis fixture'); }
    const body = JSON.parse(init.body);
    requests.push({ body, context: JSON.parse(body.contents[0].parts[0].text) });
    return Response.json({ responseId: 'analysis-scope-fixture', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: providerText }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 24 } });
  };
  route = await import('../app/api/[[...path]]/route.ts');
  ({ acceptEligibility } = await import('../lib/eligibility.ts'));
});
after(async () => {
  globalThis.fetch = originalFetch;
  await mf?.dispose();
  delete globalThis.__lumenAnalysisEnv;
  delete globalThis.__lumenAnalysisHeaders;
  assert.deepEqual(unexpectedRequests, []);
});

async function fixture({ mode = 'live', eligible = true } = {}) {
  const owner = `scope-${crypto.randomUUID()}`, siteId = crypto.randomUUID(), otherSiteId = crypto.randomUUID();
  const baseTime = Date.now(), at = days => new Date(baseTime - days * 86_400_000).toISOString();
  for (const id of [siteId, otherSiteId]) await insert('sites', { id, owner_id: owner, name: 'Scopebrand', domain: 'scopebrand.example', language: '한국어', mode, tracking_key: crypto.randomUUID(), created_at: at(0), updated_at: at(0) });
  const rows = [
    { marker: 'recent-own', days: 1, text: 'Scopebrand is suitable.' },
    { marker: 'earlier-run', days: 5, text: 'No tracked brand is recommended.' },
    { marker: 'recent-completion', days: 12, completedDays: 2, text: 'Scopebrand has relevant information.' },
    { marker: 'older-period', days: 12, text: 'Scopebrand appears only in the longer period.' },
    { marker: 'other-model', days: 1, model: 'gpt-4.1-mini', text: 'Scopebrand appears in a different model.' },
    { marker: 'other-mode', days: 1, mode: mode === 'live' ? 'demo' : 'live', text: 'Scopebrand should not cross modes.' },
    { marker: 'failed', days: 1, status: 'failed', text: 'Scopebrand unfinished output must not be evidence.' },
    { marker: 'pending', days: 1, status: 'pending', text: 'Scopebrand pending output must not be evidence.' },
    { marker: 'other-site', days: 1, siteId: otherSiteId, text: 'Scopebrand belongs to a separate workspace.' },
  ];
  for (const row of rows) {
    row.id = crypto.randomUUID();
    row.promptId = crypto.randomUUID();
    row.runId = crypto.randomUUID();
    row.question = `Question for ${row.marker}?`;
    row.text = `${row.text} EVIDENCE_${row.marker}`;
    row.siteId ||= siteId;
    row.model ||= model;
    row.mode ||= mode;
    row.status ||= 'completed';
    row.createdAt = at(row.days);
    row.completedAt = ['pending', 'processing'].includes(row.status) ? null : at(row.completedDays ?? row.days);
    await insert('prompts', { id: row.promptId, site_id: row.siteId, text: row.question, created_at: at(20) });
    await insert('runs', { id: row.runId, site_id: row.siteId, mode: row.mode, status: row.status === 'completed' ? 'completed' : row.status === 'failed' ? 'failed' : 'running', models: JSON.stringify([row.model]), total: 1, completed: Number(row.status === 'completed'), failed: Number(row.status === 'failed'), created_at: row.createdAt, completed_at: row.completedAt });
    await insert('answers', {
      id: row.id, site_id: row.siteId, run_id: row.runId, prompt_id: row.promptId, prompt_text: row.question, model: row.model,
      provider: 'Scope fixture', mode: row.mode, status: row.status, text: row.text, created_at: row.createdAt, completed_at: row.completedAt,
      // Gemini URLs are deliberately present in stored data: an ungrounded model
      // must still contribute no measurement citations to generated analysis.
      citations: JSON.stringify([{ url: `https://evidence.example/${row.marker}`, domain: 'evidence.example', title: row.marker, startIndex: 0, endIndex: 1, provenance: row.mode === 'demo' ? 'synthetic' : 'provider_annotation' }]),
    });
  }
  if (eligible) await acceptEligibility(owner);
  return { owner, siteId, rows, at };
}
function expectedRows(f, period = '7', selectedModel = model) {
  const markers = ['recent-own', 'earlier-run', 'recent-completion', ...(period === '30' ? ['older-period'] : []), ...(selectedModel === 'all' ? ['other-model'] : [])];
  return f.rows.filter(row => markers.includes(row.marker));
}
function assertScope(scope, { period = '7', selectedModel = model, completed = 3, evidence = completed, failed = 1, pending = 1, eligibleCitations = 0 } = {}) {
  assert.equal(scope.period, period);
  assert.equal(scope.model, selectedModel);
  assert.equal(scope.answerCount, completed);
  assert.equal(scope.totalAnswerCount, completed + failed + pending);
  assert.equal(scope.failedAnswerCount, failed);
  assert.equal(scope.pendingAnswerCount, pending);
  assert.equal(scope.evidenceAnswerCount, evidence);
  assert.equal(scope.citationEligibleAnswerCount, eligibleCitations);
  assert.equal(Date.parse(scope.asOf) - Date.parse(scope.from), Number(period) * 86_400_000);
  assert.equal(scope.sourceWindow.days, 30);
  assert.equal(scope.truncated, false);
}
function assertProviderEvidence(context, f, { key = 'evidence', period = '7', selectedModel = model } = {}) {
  const expected = expectedRows(f, period, selectedModel);
  assert.deepEqual(context[key].map(answer => answer.id).sort(), expected.map(answer => answer.id).sort());
  assert.deepEqual([...context.questions].sort(), expected.map(answer => answer.question).sort());
  assert.equal(context.metrics.answerCount, expected.length);
  assert.equal(context.metrics.failedAnswerCount, 1);
  assert.equal(context.metrics.pendingAnswerCount, 1);
  assert.equal(context.metrics.mentionCount, expected.length - 1);
  assert.equal(context.metrics.mentionRate, Math.round((expected.length - 1) / expected.length * 1000) / 10);
  assert.equal(context.metrics.dataMode, 'live');
  assert.equal(context.metrics.series.reduce((sum, day) => sum + day.answerCount, 0), expected.length);
  for (const answer of context[key]) {
    assert.equal(answer.model, expected.find(row => row.id === answer.id).model);
    assert.equal(answer.completedAt, expected.find(row => row.id === answer.id).completedAt);
    if (answer.model === model) assert.deepEqual(answer.citations, []);
  }
  for (const marker of ['other-site', 'other-mode', 'failed', 'pending', ...(period === '7' ? ['older-period'] : []), ...(selectedModel !== 'all' ? ['other-model'] : [])]) assert.ok(!JSON.stringify(context).includes(f.rows.find(row => row.marker === marker).text), `Excluded ${marker} leaked into provider context`);
}

test('reports and content send only selected evidence from all matching runs, then persist scope with the draft', async () => {
  const f = await fixture();
  for (const kind of ['report', 'content']) {
    const beforeCalls = requests.length;
    const result = await call('POST', `sites/${f.siteId}/documents`, { kind, topic: '범위에 맞는 분석', scope: { period: '7', model } }, f.owner);
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(requests.length, beforeCalls + 1);
    const context = requests.at(-1).context;
    assertProviderEvidence(context, f);
    assertScope(context.scope);
    assert.deepEqual(result.data.scope, context.scope);
    assert.equal(result.data.generationModel, model);
    assert.ok(result.data.document.content.includes(providerText));
    assert.match(result.data.document.content, /7일/);
    assert.match(result.data.document.content, /Gemini|gemini/);
    assert.ok(result.data.document.content.includes(context.scope.from));
    assert.ok(result.data.document.content.includes(context.scope.asOf));
    const persisted = await env.DB.prepare('SELECT content FROM documents WHERE id=? AND site_id=?').bind(result.data.document.id, f.siteId).first();
    assert.equal(persisted.content, result.data.document.content);
  }
  assert.deepEqual(await reservations(f.owner), { count: 2, units: 2 });
});

test('assistant evidence, metrics and response metadata share the selected period and model', async () => {
  const f = await fixture();
  const result = await call('POST', `sites/${f.siteId}/assistant`, { message: '어떤 질문을 개선할까요?', scope: { period: '7', model } }, f.owner);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const context = requests.at(-1).context;
  assertProviderEvidence(context, f, { key: 'answers' });
  assertScope(context.scope);
  assert.deepEqual(result.data.scope, context.scope);
  assert.equal(result.data.generationModel, model);
  assert.ok(result.data.message.includes(providerText));
  assert.deepEqual(result.data.citations, []);
  assert.deepEqual(await reservations(f.owner), { count: 1, units: 1 });
});

test('paid generation identifies GPT while retaining the selected Gemini evidence scope', async () => {
  const f = await fixture();
  env.LUMEN_PROVIDER_MODE = 'paid_enabled';
  env.OPENAI_API_KEY = 'analysis-scope-openai-fixture-only';
  try {
    for (const [resource, body, key] of [['documents', { kind: 'report' }, 'evidence'], ['assistant', { message: '선택된 관측 결과를 분석해 주세요.' }, 'answers']]) {
      const result = await call('POST', `sites/${f.siteId}/${resource}`, { ...body, scope: { period: '7', model } }, f.owner);
      assert.ok([200, 201].includes(result.status), JSON.stringify(result.data));
      assert.equal(result.data.generationModel, 'gpt-6.1-terra');
      assert.equal(requests.at(-1).body.model, 'gpt-6.1-terra');
      assertProviderEvidence(requests.at(-1).context, f, { key });
      assertScope(result.data.scope);
      if (result.data.document) assert.match(result.data.document.content, /생성 모델: `gpt-6\.1-terra`/);
    }
    assert.deepEqual(await reservations(f.owner), { count: 2, units: 2 });
  } finally {
    env.LUMEN_PROVIDER_MODE = 'free_only';
    delete env.OPENAI_API_KEY;
  }
});

test('30-day scope retains older runs and omitted scope remains compatible with all-model analysis', async () => {
  const f = await fixture();
  const report = await call('POST', `sites/${f.siteId}/documents`, { kind: 'report', scope: { period: '30', model } }, f.owner);
  assert.equal(report.status, 201, JSON.stringify(report.data));
  assertProviderEvidence(requests.at(-1).context, f, { period: '30' });
  assertScope(report.data.scope, { period: '30', completed: 4 });
  for (const [resource, body, key] of [['documents', { kind: 'report' }, 'evidence'], ['assistant', { message: '기본 분석 범위를 알려주세요.' }, 'answers']]) {
    const result = await call('POST', `sites/${f.siteId}/${resource}`, body, f.owner);
    assert.ok([200, 201].includes(result.status), JSON.stringify(result.data));
    assertProviderEvidence(requests.at(-1).context, f, { key, period: '30', selectedModel: 'all' });
    assertScope(result.data.scope, { period: '30', selectedModel: 'all', completed: 5, eligibleCitations: 1 });
  }
});

test('empty completed samples return scoped unavailable results without provider calls or reservations', async () => {
  const f = await fixture();
  await env.DB.prepare('UPDATE answers SET model=? WHERE id=?').bind('failed-only-model', f.rows.find(row => row.marker === 'failed').id).run();
  const beforeCalls = requests.length;
  for (const selectedModel of ['unobserved-model', 'failed-only-model']) for (const [resource, body] of [['documents', { kind: 'report' }], ['assistant', { message: '선택한 모델을 분석해 주세요.' }]]) {
    const result = await call('POST', `sites/${f.siteId}/${resource}`, { ...body, scope: { period: '7', model: selectedModel } }, f.owner);
    assert.ok([200, 201].includes(result.status), JSON.stringify(result.data));
    assertScope(result.data.scope, { selectedModel, completed: 0, failed: Number(selectedModel === 'failed-only-model'), pending: 0 });
    const text = result.data.document?.content || result.data.message;
    assert.match(text, /완료.*(?:없|0)|표본.*없|측정 불가/);
    assert.doesNotMatch(text, /언급률(?:은|:)?\s*0%/);
  }
  assert.equal(requests.length, beforeCalls);
  assert.deepEqual(await reservations(f.owner), { count: 0, units: 0 });
  const unconsented = await fixture({ eligible: false });
  for (const [resource, body] of [['documents', { kind: 'report' }], ['assistant', { message: '빈 분석 범위를 확인해 주세요.' }]]) {
    const blocked = await call('POST', `sites/${unconsented.siteId}/${resource}`, { ...body, scope: { period: '7', model: 'unobserved-model' } }, unconsented.owner);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.code, 'eligibility_required');
  }
  assert.equal(requests.length, beforeCalls);
  assert.deepEqual(await reservations(unconsented.owner), { count: 0, units: 0 });
});

test('invalid scope is rejected before document writes, provider dispatch or allowance reservation', async () => {
  const f = await fixture();
  const beforeCalls = requests.length;
  for (const scope of [{ period: '365', model }, { period: 7, model }, { period: '7', model: '../invalid model' }, { period: '7', model: ['all'] }, { period: '7', model, siteId: f.siteId }, null]) {
    for (const [resource, body] of [['documents', { kind: 'report' }], ['assistant', { message: '검증할 분석 요청입니다.' }]]) {
      const result = await call('POST', `sites/${f.siteId}/${resource}`, { ...body, scope }, f.owner);
      assert.equal(result.status, 400, JSON.stringify({ scope, result: result.data }));
      assert.equal(result.data.code, 'invalid_input');
    }
  }
  assert.equal(requests.length, beforeCalls);
  assert.deepEqual(await reservations(f.owner), { count: 0, units: 0 });
  assert.equal((await env.DB.prepare('SELECT count(*) AS count FROM documents WHERE site_id=?').bind(f.siteId).first()).count, 0);
});

test('demo reports and assistant use the same scope while preserving synthetic labels and zero AI usage', async () => {
  const f = await fixture({ mode: 'demo', eligible: false });
  const beforeCalls = requests.length;
  for (const [resource, body] of [['documents', { kind: 'report' }], ['assistant', { message: '샘플 분석을 확인해 주세요.' }]]) {
    const result = await call('POST', `sites/${f.siteId}/${resource}`, { ...body, scope: { period: '7', model } }, f.owner);
    assert.ok([200, 201].includes(result.status), JSON.stringify(result.data));
    assertScope(result.data.scope, { eligibleCitations: 3 });
    const text = result.data.document?.content || result.data.message;
    assert.match(text, /합성|샘플/);
    if (result.data.document) assert.match(text, /7일/);
    assert.match(text, /66\.7%/);
    if (result.data.document) assert.equal(result.data.document.mode, 'demo');
  }
  assert.equal(requests.length, beforeCalls);
  assert.deepEqual(await reservations(f.owner), { count: 0, units: 0 });
});

test('evidence excerpt limits do not shrink the full metric denominator or include unselected answers', async () => {
  const f = await fixture();
  const prompt = f.rows[0];
  const expectedIds = new Set(expectedRows(f).map(row => row.id));
  for (let index = 0; index < 4; index++) {
    const id = crypto.randomUUID(), runId = crypto.randomUUID(), at = f.at(0.5 + index / 100);
    expectedIds.add(id);
    await insert('runs', { id: runId, site_id: f.siteId, mode: 'live', status: 'completed', models: JSON.stringify([model]), total: 1, completed: 1, created_at: at, completed_at: at });
    await insert('answers', { id, site_id: f.siteId, run_id: runId, prompt_id: prompt.promptId, prompt_text: prompt.question, model, provider: 'Scope fixture', mode: 'live', status: 'completed', text: `Scopebrand extra evidence ${index}`, created_at: at, completed_at: at });
  }
  for (const [resource, body, key, evidence] of [['documents', { kind: 'report' }, 'evidence', 6], ['assistant', { message: '전체 표본을 분석해 주세요.' }, 'answers', 5]]) {
    const result = await call('POST', `sites/${f.siteId}/${resource}`, { ...body, scope: { period: '7', model } }, f.owner);
    assert.ok([200, 201].includes(result.status), JSON.stringify(result.data));
    const context = requests.at(-1).context;
    assertScope(result.data.scope, { completed: 7, evidence });
    assert.equal(context[key].length, evidence);
    assert.ok(context[key].every(answer => expectedIds.has(answer.id)));
    assert.equal(context.metrics.answerCount, 7);
    assert.equal(context.metrics.mentionCount, 6);
    assert.equal(context.metrics.mentionRate, 85.7);
    assert.equal(context.metrics.series.reduce((sum, day) => sum + day.answerCount, 0), 7);
  }
});

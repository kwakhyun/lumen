import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Pure agent logic only: no database, no network, no model. The engine runs its aggregation-only path.
const root = fileURLToPath(new URL('..', import.meta.url));
registerHooks({
  resolve(specifier, context, next) {
    const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : specifier.startsWith('.') && context.parentURL?.startsWith('file:') ? fileURLToPath(new URL(specifier, context.parentURL)) : null;
    if (base && !path.extname(base) && existsSync(`${base}.ts`)) return { url: pathToFileURL(`${base}.ts`).href, shortCircuit: true };
    return next(specifier, context);
  },
});
const { DEMO_QUESTIONS, syntheticAnswer } = await import('../lib/demo.ts');
const { AGENTS } = await import('../lib/agents/catalog.ts');
const { answerExcerpts, buildAgentEvidence, gapQuestions, sourceKind } = await import('../lib/agents/evidence.ts');
const { emptyDraft, sampleChatReply, writeFromEvidence } = await import('../lib/agents/writers.ts');
const { buildSuggestions, topicBrandMatrix } = await import('../lib/agents/suggestions.ts');
const { executeAgent } = await import('../lib/agents/engine.ts');
const { guestMayRequest } = await import('../lib/auth/guest.ts');
const { readClaudeContent } = await import('../lib/providers-anthropic.ts');

const now = Date.parse('2026-11-13T00:00:00Z');
const site = { id: 'site-1', name: 'Northstar', domain: 'northstar.example', description: '제품팀을 위한 가상의 협업 서비스입니다.', industry: '업무 협업 소프트웨어', language: '한국어', country: 'KR', mode: 'demo', createdAt: new Date(now - 30 * 86400000).toISOString(), updatedAt: new Date(now).toISOString(), trackingKey: 'key' };
const competitors = [['Orbit', 'orbit.example'], ['Tandem', 'tandem.example'], ['Boardly', 'boardly.example']].map(([name, domain], index) => ({ id: `c${index}`, siteId: site.id, name, domain, createdAt: site.createdAt }));
const prompts = DEMO_QUESTIONS.map(([text, topic, intent], index) => ({ id: `p${index}`, siteId: site.id, text, topic, intent, active: true, pinned: false, createdAt: site.createdAt }));
// Two collections inside the last week and one in the week before, so a 7-day scope has a previous window.
const dates = [1, 4, 10].map(days => new Date(now - days * 86400000).toISOString());
const answers = dates.flatMap((date, run) => prompts.flatMap(prompt => ['demo-gemini', 'demo-perplexity'].map(model => syntheticAnswer(site, competitors, prompt, model, `run-${run}`, date))));
const state = { site, prompts, competitors, answers, runs: [], documents: [], tasks: [], personas: [], providers: [], traffic: {}, metrics: {}, dataWindow: { days: 30, answersReturned: answers.length, totalAnswers: answers.length, truncated: false } };
const scope = { period: '30', model: 'all' };

test('agent evidence uses the dashboard sample and keeps numerators with denominators', () => {
  const evidence = buildAgentEvidence(state, scope, now);
  assert.equal(evidence.overview.answerCount, answers.length);
  assert.equal(evidence.overview.mentionCount, answers.filter(answer => answer.mentions[0].mentioned).length);
  assert.equal(evidence.questions.length, prompts.length);
  assert.equal(evidence.questions.reduce((sum, question) => sum + question.answerCount, 0), answers.length);
  assert.deepEqual(evidence.models.map(model => model.answerCount), [answers.length / 2, answers.length / 2]);
  assert.equal(evidence.previous, null, 'a 30-day scope has no earlier window inside the loaded history');
  const week = buildAgentEvidence(state, { period: '7', model: 'all' }, now);
  assert.equal(week.overview.answerCount, prompts.length * 2 * 2);
  assert.equal(week.previous.answerCount, prompts.length * 2);
  const filtered = buildAgentEvidence(state, { period: '30', model: 'demo-gemini' }, now);
  assert.equal(filtered.overview.answerCount, answers.length / 2);
});

test('gap questions require a competitor without the brand and are ordered by share of affected answers', () => {
  const evidence = buildAgentEvidence(state, scope, now), gaps = gapQuestions(evidence, 12);
  assert.ok(gaps.length > 0 && gaps.length < prompts.length, 'sample questions differ in how often the brand is missing');
  assert.ok(gaps.every(question => question.competitorOnlyCount > 0 && question.competitorNames.length > 0));
  const shares = gaps.map(question => question.competitorOnlyCount / question.answerCount);
  assert.deepEqual(shares, [...shares].sort((a, b) => b - a));
  const excerpts = answerExcerpts(state, scope, { promptId: gaps[0].id, limit: 2, only: 'own_missing' }, now);
  assert.ok(excerpts.length > 0 && excerpts.every(excerpt => !excerpt.ownMentioned && excerpt.question === gaps[0].text));
});

test('cited sources are split into own, competitor and third-party domains', () => {
  const evidence = buildAgentEvidence(state, scope, now);
  assert.deepEqual(sourceKind('docs.northstar.example', state), { kind: 'own', owner: 'Northstar' });
  assert.deepEqual(sourceKind('orbit.example', state), { kind: 'competitor', owner: 'Orbit' });
  assert.deepEqual(sourceKind('northstar.example.attacker.test', state), { kind: 'third_party', owner: null });
  assert.ok(evidence.sources.some(source => source.kind === 'third_party'), 'sample answers cite review and community sites');
  assert.ok(evidence.sources.every(source => source.rate >= 0 && source.rate <= 100));
});

test('every agent writes a result from aggregated data without inventing proposals it cannot produce', () => {
  const evidence = buildAgentEvidence(state, scope, now);
  for (const agent of AGENTS) {
    const draft = writeFromEvidence(agent.id, { evidence, state, scope, input: agent.id === 'content-draft' ? { topic: '팀 협업 도구 선택 기준' } : {}, asOf: now });
    assert.ok(draft.title.length > 1 && draft.summary.length > 10 && draft.report.length > 80, agent.id);
    assert.doesNotMatch(draft.report, /undefined|NaN|\[object/, agent.id);
    assert.ok(draft.proposals.every(proposal => proposal.title.length > 2 && ['task', 'prompt'].includes(proposal.kind)), agent.id);
    if (agent.id === 'prompt-discovery') assert.ok(draft.proposals.every(proposal => proposal.kind === 'prompt' && !prompts.some(prompt => prompt.text === proposal.title)));
  }
  const report = writeFromEvidence('brand-health', { evidence, state, scope, input: {}, asOf: now }).report;
  assert.ok(report.includes(`언급 ${evidence.overview.mentionCount} / 완료 답변 ${evidence.overview.answerCount}`));
  assert.match(report, /합성 샘플 데이터/);
});

test('an empty scope yields no analysis and no usage', async () => {
  const evidence = buildAgentEvidence({ ...state, answers: [] }, scope, now);
  assert.match(emptyDraft('질문 격차 분석', evidence).summary, /차감되지 않았어요/);
  const events = []; let reserved = 0;
  const result = await executeAgent({ agent: AGENTS.find(agent => agent.id === 'gap-analysis'), state: { ...state, answers: [] }, scope, input: {}, emit: event => events.push(event), model: 'gemini-3.8-flash', reserve: async () => { reserved += 1; return 2; }, asOf: now });
  assert.equal(result.units, 0); assert.equal(result.model, null); assert.equal(reserved, 0);
  assert.deepEqual(result.draft.proposals, []);
});

test('an aggregation-only run walks every step in order and reserves nothing', async () => {
  const agent = AGENTS.find(item => item.id === 'brand-health'), events = [];
  const result = await executeAgent({ agent, state, scope, input: {}, emit: event => events.push(event), model: null, reserve: async () => { throw new Error('must not reserve'); }, asOf: now });
  assert.equal(result.units, 0); assert.equal(result.model, null);
  assert.deepEqual(result.steps.map(step => step.status), agent.steps.map(() => 'done'));
  const done = events.filter(event => event.type === 'step' && event.status === 'done').map(event => event.id);
  assert.deepEqual(done, agent.steps.map(step => step.id));
  assert.ok(result.draft.report.length > 200);
});

test('a failed model request falls back to the aggregated result instead of failing the run', async () => {
  const { ProductError } = await import('../lib/product-validation.ts');
  const agent = AGENTS.find(item => item.id === 'weekly-report');
  const result = await executeAgent({ agent, state, scope, input: {}, emit() {}, model: 'gemini-3.8-flash', reserve: async () => { throw new ProductError(429, 'exhausted', 'ai_usage_exhausted'); }, asOf: now });
  assert.equal(result.model, null);
  assert.match(result.draft.summary, /^AI 사용 한도에 도달해 집계 기반 결과로 대신했어요\./);
  await assert.rejects(() => executeAgent({ agent, state, scope, input: {}, emit() {}, model: 'gemini-3.8-flash', reserve: async () => { throw new ProductError(403, 'consent', 'eligibility_required'); }, asOf: now }), { code: 'eligibility_required' });
});

test('home suggestions come from the same numbers and lead with the largest gap', () => {
  const evidence = buildAgentEvidence(state, scope, now), suggestions = buildSuggestions(state, evidence, [], now);
  assert.ok(suggestions.length > 0 && suggestions.length <= 5);
  assert.equal(suggestions[0].action.agentId, 'gap-analysis');
  assert.equal(suggestions[0].action.input.promptId, gapQuestions(evidence, 1)[0].id);
  assert.ok(suggestions.some(item => item.id === 'weekly'));
  const reported = [{ agentId: 'weekly-report', status: 'completed', createdAt: new Date(now - 86400000).toISOString() }];
  assert.ok(!buildSuggestions(state, evidence, reported, now).some(item => item.id === 'weekly'));
  const stale = buildSuggestions({ ...state, competitors: [] }, buildAgentEvidence({ ...state, competitors: [] }, scope, now), [], now + 20 * 86400000);
  assert.ok(stale.some(item => item.id === 'stale') && stale.some(item => item.id === 'competitors'));
});

test('the topic matrix reports each brand over the same completed answers', () => {
  const matrix = topicBrandMatrix(state, answers);
  assert.equal(matrix.brands[0].isOwn, true);
  assert.equal(matrix.rows.reduce((sum, row) => sum + row.answers, 0), answers.length);
  assert.ok(matrix.rows.every(row => row.rates.length === matrix.brands.length && row.rates.every(rate => rate >= 0 && rate <= 100)));
  const own = matrix.rows.map(row => row.rates[0]);
  assert.deepEqual(own, [...own].sort((a, b) => a - b), 'weakest topic first');
});

test('sample chat answers quote the scope numbers and never call a model', () => {
  const evidence = buildAgentEvidence(state, scope, now);
  const reply = sampleChatReply('경쟁사와 비교해 부족한 점은?', { evidence, state, scope, input: {}, asOf: now });
  assert.ok(reply.includes(`${evidence.overview.mentionRate}%`));
  assert.match(reply, /샘플 데이터/); assert.match(reply, /경쟁사 인사이트/);
});

test('a guest may read everything but write only to the two sample endpoints', () => {
  const siteId = 'd0000000-0000-4000-8000-000000000001';
  assert.equal(guestMayRequest('GET', '/api/bootstrap'), true);
  assert.equal(guestMayRequest('HEAD', `/api/sites/${siteId}/state`), true);
  assert.equal(guestMayRequest('POST', `/api/sites/${siteId}/agents`), true);
  assert.equal(guestMayRequest('POST', `/api/sites/${siteId}/assistant`), true);
  for (const [method, target] of [['POST', '/api/sites'], ['POST', '/api/demo'], ['POST', `/api/sites/${siteId}/runs`], ['PATCH', `/api/sites/${siteId}/agents/run`], ['DELETE', `/api/sites/${siteId}`], ['POST', `/api/sites/${siteId}/agents/x/document`], ['POST', '/api/eligibility'], [null, null], ['', '']]) assert.equal(guestMayRequest(method, target), false, `${method} ${target}`);
});

test('Claude citations come only from typed search annotations and keep fragment offsets', () => {
  const parsed = readClaudeContent([
    { type: 'thinking', thinking: 'hidden' },
    { type: 'text', text: 'Northstar는 ' },
    { type: 'text', text: '로드맵 도구입니다.', citations: [{ type: 'web_search_result_location', url: 'https://www.review.example/tools?ref=1', title: '리뷰' }, { type: 'char_location', url: 'https://ignored.example' }, { type: 'web_search_result_location', url: 'javascript:alert(1)', title: 'bad' }] },
    { type: 'web_search_tool_result', content: [] },
  ]);
  assert.equal(parsed.text, 'Northstar는 로드맵 도구입니다.');
  assert.equal(parsed.citations.length, 1);
  assert.deepEqual({ ...parsed.citations[0] }, { url: 'https://www.review.example/tools?ref=1', title: '리뷰', domain: 'review.example', startIndex: 'Northstar는 '.length, endIndex: parsed.text.length, provenance: 'provider_annotation' });
});

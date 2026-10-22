import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics, extractMentions, measuredCitations, citationMeasurementAvailable } from '../lib/metrics.ts';

const site = { name: 'Acme', domain: 'acme.com', mode: 'live' };
const questions = [{ id: 'q1', active: true }, { id: 'q2', active: true }, { id: 'q3', active: false }];
const citation = (domain = 'acme.com', provenance = 'provider_annotation') => ({ url: `https://${domain}/guide`, domain, title: 'Guide', startIndex: 0, endIndex: 4, provenance });
const answer = (id, props = {}) => ({ id, mode: 'live', model: 'gpt-4.1-mini', provider: 'OpenAI API', status: 'completed', promptId: 'q1', createdAt: '2026-10-22T10:00:00Z', completedAt: null, citations: [], mentions: [], ...props });
const mention = (domain = 'acme.com', props = {}) => ({ name: 'Acme', domain, mentioned: true, cited: false, rank: 1, firstPosition: 0, ...props });
const metric = (answers, competitors = [], prompts = questions) => computeMetrics(site, competitors, answers, prompts);

test('empty and unsupported-only data are unavailable while supported zero is observed zero', () => {
  const empty = metric([]);
  assert.equal(empty.citationRate, null);
  assert.equal(empty.citationEligibleAnswerCount, 0);
  assert.equal(empty.answerCount, 0);
  const unsupported = metric([answer('g', { model: 'gemini-3.8-flash', provider: 'Gemini API', citations: [citation()], mentions: [mention()] })]);
  assert.equal(unsupported.mentionRate, 100);
  assert.equal(unsupported.citationRate, null);
  assert.equal(unsupported.citationCount, 0);
  assert.equal(unsupported.citationExcludedAnswerCount, 1);
  assert.deepEqual(unsupported.sources, []);
  assert.equal(unsupported.series[0].citationRate, null);
  const zero = metric([answer('openai')]);
  assert.equal(zero.citationRate, 0);
  assert.equal(zero.citationEligibleAnswerCount, 1);
  assert.equal(zero.series[0].citationRate, 0);
});

test('mixed models use only eligible completed answers for citation denominator and retain exact counts', () => {
  const rows = [answer('search-yes', { citations: [citation()] }), answer('search-no', { model: 'perplexity/sonar' }), ...Array.from({ length: 8 }, (_, i) => answer(`g${i}`, { model: 'gemini-3.8-flash' })), answer('failed', { status: 'failed', citations: [citation()] }), answer('pending', { status: 'processing' })];
  const value = metric(rows);
  assert.equal(value.metricsVersion, 'lumen-metrics-v2');
  assert.equal(value.totalAnswerCount, 12);
  assert.equal(value.answerCount, 10);
  assert.equal(value.failedAnswerCount, 1);
  assert.equal(value.pendingAnswerCount, 1);
  assert.equal(value.citationCount, 1);
  assert.equal(value.citationEligibleAnswerCount, 2);
  assert.equal(value.citationExcludedAnswerCount, 8);
  assert.equal(value.citationRate, 50);
  assert.equal(value.brands[0].citationRate, 50);
  assert.equal(value.series[0].citationRate, 50);
  assert.equal(value.series[0].citationEligibleAnswerCount, 2);
});

test('duplicate answer IDs, brand domains and annotation domains cannot inflate counts', () => {
  const row = answer('same', { mentions: [mention(), mention('WWW.ACME.COM'), mention('rival.com')], citations: [citation(), citation(), citation('www.acme.com')] });
  const value = metric([row, row], [{ name: 'Duplicate', domain: 'WWW.ACME.COM' }, { name: 'Rival', domain: 'rival.com' }, { name: 'Duplicate rival', domain: 'rival.com' }]);
  assert.equal(value.answerCount, 1);
  assert.equal(value.duplicateAnswerCount, 1);
  assert.equal(value.brands.length, 2);
  assert.equal(value.brands[0].name, 'Acme');
  assert.equal(value.mentionCount, 1);
  assert.equal(value.mentionRate, 100);
  assert.equal(value.shareOfVoice, 50);
  assert.equal(value.citationRate, 100);
  assert.equal(value.sources.length, 1);
  assert.equal(value.sources[0].citations, 1);
  assert.equal(value.series[0].answerCount, 1);
  const mentions = extractMentions('Acme follows Rival.', [], [site, { name: 'Duplicate', domain: 'WWW.ACME.COM' }, { name: 'Rival', domain: 'rival.com' }]);
  assert.equal(mentions.length, 2);
  assert.deepEqual(mentions.map(m => m.rank), [1, 2]);
});

test('collection coverage and brand question coverage differ and only active unique questions count', () => {
  const rows = [answer('1', { promptId: 'q1' }), answer('2', { promptId: 'q2', mentions: [mention()] }), answer('3', { promptId: 'q2', mentions: [mention()] }), answer('4', { promptId: 'q3', mentions: [mention()] })];
  const value = metric(rows);
  assert.equal(value.promptCount, 2);
  assert.equal(value.completedPromptCount, 2);
  assert.equal(value.mentionedPromptCount, 1);
  assert.equal(value.coverage, 100);
  assert.equal(value.brandQuestionCoverage, 50);
  const missing = metric([answer('failed', { promptId: 'q1', status: 'failed', mentions: [mention()] }), answer('ok', { promptId: 'q2' })]);
  assert.equal(missing.coverage, 50);
  assert.equal(missing.brandQuestionCoverage, 0);
  assert.equal(metric(rows, [], []).brandQuestionCoverage, null);
});

test('citations require known capability, matching provenance and real URL hostname', () => {
  const rows = [citation('docs.acme.com'), citation('acme.com.attacker.test'), citation('acme.com', 'synthetic'), { ...citation(), url: 'https://evil.test', domain: 'acme.com' }, { ...citation(), url: 'javascript:alert(1)' }];
  const row = answer('proof', { citations: rows, mentions: [mention('acme.com', { mentioned: false, cited: true })] });
  const value = metric([row]);
  assert.equal(value.citationRate, 100);
  assert.equal(value.mentionRate, 0);
  assert.deepEqual(value.sources.map(s => s.domain), ['docs.acme.com', 'acme.com.attacker.test']);
  assert.equal(metric([answer('forged', { mentions: [mention('acme.com', { cited: true })] })]).citationRate, 0);
  assert.equal(metric([answer('lookalike', { citations: [citation('acme.com.attacker.test')] })]).citationRate, 0);
  assert.equal(citationMeasurementAvailable(answer('unknown', { model: 'unknown' })), false);
  assert.deepEqual(measuredCitations(answer('unknown', { model: 'unknown', citations: [citation()] })), []);
});

test('synthetic and live observations never blend in rates or history', () => {
  const demo = answer('demo', { mode: 'demo', model: 'demo-gemini', citations: [citation('acme.com', 'synthetic')], mentions: [mention()] });
  const live = answer('live');
  const value = metric([live, demo]);
  assert.equal(value.dataMode, 'live');
  assert.equal(value.excludedModeAnswerCount, 1);
  assert.equal(value.answerCount, 1);
  assert.equal(value.mentionRate, 0);
  assert.equal(value.citationRate, 0);
  assert.equal(value.series[0].answerCount, 1);
  const sample = computeMetrics({ ...site, mode: 'demo' }, [], [demo, live], questions);
  assert.equal(sample.dataMode, 'demo');
  assert.equal(sample.mentionRate, 100);
  assert.equal(sample.citationRate, 100);
  assert.equal(sample.excludedModeAnswerCount, 1);
});

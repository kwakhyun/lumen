import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardHref, filterDashboardAnswers, readDashboardScope } from '../lib/dashboard-scope.ts';
import { computeMetrics } from '../lib/metrics.ts';

const now = Date.parse('2026-11-11T03:00:00Z');
const day = 86_400_000;
const site = { id: 'site-a', name: 'Acme', domain: 'acme.com', mode: 'live' };
const scope = { period: '7', model: 'all' };
const atDaysAgo = days => new Date(now - days * day).toISOString();
const answer = (id, props = {}) => ({
  id, siteId: site.id, runId: `run-${id}`, promptId: 'prompt-a', promptText: 'Compare tools',
  mode: 'live', model: 'gemini-3.8-flash', provider: 'Gemini API', status: 'completed',
  createdAt: atDaysAgo(1), completedAt: null, citations: [], mentions: [], ...props,
});
const ids = rows => rows.map(row => row.id);

test('scope parsing accepts supported periods and model syntax, and rejects malformed or repeated values', () => {
  assert.deepEqual(readDashboardScope({}), { period: '30', model: 'all' });
  assert.deepEqual(readDashboardScope({ period: '7', model: 'perplexity/sonar' }), { period: '7', model: 'perplexity/sonar' });
  assert.deepEqual(readDashboardScope({ period: '30', model: 'gemini-3.8-flash' }), { period: '30', model: 'gemini-3.8-flash' });
  for (const period of ['0', '-7', '365', '', ['7'], ['7', '30']]) {
    assert.equal(readDashboardScope({ period }).period, '30');
  }
  for (const model of ['', ' Gemini', 'Gemini Flash', 'gpt&site=other', 'gpt?x=1', '<script>', ['gpt'], 'a'.repeat(101)]) {
    assert.equal(readDashboardScope({ model }).model, 'all');
  }
  assert.equal(readDashboardScope({ model: 'a'.repeat(100) }).model, 'a'.repeat(100));
});

test('dashboard navigation preserves period, model and workspace, and deep-links retain the selected question', () => {
  const selected = { period: '7', model: 'perplexity/sonar' };
  for (const section of ['overview', 'prompts', 'competitors', 'sources', 'actions', 'settings']) {
    const target = new URL(dashboardHref(section, selected, 'workspace-id', 'prompt-id'), 'https://lumen.example');
    assert.equal(target.pathname, section === 'overview' ? '/dashboard' : `/dashboard/${section}`);
    assert.equal(target.searchParams.get('site'), 'workspace-id');
    assert.equal(target.searchParams.get('period'), '7');
    assert.equal(target.searchParams.get('model'), 'perplexity/sonar');
    assert.equal(target.searchParams.get('prompt'), 'prompt-id');
    assert.deepEqual(readDashboardScope(Object.fromEntries(target.searchParams)), selected);
  }
  const defaults = new URL(dashboardHref('overview', { period: '30', model: 'all' }), 'https://lumen.example');
  assert.equal(defaults.searchParams.get('period'), '30');
  assert.equal(defaults.searchParams.has('model'), false);
  assert.equal(defaults.searchParams.has('site'), false);
  assert.equal(defaults.searchParams.has('prompt'), false);
  const escaped = new URL(dashboardHref('prompts', selected, 'site&extra=1', 'q#id'), 'https://lumen.example');
  assert.equal(escaped.searchParams.get('site'), 'site&extra=1');
  assert.equal(escaped.searchParams.get('prompt'), 'q#id');
  assert.equal(escaped.searchParams.has('extra'), false);
});

test('seven- and thirty-day windows retain every matching run, including the inclusive cutoff', () => {
  const rows = [answer('latest'), answer('previous-run', { createdAt: atDaysAgo(3) }), answer('at-seven', { createdAt: atDaysAgo(7) }), answer('eight-days', { createdAt: atDaysAgo(8) }), answer('at-thirty', { createdAt: atDaysAgo(30) }), answer('too-old', { createdAt: new Date(now - 30 * day - 1).toISOString() })];
  assert.deepEqual(ids(filterDashboardAnswers(rows, scope, now, site)), ['latest', 'previous-run', 'at-seven']);
  assert.deepEqual(ids(filterDashboardAnswers(rows, { ...scope, period: '30' }, now, site)), ['latest', 'previous-run', 'at-seven', 'eight-days', 'at-thirty']);
  assert.equal(new Set(filterDashboardAnswers(rows, scope, now, site).map(row => row.runId)).size, 3);
});

test('completion timestamps define the window while unfinished observations use their creation timestamp', () => {
  const rows = [
    answer('late-completion', { createdAt: atDaysAgo(10), completedAt: atDaysAgo(2) }),
    answer('old-completion', { createdAt: atDaysAgo(1), completedAt: atDaysAgo(9) }),
    answer('processing', { status: 'processing', createdAt: atDaysAgo(2) }),
    answer('timezone-boundary', { createdAt: '2026-11-04T12:00:00+09:00' }),
    answer('invalid', { createdAt: 'not-a-date' }),
    answer('invalid-completion', { createdAt: atDaysAgo(1), completedAt: 'not-a-date' }),
  ];
  assert.deepEqual(ids(filterDashboardAnswers(rows, scope, now, site)), ['late-completion', 'processing', 'timezone-boundary']);
});

test('model, site and data mode are isolated without mutating or reordering the supplied observations', () => {
  const rows = [answer('gemini'), answer('openai', { model: 'gpt-4.1-mini' }), answer('foreign', { siteId: 'site-b' }), answer('demo', { mode: 'demo' })];
  const original = structuredClone(rows);
  assert.deepEqual(ids(filterDashboardAnswers(rows, scope, now, site)), ['gemini', 'openai']);
  assert.deepEqual(ids(filterDashboardAnswers(rows, { ...scope, model: 'gpt-4.1-mini' }, now, site)), ['openai']);
  assert.deepEqual(filterDashboardAnswers(rows, { ...scope, model: 'unknown' }, now, site), []);
  assert.deepEqual(ids(filterDashboardAnswers(rows, scope, now, { ...site, mode: 'demo' })), ['demo']);
  assert.deepEqual(rows, original);
});

test('failed and unfinished answers stay visible but never increase the measured denominator', () => {
  const mention = { name: 'Acme', domain: 'acme.com', mentioned: true, cited: false, rank: 1, firstPosition: 0 };
  const rows = filterDashboardAnswers([
    answer('mention', { mentions: [mention] }), answer('unmentioned'),
    answer('failed', { status: 'failed', mentions: [mention] }),
    answer('pending', { status: 'pending' }), answer('processing', { status: 'processing' }),
  ], scope, now, site);
  assert.equal(rows.length, 5);
  const metrics = computeMetrics(site, [], rows, [{ id: 'prompt-a', active: true }]);
  assert.equal(metrics.answerCount, 2);
  assert.equal(metrics.failedAnswerCount, 1);
  assert.equal(metrics.pendingAnswerCount, 2);
  assert.equal(metrics.mentionCount, 1);
  assert.equal(metrics.mentionRate, 50);
  assert.equal(metrics.series.reduce((sum, point) => sum + point.answerCount, 0), 2);
});

test('duplicate IDs cannot inflate observations, and excluded duplicates cannot hide valid evidence', () => {
  const valid = answer('same');
  const rows = [answer('same', { mode: 'demo' }), answer('same', { siteId: 'other' }), answer('same', { createdAt: atDaysAgo(50) }), valid, valid, answer('distinct')];
  assert.deepEqual(ids(filterDashboardAnswers(rows, scope, now, site)), ['same', 'distinct']);
  assert.equal(filterDashboardAnswers(rows, scope, now, site)[0], valid);
});

test('answers completed after the mounted clock remain visible when a new collection refreshes state', () => {
  const row = answer('new-collection', { createdAt: new Date(now + 1_000).toISOString(), completedAt: new Date(now + 5_000).toISOString() });
  assert.deepEqual(ids(filterDashboardAnswers([row], scope, now, site)), ['new-collection']);
});

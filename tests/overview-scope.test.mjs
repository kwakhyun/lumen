import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { computeMetrics } from '../lib/metrics.ts';
import { filterDashboardAnswers } from '../lib/dashboard-scope.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
registerHooks({
  resolve(specifier, context, next) {
    const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : specifier.startsWith('.') && context.parentURL?.startsWith('file:') ? fileURLToPath(new URL(specifier, context.parentURL)) : null;
    if (base) for (const suffix of ['.ts', '.tsx']) if (existsSync(base + suffix)) return { url: pathToFileURL(base + suffix).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith('.tsx') || !url.startsWith(pathToFileURL(root).href)) return next(url, context);
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
  },
});
const { default: OverviewScope, latestCompletedAnswer } = await import('../components/dashboard/overview-scope.tsx');
const site = { id: 'site', name: 'Acme', domain: 'acme.com', mode: 'live' };
const scope = { period: '7', model: 'gemini-3.8-flash' };
const prompts = [{ id: 'q1', active: true }];
const answer = (id, extra = {}) => ({ id, siteId: site.id, runId: 'run', promptId: 'q1', mode: 'live', model: scope.model, status: 'completed', createdAt: '2026-11-10T23:00:00Z', completedAt: '2026-11-10T23:30:00Z', citations: [], mentions: [{ name: 'Acme', domain: 'acme.com', mentioned: true, rank: 1, firstPosition: 0 }], ...extra });
function render(answers, selected = scope) {
  return renderToStaticMarkup(React.createElement(OverviewScope, { metrics: computeMetrics(site, [], answers, prompts), answers, scope: selected, filters: React.createElement('span', null, 'Filter control') }));
}

test('overview keeps the rate, sample, selected scope and latest completed evidence together', () => {
  const rows = [
    answer('selected'),
    answer('failed', { status: 'failed', completedAt: '2026-11-11T01:00:00Z' }),
    answer('other-model', { model: 'gpt-4.1-mini', completedAt: '2026-11-11T02:00:00Z' }),
    answer('other-site', { siteId: 'other-site', completedAt: '2026-11-11T02:00:00Z' }),
    answer('old', { completedAt: '2026-10-01T00:00:00Z' }),
  ];
  const selected = filterDashboardAnswers(rows, scope, Date.parse('2026-11-11T03:00:00Z'), site);
  const html = render(selected);
  assert.match(html, /100<small>%<\/small>/);
  assert.match(html, /브랜드 언급 <b>1개<\/b>/);
  assert.match(html, /완료 답변 <b>1개<\/b>/);
  assert.match(html, /최근 7일/);
  assert.match(html, /Gemini 3.8 Flash/);
  assert.match(html, /dateTime="2026-11-10T23:30:00.000Z"/);
  assert.match(html, /11월 11일 08:30/);
  assert.match(html, />KST</);
  assert.match(html, /Filter control/);
});

test('newer failures, pending answers and another mode never replace completed evidence time', () => {
  const rows = [answer('done'), answer('failed', { status: 'failed', completedAt: '2026-11-11T02:00:00Z' }), answer('pending', { status: 'processing', completedAt: '2026-11-11T02:00:00Z' }), answer('demo', { mode: 'demo', completedAt: '2026-11-11T02:00:00Z' })];
  assert.equal(latestCompletedAnswer(rows, 'live').at, '2026-11-10T23:30:00.000Z');
  const html = render(rows.slice(1, 3));
  assert.match(html, /이 조건에서 완료한 답변 없음/);
  assert.doesNotMatch(html, /<time|>0<small>%/);
});

test('latest completion compares timestamps and preserves metric duplicate boundaries', () => {
  const rows = [answer('same', { status: 'failed' }), answer('same', { completedAt: '2026-11-12T00:00:00Z' }), answer('early', { completedAt: '2026-11-11T08:00:00+09:00' }), answer('late', { completedAt: '2026-11-10T23:30:00Z' })];
  assert.equal(latestCompletedAnswer(rows, 'live').at, '2026-11-10T23:30:00.000Z');
});

test('missing completion timestamps use a labeled collection-time fallback and never fabricate a date', () => {
  const fallback = answer('legacy', { completedAt: null });
  assert.equal(latestCompletedAnswer([fallback], 'live').collectedAtFallback, true);
  assert.match(render([fallback]), /KST \/ 수집 시각/);
  const invalid = answer('invalid', { completedAt: 'bad', createdAt: 'bad' });
  assert.equal(latestCompletedAnswer([invalid], 'live'), null);
  assert.match(render([invalid]), /수집 시각 기록 없음/);
  assert.doesNotMatch(render([invalid]), /Invalid Date|<time/);
});

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

const root = fileURLToPath(new URL('..', import.meta.url));
registerHooks({
  resolve(specifier, context, next) {
    const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : specifier.startsWith('.') && context.parentURL?.startsWith('file:') ? fileURLToPath(new URL(specifier, context.parentURL)) : null;
    if (base) for (const suffix of ['.ts', '.tsx']) if (existsSync(base + suffix)) return { url: pathToFileURL(base + suffix).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' };
    if (!url.endsWith('.tsx') || !url.startsWith(pathToFileURL(root).href)) return next(url, context);
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
  },
});

const { default: Sources, SourceEvidence } = await import('../components/dashboard/sections/sources.tsx');
const { sourceEvidence } = await import('../components/dashboard/source-evidence.ts');
const citation = (url, extra = {}) => ({ url, domain: new URL(url).hostname, title: 'Original source', provenance: 'provider_annotation', ...extra });
const answer = (id, citations, extra = {}) => ({ id, siteId: 'site', runId: 'run', promptId: 'q1', promptText: 'Original collected question', mode: 'live', model: 'gpt-4.1-mini', status: 'completed', createdAt: '2026-11-11T00:00:00Z', completedAt: null, citations, mentions: [], ...extra });
const site = { name: 'Acme', domain: 'acme.com', mode: 'live' };
const prompts = [{ id: 'q1', text: 'Current edited question', active: true }];

test('source rates use eligible completed answers instead of the largest source count', () => {
  const first = answer('first', [citation('https://acme.com/a'), citation('https://acme.com/b'), citation('https://acme.com/a')]);
  const rows = [first, first, answer('second', [citation('https://other.com/')]), answer('ungrounded', [], { model: 'gemini-3.8-flash' }), answer('failed', [], { status: 'failed' })];
  const metrics = computeMetrics(site, [], rows, prompts);
  const html = renderToStaticMarkup(React.createElement(Sources, { metrics, citationUnavailable: false, answers: rows, prompts, onPrompt() {}, onObserve() {} }));
  assert.equal(metrics.citationEligibleAnswerCount, 2);
  assert.equal(metrics.sources.find(source => source.domain === 'acme.com').citations, 1);
  assert.equal((html.match(/<strong>50%<\/strong>/g) || []).length, 2);
  assert.equal((html.match(/1 \/ 2개 답변/g) || []).length, 2);
  assert.doesNotMatch(html, /<strong>100%<\/strong>/);
});

test('source drilldown preserves original URLs but counts one row per completed answer in the correct mode', () => {
  const first = answer('a', [citation('https://acme.com/a'), citation('https://www.acme.com/b'), citation('https://acme.com/a'), citation('https://acme.com/forged', { provenance: 'synthetic' }), citation('https://attacker.test/wrong', { domain: 'acme.com' })]);
  const rows = sourceEvidence([
    first, first,
    answer('failed', [citation('https://acme.com/failed')], { status: 'failed' }),
    answer('ungrounded', [citation('https://acme.com/generated')], { model: 'gemini-3.8-flash' }),
    answer('demo', [citation('https://acme.com/demo', { provenance: 'synthetic' })], { mode: 'demo' }),
  ], 'WWW.ACME.COM.', 'live');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].citations.map(item => item.url), ['https://acme.com/a', 'https://www.acme.com/b']);
  const html = renderToStaticMarkup(React.createElement(SourceEvidence, { rows, prompts, onPrompt() {} }));
  assert.match(html, /Original collected question/);
  assert.doesNotMatch(html, /Current edited question|forged|attacker|generated/);
  assert.match(html, /href="https:\/\/acme.com\/a"/);
  assert.match(html, /href="https:\/\/www.acme.com\/b"/);
  assert.match(html, /GPT-4.1 mini/);
  assert.match(html, /답변 원문 보기/);
});

test('source drilldown keeps removed-question evidence and labels synthetic citations separately', () => {
  const rows = sourceEvidence([answer('demo', [citation('https://acme.com/demo', { provenance: 'synthetic' })], { mode: 'demo' })], 'acme.com', 'demo');
  const html = renderToStaticMarkup(React.createElement(SourceEvidence, { rows, prompts: [], onPrompt() {} }));
  assert.match(html, /합성 샘플/);
  assert.match(html, /현재 질문 목록에는 없지만/);
  assert.match(html, /href="https:\/\/acme.com\/demo"/);
  assert.doesNotMatch(html, /답변 원문 보기/);
});

test('unsupported citation collection provides a manual observation path instead of a false zero', () => {
  const answers = [answer('gemini', [], { model: 'gemini-3.8-flash' })];
  const metrics = computeMetrics(site, [], answers, prompts);
  const html = renderToStaticMarkup(React.createElement(Sources, { metrics, citationUnavailable: true, answers, prompts, onPrompt() {}, onObserve() {} }));
  assert.match(html, /현재 답변은 검색 인용을 제공하지 않아요/);
  assert.match(html, /실제 검색 관측 기록/);
  assert.doesNotMatch(html, /<strong>0%<\/strong>/);
});

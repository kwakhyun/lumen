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
    if (!url.endsWith('.tsx') || !url.startsWith(pathToFileURL(root).href)) return next(url, context);
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
  },
});
const { default: Overview } = await import('../components/dashboard/sections/overview.tsx');
const { ownMention } = await import('../components/dashboard/prompt-evidence.ts');
const site = { name: 'Acme', domain: 'acme.com', mode: 'live' };
const prompts = [{ id: 'q1', text: 'Which tool should I use?', active: true, intent: 'comparison', pinned: false }];
const answer = (id, model, extra = {}) => ({ id, mode: 'live', model, status: 'completed', promptId: 'q1', createdAt: '2026-10-22T10:00:00Z', completedAt: null, citations: [], mentions: [], ...extra });
function html(answers, history = answers) {
  const metrics = computeMetrics(site, [], answers, prompts, history);
  const state = { site, prompts, competitors: [], answers, tasks: [], metrics };
  return renderToStaticMarkup(React.createElement(Overview, { state, metrics, answers, filters: null, navigate() {}, openPrompt() {}, openForm() {} }));
}
test('overview presents unsupported citations as unavailable and exposes denominator exclusions', () => {
  const result = html([answer('gemini', 'gemini-3.8-flash')]);
  assert.match(result, /브랜드 인용률<\/span><strong[^>]*>측정 불가<\/strong>/);
  assert.match(result, /검색 인용을 제공하지 않는 완료 답변 1개를 추가로 제외/);
  assert.match(result, /질문 수집률 100% \(1\/1\)/);
  assert.match(result, /브랜드 언급 질문 0\/1개 \(0%\)/);
});
test('overview displays a real zero only with an eligible denominator', () => {
  const result = html([answer('grounded', 'gpt-4.1-mini')]);
  assert.match(result, /브랜드 인용률<\/span><strong[^>]*>0%<\/strong>/);
  assert.match(result, /인용 0 \/ 측정 가능한 답변 1개/);
});
test('overview mixed citation results do not dilute grounded measurements', () => {
  const result = html([answer('grounded', 'gpt-4.1-mini', { citations: [{ domain: 'acme.com', url: 'https://acme.com/', title: 'Guide', provenance: 'provider_annotation' }] }), answer('gemini', 'gemini-3.8-flash')]);
  assert.match(result, /브랜드 인용률<\/span><strong[^>]*>100%<\/strong>/);
  assert.match(result, /인용 1 \/ 측정 가능한 답변 1개/);
});
test('prompt evidence uses the tracked domain rather than a colliding display name', () => {
  assert.equal(ownMention({ mentions: [{ name: 'Acme', domain: 'competitor.example', mentioned: true }] }, site), undefined);
  assert.equal(ownMention({ mentions: [{ name: 'Other', domain: 'WWW.ACME.COM.', mentioned: true }] }, site).mentioned, true);
});

test('period summary retains historical completed evidence when a later collection fails', () => {
  const latest = answer('failure', 'gemini-3.8-flash', { status: 'failed' });
  const past = answer('past', 'gpt-4.1-mini', { mentions: [{ domain: 'acme.com', mentioned: true, firstPosition: 0, rank: 1 }] });
  const result = html([past, latest]);
  assert.match(result, /현재 비교 표본: 완료 1개, 실패 1개/);
  assert.match(result, /브랜드 언급 <b>1개<\/b>.*완료 답변 <b>1개<\/b>/);
  assert.match(result, /차트 데이터 보기/);
});

test('overview shows evidence counts and review actions for registered competitor-only answers', () => {
  const currentSite = { ...site, id: 'site-1' };
  const currentPrompts = [{ ...prompts[0], siteId: currentSite.id }];
  const rivals = [{ name: 'Rival', domain: 'rival.com' }];
  const rows = [answer('gap', 'gemini-3.8-flash', { siteId: currentSite.id, mentions: [{ domain: 'rival.com', mentioned: true }] })];
  const metrics = computeMetrics(currentSite, rivals, rows, currentPrompts);
  const state = { site: currentSite, prompts: currentPrompts, competitors: rivals, answers: rows, tasks: [], metrics };
  const result = renderToStaticMarkup(React.createElement(Overview, {
    state, metrics, answers: rows, filters: null, navigate() {}, openPrompt() {}, openForm() {}, onCreateTask() {},
    sectionHref: id => `/dashboard/${id}?period=7&model=gemini-3.8-flash`,
  }));
  assert.match(result, /우선 확인할 질문/);
  assert.match(result, /경쟁사만 언급된 답변/);
  assert.match(result, /1 \/ 1개/);
  assert.match(result, /해당 답변에 등장한 경쟁사: Rival/);
  assert.match(result, /개선 작업 추가/);
  assert.match(result, /href="\/dashboard\/actions\?period=7&amp;model=gemini-3.8-flash"/);
});

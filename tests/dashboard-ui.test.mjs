import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const uiUrl = new URL('../components/dashboard/ui.tsx', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/lib/metrics') return { url: new URL('../lib/metrics.ts', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url !== uiUrl) return next(url, context);
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
  },
});
const { Field, TrendChart } = await import(uiUrl);
const render = (...fields) => renderToStaticMarkup(React.createElement(React.Fragment, null, ...fields));
const field = (label, props, control = 'input') => React.createElement(Field, { label, ...props }, React.createElement(control, { name: 'value', ...(props?.controlProps || {}) }));

test('Field connects the visible label and help text to each native control', () => {
  for (const control of ['input', 'select', 'textarea']) {
    const html = render(field('고객 관점', { hint: '상황을 구체적으로 작성하세요.' }, control));
    const controlId = html.match(/<(?:input|select|textarea)[^>]* id="([^"]+)"/)[1];
    const hintId = html.match(/<small id="([^"]+)"/)[1];
    assert.ok(html.includes(`for="${controlId}"`));
    assert.ok(html.includes(`aria-describedby="${hintId}"`));
    assert.match(html, />고객 관점<\/label>/);
  }
});

test('Field preserves caller IDs, external descriptions and input behavior', () => {
  const html = render(field('웹사이트', { hint: '공개된 도메인을 입력하세요.', controlProps: { id: 'domain', 'aria-describedby': 'existing-error', defaultValue: 'example.com', required: true, disabled: true, maxLength: 200 } }));
  const hintId = html.match(/<small id="([^"]+)"/)[1];
  assert.match(html, /for="domain"/);
  assert.ok(html.includes(`aria-describedby="existing-error ${hintId}"`));
  assert.match(html, /value="example.com"/);
  assert.match(html, /required=""/);
  assert.match(html, /disabled=""/);
  assert.match(html, /maxLength="200"/);
});

test('Fields have distinct stable associations and never reference absent hints', () => {
  const html = render(field('브랜드', {}), field('질문', {}));
  const ids = [...html.matchAll(/<input[^>]* id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  assert.doesNotMatch(html, /aria-describedby|<small/);
  const externalOnly = render(field('값', { controlProps: { 'aria-describedby': 'server-error' } }));
  assert.match(externalOnly, /aria-describedby="server-error"/);
});

const chart = data => render(React.createElement(TrendChart, { data, label: '브랜드 언급률' }));
const pointXs = html => [...html.matchAll(/<circle cx="([^"]+)"/g)].map(match => Number(match[1]));

test('TrendChart preserves elapsed time between irregular observations without inventing zero days', () => {
  const html = chart([
    { date: '2026-11-01', value: 10 },
    { date: '2026-11-02', value: 20 },
    { date: '2026-11-20', value: 80 },
  ]);
  const [first, next, last] = pointXs(html);
  assert.equal(pointXs(html).length, 3);
  assert.ok(Math.abs((next - first) / (last - first) - 1 / 19) < 1e-10);
  assert.match(html, /3개 관측값/);
  assert.match(html, /관측하지 않은 날짜는 0으로 채우지 않습니다/);
  assert.equal((html.match(/<text[^>]+y="236"/g) || []).length, 2, 'nearby date labels do not overlap');
});

test('TrendChart orders the plot and its accessible data chronologically without mutating its input', () => {
  const data = [
    { date: '2026-11-20', value: 80 },
    { date: '2026-11-01', value: 10 },
    { date: '2026-11-02', value: 20 },
  ];
  const original = structuredClone(data);
  const html = chart(data);
  assert.deepEqual(data, original);
  assert.deepEqual(pointXs(html), [...pointXs(html)].sort((a, b) => a - b));
  const values = [...html.matchAll(/<td>(\d+)%<\/td>/g)].map(match => Number(match[1]));
  assert.deepEqual(values, [10, 20, 80]);
});

test('TrendChart centers one observed date and does not imply a trend or merge repeated observations', () => {
  for (const values of [[35], [35, 70]]) {
    const html = chart(values.map(value => ({ date: '2026-11-11', value })));
    const xs = pointXs(html);
    assert.equal(xs.length, values.length);
    assert.ok(xs.every(x => x === (48 + 742) / 2));
    assert.equal((html.match(/<text[^>]+y="236"/g) || []).length, 1);
    assert.match(html, /y="236"[^>]*text-anchor="middle"/);
    assert.doesNotMatch(html, /<path/);
    assert.deepEqual([...html.matchAll(/<td>(\d+)%<\/td>/g)].map(match => Number(match[1])), values);
  }
});

test('TrendChart leaves an empty series empty and excludes invalid coordinates', () => {
  for (const data of [[], [{ date: 'invalid', value: 10 }, { date: '2026-11-11', value: NaN }]]) {
    const html = chart(data);
    assert.equal(pointXs(html).length, 0);
    assert.match(html, /0개 관측값/);
    assert.doesNotMatch(html, /NaN|Infinity|Invalid Date|<path/);
  }
});

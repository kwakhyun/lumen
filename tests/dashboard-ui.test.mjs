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
const { Field } = await import(uiUrl);
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

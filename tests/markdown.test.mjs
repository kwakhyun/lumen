import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Exercise the production renderer rather than a parallel Markdown implementation.
const rendererUrl = new URL('../components/dashboard/markdown.tsx', import.meta.url).href;
registerHooks({ load(url, context, next) {
  if (url !== rendererUrl) return next(url, context);
  return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
} });
const { default: MarkdownContent, safeMarkdownUrl } = await import(rendererUrl);
const render = text => renderToStaticMarkup(React.createElement(MarkdownContent, null, text));

test('provider Markdown renders readable emphasis, headings, lists and code', () => {
  const html = render('## 브랜드 비교\n\n**중요한 근거**와 `제품 이름`\n\n1. 첫 번째\n2. 두 번째');
  assert.match(html, /<h3>브랜드 비교<\/h3>/);
  assert.match(html, /<strong>중요한 근거<\/strong>/);
  assert.match(html, /<code>제품 이름<\/code>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<li>첫 번째<\/li>/);
});

test('web links open with isolated new tabs and no referrer', () => {
  const html = render('[근거](https://example.com/source?q=one&lang=ko)과 [HTTP](http://example.com/)');
  assert.equal((html.match(/target="_blank"/g) || []).length, 2);
  assert.equal((html.match(/rel="noopener noreferrer"/g) || []).length, 2);
  assert.equal((html.match(/referrerPolicy="no-referrer"/g) || []).length, 2);
  assert.match(html, /href="https:\/\/example.com\/source\?q=one&amp;lang=ko"/);
});

test('non-web, malformed, credential-bearing and relative URLs are inert', () => {
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:evil', 'file:///tmp/local', 'mailto:user@example.com', '//example.com/', '/dashboard', '#local', 'https:\\evil.test', 'https://user:password@example.com/', 'https://example.com/\nprivate']) {
    assert.equal(safeMarkdownUrl(url), '', url);
  }
  assert.equal(safeMarkdownUrl(' HTTPS://example.com/source '), 'https://example.com/source');
  const html = render('[위험](javascript:alert%281%29) [상대 주소](/dashboard) [이메일](mailto:user@example.com)');
  assert.doesNotMatch(html, /<a\b/);
  assert.match(html, /위험/);
  assert.match(html, /상대 주소/);
});

test('raw HTML stays escaped and cannot create scripts, frames, event handlers or forms', () => {
  const html = render('<script>alert(1)</script>\n\n<iframe src="https://evil.test"></iframe>\n\n<img src=x onerror="alert(1)">\n\n<form action="https://evil.test"><input name="secret"></form>');
  assert.doesNotMatch(html, /<(script|iframe|img|form|input)\b/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img/);
});

test('Markdown images preserve an alternative label without loading remote resources', () => {
  const html = render('![비교 이미지](https://tracking.example/pixel.png)');
  assert.doesNotMatch(html, /<img\b|src=|tracking\.example/);
  assert.match(html, /이미지: 비교 이미지/);
});

test('GFM tables keep semantic cells inside an overflow container', () => {
  const html = render('| 모델 | 결과 |\n| --- | --- |\n| A | **언급** |');
  assert.match(html, /class="d-markdown-table"><table>/);
  assert.match(html, /<th>모델<\/th>/);
  assert.match(html, /<td><strong>언급<\/strong><\/td>/);
});

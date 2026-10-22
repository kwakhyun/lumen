import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('.css')) return { url: 'data:text/javascript,export default {};', shortCircuit: true };
    const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : specifier.startsWith('.') && context.parentURL?.startsWith('file:') ? fileURLToPath(new URL(specifier, context.parentURL)) : null;
    if (base) for (const suffix of ['.ts', '.tsx']) if (existsSync(base + suffix)) return { url: pathToFileURL(base + suffix).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith('.tsx')) return next(url, context);
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
  },
});
const { securityOriginForDomain, securityCollectorCommand, prepareSecurityImport, latestSecurityChecks, securityReport } = await import('../components/dashboard/security-view.ts');
const { default: Security } = await import('../components/dashboard/sections/security.tsx');

const evidence = () => ({
  schemaVersion: 1, collector: 'lumen-public-web/1', targetOrigin: 'https://example.com', observedAt: '2020-01-01T00:00:00Z', authorization: 'owner_or_authorized',
  home: { status: 200, error: null, bodyComplete: true, contentType: 'html', headers: { hsts: 'enabled', csp: 'missing', nosniff: true, framing: 'restricted', referrer: 'restricted' }, cookies: { total: 0, missingSecure: 0, missingHttpOnly: 0, missingSameSite: 0 }, html: { title: true, canonical: 'self', indexing: 'allowed', mixedContent: false } },
  robots: { status: 200, error: null, bodyComplete: true, rules: { Googlebot: 'allowed', bingbot: 'allowed', 'OAI-SearchBot': 'allowed', PerplexityBot: 'allowed' } },
  sitemap: { status: 200, error: null, bodyComplete: true, format: 'urlset', sameOriginUrls: 3, otherOriginUrls: 0 },
});
const check = (id, observedAt, patch = {}) => ({ id, siteId: 'private-workspace-id', digest: 'a'.repeat(64), createdAt: '2020-03-01T00:00:00Z', evidence: { ...evidence(), observedAt }, findings: [], ...patch });

test('collector command uses a normalized, quoted HTTPS origin and rejects executable or private metadata', () => {
  assert.equal(securityOriginForDomain('EXAMPLE.com'), 'https://example.com');
  assert.equal(securityOriginForDomain('https://example.com/'), 'https://example.com');
  assert.equal(securityCollectorCommand('example.com'), "node scripts/collect-security-evidence.mjs --origin 'https://example.com' --authorized --output ./lumen-web-check.json");
  for (const domain of ['', 'localhost', 'host.local', 'host.internal', '127.0.0.1', '[::1]', 'http://example.com', 'example.com:8443', 'example.com/path', 'example.com?token=secret', 'user:password@example.com', "example.com'; touch /tmp/surprise; #", '$(env).com', '`env`.com', 'example.com\\@evil.com', 'example.com\n--output=secret']) {
    assert.equal(securityCollectorCommand(domain), null, domain);
  }
});

test('file preview enforces bounded bytes, strict schema, matching origin and observed time before saving', () => {
  const source = evidence();
  assert.deepEqual(prepareSecurityImport(JSON.stringify(source), source.targetOrigin), source);
  assert.throws(() => prepareSecurityImport('{', source.targetOrigin), /JSON/);
  assert.throws(() => prepareSecurityImport('가'.repeat(12000), source.targetOrigin), /32 KiB/);
  assert.throws(() => prepareSecurityImport(JSON.stringify({ ...source, rawHeaders: { Cookie: 'private' } }), source.targetOrigin), /형식/);
  assert.throws(() => prepareSecurityImport(JSON.stringify({ ...source, home: null }), source.targetOrigin), /형식/);
  assert.throws(() => prepareSecurityImport(JSON.stringify(source), 'https://example.com.attacker.test'), /다른 결과/);
  assert.throws(() => prepareSecurityImport(JSON.stringify({ ...source, observedAt: '2099-01-01T00:00:00Z' }), source.targetOrigin), /현재보다 나중/);
});

test('comparison baseline uses observed order and exact workspace, origin and collector version', () => {
  const old = check('old', '2020-01-01T00:00:00Z');
  const latest = check('latest', '2020-01-03T00:00:00Z', { createdAt: '2020-02-01T00:00:00Z' });
  const unrelated = [
    check('other-workspace', '2020-01-02T00:00:00Z', { siteId: 'another' }),
    check('other-origin', '2020-01-02T00:00:00Z', { evidence: { ...evidence(), observedAt: '2020-01-02T00:00:00Z', targetOrigin: 'https://other.com' } }),
    check('other-version', '2020-01-02T00:00:00Z', { evidence: { ...evidence(), observedAt: '2020-01-02T00:00:00Z', collector: 'lumen-public-web/2' } }),
    check('same-time', '2020-01-03T00:00:00Z', { createdAt: '2020-01-01T00:00:00Z' }),
  ];
  const rows = Object.freeze([old, latest, ...unrelated]);
  assert.deepEqual(latestSecurityChecks(rows), { latest, previous: old });
  assert.equal(latestSecurityChecks([latest, ...unrelated]).previous, undefined);
  assert.deepEqual(latestSecurityChecks([]), { latest: undefined, previous: undefined });
  assert.equal(rows[0], old, 'sorting must not mutate cached API data');
});

test('report export contains observations and findings but excludes tenant and storage metadata', () => {
  const latest = check('private-check-id', '2020-01-03T00:00:00Z', { ownerId: 'private-owner-id', taskId: 'private-task-id' });
  const result = securityReport(latest, check('private-old-id', '2020-01-01T00:00:00Z'));
  const json = JSON.stringify(result);
  assert.deepEqual(result.latest.evidence, latest.evidence);
  assert.equal(result.provenance, 'user_supplied');
  assert.equal(result.latest.digest, latest.digest);
  for (const secret of ['private-check-id', 'private-workspace-id', 'private-owner-id', 'private-task-id', 'private-old-id', 'createdAt']) assert.ok(!json.includes(secret), secret);
});

test('initial import UI has an accessible file field, disclosed limits and no implicit server scan', () => {
  const html = renderToStaticMarkup(React.createElement(Security, { state: { site: { id: 'example-site', domain: 'example.com', mode: 'live' } } }));
  const id = html.match(/<input[^>]*id="([^"]+)"[^>]*type="file"/)[1];
  assert.ok(html.includes(`for="${id}"`));
  assert.ok(html.includes(`aria-describedby="${id}-hint"`));
  assert.match(html, /32 KiB/);
  assert.match(html, /선택만으로 서버에 전송하거나 저장하지 않습니다/);
  assert.match(html, /서버 내부, 로그인과 권한, 취약한 소스 코드는 검사하지 않으며/);
  assert.doesNotMatch(html, /<button[^>]*>결과 저장<\/button>|지금 점검|보안 점수/);
});

test('demo workspace cannot import live observations or display an invented security result', () => {
  const html = renderToStaticMarkup(React.createElement(Security, { state: { site: { id: 'demo-site', domain: 'demo.example', mode: 'demo' } } }));
  assert.match(html, /실제 브랜드에서 웹사이트를 점검하세요/);
  assert.doesNotMatch(html, /type="file"|수집 명령 복사|설정 개선 확인/);
});

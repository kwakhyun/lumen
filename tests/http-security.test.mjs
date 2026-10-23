import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareSecurityRequest, applySecurityHeaders } from '../lib/http-security.ts';

const origin = 'https://lumen.example';
const requestFor = (path = '/') => new Request(`${origin}${path}`);
const directives = value => new Map(value.split(';').map(part => part.trim().split(/\s+/)).filter(parts => parts[0]).map(([name, ...sources]) => [name, sources]));

test('static header configuration preserves immutable caching only for content-hashed assets', () => {
  const source = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  const blocks = new Map();
  let current;
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (line.startsWith('/')) { current = new Map(); blocks.set(line.trim(), current); }
    else {
      const separator = line.indexOf(':');
      assert.ok(current && separator > 0, 'header must belong to a path rule');
      current.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
    }
  }
  assert.equal(blocks.get('/_next/static/*')?.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(blocks.get('/*')?.has('cache-control'), false, 'HTML and non-hashed public files must not inherit immutable caching');
  assert.equal(blocks.get('/*')?.get('x-content-type-options'), 'nosniff');
  for (const [path, headers] of blocks) {
    if ((headers.get('cache-control') || '').includes('immutable')) assert.equal(path, '/_next/static/*');
  }
});

test('each request receives a fresh unpredictable nonce and spoofed nonce policies are replaced', () => {
  const nonces = new Set();
  for (let index = 0; index < 64; index++) {
    const original = new Request(`${origin}/dashboard/security`, { headers: {
      'content-security-policy': "script-src 'nonce-attacker' 'unsafe-inline'",
      'content-security-policy-report-only': "script-src 'nonce-attacker-report'",
      'x-lumen-csp-nonce': 'attacker',
      'accept': 'text/html',
    } });
    const prepared = prepareSecurityRequest(original);
    assert.match(prepared.nonce, /^[A-Za-z0-9+/_-]+={0,2}$/);
    assert.ok(Buffer.from(prepared.nonce, 'base64').length >= 16, 'nonce must contain at least 128 random bits');
    assert.equal(prepared.request.headers.get('x-lumen-csp-nonce'), prepared.nonce);
    assert.equal(prepared.request.headers.get('content-security-policy'), prepared.policy);
    assert.equal(prepared.request.headers.has('content-security-policy-report-only'), false);
    assert.ok(directives(prepared.policy).get('script-src').includes(`'nonce-${prepared.nonce}'`));
    assert.doesNotMatch(prepared.policy, /attacker/);
    assert.equal(prepared.request.headers.get('accept'), 'text/html');
    assert.equal(original.headers.get('x-lumen-csp-nonce'), 'attacker', 'caller-owned request is not mutated');
    nonces.add(prepared.nonce);
  }
  assert.equal(nonces.size, 64);
});

test('request preparation preserves POST data, method, URL, credentials and cancellation', async () => {
  const controller = new AbortController();
  const payload = JSON.stringify({ action: 'import', requestId: 'fixture-id' });
  const original = new Request(`${origin}/api/security-checks?siteId=fixture`, {
    method: 'POST', body: payload, signal: controller.signal, credentials: 'include', redirect: 'manual',
    headers: { 'content-type': 'application/json', 'origin': origin, 'cookie': 'session=fixture; csrf=fixture', 'x-request-id': 'request-fixture' },
  });
  const { request } = prepareSecurityRequest(original);
  assert.equal(request.url, original.url);
  assert.equal(request.method, 'POST');
  assert.equal(request.credentials, 'include');
  assert.equal(request.redirect, 'manual');
  for (const name of ['content-type', 'origin', 'cookie', 'x-request-id']) assert.equal(request.headers.get(name), original.headers.get(name), name);
  assert.equal(request.signal.aborted, false);
  assert.equal(await request.text(), payload);
  controller.abort('fixture-cancelled');
  assert.equal(request.signal.aborted, true);
  assert.equal(request.signal.reason, 'fixture-cancelled');
});

test('enforced policy blocks arbitrary scripts, plugins, embedding and base URL changes', () => {
  const { policy, nonce } = prepareSecurityRequest(requestFor('/dashboard'));
  const parsed = directives(policy);
  assert.deepEqual(parsed.get('default-src'), ["'self'"]);
  assert.ok(parsed.get('script-src').includes("'self'"));
  assert.ok(parsed.get('script-src').includes(`'nonce-${nonce}'`));
  const scriptSources = parsed.get('script-src-elem') ?? parsed.get('script-src');
  for (const unsafe of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'http:', 'data:']) assert.equal(scriptSources.includes(unsafe), false, unsafe);
  assert.deepEqual(parsed.get('object-src'), ["'none'"]);
  assert.deepEqual(parsed.get('base-uri'), ["'none'"]);
  assert.deepEqual(parsed.get('frame-ancestors'), ["'self'"]);
  assert.ok(parsed.get('style-src').includes("'self'"));
  assert.ok(parsed.get('style-src').includes("'unsafe-inline'"), 'existing charts and component styles remain usable');
});

test('only landing documents allow the existing consent-based analytics hosts without ads endpoints', () => {
  for (const path of ['/', '/?utm_source=fixture']) {
    const { policy } = prepareSecurityRequest(requestFor(path));
    const parsed = directives(policy);
    assert.ok(parsed.get('script-src').includes('https://www.googletagmanager.com'));
    assert.ok(parsed.get('connect-src').some(source => /google-analytics\.com$/.test(source)));
    assert.ok(parsed.get('connect-src').includes('https://*.google.com'), 'the documented GA4 connection origin remains available');
    assert.equal(parsed.get('script-src').includes('https://*.google.com'), false);
    assert.equal(parsed.get('img-src').includes('https://*.google.com'), false);
    assert.doesNotMatch(policy, /doubleclick|googlesyndication|googleadservices|\/ads|https:\/\/(?:www\.)?google\.com(?:\s|;|$)/i);
  }
  for (const path of ['/dashboard', '/dashboard/security', '/privacy', '/guides/free-ai-brand-tracking', '/api/security-checks']) {
    const parsed = directives(prepareSecurityRequest(requestFor(path)).policy);
    assert.deepEqual(parsed.get('connect-src'), ["'self'"]);
    assert.doesNotMatch([...parsed.values()].flat().join(' '), /google|doubleclick|googlesyndication/i);
  }
});

test('HTML responses keep their streamed body while receiving strict headers and non-reusable caching', async () => {
  const encoder = new TextEncoder();
  let finish;
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode('<html><body>first '));
    finish = () => { controller.enqueue(encoder.encode('second</body></html>')); controller.close(); };
  } });
  const originalRequest = requestFor('/dashboard/security');
  const { policy } = prepareSecurityRequest(originalRequest);
  const originalResponse = new Response(body, { status: 200, statusText: 'Fixture OK', headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600',
    'cdn-cache-control': 'public, s-maxage=3600', 'etag': '"old-html"', 'last-modified': 'Thu, 22 Oct 2026 00:00:00 GMT',
    'vary': 'RSC, Accept-Encoding', 'x-fixture': 'kept',
  } });
  const response = applySecurityHeaders(originalRequest, originalResponse, policy);
  assert.notEqual(response, originalResponse);
  assert.equal(response.bodyUsed, false);
  assert.equal(originalResponse.bodyUsed, false, 'adding headers must not eagerly consume the stream');
  assert.equal(response.status, 200);
  assert.equal(response.statusText, 'Fixture OK');
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('content-security-policy'), policy);
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(response.headers.get('cache-control'), /private/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  assert.equal(response.headers.has('etag'), false);
  assert.equal(response.headers.has('last-modified'), false);
  assert.equal(response.headers.get('vary'), 'RSC, Accept-Encoding');
  assert.equal(response.headers.get('x-fixture'), 'kept');
  assert.equal(originalResponse.headers.get('cache-control'), 'public, max-age=3600');
  finish();
  assert.equal(await response.text(), '<html><body>first second</body></html>');
});

test('login and OAuth redirects preserve status, destination and independent cookies', async () => {
  const originalRequest = requestFor('/api/integrations/ga4/callback');
  const { policy } = prepareSecurityRequest(originalRequest);
  const headers = new Headers({ location: '/dashboard/connections?connected=1', 'referrer-policy': 'no-referrer', 'cache-control': 'private, no-store' });
  const cookies = ['oauth_state=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure', 'session=fixture; Path=/; HttpOnly; SameSite=Lax; Secure'];
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  const response = applySecurityHeaders(originalRequest, new Response(null, { status: 303, headers }), policy);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/dashboard/connections?connected=1');
  assert.deepEqual(response.headers.getSetCookie(), cookies);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(await response.text(), '');
});

test('route-owned stronger CSP and privacy policies remain intact for protected exports', async () => {
  const originalRequest = requestFor('/api/operations/backup');
  const { policy } = prepareSecurityRequest(originalRequest);
  const sandbox = "default-src 'none'; sandbox";
  const response = applySecurityHeaders(originalRequest, new Response('{"version":6}', { headers: {
    'content-type': 'application/json', 'content-security-policy': sandbox, 'referrer-policy': 'no-referrer',
    'content-disposition': 'attachment; filename="backup.json"', 'cache-control': 'private, no-store',
  } }), policy);
  assert.equal(response.headers.get('content-security-policy'), sandbox);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="backup.json"');
  assert.equal(await response.json().then(value => value.version), 6);
});

test('JSON, tracking JavaScript and static assets retain cache validators, MIME type and CORS', async () => {
  for (const [path, contentType, payload] of [['/api/status', 'application/json', '{}'], ['/api/track.js', 'application/javascript; charset=utf-8', '/* fixture */'], ['/assets/style.css', 'text/css', 'body{}']]) {
    const request = requestFor(path);
    const { policy } = prepareSecurityRequest(request);
    const headers = {
      'content-type': contentType, 'cache-control': 'public, max-age=300', 'cdn-cache-control': 'max-age=600',
      'etag': '"fixture"', 'last-modified': 'Thu, 22 Oct 2026 00:00:00 GMT',
      'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS',
    };
    const response = applySecurityHeaders(request, new Response(payload, { headers }), policy);
    for (const [name, value] of Object.entries(headers)) assert.equal(response.headers.get(name), value, `${path}: ${name}`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await response.text(), payload);
  }
});

test('HTTPS-only HSTS leaves local HTTP usable and empty HTTP status bodies remain valid', async () => {
  for (const status of [204, 304]) {
    const request = new Request('http://127.0.0.1:8787/api/track');
    const { policy } = prepareSecurityRequest(request);
    const response = applySecurityHeaders(request, new Response(null, { status, headers: { 'access-control-allow-origin': '*', 'etag': '"fixture"' } }), policy);
    assert.equal(response.status, status);
    assert.equal(response.headers.has('strict-transport-security'), false);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('etag'), '"fixture"');
    assert.equal(await response.text(), '');
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serveStaticAsset } from '../build/static-asset-response.mjs';

const origin = 'https://lumen.example';
const scriptPath = '/_next/static/chunks/app-abc123.js';
const script = 'window.fixture = "루멘";\n';
const binary = new Uint8Array([0, 1, 127, 128, 255]);
const textAsset = (body, extra = {}) => ({
  body, encoding: 'utf8', contentType: 'text/plain; charset=utf-8',
  size: new TextEncoder().encode(body).length, etag: 'W/"fixture-text"', immutable: false, ...extra,
});
const assets = new Map([
  [scriptPath, textAsset(script, { contentType: 'application/javascript; charset=utf-8', immutable: true, etag: 'W/"fixture-script"' })],
  ['/robots.txt', textAsset('User-agent: *\nAllow: /\n')],
  ['/favicon.svg', textAsset('<svg xmlns="http://www.w3.org/2000/svg"/>', { contentType: 'image/svg+xml' })],
  ['/product-preview.jpg', { body: Buffer.from(binary).toString('base64'), encoding: 'base64', contentType: 'image/jpeg', size: binary.length, etag: 'W/"fixture-binary"', immutable: false }],
]);
const request = (path = scriptPath, init = {}) => new Request(`${origin}${path}`, init);

function assertSecurity(response, { https = true } = {}) {
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('strict-transport-security'), https ? 'max-age=31536000' : null);
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
  assert.equal(response.headers.get('accept-ranges'), 'none');
  assert.equal(response.headers.has('set-cookie'), false);
}

test('UTF-8 script bytes, MIME and immutable caching survive direct Worker delivery', async () => {
  const response = serveStaticAsset(request(), assets);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/javascript; charset=utf-8');
  assert.equal(response.headers.get('content-length'), String(Buffer.byteLength(script)));
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(response.headers.get('etag'), 'W/"fixture-script"');
  assert.equal(await response.text(), script);
  assertSecurity(response);
});

test('binary assets preserve every byte and their image MIME', async () => {
  const response = serveStaticAsset(request('/product-preview.jpg'), assets);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(response.headers.get('content-length'), '5');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), binary);
  assertSecurity(response);
});

test('ordinary public files revalidate and query parameters do not select other data', async () => {
  const response = serveStaticAsset(request('/robots.txt?path=/.env&token=ignored'), assets);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal(await response.text(), assets.get('/robots.txt').body);
});

test('HEAD has GET metadata and no body without decoding binary content', async () => {
  const undecodable = new Map([['/fixture.jpg', { ...assets.get('/product-preview.jpg'), body: 'invalid!base64' }]]);
  const response = serveStaticAsset(request('/fixture.jpg', { method: 'HEAD' }), undecodable);
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.equal(response.headers.get('content-length'), '5');
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(await response.text(), '');
  assertSecurity(response);
});

test('matching strong, weak, list and wildcard validators produce protected empty 304s', async () => {
  for (const method of ['GET', 'HEAD']) {
    for (const condition of ['"fixture-script"', 'W/"fixture-script"', '"other", W/"fixture-script"', ' W/"other", "fixture-script" ', '*']) {
      const response = serveStaticAsset(request(scriptPath, { method, headers: { 'if-none-match': condition } }), assets);
      assert.equal(response.status, 304, `${method}: ${condition}`);
      assert.equal(response.body, null);
      assert.equal(response.headers.has('content-length'), false);
      assert.equal(response.headers.get('etag'), 'W/"fixture-script"');
      assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assertSecurity(response);
    }
  }
});

test('unmatched and invalid validators return the complete response', async () => {
  for (const condition of ['"different"', 'fixture-script', 'w/"fixture-script"', '"fixture-script-extra"', '"prefix,fixture-script"']) {
    const response = serveStaticAsset(request(scriptPath, { headers: { 'if-none-match': condition } }), assets);
    assert.equal(response.status, 200, condition);
    assert.equal(await response.text(), script);
  }
});

test('commas inside opaque entity tags are not treated as list separators', () => {
  const commaAssets = new Map([['/fixture.txt', textAsset('fixture', { etag: 'W/"fixture,one"' })]]);
  const response = serveStaticAsset(request('/fixture.txt', { headers: { 'if-none-match': '"other", "fixture,one"' } }), commaAssets);
  assert.equal(response.status, 304);
});

test('POST, PUT, PATCH, DELETE and OPTIONS cannot mutate assets or use conditional 304', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = serveStaticAsset(request(scriptPath, { method, headers: { 'if-none-match': '*' } }), assets);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.has('etag'), false);
    assert.equal(await response.text(), 'Method not allowed');
    assertSecurity(response);
  }
});

test('missing framework assets and internal metadata return protected uncached text 404s', async () => {
  for (const path of ['/_next/static', '/_next/static/missing.js', '/.vite', '/.vite/manifest.json', '/vinext-client-entry-manifest.json', '/_headers', '/.assetsignore', '/wrangler.json']) {
    for (const method of ['GET', 'HEAD']) {
      const response = serveStaticAsset(request(path, { method }), assets);
      assert.equal(response.status, 404, `${method}: ${path}`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
      assert.equal(await response.text(), method === 'HEAD' ? '' : 'Not found');
      assertSecurity(response);
    }
  }
});

test('internal metadata remains private even if incorrectly included in the manifest', () => {
  const privateAssets = new Map([...assets, ['/_headers', textAsset('must stay private')]]);
  assert.equal(serveStaticAsset(request('/_headers'), privateAssets).status, 404);
  assert.equal(serveStaticAsset(request('/%5fheaders'), privateAssets).status, 404);
  assert.equal(serveStaticAsset(request('/%2evite/manifest.json'), privateAssets).status, 404);
});

test('asset lookup has no decoded aliases, prefix matching or inherited object keys', () => {
  for (const path of ['/_next/static/chunks/%61pp-abc123.js', '/_next/static/chunks/app-abc123.js/extra', '/_next/static/chunks/app-abc123.js%00', '/_next/static/%2fchunks/app-abc123.js']) {
    assert.equal(serveStaticAsset(request(path), assets).status, 404, path);
  }
  for (const path of ['/__proto__', '/constructor', '/toString', '/robots.txt/extra', '/%72obots.txt']) {
    assert.equal(serveStaticAsset(request(path), assets), null, path);
  }
});

test('application, API and authentication routes fall through unchanged for all methods', () => {
  for (const path of ['/', '/dashboard/security', '/api/security-checks', '/signin-with-chatgpt?return_to=%2Fdashboard', '/signout-with-chatgpt', '/callback']) {
    for (const method of ['GET', 'POST']) assert.equal(serveStaticAsset(request(path, { method }), assets), null, `${method}: ${path}`);
  }
});

test('Range and If-Range intentionally return complete 200 responses without partial headers', async () => {
  for (const range of ['bytes=0-1', 'bytes=-2', 'bytes=3-', 'bytes=99-100', 'bytes=0-1,3-4', 'invalid']) {
    const response = serveStaticAsset(request('/product-preview.jpg', { headers: { range, 'if-range': '"fixture-binary"' } }), assets);
    assert.equal(response.status, 200);
    assert.equal(response.headers.has('content-range'), false);
    assert.equal(response.headers.get('content-length'), '5');
    assert.equal(response.headers.get('accept-ranges'), 'none');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), binary);
  }
  const notModified = serveStaticAsset(request('/product-preview.jpg', { headers: { range: 'bytes=0-1', 'if-none-match': '*' } }), assets);
  assert.equal(notModified.status, 304);
});

test('untrusted cookies and request policies never personalize public bytes or headers', async () => {
  const response = serveStaticAsset(request(scriptPath, { headers: {
    cookie: 'session=private-fixture', authorization: 'Bearer private-fixture',
    'content-security-policy': "script-src 'unsafe-inline'", 'x-lumen-csp-nonce': 'attacker',
  } }), assets);
  assertSecurity(response);
  assert.equal(response.headers.has('vary'), false);
  assert.equal(response.headers.has('x-lumen-csp-nonce'), false);
  assert.equal(await response.text(), script);
});

test('HSTS is restricted to HTTPS and the runtime performs no external requests', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => { fetchCalls++; throw new Error('External requests are forbidden'); };
  try {
    const response = serveStaticAsset(new Request(`http://localhost${scriptPath}`), assets);
    assertSecurity(response, { https: false });
    assert.equal(await response.text(), script);
    assert.equal(fetchCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, lstat, rm, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareEmbeddedAssets } from '../scripts/embed-static-assets.mjs';

async function write(root, name, contents) {
  const path = join(root, name);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, contents);
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'lumen-static-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicAssets = new Map([
    ['robots.txt', Buffer.from('User-agent: *\nAllow: /\n')],
    ['favicon.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><title>루멘</title></svg>')],
    ['product-preview.jpg', Buffer.from([255, 216, 255, 224, 0, 16, 128, 0, 255, 217])],
    ['BingSiteAuth.xml', Buffer.from('<users><user>fixture-public-verification</user></users>')],
    ['google0123456789abcdef.html', Buffer.from('google-site-verification: google0123456789abcdef.html')],
    ['lumen-indexnow-key.txt', Buffer.from('fixture-public-indexnow-key')],
  ]);
  for (const [name, bytes] of publicAssets) {
    await write(root, `public/${name}`, bytes);
    await write(root, `dist/client/${name}`, bytes);
  }
  await write(root, 'package.json', '{"type":"module"}');
  await write(root, 'public/_headers', '/*\n  X-Content-Type-Options: nosniff\n');
  await write(root, 'dist/client/_headers', '/*\n  X-Content-Type-Options: nosniff\n');
  await write(root, 'dist/client/.assetsignore', '.vite\n');
  await write(root, 'dist/client/.vite/manifest.json', '{"internal":"not-a-public-asset"}');
  await write(root, 'dist/client/vinext-client-entry-manifest.json', '{"privateBuildMetadata":true}');
  await write(root, 'dist/client/_next/static/chunks/app-test1234.js', 'export const title = "루멘";\n');
  await write(root, 'dist/client/_next/static/css/app-test1234.css', 'body{color:#111}\n');
  await write(root, 'dist/server/index.js', 'export const named = 7; export default {fetch(){ return new Response("app"); }};\n');
  await write(root, 'dist/server/wrangler.json', JSON.stringify({ main: 'index.js', assets: { directory: '../client' }, d1_databases: [{ binding: 'DB' }], compatibility_flags: ['nodejs_compat'], rules: [{ type: 'ESModule', globs: ['**/*.js'] }] }));
  await write(root, 'dist/.openai/hosting.json', '{"project_id":"fixture-project","d1":"DB","capabilities":["mcp"]}');
  await write(root, 'dist/.openai/drizzle/0001.sql', 'CREATE TABLE fixture(id TEXT PRIMARY KEY);');
  await write(root, '.env.local', 'FIXTURE_PRIVATE_TOKEN=must-not-be-embedded');
  await write(root, 'private/report.txt', 'must-not-be-embedded');
  for (const name of ['static-worker.mjs', 'static-asset-response.mjs']) {
    await write(root, `build/${name}`, await readFile(new URL(`../build/${name}`, import.meta.url)));
  }
  return { root, publicAssets };
}

async function snapshot(root) {
  const rows = [];
  async function walk(path) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await walk(join(path, name));
    } else rows.push([relative(root, path), (await readFile(path)).toString('base64')]);
  }
  await walk(root);
  return rows;
}

test('embedded build preserves public bytes and ownership proofs, removes static routing, and keeps runtime metadata', async t => {
  const { root, publicAssets } = await fixture(t);
  const originalEntry = await readFile(join(root, 'dist/server/index.js'));
  const originalHosting = await readFile(join(root, 'dist/.openai/hosting.json'));
  const originalMigration = await readFile(join(root, 'dist/.openai/drizzle/0001.sql'));
  const result = await prepareEmbeddedAssets(root);
  assert.equal(result.count, publicAssets.size + 2);
  assert.equal(result.alreadyPrepared, false);
  await assert.rejects(lstat(join(root, 'dist/client')), { code: 'ENOENT' });
  const config = JSON.parse(await readFile(join(root, 'dist/server/wrangler.json'), 'utf8'));
  assert.equal('assets' in config, false);
  assert.deepEqual(config.d1_databases, [{ binding: 'DB' }]);
  assert.deepEqual(config.compatibility_flags, ['nodejs_compat']);
  assert.equal(config.main, 'index.js');
  assert.deepEqual(await readFile(join(root, 'dist/server/lumen-app.js')), originalEntry);
  assert.deepEqual(await readFile(join(root, 'dist/.openai/hosting.json')), originalHosting);
  assert.deepEqual(await readFile(join(root, 'dist/.openai/drizzle/0001.sql')), originalMigration);
  const { default: assets } = await import(pathToFileURL(join(root, 'dist/server/lumen-static-assets.js')).href);
  for (const [name, bytes] of publicAssets) {
    const asset = assets.get(`/${name}`);
    assert.ok(asset, name);
    assert.deepEqual(Buffer.from(asset.body, asset.encoding), bytes, name);
    assert.equal(asset.size, bytes.length);
    assert.equal(asset.immutable, false);
    assert.match(asset.etag, /^W\/"sha256-[a-f0-9]{64}"$/);
  }
  assert.equal(assets.get('/product-preview.jpg').encoding, 'base64');
  assert.equal(assets.get('/google0123456789abcdef.html').contentType, 'text/html; charset=utf-8');
  assert.equal(assets.get('/_next/static/chunks/app-test1234.js').immutable, true);
  assert.equal(assets.get('/_next/static/css/app-test1234.css').contentType, 'text/css; charset=utf-8');
  for (const name of ['/_headers', '/.assetsignore', '/.vite/manifest.json', '/vinext-client-entry-manifest.json', '/.env.local', '/private/report.txt']) assert.equal(assets.has(name), false, name);
  const manifest = await readFile(join(root, 'dist/server/lumen-static-assets.js'), 'utf8');
  assert.equal(manifest.includes('must-not-be-embedded'), false);
  assert.equal(manifest.includes('privateBuildMetadata'), false);
  const marker = JSON.parse(await readFile(join(root, 'dist/.openai/static-assets.json'), 'utf8'));
  assert.equal(marker.assets.reduce((sum, asset) => sum + asset.size, 0), result.totalBytes);
  assert.equal(marker.count, result.count);
});

test('running the embedding step twice preserves the prepared build byte-for-byte', async t => {
  const { root } = await fixture(t);
  const first = await prepareEmbeddedAssets(root);
  const before = await snapshot(root);
  const second = await prepareEmbeddedAssets(root);
  assert.deepEqual(second, { ...first, alreadyPrepared: true });
  assert.deepEqual(await snapshot(root), before);
  await write(root, 'dist/server/lumen-static-assets.js', 'export default new Map();');
  await assert.rejects(prepareEmbeddedAssets(root), /changed|fresh build/i);
});

test('prepared wrapper serves assets and preserves named exports and application request context', async t => {
  const { root } = await fixture(t);
  await write(root, 'dist/server/index.js', `export const named = 7;
export default { fetch(request, env, ctx) {
  return Response.json({ url: request.url, header: request.headers.get('x-fixture'), env: env.fixture, ctx: ctx.fixture });
} };\n`);
  await prepareEmbeddedAssets(root);
  const module = await import(pathToFileURL(join(root, 'dist/server/index.js')).href);
  assert.equal(module.named, 7);
  const asset = await module.default.fetch(new Request('https://fixture.example/robots.txt'), {}, {});
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(await asset.text(), 'User-agent: *\nAllow: /\n');
  const response = await module.default.fetch(new Request('https://fixture.example/dashboard?tab=security', { headers: { 'x-fixture': 'request-preserved' } }), { fixture: 'env-preserved' }, { fixture: 'ctx-preserved' });
  assert.deepEqual(await response.json(), {
    url: 'https://fixture.example/dashboard?tab=security', header: 'request-preserved', env: 'env-preserved', ctx: 'ctx-preserved',
  });
});

test('re-running rejects changed delivery source or restored static routing without further mutation', async t => {
  const cases = [
    ['delivery source', root => write(root, 'build/static-worker.mjs', 'export default {};'), /source changed/],
    ['static routing', root => write(root, 'dist/server/wrangler.json', '{"main":"index.js","assets":{"directory":"../client"}}'), /routing changed/],
  ];
  for (const [name, change, message] of cases) await t.test(name, async t => {
    const { root } = await fixture(t);
    await prepareEmbeddedAssets(root);
    await change(root);
    const before = await snapshot(root);
    await assert.rejects(prepareEmbeddedAssets(root), message);
    assert.deepEqual(await snapshot(root), before);
  });
});

test('unapproved public files, private client files, source maps, and source mismatches fail before modifying output', async t => {
  const cases = [
    ['unapproved public', root => write(root, 'public/unreviewed.html', '<html>new page</html>'), /Unreviewed public asset/],
    ['private client file', root => write(root, 'dist/client/.env.local', 'DO_NOT_SERVE=fixture'), /Unreviewed client output/],
    ['source map', root => write(root, 'dist/client/_next/static/chunks/app-test1234.js.map', '{}'), /Unreviewed client output/],
    ['hidden next path', root => write(root, 'dist/client/_next/static/.private/config.js', 'export default {}'), /Unreviewed client output/],
    ['copied public mismatch', root => write(root, 'dist/client/robots.txt', 'unexpected changed bytes'), /differs from its source/],
    ['missing copied public', root => rm(join(root, 'dist/client/robots.txt')), /missing expected public assets/],
    ['invalid text encoding', root => write(root, 'dist/client/_next/static/chunks/app-test1234.js', Buffer.from([0xff, 0xfe])), /encoded data|encoding|UTF-8/i],
  ];
  for (const [name, change, message] of cases) await t.test(name, async t => {
    const { root } = await fixture(t);
    await change(root);
    const before = await snapshot(root);
    await assert.rejects(prepareEmbeddedAssets(root), message);
    assert.deepEqual(await snapshot(root), before);
  });
});

test('symbolic links in either public source or client output are rejected before mutation', async t => {
  for (const name of ['public/linked.txt', 'dist/client/linked.txt']) await t.test(name, async t => {
    const { root } = await fixture(t);
    await symlink(join(root, '.env.local'), join(root, name));
    const before = await snapshot(root);
    await assert.rejects(prepareEmbeddedAssets(root), /symbolic links/);
    assert.deepEqual(await snapshot(root), before);
    assert.equal((await lstat(join(root, name))).isSymbolicLink(), true);
  });
});

test('symlinked build, server, and public roots cannot redirect file reads or writes', async t => {
  for (const name of ['dist', 'dist/server', 'public']) await t.test(name, async t => {
    const { root } = await fixture(t);
    const source = join(root, name), moved = join(root, `moved-${name.replaceAll('/', '-')}`);
    await rename(source, moved);
    await symlink(moved, source, 'dir');
    const before = await snapshot(root);
    await assert.rejects(prepareEmbeddedAssets(root), /regular directories/);
    assert.deepEqual(await snapshot(root), before);
    assert.equal((await lstat(source)).isSymbolicLink(), true);
  });
});

test('per-file, total byte, and file-count bounds reject oversized bundles without partial wrapping', async t => {
  const cases = [
    ['per-file', root => write(root, 'dist/client/_next/static/chunks/too-large.js', 'x'.repeat(2 * 1024 * 1024 + 1)), /2 MiB/],
    ['total bytes', async root => {
      await write(root, 'dist/client/_next/static/chunks/large-one.js', 'x'.repeat(2 * 1024 * 1024));
      await write(root, 'dist/client/_next/static/chunks/large-two.js', 'x'.repeat(2 * 1024 * 1024));
    }, /size or file-count/],
    ['file count', async root => {
      for (let index = 0; index < 128; index++) await write(root, `dist/client/_next/static/chunks/many-${index}.js`, 'export {};');
    }, /size or file-count/],
  ];
  for (const [name, change, message] of cases) await t.test(name, async t => {
    const { root } = await fixture(t);
    await change(root);
    const before = await snapshot(root);
    await assert.rejects(prepareEmbeddedAssets(root), message);
    assert.deepEqual(await snapshot(root), before);
  });
});

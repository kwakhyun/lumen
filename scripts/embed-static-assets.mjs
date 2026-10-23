#!/usr/bin/env node
// Sites does not apply _headers to its static delivery layer. Package only the
// reviewed public assets into the existing Worker; no new storage or fetches.
import { lstat, readdir, readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const MAX_FILES = 128;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const PUBLIC_TYPES = new Map([
  ['favicon.svg', 'image/svg+xml'], ['file.svg', 'image/svg+xml'],
  ['globe.svg', 'image/svg+xml'], ['window.svg', 'image/svg+xml'],
  ['product-preview.jpg', 'image/jpeg'], ['robots.txt', 'text/plain; charset=utf-8'],
  ['sitemap.xml', 'application/xml; charset=utf-8'],
  ['BingSiteAuth.xml', 'application/xml; charset=utf-8'],
  ['lumen-indexnow-key.txt', 'text/plain; charset=utf-8'],
]);
const INTERNAL_FILES = new Set(['_headers', '.assetsignore', 'vinext-client-entry-manifest.json']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async path => !!(await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; }));

async function regularTree(root) {
  const files = [];
  async function walk(path) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error('Static asset inputs cannot contain symbolic links.');
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await walk(join(path, name));
    } else if (stat.isFile()) files.push(path);
    else throw new Error('Static asset inputs must be regular files.');
  }
  await walk(root);
  return files;
}

function publicType(name) {
  return PUBLIC_TYPES.get(name) ?? (/^google[a-z0-9]{16}\.html$/.test(name) ? 'text/html; charset=utf-8' : null);
}

export async function prepareEmbeddedAssets(root) {
  root = resolve(root);
  const output = join(root, 'dist'), client = join(output, 'client'), server = join(output, 'server');
  for (const directory of [output, server, join(root, 'public')]) {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Build and public roots must be regular directories.');
  }
  const markerPath = join(output, '.openai', 'static-assets.json');
  // Re-running the packaging step must not wrap the previous wrapper recursively.
  if (!(await exists(client))) {
    if (!(await exists(markerPath))) throw new Error('Build client output is missing. Run the framework build first.');
    const marker = JSON.parse(await readFile(markerPath, 'utf8'));
    if (marker.version !== 1 || !marker.modules) throw new Error('Invalid static asset build marker.');
    for (const name of ['index.js', 'lumen-app.js', 'lumen-static-assets.js', 'lumen-static-response.js']) {
      if (hash(await readFile(join(server, name))) !== marker.modules[name]) throw new Error('Embedded build output changed. Run a fresh build.');
    }
    if (hash(await readFile(join(root, 'build/static-worker.mjs'))) !== marker.modules['index.js']
      || hash(await readFile(join(root, 'build/static-asset-response.mjs'))) !== marker.modules['lumen-static-response.js']) throw new Error('Static delivery source changed. Run a fresh build.');
    const config = JSON.parse(await readFile(join(server, 'wrangler.json'), 'utf8'));
    if (config.main !== 'index.js' || config.assets) throw new Error('Embedded Worker routing changed. Run a fresh build.');
    return { count: marker.count, totalBytes: marker.totalBytes, alreadyPrepared: true };
  }

  // Validate every tree before modifying generated files. Never read env or source
  // directories through a symlink or treat arbitrary build metadata as public.
  const clientFiles = await regularTree(client);
  const publicFiles = await regularTree(join(root, 'public'));
  const publicNames = new Set();
  for (const file of publicFiles) {
    const name = relative(join(root, 'public'), file).split('\\').join('/');
    if (name === '_headers') continue;
    if (!publicType(name)) throw new Error(`Unreviewed public asset: ${name}`);
    publicNames.add(name);
  }
  const index = join(server, 'index.js');
  if (!(await lstat(index)).isFile() || (await lstat(index)).isSymbolicLink()) throw new Error('Worker entry must be a regular file.');
  const appBytes = await readFile(index);
  if (appBytes.includes(Buffer.from("import assets from './lumen-static-assets.js'"))) throw new Error('Cannot wrap an existing static entry. Run a fresh build.');
  const rows = [], inventory = [];
  let totalBytes = 0;
  const foundPublic = new Set();
  for (const file of clientFiles) {
    const name = relative(client, file).split('\\').join('/');
    if (INTERNAL_FILES.has(name) || name.startsWith('.vite/')) continue;
    let contentType, immutable = false;
    if (/^_next\/static\/[A-Za-z0-9_./-]+\.(?:js|css)$/.test(name) && !name.split('/').some(part => part.startsWith('.'))) {
      contentType = name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8';
      immutable = true;
    } else if (publicNames.has(name)) {
      contentType = publicType(name);
      foundPublic.add(name);
    } else throw new Error(`Unreviewed client output: ${name}`);
    const stat = await lstat(file);
    if (stat.size > MAX_FILE_BYTES) throw new Error('Static asset exceeds the 2 MiB per-file limit.');
    const bytes = await readFile(file);
    if (bytes.length > MAX_FILE_BYTES) throw new Error('Static asset exceeds the 2 MiB per-file limit.');
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES || rows.length >= MAX_FILES) throw new Error('Static asset bundle exceeds its size or file-count limit.');
    if (!immutable && !bytes.equals(await readFile(join(root, 'public', name)))) throw new Error('Copied public asset differs from its source.');
    const digest = hash(bytes), etag = `W/"sha256-${digest}"`;
    const encoding = contentType.startsWith('image/jpeg') ? 'base64' : 'utf8';
    const body = encoding === 'base64' ? bytes.toString('base64') : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // Fatal UTF-8 decoding rejects corrupt text. Compare the round trip as well.
    if (!bytes.equals(Buffer.from(body, encoding))) throw new Error('Asset encoding changed the original bytes.');
    rows.push([`/${name}`, { body, encoding, contentType, size: bytes.length, etag, immutable }]);
    inventory.push({ pathname: `/${name}`, contentType, size: bytes.length, sha256: digest, etag, immutable });
  }
  if (!rows.length || foundPublic.size !== publicNames.size) throw new Error('Build is missing expected public assets.');
  const module = `// Generated from reviewed public build output. Do not edit.\nexport default new Map(${JSON.stringify(rows)});\n`;
  const wrapper = await readFile(join(root, 'build/static-worker.mjs'));
  const runtime = await readFile(join(root, 'build/static-asset-response.mjs'));
  const wranglerPath = join(server, 'wrangler.json');
  const wrangler = JSON.parse(await readFile(wranglerPath, 'utf8'));
  if (wrangler.main !== 'index.js') throw new Error('Unexpected Worker entry in build configuration.');
  delete wrangler.assets;
  const modules = {
    'index.js': hash(wrapper), 'lumen-app.js': hash(appBytes),
    'lumen-static-assets.js': hash(module), 'lumen-static-response.js': hash(runtime),
  };
  await writeFile(join(server, 'lumen-static-assets.js'), module);
  await writeFile(join(server, 'lumen-static-response.js'), runtime);
  await rename(index, join(server, 'lumen-app.js'));
  await writeFile(index, wrapper);
  await writeFile(wranglerPath, JSON.stringify(wrangler) + '\n');
  await mkdir(join(output, '.openai'), { recursive: true });
  await writeFile(markerPath, JSON.stringify({ version: 1, count: rows.length, totalBytes, modules, assets: inventory }, null, 2) + '\n');
  // Removing the duplicate public set prevents the platform's static-first route
  // from bypassing our response policy. Application metadata and DB stay intact.
  await rm(client, { recursive: true });
  return { count: rows.length, totalBytes, alreadyPrepared: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = await prepareEmbeddedAssets(root);
  console.log(JSON.stringify({ embeddedStaticAssets: result }));
}

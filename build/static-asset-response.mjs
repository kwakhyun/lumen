// This module is copied into the built Worker. Keep it independent of Node.js
// and source-relative imports so production serves only the embedded manifest.
const STATIC_POLICY = "default-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const INTERNAL_PATHS = new Set([
  '/vinext-client-entry-manifest.json',
  '/_headers',
  '/.assetsignore',
  '/wrangler.json',
]);

function isInternalPath(pathname) {
  return INTERNAL_PATHS.has(pathname) || pathname === '/.vite' || pathname.startsWith('/.vite/');
}

function isStaticPath(pathname) {
  return pathname === '/_next/static' || pathname.startsWith('/_next/static/');
}

function securityHeaders(url) {
  const headers = new Headers({
    'Content-Security-Policy': STATIC_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Accept-Ranges': 'none',
  });
  if (url.protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');
  return headers;
}

function errorResponse(request, url, status, message, allow) {
  const headers = securityHeaders(url);
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  if (allow) headers.set('Allow', allow);
  return new Response(request.method === 'HEAD' ? null : message, { status, headers });
}

function matchesEntityTag(condition, etag) {
  if (!condition) return false;
  const value = condition.trim();
  if (value === '*') return true;
  // Parse quoted opaque tags rather than splitting blindly on commas, which
  // are legal inside an entity tag. Invalid list members never match.
  const tokens = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '"') quoted = !quoted;
    else if (value[index] === ',' && !quoted) {
      tokens.push(value.slice(start, index));
      start = index + 1;
    }
  }
  tokens.push(value.slice(start));
  const expected = etag.replace(/^W\//, '');
  return tokens.some(token => {
    const candidate = token.trim();
    return /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(candidate)
      && candidate.replace(/^W\//, '') === expected;
  });
}

/**
 * @typedef {{body: string, encoding: 'utf8'|'base64', contentType: string,
 *   size: number, etag: string, immutable: boolean}} EmbeddedAsset
 */

/**
 * Serve a build-owned public asset, or return null for application routing.
 * No request-controlled file access, external request, cookie or auth state is
 * involved. Query parameters do not change the bytes at a public asset URL.
 * @param {Request} request
 * @param {Map<string, EmbeddedAsset>} assets
 * @returns {Response|null}
 */
export function serveStaticAsset(request, assets) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  let decodedPathname = pathname;
  try { decodedPathname = decodeURIComponent(pathname); } catch { /* Keep exact lookup semantics. */ }

  // Internal metadata must remain unavailable even if a malformed build adds
  // it to the manifest. Encoded aliases are never used to retrieve assets.
  if (isInternalPath(pathname) || isInternalPath(decodedPathname)) {
    return errorResponse(request, url, 404, 'Not found');
  }

  const asset = assets.get(pathname);
  if (!asset) {
    return isStaticPath(pathname) || isStaticPath(decodedPathname)
      ? errorResponse(request, url, 404, 'Not found')
      : null;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse(request, url, 405, 'Method not allowed', 'GET, HEAD');
  }

  const headers = securityHeaders(url);
  headers.set('Content-Type', asset.contentType);
  headers.set('Cache-Control', asset.immutable
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate');
  headers.set('ETag', asset.etag);

  if (matchesEntityTag(request.headers.get('If-None-Match'), asset.etag)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('Content-Length', String(asset.size));
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  // Range requests intentionally receive the full representation. The small
  // build-owned assets do not need a second partial-response implementation.
  let body = asset.body;
  if (asset.encoding === 'base64') {
    const binary = atob(asset.body);
    const bytes = new Uint8Array(binary.length);
    // Avoid Array.from's per-byte callback overhead for the preview image.
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    body = bytes;
  }
  return new Response(body, { status: 200, headers });
}

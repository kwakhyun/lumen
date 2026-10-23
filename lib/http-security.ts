/** Browser policy for production responses. Provider calls run on the server. */
function documentPolicy(nonce: string, landing: boolean): string {
  const googleTag = landing ? ' https://www.googletagmanager.com' : '';
  const analytics = landing ? ' https://*.google-analytics.com' : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${googleTag}`,
    "script-src-attr 'none'",
    // React charts and positioning components use inline styles, not inline scripts.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self'${googleTag}${analytics}`,
    "font-src 'self'",
    `connect-src 'self'${googleTag}${analytics}${landing ? ' https://*.google.com' : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'self'",
    "worker-src 'none'",
  ].join('; ');
}

export function prepareSecurityRequest(request: Request): { request: Request; nonce: string; policy: string } {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
  const policy = documentPolicy(nonce, new URL(request.url).pathname === '/');
  const headers = new Headers(request.headers);
  // Never accept a client-selected nonce. Vinext reads this trusted request policy
  // when rendering React bootstrap, streamed RSC chunks and framework scripts.
  headers.set('Content-Security-Policy', policy);
  headers.delete('Content-Security-Policy-Report-Only');
  headers.set('x-lumen-csp-nonce', nonce);
  return { request: new Request(request, { headers }), nonce, policy };
}

export function applySecurityHeaders(request: Request, response: Response, policy: string): Response {
  // Preserve streaming, redirects, cookies, MIME types and API/CORS headers.
  const secured = new Response(response.body, response);
  const headers = secured.headers;
  headers.set('X-Content-Type-Options', 'nosniff');
  if (!headers.has('X-Frame-Options')) headers.set('X-Frame-Options', 'SAMEORIGIN');
  if (!headers.has('Referrer-Policy')) headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // This hostname is HTTPS-only. Do not enroll sibling/subdomains or preload.
  if (new URL(request.url).protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');
  // Downloads and image responses can define stricter policies of their own.
  if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', policy);
  if (/^text\/html(?:;|$)/i.test(headers.get('Content-Type') || '')) {
    // A cached document must never share a nonce with another response.
    headers.set('Cache-Control', 'private, no-store');
    headers.set('CDN-Cache-Control', 'no-store');
    headers.delete('ETag');
    headers.delete('Last-Modified');
  }
  return secured;
}

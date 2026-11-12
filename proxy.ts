import { NextRequest, NextResponse } from 'next/server';
import { prepareSecurityRequest } from '@/lib/http-security';

export function proxy(request: NextRequest) {
  const secured=prepareSecurityRequest(request);
  const headers=secured.request.headers;
  // These headers were trusted only behind Sites' authentication gateway.
  for(const key of [...headers.keys()])if(key.startsWith('oai-authenticated-'))headers.delete(key);
  // Trusted copies for server code that has no Request object (guest read-only check).
  headers.set('x-lumen-method',request.method);headers.set('x-lumen-path',request.nextUrl.pathname);
  let policy=secured.policy;
  if(request.nextUrl.pathname==='/sign-in')policy=policy.replace("form-action 'self'","form-action 'self' https://accounts.google.com");
  if(process.env.NODE_ENV==='development')policy=policy.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'");
  headers.set('Content-Security-Policy',policy);
  const response=NextResponse.next({request:{headers}});
  response.headers.set('Content-Security-Policy',policy);
  response.headers.set('X-Content-Type-Options','nosniff');
  response.headers.set('X-Frame-Options','SAMEORIGIN');
  response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  if(request.nextUrl.protocol==='https:')response.headers.set('Strict-Transport-Security','max-age=31536000');
  if(!request.nextUrl.pathname.startsWith('/api/')){response.headers.set('Cache-Control','private, no-store');response.headers.set('CDN-Cache-Control','no-store');}
  return response;
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.svg|product-preview.jpg|og-image.jpg).*)']};

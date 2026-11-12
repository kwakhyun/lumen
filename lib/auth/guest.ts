/** Read-only visitor of the shared sample workspace. Never a real account. */
export const GUEST_COOKIE = 'lumen_guest';
export const GUEST_USER_ID = 'guest-demo';
/** Fixed ID: concurrent first visits collide on insert instead of creating two samples. */
export const GUEST_SITE_ID = 'd0000000-0000-4000-8000-000000000001';

/** The only non-GET requests a guest may make: both answer from sample data and store nothing. */
const GUEST_POST = /^\/api\/sites\/[0-9a-f-]{36}\/(?:assistant|agents|rehearsal|suggest)$/i;
export function guestMayRequest(method: string | null, path: string | null): boolean {
  const verb = (method || '').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') return true;
  return verb === 'POST' && GUEST_POST.test(path || '');
}

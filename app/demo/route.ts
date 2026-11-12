import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/db';
import * as t from '@/db/schema';
import { GUEST_COOKIE, GUEST_SITE_ID, GUEST_USER_ID } from '@/lib/auth/guest';
import { seedDemo } from '@/lib/product-demo';

export const dynamic = 'force-dynamic';
const STALE_AFTER_MS = 3 * 86_400_000;

/** Sample data is dated at seeding time, so an old shared sample is replaced before it leaves the 7-day window. */
async function ensureGuestSample() {
  const db = getDb();
  const [existing] = await db.select().from(t.sites).where(and(eq(t.sites.ownerId, GUEST_USER_ID), eq(t.sites.mode, 'demo'))).limit(1);
  if (existing && Date.now() - Date.parse(existing.createdAt) < STALE_AFTER_MS) return;
  if (existing) await db.delete(t.sites).where(and(eq(t.sites.id, existing.id), eq(t.sites.ownerId, GUEST_USER_ID)));
  try { await seedDemo(GUEST_USER_ID, { siteId: GUEST_SITE_ID }); }
  catch (error) { if (!(error instanceof Error && /UNIQUE constraint failed/i.test(error.message))) throw error; }
}

/** Opens the sample workspace without an account. Signed-in visitors get their own sample instead. */
export async function GET() {
  const headers = new Headers({ Location: '/dashboard?demo=1', 'Cache-Control': 'no-store' });
  const session = await auth();
  if (session?.user?.id) {
    headers.append('Set-Cookie', `${GUEST_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    return new Response(null, { status: 307, headers });
  }
  try { await ensureGuestSample(); }
  catch (error) {
    console.error('[guest-demo]', error instanceof Error ? error.name : 'unknown');
    return new Response(null, { status: 307, headers: { Location: '/sign-in?return_to=%2Fdashboard%3Fdemo%3D1', 'Cache-Control': 'no-store' } });
  }
  headers.append('Set-Cookie', `${GUEST_COOKIE}=1; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  return new Response(null, { status: 307, headers });
}

import { env } from '@/lib/runtime-env';
import { requireVercelSchedule } from '@/lib/operations-security';
import { tickDueSchedules } from '@/lib/automation-runner';
import { errorResponse } from '@/lib/product-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Fixed scope and batch size; a preview must never spend the owner's AI budget. */
export async function POST(request: Request) {
  try {
    await requireVercelSchedule(request);
    if (env.VERCEL_ENV !== 'production' || env.LUMEN_SCHEDULES_ENABLED !== 'true') {
      return Response.json({ skipped: true, reason: 'schedule_disabled' }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    return Response.json(await tickDueSchedules({ limit: 1, entryPoint: 'service_bearer' }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

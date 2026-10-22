import { errorResponse, requireUser } from '@/lib/product-server';
import { finishGa4Connection } from '@/lib/ga4';
import { configuredOrigin } from '@/lib/integration-security';
export async function GET(request: Request) {
  try {
    const user = await requireUser(), url = new URL(request.url);
    try { const siteId = await finishGa4Connection(user.userId, url.searchParams.get('state') || '', url.searchParams.get('code'), url.searchParams.has('error'));
      return new Response(null, { status: 303, headers: { Location: `${configuredOrigin()}/dashboard/traffic?ga4=connected&site=${encodeURIComponent(siteId)}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    } catch { return new Response(null, { status: 303, headers: { Location: `${configuredOrigin()}/dashboard/traffic?ga4=error`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }); }
  } catch (error) { return errorResponse(error); }
}

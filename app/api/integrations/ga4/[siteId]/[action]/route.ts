import { z } from 'zod';
import { errorResponse, requireUser } from '@/lib/product-server';
import { assertSameOrigin, ProductError, readJson } from '@/lib/product-validation';
import { disconnectGa4, ga4Status, listGa4Properties, selectGa4Property, startGa4Connection, syncGa4 } from '@/lib/ga4';
type Context = { params: Promise<{ siteId: string; action: string }> };
const json = (data: unknown) => Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
export async function GET(request: Request, context: Context) {
  try { const user = await requireUser(), { siteId, action } = await context.params;
    if (action === 'status') return json(await ga4Status(user.userId, siteId));
    if (action === 'properties') return json(await listGa4Properties(user.userId, siteId, new URL(request.url).searchParams.get('pageToken') || undefined));
    throw new ProductError(404, 'Integration action not found.', 'not_found');
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try { const user = await requireUser(); assertSameOrigin(request); const { siteId, action } = await context.params;
    if (action === 'property') { const body = await readJson(request, z.object({ propertyId: z.string().regex(/^\d{1,20}$/) }).strict()); return json(await selectGa4Property(user.userId, siteId, body.propertyId)); }
    if (action === 'sync') { const body = await readJson(request, z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) }).strict()); return json(await syncGa4(user.userId, siteId, body.days)); }
    await readJson(request, z.object({}).strict());
    if (action === 'connect') return json(await startGa4Connection(user.userId, siteId));
    if (action === 'disconnect') return json(await disconnectGa4(user.userId, siteId));
    throw new ProductError(404, 'Integration action not found.', 'not_found');
  } catch (error) { return errorResponse(error); }
}

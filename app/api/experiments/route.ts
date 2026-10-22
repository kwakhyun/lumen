import { requireUser, errorResponse } from '@/lib/product-server';
import { assertSameOrigin, ProductError, readJson } from '@/lib/product-validation';
import { createExperiment, experimentInput, experimentPatch, getExperiments, updateExperiment } from '@/lib/experiments-server';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const user = await requireUser(), params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== 'siteId') || params.getAll('siteId').length !== 1) throw new ProductError(400, '워크스페이스를 선택해 주세요.', 'invalid_input');
    return Response.json(await getExperiments(user.userId, params.get('siteId')!), { headers });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { const user = await requireUser(); assertSameOrigin(request); const input = await readJson(request, experimentInput); return Response.json(await createExperiment(user.userId, input), { status: 201, headers }); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  try { const user = await requireUser(); assertSameOrigin(request); return Response.json(await updateExperiment(user.userId, await readJson(request, experimentPatch)), { headers }); }
  catch (error) { return errorResponse(error); }
}

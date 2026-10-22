import { z } from 'zod';
import { requireUser, errorResponse } from '@/lib/product-server';
import { assertSameOrigin, ProductError, readJson } from '@/lib/product-validation';
import { createImpact, getImpact, voidImpact } from '@/lib/impact-server';
import { impactPostSchema, impactVoidSchema } from '@/lib/impact-validation';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  try { const user = await requireUser(), params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['siteId', 'studyId'].includes(key)) || params.getAll('siteId').length !== 1 || params.getAll('studyId').length > 1 || !z.string().uuid().safeParse(params.get('siteId')).success || (params.has('studyId') && !z.string().uuid().safeParse(params.get('studyId')).success)) throw new ProductError(400, '워크스페이스와 검증 계획을 확인해 주세요.', 'invalid_input');
    return Response.json(await getImpact(user.userId, params.get('siteId')!, params.get('studyId') || undefined), { headers });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) { try { const user = await requireUser(); assertSameOrigin(request); return Response.json(await createImpact(user.userId, await readJson(request, impactPostSchema, 65536)), { status: 201, headers }); } catch (error) { return errorResponse(error); } }
export async function PATCH(request: Request) { try { const user = await requireUser(); assertSameOrigin(request); return Response.json(await voidImpact(user.userId, await readJson(request, impactVoidSchema)), { headers }); } catch (error) { return errorResponse(error); } }

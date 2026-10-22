import { z } from 'zod';
import { requireUser, errorResponse } from '@/lib/product-server';
import { assertSameOrigin, ProductError, readJson } from '@/lib/product-validation';
import { createImpactBaseline, getImpactBaselines } from '@/lib/impact-baseline-server';
import { impactBaselineRequestSchema } from '@/lib/impact-baseline-validation';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  try { const user = await requireUser(), params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['siteId','studyId'].includes(key)) || ['siteId','studyId'].some(key => params.getAll(key).length !== 1 || !z.string().uuid().safeParse(params.get(key)).success)) throw new ProductError(400, '워크스페이스와 검증 계획을 확인해 주세요.', 'invalid_input');
    return Response.json(await getImpactBaselines(user.userId, params.get('siteId')!, params.get('studyId')!), { headers });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) { try { const user = await requireUser(); assertSameOrigin(request); const result = await createImpactBaseline(user.userId, await readJson(request, impactBaselineRequestSchema, 4096)); return Response.json(result, { status: result.cached ? 200 : 201, headers }); } catch (error) { return errorResponse(error); } }

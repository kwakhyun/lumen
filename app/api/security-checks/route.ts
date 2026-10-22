import { z } from 'zod';
import { requireUser, errorResponse } from '@/lib/product-server';
import { assertSameOrigin, ProductError, readJson } from '@/lib/product-validation';
import { getSecurityChecks, createSecurityCheck } from '@/lib/security-server';
import { securityPostSchema } from '@/lib/security-validation';
import { SECURITY_REQUEST_BYTES } from '@/lib/security-types';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
function failure(error: unknown) { const response = errorResponse(error); response.headers.set('Cache-Control', 'private, no-store'); return response; }
export async function GET(request: Request) {
  try {
    const user = await requireUser(), params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== 'siteId') || params.getAll('siteId').length !== 1 || !z.string().uuid().safeParse(params.get('siteId')).success) throw new ProductError(400, '워크스페이스를 확인해 주세요.', 'invalid_input');
    return Response.json(await getSecurityChecks(user.userId, params.get('siteId')!), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    assertSameOrigin(request);
    const input = await readJson(request, securityPostSchema, SECURITY_REQUEST_BYTES);
    return Response.json(await createSecurityCheck(user.userId, input), { status: 201, headers });
  } catch (error) { return failure(error); }
}

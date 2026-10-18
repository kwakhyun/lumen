import { z } from 'zod';
import { acceptEligibility, eligibilityStatus } from '@/lib/eligibility';
import { errorResponse, requireUser } from '@/lib/product-server';
import { assertSameOrigin, readJson } from '@/lib/product-validation';

export const dynamic = 'force-dynamic';
const json = (value: unknown) => Response.json(value, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
export async function GET() {
  try { const user = await requireUser(); return json(await eligibilityStatus(user.userId)); } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await readJson(request, z.object({ adult: z.literal(true), korea: z.literal(true), business: z.literal(true), understandsDataUse: z.literal(true) }).strict(), 1024);
    return json(await acceptEligibility(user.userId));
  } catch (error) { return errorResponse(error); }
}

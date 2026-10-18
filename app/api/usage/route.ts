import { errorResponse, requireUser } from '@/lib/product-server';
import { getUsageStatus } from '@/lib/usage';
export async function GET() { try { const user = await requireUser(); return Response.json(await getUsageStatus(user.userId), { headers: { 'Cache-Control': 'no-store' } }); } catch (error) { return errorResponse(error); } }

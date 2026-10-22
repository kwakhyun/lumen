import { z } from 'zod';
import { assertSameOrigin,readJson } from '@/lib/product-validation';
import { requireUser,errorResponse } from '@/lib/product-server';
import { acknowledgeAlert } from '@/lib/operations-server';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{assertSameOrigin(request);const user=await requireUser(),input=await readJson(request,z.object({siteId:z.string().uuid(),id:z.string().uuid(),status:z.enum(['acknowledged','resolved'])}).strict());return Response.json({alert:await acknowledgeAlert(user.userId,input.siteId,input.id,input.status)},{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}

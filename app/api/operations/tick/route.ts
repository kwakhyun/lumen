import { z } from 'zod';
import { readJson } from '@/lib/product-validation';
import { errorResponse } from '@/lib/product-server';
import { requireAutomationService } from '@/lib/operations-security';
import { tickDueSchedules } from '@/lib/automation-runner';
export const dynamic='force-dynamic';
/** No browser identity or arbitrary owner selector is accepted on this narrow service endpoint. */
export async function POST(request:Request){try{await requireAutomationService(request);const input=await readJson(request,z.object({limit:z.number().int().min(1).max(2).default(1)}).strict(),1024);return Response.json(await tickDueSchedules({limit:input.limit,entryPoint:'service_bearer'}),{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}

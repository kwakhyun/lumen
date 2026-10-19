import { z } from 'zod';
import { assertSameOrigin,readJson } from '@/lib/product-validation';
import { requireUser,errorResponse,quota } from '@/lib/product-server';
import { readOwnedExecution } from '@/lib/operations-server';
import { enqueueManualSchedule,tickDueSchedules } from '@/lib/automation-runner';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{assertSameOrigin(request);const user=await requireUser(),input=await readJson(request,z.object({siteId:z.string().uuid(),scheduleId:z.string().uuid()}).strict());await quota(user.userId,'schedule-run-requests',10,1,60000);const execution=await enqueueManualSchedule(user.userId,input.siteId,input.scheduleId),tick=await tickDueSchedules({ownerId:user.userId,limit:1,executionId:execution.id,entryPoint:'run_now_api'});return Response.json({execution:await readOwnedExecution(user.userId,input.siteId,execution.id),tick},{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}

import { z } from 'zod';
import { assertSameOrigin,readJson } from '@/lib/product-validation';
import { requireUser,errorResponse,quota } from '@/lib/product-server';
import { createSchedule,updateSchedule,deleteSchedule,scheduleInput,schedulePatch } from '@/lib/operations-server';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{assertSameOrigin(request);const user=await requireUser();await quota(user.userId,'schedule-writes',30,1,60000);return Response.json({schedule:await createSchedule(user.userId,await readJson(request,scheduleInput))},{status:201,headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}
export async function PATCH(request:Request){try{assertSameOrigin(request);const user=await requireUser();await quota(user.userId,'schedule-writes',30,1,60000);return Response.json({schedule:await updateSchedule(user.userId,await readJson(request,schedulePatch))},{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}
export async function DELETE(request:Request){try{assertSameOrigin(request);const user=await requireUser();const input=await readJson(request,z.object({siteId:z.string().uuid(),id:z.string().uuid()}).strict());await deleteSchedule(user.userId,input.siteId,input.id);return Response.json({deleted:true},{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}

import { requireUser,errorResponse } from '@/lib/product-server';
import { getOperationsState } from '@/lib/operations-server';
import { ProductError } from '@/lib/product-validation';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await requireUser(),siteId=new URL(request.url).searchParams.get('siteId');if(!siteId)throw new ProductError(400,'워크스페이스를 선택하세요.','invalid_input');return Response.json(await getOperationsState(user.userId,siteId),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return errorResponse(error);}}

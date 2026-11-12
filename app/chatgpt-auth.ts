import { cookies, headers } from 'next/headers';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { safeReturnPath } from '@/lib/auth/identity';
import { GUEST_COOKIE, GUEST_USER_ID, guestMayRequest } from '@/lib/auth/guest';

// Export names retained for existing callers; identity now comes only from Auth.js.
export type ChatGPTUser={userId:string;displayName:string;email:string;fullName:string|null;guest?:boolean};
export async function getChatGPTUser():Promise<ChatGPTUser|null>{
  const session=await auth();
  if(session?.user?.id&&session.user.email)return {userId:session.user.id,displayName:session.user.name||session.user.email,email:session.user.email,fullName:session.user.name||null};
  // No session: a visitor who opened /demo may read the shared sample workspace.
  // The method and path come from proxy.ts, which overwrites any client-supplied value.
  if((await cookies()).get(GUEST_COOKIE)?.value!=='1')return null;
  const request=await headers();
  if(!guestMayRequest(request.get('x-lumen-method'),request.get('x-lumen-path')))return null;
  return {userId:GUEST_USER_ID,displayName:'게스트',email:'',fullName:null,guest:true};
}
export async function requireChatGPTUser(returnTo:string):Promise<ChatGPTUser>{const user=await getChatGPTUser();if(user)return user;redirect(chatGPTSignInPath(returnTo));}
export function chatGPTSignInPath(returnTo:string){return '/sign-in?return_to='+encodeURIComponent(safeReturnPath(returnTo));}
export function chatGPTSignOutPath(){return '/sign-out';}

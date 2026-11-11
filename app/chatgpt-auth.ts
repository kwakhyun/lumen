import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { safeReturnPath } from '@/lib/auth/identity';

// Export names retained for existing callers; identity now comes only from Auth.js.
export type ChatGPTUser={userId:string;displayName:string;email:string;fullName:string|null};
export async function getChatGPTUser():Promise<ChatGPTUser|null>{
  const session=await auth();
  if(!session?.user?.id||!session.user.email)return null;
  return {userId:session.user.id,displayName:session.user.name||session.user.email,email:session.user.email,fullName:session.user.name||null};
}
export async function requireChatGPTUser(returnTo:string):Promise<ChatGPTUser>{const user=await getChatGPTUser();if(user)return user;redirect(chatGPTSignInPath(returnTo));}
export function chatGPTSignInPath(returnTo:string){return '/sign-in?return_to='+encodeURIComponent(safeReturnPath(returnTo));}
export function chatGPTSignOutPath(){return '/sign-out';}

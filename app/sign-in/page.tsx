import Link from 'next/link';
import { auth, signIn } from '@/auth';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { GUEST_COOKIE } from '@/lib/auth/guest';
import { safeReturnPath } from '@/lib/auth/identity';
import { LumenMark } from '@/components/lumen-mark';
import './sign-in.css';
export const dynamic='force-dynamic';
export default async function SignInPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams,returnTo=safeReturnPath(params.return_to);
  if(await auth())redirect(returnTo);
  const ready=Boolean(process.env.AUTH_GOOGLE_ID&&process.env.AUTH_GOOGLE_SECRET&&process.env.AUTH_SECRET);
  return <main className="auth-page"><section className="auth-card"><Link className="auth-brand" href="/" aria-label="Lumen 홈"><LumenMark size={30} />lumen</Link><h1>우리 브랜드의 AI 가시성을<br/>확인하고 관리하세요</h1><p>Google 계정으로 로그인하면 질문과 답변, 에이전트 실행 결과가 계정에 저장돼요.</p>{params.error&&<p role="alert" className="auth-error">로그인을 완료하지 못했어요. 같은 Google 계정으로 다시 시도해 주세요.</p>}{ready?<form action={async()=>{'use server';(await cookies()).delete(GUEST_COOKIE);await signIn('google',{redirectTo:returnTo});}}><button className="auth-primary" type="submit">Google로 계속하기 <span aria-hidden="true">↗</span></button></form>:<p role="status">로그인 연결을 준비하고 있어요. 잠시 후 다시 방문해 주세요.</p>}<p className="auth-note">처음이라면 로그인 없이 <Link href="/demo">샘플 워크스페이스</Link>를 먼저 둘러볼 수 있어요.</p><nav aria-label="서비스 안내"><Link href="/privacy">개인정보 처리 안내</Link><Link href="/terms">이용 안내</Link></nav></section></main>;
}

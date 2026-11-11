import Link from 'next/link';
import { auth, signIn } from '@/auth';
import { redirect } from 'next/navigation';
import { safeReturnPath } from '@/lib/auth/identity';
import './sign-in.css';
export const dynamic='force-dynamic';
export default async function SignInPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams,returnTo=safeReturnPath(params.return_to);
  if(await auth())redirect(returnTo);
  const ready=Boolean(process.env.AUTH_GOOGLE_ID&&process.env.AUTH_GOOGLE_SECRET&&process.env.AUTH_SECRET);
  return <main className="auth-page"><section className="auth-card"><Link className="auth-brand" href="/">Lumen</Link><h1>우리 브랜드의 AI 답변을<br/>이어서 확인하세요</h1><p>Google 계정으로 로그인하고 저장한 질문과 리포트를 확인하세요.</p>{params.error&&<p role="alert" className="auth-error">로그인을 완료하지 못했어요. 같은 Google 계정으로 다시 시도해 주세요.</p>}{ready?<form action={async()=>{'use server';await signIn('google',{redirectTo:returnTo});}}><button className="auth-primary" type="submit">Google로 계속하기 <span aria-hidden="true">↗</span></button></form>:<p role="status">로그인 연결을 준비하고 있습니다. 잠시 후 다시 방문해 주세요.</p>}<p className="auth-note">기존 사용자는 이전에 이용한 이메일의 Google 계정으로 로그인해 주세요.</p><nav aria-label="서비스 안내"><Link href="/privacy">개인정보 처리 안내</Link><Link href="/terms">이용 안내</Link></nav></section></main>;
}

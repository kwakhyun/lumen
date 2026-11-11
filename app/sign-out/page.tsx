import Link from 'next/link';
import { signOut } from '@/auth';
import '../sign-in/sign-in.css';
export default function SignOutPage(){return <main className="auth-page"><section className="auth-card"><Link className="auth-brand" href="/">Lumen</Link><h1>로그아웃할까요?</h1><p>저장한 질문과 리포트는 다음 로그인 때 다시 확인할 수 있어요.</p><form action={async()=>{'use server';await signOut({redirectTo:'/'});}}><button className="auth-primary" type="submit">로그아웃</button></form><Link className="auth-secondary" href="/dashboard">워크스페이스로 돌아가기</Link></section></main>}

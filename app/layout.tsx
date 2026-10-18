import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: {default:'Lumen — AI 검색 속 브랜드의 다음 기회',template:'%s | Lumen'},description:'AI 답변 속 브랜드 언급과 인용 출처를 분석하세요. 프롬프트, 경쟁 브랜드, 콘텐츠와 리포트를 하나의 워크스페이스에서 관리합니다.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="ko"><body>{children}</body></html>}

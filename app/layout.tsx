import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: {default:'Lumen — AI 답변 속 우리 브랜드 분석',template:'%s | Lumen'},description:'Gemini API 일반 응답에서 우리 브랜드가 어떻게 소개되는지 확인하세요. 무료 한도 안에서 답변을 수집하고 경쟁 브랜드를 비교하며 콘텐츠 초안과 리포트를 만들 수 있습니다. 웹 검색과 검색 인용은 제공하지 않습니다.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="ko"><body>{children}</body></html>}

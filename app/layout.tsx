import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: {default:'Lumen — AI 답변 속 브랜드를 읽는 워크스페이스',template:'%s | Lumen'},description:'Gemini API 일반 응답에서 브랜드 언급과 등장 맥락을 확인하세요. 질문, 경쟁 브랜드, 콘텐츠 초안과 리포트를 무료 한도 안에서 관리합니다. 웹 검색과 검색 인용은 제공하지 않습니다.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="ko"><body>{children}</body></html>}

import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: {default:'Lumen — AI 답변 속 우리 브랜드 분석',template:'%s | Lumen'},description:'무료 Gemini API 답변을 수집하고 브랜드 언급을 분석하세요. 실제 AI 검색 결과와 GA4 방문 데이터를 별도로 기록해 콘텐츠 개선 전후를 비교할 수 있습니다.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="ko"><body>{children}</body></html>}

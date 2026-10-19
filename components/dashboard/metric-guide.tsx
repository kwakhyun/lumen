"use client";
import type { SiteState } from '@/lib/product-types';
export default function MetricGuide({ state }: { state: SiteState }) {
  return <details className="d-metric-definition"><summary>지표 계산 기준과 데이터 범위</summary>
    <div className="d-table-wrap"><table className="d-table"><thead><tr><th>지표</th><th>계산 방법</th><th>확인할 점</th></tr></thead><tbody>
      <tr><td>언급률</td><td>브랜드를 언급한 완료 답변 수 / 전체 완료 답변 수</td><td>실패한 답변은 제외해요. 완료 답변 수와 실패 수를 함께 확인하세요.</td></tr>
      <tr><td>인용률</td><td>브랜드 도메인을 인용한 완료 답변 수 / 전체 완료 답변 수</td><td>AI 제공자가 확인한 인용만 계산해요. 무료 Gemini는 검색 인용을 제공하지 않아요.</td></tr>
      <tr><td>언급 점유율</td><td>우리 브랜드 언급 수 / 등록한 브랜드의 전체 언급 수</td><td>등록한 경쟁사를 바꾸면 과거 수치도 다시 계산돼요.</td></tr>
      <tr><td>질문 수집률</td><td>완료 답변이 있는 활성 질문 수 / 전체 활성 질문 수</td><td>질문을 추가하거나 비활성화하면 계산 기준이 달라져요.</td></tr>
    </tbody></table></div>
    <p>대시보드는 현재 등록된 브랜드와 질문을 기준으로 계산해요. 실험은 저장 당시의 브랜드 정보, 질문 문구와 모델을 유지하고 양쪽 모두 성공한 답변만 비교해요. 따라서 두 화면의 계산에 포함되는 답변 수는 다를 수 있어요.</p>
    <p>현재 표시 범위: 최근 {state.dataWindow?.days ?? 30}일, 답변 {state.dataWindow?.answersReturned ?? state.answers.length}개{state.dataWindow?.truncated ? ` / 전체 ${state.dataWindow.totalAnswers}개. 조회 한도를 넘어 일부 답변은 표시되지 않아요.` : '. 선택한 필터와 수집에 따라 집계해요.'} 차트의 날짜는 UTC, 수집 시각은 한국 시간(KST)을 기준으로 표시해요.</p>
  </details>;
}

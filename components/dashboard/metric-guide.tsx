"use client";
import type { SiteState } from '@/lib/product-types';
export default function MetricGuide({ state }: { state: SiteState }) {
  return <details className="d-metric-definition"><summary>숫자를 읽는 기준과 데이터 범위</summary>
    <div className="d-table-wrap"><table className="d-table"><thead><tr><th>지표</th><th>분자 / 분모</th><th>해석할 때 확인할 점</th></tr></thead><tbody>
      <tr><td>언급률</td><td>브랜드를 언급한 성공 답변 / 성공 답변</td><td>실패는 제외됩니다. 답변 수와 실패 수를 함께 확인하세요.</td></tr>
      <tr><td>인용률</td><td>브랜드 도메인을 인용한 성공 답변 / 성공 답변</td><td>제공자가 확인한 인용만 계산합니다. 무료 Gemini는 검색 인용 미제공입니다.</td></tr>
      <tr><td>언급 점유율</td><td>우리 브랜드 언급 / 추적 브랜드 전체 언급</td><td>등록한 경쟁사를 바꾸면 과거 수치도 다시 계산됩니다.</td></tr>
      <tr><td>질문 커버리지</td><td>성공 답변이 있는 활성 질문 / 현재 활성 질문</td><td>질문을 추가하거나 비활성화하면 분모가 달라집니다.</td></tr>
    </tbody></table></div>
    <p>대시보드는 현재 브랜드와 질문 정의를 적용합니다. 실험은 저장 당시의 정의와 질문 문구, 모델을 고정하고 양쪽 모두 성공한 표본만 비교합니다. 두 화면의 분모가 다를 수 있습니다.</p>
    <p>현재 조회 범위: 최근 {state.dataWindow?.days ?? 30}일, 답변 {state.dataWindow?.answersReturned ?? state.answers.length}개{state.dataWindow?.truncated ? ` / 전체 ${state.dataWindow.totalAnswers}개. 조회 한도로 일부 답변이 생략됐습니다.` : '. 표시된 필터와 선택한 수집에 따라 집계합니다.'} 추이는 UTC 날짜 기준이며 수집 시각 표시는 KST입니다.</p>
  </details>;
}

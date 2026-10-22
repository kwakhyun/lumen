"use client";
import type { Metrics, SiteState } from '@/lib/product-types';
export default function MetricGuide({ state, metrics = state.metrics }: { state: SiteState; metrics?: Metrics }) {
  return <details className="d-metric-definition"><summary>지표 계산 기준과 데이터 범위</summary>
    <div className="d-table-wrap"><table className="d-table"><thead><tr><th>지표</th><th>계산 방법</th><th>확인할 점</th></tr></thead><tbody>
      <tr><td>언급률</td><td>브랜드를 언급한 완료 답변 수 / 전체 완료 답변 수</td><td>한 답변에서 브랜드를 여러 번 언급해도 한 번만 세요. 실패와 진행 중인 답변은 제외해요.</td></tr>
      <tr><td>인용률</td><td>브랜드 도메인을 인용한 답변 수 / 검색 인용을 제공하는 완료 답변 수</td><td>무료 Gemini와 지원 여부를 확인할 수 없는 모델은 분모에서 제외해요. 측정할 수 없으면 ‘측정 불가’, 측정했지만 인용이 없으면 0%예요.</td></tr>
      <tr><td>언급 점유율</td><td>우리 브랜드 언급 수 / 등록한 브랜드의 전체 언급 수</td><td>같은 도메인의 중복 브랜드는 한 번만 세요. 등록한 경쟁사를 바꾸면 과거 수치도 다시 계산돼요.</td></tr>
      <tr><td>질문 수집률</td><td>완료 답변이 있는 활성 질문 수 / 전체 활성 질문 수</td><td>수집 진행 정도예요. 브랜드가 얼마나 노출됐는지를 뜻하지 않아요.</td></tr>
      <tr><td>브랜드 언급 질문 비율</td><td>브랜드를 언급한 완료 답변이 하나 이상 있는 활성 질문 수 / 전체 활성 질문 수</td><td>한 질문에 여러 모델이 답해도 질문은 한 번만 세요. 아직 수집하지 않은 질문도 분모에 남아요.</td></tr>
    </tbody></table></div>
    <p>지표 버전 {metrics.metricsVersion}. 현재 비율의 표본은 완료 {metrics.answerCount}개예요. 인용은 이 가운데 {metrics.citationEligibleAnswerCount}개를 대상으로 계산해요. 실제 응답과 합성 샘플은 섞지 않아요. 출처 목록도 같은 인용 기준을 사용해요. 본문에 적힌 URL만으로는 인용으로 인정하지 않아요.</p>
    <p>요약과 표는 선택한 기간 안에서 가장 최근에 종료된 수집을 비교하고, 추이 차트는 날짜별 완료 답변을 모두 집계해요. 날짜는 UTC, 수집 시각은 한국 시간(KST) 기준이에요. 실패를 제외하면 결과가 좋아 보일 수 있으므로 실패 수도 함께 확인하세요.</p>
    <p>대시보드는 현재 등록된 브랜드를 기준으로 계산해요. 실험은 저장 당시의 브랜드 정보, 질문 문구와 모델을 유지하고 양쪽 모두 성공한 답변만 비교해요. 따라서 두 화면의 계산에 포함되는 답변 수는 다를 수 있어요.</p>
    <p>현재 조회 범위: 최근 {state.dataWindow?.days ?? 30}일, 답변 {state.dataWindow?.answersReturned ?? state.answers.length}개{state.dataWindow?.truncated ? ` / 전체 ${state.dataWindow.totalAnswers}개. 조회 한도를 넘어 일부 답변은 표시되지 않아요.` : '. 필터에 따라 비교 표본은 달라져요.'}</p>
  </details>;
}

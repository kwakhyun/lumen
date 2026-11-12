import type { DashboardScope } from "@/lib/dashboard-scope";
import { modelLabel } from "./client";

export function analysisScopeLabel(scope: DashboardScope) {
  return `최근 ${scope.period}일 / ${scope.model === "all" ? "모든 AI 모델" : modelLabel(scope.model)}`;
}

export function savedAnalysisLabel(content: string) {
  if (!content.startsWith("## 분석 기준\n")) return "분석 조건 기록 없음";
  const header = content.split("\n---\n", 1)[0];
  const period = header.match(/^- 기간: 최근 (7|30)일$/m)?.[1];
  const model = header.match(/^- 관측 모델: (.+)$/m)?.[1].replaceAll("`", "");
  return period && model ? `최근 ${period}일 / ${model === "전체 모델" ? "모든 AI 모델" : modelLabel(model)}` : "분석 조건 기록 없음";
}

export default function AnalysisScope({ scope, answerCount }: { scope: DashboardScope; answerCount: number }) {
  return <div className="d-analysis-scope" aria-label="생성에 사용할 분석 조건">
    <strong>{analysisScopeLabel(scope)}</strong>
    <span>현재 화면의 완료 답변 {answerCount}개</span>
    <p>{answerCount ? "실행 시점에 같은 기간과 모델로 다시 집계해요. 새 수집 결과에 따라 표본 수가 달라질 수 있어요." : "현재 완료 답변이 없어요. 실행 시에도 완료 답변이 없으면 근거 부족을 표시하고 AI 사용량을 차감하지 않아요."}</p>
  </div>;
}

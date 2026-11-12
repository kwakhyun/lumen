"use client";

import { useId, type ReactNode } from "react";
import type { DashboardScope } from "@/lib/dashboard-scope";
import type { Answer, Metrics } from "@/lib/product-types";
import { modelLabel } from "./client";
import { numberLabel } from "./ui";

/** Use only the same completed, deduplicated mode cohort that contributes to the metric. */
export function latestCompletedAnswer(answers: Answer[], mode: Metrics["dataMode"]) {
  const seen = new Set<string>();
  let latest: { at: string; timestamp: number; collectedAtFallback: boolean } | null = null;
  for (const answer of answers) {
    if (answer.mode !== mode || (answer.id && seen.has(answer.id))) continue;
    if (answer.id) seen.add(answer.id);
    if (answer.status !== "completed") continue;
    const completed = Date.parse(answer.completedAt || "");
    const collectedAtFallback = !Number.isFinite(completed);
    const timestamp = collectedAtFallback ? Date.parse(answer.createdAt) : completed;
    if (Number.isFinite(timestamp) && (!latest || timestamp > latest.timestamp)) {
      latest = { at: new Date(timestamp).toISOString(), timestamp, collectedAtFallback };
    }
  }
  return latest;
}

export default function OverviewScope({ metrics, answers, scope, filters }: { metrics: Metrics; answers: Answer[]; scope: DashboardScope; filters: ReactNode }) {
  const labelId = useId();
  const sampleId = useId();
  const latest = latestCompletedAnswer(answers, metrics.dataMode);
  const has = metrics.answerCount > 0;
  const timestamp = latest ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(latest.at)) : null;

  return <div className="d-overview-metric-scope" aria-labelledby={labelId}>
    <div className="d-overview-metric-heading"><h2 id={labelId}>브랜드 언급률</h2><p>완료 답변 중 우리 브랜드를 언급한 답변의 비율</p></div>
    <div className="d-overview-scope-controls">{filters}</div>
    <div className="d-overview-metric-summary">
      <div className="d-overview-metric-result" aria-describedby={sampleId}>
        <strong>{has ? numberLabel(metrics.mentionRate) : "—"}{has && <small>%</small>}</strong>
        <p id={sampleId}>{has ? <>브랜드 언급 <b>{metrics.mentionCount}개</b><span aria-hidden="true"> / </span><span className="d-screen-reader">, </span>완료 답변 <b>{metrics.answerCount}개</b></> : "선택한 조건에 맞는 완료 답변이 없어요"}</p>
      </div>
      <dl className="d-overview-scope-facts">
        <div><dt>조회 기간</dt><dd>최근 {scope.period}일</dd></div>
        <div><dt>AI 모델</dt><dd>{scope.model === "all" ? "모든 AI 모델" : modelLabel(scope.model)}</dd></div>
        <div className="d-overview-scope-recent"><dt>최근 완료 답변</dt><dd>{latest ? <><time dateTime={latest.at}>{timestamp}</time><span className="d-overview-timezone">KST{latest.collectedAtFallback ? " / 수집 시각" : ""}</span></> : has ? "수집 시각 기록 없음" : "이 조건에서 완료한 답변 없음"}</dd></div>
      </dl>
    </div>
    {metrics.dataMode === "demo" ? <p className="d-overview-measurement-note">합성 샘플 답변 기준이에요. 실제 수집 성과가 아니에요.</p> : has && metrics.citationRate === null ? <p className="d-overview-measurement-note">웹 검색 인용을 제공하지 않는 API 일반 응답 기준이에요.</p> : null}
  </div>;
}

"use client";

import { useMemo, type ReactNode } from "react";
import { ArrowUpRight, ListChecks, Plus } from "lucide-react";
import type { Answer, Metrics, Prompt, SiteState } from "@/lib/product-types";
import type { DashboardScope } from "@/lib/dashboard-scope";
import { prioritizePromptOpportunities, summarizePromptEvidence } from "@/lib/prompt-opportunities";
import MetricGuide from "../metric-guide";
import OverviewScope from "../overview-scope";
import { hasOnlyUngroundedAnswers } from "../measurement";
import { measuredCitations } from "@/lib/metrics";
import { completedAnswersByPrompt, intentNames, ownMention } from "../prompt-evidence";
import { Badge, Button, Empty, Panel, TextLink, TrendChart, numberLabel } from "../ui";

export default function Overview({ state, metrics, answers, navigate, openPrompt, openForm, onCreateTask, scope = { period: "30", model: "all" }, filters }: { state: SiteState; metrics: Metrics; answers: Answer[]; navigate: (id: string) => void; openPrompt: (p: Prompt) => void; openForm: (k: "prompt") => void; onCreateTask: (p: Prompt) => void; scope?: DashboardScope; filters: ReactNode }) {
  const evidenceByPrompt = useMemo(() => completedAnswersByPrompt(answers), [answers]);
  const evidence = useMemo(() => summarizePromptEvidence(state.site, state.prompts, state.competitors, answers), [state.site, state.prompts, state.competitors, answers]);
  const opportunities = useMemo(() => prioritizePromptOpportunities(evidence), [evidence]);
  const activeEvidence = evidence.filter(row => row.prompt.active);
  const has = metrics.answerCount > 0;
  const citationUnavailable = has && metrics.citationRate === null;
  const recentPrompts = [...state.prompts].sort((a, b) => Number(b.pinned) - Number(a.pinned)).slice(0, 5);
  return <div className="d-overview-summary">
    <div className="d-briefing-grid">
      <div className="d-pulse-main">
        <section className="d-pulse-evidence" aria-label="브랜드 언급률 추이"><OverviewScope metrics={metrics} answers={answers} scope={scope} filters={filters} />{metrics.series.length > 0 ? <TrendChart data={metrics.series.map(point => ({ date: point.date, value: point.mentionRate }))} label="브랜드 언급률" /> : <Empty title={metrics.failedAnswerCount > 0 ? "답변을 가져오지 못했어요" : "선택한 조건에 맞는 완료 답변이 없어요"} text={metrics.failedAnswerCount > 0 ? "실패한 답변은 지표에 포함하지 않아요. 운영 기록에서 원인을 확인하세요." : "조회 기간과 모델을 확인해 주세요. 아직 수집하지 않았다면 등록한 질문에서 수집을 시작하세요."} action={metrics.failedAnswerCount > 0 ? <Button onClick={() => navigate("operations")}>실패 원인 확인</Button> : <Button onClick={() => state.prompts.length ? navigate("prompts") : openForm("prompt")}>{state.prompts.length ? "수집할 질문 확인" : <><Plus size={16} />질문 추가</>}</Button>} />}</section>
        <div className="d-inline-stats"><div><span>브랜드 언급 점유율</span><strong>{metrics.totalBrandMentions ? `${numberLabel(metrics.shareOfVoice)}%` : "—"}</strong><small>우리 브랜드 {metrics.mentionCount} / 전체 언급 {metrics.totalBrandMentions}건</small></div><div><span>브랜드 인용률</span><strong className={citationUnavailable ? "d-stat-text" : undefined}>{citationUnavailable ? "측정 불가" : metrics.citationRate !== null ? `${numberLabel(metrics.citationRate)}%` : "—"}</strong><small>{citationUnavailable ? "인용을 제공하는 완료 답변이 없어요" : `인용 ${metrics.citationCount} / 측정 가능한 답변 ${metrics.citationEligibleAnswerCount}개`}</small></div><div><span>평균 등장 순서</span><strong>{metrics.averageRank === null ? "—" : `${numberLabel(metrics.averageRank)}번째`}</strong><small>브랜드가 등장한 답변 기준</small></div></div>
      </div>
      <aside className="d-opportunities" aria-labelledby="opportunities-heading">
        <div className="d-opportunities-heading"><h2 id="opportunities-heading">우선 확인할 질문</h2><Badge tone="blue">{opportunities.length}개</Badge></div>
        <p className="d-opportunities-intro">경쟁사만 나온 답변, 자사 미언급 답변, 미수집 질문 순서예요.</p>
        {opportunities.length ? <ol className="d-opportunity-list">{opportunities.slice(0, 3).map(row => <li key={row.prompt.id}>
          <div className="d-opportunity-state"><Badge tone={row.competitorOnlyCount > 0 ? "amber" : "gray"}>{row.competitorOnlyCount > 0 ? "경쟁사만 언급된 답변" : row.completedCount ? "자사 미언급 답변" : "완료 답변 없음"}</Badge><span>{row.completedCount ? `${row.competitorOnlyCount || row.unmentionedCount} / ${row.completedCount}개` : row.failedCount ? `실패 ${row.failedCount}개` : row.pendingCount ? `진행 중 ${row.pendingCount}개` : "이 조건에서 미수집"}</span></div>
          <h3><button type="button" onClick={() => openPrompt(row.prompt)}>{row.prompt.text}</button></h3>
          <p>{row.competitorNames.length ? `해당 답변에 등장한 경쟁사: ${row.competitorNames.join(", ")}` : row.completedCount ? `자사 언급 ${row.mentionCount} / 완료 답변 ${row.completedCount}개. 원문에서 빠진 정보를 확인하세요.` : "완료 답변이 없어 브랜드 언급 여부를 판단할 수 없어요."}</p>
          <div className="d-opportunity-actions"><TextLink onClick={() => openPrompt(row.prompt)}>{row.completedCount ? "답변 보기" : "질문 확인"}</TextLink>{row.completedCount > 0 && <Button onClick={() => onCreateTask(row.prompt)} aria-label={`${row.prompt.text} 개선 작업 추가`}><Plus size={14} />작업 추가</Button>}</div>
        </li>)}</ol> : <div className="d-opportunity-empty"><ListChecks size={24} /><h3>{activeEvidence.length ? "우선 확인할 미언급 답변이 없어요" : "활성 질문이 없어요"}</h3><p>{activeEvidence.length ? "현재 조회 조건에서 활성 질문의 모든 완료 답변에 자사가 언급됐어요. 답변의 정확성과 설명도 함께 확인하세요." : "질문을 등록하거나 추적을 켜면 수집 결과를 바탕으로 확인할 질문을 보여줘요."}</p></div>}
        <TextLink onClick={() => navigate("prompts")}>전체 질문에서 확인</TextLink>
      </aside>
    </div>
    <Panel title="등록한 질문" subtitle={citationUnavailable ? "API 일반 응답이에요. 소비자용 AI 앱의 검색 노출을 뜻하지 않아요." : "질문별 답변과 인용 출처를 확인하세요."} action={<TextLink onClick={() => navigate("prompts")}>전체 보기</TextLink>}>{recentPrompts.length ? <><div className="d-table-wrap"><table className="d-table"><thead><tr><th>질문</th><th>질문 의도</th><th>완료 답변</th><th>브랜드 언급</th><th>인용 출처</th><th /></tr></thead><tbody>{recentPrompts.map(prompt => { const rows = evidenceByPrompt.get(prompt.id) || []; const mentions = rows.filter(answer => ownMention(answer, state.site)?.mentioned).length; return <tr key={prompt.id}><td className="d-td-title"><button className="d-table-title" onClick={() => openPrompt(prompt)}>{prompt.text}</button><div className="d-table-sub">{prompt.topic || "일반"}</div></td><td><Badge tone={prompt.intent === "comparison" ? "purple" : "gray"}>{intentNames[prompt.intent]}</Badge></td><td>{rows.length}개</td><td>{rows.length ? `${mentions} / ${rows.length}` : "—"}</td><td>{hasOnlyUngroundedAnswers(rows) ? "인용 미제공" : rows.length ? `${rows.reduce((sum, answer) => sum + measuredCitations(answer).length, 0)}개` : "—"}</td><td><button className="d-icon-button" aria-label={`${prompt.text} 답변 읽기`} onClick={() => openPrompt(prompt)}><ArrowUpRight size={18} /></button></td></tr>; })}</tbody></table></div><div className="d-table-footer"><span>활성 질문 {state.prompts.filter(prompt => prompt.active).length}개</span><span>질문 수집률 {numberLabel(metrics.coverage)}% ({metrics.completedPromptCount}/{metrics.promptCount})</span><span>브랜드 언급 질문 {metrics.mentionedPromptCount}/{metrics.promptCount}개 ({metrics.brandQuestionCoverage === null ? "—" : `${numberLabel(metrics.brandQuestionCoverage)}%`})</span></div></> : <Empty title="아직 등록한 질문이 없어요" text="고객이 제품을 찾거나 비교할 때 물을 만한 질문을 추가하세요." action={<Button onClick={() => openForm("prompt")}><Plus size={16} />첫 질문 추가</Button>} />}</Panel>
    <p className="d-caption d-section-space">현재 비교 표본: 완료 {metrics.answerCount}개, 실패 {metrics.failedAnswerCount}개, 진행 중 {metrics.pendingAnswerCount}개. 인용 지표에서는 검색 인용을 제공하지 않는 완료 답변 {metrics.citationExcludedAnswerCount}개를 추가로 제외해요.</p>
    <MetricGuide state={state} metrics={metrics} />
  </div>;
}


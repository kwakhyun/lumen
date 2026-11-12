"use client";

import SuggestField from "../suggest-field";
import { useMemo, useState } from "react";
import { Activity, ArrowRight, ArrowUp, CalendarDays, Check, Compass, Link2, RefreshCw, Sparkles, Target, Users, X } from "lucide-react";
import type { DashboardScope } from "@/lib/dashboard-scope";
import type { Metrics, SiteState } from "@/lib/product-types";
import { buildAgentEvidence } from "@/lib/agents/evidence";
import { buildSuggestions, type Suggestion } from "@/lib/agents/suggestions";
import type { AgentDefinition, AgentRun } from "@/lib/agents/types";
import type { AgentsController } from "../agents-client";
import { relativeTime } from "../client";
import { AgentIcon, runStatus } from "./agents";
import { Badge, Button, Empty, Panel, TextLink, TrendChart, colors, numberLabel } from "../ui";

const suggestionIcons = { target: Target, users: Users, refresh: RefreshCw, link: Link2, compass: Compass, calendar: CalendarDays, pulse: Activity };
const FEATURED = ["brand-health", "gap-analysis", "content-brief", "prompt-discovery"];

function Delta({ now, before }: { now: number; before: number | null | undefined }) {
  if (before === null || before === undefined) return null;
  const change = Math.round((now - before) * 10) / 10;
  return <span className={`d-delta ${change > 0 ? "d-delta-up" : change < 0 ? "d-delta-down" : "d-delta-flat"}`} title="직전 같은 길이 기간과 비교">{change > 0 ? "+" : ""}{numberLabel(change)}%p</span>;
}

export default function Home({ state, metrics, scope, clock, controller, readOnly, onLaunch, onOpenRun, onAsk, onCollect, onForm, navigate, flash }: {
  state: SiteState; metrics: Metrics; scope: DashboardScope; clock: number; controller: AgentsController; readOnly: boolean;
  onLaunch: (agent: AgentDefinition, defaults?: Record<string, string>) => void; onOpenRun: (run: AgentRun) => void; onAsk: (text: string) => void;
  onCollect: () => void; onForm: (kind: "competitor" | "prompt") => void; navigate: (id: string) => void; flash: (message: string) => void;
}) {
  const [text, setText] = useState(""); const [hidden, setHidden] = useState<string[]>([]); const [busy, setBusy] = useState("");
  const { period, model } = scope;
  const evidence = useMemo(() => buildAgentEvidence(state, { period, model }, clock), [state, period, model, clock]);
  const suggestions = useMemo(() => buildSuggestions(state, evidence, controller.runs, clock).filter(item => !hidden.includes(item.id)), [state, evidence, controller.runs, clock, hidden]);
  const byId = useMemo(() => new Map(controller.agents.map(agent => [agent.id, agent])), [controller.agents]);
  // The same follow-up can come out of two runs; show it once.
  const pending = [...new Map(controller.runs.flatMap(run => run.proposals.filter(proposal => proposal.status === "proposed").map(proposal => [`${proposal.kind}:${proposal.title}`, { run, proposal }] as const))).values()].slice(0, 4);
  const has = metrics.answerCount > 0, citationUnavailable = has && metrics.citationRate === null;
  const brands = [...metrics.brands].sort((a, b) => b.mentionRate - a.mentionRate);
  function act(suggestion: Suggestion) {
    const action = suggestion.action;
    if (action.kind === "collect") onCollect();
    else if (action.kind === "form") onForm(action.form);
    else { const agent = byId.get(action.agentId); if (agent) onLaunch(agent, action.input); }
  }
  async function decide(run: AgentRun, proposalId: string, action: "accept" | "dismiss", done?: string) { setBusy(proposalId); try { await controller.decide(run, proposalId, action); if (done) flash(done); } catch (cause) { flash((cause as Error).message); } finally { setBusy(""); } }
  const send = () => { const message = text.trim(); if (message.length < 2) return; setText(""); onAsk(message); };

  return <div className="d-home">
    <header className="d-home-hero">
      <h1>{state.site.name}의 AI 가시성, 무엇부터 볼까요?</h1>
      <p>질문하거나 에이전트에게 맡기세요. 결과에는 근거가 된 답변과 수치가 함께 남아요.</p>
      <form className="d-composer" onSubmit={event => { event.preventDefault(); send(); }}>
        <SuggestField as="textarea" siteId={state.site.id} field="ask" value={text} onValueChange={setText} maxLength={2000} placeholder="예: 경쟁사보다 덜 언급되는 질문이 뭐야?" aria-label="Lumen에게 질문하기" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
        <div className="d-composer-bar"><small>최근 {scope.period}일 · 완료 답변 {metrics.answerCount}개 기준</small><button type="submit" className="d-composer-send" disabled={text.trim().length < 2} aria-label="질문 보내기"><ArrowUp size={16} strokeWidth={2.4} /></button></div>
      </form>
      <div className="d-chip-row">
        {FEATURED.map(id => byId.get(id)).filter((agent): agent is AgentDefinition => Boolean(agent)).map(agent => <button type="button" key={agent.id} className="d-chip" onClick={() => onLaunch(agent)}><AgentIcon name={agent.icon} size={14} />{agent.name}</button>)}
        <button type="button" className="d-chip" onClick={() => navigate("agents")}>전체 에이전트<ArrowRight size={13} /></button>
      </div>
    </header>

    <section className="d-kpis" aria-label="핵심 지표">
      <div className="d-kpi"><span>브랜드 언급률</span><strong>{has ? `${numberLabel(metrics.mentionRate)}%` : "—"}{has && <Delta now={metrics.mentionRate} before={evidence.previous?.mentionRate} />}</strong><small>언급 {metrics.mentionCount} / 완료 답변 {metrics.answerCount}</small></div>
      <div className="d-kpi"><span>언급 점유율</span><strong>{metrics.totalBrandMentions ? `${numberLabel(metrics.shareOfVoice)}%` : "—"}{metrics.totalBrandMentions > 0 && <Delta now={metrics.shareOfVoice} before={evidence.previous?.shareOfVoice} />}</strong><small>자사 {metrics.mentionCount} / 전체 브랜드 언급 {metrics.totalBrandMentions}</small></div>
      <div className="d-kpi"><span>브랜드 인용률</span><strong className={citationUnavailable ? "d-kpi-text" : undefined}>{citationUnavailable ? "측정 불가" : metrics.citationRate !== null ? `${numberLabel(metrics.citationRate)}%` : "—"}</strong><small>{citationUnavailable ? "인용을 제공하는 답변 없음" : `인용 ${metrics.citationCount} / 측정 가능 ${metrics.citationEligibleAnswerCount}`}</small></div>
      <div className="d-kpi"><span>평균 등장 순서</span><strong>{metrics.averageRank === null ? "—" : `${numberLabel(metrics.averageRank)}번째`}</strong><small>브랜드가 등장한 답변 기준</small></div>
    </section>

    <div className="d-home-grid">
      <div className="d-stack">
        <Panel>
          <div className="d-list-head"><h2>다음에 할 일</h2><Badge tone="blue">{suggestions.length}</Badge></div>
          {suggestions.length ? suggestions.map((suggestion, index) => { const Icon = suggestionIcons[suggestion.icon]; return <div className="d-suggestion" key={suggestion.id}>
            <span className={`d-suggestion-icon tone-${suggestion.tone}`}><Icon size={16} /></span>
            <div className="d-suggestion-body"><h3>{suggestion.title}</h3><p>{suggestion.detail}</p></div>
            <div className="d-suggestion-actions"><Button variant={suggestion.action.kind !== "agent" ? "default" : index === 0 ? "primary" : "soft"} disabled={readOnly && suggestion.action.kind !== "agent"} onClick={() => act(suggestion)}>{suggestion.action.kind === "agent" && <Sparkles size={13} />}{suggestion.action.label}</Button><button type="button" className="d-icon-button" aria-label={`${suggestion.title} 숨기기`} onClick={() => setHidden(previous => [...previous, suggestion.id])}><X size={15} /></button></div>
          </div>; }) : <Empty title="지금 바로 할 일은 없어요" text="새 답변을 수집하면 달라진 점을 다시 확인해 드려요." />}
        </Panel>
        {pending.length > 0 && <Panel>
          <div className="d-list-head"><h2>검토할 제안</h2><Badge tone="amber">{pending.length}</Badge><TextLink onClick={() => navigate("agents")}>실행 기록</TextLink></div>
          {pending.map(({ run, proposal }) => <div className="d-suggestion" key={proposal.id}>
            <span className="d-suggestion-icon"><AgentIcon name={byId.get(run.agentId)?.icon || "pulse"} size={16} /></span>
            <div className="d-suggestion-body"><h3>{proposal.title}</h3><p>{proposal.kind === "task" ? "개선 작업" : "추적할 질문"} · {run.title}</p></div>
            <div className="d-suggestion-actions">{readOnly ? <Button onClick={() => onOpenRun(run)}>자세히</Button> : <><Button busy={busy === proposal.id} onClick={() => decide(run, proposal.id, "accept", proposal.kind === "task" ? "개선 작업에 추가했어요" : "추적할 질문에 추가했어요")}><Check size={13} />추가</Button><button type="button" className="d-icon-button" aria-label={`${proposal.title} 넘기기`} disabled={busy === proposal.id} onClick={() => decide(run, proposal.id, "dismiss")}><X size={15} /></button></>}</div>
          </div>)}
        </Panel>}
        <Panel title="브랜드 언급률 추이" subtitle="완료 답변 중 우리 브랜드를 언급한 답변의 비율" action={<TextLink onClick={() => navigate("visibility")}>가시성 분석</TextLink>}>
          {metrics.series.length ? <TrendChart data={metrics.series.map(point => ({ date: point.date, value: point.mentionRate }))} label="브랜드 언급률" /> : <Empty title="아직 추이를 그릴 답변이 없어요" text="답변을 수집하면 날짜별 언급률이 이곳에 표시돼요." action={<Button onClick={onCollect} disabled={readOnly}><RefreshCw size={13} />답변 수집</Button>} />}
        </Panel>
      </div>
      <div className="d-stack">
        <Panel>
          <div className="d-list-head"><h2>최근 실행</h2><TextLink onClick={() => navigate("agents")}>전체</TextLink></div>
          {controller.runs.length ? controller.runs.slice(0, 5).map(run => <button type="button" key={run.id} className="d-run-row" onClick={() => onOpenRun(run)}><div><strong>{run.title}</strong><small>{byId.get(run.agentId)?.name || run.agentId} · {relativeTime(run.createdAt, clock)}</small></div>{runStatus(run)}</button>)
            : <Empty icon={<Sparkles size={20} strokeWidth={1.5} />} title="아직 실행 기록이 없어요" text="위의 에이전트를 눌러 첫 실행을 시작해 보세요." />}
        </Panel>
        <Panel>
          <div className="d-list-head"><h2>브랜드 순위</h2><TextLink onClick={() => navigate("competitors")}>경쟁사</TextLink></div>
          {has ? <div className="d-rank-list">{brands.slice(0, 6).map((brand, index) => <div className="d-rank-row" key={brand.domain}><span>{index + 1}</span><span className="d-ranking-logo" style={{ color: colors[index % colors.length] }}>{brand.name[0]}</span><span>{brand.name}{brand.isOwn && <em>자사</em>}</span><b>{numberLabel(brand.mentionRate)}%</b></div>)}</div>
            : <Empty title="비교할 답변이 없어요" text="답변을 수집하면 브랜드별 언급률 순위를 보여 드려요." />}
        </Panel>
      </div>
    </div>
  </div>;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownToLine, ArrowRight, CalendarDays, Check, ClipboardList, Compass, FileText, Link2, ListChecks, PenLine, Play, RotateCcw, ShieldCheck, Sparkles, Target, Trash2, Users, X } from "lucide-react";
import type { DashboardScope } from "@/lib/dashboard-scope";
import type { SiteState } from "@/lib/product-types";
import { AGENT_CATEGORY_LABELS, type AgentCategory, type AgentDefinition, type AgentProposal, type AgentRun } from "@/lib/agents/types";
import type { AgentEngine, AgentsController, LiveRun } from "../agents-client";
import { modelLabel, relativeTime } from "../client";
import MarkdownContent from "../markdown";
import { Badge, Button, Empty, Field, Modal, Panel, downloadFile } from "../ui";

const icons = { pulse: Activity, calendar: CalendarDays, shield: ShieldCheck, target: Target, users: Users, compass: Compass, link: Link2, clipboard: ClipboardList, pen: PenLine, list: ListChecks };
export function AgentIcon({ name, size = 18 }: { name: AgentDefinition["icon"]; size?: number }) { const Icon = icons[name] || Sparkles; return <Icon size={size} strokeWidth={1.8} />; }

export function engineLine(engine: AgentEngine | null, demo: boolean) {
  if (demo) return "샘플 워크스페이스에서는 합성 데이터를 집계해 예시 결과를 만들어요. AI 사용량은 차감되지 않아요.";
  if (!engine?.model) return "연결된 AI 모델이 없어 집계 기반 결과를 만들어요. AI 사용량은 차감되지 않아요.";
  return `${modelLabel(engine.model)}가 답변을 읽고 결과를 작성해요. 실행 한 번에 AI 사용량 ${engine.units}회를 사용해요.`;
}
const scopeText = (scope: DashboardScope) => `최근 ${scope.period}일 · ${scope.model === "all" ? "모든 AI 모델" : modelLabel(scope.model)}`;
export function runStatus(run: AgentRun) {
  if (run.status === "running") return <span className="d-status d-status-running">실행 중</span>;
  if (run.status === "failed") return <span className="d-status d-status-failed">실패</span>;
  const open = run.proposals.filter(proposal => proposal.status === "proposed").length;
  return open ? <span className="d-status d-status-review">검토 {open}건</span> : <span className="d-status d-status-done">완료</span>;
}

export default function Agents({ controller, state, scope, onLaunch, onOpenRun }: { controller: AgentsController; state: SiteState; scope: DashboardScope; onLaunch: (agent: AgentDefinition) => void; onOpenRun: (run: AgentRun) => void }) {
  const [category, setCategory] = useState<AgentCategory | "all">("all");
  const categories = useMemo(() => [...new Set(controller.agents.map(agent => agent.category))], [controller.agents]);
  const shown = controller.agents.filter(agent => category === "all" || agent.category === category);
  const byId = useMemo(() => new Map(controller.agents.map(agent => [agent.id, agent])), [controller.agents]);
  return <>
    <p className="d-agent-engine"><Sparkles size={14} />{engineLine(controller.engine, state.site.mode === "demo")} <span className="d-pill">{scopeText(scope)}</span></p>
    {controller.error && <div className="d-error" role="alert"><span>{controller.error}</span><Button onClick={() => controller.reload()}>다시 불러오기</Button></div>}
    <div className="d-agent-filter" role="group" aria-label="에이전트 분류">
      <button type="button" className="d-chip" aria-pressed={category === "all"} onClick={() => setCategory("all")}>전체 {controller.agents.length}</button>
      {categories.map(item => <button type="button" key={item} className="d-chip" aria-pressed={category === item} onClick={() => setCategory(item)}>{AGENT_CATEGORY_LABELS[item]}</button>)}
    </div>
    <div className="d-agent-grid">{shown.map(agent => <button type="button" key={agent.id} className={`d-agent-card tone-${agent.category}`} onClick={() => onLaunch(agent)}>
      <span className="d-agent-icon"><AgentIcon name={agent.icon} /></span>
      <small>{AGENT_CATEGORY_LABELS[agent.category]}</small>
      <h3>{agent.name}</h3>
      <p>{agent.outcome}</p>
      <footer><span>{agent.steps.length}단계</span><span>실행<ArrowRight size={13} /></span></footer>
    </button>)}</div>
    <Panel className="d-section-space" title="실행 기록" subtitle={state.site.mode === "demo" && controller.runs.some(run => !run.persisted) ? "샘플 데이터로 만든 예시 결과예요. 직접 실행하면 이 자리에 기록돼요." : "최근 실행한 에이전트와 검토할 제안을 확인하세요."}>
      {controller.runs.length ? controller.runs.map(run => <button type="button" key={run.id} className="d-run-row" onClick={() => onOpenRun(run)}>
        <span className={`d-agent-icon tone-${byId.get(run.agentId)?.category || "reporting"}`}><AgentIcon name={byId.get(run.agentId)?.icon || "pulse"} size={16} /></span>
        <div><strong>{run.title}</strong><small>{byId.get(run.agentId)?.name || run.agentId} · {scopeText(run.scope)} · {run.model ? modelLabel(run.model) : "집계 기반"}</small></div>
        {runStatus(run)}<small>{relativeTime(run.createdAt)}</small>
      </button>) : <Empty icon={<Sparkles size={22} strokeWidth={1.5} />} title="아직 실행한 에이전트가 없어요" text="위에서 에이전트를 골라 실행하면 결과와 제안이 이곳에 쌓여요." />}
    </Panel>
  </>;
}

/** Template detail: what the agent does, what it needs, and the run button. */
export function AgentLauncher({ agent, state, scope, engine, defaults = {}, busy, onClose, onRun }: { agent: AgentDefinition; state: SiteState; scope: DashboardScope; engine: AgentEngine | null; defaults?: Record<string, string>; busy: boolean; onClose: () => void; onRun: (input: Record<string, string>) => void }) {
  const [input, setInput] = useState<Record<string, string>>(defaults);
  const topics = useMemo(() => [...new Set(state.prompts.filter(prompt => prompt.active).map(prompt => prompt.topic || "일반"))], [state.prompts]);
  const missing = agent.inputs.some(field => field.type === "text" && field.required && !input[field.key]?.trim());
  const set = (key: string, value: string) => setInput(previous => ({ ...previous, [key]: value }));
  return <Modal title={agent.name} subtitle={agent.outcome} onClose={onClose}>
    <form className="d-form" onSubmit={event => { event.preventDefault(); if (!missing && !busy) onRun(input); }}>
      <div className={`d-agent-intro tone-${agent.category}`}><span className="d-agent-icon"><AgentIcon name={agent.icon} /></span><p>{agent.description}</p></div>
      {agent.inputs.map(field => <Field key={field.key} label={field.type === "text" && field.required ? `${field.label} (필수)` : `${field.label} (선택)`} hint={field.hint}>
        {field.type === "text" ? <input value={input[field.key] || ""} maxLength={300} placeholder={field.placeholder} onChange={event => set(field.key, event.target.value)} data-autofocus={field.required ? true : undefined} />
          : <select value={input[field.key] || ""} onChange={event => set(field.key, event.target.value)}>
            <option value="">자동 선택</option>
            {field.type === "prompt" && state.prompts.filter(prompt => prompt.active).map(prompt => <option key={prompt.id} value={prompt.id}>{prompt.text.slice(0, 70)}</option>)}
            {field.type === "topic" && topics.map(topic => <option key={topic} value={topic}>{topic}</option>)}
            {field.type === "competitor" && state.competitors.map(competitor => <option key={competitor.id} value={competitor.name}>{competitor.name}</option>)}
          </select>}
      </Field>)}
      <div className="d-field"><span>진행 단계</span><ol className="d-steps">{agent.steps.map(step => <li key={step.id} className="pending"><span className="d-step-dot" /><div><strong>{step.label}</strong></div></li>)}</ol></div>
      <div className="d-rich-note"><Sparkles size={15} /><span>{scopeText(scope)} 답변을 사용해요. {engineLine(engine, state.site.mode === "demo")}</span></div>
      <div className="d-form-actions"><Button onClick={onClose}>취소</Button><Button type="submit" variant="primary" busy={busy} disabled={missing}><Play size={13} />실행</Button></div>
    </form>
  </Modal>;
}

function Proposal({ proposal, busy, readOnly, onDecide }: { proposal: AgentProposal; busy: boolean; readOnly: boolean; onDecide: (action: "accept" | "dismiss") => void }) {
  const resolved = proposal.status !== "proposed";
  return <div className={`d-proposal ${resolved ? "resolved" : ""}`}>
    <div><Badge tone={proposal.kind === "task" ? (proposal.priority === "high" ? "amber" : "gray") : "blue"}>{proposal.kind === "task" ? (proposal.priority === "high" ? "작업 · 우선" : "작업") : "추적할 질문"}</Badge><h4>{proposal.title}</h4>{proposal.detail && <p>{proposal.detail}</p>}</div>
    {resolved ? <Badge tone={proposal.status === "accepted" ? "green" : "gray"}>{proposal.status === "accepted" ? "추가됨" : "넘김"}</Badge>
      : readOnly ? null : <div className="d-suggestion-actions"><Button variant="primary" busy={busy} onClick={() => onDecide("accept")}><Check size={13} />{proposal.kind === "task" ? "작업 추가" : "질문 추가"}</Button><button type="button" className="d-icon-button" aria-label={`${proposal.title} 넘기기`} disabled={busy} onClick={() => onDecide("dismiss")}><X size={15} /></button></div>}
  </div>;
}

/** One run: the worklog on the left, the result and the proposals on the right. */
export function AgentRunDialog({ run, live, agent, controller, readOnly, flash, onClose, onRerun }: { run: AgentRun; live: LiveRun | null; agent?: AgentDefinition; controller: AgentsController; readOnly: boolean; flash: (message: string) => void; onClose: () => void; onRerun?: () => void }) {
  const current = live?.run.id === run.id ? live.run : run, running = current.status === "running";
  const [tab, setTab] = useState<"result" | "proposals">("result");
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running || !live) return;
    const tick = () => setElapsed(Math.floor((Date.now() - live.startedAt) / 1000));
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [running, live]);
  const open = current.proposals.filter(proposal => proposal.status === "proposed").length;
  async function act(key: string, work: () => Promise<unknown>, done?: string) { setBusy(key); setError(""); try { await work(); if (done) flash(done); } catch (cause) { setError((cause as Error).message); } finally { setBusy(""); } }
  const activeStep = current.steps.find(step => step.status === "active");
  return <Modal title={running ? agent?.name || "에이전트 실행" : current.title} subtitle={running ? agent?.outcome : `${agent?.name || current.agentId} · ${relativeTime(current.createdAt)}`} onClose={onClose} wide>
    <div className="d-run-view">
      <aside className="d-run-side" aria-label="진행 단계">
        <h3>진행 단계</h3>
        <ol className="d-steps">{current.steps.map(step => <li key={step.id} className={step.status}><span className="d-step-dot">{step.status === "done" && <Check size={11} strokeWidth={3} />}{step.status === "failed" && <X size={11} strokeWidth={3} />}</span><div><strong>{step.label}</strong>{step.detail && <small>{step.detail}</small>}</div></li>)}</ol>
        <dl className="d-run-facts">
          <div><dt>범위</dt><dd>{scopeText(current.scope)}</dd></div>
          <div><dt>작성</dt><dd>{running ? "진행 중" : current.model ? modelLabel(current.model) : "집계 기반"}</dd></div>
          {!running && <div><dt>AI 사용량</dt><dd>{current.units ? `${current.units}회` : "차감 없음"}</dd></div>}
        </dl>
      </aside>
      <div className="d-run-main">
        {running ? <div className="d-run-wait" role="status"><span className="d-thinking">{live?.activity || activeStep?.label || "준비 중"}</span><span className="d-num">{elapsed}초 경과 · 창을 닫아도 실행은 계속되고 결과는 실행 기록에 남아요.</span></div>
          : current.status === "failed" ? <Empty title="실행을 완료하지 못했어요" text={current.error || "잠시 후 다시 시도해 주세요."} action={onRerun && <Button variant="primary" onClick={onRerun}><RotateCcw size={13} />다시 실행</Button>} />
          : <>
            <div className="d-run-tabs">
              <button type="button" aria-pressed={tab === "result"} onClick={() => setTab("result")}>결과</button>
              <button type="button" aria-pressed={tab === "proposals"} onClick={() => setTab("proposals")}>제안 {current.proposals.length}{open ? ` · 검토 ${open}` : ""}</button>
              <div className="d-run-tools">
                {!readOnly && current.report && <Button busy={busy === "save"} onClick={() => act("save", () => controller.saveDocument(current), "문서로 저장했어요")}><FileText size={13} />문서로 저장</Button>}
                <button type="button" className="d-icon-button" aria-label="Markdown으로 내려받기" onClick={() => downloadFile(`${current.title.replaceAll("/", "-")}.md`, current.report, "text/markdown;charset=utf-8")}><ArrowDownToLine size={15} /></button>
                {onRerun && <button type="button" className="d-icon-button" aria-label="다시 실행" onClick={onRerun}><RotateCcw size={15} /></button>}
                {!readOnly && current.persisted && <button type="button" className="d-icon-button" aria-label="실행 기록 삭제" disabled={busy === "delete"} onClick={() => act("delete", async () => { await controller.remove(current); onClose(); }, "실행 기록을 삭제했어요")}><Trash2 size={15} /></button>}
              </div>
            </div>
            {error && <div className="d-error" role="alert"><span>{error}</span></div>}
            {tab === "result" ? <><p className="d-run-summary">{current.summary}</p><MarkdownContent className="d-answer">{current.report}</MarkdownContent></>
              : current.proposals.length ? <div>{current.proposals.map(proposal => <Proposal key={proposal.id} proposal={proposal} readOnly={readOnly} busy={busy === proposal.id} onDecide={action => act(proposal.id, () => controller.decide(current, proposal.id, action), action === "accept" ? (proposal.kind === "task" ? "개선 작업에 추가했어요" : "추적할 질문에 추가했어요") : undefined)} />)}{readOnly && <p className="d-caption">로그인하면 제안을 작업이나 질문으로 바로 추가할 수 있어요.</p>}</div>
              : <Empty title="제안이 없어요" text="이번 결과에서는 바로 추가할 작업이나 질문을 찾지 못했어요." />}
          </>}
      </div>
    </div>
  </Modal>;
}

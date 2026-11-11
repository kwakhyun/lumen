"use client";

import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, Filter, ListPlus, Pencil, Pin, Play, Plus, RotateCcw, Search, Trash2, WandSparkles } from "lucide-react";
import type { Answer, Prompt, SiteState } from "@/lib/product-types";
import { summarizePromptEvidence, type PromptEvidence } from "@/lib/prompt-opportunities";
import { intentNames } from "../prompt-evidence";
import { Badge, Button, Empty, Panel, dateLabel, numberLabel } from "../ui";
import RunHistory from "./run-history";

type EvidenceFilter = "all" | "competitor_only" | "unmentioned" | "uncollected";
type PromptSort = "pinned" | "newest" | "mention_rate" | "answers";

const evidenceFilters: { id: EvidenceFilter; label: string; description: string }[] = [
  { id: "all", label: "전체", description: "선택한 기간과 모델의 답변을 기준으로 표시합니다." },
  { id: "competitor_only", label: "경쟁사만 언급", description: "우리 브랜드 없이 등록한 경쟁사가 등장한 완료 답변이 있는 질문입니다." },
  { id: "unmentioned", label: "자사 미언급", description: "완료 답변이 있지만 우리 브랜드가 한 번도 언급되지 않은 질문입니다." },
  { id: "uncollected", label: "완료 답변 없음", description: "선택한 기간과 모델에 완료 답변이 없는 질문입니다. 미수집, 실패와 진행 중인 질문을 포함합니다." },
];
const sortLabels: Record<PromptSort, string> = { pinned: "고정한 질문 우선", newest: "최근 등록순", mention_rate: "언급률 낮은순", answers: "완료 답변 많은순" };

function matchesEvidence(row: PromptEvidence, filter: EvidenceFilter) {
  if (filter === "competitor_only") return row.competitorOnlyCount > 0;
  if (filter === "unmentioned") return row.completedCount > 0 && row.mentionCount === 0;
  if (filter === "uncollected") return row.completedCount === 0;
  return true;
}

type Props = {
  state: SiteState;
  answers: Answer[];
  busy: boolean;
  onDetail: (p: Prompt, orderedPrompts?: Prompt[]) => void;
  onAdd: () => void;
  onEdit: (p: Prompt) => void;
  onDelete: (p: Prompt) => void;
  onToggle: (p: Prompt, values: Record<string, boolean>) => void;
  onGenerate: (count: number) => void;
  onRun: () => void;
  onCreateTask: (p: Prompt) => void;
};

export default function Prompts({ state, answers, busy, onDetail, onAdd, onEdit, onDelete, onToggle, onGenerate, onRun, onCreateTask }: Props) {
  const [query, setQuery] = useState("");
  const [intent, setIntent] = useState("all");
  const [onlyPinned, setOnlyPinned] = useState(false);
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>("all");
  const [sort, setSort] = useState<PromptSort>("pinned");
  const [page, setPage] = useState(0);
  const [suggestionCount, setSuggestionCount] = useState(1);
  const evidence = useMemo(() => summarizePromptEvidence(state.site, state.prompts, state.competitors, answers), [state.site, state.prompts, state.competitors, answers]);
  const counts = useMemo(() => Object.fromEntries(evidenceFilters.map(filter => [filter.id, evidence.filter(row => matchesEvidence(row, filter.id)).length])) as Record<EvidenceFilter, number>, [evidence]);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    const rows = evidence.filter(row => (!search || `${row.prompt.text} ${row.prompt.topic}`.toLowerCase().includes(search)) && (intent === "all" || row.prompt.intent === intent) && (!onlyPinned || row.prompt.pinned) && matchesEvidence(row, evidenceFilter));
    return rows.sort((a, b) => {
      if (sort === "pinned" && a.prompt.pinned !== b.prompt.pinned) return Number(b.prompt.pinned) - Number(a.prompt.pinned);
      if (sort === "mention_rate") {
        const delta = (a.mentionRate ?? Infinity) - (b.mentionRate ?? Infinity);
        if (delta && !Number.isNaN(delta)) return delta;
      }
      if (sort === "answers" && a.completedCount !== b.completedCount) return b.completedCount - a.completedCount;
      return b.prompt.createdAt.localeCompare(a.prompt.createdAt) || a.prompt.text.localeCompare(b.prompt.text, "ko");
    });
  }, [evidence, query, intent, onlyPinned, evidenceFilter, sort]);
  const visiblePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 10) - 1));
  const visibleRows = filtered.slice(visiblePage * 10, visiblePage * 10 + 10);
  const orderedPrompts = filtered.map(row => row.prompt);
  const hasFilters = Boolean(query || intent !== "all" || onlyPinned || evidenceFilter !== "all" || sort !== "pinned");
  const extraFilterCount = Number(intent !== "all") + Number(onlyPinned) + Number(sort !== "pinned");
  const activePromptCount = state.prompts.filter(prompt => prompt.active).length;
  const filterDescription = evidenceFilters.find(filter => filter.id === evidenceFilter)!.description;
  const suggestionHint = state.site.mode === "demo" ? "샘플 질문 제안은 AI 사용량을 차감하지 않습니다." : "직접 추가한 질문은 사용량을 차감하지 않습니다. AI 질문 제안은 제안 수와 관계없이 무료 사용량 1회를 차감합니다.";
  const reset = () => { setQuery(""); setIntent("all"); setOnlyPinned(false); setEvidenceFilter("all"); setSort("pinned"); setPage(0); };
  const suggestions = <details className="d-prompt-ai-suggestions"><summary><WandSparkles size={15} />AI로 질문 제안받기</summary><div><p id="prompt-suggestion-hint">{suggestionHint}</p><div className="d-prompt-suggestion-controls"><label className="d-select-wrap"><span>제안 수</span><select aria-label="제안할 질문 수" value={suggestionCount} onChange={event => setSuggestionCount(Number(event.target.value))} disabled={busy}>{[1, 3, 5].map(count => <option key={count} value={count}>{count}개</option>)}</select></label><Button onClick={() => onGenerate(suggestionCount)} busy={busy} aria-describedby="prompt-suggestion-hint"><WandSparkles size={14} />질문 {suggestionCount}개 제안</Button></div></div></details>;

  if (!state.prompts.length) return <>
    <Panel className="d-prompts-panel"><Empty title="첫 질문을 추가하세요" text="고객이 AI에게 물어볼 질문을 적어 보세요. 예를 들어 ‘우리 팀에 맞는 업무 관리 도구를 추천해 줘’처럼 작성할 수 있습니다." action={<Button variant="primary" onClick={onAdd} disabled={busy}><Plus size={16} />첫 질문 추가</Button>} />{suggestions}</Panel>
    {state.runs.length > 0 && <RunHistory runs={state.runs} />}
  </>;

  return <>
    <Panel className="d-prompts-panel">
      <div className="d-prompts-command-row">
        <div className="d-search-box"><Search size={14} /><input className="d-search-input" placeholder="질문 또는 주제 검색" aria-label="질문 검색" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></div>
        <Button variant="primary" onClick={onRun} busy={busy} disabled={!activePromptCount} aria-describedby={!activePromptCount ? "prompt-no-active" : undefined}><Play size={14} />답변 수집 설정</Button>
      </div>
      {!activePromptCount && <p id="prompt-no-active" className="d-prompt-no-active">질문 관리에서 ‘추적’을 켜면 수집할 질문을 선택할 수 있습니다.</p>}
      <div className="d-prompt-status-filters" role="group" aria-label="답변 상태 필터">
        {evidenceFilters.map(filter => <button key={filter.id} type="button" className={`d-prompt-status-filter ${evidenceFilter === filter.id ? "is-active" : ""}`} aria-pressed={evidenceFilter === filter.id} title={filter.description} onClick={() => { setEvidenceFilter(filter.id); setPage(0); }}><span>{filter.label}</span><strong>{counts[filter.id]}</strong></button>)}
      </div>
      <div className="d-prompts-secondary-row">
        <details className="d-prompts-filter-details"><summary><Filter size={14} />추가 필터{extraFilterCount > 0 && <span>{extraFilterCount}개 적용</span>}</summary><div className="d-prompts-extra-filters">
          <label className="d-select-wrap"><span>질문 의도</span><select aria-label="질문 의도" value={intent} onChange={event => { setIntent(event.target.value); setPage(0); }}><option value="all">전체</option>{Object.entries(intentNames).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <label className="d-select-wrap"><ArrowDownWideNarrow size={14} /><select aria-label="질문 정렬" value={sort} onChange={event => { setSort(event.target.value as PromptSort); setPage(0); }}>{Object.entries(sortLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <Button variant={onlyPinned ? "primary" : "default"} onClick={() => { setOnlyPinned(value => !value); setPage(0); }} aria-pressed={onlyPinned}><Pin size={14} />고정만 보기</Button>
        </div></details>
        {hasFilters && <Button variant="quiet" onClick={reset}><RotateCcw size={14} />초기화</Button>}
      </div>
      <div className="d-prompts-results"><p aria-live="polite"><strong>{filtered.length}개 질문</strong><span>{sortLabels[sort]}</span></p><details><summary>집계 기준</summary><p>{filterDescription} 상태별 질문은 겹칠 수 있으며 실패와 진행 중인 답변은 언급률에서 제외합니다.</p></details></div>
      {filtered.length ? <>
        <div className="d-table-wrap d-prompts-desktop"><table className="d-table d-prompts-table"><thead><tr><th scope="col" className="d-prompts-tracking">추적</th><th scope="col">질문</th><th scope="col">자사 언급률</th><th scope="col">답변에서 확인할 내용</th><th scope="col"><span className="d-prompts-actions-label">질문 관리</span></th></tr></thead><tbody>{visibleRows.map(row => {
          const { prompt } = row;
          return <tr key={prompt.id}>
            <td><label className="d-prompt-toggle"><input type="checkbox" className="d-prompt-check" aria-label={`${prompt.text} 추적 활성화`} checked={prompt.active} onChange={event => onToggle(prompt, { active: event.target.checked })} disabled={busy} /></label></td>
            <td className="d-td-title"><button className="d-table-title" onClick={() => onDetail(prompt, orderedPrompts)}>{prompt.text}</button><PromptMetadata prompt={prompt} /></td>
            <td><MentionRate row={row} /></td>
            <td className="d-prompt-evidence-cell"><EvidenceStatus row={row} /><div className="d-table-sub">{row.latestAt ? `${dateLabel(row.latestAt)} 최근 완료` : "언급 여부를 아직 비교할 수 없어요"}</div></td>
            <td><div className="d-prompt-row-actions"><Button variant="quiet" className="d-prompt-create-task" onClick={() => onCreateTask(prompt)} disabled={busy} aria-label={`${prompt.text} 개선 작업 만들기`}><ListPlus size={15} />작업 만들기</Button><div className="d-table-actions"><button className={`d-icon-button ${prompt.pinned ? "active" : ""}`} type="button" disabled={busy} aria-label={`${prompt.text} ${prompt.pinned ? "고정 해제" : "고정"}`} aria-pressed={prompt.pinned} onClick={() => onToggle(prompt, { pinned: !prompt.pinned })}><Pin size={14} /></button><button className="d-icon-button" type="button" disabled={busy} onClick={() => onEdit(prompt)} aria-label={`${prompt.text} 편집`}><Pencil size={14} /></button><button className="d-icon-button" type="button" disabled={busy} onClick={() => onDelete(prompt)} aria-label={`${prompt.text} 삭제`}><Trash2 size={14} /></button></div></div></td>
          </tr>;
        })}</tbody></table></div>
        <ul className="d-prompt-cards" aria-label="질문 목록">{visibleRows.map(row => <li key={row.prompt.id}><article className="d-prompt-card">
          <div className="d-prompt-card-top"><Badge tone={row.prompt.intent === "comparison" ? "purple" : "gray"}>{intentNames[row.prompt.intent]}</Badge><span>{row.prompt.topic || "일반"}{row.prompt.pinned ? " / 고정" : ""}{!row.prompt.active ? " / 추적 꺼짐" : ""}</span></div>
          <h3>{row.prompt.text}</h3>
          <div className="d-prompt-card-evidence"><div><span className="d-prompt-card-label">자사 언급률</span><MentionRate row={row} /></div><div><EvidenceStatus row={row} />{row.latestAt && <div className="d-table-sub">{dateLabel(row.latestAt)} 최근 완료</div>}</div></div>
          <div className="d-prompt-card-actions"><Button onClick={() => onDetail(row.prompt, orderedPrompts)} aria-label={`${row.prompt.text} 답변 보기`}>답변 보기</Button><Button onClick={() => onCreateTask(row.prompt)} disabled={busy} aria-label={`${row.prompt.text} 개선 작업 만들기`}><ListPlus size={15} />작업 만들기</Button></div>
          <details className="d-prompt-card-manage"><summary aria-label={`${row.prompt.text} 질문 관리`}>질문 관리</summary><div><label className="d-prompt-card-track"><input type="checkbox" className="d-prompt-check" aria-label={`${row.prompt.text} 추적 활성화`} checked={row.prompt.active} onChange={event => onToggle(row.prompt, { active: event.target.checked })} disabled={busy} />추적 {row.prompt.active ? "켜짐" : "꺼짐"}</label><Button variant="quiet" onClick={() => onToggle(row.prompt, { pinned: !row.prompt.pinned })} disabled={busy} aria-pressed={row.prompt.pinned}><Pin size={14} />{row.prompt.pinned ? "고정 해제" : "고정"}</Button><Button variant="quiet" onClick={() => onEdit(row.prompt)} disabled={busy}><Pencil size={14} />편집</Button><Button variant="quiet" onClick={() => onDelete(row.prompt)} disabled={busy}><Trash2 size={14} />삭제</Button></div></details>
        </article></li>)}</ul>
        <div className="d-table-footer d-prompts-pagination"><span>전체 {state.prompts.length}개 중 {filtered.length}개 일치 / {visiblePage * 10 + 1}–{Math.min(visiblePage * 10 + 10, filtered.length)} 표시</span><div className="d-row-inline"><Button disabled={!visiblePage} onClick={() => setPage(visiblePage - 1)}>이전</Button><span aria-label={`전체 ${Math.ceil(filtered.length / 10)}페이지 중 ${visiblePage + 1}페이지`}>{visiblePage + 1} / {Math.ceil(filtered.length / 10)}</span><Button disabled={(visiblePage + 1) * 10 >= filtered.length} onClick={() => setPage(visiblePage + 1)}>다음</Button></div></div>
      </> : <Empty title="조건에 맞는 질문이 없어요" text={evidenceFilter === "competitor_only" && !counts.competitor_only ? "선택한 기간과 모델에서는 경쟁사만 언급된 완료 답변을 찾지 못했어요. 기간이나 모델을 바꾸거나 전체 질문을 확인하세요." : "검색어와 답변 상태, 질문 의도 조건을 바꾸거나 전체 질문을 확인하세요."} action={<Button onClick={reset}><RotateCcw size={14} />조건 초기화</Button>} />}
      {suggestions}
    </Panel>
    {state.runs.length > 0 && <RunHistory runs={state.runs} />}
  </>;
}

function PromptMetadata({ prompt }: { prompt: Prompt }) {
  return <div className="d-prompt-metadata"><Badge tone={prompt.intent === "comparison" ? "purple" : "gray"}>{intentNames[prompt.intent]}</Badge><span>{prompt.topic || "일반"}</span><span>{dateLabel(prompt.createdAt)} 등록</span></div>;
}

function MentionRate({ row }: { row: PromptEvidence }) {
  return <><strong className="d-prompt-mention-rate">{row.mentionRate === null ? "—" : `${numberLabel(row.mentionRate)}%`}</strong><div className="d-table-sub">{row.completedCount ? `언급 ${row.mentionCount} / 완료 ${row.completedCount}건` : "완료 답변 없음"}</div></>;
}

function EvidenceStatus({ row }: { row: PromptEvidence }) {
  if (!row.completedCount) return <><Badge tone={row.failedCount ? "amber" : "gray"}>{row.failedCount ? `수집 실패 ${row.failedCount}건` : row.pendingCount ? "수집 진행 중" : "미수집"}</Badge>{row.pendingCount > 0 && <div className="d-table-sub">진행 중 {row.pendingCount}건</div>}</>;
  if (row.competitorOnlyCount) return <><Badge tone="amber">경쟁사만 언급 {row.competitorOnlyCount}건</Badge><div className="d-table-sub d-prompt-competitor-names">{row.competitorNames.join(", ")}</div></>;
  if (row.unmentionedCount) return <Badge tone="gray">자사 미언급 {row.unmentionedCount}건</Badge>;
  return <Badge tone="green">완료 답변 모두 자사 언급</Badge>;
}

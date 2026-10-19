"use client";

import { useMemo, useState } from "react";
import { Filter, Pencil, Pin, Play, Plus, Search, Trash2, WandSparkles } from "lucide-react";
import type { Answer, Prompt, SiteState } from "@/lib/product-types";
import { completedAnswersByPrompt, intentNames, ownMention } from "../prompt-evidence";
import { Badge, Button, Empty, Panel, dateLabel, numberLabel } from "../ui";
import RunHistory from "./run-history";

export default function Prompts({ state, answers, busy, onDetail, onAdd, onEdit, onDelete, onToggle, onGenerate, onRun }: { state: SiteState; answers: Answer[]; busy: boolean; onDetail: (p: Prompt) => void; onAdd: () => void; onEdit: (p: Prompt) => void; onDelete: (p: Prompt) => void; onToggle: (p: Prompt, values: Record<string, boolean>) => void; onGenerate: (count: number) => void; onRun: () => void }) {
  const [query, setQuery] = useState(""); const [intent, setIntent] = useState("all"); const [onlyPinned, setOnlyPinned] = useState(false); const [page, setPage] = useState(0); const [suggestionCount, setSuggestionCount] = useState(1);
  const evidenceByPrompt = useMemo(() => completedAnswersByPrompt(answers), [answers]);
  const prompts = useMemo(() => state.prompts.filter(prompt => (!query || `${prompt.text} ${prompt.topic}`.toLowerCase().includes(query.toLowerCase())) && (intent === "all" || prompt.intent === intent) && (!onlyPinned || prompt.pinned)).sort((a, b) => Number(b.pinned) - Number(a.pinned)), [state.prompts, query, intent, onlyPinned]);
  const visiblePage = Math.min(page, Math.max(0, Math.ceil(prompts.length / 10) - 1));
  const suggestionHint = state.site.mode === "demo" ? "샘플 질문 제안은 AI 사용량을 차감하지 않습니다." : "직접 추가한 질문은 사용량을 차감하지 않습니다. AI 질문 제안은 제안 수와 관계없이 무료 사용량 1회를 차감합니다.";

  if (!state.prompts.length) return <>
    <Panel><Empty title="첫 질문을 추가하세요" text="고객이 AI에게 물어볼 질문을 적어 보세요. 예를 들어 ‘우리 팀에 맞는 업무 관리 도구를 추천해 줘’처럼 작성할 수 있습니다." action={<div className="d-row-inline" style={{ flexWrap: "wrap", justifyContent: "center" }}><Button variant="primary" onClick={onAdd} disabled={busy}><Plus size={16} />첫 질문 추가</Button><Button onClick={() => onGenerate(1)} busy={busy} aria-describedby="prompt-suggestion-hint"><WandSparkles size={16} />AI로 질문 1개 제안</Button></div>} /><p id="prompt-suggestion-hint" className="d-muted" style={{ padding: "0 24px 24px", margin: 0 }}>{suggestionHint}</p></Panel>
    {state.runs.length > 0 && <RunHistory runs={state.runs} />}
  </>;

  return <>
    <Panel>
      <div className="d-toolbar">
        <div className="d-search-box"><Search size={13} /><input className="d-search-input" placeholder="질문 또는 주제 검색" aria-label="질문 검색" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></div>
        <label className="d-select-wrap"><Filter size={12} /><select aria-label="질문 의도" value={intent} onChange={event => { setIntent(event.target.value); setPage(0); }}><option value="all">모든 질문 의도</option>{Object.entries(intentNames).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <Button variant={onlyPinned ? "primary" : "default"} onClick={() => { setOnlyPinned(value => !value); setPage(0); }} aria-pressed={onlyPinned}><Pin size={12} />고정한 질문</Button>
        <label className="d-select-wrap"><span className="d-caption">제안 수</span><select aria-label="제안할 질문 수" value={suggestionCount} onChange={event => setSuggestionCount(Number(event.target.value))} disabled={busy}>{[1, 3, 5].map(count => <option key={count} value={count}>{count}개</option>)}</select></label>
        <Button onClick={() => onGenerate(suggestionCount)} busy={busy} aria-describedby="prompt-suggestion-hint"><WandSparkles size={13} />AI 질문 제안</Button>
        <Button variant="primary" onClick={onRun} busy={busy} disabled={!state.prompts.some(prompt => prompt.active)}><Play size={12} />답변 수집</Button>
      </div>
      <p id="prompt-suggestion-hint" className="d-muted" style={{ padding: "0 24px 16px", margin: 0 }}>{suggestionHint}</p>
      {!state.prompts.some(prompt => prompt.active) && <p className="d-muted" style={{ padding: "0 24px 16px", margin: 0 }}>수집할 질문의 ‘추적’을 켜면 답변을 수집할 수 있습니다.</p>}
      {prompts.length ? <>
        <div className="d-table-wrap"><table className="d-table"><thead><tr><th style={{ width: 40 }}>추적</th><th>질문</th><th>주제 / 의도</th><th>언급률</th><th>완료 답변</th><th /></tr></thead><tbody>{prompts.slice(visiblePage * 10, visiblePage * 10 + 10).map(prompt => {
          const rows = evidenceByPrompt.get(prompt.id) || [];
          return <tr key={prompt.id}>
            <td><label className="d-prompt-toggle"><input type="checkbox" className="d-prompt-check" aria-label={`${prompt.text} 추적 활성화`} checked={prompt.active} onChange={event => onToggle(prompt, { active: event.target.checked })} disabled={busy} /></label></td>
            <td className="d-td-title"><button className="d-table-title" onClick={() => onDetail(prompt)}>{prompt.text}</button><div className="d-table-sub">{dateLabel(prompt.createdAt)} 추가</div></td>
            <td><div style={{ marginBottom: 5, fontSize: 13 }}>{prompt.topic || "일반"}</div><Badge tone={prompt.intent === "comparison" ? "purple" : "gray"}>{intentNames[prompt.intent]}</Badge></td>
            <td>{rows.length ? `${numberLabel(rows.filter(answer => ownMention(answer, state.site)?.mentioned).length / rows.length * 100)}%` : "—"}</td><td>{rows.length}</td>
            <td><div className="d-table-actions"><button className={`d-icon-button ${prompt.pinned ? "active" : ""}`} type="button" disabled={busy} aria-label={prompt.pinned ? "질문 고정 해제" : "질문 고정"} onClick={() => onToggle(prompt, { pinned: !prompt.pinned })}><Pin size={13} /></button><button className="d-icon-button" type="button" disabled={busy} onClick={() => onEdit(prompt)} aria-label="질문 편집"><Pencil size={13} /></button><button className="d-icon-button" type="button" disabled={busy} onClick={() => onDelete(prompt)} aria-label="질문 삭제"><Trash2 size={13} /></button></div></td>
          </tr>;
        })}</tbody></table></div>
        <div className="d-table-footer"><span>{prompts.length}개 질문 중 {visiblePage * 10 + 1}–{Math.min(visiblePage * 10 + 10, prompts.length)}</span><div className="d-row-inline"><Button disabled={!visiblePage} onClick={() => setPage(visiblePage - 1)}>이전</Button><Button disabled={(visiblePage + 1) * 10 >= prompts.length} onClick={() => setPage(visiblePage + 1)}>다음</Button></div></div>
      </> : <Empty title="검색 결과가 없어요" text="검색어나 필터를 바꾸거나 전체 질문을 확인하세요." action={<Button onClick={() => { setQuery(""); setIntent("all"); setOnlyPinned(false); setPage(0); }}>전체 질문 보기</Button>} />}
    </Panel>
    {state.runs.length > 0 && <RunHistory runs={state.runs} />}
  </>;
}

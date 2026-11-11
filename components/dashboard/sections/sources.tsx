"use client";

import { useId, useState } from "react";
import { ArrowRight, ExternalLink, FileSearch, Globe2, Info, Search, X } from "lucide-react";
import type { Answer, Metrics, Prompt } from "@/lib/product-types";
import { modelLabel } from "../client";
import { sourceEvidence, type SourceEvidenceRow } from "../source-evidence";
import { Badge, Button, Empty, Panel, dateLabel, numberLabel } from "../ui";

type SourcesProps = {
  metrics: Metrics;
  citationUnavailable: boolean;
  answers: Answer[];
  prompts: Prompt[];
  onPrompt: (prompt: Prompt) => void;
  onObserve: () => void;
};

export default function Sources({ metrics, citationUnavailable, answers, prompts, onPrompt, onObserve }: SourcesProps) {
  const [query, setQuery] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const detailId = useId();
  const sources = metrics.sources.filter(source => `${source.domain} ${source.title} ${source.url}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = sources.find(source => source.domain === selectedDomain);
  const evidence = selected ? sourceEvidence(answers, selected.domain, metrics.dataMode) : [];
  const denominator = metrics.citationEligibleAnswerCount;

  return <div className="d-stack d-sources">
    <Panel title="답변에 인용된 웹사이트" subtitle="출처를 선택하면 이 도메인을 인용한 질문과 원래 표시된 링크를 확인할 수 있어요.">
      <div className="d-toolbar">
        <div className="d-search-box"><Search size={15} /><input className="d-search-input" value={query} onChange={event => { setQuery(event.target.value); setSelectedDomain(null); }} placeholder="도메인, 제목 또는 URL 검색" aria-label="인용 출처 검색" />{query && <button type="button" className="d-icon-button" aria-label="출처 검색 초기화" onClick={() => setQuery("")}><X size={15} /></button>}</div>
        <Badge>{sources.length}개 도메인</Badge>
        {metrics.dataMode === "demo" && <Badge tone="amber">샘플 인용</Badge>}
      </div>
      <div className="d-source-method"><Info size={16} /><p>인용률 = 해당 도메인을 인용한 답변 ÷ 인용 측정이 가능한 완료 답변 <strong>{denominator}개</strong>. 한 답변에서 같은 도메인은 한 번만 세며, 여러 도메인을 인용할 수 있어 합계는 100%를 넘을 수 있어요.{metrics.citationExcludedAnswerCount > 0 && ` 인용을 제공하지 않는 답변 ${metrics.citationExcludedAnswerCount}개는 제외했어요.`}</p></div>
      {sources.length ? <div className="d-table-wrap"><table className="d-table d-source-table"><thead><tr><th>출처 도메인</th><th>인용한 답변</th><th>인용률</th><th><span className="d-screen-reader">인용 근거</span></th></tr></thead><tbody>{sources.map(source => {
        const rate = denominator ? source.citations / denominator * 100 : null;
        const expanded = selected?.domain === source.domain;
        const choose = () => setSelectedDomain(expanded ? null : source.domain);
        return <tr key={source.domain} className={expanded ? "d-source-selected" : undefined}>
          <td><button type="button" className="d-table-title d-source-name" onClick={choose} aria-expanded={expanded} aria-controls={detailId}><Globe2 size={17} /><span>{source.domain}</span></button></td>
          <td><strong>{source.citations}개</strong><div className="d-table-sub">{source.citations} / {denominator}개 답변</div></td>
          <td><div className="d-source-rate"><strong>{rate === null ? "측정 불가" : `${numberLabel(rate)}%`}</strong>{rate !== null && <div className="d-progress-track" aria-hidden="true"><div className="d-progress-fill" style={{ width: `${Math.min(100, rate)}%` }} /></div>}</div></td>
          <td><Button variant={expanded ? "primary" : "quiet"} onClick={choose} aria-expanded={expanded} aria-controls={detailId} aria-label={`${source.domain} 인용 근거 ${expanded ? "닫기" : "보기"}`}>{expanded ? "닫기" : "근거 보기"}<ArrowRight size={15} /></Button></td>
        </tr>;
      })}</tbody></table></div> : <Empty icon={<FileSearch size={26} />} title={query ? "일치하는 출처가 없어요" : citationUnavailable ? "현재 답변은 검색 인용을 제공하지 않아요" : "아직 인용된 출처가 없어요"} text={query ? "검색어를 바꾸거나 초기화해서 현재 조건의 모든 출처를 확인하세요." : citationUnavailable ? "Gemini 일반 응답은 웹 검색을 사용하지 않습니다. 실제 AI 검색 화면에서 확인한 답변과 원래 인용을 별도로 기록할 수 있어요." : "본문에 적힌 URL은 검색 인용으로 인정하지 않습니다. 실제 검색 화면에서 확인한 원래 인용은 관측 기록에 남길 수 있어요."} action={query ? <Button onClick={() => setQuery("")}>검색 초기화</Button> : <Button onClick={onObserve}>실제 검색 관측 기록<ArrowRight size={15} /></Button>} />}
    </Panel>
    <div id={detailId}>{selected && <Panel title={`${selected.domain} 인용 근거`} subtitle={`현재 기간과 모델 조건에서 ${evidence.length}개 답변이 이 도메인을 인용했어요.`} action={<Button variant="quiet" onClick={() => setSelectedDomain(null)} aria-label="인용 근거 닫기"><X size={16} /></Button>}><SourceEvidence rows={evidence} prompts={prompts} onPrompt={onPrompt} /></Panel>}</div>
  </div>;
}

export function SourceEvidence({ rows, prompts, onPrompt }: { rows: SourceEvidenceRow[]; prompts: Prompt[]; onPrompt: (prompt: Prompt) => void }) {
  if (!rows.length) return <Empty title="현재 조건에서 확인할 근거가 없어요" text="조회 기간과 모델을 확인한 뒤 출처를 다시 선택하세요." />;
  return <div className="d-source-evidence-list">{rows.map(({ answer, citations }) => {
    const prompt = prompts.find(item => item.id === answer.promptId);
    return <article key={answer.id} className="d-source-evidence">
      <div className="d-source-evidence-meta"><Badge tone="blue">{modelLabel(answer.model)}</Badge><span>{dateLabel(answer.completedAt || answer.createdAt)} 수집</span>{answer.mode === "demo" && <Badge>합성 샘플</Badge>}</div>
      <h3>{answer.promptText}</h3>
      <ul>{citations.map(citation => <li key={citation.url}><a href={citation.url} target="_blank" rel="noopener noreferrer"><span><strong>{citation.title || citation.domain}</strong><small>{citation.url}</small></span><ExternalLink size={16} /></a></li>)}</ul>
      {prompt ? <Button variant="quiet" onClick={() => onPrompt(prompt)} aria-label={`${answer.promptText} 답변 원문 보기`}>질문의 답변 원문 보기<ArrowRight size={15} /></Button> : <p className="d-caption">현재 질문 목록에는 없지만 수집 당시의 인용 기록은 남아 있어요.</p>}
    </article>;
  })}</div>;
}

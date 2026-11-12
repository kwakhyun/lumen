"use client";

import { useId, useRef, useState } from "react";
import { ArrowRight, Check, Info, Play, Quote } from "lucide-react";
import type { SiteState } from "@/lib/product-types";
import type { RehearsalResult, RehearsalSide, RehearsalVerdict } from "@/lib/rehearsal";
import { modelLabel, requestJson, shortDateTime } from "../client";
import type { RequestAiAction } from "../eligibility";
import MarkdownContent from "../markdown";
import { Badge, Button, Empty, Panel } from "../ui";

const DRAFT_MIN = 80, DRAFT_MAX = 6000;

const verdictCopy = (verdict: RehearsalVerdict, brand: string): { tone: "good" | "same" | "watch"; title: string } => ({
  gained: { tone: "good" as const, title: `초안을 읽은 답변에 ${brand}가 새로 등장했어요` },
  appeared: { tone: "good" as const, title: `초안을 읽은 답변에 ${brand}가 등장했어요` },
  kept: { tone: "same" as const, title: `초안을 읽기 전에도, 읽은 뒤에도 ${brand}가 언급돼요` },
  lost: { tone: "watch" as const, title: `초안을 읽은 답변에서는 ${brand}가 빠졌어요` },
  still_missing: { tone: "watch" as const, title: `초안을 읽고도 ${brand}는 언급되지 않았어요` },
  absent: { tone: "watch" as const, title: `초안을 읽은 답변에 ${brand}가 없어요` },
})[verdict];

const position = (side: RehearsalSide) => side.mentioned ? (side.rank ? `${side.rank}번째로 언급` : "언급됨") : "언급 없음";

/**
 * Content rehearsal. The owner picks a tracked question and pastes a draft; the model answers
 * the question with the draft as reference, and the screen sets that answer next to the one
 * already collected. Nothing is saved.
 */
export default function Rehearsal({ siteId, state, requestAI, onUsed }: { siteId: string; state: SiteState; requestAI: RequestAiAction; onUsed?: () => unknown }) {
  const demo = state.site.mode === "demo";
  const questions = state.prompts.filter(prompt => prompt.active);
  const drafts = state.documents.filter(document => document.kind === "content");
  const [promptId, setPromptId] = useState(questions[0]?.id || "");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RehearsalResult | null>(null);
  const inFlight = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const fieldId = useId();
  const length = draft.trim().length, ready = Boolean(promptId) && length >= DRAFT_MIN && length <= DRAFT_MAX;
  const highlight = { own: [state.site.name], others: state.competitors.map(competitor => competitor.name) };

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      setResult(await requestJson<RehearsalResult>(`/api/sites/${siteId}/rehearsal`, "POST", { promptId, draft: draft.trim() }));
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (cause) { setError((cause as Error).message); }
    finally { inFlight.current = false; setBusy(false); void onUsed?.(); }
  }

  if (!questions.length) return <Panel><Empty title="먼저 추적할 질문을 등록하세요" text="리허설은 등록한 질문 하나를 골라 진행해요. 질문과 답변 화면에서 질문을 추가할 수 있어요." /></Panel>;

  const verdict = result && verdictCopy(result.verdict, state.site.name);
  return <div className="d-rehearsal">
    <Panel title="무대 준비" subtitle="질문 하나와 게시하려는 초안을 올리면, AI가 그 초안을 읽었을 때의 답변을 미리 보여줘요.">
      <form className="d-rehearsal-form" onSubmit={event => { event.preventDefault(); if (ready) requestAI(run); }}>
        <label className="d-field" htmlFor={`${fieldId}-question`}>질문
          <select id={`${fieldId}-question`} value={promptId} onChange={event => { setPromptId(event.target.value); setResult(null); }}>
            {questions.map(prompt => <option key={prompt.id} value={prompt.id}>{prompt.text}</option>)}
          </select>
        </label>
        <label className="d-field" htmlFor={`${fieldId}-draft`}>
          <span className="d-rehearsal-label">게시할 초안
            {drafts.length > 0 && <select aria-label="저장된 콘텐츠에서 불러오기" value="" onChange={event => { const picked = drafts.find(document => document.id === event.target.value); if (picked) { setDraft(picked.content.slice(0, DRAFT_MAX)); setResult(null); } }}>
              <option value="">저장된 콘텐츠에서 불러오기</option>
              {drafts.map(document => <option key={document.id} value={document.id}>{document.title}</option>)}
            </select>}
          </span>
          <textarea id={`${fieldId}-draft`} value={draft} onChange={event => setDraft(event.target.value)} rows={9} maxLength={DRAFT_MAX} placeholder="블로그 글, 제품 소개, FAQ처럼 공개할 글을 붙여 넣으세요. 개인정보와 기밀정보는 넣지 마세요." aria-describedby={`${fieldId}-count`} />
          <small id={`${fieldId}-count`}>{length.toLocaleString("ko-KR")} / {DRAFT_MAX.toLocaleString("ko-KR")}자{length < DRAFT_MIN ? ` · ${DRAFT_MIN}자 이상 입력해 주세요` : ""}</small>
        </label>
        <div className="d-rehearsal-actions">
          <p>{demo ? "샘플 워크스페이스에서는 AI를 호출하지 않고, 수집된 답변에 초안 문장을 더한 예시를 보여줘요." : "AI 사용량 1회를 써요. 결과는 저장하지 않아요."}</p>
          <Button type="submit" variant="primary" busy={busy} disabled={!ready}><Play size={14} />리허설 시작</Button>
        </div>
        {error && <p className="d-error" role="alert"><Info size={15} /><span>{error}</span></p>}
      </form>
    </Panel>

    {result && verdict && <div className="d-rehearsal-result" ref={resultRef} aria-live="polite">
      <div className={`d-rehearsal-verdict tone-${verdict.tone}`}>
        <span className="d-rehearsal-verdict-icon">{verdict.tone === "good" ? <Check size={18} strokeWidth={2.6} /> : <Info size={18} />}</span>
        <div>
          <h2>{verdict.title}</h2>
          <p>{result.before ? <>수집된 답변: {position(result.before)} <ArrowRight size={13} aria-hidden="true" /> 초안을 읽은 답변: {position(result.after)}</> : <>이 질문은 아직 수집한 답변이 없어 비교할 기준이 없어요. 초안을 읽은 답변: {position(result.after)}</>}</p>
        </div>
      </div>

      <div className="d-rehearsal-stage">
        <Panel className="d-rehearsal-side" title="지금의 답변" subtitle={result.before ? `${modelLabel(result.before.model)} · ${shortDateTime(result.before.collectedAt)} 수집` : "수집한 답변 없음"}>
          {result.before
            ? <><div className="d-rehearsal-tags"><Badge tone={result.before.mentioned ? "green" : "amber"}>{position(result.before)}</Badge>{result.before.brands.length > 0 && <span>등장 순서: {result.before.brands.join(" → ")}</span>}</div><MarkdownContent className="d-answer" highlight={highlight}>{result.before.text}</MarkdownContent></>
            : <Empty title="비교할 답변이 없어요" text="이 질문의 답변을 먼저 수집하면 리허설 전후를 나란히 볼 수 있어요." />}
        </Panel>
        <Panel className="d-rehearsal-side d-rehearsal-after" title="초안을 읽은 답변" subtitle={result.model ? `${modelLabel(result.model)} · 초안을 참고 자료로 제공` : "합성 예시 · AI를 호출하지 않았어요"}>
          <div className="d-rehearsal-tags"><Badge tone={result.after.mentioned ? "green" : "amber"}>{position(result.after)}</Badge>{result.after.brands.length > 0 && <span>등장 순서: {result.after.brands.join(" → ")}</span>}</div>
          <MarkdownContent className="d-answer" highlight={highlight}>{result.after.text}</MarkdownContent>
        </Panel>
      </div>

      <Panel title="답변에 반영된 초안 문장" subtitle={`초안 문장 ${result.draftSentences}개 가운데 단어 대부분이 답변에 다시 나온 문장이에요.`}>
        {result.pickedUp.length
          ? <ul className="d-rehearsal-picked">{result.pickedUp.map(item => <li key={item.sentence}><Quote size={15} aria-hidden="true" /><p>{item.sentence}</p><span title="이 문장의 단어 중 답변에 다시 나온 비율">{item.share}%</span></li>)}</ul>
          : <p className="d-rehearsal-none">초안의 문장이 답변에 거의 반영되지 않았어요. 질문에 바로 답하는 문장을 글 앞쪽에 두고, 수치와 고유한 사실을 넣어 다시 리허설해 보세요.</p>}
      </Panel>

      <p className="d-rich-note"><Info size={16} /><span>리허설은 초안을 AI에게 직접 건넸을 때의 답변이에요. 실제 AI 서비스가 이 글을 찾아 읽을지, 같은 답을 할지는 알려 주지 않아요. 게시한 뒤에는 같은 질문의 답변을 다시 수집해 확인하세요.</span></p>
    </div>}
  </div>;
}

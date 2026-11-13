"use client";

import { useId, useRef, useState } from "react";
import { Check, Info, Play, Plus, Quote } from "lucide-react";
import type { SiteState } from "@/lib/product-types";
import { SAMPLE_VOICES, VOICE_LIMITS, voiceLines, type Sentiment, type VoiceResult } from "@/lib/voice";
import { modelLabel, requestJson } from "../client";
import type { RequestAiAction } from "../eligibility";
import { Badge, Button, Empty, Panel } from "../ui";

const SENTIMENT_COPY: Record<Sentiment, { title: string; hint: string }> = {
  satisfied: { title: "만족", hint: "써 본 고객이 좋게 말한 점" },
  complaint: { title: "불만", hint: "써 본 고객이 고쳐 달라는 점" },
  anxiety: { title: "불안", hint: "아직 망설이는 사람이 걱정하는 점" },
};
const ORDER: Sentiment[] = ["satisfied", "complaint", "anxiety"];

/**
 * Voice of customer. Pasted reviews and questions become ranked reasons for satisfaction,
 * complaint and hesitation, the needs behind them, and questions to track in AI answers.
 * Each figure and quote comes straight from the pasted lines.
 */
export default function Voice({ siteId, state, requestAI, readOnly, onAddQuestion, onUsed }: { siteId: string; state: SiteState; requestAI: RequestAiAction; readOnly: boolean; onAddQuestion: (text: string) => Promise<boolean>; onUsed?: () => unknown }) {
  const demo = state.site.mode === "demo";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [adding, setAdding] = useState("");
  const inFlight = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const fieldId = useId();
  const count = voiceLines(text).length, ready = count >= VOICE_LIMITS.minLines && text.trim().length <= VOICE_LIMITS.total;

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      setResult(await requestJson<VoiceResult>(`/api/sites/${siteId}/voice`, "POST", { text: text.trim() }));
      setAdded([]);
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (cause) { setError((cause as Error).message); }
    finally { inFlight.current = false; setBusy(false); void onUsed?.(); }
  }
  async function add(question: string) {
    setAdding(question);
    try { if (await onAddQuestion(question)) setAdded(current => [...current, question]); }
    finally { setAdding(""); }
  }

  return <div className="d-voice">
    <Panel title="고객의 목소리 넣기" subtitle="리뷰, 문의, 커뮤니티 글을 한 줄에 하나씩 붙여 넣으세요. 무엇에 만족하고 어디서 망설이는지 정리하고, AI에 물을 법한 질문으로 바꿔 줘요.">
      <form className="d-voice-form" onSubmit={event => { event.preventDefault(); if (ready) requestAI(run); }}>
        <label className="d-field" htmlFor={`${fieldId}-text`}>
          <span className="d-voice-label">고객이 쓴 글
            <button type="button" className="d-text-link" onClick={() => { setText(SAMPLE_VOICES.join("\n")); setResult(null); }}>예시 넣어 보기</button>
          </span>
          <textarea id={`${fieldId}-text`} value={text} onChange={event => setText(event.target.value)} rows={9} maxLength={VOICE_LIMITS.total} placeholder={"배송이 빨라서 좋았어요\n설정 메뉴가 복잡해서 한참 헤맸어요\n팀원이 늘면 요금이 얼마나 나올지 걱정돼요"} aria-describedby={`${fieldId}-count`} />
          <small id={`${fieldId}-count`}>{count.toLocaleString("ko-KR")}줄 · 최대 {VOICE_LIMITS.lines}줄, {VOICE_LIMITS.total.toLocaleString("ko-KR")}자{count < VOICE_LIMITS.minLines ? ` · ${VOICE_LIMITS.minLines}줄 이상 넣어 주세요` : ""}. 이름, 연락처 같은 개인정보는 지우고 넣어 주세요.</small>
        </label>
        <div className="d-voice-actions">
          <p>{demo ? "샘플 워크스페이스에서는 AI를 호출하지 않고 낱말 기준으로 묶어 보여줘요." : "AI 사용량 2회를 써요. 붙여 넣은 글과 결과는 저장하지 않아요."}</p>
          <Button type="submit" variant="primary" busy={busy} disabled={!ready}><Play size={14} />분석 시작</Button>
        </div>
        {error && <p className="d-error" role="alert"><Info size={15} /><span>{error}</span></p>}
      </form>
    </Panel>

    {result && <div className="d-voice-result" ref={resultRef} aria-live="polite">
      {result.summary && <div className="d-voice-summary"><Quote size={18} aria-hidden="true" /><div><p>{result.summary}</p><small>{result.total}줄 가운데 {result.classified}줄을 분류했어요 · {result.model ? modelLabel(result.model) : "낱말 기준 분류"}</small></div></div>}

      <div className="d-voice-split" role="img" aria-label={`만족 ${result.sentiments.satisfied.share}%, 불만 ${result.sentiments.complaint.share}%, 불안 ${result.sentiments.anxiety.share}%`}>
        {ORDER.filter(tone => result.sentiments[tone].share > 0).map(tone => <span key={tone} className={`tone-${tone}`} style={{ flexGrow: result.sentiments[tone].share }}>{SENTIMENT_COPY[tone].title} {result.sentiments[tone].share}%</span>)}
      </div>

      <div className="d-voice-columns">
        {ORDER.map(tone => <Panel key={tone} className={`d-voice-column tone-${tone}`} title={SENTIMENT_COPY[tone].title} subtitle={`${SENTIMENT_COPY[tone].hint} · ${result.sentiments[tone].count}줄`}>
          {result.sentiments[tone].factors.length
            ? <ol>{result.sentiments[tone].factors.map((factor, index) => <li key={factor.label}>
              <div className="d-voice-bar"><span>{index + 1}</span><i style={{ "--w": `${Math.max(6, Math.round((factor.count / result.sentiments[tone].factors[0].count) * 100))}%` } as React.CSSProperties} /><b>{factor.share}%</b></div>
              <strong>{factor.label}</strong>
              <p>“{factor.quote}”</p>
            </li>)}</ol>
            : <p className="d-voice-none">해당하는 글이 없어요.</p>}
        </Panel>)}
      </div>

      {result.needs.length > 0 && <section aria-labelledby={`${fieldId}-needs`}>
        <h2 className="d-voice-heading" id={`${fieldId}-needs`}>브랜드를 알기 전의 니즈</h2>
        <p className="d-voice-lead">아직 우리 브랜드를 모르는 사람이 같은 상황에서 찾을 만한 것들이에요.</p>
        <div className="d-voice-needs">{result.needs.map(need => <article key={need.label}><header><h3>{need.label}</h3><b>{need.share}%</b></header>{need.examples.map(example => <p key={example}>“{example}”</p>)}</article>)}</div>
      </section>}

      <Panel title="AI 답변에서 측정할 질문" subtitle="고객의 글에서 뽑은, 브랜드 이름 없이 AI에게 물을 법한 질문이에요. 추가하면 다음 수집부터 우리 브랜드가 언급되는지 추적해요.">
        {result.questions.length
          ? <ul className="d-voice-questions">{result.questions.map((question, index) => { const tracked = question.tracked || added.includes(question.text); return <li key={question.text}>
            <span className="d-voice-number">{index + 1}</span>
            <div><strong>{question.text}</strong><p>근거: “{question.quote}”</p></div>
            {tracked ? <Badge tone="green"><Check size={12} strokeWidth={3} /> 추적 중</Badge> : <Button variant="soft" busy={adding === question.text} disabled={readOnly || Boolean(adding)} onClick={() => add(question.text)}><Plus size={14} />질문으로 추가</Button>}
          </li>; })}</ul>
          : <Empty title="질문으로 바꿀 만한 글을 찾지 못했어요" text="걱정이나 불편을 말하는 글이 더 있으면 질문을 만들 수 있어요." />}
        {readOnly && result.questions.length > 0 && <p className="d-voice-none">샘플은 읽기 전용이에요. 로그인하면 질문을 추적 목록에 추가할 수 있어요.</p>}
      </Panel>

      <p className="d-rich-note"><Info size={16} /><span>붙여 넣은 글만 분석한 결과예요. 글을 고른 방식에 따라 비율이 달라지고, 전체 고객의 의견을 대표하지 않아요. 인용문은 붙여 넣은 원문을 그대로 보여줘요.</span></p>
    </div>}
  </div>;
}

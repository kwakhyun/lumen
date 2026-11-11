"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ExternalLink, Loader2, Send, Sparkles } from "lucide-react";
import type { DashboardScope } from "@/lib/dashboard-scope";
import type { AnalysisScopeMetadata } from "@/lib/analysis-context";
import { requestJson as api, modelLabel } from "../client";
import { analysisScopeLabel } from "../analysis-scope";
import type { RequestAiAction } from "../eligibility";
import MarkdownContent from "../markdown";
import { Button, Panel } from "../ui";

type Message = { role: "user" | "assistant"; text: string; scope: DashboardScope; resultScope?: AnalysisScopeMetadata; generationModel?: string; citations?: { url: string; title?: string }[] };

function safeUrl(value: string) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : "#"; } catch { return "#"; }
}

export default function Assistant({ siteId, siteName, demo, scope, requestAI }: { siteId: string; siteName: string; demo: boolean; scope: DashboardScope; requestAI: RequestAiAction }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pendingScope, setPendingScope] = useState<DashboardScope | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { if (messages.length) bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages]);

  function send(text: string) {
    if (!text.trim() || inFlight.current) return;
    const requestedScope = { ...scope };
    requestAI(() => sendNow(text.trim(), requestedScope));
  }

  async function sendNow(text: string, requestedScope: DashboardScope) {
    if (inFlight.current) return;
    inFlight.current = true;
    setInput(""); setError(""); setPendingScope(requestedScope);
    setMessages(current => [...current, { role: "user", text, scope: requestedScope }]);
    try {
      const result = await api<{ message: string; citations?: Message["citations"]; scope: AnalysisScopeMetadata; generationModel?: string }>(`/api/sites/${siteId}/assistant`, "POST", { message: text, scope: requestedScope });
      setMessages(current => [...current, { role: "assistant", text: result.message, citations: result.citations, scope: result.scope, resultScope: result.scope, generationModel: result.generationModel }]);
    } catch (cause) {
      setError((cause as Error).message);
      setInput(current => current || text);
    } finally { inFlight.current = false; setPendingScope(null); }
  }

  return <Panel className="d-assistant">
    {!messages.length ? <div className="d-assistant-start">
      <span className="d-assistant-orb"><Sparkles size={27} strokeWidth={1.4} /></span>
      <h2>{siteName}의 분석 결과가 궁금한가요?</h2>
      <p>선택한 기간과 모델의 수집 답변을 참고해 질문에 답합니다.{demo && " 현재는 샘플 모드입니다."}</p>
      <div className="d-assistant-suggestions">{["지금 가장 먼저 개선할 점은 무엇인가요?", "경쟁사와 비교해 부족한 부분을 알려주세요", "다음에 만들 콘텐츠를 제안해 주세요"].map(text => <button key={text} disabled={Boolean(pendingScope)} onClick={() => send(text)}>{text}<ArrowUpRight size={11} /></button>)}</div>
    </div> : <div className="d-assistant-messages" aria-live="polite">
      {messages.map((message, index) => <div key={index} className={`d-message d-message-${message.role}`}>
        {message.role === "assistant" && <strong>✳ Lumen 어시스턴트</strong>}
        <div className="d-message-scope">{analysisScopeLabel(message.scope)}{message.resultScope && ` / 완료 답변 ${message.resultScope.answerCount}개`}</div>
        {message.generationModel && <div className="d-message-scope">생성 모델: {modelLabel(message.generationModel)}</div>}
        {message.role === "assistant" ? <MarkdownContent>{message.text}</MarkdownContent> : message.text}
        {message.resultScope?.truncated && <p className="d-field-hint">불러온 최신 답변 범위의 분석입니다. 일부 답변은 표본 한도로 제외됐습니다.</p>}
        {message.citations?.length ? <div className="d-citations">{message.citations.map((citation, citationIndex) => <div className="d-citation" key={citationIndex}><span>{citationIndex + 1}</span><a href={safeUrl(citation.url)} target="_blank" rel="noopener noreferrer">{citation.title || citation.url}</a><ExternalLink size={11} /></div>)}</div> : null}
      </div>)}
      {pendingScope && <div className="d-message d-message-assistant" role="status"><Loader2 size={14} className="d-spin" /> {analysisScopeLabel(pendingScope)} 조건으로 분석하고 있어요…</div>}
      <div ref={bottom} />
    </div>}
    {error && <div className="d-error" role="alert" style={{ margin: "0 24px 15px" }}>{error}</div>}
    {messages.length > 0 && <p className="d-assistant-current-scope">다음 질문: {analysisScopeLabel(scope)}. 이전 답변은 작성 당시 조건을 유지합니다.</p>}
    <form className="d-assistant-input" onSubmit={event => { event.preventDefault(); send(input); }}>
      <textarea value={input} onChange={event => setInput(event.target.value)} placeholder="공개된 브랜드 정보로 질문하세요. 개인정보와 기밀정보는 입력하지 마세요." aria-label="어시스턴트 메시지" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(input); } }} />
      <Button type="submit" variant="primary" busy={Boolean(pendingScope)} disabled={!input.trim()} aria-label="메시지 보내기"><Send size={15} /></Button>
    </form>
  </Panel>;
}

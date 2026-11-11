"use client";

import { useState } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Info, Plus } from "lucide-react";
import type { Answer, Prompt, SiteState } from "@/lib/product-types";
import { modelLabel } from "./client";
import { intentNames, ownMention } from "./prompt-evidence";
import MarkdownContent from "./markdown";
import { Badge, Button, Empty, Modal, downloadFile } from "./ui";

type Props = {
  prompt: Prompt;
  state: SiteState;
  scopeLabel: string;
  sequence: Prompt[];
  onNavigate: (prompt: Prompt) => void;
  onCreateTask: () => void;
  onClose: () => void;
  onCollect: () => void;
};

export default function PromptDetail({ prompt, state, scopeLabel, sequence, onNavigate, onCreateTask, onClose, onCollect }: Props) {
  const index = sequence.findIndex(item => item.id === prompt.id);
  const previous = sequence[index - 1];
  const next = sequence[index + 1];
  return <Modal title="질문과 수집한 답변" subtitle={prompt.text} onClose={onClose} wide>
    <div className="d-modal-content d-prompt-detail">
      <p className="d-screen-reader" aria-live="polite">현재 질문: {prompt.text}</p>
      {index >= 0 && sequence.length > 1 && <nav className="d-answer-navigation" aria-label="질문 이동">
        <Button disabled={!previous} onClick={() => previous && onNavigate(previous)}><ArrowLeft size={15} />이전 질문</Button>
        <span aria-live="polite">{index + 1} / {sequence.length}개 질문</span>
        <Button disabled={!next} onClick={() => next && onNavigate(next)}>다음 질문<ArrowRight size={15} /></Button>
      </nav>}
      <div className="d-answer-detail-actions"><span>{scopeLabel} 기준</span><Button variant="primary" onClick={onCreateTask}><Plus size={14} />개선 작업 만들기</Button></div>
      {/* Keep the dialog mounted so closing restores the original list focus. */}
      <AnswerReader key={prompt.id} prompt={prompt} state={state} onCollect={onCollect} />
    </div>
  </Modal>;
}

function AnswerReader({ prompt, state, onCollect }: Pick<Props, "prompt" | "state" | "onCollect">) {
  const answers = state.answers.filter(answer => answer.promptId === prompt.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const first = answers[0];
  const second = answers.find(answer => answer.model !== first?.model) || answers[1];
  const [selected, setSelected] = useState([first?.id || "", second?.id || ""]);
  const [compare, setCompare] = useState(false);
  // A running collection can add answers while this reader remains open.
  const selection = selected.map((id, index) => answers.some(answer => answer.id === id) ? id : (index === 0 ? first?.id : second?.id) || "");
  if (!answers.length) return <Empty title="선택한 조건에 맞는 답변이 없어요" text={prompt.active ? "기간이나 모델을 변경하거나 이 질문의 답변을 수집하세요. 수집 전에 사용할 횟수를 확인할 수 있습니다." : "질문 설정에서 ‘답변 수집에 사용’을 켜 주세요."} action={<Button variant="primary" onClick={onCollect}>{prompt.active ? "답변 수집 설정" : "질문 설정 변경"}<ArrowRight size={15} /></Button>} />;

  return <>
    <div className="d-answer-reader-toolbar">
      <div className="d-answer-meta"><Badge tone={prompt.intent === "comparison" ? "purple" : "gray"}>{intentNames[prompt.intent]}</Badge><span>{answers.length}개 답변</span></div>
      {answers.length > 1 && <div className="d-answer-view-options" role="group" aria-label="답변 보기 방식">
        <button type="button" aria-pressed={!compare} onClick={() => setCompare(false)}>하나씩 읽기</button>
        <button type="button" aria-pressed={compare} onClick={() => setCompare(true)}>두 답변 비교</button>
      </div>}
    </div>
    <div className={`d-evidence-columns ${compare ? "" : "d-evidence-single"}`}>
      {selection.slice(0, compare ? 2 : 1).map((id, index) => {
        const answer = answers.find(item => item.id === id);
        return answer ? <AnswerColumn key={index} answer={answer} answers={answers} state={state} label={compare ? `${index + 1}번째 비교 답변` : "수집한 답변 선택"} onSelect={id => setSelected(selection.map((value, i) => i === index ? id : value))} /> : null;
      })}
    </div>
    <div className="d-rich-note d-answer-limit"><Info size={18} /><span>모델과 수집 시점에 따라 답변이 달라집니다. 언급 여부와 함께 원문과 인용 근거를 확인하세요.</span></div>
  </>;
}

function AnswerColumn({ answer, answers, state, label, onSelect }: { answer: Answer; answers: Answer[]; state: SiteState; label: string; onSelect: (id: string) => void }) {
  const mention = ownMention(answer, state.site);
  return <article className="d-evidence-column">
    <label className="d-answer-select"><span>{label}</span><select aria-label={label} value={answer.id} onChange={event => onSelect(event.target.value)}>{answers.map(item => <option value={item.id} key={item.id}>{modelLabel(item.model)} / {new Date(item.createdAt).toLocaleString("ko-KR")} / {item.status === "completed" ? "완료" : item.status === "failed" ? "실패" : "대기"}</option>)}</select></label>
    <h3>{modelLabel(answer.model)}</h3>
    <div className="d-answer-meta"><Badge tone={answer.mode === "demo" ? "gray" : "blue"}>{answer.mode === "demo" ? "샘플 응답" : "API 수집 원문"}</Badge>{answer.status === "completed" && <Badge tone={mention?.mentioned ? "green" : "gray"}>{mention?.mentioned ? "브랜드 언급" : "브랜드 미언급"}</Badge>}</div>
    {answer.status === "completed" ? <>
      <MarkdownContent className="d-answer">{answer.text}</MarkdownContent>
      <div className="d-citations"><h3>{answer.model === "gemini-3.8-flash" ? "웹 검색 미사용 / 인용 미제공" : `인용 출처 ${answer.citations.length}개`}</h3>
        {answer.citations.length ? answer.citations.map((citation, index) => <div className="d-citation" key={`${citation.url}-${index}`}><span>{index + 1}</span><a href={safeUrl(citation.url)} target="_blank" rel="noopener noreferrer">{citation.title || citation.url}{citation.provenance === "synthetic" && <span className="d-caption"> (샘플)</span>}</a><ArrowUpRight size={16} /></div>) : <p className="d-muted">{answer.model === "gemini-3.8-flash" ? "일반 생성 응답으로 수집하며, 실시간 웹 정보나 검색 인용을 제공하지 않습니다." : "제공자가 표시한 인용 출처가 없습니다."}</p>}
      </div>
      <Button onClick={() => downloadFile(`answer-${answer.id}.txt`, answer.text)}><ArrowDownToLine size={16} />원문 저장</Button>
    </> : <Empty title={answer.status === "failed" ? "답변을 수집하지 못했어요" : "수집을 기다리고 있어요"} text={answer.error || "진행 중인 수집에서 이어서 처리할 수 있어요."} />}
  </article>;
}

function safeUrl(value: string) { try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : "#"; } catch { return "#"; } }

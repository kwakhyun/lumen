"use client";

import { useState } from "react";
import { ArrowRight, Check, MessageCircle, Pencil } from "lucide-react";
import type { Prompt, SiteState } from "@/lib/product-types";
import { Button } from "./ui";

export function needsFirstAnswer(state: SiteState) {
  return state.site.mode === "live" && !state.runs.some(run => run.completed > 0) && !state.answers.some(answer => answer.status === "completed");
}

export function FirstAnswerSteps({ step }: { step: number }) {
  return <ol className="d-start-steps" aria-label="첫 답변 수집 단계">
    {["브랜드 등록", "질문 추가", "첫 답변 수집"].map((label, index) => <li key={label} className={index < step ? "done" : index === step ? "current" : ""} aria-current={index === step ? "step" : undefined}>
      <span aria-hidden="true">{index < step ? <Check size={15} /> : index + 1}</span><strong>{label}</strong><small>{index < step ? "완료" : index === step ? "현재 단계" : "다음 단계"}</small>
    </li>)}
  </ol>;
}

export default function FirstAnswerGuide({ state, primary = false, busy, running, onAdd, onEdit, onRun, onOpen }: { state: SiteState; primary?: boolean; busy: boolean; running: boolean; onAdd: () => void; onEdit: (prompt: Prompt) => void; onRun: (promptId?: string) => void; onOpen: (prompt: Prompt) => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (state.site.mode === "demo") return null;
  const completed = state.answers.find(answer => answer.status === "completed" && state.prompts.some(prompt => prompt.id === answer.promptId));
  const hasHistory = !needsFirstAnswer(state);
  if (hasHistory && (dismissed || !completed || state.runs.filter(run => run.completed > 0).length > 1)) return null;
  const prompt = state.prompts.find(item => item.active) || state.prompts[0];
  const activeRun = state.runs.find(run => ["queued", "running"].includes(run.status));
  const failed = !hasHistory && state.runs.some(run => run.failed > 0) && !activeRun;
  const failedAnswer = state.answers.find(answer => answer.status === "failed" && state.prompts.some(item => item.id === answer.promptId));
  const Heading = primary ? "h1" : "h2";
  const title = hasHistory ? "첫 답변이 준비됐어요" : activeRun ? running ? "첫 답변을 수집하고 있어요" : "진행 중인 수집을 이어서 완료하세요" : !prompt ? "첫 질문을 추가하세요" : !prompt.active ? "수집할 질문을 활성화하세요" : failed ? "첫 답변을 수집하지 못했어요" : "첫 답변을 수집할 준비가 됐어요";
  return <section className={`d-start-guide ${hasHistory ? "d-start-complete" : ""}`} aria-labelledby="first-answer-title">
    <FirstAnswerSteps step={hasHistory ? 3 : prompt ? 2 : 1} />
    <div className="d-start-content"><div><span className="d-eyebrow">{hasHistory ? "수집 완료" : "처음 시작하기"}</span><Heading id="first-answer-title">{title}</Heading>
      <p>{hasHistory ? "답변 원문을 열어 우리 브랜드가 언급됐는지 확인하세요. 한 번의 응답만으로 전체 AI 검색 노출을 판단할 수는 없어요." : activeRun ? "완료한 답변은 저장됩니다. 이 화면에서 진행 상태를 확인하고, 중단된 수집은 위의 버튼으로 이어서 처리하세요." : !prompt ? "고객이 제품을 찾거나 비교할 때 AI에 물을 만한 질문을 하나 적어 보세요. 질문을 직접 추가할 때는 AI 사용량이 차감되지 않아요." : !prompt.active ? "질문을 편집해 ‘답변 수집에 사용’을 켜 주세요. 질문을 저장하는 것만으로 수집이 시작되지는 않아요." : failed ? "질문과 실패 기록은 저장되어 있어요. 아래에서 실패 이유를 확인하고 다시 시도하세요. 새 수집을 시작하면 사용량이 다시 차감됩니다." : "질문 하나를 Gemini에 보내 답변을 받아 보세요. 다음 화면에서 질문과 차감될 사용량을 확인한 뒤 시작합니다."}</p>
    </div><div className="d-start-actions">
      {hasHistory && completed ? <><Button variant="primary" onClick={() => onOpen(state.prompts.find(item => item.id === completed.promptId)!)}>첫 답변 보기<ArrowRight size={17} /></Button><Button variant="quiet" onClick={() => setDismissed(true)}>분석 화면 살펴보기</Button></> : !activeRun ? <Button variant="primary" busy={busy} onClick={!prompt ? onAdd : !prompt.active ? () => onEdit(prompt) : () => onRun(prompt.id)}>{!prompt ? "첫 질문 추가" : !prompt.active ? "질문 설정 변경" : failed ? "수집 설정 확인" : "첫 답변 수집하기"}<ArrowRight size={17} /></Button> : null}
    </div></div>
    {failed && (failedAnswer ? <Button variant="quiet" onClick={() => onOpen(state.prompts.find(item => item.id === failedAnswer.promptId)!)}>실패 이유 확인<ArrowRight size={15} /></Button> : <a className="d-text-link" href={`/dashboard/prompts?site=${encodeURIComponent(state.site.id)}`}>수집 기록 확인<ArrowRight size={15} /></a>)}
    {prompt && !hasHistory && <div className="d-start-question"><MessageCircle size={18} aria-hidden="true" /><div><small>수집할 질문</small><p>{prompt.text}</p></div><Button variant="quiet" onClick={() => onEdit(prompt)} disabled={busy || Boolean(activeRun)}><Pencil size={14} />수정</Button></div>}
    {!hasHistory && <p className="d-start-note">브랜드와 질문 등록 후 직접 수집을 시작해야 답변이 생성됩니다. GA4 연결과 경쟁사 등록은 나중에 해도 돼요. 무료 Gemini API는 웹 검색과 인용 출처를 제공하지 않습니다.</p>}
  </section>;
}

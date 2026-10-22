"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Standard navigation avoids deployed Vinext RSC transition failures. */
import { ArrowRight, Check, Info, RefreshCw, Zap } from "lucide-react";
import type { UsageStatus, UsageWindow } from "@/lib/usage";
import { useResource, localDateTime } from "../client";
import { Button, Panel, Skeleton, Badge } from "../ui";

export default function Usage() {
  const { data, loading, error, refresh } = useResource<UsageStatus>("/api/usage");
  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="d-error" role="alert">{error || "사용량을 불러오지 못했어요."}<Button onClick={refresh}>다시 시도</Button></div>;
  return <div className="d-stack">
    {error && <div className="d-error" role="alert">{error}</div>}
    <div className="d-usage-hero"><div><Badge tone="blue">Lumen Free</Badge><h2>무료 AI<br />사용량과 한도</h2><p>Gemini API를 무료 한도 내에서 이용할 수 있습니다.<br />결제 정보나 유료 구독은 필요하지 않습니다.</p></div><div className="d-usage-available"><span>지금 요청할 수 있는 횟수</span><strong>{data.available}<small>회</small></strong><span>{data.available > 0 ? "개인 한도와 공용 한도 중 남은 횟수가 적은 쪽을 적용합니다." : "한도 초기화 후 다시 이용할 수 있어요."}</span><Button onClick={refresh}><RefreshCw size={16} />새로고침</Button></div></div>
    <div className="d-grid-2"><UsageMeter title="오늘의 내 사용량" window={data.daily} /><UsageMeter title="이번 달 내 사용량" window={data.monthly} /></div>
    <Panel title="전체 이용자 공용 사용량" subtitle="모든 이용자가 함께 사용하는 한도입니다. 개인 한도가 남아 있어도 공용 한도가 먼저 소진될 수 있어요."><div className="d-grid-2 d-card-body"><UsageMeter title="오늘 공용 사용량" window={data.serviceDaily} nested /><UsageMeter title="이번 달 공용 사용량" window={data.serviceMonthly} nested /></div></Panel>
    <Panel title="사용량 계산 기준"><div className="d-card-body d-usage-rules">{["답변 수집, 질문 제안, 문서 생성, 어시스턴트 답변에 각각 AI 요청을 사용합니다. 답변 1개 또는 기능 실행 1회당 요청 1회가 차감됩니다.", "수집을 시작하면 질문 수 × 모델 수만큼 사용량을 미리 차감합니다. 질문 3개를 Gemini로 수집하면 3회가 차감됩니다.", "요청이 실패하거나 AI 제공자에게 전달됐는지 확인할 수 없어도 차감한 사용량은 자동으로 돌려드리지 않습니다.", "샘플 워크스페이스 탐색과 샘플 수집은 무료 AI 사용량을 차감하지 않습니다."].map(text => <p key={text}><Check size={18} />{text}</p>)}<div className="d-rich-note"><Info size={18} /><span>사용량은 UTC 기준으로 초기화됩니다. 화면에는 초기화 시각을 한국 시간(KST)으로 표시합니다. 운영 상황에 따라 한도가 줄어들 수 있습니다.</span></div></div></Panel>
    <a className="d-text-link" href="/dashboard/prompts">수집할 질문 선택하기<ArrowRight size={16} /></a>
  </div>;
}
function UsageMeter({ title, window, nested = false }: { title: string; window: UsageWindow; nested?: boolean }) {
  const ratio = window.limit ? Math.min(100, window.used / window.limit * 100) : 100;
  const content = <><div className="d-meter-heading"><span>{title}</span><Zap size={18} /></div><div className="d-meter-value"><strong>{window.used}</strong><span>/ {window.limit}회</span><Badge tone={window.remaining ? "gray" : "amber"}>{window.remaining}회 남음</Badge></div><div className="d-progress-track" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={window.limit} aria-valuenow={window.used}><div className="d-progress-fill" style={{ width: `${ratio}%` }} /></div><p className="d-meter-reset">{localDateTime(window.resetsAt)} KST 초기화</p></>;
  return nested ? <div className="d-usage-meter">{content}</div> : <Panel className="d-usage-meter">{content}</Panel>;
}

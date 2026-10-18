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
    <div className="d-usage-hero"><div><Badge tone="blue">Lumen Free</Badge><h2>좋은 질문부터,<br />부담 없이 시작하세요.</h2><p>모든 AI 모델의 요청을 합산합니다.<br />결제 정보 등록이나 유료 구독 없이 이용할 수 있어요.</p></div><div className="d-usage-available"><span>지금 사용할 수 있는 AI 요청</span><strong>{data.available}<small>회</small></strong><span>{data.available > 0 ? "개인 한도와 서비스 공용 한도를 함께 적용합니다." : "한도 초기화 후 다시 이용할 수 있어요."}</span><Button onClick={refresh}><RefreshCw size={16} />새로고침</Button></div></div>
    <div className="d-grid-2"><UsageMeter title="오늘의 내 사용량" window={data.daily} /><UsageMeter title="이번 달 내 사용량" window={data.monthly} /></div>
    <Panel title="서비스 공용 사용량" subtitle="모든 이용자가 함께 사용하는 한도입니다. 개인 한도가 남아 있어도 공용 한도가 먼저 소진될 수 있어요."><div className="d-grid-2 d-card-body"><UsageMeter title="오늘 공용 한도" window={data.serviceDaily} nested /><UsageMeter title="이번 달 공용 한도" window={data.serviceMonthly} nested /></div></Panel>
    <Panel title="사용량은 이렇게 계산해요"><div className="d-card-body d-usage-rules">{["AI 답변 1개, 질문 제안 1회, 문서 생성 1회, 어시스턴트 답변 1회가 각각 요청 1회를 사용합니다.", "수집은 시작할 때 질문 수 × 모델 수만큼 전체 요청을 예약합니다. 질문 3개를 모델 2개로 수집하면 6회를 사용합니다.", "실패했거나 제공자에게 전달됐는지 확실하지 않은 요청은 자동 환급하지 않습니다.", "샘플 워크스페이스 탐색과 샘플 수집은 무료 AI 사용량을 차감하지 않습니다."].map(text => <p key={text}><Check size={18} />{text}</p>)}<div className="d-rich-note"><Info size={18} /><span>한도는 UTC 기준으로 초기화됩니다. 화면의 초기화 시간은 한국 시간(KST)으로 표시됩니다. 운영 상황에 따라 한도가 낮아질 수 있습니다.</span></div></div></Panel>
    <a className="d-text-link" href="/dashboard/prompts">적은 질문으로 수집 시작하기<ArrowRight size={16} /></a>
  </div>;
}
function UsageMeter({ title, window, nested = false }: { title: string; window: UsageWindow; nested?: boolean }) {
  const ratio = window.limit ? Math.min(100, window.used / window.limit * 100) : 100;
  const content = <><div className="d-meter-heading"><span>{title}</span><Zap size={18} /></div><div className="d-meter-value"><strong>{window.used}</strong><span>/ {window.limit}회</span><Badge tone={window.remaining ? "gray" : "amber"}>{window.remaining}회 남음</Badge></div><div className="d-progress-track" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={window.limit} aria-valuenow={window.used}><div className="d-progress-fill" style={{ width: `${ratio}%` }} /></div><p className="d-meter-reset">{localDateTime(window.resetsAt)} KST 초기화</p></>;
  return nested ? <div className="d-usage-meter">{content}</div> : <Panel className="d-usage-meter">{content}</Panel>;
}

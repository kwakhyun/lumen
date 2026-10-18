"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Standard navigation avoids deployed Vinext RSC transition failures. */
import { ArrowUpRight, Bot, Cable, Globe2, ShieldCheck } from "lucide-react";
import type { SiteState } from "@/lib/product-types";
import { Badge, Panel } from "../ui";
import { modelLabel } from "../client";
import GA4 from "./ga4";
export default function Connections({ state }: { state: SiteState }) {
  return <div className="d-stack"><Panel title="AI 모델" subtitle="연결 상태를 확인하고 같은 질문을 서로 다른 관점으로 읽어보세요."><div className="d-provider-list">{state.providers.map(provider => <article key={provider.id} className="d-provider-row"><span className="d-connection-icon"><Bot size={24} /></span><div><h3>{provider.name}</h3><p>{provider.description}</p><span className="d-caption">{modelLabel(provider.model)}</span></div><Badge tone={provider.configured && provider.available ? "green" : "gray"}>{provider.configured && provider.available ? "수집 가능" : "연결 준비 중"}</Badge></article>)}</div><div className="d-panel-footnote"><ShieldCheck size={17} /><span>인증 키는 서버에서만 사용합니다. 연결되지 않은 모델로 요청하거나 사용량을 차감하지 않습니다.</span><a href="/dashboard/models" className="d-text-link">모델별 결과<ArrowUpRight size={16} /></a></div></Panel><GA4 state={state} compact /><Panel title="웹사이트 이벤트" subtitle="간단한 방문 집계가 필요하다면 추적 스크립트를 설치할 수 있어요."><div className="d-card-body d-connection-intro"><span className="d-connection-icon"><Globe2 size={25} /></span><div><h3>{state.site.domain}</h3><p>{state.site.mode === "demo" ? "샘플 워크스페이스는 실제 방문을 수집하지 않습니다." : state.traffic.totalVisits ? `${state.traffic.totalVisits.toLocaleString()}개의 방문 이벤트가 수집됐습니다.` : "아직 수신한 이벤트가 없습니다. 설치 방법을 확인해 주세요."}</p></div><a href="/dashboard/traffic" className="d-button">설치와 결과<ArrowUpRight size={16} /></a></div></Panel><div className="d-rich-note"><Cable size={18} /><span>연결된 데이터의 범위와 수집 방식은 서로 다릅니다. AI 답변의 인용, GA4 세션, 웹사이트 방문 이벤트를 같은 수치로 해석하지 않습니다.</span></div></div>;
}

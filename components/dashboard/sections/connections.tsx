"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Standard navigation avoids deployed Vinext RSC transition failures. */
import { ArrowUpRight, Bot, Cable, Globe2, ShieldCheck } from "lucide-react";
import type { SiteState } from "@/lib/product-types";
import { Badge, Panel } from "../ui";
import { modelLabel } from "../client";
import GA4 from "./ga4";
import { providerLabel } from "../measurement";
export default function Connections({ state }: { state: SiteState }) {
  return <div className="d-stack"><Panel title="AI 모델" subtitle="이용할 수 있는 모델과 답변 수집 방식을 확인하세요. 현재 무료 서비스에서는 Gemini의 일반 응답을 수집합니다."><div className="d-provider-list">{state.providers.map(provider => <article key={provider.id} className="d-provider-row"><span className="d-connection-icon"><Bot size={24} /></span><div><h3>{provider.name}</h3><p>{provider.description}</p><span className="d-caption">{modelLabel(provider.model)}</span></div><Badge tone={provider.configured && provider.available ? "green" : "gray"}>{providerLabel(provider)}</Badge></article>)}</div><div className="d-panel-footnote"><ShieldCheck size={17} /><span>API 키는 서버에서만 사용합니다. 이용할 수 없는 모델은 실행하지 않으며, Gemini에 오류가 나도 유료 모델로 전환하지 않습니다.</span><a href="/dashboard/models" className="d-text-link">모델별 결과<ArrowUpRight size={16} /></a></div></Panel><GA4 state={state} compact /><Panel title="웹사이트 방문 집계" subtitle="웹사이트에 추적 스크립트를 설치하면 방문 이벤트를 집계할 수 있습니다."><div className="d-card-body d-connection-intro"><span className="d-connection-icon"><Globe2 size={25} /></span><div><h3>{state.site.domain}</h3><p>{state.site.mode === "demo" ? "샘플 워크스페이스에서는 실제 방문을 집계하지 않습니다." : state.traffic.totalVisits ? `${state.traffic.totalVisits.toLocaleString()}건의 방문 이벤트를 수집했습니다.` : "아직 수집된 방문 이벤트가 없어요. 설치 방법을 확인해 주세요."}</p></div><a href="/dashboard/traffic" className="d-button">설치 방법과 방문 현황<ArrowUpRight size={16} /></a></div></Panel><div className="d-rich-note"><Cable size={18} /><span>AI 답변의 인용 수, GA4 세션 수, 웹사이트 방문 이벤트 수는 각각 다른 기준으로 집계됩니다. 서로 같은 지표로 비교하지 않도록 주의해 주세요.</span></div></div>;
}

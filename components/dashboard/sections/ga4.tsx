"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Standard navigation avoids deployed Vinext RSC transition failures. */
import { useState } from "react";
import { ArrowRight, BarChart3, ChevronDown, Info, Link2, RefreshCw, Unplug } from "lucide-react";
import type { GA4Property, GA4Status } from "@/lib/integration-types";
import type { SiteState } from "@/lib/product-types";
import { Badge, Button, Empty, Field, Modal, Panel, TrendChart, csvFile } from "../ui";
import { localDateTime, requestJson, useResource } from "../client";

export default function GA4({ state, compact = false }: { state: SiteState; compact?: boolean }) {
  const base = `/api/integrations/ga4/${state.site.id}`;
  const resource = useResource<GA4Status>(`${base}/status`);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [properties, setProperties] = useState<GA4Property[]>([]); const [nextToken, setNextToken] = useState<string | null>(null); const [propertiesLoaded, setPropertiesLoaded] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState(""); const [days, setDays] = useState("30"); const [disconnect, setDisconnect] = useState(false);
  const status = resource.data;
  async function action(path: string, body: unknown = {}) { setBusy(true); setError(""); try { const result = await requestJson<GA4Status & { url?: string }>(`${base}/${path}`, "POST", body); if (result.url) window.location.assign(result.url); else resource.setData(result); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); } }
  async function loadProperties(append = false) { setBusy(true); setError(""); try { const result = await requestJson<{ properties: GA4Property[]; nextPageToken: string | null }>(`${base}/properties${append && nextToken ? `?pageToken=${encodeURIComponent(nextToken)}` : ""}`); setProperties(p => append ? [...p, ...result.properties.filter(v => !p.some(old => old.id === v.id))] : result.properties); setNextToken(result.nextPageToken); setPropertiesLoaded(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  if (resource.loading && !status) return <Panel><div className="d-card-body"><p className="d-muted">Google Analytics 연결 상태를 확인하고 있어요…</p></div></Panel>;
  if (!status) return <Panel><div className="d-card-body"><div className="d-error" role="alert">{resource.error || "연결 상태를 확인하지 못했어요."}<Button onClick={resource.refresh}>다시 시도</Button></div></div></Panel>;
  const report = status.report;
  const series = report ? Array.from(report.rows.reduce((map, row) => { map.set(row.date, (map.get(row.date) || 0) + row.sessions); return map; }, new Map<string, number>())).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date: date.includes("-") ? date : `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`, value })) : [];
  return <div className="d-stack">
    <Panel title="Google Analytics 4" subtitle="방문자가 AI의 답변에서 웹사이트까지 이어졌는지 확인하세요." action={<Badge tone={status.connected ? "green" : "gray"}>{status.connected ? "연결됨" : status.reconnectRequired ? "다시 연결 필요" : "연결 전"}</Badge>}>
      <div className="d-card-body">
        {status.oauthMode === "testing" && <div className="d-rich-note"><Info size={18} /><span><strong>Google 연결은 테스트 운영 중입니다.</strong> 등록된 테스트 사용자만 연결할 수 있고, 갱신 토큰이 7일 후 만료되어 재연결이 필요할 수 있습니다. 일반 서비스 이용이나 AI 수집에는 Google 연결이 필요하지 않습니다.</span></div>}
        {(error || resource.error || status.error) && <div className="d-error" role="alert">{error || resource.error || status.error}</div>}
        {state.site.mode === "demo" ? <Empty icon={<BarChart3 size={28} />} title="실제 웹사이트에서 연결해 보세요" text="샘플 데이터에 실제 방문 실적을 섞지 않습니다. 내 브랜드 워크스페이스에서 Google Analytics를 연결할 수 있어요." /> : !status.connected ? <div className="d-connection-intro"><span className="d-connection-icon"><BarChart3 size={28} /></span><div><h3>{status.reconnectRequired ? "Google 계정을 다시 연결해 주세요" : "이미 사용 중인 방문 데이터를 가져오세요"}</h3><p>읽기 전용 권한으로 속성과 집계 보고서를 가져옵니다. Google 비밀번호나 인증 토큰을 Lumen에 직접 입력하지 않습니다.</p>{!status.configured && <p className="d-field-hint">Google 연결이 아직 준비되지 않았습니다. 준비되면 이곳에서 연결할 수 있어요.</p>}</div><Button variant="primary" busy={busy} disabled={!status.configured} onClick={() => action("connect")}><Link2 size={16} />Google 연결</Button></div> : <>
          <div className="d-setting-row"><div><strong>{status.propertyName || "아직 분석할 속성을 선택하지 않았어요"}</strong><p>{status.propertyId ? `속성 ${status.propertyId} · 최근 가져오기 ${localDateTime(status.lastSyncedAt)} KST` : "연결된 Google 계정에서 분석할 GA4 속성을 선택하세요."}</p></div><div className="d-row-inline"><Button onClick={() => loadProperties()} busy={busy}>속성 선택<ChevronDown size={16} /></Button><Button variant="quiet" busy={busy} onClick={() => action("connect")}><RefreshCw size={16} />권한 다시 연결</Button><Button variant="quiet" onClick={() => setDisconnect(true)}><Unplug size={16} />연결 해제</Button></div></div>
          {propertiesLoaded && <div className="d-property-picker"><Field label="GA4 속성"><select aria-label="GA4 속성 선택" value={selectedProperty} onChange={e => setSelectedProperty(e.target.value)}><option value="">속성을 선택하세요</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name} · {p.accountName} ({p.id})</option>)}</select></Field><div className="d-row-inline"><Button variant="primary" disabled={!selectedProperty} busy={busy} onClick={() => action("property", { propertyId: selectedProperty })}>이 속성 사용</Button>{nextToken && <Button busy={busy} onClick={() => loadProperties(true)}>속성 더 불러오기</Button>}{!properties.length && <span className="d-muted">이 계정에서 접근할 수 있는 속성이 없습니다.</span>}</div></div>}
          {!compact && <div className="d-toolbar d-toolbar-plain"><label className="d-select-wrap"><select aria-label="GA4 가져오기 기간" value={days} onChange={e => setDays(e.target.value)}><option value="7">최근 7일</option><option value="30">최근 30일</option><option value="90">최근 90일</option></select></label><Button variant="primary" disabled={!status.propertyId} busy={busy} onClick={() => action("sync", { days: Number(days) })}><RefreshCw size={16} />방문 데이터 가져오기</Button><span className="d-muted">어제까지의 완료된 날짜를 가져옵니다.</span></div>}
          {compact && <a className="d-text-link" href="/dashboard/traffic">방문 보고서 열기<ArrowRight size={16} /></a>}
        </>}
      </div>
    </Panel>
    {!compact && status.connected && (report ? <>
      {(report.dataQuality.sampled || report.dataQuality.subjectToThresholding || report.dataQuality.dataLossFromOtherRow) && <div className="d-rich-note"><Info size={18} /><span>Google이 이 보고서에 {report.dataQuality.sampled ? "샘플링 " : ""}{report.dataQuality.subjectToThresholding ? "데이터 임계값 " : ""}{report.dataQuality.dataLossFromOtherRow ? "일부 행 통합 " : ""}을 적용했습니다. 실제 전체 방문과 차이가 있을 수 있습니다.</span></div>}
      <div className="d-tracking-stats"><Panel className="d-mini-stat"><span>전체 세션</span><strong>{report.totalSessions.toLocaleString()}</strong></Panel><Panel className="d-mini-stat"><span>전체 사용자</span><strong>{report.totalUsers.toLocaleString()}</strong></Panel><Panel className="d-mini-stat"><span>AI 추천 세션</span><strong>{report.aiSessions.toLocaleString()}</strong></Panel></div>
      <Panel title="GA4 세션 추이" subtitle={`${report.startDate} — ${report.endDate} · 속성 시간대 ${report.timeZone || "정보 없음"}`} action={<Button onClick={() => csvFile("lumen-ga4.csv", [["날짜", "출처", "매체", "세션", "조회수"], ...report.rows.map(r => [r.date, r.source, r.medium, r.sessions, r.views])])}>CSV 내보내기</Button>}><TrendChart data={series} label="세션" suffix="" /></Panel>
      <Panel title="유입 근거" subtitle="GA4의 출처와 매체별 집계입니다. 사용자 수는 행별로 더하지 않습니다."><div className="d-table-wrap"><table className="d-table"><thead><tr><th>날짜</th><th>출처</th><th>매체</th><th>세션</th><th>조회수</th></tr></thead><tbody>{report.rows.slice(0, 50).map((row, i) => <tr key={`${row.date}-${row.source}-${i}`}><td>{row.date}</td><td>{row.source}</td><td>{row.medium}</td><td>{row.sessions.toLocaleString()}</td><td>{row.views.toLocaleString()}</td></tr>)}</tbody></table></div><div className="d-table-footer">{report.rows.length}개 집계 행 중 최대 50개 표시 · CSV에 모든 행이 포함됩니다.</div></Panel>
    </> : <Panel><Empty title="첫 보고서를 가져와 보세요" text="속성을 선택하고 방문 데이터를 가져오면 세션, 사용자, AI 추천 방문을 확인할 수 있어요." /></Panel>)}
    {disconnect && <Modal title="Google 연결을 해제할까요?" subtitle="Lumen에 저장된 인증 정보와 가져온 보고서를 삭제합니다. Google 계정의 앱 권한은 계정 설정에서 별도로 취소할 수 있습니다." onClose={() => setDisconnect(false)}><div className="d-form"><div className="d-form-actions"><Button onClick={() => setDisconnect(false)}>유지하기</Button><Button variant="danger" busy={busy} onClick={async () => { if (await action("disconnect")) { setDisconnect(false); setProperties([]); setPropertiesLoaded(false); } }}>연결 해제</Button></div></div></Modal>}
  </div>;
}

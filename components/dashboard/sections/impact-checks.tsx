"use client";

import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { ImpactDetail } from '@/lib/impact-types';
import type { ImpactCheck, ImpactCheckPayload, ImpactChecksResponse } from '@/lib/impact-check-types';
import { IMPACT_CHECK_REQUEST_BYTES } from '@/lib/impact-check-types';
import { impactCheckPayloadSchema } from '@/lib/impact-check-validation';
import { checkBaseline, checkCitation, checkContextChanged, checkMention } from '@/lib/impact-checks-view';
import { Badge, Button, Empty, Field, Modal, Panel, downloadFile } from '../ui';
import { localDateTime, requestJson } from '../client';

const known = (value: boolean | null) => value === null ? '미확인' : value ? '있음' : '없음';
const contextLabels = { surface: '검색 서비스', model: '모델', language: '언어', country: '지역', device: '기기', personalization: '개인화 조건' };
export function ImpactChecks({ detail, refresh }: { detail: ImpactDetail; refresh: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false), [raw, setRaw] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<ImpactCheckPayload | null>(null);
  const requestId = useRef(''), lock = useRef(false);
  const checks = detail.checks ?? [];
  function edit(value: string) { setRaw(value); setPreview(null); setError(''); requestId.current = crypto.randomUUID(); }
  function parse() {
    try {
      if (new TextEncoder().encode(raw).byteLength > IMPACT_CHECK_REQUEST_BYTES) throw new Error('JSON 파일은 96 KiB 이내여야 해요.');
      const parsed = impactCheckPayloadSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw new Error(`자료를 확인해 주세요: ${parsed.error.issues[0]?.message ?? '형식이 올바르지 않아요.'}`);
      setPreview(parsed.data); setError('');
    } catch (cause) { setError((cause as Error).message); }
  }
  async function save() {
    if (!preview || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await requestJson<ImpactChecksResponse>('/api/impact/checks', 'POST', { siteId: detail.study.siteId, studyId: detail.study.id, requestId: requestId.current, payload: preview });
      setOpen(false); setNotice('배포 후 점검을 저장했어요. 고정된 계획의 비교 결과에는 합산하지 않습니다.'); await refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  const baselineRows = detail.searches.filter(row => row.phase === 'before' && !row.voidedAt);
  const templateParts = Math.max(1, Math.ceil(baselineRows.length / 20));
  function template(part = 0) {
    const payload = { label: '배포 후 검색 점검', publishedAt: '', deploymentRef: '', contentVersion: '', changes: '', changedUrls: [detail.study.plan.queries[0]?.pageUrl ?? ''], context: detail.study.plan.context, indexingStatus: 'unconfirmed', indexingEvidence: '', observations: baselineRows.slice(part * 20, part * 20 + 20).map(row => ({ baselineDigest: row.digest, queryId: row.queryId, repetition: row.repetition, observedAt: '', result: 'error', searchConfirmed: false, answerExcerpt: '', brandMention: 'uncertain', citationReview: 'not_reviewed', evidenceUrl: '', citations: [], notes: '' })) };
    downloadFile(`lumen-deployment-check-template-${part + 1}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }
  return <Panel title="배포 후 별도 점검" subtitle="실제 배포 이후 같은 질문으로 확인한 결과입니다. 원래 계획과 다른 시점의 관측은 별도로 보관해요." action={<Button onClick={() => { setOpen(true); edit(''); }}><Plus size={16} />점검 자료 가져오기</Button>}>
    <div className="d-card-body"><p className="d-rich-note">검색 결과는 수집 시점과 개인화, 검색 서비스의 변화에 따라 달라집니다. 전후 차이만으로 콘텐츠 개선의 효과를 확정할 수 없으며, 검색 노출과 매출 증가는 별도로 검증해야 해요.</p>{notice && <p className="d-impact-notice" role="status">{notice}</p>}</div>
    {checks.length ? <div className="d-impact-records">{checks.map(check => <CheckRecord key={check.id} check={check} detail={detail} />)}</div> : <Empty title="아직 배포 후 점검이 없어요" text="실제 배포 시각과 검색 근거를 확인한 뒤 자료를 가져오세요. 저장된 변경 전 기록과 연결해 질문별로 비교합니다." />}
    {open && <Modal title="배포 후 점검 가져오기" subtitle="실제로 확인한 결과만 입력하세요. 저장 후 원본은 수정할 수 없으며 AI 요청은 발생하지 않습니다." wide dismissDisabled={busy} onClose={() => setOpen(false)}><div className="d-form">
      <div className="d-row-inline">{Array.from({ length: templateParts }, (_, part) => <Button key={part} onClick={() => template(part)} disabled={busy || !baselineRows.length}>기준 기록 양식 다운로드{templateParts > 1 ? ` (${part + 1}/${templateParts})` : ''}</Button>)}</div>
      <p className="d-caption">양식의 빈 배포 시각과 관측 시각, 버전, 검색 근거를 실제 값으로 채우세요. 확인하지 못한 언급과 인용을 ‘없음’으로 입력하지 마세요.</p><p className="d-caption">입력 오류를 정정할 때는 새 점검의 제목과 변경 내용에 원본 기록 해시와 정정 사유를 남기세요. 이전 기록은 삭제되지 않으며 점검별 결과를 따로 표시합니다.</p>
      <Field label="점검 JSON 파일" hint="최대 96 KiB, 한 번에 20개 관측까지 가져올 수 있어요."><input type="file" accept=".json,application/json" disabled={busy} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; edit(''); try { if (file.size > IMPACT_CHECK_REQUEST_BYTES) throw new Error('파일은 96 KiB 이내여야 해요.'); edit(await file.text()); } catch (cause) { setError((cause as Error).message); } }} /></Field>
      <Field label="점검 JSON"><textarea className="d-impact-import-json" rows={10} value={raw} disabled={busy} onChange={event => edit(event.target.value)} /></Field>
      {error && <p className="d-error" role="alert">{error}</p>}
      {preview && <div className="d-impact-import-preview"><article><h3>{preview.label}</h3><p>배포 {localDateTime(preview.publishedAt)} KST / 관측 {preview.observations.length}건</p><p>{preview.changes}</p><p>{preview.indexingStatus === 'confirmed' ? '사용자가 검색 반영 근거를 입력했어요.' : '변경 내용의 검색 반영 여부는 미확인입니다.'}</p><p className="d-caption">저장 전에 실제 관측 환경과 인용 목록을 다시 확인하세요.</p></article></div>}
      <div className="d-form-actions"><Button onClick={() => setOpen(false)} disabled={busy}>취소</Button><Button onClick={parse} disabled={busy || !raw.trim()}>자료 미리보기</Button><Button variant="primary" onClick={save} busy={busy} disabled={!preview}>점검 저장</Button></div>
    </div></Modal>}
  </Panel>;
}

function CheckRecord({ check, detail }: { check: ImpactCheck; detail: ImpactDetail }) {
  const { payload } = check, plan = detail.study.plan;
  const timingChanged = Date.parse(payload.publishedAt) !== Date.parse(plan.changedAt);
  const environmentChanged = checkContextChanged(plan.context, payload.context);
  return <article>
    <div className="d-row-inline"><Badge tone="blue">별도 관측</Badge><Badge>{payload.indexingStatus === 'confirmed' ? '사용자가 검색 반영 근거 등록' : '검색 반영 미확인'}</Badge></div>
    <h3>{payload.label}</h3><p>실제 배포 {localDateTime(payload.publishedAt)} KST</p><p>{payload.changes}</p>
    {timingChanged && <p className="d-rich-note">계획의 변경 시각({localDateTime(plan.changedAt)} KST)과 다릅니다. 원래 계획의 변경 후 집계에는 포함하지 않습니다.</p>}
    {environmentChanged && <p className="d-rich-note">계획과 실제 검색 환경이 다릅니다. 아래 검색 조건을 함께 확인하세요.</p>}
    <div className="d-table-scroll d-impact-baseline-table" tabIndex={0} role="region" aria-label="질문별 배포 전후 관측"><table className="d-table"><thead><tr><th scope="col">동일 질문</th><th scope="col">브랜드 언급<br />기준 → 배포 후</th><th scope="col">자사 인용<br />기준 → 배포 후</th><th scope="col">배포 후 관측 시각</th></tr></thead><tbody>{payload.observations.map(row => {
      const before = checkBaseline(row, detail.searches), query = plan.queries.find(q => q.id === row.queryId);
      return <tr key={`${row.queryId}-${row.repetition}`}><td><span className="d-impact-check-question">{query?.question ?? '계획의 질문'}</span><small>{query?.arm === 'treatment' ? '개선 대상' : '비교 대상'} / {row.repetition}회차</small></td><td>{before ? `${known(checkMention(before))} → ${known(checkMention(row))}` : '기준 기록 제외됨'}</td><td>{before ? `${known(checkCitation(before, detail.study.brand.domain))} → ${known(checkCitation(row, detail.study.brand.domain))}` : '비교 제외'}</td><td>{localDateTime(row.observedAt)} KST</td></tr>;
    })}</tbody></table></div>
    <details><summary>배포 내역과 검색 근거 보기</summary><div className="d-stack"><p>배포 기록: {payload.deploymentRef}<br />콘텐츠 버전: {payload.contentVersion}</p><ul>{payload.changedUrls.map(url => <li key={url}><a className="d-impact-link" href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul><dl className="d-impact-baseline-meta">{(Object.keys(contextLabels) as (keyof typeof contextLabels)[]).map(key => <div key={key}><dt>{contextLabels[key]}</dt><dd>{payload.context[key]}</dd></div>)}</dl><p>{payload.indexingEvidence || '검색 서비스가 이번 변경 내용을 반영했는지는 확인되지 않았습니다.'}</p>{payload.observations.map(row => <div key={`${row.queryId}-${row.repetition}`}><h3>{plan.queries.find(q => q.id === row.queryId)?.question}</h3><p>원래 표시된 인용 {row.citations.filter(c => c.relation === 'original_citation').length}개 / {row.searchConfirmed ? '검색 사용 확인' : '검색 사용 미확인'} / {row.citationReview === 'complete' ? '인용 검토 완료' : '인용 미검토'}</p>{row.evidenceUrl && <a className="d-impact-link" href={row.evidenceUrl} target="_blank" rel="noopener noreferrer">검색 결과 근거 열기</a>}{row.answerExcerpt && <blockquote>{row.answerExcerpt}</blockquote>}<ul>{row.citations.map((citation, i) => <li key={i}><a className="d-impact-link" href={citation.url} target="_blank" rel="noopener noreferrer">{citation.title || citation.url}</a>{citation.relation === 'followup_search' ? ' (나중에 찾은 참고 자료)' : ''}</li>)}</ul><p>{row.notes}</p></div>)}<p className="d-caption">사용자가 관측한 자료 / 저장 {localDateTime(check.createdAt)} KST<br />기록 해시: {check.digest}</p></div></details>
  </article>;
}

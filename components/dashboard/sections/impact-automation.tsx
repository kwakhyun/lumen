"use client";

import { useRef, useState } from 'react';
import { Download, FileUp, Info, RefreshCw } from 'lucide-react';
import type { ImpactDetail, ImpactStudy } from '@/lib/impact-types';
import type { ImpactBaseline, ImpactBaselineResponse } from '@/lib/impact-baseline-types';
import { Badge, Button, Empty, Field, Modal, Panel, Skeleton, downloadFile, numberLabel } from '../ui';
import { requestJson, useResource } from '../client';
import { beforeSearchBaseline, IMPACT_IMPORT_BYTES, prepareImpactImport, saveImpactImport, type ImpactImportRow } from '../impact-automation';

const arms = ['treatment', 'control'] as const;
const armLabel = { treatment: '개선 대상', control: '비교 대상' };
const phaseLabel = { before: '변경 전', after: '변경 후' };
const time = (value: string) => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value));

export function BeforeSearchBaseline({ detail }: { detail: ImpactDetail }) {
  const baseline = beforeSearchBaseline(detail.study, detail.searches);
  return <Panel title="변경 전 검색 기준값" subtitle={`${detail.study.plan.beforeStart} ~ ${detail.study.plan.beforeEnd} UTC에 기록한 표본입니다. 변경 후 관측이 없어도 확인할 수 있어요.`}><div className="d-table-wrap d-impact-baseline-table" role="region" aria-label="변경 전 검색 기준값 표. 좁은 화면에서는 좌우로 이동할 수 있습니다." tabIndex={0}><table className="d-table"><thead><tr><th scope="col">대상</th><th scope="col">기록 / 계획</th><th scope="col">검색 확인 답변</th><th scope="col">브랜드 언급률</th><th scope="col">브랜드 원문 인용률</th></tr></thead><tbody>{arms.map(arm => <tr key={arm}><th scope="row">{armLabel[arm]}</th><td>{baseline[arm].recorded} / {baseline[arm].planned}</td><td>{baseline[arm].confirmedAnswers}개</td>{(['mention', 'citation'] as const).map(metric => <td key={metric}>{baseline[arm][metric].rate === null ? '측정 불가' : `${numberLabel(baseline[arm][metric].rate)}%`}<small className="d-impact-baseline-denominator">{baseline[arm][metric].numerator} / {baseline[arm][metric].denominator}</small></td>)}</tr>)}</tbody></table></div><div className="d-card-body"><p className="d-caption">검색이 확인된 AI 답변 중 판정이 끝난 기록만 집계해요. 미관측, 오류와 AI 답변 미표시는 0으로 넣지 않습니다. 전체 AI 검색 시장의 노출률이나 개선 효과를 뜻하지 않아요.</p></div></Panel>;
}

export function Ga4Baseline({ siteId, study }: { siteId: string; study: ImpactStudy }) {
  const resource = useResource<ImpactBaselineResponse>(`/api/impact/baseline?siteId=${siteId}&studyId=${study.id}`);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const requestId = useRef(''), lock = useRef(false);
  async function collect() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    if (!requestId.current) requestId.current = crypto.randomUUID();
    try {
      const result = await requestJson<ImpactBaselineResponse>('/api/impact/baseline', 'POST', { siteId, studyId: study.id, requestId: requestId.current });
      resource.setData(result); requestId.current = '';
      setNotice(result.cached ? '최근 저장한 GA4 자료를 불러왔어요. Google에 중복 조회하지 않았습니다.' : '연결된 GA4의 방문 집계를 저장했어요. AI 사용량은 차감되지 않았습니다.');
    } catch (cause) { setError((cause as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  const rows = resource.data?.baselines ?? [], latest = rows[0];
  return <Panel title="GA4 기준 자료" subtitle="연결된 Google Analytics에서 브랜드 사이트의 방문 집계를 가져옵니다." action={<Button onClick={collect} busy={busy} disabled={resource.loading && !resource.data}><RefreshCw size={15} />GA4 기준 자료 가져오기</Button>}><div className="d-card-body d-stack">
    <div className="d-rich-note"><Info size={17} aria-hidden="true" /><span>기존 GA4 연결로 가져온 사이트 전체 방문의 참고 자료예요. 개선 대상과 비교 대상의 성과로 나누지 않으며, 전후 성과 비교에도 넣지 않습니다. 유료 API나 AI 모델은 호출하지 않아요.</span></div>
    {(error || resource.error) && <div className="d-error" role="alert">{error || resource.error}</div>}
    {notice && <p className="d-impact-notice" role="status">{notice}</p>}
    {resource.loading && !resource.data ? <Skeleton /> : latest ? <>
      <BaselineRecord record={latest} />
      {rows.length > 1 && <details className="d-impact-baseline-history"><summary>이전 기준 자료 {rows.length - 1}개 보기</summary><div className="d-stack">{rows.slice(1).map(record => <BaselineRecord key={record.id} record={record} />)}</div></details>}
    </> : !resource.error && <Empty title="아직 가져온 GA4 기준 자료가 없어요" text="연결 관리에서 선택한 GA4 속성을 읽어 옵니다. 방문과 AI 추천 유입은 확인할 수 있지만, 측정하지 않은 구매나 매출을 0으로 채우지는 않아요." />}
    <p className="d-caption">가져온 데이터는 GA4의 처리 상태에 따라 달라질 수 있어요. 최근 약 48시간의 집계는 잠정값으로 보고, 보고서의 시간대와 조회 범위를 함께 확인하세요.</p>
  </div></Panel>;
}

function BaselineRecord({ record }: { record: ImpactBaseline }) {
  const data = record.payload;
  const timeZoneDiffers = !['UTC', 'Etc/UTC', 'Etc/GMT', 'GMT'].includes(data.timeZone);
  const periodDiffers = data.startDate !== data.requestedStartDate || data.endDate !== data.requestedEndDate;
  return <article className="d-impact-ga4-record"><div className="d-impact-toolbar"><div className="d-row-inline"><Badge tone="blue">GA4 API 집계</Badge><Badge>전후 비교 미포함</Badge></div><Button variant="quiet" onClick={() => downloadFile(`lumen-ga4-baseline-${record.id}.json`, JSON.stringify(record, null, 2), 'application/json')}><Download size={15} />자료 내보내기</Button></div><h3>{data.propertyName || '연결된 GA4 속성'}</h3><p className="d-caption">속성 {data.propertyId} / {data.hostName}<br />{data.startDate} ~ {data.endDate} / {data.timeZone || '시간대 미확인'}<br />가져온 시각 {time(data.fetchedAt)} (한국 시간)</p>
    {(timeZoneDiffers || periodDiffers) && <p className="d-rich-note"><Info size={17} aria-hidden="true" /><span>{timeZoneDiffers ? `GA4는 ${data.timeZone} 기준이고, 검증 계획은 UTC 기준입니다. 같은 날짜여도 포함되는 시간이 달라요. ` : ''}{periodDiffers ? `실제 보고서 기간(${data.startDate} ~ ${data.endDate})이 계획한 기준 기간(${data.requestedStartDate} ~ ${data.requestedEndDate})과 달라요. ` : ''}이 자료를 계획의 변경 전 집계와 같은 값으로 사용하면 안 됩니다.</span></p>}
    {(data.dataQuality.subjectToThresholding || data.dataQuality.dataLossFromOtherRow || data.dataQuality.sampled || data.dataQuality.truncated || data.dataQuality.emptyReasons.length > 0) && <p className="d-rich-note"><Info size={17} aria-hidden="true" /><span>GA4 응답에 데이터 품질 제한이 표시됐어요. 아래 집계 조건을 확인하고, 표시된 수치를 완전한 방문 수로 해석하지 마세요.</span></p>}
    <div className="d-impact-values"><span>브랜드 사이트 세션<strong>{numberLabel(data.totalSessions)}</strong></span><span>확인된 AI 추천 세션<strong>{numberLabel(data.aiSessions)}</strong></span><span>페이지 조회<strong>{numberLabel(data.totalViews)}</strong></span><span>전환 세션<strong>미측정</strong></span><span>주문과 매출<strong>미측정</strong></span></div>
    <p className="d-caption">세션 소스로 식별된 AI 추천 방문입니다. 추천 출처가 전달되지 않은 방문이나 나중에 직접 방문한 고객은 빠질 수 있어요. 사이트 전체 범위의 집계이므로 개선 대상과 비교 대상의 성과로 나누어 해석할 수 없습니다.</p>
    <details><summary>집계 조건과 데이터 품질</summary><dl className="d-impact-baseline-meta"><div><dt>계획한 기준 기간</dt><dd>{data.requestedStartDate} ~ {data.requestedEndDate} UTC</dd></div><div><dt>가져온 보고서 기간</dt><dd>{data.startDate} ~ {data.endDate} ({data.timeZone})</dd></div><div><dt>집계 범위</dt><dd>{data.hostName}의 세션</dd></div><div><dt>AI 유입 분류 규칙</dt><dd><code>{data.sourcePattern}</code></dd></div><div><dt>임계값 적용</dt><dd>{data.dataQuality.subjectToThresholding ? '적용됨' : '적용 표시 없음'}</dd></div><div><dt>기타 행으로 인한 손실</dt><dd>{data.dataQuality.dataLossFromOtherRow ? '있음' : '손실 표시 없음'}</dd></div><div><dt>표본 집계</dt><dd>{data.dataQuality.sampled ? '표본 사용' : '표본 사용 표시 없음'}</dd></div><div><dt>보고서 잘림</dt><dd>{data.dataQuality.truncated ? '일부 행만 포함' : '잘림 표시 없음'}</dd></div>{data.dataQuality.emptyReasons.length > 0 && <div><dt>빈 응답 사유</dt><dd>{data.dataQuality.emptyReasons.join('; ')}</dd></div>}<div><dt>원본 확인값</dt><dd><code>{record.digest}</code></dd></div></dl>{data.notes.length > 0 && <ul>{data.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}</details>
  </article>;
}

export function SearchImport({ siteId, detail, onClose, onSaved }: { siteId: string; detail: ImpactDetail; onClose: () => void; onSaved: (detail: ImpactDetail) => void }) {
  const [raw, setRaw] = useState(''), [rows, setRows] = useState<ImpactImportRow[] | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const saved = rows?.filter(row => row.saved).length ?? 0;
  const complete = !!rows && saved === rows.length;
  function preview() {
    setError('');
    try { setRows(prepareImpactImport(raw, detail.study)); } catch (cause) { setError((cause as Error).message); }
  }
  async function save() {
    if (!rows || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await saveImpactImport(rows, row => requestJson<ImpactDetail>('/api/impact', 'POST', { action: 'add_search', siteId, studyId: detail.study.id, requestId: row.requestId, observation: row.observation }), (next, progress) => { onSaved(next); setRows(progress); });
      setRows(result.rows); setError(result.error);
    } finally { lock.current = false; setBusy(false); }
  }
  function downloadTemplate() {
    const observations = detail.study.plan.queries.map(query => ({ phase: 'before', queryId: query.id, repetition: 1, observedAt: '실제로 관측한 ISO 시각을 입력하세요', result: 'answer', searchConfirmed: false, answerExcerpt: '', brandMention: 'uncertain', citationReview: 'not_reviewed', evidenceUrl: '', citations: [], notes: '' }));
    downloadFile(`lumen-search-template-${detail.study.id}.json`, JSON.stringify({ observations }, null, 2), 'application/json');
  }
  return <Modal title="검색 관측 가져오기" subtitle="실제로 확인한 AI 검색 결과를 JSON으로 한 번에 저장합니다. AI 답변이나 인용을 새로 생성하지 않습니다." onClose={onClose} dismissDisabled={busy} wide><div className="d-form d-impact-form">
    <div className="d-rich-note"><Info size={17} aria-hidden="true" /><span>계획의 질문과 검색 환경에 맞는 관측만 가져오세요. 일반 API 답변이나 별도로 찾은 검색 결과를 실제 AI 검색의 원래 답변과 인용으로 바꾸어 기록하면 안 됩니다.</span></div>
    {!rows ? <><div className="d-impact-toolbar"><Button onClick={downloadTemplate}><Download size={15} />현재 계획의 JSON 양식</Button><span className="d-caption">최대 20개 관측 / 64 KiB</span></div><Field label="관측 JSON 파일 (선택)"><input type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (!file) return; setError(''); if (file.size > IMPACT_IMPORT_BYTES) { setError('JSON 파일은 64 KiB 이하로 나누어 가져오세요.'); event.target.value = ''; return; } void file.text().then(value => setRaw(value)).catch(() => setError('파일을 읽지 못했어요. JSON 내용을 아래에 붙여 넣으세요.')); }} /></Field><Field label="관측 JSON" hint="observations 배열의 각 항목에 질문 ID, 관측 시각, 검색 확인 여부, 답변 발췌와 인용 목록을 넣으세요. 개인정보와 인증 정보는 넣지 마세요."><textarea className="d-impact-import-json" value={raw} onChange={event => setRaw(event.target.value)} rows={12} maxLength={IMPACT_IMPORT_BYTES} spellCheck={false} placeholder={'{\n  "observations": [...]\n}'} /></Field><p className="d-caption">양식의 관측 시각은 실제 시각으로 바꾸세요. 아직 확인하지 않은 항목을 임의로 채우면 안 됩니다. 확인한 자료만 입력한 뒤 미리보기에서 저장할 내용을 검토하세요.</p></> : <>
      <p className="d-impact-notice" role="status">{rows.length}개 관측 중 {saved}개 저장{complete ? ' 완료' : '됨'}</p>
      <div className="d-impact-import-preview">{rows.map((row, index) => { const query = detail.study.plan.queries.find(item => item.id === row.observation.queryId)!; return <article key={row.requestId}><div className="d-row-inline"><Badge tone={row.saved ? 'green' : 'blue'}>{row.saved ? '저장 완료' : '저장 대기'}</Badge><span>{index + 1}. {phaseLabel[row.observation.phase]} / {armLabel[query.arm]} / {row.observation.repetition}회차</span></div><h3>{query.question}</h3><p className="d-caption">{time(row.observation.observedAt)} (한국 시간) / {row.observation.searchConfirmed ? '검색 사용 확인' : '검색 사용 미확인'}</p><p>{row.observation.result === 'answer' ? row.observation.answerExcerpt.slice(0, 240) : row.observation.result === 'no_ai_answer' ? 'AI 답변 미표시' : '확인 실패'}{row.observation.answerExcerpt.length > 240 ? '…' : ''}</p><p className="d-caption">브랜드 {row.observation.brandMention === 'present' ? '언급됨' : row.observation.brandMention === 'absent' ? '언급 없음' : '판정 보류'} / 원래 인용 {row.observation.citations.filter(item => item.relation === 'original_citation').length}개 / 참고 링크 {row.observation.citations.filter(item => item.relation === 'followup_search').length}개 / 인용 목록 {row.observation.citationReview === 'complete' ? '전체 확인' : '미검토'}</p><details><summary>저장할 내용 전체 확인</summary><pre>{JSON.stringify(row.observation, null, 2)}</pre></details></article>; })}</div>
      <p className="d-caption">오류가 나면 해당 관측에서 멈추고, 이미 저장한 기록은 유지해요. 이 창에서 다시 시도하면 완료된 관측을 건너뜁니다. 창을 닫기 전 아래 파일을 내려받으면 같은 요청 ID로 나중에 재시도할 수 있어요.</p><Button disabled={busy} onClick={() => downloadFile(`lumen-search-import-${detail.study.id}.json`, JSON.stringify({ observations: rows.map(row => ({ ...row.observation, requestId: row.requestId })) }, null, 2), 'application/json')}><Download size={15} />재시도용 JSON 내려받기</Button>
    </>}
    {error && <p className="d-error" role="alert">{error}</p>}<div className="d-form-actions">{rows && saved === 0 && <Button disabled={busy} onClick={() => { setRows(null); setError(''); }}>내용 수정</Button>}<Button disabled={busy} onClick={onClose}>{complete ? '닫기' : '취소'}</Button>{!complete && <Button variant="primary" busy={busy} disabled={!rows && !raw.trim()} onClick={rows ? save : preview}><FileUp size={15} />{rows ? saved ? '남은 관측 저장' : `${rows.length}개 관측 저장` : '미리보기'}</Button>}</div>
  </div></Modal>;
}

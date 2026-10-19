"use client";
import { useState, type FormEvent } from 'react';
import { ArrowRight, FlaskConical, Info, Plus, RefreshCw } from 'lucide-react';
import type { SiteState } from '@/lib/product-types';
import type { ExperimentsState, ImprovementExperiment } from '@/lib/experiment-types';
import { Badge, Button, Empty, Field, Modal, Panel, Skeleton } from '../ui';
import { localDateTime, modelLabel, requestJson, useResource } from '../client';

const names = { draft: '계획', observing: '관측 중', reviewed: '검토 완료' };
const metricNames = { mentionRate: '브랜드 언급률', citationRate: '브랜드 인용률' };
const percentage = (n: number | null) => n === null ? '비교 불가' : `${n}%`;

export default function Experiments({ state }: { state: SiteState }) {
  const resource = useResource<ExperimentsState>(`/api/experiments?siteId=${state.site.id}`);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ImprovementExperiment | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const runs = state.runs.filter(run => ['completed', 'partial'].includes(run.status) && run.completed > 0);
  async function save(method: string, payload: unknown) {
    setBusy(true); setError('');
    try { await requestJson('/api/experiments', method, payload); setCreating(false); setSelected(null); await resource.refresh(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="d-stack">
    <Panel title="개선 실험" subtitle="가설을 세우고, 같은 질문의 전후 결과를 비교하세요." action={<div className="d-row-inline"><Button aria-label="개선 실험 새로고침" onClick={resource.refresh} disabled={resource.loading}><RefreshCw size={16} /></Button><Button variant="primary" onClick={() => { setError(''); setCreating(true); }} disabled={!runs.length}><Plus size={16} />실험 만들기</Button></div>}>
      <div className="d-card-body"><div className="d-rich-note"><Info size={18} /><span>실험은 저장된 수집 결과만 사용합니다. 일정이나 AI 요청을 만들지 않으며, 기존 자동 수집도 그대로 유지됩니다. 콘텐츠 수정 등 실제 변경을 마친 뒤 후속 결과를 연결해 주세요. 무료 Gemini는 웹을 검색하지 않으므로 웹페이지 수정의 반영 여부나 효과를 이 실험으로 확인할 수 없습니다.</span></div></div>
      {resource.error && <div className="d-error" role="alert">{resource.error}<Button onClick={resource.refresh}>다시 시도</Button></div>}
      {resource.loading && !resource.data ? <Skeleton /> : resource.data?.experiments.length ? <div className="d-experiment-list">{resource.data.experiments.map(experiment => {
        const comparison = experiment.comparison;
        return <article className="d-experiment-card" key={experiment.id}>
          <div className="d-section-toolbar"><Badge tone={experiment.status === 'reviewed' ? 'green' : 'gray'}>{names[experiment.status]}</Badge><span className="d-caption">{localDateTime(experiment.createdAt)} KST</span></div>
          <h3>{experiment.title}</h3><p>{experiment.hypothesis}</p>
          <div className="d-experiment-target"><span>{metricNames[experiment.metric]}</span><strong>목표 +{experiment.targetDelta}%p</strong></div>
          {comparison ? <><div className="d-experiment-result"><span>{percentage(comparison.before)}</span><ArrowRight size={18} aria-hidden="true" /><strong>{percentage(comparison.after)}</strong><Badge tone={comparison.targetObserved ? 'green' : 'gray'}>{comparison.delta === null ? '성공 표본 없음' : `${comparison.delta > 0 ? '+' : ''}${comparison.delta}%p`}</Badge></div><p className="d-caption">양쪽 성공 {comparison.paired}/{comparison.total}개 · {comparison.targetObserved ? '목표 변화 관측, 원인 판단은 별도' : '추가 검토 필요'}</p></> : <p className="d-muted">기준 {experiment.baselineSnapshot.cells.length}개 답변을 고정했어요. 후속 수집을 연결하면 비교할 수 있습니다.</p>}
          <Button onClick={() => { setError(''); setSelected(experiment); }}>근거와 결과 보기<ArrowRight size={16} /></Button>
        </article>;
      })}</div> : !resource.error && <Empty icon={<FlaskConical size={28} />} title={runs.length ? '첫 개선 가설을 기록해 보세요' : '먼저 완료된 수집이 필요해요'} text={runs.length ? '예: 제품 비교 페이지를 보완하면 같은 구매 질문에서 브랜드 언급이 늘어날 것이다.' : '기존 일정의 수집이 끝나면 그 결과를 기준으로 실험을 만들 수 있습니다.'} />}
    </Panel>
    {creating && <Modal title="개선 실험 만들기" subtitle="기준 수집과 질문, 모델, 브랜드 정의는 저장 후 고정됩니다." onClose={() => setCreating(false)} wide><form className="d-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); void save('POST', { siteId: state.site.id, title: form.get('title'), hypothesis: form.get('hypothesis'), intervention: form.get('intervention'), metric: form.get('metric'), targetDelta: Number(form.get('targetDelta')), baselineRunId: form.get('baselineRunId') }); }}>
      <Field label="실험 이름"><input name="title" required minLength={3} maxLength={200} placeholder="예: 비교 페이지의 제품 설명 보완" /></Field>
      <Field label="가설" hint="대상 질문과 기대하는 변화를 구체적으로 적어 주세요."><textarea name="hypothesis" required minLength={5} maxLength={2000} rows={3} placeholder="제품 특징을 명확히 설명하면 구매 비교 질문의 브랜드 언급이 늘어날 것이다." /></Field>
      <Field label="변경할 내용" hint="페이지, 변경 내용, 적용 시점을 남겨 주세요. 실제 수정은 별도로 진행합니다."><textarea name="intervention" required minLength={3} maxLength={2000} rows={3} /></Field>
      <Field label="기준 수집" hint="최근 40개 수집 중 성공 답변이 있는 완료 결과를 선택합니다."><select name="baselineRunId" required defaultValue={runs[0]?.id}>{runs.map(run => <option key={run.id} value={run.id}>{localDateTime(run.createdAt)} KST / {run.models.map(modelLabel).join(', ')} / 성공 {run.completed}, 실패 {run.failed}</option>)}</select></Field>
      <div className="d-form-row"><Field label="비교 지표" hint="무료 Gemini는 검색 인용을 제공하지 않아 언급률만 사용할 수 있어요."><select name="metric" defaultValue="mentionRate"><option value="mentionRate">브랜드 언급률</option><option value="citationRate">브랜드 인용률 (인용 제공 모델)</option></select></Field><Field label="목표 증가폭 (%p)" hint="예: 20%에서 30%로 증가하면 +10%p입니다."><input name="targetDelta" type="number" min={1} max={100} defaultValue={10} required /></Field></div>
      {error && <div role="alert" className="d-error">{error}</div>}<div className="d-form-actions"><Button onClick={() => setCreating(false)}>취소</Button><Button type="submit" variant="primary" busy={busy}>기준을 고정하고 저장</Button></div>
    </form></Modal>}
    {selected && <ExperimentDetail experiment={selected} runs={runs} busy={busy} error={error} onClose={() => setSelected(null)} onSave={values => save('PATCH', { siteId: state.site.id, id: selected.id, expectedUpdatedAt: selected.updatedAt, ...values })} />}
  </div>;
}

function ExperimentDetail({ experiment: item, runs, busy, error, onClose, onSave }: { experiment: ImprovementExperiment; runs: SiteState['runs']; busy: boolean; error: string; onClose: () => void; onSave: (values: Record<string, unknown>) => Promise<void> }) {
  const result = item.comparison;
  return <Modal title={item.title} subtitle="전후 관측을 기록합니다. 인과 효과나 통계적 유의성을 뜻하지 않습니다." onClose={onClose} wide>
    <div className="d-form"><dl className="d-experiment-facts"><dt>가설</dt><dd>{item.hypothesis}</dd><dt>변경 계획</dt><dd>{item.intervention}</dd><dt>고정한 브랜드</dt><dd>{item.baselineSnapshot.brands.map(brand => `${brand.name} (${brand.domain})`).join(', ')}</dd><dt>측정 기준</dt><dd>{item.baselineSnapshot.version} / {item.baselineSnapshot.mode === 'demo' ? '샘플' : '실제 답변'} / {metricNames[item.metric]}</dd></dl>
    <details className="d-metric-definition"><summary>고정한 질문과 모델 {item.baselineSnapshot.cells.length}개</summary><ul>{item.baselineSnapshot.cells.map((cell, index) => <li key={index}>{cell.question}<span className="d-muted"> — {modelLabel(cell.model)} / {cell.provider} / {cell.status === 'completed' ? '성공' : '실패'}</span></li>)}</ul></details>
    {result && <div className="d-stack"><div className="d-grid-3"><Panel title="기준 언급/인용률"><strong>{percentage(result.before)}</strong></Panel><Panel title="후속 언급/인용률"><strong>{percentage(result.after)}</strong></Panel><Panel title="같은 성공 표본"><strong>{result.paired}/{result.total}</strong></Panel></div><p>기준 실패 {result.baselineFailed}개, 후속 실패 {result.followupFailed}개. 목표 +{item.targetDelta}%p에 대해 {result.targetObserved ? '목표 이상의 변화를 관측했습니다.' : '목표 이상의 변화가 아직 관측되지 않았습니다.'}</p>{result.caveats.map(caveat => <p className="d-caption" key={caveat}>{caveat}</p>)}</div>}
    <form className="d-form" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void onSave({ status: data.get('status'), notes: data.get('notes'), ...(data.get('followupRunId') ? { followupRunId: data.get('followupRunId') } : {}) }); }}>
      <Field label="후속 수집 연결" hint="기준 이후의 같은 질문 문구, 모델, 제공자를 가진 수집만 연결됩니다. 누락되거나 다른 조건이면 저장을 거절합니다."><select name="followupRunId" defaultValue=""><option value="">{item.followupRunId ? '기존 후속 결과 유지' : '나중에 연결하기'}</option>{runs.filter(run => run.id !== item.baselineRunId).map(run => <option key={run.id} value={run.id}>{localDateTime(run.createdAt)} KST / {run.models.map(modelLabel).join(', ')} / 성공 {run.completed}, 실패 {run.failed}</option>)}</select></Field>
      <Field label="진행 상태"><select name="status" defaultValue={item.status}>{Object.entries(names).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="변경 근거와 검토 메모" hint="실제 적용 날짜, 변경한 페이지, 관측 결과와 다음 조치를 남겨 주세요."><textarea name="notes" rows={4} maxLength={4000} defaultValue={item.notes} /></Field>
      {error && <div className="d-error" role="alert">{error}</div>}<div className="d-form-actions"><Button onClick={onClose}>닫기</Button><Button type="submit" variant="primary" busy={busy}>기록 저장</Button></div>
    </form></div>
  </Modal>;
}

"use client";
import { useState, type FormEvent } from 'react';
import { ArrowRight, FlaskConical, Info, Plus, RefreshCw } from 'lucide-react';
import type { SiteState } from '@/lib/product-types';
import type { ExperimentsState, ImprovementExperiment } from '@/lib/experiment-types';
import { Badge, Button, Empty, Field, Modal, Panel, Skeleton } from '../ui';
import { localDateTime, modelLabel, requestJson, useResource } from '../client';

const names = { draft: '계획', observing: '관찰 중', reviewed: '검토 완료' };
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
    <Panel title="개선 실험" subtitle="개선할 내용과 목표를 기록하고, 같은 조건으로 수집한 답변을 비교하세요." action={<div className="d-row-inline"><Button aria-label="개선 실험 새로고침" onClick={resource.refresh} disabled={resource.loading}><RefreshCw size={16} /></Button><Button variant="primary" onClick={() => { setError(''); setCreating(true); }} disabled={!runs.length}><Plus size={16} />실험 만들기</Button></div>}>
      <div className="d-card-body"><div className="d-rich-note"><Info size={18} /><span>이미 수집한 답변을 비교하는 기능이에요. 실험을 저장해도 새 AI 요청이나 수집 일정이 만들어지지 않아요. 콘텐츠 등을 수정한 뒤 비교할 수집 결과를 연결하세요. 무료 Gemini는 웹을 검색하지 않으므로, 웹페이지 수정이 답변에 반영됐는지 또는 효과가 있었는지는 확인할 수 없어요.</span></div></div>
      {resource.error && <div className="d-error" role="alert">{resource.error}<Button onClick={resource.refresh}>다시 시도</Button></div>}
      {resource.loading && !resource.data ? <Skeleton /> : resource.data?.experiments.length ? <div className="d-experiment-list">{resource.data.experiments.map(experiment => {
        const comparison = experiment.comparison;
        return <article className="d-experiment-card" key={experiment.id}>
          <div className="d-section-toolbar"><Badge tone={experiment.status === 'reviewed' ? 'green' : 'gray'}>{names[experiment.status]}</Badge><span className="d-caption">{localDateTime(experiment.createdAt)} KST</span></div>
          <h3>{experiment.title}</h3><p>{experiment.hypothesis}</p>
          <div className="d-experiment-target"><span>{metricNames[experiment.metric]}</span><strong>목표 +{experiment.targetDelta}%p</strong></div>
          {comparison ? <><div className="d-experiment-result"><span>{percentage(comparison.before)}</span><ArrowRight size={18} aria-hidden="true" /><strong>{percentage(comparison.after)}</strong><Badge tone={comparison.targetObserved ? 'green' : 'gray'}>{comparison.delta === null ? '비교 가능한 답변 없음' : `${comparison.delta > 0 ? '+' : ''}${comparison.delta}%p`}</Badge></div><p className="d-caption">양쪽 모두 성공한 답변 {comparison.paired}/{comparison.total}개 / {comparison.targetObserved ? '목표 증가폭 도달. 변화의 원인은 별도 확인이 필요해요.' : '목표 증가폭은 아직 확인되지 않았어요.'}</p></> : <p className="d-muted">기준 수집의 답변 {experiment.baselineSnapshot.cells.length}개를 저장했어요. 이후의 수집 결과를 연결하면 비교할 수 있어요.</p>}
          <Button onClick={() => { setError(''); setSelected(experiment); }}>실험 내용과 결과 보기<ArrowRight size={16} /></Button>
        </article>;
      })}</div> : !resource.error && <Empty icon={<FlaskConical size={28} />} title={runs.length ? '아직 등록한 실험이 없어요' : '비교 기준으로 사용할 수집이 없어요'} text={runs.length ? '어떤 내용을 바꾸고 어떤 지표를 확인할지 기록해 보세요.' : '성공한 답변이 있는 수집이 끝나면 그 결과를 기준으로 실험을 만들 수 있어요.'} />}
    </Panel>
    {creating && <Modal title="개선 실험 만들기" subtitle="저장한 뒤에는 기준 수집, 질문, 모델, 브랜드 정보를 바꿀 수 없어요." onClose={() => setCreating(false)} wide><form className="d-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); void save('POST', { siteId: state.site.id, title: form.get('title'), hypothesis: form.get('hypothesis'), intervention: form.get('intervention'), metric: form.get('metric'), targetDelta: Number(form.get('targetDelta')), baselineRunId: form.get('baselineRunId') }); }}>
      <Field label="실험 이름"><input name="title" required minLength={3} maxLength={200} placeholder="예: 비교 페이지의 제품 설명 보완" /></Field>
      <Field label="가설" hint="어떤 질문에서 어떤 변화를 기대하는지 적으세요."><textarea name="hypothesis" required minLength={5} maxLength={2000} rows={3} placeholder="제품 특징을 명확히 설명하면 구매 비교 질문의 브랜드 언급이 늘어날 것이다." /></Field>
      <Field label="변경할 내용" hint="수정할 페이지와 내용, 적용 시점을 적으세요. 페이지는 직접 수정해야 해요."><textarea name="intervention" required minLength={3} maxLength={2000} rows={3} /></Field>
      <Field label="기준 수집" hint="최근 40개 수집 중 성공한 답변이 있는 수집을 선택하세요."><select name="baselineRunId" required defaultValue={runs[0]?.id}>{runs.map(run => <option key={run.id} value={run.id}>{localDateTime(run.createdAt)} KST / {run.models.map(modelLabel).join(', ')} / 성공 {run.completed}, 실패 {run.failed}</option>)}</select></Field>
      <div className="d-form-row"><Field label="비교 지표" hint="무료 Gemini는 검색 인용을 제공하지 않아 언급률만 사용할 수 있어요."><select name="metric" defaultValue="mentionRate"><option value="mentionRate">브랜드 언급률</option><option value="citationRate">브랜드 인용률 (인용 제공 모델)</option></select></Field><Field label="목표 증가폭 (%p)" hint="예: 20%에서 30%로 증가하면 +10%p입니다."><input name="targetDelta" type="number" min={1} max={100} defaultValue={10} required /></Field></div>
      {error && <div role="alert" className="d-error">{error}</div>}<div className="d-form-actions"><Button onClick={() => setCreating(false)}>취소</Button><Button type="submit" variant="primary" busy={busy}>실험 저장</Button></div>
    </form></Modal>}
    {selected && <ExperimentDetail experiment={selected} runs={runs} busy={busy} error={error} onClose={() => setSelected(null)} onSave={values => save('PATCH', { siteId: state.site.id, id: selected.id, expectedUpdatedAt: selected.updatedAt, ...values })} />}
  </div>;
}

function ExperimentDetail({ experiment: item, runs, busy, error, onClose, onSave }: { experiment: ImprovementExperiment; runs: SiteState['runs']; busy: boolean; error: string; onClose: () => void; onSave: (values: Record<string, unknown>) => Promise<void> }) {
  const result = item.comparison;
  return <Modal title={item.title} subtitle="기준 수집과 이후 수집의 차이를 보여줘요. 이 차이만으로 개선 작업의 효과나 통계적 유의성을 판단할 수는 없어요." onClose={onClose} wide>
    <div className="d-form"><dl className="d-experiment-facts"><dt>가설</dt><dd>{item.hypothesis}</dd><dt>변경 계획</dt><dd>{item.intervention}</dd><dt>저장한 브랜드</dt><dd>{item.baselineSnapshot.brands.map(brand => `${brand.name} (${brand.domain})`).join(', ')}</dd><dt>측정 기준</dt><dd>{item.baselineSnapshot.version} / {item.baselineSnapshot.mode === 'demo' ? '샘플' : '실제 답변'} / {metricNames[item.metric]}</dd></dl>
    <details className="d-metric-definition"><summary>비교할 질문과 모델 조합 {item.baselineSnapshot.cells.length}개</summary><ul>{item.baselineSnapshot.cells.map((cell, index) => <li key={index}>{cell.question}<span className="d-muted"> — {modelLabel(cell.model)} / {cell.provider} / {cell.status === 'completed' ? '성공' : '실패'}</span></li>)}</ul></details>
    {result && <div className="d-stack"><div className="d-grid-3"><Panel title="기준 수집의 비율"><strong>{percentage(result.before)}</strong></Panel><Panel title="비교 수집의 비율"><strong>{percentage(result.after)}</strong></Panel><Panel title="양쪽 모두 성공한 답변"><strong>{result.paired}/{result.total}</strong></Panel></div><p>기준 수집에서 {result.baselineFailed}개, 비교 수집에서 {result.followupFailed}개가 실패했어요. 목표 증가폭은 +{item.targetDelta}%p예요. {result.targetObserved ? '비교한 답변에서는 목표에 도달했어요.' : '목표 증가폭은 아직 확인되지 않았어요.'}</p>{result.caveats.map(caveat => <p className="d-caption" key={caveat}>{caveat}</p>)}</div>}
    <form className="d-form" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void onSave({ status: data.get('status'), notes: data.get('notes'), ...(data.get('followupRunId') ? { followupRunId: data.get('followupRunId') } : {}) }); }}>
      <Field label="비교할 수집 연결" hint="기준 수집보다 나중에 수집한 결과를 선택하세요. 질문 문구, 모델, 제공자가 모두 같아야 저장할 수 있어요."><select name="followupRunId" defaultValue=""><option value="">{item.followupRunId ? '기존 비교 결과 유지' : '나중에 연결하기'}</option>{runs.filter(run => run.id !== item.baselineRunId).map(run => <option key={run.id} value={run.id}>{localDateTime(run.createdAt)} KST / {run.models.map(modelLabel).join(', ')} / 성공 {run.completed}, 실패 {run.failed}</option>)}</select></Field>
      <Field label="진행 상태"><select name="status" defaultValue={item.status}>{Object.entries(names).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="변경 내용과 검토 메모" hint="수정한 페이지와 날짜, 확인한 결과, 추가로 할 일을 적으세요."><textarea name="notes" rows={4} maxLength={4000} defaultValue={item.notes} /></Field>
      {error && <div className="d-error" role="alert">{error}</div>}<div className="d-form-actions"><Button onClick={onClose}>닫기</Button><Button type="submit" variant="primary" busy={busy}>기록 저장</Button></div>
    </form></div>
  </Modal>;
}

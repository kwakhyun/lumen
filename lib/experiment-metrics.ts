import type { Answer } from './product-types';
import { extractMentions } from './metrics';
import { ProductError } from './product-validation';
import { EXPERIMENT_METRIC_VERSION, type ExperimentComparison, type ExperimentMetric, type ExperimentSnapshot } from './experiment-types';

export const experimentCellKey = (cell: ExperimentSnapshot['cells'][number]) => JSON.stringify([cell.question, cell.model, cell.provider]);
export function snapshotAnswers(answers: Answer[], brands: ExperimentSnapshot['brands'], mode: 'live' | 'demo'): ExperimentSnapshot {
  if (!answers.length || answers.length > 60 || answers.some(a => a.mode !== mode || !['completed', 'failed'].includes(a.status))) {
    throw new ProductError(409, '완료된 수집을 선택해 주세요. 최대 60개 답변을 비교할 수 있습니다.', 'experiment_run_incomplete');
  }
  const cells = answers.map(answer => {
    const own = extractMentions(answer.text, answer.citations.filter(c => c.provenance === (mode === 'live' ? 'provider_annotation' : 'synthetic')), brands)[0];
    return { question: answer.promptText, model: answer.model, provider: answer.provider, status: answer.status as 'completed' | 'failed', mentioned: answer.status === 'completed' && own.mentioned, cited: answer.status === 'completed' && own.cited };
  }).sort((a, b) => experimentCellKey(a).localeCompare(experimentCellKey(b)));
  if (new Set(cells.map(experimentCellKey)).size !== cells.length) throw new ProductError(409, '같은 질문과 모델이 중복된 수집은 비교 기준으로 사용할 수 없어요.', 'experiment_duplicate_cohort');
  if (!cells.some(c => c.status === 'completed')) throw new ProductError(409, '성공한 답변이 하나 이상 필요합니다.', 'experiment_no_answers');
  return { version: EXPERIMENT_METRIC_VERSION, mode, brands: brands.map(({ name, domain }) => ({ name, domain })), cells, capturedAt: new Date().toISOString() };
}
export function citationMetricAvailable(snapshot: ExperimentSnapshot): boolean {
  return !snapshot.cells.some(cell => /gemini/i.test(cell.provider) && snapshot.mode === 'live');
}
export function compareExperiment(before: ExperimentSnapshot, after: ExperimentSnapshot, metric: ExperimentMetric, target: number): ExperimentComparison {
  if (before.version !== after.version || before.mode !== after.mode || JSON.stringify(before.brands) !== JSON.stringify(after.brands) || before.cells.length !== after.cells.length) throw new ProductError(409, '기준과 동일한 질문, 모델, 제공자, 측정 기준을 선택해 주세요.', 'experiment_cohort_mismatch');
  const later = new Map(after.cells.map(cell => [experimentCellKey(cell), cell]));
  if (later.size !== before.cells.length || before.cells.some(cell => !later.has(experimentCellKey(cell)))) throw new ProductError(409, '질문 문구, 모델 또는 제공자가 기준 수집과 달라 비교할 수 없어요.', 'experiment_cohort_mismatch');
  if (metric === 'citationRate' && (!citationMetricAvailable(before) || !citationMetricAvailable(after))) throw new ProductError(409, '검색 인용을 제공하지 않는 모델은 언급률로 비교해 주세요.', 'experiment_citation_unavailable');
  const pairs = before.cells.filter(cell => cell.status === 'completed' && later.get(experimentCellKey(cell))!.status === 'completed');
  const field = metric === 'mentionRate' ? 'mentioned' : 'cited';
  const rate = (n: number) => Math.round(n / pairs.length * 1000) / 10;
  const beforeCount = pairs.filter(cell => cell[field]).length;
  const afterCount = pairs.filter(cell => later.get(experimentCellKey(cell))![field]).length;
  const first = pairs.length ? rate(beforeCount) : null;
  const last = pairs.length ? rate(afterCount) : null;
  const delta = pairs.length ? Math.round((afterCount - beforeCount) / pairs.length * 1000) / 10 : null;
  const caveats = ['같은 질문과 모델로 수집한 두 결과를 비교합니다. 변화가 개선 작업 때문인지, 우연을 넘어 통계적으로 의미가 있는지는 이 비교만으로 알 수 없습니다.'];
  if (pairs.length < before.cells.length) caveats.push('두 수집에서 모두 성공한 답변만 비교하며, 같은 답변 수를 기준으로 비율을 계산합니다. 실패한 답변이 제외되어 결과가 편향될 수 있습니다.');
  if (pairs.length < 30) caveats.push('비교할 답변이 적습니다. 일부 답변의 변화가 서비스 전체 성과를 뜻하지는 않습니다.');
  // Classify against exact counts; display rounding must never turn a near miss into success.
  return { paired: pairs.length, total: before.cells.length, baselineFailed: before.cells.filter(c => c.status === 'failed').length, followupFailed: after.cells.filter(c => c.status === 'failed').length, before: first, after: last, delta, targetObserved: pairs.length > 0 && (afterCount - beforeCount) * 100 >= target * pairs.length, caveats };
}

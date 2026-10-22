import { z } from 'zod';
import { impactPlanSchema, impactSearchSchema } from './impact-validation';
import { IMPACT_CHECK_REQUEST_BYTES, type ImpactCheckPayload } from './impact-check-types';
import type { ImpactPlan, ImpactSearch } from './impact-types';
import { ProductError } from './product-validation';
const text = (max: number) => z.string().trim().min(1).max(max);
const instant = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)), '유효한 날짜와 시간대를 입력해 주세요.');
const publicUrl = impactPlanSchema.innerType().shape.queries.element.shape.pageUrl;
export const impactCheckObservationSchema = impactSearchSchema.innerType().omit({ phase: true }).extend({ baselineDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().superRefine((row, context) => {
  const { baselineDigest, ...observation } = row; void baselineDigest;
  const result = impactSearchSchema.safeParse({ ...observation, phase: 'after' });
  if (!result.success) for (const issue of result.error.issues) context.addIssue(issue);
});
export const impactCheckPayloadSchema = z.object({
  label: text(200), publishedAt: instant, deploymentRef: text(500), contentVersion: text(500), changes: z.string().trim().min(5).max(6000), changedUrls: z.array(publicUrl).min(1).max(10),
  context: impactPlanSchema.innerType().shape.context, indexingStatus: z.enum(['unconfirmed', 'confirmed']), indexingEvidence: z.string().trim().max(2000),
  observations: z.array(impactCheckObservationSchema).min(1).max(20),
}).strict().superRefine((payload, context) => {
  if (payload.indexingStatus === 'confirmed' && payload.indexingEvidence.length < 3) context.addIssue({ code: 'custom', path: ['indexingEvidence'], message: '검색 반영을 확인한 근거를 입력해 주세요. 입력한 근거는 사용자 보고이며 Lumen의 독립 검증은 아닙니다.' });
  const seen = new Set<string>();
  payload.observations.forEach((row, i) => {
    const key = `${row.queryId}:${row.repetition}`;
    if (seen.has(key)) context.addIssue({ code: 'custom', path: ['observations',i], message: '같은 질문과 회차는 한 점검에 한 번만 기록할 수 있어요.' });
    seen.add(key);
    if (Date.parse(row.observedAt) < Date.parse(payload.publishedAt)) context.addIssue({ code: 'custom', path: ['observations',i,'observedAt'], message: '관측 시각은 실제 배포 시각 이후여야 해요.' });
  });
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > IMPACT_CHECK_REQUEST_BYTES) context.addIssue({ code: 'custom', message: '점검 자료는 96 KiB 이내로 입력해 주세요.' });
});
export const impactCheckRequestSchema = z.object({ siteId: z.string().uuid(), studyId: z.string().uuid(), requestId: z.string().uuid(), payload: impactCheckPayloadSchema }).strict();
export type ImpactCheckBaseline = Pick<ImpactSearch, 'digest'|'phase'|'queryId'|'repetition'|'observedAt'|'voidedAt'>;
/** Retained checks may reference a subsequently excluded baseline, so backup validation can allow voided rows. */
export function assertImpactCheckMatchesBaselines(plan: Pick<ImpactPlan,'queries'|'repetitions'>, payload: ImpactCheckPayload, baselines: ImpactCheckBaseline[], timestamp = Date.now(), allowVoided = false) {
  const published = Date.parse(payload.publishedAt);
  if (!Number.isFinite(timestamp) || !Number.isFinite(published) || published > timestamp) throw new ProductError(400, '실제로 배포가 완료된 시각을 입력해 주세요.', 'impact_check_time');
  for (const row of payload.observations) {
    if (!plan.queries.some(query => query.id === row.queryId) || row.repetition > plan.repetitions) throw new ProductError(400, '검증 계획에 등록된 질문과 회차로 점검해 주세요.', 'impact_cohort_mismatch');
    const baseline = baselines.find(candidate => candidate.digest === row.baselineDigest && candidate.phase === 'before' && candidate.queryId === row.queryId && candidate.repetition === row.repetition && (allowVoided || !candidate.voidedAt));
    if (!baseline) throw new ProductError(409, '연결할 변경 전 기록이 없거나 제외되었습니다. 현재 기준 기록을 확인해 주세요.', 'impact_check_baseline_unavailable');
    const baselineAt = Date.parse(baseline.observedAt), observed = Date.parse(row.observedAt);
    if (![baselineAt,observed].every(Number.isFinite) || baselineAt >= published || published > observed || observed > timestamp) throw new ProductError(400, '기준 기록 다음에 배포하고 배포 이후에 관측한 실제 시각을 입력해 주세요. 미래의 관측은 저장할 수 없어요.', 'impact_check_time');
  }
}

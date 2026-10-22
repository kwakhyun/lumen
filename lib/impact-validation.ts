import { z } from 'zod';
import { ProductError } from './product-validation';
import type { ImpactPlan, ImpactSearchInput, ImpactOutcomeInput } from './impact-types';
const dayMs = 86_400_000;
const validInstant = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)), '유효한 시간대와 날짜를 입력해 주세요.');
const currency = z.enum(['KRW', 'USD', 'JPY', 'EUR']);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 날짜를 입력해 주세요.').refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, '유효한 날짜를 입력해 주세요.');
const publicUrl = z.string().trim().max(2000).url().refine(value => {
  try { const url = new URL(value), host = url.hostname.toLowerCase(); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && host.includes('.') && !host.endsWith('.local') && !host.endsWith('.localhost') && !/^\d+(\.\d+){3}$/.test(host) && !host.includes(':'); } catch { return false; }
}, '인증 정보가 없는 공개 http/https 주소를 입력해 주세요.');
const text = (max: number) => z.string().trim().min(1).max(max);
export const impactPlanSchema = z.object({
  title: text(200), hypothesis: text(2000), changeSummary: text(2000), changedAt: validInstant, contentVersion: text(500),
  beforeStart: date, beforeEnd: date, afterStart: date, afterEnd: date,
  context: z.object({ surface: text(100), model: text(100), language: text(50), country: text(50), device: text(100), personalization: text(500) }).strict(),
  queries: z.array(z.object({ id: z.string().uuid(), question: z.string().trim().min(5).max(1000), arm: z.enum(['treatment', 'control']), pageUrl: publicUrl }).strict()).min(2).max(20),
  repetitions: z.number().int().min(1).max(3), currency, outcomeDefinition: text(1000), attributionRule: text(1000),
}).strict().superRefine((plan, context) => {
  const a = Date.parse(plan.beforeStart), b = Date.parse(plan.beforeEnd), c = Date.parse(plan.afterStart), d = Date.parse(plan.afterEnd), changed = Date.parse(plan.changedAt);
  if (![a,b,c,d,changed].every(Number.isFinite) || b < a || d < c || b - a !== d - c || b >= c || b - a >= 90 * dayMs || changed < b + dayMs || changed > c) context.addIssue({ code: 'custom', message: '전후 기간은 각각 1~90일로 길이가 같고 겹치지 않아야 해요. 변경 시각은 이전 기간 종료 다음 날부터 이후 기간 시작 사이로 지정해 주세요.' });
  const ids = new Set(plan.queries.map(query => query.id)), questions = new Set(plan.queries.map(query => query.question.toLocaleLowerCase()));
  if (ids.size !== plan.queries.length || questions.size !== plan.queries.length) context.addIssue({ code: 'custom', message: '질문 ID와 질문 내용은 중복될 수 없어요.' });
  if (!plan.queries.some(query => query.arm === 'treatment') || !plan.queries.some(query => query.arm === 'control')) context.addIssue({ code: 'custom', message: '개선 대상과 비교 대상에 질문을 하나 이상 등록해 주세요.' });
  const pages = new Map<string, string>();
  for (const query of plan.queries) { let url: URL; try { url = new URL(query.pageUrl); } catch { continue; } const key = `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`; if (pages.has(key) && pages.get(key) !== query.arm) context.addIssue({ code: 'custom', message: '같은 페이지를 개선 대상과 비교 대상에 동시에 배정할 수 없어요.' }); pages.set(key, query.arm); }
});
export const impactSearchSchema = z.object({
  phase: z.enum(['before', 'after']), queryId: z.string().uuid(), repetition: z.number().int().min(1).max(3), observedAt: validInstant,
  result: z.enum(['answer', 'no_ai_answer', 'error']), searchConfirmed: z.boolean(), answerExcerpt: z.string().trim().max(12000), brandMention: z.enum(['present', 'absent', 'uncertain']), citationReview: z.enum(['complete', 'not_reviewed']), evidenceUrl: z.union([z.literal(''), publicUrl]),
  citations: z.array(z.object({ url: publicUrl, title: z.string().trim().max(300), relation: z.enum(['original_citation', 'followup_search']) }).strict()).max(30), notes: z.string().trim().max(3000),
}).strict().superRefine((row, context) => {
  if (row.result === 'answer' && row.answerExcerpt.length === 0) context.addIssue({ code: 'custom', message: 'AI 답변의 발췌문을 입력해 주세요.' });
  if (row.result !== 'answer' && (row.answerExcerpt || row.brandMention !== 'uncertain' || row.citationReview !== 'not_reviewed' || row.citations.length)) context.addIssue({ code: 'custom', message: '답변이 없거나 오류가 난 경우 답변과 인용을 기록할 수 없어요. 언급 여부는 미확인으로 남겨 주세요.' });
  if (row.citations.some(citation => citation.relation === 'original_citation') && !row.searchConfirmed) context.addIssue({ code: 'custom', message: '원본 인용을 기록하려면 검색 사용 여부를 먼저 확인해 주세요.' });
});
const count = z.number().int().min(0).max(1_000_000_000).nullable();
export const impactOutcomeSchema = z.object({
  arm: z.enum(['treatment', 'control']), phase: z.enum(['before', 'after']), source: z.enum(['ga4_export', 'store_export', 'manual']), sourceId: text(300), sourceRef: text(1000), reportTimeZone: z.literal('UTC'), definitionConfirmed: z.literal(true), rangeStart: date, rangeEnd: date,
  sessions: count, convertingSessions: count, orders: count, revenueMinor: z.number().int().min(0).max(1_000_000_000_000).nullable(), currency, notes: z.string().trim().max(3000), confounders: z.string().trim().max(3000),
}).strict().superRefine((row, context) => {
  if (row.convertingSessions !== null && (row.sessions === null || row.convertingSessions > row.sessions)) context.addIssue({ code: 'custom', message: '전환 세션은 전체 세션보다 많을 수 없으며 전체 세션도 함께 입력해야 해요.' });
  if ([row.sessions, row.convertingSessions, row.orders, row.revenueMinor].every(value => value === null)) context.addIssue({ code: 'custom', message: '측정한 값을 하나 이상 입력해 주세요. 미측정 값은 비워 두세요.' });
  if (row.sessions === 0 && row.revenueMinor !== null && row.revenueMinor > 0) context.addIssue({ code: 'custom', message: '세션이 0인데 매출이 있다면 집계 범위와 출처를 다시 확인해 주세요.' });
});
export const impactPostSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_study'), siteId: z.string().uuid(), requestId: z.string().uuid(), plan: impactPlanSchema }).strict(),
  z.object({ action: z.literal('add_search'), siteId: z.string().uuid(), studyId: z.string().uuid(), requestId: z.string().uuid(), observation: impactSearchSchema }).strict(),
  z.object({ action: z.literal('add_outcome'), siteId: z.string().uuid(), studyId: z.string().uuid(), requestId: z.string().uuid(), outcome: impactOutcomeSchema }).strict(),
]);
export const impactVoidSchema = z.object({ action: z.enum(['void_search', 'void_outcome']), siteId: z.string().uuid(), studyId: z.string().uuid(), id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }).strict();
export function assertSearchMatchesPlan(plan: ImpactPlan, row: ImpactSearchInput, timestamp = Date.now()) {
  const start = Date.parse(row.phase === 'before' ? plan.beforeStart : plan.afterStart), end = Date.parse(row.phase === 'before' ? plan.beforeEnd : plan.afterEnd) + dayMs, observed = Date.parse(row.observedAt);
  if (!plan.queries.some(query => query.id === row.queryId) || row.repetition > plan.repetitions) throw new ProductError(400, '계획에 등록된 질문과 관측 회차를 선택해 주세요.', 'impact_cohort_mismatch');
  if (![start,end,observed,timestamp].every(Number.isFinite) || observed < start || observed >= end || observed > timestamp) throw new ProductError(400, '관측 시각은 선택한 전후 기간 안에 있어야 하며 미래일 수 없어요.', 'impact_observation_time');
}
export function assertOutcomeMatchesPlan(plan: ImpactPlan, row: ImpactOutcomeInput, timestamp = Date.now()) {
  if (row.rangeStart !== (row.phase === 'before' ? plan.beforeStart : plan.afterStart) || row.rangeEnd !== (row.phase === 'before' ? plan.beforeEnd : plan.afterEnd)) throw new ProductError(400, '성과 집계 기간은 계획의 전후 기간과 정확히 같아야 해요.', 'impact_outcome_window');
  if (row.currency !== plan.currency) throw new ProductError(400, '계획에서 정한 통화로 입력해 주세요.', 'impact_currency');
  if (!Number.isFinite(Date.parse(row.rangeEnd)) || !Number.isFinite(timestamp) || Date.parse(row.rangeEnd) + dayMs > timestamp) throw new ProductError(400, '집계 기간이 모두 끝난 뒤 성과를 기록해 주세요.', 'impact_outcome_time');
}

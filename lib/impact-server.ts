import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { impactOutcomes, impactSearches, impactStudies } from '@/db/impact-schema';
import { now, ownedSite } from './product-server';
import { ProductError } from './product-validation';
import { compareImpact } from './impact-metrics';
import { assertOutcomeMatchesPlan, assertSearchMatchesPlan, impactPostSchema, impactVoidSchema } from './impact-validation';
import { IMPACT_METRIC_VERSION, type ImpactDetail, type ImpactOutcome, type ImpactSearch, type ImpactStudy } from './impact-types';
import { impactDigest } from './impact-integrity';
import { listImpactBaselines } from './impact-baseline-server';
import { listImpactChecks } from './impact-check-server';
const storage = {
  impact_studies: { columns: ['id','site_id','plan','brand','metric_version','created_at','digest'], bytes: 512 * 1024, reserve: 0 },
  impact_searches: { columns: ['id','site_id','study_id','phase','query_id','repetition','payload','created_at','digest','voided_at','void_reason'], bytes: 3 * 1024 * 1024, reserve: 6048 },
  impact_outcomes: { columns: ['id','site_id','study_id','arm','phase','payload','created_at','digest','voided_at','void_reason'], bytes: 1024 * 1024, reserve: 6048 },
} as const;
/** Match backup-server's conservative JSON wire-size estimate, reserving exclusion metadata before insert. */
function withinByteBudget(name: keyof typeof storage, siteId: string, row: Record<string, string | number | null>) {
  const spec = storage[name], overhead = spec.columns.reduce((sum, column) => sum + JSON.stringify(column).length + 2, 2);
  const estimate = new TextEncoder().encode(JSON.stringify(spec.columns.map(column => row[column]))).byteLength + overhead + spec.reserve;
  const existingReserve = spec.reserve ? sql`CASE WHEN voided_at IS NULL THEN ${spec.reserve} ELSE 0 END` : sql`0`;
  // Only static allowlisted table/column identifiers enter SQL text; all data values remain bound.
  return sql`((SELECT coalesce(sum(length(CAST(json_array(${sql.raw(spec.columns.join(','))}) AS BLOB)) + ${overhead} + ${existingReserve}), 0) FROM ${sql.raw(name)} WHERE site_id=${siteId}) + ${estimate} <= ${spec.bytes})`;
}
function publicStudy(row: typeof impactStudies.$inferSelect): ImpactStudy { const plan = JSON.parse(row.plan); return { ...row, metricVersion: IMPACT_METRIC_VERSION, plan, brand: JSON.parse(row.brand), registration: Date.parse(row.createdAt) < Date.parse(plan.beforeStart) ? 'prospective' : 'retrospective' }; }
function publicSearch(row: typeof impactSearches.$inferSelect): ImpactSearch { const { payload, ...audit } = row; return { ...JSON.parse(payload), ...audit }; }
function publicOutcome(row: typeof impactOutcomes.$inferSelect): ImpactOutcome { const { payload, ...audit } = row; return { ...JSON.parse(payload), ...audit }; }
async function readStudy(siteId: string, studyId: string) { const [row] = await getDb().select().from(impactStudies).where(and(eq(impactStudies.siteId, siteId), eq(impactStudies.id, studyId))).limit(1); if (!row) throw new ProductError(404, '검증 계획을 찾을 수 없어요.', 'not_found'); return publicStudy(row); }
async function detail(siteId: string, studyId: string): Promise<ImpactDetail> { const study = await readStudy(siteId, studyId), db = getDb(); const [searchRows, outcomeRows] = await Promise.all([db.select().from(impactSearches).where(and(eq(impactSearches.siteId, siteId), eq(impactSearches.studyId, studyId))).orderBy(desc(impactSearches.createdAt)).limit(5000), db.select().from(impactOutcomes).where(and(eq(impactOutcomes.siteId, siteId), eq(impactOutcomes.studyId, studyId))).orderBy(desc(impactOutcomes.createdAt)).limit(1000)]); const searches = searchRows.map(publicSearch), outcomes = outcomeRows.map(publicOutcome); return { study, searches, outcomes, baselines: await listImpactBaselines(siteId, studyId), checks: await listImpactChecks(siteId, studyId), comparison: compareImpact(study, searches, outcomes) }; }
export async function getImpact(ownerId: string, siteId: string, studyId?: string) { await ownedSite(siteId, ownerId); if (studyId) return detail(siteId, studyId); const rows = await getDb().select().from(impactStudies).where(eq(impactStudies.siteId, siteId)).orderBy(desc(impactStudies.createdAt)).limit(50); return { studies: rows.map(publicStudy), metricVersion: IMPACT_METRIC_VERSION }; }
export async function createImpact(ownerId: string, raw: z.infer<typeof impactPostSchema>): Promise<ImpactDetail> {
  const input = impactPostSchema.parse(raw), site = await ownedSite(input.siteId, ownerId), db = getDb(), date = now();
  if (site.mode !== 'live') throw new ProductError(409, '실제 브랜드 워크스페이스에서 검증 계획을 등록해 주세요.', 'impact_live_required');
  if (input.action === 'create_study') {
    const [previous] = await db.select().from(impactStudies).where(eq(impactStudies.id, input.requestId)).limit(1);
    if (previous) { if (previous.siteId !== site.id || previous.plan !== JSON.stringify(input.plan)) throw new ProductError(409, '이미 사용한 요청 ID입니다. 새 요청으로 다시 시도해 주세요.', 'impact_request_conflict'); return detail(site.id, previous.id); }
    const brand = { name: site.name, domain: site.domain }, digest = await impactDigest({ metricVersion: IMPACT_METRIC_VERSION, plan: input.plan, brand });
    const budget = withinByteBudget('impact_studies', site.id, { id: input.requestId, site_id: site.id, plan: JSON.stringify(input.plan), brand: JSON.stringify(brand), metric_version: IMPACT_METRIC_VERSION, created_at: date, digest });
    await db.run(sql`INSERT OR IGNORE INTO impact_studies (id,site_id,plan,brand,metric_version,created_at,digest) SELECT ${input.requestId},${site.id},${JSON.stringify(input.plan)},${JSON.stringify(brand)},${IMPACT_METRIC_VERSION},${date},${digest} WHERE (SELECT count(*) FROM impact_studies WHERE site_id=${site.id}) < 50 AND ${budget}`);
    const [saved] = await db.select().from(impactStudies).where(eq(impactStudies.id, input.requestId)).limit(1);
    if (!saved) throw new ProductError(409, '검증 계획 저장 한도에 도달했어요. 워크스페이스당 최대 50개, 백업용 크기 512 KiB까지 저장할 수 있어요.', 'impact_limit');
    if (saved.siteId !== site.id || saved.plan !== JSON.stringify(input.plan)) throw new ProductError(409, '요청 ID가 충돌했어요. 새 요청으로 다시 시도해 주세요.', 'impact_request_conflict');
    return detail(site.id, saved.id);
  }
  const study = await readStudy(site.id, input.studyId), payload = input.action === 'add_search' ? input.observation : input.outcome, payloadJson = JSON.stringify(payload), digest = await impactDigest({ studyDigest: study.digest, kind: input.action, payload });
  if (input.action === 'add_search') {
    assertSearchMatchesPlan(study.plan, input.observation);
    const budget = withinByteBudget('impact_searches', site.id, { id: input.requestId, site_id: site.id, study_id: study.id, phase: input.observation.phase, query_id: input.observation.queryId, repetition: input.observation.repetition, payload: payloadJson, created_at: date, digest, voided_at: null, void_reason: null });
    await db.run(sql`INSERT OR IGNORE INTO impact_searches (id,site_id,study_id,phase,query_id,repetition,payload,created_at,digest) SELECT ${input.requestId},${site.id},${study.id},${input.observation.phase},${input.observation.queryId},${input.observation.repetition},${payloadJson},${date},${digest} WHERE (SELECT count(*) FROM impact_searches WHERE site_id=${site.id}) < 5000 AND ${budget}`);
    const [saved] = await db.select().from(impactSearches).where(eq(impactSearches.id, input.requestId)).limit(1);
    if (!saved) throw new ProductError(409, '같은 질문, 기간, 회차의 관측이 이미 있거나 저장 한도에 도달했어요. 검색 기록은 최대 5,000개, 제외 사유 보존 공간을 포함해 3 MiB까지 저장할 수 있어요. 기존 기록을 확인해 주세요.', 'impact_duplicate_or_limit');
    if (saved.siteId !== site.id || saved.studyId !== study.id || saved.payload !== payloadJson) throw new ProductError(409, '이미 사용한 요청 ID입니다.', 'impact_request_conflict');
  } else {
    assertOutcomeMatchesPlan(study.plan, input.outcome);
    const budget = withinByteBudget('impact_outcomes', site.id, { id: input.requestId, site_id: site.id, study_id: study.id, arm: input.outcome.arm, phase: input.outcome.phase, payload: payloadJson, created_at: date, digest, voided_at: null, void_reason: null });
    await db.run(sql`INSERT OR IGNORE INTO impact_outcomes (id,site_id,study_id,arm,phase,payload,created_at,digest) SELECT ${input.requestId},${site.id},${study.id},${input.outcome.arm},${input.outcome.phase},${payloadJson},${date},${digest} WHERE (SELECT count(*) FROM impact_outcomes WHERE site_id=${site.id}) < 1000 AND ${budget}`);
    const [saved] = await db.select().from(impactOutcomes).where(eq(impactOutcomes.id, input.requestId)).limit(1);
    if (!saved) throw new ProductError(409, '같은 대상과 기간의 성과가 이미 있거나 저장 한도에 도달했어요. 성과 기록은 최대 1,000개, 제외 사유 보존 공간을 포함해 1 MiB까지 저장할 수 있어요. 기존 기록을 확인해 주세요.', 'impact_duplicate_or_limit');
    if (saved.siteId !== site.id || saved.studyId !== study.id || saved.payload !== payloadJson) throw new ProductError(409, '이미 사용한 요청 ID입니다.', 'impact_request_conflict');
  }
  return detail(site.id, study.id);
}
export async function voidImpact(ownerId: string, raw: z.infer<typeof impactVoidSchema>): Promise<ImpactDetail> {
  const input = impactVoidSchema.parse(raw); await ownedSite(input.siteId, ownerId); await readStudy(input.siteId, input.studyId); const db = getDb(), table = input.action === 'void_search' ? impactSearches : impactOutcomes;
  const [row] = await db.select().from(table).where(and(eq(table.id, input.id), eq(table.siteId, input.siteId), eq(table.studyId, input.studyId))).limit(1);
  if (!row) throw new ProductError(404, '관측 기록을 찾을 수 없어요.', 'not_found');
  if (row.voidedAt && row.voidReason !== input.reason) throw new ProductError(409, '이미 제외한 기록의 사유는 변경할 수 없어요.', 'impact_immutable');
  if (!row.voidedAt) await db.update(table).set({ voidedAt: now(), voidReason: input.reason }).where(and(eq(table.id, row.id), eq(table.siteId, input.siteId), isNull(table.voidedAt)));
  const [saved] = await db.select().from(table).where(eq(table.id, row.id)).limit(1);
  if (saved.voidReason !== input.reason) throw new ProductError(409, '다른 요청이 먼저 이 기록을 제외했어요. 새로고침해 주세요.', 'impact_conflict');
  return detail(input.siteId, input.studyId);
}

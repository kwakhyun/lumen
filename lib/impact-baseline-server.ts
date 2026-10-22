import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { impactBaselines } from '@/db/impact-baseline-schema';
import { impactStudies } from '@/db/impact-schema';
import { ownedSite, quota } from './product-server';
import { ProductError } from './product-validation';
import { ga4BaselineDateRange, GA4_BASELINE_SOURCE_PATTERN, ga4Status, readGa4Baseline } from './ga4';
import { impactDigest } from './impact-integrity';
import { impactBaselineQueryKey } from './impact-baseline-integrity';
import { impactBaselinePayloadSchema, impactBaselineRequestSchema } from './impact-baseline-validation';
import { type ImpactBaseline, type ImpactBaselinePayload } from './impact-baseline-types';
import type { ImpactPlan } from './impact-types';
const bytes = 512 * 1024, columns = ['id','site_id','study_id','query_key','payload','created_at','digest'], overhead = columns.reduce((sum, column) => sum + JSON.stringify(column).length + 2, 2);
const publicRow = (row: typeof impactBaselines.$inferSelect): ImpactBaseline => ({ ...row, payload: impactBaselinePayloadSchema.parse(JSON.parse(row.payload)) });
export async function listImpactBaselines(siteId: string, studyId: string): Promise<ImpactBaseline[]> { return (await getDb().select().from(impactBaselines).where(and(eq(impactBaselines.siteId, siteId), eq(impactBaselines.studyId, studyId))).orderBy(desc(impactBaselines.createdAt)).limit(100)).map(publicRow); }
async function studyFor(ownerId: string, siteId: string, studyId: string) {
  const site = await ownedSite(siteId, ownerId), [study] = await getDb().select().from(impactStudies).where(and(eq(impactStudies.id, studyId), eq(impactStudies.siteId, siteId))).limit(1);
  if (!study) throw new ProductError(404, '검증 계획을 찾을 수 없어요.', 'not_found');
  return { site, study, plan: JSON.parse(study.plan) as ImpactPlan };
}
export async function getImpactBaselines(ownerId: string, siteId: string, studyId: string) { await studyFor(ownerId, siteId, studyId); return { baselines: await listImpactBaselines(siteId, studyId) }; }
export function baselineQueryKey(payload: Pick<ImpactBaselinePayload, 'propertyId'|'hostName'|'requestedStartDate'|'requestedEndDate'|'startDate'|'endDate'|'timeZone'>) { return impactBaselineQueryKey({ ...payload, sourcePattern: GA4_BASELINE_SOURCE_PATTERN }); }
export async function createImpactBaseline(ownerId: string, raw: unknown) {
  const input = impactBaselineRequestSchema.parse(raw), { site, study, plan } = await studyFor(ownerId, input.siteId, input.studyId), db = getDb();
  if (site.mode !== 'live') throw new ProductError(409, '실제 브랜드 워크스페이스에서 GA4 자료를 가져와 주세요.', 'impact_live_required');
  const [previous] = await db.select().from(impactBaselines).where(eq(impactBaselines.id, input.requestId)).limit(1);
  if (previous) { if (previous.siteId !== site.id || previous.studyId !== study.id) throw new ProductError(409, '이미 사용한 요청 ID입니다.', 'impact_request_conflict'); return { baselines: await listImpactBaselines(site.id, study.id), cached: true }; }
  const status = await ga4Status(ownerId, site.id);
  if (!status.connected || !status.propertyId) throw new ProductError(409, '연결 설정에서 GA4 속성을 연결하고 선택해 주세요.', 'ga4_property_required');
  const history = await listImpactBaselines(site.id, study.id);
  for (const candidate of history) {
    const p = candidate.payload;
    if (Date.now() - Date.parse(candidate.createdAt) >= 86400000 || Date.parse(candidate.createdAt) > Date.now() || p.propertyId !== status.propertyId || p.hostName !== site.domain.toLowerCase() || p.requestedStartDate !== plan.beforeStart || p.requestedEndDate !== plan.beforeEnd) continue;
    const range = ga4BaselineDateRange(p.timeZone, plan.beforeStart, plan.beforeEnd);
    if (range.endDate === p.endDate && candidate.queryKey === await baselineQueryKey({ propertyId:p.propertyId,hostName:p.hostName,requestedStartDate:p.requestedStartDate,requestedEndDate:p.requestedEndDate,...range })) return { baselines: history, cached: true };
  }
  const budget = await db.get<{ count: number; bytes: number }>(sql`SELECT count(*) AS count, coalesce(sum(length(CAST(json_array(id,site_id,study_id,query_key,payload,created_at,digest) AS BLOB)) + ${overhead}),0) AS bytes FROM impact_baselines WHERE site_id=${site.id}`);
  if (!budget || budget.count >= 100 || budget.bytes >= bytes - 12000) throw new ProductError(409, 'GA4 기준 자료의 저장 한도에 도달했어요. 브랜드당 최대 100개, 512 KiB입니다.', 'impact_baseline_limit');
  await quota(ownerId, 'impact-ga4-baseline', 4); await quota('service', 'impact-ga4-baseline-global', 40);
  return readGa4Baseline(ownerId, site.id, plan.beforeStart, plan.beforeEnd, async (rawPayload, guard) => {
    const payload = impactBaselinePayloadSchema.parse(rawPayload), queryKey = await baselineQueryKey({ propertyId:payload.propertyId,hostName:payload.hostName,requestedStartDate:payload.requestedStartDate,requestedEndDate:payload.requestedEndDate,startDate:payload.startDate,endDate:payload.endDate,timeZone:payload.timeZone }), payloadJson = JSON.stringify(payload), createdAt = new Date().toISOString(), digest = await impactDigest({ studyDigest: study.digest, kind: 'ga4_baseline', queryKey, payload });
    const estimate = new TextEncoder().encode(JSON.stringify([input.requestId,site.id,study.id,queryKey,payloadJson,createdAt,digest])).length + overhead;
    await db.run(sql`INSERT OR IGNORE INTO impact_baselines(id,site_id,study_id,query_key,payload,created_at,digest) SELECT ${input.requestId},${site.id},${study.id},${queryKey},${payloadJson},${createdAt},${digest} WHERE EXISTS (SELECT 1 FROM ga4_connections WHERE site_id=${site.id} AND owner_id=${ownerId} AND property_id=${guard.propertyId} AND status='connected' AND lease_token=${guard.lease} AND lease_until>${Date.now()} AND revision=${guard.revision}) AND (SELECT count(*) FROM impact_baselines WHERE site_id=${site.id}) < 100 AND (SELECT coalesce(sum(length(CAST(json_array(id,site_id,study_id,query_key,payload,created_at,digest) AS BLOB)) + ${overhead}),0) FROM impact_baselines WHERE site_id=${site.id}) + ${estimate} <= ${bytes}`);
    const [saved] = await db.select().from(impactBaselines).where(eq(impactBaselines.id, input.requestId)).limit(1);
    if (!saved) {
      const connection = await db.get(sql`SELECT site_id FROM ga4_connections WHERE site_id=${site.id} AND owner_id=${ownerId} AND property_id=${guard.propertyId} AND status='connected' AND lease_token=${guard.lease} AND lease_until>${Date.now()} AND revision=${guard.revision}`);
      if (!connection) throw new ProductError(409, '조회 중 GA4 연결이 변경되어 새 자료를 저장하지 않았어요.', 'integration_changed');
      throw new ProductError(409, 'GA4 기준 자료의 저장 한도에 도달했어요.', 'impact_baseline_limit');
    }
    if (saved.siteId !== site.id || saved.studyId !== study.id || saved.queryKey !== queryKey || saved.payload !== payloadJson) throw new ProductError(409, '이미 사용한 요청 ID입니다.', 'impact_request_conflict');
    return { baselines: await listImpactBaselines(site.id, study.id), cached: false };
  });
}

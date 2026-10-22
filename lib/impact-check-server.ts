import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { impactChecks } from '@/db/impact-check-schema';
import { impactSearches, impactStudies } from '@/db/impact-schema';
import { ownedSite } from './product-server';
import { ProductError } from './product-validation';
import { impactCheckDigest } from './impact-check-integrity';
import { assertImpactCheckMatchesBaselines, impactCheckPayloadSchema, impactCheckRequestSchema } from './impact-check-validation';
import type { ImpactCheck, ImpactChecksResponse } from './impact-check-types';
import type { ImpactPlan, ImpactSearch } from './impact-types';
const byteLimit = 1024 * 1024, columns = ['id','site_id','study_id','payload','created_at','digest'], overhead = columns.reduce((sum, column) => sum + JSON.stringify(column).length + 2, 2);
const publicRow = (row: typeof impactChecks.$inferSelect): ImpactCheck => ({ ...row, payload: impactCheckPayloadSchema.parse(JSON.parse(row.payload)) });
export async function listImpactChecks(siteId: string, studyId: string): Promise<ImpactCheck[]> { return (await getDb().select().from(impactChecks).where(and(eq(impactChecks.siteId,siteId),eq(impactChecks.studyId,studyId))).orderBy(desc(impactChecks.createdAt)).limit(20)).map(publicRow); }
async function studyFor(ownerId: string, siteId: string, studyId: string) {
  const site = await ownedSite(siteId,ownerId), [study] = await getDb().select().from(impactStudies).where(and(eq(impactStudies.siteId,siteId),eq(impactStudies.id,studyId))).limit(1);
  if (!study) throw new ProductError(404,'검증 계획을 찾을 수 없어요.','not_found');
  return { site, study, plan: JSON.parse(study.plan) as ImpactPlan };
}
export async function getImpactChecks(ownerId: string, siteId: string, studyId: string): Promise<ImpactChecksResponse> { await studyFor(ownerId,siteId,studyId); return { checks: await listImpactChecks(siteId,studyId) }; }
export async function createImpactCheck(ownerId: string, raw: unknown): Promise<ImpactChecksResponse> {
  const input = impactCheckRequestSchema.parse(raw), { site,study,plan } = await studyFor(ownerId,input.siteId,input.studyId), db = getDb(), payloadJson = JSON.stringify(input.payload);
  if (site.mode !== 'live') throw new ProductError(409,'실제 브랜드 워크스페이스에서 배포 후 점검을 기록해 주세요.','impact_live_required');
  const [prior] = await db.select().from(impactChecks).where(eq(impactChecks.id,input.requestId)).limit(1);
  if (prior) { if (prior.siteId !== site.id || prior.studyId !== study.id || prior.payload !== payloadJson) throw new ProductError(409,'이미 사용한 요청 ID입니다.','impact_request_conflict'); return { checks: await listImpactChecks(site.id,study.id), cached: true }; }
  const rows = await db.select().from(impactSearches).where(and(eq(impactSearches.siteId,site.id),eq(impactSearches.studyId,study.id),eq(impactSearches.phase,'before'))).limit(5000);
  const baselines = rows.map(row => ({ ...JSON.parse(row.payload), ...row })) as ImpactSearch[];
  const createdAt = new Date().toISOString();
  assertImpactCheckMatchesBaselines(plan,input.payload,baselines,Date.parse(createdAt));
  const digest = await impactCheckDigest(study.digest,input.payload), estimate = new TextEncoder().encode(JSON.stringify([input.requestId,site.id,study.id,payloadJson,createdAt,digest])).byteLength + overhead;
  // Recheck active references inside the insert so a simultaneous exclusion cannot attach a new check.
  const references = input.payload.observations.map(row => sql`EXISTS (SELECT 1 FROM impact_searches WHERE site_id=${site.id} AND study_id=${study.id} AND phase='before' AND digest=${row.baselineDigest} AND query_id=${row.queryId} AND repetition=${row.repetition} AND voided_at IS NULL)`);
  await db.run(sql`INSERT OR IGNORE INTO impact_checks(id,site_id,study_id,payload,created_at,digest) SELECT ${input.requestId},${site.id},${study.id},${payloadJson},${createdAt},${digest} WHERE ${sql.join(references,sql` AND `)} AND (SELECT count(*) FROM impact_checks WHERE site_id=${site.id}) < 20 AND (SELECT coalesce(sum(length(CAST(json_array(id,site_id,study_id,payload,created_at,digest) AS BLOB)) + ${overhead}),0) FROM impact_checks WHERE site_id=${site.id}) + ${estimate} <= ${byteLimit}`);
  const [saved] = await db.select().from(impactChecks).where(eq(impactChecks.id,input.requestId)).limit(1);
  if (!saved) throw new ProductError(409,'기준 기록이 제외되었거나 저장 한도에 도달했어요. 배포 후 점검은 브랜드당 최대 20개, 1 MiB까지 저장합니다.','impact_check_reference_or_limit');
  if (saved.siteId !== site.id || saved.studyId !== study.id || saved.payload !== payloadJson) throw new ProductError(409,'이미 사용한 요청 ID입니다.','impact_request_conflict');
  return { checks: await listImpactChecks(site.id,study.id), cached: false };
}

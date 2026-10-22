import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { tasks } from '@/db/schema';
import { securityChecks } from '@/db/security-schema';
import { now, ownedSite, quota } from './product-server';
import { ProductError } from './product-validation';
import { assessSecurityEvidence } from './security-assessment';
import { securityEvidenceDigest, securityTaskId } from './security-integrity';
import { assertSecurityEvidenceTime, securityOriginMatchesDomain, securityEvidenceSchema, securityPostSchema } from './security-validation';
import type { SecurityCheck, SecurityChecksResponse } from './security-types';

const columns = ['id','site_id','evidence','digest','created_at'] as const;
const overhead = columns.reduce((size, column) => size + JSON.stringify(column).length + 2, 2);
function publicCheck(row: typeof securityChecks.$inferSelect): SecurityCheck {
  const evidence = securityEvidenceSchema.parse(JSON.parse(row.evidence));
  return { id: row.id, siteId: row.siteId, evidence, digest: row.digest, createdAt: row.createdAt, findings: assessSecurityEvidence(evidence) };
}
async function listChecks(siteId: string): Promise<SecurityCheck[]> {
  const rows = await getDb().select().from(securityChecks).where(eq(securityChecks.siteId, siteId)).orderBy(desc(securityChecks.createdAt), desc(securityChecks.id)).limit(20);
  return rows.map(publicCheck);
}
export async function getSecurityChecks(ownerId: string, siteId: string): Promise<SecurityChecksResponse> {
  await ownedSite(siteId, ownerId);
  return { checks: await listChecks(siteId) };
}
export async function createSecurityCheck(ownerId: string, raw: z.infer<typeof securityPostSchema>): Promise<SecurityChecksResponse | { taskId: string; cached: boolean }> {
  const input = securityPostSchema.parse(raw), site = await ownedSite(input.siteId, ownerId), db = getDb();
  if (site.mode !== 'live') throw new ProductError(409, '실제 브랜드 워크스페이스에서 점검 결과를 등록해 주세요.', 'security_live_required');
  if (input.action === 'create_task') {
    const [check] = await db.select().from(securityChecks).where(and(eq(securityChecks.siteId, site.id), eq(securityChecks.id, input.checkId))).limit(1);
    if (!check) throw new ProductError(404, '점검 기록을 찾을 수 없어요.', 'not_found');
    const finding = publicCheck(check).findings.find(row => row.id === input.findingId);
    if (!finding || finding.state !== 'attention') throw new ProductError(400, '개선이 필요한 점검 항목을 선택해 주세요.', 'security_finding_not_actionable');
    const taskId = await securityTaskId(check.id, finding.id);
    const [previous] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (previous) {
      if (previous.siteId !== site.id) throw new ProductError(409, '작업 ID가 충돌했어요.', 'security_request_conflict');
      return { taskId, cached: true };
    }
    const date = now();
    const title = `[웹 기본 점검] ${finding.title}`.slice(0,200);
    const description = `${finding.detail}\n\n${finding.recommendation}\n\n근거: ${finding.referenceUrl}\n관측: ${JSON.parse(check.evidence).observedAt}\n점검 ID: ${check.id}\n항목: ${finding.id}\n가져온 관측에 기반한 개선 작업이며, 취약점 확정을 뜻하지 않습니다.`.slice(0,2000);
    const result = await db.run(sql`INSERT OR IGNORE INTO tasks (id,site_id,title,description,status,priority,created_at,updated_at) SELECT ${taskId},${site.id},${title},${description},'todo',${finding.priority},${date},${date} WHERE (SELECT count(*) FROM tasks WHERE site_id=${site.id}) < 100`);
    const [saved] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!saved) throw new ProductError(409, '워크스페이스의 작업이 100개에 도달했어요. 기존 작업을 정리한 뒤 다시 시도해 주세요.', 'security_task_limit');
    if (saved.siteId !== site.id) throw new ProductError(409, '작업 ID가 충돌했어요.', 'security_request_conflict');
    return { taskId, cached: result.meta.changes === 0 };
  }
  const date = now();
  if (!assertSecurityEvidenceTime(input.evidence, Date.parse(date))) throw new ProductError(400, '관측 시각은 현재 시각보다 이후일 수 없어요.', 'security_future_observation');
  if (!securityOriginMatchesDomain(input.evidence.targetOrigin, site.domain)) throw new ProductError(400, '등록한 브랜드 도메인과 점검 대상이 다릅니다. www와 하위 도메인까지 같은지 확인해 주세요.', 'security_domain_mismatch');
  const evidence = JSON.stringify(input.evidence), digest = await securityEvidenceDigest(input.evidence);
  const [previous] = await db.select().from(securityChecks).where(eq(securityChecks.id, input.requestId)).limit(1);
  if (previous) {
    if (previous.siteId !== site.id || previous.digest !== digest || previous.evidence !== evidence) throw new ProductError(409, '이미 다른 내용에 사용한 요청 ID입니다.', 'security_request_conflict');
    return { checks: await listChecks(site.id), cached: true };
  }
  await quota(ownerId, 'security-import', 30, 1, 60_000);
  const estimatedBytes = new TextEncoder().encode(JSON.stringify([input.requestId, site.id, evidence, digest, date])).byteLength + overhead;
  // Count and byte constraints share the INSERT statement, so concurrent requests cannot overfill the workspace.
  const result = await db.run(sql`INSERT OR IGNORE INTO security_checks (id,site_id,evidence,digest,created_at) SELECT ${input.requestId},${site.id},${evidence},${digest},${date} WHERE (SELECT count(*) FROM security_checks WHERE site_id=${site.id}) < 20 AND (SELECT coalesce(sum(length(CAST(json_array(id,site_id,evidence,digest,created_at) AS BLOB)) + ${overhead}),0) FROM security_checks WHERE site_id=${site.id}) + ${estimatedBytes} <= ${1024 * 1024}`);
  const [saved] = await db.select().from(securityChecks).where(eq(securityChecks.id, input.requestId)).limit(1);
  if (!saved) throw new ProductError(409, '점검 결과 저장 한도에 도달했어요. 워크스페이스당 20개, 최대 1 MiB까지 보관합니다.', 'security_storage_limit');
  if (saved.siteId !== site.id || saved.digest !== digest || saved.evidence !== evidence) throw new ProductError(409, '다른 요청이 먼저 이 ID를 사용했어요.', 'security_request_conflict');
  return { checks: await listChecks(site.id), cached: result.meta.changes === 0 };
}

import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { aiEligibility } from '@/db/eligibility-schema';
import { freeOnlyMode } from './provider-policy';
import { ProductError } from './product-validation';

export const ELIGIBILITY_VERSION = '2026-10-18';
export async function eligibilityStatus(ownerId: string) {
  const [row] = await getDb().select().from(aiEligibility).where(eq(aiEligibility.ownerId, ownerId)).limit(1);
  return { eligible: row?.version === ELIGIBILITY_VERSION, version: ELIGIBILITY_VERSION, acceptedAt: row?.acceptedAt || null };
}
export async function acceptEligibility(ownerId: string) {
  const acceptedAt = new Date().toISOString();
  await getDb().insert(aiEligibility).values({ ownerId, version: ELIGIBILITY_VERSION, acceptedAt }).onConflictDoUpdate({ target: aiEligibility.ownerId, set: { version: ELIGIBILITY_VERSION, acceptedAt } });
  return { eligible: true, version: ELIGIBILITY_VERSION, acceptedAt };
}
export async function requireAiEligibility(ownerId: string) {
  if (freeOnlyMode() && !(await eligibilityStatus(ownerId)).eligible) throw new ProductError(403, 'AI 이용 전 한국에서 이용하는 성인의 업무용 이용 조건과 무료 API 데이터 처리 안내를 확인해 주세요.', 'eligibility_required');
}

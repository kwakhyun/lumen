import type { SecurityEvidence } from './security-types';
import { impactDigest } from './impact-integrity';

/** A content checksum detects changes; it cannot prove site ownership or observation authenticity. */
export const securityEvidenceDigest = (evidence: SecurityEvidence) => impactDigest({ kind: 'public-security-evidence-v1', evidence });
export async function securityTaskId(checkId: string, findingId: string): Promise<string> {
  const digest = await impactDigest({ kind: 'public-security-task-v1', checkId, findingId });
  return `${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-${((parseInt(digest[16],16)&3)|8).toString(16)}${digest.slice(17,20)}-${digest.slice(20,32)}`;
}

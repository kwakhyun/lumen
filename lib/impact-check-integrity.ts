import { impactDigest } from './impact-integrity';
import type { ImpactCheckPayload } from './impact-check-types';
export function impactCheckDigest(studyDigest: string, payload: ImpactCheckPayload) { return impactDigest({ studyDigest, kind: 'deployment_check', payload }); }

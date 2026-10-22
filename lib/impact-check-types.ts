import type { ImpactPlan, ImpactSearchInput } from './impact-types';
export const IMPACT_CHECK_REQUEST_BYTES = 96 * 1024;
export type ImpactCheckObservation = Omit<ImpactSearchInput, 'phase'> & { baselineDigest: string };
/** A separate post-deployment spot check. It never changes the study's frozen before/after windows. */
export type ImpactCheckPayload = {
  label: string; publishedAt: string; deploymentRef: string; contentVersion: string; changes: string; changedUrls: string[];
  context: ImpactPlan['context']; indexingStatus: 'unconfirmed' | 'confirmed'; indexingEvidence: string;
  observations: ImpactCheckObservation[];
};
export type ImpactCheck = { id: string; siteId: string; studyId: string; payload: ImpactCheckPayload; createdAt: string; digest: string };
export type ImpactChecksResponse = { checks: ImpactCheck[]; cached?: boolean };
export type ImpactCheckRequest = { siteId: string; studyId: string; requestId: string; payload: ImpactCheckPayload };

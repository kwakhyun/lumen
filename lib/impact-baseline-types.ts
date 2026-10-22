export const GA4_BASELINE_METRIC_VERSION = 'ga4-baseline-v1' as const;
/** Read-only GA4 reference data; never substitutes for a treatment/control outcome. */
export type ImpactBaselinePayload = {
  source: 'ga4_api'; metricVersion: typeof GA4_BASELINE_METRIC_VERSION;
  propertyId: string; propertyName: string; fetchedAt: string;
  requestedStartDate: string; requestedEndDate: string; startDate: string; endDate: string; timeZone: string;
  hostName: string; totalSessions: number; aiSessions: number; totalViews: number;
  convertingSessions: null; orders: null; revenueMinor: null;
  sourcePattern: string; scope: 'tracked_site_sessions'; completeForPlan: false;
  dataQuality: { subjectToThresholding: boolean; dataLossFromOtherRow: boolean; sampled: boolean; truncated: boolean; emptyReasons: string[] };
  notes: string[];
};
export type ImpactBaseline = { id: string; siteId: string; studyId: string; queryKey: string; payload: ImpactBaselinePayload; createdAt: string; digest: string };
export type ImpactBaselineResponse = { baselines: ImpactBaseline[]; cached?: boolean };

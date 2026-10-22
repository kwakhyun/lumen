import { impactDigest } from './impact-integrity';
import { GA4_BASELINE_METRIC_VERSION, type ImpactBaselinePayload } from './impact-baseline-types';
export function impactBaselineQueryKey(payload: Pick<ImpactBaselinePayload, 'propertyId'|'hostName'|'requestedStartDate'|'requestedEndDate'|'startDate'|'endDate'|'timeZone'|'sourcePattern'>) {
  return impactDigest({ metricVersion: GA4_BASELINE_METRIC_VERSION, propertyId: payload.propertyId, hostName: payload.hostName, requestedStartDate: payload.requestedStartDate, requestedEndDate: payload.requestedEndDate, startDate: payload.startDate, endDate: payload.endDate, timeZone: payload.timeZone, sourcePattern: payload.sourcePattern });
}

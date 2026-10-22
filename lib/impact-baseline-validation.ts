import { z } from 'zod';
import { GA4_BASELINE_METRIC_VERSION } from './impact-baseline-types';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
const instant = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const count = z.number().int().min(0).max(1_000_000_000);
const zone = z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } });
export const impactBaselineRequestSchema = z.object({ siteId: z.string().uuid(), studyId: z.string().uuid(), requestId: z.string().uuid() }).strict();
export const impactBaselinePayloadSchema = z.object({
  source: z.literal('ga4_api'), metricVersion: z.literal(GA4_BASELINE_METRIC_VERSION), propertyId: z.string().regex(/^\d{1,20}$/), propertyName: z.string().max(200), fetchedAt: instant,
  requestedStartDate: date, requestedEndDate: date, startDate: date, endDate: date, timeZone: zone,
  hostName: z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/), totalSessions: count, aiSessions: count, totalViews: count,
  convertingSessions: z.null(), orders: z.null(), revenueMinor: z.null(), sourcePattern: z.string().min(1).max(1000), scope: z.literal('tracked_site_sessions'), completeForPlan: z.literal(false),
  dataQuality: z.object({ subjectToThresholding: z.boolean(), dataLossFromOtherRow: z.boolean(), sampled: z.boolean(), truncated: z.boolean(), emptyReasons: z.array(z.string().max(500)).max(2) }).strict(), notes: z.array(z.string().max(1000)).max(12),
}).strict().superRefine((row, context) => {
  if (row.startDate !== row.requestedStartDate || row.endDate > row.requestedEndDate || row.endDate < row.startDate || Date.parse(row.requestedEndDate) - Date.parse(row.requestedStartDate) >= 90 * 86400000 || row.aiSessions > row.totalSessions) context.addIssue({ code: 'custom', message: 'GA4 기준 자료의 기간이나 세션 수가 일치하지 않아요.' });
});

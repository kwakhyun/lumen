import { z } from 'zod';
import { SECURITY_BOTS, SECURITY_COLLECTOR } from './security-types';
import type { SecurityEvidence } from './security-types';

const observation = z.enum(['allowed', 'blocked', 'unknown']);
const requestFields = {
  status: z.number().int().min(100).max(599).nullable(),
  error: z.enum(['dns_blocked', 'dns_failed', 'tls_or_network', 'timeout', 'body_limit']).nullable(),
  bodyComplete: z.boolean(),
};
const count = z.number().int().nonnegative().max(10000);
export const securityOriginSchema = z.string().max(300).refine(value => {
  try {
    const url = new URL(value), host = url.hostname;
    return url.protocol === 'https:' && value === url.origin && !url.username && !url.password && !url.port &&
      host.includes('.') && !host.endsWith('.') && !host.endsWith('.local') && !host.endsWith('.localhost') &&
      !host.endsWith('.internal') && !/^\d+(\.\d+){3}$/.test(host) && !host.includes(':');
  } catch { return false; }
}, '공개 HTTPS 사이트의 기본 주소를 확인해 주세요.');
const home = z.object({
  ...requestFields,
  contentType: z.enum(['html', 'other', 'unknown']),
  headers: z.object({ hsts: z.enum(['missing','disabled','short','enabled','invalid']), csp: z.enum(['missing','report-only','present','unsafe']), nosniff: z.boolean(), framing: z.enum(['restricted','missing','invalid']), referrer: z.enum(['restricted','unsafe','missing','invalid']) }).strict().nullable(),
  cookies: z.object({ total: count, missingSecure: count, missingHttpOnly: count, missingSameSite: count }).strict().nullable(),
  html: z.object({ title: z.boolean(), canonical: z.enum(['self','other','missing','invalid']), indexing: observation, mixedContent: z.boolean() }).strict().nullable(),
}).strict();
export const securityEvidenceSchema = z.object({
  schemaVersion: z.literal(1), collector: z.literal(SECURITY_COLLECTOR), targetOrigin: securityOriginSchema,
  observedAt: z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)), '관측 시각을 확인해 주세요.'),
  authorization: z.literal('owner_or_authorized'), home,
  robots: z.object({ ...requestFields, rules: z.object({ Googlebot: observation, bingbot: observation, 'OAI-SearchBot': observation, PerplexityBot: observation }).strict() }).strict(),
  sitemap: z.object({ ...requestFields, format: z.enum(['urlset','index','unknown']), sameOriginUrls: count, otherOriginUrls: count }).strict(),
}).strict().superRefine((value, context) => {
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });
  for (const name of ['home','robots','sitemap'] as const) {
    const request = value[name];
    if (request.status === null && request.error === null) issue([name], '응답이 없으면 오류 상태를 남겨 주세요.');
    if ((request.status === null || request.error !== null) && request.bodyComplete) issue([name,'bodyComplete'], '실패한 요청은 응답 본문 완료로 기록할 수 없어요.');
  }
  const failedHome = value.home.status !== 200 || value.home.error !== null;
  if (failedHome && (value.home.headers !== null || value.home.cookies !== null || value.home.html !== null || value.home.contentType !== 'unknown')) issue(['home'], '실패한 요청의 보안 설정과 페이지 내용은 미확인으로 남겨 주세요.');
  if (!failedHome && (value.home.headers === null || value.home.cookies === null)) issue(['home'], '응답을 받았으면 헤더와 쿠키의 관측값이 필요해요.');
  if (value.home.cookies && [value.home.cookies.missingSecure, value.home.cookies.missingHttpOnly, value.home.cookies.missingSameSite].some(n => n > value.home.cookies!.total)) issue(['home','cookies'], '속성 누락 개수는 전체 쿠키 수를 넘을 수 없어요.');
  const successfulHtml = value.home.status === 200 && value.home.error === null && value.home.bodyComplete && value.home.contentType === 'html';
  if (!successfulHtml && value.home.html !== null) issue(['home','html'], '완전한 HTML 성공 응답이 없으면 페이지 내용은 미확인이어야 해요.');
  if (successfulHtml && value.home.html === null) issue(['home','html'], '완료된 HTML 응답의 관측값이 필요해요.');
  const robotsComplete = value.robots.status === 200 && value.robots.error === null && value.robots.bodyComplete;
  if (!robotsComplete && SECURITY_BOTS.some(bot => value.robots.rules[bot] !== 'unknown')) issue(['robots','rules'], 'robots.txt를 완전히 확인하지 못했으면 봇 허용 여부를 단정할 수 없어요.');
  const sitemapComplete = value.sitemap.status === 200 && value.sitemap.error === null && value.sitemap.bodyComplete;
  if ((!sitemapComplete || value.sitemap.format === 'unknown') && (value.sitemap.format !== 'unknown' || value.sitemap.sameOriginUrls || value.sitemap.otherOriginUrls)) issue(['sitemap'], '사이트맵을 완전히 해석하지 못했으면 URL 수를 기록할 수 없어요.');
});
export function assertSecurityEvidenceTime(evidence: SecurityEvidence, latest = Date.now()): boolean {
  return Date.parse(evidence.observedAt) <= latest;
}
/** Site ownership is checked separately; matching a domain does not attest to evidence authenticity. */
export function securityOriginMatchesDomain(origin: string, domain: string): boolean {
  try { return new URL(origin).hostname === new URL(`https://${domain}`).hostname && new URL(`https://${domain}`).pathname === '/' && !new URL(`https://${domain}`).port; } catch { return false; }
}
export const securityPostSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('import'), siteId: z.string().uuid(), requestId: z.string().uuid(), evidence: securityEvidenceSchema }).strict(),
  z.object({ action: z.literal('create_task'), siteId: z.string().uuid(), checkId: z.string().uuid(), findingId: z.string().regex(/^[a-z][a-z0-9-]{0,99}$/) }).strict(),
]);

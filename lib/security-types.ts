/** Imported, user-supplied observations. A digest proves integrity, not site ownership or authenticity. */
export const SECURITY_COLLECTOR = 'lumen-public-web/1' as const;
export const SECURITY_REQUEST_BYTES = 32 * 1024;
export const SECURITY_BOTS = ['Googlebot', 'bingbot', 'OAI-SearchBot', 'PerplexityBot'] as const;
export type SecurityBot = typeof SECURITY_BOTS[number];
export type ObservationState = 'allowed' | 'blocked' | 'unknown';
export type SecurityRequestError = 'dns_blocked' | 'dns_failed' | 'tls_or_network' | 'timeout' | 'body_limit' | null;
export interface PublicRequestEvidence {
  status: number | null;
  error: SecurityRequestError;
  bodyComplete: boolean;
}
export interface SecurityEvidence {
  schemaVersion: 1;
  collector: typeof SECURITY_COLLECTOR;
  targetOrigin: string;
  observedAt: string;
  authorization: 'owner_or_authorized';
  home: PublicRequestEvidence & {
    contentType: 'html' | 'other' | 'unknown';
    headers: {
      hsts: 'missing' | 'disabled' | 'short' | 'enabled' | 'invalid';
      csp: 'missing' | 'report-only' | 'present' | 'unsafe';
      nosniff: boolean;
      framing: 'restricted' | 'missing' | 'invalid';
      referrer: 'restricted' | 'unsafe' | 'missing' | 'invalid';
    } | null;
    cookies: { total: number; missingSecure: number; missingHttpOnly: number; missingSameSite: number } | null;
    html: { title: boolean; canonical: 'self' | 'other' | 'missing' | 'invalid'; indexing: ObservationState; mixedContent: boolean } | null;
  };
  robots: PublicRequestEvidence & { rules: Record<SecurityBot, ObservationState> };
  sitemap: PublicRequestEvidence & { format: 'urlset' | 'index' | 'unknown'; sameOriginUrls: number; otherOriginUrls: number };
}
export interface SecurityFinding {
  id: string;
  category: 'security' | 'discovery';
  state: 'pass' | 'attention' | 'unknown';
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  recommendation: string;
  referenceUrl: string;
}
export interface SecurityCheck {
  id: string;
  siteId: string;
  evidence: SecurityEvidence;
  digest: string;
  createdAt: string;
  findings: SecurityFinding[];
}
export interface SecurityChecksResponse { checks: SecurityCheck[]; cached?: boolean }
export interface SecurityComparison {
  comparable: boolean;
  reason: string;
  improved: string[];
  regressed: string[];
  unobserved: string[];
}

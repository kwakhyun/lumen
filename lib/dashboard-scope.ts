import type { Answer } from './product-types';

export type DashboardScope = { period: '7' | '30'; model: string };

export function readDashboardScope(query: Record<string, string | string[] | undefined>): DashboardScope {
  return {
    period: query.period === '7' ? '7' : '30',
    model: typeof query.model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,99}$/.test(query.model) ? query.model : 'all',
  };
}

export function dashboardHref(section: string, scope: DashboardScope, siteId?: string, promptId?: string): string {
  const query = new URLSearchParams();
  if (siteId) query.set('site', siteId);
  query.set('period', scope.period);
  if (scope.model !== 'all') query.set('model', scope.model);
  if (promptId) query.set('prompt', promptId);
  return `/dashboard${section === 'overview' ? '' : `/${encodeURIComponent(section)}`}?${query}`;
}

/** The same sample feeds summaries, question rows, answer details and exports. */
export function filterDashboardAnswers(answers: Answer[], scope: DashboardScope, now: number, site: { id: string; mode: string }): Answer[] {
  const cutoff = now - Number(scope.period) * 86_400_000;
  const seen = new Set<string>();
  return answers.filter(answer => {
    const timestamp = Date.parse(answer.completedAt || answer.createdAt);
    if (answer.siteId !== site.id || answer.mode !== site.mode || (scope.model !== 'all' && answer.model !== scope.model) || !Number.isFinite(timestamp) || timestamp < cutoff || seen.has(answer.id)) return false;
    seen.add(answer.id);
    return true;
  });
}

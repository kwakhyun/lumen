import type { ImpactCheckObservation } from './impact-check-types';
import type { ImpactPlan, ImpactSearch } from './impact-types';

type Search = Pick<ImpactSearch, 'result' | 'searchConfirmed' | 'brandMention' | 'citationReview' | 'citations'>;
export function checkMention(row: Search | undefined): boolean | null {
  return !row || row.result !== 'answer' || !row.searchConfirmed || row.brandMention === 'uncertain' ? null : row.brandMention === 'present';
}
export function checkCitation(row: Search | undefined, domain: string): boolean | null {
  if (!row || row.result !== 'answer' || !row.searchConfirmed || row.citationReview !== 'complete') return null;
  const own = domain.toLowerCase().replace(/^www\./, '');
  return row.citations.some(citation => {
    if (citation.relation !== 'original_citation') return false;
    try { const host = new URL(citation.url).hostname.toLowerCase().replace(/^www\./, ''); return host === own || host.endsWith(`.${own}`); } catch { return false; }
  });
}
export function checkBaseline(row: ImpactCheckObservation, searches: ImpactSearch[]) {
  return searches.find(before => !before.voidedAt && before.phase === 'before' && before.digest === row.baselineDigest && before.queryId === row.queryId && before.repetition === row.repetition);
}
export function checkContextChanged(before: ImpactPlan['context'], after: ImpactPlan['context']) {
  return (Object.keys(before) as (keyof ImpactPlan['context'])[]).some(key => before[key] !== after[key]);
}

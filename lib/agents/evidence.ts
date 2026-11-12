import { filterDashboardAnswers, type DashboardScope } from '../dashboard-scope';
import { computeMetrics, domainMatches, measuredCitations } from '../metrics';
import { summarizePromptEvidence, type PromptEvidence } from '../prompt-opportunities';
import type { Answer, BrandMetric, Prompt, SiteState } from '../product-types';

const pct = (n: number, d: number) => d ? Math.round(n / d * 1000) / 10 : 0;
const DAY = 86_400_000;

export type SourceKind = 'own' | 'competitor' | 'third_party';
export type AgentEvidence = {
  site: { name: string; domain: string; description: string; industry: string; language: string; country: string; mode: 'live' | 'demo' };
  scope: { period: '7' | '30'; model: string; from: string; asOf: string; truncated: boolean };
  overview: {
    answerCount: number; failedAnswerCount: number; pendingAnswerCount: number;
    mentionCount: number; mentionRate: number; shareOfVoice: number; totalBrandMentions: number;
    citationRate: number | null; citationCount: number; citationEligibleAnswerCount: number;
    averageRank: number | null; activePromptCount: number; answeredPromptCount: number; mentionedPromptCount: number;
  };
  /** The equal-length window before the selected one. null when it lies outside the loaded history. */
  previous: { answerCount: number; mentionRate: number; shareOfVoice: number; citationRate: number | null } | null;
  trend: { date: string; answerCount: number; mentionRate: number }[];
  models: { model: string; answerCount: number; mentionRate: number; citationRate: number | null }[];
  topics: { topic: string; promptCount: number; answerCount: number; mentionRate: number | null; competitorOnlyCount: number }[];
  questions: { id: string; text: string; topic: string; intent: Prompt['intent']; active: boolean; answerCount: number; mentionCount: number; mentionRate: number | null; competitorOnlyCount: number; competitorNames: string[]; status: PromptEvidence['status'] }[];
  brands: BrandMetric[];
  sources: { domain: string; kind: SourceKind; owner: string | null; answers: number; rate: number; url: string; title: string }[];
  tasks: { title: string; status: string }[];
  documents: { title: string; kind: string }[];
};

export function sourceKind(domain: string, state: Pick<SiteState, 'site' | 'competitors'>): { kind: SourceKind; owner: string | null } {
  if (domainMatches(domain, state.site.domain)) return { kind: 'own', owner: state.site.name };
  const rival = state.competitors.find(competitor => domainMatches(domain, competitor.domain));
  return rival ? { kind: 'competitor', owner: rival.name } : { kind: 'third_party', owner: null };
}

/** The same scoped sample the dashboard shows, aggregated once for every agent. */
export function buildAgentEvidence(state: SiteState, scope: DashboardScope, asOf = Date.now()): AgentEvidence {
  const answers = filterDashboardAnswers(state.answers, scope, asOf, state.site);
  const metrics = computeMetrics(state.site, state.competitors, answers, state.prompts);
  const days = Number(scope.period);
  // state.answers holds 30 days. Only a 7-day window has a full earlier window to compare with.
  const earlier = days === 7 ? filterDashboardAnswers(state.answers, { period: '30', model: scope.model }, asOf, state.site)
    .filter(answer => { const at = Date.parse(answer.completedAt || answer.createdAt); return at < asOf - days * DAY && at >= asOf - 2 * days * DAY; }) : [];
  const previousMetrics = earlier.length ? computeMetrics(state.site, state.competitors, earlier, state.prompts) : null;
  const rows = summarizePromptEvidence(state.site, state.prompts, state.competitors, answers);
  const completed = answers.filter(answer => answer.status === 'completed');
  const models = [...new Set(completed.map(answer => answer.model))].map(model => {
    const m = computeMetrics(state.site, state.competitors, answers.filter(answer => answer.model === model), state.prompts);
    return { model, answerCount: m.answerCount, mentionRate: m.mentionRate, citationRate: m.citationRate };
  }).sort((a, b) => b.answerCount - a.answerCount);
  const topicMap = new Map<string, { promptCount: number; answerCount: number; mentionCount: number; competitorOnlyCount: number }>();
  for (const row of rows) {
    if (!row.prompt.active) continue;
    const key = row.prompt.topic || '일반', current = topicMap.get(key) || { promptCount: 0, answerCount: 0, mentionCount: 0, competitorOnlyCount: 0 };
    topicMap.set(key, { promptCount: current.promptCount + 1, answerCount: current.answerCount + row.completedCount, mentionCount: current.mentionCount + row.mentionCount, competitorOnlyCount: current.competitorOnlyCount + row.competitorOnlyCount });
  }
  return {
    site: { name: state.site.name, domain: state.site.domain, description: state.site.description, industry: state.site.industry, language: state.site.language, country: state.site.country, mode: state.site.mode },
    scope: { ...scope, from: new Date(asOf - days * DAY).toISOString(), asOf: new Date(asOf).toISOString(), truncated: state.dataWindow?.truncated ?? false },
    overview: {
      answerCount: metrics.answerCount, failedAnswerCount: metrics.failedAnswerCount, pendingAnswerCount: metrics.pendingAnswerCount,
      mentionCount: metrics.mentionCount, mentionRate: metrics.mentionRate, shareOfVoice: metrics.shareOfVoice, totalBrandMentions: metrics.totalBrandMentions,
      citationRate: metrics.citationRate, citationCount: metrics.citationCount, citationEligibleAnswerCount: metrics.citationEligibleAnswerCount,
      averageRank: metrics.averageRank, activePromptCount: metrics.promptCount, answeredPromptCount: metrics.completedPromptCount, mentionedPromptCount: metrics.mentionedPromptCount,
    },
    previous: previousMetrics?.answerCount ? { answerCount: previousMetrics.answerCount, mentionRate: previousMetrics.mentionRate, shareOfVoice: previousMetrics.shareOfVoice, citationRate: previousMetrics.citationRate } : null,
    trend: metrics.series.map(point => ({ date: point.date, answerCount: point.answerCount, mentionRate: point.mentionRate })),
    models,
    topics: [...topicMap].map(([topic, value]) => ({ topic, promptCount: value.promptCount, answerCount: value.answerCount, mentionRate: value.answerCount ? pct(value.mentionCount, value.answerCount) : null, competitorOnlyCount: value.competitorOnlyCount }))
      .sort((a, b) => (a.mentionRate ?? 101) - (b.mentionRate ?? 101)),
    questions: rows.map(row => ({ id: row.prompt.id, text: row.prompt.text, topic: row.prompt.topic || '일반', intent: row.prompt.intent, active: row.prompt.active, answerCount: row.completedCount, mentionCount: row.mentionCount, mentionRate: row.mentionRate, competitorOnlyCount: row.competitorOnlyCount, competitorNames: row.competitorNames, status: row.status })),
    brands: [...metrics.brands].sort((a, b) => b.mentionRate - a.mentionRate),
    sources: metrics.sources.map(source => ({ ...sourceKind(source.domain, state), domain: source.domain, answers: source.citations, rate: pct(source.citations, metrics.citationEligibleAnswerCount), url: source.url, title: source.title })),
    tasks: state.tasks.map(task => ({ title: task.title, status: task.status })),
    documents: state.documents.map(document => ({ title: document.title, kind: document.kind })),
  };
}

export type AnswerExcerpt = { id: string; question: string; model: string; completedAt: string; ownMentioned: boolean; mentionedBrands: string[]; text: string; citations: { domain: string; url: string; title: string }[] };

/** Newest completed answers for one question, or across the scope when no question is given. */
export function answerExcerpts(state: SiteState, scope: DashboardScope, options: { promptId?: string; limit?: number; textLimit?: number; only?: 'own_mentioned' | 'own_missing' } = {}, asOf = Date.now()): AnswerExcerpt[] {
  const { promptId, limit = 3, textLimit = 1400, only } = options;
  const own = (answer: Answer) => answer.mentions.some(mention => mention.mentioned && domainMatches(mention.domain, state.site.domain));
  return filterDashboardAnswers(state.answers, scope, asOf, state.site)
    .filter(answer => answer.status === 'completed' && (!promptId || answer.promptId === promptId) && (!only || (only === 'own_mentioned') === own(answer)))
    .sort((a, b) => (b.completedAt || b.createdAt).localeCompare(a.completedAt || a.createdAt))
    .slice(0, Math.max(1, Math.min(6, limit)))
    .map(answer => ({
      id: answer.id, question: answer.promptText, model: answer.model, completedAt: answer.completedAt || answer.createdAt, ownMentioned: own(answer),
      mentionedBrands: answer.mentions.filter(mention => mention.mentioned).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map(mention => mention.name),
      text: answer.text.slice(0, textLimit),
      citations: measuredCitations(answer).slice(0, 6).map(citation => ({ domain: citation.domain, url: citation.url, title: citation.title })),
    }));
}

/** Questions where rivals appear without the brand, most affected first. */
export function gapQuestions(evidence: AgentEvidence, limit = 3) {
  return evidence.questions.filter(question => question.active && question.answerCount > 0 && question.competitorOnlyCount > 0)
    .sort((a, b) => b.competitorOnlyCount / b.answerCount - a.competitorOnlyCount / a.answerCount || b.competitorOnlyCount - a.competitorOnlyCount || a.text.localeCompare(b.text, 'ko'))
    .slice(0, limit);
}

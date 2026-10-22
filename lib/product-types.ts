/** Public API contract. All times are ISO 8601; percentages use 0–100. */
export type DataMode = 'live' | 'demo';
export type RunStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';
export type Site = { id: string; name: string; domain: string; description: string; industry: string; language: string; country: string; mode: DataMode; createdAt: string; updatedAt: string; trackingKey: string };
export type Prompt = { id: string; siteId: string; text: string; topic: string; intent: 'informational' | 'comparison' | 'transactional'; active: boolean; pinned: boolean; createdAt: string };
export type Competitor = { id: string; siteId: string; name: string; domain: string; createdAt: string };
export type Citation = { url: string; title: string; domain: string; startIndex: number; endIndex: number; provenance: 'provider_annotation' | 'synthetic' };
export type BrandMention = { name: string; domain: string; mentioned: boolean; firstPosition: number | null; rank: number | null; cited: boolean };
export type Answer = { id: string; siteId: string; runId: string; promptId: string; promptText: string; model: string; provider: string; mode: DataMode; status: 'pending' | 'processing' | 'completed' | 'failed'; text: string; citations: Citation[]; mentions: BrandMention[]; inputTokens: number; outputTokens: number; providerResponseId: string | null; error: string | null; createdAt: string; completedAt: string | null };
export type Run = { id: string; siteId: string; mode: DataMode; status: RunStatus; models: string[]; total: number; completed: number; failed: number; createdAt: string; completedAt: string | null; error: string | null };
export type Document = { id: string; siteId: string; kind: 'report' | 'content'; title: string; content: string; format: string; mode: DataMode; createdAt: string };
export type Task = { id: string; siteId: string; title: string; description: string; status: 'todo' | 'in_progress' | 'done'; priority: 'high' | 'medium' | 'low'; createdAt: string; updatedAt: string };
export type Persona = { id: string; siteId: string; name: string; description: string; promptPrefix: string; createdAt: string };
export type ProviderStatus = { id: string; name: string; model: string; configured: boolean; available: boolean; description: string };
export type BrandMetric = { name: string; domain: string; isOwn: boolean; mentions: number; citations: number; mentionRate: number; citationRate: number | null; shareOfVoice: number; averageRank: number | null };
export type MetricSeriesPoint = { date: string; mentionRate: number; citationRate: number | null; answerCount: number; mentionCount: number; citationCount: number; citationEligibleAnswerCount: number };
export type Metrics = {
  metricsVersion: 'lumen-metrics-v2'; dataMode: DataMode;
  totalAnswerCount: number; answerCount: number; failedAnswerCount: number; pendingAnswerCount: number;
  excludedModeAnswerCount: number; duplicateAnswerCount: number;
  promptCount: number; completedPromptCount: number; mentionedPromptCount: number;
  /** Legacy coverage is collection coverage, never brand visibility. */
  coverage: number; brandQuestionCoverage: number | null;
  mentionCount: number; citationCount: number; totalBrandMentions: number;
  citationEligibleAnswerCount: number; citationExcludedAnswerCount: number;
  mentionRate: number; citationRate: number | null; shareOfVoice: number; averageRank: number | null;
  brands: BrandMetric[]; series: MetricSeriesPoint[];
  sources: { domain: string; citations: number; url: string; title: string }[];
};
export type TrafficSummary = { totalVisits: number; aiVisits: number; sources: { source: string; visits: number }[]; pages: { path: string; visits: number }[]; series: { date: string; visits: number; aiVisits: number }[]; trackingEnabled: boolean; note: string };
export type ProductUser = { userId: string; displayName: string; email: string; fullName: string | null };
export type Bootstrap = { user: ProductUser; sites: Site[]; providers: ProviderStatus[] };
export type SiteState = { dataWindow?: { days: number; answersReturned: number; totalAnswers: number; truncated: boolean }; site: Site; personas: Persona[]; prompts: Prompt[]; competitors: Competitor[]; runs: Run[]; answers: Answer[]; documents: Document[]; tasks: Task[]; traffic: TrafficSummary; metrics: Metrics; providers: ProviderStatus[] };
export type ApiError = { error: string; code?: string; details?: unknown };
export const LIVE_MODEL = 'gpt-4.1-mini';
export const DEMO_MODELS = ['gpt-4.1-mini', 'demo-gemini', 'demo-perplexity'] as const;
export const METRIC_DEFINITIONS = {
  coverage: 'Unique questions with at least one completed answer ÷ active tracked questions. Failed answers are excluded.',
  mentionRate: 'Completed answers mentioning your brand or domain ÷ all completed answers. One mention maximum per brand per answer.',
  citationRate: 'Completed answers with accepted provider annotations citing your domain ÷ completed answers from citation-capable collection adapters. Unsupported models and failures are excluded; no eligible answer means null, not zero. Demo uses synthetic annotations separately.',
  brandQuestionCoverage: 'Active tracked questions with at least one completed answer mentioning your brand ÷ all active tracked questions. This differs from collection coverage; unanswered questions remain unobserved.',
  shareOfVoice: 'Your brand mentions ÷ total mentions of your brand and tracked competitors in completed answers.',
  averageRank: 'Average order of first appearance among tracked brands, only in answers that mention your brand. This is not a search engine ranking.',
} as const;

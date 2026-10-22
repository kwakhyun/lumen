export const EXPERIMENT_METRIC_VERSION = 'lumen-experiment-v1' as const;
export type ExperimentMetric = 'mentionRate' | 'citationRate';
export type ExperimentSnapshot = {
  version: typeof EXPERIMENT_METRIC_VERSION;
  mode: 'live' | 'demo';
  brands: { name: string; domain: string }[];
  cells: { question: string; model: string; provider: string; status: 'completed' | 'failed'; mentioned: boolean; cited: boolean }[];
  capturedAt: string;
};
export type ExperimentComparison = {
  paired: number; total: number; baselineFailed: number; followupFailed: number;
  before: number | null; after: number | null; delta: number | null;
  targetObserved: boolean; caveats: string[];
};
export type ImprovementExperiment = {
  id: string; siteId: string; title: string; hypothesis: string; intervention: string;
  metric: ExperimentMetric; targetDelta: number; status: 'draft' | 'observing' | 'reviewed';
  baselineRunId: string; followupRunId: string | null;
  baselineSnapshot: ExperimentSnapshot; followupSnapshot: ExperimentSnapshot | null;
  notes: string; createdAt: string; updatedAt: string; comparison: ExperimentComparison | null;
};
export type ExperimentsState = { experiments: ImprovementExperiment[]; metricVersion: typeof EXPERIMENT_METRIC_VERSION };

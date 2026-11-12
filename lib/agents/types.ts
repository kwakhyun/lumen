import type { DashboardScope } from '../dashboard-scope';
import type { DataMode } from '../product-types';

export type AgentCategory = 'reporting' | 'research' | 'content' | 'outreach';
export type AgentInputField =
  | { key: string; label: string; type: 'prompt'; hint?: string }
  | { key: string; label: string; type: 'topic'; hint?: string }
  | { key: string; label: string; type: 'competitor'; hint?: string }
  | { key: string; label: string; type: 'text'; placeholder?: string; hint?: string; required?: boolean };
export type AgentDefinition = {
  id: string;
  category: AgentCategory;
  name: string;
  /** One verb-first line: what the owner has when the run ends. */
  outcome: string;
  description: string;
  icon: 'pulse' | 'calendar' | 'shield' | 'target' | 'users' | 'compass' | 'link' | 'clipboard' | 'pen' | 'list';
  inputs: AgentInputField[];
  steps: { id: string; label: string }[];
  produces: ('report' | 'tasks' | 'prompts')[];
  /** Saved documents use the existing report/content split. */
  documentKind: 'report' | 'content';
};

export type AgentStepStatus = 'pending' | 'active' | 'done' | 'failed';
export type AgentStep = { id: string; label: string; status: AgentStepStatus; detail?: string };
export type AgentProposal = {
  id: string;
  kind: 'task' | 'prompt';
  title: string;
  detail: string;
  priority?: 'high' | 'medium' | 'low';
  topic?: string;
  intent?: 'informational' | 'comparison' | 'transactional';
  status: 'proposed' | 'accepted' | 'dismissed';
};
export type AgentRun = {
  id: string;
  siteId: string;
  agentId: string;
  title: string;
  status: 'running' | 'completed' | 'failed';
  mode: DataMode;
  input: Record<string, string>;
  scope: DashboardScope;
  steps: AgentStep[];
  summary: string;
  report: string;
  proposals: AgentProposal[];
  /** The model that wrote the result. null means the run used no AI request. */
  model: string | null;
  units: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  /** false when the result exists only in this response (guest preview or storage unavailable). */
  persisted: boolean;
};
export type AgentEvent =
  | { type: 'run'; run: AgentRun }
  | { type: 'step'; id: string; status: AgentStepStatus; detail?: string }
  | { type: 'activity'; text: string }
  | { type: 'done'; run: AgentRun }
  | { type: 'error'; message: string; code?: string };

export const AGENT_CATEGORY_LABELS: Record<AgentCategory, string> = {
  reporting: '리포트와 모니터링',
  research: '리서치',
  content: '콘텐츠',
  outreach: '외부 채널',
};
/** Each run reserves this many units of the AI allowance, whichever model writes it. */
export const AGENT_RUN_UNITS = 2;

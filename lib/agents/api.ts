import { and, count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import * as t from '@/db/schema';
import { agentRuns } from '@/db/agents-schema';
import { analysisScopeInput, ProductError, promptInput, readJson, taskInput } from '../product-validation';
import { getState, now, quota, uid } from '../product-server';
import { defaultGenerationModel, providerStatuses } from '../providers';
import { requireAiEligibility } from '../eligibility';
import { reserveAiUsage } from '../usage';
import type { DashboardScope } from '../dashboard-scope';
import type { SiteState } from '../product-types';
import { AGENTS, agentById } from './catalog';
import { executeAgent } from './engine';
import { buildAgentEvidence } from './evidence';
import { AGENT_RUN_UNITS, type AgentDefinition, type AgentEvent, type AgentProposal, type AgentRun, type AgentStep } from './types';
import { writeFromEvidence, type AgentDraft } from './writers';

type SiteRow = typeof t.sites.$inferSelect;
type Actor = { userId: string; guest?: boolean };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
const missing = (): never => { throw new ProductError(404, 'Record not found.', 'not_found'); };
/** A deployment that has not applied the agent migration yet still runs agents; it just cannot keep history. */
/** True when agent_runs has not been migrated yet. Drizzle wraps the driver error, so the cause chain is checked too. */
export function storageMissing(error: unknown): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; current = current.cause, depth += 1) {
    if (/no such table/i.test(current.message)) return true;
  }
  return false;
}

function toRun(row: typeof agentRuns.$inferSelect): AgentRun {
  const parse = <T,>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };
  return { id: row.id, siteId: row.siteId, agentId: row.agentId, title: row.title, status: row.status, mode: row.mode, input: parse(row.input, {}), scope: parse<DashboardScope>(row.scope, { period: '30', model: 'all' }), steps: parse<AgentStep[]>(row.steps, []), summary: row.summary, report: row.report, proposals: parse<AgentProposal[]>(row.proposals, []), model: row.model, units: row.units, error: row.error, createdAt: row.createdAt, completedAt: row.completedAt, persisted: true };
}

/** A proposal whose task or question already exists reads as accepted, wherever it was added. */
function withAcceptance(run: AgentRun, state: Pick<SiteState, 'tasks' | 'prompts'>): AgentRun {
  const tasks = new Set(state.tasks.map(task => task.title)), prompts = new Set(state.prompts.map(prompt => prompt.text));
  return { ...run, proposals: run.proposals.map(proposal => proposal.status === 'proposed' && (proposal.kind === 'task' ? tasks.has(proposal.title.slice(0, 200)) : prompts.has(proposal.title)) ? { ...proposal, status: 'accepted' } : proposal) };
}

function proposalsFrom(draft: AgentDraft, agent: AgentDefinition, runId: string): AgentProposal[] {
  return draft.proposals.filter(proposal => agent.produces.includes(proposal.kind === 'task' ? 'tasks' : 'prompts')).slice(0, 8)
    .map((proposal, index) => ({ ...proposal, id: `${runId}:${index}`, status: 'proposed' }));
}

const SAMPLE_AGENTS = ['brand-health', 'gap-analysis', 'source-playbook'];
/** Sample workspaces show finished example runs without storing or generating anything. */
export function sampleAgentRuns(state: SiteState): AgentRun[] {
  if (state.site.mode !== 'demo') return [];
  const latest = state.answers.reduce((max, answer) => (answer.completedAt || answer.createdAt) > max ? (answer.completedAt || answer.createdAt) : max, state.site.createdAt);
  const scope: DashboardScope = { period: '30', model: 'all' }, asOf = Date.parse(latest) + 60_000;
  const evidence = buildAgentEvidence(state, scope, asOf);
  return SAMPLE_AGENTS.map((id, index) => {
    const agent = agentById(id)!, runId = `sample-${id}`, draft = writeFromEvidence(id, { evidence, state, scope, input: {}, asOf });
    const at = new Date(asOf + (SAMPLE_AGENTS.length - index) * 60_000).toISOString();
    return { id: runId, siteId: state.site.id, agentId: id, title: draft.title, status: 'completed', mode: 'demo', input: {}, scope, steps: agent.steps.map(step => ({ ...step, status: 'done' })), summary: draft.summary, report: draft.report, proposals: proposalsFrom(draft, agent, runId), model: null, units: 0, error: null, createdAt: at, completedAt: at, persisted: false };
  });
}

async function storedRuns(siteId: string): Promise<AgentRun[]> {
  try { return (await getDb().select().from(agentRuns).where(eq(agentRuns.siteId, siteId)).orderBy(desc(agentRuns.createdAt)).limit(30)).map(toRun); }
  catch (error) { if (storageMissing(error)) return []; throw error; }
}
async function findRun(site: SiteRow, state: SiteState, id: string): Promise<AgentRun> {
  if (id.startsWith('sample-')) return sampleAgentRuns(state).find(run => run.id === id) || missing();
  if (!/^[0-9a-f-]{36}$/i.test(id)) missing();
  const [row] = await getDb().select().from(agentRuns).where(and(eq(agentRuns.id, id), eq(agentRuns.siteId, site.id))).limit(1);
  return row ? toRun(row) : missing();
}

const runInput = z.object({ agentId: z.string().max(60), input: z.record(z.string().max(40), z.string().trim().max(400)).default({}), scope: analysisScopeInput }).strict();

function cleanInput(agent: AgentDefinition, raw: Record<string, string>, state: SiteState): Record<string, string> {
  const input: Record<string, string> = {};
  for (const field of agent.inputs) {
    const value = raw[field.key]?.trim();
    if (!value) { if (field.type === 'text' && field.required) throw new ProductError(400, `‘${field.label}’ 항목을 입력해 주세요.`, 'invalid_input'); continue; }
    if (field.type === 'prompt' && !state.prompts.some(prompt => prompt.id === value)) throw new ProductError(400, '이 워크스페이스의 질문을 선택해 주세요.', 'invalid_prompt');
    if (field.type === 'competitor' && !state.competitors.some(competitor => competitor.name === value)) throw new ProductError(400, '등록된 경쟁사를 선택해 주세요.', 'invalid_input');
    input[field.key] = value;
  }
  return input;
}

async function startRun(request: Request, site: SiteRow, actor: Actor): Promise<Response> {
  const body = await readJson(request, runInput), agent = agentById(body.agentId) || missing();
  const state = await getState(site), input = cleanInput(agent, body.input, state), scope = body.scope as DashboardScope;
  await quota(actor.userId, 'agent-runs', actor.guest ? 600 : 60);
  const live = site.mode === 'live';
  if (live) await requireAiEligibility(actor.userId);
  const generation = live ? defaultGenerationModel() : null;
  const model = generation && providerStatuses().some(provider => provider.model === generation && provider.configured && provider.available) ? generation : null;
  const runId = uid(), createdAt = now();
  const base: AgentRun = { id: runId, siteId: site.id, agentId: agent.id, title: agent.name, status: 'running', mode: site.mode, input, scope, steps: agent.steps.map(step => ({ ...step, status: 'pending' })), summary: '', report: '', proposals: [], model, units: 0, error: null, createdAt, completedAt: null, persisted: false };
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The reader may leave; the run still finishes and is stored.
      const emit = (event: AgentEvent) => { try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { /* disconnected */ } };
      emit({ type: 'run', run: base });
      let run: AgentRun;
      try {
        const result = await executeAgent({ agent, state, scope, input, emit, model, pace: live ? 0 : 420, reserve: async () => { await reserveAiUsage(actor.userId, AGENT_RUN_UNITS, `agent:${runId}`); return AGENT_RUN_UNITS; } });
        run = { ...base, title: result.draft.title.slice(0, 200), status: 'completed', steps: result.steps, summary: result.draft.summary, report: result.draft.report, proposals: proposalsFrom(result.draft, agent, runId), model: result.model, units: result.units, completedAt: now() };
      } catch (error) {
        const message = error instanceof ProductError ? error.message : '에이전트 실행을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.';
        if (!(error instanceof ProductError)) console.error('[agent]', error instanceof Error ? error.name : 'unknown');
        run = { ...base, status: 'failed', error: message, completedAt: now() };
      }
      if (!actor.guest) {
        try {
          await getDb().insert(agentRuns).values({ id: run.id, siteId: site.id, ownerId: actor.userId, agentId: run.agentId, title: run.title, status: run.status, mode: run.mode, input: JSON.stringify(run.input), scope: JSON.stringify(run.scope), steps: JSON.stringify(run.steps), summary: run.summary, report: run.report, proposals: JSON.stringify(run.proposals), model: run.model, units: run.units, error: run.error, createdAt: run.createdAt, completedAt: run.completedAt });
          run.persisted = true;
        } catch (error) { if (!storageMissing(error)) console.error('[agent-store]', error instanceof Error ? error.name : 'unknown'); }
      }
      emit({ type: 'done', run });
      try { controller.close(); } catch { /* disconnected */ }
    },
  });
  return new Response(stream, { status: 201, headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'private, no-store, no-transform', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' } });
}

const decision = z.object({ proposalId: z.string().max(80), action: z.enum(['accept', 'dismiss']) }).strict();

/** /api/sites/:id/agents[/:runId[/document]] */
export async function handleAgents(request: Request, site: SiteRow, actor: Actor, id?: string, action?: string): Promise<Response> {
  const method = request.method;
  if (!id) {
    if (method === 'GET') {
      const state = await getState(site), stored = await storedRuns(site.id);
      const generation = site.mode === 'live' ? defaultGenerationModel() : null;
      const provider = providerStatuses().find(item => item.model === generation);
      return json({ agents: AGENTS, runs: (stored.length ? stored : sampleAgentRuns(state)).map(run => withAcceptance(run, state)), engine: { model: provider?.configured && provider.available ? generation : null, units: AGENT_RUN_UNITS } });
    }
    if (method === 'POST') return startRun(request, site, actor);
    missing();
  }
  if (actor.guest) throw new ProductError(403, '샘플은 읽기 전용이에요. 로그인하면 내 워크스페이스에 저장할 수 있어요.', 'demo_read_only');
  const state = await getState(site), run = await findRun(site, state, id!), db = getDb();
  if (!action && method === 'GET') return json({ run: withAcceptance(run, state) });
  if (!action && method === 'DELETE') {
    if (run.persisted) await db.delete(agentRuns).where(and(eq(agentRuns.id, run.id), eq(agentRuns.siteId, site.id)));
    return json({ deleted: true });
  }
  if (!action && method === 'PATCH') {
    const body = await readJson(request, decision), proposal = run.proposals.find(item => item.id === body.proposalId) || missing();
    let created: unknown = null;
    if (body.action === 'accept' && withAcceptance(run, state).proposals.find(item => item.id === proposal.id)?.status === 'proposed') {
      if (proposal.kind === 'task') {
        const [total] = await db.select({ n: count() }).from(t.tasks).where(eq(t.tasks.siteId, site.id));
        if (total.n >= 100) throw new ProductError(409, 'This workspace has reached the 100-record limit. Remove an unused record first.', 'record_limit');
        const input = taskInput.parse({ title: proposal.title.slice(0, 200), description: `${proposal.detail}\n\n출처: 에이전트 ‘${run.title}’`.slice(0, 2000), priority: proposal.priority || 'medium', status: 'todo' }), date = now();
        [created] = await db.insert(t.tasks).values({ id: uid(), siteId: site.id, ...input, createdAt: date, updatedAt: date }).returning();
      } else {
        const [total] = await db.select({ n: count() }).from(t.prompts).where(eq(t.prompts.siteId, site.id));
        if (total.n >= 100) throw new ProductError(409, 'This workspace has reached the 100-record limit. Remove an unused record first.', 'record_limit');
        const input = promptInput.parse({ text: proposal.title.slice(0, 1000), topic: proposal.topic || '일반', intent: proposal.intent || 'informational' });
        [created] = await db.insert(t.prompts).values({ id: uid(), siteId: site.id, ...input, createdAt: now() }).returning();
      }
    }
    const proposals = run.proposals.map(item => item.id === proposal.id ? { ...item, status: body.action === 'accept' ? 'accepted' as const : 'dismissed' as const } : item);
    if (run.persisted) await db.update(agentRuns).set({ proposals: JSON.stringify(proposals) }).where(and(eq(agentRuns.id, run.id), eq(agentRuns.siteId, site.id)));
    return json({ run: { ...run, proposals }, created });
  }
  if (action === 'document' && method === 'POST') {
    const agent = agentById(run.agentId) || missing();
    if (!run.report) throw new ProductError(400, '저장할 결과가 없어요.', 'invalid_input');
    const [total] = await db.select({ n: count() }).from(t.documents).where(eq(t.documents.siteId, site.id));
    if (total.n >= 100) throw new ProductError(409, 'This workspace has reached the 100-record limit. Remove an unused record first.', 'record_limit');
    const header = `> 에이전트 ‘${agent.name}’ 실행 결과 · 최근 ${run.scope.period}일 · ${run.scope.model === 'all' ? '전체 모델' : run.scope.model}${run.model ? ` · 생성 모델 \`${run.model}\`` : ' · 집계 기반'}\n\n`;
    const [document] = await db.insert(t.documents).values({ id: uid(), siteId: site.id, kind: agent.documentKind, title: run.title.slice(0, 200), content: `${header}${run.report}`.slice(0, 60000), format: agent.documentKind === 'report' ? 'report' : 'article', mode: site.mode, createdAt: now() }).returning();
    return json({ document }, 201);
  }
  return missing();
}

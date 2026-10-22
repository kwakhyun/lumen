import { env } from 'cloudflare:workers';
import { and, count, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { operationTicks } from '@/db/observability-schema';
import type { AutomationTickResult, ExecutionDelaySummary, OperationTick, TickEntryPoint, TickHistory } from './operations-types';

export const TICK_RETENTION_DAYS = 30;
export const TICK_SCOPE_LIMIT = 1000;
export const TICK_GLOBAL_LIMIT = 10000;
export const HISTORY_DISPLAY_LIMIT = 50;
export const HEARTBEAT_STALE_MS = 2 * 60 * 60 * 1000;
const UNFINISHED_AFTER_MS = 2 * 60 * 1000;
const entryPoints: readonly string[] = ['mcp_owner', 'mcp_operator', 'service_bearer', 'run_now_api', 'internal'];
const safeCodes = new Set(['paid_provider_disabled', 'eligibility_required', 'schedule_expired', 'ai_usage_exhausted', 'provider_unavailable', 'run_size', 'invalid_prompt', 'run_in_progress', 'run_locked', 'run_lease_changed', 'not_found', 'quota_exceeded', 'database_unavailable', 'collection_error']);
type Observation = { id: string; ownerId?: string; entryPoint?: TickEntryPoint; startedAt: number };
const number = (value: number) => Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

/** Best effort telemetry is deliberately outside dispatcher leases and provider retry paths. */
export async function beginTickObservation(input: Observation): Promise<boolean> {
  try {
    if (!env.DB) return false;
    const owner = input.ownerId ?? null;
    const cutoff = new Date(input.startedAt - TICK_RETENTION_DAYS * 86400000).toISOString();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO operation_ticks (id,owner_id,entry_point,status,started_at) VALUES (?,?,?,\'started\',?)').bind(input.id, owner, entryPoints.includes(input.entryPoint || '') ? input.entryPoint! : 'internal', new Date(input.startedAt).toISOString()),
      env.DB.prepare('DELETE FROM operation_ticks WHERE started_at < ?').bind(cutoff),
      env.DB.prepare('DELETE FROM operation_ticks WHERE owner_id IS ? AND id NOT IN (SELECT id FROM operation_ticks WHERE owner_id IS ? ORDER BY started_at DESC,id DESC LIMIT ?)').bind(owner, owner, TICK_SCOPE_LIMIT),
      env.DB.prepare('DELETE FROM operation_ticks WHERE id NOT IN (SELECT id FROM operation_ticks ORDER BY started_at DESC,id DESC LIMIT ?)').bind(TICK_GLOBAL_LIMIT),
    ]);
    return true;
  } catch {
    // Static code only: errors may contain SQL parameters or private provider responses.
    console.warn('operation_tick_observation_unavailable');
    return false;
  }
}

export async function finishTickObservation(input: Observation, result: AutomationTickResult, errorCode?: string): Promise<void> {
  try {
    const at = Date.now();
    await getDb().update(operationTicks).set({
      status: errorCode ? 'failed' : result.skipped ? 'skipped' : 'completed',
      finishedAt: new Date(at).toISOString(), durationMs: number(at - input.startedAt),
      queued: number(result.queued), processed: number(result.processed), completed: number(result.completed), failed: number(result.failed), blocked: number(result.blocked),
      skipped: Boolean(result.skipped), continuation: Boolean(result.continuation),
      errorCode: errorCode ? safeCodes.has(errorCode) ? errorCode : 'collection_error' : null,
    }).where(and(eq(operationTicks.id, input.id), input.ownerId ? eq(operationTicks.ownerId, input.ownerId) : isNull(operationTicks.ownerId), eq(operationTicks.status, 'started')));
  } catch { console.warn('operation_tick_observation_unavailable'); }
}

/** Owner calls never expose other tenants or global dispatcher counts. Operator identity comes from server configuration. */
export async function readTickHistory(ownerId: string, at = Date.now()): Promise<TickHistory> {
  const includesService = typeof env.LUMEN_OPERATOR_USER_ID === 'string' && env.LUMEN_OPERATOR_USER_ID.length > 0 && env.LUMEN_OPERATOR_USER_ID === ownerId;
  const since = new Date(at - TICK_RETENTION_DAYS * 86400000).toISOString(), until = new Date(at).toISOString();
  const window = { since, until, limit: HISTORY_DISPLAY_LIMIT, retentionDays: TICK_RETENTION_DAYS, perScopeLimit: TICK_SCOPE_LIMIT, globalLimit: TICK_GLOBAL_LIMIT };
  try {
    const db = getDb();
    const filter = and(includesService ? or(eq(operationTicks.ownerId, ownerId), isNull(operationTicks.ownerId)) : eq(operationTicks.ownerId, ownerId), gte(operationTicks.startedAt, since), lte(operationTicks.startedAt, until));
    const [rows, totals] = await db.batch([
      db.select().from(operationTicks).where(filter).orderBy(desc(operationTicks.startedAt), desc(operationTicks.id)).limit(HISTORY_DISPLAY_LIMIT),
      db.select({ n: count() }).from(operationTicks).where(filter),
    ]);
    const ticks: OperationTick[] = rows.map(row => ({
      id: row.id, scope: row.ownerId === null ? 'service' : 'owner', entryPoint: row.entryPoint,
      status: row.status, startedAt: row.startedAt, finishedAt: row.finishedAt, durationMs: row.durationMs,
      queued: row.queued, processed: row.processed, completed: row.completed, failed: row.failed, blocked: row.blocked,
      skipped: row.skipped, continuation: row.continuation, errorCode: row.errorCode,
      unfinished: row.status === 'started' && at - Date.parse(row.startedAt) > UNFINISHED_AFTER_MS,
    }));
    return { available: true, includesService, ticks, window: { ...window, retainedCount: totals[0].n, truncated: totals[0].n > ticks.length } };
  } catch {
    return { available: false, includesService, ticks: [], window: { ...window, retainedCount: null, truncated: false } };
  }
}

/** Queue delay is creation minus scheduled time, not provider start. Values are descriptive, not an SLA or causal estimate. */
export function executionDelays(scheduledFor: number, createdAt: string, completedAt: string | null) {
  const delay = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? Math.max(0, Date.parse(value) - scheduledFor) : null;
  return { queueDelayMs: delay(createdAt), completionDelayMs: delay(completedAt) };
}
export function summarizeExecutionDelays(executions: { createdAt: string; queueDelayMs: number | null; completionDelayMs: number | null }[], totalCount: number, checkedAt = Date.now()): ExecutionDelaySummary {
  const queue = executions.map(e => e.queueDelayMs).filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  const complete = executions.map(e => e.completionDelayMs).filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  const dates = executions.map(e => e.createdAt).sort();
  const percentile = (values: number[], p: number) => values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
  return {
    sampleSize: executions.length, totalCount, limit: HISTORY_DISPLAY_LIMIT, truncated: totalCount > executions.length,
    observedFrom: dates[0] || null, observedTo: dates.at(-1) || null, checkedAt: new Date(checkedAt).toISOString(),
    includesImmediateRuns: true, queueSampleSize: queue.length, completionSampleSize: complete.length,
    queueP50Ms: percentile(queue, .5), queueP95Ms: percentile(queue, .95), queueMaxMs: queue.at(-1) ?? null,
    completionP50Ms: percentile(complete, .5), completionP95Ms: percentile(complete, .95), queueOverOneHourCount: queue.filter(v => v > 3600000).length,
  };
}

import { env } from 'cloudflare:workers';
import { ProductError } from './product-validation';
import { hash, integrationDb, isoNow } from './integration-security';

export type UsageWindow = { limit: number; used: number; remaining: number; resetsAt: string };
export type UsageStatus = { plan: 'free'; timezone: 'UTC'; unit: 'reserved_ai_call'; daily: UsageWindow; monthly: UsageWindow; serviceDaily: UsageWindow; serviceMonthly: UsageWindow; available: number; note: string };
type BudgetEnv = typeof env & { AI_USER_DAILY_LIMIT?: string; AI_USER_MONTHLY_LIMIT?: string; AI_GLOBAL_DAILY_LIMIT?: string; AI_GLOBAL_MONTHLY_LIMIT?: string };
type Bucket = { id: string; limit: number; expires: number };
function limit(raw: string | undefined, ceiling: number): number { if (raw === undefined || raw === '') return ceiling; const n = Number(raw); if (!Number.isSafeInteger(n) || n < 0) return 0; return Math.min(n, ceiling); }
async function buckets(ownerId: string, time = new Date()): Promise<Bucket[]> {
  const config = env as BudgetEnv, owner = await hash(ownerId), day = time.toISOString().slice(0, 10), month = day.slice(0, 7);
  const dayEnd = Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate() + 1), monthEnd = Date.UTC(time.getUTCFullYear(), time.getUTCMonth() + 1, 1);
  return [
    { id: `user:${owner}:day:${day}`, limit: limit(config.AI_USER_DAILY_LIMIT, 10), expires: dayEnd },
    { id: `user:${owner}:month:${month}`, limit: limit(config.AI_USER_MONTHLY_LIMIT, 100), expires: monthEnd },
    { id: `service:day:${day}`, limit: limit(config.AI_GLOBAL_DAILY_LIMIT, 50), expires: dayEnd },
    { id: `service:month:${month}`, limit: limit(config.AI_GLOBAL_MONTHLY_LIMIT, 500), expires: monthEnd },
  ];
}
/** Reserve all user/service budgets atomically. operation is a stable unique request ID, not a label. */
export async function reserveAiUsage(ownerId: string, units: number, operation: string): Promise<void> {
  if (!ownerId || !Number.isSafeInteger(units) || units < 1 || units > 100 || operation.length < 5 || operation.length > 200) throw new ProductError(400, 'Invalid AI usage reservation.', 'invalid_usage_reservation');
  const id = await hash(`${ownerId}\n${operation}`), db = integrationDb();
  const prior = await db.prepare('SELECT owner_id,operation,units FROM ai_usage_reservations WHERE id=?').bind(id).first<{ owner_id: string; operation: string; units: number }>();
  if (prior) { if (prior.owner_id !== ownerId || prior.operation !== operation || prior.units !== units) throw new ProductError(409, 'The operation already has a different usage reservation.', 'usage_reservation_conflict'); return; }
  const target = await buckets(ownerId), token = crypto.randomUUID();
  const values = target.flatMap(b => [b.id, b.limit, b.expires]);
  const cte = 'WITH target(id,maximum,expires) AS (VALUES (?,?,?),(?,?,?),(?,?,?),(?,?,?)) ';
  // D1 batch is a transaction. The claim and all four increments commit together or roll back together.
  // A duplicate operation cannot match the fresh claim token in the second statement.
  const result = await db.batch([
    db.prepare(cte + 'INSERT INTO ai_usage_reservations (id,owner_id,operation,units,claim_token,created_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM target t LEFT JOIN ai_usage_buckets b ON b.id=t.id WHERE coalesce(b.count,0)+? > t.maximum) ON CONFLICT(id) DO NOTHING').bind(...values, id, ownerId, operation, units, token, isoNow(), units),
    db.prepare(cte + 'INSERT INTO ai_usage_buckets (id,count,expires_at) SELECT id,?,expires FROM target WHERE EXISTS (SELECT 1 FROM ai_usage_reservations WHERE id=? AND claim_token=?) ON CONFLICT(id) DO UPDATE SET count=ai_usage_buckets.count+excluded.count').bind(...values, units, id, token),
  ]);
  if (result[0].meta.changes === 1 && result[1].meta.changes === 4) return;
  const existing = await db.prepare('SELECT owner_id,operation,units FROM ai_usage_reservations WHERE id=?').bind(id).first<{ owner_id: string; operation: string; units: number }>();
  if (existing?.owner_id === ownerId && existing.operation === operation && existing.units === units) return;
  if (existing) throw new ProductError(409, 'The operation already has a different usage reservation.', 'usage_reservation_conflict');
  throw new ProductError(429, 'The free AI allowance is exhausted. Check usage for the next UTC reset. Reserved or possibly delivered requests are not automatically refunded.', 'ai_usage_exhausted');
}
export async function getUsageStatus(ownerId: string): Promise<UsageStatus> {
  const target = await buckets(ownerId);
  const rows = await integrationDb().prepare('SELECT id,count FROM ai_usage_buckets WHERE id IN (?,?,?,?)').bind(...target.map(b => b.id)).all<{ id: string; count: number }>();
  const windows = target.map(b => { const used = rows.results.find(r => r.id === b.id)?.count || 0; return { limit: b.limit, used, remaining: Math.max(0, b.limit - used), resetsAt: new Date(b.expires).toISOString() }; });
  return { plan: 'free', timezone: 'UTC', unit: 'reserved_ai_call', daily: windows[0], monthly: windows[1], serviceDaily: windows[2], serviceMonthly: windows[3], available: Math.min(...windows.map(w => w.remaining)), note: 'One reserved unit permits one provider request, including answers, suggestions, documents and assistant messages. Analysis runs reserve their full question × model count before starting. Failed or ambiguous requests are not refunded automatically. Demo data does not use the allowance.' };
}

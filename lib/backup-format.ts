import { z } from 'zod';

export const BACKUP_FORMAT = 'lumen-workspace-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_MAX_BYTES = 8 * 1024 * 1024;
export const BACKUP_MAX_ROWS = 20000;
export const BACKUP_MIGRATIONS = [
  { name: '0000_yummy_hannibal_king.sql', sha256: 'a03dba2214e85b1f91d9d7aaaccbf916aa2462ce9eaf76754631d15877372f1b' },
  { name: '0001_rapid_songbird.sql', sha256: '2820f179dd24c16a09d34ec7254b34995268f73ff015fc6f61585ad0fe4601b2' },
  { name: '0002_nostalgic_wasp.sql', sha256: 'a233d6a33f208b4889df5ac57dfd1f694e10ed71744f96b0def8142f4783dde2' },
] as const;
export class BackupError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}
const id = z.string().uuid(), date = z.string().datetime(), nullableDate = date.nullable();
const str = (max = 2000) => z.string().max(max);
const num = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const flag = z.union([z.literal(0), z.literal(1)]);
const mode = z.enum(['live', 'demo']);
function jsonText(schema: z.ZodTypeAny, max = 200000) {
  return str(max).refine(value => { try { return schema.safeParse(JSON.parse(value)).success; } catch { return false; } }, 'Invalid structured JSON field');
}
const models = jsonText(z.array(str(100).min(1)).min(1).max(10), 2000);
const promptIds = jsonText(z.array(id).max(1000), 50000).nullable();
const citation = z.object({ url: str(10000), title: str(10000), domain: str(300), startIndex: num, endIndex: num, provenance: z.enum(['provider_annotation', 'synthetic']) }).strict();
const mention = z.object({ name: str(500), domain: str(300), mentioned: z.boolean(), firstPosition: num.nullable(), rank: num.nullable(), cited: z.boolean() }).strict();
const report = z.object({ startDate: str(10), endDate: str(10), totalSessions: num, totalUsers: num, totalViews: num, aiSessions: num, rows: z.array(z.object({ date: str(20), source: str(500), medium: str(500), sessions: num, views: num }).strict()).max(10000), dataQuality: z.object({ subjectToThresholding: z.boolean(), dataLossFromOtherRow: z.boolean(), sampled: z.boolean() }).strict(), timeZone: str(100).nullable().optional() }).strict();
const siteFields = { id, name: str(200), domain: str(300), description: str(5000), industry: str(200), language: str(100), country: str(100), mode, created_at: date, updated_at: date };
const child = { id, site_id: id };
const table = (shape: z.ZodRawShape, maxRows: number, maxBytes: number) => ({ schema: z.object(shape).strict(), maxRows, maxBytes });
const KiB = 1024;
/** Explicit export allowlist. Never SELECT *; credentials are not read into memory. */
export const BACKUP_TABLES = {
  sites: table(siteFields, 1, 32 * KiB),
  prompts: table({ ...child, text: str(5000), topic: str(300), intent: z.enum(['informational', 'comparison', 'transactional']), active: flag, pinned: flag, created_at: date }, 1000, 256 * KiB),
  competitors: table({ ...child, name: str(200), domain: str(300), created_at: date }, 100, 64 * KiB),
  runs: table({ ...child, mode, status: z.enum(['queued', 'running', 'completed', 'partial', 'failed']), models, total: num, completed: num, failed: num, created_at: date, completed_at: nullableDate, error: str(5000).nullable() }, 6000, 1024 * KiB),
  answers: table({ ...child, run_id: id, prompt_id: id, prompt_text: str(5000), model: str(100), provider: str(100), mode, status: z.enum(['pending', 'processing', 'completed', 'failed']), text: str(1000000), citations: jsonText(z.array(citation).max(1000), 500000), mentions: jsonText(z.array(mention).max(100), 100000), input_tokens: num, output_tokens: num, provider_response_id: str(500).nullable(), error: str(5000).nullable(), created_at: date, completed_at: nullableDate }, 10000, 4 * 1024 * KiB),
  documents: table({ ...child, kind: z.enum(['report', 'content']), title: str(300), content: str(1000000), format: str(100), mode, created_at: date }, 1000, 1024 * KiB),
  tasks: table({ ...child, title: str(300), description: str(10000), status: z.enum(['todo', 'in_progress', 'done']), priority: z.enum(['high', 'medium', 'low']), created_at: date, updated_at: date }, 1000, 256 * KiB),
  personas: table({ ...child, name: str(200), description: str(5000), prompt_prefix: str(5000), created_at: date }, 100, 128 * KiB),
  traffic: table({ ...child, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source: str(100), path: str(1000), visits: num }, 6000, 512 * KiB),
  collection_schedules: table({ ...child, name: str(200), enabled: flag, frequency: z.enum(['daily', 'weekly']), timezone: str(100), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59), weekdays: jsonText(z.array(z.number().int().min(0).max(6)).max(7), 100), models, prompt_ids: promptIds, next_run_at: num, ends_at: num.nullable(), last_run_at: num.nullable(), last_status: str(100).nullable(), deleted_at: nullableDate, created_at: date, updated_at: date }, 100, 128 * KiB),
  scheduled_executions: table({ ...child, schedule_id: id.nullable(), schedule_name: str(200), scheduled_for: num, status: z.enum(['queued', 'running', 'completed', 'partial', 'failed', 'blocked', 'cancelled']), run_id: id.nullable(), configuration: jsonText(z.object({ models: z.array(str(100)).min(1).max(10), promptIds: z.array(id).max(1000).nullable() }).strict(), 50000), attempts: num, completed: num, failed: num, total: num, error_code: str(200).nullable(), message: str(5000).nullable(), created_at: date, updated_at: date, completed_at: nullableDate }, 6000, 1024 * KiB),
  operation_alerts: table({ ...child, execution_id: id.nullable(), severity: z.enum(['warning', 'critical']), code: str(200), title: str(500), message: str(5000), status: z.enum(['open', 'acknowledged', 'resolved']), created_at: date, updated_at: date }, 1000, 256 * KiB),
  operation_audit: table({ ...child, action: str(200), subject_id: id.nullable(), summary: str(5000), created_at: date }, 4000, 512 * KiB),
  ga4_connections: table({ site_id: id, property_id: z.string().regex(/^\d{1,20}$/).nullable(), property_name: str(200).nullable(), report: jsonText(report, 500000).nullable(), last_synced_at: nullableDate, created_at: date, updated_at: date }, 1, 512 * KiB),
} as const;
export type BackupTableName = keyof typeof BACKUP_TABLES;
export type BackupRow = Record<string, string | number | null>;
export type BackupTables = Record<BackupTableName, BackupRow[]>;
export const BACKUP_TABLE_NAMES = Object.keys(BACKUP_TABLES) as BackupTableName[];
const tableSchemas = Object.fromEntries(BACKUP_TABLE_NAMES.map(name => [name, z.array(BACKUP_TABLES[name].schema).max(BACKUP_TABLES[name].maxRows)]));
const countSchemas = Object.fromEntries(BACKUP_TABLE_NAMES.map(name => [name, num]));
const payloadSchema = z.object({
  format: z.literal(BACKUP_FORMAT), version: z.literal(BACKUP_VERSION),
  schemaMigrations: z.array(z.object({ name: str(100), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).length(BACKUP_MIGRATIONS.length),
  exportedAt: date,
  scope: z.object({ kind: z.literal('workspace'), sourceSiteId: id }).strict(),
  policy: z.object({ credentials: z.literal('excluded'), restoration: z.literal('isolated-disabled-copy') }).strict(),
  counts: z.object(countSchemas).strict(), tables: z.object(tableSchemas).strict(),
}).strict();
const backupSchema = payloadSchema.extend({ integrity: z.object({ algorithm: z.literal('SHA-256'), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict() });
export type WorkspaceBackup = {
  format: typeof BACKUP_FORMAT; version: typeof BACKUP_VERSION; schemaMigrations: { name: string; sha256: string }[];
  exportedAt: string; scope: { kind: 'workspace'; sourceSiteId: string };
  policy: { credentials: 'excluded'; restoration: 'isolated-disabled-copy' };
  counts: Record<BackupTableName, number>; tables: BackupTables;
  integrity: { algorithm: 'SHA-256'; digest: string };
};
/** Canonical JSON is used for corruption detection, not authentication or encryption. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function sha256(value: string): Promise<string> { const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join(''); }
function fail(message = 'Backup data is invalid or incomplete.'): never { throw new BackupError('backup_invalid', message); }
export function validateRelationships(data: WorkspaceBackup): void {
  const { tables, scope } = data;
  if (tables.sites.length !== 1 || tables.sites[0].id !== scope.sourceSiteId) fail();
  let total = 0;
  const ids = new Map<BackupTableName, Set<string>>();
  for (const name of BACKUP_TABLE_NAMES) {
    const rows = tables[name]; total += rows.length;
    if (data.counts[name] !== rows.length) fail();
    const seen = new Set<string>(); ids.set(name, seen);
    for (const row of rows) {
      const key = String(name === 'ga4_connections' ? row.site_id : row.id);
      if (seen.has(key)) fail(); seen.add(key);
      if (name !== 'sites' && row.site_id !== scope.sourceSiteId) fail('Backup crosses a workspace boundary.');
    }
  }
  if (total > BACKUP_MAX_ROWS) throw new BackupError('backup_too_large', 'Backup exceeds the supported row limit.', 413);
  const exists = (name: BackupTableName, value: unknown) => value === null || ids.get(name)?.has(String(value));
  const runsById = new Map(tables.runs.map(run => [run.id, run]));
  const answersByRun = new Map<string | number | null, BackupRow[]>();
  for (const a of tables.answers) {
    const group = answersByRun.get(a.run_id) || []; group.push(a); answersByRun.set(a.run_id, group);
    if (!exists('runs', a.run_id)) fail('Answer has no parent run.');
    const run = runsById.get(a.run_id);
    if (run?.mode !== a.mode) fail('Answer and run modes differ.');
  }
  const answerKeys = new Set<string>();
  for (const a of tables.answers) { const key = `${a.run_id}:${a.prompt_id}:${a.model}`; if (answerKeys.has(key)) fail(); answerKeys.add(key); }
  for (const run of tables.runs) {
    const rows = answersByRun.get(run.id) || [];
    if (run.mode !== tables.sites[0].mode) fail('Run and workspace modes differ.');
    if (rows.length !== run.total) fail('Run answer count is incomplete.');
    if (['completed', 'partial', 'failed'].includes(String(run.status)) && (rows.some(a => ['pending', 'processing'].includes(String(a.status))) || rows.filter(a => a.status === 'completed').length !== run.completed || rows.filter(a => a.status === 'failed').length !== run.failed)) fail('Terminal run counters are inconsistent.');
  }
  const occurrenceKeys = new Set<string>();
  for (const e of tables.scheduled_executions) {
    if (!exists('collection_schedules', e.schedule_id) || !exists('runs', e.run_id)) fail('Execution references a missing parent.');
    if (e.schedule_id !== null) { const key = `${e.schedule_id}:${e.scheduled_for}`; if (occurrenceKeys.has(key)) fail(); occurrenceKeys.add(key); }
  }
  for (const alert of tables.operation_alerts) if (!exists('scheduled_executions', alert.execution_id)) fail('Alert references a missing execution.');
  // answers.prompt_id intentionally has no FK: deleted prompts retain historical answers.
}
export async function validateBackup(input: unknown): Promise<WorkspaceBackup> {
  const result = backupSchema.safeParse(input); if (!result.success) fail();
  const data = result.data as WorkspaceBackup;
  if (canonicalJson(data.schemaMigrations) !== canonicalJson(BACKUP_MIGRATIONS)) throw new BackupError('backup_schema_unsupported', 'Backup schema version is not supported.');
  if (new TextEncoder().encode(canonicalJson(data)).byteLength > BACKUP_MAX_BYTES) throw new BackupError('backup_too_large', 'Backup exceeds the supported byte limit.', 413);
  validateRelationships(data);
  const { integrity, ...payload } = data;
  if (await sha256(canonicalJson(payload)) !== integrity.digest) throw new BackupError('backup_digest_mismatch', 'Backup integrity check failed.');
  return data;
}
export async function createBackup(siteId: string, tables: BackupTables, exportedAt = new Date().toISOString()): Promise<WorkspaceBackup> {
  const payload = { format: BACKUP_FORMAT, version: BACKUP_VERSION, schemaMigrations: [...BACKUP_MIGRATIONS], exportedAt, scope: { kind: 'workspace' as const, sourceSiteId: siteId }, policy: { credentials: 'excluded' as const, restoration: 'isolated-disabled-copy' as const }, counts: Object.fromEntries(BACKUP_TABLE_NAMES.map(name => [name, tables[name].length])) as Record<BackupTableName, number>, tables };
  return validateBackup({ ...payload, integrity: { algorithm: 'SHA-256', digest: await sha256(canonicalJson(payload)) } });
}

import { z } from 'zod';
import { impactPlanSchema, impactSearchSchema, impactOutcomeSchema, assertSearchMatchesPlan, assertOutcomeMatchesPlan } from './impact-validation';
import { IMPACT_METRIC_VERSION, type ImpactPlan, type ImpactSearchInput, type ImpactOutcomeInput } from './impact-types';
import { impactDigest } from './impact-integrity';
import { impactBaselinePayloadSchema } from './impact-baseline-validation';
import { impactBaselineQueryKey } from './impact-baseline-integrity';
import { impactCheckPayloadSchema, assertImpactCheckMatchesBaselines } from './impact-check-validation';
import { impactCheckDigest } from './impact-check-integrity';

export const BACKUP_FORMAT = 'lumen-workspace-backup';
export const BACKUP_VERSION = 5;
export const PREVIOUS_BACKUP_VERSION = 4;
export const V3_BACKUP_VERSION = 3;
export const V2_BACKUP_VERSION = 2;
export const LEGACY_BACKUP_VERSION = 1;
export const BACKUP_MAX_BYTES = 8 * 1024 * 1024;
export const BACKUP_MAX_ROWS = 20000;
export const LEGACY_BACKUP_MIGRATIONS = [
  { name: '0000_yummy_hannibal_king.sql', sha256: 'a03dba2214e85b1f91d9d7aaaccbf916aa2462ce9eaf76754631d15877372f1b' },
  { name: '0001_rapid_songbird.sql', sha256: '2820f179dd24c16a09d34ec7254b34995268f73ff015fc6f61585ad0fe4601b2' },
  { name: '0002_nostalgic_wasp.sql', sha256: 'a233d6a33f208b4889df5ac57dfd1f694e10ed71744f96b0def8142f4783dde2' },
] as const;
// Append new, checksum-pinned migrations here; the V1 manifest stays immutable.
export const V2_BACKUP_MIGRATIONS = [
  ...LEGACY_BACKUP_MIGRATIONS,
  { name: '0003_closed_santa_claus.sql', sha256: 'd1e95bbc9d9b606e51322a7caadae770e653c58d99d757f7f43d0f54915b338e' },
] as const;
// New migrations are appended without changing either historical manifest.
export const V3_BACKUP_MIGRATIONS = [...V2_BACKUP_MIGRATIONS,
  { name: '0004_medical_master_chief.sql', sha256: 'ecf08e5e834514f01b6a7c111b0ef33fc848d31d2296f854f5a10e5c51a94d7d' },
] as const;
export const V4_BACKUP_MIGRATIONS = [...V3_BACKUP_MIGRATIONS,
  { name: '0005_freezing_jackpot.sql', sha256: 'ce16c150df8265dc191712d5b1bc730a012446041d28436cbf22b18d4d260ecb' },
] as const;
export const BACKUP_MIGRATIONS = [...V4_BACKUP_MIGRATIONS,
  { name: '0006_opposite_fenris.sql', sha256: 'cede6da309649d7e6072bf8bf72c55df360e3b4b9af3e0df944f98a12700f867' },
] as const;
export class BackupError extends Error {
  code: string;
  status: number;
  issues?: { code: string; path: (string | number)[] }[];
  constructor(code: string, message: string, status = 400, issues?: { code: string; path: (string | number)[] }[]) { super(message); this.code = code; this.status = status; this.issues = issues; }
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
const experimentSnapshot = z.object({
  version: z.literal('lumen-experiment-v1'), mode,
  brands: z.array(z.object({ name: str(200).min(1), domain: str(300).min(1) }).strict()).min(1).max(21),
  cells: z.array(z.object({ question: str(5000).min(1), model: str(100).min(1), provider: str(100).min(1), status: z.enum(['completed', 'failed']), mentioned: z.boolean(), cited: z.boolean() }).strict()).min(1).max(60),
  capturedAt: date,
}).strict();
type ExperimentSnapshot = z.infer<typeof experimentSnapshot>;
const siteFields = { id, name: str(200), domain: str(300), description: str(5000), industry: str(200), language: str(100), country: str(100), mode, created_at: date, updated_at: date };
const child = { id, site_id: id };
const evidenceFields = { ...child, study_id: id, created_at: date, digest: z.string().regex(/^[a-f0-9]{64}$/), voided_at: nullableDate, void_reason: str(1000).min(3).nullable() };
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
  improvement_experiments: table({ ...child, title: str(200).min(3), hypothesis: str(2000).min(5), intervention: str(2000).min(3), metric: z.enum(['mentionRate', 'citationRate']), target_delta: z.number().int().min(1).max(100), status: z.enum(['draft', 'observing', 'reviewed']), baseline_run_id: id, followup_run_id: id.nullable(), baseline_snapshot: jsonText(experimentSnapshot, 500000), followup_snapshot: jsonText(experimentSnapshot, 500000).nullable(), notes: str(4000), created_at: date, updated_at: date }, 100, 512 * KiB),
  impact_studies: table({ ...child, plan: jsonText(impactPlanSchema, 100000), brand: jsonText(z.object({ name: str(200).min(1), domain: str(300).min(1) }).strict(), 1000), metric_version: z.literal(IMPACT_METRIC_VERSION), created_at: date, digest: z.string().regex(/^[a-f0-9]{64}$/) }, 50, 512 * KiB),
  impact_searches: table({ ...evidenceFields, phase: z.enum(['before', 'after']), query_id: id, repetition: z.number().int().min(1).max(3), payload: jsonText(impactSearchSchema, 100000) }, 5000, 3 * 1024 * KiB),
  impact_outcomes: table({ ...evidenceFields, arm: z.enum(['treatment', 'control']), phase: z.enum(['before', 'after']), payload: jsonText(impactOutcomeSchema, 20000) }, 1000, 1024 * KiB),
  impact_baselines: table({ ...child, study_id: id, query_key: z.string().regex(/^[a-f0-9]{64}$/), payload: jsonText(impactBaselinePayloadSchema, 20000), created_at: date, digest: z.string().regex(/^[a-f0-9]{64}$/) }, 100, 512 * KiB),
  impact_checks: table({ ...child, study_id: id, payload: jsonText(impactCheckPayloadSchema, 100000), created_at: date, digest: z.string().regex(/^[a-f0-9]{64}$/) }, 20, 1024 * KiB),
} as const;
export type BackupTableName = keyof typeof BACKUP_TABLES;
export type BackupRow = Record<string, string | number | null>;
export type BackupTables = Record<BackupTableName, BackupRow[]>;
export const BACKUP_TABLE_NAMES = Object.keys(BACKUP_TABLES) as BackupTableName[];
// Freeze the historical table inventory as well as its migration manifest.
export const LEGACY_BACKUP_TABLE_NAMES = ['sites', 'prompts', 'competitors', 'runs', 'answers', 'documents', 'tasks', 'personas', 'traffic', 'collection_schedules', 'scheduled_executions', 'operation_alerts', 'operation_audit', 'ga4_connections'] as const satisfies readonly BackupTableName[];
type LegacyBackupTableName = typeof LEGACY_BACKUP_TABLE_NAMES[number];
export const V2_BACKUP_TABLE_NAMES = [...LEGACY_BACKUP_TABLE_NAMES, 'improvement_experiments'] as const satisfies readonly BackupTableName[];
export const V3_BACKUP_TABLE_NAMES = [...V2_BACKUP_TABLE_NAMES, 'impact_studies', 'impact_searches', 'impact_outcomes'] as const satisfies readonly BackupTableName[];
export const V4_BACKUP_TABLE_NAMES = [...V3_BACKUP_TABLE_NAMES, 'impact_baselines'] as const satisfies readonly BackupTableName[];
type BackupVersion = typeof BACKUP_VERSION | typeof PREVIOUS_BACKUP_VERSION | typeof V3_BACKUP_VERSION | typeof V2_BACKUP_VERSION | typeof LEGACY_BACKUP_VERSION;
const tableNamesFor = (version: BackupVersion) => version === 1 ? LEGACY_BACKUP_TABLE_NAMES : version === 2 ? V2_BACKUP_TABLE_NAMES : version === 3 ? V3_BACKUP_TABLE_NAMES : version === 4 ? V4_BACKUP_TABLE_NAMES : BACKUP_TABLE_NAMES;
const migrationsFor = (version: BackupVersion) => version === 1 ? LEGACY_BACKUP_MIGRATIONS : version === 2 ? V2_BACKUP_MIGRATIONS : version === 3 ? V3_BACKUP_MIGRATIONS : version === 4 ? V4_BACKUP_MIGRATIONS : BACKUP_MIGRATIONS;
function backupSchemaFor(version: BackupVersion) {
  const names = tableNamesFor(version);
  const manifest = migrationsFor(version);
  const tableSchemas = Object.fromEntries(names.map(name => [name, z.array(BACKUP_TABLES[name].schema).max(BACKUP_TABLES[name].maxRows)]));
  const countSchemas = Object.fromEntries(names.map(name => [name, num]));
  return z.object({
    format: z.literal(BACKUP_FORMAT), version: z.literal(version),
    schemaMigrations: z.array(z.object({ name: str(100), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).length(manifest.length),
    exportedAt: date,
    scope: z.object({ kind: z.literal('workspace'), sourceSiteId: id }).strict(),
    policy: z.object({ credentials: z.literal('excluded'), restoration: z.literal('isolated-disabled-copy') }).strict(),
    counts: z.object(countSchemas).strict(), tables: z.object(tableSchemas).strict(),
    integrity: z.object({ algorithm: z.literal('SHA-256'), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  }).strict();
}
const currentBackupSchema = backupSchemaFor(BACKUP_VERSION);
const previousBackupSchema = backupSchemaFor(PREVIOUS_BACKUP_VERSION);
const v3BackupSchema = backupSchemaFor(V3_BACKUP_VERSION);
const v2BackupSchema = backupSchemaFor(V2_BACKUP_VERSION);
const legacyBackupSchema = backupSchemaFor(LEGACY_BACKUP_VERSION);
export type WorkspaceBackup = {
  format: typeof BACKUP_FORMAT; version: BackupVersion; schemaMigrations: { name: string; sha256: string }[];
  exportedAt: string; scope: { kind: 'workspace'; sourceSiteId: string };
  policy: { credentials: 'excluded'; restoration: 'isolated-disabled-copy' };
  counts: Record<LegacyBackupTableName, number> & Partial<Record<Exclude<BackupTableName, LegacyBackupTableName>, number>>;
  tables: Record<LegacyBackupTableName, BackupRow[]> & Partial<Record<Exclude<BackupTableName, LegacyBackupTableName>, BackupRow[]>>;
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
  const names = tableNamesFor(data.version);
  for (const name of names) {
    const rows = tables[name]!; total += rows.length;
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
  for (const experiment of tables.improvement_experiments || []) {
    if (!exists('runs', experiment.baseline_run_id) || !exists('runs', experiment.followup_run_id)) fail('Experiment references a missing run.');
    if ((experiment.followup_run_id === null) !== (experiment.followup_snapshot === null)) fail('Experiment follow-up evidence is incomplete.');
    if (experiment.status === 'reviewed' && experiment.followup_run_id === null) fail('Reviewed experiment has no follow-up evidence.');
    const baseline = JSON.parse(String(experiment.baseline_snapshot)) as ExperimentSnapshot;
    const followup = experiment.followup_snapshot === null ? null : JSON.parse(String(experiment.followup_snapshot)) as ExperimentSnapshot;
    const cohort = (snapshot: ExperimentSnapshot) => snapshot.cells.map(cell => JSON.stringify([cell.question, cell.model, cell.provider])).sort();
    for (const [snapshot, runId] of [[baseline, experiment.baseline_run_id], [followup, experiment.followup_run_id]] as const) {
      if (!snapshot) continue;
      if (snapshot.mode !== tables.sites[0].mode || snapshot.mode !== runsById.get(runId)?.mode) fail('Experiment snapshot and run modes differ.');
      if (new Set(cohort(snapshot)).size !== snapshot.cells.length) fail('Experiment contains duplicate cohort cells.');
    }
    if (followup && (canonicalJson(baseline.brands) !== canonicalJson(followup.brands) || canonicalJson(cohort(baseline)) !== canonicalJson(cohort(followup)))) fail('Experiment follow-up cohort differs from its baseline.');
  }
  const studies = new Map((tables.impact_studies || []).map(row => [row.id, JSON.parse(String(row.plan)) as ImpactPlan]));
  for (const name of ['impact_searches', 'impact_outcomes'] as const) {
    const activeKeys = new Set<string>();
    for (const row of tables[name] || []) {
      const plan = studies.get(row.study_id);
      if (!plan) fail('Impact evidence references a missing study.');
      if ((row.voided_at === null) !== (row.void_reason === null) || row.voided_at !== null && Date.parse(String(row.voided_at)) < Date.parse(String(row.created_at))) fail('Impact evidence has invalid exclusion history.');
      const payload = JSON.parse(String(row.payload));
      if (payload.phase !== row.phase) fail('Impact evidence index differs from its original record.');
      let key: string;
      try {
        if (name === 'impact_searches') {
          if (payload.queryId !== row.query_id || payload.repetition !== row.repetition) fail('Impact search index differs from its original record.');
          assertSearchMatchesPlan(plan, payload as ImpactSearchInput, Date.parse(String(row.created_at)));
          key = JSON.stringify([row.study_id, row.phase, row.query_id, row.repetition]);
        } else {
          if (payload.arm !== row.arm) fail('Impact outcome index differs from its original record.');
          assertOutcomeMatchesPlan(plan, payload as ImpactOutcomeInput, Date.parse(String(row.created_at)));
          key = JSON.stringify([row.study_id, row.arm, row.phase]);
        }
      } catch { fail('Impact evidence is inconsistent with the frozen study plan.'); }
      if (row.voided_at === null) {
        if (activeKeys.has(key!)) fail('Impact evidence contains duplicate active records.');
        activeKeys.add(key!);
      }
    }
  }
  for (const row of tables.impact_baselines || []) {
    const plan = studies.get(row.study_id);
    if (!plan) fail('GA4 baseline references a missing study.');
    const payload = JSON.parse(String(row.payload));
    if (payload.requestedStartDate !== plan.beforeStart || payload.requestedEndDate !== plan.beforeEnd) fail('GA4 baseline differs from its frozen study window.');
    if (Date.parse(payload.fetchedAt) > Date.parse(String(row.created_at))) fail('GA4 baseline was saved before its observation.');
  }
  for (const row of tables.impact_checks || []) {
    const plan = studies.get(row.study_id);
    if (!plan) fail('Deployment check references a missing study.');
    const baselines = (tables.impact_searches || []).filter(search => search.study_id === row.study_id).map(search => ({ ...JSON.parse(String(search.payload)), digest: String(search.digest), voidedAt: search.voided_at === null ? null : String(search.voided_at) }));
    try { assertImpactCheckMatchesBaselines(plan, JSON.parse(String(row.payload)), baselines, Date.parse(String(row.created_at)), true); }
    catch { fail('Deployment check references or chronology are inconsistent with its original baseline.'); }
  }
  for (const name of ['impact_baselines', 'impact_checks'] as const) {
    const columns = Object.keys(BACKUP_TABLES[name].schema.shape);
    const overhead = columns.reduce((size, key) => size + JSON.stringify(key).length + 2, 2);
    const bytes = (tables[name] || []).reduce((size, row) => size + new TextEncoder().encode(JSON.stringify(columns.map(key => row[key]))).byteLength + overhead, 0);
    if (bytes > BACKUP_TABLES[name].maxBytes) throw new BackupError('backup_too_large', 'Impact reference data exceeds its supported byte limit.', 413);
  }
  // answers.prompt_id intentionally has no FK: deleted prompts retain historical answers.
}
export async function validateBackup(input: unknown): Promise<WorkspaceBackup> {
  const version = input !== null && typeof input === 'object' && !Array.isArray(input) ? (input as { version?: unknown }).version : undefined;
  if (version !== LEGACY_BACKUP_VERSION && version !== V2_BACKUP_VERSION && version !== V3_BACKUP_VERSION && version !== PREVIOUS_BACKUP_VERSION && version !== BACKUP_VERSION) throw new BackupError('backup_schema_unsupported', 'Backup schema version is not supported.');
  const result = (version === LEGACY_BACKUP_VERSION ? legacyBackupSchema : version === V2_BACKUP_VERSION ? v2BackupSchema : version === V3_BACKUP_VERSION ? v3BackupSchema : version === PREVIOUS_BACKUP_VERSION ? previousBackupSchema : currentBackupSchema).safeParse(input);
  if (!result.success) throw new BackupError('backup_invalid', 'Backup data is invalid or incomplete.', 400, result.error.issues.slice(0, 20).map(issue => ({ code: issue.code, path: issue.path }))); 
  const data = result.data as WorkspaceBackup;
  const manifest = migrationsFor(version);
  if (canonicalJson(data.schemaMigrations) !== canonicalJson(manifest)) throw new BackupError('backup_schema_unsupported', 'Backup schema version is not supported.');
  if (new TextEncoder().encode(canonicalJson(data)).byteLength > BACKUP_MAX_BYTES) throw new BackupError('backup_too_large', 'Backup exceeds the supported byte limit.', 413);
  validateRelationships(data);
  const { integrity, ...payload } = data;
  if (await sha256(canonicalJson(payload)) !== integrity.digest) throw new BackupError('backup_digest_mismatch', 'Backup integrity check failed.');
  const studyDigests = new Map<string | number | null, string>();
  for (const row of data.tables.impact_studies || []) {
    const digest = await impactDigest({ metricVersion: row.metric_version, plan: JSON.parse(String(row.plan)), brand: JSON.parse(String(row.brand)) });
    if (digest !== row.digest) fail('Impact study integrity check failed.');
    studyDigests.set(row.id, digest);
  }
  for (const name of ['impact_searches', 'impact_outcomes'] as const) for (const row of data.tables[name] || []) {
    const digest = await impactDigest({ studyDigest: studyDigests.get(row.study_id), kind: name === 'impact_searches' ? 'add_search' : 'add_outcome', payload: JSON.parse(String(row.payload)) });
    if (digest !== row.digest) fail('Impact evidence integrity check failed.');
  }
  for (const row of data.tables.impact_baselines || []) {
    const payload = impactBaselinePayloadSchema.parse(JSON.parse(String(row.payload)));
    const queryKey = await impactBaselineQueryKey(payload);
    if (queryKey !== row.query_key) fail('GA4 baseline query integrity check failed.');
    const digest = await impactDigest({ studyDigest: studyDigests.get(row.study_id), kind: 'ga4_baseline', queryKey, payload });
    if (digest !== row.digest) fail('GA4 baseline evidence integrity check failed.');
  }
  for (const row of data.tables.impact_checks || []) {
    const payload = impactCheckPayloadSchema.parse(JSON.parse(String(row.payload)));
    const digest = await impactCheckDigest(studyDigests.get(row.study_id)!, payload);
    if (digest !== row.digest) fail('Deployment check integrity check failed.');
  }
  return data;
}
export async function createBackup(siteId: string, tables: BackupTables, exportedAt = new Date().toISOString()): Promise<WorkspaceBackup> {
  const payload = { format: BACKUP_FORMAT, version: BACKUP_VERSION, schemaMigrations: [...BACKUP_MIGRATIONS], exportedAt, scope: { kind: 'workspace' as const, sourceSiteId: siteId }, policy: { credentials: 'excluded' as const, restoration: 'isolated-disabled-copy' as const }, counts: Object.fromEntries(BACKUP_TABLE_NAMES.map(name => [name, tables[name].length])) as Record<BackupTableName, number>, tables };
  return validateBackup({ ...payload, integrity: { algorithm: 'SHA-256', digest: await sha256(canonicalJson(payload)) } });
}

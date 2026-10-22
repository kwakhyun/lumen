import { BACKUP_TABLE_NAMES, BackupError, canonicalJson, sha256, validateBackup } from './backup-format';
import type { BackupRow, BackupTables } from './backup-format';

export const RESTORE_OWNER = 'isolated-backup-verification';
const stoppedMessage = 'Stopped in an isolated backup restore. Original state remains in the backup file.';
const sensitiveTables = ['quotas', 'ai_usage_buckets', 'ai_usage_reservations', 'oauth_states', 'operation_heartbeats', 'operation_ticks', 'ai_eligibility'];
const ownerTables = new Set(['sites', 'collection_schedules', 'scheduled_executions', 'operation_alerts', 'operation_audit', 'ga4_connections']);
export type RestoreSummary = { sourceDigest: string; restoredDigest: string; rowCount: number; counts: Record<string, number>; remappedIds: number; disabledSchedules: number; stoppedAnswers: number; stoppedExecutions: number; foreignKeyViolations: number; integrity: 'ok'; credentials: 'excluded'; externalCalls: 0 };
/** Only called by the local Miniflare CLI/tests, never exported as an HTTP or MCP action. */
export async function restoreToEmptyDatabase(db: D1Database, input: unknown): Promise<RestoreSummary> {
  const backup = await validateBackup(input);
  // Refuse any preexisting product data, including quotas and credentials.
  for (const name of [...BACKUP_TABLE_NAMES, ...sensitiveTables]) {
    const row = await db.prepare(`SELECT count(*) AS n FROM "${name}"`).first<{ n: number }>();
    if (!row || row.n !== 0) throw new BackupError('restore_target_not_empty', 'Restore requires a new empty local database.');
  }
  const idMap = new Map<string, string>();
  function remap(value: string | number | null): string | null {
    if (value === null) return null;
    const old = String(value); if (!idMap.has(old)) idMap.set(old, crypto.randomUUID()); return idMap.get(old)!;
  }
  // Validate each historical digest first. Only the isolated copy gains empty
  // tables added later; never rewrite the historical envelope or its digest.
  const tables = Object.fromEntries(BACKUP_TABLE_NAMES.map(name => [name, structuredClone(backup.tables[name] || [])])) as BackupTables;
  let stoppedAnswers = 0, stoppedExecutions = 0;
  const newSiteId = remap(backup.scope.sourceSiteId)!;
  // A single map preserves the intentional execution.id === run.id relation.
  for (const name of BACKUP_TABLE_NAMES) for (const row of tables[name]) {
    if ('id' in row) row.id = remap(row.id);
    if ('site_id' in row) row.site_id = newSiteId;
    for (const key of ['run_id', 'prompt_id', 'schedule_id', 'execution_id', 'subject_id', 'baseline_run_id', 'followup_run_id', 'study_id']) if (key in row) row[key] = remap(row[key]);
    if (ownerTables.has(name)) row.owner_id = RESTORE_OWNER;
    if (name === 'sites') row.tracking_key = crypto.randomUUID();
    if (name === 'runs') { row.lease_token = null; row.lease_until = 0; }
    if (name === 'answers' && ['pending', 'processing'].includes(String(row.status))) { row.status = 'failed'; row.error = stoppedMessage; row.completed_at = backup.exportedAt; stoppedAnswers++; }
    if (name === 'collection_schedules') {
      row.enabled = 0;
      if (row.prompt_ids !== null) row.prompt_ids = JSON.stringify((JSON.parse(String(row.prompt_ids)) as string[]).map(remap));
    }
    if (name === 'scheduled_executions') {
      row.lease_token = null; row.lease_until = 0; row.next_attempt_at = 0;
      const config = JSON.parse(String(row.configuration));
      if (config.promptIds) config.promptIds = config.promptIds.map(remap);
      row.configuration = JSON.stringify(config);
      if (['queued', 'running'].includes(String(row.status))) { row.status = 'cancelled'; row.error_code = 'isolated_restore'; row.message = stoppedMessage; row.completed_at = backup.exportedAt; stoppedExecutions++; }
    }
    if (name === 'operation_alerts') row.dedupe_key = `restored:${row.id}`;
    if (name === 'ga4_connections') {
      row.status = 'disconnected'; row.refresh_cipher = null; row.access_cipher = null; row.access_expires = 0; row.scopes = ''; row.revision = 0; row.lease_token = null; row.lease_until = 0; row.error = null;
    }
  }
  const answersByRun = new Map<string, BackupRow[]>();
  for (const answer of tables.answers) { const key = String(answer.run_id), group = answersByRun.get(key) || []; group.push(answer); answersByRun.set(key, group); }
  for (const run of tables.runs) if (['queued', 'running'].includes(String(run.status))) {
    const answers = answersByRun.get(String(run.id)) || [];
    run.completed = answers.filter(a => a.status === 'completed').length;
    run.failed = answers.filter(a => a.status === 'failed').length;
    run.status = run.completed === run.total ? 'completed' : run.completed ? 'partial' : 'failed';
    run.error = stoppedMessage; run.completed_at = backup.exportedAt;
  }
  const statements: D1PreparedStatement[] = [];
  // The table order is parent-first. Every value is bound, never executable SQL.
  for (const name of BACKUP_TABLE_NAMES) for (const row of tables[name]) {
    const keys = Object.keys(row);
    statements.push(db.prepare(`INSERT INTO "${name}" (${keys.map(key => `"${key}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map(key => row[key])));
  }
  for (let i = 0; i < statements.length; i += 40) await db.batch(statements.slice(i, i + 40));
  const fk = await db.prepare('PRAGMA foreign_key_check').all();
  const integrity = await db.prepare('PRAGMA quick_check').all();
  if (fk.results.length || integrity.results.length !== 1 || !Object.values(integrity.results[0]).includes('ok')) throw new BackupError('restore_integrity_failed', 'Restored database failed integrity checks.');
  const counts: Record<string, number> = {};
  const actualTables: Record<string, BackupRow[]> = {};
  for (const name of BACKUP_TABLE_NAMES) {
    const rows = (await db.prepare(`SELECT * FROM "${name}" ORDER BY ${name === 'ga4_connections' ? 'site_id' : 'id'}`).all<BackupRow>()).results;
    counts[name] = rows.length;
    if (rows.length !== (backup.counts[name] ?? 0)) throw new BackupError('restore_incomplete', 'Restored row counts differ.');
    // Compare every imported value, including answer/document/report content, without logging it.
    const expected = [...tables[name]].sort((a, b) => String(a[name === 'ga4_connections' ? 'site_id' : 'id']).localeCompare(String(b[name === 'ga4_connections' ? 'site_id' : 'id'])));
    const projected = rows.map(row => Object.fromEntries(Object.keys(expected[0] || {}).map(key => [key, row[key]])));
    if (canonicalJson(expected) !== canonicalJson(projected)) throw new BackupError('restore_data_mismatch', 'Restored data differs from the safe copy.');
    actualTables[name] = rows;
  }
  for (const name of sensitiveTables) if ((await db.prepare(`SELECT count(*) AS n FROM "${name}"`).first<{ n: number }>())?.n !== 0) throw new BackupError('restore_sensitive_data', 'Transient or credential data was unexpectedly restored.');
  return { sourceDigest: backup.integrity.digest, restoredDigest: await sha256(canonicalJson(actualTables)), rowCount: Object.values(counts).reduce((a, b) => a + b, 0), counts, remappedIds: idMap.size, disabledSchedules: tables.collection_schedules.length, stoppedAnswers, stoppedExecutions, foreignKeyViolations: 0, integrity: 'ok', credentials: 'excluded', externalCalls: 0 };
}

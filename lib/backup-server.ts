import { env } from 'cloudflare:workers';
import { ProductError } from './product-validation';
import { BACKUP_TABLE_NAMES, BACKUP_TABLES, BackupError, createBackup } from './backup-format';
import type { BackupTables, BackupRow } from './backup-format';

/** All counts and projections execute in one read-only D1 batch transaction. */
export async function exportWorkspaceBackup(ownerId: string, siteId: string) {
  if (!ownerId) throw new ProductError(401, 'Sign in to export a workspace.', 'unauthenticated');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(siteId)) throw new ProductError(400, 'Select a valid workspace.', 'invalid_input');
  if (!env.DB) throw new ProductError(503, 'The database is unavailable.', 'database_unavailable');
  const owned = await env.DB.prepare('SELECT id FROM sites WHERE id=? AND owner_id=?').bind(siteId, ownerId).first();
  if (!owned) throw new ProductError(404, 'Workspace not found.', 'not_found');
  const statements: D1PreparedStatement[] = [];
  for (const name of BACKUP_TABLE_NAMES) {
    const def = BACKUP_TABLES[name], columns = Object.keys(def.schema.shape);
    // Historical mentions used to spread entire brand records, including owner/tracking
    // fields. Strip those in SQL before the JSON ever reaches the Worker or download.
    // Preserve JSON scalar types; malformed/missing required metric fields still fail
    // the strict envelope schema rather than being silently repaired.
    const mentionFields = ['name', 'domain', 'mentioned', 'firstPosition', 'rank', 'cited'];
    const mentionObject = `json_object(${mentionFields.map(field => `'${field}',json(m.value -> '$.${field}')`).join(',')})`;
    const mentionValid = mentionFields.map(field => `json_type(m.value,'$.${field}') IS NOT NULL`).join(' AND ');
    const safeMentions = `CASE WHEN json_valid(t.mentions) THEN CASE WHEN json_type(t.mentions)='array' THEN (SELECT json_group_array(CASE WHEN m.type='object' THEN CASE WHEN ${mentionValid} THEN ${mentionObject} ELSE json('null') END ELSE json('null') END) FROM json_each(t.mentions) m) ELSE '[null]' END ELSE '[null]' END`;
    const selection = columns.map(column => name === 'answers' && column === 'mentions' ? `${safeMentions} AS "mentions"` : `t."${column}"`).join(',');
    const predicate = name === 'sites' ? 't.id=? AND t.owner_id=?' : `t.site_id=? AND EXISTS (SELECT 1 FROM sites s WHERE s.id=t.site_id AND s.owner_id=?)${['collection_schedules','scheduled_executions','operation_alerts','operation_audit','ga4_connections'].includes(name) ? ' AND t.owner_id=(SELECT owner_id FROM sites WHERE id=t.site_id)' : ''}`;
    // JSON array size plus escaped column names overestimates the eventual object size.
    // LIMIT bounds scans; the max+1 sentinel causes a full failure, never truncation.
    const overhead = columns.reduce((n, key) => n + JSON.stringify(key).length + 2, 2);
    const cte = `WITH bounded AS (SELECT ${selection} FROM "${name}" t WHERE ${predicate} ORDER BY t.${name === 'ga4_connections' ? 'site_id' : 'id'} LIMIT ${def.maxRows + 1}), stats AS (SELECT count(*) AS n,coalesce(sum(length(CAST(json_array(${columns.map(c => `"${c}"`).join(',')}) AS BLOB))+${overhead}),0) AS bytes FROM bounded)`;
    const ownerBearing = ['collection_schedules','scheduled_executions','operation_alerts','operation_audit','ga4_connections'].includes(name);
    const invalidOwner = ownerBearing ? `(SELECT count(*) FROM "${name}" bad JOIN sites s ON s.id=bad.site_id WHERE bad.site_id=? AND s.owner_id=? AND bad.owner_id<>s.owner_id)` : '0';
    statements.push(env.DB.prepare(`${cte} SELECT n,bytes,${invalidOwner} AS invalid_owner FROM stats`).bind(siteId, ownerId, ...(ownerBearing ? [siteId, ownerId] : [])));
    statements.push(env.DB.prepare(`${cte} SELECT ${columns.map(c => `"${c}"`).join(',')} FROM bounded WHERE (SELECT n FROM stats)<=${def.maxRows} AND (SELECT bytes FROM stats)<=${def.maxBytes}`).bind(siteId, ownerId));
  }
  const results = await env.DB.batch(statements), tables = {} as BackupTables;
  if (!results.every(r => r.success)) throw new BackupError('backup_incomplete', 'A complete snapshot could not be read.', 503);
  if (Number((results[0].results[0] as { n: number }).n) !== 1) throw new ProductError(404, 'Workspace not found.', 'not_found');
  for (let i = 0; i < BACKUP_TABLE_NAMES.length; i++) {
    const name = BACKUP_TABLE_NAMES[i], def = BACKUP_TABLES[name], stats = results[i * 2].results[0] as { n: number; bytes: number; invalid_owner: number };
    if (stats.invalid_owner) throw new BackupError('backup_incomplete', 'Workspace ownership records are inconsistent. No partial file was created.', 503);
    if (stats.n > def.maxRows || stats.bytes > def.maxBytes) throw new BackupError('backup_too_large', 'Workspace exceeds the supported backup limit. No partial file was created.', 413);
    const rows = results[i * 2 + 1].results as BackupRow[];
    if (rows.length !== stats.n) throw new BackupError('backup_incomplete', 'Snapshot row counts do not match. No partial file was created.', 503);
    tables[name] = rows;
  }
  return createBackup(siteId, tables);
}

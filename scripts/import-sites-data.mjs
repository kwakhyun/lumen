import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrationClient } from './migrate-turso.mjs';

const identifier = value => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Invalid SQL identifier.');
  return `"${value}"`;
};
function rowJson(columns, row) { return JSON.stringify(columns.map(column => row[column])); }
export function tableDigest(columns, rows) {
  return createHash('sha256').update(JSON.stringify(rows.map(row => rowJson(columns, row)).sort())).digest('hex');
}
export function validateSnapshot(snapshot) {
  if (snapshot?.format !== 'lumen-sites-migration-v1' || !snapshot.tables || typeof snapshot.tables !== 'object') throw new Error('Invalid migration snapshot.');
  for (const [name, table] of Object.entries(snapshot.tables)) {
    identifier(name);
    if (!Array.isArray(table.columns) || !table.columns.length || new Set(table.columns).size !== table.columns.length || !Array.isArray(table.rows)) throw new Error('Invalid table shape.');
    table.columns.forEach(identifier);
    for (const row of table.rows) {
      if (Object.keys(row).length !== table.columns.length || table.columns.some(column => !Object.hasOwn(row, column))) throw new Error('Missing or unexpected column.');
      for (const value of Object.values(row)) if ((typeof value === 'string' && value.includes('\0')) || (value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value)))) throw new Error('Unsupported row value.');
    }
    if (tableDigest(table.columns, table.rows) !== table.sha256) throw new Error(`Snapshot checksum mismatch: ${name}`);
  }
  return snapshot;
}
async function verifyWith(client, snapshot) {
  const counts = {};
  for (const [name, table] of Object.entries(snapshot.tables)) {
    const result = await client.execute(`SELECT ${table.columns.map(identifier).join(',')} FROM ${identifier(name)}`);
    if (tableDigest(table.columns, result.rows) !== table.sha256) throw new Error(`Data verification failed: ${name}`);
    counts[name] = result.rows.length;
  }
  if ((await client.execute('PRAGMA foreign_key_check')).rows.length) throw new Error('Foreign-key verification failed.');
  return counts;
}
export async function verifySnapshot(client, snapshot) {
  validateSnapshot(snapshot);
  return verifyWith(client, snapshot);
}
export async function importSnapshot(client, snapshot) {
  validateSnapshot(snapshot);
  const names = (await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_lumen_schema_migrations'")).rows.map(row => row.name);
  const expected = Object.keys(snapshot.tables).concat('auth_identity_links').sort();
  if (JSON.stringify(names.slice().sort()) !== JSON.stringify(expected)) throw new Error('Target schema does not match the complete snapshot.');
  for (const [name, table] of Object.entries(snapshot.tables)) {
    const columns = (await client.execute(`PRAGMA table_info(${identifier(name)})`)).rows.map(row => row.name).sort();
    if (JSON.stringify(columns) !== JSON.stringify(table.columns.slice().sort())) throw new Error(`Schema mismatch: ${name}`);
  }
  const tx = await client.transaction('write');
  try {
    for (const name of names) if ((await tx.execute(`SELECT count(*) AS n FROM ${identifier(name)}`)).rows[0].n !== 0) throw new Error('Target is not empty. Refusing to overwrite existing records.');
    await tx.execute('PRAGMA defer_foreign_keys=ON');
    for (const [name, table] of Object.entries(snapshot.tables)) {
      const sql = `INSERT INTO ${identifier(name)} (${table.columns.map(identifier).join(',')}) VALUES (${table.columns.map(() => '?').join(',')})`;
      for (let i = 0; i < table.rows.length; i += 50) await tx.batch(table.rows.slice(i, i + 50).map(row => ({ sql, args: table.columns.map(column => row[column]) })));
    }
    const counts = await verifyWith(tx, snapshot);
    await tx.commit();
    return { tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0), counts };
  } catch (error) { await tx.rollback(); throw error; }
  finally { tx.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = process.argv.find(arg => arg.startsWith('--source='))?.slice('--source='.length);
  if (!source) throw new Error('Pass --source=/absolute/path/to/verified-snapshot.json');
  const snapshot = JSON.parse(await readFile(source, 'utf8')), client = migrationClient();
  try { console.log(JSON.stringify(await (process.argv.includes('--verify') ? verifySnapshot(client, snapshot) : importSnapshot(client, snapshot)))); }
  catch (error) { console.error('Data migration failed:', error.code || error.name); process.exitCode = 1; }
  finally { client.close(); }
}

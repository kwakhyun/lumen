import { createClient } from '@libsql/client/http';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ledger = '_lumen_schema_migrations';
const sha256 = value => createHash('sha256').update(value).digest('hex');
export function migrationClient() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('TURSO_DATABASE_URL is required.');
  const parsed = new URL(url);
  const local = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (!local && (!['https:', 'libsql:'].includes(parsed.protocol) || !process.env.TURSO_AUTH_TOKEN)) throw new Error('A secure remote database URL and TURSO_AUTH_TOKEN are required.');
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}
export async function migrateDatabase(client, directory = root) {
  const journal = JSON.parse(await readFile(resolve(directory, 'drizzle/meta/_journal.json'), 'utf8'));
  const names = journal.entries.map(entry => `drizzle/${entry.tag}.sql`);
  // Tables outside the workspace backup manifest. The order is fixed so existing ledgers stay valid.
  for (const area of ['auth', 'agents']) for (const name of (await readdir(resolve(directory, `migrations/${area}`))).filter(name => name.endsWith('.sql')).sort()) names.push(`migrations/${area}/${name}`);
  const existing = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  if (existing.rows.length && !existing.rows.some(row => row.name === ledger)) throw new Error('Existing untracked schema: refusing to adopt or overwrite this database.');
  await client.execute(`CREATE TABLE IF NOT EXISTS ${ledger} (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = new Map((await client.execute(`SELECT name,sha256 FROM ${ledger}`)).rows.map(row => [row.name, row.sha256]));
  for (const name of applied.keys()) if (!names.includes(name)) throw new Error('Database contains an unknown migration.');
  let count = 0;
  for (const name of names) {
    const content = await readFile(resolve(directory, name), 'utf8'), hash = sha256(content);
    if (applied.has(name)) {
      if (applied.get(name) !== hash) throw new Error(`Migration checksum changed: ${name}`);
      continue;
    }
    const tx = await client.transaction('write');
    try {
      await tx.executeMultiple(content);
      await tx.execute({ sql: `INSERT INTO ${ledger} VALUES (?,?,?)`, args: [name, hash, new Date().toISOString()] });
      await tx.commit();
      count++;
    } catch (error) { await tx.rollback(); throw error; }
    finally { tx.close(); }
  }
  return { applied: count, total: names.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const client = migrationClient();
  try { console.log(JSON.stringify(await migrateDatabase(client))); }
  catch (error) { console.error('Schema migration failed:', error.code || error.name); process.exitCode = 1; }
  finally { client.close(); }
}

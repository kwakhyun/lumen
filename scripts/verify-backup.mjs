#!/usr/bin/env node
// Local-only recovery drill. No .env files, remote bindings or provider modules are loaded.
import { registerHooks } from 'node:module';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Miniflare } from 'miniflare';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    if (existsSync(base + '.ts')) return { url: pathToFileURL(base + '.ts').href, shortCircuit: true };
  }
  return next(specifier, context);
} });
const { BACKUP_MAX_BYTES, BACKUP_MIGRATIONS, BackupError, canonicalJson, validateBackup } = await import('../lib/backup-format.ts');
const { restoreToEmptyDatabase } = await import('../lib/backup-restore.ts');
let output, created = false, mf;
try {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output') throw new BackupError('invalid_arguments', 'Use --input <backup.json> --output <new-local-directory>.');
  const input = path.resolve(args[1]); output = path.resolve(args[3]);
  const info = await lstat(input);
  if (!info.isFile() || info.isSymbolicLink() || info.size > BACKUP_MAX_BYTES) throw new BackupError('backup_file_invalid', 'Input must be a bounded regular file.');
  if ((info.mode & 0o077) !== 0) throw new BackupError('backup_permissions', 'Set input permissions to 0600 before restoring.');
  const parent = await realpath(path.dirname(output));
  output = path.join(parent, path.basename(output));
  if (output === root || output === input || existsSync(output)) throw new BackupError('restore_target_exists', 'Output must be a new directory. Existing paths are never overwritten.');
  const bytes = await readFile(input); if (bytes.byteLength > BACKUP_MAX_BYTES) throw new BackupError('backup_too_large', 'Backup exceeds the byte limit.');
  let inputData;
  try { inputData = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new BackupError('backup_invalid', 'Input is not valid UTF-8 JSON.'); }
  const backup = await validateBackup(inputData);
  // Only manifests accepted by the version-specific validator reach this point.
  // A supported historical manifest must also be the unchanged prefix of the
  // current schema; we apply the whole pinned chain to the new empty database.
  if (canonicalJson(backup.schemaMigrations) !== canonicalJson(BACKUP_MIGRATIONS.slice(0, backup.schemaMigrations.length))) throw new BackupError('restore_schema_unsupported', 'Backup migrations are not a supported prefix of the local schema.');
  const migrations = (await readdir(path.join(root, 'drizzle'))).filter(name => name.endsWith('.sql')).sort();
  if (JSON.stringify(migrations) !== JSON.stringify(BACKUP_MIGRATIONS.map(m => m.name))) throw new BackupError('restore_schema_unsupported', 'Local migrations do not match the supported restore schema.');
  const sql = [];
  for (const migration of BACKUP_MIGRATIONS) {
    const source = await readFile(path.join(root, 'drizzle', migration.name), 'utf8');
    if (createHash('sha256').update(source).digest('hex') !== migration.sha256) throw new BackupError('restore_schema_mismatch', 'Local migration checksum differs.');
    sql.push(...source.split('--> statement-breakpoint').filter(part => part.trim()));
  }
  await mkdir(output, { mode: 0o700 }); created = true;
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("Offline backup verification only"); } }', d1Databases: { DB: 'isolated-backup-verification' }, d1Persist: path.join(output, 'd1') });
  const db = await mf.getD1Database('DB');
  for (const statement of sql) await db.prepare(statement).run();
  const summary = await restoreToEmptyDatabase(db, backup);
  await mf.dispose(); mf = undefined;
  async function secureTree(directory) { for (const item of await readdir(directory, { withFileTypes: true })) { const target = path.join(directory, item.name); if (item.isDirectory()) { await chmod(target, 0o700); await secureTree(target); } else if (item.isFile()) await chmod(target, 0o600); } }
  await secureTree(output);
  await writeFile(path.join(output, 'verification.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify(summary) + '\n');
} catch (error) {
  if (mf) await mf.dispose().catch(() => {});
  if (created) await rm(output, { recursive: true, force: true });
  // Only stable codes and predefined messages are exposed, never SQL or backup data.
  const safe = error instanceof BackupError ? { code: error.code, error: error.message } : { code: 'restore_failed', error: 'Local restore verification failed. No restored copy was retained.' };
  process.stderr.write(JSON.stringify(safe) + '\n'); process.exitCode = 1;
}

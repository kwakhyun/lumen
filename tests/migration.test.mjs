import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { migrateDatabase } from '../scripts/migrate-turso.mjs';
import { importSnapshot, tableDigest, verifySnapshot } from '../scripts/import-sites-data.mjs';

test('schema migrations are repeatable and reject a changed checksum', async () => {
  const client = createClient({ url: 'file::memory:' });
  try {
    assert.deepEqual(await migrateDatabase(client), { applied: 10, total: 10 });
    assert.deepEqual(await migrateDatabase(client), { applied: 0, total: 10 });
    await client.execute("UPDATE _lumen_schema_migrations SET sha256='changed' WHERE name='migrations/auth/0001_identity_links.sql'");
    await assert.rejects(migrateDatabase(client), /checksum/);
  } finally { client.close(); }
});
const table = (columns, rows) => ({ columns, rows, sha256: tableDigest(columns, rows) });
const snapshot = parentId => ({ format: 'lumen-sites-migration-v1', tables: {
  parents: table(['id','body'], [{id:'original-id',body:'한글 원본'}]),
  children: table(['id','parent_id'], [{id:'child-id',parent_id:parentId}]),
} });
test('import preserves original IDs, verifies every value, refuses overwrite and rolls back invalid relationships', async () => {
  const client = createClient({ url: 'file::memory:' });
  try {
    await client.executeMultiple('PRAGMA foreign_keys=ON; CREATE TABLE parents(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE children(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES parents(id)); CREATE TABLE auth_identity_links(subject TEXT PRIMARY KEY);');
    await assert.rejects(importSnapshot(client, snapshot('missing')), /Foreign-key/);
    assert.equal((await client.execute('SELECT count(*) AS n FROM parents')).rows[0].n, 0);
    const input = snapshot('original-id');
    assert.equal((await importSnapshot(client,input)).rows,2);
    assert.deepEqual(await verifySnapshot(client,input),{parents:1,children:1});
    await assert.rejects(importSnapshot(client,input), /not empty/);
    input.tables.parents.rows[0].body='changed';
    await assert.rejects(verifySnapshot(client,input), /checksum/);
  } finally { client.close(); }
});

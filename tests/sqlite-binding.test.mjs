import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/d1';
import { sql } from 'drizzle-orm';
import { createSqliteBinding } from '../lib/runtime/sqlite-binding.ts';

test('libSQL adapter preserves values, column order and Drizzle results', async () => {
  const client = createClient({url: 'file::memory:'});
  const db = createSqliteBinding(client);
  try {
    await db.prepare('CREATE TABLE records (id TEXT PRIMARY KEY, body TEXT, active INTEGER, optional TEXT)').run();
    const base = db.prepare('INSERT INTO records VALUES (?,?,?,?)');
    const r = await base.bind('one','한국어 "문서"',true,null).run();
    assert.equal(r.meta.changes,1);
    await base.bind('two','Second',false,'').run();
    assert.deepEqual(await db.prepare('SELECT id,body,active,optional FROM records WHERE id=?').bind('one').first(), {id:'one',body:'한국어 "문서"',active:1,optional:null});
    assert.equal(await db.prepare('SELECT count(*) AS n FROM records').first('n'),2);
    assert.equal(await db.prepare('SELECT * FROM records WHERE id=?').bind('missing').first(),null);
    assert.deepEqual(await db.prepare('SELECT active,id FROM records WHERE id=?').bind('two').raw({columnNames:true}),[['active','id'],[0,'two']]);
    const orm=drizzle(db);
    assert.deepEqual(await orm.all(sql`SELECT id FROM records ORDER BY id`),[{id:'one'},{id:'two'}]);
    assert.throws(()=>base.bind(undefined),/Unsupported/);
    assert.throws(()=>base.bind('id','before\0after',true,null),/NUL/);
  } finally { client.close(); }
});

test('a failed batch rolls back all changes and refuses another connection', async () => {
  const client=createClient({url:'file::memory:'}), other=createClient({url:'file::memory:'});
  const db=createSqliteBinding(client);
  try {
    await db.prepare('CREATE TABLE claims (id TEXT PRIMARY KEY)').run();
    await assert.rejects(db.batch([db.prepare('INSERT INTO claims VALUES (?)').bind('same'),db.prepare('INSERT INTO claims VALUES (?)').bind('same')]));
    assert.equal(await db.prepare('SELECT count(*) AS n FROM claims').first('n'),0);
    await assert.rejects(db.batch([createSqliteBinding(other).prepare('SELECT 1')]),/same database/);
    const r=await db.batch([db.prepare('INSERT INTO claims VALUES (?)').bind('unique'),db.prepare('SELECT id FROM claims')]);
    assert.equal(r[0].meta.changes,1); assert.deepEqual(r[1].results,[{id:'unique'}]);
  } finally { client.close(); other.close(); }
});

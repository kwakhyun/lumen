import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath,pathToFileURL } from 'node:url';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){const base=fileURLToPath(new URL(specifier,context.parentURL));if(existsSync(base+'.ts'))return {url:pathToFileURL(base+'.ts').href,shortCircuit:true};}return next(specifier,context);}});
const {createSqliteBinding}=await import('../lib/runtime/sqlite-binding.ts');
const {resolveOwnerLink}=await import('../lib/auth/owner-link.ts');
test('migration binds a legacy owner once, preserves identity on email change, and prevents duplicate claims',async()=>{
 const c=createClient({url:'file::memory:'}),db=createSqliteBinding(c);
 try{
  await db.exec('CREATE TABLE auth_identity_links(provider TEXT,subject TEXT,owner_id TEXT UNIQUE NOT NULL,verified_email TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(provider,subject))');
  const identity={subject:'subject1',email:'person@example.com',name:'Person'},mapping='{"person@example.com":"legacy-owner"}';
  assert.equal(await resolveOwnerLink(db,identity,mapping),'legacy-owner');
  assert.equal(await resolveOwnerLink(db,{...identity,email:'new@example.com'}),'legacy-owner');
  await assert.rejects(resolveOwnerLink(db,{...identity,subject:'subject2'},mapping));
  assert.equal(await resolveOwnerLink(db,{subject:'stranger',email:'stranger@example.com',name:null},mapping),'google:stranger');
  assert.equal(await db.prepare('SELECT count(*) AS n FROM auth_identity_links').first('n'),2);
 }finally{c.close();}
});

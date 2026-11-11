import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){const base=fileURLToPath(new URL(specifier,context.parentURL));if(existsSync(base+'.ts'))return {url:pathToFileURL(base+'.ts').href,shortCircuit:true};}return next(specifier,context);}});
import { Auth } from '@auth/core';
const { createAuthConfig }=await import('../lib/auth/config.ts');
test('real auth endpoint rejects forged Sites identity headers without a session',async()=>{
 const config={...createAuthConfig(async()=>{throw new Error('No login callback expected');}),secret:'isolated-test-secret-value-with-at-least-32-characters',trustHost:true,basePath:'/api/auth'};
 const response=await Auth(new Request('https://lumen.test/api/auth/session',{headers:{'oai-authenticated-user-id':'victim-owner','oai-authenticated-user-email':'victim@example.com'}}),config);
 assert.equal(response.status,200);assert.equal(await response.json(),null);
});
test('verified provider callback sets owner, and client session updates cannot replace it',async()=>{
 let calls=0;const config=createAuthConfig(async identity=>{calls++;assert.equal(identity.email,'person@example.com');return 'legacy-owner';});
 const callbacks=config.callbacks;
 assert.equal(await callbacks.signIn({account:{provider:'google'},profile:{sub:'123',email:'person@example.com',email_verified:false}}),false);
 const token=await callbacks.jwt({token:{},account:{provider:'google'},profile:{sub:'123',email:'person@example.com',email_verified:true,name:'Person'}});
 assert.equal(token.ownerId,'legacy-owner');assert.equal(calls,1);
 const unchanged=await callbacks.jwt({token,trigger:'update',session:{ownerId:'victim-owner',email:'victim@example.com'}});
 assert.equal(unchanged.ownerId,'legacy-owner');assert.equal(unchanged.email,'person@example.com');assert.equal(calls,1);
 const session=await callbacks.session({session:{user:{}},token});assert.equal(session.user.id,'legacy-owner');
 await assert.rejects(callbacks.session({session:{user:{}},token:{email:'person@example.com'}}));
});

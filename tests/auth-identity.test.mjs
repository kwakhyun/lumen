import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifiedGoogleIdentity,legacyOwnerForEmail,safeReturnPath } from '../lib/auth/identity.ts';
test('only Google verified profiles can become an identity',()=>{
 const profile={sub:'12345',email:'Person@Example.com',email_verified:true,name:'Person'};
 assert.deepEqual(verifiedGoogleIdentity(profile),{subject:'12345',email:'person@example.com',name:'Person'});
 for(const patch of [{email_verified:false},{email_verified:'true'},{sub:''},{sub:'other:owner'},{email:'bad'}])assert.throws(()=>verifiedGoogleIdentity({...profile,...patch}));
 assert.throws(()=>verifiedGoogleIdentity(null));
});
test('legacy ownership mapping is explicit, server configured and rejects inherited keys',()=>{
 assert.equal(legacyOwnerForEmail('{"person@example.com":"legacy-123"}','person@example.com'),'legacy-123');
 assert.equal(legacyOwnerForEmail('{"person@example.com":"legacy-123"}','stranger@example.com'),null);
 assert.equal(legacyOwnerForEmail('{}','toString'),null);
 assert.equal(legacyOwnerForEmail(undefined,'person@example.com'),null);
 for(const config of ['[]','null','{','{"person@example.com":true}','{"person@example.com":"../bad"}'])assert.throws(()=>legacyOwnerForEmail(config,'person@example.com'));
});
test('login return paths cannot redirect offsite or recurse into authentication',()=>{
 assert.equal(safeReturnPath('/dashboard/reports?period=7&model=gemini-3.8-flash'),'/dashboard/reports?period=7&model=gemini-3.8-flash');
 for(const path of ['https://evil.test','//evil.test','/\\evil.test','/api/auth/callback/google','/sign-in','/sign-out','/signin-with-chatgpt','/callback','/\nlocation'])assert.equal(safeReturnPath(path),'/dashboard');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(url))return{url:url.href,shortCircuit:true};}return next(specifier,context);}});
const {assessSecurityEvidence,compareSecurityChecks}=await import('../lib/security-assessment.ts');
const {evidenceFromResponses}=await import('../scripts/collect-security-evidence.mjs');
const response=(body,headers,status=200)=>({status,error:null,bodyComplete:status===200,body,headers});
function evidence(){return evidenceFromResponses('https://example.com',[
  response('<html><head><title>Fixture</title><link rel="canonical" href="/"></head><body>Public</body></html>',{'content-type':'text/html','strict-transport-security':'max-age=31536000','content-security-policy':"default-src 'self'; frame-ancestors 'none'",'x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'}),
  response('User-agent: *\nAllow: /',{'content-type':'text/plain'}),
  response('<urlset><url><loc>https://example.com/</loc></url></urlset>',{'content-type':'application/xml'})
],'2026-01-01T00:00:00Z');}
function report(e){return{id:crypto.randomUUID(),siteId:'fixture-site',evidence:e,createdAt:new Date().toISOString(),digest:'fixture',findings:assessSecurityEvidence(e)};}
test('limited positive settings never become an overall security score, CSP efficacy claim or indexing proof',()=>{
  const checks=assessSecurityEvidence(evidence()),ids=new Set(checks.map(f=>f.id));assert.equal(ids.size,checks.length);assert.equal(checks.length,16);
  assert.equal(checks.find(f=>f.id==='https').state,'pass');assert.equal(checks.find(f=>f.id==='csp').state,'unknown');assert.equal(checks.find(f=>f.id==='cookies').state,'unknown');
  assert.match(checks.find(f=>f.id==='robots-oai-searchbot').detail,/실제 봇의 방문이나 색인 증거는 아닙니다/);assert.ok(checks.every(f=>!('score'in f)));
});
test('missing collection is unknown rather than a fabricated missing-header vulnerability',()=>{
  const e=evidence();Object.assign(e.home,{status:null,error:'timeout',bodyComplete:false,headers:null,cookies:null,html:null,contentType:'unknown'});
  for(const f of assessSecurityEvidence(e).filter(f=>f.category==='security'))assert.equal(f.state,'unknown',f.id);
});
test('unknown-to-pass is not counted as a fixed finding and uploaded findings cannot override recomputation',()=>{
  const before=report(evidence()),after=report(evidence());before.evidence.home.headers.nosniff=false;before.findings=[];
  before.evidence.robots.rules.Googlebot='unknown';after.evidence.observedAt='2026-01-02T00:00:00Z';after.evidence.home.headers.referrer='missing';
  const diff=compareSecurityChecks(before,after);assert.equal(diff.comparable,true);assert.deepEqual(diff.improved,['nosniff']);assert.deepEqual(diff.regressed,['referrer']);assert.ok(diff.unobserved.includes('robots-googlebot'));assert.ok(diff.unobserved.includes('csp'));
});
test('comparison requires same site, origin, collector and a strictly later observation, regardless of save order',()=>{
  const a=report(evidence()),b=report(evidence());assert.equal(compareSecurityChecks(a,b).comparable,false);b.evidence.observedAt='2026-01-02T00:00:00Z';
  for (const mutate of [x=>x.siteId='different',x=>x.evidence.targetOrigin='https://other.com',x=>x.evidence.collector='future/v2',x=>x.evidence.schemaVersion=2,x=>x.evidence.observedAt='invalid']){const x=structuredClone(b);mutate(x);assert.equal(compareSecurityChecks(a,x).comparable,false);}
  assert.equal(compareSecurityChecks(a,b).comparable,true);
});

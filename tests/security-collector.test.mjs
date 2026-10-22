import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { isPublicAddress, parseTarget, resolvePublicHost, pinnedRequestOptions, fetchPinned, inspectPublicHeaders, inspectCookieAttributes, inspectPublicHtml, inspectRootRobotRules, evidenceFromResponses, collectEvidence, parseArguments } from '../scripts/collect-security-evidence.mjs';

const origin='https://example.com';
const pinned={address:'93.184.216.34',family:4};
const response=(status=200,body='',headers={'content-type':'text/plain'})=>({status,error:null,bodyComplete:status===200,body,headers});

test('collector rejects private, reserved, mapped and translated addresses in both IP families',()=>{
  for (const ip of ['0.0.0.0','10.1.2.3','100.64.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','192.0.0.9','192.0.2.1','192.88.99.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::','::1','::ffff:127.0.0.1','::ffff:8.8.8.8','64:ff9b::a00:1','fc00::1','fe80::1','fe80::1%en0','ff02::1','2001:db8::1','2002:7f00:1::','2001::1','3fff::1','not-an-ip']) assert.equal(isPublicAddress(ip),false,ip);
  for (const ip of ['1.1.1.1','8.8.8.8','93.184.216.34','2001:4860:4860::8888','2606:4700:4700::1111']) assert.equal(isPublicAddress(ip),true,ip);
});
test('origin parser rejects URL tricks, IP literals, unsafe hostnames and arbitrary paths',()=>{
  for (const url of ['http://example.com','https://127.0.0.1','https://2130706433','https://0x7f000001','https://[::1]','https://user:pass@example.com','https://example.com:8443','https://example.com:443','https://example.com/a','https://example.com/?key=secret','https://example.com/#secret','https://example.com.','https://localhost','https://metadata.google.internal','https://foo.local','https://x.test','https://foo..com','https://-example.com','https://example.com\n','https://EXAMPLE.com']) assert.throws(()=>parseTarget(url),url);
  assert.equal(parseTarget(origin+'/'),origin);assert.equal(parseTarget(origin),origin);
});
test('DNS requires every answer to be public and socket lookup is pinned without resolving twice',async()=>{
  await assert.rejects(()=>resolvePublicHost('example.com',async()=>[pinned,{address:'10.0.0.1',family:4}]),/dns_blocked/);
  await assert.rejects(()=>resolvePublicHost('example.com',async()=>[{address:'8.8.8.8',family:6}]),/dns_blocked/);
  await assert.rejects(()=>resolvePublicHost('example.com',async()=>[]),/dns_failed/);
  let lookups=0;
  const actual=await resolvePublicHost('example.com',async()=>{lookups++;return[pinned];});
  const options=pinnedRequestOptions(origin,'/',actual);
  assert.equal(options.hostname,'example.com');assert.equal(options.servername,'example.com');assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);assert.equal(options.autoSelectFamily,false);
  options.lookup('example.com',{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,pinned.address);assert.equal(family,4);});
  options.lookup('example.com',{all:true},(error,addresses)=>{assert.equal(error,null);assert.deepEqual(addresses,[pinned]);});
  assert.equal(lookups,1);
  assert.deepEqual(Object.keys(options.headers).sort(),['Accept','Accept-Encoding','User-Agent']);
  assert.throws(()=>pinnedRequestOptions(origin,'/admin',actual));
});
function transportFixture({status=200,headers={},chunks=[]}) {
  let count=0,destroyed=0;
  return {get count(){return count;},get destroyed(){return destroyed;},transport(_options,onResponse){
    count++;const req=new EventEmitter();req.destroy=()=>{destroyed++;};req.end=()=>queueMicrotask(()=>{
      const res=new EventEmitter();res.statusCode=status;res.headers=headers;res.destroy=()=>{destroyed++;};onResponse(res);
      if (status===200) { for(const chunk of chunks)res.emit('data',Buffer.from(chunk));res.emit('end'); }
    });return req;
  }};
}
test('redirects are recorded without following their destinations',async()=>{
  const fixture=transportFixture({status:302,headers:{location:'http://169.254.169.254/secret','set-cookie':['private=token']}});
  const result=await fetchPinned(origin,'/',pinned,64,fixture.transport);
  assert.equal(fixture.count,1);assert.equal(result.status,302);assert.equal(result.bodyComplete,false);assert.deepEqual(result.headers,{});assert.equal(result.body,'');assert.equal(fixture.destroyed,1);
});
test('actual streamed byte count and compressed responses are bounded without retaining partial evidence',async()=>{
  for (const config of [{headers:{'content-length':'1'},chunks:['a'.repeat(40),'b'.repeat(40)]},{headers:{'content-encoding':'gzip'},chunks:[]},{headers:{'content-length':'100'},chunks:[]}]) {
    const fixture=transportFixture(config),result=await fetchPinned(origin,'/',pinned,64,fixture.transport);
    assert.equal(result.error,'body_limit');assert.equal(result.bodyComplete,false);assert.deepEqual(result.headers,{});assert.equal(result.body,'');
  }
});
test('passive collection makes exactly three fixed requests using one DNS resolution and no redirects',async()=>{
  let dns=0;const calls=[];
  const e=await collectEvidence(origin,{resolver:async()=>{dns++;return dns===1?[pinned]:[{address:'127.0.0.1',family:4}];},fetcher:async(...args)=>{calls.push(args);return response(302);}});
  assert.equal(dns,1);assert.deepEqual(calls.map(c=>c[1]),['/','/robots.txt','/sitemap.xml']);assert.ok(calls.every(c=>c[2].address===pinned.address));assert.equal(e.home.headers,null);
  let outbound=0;const blocked=await collectEvidence(origin,{resolver:async()=>[{address:'127.0.0.1',family:4}],fetcher:async()=>{outbound++;}});assert.equal(outbound,0);assert.equal(blocked.home.error,'dns_blocked');assert.equal(blocked.robots.rules.Googlebot,'unknown');
});
test('headers distinguish report-only, unsafe CSP, disabled HSTS and overridden frame protection',()=>{
  let h=inspectPublicHeaders({'strict-transport-security':'max-age=0','content-security-policy-report-only':"default-src 'self'",'referrer-policy':'unsafe-url'});
  assert.equal(h.hsts,'disabled');assert.equal(h.csp,'report-only');assert.equal(h.referrer,'unsafe');
  h=inspectPublicHeaders({'strict-transport-security':'max-age=31536000; includeSubDomains','content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; frame-ancestors *",'x-frame-options':'DENY','x-content-type-options':'nosniff','referrer-policy':'unsafe-url, strict-origin-when-cross-origin'});
  assert.equal(h.hsts,'enabled');assert.equal(h.csp,'unsafe');assert.equal(h.framing,'invalid');assert.equal(h.referrer,'restricted');assert.equal(h.nosniff,true);
  h=inspectPublicHeaders({'strict-transport-security':'max-age=123; max-age=31536000','content-security-policy':"default-src 'self'; frame-ancestors 'none'"});assert.equal(h.hsts,'invalid');assert.equal(h.framing,'restricted');assert.equal(h.csp,'present');
  for(const value of ['max-age="31536000','max-age=31536000"','max-age=9007199254740993','max-age=31536000; max-age=bad'])assert.equal(inspectPublicHeaders({'strict-transport-security':value}).hsts,'invalid');
  assert.equal(inspectPublicHeaders({'strict-transport-security':'max-age="31536000"'}).hsts,'enabled');
});
test('robots query filters retain their meaning and do not falsely block the root path',()=>{
  for(const rule of ['/?q=','/*?s=','/private'])assert.equal(inspectRootRobotRules(`User-agent: *\nDisallow: ${rule}`).Googlebot,'allowed');
  assert.equal(inspectRootRobotRules('User-agent: *\nDisallow: /').Googlebot,'blocked');
  assert.equal(inspectRootRobotRules('User-agent: *\nDisallow: /\nUser-agent: OAI-SearchBot\nAllow: /')['OAI-SearchBot'],'allowed');
});
test('HTML facts never retain secrets and distinguish canonical, noindex and static HTTP resources',()=>{
  const secret='UNIQUE_PRIVATE_COOKIE_OR_TOKEN';
  const html=`<html><head><title>Public title</title><link rel="canonical" href="${origin}/"><meta name="robots" content="noindex"></head><body><script src="http&#58;//cdn.example/x.js">${secret}</script><img src="http://example.com/a.png">${secret}</body></html>`;
  const facts=inspectPublicHtml(html,{},origin);assert.deepEqual(facts,{title:true,canonical:'self',indexing:'blocked',mixedContent:true});assert.ok(!JSON.stringify(facts).includes(secret));
  assert.equal(inspectPublicHtml('<head><title>OK</title></head><body><a href="http://example.com">link</a></body>',{},origin).mixedContent,false);
  assert.equal(inspectPublicHtml('<head><link rel="canonical" href="/other"></head>',{},origin).canonical,'other');
  assert.equal(inspectPublicHtml('<head><link rel="canonical" href="/"><link rel="canonical" href="/"></head>',{},origin).canonical,'invalid');
  const based=inspectPublicHtml('<head><base href="http://example.com/"><link rel="canonical" href="/"></head><body><script src="/app.js"></script></body>',{},origin);
  assert.equal(based.canonical,'other');assert.equal(based.mixedContent,true);
});
test('cookie values, names, raw headers, XML addresses and body text never enter exported evidence',()=>{
  const secret='PRIVATE_DO_NOT_SAVE';
  const headers={'content-type':'text/html','set-cookie':[`session=${secret}; Secure; HttpOnly; SameSite=Lax`,`other=${secret}`],'x-private-token':secret};
  assert.deepEqual(inspectCookieAttributes(headers),{total:2,missingSecure:1,missingHttpOnly:1,missingSameSite:1});
  const e=evidenceFromResponses(origin,[response(200,`<html><head><title>${secret}</title></head><body>${secret}</body></html>`,headers),response(200,'User-agent: *\nDisallow: /\n'),response(200,`<urlset><url><loc>${origin}/?secret=${secret}</loc></url></urlset>`,{'content-type':'application/xml'})]);
  assert.equal(e.robots.rules['OAI-SearchBot'],'blocked');assert.equal(e.sitemap.sameOriginUrls,1);assert.ok(!JSON.stringify(e).includes(secret));assert.ok(!JSON.stringify(e).includes('set-cookie'));assert.ok(!JSON.stringify(e).includes('session='));
});
test('unsupported, truncated and failed documents remain unknown; sitemap entities are never expanded',()=>{
  const e=evidenceFromResponses(origin,[{...response(),error:'body_limit',bodyComplete:false},response(200,'<html>error</html>',{'content-type':'text/html'}),response(200,'<!DOCTYPE urlset [<!ENTITY secret SYSTEM "file:///etc/passwd">]><urlset><loc>&secret;</loc></urlset>',{'content-type':'application/xml'})]);
  assert.equal(e.home.headers,null);assert.equal(e.home.html,null);assert.equal(e.robots.rules.Googlebot,'unknown');assert.equal(e.sitemap.format,'unknown');assert.equal(e.sitemap.sameOriginUrls,0);
});
test('CLI requires explicit authorization and output, rejects unknown and repeated flags',()=>{
  const args=['--origin',origin,'--authorized','--output','/tmp/example.json'];assert.equal(parseArguments(args).origin,origin);
  for(const bad of [args.filter(x=>x!=='--authorized'),[...args,'--follow-redirects'],[...args,'--authorized'],['--origin',origin,'--authorized']])assert.throws(()=>parseArguments(bad));
  assert.deepEqual(parseArguments(['--help']),{help:true});
});

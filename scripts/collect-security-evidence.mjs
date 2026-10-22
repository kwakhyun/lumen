#!/usr/bin/env node
/** Passive, explicitly authorized local collection. No browser session, environment secrets or remote scanner. */
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP, BlockList } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { robotsAllows } from './audit-public-indexing.mjs';

export const COLLECTOR = 'lumen-public-web/1';
export const BOTS = ['Googlebot', 'bingbot', 'OAI-SearchBot', 'PerplexityBot'];
export const REQUEST_PATHS = ['/', '/robots.txt', '/sitemap.xml'];
const LIMITS = [256 * 1024, 32 * 1024, 64 * 1024];
const DEADLINE = 10_000;
const denied = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) denied.addSubnet(address,prefix,'ipv4');
for (const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) denied.addSubnet(address,prefix,'ipv6');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::',3,'ipv6');

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !denied.check(address,'ipv4');
  if (family === 6) return !address.includes('%') && globalV6.check(address,'ipv6') && !denied.check(address,'ipv6');
  return false;
}

export function parseTarget(value) {
  let url; try { url = new URL(value); } catch { throw new Error('invalid_origin'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/' || ![url.origin, `${url.origin}/`].includes(value)) throw new Error('invalid_origin');
  const hostname = url.hostname;
  if (isIP(hostname) || hostname.includes(':') || !hostname.includes('.') || hostname.length > 253 || !hostname.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) || /(?:^|\.)(?:localhost|local|internal|home|test|invalid|example|arpa)$/.test(hostname)) throw new Error('invalid_origin');
  return url.origin;
}

async function withDeadline(promise, ms) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject) => { timer=setTimeout(()=>reject(new Error('timeout')),ms); })]); }
  finally { clearTimeout(timer); }
}
export async function resolvePublicHost(hostname, resolver = lookup) {
  let rows;
  try { rows = await withDeadline(resolver(hostname,{all:true,verbatim:true}),DEADLINE); }
  catch (error) { throw new Error(error.message === 'timeout' ? 'timeout' : 'dns_failed'); }
  if (!Array.isArray(rows) || !rows.length) throw new Error('dns_failed');
  if (rows.length > 64 || rows.some(row => !isPublicAddress(row.address) || isIP(row.address) !== row.family)) throw new Error('dns_blocked');
  return rows[0];
}

/** The validated address is supplied to the actual socket lookup; no second DNS resolution. */
export function pinnedRequestOptions(origin, pathname, pinned) {
  const url = new URL(origin);
  if (parseTarget(origin) !== origin || !REQUEST_PATHS.includes(pathname) || !isPublicAddress(pinned.address) || isIP(pinned.address) !== pinned.family) throw new Error('invalid_request');
  return {
    protocol:'https:', hostname:url.hostname, port:443, path:pathname, method:'GET',
    servername:url.hostname, rejectUnauthorized:true, checkServerIdentity,
    agent:false, autoSelectFamily:false, family:pinned.family, maxHeaderSize:16*1024,
    lookup(_host,options,callback) { if (options?.all) callback(null,[{address:pinned.address,family:pinned.family}]); else callback(null,pinned.address,pinned.family); },
    headers:{ 'User-Agent':'Lumen-Public-Web-Check/1.0 (owner-authorized; 3 public paths)', Accept:'text/html,text/plain,application/xml,text/xml;q=0.9', 'Accept-Encoding':'identity' },
  };
}

export function fetchPinned(origin, pathname, pinned, maxBytes, transport = request) {
  return new Promise(resolveResult => {
    let finished=false, req, timer, status=null;
    const finish = result => { if (finished) return; finished=true;clearTimeout(timer);resolveResult(result); };
    const fail = error => { finish({status,error,bodyComplete:false,headers:{},body:''}); req?.destroy(); };
    timer=setTimeout(()=>fail('timeout'),DEADLINE);
    try {
      req=transport(pinnedRequestOptions(origin,pathname,pinned), response => {
        status=response.statusCode ?? null;
        // Never follow redirects, download error pages, accept compression or parse authentication responses.
        if (status !== 200) { finish({status,error:null,bodyComplete:false,headers:{},body:''}); response.destroy();return; }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { fail('body_limit');response.destroy();return; }
        if (Number(response.headers['content-length']) > maxBytes) { fail('body_limit');response.destroy();return; }
        let bytes=0; const chunks=[];
        response.on('data',chunk => { bytes += chunk.length; if (bytes>maxBytes) { fail('body_limit');response.destroy(); } else chunks.push(chunk); });
        response.on('aborted',()=>fail('tls_or_network'));
        response.on('error',()=>fail('tls_or_network'));
        response.on('end',()=>finish({status,error:null,bodyComplete:true,headers:response.headers,body:Buffer.concat(chunks).toString('utf8')}));
      });
      req.on('error',()=>fail('tls_or_network'));
      req.end();
    } catch { fail('tls_or_network'); }
  });
}

const header = (headers,key) => { const value=headers[key];return Array.isArray(value) ? value.join(',') : String(value ?? ''); };
function directives(policy) {
  const result=new Map();
  for (const part of policy.toLowerCase().split(';')) {
    const [name,...values]=part.trim().split(/\s+/);
    if (name && !result.has(name)) result.set(name,values);
  }
  return result;
}
export function inspectPublicHeaders(headers) {
  const hstsRaw=header(headers,'strict-transport-security');
  const ageDirectives=hstsRaw.split(';').map(part=>part.trim()).filter(part=>/^max-age\b/i.test(part));
  const ageMatch=ageDirectives.length===1?/^max-age\s*=\s*(?:"(\d+)"|(\d+))$/i.exec(ageDirectives[0]):null;
  const age=ageMatch?Number(ageMatch[1]??ageMatch[2]):NaN;
  const hsts=!hstsRaw ? 'missing' : !ageMatch || hstsRaw.includes(',') || !Number.isSafeInteger(age) ? 'invalid' : age===0 ? 'disabled' : age<15552000 ? 'short' : 'enabled';
  const cspRaw=header(headers,'content-security-policy');
  const policies=cspRaw.split(',').map(directives);
  const scriptSources=policies.flatMap(policy => policy.get('script-src-elem') ?? policy.get('script-src') ?? policy.get('default-src') ?? []);
  const unsafe=scriptSources.some(source => ["'unsafe-inline'","'unsafe-eval'",'*','http:','https:','data:'].includes(source));
  const csp=cspRaw ? unsafe ? 'unsafe' : 'present' : header(headers,'content-security-policy-report-only') ? 'report-only' : 'missing';
  const xfo=header(headers,'x-frame-options').trim().toLowerCase();
  const frames=policies.map(policy=>policy.get('frame-ancestors')).filter(Boolean);
  const restrictedCsp=frames.some(values => values.length===1 && ["'none'","'self'"].includes(values[0]));
  // An explicit but broad CSP overrides X-Frame-Options in modern browsers.
  const framing=frames.length ? restrictedCsp ? 'restricted' : 'invalid' : ['deny','sameorigin'].includes(xfo) ? 'restricted' : xfo ? 'invalid' : 'missing';
  const refRaw=header(headers,'referrer-policy').trim().toLowerCase();
  const known=['no-referrer','no-referrer-when-downgrade','origin','origin-when-cross-origin','same-origin','strict-origin','strict-origin-when-cross-origin','unsafe-url'];
  const ref=refRaw.split(',').map(x=>x.trim()).filter(value=>known.includes(value)).at(-1);
  const referrer=!refRaw ? 'missing' : !ref ? 'invalid' : ['no-referrer','same-origin','strict-origin','strict-origin-when-cross-origin'].includes(ref) ? 'restricted' : 'unsafe';
  return {hsts,csp,nosniff:header(headers,'x-content-type-options').trim().toLowerCase()==='nosniff',framing,referrer};
}
export function inspectCookieAttributes(headers) {
  const raw=headers['set-cookie'];
  const values=Array.isArray(raw) ? raw : raw ? [raw] : [];
  const result={total:values.length,missingSecure:0,missingHttpOnly:0,missingSameSite:0};
  for (const value of values) {
    const attrs=String(value).split(';').slice(1).map(a=>a.trim().toLowerCase());
    if (!attrs.some(a=>a.split('=',1)[0]==='secure')) result.missingSecure++;
    if (!attrs.some(a=>a.split('=',1)[0]==='httponly')) result.missingHttpOnly++;
    if (!attrs.some(a=>/^samesite\s*=\s*(?:lax|strict|none)$/.test(a))) result.missingSameSite++;
  }
  return result;
}
function decode(value) {
  return value.replace(/&(?:#(x[\da-f]+|\d+)|([a-z]+));/gi,(all,num,named)=>{
    if (num) { const point=num[0].toLowerCase()==='x'?parseInt(num.slice(1),16):Number(num);return point>0&&point<=0x10ffff&&! (point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):''; }
    return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',colon:':',Tab:'\t',NewLine:'\n'}[named] ?? all;
  });
}
function attrs(tag) {
  const result={};
  for (const m of tag.matchAll(/([a-z_:][a-z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) if (!(m[1].toLowerCase() in result)) result[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]??'');
  return result;
}
export function inspectPublicHtml(body,headers,origin) {
  const clean=body.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|template)\b([^>]*)>[\s\S]*?<\/\1\s*>/gi,(_all,name,attributes)=>`<${name}${attributes}></${name}>`);
  const head=clean.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] ?? clean;
  let base=`${origin}/`;
  const baseTag=[...head.matchAll(/<base\b[^>]*>/gi)].map(m=>attrs(m[0])).find(a=>a.href!==undefined);
  if (baseTag) try { const url=new URL(baseTag.href,base);if(['http:','https:'].includes(url.protocol))base=url.href; } catch { /* Browsers fall back to the document URL for an invalid base. */ }
  const title=!!head.match(/<title\b[^>]*>\s*[^<\s][\s\S]*?<\/title\s*>/i);
  const canonicalTags=[...head.matchAll(/<link\b[^>]*>/gi)].map(m=>attrs(m[0])).filter(a=>(a.rel??'').toLowerCase().split(/\s+/).includes('canonical'));
  let canonical='missing';
  if (canonicalTags.length) {
    canonical='invalid';
    if (canonicalTags.length===1 && canonicalTags[0].href) try { const url=new URL(canonicalTags[0].href,base);canonical=['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href===`${origin}/`?'self':'other':'invalid'; } catch { /* Invalid evidence is retained as a classification, never a raw URL. */ }
  }
  const relevantMeta=[...head.matchAll(/<meta\b[^>]*>/gi)].map(m=>attrs(m[0])).filter(a=>['robots',...BOTS.map(b=>b.toLowerCase())].includes((a.name??'').toLowerCase()));
  const noindex=/(?:^|[\s,;:])(?:noindex|none)(?=$|[\s,;])/i;
  // Conservatively retain scoped noindex as potentially applicable; do not infer a universal allow from it.
  const blocked=relevantMeta.some(a=>noindex.test(a.content??''))||noindex.test(header(headers,'x-robots-tag'));
  const mixedContent=[...clean.matchAll(/<(?:script|img|iframe|audio|video|source|link|object|embed)\b[^>]*>/gi)].some(m=>{
    const a=attrs(m[0]);const tag=m[0].match(/^<(\w+)/)[1].toLowerCase();
    const values=tag==='link' ? /(?:^|\s)(?:stylesheet|preload|modulepreload|icon)(?:\s|$)/i.test(a.rel??'')?[a.href??'']:[] : tag==='object'?[a.data??'']:[a.src??'',...(tag==='video'?[a.poster??'']:[]),...(['img','source'].includes(tag)?(a.srcset??'').split(',').map(v=>v.trim().split(/\s+/)[0]):[])];
    return values.filter(Boolean).some(value=>{try{return new URL(value,base).protocol==='http:';}catch{return false;}});
  });
  return {title,canonical,indexing:blocked?'blocked':'allowed',mixedContent};
}
const unknownRules = () => Object.fromEntries(BOTS.map(bot=>[bot,'unknown']));
/** Match the original rule, including its query. No path or robots text enters exported evidence. */
export function inspectRootRobotRules(raw) {
  if (Buffer.byteLength(raw)>32*1024 || /<(?:html|!doctype)/i.test(raw)) return unknownRules();
  const groups=[];let group=null;
  for (const original of raw.split(/\r?\n/)) {
    const line=original.replace(/#.*$/,'').trim(),match=/^(user-agent|allow|disallow)\s*:\s*(.*)$/i.exec(line);
    if(!match)continue;
    const key=match[1].toLowerCase(),value=match[2].trim();
    if(key==='user-agent') {
      if(!/^[a-z0-9*_.-]{1,100}$/i.test(value))return unknownRules();
      if(!group||group.rules.length){group={agents:[],rules:[]};groups.push(group);}
      group.agents.push(value.toLowerCase());
    } else if(group) {
      if(value.length>2048 || (value && !value.startsWith('/')))return unknownRules();
      group.rules.push({allow:key==='allow',path:value});
    }
  }
  return Object.fromEntries(BOTS.map(bot=>[bot,robotsAllows(groups,bot,'/')?'allowed':'blocked']));
}
export function evidenceFromResponses(origin,results,observedAt=new Date().toISOString()) {
  const [home,robots,sitemap]=results;
  const summary=r=>({status:r.status,error:r.error,bodyComplete:r.bodyComplete});
  const homeOK=home.status===200&&!home.error&&home.bodyComplete;
  const html=homeOK&&/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(header(home.headers,'content-type'));
  let rules=unknownRules();
  if (robots.status===200&&!robots.error&&robots.bodyComplete && /^(?:text\/plain)(?:;|$)/i.test(header(robots.headers,'content-type'))) {
    rules=inspectRootRobotRules(robots.body);
  }
  let format='unknown',sameOriginUrls=0,otherOriginUrls=0;
  if (sitemap.status===200&&!sitemap.error&&sitemap.bodyComplete && /^(?:text\/(?:xml|plain)|application\/(?:xml|rss\+xml))(?:;|$)/i.test(header(sitemap.headers,'content-type')) && !/<!DOCTYPE|<!ENTITY/i.test(sitemap.body)) {
    const clean=sitemap.body.replace(/<!--[\s\S]*?-->/g,'').trim().replace(/^<\?xml[^>]*\?>\s*/i,'');
    if (/^<urlset\b[^>]*>[\s\S]*<\/urlset\s*>$/i.test(clean)) format='urlset';
    else if (/^<sitemapindex\b[^>]*>[\s\S]*<\/sitemapindex\s*>$/i.test(clean)) format='index';
    if (format!=='unknown') for (const m of clean.matchAll(/<loc\b[^>]*>\s*([^<]*)\s*<\/loc\s*>/gi)) {
      try { const url=new URL(decode(m[1].trim()));if (!['https:','http:'].includes(url.protocol)||url.username||url.password) {otherOriginUrls++;continue;}if(url.origin===origin)sameOriginUrls++;else otherOriginUrls++; } catch {otherOriginUrls++;}
    }
  }
  return {
    schemaVersion:1,collector:COLLECTOR,targetOrigin:origin,observedAt,authorization:'owner_or_authorized',
    home:{...summary(home),contentType:homeOK?html?'html':'other':'unknown',headers:homeOK?inspectPublicHeaders(home.headers):null,cookies:homeOK?inspectCookieAttributes(home.headers):null,html:html?inspectPublicHtml(home.body,home.headers,origin):null},
    robots:{...summary(robots),rules},sitemap:{...summary(sitemap),format,sameOriginUrls,otherOriginUrls},
  };
}

export async function collectEvidence(origin, {resolver=lookup,fetcher=fetchPinned}={}) {
  origin=parseTarget(origin);
  let pinned;
  try { pinned=await resolvePublicHost(new URL(origin).hostname,resolver); }
  catch (error) { const result={status:null,error:error.message,bodyComplete:false,headers:{},body:''};return evidenceFromResponses(origin,[result,result,result]); }
  const responses=[];
  for (let i=0;i<REQUEST_PATHS.length;i++) responses.push(await fetcher(origin,REQUEST_PATHS[i],pinned,LIMITS[i]));
  return evidenceFromResponses(origin,responses);
}

export function parseArguments(args) {
  if (args.length===1 && args[0]==='--help') return {help:true};
  const parsed={};
  for (let i=0;i<args.length;i++) {
    const flag=args[i];if (Object.hasOwn(parsed,flag)) throw new Error('invalid_arguments');
    if (flag==='--authorized') parsed[flag]=true;
    else if (['--origin','--output'].includes(flag)&&args[i+1]&&!args[i+1].startsWith('--')) parsed[flag]=args[++i];
    else throw new Error('invalid_arguments');
  }
  if (!parsed['--authorized'] || !parsed['--origin'] || !parsed['--output']) throw new Error('authorization_and_output_required');
  return {origin:parseTarget(parsed['--origin']),output:resolve(parsed['--output'])};
}
export async function main(args=process.argv.slice(2)) {
  let options;
  try { options=parseArguments(args); } catch { console.error('관리 권한이 있는 공개 HTTPS 사이트만 지정하세요. 사용법: node scripts/collect-security-evidence.mjs --origin https://your-domain.com --authorized --output ./lumen-web-check.json');process.exitCode=1;return; }
  if (options.help) { console.log('관리 권한이 있는 사이트의 /, /robots.txt, /sitemap.xml을 최대 한 번씩 읽습니다. 로그인, 리다이렉트, 하위 URL 수집과 취약점 공격은 하지 않습니다.\nnode scripts/collect-security-evidence.mjs --origin https://your-domain.com --authorized --output ./lumen-web-check.json\n출력 파일은 새로 생성하며 덮어쓰지 않습니다. 본문, 원문 헤더, 쿠키 값, IP 주소를 저장하지 않습니다.');return; }
  let file;
  try {
    // Reserve a new private file before any network work; reject symlinks and overwrites via wx.
    file=await open(options.output,'wx',0o600);
    const evidence=await collectEvidence(options.origin);
    await file.writeFile(`${JSON.stringify(evidence,null,2)}\n`);
    console.log(JSON.stringify({saved:true,collector:COLLECTOR,requestLimit:3,observedAt:evidence.observedAt,statuses:[evidence.home,evidence.robots,evidence.sitemap].map(x=>({status:x.status,error:x.error})),independentlyAuthenticated:false}));
  } catch { console.error('점검 파일을 만들지 못했습니다. 출력 폴더와 파일 중복 여부를 확인하세요. 원문 오류나 비밀값은 출력하지 않습니다.');process.exitCode=1; }
  finally { await file?.close(); }
}
if (process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await main();

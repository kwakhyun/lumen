import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ORIGIN, GUIDE_PATH, inspectHtml, inspectRobots, robotsAllows, inspectSitemap, classifyResult } from '../scripts/audit-public-indexing.mjs';

const pageResult = (overrides = {}) => ({ profile: 'browser', kind: 'page', pathname: '/', url: `${DEFAULT_ORIGIN}/`, status: 200, headers: {}, ...overrides });

test('HTML audit extracts public metadata and SSR evidence without retaining scripts or body', () => {
  const html = `<html><head><title>Lumen &amp; 검색</title><link href='${DEFAULT_ORIGIN}/?token=DO_NOT_LOG' rel='canonical'><meta name=robots content='index, follow'></head><body><h1>AI는 우리 브랜드를 어떻게 소개하고 있을까요?</h1><a href='${GUIDE_PATH}'>가이드</a><script>const secret='DO_NOT_LOG'; const fake='<meta name="robots" content="noindex">';</script><p>BODY_NOT_RETAINED</p></body></html>`;
  const result = inspectHtml(html);
  assert.equal(result.title,'Lumen & 검색');assert.deepEqual(result.canonicals,[`${DEFAULT_ORIGIN}/`]);assert.equal(result.hasGuideLink,true);assert.equal(result.expectedContentFound,true);assert.ok(result.ssrTextCharacters>30);
  assert.equal(result.robots.length,1);assert.doesNotMatch(JSON.stringify(result),/DO_NOT_LOG|BODY_NOT_RETAINED/);
  assert.deepEqual(classifyResult(pageResult({html:result})),[]);
});

test('index restrictions are scoped to relevant UA and body error metadata is detected', () => {
  const html=inspectHtml('<html><head><title>Page</title><link rel="canonical" href="/"></head><body>AI는 우리 브랜드를<meta name="robots" content="noindex, nofollow"><a href="/guides/free-ai-brand-tracking">가이드</a></body></html>');
  const codes=classifyResult(pageResult({html})).map(item=>item.code);
  assert.ok(codes.includes('html_noindex'));assert.ok(codes.includes('html_nofollow'));
  const botSpecific=pageResult({headers:{'x-robots-tag':'googlebot: noindex, nofollow'},html:{...html,robots:[]}});
  assert.ok(!classifyResult(botSpecific).some(item=>item.code==='header_noindex'));
  assert.ok(classifyResult({...botSpecific,profile:'Googlebot'}).some(item=>item.code==='header_noindex'));
  assert.ok(classifyResult(pageResult({headers:{'x-robots-tag':'none'}})).some(item=>item.code==='header_noindex'));
});

test('robots sanitizer omits comments and unknown data; specificity and allow tie are respected', () => {
  const parsed=inspectRobots(`User-agent: *\nDisallow: /\nAllow: /guides/\n# DO_NOT_LOG\nSecret: DO_NOT_LOG\nSitemap: ${DEFAULT_ORIGIN}/sitemap.xml?key=DO_NOT_LOG\nUser-agent: Googlebot\nDisallow: /guides/\nAllow: /guides/free-ai-brand-tracking$`);
  assert.doesNotMatch(parsed.rawSanitized,/DO_NOT_LOG/);
  assert.equal(robotsAllows(parsed.groups,'bingbot','/'),false);
  assert.equal(robotsAllows(parsed.groups,'bingbot',GUIDE_PATH),true);
  assert.equal(robotsAllows(parsed.groups,'Googlebot',GUIDE_PATH),true);
  assert.equal(robotsAllows(parsed.groups,'Googlebot',`${GUIDE_PATH}/other`),false);
  assert.equal(robotsAllows(parsed.groups,'Googlebot','/'),true,'specific agent group replaces wildcard group');
  const tie=inspectRobots('User-agent: *\nDisallow: /\nAllow: /');assert.equal(robotsAllows(tie.groups,'PerplexityBot','/'),true);
  const wildcard=inspectRobots('User-agent: *\nDisallow: /*secret$');assert.equal(robotsAllows(wildcard.groups,'OAI-SearchBot','/something/secret'),false);
});

test('sitemap parser keeps URL discovery and drops query strings and unrecognized paths', () => {
  const result=inspectSitemap(`<urlset><url><loc>${DEFAULT_ORIGIN}/</loc></url><url><loc>${DEFAULT_ORIGIN}${GUIDE_PATH}?token=DO_NOT_LOG&amp;a=1</loc></url><url><loc>${DEFAULT_ORIGIN}/private/DO_NOT_LOG</loc></url></urlset>`);
  assert.equal(result.isUrlset,true);assert.equal(result.urls.length,3);assert.equal(result.urls[1],`${DEFAULT_ORIGIN}${GUIDE_PATH}`);assert.doesNotMatch(JSON.stringify(result),/DO_NOT_LOG/);
});

test('public block, soft 404, redirect and private API checks never imply indexed status', () => {
  assert.ok(classifyResult(pageResult({status:403})).some(item=>item.code==='public_access_blocked'));
  assert.ok(classifyResult(pageResult({status:302})).some(item=>item.code==='redirect'));
  assert.ok(classifyResult(pageResult({kind:'not-found'})).some(item=>item.code==='soft_404'));
  assert.ok(classifyResult(pageResult({html:inspectHtml('<html><head><title>404 - Page not found</title></head><body>Not found</body></html>')})).some(item=>item.code==='soft_404'));
  assert.deepEqual(classifyResult(pageResult({kind:'private-api',status:401})),[]);
  assert.deepEqual(classifyResult(pageResult({kind:'not-found',status:404})),[]);
  assert.equal(classifyResult(pageResult({error:'timeout_15_seconds'}))[0].code,'request_failed');
});

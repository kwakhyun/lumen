#!/usr/bin/env node
/** Read-only public HTTP audit. No login, cookies, environment variables, or index-submission calls. */
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_ORIGIN = 'https://lumen-ai-visibility.khyun97.chatgpt.site';
export const GUIDE_PATH = '/guides/free-ai-brand-tracking';
const MISSING_PATH = '/__lumen_crawl_audit_missing__';
const TIMEOUT_MS = 15_000;
const MAX_REQUESTS = 20;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_ROBOTS_BYTES = 32 * 1024;
const PUBLIC_PATHS = new Set(['/', GUIDE_PATH, '/methodology', '/privacy', '/terms', '/robots.txt', '/sitemap.xml']);
const SAFE_REDIRECT_PATHS = new Set([...PUBLIC_PATHS, '/dashboard', '/signin-with-chatgpt', '/signout-with-chatgpt', '/callback']);
const PROFILES = [
  { name: 'browser', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' },
  { name: 'Googlebot', userAgent: 'Googlebot' },
  { name: 'bingbot', userAgent: 'bingbot' },
  { name: 'OAI-SearchBot', userAgent: 'OAI-SearchBot' },
  { name: 'PerplexityBot', userAgent: 'PerplexityBot' },
];

const compact = (value, max = 256) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, name) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (!name.startsWith('#')) return named[name.toLowerCase()] ?? match;
    const number = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return number >= 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '';
  });
}
function attributes(tag) {
  const output = {};
  for (const match of tag.matchAll(/([a-z_:][a-z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) output[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  return output;
}
function safeUrl(value, origin, paths = PUBLIC_PATHS) {
  try {
    const url = new URL(value, origin);
    if (!['https:', 'http:'].includes(url.protocol)) return '[unsupported URL]';
    const path = paths.has(url.pathname) ? url.pathname : '/[unrecognized-path]';
    return `${url.origin}${path}`;
  } catch { return '[invalid URL]'; }
}
const hasNoindex = value => /(?:^|[\s,;:])(?:noindex|none)(?=$|[\s,;])/i.test(value);
const hasNofollow = value => /(?:^|[\s,;:])(?:nofollow|none)(?=$|[\s,;])/i.test(value);

/** Pure fixture-friendly parser. Never returns HTML, scripts, or answer/user content. */
export function inspectHtml(html, { origin = DEFAULT_ORIGIN, pathname = '/' } = {}) {
  const withoutScripts = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const head = withoutScripts.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] ?? withoutScripts;
  const body = withoutScripts.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] ?? withoutScripts;
  const text = compact(decodeEntities(body.replace(/<[^>]*>/g, ' ')), MAX_BODY_BYTES);
  const title = compact(decodeEntities(head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]?.replace(/<[^>]*>/g, ' ') ?? ''), 200);
  const robots = [];
  for (const match of withoutScripts.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]), name = (attrs.name ?? '').toLowerCase();
    if (['robots', 'googlebot', 'bingbot', 'oai-searchbot', 'perplexitybot'].includes(name)) robots.push({ name, content: compact(attrs.content, 300) });
  }
  const canonicals = [];
  for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if ((attrs.rel ?? '').toLowerCase().split(/\s+/).includes('canonical') && attrs.href) canonicals.push(safeUrl(attrs.href, origin));
  }
  let hasGuideLink = false;
  for (const match of body.matchAll(/<a\b[^>]*>/gi)) {
    const href = attributes(match[0]).href;
    try { const url = new URL(href ?? '', origin); if (url.origin === origin && url.pathname === GUIDE_PATH) hasGuideLink = true; } catch { /* Invalid links do not prove discoverability. */ }
  }
  const expectedContentFound = pathname === '/' ? text.includes('AI는 우리 브랜드를')
    : pathname === GUIDE_PATH ? text.includes('브랜드 언급과 인용을') && text.includes('무료로 추적하는 방법')
      : pathname === '/methodology' ? text.includes('지표를 읽는 방법') : null;
  const notFoundSignal = /(?:\b404\b|page\s+not\s+found|페이지를\s*찾을\s*수\s*없|찾을\s*수\s*없는\s*페이지)/i.test(title)
    || (text.length < 1500 && /(?:\b404\b|page\s+not\s+found|페이지를\s*찾을\s*수\s*없|찾을\s*수\s*없는\s*페이지)/i.test(text));
  return { title, ssrTextCharacters: text.length, hasHtmlDocument: /<html\b/i.test(html), robots, canonicals, hasGuideLink, expectedContentFound, notFoundSignal };
}

function robotPath(value) {
  const path = value.split(/[?#]/, 1)[0].slice(0, 300);
  return /^[\w/.*$%~!()+,:;@=-]*$/.test(path) && !/(?:AIza|sk[-_]|eyJ[A-Za-z0-9_-]{15})/.test(path) && !/[A-Za-z0-9_-]{65}/.test(path) ? path : '[redacted-rule]';
}
/** Keep known robots directives only; comments and unknown server text are not logged. */
export function inspectRobots(raw, origin = DEFAULT_ORIGIN) {
  const groups = [], sitemaps = [], sanitizedLines = [];
  let group = null;
  for (const original of raw.slice(0, MAX_ROBOTS_BYTES).split(/\r?\n/)) {
    const line = original.replace(/#.*$/, '').trim();
    const match = /^(user-agent|allow|disallow|sitemap|crawl-delay)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase(), value = match[2].trim();
    if (key === 'user-agent') {
      if (!/^[a-z0-9*_.-]{1,100}$/i.test(value)) continue;
      if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group); }
      group.agents.push(value.toLowerCase()); sanitizedLines.push(`User-agent: ${value}`);
    } else if (key === 'allow' || key === 'disallow') {
      const path = robotPath(value);
      if (!group || path === '[redacted-rule]') continue;
      group.rules.push({ allow: key === 'allow', path }); sanitizedLines.push(`${key === 'allow' ? 'Allow' : 'Disallow'}: ${path}`);
    } else if (key === 'sitemap') {
      const url = safeUrl(value, origin); sitemaps.push(url); sanitizedLines.push(`Sitemap: ${url}`);
    } else if (/^\d+(?:\.\d+)?$/.test(value)) sanitizedLines.push(`Crawl-delay: ${value.slice(0, 20)}`);
  }
  return { rawSanitized: sanitizedLines.join('\n').slice(0, 8000), groups: groups.slice(0, 100), sitemaps: sitemaps.slice(0, 50), rawWasTruncated: raw.length > MAX_ROBOTS_BYTES || sanitizedLines.join('\n').length > 8000 };
}
export function robotsAllows(groups, agent, pathname) {
  const name = agent.toLowerCase();
  const matches = groups.map(group => ({ group, specificity: Math.max(-1, ...group.agents.map(item => item === '*' ? 0 : name.includes(item) ? item.length : -1)) })).filter(item => item.specificity >= 0);
  if (!matches.length) return true;
  const specificity = Math.max(...matches.map(item => item.specificity));
  let best = null;
  for (const { group, specificity: score } of matches) {
    if (score !== specificity) continue;
    for (const rule of group.rules) {
      if (!rule.path) continue;
      const end = rule.path.endsWith('$'), source = (end ? rule.path.slice(0, -1) : rule.path).split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
      if (!new RegExp(`^${source}${end ? '$' : ''}`).test(pathname)) continue;
      const length = rule.path.replace(/\*/g, '').length;
      if (!best || length > best.length || (length === best.length && rule.allow)) best = { length, allow: rule.allow };
    }
  }
  return best?.allow ?? true;
}
export function inspectSitemap(xml, origin = DEFAULT_ORIGIN) {
  return { urls: [...xml.matchAll(/<loc\b[^>]*>\s*([\s\S]*?)\s*<\/loc\s*>/gi)].slice(0, 50).map(match => safeUrl(decodeEntities(match[1].trim()), origin)), isUrlset: /<urlset\b/i.test(xml), isSitemapIndex: /<sitemapindex\b/i.test(xml) };
}
function headerNoindex(value, agent) {
  let scope = '*';
  for (const part of value.split(',')) {
    const scoped = /^\s*([a-z][a-z0-9_-]*)\s*:\s*(.*)$/i.exec(part);
    let directives = part;
    if (scoped && !['max-snippet', 'max-image-preview', 'max-video-preview', 'unavailable_after'].includes(scoped[1].toLowerCase())) { scope = scoped[1].toLowerCase(); directives = scoped[2]; }
    if ((scope === '*' || agent.toLowerCase().includes(scope)) && hasNoindex(directives)) return true;
  }
  return false;
}
export function classifyResult(result) {
  const findings = [], add = (code, severity, message) => findings.push({ code, severity, message });
  if (result.error) { add('request_failed', 'warning', 'HTTP 요청을 완료하지 못했습니다. 검색엔진의 접근 실패를 직접 확인한 결과는 아닙니다.'); return findings; }
  const { status, kind, html, headers, profile } = result;
  if (kind === 'private-api') {
    if (![401, 403].includes(status)) add('private_api_unexpected_status', 'warning', '익명 비공개 API 요청이 예상한 401/403과 다릅니다. 본문은 저장하지 않았습니다.');
    return findings;
  }
  if (kind === 'not-found') {
    if (status === 200) add('soft_404', 'error', '존재하지 않는 점검 경로가 HTTP 200을 반환했습니다.');
    else if (status !== 404) add('not_found_unexpected_status', 'warning', '없는 경로가 예상한 404와 다른 응답을 반환했습니다.');
    return findings;
  }
  if ([401, 403, 429].includes(status)) add('public_access_blocked', 'error', '공개 경로의 이 요청이 인증, 접근 또는 요청 제한 응답을 받았습니다.');
  else if (status >= 400) add('public_http_error', 'error', '공개 경로가 HTTP 오류를 반환했습니다.');
  if (status >= 300 && status < 400) add('redirect', 'warning', '리다이렉트가 있습니다. 인증 흐름을 따라가지 않았습니다.');
  if (headerNoindex(headers['x-robots-tag'] ?? '', profile)) add('header_noindex', 'error', '이 사용자 에이전트에 적용되는 X-Robots-Tag 색인 금지 지시가 있습니다.');
  if (kind === 'page' && status === 200) {
    if (!html) add('unexpected_content_type', 'error', '공개 페이지가 HTML 응답을 반환하지 않았습니다.');
    else {
      if (html.robots.some(meta => (meta.name === 'robots' || meta.name === profile.toLowerCase()) && hasNoindex(meta.content))) add('html_noindex', 'error', 'HTML 메타태그에 이 사용자 에이전트의 색인 금지 지시가 있습니다.');
      if (html.robots.some(meta => (meta.name === 'robots' || meta.name === profile.toLowerCase()) && hasNofollow(meta.content))) add('html_nofollow', 'warning', 'HTML에 링크 추적 제한 지시가 있습니다.');
      if (html.notFoundSignal && !html.expectedContentFound) add('soft_404', 'error', 'HTTP 200 HTML이 정상 본문 대신 오류 페이지 신호를 포함합니다.');
      if (!result.bodyTruncated && html.expectedContentFound === false) add('expected_ssr_content_missing', 'warning', '예상한 공개 본문 문구를 HTML에서 확인하지 못했습니다.');
      if (!html.title) add('title_missing', 'warning', 'HTML 제목을 확인하지 못했습니다.');
      if (html.canonicals.length !== 1) add('canonical_count', 'warning', 'canonical 링크가 없거나 여러 개입니다.');
      else if (html.canonicals[0] !== result.url) add('canonical_mismatch', 'warning', 'canonical이 요청한 공개 URL과 다릅니다.');
      if (result.pathname === '/' && !html.hasGuideLink) add('guide_link_missing', 'warning', '홈 HTML에서 가이드 내부 링크를 확인하지 못했습니다.');
    }
  }
  if (result.bodyTruncated) add('body_truncated', 'warning', '본문 읽기 한도에 도달했습니다. 확인하지 못한 나머지는 판정하지 않습니다.');
  return findings;
}

async function readBoundedBody(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return { text: '', bytes: 0, truncated: false };
  const decoder = new TextDecoder(); let bytes = 0, text = '', truncated = false;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      const available = maxBytes - bytes;
      if (next.value.byteLength > available) { text += decoder.decode(next.value.slice(0, available), { stream: true }); bytes += available; truncated = true; await reader.cancel(); break; }
      bytes += next.value.byteLength; text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  return { text, bytes, truncated };
}
async function inspectRequest(task, origin) {
  const url = new URL(task.pathname, origin).href;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS), started = Date.now();
  const result = { profile: task.profile.name, kind: task.kind, pathname: task.pathname, url, status: null, headers: {}, durationMs: 0 };
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { 'User-Agent': task.profile.userAgent, Accept: task.kind === 'page' ? 'text/html' : '*/*' } });
    result.status = response.status;
    for (const name of ['content-type', 'x-robots-tag', 'cache-control']) if (response.headers.has(name)) result.headers[name] = compact(response.headers.get(name), 512);
    if (response.headers.has('location')) result.headers.location = safeUrl(response.headers.get('location'), origin, SAFE_REDIRECT_PATHS);
    if (task.kind === 'private-api' || response.status >= 300 && response.status < 400) await response.body?.cancel();
    else {
      const body = await readBoundedBody(response, task.kind === 'robots' ? MAX_ROBOTS_BYTES : MAX_BODY_BYTES);
      result.bodyBytesRead = body.bytes; result.bodyTruncated = body.truncated;
      const contentType = result.headers['content-type'] ?? '';
      if (task.kind === 'robots') result.robots = inspectRobots(body.text, origin);
      else if (task.kind === 'sitemap') result.sitemap = inspectSitemap(body.text, origin);
      else if (/\btext\/html\b|\bapplication\/xhtml\+xml\b/i.test(contentType)) result.html = inspectHtml(body.text, { origin, pathname: task.pathname });
    }
  } catch {
    result.error = controller.signal.aborted ? 'timeout_15_seconds' : 'network_or_response_error';
  } finally { clearTimeout(timer); result.durationMs = Date.now() - started; }
  result.findings = classifyResult(result);
  return result;
}

export async function runPublicIndexingAudit(origin = DEFAULT_ORIGIN) {
  if (origin !== DEFAULT_ORIGIN) throw new Error('이 도구는 승인된 Lumen 공개 도메인만 검사합니다.');
  const tasks = PROFILES.flatMap(profile => ['/', GUIDE_PATH].map(pathname => ({ profile, pathname, kind: 'page' })));
  for (const [pathname, kind] of [['/robots.txt', 'robots'], ['/sitemap.xml', 'sitemap'], ['/methodology', 'page'], [MISSING_PATH, 'not-found'], ['/api/impact', 'private-api']]) tasks.push({ profile: PROFILES[0], pathname, kind });
  if (tasks.length > MAX_REQUESTS) throw new Error('최대 요청 수를 초과했습니다.');
  const startedAt = new Date().toISOString(), results = new Array(tasks.length); let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => { while (cursor < tasks.length) { const index = cursor++; results[index] = await inspectRequest(tasks[index], origin); } }));
  const robotsResult = results.find(item => item.kind === 'robots'), sitemapResult = results.find(item => item.kind === 'sitemap');
  const robotsAccess = robotsResult?.status === 200 && robotsResult.robots?.groups.length ? PROFILES.flatMap(profile => ['/', GUIDE_PATH].map(pathname => ({ profile: profile.name, pathname, allowed: robotsAllows(robotsResult.robots.groups, profile.name, pathname) }))) : [];
  const findings = results.flatMap(item => item.findings.map(finding => ({ ...finding, profile: item.profile, pathname: item.pathname })));
  for (const access of robotsAccess) if (!access.allowed) findings.push({ code: 'robots_disallow', severity: 'error', message: 'robots.txt가 이 사용자 에이전트의 공개 경로 접근을 금지합니다.', profile: access.profile, pathname: access.pathname });
  if (robotsResult?.status === 200 && !robotsResult.robots?.groups.length) findings.push({ code: 'robots_rules_missing', severity: 'warning', message: 'robots.txt에서 사용자 에이전트 규칙을 확인하지 못했습니다.', pathname: '/robots.txt' });
  if (sitemapResult?.status === 200 && (!sitemapResult.sitemap?.isUrlset || !sitemapResult.sitemap.urls.length)) findings.push({ code: 'sitemap_invalid_or_empty', severity: 'warning', message: 'sitemap의 URL 목록을 확인하지 못했습니다.', pathname: '/sitemap.xml' });
  for (const pathname of ['/', GUIDE_PATH, '/methodology']) if (sitemapResult?.status === 200 && !sitemapResult.sitemap?.urls.includes(new URL(pathname, origin).href)) findings.push({ code: 'sitemap_url_missing', severity: 'warning', message: '공개 URL이 sitemap에 없습니다.', pathname });
  return { schemaVersion: 1, origin, startedAt, finishedAt: new Date().toISOString(), requestCount: tasks.length, requestLimit: MAX_REQUESTS, concurrency: 3, timeoutMs: TIMEOUT_MS,
    limitations: ['사용자 에이전트 문자열만 모사했습니다. 실제 검색엔진 IP, 역방향 DNS 또는 검색엔진의 수집 결과를 확인하지 않았습니다.', '인증, 쿠키, 환경변수와 개인 데이터는 사용하지 않았고 리다이렉트를 따라가지 않았습니다.', 'HTTP 접근과 공개 문서의 색인 지시만 확인합니다. 색인 완료, 검색 순위와 AI 검색의 콘텐츠 반영 여부는 판단하지 않습니다.', '본문 전체, Set-Cookie와 인증 헤더는 저장하지 않습니다. URL의 쿼리와 인증 경로의 상세 정보는 출력하지 않습니다.'],
    indexingStatus: 'not_verified', results, robotsAccess, findings, summary: { errors: findings.filter(item => item.severity === 'error').length, warnings: findings.filter(item => item.severity === 'warning').length } };
}

async function main() {
  let origin = DEFAULT_ORIGIN, output;
  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index];
    if (arg === '--help') { process.stdout.write('Usage: node scripts/audit-public-indexing.mjs [--origin https://lumen-ai-visibility.khyun97.chatgpt.site] [--output work/crawl-audit/report.json]\nRead-only: 15 anonymous GET requests, concurrency 3, 15-second timeout.\n'); return; }
    if (arg !== '--origin' && arg !== '--output') throw new Error('지원하지 않는 옵션입니다. --help를 확인하세요.');
    const value = process.argv[++index]; if (!value || value.startsWith('--')) throw new Error('옵션 값이 필요합니다.');
    if (arg === '--origin') origin = value.replace(/\/$/, ''); else output = value;
  }
  if (origin !== DEFAULT_ORIGIN) throw new Error('이 도구는 승인된 Lumen 공개 도메인만 검사합니다.');
  let outputPath;
  if (output) {
    const root = fileURLToPath(new URL('../', import.meta.url)), allowed = resolve(root, 'work/crawl-audit');
    outputPath = resolve(root, output); const child = relative(allowed, outputPath);
    if (!child || child.startsWith('..') || isAbsolute(child) || !outputPath.endsWith('.json')) throw new Error('출력 파일은 ignored work/crawl-audit 안의 JSON 경로를 사용하세요.');
  }
  const report = await runPublicIndexingAudit(origin);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) { await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 }); await writeFile(outputPath, serialized, { mode: 0o600 }); await chmod(outputPath, 0o600); }
  process.stdout.write(serialized);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { process.stderr.write('공개 접근 점검을 완료하지 못했습니다. 옵션과 네트워크 상태를 확인하세요.\n'); process.exitCode = 1; });

import { SECURITY_BOTS, type SecurityCheck, type SecurityComparison, type SecurityEvidence, type SecurityFinding } from './security-types';

const HEADERS = 'https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html';
const CSP = 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP';
const ROBOTS = 'https://developers.google.com/search/docs/crawling-indexing/robots/intro';
const INDEXING = 'https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers';

/** Classifies a bounded observation, never the overall security of the service. */
export function assessSecurityEvidence(e: SecurityEvidence): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const add = (id: string, category: SecurityFinding['category'], state: SecurityFinding['state'], title: string, detail: string, recommendation: string, referenceUrl = HEADERS, priority: SecurityFinding['priority'] = 'medium') => findings.push({ id, category, state, title, detail, recommendation, referenceUrl, priority });
  const accessible = e.home.status === 200 && e.home.error === null;
  const headers = accessible ? e.home.headers : null;
  const html = accessible && e.home.bodyComplete && e.home.contentType === 'html' ? e.home.html : null;
  const unavailable = '정상 응답의 설정을 확인하지 못했습니다. 연결 실패나 이동 응답을 설정 누락으로 판단하지 않습니다.';
  add('https', 'security', accessible ? 'pass' : 'unknown', 'HTTPS 연결', accessible ? '인증서 검증을 켠 수집기가 홈페이지에서 HTTPS 200 응답을 관측했다고 보고했습니다.' : `홈페이지 응답: ${e.home.status ?? '없음'}. 리다이렉트와 인증 화면은 따라가지 않았습니다.`, '배포한 대표 HTTPS 주소와 인증서, 공개 접근 여부를 확인하세요. 이 점검은 TLS 버전이나 서비스 전체의 안전성을 검증하지 않습니다.');
  add('hsts', 'security', !headers ? 'unknown' : headers.hsts === 'enabled' ? 'pass' : 'attention', 'HTTPS 유지 정책', !headers ? unavailable : headers.hsts === 'enabled' ? '유효 기간이 180일 이상인 HSTS 설정이 관측됐습니다.' : headers.hsts === 'short' ? 'HSTS 유효 기간이 180일보다 짧습니다.' : 'HSTS가 없거나, 해제됐거나, 유효한 설정으로 읽히지 않았습니다.', 'HTTPS가 안정적으로 동작하는지 먼저 확인한 뒤 HSTS를 적용하세요. includeSubDomains와 preload는 모든 하위 도메인을 검토한 뒤 결정해야 합니다.');
  add('csp', 'security', !headers ? 'unknown' : headers.csp === 'present' ? 'unknown' : 'attention', '콘텐츠 보안 정책', !headers ? unavailable : headers.csp === 'present' ? '강제 CSP 헤더가 있습니다. 정책의 실효성과 애플리케이션 호환성은 별도 검토가 필요합니다.' : headers.csp === 'report-only' ? 'Report-Only 정책만 있습니다. 위반을 보고하지만 리소스를 차단하지 않습니다.' : headers.csp === 'unsafe' ? '넓은 스크립트 허용 또는 실행 허용 표현이 관측됐습니다. 다른 정책과 nonce의 영향은 별도 검토해야 합니다.' : '강제 CSP 헤더를 확인하지 못했습니다. HTML 메타 정책은 이 헤더 점검의 범위 밖입니다.', '사용하는 스크립트와 외부 연결을 정리하고 Report-Only로 호환성을 확인한 뒤 강제 정책으로 전환하세요. 복사한 범용 정책을 바로 적용하지 마세요.', CSP);
  add('nosniff', 'security', !headers ? 'unknown' : headers.nosniff ? 'pass' : 'attention', '콘텐츠 형식 보호', !headers ? unavailable : headers.nosniff ? 'X-Content-Type-Options: nosniff가 관측됐습니다.' : '유효한 nosniff 설정을 확인하지 못했습니다.', '응답의 Content-Type을 정확히 지정하고 X-Content-Type-Options: nosniff를 설정하세요.');
  add('framing', 'security', !headers ? 'unknown' : headers.framing === 'restricted' ? 'pass' : 'attention', '외부 페이지의 화면 삽입 제한', !headers ? unavailable : headers.framing === 'restricted' ? '자기 출처로 제한하거나 삽입을 금지하는 정책이 관측됐습니다.' : '명확한 화면 삽입 제한을 확인하지 못했습니다. 임베드 제품은 허용 대상 검토가 필요합니다.', "제품의 임베드 요구를 확인한 뒤 CSP frame-ancestors 또는 X-Frame-Options를 설정하세요. 여러 정책이 있으면 실제 브라우저에서 함께 검증하세요.");
  add('referrer', 'security', !headers ? 'unknown' : headers.referrer === 'restricted' ? 'pass' : 'attention', '방문 출처 정보 최소화', !headers ? unavailable : headers.referrer === 'restricted' ? '외부로 전체 URL을 넘기지 않도록 하는 정책이 관측됐습니다.' : '명시적인 보수적 Referrer-Policy를 확인하지 못했습니다. 브라우저 기본값과 실제 유출 여부는 별도입니다.', 'strict-origin-when-cross-origin 등 필요한 출처 정보만 전달하는 정책을 검토하고 URL에 비밀값을 넣지 마세요.', HEADERS, 'low');
  const cookies = accessible ? e.home.cookies : null;
  add('cookies', 'security', !cookies || cookies.total === 0 ? 'unknown' : cookies.missingSecure + cookies.missingHttpOnly + cookies.missingSameSite > 0 ? 'attention' : 'pass', '공개 응답의 쿠키 속성', !cookies ? unavailable : cookies.total === 0 ? '이 비로그인 응답에서 쿠키를 관측하지 못했습니다. 로그인 세션 쿠키는 점검하지 않았습니다.' : `${cookies.total}개 쿠키에서 Secure 미확인 ${cookies.missingSecure}개, HttpOnly 미확인 ${cookies.missingHttpOnly}개, SameSite 미확인 ${cookies.missingSameSite}개입니다. 이름과 값은 저장하지 않았습니다.`, '인증 쿠키에는 Secure, HttpOnly와 적절한 SameSite를 적용하세요. 자바스크립트가 읽어야 하는 비인증 쿠키는 목적에 맞게 판단하세요.');
  add('mixed-content', 'security', !html ? 'unknown' : html.mixedContent ? 'attention' : 'pass', 'HTTP 리소스 참조', !html ? 'HTML 전체를 읽지 못해 판정하지 않았습니다.' : html.mixedContent ? '정적 HTML에서 HTTP 리소스 참조를 발견했습니다. 실제 요청과 브라우저 차단 여부는 따로 확인해야 합니다.' : '정적 HTML에서 점검 대상 HTTP 리소스 참조를 발견하지 못했습니다. 동적 스크립트와 CSS 내부 참조는 검사하지 않았습니다.', '외부 리소스를 HTTPS로 바꾸고 브라우저 개발자 도구에서 실제 혼합 콘텐츠 요청을 확인하세요.', 'https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content');
  add('indexing', 'discovery', !html || html.indexing === 'unknown' ? 'unknown' : html.indexing === 'blocked' ? 'attention' : 'pass', '공개 홈의 색인 지시', !html || html.indexing === 'unknown' ? 'HTML이나 응답 헤더에서 색인 지시를 충분히 확인하지 못했습니다.' : html.indexing === 'blocked' ? '점검 대상 검색 봇에 적용될 수 있는 noindex 지시가 관측됐습니다.' : '점검 대상 noindex 지시가 관측되지 않았습니다. 실제 색인 완료를 뜻하지 않습니다.', '검색에 공개할 페이지인지 먼저 확인하세요. 공개 페이지의 불필요한 noindex만 수정하고 계정 화면의 접근 제한은 유지하세요.', INDEXING);
  add('canonical', 'discovery', !html ? 'unknown' : html.canonical === 'self' ? 'pass' : 'attention', '대표 URL', !html ? 'HTML 전체를 읽지 못해 판정하지 않았습니다.' : html.canonical === 'self' ? '홈페이지 자신을 가리키는 canonical이 관측됐습니다.' : 'canonical이 없거나, 다른 URL을 가리키거나, 모호한 설정입니다. 다른 대표 주소를 쓰는 경우는 정상일 수 있습니다.', '실제 대표 주소에 맞춰 canonical, 내부 링크와 사이트맵을 일치시키세요. 현재 페이지를 무조건 대표 주소로 바꾸지 마세요.', 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls', 'low');
  add('title', 'discovery', !html ? 'unknown' : html.title ? 'pass' : 'attention', '페이지 제목', !html ? 'HTML 전체를 읽지 못해 판정하지 않았습니다.' : html.title ? '비어 있지 않은 title 요소가 관측됐습니다.' : '정적 HTML에서 페이지 제목을 확인하지 못했습니다.', '브랜드와 페이지의 주제를 설명하는 제목을 서버가 제공하는 HTML에 넣으세요.', 'https://developers.google.com/search/docs/appearance/title-link', 'low');
  for (const bot of SECURITY_BOTS) {
    const state = e.robots.status === 200 && !e.robots.error && e.robots.bodyComplete ? e.robots.rules[bot] : 'unknown';
    add(`robots-${bot.toLowerCase()}`, 'discovery', state === 'unknown' ? 'unknown' : state === 'allowed' ? 'pass' : 'attention', `${bot}의 홈 수집 설정`, state === 'unknown' ? 'robots.txt를 충분히 확인하지 못했습니다. 파일 부재나 실패를 수집 차단으로 단정하지 않습니다.' : state === 'allowed' ? '현재 robots.txt에서 홈 경로 수집을 허용합니다. 실제 봇의 방문이나 색인 증거는 아닙니다.' : '현재 robots.txt에서 홈 경로 수집을 제한합니다.', '공개하려는 경로의 규칙을 검토하세요. robots.txt는 인증 수단이 아니므로 비공개 경로는 서버 접근 제어로 보호해야 합니다.', ROBOTS);
  }
  const map = e.sitemap;
  const knownMap = map.status === 200 && map.error === null && map.bodyComplete && map.format !== 'unknown';
  add('sitemap', 'discovery', !knownMap ? map.status === 404 ? 'attention' : 'unknown' : map.sameOriginUrls > 0 && map.otherOriginUrls === 0 ? 'pass' : 'attention', '사이트맵 발견', knownMap ? `${map.format === 'index' ? '사이트맵 인덱스' : 'URL 목록'}에서 같은 출처 주소 ${map.sameOriginUrls}개, 다른 출처 주소 ${map.otherOriginUrls}개를 관측했습니다. 하위 주소는 방문하지 않았습니다.` : map.status === 404 ? '/sitemap.xml이 없습니다. 다른 주소에서 사이트맵을 제공하는 경우는 별도 확인이 필요합니다.' : '/sitemap.xml의 전체 내용을 확인하지 못했거나 지원하는 형식이 아닙니다.', '공개 대표 URL의 사이트맵을 제공하고 검색 관리 도구에서 실제 처리 결과를 확인하세요. 다른 사이트맵 주소나 교차 사이트 제출을 사용하는 경우 의도한 설정인지 확인하세요.', 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview', 'low');
  return findings;
}

export function compareSecurityChecks(before: SecurityCheck, after: SecurityCheck): SecurityComparison {
  const base = { improved: [], regressed: [], unobserved: [] };
  if (before.siteId !== after.siteId || before.evidence.targetOrigin !== after.evidence.targetOrigin || before.evidence.collector !== after.evidence.collector || before.evidence.schemaVersion !== after.evidence.schemaVersion) return { ...base, comparable: false, reason: '같은 브랜드, 출처와 수집 버전의 기록만 비교할 수 있습니다.' };
  const a = Date.parse(before.evidence.observedAt), b = Date.parse(after.evidence.observedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return { ...base, comparable: false, reason: '기준 기록보다 나중에 관측한 결과를 선택하세요. 저장한 순서와 관측한 순서는 다를 수 있습니다.' };
  const previous = new Map(assessSecurityEvidence(before.evidence).map(f => [f.id, f.state]));
  const result: SecurityComparison = { ...base, comparable: true, reason: '공개 설정의 관측 변화입니다. 해킹 위험이나 검색 노출의 증감률로 해석하지 않습니다.' };
  for (const f of assessSecurityEvidence(after.evidence)) {
    const old = previous.get(f.id);
    if (old === 'unknown' || f.state === 'unknown' || !old) result.unobserved.push(f.id);
    else if (old === 'attention' && f.state === 'pass') result.improved.push(f.id);
    else if (old === 'pass' && f.state === 'attention') result.regressed.push(f.id);
  }
  return result;
}

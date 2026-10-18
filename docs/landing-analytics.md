# 랜딩 방문 통계

측정 ID: `G-3Q9BXQLQ4H`. 허용 주소: `https://lumen-ai-visibility.khyun97.chatgpt.site/`.

`AnalyticsConsent`는 `app/page.tsx` footer에만 설치합니다. 공통 layout이나 dashboard에는 설치하지 않습니다. 프로덕션 HTTPS의 정확한 호스트와 `/`에서 사용자가 허용한 경우에만 Google tag를 요청합니다. 동의가 없거나 거절한 경우, 로컬 개발, 다른 호스트와 경로에서는 외부 분석 스크립트를 요청하지 않습니다. GA4 향상된 측정은 해당 스트림 관리 화면에서 꺼 두어야 합니다.

동의는 버전과 선택 시각을 로컬 저장소에 보관하며 180일 후 재확인합니다. 쿠키는 host-only, 세션 만료, Lumen 전용 prefix를 사용합니다. 철회하면 Google의 `ga-disable` 플래그로 후속 수집을 차단하고 해당 prefix 쿠키의 삭제를 시도합니다. 이미 전송된 데이터의 자동 삭제를 의미하지 않습니다.

자동 `page_view`는 꺼 두고 허용 후 현재 문서에서 하나의 `page_view`를 큐에 넣습니다. 페이지 주소는 origin과 `/`, referrer는 origin만 사용하며 페이지 제목은 고정 문자열입니다. 캠페인 필드도 빈 값으로 재정의합니다. 계정 ID, 이메일, 질문, 답변, 문서를 이벤트에 넣지 않습니다. 광고 저장, 광고 사용자 데이터, 광고 개인화 동의는 항상 거절이며 Google signals와 광고 개인화 신호도 끕니다. Google이 요청을 수신할 때의 네트워크 정보까지 익명이라고 주장하지 않습니다.

공식 근거: [Google tag consent API](https://developers.google.com/tag-platform/gtagjs/reference#consent), [Google Analytics privacy controls](https://developers.google.com/tag-platform/security/guides/privacy), [GA4 configuration fields](https://developers.google.com/analytics/devguides/collection/ga4/reference/config).

`tests/analytics-consent.test.mjs`는 동의 기본 거절, allowlist, 로컬 차단, URL 정규화, 이벤트 중복 방지, 철회와 페이지 이탈 차단을 네트워크 없는 브라우저 fixture로 검증합니다. 실제 GA4 보고서 수신을 확인한 테스트는 아닙니다. 배포 후 확인에는 명시적으로 동의한 테스트 방문이 필요합니다.

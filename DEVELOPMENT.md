# Lumen 개발과 Vercel 배포

프로젝트 경로는 `/Users/kwakhyun/lumen`입니다. 이전 경로에는 이동 안내만 남아 있습니다. Node.js 22.21 이상과 공식 Turso CLI를 사용합니다.

## 로컬 실행

```sh
npm ci
cp .env.example .env.local # 기존 파일이 없을 때만 실행
# 별도 터미널에서 실행
# 실제 운영과 같은 HTTP 전송을 사용합니다.
turso dev --db-file local.db
```

`.env.local`에 `TURSO_DATABASE_URL=http://127.0.0.1:8080`을 설정하고, 로컬 서버에는 `TURSO_AUTH_TOKEN`을 비워 둡니다. `file:` URL은 사용하지 않습니다. 운영 libSQL이 NUL 포함 TEXT를 읽을 때 잘라 반환하는 차이가 있어 NUL 입력을 API와 DB 경계에서 거절합니다. 일반 한글과 JSON 안의 이스케이프된 문자열은 보존합니다.

```sh
npm run db:migrate
npm run dev
```

주소는 `http://localhost:3000`입니다. 개발 서버는 요청 주소를 `localhost`로 보고하므로, `127.0.0.1`로 열면 저장 요청이 출처 검사(`invalid_origin`)에서 거절됩니다. 마이그레이션은 적용 이력과 SHA-256을 기록하며 재실행 시 이미 적용한 파일을 건너뜁니다. 적용한 SQL 파일은 수정하지 말고 새 파일을 추가하세요. `drizzle/`의 8개 스키마 뒤에 `migrations/auth`(Google 계정 소유권 연결)와 `migrations/agents`(에이전트 실행 기록)를 순서대로 적용합니다. 뒤의 두 디렉터리는 워크스페이스 백업의 체크섬 목록에 포함되지 않습니다. 에이전트 테이블이 아직 없는 배포에서도 에이전트는 실행되며, 실행 기록만 저장되지 않습니다.

## 로그인과 비밀 변수

전체 변수명은 `.env.example`을 참고하세요. `.env.local`과 `.dev.vars`는 Git과 Vercel 업로드에서 제외합니다.

| 용도 | 변수 |
| --- | --- |
| Turso DB | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` |
| Google 로그인 | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, `AUTH_URL` |
| 기존 계정 연결 | `AUTH_LEGACY_OWNER_MAP` |
| AI 제공자 | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, 선택적 `PERPLEXITY_API_KEY` |
| 서비스 주소 | `APP_BASE_URL` |
| GA4 OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| 기존 GA4 암호화 | `INTEGRATION_ENCRYPTION_KEY`, 선택적 이전 키 `INTEGRATION_ENCRYPTION_KEY_PREVIOUS` |
| 예약 수집 실행기 | `LUMEN_AUTOMATION_SECRET`, `LUMEN_OPERATOR_USER_ID` |

Google OAuth의 웹 애플리케이션 클라이언트에 다음 승인된 리디렉션 URI를 등록합니다.

- 운영 로그인: `https://lumen-nine-rose.vercel.app/api/auth/callback/google`
- 로컬 로그인: `http://localhost:3000/api/auth/callback/google`
- GA4: 기존 `app/api/integrations/ga4/callback` 경로를 사용하며 실제 리디렉션 URI는 `APP_BASE_URL` 기준으로 구성합니다.

`AUTH_SECRET`은 충분히 긴 무작위 비밀입니다. `AUTH_LEGACY_OWNER_MAP`은 인증된 기존 이메일과 과거 소유자 ID를 연결하는 서버 전용 JSON이며 사용자 입력으로 구성하지 않습니다. 최초 로그인 후에는 Google subject와 소유자 ID의 고정 연결을 사용합니다. 임의의 `oai-authenticated-*` 헤더는 인증으로 인정하지 않습니다. 로컬 환경도 실제 Google 로그인을 사용합니다.

`/demo`는 로그인 없이 공용 샘플 워크스페이스를 엽니다. 방문자는 `lumen_guest` 쿠키로 식별되는 읽기 전용 게스트이며, 조회 요청과 샘플 에이전트 실행, 샘플 질문 응답만 허용됩니다(`lib/auth/guest.ts`). 공용 샘플은 3일이 지나면 다음 방문 때 새로 만들어집니다.

GA4 연결을 보존하려면 이전 운영의 암호화 키를 그대로 옮겨야 합니다. 새 키로 덮어쓰면 저장된 refresh token을 읽을 수 없습니다.

## 검증

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

DB 통합 검사는 각 테스트에 별도의 Turso HTTP 서버를 띄웁니다. 인증 단위 검사는 서명 없는 요청, 위조 헤더, 클라이언트의 소유권 변경, 미확인 이메일과 중복 계정 연결을 검사합니다. 기존 업무 로직 테스트만 전용 인증 fixture를 사용하며 이 파일은 배포에서 제외됩니다.

## 화면 구성과 디자인 기준

- 소개 페이지는 `app/page.tsx`와 `app/home.css`, `components/landing/`에 있습니다. 가이드, 측정 방법, 정책 페이지는 `app/landing.css`를 씁니다.
- 소개 페이지 서체(Hahmlet, Instrument Serif, JetBrains Mono)는 `next/font`가 빌드 때 내려받아 같은 출처에서 제공합니다. CSP의 `font-src 'self'`를 지키기 위한 구성이므로 외부 글꼴 링크를 추가하지 않습니다. 빌드 환경에서 Google Fonts에 접근할 수 있어야 합니다.
- 소개 페이지의 움직임은 `components/landing/landing-motion.tsx`가 `data-reveal`, `data-count` 같은 속성을 찾아 붙입니다. 움직임 줄이기 설정에서는 실행하지 않으며, 스크립트 없이도 모든 내용이 보입니다.
- 로고는 `components/lumen-mark.tsx` 하나에서 그립니다. `public/favicon.svg`와 모양을 맞춰 둡니다.
- 화면 문구는 해요체로 씁니다. 가이드와 정책 문서, AI 답변 예시는 예외입니다.
- 터치 화면에서 조작 요소는 44px 이상이어야 합니다(`components/dashboard/refresh.css`의 `pointer: coarse` 규칙). 한 화면에 채워진 버튼은 하나만 두고, 나머지는 `soft` 버튼을 씁니다.
- `public/product-preview.jpg`(1440×1000)와 `public/og-image.jpg`(1200×630)는 샘플 워크스페이스 화면으로 만든 이미지입니다. 홈 화면이나 로고가 바뀌면 다시 만듭니다.

## 운영 데이터 이전

`migrate-turso.mjs`는 스키마만 생성합니다. `import-sites-data.mjs`는 모든 원본 ID, 사용량, GA4 암호문과 작업 기록을 보존하고 비어 있지 않은 대상 DB는 거절합니다.

```sh
node --env-file=.env.local scripts/migrate-turso.mjs
node --env-file=.env.local scripts/import-sites-data.mjs --source=/secure/verified-snapshot.json
node --env-file=.env.local scripts/import-sites-data.mjs --source=/secure/verified-snapshot.json --verify
```

원본 도구의 긴 셀은 잘릴 수 있으므로 잘린 값을 그대로 이전하지 않습니다. 전체 값 복구, 무결성 검증, 마지막 페이지 확인을 끝낸 스냅샷만 사용합니다. 가져오기는 한 트랜잭션으로 실행하고 모든 테이블의 값 해시와 외래 키를 커밋 전에 검증합니다. 기존 서비스가 쓰기를 계속할 수 있으므로 운영 전환 직전에 새 스냅샷을 확보하고 다시 대조해야 합니다. 테스트용 워크스페이스 복원 API는 ID를 바꾸므로 운영 이전에 사용하지 않습니다.

## Vercel

연결된 팀은 `khyun`, 프로젝트는 `lumen`, 기본 운영 도메인은 `lumen-nine-rose.vercel.app`입니다. `vercel.json`은 Tokyo 리전과 API 실행 시간 300초를 지정합니다. 런타임은 Node.js 22입니다.

### GitHub 자동 배포

GitHub `kwakhyun/lumen` 저장소가 이 프로젝트에 연결되어 있습니다. `main`에 푸시하면 Vercel이 Production 환경변수로 빌드하고, 성공한 배포를 운영 도메인에 자동 반영합니다. 별도의 GitHub Actions 배포 토큰은 사용하지 않습니다.

변경 전에 테스트와 타입 검사, 빌드를 실행하세요. 푸시 후에는 Vercel 배포의 Git 커밋이 해당 main 커밋과 일치하는지, 상태가 READY인지, 운영 도메인이 새 배포를 가리키는지 확인합니다. 환경변수와 DB는 저장소에 포함하지 않으며 Vercel에서 별도로 관리합니다.

### 수동 검증 배포

```sh
vercel link --scope khyun --project lumen
# 환경 변수는 Vercel에 별도로 등록합니다. 키를 명령 인자나 로그에 넣지 않습니다.
vercel deploy --prod --skip-domain --scope khyun
```

배포 성공만으로 운영 전환을 완료한 것으로 보지 않습니다. DB와 로그인 연결, 소유권, 리포트, 수집, 모바일 화면과 200% 확대를 검증한 뒤 해당 배포를 promote합니다. 기존 Sites 서비스는 전환이 검증될 때까지 유지합니다.

Sites의 ChatGPT 인증과 기존 MCP 연결은 Vercel로 자동 승계되지 않습니다. 기존 예약 실행 트리거 역시 별도로 전환해야 합니다. `/api/operations/tick`은 서버용 bearer 인증을 요구하는 POST 경로입니다. 새로운 트리거가 확인되기 전에는 예약 수집의 무인 실행이 이전되었다고 간주하지 않습니다.

### 시간별 예약 실행

[새 Vercel Schedules](https://vercel.com/docs/schedules/limits)는 Hobby에서도 시간별 실행을 지원합니다. 기존 Cron Jobs의 하루 한 번 제한과 다릅니다. `hourly-due-work`는 서울 시간 매시 0분을 기준으로 최대 15분의 지연 범위 안에서 `/api/operations/scheduled`를 POST로 호출합니다. 기존 실행기의 중복 방지 잠금, 소유자별 사용량 한도와 일괄 처리 크기 1을 유지합니다.

`CRON_SECRET`은 32자 이상의 별도 무작위 비밀을 사용합니다. 이 경로는 정상 bearer 인증 뒤에도 `VERCEL_ENV=production`과 `LUMEN_SCHEDULES_ENABLED=true`가 모두 있어야 작업합니다. Preview와 운영 전환 전에는 실행하지 않습니다. 운영 전환 시 기존 트리거를 정지하고 최종 스냅샷을 반영한 다음 활성화하세요. 새로운 일정은 운영 승격 시 자동 활성화되므로 이 환경변수의 기본값을 바꾸지 마세요. 일정이 실제로 호출한 기록과 미인증 요청의 거절을 확인해야 이전 완료로 판단합니다.

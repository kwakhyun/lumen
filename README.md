# Lumen

AI 검색에서 브랜드의 언급, 인용 출처와 경쟁 브랜드를 추적하는 워크스페이스입니다. Soha AI의 사용자 경험을 조사하고 새로운 브랜딩으로 독립 구현했습니다. REA는 분석 도구로 사용했으며 앱 런타임에 포함하지 않습니다.

## 실행

Node.js 22.13 이상이 필요합니다.

```sh
npm ci
npm run db:generate
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_yummy_hannibal_king.sql
node --env-file=../.env.local scripts/run-framework.mjs dev --hostname 127.0.0.1 --port 5173
```

마이그레이션은 새 로컬 DB에서 한 번만 적용합니다. 이미 적용했다면 반복 실행하지 않습니다. 로컬 시크릿은 승인된 상위 폴더 `.env.local`에서 프로세스 메모리로만 읽고 Cloudflare의 선언된 개발 시크릿으로 전달합니다. 빌드는 환경 파일을 읽지 않는 별도 명령으로 실행합니다.

개발용 로그인은 loopback에서만 제공되는 Sites mock auth입니다. 배포 환경은 Sites의 ChatGPT 로그인과 소유자 비공개 접근 정책을 사용합니다. 임의 프록시가 인증 헤더를 받도록 인터넷에 직접 노출하지 마세요.

## 주요 기능

- 별도 디자인의 한국어 랜딩, 반응형 대시보드, 키보드 검색
- 로그인 계정별 사이트, 프롬프트, 경쟁사와 페르소나 관리
- OpenAI 웹 검색, Gemini 일반 응답, Perplexity Agent API를 사용하는 선택적 실제 분석
- 응답 원문, 제공자 인용 annotation, 토큰 사용량, 실패 상태 저장
- 작업 임대와 재개, 비용 한도, 실패/불완전 응답 제외
- 언급률, 점유율, 인용률, 추적 브랜드 내 등장 순서, 날짜/모델 필터
- 명시적 샘플 워크스페이스, 실제 분석과 분리
- 원문/출처 상세, 콘텐츠/리포트 생성 및 편집, Markdown/CSV 내보내기
- 실행 과제 보드와 분석 근거를 사용하는 AI 어시스턴트
- 개인정보를 최소화한 유입 수집 코드와 집계(공개 수집 인프라 필요)

## 기술 구성

React 19, TypeScript, Vinext(App Router), Cloudflare Workers, D1, Drizzle, Zod. 인증은 Sites 게이트웨이. 원본은 서버 데이터베이스에 저장되며 localStorage는 선택한 워크스페이스 ID만 보관합니다.

`app/api/[[...path]]/route.ts`가 API를 제공합니다. 모든 내부 데이터 API는 로그인 및 사이트 소유권을 확인합니다. 변경 요청은 Origin을 검증하고 본문 크기를 제한합니다. API 키는 서버 바인딩에서만 읽습니다.

## 검증

```sh
npx tsc --noEmit
node --experimental-strip-types --test tests/backend.test.mjs
node --experimental-strip-types --test tests/providers.test.mjs
npm run build
```

백엔드 테스트는 Miniflare의 실제 로컬 D1을 사용하므로 localhost 소켓 실행 권한이 필요합니다. 실제 공급자 호출은 테스트 fixture와 분리하며, 실행 기록과 출시 제한은 상위 `docs/`에서 확인할 수 있습니다.

## 측정 및 제한

서버에 키가 있는 제공자만 실제 분석에서 선택할 수 있습니다. 연결 상태는 키 설정 여부이며 계정의 모델 권한이나 결제 상태가 실제 호출로 검증됐다는 뜻은 아닙니다.

| 제공자 | 모델 / 방식 | 서버 비밀 환경 변수 | 검증 상태 |
| --- | --- | --- | --- |
| OpenAI API | `gpt-4.1-mini`, Responses API 웹 검색 | `OPENAI_API_KEY` | 실제 호출 기록은 상위 `docs/` 참조 |
| Google Gemini | `gemini-3.8-flash`, 일반 텍스트 응답 | `GEMINI_API_KEY` | 코드 및 fixture 검증, 실제 API 미검증 |
| Perplexity | `perplexity/sonar`, `/v1/agent` 웹 검색 | `PERPLEXITY_API_KEY` | 코드 및 fixture 검증, 실제 API 미검증 |

Gemini는 웹 검색을 사용하지 않으며 인용을 제공하지 않습니다. 본문에 URL이 있어도 인용으로 집계하지 않습니다. Gemini 인용률 0은 검색 출처에서 브랜드가 관측되지 않았다는 의미가 아니므로 검색을 사용하는 모델의 인용률과 직접 비교하면 안 됩니다. [Google Search Grounding 약관](https://ai.google.dev/gemini-api/terms#grounding-with-google-search)의 분석 및 저장 제한 때문에 이 기능은 요청하지 않습니다. Gemini 연결에는 운영 용도에 맞는 유료 프로젝트와 출력 보존 정책을 사용하세요.

Perplexity는 [현재 Agent API 모델 목록](https://docs.perplexity.ai/docs/agent-api/models)의 명시적 Sonar 모델을 사용합니다. 검색 결과 중 답변의 인용 번호와 연결된 항목 또는 제공자의 URL annotation만 인용으로 집계합니다. 단순히 검색된 모든 페이지를 인용으로 간주하지 않습니다.

API 응답은 ChatGPT, Gemini, Perplexity 소비자 앱의 개인화된 결과와 같지 않습니다. 샘플 워크스페이스의 모든 모델 응답은 합성 데이터입니다. 결제, 자동 정기 분석, GA4 OAuth, 외부 블로그 발행은 별도 구현/연결 항목입니다. 모델과 API 확인 근거는 상위 `docs/provider-adapters.md`에 정리했습니다.

일일 계정 한도: 실제 답변 200건 예약, 분석 실행 20회, AI 생성 30회. 한 번에 질문 20개, 병렬 답변 2개. 요청 타임아웃 45초, 작업 임대 120초. 중단돼 이미 요청이 전달됐을 수 있는 응답은 비용 중복을 피하기 위해 자동 재전송하지 않습니다.

화면은 최근 30일, 최대 1,000개 응답을 로드하며 잘린 범위를 표시합니다. 전체 최근 30일 원문은 서버 CSV로 내보낼 수 있습니다. 순위는 답변 내 추적 브랜드의 첫 등장 순서이며 검색 엔진 순위가 아닙니다.

## 비공개 배포

`.openai/hosting.json`의 사이트 ID를 유지해야 합니다. Sites 스킬의 source workflow로 검증된 소스를 동기화하고 Worker/D1 마이그레이션을 배포합니다. 소스에 시크릿을 추가하지 마세요. 공개 상용 출시 전 운영 주체, 결제, 이용약관/개인정보 정책, 백업, 모니터링과 작업 큐 정책을 확정해야 합니다.

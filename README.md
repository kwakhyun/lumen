# Lumen

AI 검색에서 브랜드의 언급, 인용 출처와 경쟁 브랜드를 추적하는 워크스페이스입니다. Soha AI의 사용자 경험을 조사하고 새로운 브랜딩으로 독립 구현했습니다. REA는 분석 도구로 사용했으며 앱 런타임에 포함하지 않습니다.

## 실행

Node.js 22.13 이상이 필요합니다.

```sh
npm ci
npm run db:generate
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_yummy_hannibal_king.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_rapid_songbird.sql
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
- D1 일정과 실행 이력, 작업 재개, 운영 알림, 인증된 MCP 수집 도구
- 읽기 전용 GA4 OAuth, 속성 선택과 집계 보고서 가져오기(외부 OAuth 설정 필요)
- 명시적 동의 후에만 동작하는 랜딩 페이지 방문 통계

## 기술 구성

React 19, TypeScript, Vinext(App Router), Cloudflare Workers, D1, Drizzle, Zod. 인증은 Sites 게이트웨이. 원본은 서버 데이터베이스에 저장되며 localStorage는 선택한 워크스페이스 ID와 선택형 방문 통계의 동의 상태를 보관합니다.

`app/api/[[...path]]/route.ts`가 API를 제공합니다. 모든 내부 데이터 API는 로그인 및 사이트 소유권을 확인합니다. 변경 요청은 Origin을 검증하고 본문 크기를 제한합니다. API 키는 서버 바인딩에서만 읽습니다.

## 검증

```sh
npx tsc --noEmit
npm test
npm run build
```

백엔드 테스트는 Miniflare의 실제 로컬 D1을 사용하므로 localhost 소켓 실행 권한이 필요합니다. 실제 공급자 호출은 테스트 fixture와 분리하며, 실행 기록과 출시 제한은 상위 `docs/`에서 확인할 수 있습니다.

## 측정 및 제한

서버에 키가 있는 제공자만 실제 분석에서 선택할 수 있습니다. 연결 상태는 키 설정 여부이며 계정의 모델 권한이나 결제 상태가 실제 호출로 검증됐다는 뜻은 아닙니다.

| 제공자 | 모델 / 방식 | 서버 비밀 환경 변수 | 검증 상태 |
| --- | --- | --- | --- |
| OpenAI API | `gpt-4.1-mini`, Responses API 웹 검색 | `OPENAI_API_KEY` | 실제 호출 기록은 상위 `docs/` 참조 |
| Google Gemini | `gemini-3.8-flash`, 일반 텍스트 응답 | `GEMINI_API_KEY` | Lumen 무료 등급에서 수동 수집과 MCP 예약 수집 각 1/1 완료 |
| Perplexity | `perplexity/sonar`, `/v1/agent` 웹 검색 | `PERPLEXITY_API_KEY` | 코드 및 fixture 검증, 실제 API 미검증 |

Gemini는 웹 검색을 사용하지 않으며 인용을 제공하지 않습니다. 본문에 URL이 있어도 인용으로 집계하지 않습니다. Gemini 인용률 0은 검색 출처에서 브랜드가 관측되지 않았다는 의미가 아니므로 검색을 사용하는 모델의 인용률과 직접 비교하면 안 됩니다. [Google Search Grounding 약관](https://ai.google.dev/gemini-api/terms#grounding-with-google-search)의 분석 및 저장 제한 때문에 이 기능은 요청하지 않습니다. 현재 Lumen 프로젝트는 결제 계정이 연결되지 않은 무료 등급입니다. 공개된 질문으로 연결을 검증했으며, 무료 API의 데이터 처리 조건에 맞는 입력 및 출력 보존 정책을 운영해야 합니다.

Perplexity는 [현재 Agent API 모델 목록](https://docs.perplexity.ai/docs/agent-api/models)의 명시적 Sonar 모델을 사용합니다. 검색 결과 중 답변의 인용 번호와 연결된 항목 또는 제공자의 URL annotation만 인용으로 집계합니다. 단순히 검색된 모든 페이지를 인용으로 간주하지 않습니다.

API 응답은 ChatGPT, Gemini, Perplexity 소비자 앱의 개인화된 결과와 같지 않습니다. 샘플 워크스페이스의 모든 모델 응답은 합성 데이터입니다. 결제와 구독은 활성화하지 않은 제한형 무료 서비스이며, 외부 블로그에 자동 발행하지 않습니다. 매시 정각 클라우드 작업의 첫 MCP 호출과, 별도로 브라우저를 닫은 상태의 MCP 예약 Gemini 수집을 검증했습니다. 검증용 질문 일정은 일시 정지했고 매시간 운영 확인 작업은 활성 상태입니다. GA4는 Google OAuth 테스트 앱과 읽기 전용 실제 계정 연결, 속성 조회를 완료했습니다. 집계 import의 운영 검증 결과는 상위 `docs/google-live-connections.md`를 참조하세요. 테스트 앱의 갱신 토큰은 7일 후 재연결이 필요할 수 있습니다. 모델과 API 확인 근거는 상위 `docs/provider-adapters.md`에 정리했습니다.

기본 무료 AI 호출 예약 한도는 계정당 UTC 하루 10회/월 100회, 서비스 전체 하루 50회/월 500회입니다. 분석 답변, 질문 제안, 문서와 보조 채팅이 같은 예산을 쓰며 환경 설정으로 한도를 낮출 수 있습니다. 분석은 질문 수 × 모델 수를 먼저 예약하므로 한 번에 질문 20개를 선택할 수 있어도 남은 예산을 넘으면 실행하지 않습니다. 분석 실행은 하루 20회, 병렬 답변은 run당 2개로 제한합니다. 요청 타임아웃은 45초, 제공자 응답 상한은 1MB, 작업 임대는 120초입니다. 전달 여부가 불확실한 요청은 자동 재전송하거나 예약을 환급하지 않습니다. 호출 수 한도는 금액 상한을 보증하지 않으므로 제공자 예산도 따로 설정해야 합니다.

화면은 최근 30일, 최대 1,000개 응답을 로드하며 잘린 범위를 표시합니다. 전체 최근 30일 원문은 서버 CSV로 내보낼 수 있습니다. 순위는 답변 내 추적 브랜드의 첫 등장 순서이며 검색 엔진 순위가 아닙니다.

## 비공개 배포

`.openai/hosting.json`의 사이트 ID를 유지해야 합니다. Sites 스킬의 source workflow로 검증된 소스를 동기화하고 Worker/D1 마이그레이션을 배포합니다. 소스에 시크릿을 추가하지 마세요. 현재 비공개 접근 정책을 바꾸는 작업은 별도 배포 결정입니다. 공개 무료 출시 전 운영 주체와 연락처, 데이터 보존/삭제 정책, 백업, 모니터링, 금액 예산과 주기 수집 운영을 확정해야 합니다. 결제는 현재 출시 범위에 포함되지 않습니다.

랜딩 방문 통계는 지정된 프로덕션 hostname의 `/`에서 명시적 동의 후에만 로드합니다. 대시보드에는 설치하지 않고 계정 및 워크스페이스 데이터를 전달하지 않습니다. GA4 웹 스트림의 Enhanced Measurement를 꺼두어야 합니다. `send_page_view: false`만으로 history 기반 자동 측정이 꺼지지는 않습니다. 실제 Google 설정과 배포 검증 결과는 상위 `docs/`를 참조하세요.

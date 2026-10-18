# Lumen

AI API 답변에서 브랜드 언급과 경쟁 브랜드를 비교하는 업무용 워크스페이스입니다. 현재 무료 서비스는 웹 검색 없는 Gemini 일반 응답을 수집하며 검색 인용을 제공하지 않습니다. Soha AI의 사용자 경험을 조사하고 새로운 브랜딩으로 독립 구현했습니다. REA는 분석 도구로 사용했으며 앱 런타임에 포함하지 않습니다.

## 무료 서비스 운영 범위

운영자는 **곽현**, 공개 지원 및 데이터 문의 주소는 **khyun9685@gmail.com**입니다. 서비스의 이용 범위와 데이터 처리 방식은 `/terms`, `/privacy`, `/methodology`에 공개합니다.

현재 대상은 대한민국에서 이용하는 만 18세 이상 업무 사용자입니다. 첫 실제 AI 실행 전에 `/api/eligibility`의 네 가지 조건을 확인하고 안내 버전과 동의 시각을 계정에 저장합니다. 개인정보, 민감정보와 기밀정보를 입력하지 않습니다. 질문의 대상 국가 설정은 분석 시장이며 이용자의 소재지나 이용 자격을 바꾸지 않습니다. 무료 Gemini 입력과 응답은 Google의 제품 개선 및 인적 검토에 사용될 수 있습니다.

`LUMEN_PROVIDER_MODE=free_only`를 사용합니다. 설정이 없거나 오탈자가 있어도 무료 모드로 동작하며, 정확히 `paid_enabled`인 경우에만 유료 어댑터가 허용됩니다. 무료 모드에서는 OpenAI와 Perplexity의 키가 존재해도 실행을 차단하고, 수집 및 생성 기능은 Gemini를 사용합니다. Gemini 실패 시 유료 모델로 자동 전환하지 않습니다. 이 정책은 API와 MCP, 자동 수집에 적용되며 사용자 UI에서 변경할 수 없습니다. Google 프로젝트의 결제 연결 상태 자체를 API로 조회하는 기능은 없으므로, 운영자는 연결되지 않은 무료 프로젝트를 유지해야 합니다. 결제와 구독 UI는 없습니다.

## 실행

Node.js 22.13 이상이 필요합니다.

```sh
npm ci
npm run db:generate
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_yummy_hannibal_king.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_rapid_songbird.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_nostalgic_wasp.sql
node --env-file=../.env.local scripts/run-framework.mjs dev --hostname 127.0.0.1 --port 5173
```

마이그레이션은 새 로컬 DB에서 한 번만 적용합니다. 이미 적용했다면 반복 실행하지 않습니다. 로컬 시크릿은 승인된 상위 폴더 `.env.local`에서 프로세스 메모리로만 읽고 Cloudflare의 선언된 개발 시크릿으로 전달합니다. 빌드는 환경 파일을 읽지 않는 별도 명령으로 실행합니다.

개발용 로그인은 loopback에서만 제공되는 Sites mock auth입니다. 배포 환경은 Sites의 ChatGPT 로그인을 사용하며, 공개 여부는 별도의 사이트 접근 정책에서 결정합니다. 공개 사이트에서도 각 워크스페이스는 소유자 인증을 요구합니다. 임의 프록시가 인증 헤더를 받도록 인터넷에 직접 노출하지 마세요.

## 주요 기능

- 별도 디자인의 한국어 랜딩, 반응형 대시보드, 키보드 검색
- 로그인 계정별 사이트, 프롬프트, 경쟁사와 페르소나 관리
- 무료 Gemini 일반 응답 수집과 생성, 유료 제공자 실행 차단 및 이용 조건 확인
- 응답 원문, 제공자 인용 annotation, 토큰 사용량, 실패 상태 저장
- 작업 임대와 재개, 비용 한도, 실패/불완전 응답 제외
- 언급률, 점유율, 인용률, 추적 브랜드 내 등장 순서, 날짜/모델 필터
- 명시적 샘플 워크스페이스, 실제 분석과 분리
- 원문/출처 상세, 콘텐츠/리포트 생성 및 편집, Markdown/CSV 내보내기
- 실행 과제 보드와 분석 근거를 사용하는 AI 어시스턴트
- 개인정보를 최소화한 유입 수집 코드와 집계(공개 수집 인프라 필요)
- 종료 시각을 설정할 수 있는 D1 일정, 실행 이력, 운영 알림, 인증된 MCP 수집 도구
- 소유자 인증 JSON 백업과 별도 로컬 DB 복구 검증 CLI
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

실행 가능 여부는 키 설정과 서버 제공자 정책을 함께 적용합니다. `configured`는 키 존재 여부이고 `available`은 현재 정책상 실행 가능 여부입니다. 키가 있다는 사실만으로 계정의 모델 권한이나 결제 상태가 검증되지는 않습니다. 아래 OpenAI 및 Perplexity 어댑터는 무료 공개 모드에서 차단됩니다.

| 제공자 | 모델 / 방식 | 서버 비밀 환경 변수 | 검증 상태 |
| --- | --- | --- | --- |
| OpenAI API | `gpt-4.1-mini`, Responses API 웹 검색 | `OPENAI_API_KEY` | 실제 호출 기록은 상위 `docs/` 참조 |
| Google Gemini | `gemini-3.8-flash`, 일반 텍스트 응답 | `GEMINI_API_KEY` | Lumen 무료 등급에서 수동 수집과 MCP 예약 수집 각 1/1 완료 |
| Perplexity | `perplexity/sonar`, `/v1/agent` 웹 검색 | `PERPLEXITY_API_KEY` | 코드 및 fixture 검증, 실제 API 미검증 |

Gemini는 웹 검색을 사용하지 않으며 인용을 제공하지 않습니다. 본문에 URL이 있어도 인용으로 집계하지 않습니다. 최근 완료 수집이 Gemini 일반 응답만 포함하면 UI는 인용률을 숫자 0% 대신 ‘인용 미제공’으로 표시합니다. 내부 집계의 0은 검색 출처에서 브랜드가 관측되지 않았다는 뜻이 아니므로 다른 수집 방식의 인용률과 직접 비교하지 않습니다. [Google Search Grounding 약관](https://ai.google.dev/gemini-api/terms#grounding-with-google-search)의 분석 및 저장 제한 때문에 이 기능은 요청하지 않습니다. 현재 Lumen 프로젝트는 결제 계정이 연결되지 않은 무료 등급입니다. 공개된 질문으로 연결을 검증했으며, 무료 API의 데이터 처리 조건에 맞는 입력 및 출력 보존 정책을 운영해야 합니다.

Perplexity는 [현재 Agent API 모델 목록](https://docs.perplexity.ai/docs/agent-api/models)의 명시적 Sonar 모델을 사용합니다. 검색 결과 중 답변의 인용 번호와 연결된 항목 또는 제공자의 URL annotation만 인용으로 집계합니다. 단순히 검색된 모든 페이지를 인용으로 간주하지 않습니다.

API 응답은 ChatGPT, Gemini, Perplexity 소비자 앱의 개인화된 결과와 같지 않습니다. 샘플 워크스페이스의 모든 모델 응답은 합성 데이터입니다. 결제와 구독은 활성화하지 않은 제한형 무료 서비스이며, 외부 블로그에 자동 발행하지 않습니다. 매시 정각 클라우드 작업의 첫 MCP 호출과, 별도로 브라우저를 닫은 상태의 MCP 예약 Gemini 수집을 검증했습니다. 검증용 질문 일정은 일시 정지했고 매시간 운영 확인 작업은 활성 상태입니다. GA4는 Google OAuth 테스트 앱과 읽기 전용 실제 계정 연결, 속성 조회를 완료했습니다. 집계 import의 운영 검증 결과는 상위 `docs/google-live-connections.md`를 참조하세요. 테스트 앱의 갱신 토큰은 7일 후 재연결이 필요할 수 있습니다. `GOOGLE_OAUTH_MODE=production`은 앱이 표시하는 운영 모드일 뿐 Google 심사 완료나 사용자 제한 해제를 뜻하지 않습니다. 실제 Google Console 상태를 확인한 뒤 설정해야 합니다. Testing은 등록된 테스트 사용자만 허용하며, 미검증 민감 권한의 신규 사용자 100명 제한은 Production 전환과 별개입니다. [Google의 공개 상태 및 사용자 제한](https://support.google.com/cloud/answer/15549945)을 따릅니다. GA4 연결 데이터는 AI 생성 입력에 넣지 않으며 Limited Use 안내는 `/privacy`에 있습니다. 모델과 API 확인 근거는 상위 `docs/provider-adapters.md`에 정리했습니다.

기본 무료 AI 호출 예약 한도는 계정당 UTC 하루 10회/월 100회, 서비스 전체 하루 50회/월 500회입니다. 분석 답변, 질문 제안, 문서와 보조 채팅이 같은 예산을 쓰며 환경 설정으로 한도를 낮출 수 있습니다. 분석은 질문 수 × 모델 수를 먼저 예약하므로 한 번에 질문 20개를 선택할 수 있어도 남은 예산을 넘으면 실행하지 않습니다. 분석 실행은 하루 20회, 병렬 답변은 run당 2개로 제한합니다. 요청 타임아웃은 45초, 제공자 응답 상한은 1MB, 작업 임대는 120초입니다. 전달 여부가 불확실한 요청은 자동 재전송하거나 예약을 환급하지 않습니다. 호출 수 한도는 금액 상한을 보증하지 않으므로 제공자 예산도 따로 설정해야 합니다.

화면은 최근 30일, 최대 1,000개 응답을 로드하며 잘린 범위를 표시합니다. 전체 최근 30일 원문은 서버 CSV로 내보낼 수 있습니다. 순위는 답변 내 추적 브랜드의 첫 등장 순서이며 검색 엔진 순위가 아닙니다.

## 자동 수집 종료와 백업

일정의 `endsAt`은 선택적인 ISO 종료 시각입니다. UI는 KST로 입력받고 API에 UTC ISO로 전달하며, 비워두면 종료 없이 반복합니다. 종료 시각 이후에는 새 실행과 대기 또는 재시도 작업을 중단하고, 이미 진행 중인 외부 호출은 완료될 수 있습니다. 수집기가 종료를 확인하면 일정을 비활성화합니다. UI는 수집기 확인 전에도 종료된 일정을 표시합니다. 과거 종료 시각으로 재활성화하려면 종료 시각을 미래로 바꾸거나 삭제해야 합니다. 매시간 수집기는 설정 시각보다 최대 1시간 늦게 시작할 수 있습니다.

운영 화면의 `GET /api/backup?siteId=<UUID>`는 소유자의 워크스페이스 설정, 원문, 문서, 일정과 실행 이력, GA4 저장 집계 등을 단일 JSON으로 내보냅니다. 인증 및 OAuth 토큰, API 키, 추적 키, 소유자 식별자, 사용량과 실행 잠금은 제외합니다. 8 MiB, 20,000행 및 항목별 한도를 넘으면 HTTP 413을 반환하고 부분 백업을 만들지 않습니다. 입력 내용에 사용자가 직접 적은 비밀까지 자동 제거하지는 않습니다. 파일은 안전한 위치에 보관해야 합니다.

복구 CLI는 새 임시 로컬 D1에서만 검증하며 기존 운영 DB를 덮어쓰지 않습니다. 복원된 일정은 비활성, Google 연결은 해제 상태입니다. 절차와 범위는 [백업과 격리 복구 안내](docs/backup-and-restore.md)를 참조하세요. 워크스페이스 데이터는 삭제 전까지 저장하며, 최근 30일 조회 범위는 자동 삭제 기간이 아닙니다. 이 기능은 운영자 백업의 보관 기한, 자동 삭제, 외부 재해 복구 사본이나 SLA를 보장하지 않습니다.

## 배포

`.openai/hosting.json`의 사이트 ID를 유지해야 합니다. Sites 스킬의 source workflow로 검증된 소스를 동기화하고 Worker/D1 마이그레이션을 배포합니다. 소스에 시크릿을 추가하지 마세요. 공개 접근 전환은 별도 배포 결정입니다. 공개 무료 출시에는 무료 제공자 정책, 이용 조건 동의, 개인정보 및 지원 안내, 마이그레이션, 실제 백업 다운로드와 격리 복구 검증, Google OAuth 상태를 확인해야 합니다. 정적 코드나 fixture 통과만으로 외부 연결 및 운영 준비 완료를 주장하지 않습니다. 결제는 현재 출시 범위에 포함되지 않습니다.

랜딩 방문 통계는 지정된 프로덕션 hostname의 `/`에서 명시적 동의 후에만 로드합니다. 대시보드에는 설치하지 않고 계정 및 워크스페이스 데이터를 전달하지 않습니다. GA4 웹 스트림의 Enhanced Measurement를 꺼두어야 합니다. `send_page_view: false`만으로 history 기반 자동 측정이 꺼지지는 않습니다. 실제 Google 설정과 배포 검증 결과는 상위 `docs/`를 참조하세요.

# 개발 안내

이 저장소는 Lumen의 애플리케이션 소스입니다. 운영 데이터, API 키, Google OAuth 자격 증명과 기존 배포 프로젝트 연결은 포함하지 않습니다. 서비스 소개는 [README](README.md)를 참고하세요.

## 실행 환경

- Node.js 22.21.0과 npm을 기준으로 개발했습니다. `package.json`의 엔진 조건은 22.13 이상이지만, 테스트는 `node:module`의 `registerHooks`도 사용하므로 22.21 이상을 권장합니다.
- React 19, TypeScript, Vinext의 App Router, Cloudflare Workers와 D1을 사용합니다. 정적 HTML만 배포하는 앱은 아닙니다.
- 로컬 테스트는 Miniflare의 Worker와 D1을 실행하므로 로컬 소켓을 사용할 수 있어야 합니다.
- 아래 셸 예제는 macOS와 Linux의 Bash 또는 Zsh 기준입니다.

## 설치와 빌드

저장소 루트에서 실행합니다.

```sh
npm run install:ci
npx tsc --noEmit --incremental false
npm run build
```

설치는 `package-lock.json`에 고정된 npm 의존성을 사용합니다. 개발 및 선택적 의존성이 필요하므로 `--omit=dev`나 `--omit=optional`로 설치하지 마세요. 설치에는 npm 패키지 다운로드가 필요하지만 빌드가 AI 제공자에게 질문을 보내지는 않습니다.

`.openai/hosting.json`은 로컬 빌드에 필요한 바인딩 선언입니다. 공개 소스에는 다음 설정만 포함하며, 기존 서비스의 `project_id`는 포함하지 않습니다.

```json
{
  "d1": "DB",
  "r2": null,
  "capabilities": ["mcp"]
}
```

`vite.config.ts`는 이 파일에서 `d1`과 `r2`를 읽습니다. 로컬 D1에는 플레이스홀더 데이터베이스 ID를 사용하므로 운영 데이터베이스에 연결되지 않습니다.

## 새 로컬 데이터베이스 초기화

빌드 후 **아직 초기화하지 않은 로컬 DB에서만** 다음을 한 번 실행합니다. SQL 파일을 직접 적용하는 명령이라 이미 적용한 마이그레이션을 자동으로 건너뛰지 않습니다. 기존 DB가 있으면 변경 이력을 확인하고 미적용 파일만 순서대로 적용하세요.

```sh
(
  for migration in drizzle/*.sql; do
    node --import ./scripts/sites-env.mjs \
      ./node_modules/wrangler/bin/wrangler.js \
      d1 execute DB --local \
      --config dist/server/wrangler.json \
      --persist-to .wrangler/state \
      --file "$migration" || exit 1
  done
)
```

현재 파일은 다음 8개입니다. 화면과 API는 전체 스키마를 전제로 합니다.

1. `0000_yummy_hannibal_king.sql`
2. `0001_rapid_songbird.sql`
3. `0002_nostalgic_wasp.sql`
4. `0003_closed_santa_claus.sql`
5. `0004_medical_master_chief.sql`
6. `0005_freezing_jackpot.sql`
7. `0006_opposite_fenris.sql`
8. `0007_security_checks.sql`

기존 스키마를 사용하려면 `npm run db:generate`를 다시 실행할 필요가 없습니다. 스키마를 수정할 때만 새 마이그레이션을 생성하고 검토하세요. 위 명령에는 `--local`이 명시돼 있으며 운영 DB를 변경하지 않습니다.

## 로컬 미리보기와 인증

```sh
npm run dev -- --hostname 127.0.0.1
```

기본 주소는 `http://127.0.0.1:5173`입니다. 로그인 링크는 loopback에서만 제공하는 개발용 계정을 사용합니다. API 키가 없어도 랜딩과 샘플 워크스페이스를 확인할 수 있습니다. 연결되지 않은 AI 제공자는 사용할 수 없다고 표시됩니다. 개발 서버의 `OPENAI_API_KEY` 누락 경고를 없애기 위해 실제 키나 임의의 가짜 키를 넣을 필요는 없습니다. 무료 모드는 OpenAI API를 사용하지 않습니다.

개발용 로그인은 프로덕션 인증이 아닙니다. `npm start`는 빌드한 Worker의 로컬 실행용이며 개발 서버의 로그인 미들웨어를 제공하지 않습니다. 인증이 필요한 화면을 검토할 때는 `npm run dev`를 사용하세요.

운영 인증은 Sites의 신뢰된 게이트웨이가 제공하는 사용자 헤더를 사용합니다. 앱이 임의의 인터넷 요청 헤더를 신뢰하도록 독립 Worker를 공개하면 안 됩니다. 다른 호스팅에서 운영하려면 해당 환경에 맞는 인증을 구현하고, 외부에서 주입한 인증 헤더를 제거하는 신뢰 경계를 먼저 구성해야 합니다.

## 선택적 외부 연결

로컬 비밀은 무시되는 `.env.local`에 보관하고 프로세스에 명시적으로 불러옵니다. 파일 내용이나 토큰을 Git, 이슈와 로그에 넣지 마세요.

```sh
node --env-file=.env.local scripts/run-framework.mjs dev --hostname 127.0.0.1
```

| 용도 | 서버 설정 이름 |
| --- | --- |
| Gemini 일반 응답 | `GEMINI_API_KEY` |
| GA4 OAuth | `APP_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GA4 토큰 암호화 | `INTEGRATION_ENCRYPTION_KEY`, 선택적 `INTEGRATION_ENCRYPTION_KEY_PREVIOUS` |
| 제공자 정책 | `LUMEN_PROVIDER_MODE` |
| OAuth 표시 모드 | `GOOGLE_OAUTH_MODE` |
| 계정 호출 한도 | `AI_USER_DAILY_LIMIT`, `AI_USER_MONTHLY_LIMIT` |
| 서비스 호출 한도 | `AI_GLOBAL_DAILY_LIMIT`, `AI_GLOBAL_MONTHLY_LIMIT` |
| 별도 서버 수집기 | `LUMEN_AUTOMATION_SECRET` |
| 서비스 운영자 범위 | `LUMEN_OPERATOR_USER_ID` |

위 이름은 애플리케이션의 서버 설정 목록입니다. 로컬에서는 `vite.config.ts`에 선언된 개발용 secret만 Worker로 전달됩니다. 개발 바인딩에 없는 설정을 추가하려면 설정 이름과 전달 방법을 검토하세요. 프로덕션에는 호스팅의 비밀 환경 변수 및 서버 바인딩을 사용합니다.

제공자 정책을 생략하거나 잘못 입력하면 `free_only`로 처리합니다. 이 모드는 Gemini 일반 응답만 허용하며, OpenAI와 Perplexity의 유료 API 어댑터를 차단합니다. 유료 제공자로 자동 전환하지 않습니다. Gemini에 검색 grounding을 요청하지 않으며, 일반 응답을 실제 소비자 검색 결과라고 표시하지 않습니다.

이 설정만으로 제공자 계정의 청구 상태가 무료임을 보증하지는 않습니다. 실제 호출 전에 자신의 Google 프로젝트, 모델 접근 권한과 무료 할당량을 확인해야 합니다. 키를 넣고 실제 분석이나 예약 수집을 실행하면 외부 API 요청이 발생합니다. 키 없이도 샘플과 fixture 테스트를 사용할 수 있습니다.

GA4는 별도의 Google Cloud 및 OAuth 설정과 읽기 권한이 필요합니다. `GOOGLE_OAUTH_MODE`는 화면에 표시할 모드이며 Google의 심사나 공개 상태를 변경하지 않습니다. 암호화 키는 Base64 또는 Base64URL로 인코딩한 32바이트 키를 사용합니다. 이 저장소에는 서비스의 기존 Google 연결이나 갱신 토큰이 포함되지 않습니다.

## 테스트

```sh
npm test
npx tsc --noEmit --incremental false
npm run lint
npm run build
```

테스트는 합성 데이터와 격리된 로컬 D1을 사용합니다. 제공자 응답은 fixture이며 실제 API 연결 성공을 증명하지는 않습니다. 인증, 워크스페이스 격리, 지표 계산, 수집 중복 방지, 한도, 원문 무결성, GA4 집계와 백업 복구 경계를 검사합니다.

공개 HTTP 검사 도구는 현재 Lumen 운영 호스트만 허용합니다. 자신의 배포에서 사용하려면 `scripts/audit-public-indexing.mjs`의 허용 호스트와 공개 경로를 먼저 변경하세요. AI 생성 요청을 만들지 않으며 응답 상태와 크롤링 조건만 확인합니다. 크롤러 User-Agent 검사만으로 실제 검색 색인을 증명하지 않습니다.

```sh
node scripts/audit-public-indexing.mjs --help
```

## 배포와 자동 수집

이 공개 소스는 원본 서비스의 배포 권한을 제공하지 않습니다. Sites에 배포하려면 자신의 프로젝트와 DB를 생성하고 `.openai/hosting.json`의 프로젝트 연결을 자신의 환경에서 구성해야 합니다. 플랫폼의 소스 동기화와 배포 도구는 이 저장소에 포함되지 않습니다. 로컬 빌드와 테스트에 그 도구가 필요하지는 않습니다.

설정한 수집 일정을 저장하는 것만으로 정기 실행기가 생성되지는 않습니다. 인증된 MCP 호출기 또는 서버 전용 수집기를 별도로 운영해야 합니다. 공개 소스는 원본 서비스의 예약 작업, 사용자 계정, 워크스페이스나 무료 예산을 복제하지 않습니다.

기존 배포와 다른 주소로 운영한다면 canonical, 사이트맵, robots의 사이트맵 주소, 공개 지원 정보와 GA4 호스트 허용 목록도 자신의 서비스에 맞춰 검토하세요. 원본 서비스의 검색엔진 소유권 확인 파일은 포함하지 않습니다.

## 포함하지 않는 데이터

`.env*`, `work/`, `outputs/`, `.wrangler/`, `.sites-runtime/`, 로컬 백업, 원문 관측 기록과 운영 이력을 공개 소스에 추가하지 마세요. `tsconfig.tsbuildinfo`, `dist/`, `node_modules/`도 생성물입니다. 운영 백업에는 사용자 입력과 답변이 들어갈 수 있으므로 source archive나 공개 이슈에 첨부하지 않습니다.

## 제3자 코드

포함된 제3자 코드와 라이선스 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 정리했습니다. 이 문서는 별도의 자체 코드 오픈소스 라이선스를 부여하지 않습니다.

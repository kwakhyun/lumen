# Lumen 운영 관측과 개선 실험

기준: 2026-10-19. 기존 공개 무료 서비스를 유지하며 외부 유료 도구나 AI 요청을 추가하지 않는 개선이다. 런타임 패키지를 추가하거나 스킬 묶음 전체를 설치하지 않았다.

## 적용한 지침과 구현

| 참고한 개별 지침 | 적용한 부분 | 구현 위치 |
| --- | --- | --- |
| [Addy observability-and-instrumentation](https://github.com/addyosmani/agent-skills/blob/main/skills/observability-and-instrumentation/SKILL.md) | 호출 식별자, 진입 경로, 제한된 오류 코드, 처리 건수, 지연과 관측 범위 | lib/operations-observability.ts, 운영 화면 |
| [Superpowers systematic-debugging](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md), [verification-before-completion](https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md) | 실제 지연 증거와 설정을 구분하고, 격리 검증과 배포 결과로 완료 판단 | 테스트와 릴리스 증거 |
| [Vercel React](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices), [web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | 화면 경계 분리, 답변 인덱싱, 요청 취소와 최신 응답만 반영, 라벨과 도움말 연결 | dashboard/sections, client.ts, ui.tsx |
| [Emil break-ui](https://github.com/emilkowalski/skills/blob/main/skills/break-ui/SKILL.md), [mobile-native](https://github.com/emilkowalski/skills/blob/main/skills/mobile-native/SKILL.md) | 긴 한국어, 작은 화면, 모달 키보드 이동, 최소 글자 크기와 조작 영역 | dashboard.css, 브라우저 검증 |
| [Impeccable](https://github.com/pbakaus/impeccable) audit / harden / clarify 원칙 | 실제 관측과 미관측 구분, 빈 상태, 실패 설명, 지표 안내문 | 운영과 실험 UI |
| [Matt codebase-design](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md), [domain-modeling](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md) | 관측, 수집 실행, 지표 계산과 실험 저장 경계 분리 | experiment-types, experiment-metrics, experiments-server |
| [PM dashboard requirements](https://github.com/product-on-purpose/pm-skills/blob/main/skills/measure-dashboard-requirements/SKILL.md), [instrumentation spec](https://github.com/product-on-purpose/pm-skills/blob/main/skills/measure-instrumentation-spec/SKILL.md) | 분모, 실패, 조회 범위, 정의 버전과 최소 운영 계측 명시 | metric-guide.tsx, methodology, 아래 계약 |
| [Phuryn assumptions](https://github.com/phuryn/pm-skills/blob/main/pm-product-discovery/skills/identify-assumptions-existing/SKILL.md), [opportunity-solution-tree](https://github.com/phuryn/pm-skills/blob/main/pm-product-discovery/skills/opportunity-solution-tree/SKILL.md) | 가설 → 변경 계획 → 기준 수집 → 후속 관측 → 검토 메모 | 개선 실험 화면과 API |

공개 지침은 2026-10-19 검토한 문서의 원칙을 적용했다. 원문을 제품 코드에 복제하거나 외부 hooks, 업데이트 엔진, 모니터링 SDK를 설치하지 않았다. 현재 환경의 Vercel React 스킬은 기존 설치본 0.54.1을 사용했다. 런타임 라이브러리 버전과 호스팅은 유지했다. 표의 main 링크는 upstream 최신 내용이 달라질 수 있으며 설치한 고정 버전을 뜻하지 않는다.

## 용어와 계측 계약

- 일정: 질문과 모델, 시간대, 예정 시각, 종료 시각을 저장한 설정이다.
- 예정 회차: 특정 일정의 scheduledFor다. 같은 회차의 실행 중복은 기존 DB 제약으로 막는다.
- 실행: 예정 회차 또는 직접 실행 요청의 영속 처리 기록이다. 답변 수집 run과 연결된다.
- 수집: 질문 × 모델의 답변 집합이다. 실패 답변도 manifest에 남는다.
- 수집기 호출: 여러 일정을 처리할 수 있는 dispatcher 진입 한 번이다. 새 operation_ticks 행이 시작/종료를 나타낸다.
- heartbeat: 마지막 호출 신호다. 전체 이력이나 실제 AI 답변 성공과 같지 않다.
- 실험: 고정한 조건으로 기존 수집 두 개를 비교하는 수동 연구 기록이다. 일정이나 제공자 요청을 실행하지 않는다.

operation_ticks에는 UUID, 서버 코드가 지정한 진입 경로, owner/service 범위, 시작/종료/소요 시간, 처리 건수, 건너뜀/이어 처리 여부, 오류 allowlist만 저장한다. 원문, 헤더, 이메일, 키, 토큰은 넣지 않는다. 사용자는 본인 계정 범위만, 서버에 정확히 지정된 운영자는 서비스 범위도 볼 수 있다. MCP 경로가 자동 예약인지 사람이 호출한 것인지 자체 기록만으로 단정하지 않는다.

조회는 DB를 변경하지 않는다. 최근 30일의 최신 50개를 표시하고 보존 건수와 생략 여부를 알린다. 다음 tick에서 30일 이전 기록, 범위당 1,000개 초과와 전체 10,000개 초과를 정리한다. 수집기가 멈추면 물리 정리는 재개 때까지 지연될 수 있다. 관측 저장 실패는 정적 오류 코드로 남기며 수집을 중복 실행하거나 유료 모델로 우회하지 않는다. 이력은 배포 이후부터 쌓이며 과거 tick을 생성하지 않는다.

실행 지연은 예정 시각에서 대기열 등록 또는 완료까지의 시간이다. 실제 공급자 요청 시작 시각이나 SLA를 뜻하지 않는다. 현재 워크스페이스 최신 50개의 표본 수, 전체 실행 수, 관측 기간, P50/P95/최대치를 표시한다. 직접 실행과 정기 실행이 포함된다. 오래된 heartbeat와 2시간을 넘긴 예정 회차는 조회 시 판단하므로 dispatcher가 중지돼도 다음 조회에서 경고할 수 있다. 외부 메시지 알림을 새로 연결하지 않았다.

## 고정한 실험 정의

실험 생성 시 브랜드 집합, 질문 문구, 모델, 제공자, 성공/실패와 언급/인용 여부를 lumen-experiment-v1로 고정한다. 답변 원문은 기존 수집에 보관하고 스냅샷에 중복 저장하지 않는다. 생성 후 가설, 목표와 기준은 바꾸지 않으며 상태와 후속 결과, 검토 메모를 갱신한다. 동시 수정은 updatedAt으로 충돌을 검출한다.

후속 수집은 기준 수집 이후여야 하며 같은 워크스페이스, 모드, 질문 문구, 모델과 제공자 집합을 요구한다. 같은 질문/모델/제공자의 중복 셀은 모호하므로 거절한다. 양쪽 모두 성공한 셀만 동일 분모로 비교하고 양쪽 실패 수를 표시한다. 성공 표본이 겹치지 않으면 변화는 null이며 0%로 표시하지 않는다. 목표 판정은 반올림 전 정수 건수로 한다. 표시용 반올림으로 목표 미달을 달성으로 바꾸지 않는다.

무료 Gemini는 검색 인용을 제공하지 않아 인용률 실험을 거절한다. 웹페이지 수정 반영이나 효과를 이 응답으로 입증할 수 없으며 전후 변화가 인과 효과나 통계적 유의성을 뜻하지 않는다. 표본이 적으면 경고한다. 기존 원문 비교와 작업 보드는 유지한다. 실험 저장, 조회 및 결과 연결은 AI 예산을 예약하지 않는다.

## 구조와 보호 장치

개요, 질문 목록, 수집 기록을 별도 컴포넌트로 추출했다. dashboard.tsx가 약 16% 작아졌지만 전체 번들 크기나 체감 성능이 같은 비율로 개선됐다는 뜻은 아니다. 질문별 답변 Map은 반복 필터링을 줄인다. 요청 취소와 최신 요청 검사를 추가해 화면 전환 중 이전 워크스페이스 응답을 노출하지 않는다. 기존 전체 문서 탐색 방식과 모달 포커스 복원은 유지한다.

0003 migration은 실험과 운영 관측 테이블/인덱스만 추가한다. 기존 테이블을 다시 만들거나 일정을 변경하지 않는다. 새 백업은 V2로 실험을 포함하며, 실제 운영 V1 파일도 원래 digest를 검증한 뒤 최신 격리 DB로 복구할 수 있다. OAuth, AI 사용량 및 runtime telemetry는 복원하지 않고 모든 복원 일정은 비활성화한다.

## 확인된 검증

- 로컬 브라우저에서 기존 Northstar 샘플 36개 표본으로 실험 생성, 기준 고정, 후속 결과 연결, 저장 후 재조회가 성공했다. 75% → 80.6%, +5.6%p는 샘플 기능 검증값이며 Lumen 성과가 아니다.
- 320px 모달과 긴 한국어, 390px 실험 카드, 820px 및 1440px 지표 사전에서 문서 너비가 뷰포트를 넘지 않았다. 모바일 본문 도움말 최소 12px을 확인했다.
- 라벨/도움말 연결, Shift+Tab 포커스 순환, Escape 후 원래 버튼 복원을 확인했다. 워크스페이스 전환 시 이전 브랜드 내용이 즉시 사라졌다.
- 10월 18일 실제 V1 운영 백업의 새 격리 복구: 총 14행, ID 12개 재매핑, 일정 1개 비활성화, 실험 0개, 외래 키 위반 0, quick_check ok. 원본 digest a7c44ea27d357c986f2e7a8910ebe147511d35e650f408ddc303361e5ed82f98. 외부 API 호출과 운영 DB 변경 없음.

전체 fixture/격리 D1 테스트 161개와 타입 검사 통과. 반올림 때문에 목표 미달을 달성으로 표시하던 경계를 독립 검토에서 발견해 정수 건수 판정으로 수정하고 회귀 테스트를 추가했다. 빌드와 공개 배포 결과는 배포 후 검증 문서에 기록한다. 7일 경과, Google OAuth 최종 7일 갱신, 최종 백업은 기존 후속 점검을 유지한다. 이 릴리스는 해당 장기 검증의 완료 선언이 아니다.

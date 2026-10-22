# Lumen / Quiet Intelligence

The workspace uses a quiet editorial hierarchy: white canvas, graphite type and one cobalt action color. Evidence is readable before it is decorative. A value is always accompanied by its definition, scope and source state.

## Sources and ownership

The selected Quiet Intelligence reference governs the top navigation and briefing rhythm. The evidence-reader reference informs the two-column answer comparison. Workflow references inform the question → evidence → action sequence. Illustrative mock values and predicted uplift are not shipped as product data.

- `design-tokens.css`: shared semantic colors, type scale, spacing, radii and motion.
- `ui.tsx`: actual Button, Panel, Badge, Field, Modal, Empty, Skeleton and data-chart primitives.
- `app/dashboard.css`: layout and component rules, one definition per component family.
- `/dashboard/design-system`: interactive component and state showcase.

## Foundation

16px body / 1.65 line height; controls and tables 14–15px; captions at least12px. Page titles36–48px, section titles20–24px. Control height44px and visible keyboard focus. Spacing uses4,8,12,16,24,32,48,64px. Functional borders distinguish regions; shadows are reserved for floating dialogs. No arbitrary color per screen.

Semantic color roles: ink (primary text), secondary (body), muted (context), accent (primary action and selected), success (confirmed successful state), warning (action required), danger (error/destructive). Never use color alone to encode state.

## Information architecture

Pulse → current evidence and next work. Research → questions/answers, competitors, sources and personas. Experiments → execution board, content and reports. Automations → schedules. Connections → providers/GA4/tracking. Usage → individual and shared free limits. Operations → execution health, alerts and audit history. Brand settings and assistant are secondary utilities.

## Behavior

Use standard anchors/full-document navigation to avoid the deployed Vinext client-transition failure. Persist all real product mutations in APIs. Distinguish empty, loading, error, disconnected, unobserved and successful states. Unknown is never green/healthy. Show configured provider capabilities and explicitly separate synthetic samples from collected data. Destructive actions require a concrete confirmation. Dialogs trap/restore focus. Mobile navigation is inert when closed. Reduced-motion preferences are respected.

Usage windows are server-backed reservations. UTC reset times are displayed in Korean time with KST label. GA4 aggregate users are not summed across rows. Evidence charts include a readable data table. API errors retain recoverable actions.

## Verification

Check desktop and390px mobile, keyboard navigation,200%zoom/reflow, label association, error states and live API mutations. Screenshot comparison informs visual QA; it does not alone establish WCAG compliance.

## Component contracts and refresh behavior

`Field` accepts exactly one native `input`, `select`, or `textarea`. It provides an explicit label association and connects its hint with `aria-describedby`. Caller-supplied IDs and description IDs, handlers, refs and form attributes remain intact. Multiple controls belong in a labelled fieldset rather than one Field.

The overview, question table and run history live in `sections/overview.tsx`, `sections/prompts.tsx` and `sections/run-history.tsx`. `prompt-evidence.ts` groups completed answers once for the question views; it does not change metric definitions. Existing whole-document navigation remains intentional.

`useResource` scopes visible data and errors to the current resource path. A path change hides prior data immediately. Superseded and unmounted GET requests are aborted; only the current request can update state. Refresh errors retain the last successful result for that same path, and a completed mutation cancels older GETs before setting its result. There is no automatic retry or AI request in this hook.

Compact dashboard captions use the 12px token, and standalone buttons, icon controls, select controls and checkbox labels use the 44px control token. Text fields use 16px on small screens. Long user-provided titles and descriptions may wrap instead of widening their card. Experimental results keep paired sample counts and limitations visible; the metric-definition table scrolls inside its own container.

## Korean product copy

Write headings that name the screen's subject, then explain what the user can see or do. Use concrete terms such as AI 답변, 브랜드 언급, 수집 일정 and 개선 작업. Do not replace the subject with a slogan about 기회, 여정 or 다음 행동. Avoid inserting commas for emphasis or using sentence fragments where an ordinary sentence is clearer.

Use 해요체 sparingly for brief empty states and polite 하세요/합니다 for instructions and explanations. Button labels describe the action, such as 질문 추가, 일정 저장 or 답변 보기. Keep metric labels consistent with their definitions. Preserve sample labels, uncertainty, free-tier limits, provider capabilities and consent boundaries when simplifying wording; clearer copy must not promise a feature or outcome the service does not provide.

## First answer onboarding

Use the persisted workspace state to guide brand registration, manual question creation and explicit first collection. Before a completed collection exists, show the current step instead of empty analytics. Optional brand and question settings stay in native details disclosures; their inputs retain default values. Starting collection always passes through consent and a question/model/allowance review. Manual setup never calls a provider. Preserve failed and historical results rather than treating them as zero or silently retrying. Busy dialogs cannot close; collapsed controls do not enter the keyboard focus loop.

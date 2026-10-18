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

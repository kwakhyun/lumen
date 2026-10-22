# Landing content and deployment checks — 2026-10-23 KST

## Scope

The public home page now explains three distinct capabilities: scheduled general Gemini API answers, user-observed consumer AI search evidence, and GA4 reference aggregates. A public guide at `/guides/free-ai-brand-tracking` answers how a small Korean SaaS team can track brand mentions and original citations without paid APIs. Both pages have page-specific canonical and Open Graph metadata. Public robots and sitemap files list discoverable pages; authentication remains responsible for protecting private routes.

`/methodology` and root metadata remain unchanged. Discovery changes are site-wide and the new guide also discusses metrics, so the existing informational question is a descriptive comparator, not an experimentally isolated control.

## Evidence integrity

The original plan `f7321f1d-5ebe-4af9-9db6-62fcd4e319eb` schedules its content change for October 26, while the user now requests an earlier deployment. Original plan, baseline records and formal before/after windows are preserved. New immutable deployment checks link to exact baseline digests and record actual publish and observation timestamps. They are displayed separately and never enter the original before/after calculations. The UI warns when deployment occurs within the planned baseline period.

Validation enforces baseline < deployment <= observation <= storage time, original query/repetition identity, ownership, same-origin writes, idempotency, 96 KiB request size, and 20 records / 1 MiB per site. A later-voided baseline remains auditable but is excluded from the displayed pair. Unknown search/mention/citation status is not treated as absence. Input corrections require a new record identifying the original digest and reason.

Backup V5 includes checks and validates parent links, temporal order and content digests. Earlier V1–V4 manifests and restore behavior are retained. No provider, scheduler, OAuth, quota or billing setting is changed.

## Interpretation

Deployment does not confirm crawling or indexing. Repeat the two exact original questions in fresh searches, record the actual consumer UI and source list, and retain failures. Immediate observations are descriptive and do not prove content effects, population exposure, statistical significance or sales uplift. GA4 reference values are not revenue measurements. Actual deployment and observed results are documented in the workspace evidence report after verification.

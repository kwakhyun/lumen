# Workspace backup and isolated recovery

Lumen provides an owner-authenticated, read-only application backup. This is a portable copy of the workspace's product data, with credentials and executable runtime state excluded. It is not a provider-wide database dump, a point-in-time rollback service, or permission to replace production data.

## Export contract

`GET /api/backup?siteId=<workspace UUID>` verifies the authenticated owner's workspace before querying data. Every projection independently enforces the same ownership boundary. Unknown parameters, repeated workspace selectors and cross-site browser requests are rejected. Successful responses are JSON attachments with `Cache-Control: private, no-store` and `nosniff`. Errors return the usual `{error, code}` JSON without an attachment. Schema errors may additionally return at most 20 issue codes and structural paths, never offending values or raw schema messages.

The snapshot includes all rows for the selected workspace in these 15 areas, without a date filter:

- Workspace settings, prompts, competitors and personas.
- Runs, original answers, provider citations and stored mention metadata.
- Documents, reports, improvement tasks and frozen experiment evidence.
- Client-reported traffic aggregates.
- Collection schedules, execution history, alerts and audit history.
- GA4 property metadata and the saved aggregate report.

The SQL explicitly selects permitted columns. Historical answer mentions that contain a full brand record are projected to only `name`, `domain`, `mentioned`, `firstPosition`, `rank` and `cited` inside SQL; extra owner, ID and tracking fields never enter the export. The original stored evidence is not rewritten. Invalid metric values still fail the strict schema. It never reads API keys, OAuth access/refresh ciphertext, OAuth state/verifier ciphertext, tracking keys, owner identifiers, job leases or quota reservations into the export. The `quotas`, `ai_usage_buckets`, `ai_usage_reservations`, `oauth_states`, `operation_heartbeats`, `operation_ticks` and account-scoped `ai_eligibility` tables are excluded. GA4 authorization scopes and connection status are not exported as renewable access.

Original questions, answers and documents remain private user content. The format removes stored system credentials; it does not search for or redact secrets that a user may have typed into a question or document. Keep the download private. Nothing uploads it to an external backup service.

## Completeness and limits

After the preliminary authorization check, the 30 count/projection statements execute in one read-only D1 `batch()`. Counts and content therefore share the batch transaction. Each query uses fixed table/column names and bound identifiers. Rows are selected only when the associated count and estimated UTF-8 size fit the table limit. A max-plus-one sentinel detects oversized tables. Owner-field inconsistencies, invalid records or broken relationships fail the entire request.

The complete canonical JSON is limited to **8 MiB and 20,000 rows**. Table limits are deliberately lower for some data: sites 1; prompts 1,000; competitors 100; runs 6,000; answers 10,000; documents 1,000; tasks 1,000; personas 100; traffic 6,000; schedules 100; executions 6,000; alerts 1,000; audit rows 4,000; GA4 connection snapshots 1; improvement experiments 100 (512 KiB). Individual table byte bounds also apply. These are backup capacity bounds, not automatic retention or permission to delete data.

An over-limit workspace returns HTTP 413 `backup_too_large`. No silently truncated or partial backup is emitted. Increasing the limits or building a durable multi-part snapshot requires a separate design; ordinary paginated reads would not preserve one snapshot during concurrent changes.

The envelope contains format version 2, ordered SQL migration names and SHA-256 checksums, export time, workspace scope, exact row counts and a canonical payload SHA-256 digest. Validation rejects unknown fields, unsupported migration versions, altered digests, duplicate IDs, incomplete answer sets, cross-workspace rows and missing required parents. Deleted prompts may legitimately leave historical `answers.prompt_id` references; these are intentionally soft references in the application schema.

SHA-256 detects accidental corruption and payload changes. It is not a signature, proof of origin or encryption. The downloaded file contains private product data.

## Local recovery drill

Use the existing ignored `work/backups/` directory for downloads and `work/restore-<unique-name>/` for a new recovery copy. Protect the download directory with mode 0700 and each backup with mode 0600. The CLI refuses permissive input files, symlinks, oversized/invalid JSON, incompatible migration checksums and an existing output path.

From the application checkout:

```sh
node --experimental-strip-types scripts/verify-backup.mjs --input /absolute/path/backup.json --output /absolute/path/new-restore-directory
```

The destination's parent must exist; the destination itself must not. The CLI creates a new local Miniflare D1 database, applies the exact checked-in migrations, imports the validated data and persists the recovered copy. It does not load `.env` files, remote bindings, OAuth credentials or provider modules. It cannot take a production database binding or run a remote restore. A failed drill disposes and removes only the new directory created by that invocation; existing destinations are never overwritten or deleted.

Recovery changes only the isolated copy:

1. Every record ID and every reference receives a new UUID. One mapping preserves an execution whose ID is also its run ID. Soft references to deleted prompts are remapped without inventing prompt rows.
2. The owner becomes the fixed local verification identity, and tracking keys are regenerated.
3. All schedules are disabled. Queued/running executions become cancelled. Pending/processing answers become failed, and unfinished runs receive matching terminal counters. The source backup retains the original statuses.
4. Leases and retry times are cleared. No usage buckets, reservations, OAuth states, heartbeats or account eligibility declarations are imported. GA4 retains the historical property/report snapshot but is disconnected with no tokens.
5. D1 `PRAGMA foreign_key_check` must return no violations; `PRAGMA quick_check` must return `ok`. Every imported value is read back and compared to the transformed safe copy, and exact table counts must match. Credential/transient tables must remain empty.

The CLI prints only counts, digests and verification flags. It writes the same summary to `verification.json` with mode 0600; the output directory and subdirectories use 0700, data files 0600. It never prints questions, answers, database rows, credentials or SQL errors. Keep the recovered database private and outside source archives.

No AI or GA4 API request is made by the drill. The local database does not have provider secrets or an unattended dispatcher. Production data is not changed. The hosted export still performs normal bounded D1 reads; this feature does not establish a hosting billing guarantee.

## Verification evidence and remaining limits

`tests/backup.test.mjs` uses isolated Miniflare databases and fabricated data. It covers authenticated ownership, strict scope, secret-column exclusion, concurrent snapshot consistency, integrity tampering, missing/cross-workspace references, row/byte overflow, disabled restoration, ID remapping, data readback, and CLI file protection. No fixture is evidence that a production download has been restored.

For an actual drill, save a production backup through the authenticated UI, then run the CLI on that file. Record only source digest, recovered digest, table counts, quick-check result, foreign-key violations and completion time. Confirm the production workspace remained unchanged. Record the actual result separately; do not mark the drill complete merely because fixture tests passed.

This verifies an isolated product-data recovery. It does not establish backup retention, an off-device disaster recovery copy, an SLA, provider-side point-in-time recovery, production replacement, OAuth reconnection, or resumption of historical quota reservations. No production restore HTTP/MCP endpoint is exposed.

## Hosting support checked

The installed Sites storage skill documents D1 bindings and schema migration deployment. The available native Sites catalog exposes database overview and table-row reads. Row reads return at most 25 rows and may project/truncate values, so they are unsuitable as an unverified full backup. A native full export/restore operation was not exposed in this session.

Cloudflare documents transactional [D1 batch calls](https://developers.cloudflare.com/d1/worker-api/d1-database/), [quick and foreign-key checks](https://developers.cloudflare.com/d1/sql-api/sql-statements/), and [SQL import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/). The D1 binding's `dump()` method is alpha-only. [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) is a separate Cloudflare control-plane capability; its accessibility, retention and recovery permissions for this Sites-managed database have not been verified. The application backup does not claim to configure it.

## V1 compatibility after the observability and experiments release

New exports use V2 with the four pinned migrations through `0003_closed_santa_claus.sql`. Existing V1 envelopes remain accepted only with the exact original 3-migration manifest and original 14-table schema. Their original digest is checked before adding an empty experiments table to the isolated recovery copy. Arbitrary historical prefixes and future manifests are rejected. The recovery CLI checks and applies all four current pinned migrations, remaps experiment run references, preserves passive experiment evidence, and confirms all seven credential/runtime tables (including operation_ticks) remain empty. No telemetry history is invented for older backups.

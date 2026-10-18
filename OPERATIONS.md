# Lumen unattended collection

The published Site provides authenticated, tenant-scoped MCP tools. The source and these instructions are stored with the Site. The Site gateway supplies the caller identity. Do not use browser cookies, local preview identities, or a service-bypass token as an application user identity.

## Hourly dispatcher

1. Call `lumen_workspaces` to verify authenticated access and the available budget.
2. Call `lumen_collect_due` with `limit: 1`. The server selects only due schedules and unfinished live runs owned by the caller. It never creates schedules or changes their configuration.
3. When `continuation` is true, honor `retryAfterSeconds` and continue, up to 10 tool calls per task. Waits longer than one minute should yield to the next scheduled task. Do not reset leases or retry a terminal failed/blocked occurrence.
4. Call `lumen_operations` for affected workspaces to read persisted execution status and actionable alerts. A successful tick is not evidence that every provider answer succeeded.
5. Keep silent when nothing actionable changed. Report new collection failures, exhausted budgets, missing connections, or a dispatcher that needs intervention. Never include API keys, OAuth tokens, private prompt text, or full provider responses in notifications.

Run hourly in Asia/Seoul. A schedule's selected time is its due time; actual collection begins at the next dispatcher run, normally within one hour. Delays are possible when the cloud task or upstream provider is unavailable. Lumen does not promise exact-minute execution. Before any heartbeat, status remains `not_observed`. Once observed, an enabled schedule with no worker observation for more than two hours, or a due time more than two hours overdue, produces `attention`; recent worker failures and open alerts also require attention. This is an on-read application status, not an independently delivered alert.

## Failure semantics

- A user may reserve at most 10 AI calls per UTC day and 100 per UTC month. The entire service has ceilings of 50 per day and 500 per month. Environment settings may lower these caps, including zero to pause calls.
- A run reserves all question × model calls before provider dispatch. Text generation and assistant calls share the same allowance. Ambiguous failures are not refunded automatically.
- The execution UUID fixes its run identity. Conditional database leases fence concurrent/stale workers. Already dispatched answers are marked failed after interruption rather than silently purchased again.
- Quota exhaustion blocks an occurrence. The next scheduled occurrence can try again when allowance is available; the dispatcher must not manufacture replacement occurrences.
- Paused or deleted schedules do not enqueue new work. Existing histories remain for inspection. An already executing provider call may finish.
- Gemini currently collects ordinary model responses without Google Search grounding. No citation is invented. Perplexity requires its own active server API key and API billing; a consumer subscription is insufficient evidence of API access.

## Deployment and incident recovery

Use `.openai/hosting.json` project_id unchanged. Apply all ordered SQL migrations through the Sites deployment flow. Keep API/OAuth/encryption keys in secret environment entries, never source or archives. Changing a runtime secret requires deployment of a saved version to apply that environment revision.

Before a rollout: typecheck, isolated D1 tests, build, review source/compiled artifacts for secrets, verify private audience, and retain the prior version ID. After rollout: authenticate in a browser, exercise MCP through the provisioned Site plugin, read back the persistent result, and inspect worker errors. If a rollout fails, deploy the previous saved source version only when its schema is compatible; never discard the current production database.

Setting a service budget limit to zero and deploying that configuration blocks new usage reservations. It does not stop runs that already have an idempotent usage reservation, and it cannot cancel in-flight provider requests. Disable schedules separately to prevent future due occurrences; their already running executions may finish. If provider dispatch must stop, an operator must disable the relevant server provider credential and deploy the environment change, then verify the connection is unavailable. Previously dispatched requests may still complete. Preserve curated execution history when investigating. A restored database must be validated in an isolated environment for schema, tenant ownership, run status and budget reservations before resuming dispatch.

This repository does not establish a backup retention SLA. Hosting backup capabilities, a verified restore drill, operator identity/contact, public OAuth verification and public access policy must be established before broad commercial launch. The current Site audience remains owner-private.


## MCP contract and first unattended acceptance

The externally exposed tool is `lumen_collect_due({"limit":1})`, not the internal TypeScript function name. The route injects the authenticated owner into `tickDueSchedules({ownerId:user.userId,limit})`. The caller cannot supply `ownerId`, `siteId`, execution IDs or a clock override. The optional service bearer endpoint `/api/operations/tick` is a separate, all-owner dispatcher and is not needed by the authenticated Site plugin.

`limit` bounds processing chunks (default 1, maximum 2), not individual answers. Each run chunk dispatches at most two pending answers. A run reserves its full question × model count before dispatch. One tick first resumes manual live runs, then queues up to ten due occurrences, then uses any remaining processing slots for scheduled executions. A queued occurrence is not proof of a completed answer.

Perform these steps after a successful deployment; this section is a procedure, not evidence that production collection has already run:

1. Verify the deployed Site still uses the intended project, owner-private audience, required migrations and provider environment. Through the installed/provisioned Site plugin, confirm discovery exposes `lumen_workspaces`, `lumen_operations` and `lumen_collect_due`. Use the same authenticated owner for the native cloud task and the workspace. Missing plugin access or failed authentication is a blocker; do not forge headers or substitute a browser session/service-bypass credential.
2. Read `lumen_workspaces({})` and `lumen_operations({"siteId":"<owned UUID>"})`. Check the free allowance and record the initial heartbeat and schedules. Also inspect pending analysis runs in every owned live workspace through the UI: the operations MCP result contains scheduled executions, but does not enumerate all manually started runs. `lumen_collect_due` has no per-workspace filter and can process any of the owner's due or pending work.
3. For a genuinely empty owner queue, one `lumen_collect_due({"limit":1})` establishes the dispatcher connection with `queued:0`, `processed:0`, `continuation:false` and no new reserved AI calls. This updates heartbeat state, so it is not a read-only operation. Skip this empty-queue expectation if existing work is present.
4. In a live test workspace, add one non-sensitive question manually and select one currently connected model. Save one enabled daily schedule in `Asia/Seoul` with its due minute strictly in the future, before the next known hourly dispatcher invocation. Record the schedule ID, `nextRunAt` and available budget. Do not use AI suggestion generation for this one-call test. A time already passed today schedules the next applicable day. Demo workspaces cannot create live schedules.
5. Close the product browser tab and let the registered native hourly task invoke the Site plugin. A manual “run now” action or a manually invoked MCP call can test the server, but does not prove unattended dispatch. Keep the native task's timestamp and actual tool-result evidence.
6. In MCP results, require `isError:false` and inspect the JSON in the text content. With only this one due question/model and no competing work, expect one queued execution and a completed result; otherwise follow `continuation` and `retryAfterSeconds`. Stop after ten collection calls, or defer waits over 60 seconds to the next scheduled task. A locked tick (`skipped:true`) is not success and must not trigger lease resets.
7. Read back `lumen_operations` and the answer in the authenticated dashboard. Confirm the persisted occurrence references the saved schedule, `status:completed`, `total:1`, `completed:1`, `failed:0`, a run ID and timestamps after the due time. Confirm the live answer has the selected provider/model, an original provider response ID and no synthetic provenance. A valid live answer may have zero citation annotations; do not invent a citation requirement. Confirm reserved usage increased by exactly one compared with the recorded baseline when no other AI work ran.
8. An immediate replay while no further work is due should produce no additional execution, provider request or usage reservation. Inspect the persisted IDs and usage rather than relying on HTTP 200 alone. Pause the temporary test schedule if repeated collection is not intended, preserving its evidence history.
9. If the occurrence is `failed`, `partial` or `blocked`, retain it and inspect its curated alert and answer errors. Do not press “run now” repeatedly, manufacture a new occurrence, or claim end-to-end success. Test failures, exhausted budget and provider disconnection are distinct outcomes.

Source comparison and fixture tests establish the implementation contract only. The production acceptance evidence must separately include native schedule registration, authenticated plugin invocation, persisted live run/answer and budget delta. Neither this document nor a fresh heartbeat establishes all four.

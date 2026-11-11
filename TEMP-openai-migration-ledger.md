# OpenAI API Migration Decision Ledger

Date: 2026-11-11. Application: Lumen. Implementation authorized by the user's request to repair generation, issue/apply a new GPT key, use a model at least 5.6, verify and deploy.

Previous integration: direct HTTP Responses API with GPT-4.1 mini; production generation used Gemini in free-only mode. Selected integration: the same Responses transport with `gpt-6.1-terra`, Standard processing, no reasoning, medium verbosity, `store:false`. The new key's model list includes this exact ID. A real connection request completed in 4.7 seconds, with no reasoning tokens. No SDK/framework migration or database migration is needed.

Privacy: preserve stateless API requests, bounded response reads and existing local document storage. No Zero Data Retention or regional processing requirement was supplied; `store:false` does not establish either. No secrets or request bodies are logged. Existing public privacy disclosures now identify both providers.

## Approved stages

1. Diagnose existing failures and confirm model/key access: complete. Reproduced Gemini's 45-second deadline; old generic HTTP errors did not retain enough information to attribute a provider cause.
2. Implement model change, distinguish observation/generation, classify safe errors and repair Gemini configuration: complete. Preserve quota accounting, evidence scope, provider choice and historical measurements.
3. Local regression checks and production functional verification: complete for GPT reports and analysis. Version 25 published with environment revision 7. Final copy corrections are the next publication stage. Gemini remains an external diagnostic limitation as recorded below.

## Workload routes

| Workflow | Selected route and retained behavior | Validation |
|---|---|---|
| Answer collection, including scheduled runs | GPT-6.1 Terra Responses, required web search, at most one tool call, 1,800 output tokens. Gemini ordinary generation and Perplexity remain explicit alternatives; never replace a failed measured model silently. Historical GPT-4.1 mini stays identifiable but cannot start a new live call. | Provider request/parser, workerd, operations and citation-provenance tests. |
| Reports and content drafts | GPT-6.1 Terra, no search, 3,500 output tokens, existing period/model evidence scope. Persist generation model separately from observed model. | Scoped API tests assert input evidence, response metadata and persisted header. |
| Dashboard AI analysis | GPT-6.1 Terra, no search, 1,500 output tokens, existing evidence scope; result retains scope/model when filters change. | Scoped API tests and assistant UI metadata. |
| Prompt suggestions | GPT-6.1 Terra, existing JSON object response, no search, 1,800 output tokens, existing validation. | Backend/onboarding/provider JSON tests. |
| Free-only mode and demo mode | Free-only continues Gemini. Demo never calls paid providers; no generated-model claim. | Provider-policy, eligibility and scope tests. |

## Capability decisions

Every guidance capability is assessed below. Supported refers to the selected route, not a claim that every optional feature has been live-tested.

| Capability | Applicable / supported | Decision and evidence |
|---|---|---|
| Model selection, quality, speed and cost | Yes / yes | Implemented. User requested >=5.6 and real recovery; exact 6.1 Terra access verified. Explicit no reasoning preserves prior non-reasoning behavior and output budgets. Existing operator-funded request caps remain. |
| Instruction file naming | No / yes | Not applicable. No instruction files are renamed or added. |
| Chat Completions migration | No / yes | Already Responses for every OpenAI invocation. Preserve endpoint and HTTP integration. |
| Streaming and typed events | No for this repair / yes | Preserve complete-response UI. Reports must pass completeness checks before persistence; current UI never streamed. Partial rendering and event adaptation are not required to restore these workflows. |
| WebSocket mode, reconnects and lanes | No / yes | Not applicable. Single stateless request per action, one hosted tool maximum, no persistent session or tool loop. Existing HTTP failures reject without replay or duplicate billing. |
| Zero Data Retention | Unknown requirement / project-dependent | No ZDR claim. Preserve store:false and current retention; no new persistent response chain, background API job or regional endpoint. |
| Data residency | No stated requirement / project-dependent | Preserve current endpoint. No storage/processing jurisdiction change is made or promised. |
| Standard tier | Yes / yes | Implemented explicitly as service_tier:default, preserving existing Standard behavior for all workflows. |
| Priority, Flex, Batch, Reserved | No / project/model-dependent | Not applicable to this recovery. Interactive complete responses use Standard; schedules reuse the same collection adapter. No separate throughput or reserved-capacity requirement. |
| Prompt cache keys and fragmentation | Yes / yes | Preserve omission; >=5.6 needs no new cache key. Stable instructions precede variable evidence. No per-user cache fragmentation is introduced. |
| Earlier-model extended retention | No / no for selected model route | Not applicable; selected model is >=5.6 and no retention override is added. |
| Explicit cache breakpoints and caching mode | No eligible stable prefix / yes | Stable instructions are shorter than cache minimum; long evidence varies per action. Preserve implicit caching. No artificial prefix padding or explicit-only mode. |
| Cache diagnostics | No current cache requirement / yes | Existing input/output token accounting retained; no cache-hit UI or schema change without reusable prefix workload. |
| Multi-turn and instruction persistence | No multi-turn state / yes | Each action resends instructions and full scoped context. No previous_response_id, encrypted replay, local tool outputs or stored-response chaining exists. |
| Encrypted reasoning items and preservation | No / yes | Not applicable with reasoning:none and one independent request per action. No reasoning history is discarded from a multi-turn workflow. |
| Reasoning effort | Yes / yes | Implemented explicitly none for all four workloads, preserving GPT-4.1 mini's prior non-reasoning behavior. Official model docs and successful request confirm support. |
| Reasoning summaries and tool preambles | No / yes | No summary requested or displayed. Final answer is the product output; commentary is excluded without exposing reasoning. |
| Verbosity | Yes / yes | Implemented explicitly medium, preserving prior default and task instructions. No independent length preference was changed. |
| Maximum output tokens | Yes / yes | Preserve 1,800/3,500/1,500 limits by workload; no reasoning tokens with selected effort. Incomplete results stay excluded. |
| Assistant message phases | Yes / yes | Implemented final-answer extraction; skip commentary and non-assistant messages. Preserve citation offsets relative to final text. Focused parser regression test added. No replay path exists. |
| Context compaction | No / yes | Not applicable: bounded evidence excerpts, independent actions, no expanding conversation or tool history. |
| Structured outputs | Yes for suggestions / yes | Preserve JSON object mode and downstream validation. Reports/analysis remain Markdown; no forced schema. |
| Tool choice | Yes for collection / yes | Preserve required web search, low context, max_tool_calls:1. No tools in scoped generation. |
| Tool search and additional-tool replay | No / not needed | One fixed hosted tool, no dynamic catalog or additional tools. |
| Parallel tool calls | No / not needed | At most one hosted search call. No new concurrency, approval or shared-state behavior. |
| Programmatic tool calling | No / unassessed because inapplicable | No app-side tool executor, code sandbox or tool orchestration workload. Existing single hosted search is retained. |
| Model-aligned tool interfaces | No / not needed | No repository editing or file-search agent in the product. |

## Gemini repair and diagnostic limits

Removed candidateCount, which current Gemini 3/4 troubleshooting documentation marks unsupported. Extended the total request deadline from 45 to 90 seconds, below the 120-second collection lease. Do not automatically repeat an ambiguous billed request. Distinguish timeouts, network failures, access denial, invalid input, unavailable model, rate limits and upstream 5xx. Log provider/model, safe code, HTTP status and elapsed time only. A timeout alone is not proof of an invalid key or provider outage. Preserve the existing Gemini key unless live evidence establishes a key-access problem.

## Validation evidence

- Focused provider/workerd/backend/scope checks: 55 passed before the additional observation/generation metadata assertions.
- Final full run with test-concurrency=2: 377 passed, 0 failed/cancelled. This includes the added paid-generation scope test. The prior unbounded run had two local D1 transport failures in unrelated backup/impact suites; both pass in the bounded run.
- TypeScript and production build passed. Lint: no errors; five pre-existing warnings. Built output contains no new API key bytes.
- Direct new-key request: HTTP 200, completed, exact gpt-6.1-terra, reasoning token count 0.
- Production v25: real GPT report generated and persisted for 7-day Gemini scope (1 completed answer); reload retained the document. Real GPT assistant generation used 30-day Gemini scope (6 completed answers); changing period/model preserved the original message scope. Both identified GPT-6.1 Terra separately.
- Production responsive checks: CSS widths 320 and 390 and native Chrome 200% (CSS 735, DPR 4) showed no document overflow; report editor also had equal client/scroll widths. Original 90% zoom and temporary viewport were restored.
- Gemini production retest with a short two-sentence question failed before response headers at exactly 90,000ms. Safe log event provider_timeout, request ID 864548ce5d3fbbc409ae771a2133f287, 2026-11-11T12:42:49.814Z. No upstream HTTP authentication/quota response was received; key replacement need and underlying provider cause are not established. Requested the Google project identity for further quota/access diagnosis.
- Production v25 GPT web-search collection completed 1/1 for the existing GEO-tool question. Saved GPT-6.1 Terra original text and six provider citation annotations; the model filter shows one completed answer.
- Live testing found stale Gemini-only availability copy. Corrected collection dialog, model notes, public FAQ, method guide and metadata to describe each connected provider without claiming API results equal consumer app results.

## Sources

- https://developers.openai.com/api/docs/models/gpt-6.1-terra
- https://developers.openai.com/api/docs/guides/migrate-to-responses
- https://aistudio.google.com/docs/troubleshooting

No optional capability requires a new user decision for this approved recovery. Do not expand retention, pricing tier, tool permissions or automatic retries as a side effect.

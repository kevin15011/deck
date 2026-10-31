# Provider and runner failure reporting working brief

## User outcome

The user explicitly requested resilience and clear information when providers fail from instability, so users can distinguish external failures from Deck defects. Expand P-012 beyond the observed Codex overload to supported runner integrations. Continue existing compaction and readiness work without overlapping edits.

## Evidence and acceptance direction

The observed Codex error `serverOverloaded` reached the native ledger but the terminal host event contained only failed status; the UI displayed a generic fallback. Preserve a bounded, sanitized failure category and actionable explanation through native adapter → host terminal outcome → live/history UI.

- Distinguish confirmed provider overload/unavailability, rate limits or quota, authentication/configuration, transport/connectivity, runner process failure, Deck orchestration failure, and unknown origin using actual evidence. Do not blame the provider for every failed turn or conflate runner identity with provider identity.
- Tell users what failed and the appropriate next action: retry later, respect a reported retry delay, check credentials/connectivity, or choose another configured model where applicable. Do not promise those actions can resolve every failure.
- Preserve existing session history, partial work, terminal state, queued input controls and manual retry behavior. Explain interruptions without claiming completed effects were rolled back.
- Do not silently switch model/provider or replay arbitrary turns. Any automatic recovery must prove safe pre-execution boundaries or idempotency, respect native retry handling and user cancellation, and have bounded attempts/backoff. Decide scope from existing behavior before implementation; accurate reporting is the first deliverable.
- Do not expose raw error bodies, credentials, endpoints or arbitrary provider text. Keep a safe fallback and additive compatibility for old events/clients.
- Verify Codex's observed overload and supported Claude/OpenCode error shapes with deterministic fixtures, plus unknown errors, ambiguous network errors, redaction, correct task/turn attribution and history/reconnection.

## Current source trace and ownership

`TurnOutcome` currently exposes `error?: string` and a narrow native-session-not-found reason. Codex native turn completion passes only status to `finish`; OpenCode session error uses a generic string. The web renderer falls back when the terminal error string is absent. Further trace and a compact shared contract decision are required. Graph coverage is stale/untracked; use source fallback.

Architect owns a read-only bounded contract/recovery design and returns recommendations; Lead writes official persistence. No implementation is assigned yet. Apply Fast currently owns compaction changes in the Codex driver and core chat-history; do not edit these concurrently. Apply Deep owns the independent readiness cancellation follow-up.

Design task: `task-cfd22420-48f2-4114-95a9-0f29ce642881`, owner `architect`, in progress.

## Reviewed contract decision

Architect attempt 1 (result 22475 / ended 22476) is reviewed; the complete report was recovered from the result ledger because tool retrieval truncated its tail. Adopt an optional additive `TurnOutcome.failure` record propagated by the host to failed `turn.completed` events. Keep legacy `error` and existing no-metadata rendering. Core owns the shared record, sanitization and validation; native classifiers belong in adapters. Web uses fixed category-based wording and next steps, not native prose or response bodies. Existing queue pause, manual recovery and native-session-not-found handling remain unchanged.

The record carries a stable category (provider overload/unavailable, rate limit, quota, auth, rejection, context limit, network, runner process, Deck or unknown), origin (`provider`, `runner`, `deck`, `unknown`), and evidence certainty (`reported`, `inferred`). Optional code/provider tokens must be explicitly validated/allowlisted, not merely accepted because they match a token regex. Optional HTTP status or reset time requires structured native evidence. Omit ambiguous `recoverable` and optional activity tracking in this first slice; no field implies safe replay.

Corrections to the handoff: do not label every host startup catch or lost transport as a Deck defect. Classify the actual evidence; ambiguous startup/network failures remain unknown. A terminal failure does not prove that native retries were exhausted, and native retry support must not be generalized to every runner/error. Do not implement named OpenCode categories from guessed fixture shapes: verify current local protocol/schema/fixtures first or retain unknown. Provider identity must not be inferred from runner identity. A future retry policy needs separate evidence; no automatic retry, delayed replay or model switching is part of this slice.

Confirmed local evidence includes Codex `serverOverloaded` on this session and investigator-reported Claude structured API error fields in session `20261021T141551-27e992`, sequences 27013–27015. Implementation must use sanitized fixtures to verify Claude attribution, quota versus rate-limit distinction, and reset-time correlation to the correct turn. Codex error-notification fallback must match the current thread/turn, must ignore `willRetry:true` as a terminal failure, and must clear state between turns.

## Additive persisted-event requirements

- Given a verified native failure category, when a failed turn finishes, the host SHALL persist a sanitized optional `failure` record alongside existing fields. Nonfailed/cancelled turns SHALL NOT acquire a failure from stale native notifications.
- Given legacy, missing or invalid metadata, readers SHALL retain safe compatible rendering. Invalid optional metadata MUST NOT corrupt or prevent the terminal event.
- Given a failed turn loaded live or from history, the UI SHALL show a consistent category explanation and appropriate manual next step. Unknown origin SHALL remain explicit; partial work and queue state SHALL be preserved.
- The implementation MUST NOT persist/display raw provider error payloads in the new record or silently change runner/model/retry policy. No new ledger event kind is required.

Implementation is one Apply Deep vertical slice across core contracts, adapter classifiers, host forwarding, web presentation and focused tests. Begin independent files while P-001 review runs; do not edit the shared Codex driver/mapper or core chat-history until Lead confirms that review checkpoint is complete. Keep this ordering internal; no user approval is required for the authorized failure-reporting work.

Implementation owner: `apply-deep`, task `task-1fbf3888-0a98-4deb-84f4-44acde55e039`; in progress. This is separate from the completed readiness-cache implementation task.

P-001 review checkpoint is complete: compaction committed as `484fd39`, independently approved by Quality attempt 3; fixture follow-up committed as `503b5ae`. Shared Codex paths can now be updated for P-012 while preserving compaction. A continuation carrying this clearance was rejected with `task-running`, so it was not delivered; relay it on the owner's next outcome/checkpoint continuation. Independent P-012 files may continue under the original task instructions meanwhile.

Implementation attempt 1 completed at the checkpoint (result 25053 / ended 25054): shared sanitizer, Claude/OpenCode handling, host persistence, web live/history explanations and Codex pure classifier are implemented. Lead inspected shared contract/UI and `/tmp/p012-targeted-final.log` (533 passed, zero failed); typecheck and whitespace passed per owner. Production Codex wiring remained intentionally pending. Attempt 2 now receives explicit clearance to complete that wiring while preserving P-001. Lead also requested wording that distinguishes inferred origin from a provider-reported fact, with a focused regression. Candidate remains partial until that continuation and independent review finish; no deployment.

Implementation attempt 2 completed (result 26075 / ended 26076). Lead reviewed Codex terminal-error precedence, scoped notification fallback, host sanitization and certainty-aware fixed UI wording. Local generated Codex 0.162.1 schema and OpenCode 1.19.1 declaration excerpts support fixtures; observed overload is exercised through adapter → host → live/reloaded history → UI. OpenCode session-only SSE failures remain unknown because no current-turn identity is available. Verification commands and evidence are in `/tmp/p012-verification.txt`: 165 affected tests, 123 latest-delta tests and 7 host-boundary tests passed (overlapping populations; not a sum), with typecheck and whitespace passing. These are fixture/process-simulation checks, not a live provider outage test.

Accepted as a complete candidate pending independent review by Quality task `task-42242c04-39b4-4a34-a996-c6f54bf9e0c9`, attempt 4. No installation or activation yet.

Quality attempt 4 (result 27048 / ended 27049): **request changes** for one attribution issue. `ContextOverflowError` is also constructed by OpenCode's local compaction path, so its name alone does not establish provider origin. Lead checked the classifier and the local executable excerpt at byte offset 96758313, confirming the report. Preserve the context-limit category with conservative origin and add a classifier-to-UI regression; return this delta to the same implementation owner. No other blockers were reported after 28 classifier/UI/history checks, 30 driver lifecycle/compaction checks and 7 host boundary checks, plus typecheck/whitespace. Schema provenance and Claude recorded quota/reset fields were independently checked. Activation remains pending correction and review.

Implementation attempt 3 (result 27611 / ended 27612) preserves the known context-limit category but uses unknown origin for OpenCode context overflow. Lead reviewed source, regressions and RED/GREEN logs (three prior failures, then 11 passing tests). Neither provider-looking prose nor local-compaction prose changes attribution; the UI preserves context guidance without claiming a provider/runner origin or displaying native text. Typecheck and whitespace passed per owner. Quality attempt 5 is reviewing this bounded correction; previous unaffected findings remain applicable. No deployment yet.

Quality attempt 5 (result 28086 / ended 28087): **approve**, original P2 resolved and no new blockers. Independent classifier/UI checks passed all 11 tests; the provenance excerpt matches the recorded executable offset, and scoped whitespace checks passed. Prior unaffected P012 review evidence remains applicable. Lead accepted final review. Ready for commit and local canary build, including the already reviewed compaction slice; activation must be verified separately.

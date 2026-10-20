# Push attention for conversational continuity

Status: authorized design and implementation increment, 2026-10-19.

## Intent
Notify an away user about actionable decisions, reviewed results and blocked work without equating Lead turn release with completed work. User approved the preceding recommendations, including relevant attention recovery after restart/reconnection. Runner parity proceeds independently.

## Acceptance
- Pending decisions can notify while unrelated tasks run; revisions, resolution and related questions/approvals do not create duplicate or stale alerts.
- A reviewed result presented by the Lead may notify while unrelated tasks continue. Integration alone is not proof of user-facing presentation.
- Actionable blocked continuation can notify, excluding intentional user pause/release/stop.
- Restart/reconnection re-evaluates relevant unresolved attention, without replaying historical notifications.
- Turn release and ordinary child completion alone do not notify.
- Occurrence identity and per-device accounting prevent avoidable duplicates across retries/reconnects; transport uncertainty must not be misrepresented as exactly-once delivery.
- Viewing suppression remains per device; opening/receiving a push never resolves a decision or acknowledges review. Preserve opt-out, revocation, privacy and existing browser security boundaries.
- Include a concise, specific summary of the user-facing Lead response by default. The user explicitly rejected optional previews, privacy settings and added configuration. This supersedes the earlier fixed-generic-copy requirement. Summaries must accurately describe the relevant result without claiming all work is complete while independent tasks remain active. Render bounded plain text, not raw Markdown/tool output; preserve transport security and exclude credentials/internal hidden content. Use the response language for its summary; static fallback UI copy remains English. No separate model request solely for summarization unless a material need is established.

## Evidence and implementation boundaries
Audit attempt 9: result 40020/ended 40021. Lead reran four push suites on Bun 1.3.12: 35 passed, 162 assertions; simulated transport only. No confirmed regression. Current source produces question, approval, finished and failure events; decisions lack their own producer. Current global finished gate suppresses while other work runs. Current restart intentionally does not replay missed attention.

Before this increment, main and origin/main were checked after fetch: 0/0 divergence. Preserve all staged and unstaged work. Scope includes producer semantics, durable attention/delivery state as necessary, host wiring, service-worker copy, focused tests and documentation. No unrelated redesign, voice/terminal work, runner upgrades or live push during automated testing. Lead owns OpenSpec. Material protocol/security changes require independent review before canary installation and canonical daemon restart.

## Open design points
Define trustworthy result-presentation evidence, bounded recovery policy and deduplication identity; resolve implementation choices from source and existing contracts without changing decision authority. Record uncertainty if a product choice is genuinely necessary.

## Design review checkpoint
Architect attempt 1 (result 43425, ended 43426) is not yet accepted for implementation. Its generic-only payload sections predate the accepted mandatory summary clarification. Lead requested a targeted revision: bounded default content summaries with no new configuration, no unrelated six-hour session-wide coverage, no swallowing independent requests, final-presentation evidence that excludes commentary, and confirmed intentional-stop versus crash provenance. The same architect continues the design. Temporal ordering alone is not semantic proof that a result was presented. No push runtime changes are installed.

## Implementation handoff
Architect revision 2 (result 44161, ended 44162) is accepted with the overriding Lead constraints in push-continuity-design.md. Mandatory summaries and independent attention preservation are required. Same-turn membership alone does not justify covering a distinct result/decision. Final-text extraction is structural, not semantic proof. Push implementation proceeds with one owner and independent review before activation; runner parity stays independent.

## Functional candidate awaiting independent review
Apply Fast task-29ecc53d-f401-4717-b5ec-319eb983fd3f attempt 1 (result 46824, ended 46825) reports implementation complete. Report: /tmp/deck-push-continuity-implementation.md. Reported verification on pinned Bun 1.3.12: 88 focused tests/416 assertions and 258 affected tests/1704 assertions; TypeScript and diff checks passed. Candidate uses distinct attention delivery (no lossy coverage), bounded default summaries, private durable receipt state, replay-derived block sequences with snapshot version 12, production composition and worker compatibility. No real phone delivery or activation is claimed. Lead reviewed the handoff and requested independent Quality security/protocol review; source acceptance remains pending that review. Claude implementation continues separately.

## Independent review: repairs required
Quality attempt 12 (result 47760, ended 47761) reproduced three blockers in /tmp/deck-push-continuity-review.md: formatted credentials/quoted fenced code reach summaries; renewal can strand pending/retry jobs; bounded receipt eviction reopens delivered/exhausted occurrences. The passing existing tests did not cover these cases. Same Apply Fast owner continues repairs with payload, renewal and capacity/restart regressions. No activation until re-review. Shared session-manager changed during review; all finding-target files were stable. User-facing content summaries remain enabled by default without configuration.

## Repaired candidate awaiting re-review
Apply Fast attempt 2 (result 48776, ended 48777) reports fixes for all three findings; 57 affected tests/1824 assertions, TypeScript and diff checks pass. Evidence and immutable source copies are referenced in /tmp/deck-push-continuity-implementation.md. Same Quality reviewer is checking original repros plus repair edge cases. New receipt capacity policy reserves slots and defers unsent work rather than evicting terminal receipts; its possible expiry under pressure is a review concern, not an accepted delivery guarantee. No activation or phone-delivery claim.

## Re-review: broader repair failures
Quality attempt 13 (result 49700, ended 49701) verified original repro repairs but reproduced optional-outer-pipe table content leakage, in-flight renewal losing acceptance/retry accounting, and permanent loss of an independent short-horizon result behind retained capacity. All 18 source hashes were stable. Same implementation owner continues invariant-based repairs; bounded storage must not become a delivery quota. Documenting capacity loss is not accepted. Re-review required before activation.

## Exact-outcome implementation awaiting review
Apply Fast attempt 4 (result 52740, ended 52741) reports the accepted representation correction implemented with private Bun SQLite outcomes, bounded memory cache, paired v2 metadata/index, transactional v1 receipt migration, expiry compaction and explicit storage-error handling. Table grammar and active renewal accounting repairs are included. Reported final verification: 113 tests/2801 assertions, TypeScript and diff checks. Evidence/source snapshot: /tmp/deck-push-representation-source-hashes.json and /tmp/deck-push-continuity-implementation.md. Same Quality reviewer continues push review including SQLite/migration and prior failure cases; final packaged acceptance must exercise compiled SQLite support. Claude source approval remains separate. No activation yet.

## Review 15: storage and renewal verified; summary repair pending
Quality attempt 15 (result 54040, ended 54041) independently passed renewal accounting, capacity independence, SQLite migration rollback/replay, paired-index checks, private modes and writer-contention recovery. 74 tests/2507 assertions passed; all 20 manifest files remained stable. One summary exclusion defect remains: mixed list/quote fenced code and table headers truncated before their delimiter can enter outgoing summaries. Same owner performs a narrow bounded-parser repair with ingestion/payload regressions; no storage redesign. Packaged acceptance must exercise compiled SQLite. Claude source approval remains unchanged; push activation still blocked.

## Summary repair awaiting focused re-review
Apply Fast attempt 5 (result 54765, ended 54766) reports bounded mixed-container/fence handling and fail-closed saturated-input classification. 33 targeted tests/177 assertions, TypeScript and diff checks pass. Only summary source/tests and fallback documentation changed; renewal/SQLite/shared source hashes remain identical. Same reviewer checks this delta; prior stable storage evidence stands. Saturated content uses safe fallback while still sending the attention notification. Source approval and packaged runtime acceptance remain pending.

## Review 16: summary grammar boundary
Quality attempt 16 (result 55669, ended 55670) confirmed preceding repros fixed but found effective list-padding/dedent fence misclassification exposing code in outgoing summaries. All 20 manifest entries stable; storage/renewal and Claude evidence unchanged. Lead directed same owner to use a bounded standards-based Markdown/GFM syntax parser if available, with explicit host dependency allowed and no React coupling/unrelated upgrades, instead of repeated partial grammar fixes. If custom parsing remains, differential padding/dedent coverage against existing renderer is required. Mandatory summaries and safe fallback remain; activation blocked pending re-review.

## Standard-parser candidate awaiting review
Apply Fast attempt 6 (result 56306, ended 56307) replaced handwritten Markdown classification with already-locked mdast/GFM parser dependencies declared directly by session-host. Reported verification: 37 tests/825 assertions, differential matrix of 1080 renderer cases, actual ingestion/outgoing payload regressions, typecheck, CLI bundling and isolated compiled parser harness. Source manifest: /tmp/deck-push-summary16-source-hashes.json. Same Quality reviewer checks parser/dependency reproducibility and remaining exclusion cases; prior unchanged storage/renewal/shared-source evidence stands. Full packaged SQLite/migration/restart acceptance remains required; no activation.

## Source approval; packaged acceptance in progress
Quality attempt 17 (result 57168, ended 57169) APPROVES push source. Independent 37 tests/825 assertions plus 11 exclusion/redaction/language/bound checks passed. Renderer matrix: 1080 cases, 621 code excluded/459 prose preserved, zero leaks; shared parser dependencies limit oracle independence. All 23 manifest files stable; manifest f110d2e86091e8631c46377d4717e2e052016d34533f49693949b813cbc39098. Direct parser declarations match lock; 59 transitive resolutions/integrities unchanged. No clean install or phone delivery claimed.

Prior renewal/SQLite and Claude source approvals stand. Same push owner now compiles through canonical canary workflow into private temporary install location and exercises actual packaged SQLite/migration/restart/assets, without changing user installation/daemon or sending real pushes. Live activation follows accepted packaged evidence; source approval alone is insufficient.

## Packaged acceptance and installed candidate
Apply Fast attempt 7 (result 57837, ended 57838) packaged acceptance reviewed: actual compiled SQLite v1 migration, 512 terminal identities retained over restart, private modes, served canonical assets and signature/version passed. No transport/phone delivery exercised. Canonical live canary installation completed; digest 4a7e3a4933070e5d44585c8945b62a2d953013450c81ee78b076bba2378cd316 exactly matches tested artifact. Bounded identity/digest-checked watcher scheduled exact daemon restart after Lead idle, from PID1355/nonce ea37ef15-40f0-402d-bd1c-4af59953566a. Restart is not yet verified. Evidence directory: /var/folders/tn/z_26gcr948v50zmhpkp4pr2w0000gn/T/deck-push-activation-_x5ngmp8. No force/stop-start fallback.

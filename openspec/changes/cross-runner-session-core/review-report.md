# Review: Cross-Runner Session Core

## Precommit and portability review — approved (2026-10-15)

Independent bounded review found no unrelated group, binary dump, common credential-pattern match or whitespace error in the accumulated candidate. Atomic runtime/UI/test commit plus documentation/governance commit preserves dependent queue/generation/lifecycle UI semantics. Cosmetic removal text has minimum6.03:1 measured contrast. Independent investigation verified initial checkout-denied compiled67 and mocked memory runtime; Root repeated both successfully on the final rebuilt artifact. The conclusion is repository independence for exercised Darwin arm64 paths, with runner/plugin/MCP prerequisites retained. Full gates and artifact evidence are in `release-readiness.md`; publication is not claimed.

## Session release/actions follow-up — approved (2026-10-15)

Independent deck_quality_cross_workspace approved the frozen host/UI candidate after repairs. Findings resolved: renamed title projection, async assignment after removal, pruning during cleanup, fresh-command retry after failed removal, finalization-prefix recovery, retained-resource daemon busy guard, stale readiness and cross-client catalog omission. Reviewed same-ID/native/history/images/drafts retention, paused queue and catalog-only removal policy. Independent40 tests/170 assertions passed and overlap owner/root suites; browser assertion review and mobile menu inspection completed. Broader workspace and installed compiled checks remain root/owner evidence, both passed. No outstanding blocker; see `session-release-brief.md`.

Result: **approved** after repair, 2026-10-13 UTC. Lead centralized this record from independent Deck Quality reviews; the reviewer did not edit the candidate.

Review covered driver isolation and lifecycle, session/task authorization, durable receipts and recovery, delegated memory ownership, web authentication/replay, cross TUI persistence, native-flow compatibility and verification claims.

Confirmed findings were repaired and regression-tested:

- Cross-session credential/approval cleanup and approval ownership; terminal replay/retry handling.
- Codex process drain before slot release; OpenCode stale approval and startup bounds.
- Queued cancellation receipt type and idle Lead wake; concurrent/replayed create payload ownership and shutdown checks.
- Desktop task `modelId` rendering and interrupted-stream attempt boundaries.
- Cross config migration preservation and Claude's unsupported cross-member `inherit` sentinel.
- Codex native MCP permissions use `mcpServer/elicitation/request`. Exact isolated approval forms now relay once; unsupported forms fail closed. The final guard requires nonempty matching native turn IDs, rejects array-valued form properties and retains the original turn object across asynchronous broker decisions.

Independent review rounds passed 346 affected checks, 90 integration checks and 108 final-delta checks. The last approval-boundary review independently passed 26 tests including all three guard regressions, then reported no outstanding source blockers. The implementation owner's full Codex focused set passed 35 tests. These counts describe separate, overlapping runs, not one combined total.

The reviewer accepted the explicit worker-cap interpretation (delegates plus a separate Lead slot) and confirmed the native TUI remains unchanged by cross-only `inherit` filtering. Narrow baseline fixture repairs preserve production behavior and test intent. Final broad verification subsequently passed 6,373 tests with no failures; see [verification](verify-report.md) for compiled/native evidence and limits.

No open blocking finding remains. This is source/integration approval, not publication or installation approval. Optional exposure remains deferred.

## Canary feedback review — 2026-10-13

**Approved** after independent read-only Deck Quality review and repairs. Review covered automatic loopback authentication boundaries, removal of subscription gates, partial text/failure visibility, exact MCP compatibility, private runtime isolation, protocol readiness, bounded recovery/backoff, task references and cancellation/shutdown races.

Confirmed repairs: reserve initialization before asynchronous retirement to avoid duplicate services; isolate cancellation of shared artifact verification; stop and clear malformed/oversize closed protocol input; retain native consumer leases during recovery; persist ownership-unsettled after rejected native drain and reject prompt/continue/prune across restart; fail Claude turns for expected MCP failed/pending/missing connection status and suppress buffered output after the fatal guard. Independent focused results included 151 broad runtime tests, 62 ownership tests and 31 final Claude checks, all passing. No outstanding source blocker remains.

The final standalone daemon exits after bounded shutdown; generic embedded-daemon fencing was outside this design and was not a blocker. The full follow-up gates in `verify-report.md` passed after source freeze. No archival, commit, installation or publication is implied by this approval.

## Duplicate completion wake review — 2026-10-13

**Approved**, no blockers. Independent read-only Quality review verified task-attempt acknowledgement during terminal Lead-tool result delivery; suppression of later enqueue in synchronous completion/cancellation paths; preservation of unseen results, later attempts, partial-timeout semantics, observer isolation and aborted calls; and the scheduled wake callback's pending-notice recheck. Reviewer independently ran 19 cross-runner integration tests, all passing, including authenticated socket delivery. The localized production delta changes only session-manager.ts; no transport exactly-once guarantee is claimed. Broader affected verification and rebuilt host acceptance are recorded in the latest verify-report section.

## Public daemon command review — 2026-10-13

**Approved**, no blocking findings. Independent Quality verified inert status/absent stop, idempotent start, busy and pending-approval refusal, bounded stop/old-PID/socket/lock settlement, preserved history, correct production CLI routing and JSON outcomes, and atomic admission closure across control, browser and bridge calls. The identified competing-start attribution race was repaired by returning the spawned PID and requiring the observed replacement identity to match it; a competing winner is reported explicitly without foreign cleanup. No forced signals or lock removal are performed by these commands.

Reviewer independently passed 110 tests (292 assertions, four files). Root subsequently passed fresh compiled macOS/Linux lifecycle and host cross/web acceptance. A concurrent start during another process's lock-before-listen window may conservatively report daemon-unreachable; this is an honest bounded failure, not an ownership violation. No automatic build-fingerprint or channel migration framework is included.

## Web workspace redesign review — 2026-10-13

**Approved**, no remaining blockers. Independent Quality reviewed canonical message provenance, safe Markdown rendering/URLs/images, session-bound artifact access, traversal/symlink/size/depth/enumeration boundaries, stale asynchronous responses, approval/replay continuity, keyboard/drawer/mobile behavior and scrolling. Existing authentication and CSP are preserved. Screenshots match the current visual agreement and separate prose from operational evidence.

Confirmed repairs: prevent repeated Enter from bypassing the pending-send guard; announce pending approvals politely; scope collapsed-sidebar rules so the mobile drawer retains names/headings; retain explicitly selected documents/changes when deleted, clear stale content and show unavailable instead of silently opening another document. Root requested a concise task completion summary in Activity with full Markdown results retained under Subagents.

Independent evidence: 104 backend tests/380 assertions, 10 frontend tests/44 assertions and 22 browser checks passed. Root subsequently passed four-target builds, extracted Darwin/Linux HTTP acceptance and compiled browser artifact/approval flows. Review used official requirements/source/tests; adaptive context was not loaded. No installed-runtime or publication action is implied.


## Detailed Lead Activity review — 2026-10-14

**Approved**, no remaining blocking findings. Independent Quality verified native identity correlation, streamed/snapshot reconciliation, task/runner scope, explicit skill evidence, safe Markdown and bounded/redacted presentation. Repairs prevent repeated prefixes after interleaved tools, protect historical replay, preserve unknown tool outcomes on failed turns, and close pending entries on host lifecycle events that omit native session identity.

Reviewer independently passed 26 mapper tests/136 assertions and 20 web tests/94 assertions, reviewed the final mobile Activity capture and accepted Root evidence: 176 runtime tests, 22 web/asset tests, 18 documentation tests, clean TypeScript, 36 generated-asset browser checks and scoped registry validation. No live-model or installed-canary verification; unscoped legacy registry issues are outside this increment.


## Immediate Lead feedback and preparation timing review — 2026-10-14

**Approved**, no blocking findings. Independent Quality verified immediate and receipt-scoped feedback, session-specific pending state, terminal precedence during delayed POSTs, failed-send cleanup, reconnect/replay, child/internal isolation and mobile visibility. Preparation events preserve lifecycle sequencing and only report the final phase after the driver emits its turn boundary.

Independent checks: seven UI tests/36 assertions and five preparation tests/14 assertions. Root final integrated checks passed 503 runtime tests, 29 web/asset tests, 18 documentation tests, 42 browser checks and TypeScript. The subsequent unknown-phase guard and corrected canonical failure fixture are included in Root final evidence. Timings are wall-clock operational estimates and driver boundaries differ; no measured latency improvement or installed-canary verification is claimed.
# Native memory and hook Activity review — 2026-10-14

Independent Deck Quality approved the source candidate with no remaining blocking finding. Review covered canonical scope/profile reuse, native versus daemon authority, per-runner effective configuration and hook trust, native session continuity, safe hook provenance and UI attempt/replay behavior. Normal-launch selection policy matches the cross preparation path.

Three hook privacy paths found during review were repaired: malformed Codex hook identity, rejected foreign-thread/unsupported-request hook messages, and unknown future Codex `hook/` / Claude `hook_*` messages. Regressions prove these remain metadata-only while regular unknown events retain the existing raw-event policy. Supermemory hook attribution is accepted only after trusted launch/effective-configuration evidence.

Independent checks: 55 preparation/launch/UI tests (240 assertions) and 62 final hook mapper/driver/schema tests (339 assertions), with final privacy evidence in `/tmp/deck-hook-privacy-quality-final.log`. Lead's frozen aggregate, TypeScript and 45 browser checks also pass. All four distribution targets built, and 22 isolated compiled Darwin arm64 cross/web checks passed.

Accepted explicit limitation: native integration activation does not certify provider recall or background capture. The managed lifecycle does not provide a verified Claude asynchronous capture barrier or an awaited OpenCode capture-disposal barrier. These limits are documented and supplied to the Lead; no arbitrary delay, silent fallback or fabricated storage receipt is introduced.

## Native no-confirmation and Claude project instructions — approved (2026-10-14)

Independent Deck Quality approved native no-confirmation mapping for all three runners, preservation of explicit relay and fixed delegation restrictions, and Claude-only bounded root instruction supply. Actual assignment gating, fresh/resumed reads, unsafe-file rejection and content privacy were verified. The final intentional-memory-omission clarification is accurate and preserves native capture caveats. No source blocker remains.

Evidence: `/tmp/deck-cross-yolo-quality.log` (104 tests, 282 assertions), `/tmp/deck-project-instructions-quality.log` (34 tests, 93 assertions). These overlap the Lead aggregate and are not additional unique test counts.

## Activity follow and document bounds — approved (2026-10-15)

Independent Quality approved the final scroll source after resolving reflow-versus-user-intent handling and immediate persistence of pauses. Keyboard, detail, wheel, touch and scrollbar interactions remain distinct from layout-driven scroll. Session/tab/replay restoration and viewport containment passed browser acceptance; no source blocker remains. Project/session lifecycle work is design-only in workspace-evolution-brief.md and is not part of this approval.

## Global workspace — functional candidate approved (2026-10-15)

Independent `deck_quality_cross_workspace` approved the implemented CLI, host contracts/lifecycle and web candidate with no remaining blocking findings. This approval supersedes the previous proposal-only scope for phases 2–4. Review covered canonical project identities, authenticated directory completion, preserved native ownership, stable command retries, crash-safe linked successors, preparation cancellation and resource cleanup, fair admission/drain reservations, active-generation authorization/interrupts, and historical session pagination/assignment updates.

Confirmed findings were repaired and regression-tested: fixed Lead IDs in terminal interruption, stale browser assignment metadata, pagination self-invalidation, unsafe preparation exception text, late readiness/cleanup races, uncertain owner reservations after restart, replacement symlinks before launch/continuation, inherited roles removed from global defaults, partial successor writes and retry fingerprints drifting with configuration. Explicit connection/preparation gates replace the composer until ready while preserving drafts. The reviewer inspected actual-backend browser assertions and fresh desktop/mobile/dialog renders.

Independent checks: 153 tests/667 assertions for host/schema/catalog/terminal; continuation repairs 3/10; control/bridge 49/131; UI projections 32/143. These suites overlap and are not summed. Freshness references: session-manager `595df40fd120867b`, web main `69117dacc43e6d2b`; subsequent root gates are recorded in verify-report.md. Native inference and Supermemory persistence remain unverified by this increment. Root retains responsibility for final distribution, regression and activation checks.

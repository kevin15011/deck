# Review: Cross-Runner Session Core

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

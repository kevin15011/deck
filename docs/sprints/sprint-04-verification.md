# Sprint 4 candidate verification

Status: corrected candidate `830524cb…` is accepted at 125556 and installed as `deck2`, binary `6bed34b2…`. S4-Q01 is resolved. S1-Q07 and the documented scope limits remain. No live user host was restarted.

## Candidate and scope

Apply Deep attempt 9 (115600/115601) supplied candidate `unborn-head:implementation-sha256:ece822aff5ec9f59f6c01af230cf290e5d2e3034e6a61f58d557816667df56b2` and binary SHA-256 `152ad27a87c3ff535d87696f2f4e711b38ca1642a5fa5429977c01e98114ac5d`. Lead recomputed the sorted compact JSON input-map digest, matched all 84 implementation inputs, 22 embedded assets and the binary, and froze them in `target/review-s4-ece822af/`. Lead documents are outside this implementation identity; the repository has no commit-based candidate identity yet.

The proposed slice is a Codex 0.166.0 Lead using dynamic tools to delegate a scoped read-only investigation to OpenCode 1.19.1 with explicit model `minimax-coding-plan/MiniMax-M2.7`. It adds durable task/attempt ownership, immutable reports, exact treatment, same-owner follow-up, cancellation and task views. The runtime uses a default-deny native agent and Deck-owned scoped read/search tools, without installing a plugin into a native profile.

The [brief](../../openspec/changes/sprint-04-cross-runner/working-brief.md) remains the acceptance source. A successful model report is not independent verification, and this document does not certify the full roadmap.

## Implementation-owner evidence

Full handoff, manifest, gates, native records and screenshots are under `target/s4-verification/`. These are implementation-owner observations until independently checked.

| Check | Owner result |
|---|---|
| Formatting / Clippy | Passed; 0.243 / 0.226 s |
| Locked Rust workspace | 50 passed, one opt-in native test ignored; 11.939 s |
| API contracts | Six passed; 0.032 s, reused from matching API inputs |
| Packaged build/typecheck | Passed; 18.905 s |
| Packaged recovery / stable origin | Passed; 0.768 / 0.215 s |
| Real packaged two-runner browser | Passed; 128.939 s overall, initial delegation/treatment/follow-up journey 66.913 s |
| Child / root cancellation | Native child settlement observed in 672 / 707 ms |
| Real scoped-read negative cases | One allowed file and denied symlink, traversal, outside scope and absolute path; 38.634 s |
| Ordinary Codex continuation | Two sequential turns retained native context; 5.548 / 6.575 s overall, 14 / 9 ms admission |

An earlier concurrent ordinary-message fixture acknowledged dispatch but produced no output within 180 seconds. It was stopped without replay; the cause is unknown. Later sequential success does not establish a general latency guarantee. Native negative evidence includes recorded tool outcomes, separate from the specialist's prose; the Lead corrected an inconsistent count in that report rather than treating adoption as certification.

New deterministic coverage targets duplicate mutation/lost-response identity, foreign authority, report/treatment ownership, same-owner follow-up, storage rollback, restart, scoped reads and cancellation. Owner records red-first evidence for parent cancellation and result polling exhausting mutation budget; other new-feature tests do not claim an artificial prior failure.

## Lead review and independent responsibilities

Lead reviewed the material task-operation transaction/authority, native dynamic-tool channel, scoped reads and OpenCode configuration/preparation/dispatch/settlement paths. Graph coverage remains unavailable for `deck-next`; exact source fallback was used. The read boundary uses descriptor-relative traversal with no-follow flags and bounds content size/call count. OpenCode reads its native authentication; Deck selects separate database/discovery/config/cache/state/temp locations. Native logging is an explicit write exception, so this is not a claim of zero writes to native data. The supported executable/model/Linux Landlock environment is deliberately bounded.

Quality continues the same review task against the frozen candidate, with targeted independent protected-boundary execution and source/visual review. Lead independently replayed the real packaged browser scenario using the frozen binary and script, changing only its output directory to `target/lead-s4-checks/` to preserve owner evidence.

Lead replay passed in **138.368 seconds**, including delegation, exact report treatment, same-owner follow-up, mobile keyboard/tab reversals, reduced motion, and independent child/root cancellation. The first journey took 71.563 s; observed child settlement after cancellation took 676 ms and root-triggered child settlement 284 ms. These are observations, not latency guarantees. The fixture host exited with code 0, source/sentinel checks passed and no page exception occurred. Lead inspected both desktop and mobile screenshots. All 84 implementation inputs, 22 assets and binary were rematched afterward; `/proc` cwd sampling found no process in the owned fixture (not an exhaustive process audit). Records: `browser-replay.json`, `browser-acceptance.json`, `identity-cleanup.json` and screenshots under `target/lead-s4-checks/`.

The Lead's cleanup/follow-up review question is confirmed by Quality's source trace as **S4-Q01**, below. The existing cleanup-uncertainty test checks project queue ownership after uncertainty is recorded; it does not exercise the intervening admission/dispatch sequence.

## Independent review and required correction

Quality attempt 12 (117142/117143), integrated by Lead at 117291, blocks acceptance on **S4-Q01 — terminal task state precedes process settlement**. Lead rematched the 84 inputs/22 assets/binary and reviewed the same material source. `opencode::run_inner` persists a terminal report before `Runner::stop` completes. The parent can retrieve/treat it and admit a follow-up in that interval. If cleanup then fails, the previous attempt becomes uncertain, but `clear_active` can start the already-accepted follow-up; neither `start_task` nor final native dispatch rejects that conflicting uncertainty. Direct root submission also lacks the active-owner check used by the queue pump.

Keep durable unsettled ownership until cleanup succeeds, and revalidate conflicting ownership at native dispatch and direct admission. Add a deterministic delayed/failed-cleanup regression covering both follow-up and direct root submission. This defect is established by source tracing; neither reviewer claims the fault interleaving was executed yet. The passing real browser scenarios remain evidence for their exercised paths, not evidence against the fault.

Quality independently reran seven existing task contract tests in 0.050 s, with no failures, and reviewed the matching full-gate evidence and visual/native records. Its reviewed scope accepts the documented runner/model, fresh-execution, retained-history and schema limits. A separate qualification boundary remains: MCP liveness is checked before filesystem access without retaining the Store lock through the read. Existing tests do not prove immediate revocation of a read already admitted before cancellation; do not advertise that guarantee. New reads must be denied after revocation. S1-Q07 stays open.

## S4-Q01 correction candidate

Apply Deep 10 (122356/122357), integrated at 123907, supplied candidate `unborn-head:implementation-sha256:830524cb05839edb5e1b4de99654b20ffd5c42baeb913fd26d234160cf39f06a`, binary `6bed34b2eea0fdfd871e15b3ef7b43a0cc50c26a228ef086eb7f1e07fd4af271`. Lead matched all 84 inputs, 22 embedded assets and the binary and froze `target/review-s4-830524cb/`. Full owner evidence is in `target/s4-corrections/`. The earlier candidate and its failures remain preserved.

The model report now persists while the task remains active. Successful process cleanup permits terminal settlement; failed cleanup retains uncertain ownership and the immutable report, including cancellation during cleanup. Both child start and final native dispatch reject conflicting durable owners. Direct authenticated submission checks live process ownership; queue admission and idempotent retries remain available.

Lead reviewed the production diff, the six affected tests and the four failure records produced by applying the regression tests to the original frozen production code. Lead independently passed five OpenCode boundary tests and the authenticated direct-submission test. These use fake HTTP and injected cleanup outcomes around actual host/storage boundaries; they do not reproduce an operating-system reaper failure. The owner reports passing 55 Rust tests, six API tests, formatting, Clippy, build and the rebuilt real browser journey (135.561 s). Unchanged asset evidence is reused; no visual redesign occurred in this correction. Quality 13 independently reviews the exact candidate and recovery caveat before acceptance.

One unchanged packaged recovery fixture exceeded its five-second startup deadline (5.525 s) before the launcher record appeared. The fixture stopped the host and preserved owned state `/tmp/deck2-s3-recovery-nxte1cch` with a hot journal. Read-only reopening rejected it as unsupported/corrupt. An unchanged-source retry passed in 1.135 s; the cause of the initial delay is unknown. Both outcomes remain recorded, and interrupted first initialization is not qualified by the passing retry. MCP cancellation is qualified for new read admission only; already-admitted IO may complete.

Lead's independent replay of the corrected frozen binary and script passed in **146.248 s**. Real delegation, exact report treatment and distinct same-owner follow-up completed in 73.903 s; child and root-triggered child cancellation settled in 267 and 274 ms. Mobile keyboard/tab reversals, reduced motion, source/sentinel checks and absence of page exceptions passed. Host exit was 0; subsequent `/proc` cwd sampling found no process inside the owned fixture (a bounded observation). Inputs/assets/binary rematched and installed S3 remained unchanged. Records are under `target/lead-s4-correction-checks/`: `focused-and-identity.json`, `browser-replay.json`, `browser-acceptance.json`, `cleanup-observation.json` and screenshots. Quality 13 acceptance remains pending.

## Compatibility and remaining limits

- API 3 and schema 4 replace the prior API/schema. Recognized migrations are transactional; older binaries cannot open schema 4. Preserve stopped-state backups before activating migration; a binary backup alone is not a compatible data rollback.
- Team context continuation remains unavailable and requires explicit fresh execution. Follow-up retains task/owner/source-report lineage but uses a fresh native process/session; it does not claim remote memory continuity.
- Legacy native contexts without fingerprints require an explicitly fresh execution. Ordinary qualified Codex continuation remains supported.
- Task-bearing conversations conservatively retain their evidence: release/removal is unavailable in this slice. Ordinary settled S3 conversation removal remains available.
- Only the qualified OpenCode artifact/model and Linux Landlock ABI 3 path are enabled. Native provider HTTP is required; shell/write/network/delegation tools are excluded from the investigator.
- Native step-count guidance is not enforcement; the host separately bounds tool calls and native/abort waits.
- S1-Q07 actual Windows browser opening and live steering remain unqualified. Later sprint features are still outstanding.

## Acceptance and installation

Quality 13 (124836/124837), integrated at 125556, recommends acceptance with no new blocking defect. Its independent direct-admission test and seven task-boundary tests passed. Four cleanup-fixture executions were denied TCP binding in the review environment before assertions; Lead's six passing focal tests and real browser replay cover that gap on the exact candidate. Lead rematched all current/frozen inputs, assets and binary before accepting S4 and resolving structured S4-Q01.

The preserved startup fixture requires SQLite journal rollback: read-only inspection returns `SQLITE_READONLY_ROLLBACK`. Both Quality and Lead independently inspected the unrecovered physical image in memory: `quick_check=ok`, zero receipts, with original files unchanged. This does not prove corruption, lost admitted work or a correction-specific regression. Slow startup and interrupted-initialization recovery remain unqualified; the earlier failed run and passing retry are retained.

At 2026-11-11 08:39:15 UTC, Lead atomically replaced `/home/kevin15011/.local/bin/deck2` with accepted binary `6bed34b2…`, retaining S3 `86ac96f0…` in `target/installed-backups/`. Version/help checks passed. Record: `target/deck2-s4-install-evidence.json`. Only the executable changed: no running host was restarted, state opened/migrated, credential copied or runner profile modified. Installation is not full-product completion; S5–S12 remain outstanding.

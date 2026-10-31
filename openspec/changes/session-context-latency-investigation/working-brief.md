# Session latency and context investigation

## Outcome and scope

Current candidate: [preparation breakdown and baseline](preparation-progress.md) records a tested runtime diagnostic added after the user authorized proceeding. Prior research-only statements below describe the earlier investigation, not the current candidate. Live activation and matched native benchmarks remain outstanding.

Scope correction: community latency is reported across runners, including Claude. [Cross-runner analysis](cross-runner-analysis.md) supersedes the Codex-first prioritization below with shared preparation/startup investigation, existing Claude/Codex timing evidence, and adapter-specific findings. The initial reproduced Codex failures do not explain general latency.

The initial investigation confirms two remaining paths where an oversized Codex response can terminate a turn, and a diagnostic gap that hides startup timeouts. Native context reuse and expensive compaction are also evidenced. The community screenshot's exact nine-attempt timeline, 245–271k token interpretation, 19-minute loss, and repeated verification counts remain unverified without that machine's records.

User priority: investigate P-008 before implementing the other pending UI improvements, with P-001 and P-006 as related issues. Baseline: `main` / `origin/main` at `fc667aadbb052e2e4515889e425848762769c838`, branch `fix/session-pending-issues`. The memory feature branch is outside this investigation.

This is an investigation artifact, not implementation approval for a particular context-reset or transport design. No product source, session settings, daemon, or native conversation was changed. Driver probes use a fake child and synthetic text; the later history measurement uses a disposable copy of a local ledger. Neither performs network requests or inference.

Follow-up: [history limits and necessary operations](transaction-analysis.md) confirms the UI performance origin of pagination, measures cold indexing versus warm paging, and separates transport reduction from model context ownership. It refines the next implementation slices without removing existing protections.

## Evidence and limits

- **Community report:** [P-008](../../pending-issues.md#p-008--slow-sessions-with-accumulated-context-repeated-verification-and-oversized-rpc-responses), transcribed from the supplied screenshot. Original machine logs and versions are unavailable here.
- **Current source:** exact source reads at the baseline above. Graph project `deck` reports generation `2026-08-20T17:25:00Z`; relevant session paths are untracked by that index. Symbol lookup returned no relevant session symbols. Coverage checks therefore led to direct source reads and bounded literal searches, rather than negative conclusions from the graph.
- **Prior official evidence:** [Codex resume-history fix](../cross-runner-session-core/codex-resume-history-fix.md), dated 2026-10-16. Its historical live reproduction is cited as an existing record, not repeated or independently attested here.
- **Current reproduction:** [reproduce.ts](reproduce.ts) and [results](reproduction-results.json), run 2026-10-22. These establish reachable adapter behavior, not incidence on the reporting user's machine.
- **Local telemetry:** a separate retained Deck session, `20261021T141551-27e992`; used to measure compaction, not substituted for the community case.
- Adaptive memory was disabled; findings use source, tests, OpenSpec, and local runtime evidence.

## Findings

### 1. Frame size and model context are different limits

[CodexRpc](../../../packages/adapter-codex/src/session-driver/rpc.ts), lines 34–58, accepts newline-delimited input from Codex's stdout. It enforces **1,048,576 UTF-8 bytes per frame** before parsing JSON or calling the event mapper. Exceeding the limit closes pending RPC calls and raises `codex-rpc-frame-too-large`.

[CodexTask.connect / fail](../../../packages/adapter-codex/src/session-driver/driver.ts), lines 112–147, catches that framing failure, terminates the native process group, and fails the turn. This is a **Deck adapter receive limit**, not evidence that the model's token window was exceeded or that Codex rejected the response. A large retained history or tool output can reach it independently of inference context size.

### 2. The resume-history fix is already present in main

`CodexTask.initialize`, lines 190–201, sends `excludeTurns: true` on `thread/resume`, while retaining the same native thread. It omits history from the protocol response; it does **not** clear the model's conversation context.

The prior investigation recorded a full-history response of 1,050,693 bytes reduced to 4,532 bytes with this option. Current driver tests and the isolated probe confirm that the request is still bounded and continuation succeeds. Before attributing a community failure to this old path, obtain the actual running daemon build, not only the installed CLI version: an existing daemon may still run an older build.

### 3. Full-history steering reconciliation remains vulnerable

`CodexTask.reconcileSteering`, lines 424–428, calls `thread/read` with `includeTurns: true`. [reconcileHistory](../../../packages/adapter-codex/src/session-driver/steering.ts) then filters the returned history for one exact turn and user message. That filtering happens after receipt of the complete frame.

The host calls this path when a same-turn input receipt is uncertain and when reconciling earlier uncertain inputs: [SessionManager](../../../packages/session-host/src/session-manager.ts), lines 1421–1439. The latter can attempt reconciliation for up to 16 records; each matching Codex-thread request asks for history again. This is a concrete repeated-read opportunity, not proof that all 16 requests occur in a typical session.

**Reproduced:** a 1,050,808-byte synthetic history response causes `reconciliation: unknown`, fails the active turn with `codex-rpc-frame-too-large`, and terminates the child once, despite `excludeTurns: true` on resume.

The host enables steering for the Lead. This finding therefore does not by itself explain the screenshot's subagent failures. A correction must preserve exact input correlation and the rule that an uncertain delivery is not permission to resend. Simply dropping historical turns would destroy the evidence this path needs.

### 4. Tool-output truncation happens too late to protect transport

[mapCodexNotification](../../../packages/adapter-codex/src/session-driver/mapper.ts) bounds normalized tool data to 16 KiB, but runs only after the RPC parser accepts the native frame.

**Reproduced:** a synthetic `commandExecution` completion containing large `aggregatedOutput` produces a 1,050,882-byte frame, fails the turn, and never reaches `tool.completed` mapping. This path can affect either Lead or subagent work. It establishes a mechanism, not that the reporting user's browser scripts emitted such a payload.

### 5. Native task context and reasoning settings persist across attempts

`SessionManager.delegate`, lines 631–647, retains the prior task's runner, model, thinking setting, and confirmed native session ID. Each attempt launches a driver and resumes that native thread. `launchTurn` subsequently closes the handle after completion, so same-thread continuity does not mean the native process stays warm across attempts.

The [session delegation instructions](../../../apps/cli/src/session-service.ts), lines 70–79, explicitly require the same owner and task for follow-ups. `CodexTask.send`, around line 402, forwards the retained thinking level as `effort`; the inspected path does not classify each instruction as mechanical or reduce effort automatically. Updating a member's default does not change the recorded assignment used by an existing task's continuation.

The [bounded continuity summary](../../../packages/session-host/src/continuity.ts) limits a host-authored context fragment to at most 4,096 **characters**. It is not a cap on the native thread's token context. In the inspected continuation path, the host does not select a fresh context based on usage counters. Native compaction is observed, but its trigger policy is not established by Deck's code here.

Preserving ownership is valuable. The initial investigation considered a fresh-context checkpoint; the subsequent user direction below supersedes that option as a performance remedy. Retain native context ownership and investigate unnecessary orchestration payload instead.

### 6. Local compaction takes measurable time; token counters need care

In the separate local session, a scan paired **17 completed `contextCompaction` items** by task and item ID. Their durations sum to **1,687.182 seconds**; this is a sum of intervals across tasks, not unique wall-clock delay or a savings estimate, since intervals can overlap.

| Local evidence | Duration | Preceding input / cached-input counters | Reported window |
| --- | --- | --- | --- |
| Lead, seq 87517 → 87519 (P-001) | 122.945 s | 195,557 / 13,184 | 258,400 |
| Subagent, seq 79119 → 79289 | 146.956 s | 195,629 / 191,232 | 258,400 |
| Subagent, seq 37649 → 37983 | 145.247 s | 366,725 / 366,464 | 475,000 |

These counters are the most recent native usage notification before each compaction, not a tokenizer measurement of the entire thread. For P-001, the post-compaction event reports `last.totalTokens = 34,794` with zero input/output counters, further demonstrating that different event shapes must not be conflated.

The screenshot's 245–271k numbers cannot be reliably classified without their field names and timestamps. Distinguish cumulative usage, last-request input, output, cached input, and reported window. Do not add cached-input counts to input counts or interpret cumulative tokens as context occupancy. High cached-input counters also make “all tokens are reread at full cost every attempt” an unsupported conclusion; cache telemetry alone does not establish latency or billing savings.

### 7. Startup errors currently conceal useful distinctions

`startupErrorCode`, [driver.ts](../../../packages/adapter-codex/src/session-driver/driver.ts), lines 43–56, exposes a small internal allowlist and otherwise returns `codex-startup-failed`. `CodexRpc.call` creates `codex-rpc-timeout: <method>` errors, which are outside that allowlist.

**Reproduced:** withholding a synthetic `config/read` reply yields `codex-startup-failed`. Native RPC errors and write failures can also share that label, as the existing driver tests show. Raw stderr is intentionally discarded to avoid persisting credentials or native configuration. Improve diagnostics with safe phase, method, numeric error class, elapsed time, and size metadata rather than restoring raw stderr or payload logging.

### 8. Repeated scripts and duplicate verification need original evidence

The screenshot reports regenerated Playwright scripts and duplicate checks of 8 code, 33 merchant-data, and 57 evidence files. No original commands or artifacts were supplied, so the frequency and cost are not confirmed.

The [current team contract](../../../packages/core/src/teams/developer/adaptive-team-content.ts) already says to rerun only checks invalidated by the delta. The report suggests a possible execution/guidance gap, not a requirement to repeat everything. Compare commands and their inputs, revision, environment, and purpose before removing checks: independent review can serve a distinct risk even when it touches the same files.

## Recommended order of work

1. **Make large-history reads safe:** design bounded exact-message reconciliation, coalesce redundant reads when possible, and ensure an optional historical lookup cannot unnecessarily kill active work. Verify protocol capabilities first; preserve unknown-delivery and no-duplicate-send guarantees.
2. **Expose safe diagnostics:** classify startup failures and record RPC method/phase/size without sensitive contents. Include compaction progress and duration so context maintenance is visible (P-001/P-006).
3. **Bound output at its producer:** reuse browser scripts, persist verbose logs to artifacts, return compact summaries, and examine runner-side output limits. Raising the 1 MiB cap alone postpones growth and does not solve history or repeated-output costs.
4. **Measure native context and effort:** compare equivalent task slices, model/effort, startup and native compaction time, input/cache counters, output size, and repeated checks. Keep conversation-history construction and compaction owned by the runner; audit Deck's additional prompt material before proposing per-attempt effort changes.
5. **Reuse verification evidence:** store a script and a result keyed to the actual revision, inputs, command, and environment. Rerun invalidated checks; keep independently justified review.

## Validation and remaining evidence

- `bun test packages/adapter-codex/src/session-driver --timeout 30000`: **122 passed, 0 failed**, 433 assertions, six files. Existing passing tests do not cover all oversized-history reconciliation cases.
- `bun run openspec/changes/session-context-latency-investigation/reproduce.ts`: four characterization scenarios passed. “Passed” includes deliberately reproducing the current failures; it is not a fix.
- `deck openspec validate --change session-context-latency-investigation --json`: passed with zero errors and warnings using the installed CLI. The source CLI invocation was unavailable because this checkout's dependencies lack `mdast-util-from-markdown`; dependencies were not modified for this investigation. Tests/probes used the available Bun 1.4.0, not the release-pinned 1.3.12; this is investigation evidence, not release qualification.
- Report links and whitespace checked. No production typecheck, release build, installation, or daemon restart was performed.
- A bounded scan of seven retained sessions whose project root is this repository found no diagnostic event with the exact codes `codex-rpc-frame-too-large`, `codex-startup-failed`, or `codex-turn-start-failed`. It did find other framing diagnostics. This does not disprove the community report or cover other projects, deleted sessions, or missing diagnostics.
- Still needed from the reporting machine: affected session/task/attempt IDs, Deck daemon build and Codex version, timestamps, sanitized preparation/diagnostic/usage/compaction events, the field names behind the token estimate, and the browser-check commands with durations and output byte counts. No credentials, raw conversations, or merchant data are needed for initial triage.

Initial source investigation is complete; the community incident remains open for correlation and the candidate fixes remain unimplemented.

## User direction: native context ownership

On 2026-10-22 the user requested clarification and stated that Deck should not manage or repeatedly supply runner conversation context/history, due to concern about unnecessary token and quota consumption. This supersedes treating a Deck-managed context checkpoint as the preferred direction.

Current behavior has three distinct layers:

- Native continuity uses Codex `thread/resume`, Claude `--resume`, and OpenCode's retained session ID. Normal continuation sends the new instruction to that session, not a Deck-assembled copy of the full transcript. The runner owns assembling native conversation input and compaction behavior.
- Codex `thread/read` for delivery reconciliation is a data read into Deck, not a new inference call. The returned transcript is locally inspected for a matching user message, not appended to the next model prompt by that path. Its demonstrated problem is transport size and disruption of the active process; this read alone is not evidence of additional model input tokens.
- Deck does add role instructions, task information, completion notices, and a bounded continuity summary to model-facing input. These additions are separate from native history. It also has explicit recovery/handoff paths that supply retained context when a native session is unavailable or a fresh Lead session is seeded. Those paths must be disclosed and audited rather than claiming Deck never injects historical material.

Follow-up: inventory and measure these additions, identify redundant continuity material during healthy native resume, and evaluate keeping only necessary orchestration instructions and new task/result information. Preserve native runner ownership; do not introduce Deck-side history replay, custom compaction, or fresh-context reseeding as a performance remedy under the current direction. Existing fallback behavior has not been changed by this clarification. Exact quota effects require provider-specific usage evidence; byte counts or repeated role configuration alone do not establish billed-token duplication.

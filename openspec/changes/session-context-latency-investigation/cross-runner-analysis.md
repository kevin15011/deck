# General session latency, including Claude

## Scope correction

On October 22 the user clarified that community latency reports include Claude and are not limited to Codex. The initial screenshot provided a concrete Codex error, which biased the first investigation toward that adapter. Its reproduced failures remain valid, but do not explain general Deck slowness or establish a cause for Claude incidents.

This report supersedes the Codex-first ordering in the earlier briefs. Investigate shared orchestration and runner-specific stages separately, using the same user-visible milestones. Native runner context remains runner-owned; do not introduce Deck transcript replay or custom compaction.

## Evidence shared by both runners

[SessionManager.launchTurn](../../../packages/session-host/src/session-manager.ts) probes the runner, resolves child tools/MCP, prepares credentials and input, starts the driver, waits for completion, closes the handle and releases the resolver. Those operations occur per attempt in the inspected path. The amount of work performed inside a resolver can differ; a call alone does not prove all tool preparation is repeated uncached.

The host already records `turn.preparation` phases (`checking-runner`, `preparing-tools`, `starting-runner`). Its comment explicitly warns that the terminal `turn.started` boundary differs by adapter. In Claude it is emitted from native `system/init`; it is not proof that the model has produced its first answer. These records can locate delay without adding model calls or full-history reads.

The event ledger, delivery/approval orchestration, history indexing, browser transport and rendering are shared. The prior [history measurement](transaction-analysis.md) demonstrates costs in those shared paths, but it is not a Claude-specific browser reproduction. Independent review/repeated-test behavior and oversized orchestration prompts also require runner-neutral scrutiny.

## Existing local preparation telemetry

A read-only scan selected seven retained sessions whose metadata projectRoot is this repository. It found 40,241 Claude-sourced events and 176,354 Codex-sourced events. These counts are events, not attempts. Source records may come from different historical builds and workloads; they are not the community reporting machine.

Reproducible collector: [measure-preparation.py](measure-preparation.py). Aggregate output: [preparation-measurement.json](preparation-measurement.json). No prompts, tool contents, credentials, or native history are printed.

| Runner | Recorded phase | Observations | Median | Maximum |
| --- | --- | ---: | ---: | ---: |
| Claude | checking-runner | 143 | 26 ms | 1,954 ms |
| Claude | preparing-tools | 143 | 2,164 ms | 11,565 ms |
| Claude | starting-runner | 142 | 10,416 ms | 29,454 ms |
| Codex | checking-runner | 257 | 37 ms | 247 ms |
| Codex | preparing-tools | 252 | 3,283 ms | 13,247 ms |
| Codex | starting-runner | 244 | 12,489 ms | 25,117 ms |

These observations justify investigating setup/startup across runners, rather than assuming all waiting is context growth. They do not identify which subprocess, MCP initialization, hook or native operation caused a recorded interval. Do not add the medians to manufacture a median total, compare runners as equivalent workloads, or label these intervals time-to-first-token. Missing phase completions are not imputed; failed/stuck attempts may be underrepresented. Concurrent appends can change later collector counts.

## Claude-specific source findings

### Process lifecycle and native continuity

[ClaudeTask.runTurn](../../../packages/adapter-claude/src/session-driver/driver.ts) starts one `claude -p` process per turn. [buildClaudeTurnLaunch](../../../packages/adapter-claude/src/session-driver/launch.ts) assigns a native session ID initially and uses `--resume` on continuation; it sends the new user instruction through stream-json and adds role instructions with `--append-system-prompt-file`.

Thus native conversation continuity does not imply a permanently warm process. Repeated attempts revisit process initialization and native tool setup. Measure that cost before considering lifecycle changes; persistent processes would require deliberate treatment of cancellation, credentials, isolation and cleanup. The current audit does not establish those changes as necessary or safe.

### Local transcript checks differ from Codex RPC reads

[readClaudeTranscript](../../../packages/adapter-claude/src/session-driver/steering.ts) synchronously reads at most the last 4 MiB of the native JSONL transcript, requires committed lines, rejects more than 4,096 rows, and parses those rows. Its output is inspected for exact delivery evidence, not sent back to the model.

The inspected guarded input path is enabled only with the exact `steeringVersion === '2.1.296'` and without image input; native init version drift disables guarded mode. The host enables user steering only for the Lead. Do not extrapolate this path to every installed Claude version or every subagent.

In that guarded path, original-input verification can reread the tail while evidence is not yet available, subject to `historyReads < 32`. `refreshSteering` shares one read across its pending checks, but can retry after 50 ms (retry < 4 and historyReads < 32). Other direct/event-triggered/final reconciliation calls exist, so 32 is not a proven total-read ceiling. Each repeated read can reparse unchanged bytes. Historical reconciliation also calls the adapter separately for unresolved records.

This is a concrete optimization candidate for supported versions, not measured incident attribution. Reuse unchanged local observations or coalesce compatible checks only while preserving exact UUID/ancestry evidence. A root outside the bounded tail must remain unknown, never authorize a resend. Do not increase the transcript cap or interpret these reads as inference-token usage without evidence.

### Transport and telemetry are not interchangeable

[ClaudeLineSplitter](../../../packages/adapter-claude/src/session-driver/mapper.ts) has its own nominal 8 MiB threshold, implemented against JavaScript string length, and drops oversized lines with an overflow flag. The driver emits `claude-line-too-long` after exit. This is different from Codex's 1 MiB UTF-8 frame failure and does not establish equivalent behavior or a common fix.

Claude result mapping exposes usage/cache counters and `duration_ms`. Those are native result fields, not a verified measure of current context occupancy. The inspected system-message switch has no dedicated compaction branch; unrecognized system subtypes fall through to `runner.unmapped`. Whether the affected native version emits adequate compaction events still requires actual protocol evidence. Do not reuse the prior Codex compaction timing or window numbers for Claude.

## Revised investigation order

1. **Locate user-visible delay across runners.** Distinguish slow typing/loading, queued input, preparation, native initialization, first output, tool/approval waits, native context maintenance and final cleanup. Reuse existing telemetry; add only missing bounded phase/duration counters. Never call the model to measure UI or daemon latency.
2. **Prioritize shared repeated work.** Inspect the measured preparation/startup intervals, child tool lifecycle, synchronous daemon work, event volume and UI transport. Rank by frequency and time actually attributable to Deck; do not assume all native startup time is removable.
3. **Investigate each adapter with appropriate evidence.** Claude: native resume/init, local delivery-check reads when supported, hooks/tools and compaction visibility. Codex: oversized frames, full-history reconciliation and hidden startup error distinctions. OpenCode remains in the overall scope, but this local dataset does not provide an OpenCode comparison.
4. **Validate a minimal fix on both Claude and Codex.** For shared changes, use comparable task slices and state sizes, same machine, documented daemon/runner versions, tools/hooks, model/effort, permissions, warm/cold state and concurrency. Compare message-to-first-visible-output, preparation, tool round-trip and UI responsiveness. Test receipt correctness, cancellation and reconnects. Keep UI paging, durable evidence and native context ownership.

Immediate follow-up is to break down the shared preparation/startup intervals and establish matched Claude/Codex baseline scenarios. No broad redesign, persistent-process migration, cap increase, permission bypass or context rewrite is selected by this report.

## Verification and remaining limits

Graph project `deck`, generation `2026-08-20T17:25:00Z`, returned no relevant Claude adapter symbols and coverage marked the relied-on Claude driver/launch/mapper/steering and shared manager files untracked. Direct source reads supplied the evidence. The aggregate collector completed without malformed lines. This turn made research-only changes; it did not run native inference, restart the daemon, change runtime behavior, or benchmark the community machine. Source mechanisms and historical timing observations are separate evidence tiers, neither proving the reported root cause.

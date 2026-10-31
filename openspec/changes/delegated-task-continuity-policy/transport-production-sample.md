# Transport correction: first production continuity sample

Status: reviewed observational evidence; no runtime change proposed or activated by this analysis.

Source: Deck session 20261022T003008-6f199c. Investigator task-1cf2011b-0318-4587-84f5-47cef713f609 attempt12, result77339/end77340. Lead reran the existing offline metrics projector and native identity extraction; all seven cohort rows matched reported step counts, tokens and duration. No native runner history/database or additional provider experiment was used.

Reproduction scripts and output: /tmp/continuity-transport-analysis/{project.ts,identity.ts,summary.json,lead-projection.json}. The projector is packages/session-host/src/task-continuity-metrics.ts, previously read directly after stale/untracked graph coverage. Investigation attempt12 is excluded. Primary cohort: implementation bac377a6 attempts1–4 (Codex/gpt-6.1-sol) and quality f512eb6f attempts1–3 (Codex/gpt-6-astra).

## Observations

Input is the first observed post-response request input, including cached tokens. Maximum equals final observed input in each row. Steps are supported observations from the projector, not instrumented provider HTTP calls. Tools are distinct recorded calls, not model steps.

| Attempt | First input | Final/max input | Steps | Tools | Native duration | First-input seq |
|---|---:|---:|---:|---:|---:|---:|
| Implementation 1 | 25,078 | 116,391 | 27 | 54 | 356.7 s | 66396 |
| Implementation 2 | 29,106 | 170,704 | 38 | 87 | 891.8 s | 68594 |
| Implementation 3 | 30,002 | 152,760 | 43 | 82 | 696.1 s | 71819 |
| Implementation 4 | 30,177 | 98,466 | 16 | 41 | 294.9 s | 74593 |
| Review 1 | 24,584 | 127,989 | 19 | 43 | 275.7 s | 70168 |
| Review 2 | 30,514 | 120,557 | 24 | 42 | 330.0 s | 73276 |
| Review 3 | 28,041 | 67,648 | 8 | 18 | 68.8 s | 75453 |

Seven distinct native thread identities were recorded. Five continuations followed completed attempts; none followed operator interruption, and none requested native override. The five continuations started with fresh threads and materially smaller input than their predecessors ended with. Initial attempts are not counted as continuations even though the ledger uses reseeded continuity for launch selection.

Implementation continuation handoffs were14,947 /19,229 /19,748 bytes; the latter two carried truncated=true. Review handoffs were4,543 /26,952 /18,131 bytes. Truncation below32KiB may reflect section bounds; cause and impact are not established and must not be labeled a defect without inspection.

First implementation edit occurred after89.4 /101.4 /97.3 /126.5 seconds and7 /9 /7 /6 observed steps. Corresponding observed input prefixes were347,316 /587,422 /415,163 /323,102 tokens. These edit boundaries are not precisely request-aligned. They include useful investigation/test work and cannot isolate handoff reconstruction cost or its penalty relative to native resume.

Across seven attempts:175 observed steps,367 distinct tool calls,17,267,884 accumulated input tokens including16,445,440 cached-read tokens (95.2%),114,489 output tokens. Reported reasoning is41,249; do not add it to output without runner accounting semantics. These cumulative inputs are not context-window sizes, billable-token totals or quota savings. Cache share varies83.9–97.4%; the investigator's92–97% range omitted the last review. Cache-write usage is unavailable.

No compaction diagnostics were observed. Null compaction duration is not proof that native compaction never occurred. The170,704 maximum does not violate the160k resume gate: that gate evaluates continuation eligibility, not a running attempt's context size.

## Elapsed time and rework

Measured interval:2026-10-22T23:14:43Z to2026-10-23T00:10:58Z, about56.2 minutes. This starts with implementation launch and ends with the final review result; it excludes earlier incident diagnosis and later build/restart.

- Implementation native turns:37.3 minutes.
- Review native turns:11.2 minutes.
- Gaps between measured attempts:about7.7 minutes. These are not demonstrated idle time or pure coordination overhead.
- Recorded queue/preparation per attempt:8–13ms /93–293ms. These do not explain the long elapsed time.

Scope classification is reconstructed from reviewed task instructions and findings, not structured reworkSources (the projector reports not-established): original Codex implementation5.9min; expansion to Claude/OpenCode14.9min; two correction rounds16.5min. Follow-up reviews add6.6min, bringing correction plus re-review to approximately23.2min,41% of this measured wall interval. Initial independent review found five real defects; one cleanup defect required a second correction. This supports investigating implementation/review efficiency, not removing review.

Recorded tool interval unions cover12–27% of implementation turns and1–3% of reviews; implementation2 has one unmatched pair. Asynchronous process time may sit outside a short tool invocation. Therefore residual wall time cannot be attributed to model processing, provider waiting, or network alone. Turn duration divided by steps (8.6–23.5s) is an arithmetic average, not measured per-request latency or a causal explanation.

## Conclusion and next decisions

Fresh sessions worked at the continuation boundary; within-attempt input still grew to68k–171k. This sample establishes neither latency improvement nor regression against the earlier UI task, whose reported total-context metrics and scopes differ. It is a Codex sample and does not establish Claude/OpenCode performance. There are no interrupted samples, so no result yet supports prioritizing member steering based on recovery cost.

Keep fresh-session policy. The next analysis should inspect the long within-attempt reads/output and the two correction rounds, plus what the two truncated handoffs omitted. Record structured rework attribution in future work where supported. These are recommendations, not authorization for a new runtime mechanism, automatic interruption, broader telemetry or native resume. Git diff/layout remains paused.

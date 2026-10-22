# P-011: Context visibility

## Intent and authorization

The user authorized proceeding with context-window visibility for the Lead and each subagent. Earlier Web UI restart diagnosis is deferred at the user's request; do not continue that investigation as part of this slice.

## Acceptance

- Evaluate Codex, Claude, and OpenCode using existing native telemetry and locally available protocol evidence.
- Show capacity, used tokens, and percentage only when their meaning and compatibility are supported by evidence. Session totals, billing usage, cached input, and last-request tokens are not automatically current occupancy.
- Distinguish reported, estimated, last-observed/stale, and unavailable information. Missing data must never display as zero.
- Attribute observations to the correct task, attempt, native context, and model. Handle continuation, compaction, completion, model changes, and reconnects without misleading reuse.
- Place compact, accessible information beside Lead status and individual subagent entries, usable on mobile and desktop within existing visual patterns.
- Add no model calls, transcript replay, polling of native history, or custom compaction. Keep storage and UI projection bounded and use existing event flow.

## Current evidence and next step

The earlier investigation established that native usage counters require semantic validation. Parent discovery found Codex `thread/tokenUsage/updated` mapped to `usage`, and Claude result usage mapped to input/output/cache counters. Neither alone proves current occupancy. The graph generation is stale and candidate mapper coverage is untracked; direct source/protocol verification is required.

A bounded investigation will return a runner capability table, exact production data path, uncertainty labels, and the smallest implementable contract/UI proposal. Implementation follows this evidence without requiring another authorization for reversible in-scope work. Lead owns OpenSpec updates; specialists return compact evidence and references.

## Status

Investigator task `task-1cf2011b-0318-4587-84f5-47cef713f609` continued for this bounded investigation. No context meter implemented yet. Existing P001/P012 canary activation is already verified and is separate from this slice.

## Reviewed feasibility and implementation constraints

Investigation attempt 6 identifies Codex `last` counters and nullable `modelContextWindow`, Claude aggregate result counters and per-model capacity, and OpenCode assistant-message counters plus a separate model catalog limit. Lead source checks confirm existing Codex/Claude usage mapping and the absence of usage retention in the inspected CurrentEvents projection. Treat proposed arithmetic and live occupancy claims as provisional: Codex post-compaction totals and OpenCode cache composition need semantic evidence, not merely field types. Claude per-call fields were not established; that is not proof that they do not exist.

Proceed with one vertical implementation owner. Resolve these bounded semantic questions from installed SDK/schema/native implementation or existing sanitized fixtures during implementation. Do not launch inference to discover them. If unresolved, show the last reported counter with its actual basis, capacity alone when attributable, or an explicit unavailable state; do not manufacture an occupancy percentage. A percentage requires a justified compatible numerator/denominator and an estimated/last-observed label rather than a claim of exact current usage.

Use an optional validated normalized context observation while preserving existing usage fields. Retain at most one sanitized observation per task through the existing event/snapshot flow, without raw native bodies. Reject unrelated native threads/turns and stale attempts at producer and projection boundaries. Compaction invalidates freshness until evidence supports a new observation; a late pre-compaction event must not revive freshness. On completion, retaining the final observation as explicitly last-observed is acceptable and useful; clear or invalidate it on incompatible continuation, model/native-context changes, and session end. Live and reconnect behavior must agree.

Unavailable information should be discoverable alongside Lead/subagent status rather than silently represented as zero. Reuse existing typography and layout; no visual redesign. Independent review will verify attribution, arithmetic, bounded retention, and lifecycle behavior after the candidate is functional.

Implementation owner: `apply-deep`, task `task-7774d031-14d9-4c0a-bd3f-1a30b04a6cf6`. Candidate pending; investigate attempt 6 integrated with the qualifications above.

## Candidate review

Implementation attempt 1 is integrated for independent review, not activation. The candidate displays Codex last native total, Claude aggregate input with single-model reported capacity, and OpenCode input from the correlated HTTP response with unavailable capacity. All are explicitly last-reported counters; current occupancy and percentages remain unavailable. Lead inspected contract/projection/UI and adapter/host diffs and the 1,004-pass test log. Browser checks use rendered component fixtures and real CSS at 320/390/1280px, not a live daemon end-to-end scenario. Independent review continues with quality task `task-42242c04-39b4-4a34-a996-c6f54bf9e0c9`. No P011 commit/build/activation yet.

## Independent review: changes requested

Quality attempt 6 found one P2: fresh Codex/OpenCode tasks discover native identity after task creation, but CurrentEvents overwrites the discovery/start records on completion. Replaying its snapshot can then reject the retained usage because the thread fence is not established. Lead checked the source mechanism and accepted the finding. The implementation owner will preserve bounded attribution evidence and add late-discovery completion/reconnect/rebuild regressions without weakening validation.

A related nonblocking efficiency finding is included in the same delta: each card currently rebuilds the entire projection. Share one bounded indexed projection per event set/session instead. The reported 300-task synthetic lookup time is not measured production latency. Prior review found no additional blocker and accepted the truthful last-reported wording. Candidate remains unapproved and inactive until correction and review.

## Correction candidate

Implementation attempt 2 retains at most two sanitized attribution records per task, preserving late-discovered identity across completed snapshots without relaxing validation. A shared memoized event-set/session index replaces per-card full projection. The 300-card structural test reports 900 projection applications rather than 270,000; this is not an end-to-end latency result. Lead inspected the delta and logs: 377 affected tests passed, and component browser checks passed at 320/390/1280px. Quality is re-reviewing the focused delta. No P011 build or activation yet.

## Final verification

Quality attempt 7 approved the candidate with no new blockers. Independent verification passed 39 focused tests across projection/UI/history/Lead progress, TypeScript and whitespace checks. Late-discovered identity, completed snapshot/rebuild, assignment/model/thread changes, compaction/release, and stale index rejection were verified. Prior unaffected adapter findings remain applicable. The 377-test correction suite and component browser evidence remain supporting evidence; counts overlap and must not be summed. P011 is ready for commit and local canary build. Current occupancy/percentage remains unavailable by design; no provider validation or production latency claim.

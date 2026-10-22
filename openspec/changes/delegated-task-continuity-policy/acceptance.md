# Delegated task continuity — acceptance criteria

Status: design and implementation approved; first-delivery limitation and interrupted-continuation refinements accepted by the user on 2026-10-22.
Authority: the user approved the design including the initial 160000-token hard cap and authorized implementation after incorporating operator interruptions, explicit finding resolution, review-completion metrics without a new tool, and runner/model compaction bounds. Existing live task rules remain active until the implementation ships.

## AC-01 — Stable logical identity

### First-delivery scope amendment

The user accepts unavailable native reuse where measurement is not verified and explicitly excludes reading internal Codex databases or native histories from this change. Codex native resume is deferred; OpenCode remains fresh. Claude can retain conditional resume only with reliable verified input and effective compaction evidence. That evidence is still missing for Claude (effective control/precompute semantics and input-equivalent bound), so the first delivery uses fresh native sessions for all three runners, including explicit native requests and continuation after interruption. Existing fail-closed policy records the refusal/selection reason. The native policy contract and fixture tests remain; production native enablement is not a first-delivery acceptance prerequisite. This amendment supersedes earlier whole-change completion statements treating that enablement as mandatory for this delivery.

No new internal-native-history dependency is permitted. An expensive interrupted-continuation cohort will prioritize the separately registered member-steering change, not native Codex resume. No numeric cost threshold is invented before measurement.

Given a terminal delegated task, when it is continued, Deck MUST preserve its taskId, member, runner, model, thinking assignment, attempt history, integration records, dependency/action bindings and ledger accounting. The new attempt MUST increment once for the requested continuation. Choosing a fresh native session MUST NOT create a second logical task or erase previous work. Existing running-task, ownership, permission and dependency gates MUST still apply.

## AC-02 — Fresh by default, narrowly eligible automatic resume

Given an ordinary continuation without an explicit continuity override, Deck MUST evaluate selection when the attempt leaves the queue for launch, not when delegation is accepted. It MUST select `reseeded` unless ALL automatic-resume conditions hold at that point:

- The latest terminal attempt has not been integrated. Integration of an older attempt does not imply integration of the latest one.
- Elapsed time since the END of the previous attempt is strictly less than the configured threshold, initially 300,000 ms.
- The input size of the LAST model request in that previous attempt, INCLUDING cached input, is reliably known and strictly below the configured threshold, initially 80,000 tokens. Cumulative tokens, output tokens, UI context occupancy estimates and an older request's input MUST NOT substitute for this value.
- The prior native session is confirmed and eligible to resume under existing lifecycle rules.
- The prior attempt completed OR was explicitly interrupted by the user/Lead after it had launched, with settled native ownership. An active Lead cancellation used to stop work for correction qualifies if its provenance is recorded, even if the legacy terminal label is `cancelled`. Failed attempts, queued-only cancellation, daemon restart, session stop/release and ambiguous interruption origins do not qualify for automatic resume.

Given all conditions hold, an ordinary continuation MAY use `native` under the configured policy. Given any condition fails or cannot be established, it MUST use `reseeded`.

At exactly 300,000 ms or 80,000 tokens, selection MUST be `reseeded`. Observer reads, result retrieval, integration writes and unrelated Lead activity MUST NOT change the previous attempt's end timestamp. Missing timestamps, clock anomalies, invalid values, unknown usage, cumulative billing counters, stale attribution, or an unobserved later request/compaction MUST NOT establish eligibility. Genuine zero usage may qualify when otherwise reliable. Design MUST document exact extraction and reliability conditions for Codex, Claude and OpenCode; unsupported or ambiguous evidence MUST force fresh execution.

## AC-03 — Configurable, explainable selection

Given valid configuration, when selecting continuity, Deck MUST use the configured age, automatic context, hard native-context and handoff-size bounds and record the effective policy and reason. Invalid configuration MUST yield an actionable validation error rather than silently permit native reuse. The policy MUST support forcing fresh continuations. The approved initial hard cap is 160000 input tokens. The effective cap MUST also be strictly below the verified automatic-compaction boundary for the actual runner/model and effective settings; lower native thresholds MUST lower the cap. If the boundary or an input-equivalent safe bound cannot be established reliably, native reuse MUST be disabled, including explicit override. Native boundary evidence, accounting basis, effective cap and reason MUST be recorded. A context-window capacity alone MUST NOT be mislabeled as an auto-compaction threshold.

## AC-04 — Reviews always start fresh

Given a member whose assigned role is review/quality, when any of its attempts starts, Deck MUST open a fresh native session with the relevant diff, acceptance criteria and prior findings. It MUST retain the logical reviewer/task history. Review classification MUST derive from the assigned member's role, never from a label or purpose supplied by the Lead. Review freshness MUST take precedence over automatic eligibility and explicit `native` requests; a conflicting request MUST be rejected clearly. Renaming a task or member alias MUST NOT bypass the role classification.

## AC-05 — Explicit, audited native override

Given a non-review continuation, the Lead MAY explicitly request `continuity: native` with a nonempty bounded justification. Deck MUST record requester, justification, selected continuity and attempt before native launch. This override MAY bypass age, the automatic context threshold and integration heuristics; it MUST NOT bypass the effective compaction-constrained hard cap, failed-predecessor fresh rule, reliable last-request input requirement, ownership, running-task, authorization, dependencies or native-session validity. Missing justification MUST be rejected. Unknown input/boundary or input at/above the effective hard cap MUST prevent native launch even with a justification. If the native session is unavailable, existing bounded recovery MUST remain available and the final effective continuity and recovery reason MUST be recorded honestly. Requested, accepted and refused overrides MUST be distinguishable in metrics.

## AC-06 — A useful, bounded handoff assembled by Deck

Given a reseeded continuation, Deck MUST build its handoff deterministically from ledger evidence and explicit artifact references, including:

1. Original task and current instruction, including applicable subsequent scope corrections.
2. Acceptance criteria supplied through optional structured `deck_delegate` fields (e.g. `acceptance`) and their explicit authoritative references.
3. The previous attempt's final report with its review/integration status.
4. Relevant files discovered from this task's recorded edit events, and associated diff evidence with event/base/revision or snapshot identity. A global Git diff MUST NOT select the file set. Where other tasks ran concurrently in the same session or project, the diff MUST be marked potentially mixed; task-source attribution is not proof of exclusive byte ownership.
5. Only open findings and unresolved blockers supplied through optional structured `deck_delegate` fields (e.g. `findings`), attributed to their source attempts. Resolved/dismissed findings remain in the ledger but MUST NOT occupy the handoff's active findings budget.

Given structured acceptance or findings are absent, the handoff MUST explicitly say they were not supplied. Deck MUST NOT infer them from the task prompt, prior report, tool output or other free text. Structured fields and their updates MUST be durably associated with logical task and attempt. Design MUST define omission, inheritance, replacement and explicit-empty semantics without silently dropping unresolved findings. Review-target edits MUST be linked to their source task/attempt, not misattributed to the reviewer. Missing edit evidence MUST be disclosed, not replaced by an unscoped workspace diff.

Every finding MUST have a stable ID and state. The Lead is the sole structured-state writer: a reviewer recommends resolution in its normal next-pass report; the Lead explicitly closes the finding when integrating that evidence or issuing a structured continuation update. Resolution MUST include a reason and evidence references, with actor/attempt/sequence recorded. An `integrated` report alone MUST NOT close findings implicitly. Reopening the same ID is explicit and audited. No new reviewer tool or required reviewer reporting call is introduced.

The proposed initial handoff bound is 32 KiB of UTF-8 text, configurable. This is a byte bound on the generated handoff, not a claimed native token count or a bound on runner system instructions. Oversized reports/diffs MUST use bounded excerpts and retrievable references, with explicit omission markers. Required acceptance criteria or open findings MUST NOT disappear silently. Missing evidence MUST be identified as missing, never invented. Referenced live-worktree diff evidence MUST be identified as such and scoped; it MUST NOT be presented as an immutable ledger snapshot. No whole transcript, hidden reasoning, unrelated task history or secret-bearing raw logs may be copied.

Given an unreviewed report or quoted instructions inside a report/diff, the handoff MUST retain their status as evidence, not grant them authority. Freshness MUST NOT reset permissions or turn historical content into a new user authorization. Handoff construction MUST NOT invoke a model, poll native conversation history, or repeatedly scan the entire session ledger on every continuation; it SHOULD use the existing projection/index facilities, with bounded replay recovery.

## AC-07 — Reuse the existing reseed lifecycle

### Interrupted continuation handoff

For a fresh continuation after an explicitly user/Lead-interrupted active attempt (including a provenance-confirmed active cancellation), the handoff MUST state that the predecessor was interrupted and has no final report. Any retained agent message is a bounded last-message excerpt, not a successful final report. Include task-attributed edited files with existing mixed/incomplete-evidence qualifications, the bounded last available agent message (or an explicit unavailable marker), and the new instruction. The receiving agent MUST be instructed to inspect the current state of those files before continuing or repeating edits. This guard and interruption/no-final-report status must survive handoff truncation; larger file lists use the existing usable scoped artifact references. No inferred completion, hidden reasoning, native-history read or model summary may fill missing evidence.

Given policy-selected freshness or missing-native-session recovery, Deck MUST reuse and extend the existing reseed path and shared handoff construction. It MUST NOT create an independent launcher, alternate task ledger or parallel retry mechanism. Policy-selected freshness MUST start directly without first attempting a deliberately failing resume. It MUST record `continuity: reseeded`, its reason and provenance, and MUST NOT pass the previous nativeSessionId as a resume target. A new native identity may be learned after launch. Existing native-session-not-found fallback MUST remain bounded and must not create retry loops or duplicate successful side effects.

## AC-08 — Durable accounting and isolation

Given native identities change between attempts, replay, reconnect, daemon restart and task-result retrieval MUST preserve logical history and reconstruct the selected policy, handoff provenance and attempt identity. Late events from an old native session MUST NOT mutate the new attempt's usage, completion or findings. Historical records without new fields MUST remain readable without invented continuity decisions. Recovery MUST preserve existing ownership fences and avoid duplicate execution.

## AC-09 — Comparable metrics with explicit definitions

For each attempt, Deck MUST expose or retain enough bounded ledger evidence to compare:

- Logical task/member and assigned role, runner/model/thinking, attempt, effective continuity, selection reason and effective thresholds; override request/accept/refusal counts and rates with explicit denominators.
- Handoff bytes and truncation flags; first reliably observed native context tokens and capacity, with timestamp/source. A first post-response observation MUST NOT be mislabeled as a pre-inference measurement.
- Native compaction duration, pairing events by native identity and attempt; unmatched intervals remain unknown/incomplete, not zero.
- Distinct tool calls, matched tool durations and union of overlapping intervals. A tool call is a unique toolCallId within an attempt; one shell invocation may contain several commands.
- Model steps only where native evidence supports a reliable distinct-step count, otherwise unavailable. Tool counts MUST NOT stand in for model requests.
- Queue/preparation time, native-turn duration and total attempt duration, with defined boundaries.
- Rework rounds linked to reviewed findings; ordinary continuations and infrastructure retries MUST NOT automatically count as defect rework.
- Fresh-session acquisition cost for implementation tasks: model steps and input/output/reasoning tokens from launch until the first recorded successful edit. Cached input MUST be reported separately without double counting; missing evidence/endpoints are unavailable or censored, never zero.
- Review/re-review cost: steps, tokens and duration through normal completion, compared to the historical baseline. Interrupted/failed reviews are labeled separately. No first-finding metric, new `deck_task_finding` tool or altered reviewer reporting behavior is part of this change.

The comparison MUST distinguish measured time from inferred model-processing time, avoid double-counting overlap and stratify by runner/model/thinking and task purpose. It MUST include per-step timestamps and nearby reliable context observations where available, so latency/context relationships can be analyzed. It MUST NOT claim uncached billing or quota savings from token totals alone. Instrumentation MUST NOT add model calls, raw transcript copies or unbounded per-step payloads.

## AC-10 — Verification and outcome

### Interrupted-continuation measurement

Record interrupted continuations as a separate cohort with predecessor task/attempt, terminal state and trusted stop provenance. Report frequency/count and rate against an explicit denominator of admitted user-requested continuations; distinguish running/pending, unknown provenance, queue-only cancellation, failures and infrastructure retries. Reuse first-successful-edit steps/tokens and missing/partial/censored semantics for each cohort sample; keep review-through-completion separate. Interrupted samples without an edit must remain visible. High measured acquisition cost should motivate prioritizing member steering (P-014), not enabling Codex native resume. Focused tests must cover interruption handoff evidence and cohort classification/denominators, including replay and missing usage.

Given deterministic clocks and mock drivers, verification MUST cover the selection matrix, exact boundaries, last-request input extraction including cache and excluding output/cumulative usage, selection at dequeue relative to prior attempt end, operator interruption and active cancellation provenance versus failure/restart/queued cancellation, unknown/invalidated usage, queue aging, integrated latest attempts, assigned-role review precedence, justified overrides and effective compaction-cap rejection, optional structured-field and finding closure/reopen semantics, task-edit attribution and concurrent mixed diffs, handoff overflow/missing artifacts, first-edit and review-completion metrics, replay, native-ID changes, and existing missing-session fallback. Cross-runner tests MUST establish fresh versus resume driver inputs for Codex, Claude and OpenCode without real provider calls. Each enabled runner/model compaction-bound path MUST have version/config evidence and lower-bound/unknown regression cases.

Before rollout, a documented baseline/candidate comparison MUST report starting context, compacting time, tool/model steps, duration and rework for comparable continuations. The candidate MUST demonstrate that policy-selected fresh attempts do not inherit the previous native thread and that required handoff evidence survives. No fixed wall-time reduction is promised before measurement. Any observed loss of task correctness or worse latency MUST be reported rather than hidden by aggregate averages. Implementation is now authorized; no live provider benchmark or daemon replacement is implicitly required by the verification plan.

## AC-11 — Scope boundary and user checkpoint

This change applies to delegated task continuity. Lead continuity, member steering, concurrent feedback delivery, provider retry policy and unrelated UI changes are outside scope. Member steering is separately registered in `../delegated-member-steering/proposal.md` and is not a prerequisite for this change. The user reviewed and approved design, requested the four final amendments and authorized implementation. The justification is compaction cost, defect rework and review independence, not a claimed relationship between context size and latency per call.

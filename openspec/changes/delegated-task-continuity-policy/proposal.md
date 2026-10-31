# Separate logical task ownership from native context reuse

## Status and acceptance first

Proposed on 2026-10-22 at the user's explicit request. The user approved the [acceptance criteria](acceptance.md), then approved the [design](design.md) including the initial 160000-token ceiling and authorized implementation with four final amendments. Those amendments are incorporated. Acceptance and design checkpoints are complete; implementation is in progress.

## Problem

Continuing a delegated task currently retains its owner and also normally resumes its native session. These are separate concerns. During the latest MCP/context UX work, three implementation attempts and two reviews formed a serial chain with large native contexts and two compacting intervals totaling 267.640 seconds. The entire request-to-installed-canary flow took 72 minutes 3 seconds. A long-lived reviewer also paid compaction cost on a small re-review.

The observed output volume is consistent with model generation dominating the residual time between tools. It does not isolate network, queueing or context-prefill time. [Evidence and the missing step counts](evidence.md) preserve this distinction. The agreed justification is measured compaction cost, defect rework and independent reviews, not a claim that latency per call increases with context.

## Requested policy

- Preserve logical task identity, owner, assignment, attempts and ledger accounting.
- Default to a fresh native session with a bounded, host-built handoff and `continuity: reseeded`.
- Evaluate automatic native reuse at dequeue/launch against the latest unintegrated completed or explicit user/Lead-interrupted attempt: less than five minutes since that attempt ended, and reliable LAST-request INPUT below 80,000 tokens, including cached input. Failed attempts are fresh. Other origin/ownership requirements are in the design. Thresholds are configurable; cumulative and output tokens are excluded.
- Always start reviews and re-reviews fresh, classified by assigned member role, never a Lead-provided task label.
- Permit a justified, ledger-recorded explicit native override for non-review tasks, without bypassing reliable-input evidence, the failed-attempt rule, an effective hard cap or safety gates. The approved ceiling is 160000; it is lowered below verified runner/model auto-compaction boundaries. Unknown boundaries force fresh.
- Add optional structured acceptance/findings fields to delegation. Lead explicitly closes findings with evidence, based on the reviewer's normal report or verified correction; integration alone does not close them. Only open findings enter the handoff. Missing fields remain explicit; no inference from prose. Handoff files come only from task-attributed edit events; concurrent tasks make associated diffs potentially mixed.
- Extend the existing reseed mechanism instead of introducing another execution path.
- Measure initial context, compaction, tool/model steps, total duration, defect-rework rounds and override rates. Measure first-edit acquisition cost for work tasks, and steps/tokens/duration through completion for reviews. No new reviewer tool or first-finding measurement.

The latest-attempt interpretation of integration and precedence of always-fresh reviews over explicit native override remain explicit in AC-02/04/05. The handoff intentionally replaces implicit transcript continuity; it is a bounded evidence package, not a model-generated summary or full-history replay. Its initial bound remains 32 KiB; native token measurements are separate.

## Scope and sequencing

Only delegated task continuity is covered. [Member steering](../delegated-member-steering/proposal.md) is registered separately and must not be bundled here. Existing Lead continuity, ownership safety, dependencies, permissions and provider recovery semantics remain protected.

1. Completed: present acceptance criteria/baseline and incorporate the user's approved amendments.
2. Completed: source-backed design for reseed reuse, launch-time policy, bounded structured ledger evidence and measurement.
3. Completed: user reviewed the design, approved the initial 160000 ceiling with four amendments and authorized implementation.
4. In progress: one vertical implementation owner, parallel read-only compaction-bound verification, then focused checks and independent lifecycle/contract review.

## Implementation risks and evidence gates

Fresh context can lose decisions or open findings if the handoff is incomplete. Large role/tool instructions can still make a fresh session expensive. Unknown native usage/compaction thresholds must not accidentally qualify for reuse. Reviews require host-derived member-role classification. Some structured criteria/findings and task edit evidence may be absent; they cannot be invented. Native lifecycle/replay changes must not duplicate work or accept late events from old identities. Review measurement must preserve existing reviewer behavior.

## Rollout and rollback requirements

Design must include a reversible policy rollout and safe fallback for future attempts. It must not rewrite old records, discard work, resume obsolete native identities implicitly, weaken the hard cap/review freshness invariants, or roll back the additive accounting. No canary build, restart or rollout is part of this design delivery.

## Related official context

- [Prior UX/context change](../session-context-latency-investigation/context-window-brief.md)
- [Pending issue register](../../pending-issues.md), P-008 and P-013
- [Acceptance criteria](acceptance.md), including normative Given/When/Then scenarios

# Current Lead-owned boundary review — 2026-10-04

**Outcome: no known blocking findings in the verified repository candidate.** The user required Lead-only implementation and no subagent review. This is not a new independent Quality approval; the independent findings below are historical.

Reviewed: exact-session/file/attempt ownership; storage validation and private child paths; admission versus integration; stale/duplicate wake removal; busy response/tool-loop scheduling; bounded retry/reminder behavior; UI/storage failure isolation; cancellation/settlement before recovery; IPC nonce/PID proof; credential scrubbing and exact-parent ephemeral memory; generated/TUI distribution; scope exclusion of core and other runners.

Review-driven fixes included an old-attempt callback mutating a resumed task, duplicate synthesis when a queued wake followed a tool loop that had already integrated its result, and advisory context disappearing on native custom-message continuation. Each has a regression. Native PTY probes cover actual InteractiveMode in both modes; source/code safety is not inferred solely from visual tests. Full current evidence: verification.md (1,141 passing tests plus TypeScript/diff checks).

Known limits remain explicit: model judgment is not guaranteed, persistence failure cannot guarantee durability until a write succeeds, bounded retries can leave visible work pending, and unsupported/orphan/daemonized or external effects are not made safe by a status flag. No personal install or release approval is implied.

---
# Historical focused independent review — initial candidate
## Initial verdict
Changes required on the initial candidate. Initial focused tests: 55 passed, 0 failed; root TypeScript passed. These checks did not cover the lifecycle findings below.
## Findings returned to the same implementation owner
1. P1: detached children can outlive abrupt parent death with no exclusive execution lease; explicit resume can duplicate a live child against the same history.
2. P1: successful child exit can leave same-group descendants with redirected stdio outside subsequent lifecycle cleanup.
3. P1: tree navigation uses branch snapshots while startup uses all entries; historical state may revive completed work or hide execution records although effects did not rewind.
4. P2: before-navigation cleanup clears context, but cancelled/vetoed/failed navigation may never emit reopening hooks; unchanged session loses delegation/controls.
5. P2: resuming a never-started interrupted chain successor omits predecessor substitution.
6. P2: JSON-quoted and common environment credential keys evade current text redaction.
## Product refinements
Show meaningful observed activity stages; avoid dropping the latest important report inside notification throttling; advertise restore toggle in compact status. Preserve facts versus reported milestones.
## Evidence limits
Native renderer scroll/focus tests are not full InteractiveMode/PTY evidence. No personal installation/configuration changes or installation runs. Quality reviewed source read-only; test execution evidence belongs to Lead.

## Final independent delta review
GO for repaired protected boundaries. No blocking residual findings in current source/tests. Supported child Bash shares the delegated process group; timeout/abort escalates whole-job cleanup. Dedicated nonce/PID acknowledgement proves override installation before clearing uncertain ownership. Unknown runtimes remain fenced and recovery never signals stored PIDs. Activation guard, package layout and materialization deliver child containment without replacing Lead tools. Native delayed-navigation test verifies refusal while navigation is pending, then explicit recovery after cancellation.

Prior permanent write-role recovery refusal was not accepted as the final outcome and was superseded by child-scoped supported native operations. Normal supported failed/interrupted apply jobs can continue the same history once ownership is settled. Deliberate daemon escape and remote effects are outside the guarantee. Native shell tests cover Linux Bash; native renderer tests cover scroll/focus but not full human/PTY interaction. See verification.md for final Lead-run evidence.

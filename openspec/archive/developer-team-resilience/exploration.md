# Exploration: Developer Team Resilience

## Current State

Multi-agent SDD pipelines routinely degrade under scale. A recent representative session (evidence from a TypeScript/React CLI project) took **4+ hours**, produced **18 verify reports** and **18 review reports**, encountered **8 `changes_requested` cycles**, and suffered **1 hard verify failure**. Root causes clustered in four areas:

1. **Late-discovered invariants**: Security, integration, and boundary constraints were not surfaced until Review or Verify phases, forcing expensive back-propagation into already-completed Apply work.
2. **Oversized task granularity**: Tasks bundled too many concerns, making partial failure inevitable and forcing all-or-nothing rework.
3. **Late boundary tests**: Cross-module contracts were not exercised until after frontend and backend implementations were claimed complete, causing cascading fix loops.
4. **No replanning on loop detection**: The orchestrator continued launching Apply→Verify→Review cycles without recalibrating scope, budget, or task boundaries after repeated failures.

Additional runner/platform issues amplified the damage:
- **Transport false negatives**: WebSocket transport errors marked artifact-producing successful agents as failed, causing redundant relaunches and stale-state edits.
- **Mutable artifact edits**: Apply agents performed exact-text replacements against mutable `apply-progress` artifacts; when a prior fix had already mutated the file, subsequent edits failed on stale anchors, requiring manual repair.
- **Runaway context growth**: Long Apply runs reached **120k+ tokens**, **40+ turns**, and **46 tool calls**, degrading output quality and increasing failure rates.

The user explicitly requests a **general, project-agnostic resilience layer** that can be adopted by any project using multi-agent SDD, not a Deck-only patch.

---

## Affected Areas

- **Orchestrator decision layer** — triage, phase routing, execution mode, and loop detection need risk-aware adaptation.
- **Spec/Design/Tasks authoring** — need embedded self-audit gates and risk scoring before Apply is authorized.
- **Agent runner / transport layer** — needs recovery from transient failures and idempotent artifact reconciliation.
- **Artifact state management** — needs deterministic mutation strategies instead of exact-text patches on mutable files.
- **Budget and watchdog subsystem** — needs token, turn, and tool-call limits with escalation, not silent exhaustion.

---

## Approaches

### Approach A: Heavyweight Quality Gating (Always-On Extra Agents)

Add dedicated pre-Apply quality agents (security auditor, integration checker, boundary validator) that run before every Apply phase.

- **Pros**: Catches invariants early; high confidence.
- **Cons**: Multiplies agent count and cost; adds latency to every change regardless of risk; does not address runner/transport or loop issues.
- **Effort**: High

### Approach B: Adaptive / Proportional Quality (Recommended)

Embed lightweight self-audit checkpoints inside Spec, Design, and Tasks artifacts. Compute a risk score from those checkpoints. Invoke extra quality agents (review, security, integration) **only when risk exceeds threshold**. Add a loop breaker, runner resilience, artifact state manager, and budget watchdog.

- **Pros**: Quality spend is proportional to risk; protects fast low-risk changes; directly addresses root causes (late invariants, oversized tasks, runaway context, transport errors).
- **Cons**: Requires orchestrator to implement scoring and conditional routing; slightly more complex than uniform gating.
- **Effort**: Medium

### Approach C: Minimal Loop Limiter Only

Add only a hard loop counter (e.g., max 3 verify/review cycles) and stop.

- **Pros**: Simple to implement; prevents infinite loops.
- **Cons**: Does not prevent loops from starting; ignores transport, artifact state, and task-sizing root causes; likely produces incomplete changes.
- **Effort**: Low

---

## Recommendation

**Adopt Approach B: Adaptive / Proportional Quality with Resilience Subsystems.**

This aligns with the user's stated preference and provides the highest leverage. The implementation breaks into five general subsystems usable by any SDD orchestrator:

### 1. Embedded Self-Audit in Spec / Design / Tasks

- **Spec**: Add an `Invariants & Boundaries` section that MUST list security, integration, and cross-module contracts before scenarios are accepted complete.
- **Design**: Add a `Risk Surface` section scoring each architectural decision as `Low / Medium / High` on dimensions: state mutation, cross-service boundary, secret handling, backward compatibility.
- **Tasks**: Add a `Task Readiness Checklist` per task: (a) contract is defined, (b) boundary tests are identified, (c) rollback step is known. If any item is missing, the task is classified `blocked` or `allowed-with-placeholder`, and Apply cannot proceed without explicit override.

### 2. Lightweight Risk Scoring

Derive a composite `change_risk_score` (0–100) from:
- Design risk surface maximum (0–40)
- Number of blocked / placeholder tasks × 10 (0–30)
- Number of cross-module contracts mentioned (0–20)
- Presence of secret-handling or auth changes (0–10)

**Routing rules** (configurable per project):
- `risk_score < 30`: Standard Verify + Review in parallel; no extra gates.
- `30 ≤ risk_score < 60`: Add a **Pre-Apply Boundary Review** (focused cross-module contract check) before Apply.
- `risk_score ≥ 60`: Add **Pre-Apply Boundary Review** + **Security/Integration Invariant Check** before Apply; force Interactive mode even if Automatic was requested.

### 3. Loop Breaker

After each Verify + Review cycle:
- If `changes_requested` count for the same task group exceeds **2**, the orchestrator MUST:
  1. Recompute risk score.
  2. If score rose, require a **Task Repair** phase (re-scope or split tasks) before next Apply.
  3. If score unchanged after repair, escalate to user with a `loop_detected` summary: affected tasks, failure patterns, recommended scope reduction.
- Hard ceiling: **4** total Verify + Review cycles per task group. After 4, force Archive with `status: incomplete` and surface to user.

### 4. Runner Resilience & Transport Recovery

- **Idempotent artifact reconciliation**: Runner MUST compare agent-produced artifact hash against expected hash before marking success. If transport disconnected after artifact write but before ACK, reconcile by re-reading the artifact and confirming structural validity (required sections exist, no truncation).
- **Artifact state manager**: Mutable artifacts (e.g., `apply-progress`) MUST be mutated via append-only or structured-overlay strategies, never exact-text replacement. Options:
  - Append-only log: each Apply writes a new numbered entry; orchestrator replays to produce current state.
  - Structured overlay (YAML/JSON): Apply emits a patch object; orchestrator applies it deterministically with merge semantics.
- **Transport recovery**: On WebSocket / transport failure, runner retries with exponential backoff (max 3 attempts). If agent completed but ACK was lost, reconciliation (above) prevents relaunch.

### 5. Budgets & Watchdogs

Per-phase budgets enforced by the runner, not the agent:
- **Token budget**: 80k input tokens soft limit, 120k hard limit.
- **Turn budget**: 30 turns soft limit, 40 hard limit.
- **Tool-call budget**: 25 soft, 35 hard.

**Watchdog behavior**:
- Soft limit reached: agent receives a compaction / summarization prompt and MUST return a checkpoint within 3 turns.
- Hard limit reached: runner forcibly terminates the agent, marks phase as `partial`, and surfaces a `budget_exceeded` event to the orchestrator. Orchestrator decides: split tasks, reduce scope, or escalate to user.

---

## Risks

1. **Risk scoring calibration**: A poorly tuned score can either over-gate (slowing simple changes) or under-gate (letting risky changes through). Mitigation: make scoring formula and thresholds project-configurable in `openspec/config.yaml` (or equivalent), and seed with conservative defaults.
2. **Loop breaker too aggressive**: Forcing Archive after 4 cycles may abort salvageable work. Mitigation: allow user override with explicit `force_continue` intent; log override for retrospective review.
3. **Artifact state manager complexity**: Append-only or overlay strategies require orchestrator changes. Mitigation: provide a reference implementation as a reusable library/function, not as framework lock-in.
4. **Runner resilience depends on platform hooks**: Not all agent runners expose transport-state or artifact-hash hooks. Mitigation: define the interface abstractly; projects implement the concrete watcher for their platform (e.g., Pi runner, Claude Code, OpenCode).

---

## Ready for Proposal

**Yes.**

The orchestrator should launch `sdd-propose` next. The Proposal should define:
- General intent and scope of the resilience layer.
- Which subsystems are in-scope for the first delivery (recommend: risk scoring + loop breaker + artifact state manager).
- Which subsystems are deferred (transport recovery may need platform-specific implementation).
- Affected generic interfaces: orchestrator triage, Spec/Design/Tasks templates, runner budget API, artifact store overlay API.

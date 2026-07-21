# Tasks: Deterministic Apply → Verify → Review Flow

## Change identity

- **Change ID:** `deterministic-apply-verify-review-flow`
- **Execution mode:** Automatic
- **Spec SHA-256:** `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` (authoritative)
- **Design SHA-256:** `9850e208e6f364232c4418481e6cc99eb063a68a1afdf77db52ae703ca2e9bc1` (revised; resolves REVIEW-G2-G6-PI-B1-CALLER-SUPPLIED-AUTHORITY)
- **Design replan SHA-256:** `7d389a846ca00c71c356ada41d78af4ffd0f140aa2acba431d1871611cb8306a`
- **Recovery batch identity (G1):** `deterministic-apply-verify-review-flow-recovery-batch-g1`
- **Recovery batch ceiling (G1):** exactly 8 files (4 source + 4 test) per `tasks-replan-g1.md`
- **Runner-authority batch identity:** `deterministic-apply-verify-review-flow-runner-authority-g2-g6`
- **Runner-authority batch ceiling:** exactly 8 files (4 source + 4 test + 2 generated) per `tasks-replan-runner-authority.md`
- **Effect-authority batch identity:** `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority` (**NOT YET APPROVED** — requires named human approval)
- **G2 Apply:** BLOCKED — explicit prohibition; no `G2_apply` route authorized in any task
- **repair-3:** PROHIBITED — exhausted G1 two-attempt budget not reopened, reset, or converted to authorize-anyway path
- **Human approval required:** a new explicit human-approved batch identity is mandatory before any modifying attempt
- **Runner-authority G2-G6 repair-1 batch identity:** `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-1` (**NOT YET APPROVED** — requires user authorization message with exact batch identity string)
- **Runner-authority G2-G6 repair-1 batch ceiling:** exactly 1 file per `tasks-replan-runner-authority-repair-1.md`
- **Runner-authority G2-G6 repair-2 batch identity:** `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-2` (**NOT YET APPROVED** — requires user authorization message with exact batch identity string)
- **Runner-authority G2-G6 repair-2 batch ceiling:** exactly 1 file per `tasks-replan-runner-authority-repair-2.md`
- **Runner-authority G2-G6 prompt-profile-oracle-completion batch identity:** `deterministic-apply-verify-review-flow-runner-authority-prompt-profile-oracle-completion` (**NOT YET APPROVED** — requires user authorization message with exact batch identity string; NOT repair-3 — G1 repair-3 remains PROHIBITED)
- **Runner-authority G2-G6 prompt-profile-oracle-completion batch ceiling:** exactly 1 file per `tasks-replan-runner-authority-oracle-completion.md`
- **Provider-capture repair batch identity:** `deterministic-apply-verify-review-flow-runner-authority-provider-capture-repair` (**NOT YET APPROVED** — requires user authorization message with exact batch identity string; addresses REVIEW-RA-FINAL-B1, REVIEW-RA-FINAL-B2, REVIEW-RA-FINAL-B3)
- **Provider-capture repair batch ceiling:** exactly 6 files per `tasks-replan-runner-authority-provider-capture-repair.md`

## Task group overview

| Group | Label | Tasks | Notes |
|-------|-------|-------|-------|
| G-REC | Recovery batch (authority floors) | T-REC-01, T-REC-02, T-REC-03, T-REC-04 | Bounded to 8 files; G2/repair-3 prohibited; human batch approval required |
| G-EA | Effect-authority recovery (Review blockers B1-B3) | T-EA-01, T-EA-02, T-EA-03 | Proposed bounded 8-file ceiling; NOT APPROVED; requires named human approval; defined in `tasks-replan-effect-authority.md` |
| G-RA | Runner-authority boundary (Review blocker G2-G6-PI-B1) | T-RA-01, T-RA-02, T-RA-03, T-RA-04, T-RA-05, T-RA-06, T-RA-07, T-RA-08 | Exact 8-file ceiling; addresses `REVIEW-G2-G6-PI-B1-CALLER-SUPPLIED-AUTHORITY` |
| G-RA-REP-1 | Runner-authority G2-G6 repair-1 (oracle + byte drift) | T-RA-REP-01 | Exact 1-file ceiling; addresses `VERIFY-G2-G6-TARGETED-GEN-OPEN-SPEC-PATH` and `VERIFY-G2-G6-AFFECTED-CORE-PROMPT-PROFILE-BYTE-DRIFT`; defined in `tasks-replan-runner-authority-repair-1.md` |
| G-RA-REP-2 | Runner-authority G2-G6 repair-2 (lexical tokens drift) | T-RA-REP-02 | Exact 1-file ceiling; addresses `APPLY-G2-G6-REP1-LEXICAL-TOKENS-ORACLE-DRIFT`; defined in `tasks-replan-runner-authority-repair-2.md` |
| G-RA-REP-3 | Runner-authority G2-G6 oracle-completion (SHA256 drift) | T-RA-REP-03 | Exact 1-file ceiling; addresses `APPLY-G2-G6-REP2-SHA256-ORACLE-DRIFT`; defined in `tasks-replan-runner-authority-oracle-completion.md` |
| G-RA-PC | Runner-authority provider-capture repair (B1/B2/B3) | T-RA-PC-01, T-RA-PC-02, T-RA-PC-03, T-RA-PC-04, T-RA-PC-05, T-RA-PC-06 | Exact 6-file ceiling; addresses `REVIEW-RA-FINAL-B1` (provider/global re-read), `REVIEW-RA-FINAL-B2` (malformed evidence), `REVIEW-RA-FINAL-B3` (non-Apply tests); defined in `tasks-replan-runner-authority-provider-capture-repair.md` |
| G-RA-MT | Runner-authority mode-taxonomy repair (B4/B5) | T-RA-MT-01, T-RA-MT-02, T-RA-MT-03, T-RA-MT-04, T-RA-MT-05, T-RA-MT-06 | Exact 6-file ceiling; addresses `REVIEW-RA-PC-B4` (invalid mode fails open), `REVIEW-RA-PC-B5` (OpenCode AUTHZ_MISSING vs Pi invalid-evidence taxonomy mismatch); defined in `tasks-replan-runner-authority-mode-taxonomy-repair.md` |
| G1 | New contracts | T-01, T-02, T-03, T-04 | Original; pending recovery batch completion |
| G2 | Orchestrator policy | T-05, T-06, T-07, T-08 | Original; G2_apply BLOCKED |
| G3 | Execution / registry | T-09, T-10, T-11 | |
| G4 | Canonical prompts | T-12, T-13 | |
| G5 | Contract + policy tests | T-14, T-15, T-16, T-17, T-18, T-19, T-20 | |
| G6 | Integration + acceptance tests | T-21, T-22, T-23, T-24 | |

**Total: 54 tasks across 14 groups (7 recovery + 8 runner-authority + 3 repair + 6 provider-capture + 6 mode-taxonomy + 24 original).**

## Global constraints and exclusions

### PROHIBITED TARGETS (hard stop — no task may authorize these)

- `runner-capability-standardization` — excluded from every batch, repair route, and target allowlist
- `openspec/changes/developer-team-execution-convergence/**` — historical/runtime evidence only; never modified, reconciled, or used to widen this change
- `openspec/changes/*/state.yaml`, `openspec/changes/*/events.yaml` — specialists never write shared YAML in centralized mode
- Generated outputs (`packages/core/src/skills/external/content.generated.ts`, `apps/cli/src/runtime/build-info.generated.ts`, etc.) — downstream effects only; never edited directly
- Any existing OpenSpec change's artifacts, state, or events

### IMPLEMENTATION RULE

- Only **implementation defects** (root cause = `implementation`) are eligible for Apply `targeted_repair`.
- Root causes `requirement`, `architecture`, `batch_shape` → `replan_spec` / `replan_design` / `replan_tasks`.
- Root causes `oracle` → `correct_oracle` (non-modifying).
- Root causes `environment`, `transport`, `capability` → `verify_runtime_diagnosis` (non-modifying; escalates if unresolved).
- Root causes `security`, `data-loss` → `escalate` / `human`.
- Root causes `authorization`, `git_safety` → `stop`.
- Root cause `unknown` with ambiguous evidence → `verify_runtime_diagnosis`; without usable probe or after exhaustion → `escalate`.
- Any unrecognized combination → `stop` (fail closed, no permissive default).

### SOURCE/CONFIG TARGET BOUNDARY

All source/config targets are **explicit and bounded** per task. No glob expansion, no broader directory sweep. Targets are drawn only from the official design.md impact candidates and spec.md runtime evidence references.

### OPENSPEC STATE

Specialists emit ordered `RegistryIntentV1` values only. The centralized coordinator remains the sole writer of shared `state.yaml` / `events.yaml`. No task writes shared YAML directly.

---

## G-REC — Recovery batch: authority floors (bounded 8-file ceiling)

> **Batch identity:** `deterministic-apply-verify-review-flow-recovery-batch-g1`
> **Ceiling:** exactly 4 source files + 4 test files (see `tasks-replan-g1.md` for full definition)
> **G2_apply:** BLOCKED. **repair-3:** PROHIBITED. **Human batch approval:** required before any modifying attempt.
> **Spec digest (authoritative):** `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f`
> **Design digest (authoritative):** `sha256:9850e208e6f364232c4418481e6cc99eb063a68a1afdf77db52ae703ca2e9bc1`

Full task definitions (RED/GREEN oracles, completion evidence, rollback) are in `tasks-replan-g1.md`. Summary:

| Task | Source file | Test file | Authority requirement |
|------|-------------|-----------|----------------------|
| T-REC-01 | `finding-disposition.ts` | `finding-disposition.test.ts` | FD-03, SEC-03: protected-risk as mandatory disposition input |
| T-REC-02 | `routing-decision.ts` | `routing-decision.test.ts` | SEC-03: protected-risk recomputed at routing boundary |
| T-REC-03 | `blocking-repair-projection.ts` | `blocking-repair-projection.test.ts` | RG-05, MD-03: complete identity, counter authority, ledger binding |
| T-REC-04 | `execution-convergence.ts` | `execution-convergence.test.ts` | BV-03, REG-03: typed evidence, transition-authoritative convergence |

**Dependency order:** T-REC-01 → T-REC-02 → T-REC-03 → T-REC-04
**Complexity totals:** C4×2, C5×2
**Risk lane:** CRITICAL for all four

### Dispatch policy for G-REC

1. **G2_apply is BLOCKED** — no task may authorize a `G2_apply` route.
2. **repair-3 is PROHIBITED** — the exhausted G1 two-attempt budget is not reopened.
3. Root cause `security` or `data-loss protected-risk` → `escalate` / `human`.
4. Root cause `authorization` or `git_safety` → `stop`.
5. Any unrecognized combination → `stop` (fail closed).
6. No recovery batch task may be modified without a new explicit human-approved batch identity.

---

## G-EA — Effect-authority recovery batch (bounded 8-file ceiling — NOT APPROVED)

> **Proposed batch identity:** `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority`
> **NOT APPROVED — requires named human approval before any modifying attempt.**
> **Ceiling:** exactly 4 source files + 4 test files (same as G1 recovery batch); see `tasks-replan-effect-authority.md` for full definitions.
> **G2_apply:** BLOCKED. **repair-3:** PROHIBITED. **Spec/Design replan:** NOT REQUIRED (Review confirmed).
> **Spec digest (authoritative):** `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f`
> **Design digest (authoritative):** `sha256:9850e208e6f364232c4418481e6cc99eb063a68a1afdf77db52ae703ca2e9bc1`

Addresses three Review blockers from `review-recovery-g1.md`:
- **REVIEW-REC-G1-B1** (protected-risk effect authority): T-EA-01
- **REVIEW-REC-G1-B2** (retry identity effect authority): T-EA-02
- **REVIEW-REC-G1-B3** (convergence replay authority): T-EA-03

Full task definitions (RED/GREEN oracles, completion evidence, rollback, hard stops) are in `tasks-replan-effect-authority.md`. Summary:

| Task | Source files | Test files | Covers |
|------|--------------|------------|--------|
| T-EA-01 | `finding-disposition.ts`, `routing-decision.ts`, `blocking-repair-projection.ts` | `finding-disposition.test.ts`, `routing-decision.test.ts`, `blocking-repair-projection.test.ts` | B1: protected-risk mandatory authority at disposition/routing/projection/effect |
| T-EA-02 | `blocking-repair-projection.ts` | `blocking-repair-projection.test.ts` | B2: retry identity/ledger authority at parse/effect boundaries |
| T-EA-03 | `execution-convergence.ts` | `execution-convergence.test.ts` | B3: typed transition replay in authority parser |

**Dependency order:** T-EA-01 → T-EA-02 → T-EA-03
**Complexity totals:** C5×3
**Risk lane:** CRITICAL for all three

### Dispatch policy for G-EA

1. **G2_apply is BLOCKED** — no task may authorize a `G2_apply` route.
2. **repair-3 is PROHIBITED** — the exhausted G1 two-attempt budget is not reopened.
3. Root cause `security` or `data-loss protected-risk` → `escalate` / `human`.
4. Root cause `authorization` or `git_safety` → `stop`.
5. Any unrecognized combination → `stop` (fail closed).
6. No task may be modified without a new explicit named human-approved batch identity.
7. **Apply is NOT authorized by this replan.** Named human approval for the proposed batch identity is required before any modifying attempt.

---

## G-RA — Runner-authority boundary (bounded 8-file ceiling)

> **Batch identity:** `deterministic-apply-verify-review-flow-runner-authority-g2-g6`
> **Ceiling:** exactly 4 source files + 2 generated assets + 2 reachability test files
> **Addresses:** `REVIEW-G2-G6-PI-B1-CALLER-SUPPLIED-AUTHORITY` (critical)
> **Spec digest (authoritative):** `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f`
> **Design digest (authoritative):** `sha256:9850e208e6f364232c4418481e6cc99eb063a68a1afdf77db52ae703ca2e9bc1`
> **Design-replan digest:** `sha256:7d389a846ca00c71c356ada41d78af4ffd0f140aa2acba431d1871611cb8306a`

### Runner-authority architecture summary

The sole V1 modifying-authority source is a trusted process-local Deck host provider. Both adapters must:
1. Delete `deckExecution` immediately, before checking whether the requested role is Apply.
2. Never parse, hash, preserve, log, emit, copy, or pass its value to provider selection, mode selection, the provider, the authorization service, the bridge, telemetry, or the delegated specialist.
3. If the role is not an Apply role, return after stripping — prevents the control object from leaking into non-modifying specialists.
4. If the role is Apply, use only the provider captured at initialization. A caller marker cannot cause a provider lookup, choose a mode, alter fail-closed behavior, or activate the bridge.
5. Parse the provider event and derive claims through a private `authorizationInputFromTrustedEvent`-style boundary. No equivalent helper may accept the removed caller object.
6. Issue the process-local envelope only after provider resolution and exact structural/binding checks succeed.
7. Pass only the reconstructed provider event plus local envelope to `DeveloperTeamRunnerHostBridgeV1`.

`invocation-required` + no provider → `AUTHZ_MISSING`, zero bridge calls, zero effects.
`static-compatible` + no provider → strip payload, preserve legacy delegation, zero V1 bridge/effect.
Caller marker cannot promote provider V1, convert `shadow` to `active`, or force local authority mint.

Installed generated assets must be standalone without: (1) absolute checkout path resolution, (2) filesystem read/import/require/dynamic import/resolution of OpenSpec or repository sources, or (3) cwd-derived Deck source lookup. The bundled excluded-WIP safety constant `runner-capability-standardization` (a hard-coded string literal in prompts) is exempt — it is documentation, not a runtime dependency. This oracle correction (finding `VERIFY-G2-G6-TARGETED-GEN-OPEN-SPEC-PATH`) requires no source or generated change.

---

### T-RA-01: Orchestrator — remove caller-authority instruction

| Field | Value |
|-------|-------|
| **Owner** | `apply-general` |
| **Priority** | P0 |
| **Complexity** | C2 |
| **Parallel** | sequential (G-RA) |
| **Depends on** | none |
| **Files (allowlist — source)** | `packages/core/src/teams/developer/orchestrator-content.ts` |
| **Files (blocked)** | Any other prompt source; any generated file; any contract/execution/adapter file |
| **Verification** | RED: no instruction tells orchestrator to attach `deckExecution` as a Task argument with `deterministicRepairAuthority.schema === "deterministic-targeted-repair-authority-v1"`; GREEN: canonical prompt surfaces describe out-of-band trusted provider authority and confirm adapter strips deckExecution before sub-agent receipt |
| **Completion evidence** | `orchestrator-content.test.ts` updated (T-RA-02 passes); TypeScript compiles |
| **Risk lane** | CRITICAL |
| **Rollback** | Revert orchestrator-content.ts to pre-T-RA-01 state |

#### Requirement/scenario coverage

- `REVIEW-G2-G6-PI-B1-CALLER-SUPPLIED-AUTHORITY` — prompt must not instruct agents to manufacture modifying authority via `deckExecution`
- Design decision 5: update canonical orchestrator guidance so prompts never instruct an agent to manufacture or attach modifying authority in `deckExecution`; host/provider authority is out-of-band
- Decision 11 note: caller booleans never clearing authority; disagreement or missing authority blocks or escalates

#### Change description

Remove from `ORCHESTRATOR_SYSTEM_PROMPT` (Pre-Delegation Checklist section, line ~212) the instruction:

> "For a deterministic repair delegation, attach the complete validated host event as the Task argument `deckExecution`. Its `deterministicRepairAuthority.schema` must be `deterministic-targeted-repair-authority-v1` and must carry the current manifest, disposition, routing, projection, convergence records, and retry ledger. Never invent missing authority or fall back to a structural/self-hashed event; the installed runner plugin removes this control argument before delegation and fails closed on any mismatch."

Replace with a statement that trusted process-local provider authority is established out-of-band at adapter initialization, that `deckExecution` is stripped by the adapter before the sub-agent receives args, and that the orchestrator must not attempt to mint, forward, or re-sign caller-supplied authority.

#### Why orchestrator-content.ts is in this batch

The design explicitly requires updating the core prompt source to remove the caller-authority instruction. This file is on the runner-authority batch allowlist per design-replan-runner-authority.md § "Exact candidate Task allowlist" row 1. The instruction to attach `deckExecution` as a Task argument is the source-level enabler of the caller-supplied authority defect; removing it is mandatory and cannot be deferred to G4 T-12 without leaving the critical defect open longer.

#### Why orchestrator-content.test.ts is also in this batch

The existing test at line 97-98 asserts that `ORCHESTRATOR_SYSTEM_PROMPT` contains `deckExecution`. After T-RA-01 removes the instruction, that assertion will fail. The test must be updated as part of the same atomic change to keep the prompt/test contract valid.

---

### T-RA-02: Orchestrator test — update deckExecution assertions

| Field | Value |
|-------|-------|
| **Owner** | `apply-general` |
| **Priority** | P0 |
| **Complexity** | C1 |
| **Parallel** | sequential (G-RA, after T-RA-01) |
| **Depends on** | T-RA-01 |
| **Files (allowlist — test)** | `packages/core/src/teams/developer/orchestrator-content.test.ts` |
| **Files (blocked)** | Any other test file; any source file |
| **Verification** | RED: existing line 97-98 assertion (`expect(prompt).toContain("deckExecution")`) fails because T-RA-01 removed the instruction; GREEN: new assertion confirms deckExecution is not referenced as a caller-supplied Task argument in any prompt surface, and that trusted provider authority is documented |
| **Completion evidence** | `orchestrator-content.test.ts` passes; TypeScript compiles |
| **Risk lane** | HIGH |
| **Rollback** | Revert orchestrator-content.test.ts to pre-T-RA-02 state |

#### Change description

Update the test at line 97-98 from:
```ts
expect(prompt).toContain("deckExecution");
expect(prompt).toContain("deterministic-targeted-repair-authority-v1");
```
To assert that neither `deckExecution` nor `deterministic-targeted-repair-authority-v1` appears as a caller-supplied/modifying-authority instruction in any prompt surface. Add new assertions confirming the prompt documents out-of-band trusted provider establishment and the adapter stripping behavior.

---

### T-RA-03: OpenCode adapter — strip deckExecution, pin provider, remove caller fallback

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | sequential (G-RA) |
| **Depends on** | T-RA-01 |
| **Files (allowlist — source)** | `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts` |
| **Files (blocked)** | Any other adapter file; any execution/runtime file; any generated file |
| **Verification** | RED: caller `deckExecution` with no provider produces zero HMAC issuance, zero bridge calls, zero effects in both `invocation-required` and `static-compatible` modes; GREEN: valid trusted provider V1 event reaches bridge after local authorization; tampered provider authority fails closed; caller marker cannot promote provider V1 |
| **Completion evidence** | `developer-team-execution-reachability.test.ts` updated (new runner-authority oracles pass); TypeScript compiles |
| **Risk lane** | CRITICAL |
| **Rollback** | Revert developer-team-execution.ts to pre-T-RA-03 state |

#### Current defect (caller-supplied authority)

The current OpenCode adapter at `tool.execute.before`:
1. Captures `callerEvent = args.deckExecution` BEFORE role check
2. Deletes `deckExecution` from args
3. Checks `deterministicCallerEvent = deterministicExecutionEvent(callerEvent)`
4. Sets `deterministicCallerFallback = !resolveExecutionEvent && deterministicCallerEvent`
5. When `!resolveExecutionEvent && !deterministicCallerEvent` → throws AUTHZ_MISSING in invocation-required mode
6. BUT when `!resolveExecutionEvent && deterministicCallerEvent` (steps 102-108) → proceeds to use `callerEvent` as `rawEvent` (line 118)

This allows a caller with `deckExecution` (but no provider) to activate V1 bridge/effect — exactly the critical defect.

#### Fix description

In the `tool.execute.before` hook, BEFORE the `applyAgent(args)` check:
1. If `args` is an object, immediately `delete args.deckExecution` — do not read it first
2. After deletion, check whether args is an Apply agent args
3. If not Apply, return immediately (no further processing)
4. If Apply, resolve the provider and derive authority ONLY from the provider event
5. Remove all `deterministicCallerEvent`, `deterministicCallerFallback`, and `callerEvent` variable usage
6. In `invocation-required` mode with no provider: throw `modification-not-authorized:AUTHZ_MISSING`
7. In `static-compatible` mode with no provider: return without bridge call or effect

Exact behavioral contract (from design § "Authorization lifecycle"):

| Provider state | Caller/grant-shaped payload | Effective mode | Bridge/effect behavior |
|---|---|---|---|
| valid trusted provider event | any | `invocation-required` | provider `active` may reach effect after local auth + bridge validation; `shadow` non-effecting |
| provider fails/malformed | any | `invocation-required` | fail closed with redacted `invalid-evidence`; no local authorization/effect |
| provider absent | absent or present | `invocation-required` | strip payload; `AUTHZ_MISSING`; no issue/bridge/effect |
| provider `shadow` | any | `static-compatible` | caller ignored; shadow may reach bridge observation; no effect |
| provider `active` or `legacy` | any | `static-compatible` | caller ignored; V1 bridge not activated; preserve underlying legacy delegation |
| provider fails/absent | absent or present | `static-compatible` | strip payload; preserve underlying legacy delegation; no V1 bridge/effect |

---

### T-RA-04: OpenCode generated asset — regenerate from fixed canonical source

| Field | Value |
|-------|-------|
| **Owner** | `apply-general` |
| **Priority** | P0 |
| **Complexity** | C1 |
| **Parallel** | sequential (G-RA, after T-RA-03) |
| **Depends on** | T-RA-03 |
| **Files (allowlist — generated)** | `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.generated.js` |
| **Files (blocked)** | Any other generated file; any source file |
| **Verification** | RED: generated file SHA-256 differs from pre-T-RA-03 value `f08ef142d20c568dccf8c714554134c5a3c9ace790313e4bc7d8f85097d98cae`; GREEN: `scripts/generate-runner-execution-assets.ts` runs successfully; generated output contains no `process.cwd()`, `/home/kevinlb/deck`, or OpenSpec path; source digest comment updated |
| **Completion evidence** | Generated file exists at correct path; generator exit code 0 |
| **Risk lane** | CRITICAL |
| **Rollback** | Restore pre-T-RA-04 generated file from git |

#### Important

This file is **generator-owned**. Apply edits the canonical TypeScript source and invokes the canonical generator. The generated output is a build artifact with no independent edit authority.

#### Generator invocation

```bash
bun run scripts/generate-runner-execution-assets.ts
```

The generator reads `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts` and produces `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.generated.js` with a `// source-sha256:<hash>` comment.

---

### T-RA-05: Pi adapter — strip deckExecution, pin provider, remove caller fallback

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | sequential (G-RA) |
| **Depends on** | T-RA-01 |
| **Files (allowlist — source)** | `packages/adapter-pi/assets/pi/extensions/developer-team-execution.ts` |
| **Files (blocked)** | Any other Pi adapter file; any execution/runtime file; any generated file |
| **Verification** | RED: caller `deckExecution` with no provider produces zero bridge calls, zero effects in both modes; GREEN: parity with OpenCode — same behavioral matrix; tampered provider fails closed; caller marker cannot promote |
| **Completion evidence** | `developer-team-execution-reachability.test.ts` (Pi) updated; TypeScript compiles |
| **Risk lane** | CRITICAL |
| **Rollback** | Revert developer-team-execution.ts to pre-T-RA-05 state |

#### Current defect (identical to OpenCode)

The current Pi adapter at `tool_call` (lines 100-117) has the same caller-supplied authority defect:
- Captures `callerEvent = input.deckExecution` before role check
- Sets `deterministicCallerFallback = !resolveExecutionEvent && deterministicCallerEvent`
- Falls back to `callerEvent` when no resolver exists

#### Fix description

Identical pattern to T-RA-03 but for the Pi `tool_call` hook:
1. Immediately `delete input.deckExecution` before any role check or provider resolution
2. If not Apply agent, return `undefined` immediately (no further processing)
3. Resolve provider from factory option or global slot only
4. No `callerEvent`, `deterministicCallerEvent`, or `deterministicCallerFallback` variables
5. Behavioral matrix identical to OpenCode

**Pi/OpenCode parity**: provider selection, stripping, mode semantics, denial codes, bridge calls, and effect counts must be semantically identical across both adapters.

#### Worktree note

The Pi canonical source has pre-existing uncommitted modifications (worktree evidence, digest `e24e50d2cc867a11cb2e9000f1c132efbeb387f255d79966fc780f1e7c1544eb`). Apply must reconcile these changes **in place** without git discard/restore/checkout. The Apply agent must inspect the worktree state, preserve unrelated modifications, and apply only the runner-authority fix to this file.

---

### T-RA-06: Pi generated asset — regenerate from fixed canonical source

| Field | Value |
|-------|-------|
| **Owner** | `apply-general` |
| **Priority** | P0 |
| **Complexity** | C1 |
| **Parallel** | sequential (G-RA, after T-RA-05) |
| **Depends on** | T-RA-05 |
| **Files (allowlist — generated)** | `packages/adapter-pi/assets/pi/extensions/developer-team-execution.generated.js` |
| **Files (blocked)** | Any other generated file; any source file |
| **Verification** | RED: generated file SHA-256 differs from pre-T-RA-05 value `d6d39cb14cfd8244cdd4e8d60ffda3629fe92e31cd694f0b5b1dfa81b8335aeb`; GREEN: generator exit code 0; no checkout/OpenSpec/cwd path; source digest comment updated |
| **Completion evidence** | Generated file exists at correct path; generator exit code 0 |
| **Risk lane** | CRITICAL |
| **Rollback** | Restore pre-T-RA-06 generated file from git |

#### Important

This file is **generator-owned**. Apply edits the canonical TypeScript source and invokes the canonical generator.

---

### T-RA-07: OpenCode reachability — runner-authority oracles

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | sequential (G-RA, after T-RA-04) |
| **Depends on** | T-RA-04 |
| **Files (allowlist — test)** | `packages/adapter-opencode/src/developer-team-execution-reachability.test.ts` |
| **Files (blocked)** | Any other test file; any source file |
| **Verification** | RED: caller-only `deckExecution` with no provider → zero bridge calls, `AUTHZ_MISSING` in invocation-required, legacy preserved in static-compatible; caller marker cannot promote provider V1; GREEN: all new runner-authority oracles pass; existing tests D-REACH-04..17, D-REACH-21, EG8-REACH-11..16 still pass |
| **Completion evidence** | `bun test developer-team-execution-reachability.test.ts` 100% pass |
| **Risk lane** | CRITICAL |
| **Rollback** | Revert reachability test to pre-T-RA-07 state |

#### Test oracle requirements (per design § "Task-ready test oracles")

1. Complete caller `deckExecution` with no provider → zero HMAC issuance, zero bridge calls, zero effects
2. Caller-labelled grant, marker-only authority, tampered authority, caller-selected capability → same non-authoritative provenance result
3. `invocation-required` + missing provider → `AUTHZ_MISSING`, even in Automatic mode
4. `static-compatible` + missing/failing provider → preserves legacy delegation, never activates V1
5. Conflicting caller and provider events → only provider authority used; caller cannot alter batch/target/role/action/mode/receipt
6. Caller marker cannot promote provider `active` event in static-compatible mode
7. `deckExecution` removed for Apply and non-Apply before any provider or specialist sees it
8. Provider failure details redacted; no secret-shaped value in output/telemetry
9. Process-local authorization rejects expiry, future time, restart, replay, invocation/role/change/batch/task/receipt/action/target/blocked-target mismatch
10. OpenCode and Pi outcome/effect-count matrices identical
11. Generated assets match canonical sources after generator run; no checkout/cwd/deck path dependency
12. Current V1 replay, bridge, deterministic authority, Git-safety, and static-compatible suites remain green

#### Tests to replace

The following existing tests will fail after T-RA-03 because they validate the buggy fallback behavior (caller `deckExecution` activates V1 when no provider exists). They must be updated or replaced:

- **D-REACH-18** (currently: installed plugin accepts complete deterministic delegation without external provider, expects bridgeCalls=1) → replace with test verifying `AUTHZ_MISSING` and zero bridge calls
- **D-REACH-19** (currently: installed plugin fails closed on tampered caller-carried authority, expects `invalid-evidence`) → update to reflect new behavior where caller event is never used, so tampered caller event with no provider → `AUTHZ_MISSING`
- **D-REACH-20** (currently: installed plugin rejects caller-selected capability, expects `invalid-evidence`) → update to reflect new behavior

#### Tests to preserve (correct behavior, unchanged)

D-REACH-04, D-REACH-05, D-REACH-06, D-REACH-09, D-REACH-15, D-REACH-16, D-REACH-17, D-REACH-21, EG8-REACH-11, EG8-REACH-13, EG8-REACH-14, and all static-compatible/providerr error redaction tests.

---

### T-RA-08: Pi reachability — runner-authority oracles

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | sequential (G-RA, after T-RA-06) |
| **Depends on** | T-RA-06 |
| **Files (allowlist — test)** | `packages/adapter-pi/src/developer-team-execution-reachability.test.ts` |
| **Files (blocked)** | Any other test file; any source file |
| **Verification** | RED: same behavioral matrix as OpenCode (oracles 1-12); GREEN: Pi tests pass; OpenCode/Pi effect-count matrices identical |
| **Completion evidence** | `bun test developer-team-execution-reachability.test.ts` (Pi) 100% pass |
| **Risk lane** | CRITICAL |
| **Rollback** | Revert reachability test to pre-T-RA-08 state |

#### Tests to replace

Same as T-RA-07 for Pi:
- D-REACH-18 → replace with `AUTHZ_MISSING` oracle
- D-REACH-19 → update for new behavior
- D-REACH-20 → update for new behavior

#### Tests to preserve

D-REACH-01, D-REACH-02, D-REACH-03, D-REACH-10, EG8-REACH-12, EG8-REACH-15, EG8-REACH-16, and all static-compatible/provider error redaction tests.

---

## G-RA-REP-1 — Runner-authority G2-G6 repair-1 (oracle + byte drift correction)

> **Batch identity:** `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-1`
> **Ceiling:** exactly 1 file (test oracle correction only)
> **Addresses:** `VERIFY-G2-G6-TARGETED-GEN-OPEN-SPEC-PATH` (oracle correction) and `VERIFY-G2-G6-AFFECTED-CORE-PROMPT-PROFILE-BYTE-DRIFT` (byte drift repair)
> **Spec digest (authoritative):** `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f`
> **Design digest (authoritative):** `sha256:9850e208e6f364232c4418481e6cc99eb063a68a1afdf77db52ae703ca2e9bc1`
> **Design-replan digest:** `sha256:7d389a846ca00c71c356ada41d78af4ffd0f140aa2acba431d1871611cb8306a`
> **Apply authority:** BLOCKED — requires new exact user message authorizing batch identity `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-1`

### Failed Verify bindings

| Binding | Digest / value |
|---|---|
| Dossier | `sha256:ab19faedb74876f7460c80719016c2d1c58f985fcdc1dff586aeeef8712d8c` |
| Evidence | `sha256:8e903ba48d283f71e4f7f0f9510b685269e7514a56eb85aa1baa0c149a4fe18e` |
| Decision | `sha256:41a452255c3524f3197e5d55cad39104fdd9cdfad6ee9abc4ea1b22b79d8e976` |

### Finding 1: VERIFY-G2-G6-TARGETED-GEN-OPEN-SPEC-PATH — Oracle Correction

The no-checkout oracle in the G-RA architecture summary (line ~160) incorrectly flagged the bundled excluded-WIP safety constant `openspec/changes/runner-capability-standardization`. This constant is embedded as a hard-coded string literal in prompts (documentation, not runtime dependency) and is exempt. The oracle text has been corrected to a semantic property:

> Installed generated assets must be standalone without: (1) absolute checkout path resolution, (2) filesystem read/import/require/dynamic import/resolution of OpenSpec or repository sources, or (3) cwd-derived Deck source lookup. The bundled excluded-WIP safety constant `runner-capability-standardization` (a hard-coded string literal in prompts) is exempt — it is documentation, not a runtime dependency.

This correction requires no source or generated change.

### Finding 2: VERIFY-G2-G6-AFFECTED-CORE-PROMPT-PROFILE-BYTE-DRIFT — Byte Drift Repair

T-RA-01 (orchestrator-content.ts) removed the caller-authority instruction and added out-of-band trusted provider documentation. This changed `LEGACY_BYTES` from `365_023` to `365_242` (+219 bytes). The test assertion at `prompt-profile.test.ts` line 80 now fails.

### T-RA-REP-01: Update LEGACY_BYTES oracle

| Field | Value |
|-------|-------|
| **Owner** | `apply-general` |
| **Priority** | P0 |
| **Complexity** | C1 |
| **Parallel** | sequential (G-RA-REP-1) |
| **Depends on** | T-RA-01 (authorized orchestrator prompt change) |
| **Files (allowlist — test only)** | `packages/core/src/teams/developer/prompt-profile.test.ts` |
| **Files (blocked)** | Any other file; any source; any generated asset; `orchestrator-content.ts` (T-RA-01 applied); `orchestrator-content.test.ts` (T-RA-02 applied) |
| **Verification** | RED: `LEGACY_BYTES = 365_023` fails (received 365242); GREEN: `LEGACY_BYTES = 365_242` passes |
| **Completion evidence** | `bun test packages/core/src/teams/developer/prompt-profile.test.ts` — 8 pass, 0 fail |
| **Risk lane** | **CRITICAL** (closes evidence for a security boundary; oracle correction, not behavior weakening) |
| **Rollback** | Revert `LEGACY_BYTES` to `365_023` — no Git discard required; prior value documented in `tasks-replan-runner-authority-repair-1.md` |

### RED/GREEN Checks

| Check | Before Repair | After Repair |
|-------|---------------|--------------|
| `LEGACY_BYTES = 365_023` assertion | FAIL (received 365242) | N/A |
| `LEGACY_BYTES = 365_242` assertion | N/A | PASS |
| `LEGACY_SHA256` assertion | PASS | PASS |
| Other 6 assertions | PASS | PASS |
| **Total** | **7 pass / 1 fail** | **8 pass / 0 fail** |

### Dependency order

```
T-RA-01 → T-RA-02 → ... → T-RA-08 (parent G-RA batch)
                                              ↓
                                    T-RA-REP-01 (oracle + byte repair)
```

### Complexity summary (G-RA-REP-1 only)

| Task | Complexity | Risk |
|------|------------|------|
| T-RA-REP-01 | C1 | CRITICAL |

**G-RA-REP-1 totals: C1×1**

### Verification schedule (fresh after repair)

1. **Targeted**: `LEGACY_BYTES` updated to `365_242`; test passes
2. **Affected-area**: `prompt-profile.test.ts` 8/8 pass; no other test affected
3. **Independent Review**: fresh reviewer validates oracle correction semantics and byte drift recomputation
4. **Broad**: repository-wide TypeScript compile; no regression in prompt or adapter tests

---

## G-RA-REP-2 — Runner-authority G2-G6 repair-2 (lexical tokens drift correction)

> **Batch identity:** `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-2`
> **Ceiling:** exactly 1 file (test oracle correction only)
> **Addresses:** `APPLY-G2-G6-REP1-LEXICAL-TOKENS-ORACLE-DRIFT` (rootCause task_plan, destination replan_tasks, owner task)
> **Spec digest (authoritative):** `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f`
> **Design digest (authoritative):** `sha256:9850e208e6f364232c4418481e6cc99eb063a68a1afdf77db52ae703ca2e9bc1`
> **Design-replan digest:** `sha256:7d389a846ca00c71c356ada41d78af4ffd0f140aa2acba431d1871611cb8306a`
> **Apply authority:** BLOCKED — requires new exact user message authorizing batch identity `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-2`

### Failed Apply bindings

| Binding | Digest / value |
|---|---|
| Blocker | `APPLY-G2-G6-REP1-LEXICAL-TOKENS-ORACLE-DRIFT` |
| Location | `packages/core/src/teams/developer/prompt-profile.test.ts:25` / assertion line 81 |
| Expected | `LEGACY_LEXICAL_TOKENS = 79_051` |
| Received | `79_092` |
| Delta | +41 lexical tokens |
| Focused result | 7 pass / 1 fail |
| Affected result | 1076 pass / 1 fail |

### T-RA-REP-02: Update LEGACY_LEXICAL_TOKENS oracle

| Field | Value |
|-------|-------|
| **Owner** | `apply-general` |
| **Priority** | P0 |
| **Complexity** | C1 |
| **Parallel** | sequential (G-RA-REP-2) |
| **Depends on** | T-RA-01 (authorized orchestrator prompt change); T-RA-REP-01 (prior repair of LEGACY_BYTES) |
| **Files (allowlist — test only)** | `packages/core/src/teams/developer/prompt-profile.test.ts` |
| **Files (blocked)** | Any other file; any source; any generated asset; `orchestrator-content.ts` (T-RA-01 applied); `orchestrator-content.test.ts` (T-RA-02 applied); LEGACY_BYTES constant (repair-1 preserved: 365_242) |
| **Verification** | RED: `LEGACY_LEXICAL_TOKENS = 79_051` fails (received 79092); GREEN: `LEGACY_LEXICAL_TOKENS = 79_092` passes |
| **Completion evidence** | `bun test packages/core/src/teams/developer/prompt-profile.test.ts` — 8 pass, 0 fail |
| **Risk lane** | **CRITICAL** (closes evidence for a security boundary; oracle correction, not behavior weakening) |
| **Rollback** | Revert `LEGACY_LEXICAL_TOKENS` to `79_051` — no Git discard required; prior value documented in `tasks-replan-runner-authority-repair-2.md` |

### RED/GREEN Checks

| Check | Before Repair-2 | After Repair-2 |
|-------|-----------------|----------------|
| `LEGACY_BYTES = 365_242` assertion | PASS (repair-1 preserved) | PASS |
| `LEGACY_LEXICAL_TOKENS = 79_051` assertion | FAIL (received 79092) | N/A |
| `LEGACY_LEXICAL_TOKENS = 79_092` assertion | N/A | PASS |
| `LEGACY_SHA256` assertion | PASS | PASS |
| Other 6 assertions | PASS | PASS |
| **Total** | **7 pass / 1 fail** | **8 pass / 0 fail** |

### Dependency order

```
T-RA-01 → T-RA-02 → ... → T-RA-08 (parent G-RA batch)
                                              ↓
                                    T-RA-REP-01 (LEGACY_BYTES repair)
                                              ↓
                                    T-RA-REP-02 (LEGACY_LEXICAL_TOKENS repair)
```

### Complexity summary (G-RA-REP-2 only)

| Task | Complexity | Risk |
|------|------------|------|
| T-RA-REP-02 | C1 | CRITICAL |

**G-RA-REP-2 totals: C1×1**

### Verification schedule (fresh after repair-2)

1. **Targeted**: `LEGACY_LEXICAL_TOKENS` updated to `79_092`; test passes
2. **Affected-area**: `prompt-profile.test.ts` 8/8 pass; no other test affected
3. **Independent Review**: fresh reviewer validates oracle correction semantics and lexical token drift recomputation
4. **Broad**: repository-wide TypeScript compile; no regression in prompt or adapter tests

---

## G-RA-REP-3 — Runner-authority G2-G6 prompt-profile-oracle-completion (SHA256 drift correction)

> **Batch identity:** `deterministic-apply-verify-review-flow-runner-authority-prompt-profile-oracle-completion`
> **Ceiling:** exactly 1 file (test oracle correction only)
> **Addresses:** `APPLY-G2-G6-REP2-SHA256-ORACLE-DRIFT` (rootCause task_plan, destination replan_tasks, owner task)
> **NOT repair-3:** G1 `repair-3` remains PROHIBITED — exhausted G1 two-attempt budget not reopened. This is a newly authorized normal-workflow oracle-completion batch after Task-plan omissions, not reopening G1 repair governance.
> **Spec digest (authoritative):** `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f`
> **Design digest (authoritative):** `sha256:9850e208e6f364232c4418481e6cc99eb063a68a1afdf77db52ae703ca2e9bc1`
> **Design-replan digest:** `sha256:7d389a846ca00c71c356ada41d78af4ffd0f140aa2acba431d1871611cb8306a`
> **Apply authority:** BLOCKED — requires new exact user message authorizing batch identity `deterministic-apply-verify-review-flow-runner-authority-prompt-profile-oracle-completion`

### Failed Apply bindings

| Binding | Digest / value |
|---|---|
| Blocker | `APPLY-G2-G6-REP2-SHA256-ORACLE-DRIFT` |
| Location | `packages/core/src/teams/developer/prompt-profile.test.ts:26` / assertion line 82 |
| Expected (stale) | `4eb4caaeb12ff0242c2e753e211cdd76bb9d3b24b610c2c512f1976ecfbc9e36` |
| Received (stable candidate) | `617d589136d3c20d9baed0ffd159dfef0fd5762ff92790f1c121c39d22a0aa54` |
| Focused result | 7 pass / 1 fail |
| Affected result | 1076 pass / 1 fail |

### Deterministic Legacy Snapshot Assertion Inventory

The test file `prompt-profile.test.ts` contains exactly **3 chained deterministic legacy snapshot assertions**:

| # | Constant | Line | Value | Assertion Line | Status |
|---|----------|------|-------|----------------|--------|
| 1 | `LEGACY_BYTES` | 24 | `365_242` | 80 | **PASS** (repair-1) |
| 2 | `LEGACY_LEXICAL_TOKENS` | 25 | `79_092` | 81 | **PASS** (repair-2) |
| 3 | `LEGACY_SHA256` | 26 | `4eb4caaeb...` | 82 | **FAIL** (drift exposed) |

**No additional chained snapshot oracle exists after SHA-256.** SHA-256 is the terminal oracle in the chain. It depends on the concatenated legacy content (bytes + tokens), but no subsequent assertion depends on SHA-256.

### T-RA-REP-03: Update LEGACY_SHA256 oracle

| Field | Value |
|-------|-------|
| **Owner** | `apply-general` |
| **Priority** | P0 |
| **Complexity** | C1 |
| **Parallel** | sequential (G-RA-REP-3) |
| **Depends on** | T-RA-01 (authorized orchestrator prompt change); T-RA-REP-01 (LEGACY_BYTES repair); T-RA-REP-02 (LEGACY_LEXICAL_TOKENS repair) |
| **Files (allowlist — test only)** | `packages/core/src/teams/developer/prompt-profile.test.ts` |
| **Files (blocked)** | Any other file; any source; any generated asset; `LEGACY_BYTES` constant (365_242 from repair-1 preserved); `LEGACY_LEXICAL_TOKENS` constant (79_092 from repair-2 preserved) |
| **Verification** | RED: `LEGACY_SHA256 = "4eb4caaeb..."` fails (received `617d5891...`); GREEN: `LEGACY_SHA256 = "617d589136d3c20d9baed0ffd159dfef0fd5762ff92790f1c121c39d22a0aa54"` passes |
| **Completion evidence** | `bun test packages/core/src/teams/developer/prompt-profile.test.ts` — 8 pass, 0 fail |
| **Risk lane** | **CRITICAL** (closes evidence for a security boundary; oracle correction, not behavior weakening) |
| **Rollback** | Revert `LEGACY_SHA256` to `4eb4caaeb12ff0242c2e753e211cdd76bb9d3b24b610c2c512f1976ecfbc9e36` — no Git discard required; prior value documented in `tasks-replan-runner-authority-oracle-completion.md` |

### RED/GREEN Checks

| Check | Before Oracle-Completion | After Oracle-Completion |
|-------|-------------------------|------------------------|
| `LEGACY_BYTES = 365_242` assertion | PASS (repair-1 preserved) | PASS |
| `LEGACY_LEXICAL_TOKENS = 79_092` assertion | PASS (repair-2 preserved) | PASS |
| `LEGACY_SHA256 = "4eb4caaeb..."` assertion | FAIL (received 617d5891...) | N/A |
| `LEGACY_SHA256 = "617d5891..."` assertion | N/A | PASS |
| Other 5 assertions | PASS | PASS |
| **Total** | **7 pass / 1 fail** | **8 pass / 0 fail** |

### Scope/Diff Proof

- **File changed:** exactly 1 (`prompt-profile.test.ts`)
- **Constant changed:** exactly 1 (`LEGACY_SHA256` on line 26)
- **Value changed:** exactly 1 SHA-256 hex string (40 bytes)
- **Bytes/tokens preserved:** `LEGACY_BYTES = 365_242` and `LEGACY_LEXICAL_TOKENS = 79_092` are untouched
- **No other file touched:** source, generated, state, events, registry, other tests all unchanged

### Dependency order

```
T-RA-01 → T-RA-02 → ... → T-RA-08 (parent G-RA batch)
                                              ↓
                                    T-RA-REP-01 (LEGACY_BYTES repair)
                                              ↓
                                    T-RA-REP-02 (LEGACY_LEXICAL_TOKENS repair)
                                              ↓
                                    T-RA-REP-03 (LEGACY_SHA256 oracle-completion)
```

### Complexity summary (G-RA-REP-3 only)

| Task | Complexity | Risk |
|------|------------|------|
| T-RA-REP-03 | C1 | CRITICAL |

**G-RA-REP-3 totals: C1×1**

### Verification schedule (fresh after oracle-completion)

1. **Targeted**: `LEGACY_SHA256` updated to `617d589136d3c20d9baed0ffd159dfef0fd5762ff92790f1c121c39d22a0aa54`; test passes
2. **Affected-area**: `prompt-profile.test.ts` 8/8 pass; no other test affected
3. **Independent Review**: fresh reviewer validates oracle correction semantics and SHA-256 drift recomputation (performed twice independently)
4. **Broad**: repository-wide TypeScript compile; no regression in prompt or adapter tests

---

## G-RA-PC — Runner-authority provider-capture repair (bounded 6-file ceiling)

> **Batch identity:** `deterministic-apply-verify-review-flow-runner-authority-provider-capture-repair`
> **Ceiling:** exactly 6 files (2 canonical adapter TS + 2 generated JS + 2 reachability test)
> **Addresses:** `REVIEW-RA-FINAL-B1` (provider/global options reread), `REVIEW-RA-FINAL-B2` (installed resolver returning null/non-object → invalid-evidence), `REVIEW-RA-FINAL-B3` (non-Apply role tests)
> **Spec digest (authoritative):** `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f`
> **Design digest (authoritative):** `sha256:9850e208e6f364232c4418481e6cc99eb063a68a1afdf77db52ae703ca2e9bc1`
> **Design-replan digest:** `sha256:7d389a846ca00c71c356ada41d78af4ffd0f140aa2acba431d1871611cb8306a`
> **Apply authority:** BLOCKED — requires new exact user message authorizing batch identity `deterministic-apply-verify-review-flow-runner-authority-provider-capture-repair`

Full task definitions (RED/GREEN oracles, completion evidence, rollback, hard stops) are in `tasks-replan-runner-authority-provider-capture-repair.md`. Summary:

| Task | Source files | Test/generated files | Covers |
|------|-------------|---------------------|--------|
| T-RA-PC-01 | `developer-team-execution.ts` (OpenCode) | — | B1: freeze resolver/mode at init; B2: invalid-evidence for installed resolver returning null/non-object |
| T-RA-PC-02 | `developer-team-execution.ts` (Pi) | — | B1: freeze resolver/mode at init; B2: invalid-evidence for installed resolver returning null/non-object |
| T-RA-PC-03 | — | `developer-team-execution.generated.js` (OpenCode) | Regenerate after T-RA-PC-01 |
| T-RA-PC-04 | — | `developer-team-execution.generated.js` (Pi) | Regenerate after T-RA-PC-02 |
| T-RA-PC-05 | — | `developer-team-execution-reachability.test.ts` (OpenCode) | B1/B2/B3 tests: late-global-provider, mutable-options, null/non-object resolver, non-Apply stripping |
| T-RA-PC-06 | — | `developer-team-execution-reachability.test.ts` (Pi) | B1/B2/B3 tests: late-global-provider, mutable-options, null/non-object resolver, non-Apply stripping |

**Dependency order:** T-RA-PC-01 → T-RA-PC-03 → T-RA-PC-05; T-RA-PC-02 → T-RA-PC-04 → T-RA-PC-06 (T-RA-PC-01 and T-RA-PC-02 can run in parallel)
**Complexity totals:** C3×4, C1×2 = C14
**Risk lane:** CRITICAL for all six tasks

### Dispatch policy for G-RA-PC

1. **TDD rule:** new tests (D-REACH-22..27, D-REACH-22..27-Pi) must RED before source changes and GREEN after fixes.
2. **Existing tests preserved:** all prior authority tests remain GREEN; no existing test is modified.
3. **apply-backend owns:** T-RA-PC-01 (OpenCode adapter TS), T-RA-PC-02 (Pi adapter TS), T-RA-PC-05 (OpenCode tests), T-RA-PC-06 (Pi tests).
4. **apply-general owns:** T-RA-PC-03 (OpenCode generated), T-RA-PC-04 (Pi generated) — via `bun run scripts/generate-runner-execution-assets.ts`.
5. **Generated assets:** byte parity required; regenerate after source fixes before test execution.
6. Root cause `implementation` → `targeted_repair` (this batch).
7. Root cause `requirement`, `architecture`, `batch_shape` → `replan_spec` / `replan_design` / `replan_tasks`.
8. Root cause `oracle` → `correct_oracle` (non-modifying).
9. Any unrecognized combination → `stop`.

---

## G-RA-MT — Runner-authority mode-taxonomy repair (bounded 6-file ceiling)

> **Batch identity:** `deterministic-apply-verify-review-flow-runner-authority-mode-taxonomy-repair`
> **Ceiling:** exactly 6 files (2 canonical adapter TS + 2 generated JS + 2 reachability test)
> **Addresses:** `REVIEW-RA-PC-B4` (invalid mode fails open with valid provider), `REVIEW-RA-PC-B5` (OpenCode AUTHZ_MISSING vs Pi invalid-evidence taxonomy mismatch for missing receipt)
> **Spec digest (authoritative):** `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f`
> **Design digest (authoritative):** `sha256:9850e208e6f364232c4418481e6cc99eb063a68a1afdf77db52ae703ca2e9bc1`
> **Design-replan digest:** `sha256:7d389a846ca00c71c356ada41d78af4ffd0f140aa2acba431d1871611cb8306a`
> **Apply authority:** BLOCKED — requires new exact user message authorizing batch identity `deterministic-apply-verify-review-flow-runner-authority-mode-taxonomy-repair`

Full task definitions (RED/GREEN oracles, completion evidence, rollback, hard stops) are in `tasks-replan-runner-authority-mode-taxonomy-repair.md`. Summary:

| Task | Source files | Test/generated files | Covers |
|------|-------------|---------------------|--------|
| T-RA-MT-01 | `developer-team-execution.ts` (OpenCode) | — | B4: mode validation (unknown/null/string/object → invalid-evidence); B5: missing receipt from installed resolver → invalid-evidence (not AUTHZ_MISSING) |
| T-RA-MT-02 | — | `developer-team-execution.generated.js` (OpenCode) | Regenerate after T-RA-MT-01 |
| T-RA-MT-03 | — | `developer-team-execution-reachability.test.ts` (OpenCode) | B4/B5 tests: invalid mode at init, mutable invalid mode, absent resolver AUTHZ_MISSING, missing receipt → invalid-evidence |
| T-RA-MT-04 | `developer-team-execution.ts` (Pi) | — | B4: mode validation; B5: taxonomy parity confirmation for missing receipt |
| T-RA-MT-05 | — | `developer-team-execution.generated.js` (Pi) | Regenerate after T-RA-MT-04 |
| T-RA-MT-06 | — | `developer-team-execution-reachability.test.ts` (Pi) | B4/B5 tests: invalid mode at init, mutable invalid mode, absent resolver AUTHZ_MISSING, missing receipt → invalid-evidence |

**Dependency order:** T-RA-MT-01 → T-RA-MT-02 → T-RA-MT-03; T-RA-MT-04 → T-RA-MT-05 → T-RA-MT-06 (T-RA-MT-01 and T-RA-MT-04 can run in parallel)
**Complexity totals:** C3×4, C1×2 = C14
**Risk lane:** CRITICAL for all six tasks

### Dispatch policy for G-RA-MT

1. **TDD rule:** new tests (D-REACH-28..36, D-REACH-28..36-Pi) must RED before source changes and GREEN after fixes.
2. **Existing tests preserved:** all prior authority tests remain GREEN; B1-B3 tests from G-RA-PC remain GREEN; no existing test is modified.
3. **apply-backend owns:** T-RA-MT-01 (OpenCode adapter TS), T-RA-MT-04 (Pi adapter TS), T-RA-MT-03 (OpenCode tests), T-RA-MT-06 (Pi tests).
4. **apply-general owns:** T-RA-MT-02 (OpenCode generated), T-RA-MT-05 (Pi generated) — via `bun run scripts/generate-runner-execution-assets.ts`.
5. **Generated assets:** byte parity required; regenerate after source fixes before test execution.
6. Root cause `implementation` → `targeted_repair` (this batch).
7. Root cause `requirement`, `architecture`, `batch_shape` → `replan_spec` / `replan_design` / `replan_tasks`.
8. Root cause `oracle` → `correct_oracle` (non-modifying).
9. Any unrecognized combination → `stop`.
10. **Taxonomy parity:** OpenCode and Pi must return identical error codes for identical scenarios; `AUTHZ_MISSING` only when resolver is truly absent.

---

## G1 — New contracts

### T-01: FindingDispositionEnvelopeV1

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G1, no dependents yet) |
| **Depends on** | none |
| **Files (allowlist — source)** | `packages/sdd-runtime/src/contracts/finding-disposition.ts` |
| **Files (allowlist — test)** | `packages/sdd-runtime/src/contracts/finding-disposition.test.ts` |
| **Files (blocked)** | `packages/sdd-runtime/src/contracts/failure-manifest.ts` (read-only; V1 preserved) |
| **Verification** | RED: schema validation rejects missing/disputed finding IDs, non-disposition input, V1 digest change; GREEN: all four dispositions reachable, ambiguous→blocking fallback, baseline projection, no V1 ID/digest change |
| **Completion evidence** | TypeScript compiles; contract unit tests pass; V1 compatibility fixture unchanged |
| **Risk lane** | HIGH |
| **Rollback** | Delete `finding-disposition.ts`; revert to V1-only path |

---

### T-02: RoutingDecisionV1

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | parallel-safe (G1) |
| **Depends on** | T-01 (disposition envelope used by routing) |
| **Files (allowlist — source)** | `packages/sdd-runtime/src/contracts/routing-decision.ts` |
| **Files (allowlist — test)** | `packages/sdd-runtime/src/contracts/routing-decision.test.ts` |
| **Files (blocked)** | `packages/sdd-runtime/src/contracts/execution-decision.ts` (read-only; V1 preserved) |
| **Verification** | RED: total routing table covers all 12+ root causes, unknown→stop, mixed owner→split; GREEN: each route entry has stable destination+owner, semantic decision digest excludes prose/identity/timestamps |
| **Completion evidence** | RoutingDecisionV1 schema tests pass; total coverage test passes |
| **Risk lane** | HIGH |
| **Rollback** | Delete `routing-decision.ts` |

---

### T-03: BlockingRepairProjectionV1

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | parallel-safe (G1) |
| **Depends on** | T-01, T-02 |
| **Files (allowlist — source)** | `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` |
| **Files (allowlist — test)** | `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` |
| **Files (blocked)** | `packages/sdd-runtime/src/contracts/apply-batch.ts` (read-only; original batch preserved) |
| **Verification** | RED: rejects extra anchors/checks/targets, blocked-target intersection, stale authorization, excluded-change intersection; GREEN: minimality proven, original batch identity unchanged, projection digest stable |
| **Completion evidence** | Projection schema tests pass; minimality property test passes |
| **Risk lane** | CRITICAL |
| **Rollback** | Delete `blocking-repair-projection.ts` |

---

### T-04: ExecutionConvergenceDossierV1 + ExecutionConvergenceStateV1

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | parallel-safe (G1) |
| **Depends on** | T-01, T-02, T-03 |
| **Files (allowlist — source)** | `packages/sdd-runtime/src/contracts/execution-convergence.ts` |
| **Files (allowlist — test)** | `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` |
| **Files (blocked)** | `packages/sdd-runtime/src/contracts/execution-dossier.ts` (read-only; V1 dossier preserved) |
| **Verification** | RED: append-only revision validation, predecessor digest mismatch rejected, invalid state transition rejected; GREEN: state machine transitions match design table, generation increments on repair |
| **Completion evidence** | Convergence dossier/state schema tests pass; state machine transition oracle tests pass |
| **Risk lane** | HIGH |
| **Rollback** | Delete `execution-convergence.ts` |

---

## G2 — Orchestrator policy

### T-05: Decision kernel — total routing table

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | sequential (G2, depends on G1) |
| **Depends on** | T-01, T-02 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/decision-kernel.ts` |
| **Files (blocked)** | Any other orchestrator file; any contract file (read-only boundary) |
| **Verification** | RED: every root cause maps to exactly one destination, protected-risk→escalate dominates, mixed-owner→split_required; GREEN: routing table matches design.md table exactly, unknown→stop fail-closed |
| **Completion evidence** | `decision-kernel.test.ts` covers all 12+ root causes and override rows; existing V1 tests still pass |
| **Risk lane** | CRITICAL |
| **Rollback** | Revert decision-kernel.ts to pre-T-05 state |

---

### T-06: Failure delta — blocking progress computation

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | sequential (G2) |
| **Depends on** | T-01, T-05 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/failure-delta.ts` |
| **Files (blocked)** | Any other orchestrator file |
| **Verification** | RED: recommendation/deferred/pre-existing contribute zero progress; blocking regressions dominate; GREEN: `computeBlockingProgressV1` produces correct progress sets, positive progress proven only by resolved active blockers |
| **Completion evidence** | `failure-delta.test.ts` disposition-aware progress tests pass |
| **Risk lane** | HIGH |
| **Rollback** | Revert failure-delta.ts |

---

### T-07: Staged verification — Review gate and state machine

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | sequential (G2) |
| **Depends on** | T-04, T-05 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/staged-verification.ts` |
| **Files (blocked)** | Any other orchestrator file |
| **Verification** | RED: Review not scheduled while scoped incomplete, no stage-skip, mandatory broad floors enforced; GREEN: targeted→affected→review_pending→broad sequence matches design state machine |
| **Completion evidence** | `staged-verification.test.ts` pre-Review-gate tests pass; existing staged tests still pass |
| **Risk lane** | HIGH |
| **Rollback** | Revert staged-verification.ts |

---

### T-08: Freshness policy — post-repair invalidation and Review reuse

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P1 |
| **Complexity** | C3 |
| **Parallel** | sequential (G2) |
| **Depends on** | T-04, T-06, T-07 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/freshness-policy.ts` |
| **Files (blocked)** | Any other orchestrator file |
| **Verification** | RED: stale post-modification evidence rejected, Review reuse requires unchanged reviewed deps; GREEN: dependency digest comparison correct, stale→fresh transition produces correct invalidation records |
| **Completion evidence** | `freshness-policy.test.ts` post-repair invalidation tests pass |
| **Risk lane** | MEDIUM |
| **Rollback** | Revert freshness-policy.ts |

---

## G3 — Execution / registry

### T-09: Execution control plane — convergence scheduling and result consumption

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C5 |
| **Parallel** | sequential (G3) |
| **Depends on** | T-04, T-05, T-06, T-07, T-08 |
| **Files (allowlist)** | `packages/sdd-runtime/src/execution/execution-control-plane.ts` |
| **Files (blocked)** | Any other execution file; any adapter file |
| **Verification** | RED: Review never parallel with Verify, Review gate enforced before broad, generation increment triggers scoped invalidation; GREEN: role invocation envelopes include convergence digest/generation/dependency-set, result consumption validates exact equality on all new fields |
| **Completion evidence** | `execution-control-plane.test.ts` convergence scheduling tests pass; `execution-role-scheduler.test.ts` pre-broad Review oracle updated |
| **Risk lane** | CRITICAL |
| **Rollback** | Revert execution-control-plane.ts to pre-convergence state; keep V1 replay path intact |

---

### T-10: Repair loop governance — unified retry identity

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P1 |
| **Complexity** | C4 |
| **Parallel** | sequential (G3) |
| **Depends on** | T-03, T-06, T-09 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/repair-loop-governance.ts` |
| **Files (blocked)** | Any other orchestrator file |
| **Verification** | RED: changed blocking set creates new identity, no-progress→checkpoint once→replan/escalation, negative progress→stop; GREEN: `evaluateRepairIncident()` as restrictive guard (never converts checkpoint→repair), compatibility projection recorded |
| **Completion evidence** | `repair-loop-governance.test.ts` unified identity tests pass; legacy incident tests still pass |
| **Risk lane** | HIGH |
| **Rollback** | Revert repair-loop-governance.ts |

---

### T-11: Registry coordinator — atomic intent chain commit

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | sequential (G3) |
| **Depends on** | T-04, T-09 |
| **Files (allowlist)** | `packages/sdd-runtime/src/artifact-state/registry-coordinator.ts` |
| **Files (blocked)** | Any other artifact-state file; any spec-registry file beyond what is needed for coordinator |
| **Verification** | RED: stale base→conflict with recovery guidance, partial chain never committed, recovery-required→hard stop; GREEN: `commitIntentChainV1` atomically commits full ordered chain in one filesystem transaction |
| **Completion evidence** | Registry coordinator chain tests pass; existing single-intent commit tests still pass |
| **Risk lane** | CRITICAL |
| **Rollback** | Revert registry-coordinator.ts; existing `commit` and `commitAll` remain available for legacy consumers |

---

## G4 — Canonical prompts

### T-12: Orchestrator prompt — remove legacy parallelism, express canonical flow

| Field | Value |
|-------|-------|
| **Owner** | `apply-general` |
| **Priority** | P1 |
| **Complexity** | C2 |
| **Parallel** | sequential (G4, after T-09 demonstrates runtime ordering) |
| **Depends on** | T-09 (runtime scheduling proven) |
| **Files (allowlist)** | `packages/core/src/teams/developer/orchestrator-content.ts` |
| **Files (blocked)** | Any other prompt source; any generated file |
| **Verification** | RED: no statement that Verify and Review run in parallel after Apply; GREEN: canonical lifecycle described as targeted→affected→Review→broad, no contradictory choreography |
| **Completion evidence** | `orchestrator-content.test.ts` prompt parity tests pass |
| **Risk lane** | MEDIUM |
| **Rollback** | Revert orchestrator-content.ts to pre-T-12 state |

> **Note:** orchestrator-content.ts is already updated by T-RA-01 (G-RA runner-authority batch) before this task runs. T-RA-01 removes the caller-authority instruction. T-12 makes additional changes to remove legacy parallelism language and express canonical flow. These are independent changes to the same file; T-RA-01 runs first and does not block T-12.

---

### T-13: Apply/Verify/Review prompts — clarify evidence and disposition

| Field | Value |
|-------|-------|
| **Owner** | `apply-general` (coordinate), `apply-backend`, `apply-frontend`, `verify`, `review` |
| **Priority** | P1 |
| **Complexity** | C2 |
| **Parallel** | parallel-safe within G4 (independent prompts) |
| **Depends on** | T-12 (orchestrator context set) |
| **Files (allowlist)** | `packages/core/src/teams/developer/apply-general-content.ts`, `apply-backend-content.ts`, `apply-frontend-content.ts`, `verify-content.ts`, `review-content.ts` |
| **Files (blocked)** | Any generated file; any other prompt source |
| **Verification** | RED: Apply prompts do not claim self-verify equals independent Verify; Verify prompts require disposition on findings; Review prompts require blocking-only authorization; GREEN: all six prompt parity tests pass |
| **Completion evidence** | All six prompt-content tests pass |
| **Risk lane** | MEDIUM |
| **Rollback** | Revert individual content files to pre-T-13 state |

---

## G5 — Contract + policy tests

### T-14: FindingDispositionEnvelopeV1 tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G5) |
| **Depends on** | T-01 |
| **Files (allowlist)** | `packages/sdd-runtime/src/contracts/finding-disposition.test.ts` (new) |
| **Files (blocked)** | Existing V1 fixture files (read-only) |
| **Verification** | RED: four dispositions reachable, ambiguous→blocking, baseline→pre-existing, V1 projection non-destructive; GREEN: all disposition tests pass |
| **Completion evidence** | `finding-disposition.test.ts` 100% pass |
| **Risk lane** | HIGH |
| **Rollback** | Delete finding-disposition.test.ts |

---

### T-15: RoutingDecisionV1 tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G5) |
| **Depends on** | T-02 |
| **Files (allowlist)** | `packages/sdd-runtime/src/contracts/routing-decision.test.ts` (new) |
| **Files (blocked)** | Existing routing fixtures (read-only) |
| **Verification** | RED: total table coverage, mixed-owner split, stable digest; GREEN: all routing tests pass |
| **Completion evidence** | `routing-decision.test.ts` 100% pass |
| **Risk lane** | HIGH |
| **Rollback** | Delete routing-decision.test.ts |

---

### T-16: BlockingRepairProjectionV1 tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G5) |
| **Depends on** | T-03 |
| **Files (allowlist)** | `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` (new) |
| **Files (blocked)** | Existing batch/dossier fixtures (read-only) |
| **Verification** | RED: minimality enforced, original batch identity preserved, effect-boundary rejects oversized/mismatched; GREEN: all projection tests pass |
| **Completion evidence** | `blocking-repair-projection.test.ts` 100% pass |
| **Risk lane** | CRITICAL |
| **Rollback** | Delete blocking-repair-projection.test.ts |

---

### T-17: State machine + convergence dossier tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | parallel-safe (G5) |
| **Depends on** | T-04 |
| **Files (allowlist)** | `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` (new) |
| **Files (blocked)** | Existing dossier fixtures (read-only) |
| **Verification** | RED: all state transitions from design table, generation increment, invalid transitions rejected; GREEN: all convergence state tests pass |
| **Completion evidence** | `execution-convergence.test.ts` 100% pass |
| **Risk lane** | HIGH |
| **Rollback** | Delete execution-convergence.test.ts |

---

### T-18: Blocking progress + retry governance tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G5) |
| **Depends on** | T-06, T-10 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/failure-delta.test.ts` (augment), `packages/sdd-runtime/src/orchestrator/repair-loop-governance.test.ts` (augment) |
| **Files (blocked)** | Existing V1 delta tests (read-only oracle) |
| **Verification** | RED: non-blocking zero progress, positive progress gate, no-progress checkpoint, negative progress stop, loop ceiling; GREEN: augmented tests pass, existing tests still pass |
| **Completion evidence** | Augmented `failure-delta.test.ts` and `repair-loop-governance.test.ts` 100% pass |
| **Risk lane** | HIGH |
| **Rollback** | Revert augmentation to pre-T-18 |

---

### T-19: Staged verification + freshness policy tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G5) |
| **Depends on** | T-07, T-08 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/staged-verification.test.ts` (augment), `packages/sdd-runtime/src/orchestrator/freshness-policy.test.ts` (augment) |
| **Files (blocked)** | Existing staged/freshness tests (read-only oracle) |
| **Verification** | RED: Review gate enforced, dependency invalidation correct, Review reuse/refresh conditions; GREEN: augmented tests pass, existing tests still pass |
| **Completion evidence** | Augmented `staged-verification.test.ts` and `freshness-policy.test.ts` 100% pass |
| **Risk lane** | HIGH |
| **Rollback** | Revert augmentation to pre-T-19 |

---

### T-20: Decision kernel total-table + mixed-owner tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G5) |
| **Depends on** | T-05 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/decision-kernel.test.ts` (augment) |
| **Files (blocked)** | Existing decision-kernel tests (read-only oracle) |
| **Verification** | RED: all 12+ root causes routed correctly, override rows dominate, mixed-owner→split; GREEN: augmented kernel tests pass, existing tests still pass |
| **Completion evidence** | Augmented `decision-kernel.test.ts` 100% pass |
| **Risk lane** | HIGH |
| **Rollback** | Revert augmentation to pre-T-20 |

---

## G6 — Integration + acceptance tests

### T-21: Control plane + scheduler integration tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | parallel-safe (G6) |
| **Depends on** | T-09 |
| **Files (allowlist)** | `packages/sdd-runtime/src/execution/execution-control-plane.test.ts` (augment), `packages/sdd-runtime/src/execution/execution-role-scheduler.test.ts` (augment) |
| **Files (blocked)** | Existing E2E fixtures for other changes |
| **Verification** | RED: convergence scheduling, Review gate, generation invalidation, role result binding; GREEN: augmented control-plane/scheduler tests pass |
| **Completion evidence** | Augmented tests 100% pass; TypeScript compiles |
| **Risk lane** | HIGH |
| **Rollback** | Revert augmentation to pre-T-21 |

---

### T-22: Effect boundary + projection enforcement tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G6) |
| **Depends on** | T-03, T-09 |
| **Files (allowlist)** | `packages/sdd-runtime/src/execution/execution-adapter-port.test.ts` (augment), `packages/sdd-runtime/src/execution/execution-composition.test.ts` (augment) |
| **Files (blocked)** | Existing adapter fixtures |
| **Verification** | RED: effect boundary rejects non-blocking, non-homogeneous, oversized, stale, unauthorized, Git-unsafe, excluded-scope projections; GREEN: augmented effect tests pass |
| **Completion evidence** | Augmented effect boundary tests 100% pass |
| **Risk lane** | CRITICAL |
| **Rollback** | Revert augmentation to pre-T-22 |

---

### T-23: E2E convergence + registry chain tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | parallel-safe (G6) |
| **Depends on** | T-11, T-21 |
| **Files (allowlist)** | `packages/sdd-runtime/src/execution/developer-team-convergence.e2e.test.ts` (augment), `packages/sdd-runtime/src/artifact-state/registry-coordinator.test.ts` (augment) |
| **Files (blocked)** | Other E2E fixtures |
| **Verification** | RED: end-to-end role order, atomic registry chain, stale base conflict, no partial commit; GREEN: augmented E2E + registry tests pass |
| **Completion evidence** | Augmented E2E + registry tests 100% pass |
| **Risk lane** | HIGH |
| **Rollback** | Revert augmentation to pre-T-23 |

---

### T-24: Adapter bridge + prompt parity tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` (with `verify`, `review` roles for parity) |
| **Priority** | P1 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G6) |
| **Depends on** | T-12, T-13, T-21 |
| **Files (allowlist)** | OpenCode bridge test (if exists), Pi bridge test (if exists), `packages/core/src/teams/developer/orchestrator-content.test.ts` (augment), all 6 `*-content.test.ts` files (augment) |
| **Files (blocked)** | Generated files; other change artifacts |
| **Verification** | RED: canonical prompt invariant parity, no contradictory choreography, bridge uses shared runtime path; GREEN: all augmented prompt-parity tests pass |
| **Completion evidence** | All augmented prompt-content tests + adapter bridge tests 100% pass |
| **Risk lane** | MEDIUM |
| **Rollback** | Revert prompt augmentation to pre-T-24 |

---

## Dependency order (execution sequence)

```
G-RA: T-RA-01 → T-RA-02 → T-RA-03 → T-RA-04 → T-RA-05 → T-RA-06 → T-RA-07 → T-RA-08
        (orchestrator-content.ts + test, then OpenCode adapter + generated + tests, then Pi adapter + generated + tests)

G-REC: T-REC-01 → T-REC-02 → T-REC-03 → T-REC-04
G-EA:  T-EA-01 → T-EA-02 → T-EA-03   (NOT APPROVED — requires named human approval)

G1: T-01 → T-02 → T-03 → T-04    (contracts, no dependencies on each other beyond stated)

G2: T-05 → T-06 → T-07 → T-08    (orchestrator policy, each depends on G1)
        T-05 depends on T-01, T-02
        T-06 depends on T-01, T-05
        T-07 depends on T-04, T-05
        T-08 depends on T-04, T-06, T-07

G3: T-09 → T-10 → T-11            (execution/registry, depends on G1+G2)
        T-09 depends on T-04, T-05, T-06, T-07, T-08
        T-10 depends on T-03, T-06, T-09
        T-11 depends on T-04, T-09

G4: T-12 → T-13                   (prompts, depends on G3 runtime)
        T-12 depends on T-09
        T-13 depends on T-12

G5: T-14..T-20                    (contract+policy tests, parallel after respective prod code)
        T-14 ← T-01
        T-15 ← T-02
        T-16 ← T-03
        T-17 ← T-04
        T-18 ← T-06, T-10
        T-19 ← T-07, T-08
        T-20 ← T-05

G6: T-21..T-24                    (integration+acceptance tests, parallel after G5)
        T-21 ← T-09
        T-22 ← T-03, T-09
        T-23 ← T-11, T-21
        T-24 ← T-12, T-13, T-21
```

---

## Review Workload Forecast

| Reviewer pool | Estimated tasks requiring independent Review |
|---------------|---------------------------------------------|
| `apply-backend` (self-review for G-RA, G1-G3) | T-RA-01..T-RA-08, T-01..T-11 — independent Review by a second `apply-backend` instance |
| `apply-general` (G-RA orchestrator prompts) | T-RA-01, T-RA-02 — Review by `review` role |
| `apply-general` (G4 prompts) | T-12, T-13 — Review by `review` role |
| `verify` (test verification) | T-RA-07, T-RA-08, T-14..T-24 — Review by `review` role |
| `review` (final acceptance) | T-RA-07, T-RA-08, T-14..T-24 — independent `review` role |

**Independent Verify**: Each of T-RA-07, T-RA-08, T-14..T-24 requires a fresh `verify`-role instance to prove staged verification passes before Review runs.

**G-RA Review priority**: Given `REVIEW-G2-G6-PI-B1-CALLER-SUPPLIED-AUTHORITY` is critical, T-RA-03 through T-RA-08 (adapter + generated + reachability tests) should receive independent Review immediately after Verify confirms the new behavioral oracles pass.

## Complexity summary

| ID | Area | Complexity | Notes |
|----|------|------------|-------|
| T-RA-01 | Orchestrator prompt (runner-authority fix) | C2 | Remove caller-authority instruction |
| T-RA-02 | Orchestrator test update | C1 | Update deckExecution assertions |
| T-RA-03 | OpenCode adapter strip/fallback removal | C3 | Remove caller fallback, pin provider |
| T-RA-04 | OpenCode generated asset | C1 | Regenerate from fixed source |
| T-RA-05 | Pi adapter strip/fallback removal | C3 | Remove caller fallback, pin provider |
| T-RA-06 | Pi generated asset | C1 | Regenerate from fixed source |
| T-RA-07 | OpenCode reachability (runner-authority) | C3 | New behavioral oracles |
| T-RA-08 | Pi reachability (runner-authority) | C3 | New behavioral oracles |
| T-REC-01 | FD contract recovery | C4 | |
| T-REC-02 | Routing contract recovery | C4 | |
| T-REC-03 | Projection contract recovery | C5 | |
| T-REC-04 | Convergence contract recovery | C5 | |
| T-EA-01 | Effect-authority B1 | C5 | |
| T-EA-02 | Effect-authority B2 | C5 | |
| T-EA-03 | Effect-authority B3 | C5 | |
| T-01 | FD contract | C3 | New schema, 4-disposition logic |
| T-02 | Routing contract | C4 | 12+ root-cause table, stable digest |
| T-03 | Projection contract | C4 | Effect boundary, minimality |
| T-04 | Convergence state | C4 | State machine, 8+ transitions |
| T-05 | Decision kernel | C4 | Routing dispatch, override rows |
| T-06 | Failure delta | C3 | Progress computation |
| T-07 | Staged verification | C4 | Review gate, broad ordering |
| T-08 | Freshness policy | C3 | Dependency digest, invalidation |
| T-09 | Control plane | C5 | Scheduling, result consumption, generation |
| T-10 | Repair governance | C4 | Unified identity, ledger |
| T-11 | Registry coordinator | C4 | Atomic chain commit |
| T-12 | Orchestrator prompt | C2 | Remove legacy contradiction |
| T-13 | Role prompts (5 files) | C2 | Clarify evidence/authorization |
| T-14 | FD contract tests | C3 | |
| T-15 | Routing tests | C3 | |
| T-16 | Projection tests | C3 | |
| T-17 | Convergence state tests | C4 | |
| T-18 | Progress+governance tests | C3 | |
| T-19 | Staged+freshness tests | C3 | |
| T-20 | Kernel table tests | C3 | |
| T-21 | Control plane integration | C4 | |
| T-22 | Effect boundary tests | C3 | |
| T-23 | E2E+registry chain tests | C4 | |
| T-24 | Bridge+prompt parity tests | C3 | |

**Complexity totals: C1×2, C2×4, C3×14, C4×11, C5×8**

## Open Questions / Blockers

### Classified as Open Questions (resolved by Design, not blocking Apply)

All 11 Spec OQs (OQ-1..OQ-11) are resolved by design.md and are **not** blockers to Tasks.

### Classified as Blockers to Apply (not to Tasks)

- **Spec SHA-256 drift**: if spec.md changes (verified by digest), Tasks must be reconciled before Apply. Authoritative digest is `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f`.
- **Design SHA-256 drift**: if design.md changes (verified by digest), Tasks must be reconciled before Apply. Authoritative digest is `9850e208e6f364232c4418481e6cc99eb063a68a1afdf77db52ae703ca2e9bc1`.
- **Design-replan SHA-256 drift**: if design-replan-runner-authority.md changes, Tasks must be reconciled. Authoritative digest is `7d389a846ca00c71c356ada41d78af4ffd0f140aa2acba431d1871611cb8306a`.
- **Target allowlist intersection with existing OpenSpec change**: any overlap with another active change's targets hard-stops that task's batch.
- **`runner-capability-standardization` intersection**: hard stop on any target, repair route, or scope expansion.
- **V1 compatibility regression**: any existing V1 fixture or replay test failing after implementation must be diagnosed before the next modifying batch.
- **Adaptive-quality-control ceiling hit**: repeated verify/fix cycles on same identity reaching the configured ceiling without successful repair must trigger replan/split/escalation before another Apply batch is issued.
- **Pi worktree state**: the pre-existing uncommitted Pi canonical source changes must be reconciled in place during T-RA-05. Apply must not use git discard/restore/checkout to eliminate these changes. The worktree evidence is an independent signal, not pre-approval for the runner-authority batch.

### No Unresolved External Preconditions

All inputs are available in the current repository state. No external service, human approval gate, or remote artifact is required before Tasks can proceed, except named human approval for the runner-authority batch identity.

---

## Phase Result Summary

| Field | Value |
|-------|-------|
| **Status** | `tasks_replan_completed` |
| **Recommended next action** | `human_approval_required` — user must authorize `deterministic-apply-verify-review-flow-runner-authority-g2-g6` in a new explicit message before any modifying attempt |
| **Tasks total** | 39 (8 G-RA + 7 recovery + 24 original) |
| **Groups total** | 9 (G-RA + G-REC + G-EA + G1..G6) |
| **Dependency order** | G-RA (T-RA-01→T-RA-02→T-RA-03→T-RA-04→T-RA-05→T-RA-06→T-RA-07→T-RA-08) → G-REC → G-EA → G1 → G2 → G3 → G4 → G5 → G6 |
| **Runner-authority batch identity** | `deterministic-apply-verify-review-flow-runner-authority-g2-g6` |
| **Runner-authority batch ceiling** | exactly 8 files: `orchestrator-content.ts`, `orchestrator-content.test.ts`, `developer-team-execution.ts` (OpenCode), `developer-team-execution.ts` (Pi), `developer-team-execution.generated.js` (OpenCode), `developer-team-execution.generated.js` (Pi), `developer-team-execution-reachability.test.ts` (OpenCode), `developer-team-execution-reachability.test.ts` (Pi) |
| **Apply readiness** | **NOT AUTHORIZED.** No Apply, G2, repair-3, or scope expansion is authorized by this Task replan. A new explicit named human-approved batch identity is required through the normal OpenSpec workflow before any modifying attempt. |
| **G2 Apply** | **BLOCKED** — explicit prohibition in all dispatch policy entries |
| **repair-3** | **PROHIBITED** — exhausted G1 two-attempt budget not reopened |
| **Spec/Design replan required for runner-authority** | **NO** — design-replan-runner-authority.md resolved the architecture |
| **Blockers to Apply** | (1) spec SHA-256 drift from `374a8fb1...`; (2) design SHA-256 drift from `9850e208...`; (3) design-replan SHA-256 drift from `7d389a84...`; (4) target intersection; (5) Pi worktree state reconciliation; (6) V1 regression; (7) missing named human-approved batch identity for runner-authority batch |
| **FailureManifestV1** | none (forward reconciliation, not a reactive batch failure) |
| **RegistryIntentV1 values** | `[]` — no intent emitted by this bounded Task replan |
| **Risk lane** | CRITICAL for T-RA-03..T-RA-08, T-REC-01..T-REC-04, T-EA-01..T-EA-03, T-03, T-09, T-11, T-22 |
| **Complexity floor** | C1 (test updates); ceiling C5 (control plane + convergence authority + effect-authority recovery + runner-authority critical path) |
| **Spec SHA-256** | `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` |
| **Design SHA-256** | `sha256:9850e208e6f364232c4418481e6cc99eb063a68a1afdf77db52ae703ca2e9bc1` |
| **Design-replan SHA-256** | `sha256:7d389a846ca00c71c356ada41d78af4ffd0f140aa2acba431d1871611cb8306a` |

---

## Dispatch Policy (official — applies to all Apply batches from this change)

1. **Only implementation defects are eligible for `targeted_repair` (Apply)**.
2. Root cause `implementation` + fully anchored blocking + scope-valid + policy-permitted → `targeted_repair`.
3. Root cause `implementation` + missing anchors or scope growth → `replan_tasks`.
4. Root cause `requirement` → `replan_spec`.
5. Root cause `architecture` → `replan_design`.
6. Root cause `oracle` → `correct_oracle` (non-modifying; requires new Task/Apply batch for source/test changes).
7. Root cause `environment`, `transport`, `capability` + diagnosable evidence → `verify_runtime_diagnosis` (non-modifying; escalates if unresolved).
8. Root cause `security` or `data-loss protected-risk` → `escalate` / `human` (never downgraded).
9. Root cause `authorization` or `git_safety` → `stop`.
10. Root cause `unknown` + diagnosable → `verify_runtime_diagnosis`; otherwise → `escalate`.
11. Mixed owner destinations → `split_required` (no single Apply batch authorized).
12. Any unrecognized combination → `stop` (fail closed, no permissive default).
13. **No Apply batch may be issued for a finding with disposition `recommendation`, `deferred`, or `pre-existing`**, individually or in aggregate.
14. **No Apply batch may be issued for a target intersecting `runner-capability-standardization`** or any other active OpenSpec change.
15. Retry identity is authoritative for modifying retries; legacy `RepairIncident` is a restrictive guard only (never converts checkpoint→repair).
16. **G2_apply is BLOCKED.** No `G2_apply` route may be authorized for any finding in any batch from this change.
17. **repair-3 is PROHIBITED.** The exhausted G1 two-attempt budget is not reopened, reset, or converted into an authorize-anyway path.
18. **No modifying batch may be issued without a new explicit human-approved batch identity.**

(End of file — total lines: ~900)

# Preconditions: Deterministic Apply → Verify → Review Flow

## Change identity

- **Change ID:** `deterministic-apply-verify-review-flow`
- **Execution mode:** Automatic
- **Phase:** tasks (replan)

## Precondition assessment

### External / User Preconditions

| Condition | Status | Notes |
|-----------|--------|-------|
| Spec SHA-256 matches authoritative artifact | **SATISFIED** | `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` — confirmed against design.md authoritative binding |
| Design SHA-256 matches authoritative artifact | **SATISFIED** | `9850e208e6f364232c4418481e6cc99eb063a68a1afdf77db52ae703ca2e9bc1` — revised; resolves `REVIEW-G2-G6-PI-B1-CALLER-SUPPLIED-AUTHORITY` |
| Design-replan SHA-256 | **SATISFIED** | `7d389a846ca00c71c356ada41d78af4ffd0f140aa2acba431d1871611cb8306a` — `design-replan-runner-authority.md` |
| Design decisions complete | **SATISFIED** | All 11 Spec OQs (OQ-1..OQ-11) resolved; runner-authority resolved by design-replan |
| Proposal approved | **SATISFIED** | `proposal.md` exists and authorized Spec + Design to proceed |
| Exploration complete | **SATISFIED** | `exploration.md` complete; B1–B6 identified and addressed by Spec/Design |
| User authorized this change | **SATISFIED** | Explicit user request for `deterministic-apply-verify-review-flow` in Automatic mode |
| OpenSpec initialized | **SATISFIED** | `openspec/config.yaml` initialized: `initialized: true` |
| Baseline ledger present | **SATISFIED** | `openspec/baseline-health.yaml` exists with exact known failure fingerprint |
| Registry schema present | **SATISFIED** | `openspec/registry-schema.md` exists and defines centralized lifecycle |
| Promoted specs available | **SATISFIED** | `adaptive-quality-control`, `artifact-state-contracts`, `runner-orchestration-resilience` all referenced and accessible |
| No `runner-capability-standardization` dependency | **SATISFIED** | Explicitly excluded by exploration, proposal, spec, and design |

### Runtime / Repository Preconditions

| Condition | Status | Notes |
|-----------|--------|-------|
| Worktree clean (or Git discard protection satisfied) | **VERIFY BEFORE APPLY** | Pre-batch gate classifies own-change untracked planning artifacts as **expected** and **not a discard reason**. Expected untracked: `openspec/changes/deterministic-apply-verify-review-flow/**` (tasks.md, preconditions.md, design.md, spec.md, exploration.md, proposal.md, design-replan-runner-authority.md, tasks-replan-runner-authority.md, and companion planning artifacts). The gate **blocks**: (1) any modified tracked source/test/config file unrelated to the current change; (2) any untracked file outside `openspec/changes/deterministic-apply-verify-review-flow/`; (3) any generated output file (`*.generated.ts`, `build-info.generated.ts`, etc.). **Pi worktree note**: pre-existing uncommitted Pi canonical source modifications (`sha256:e24e50d2cc867a11cb2e9000f1c132efbeb387f255d79966fc780f1e7c1544eb`) are **worktree evidence only**; they must be reconciled in place during T-RA-05 without git discard/restore/checkout. Git discard safeguards (git-safety.ts protocol) remain in force for all destructive operations. |
| Existing V1 contracts readable | **SATISFIED** | `failure-manifest.ts`, `apply-batch.ts`, `execution-dossier.ts`, `execution-decision.ts` all readable |
| Existing orchestrator policy readable | **SATISFIED** | `decision-kernel.ts`, `failure-delta.ts`, `staged-verification.ts`, `freshness-policy.ts`, `repair-loop-governance.ts` all readable |
| Execution control plane readable | **SATISFIED** | `execution-control-plane.ts` readable |
| Registry coordinator readable | **SATISFIED** | `registry-coordinator.ts` readable |
| Canonical prompt sources readable | **SATISFIED** | All 6 `*-content.ts` files readable including `orchestrator-content.ts` |
| OpenCode adapter source readable | **SATISFIED** | `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts` readable |
| Pi adapter source readable | **SATISFIED** | `packages/adapter-pi/assets/pi/extensions/developer-team-execution.ts` readable (worktree evidence with pre-existing uncommitted changes) |
| Existing test infrastructure | **SATISFIED** | Bun test runner available; existing test files readable as oracle |
| TypeScript compiler available | **SATISFIED** | `tsc --noEmit` available per `openspec/config.yaml` |
| Generator script available | **SATISFIED** | `scripts/generate-runner-execution-assets.ts` exists and is executable |

### Authorization Preconditions

| Condition | Status | Notes |
|-----------|--------|-------|
| No target intersection with another active OpenSpec change | **VERIFY PER TASK** | Must be checked at each batch issuance; no known intersection identified in tasks |
| No target intersection with `runner-capability-standardization` | **SATISFIED** | Hard exclusion confirmed in all artifacts |
| No historical OpenSpec change target conflict | **SATISFIED** | `developer-team-execution-convergence/**` is read-only evidence; not a modification target |
| Generated files not in any target allowlist | **SATISFIED** | Generated files are downstream effects only; explicitly blocked in all task target lists |

### Spec Digest Precondition for Apply

> **CRITICAL**: The Spec SHA-256 `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` must be confirmed **immediately before** the first Apply batch is issued. If the spec.md artifact has been modified (even whitespace), reconciliation is required before any modifying batch is authorized.
>
> **ALSO REQUIRED**: Design SHA-256 `9850e208e6f364232c4418481e6cc99eb063a68a1afdf77db52ae703ca2e9bc1` must be confirmed immediately before any modifying batch is issued.
>
> **ALSO REQUIRED**: Design-replan SHA-256 `7d389a846ca00c71c356ada41d78af4ffd0f140aa2acba431d1871611cb8306a` (design-replan-runner-authority.md) must be confirmed immediately before the runner-authority batch is issued.
>
> **RUNNER-AUTHORITY BATCH CEILING**: `deterministic-apply-verify-review-flow-runner-authority-g2-g6` is bounded to exactly 8 files: 2 source (orchestrator-content.ts + Pi adapter), 2 test (orchestrator-content test + Pi reachability), 2 generated (OpenCode + Pi), and 2 canonical (OpenCode adapter + OpenCode reachability). No index, fixture, orchestrator policy, execution, prompt other than named, registry YAML, other OpenSpec change, or historical target may be added.
>
> **Pi WORKTREE NOTE**: The pre-existing uncommitted Pi canonical source modifications (worktree evidence, digest `e24e50d2cc867a11cb2e9000f1c132efbeb387f255d79966fc780f1e7c1544eb`) must be reconciled **in place** during T-RA-05. Apply must not use git discard/restore/checkout/clean to eliminate these changes. They represent independent worktree evidence, not pre-approval for the runner-authority batch.
>
> **RECOVERY BATCH CEILING (G1)**: `deterministic-apply-verify-review-flow-recovery-batch-g1` is bounded to exactly 8 files (4 source + 4 test). No index, fixture, orchestrator, execution, adapter, prompt, generated, config, registry YAML, other OpenSpec change, or historical target may be added.
>
> **EFFECT-AUTHORITY PROPOSED BATCH**: `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority` is defined in `tasks-replan-effect-authority.md`. **NOT APPROVED** — requires named human approval before any modifying attempt. Spec/Design replan is NOT required — Review confirmed the revised Spec and Design already require the missing boundaries. The proposed batch ceiling is exactly 8 files (4 source + 4 test), same as the G1 recovery batch.
>
> **RUNNER-AUTHORITY G2-G6 REPAIR-1 BATCH**: `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-1` is defined in `tasks-replan-runner-authority-repair-1.md`. **NOT APPROVED** — requires a new exact user message authorizing the batch identity string. Addresses findings `VERIFY-G2-G6-TARGETED-GEN-OPEN-SPEC-PATH` (oracle correction — no source change) and `VERIFY-G2-G6-AFFECTED-CORE-PROMPT-PROFILE-BYTE-DRIFT` (byte drift: LEGACY_BYTES 365023→365242). Batch ceiling is exactly 1 file: `packages/core/src/teams/developer/prompt-profile.test.ts`. No other file is authorized for this batch.
>
> **RUNNER-AUTHORITY G2-G6 REPAIR-2 BATCH**: `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-2` is defined in `tasks-replan-runner-authority-repair-2.md`. **NOT APPROVED** — requires a new exact user message authorizing the batch identity string. Addresses finding `APPLY-G2-G6-REP1-LEXICAL-TOKENS-ORACLE-DRIFT` (lexical tokens drift: LEGACY_LEXICAL_TOKENS 79051→79092). Batch ceiling is exactly 1 file: `packages/core/src/teams/developer/prompt-profile.test.ts`. No other file is authorized for this batch. LEGACY_BYTES (365_242 from repair-1) is preserved and not touched.
>
> **RUNNER-AUTHORITY G2-G6 PROMPT-PROFILE-ORACLE-COMPLETION BATCH**: `deterministic-apply-verify-review-flow-runner-authority-prompt-profile-oracle-completion` is defined in `tasks-replan-runner-authority-oracle-completion.md`. **NOT APPROVED** — requires a new exact user message authorizing the batch identity string. **NOT repair-3** — G1 `repair-3` remains PROHIBITED (exhausted two-attempt budget not reopened). This is a newly authorized normal-workflow oracle-completion batch after Task-plan omissions, not reopening G1 repair governance. Addresses finding `APPLY-G2-G6-REP2-SHA256-ORACLE-DRIFT` (SHA256 drift: LEGACY_SHA256 expected 4eb4caaeb... received 617d5891...). Batch ceiling is exactly 1 file: `packages/core/src/teams/developer/prompt-profile.test.ts`. LEGACY_BYTES (365_242 from repair-1) and LEGACY_LEXICAL_TOKENS (79_092 from repair-2) are preserved and not touched.
>
> **PROVIDER-CAPTURE REPAIR BATCH**: `deterministic-apply-verify-review-flow-runner-authority-provider-capture-repair` is defined in `tasks-replan-runner-authority-provider-capture-repair.md`. **NOT APPROVED** — requires a new exact user message authorizing the batch identity string. Addresses findings `REVIEW-RA-FINAL-B1` (provider/global options re-read during Apply; late provider installation authorizes effects), `REVIEW-RA-FINAL-B2` (installed resolver returning null/non-object is malformed evidence → invalid-evidence), and `REVIEW-RA-FINAL-B3` (add explicit non-Apply role tests for both runners proving caller deckExecution is stripped, provider not called, zero bridge/effect, and no specialist leakage). Batch ceiling is exactly 6 files (2 canonical adapter TS + 2 generated JS + 2 reachability test). Spec/Design replan is NOT required — the authoritative requirements and accepted Design already specify the missing boundaries. TDD: new tests must RED before source changes and GREEN after fixes. Existing authority tests preserved.
>
> **MODE-TAXONOMY REPAIR BATCH**: `deterministic-apply-verify-review-flow-runner-authority-mode-taxonomy-repair` is defined in `tasks-replan-runner-authority-mode-taxonomy-repair.md`. **NOT APPROVED** — requires a new exact user message authorizing the batch identity string. Addresses findings `REVIEW-RA-PC-B4` (invalid mode fails open with valid provider — mode must be exactly "invocation-required" or "static-compatible"; unknown/null/string/object at init or post-init mutation must deny invalid-evidence with zero resolver/bridge/effect), `REVIEW-RA-PC-B5` (OpenCode classifies missing required receipt from installed valid provider as AUTHZ_MISSING rather than invalid-evidence while Pi returns invalid-evidence — taxonomy parity required). Batch ceiling is exactly 6 files (2 canonical adapter TS + 2 generated JS + 2 reachability test). Spec/Design replan is NOT required — Spec/Design already demand fail-closed two-mode boundary and taxonomy parity. TDD: new tests must RED before source changes; B1-B3 and all prior tests preserved.

---

## Conclusion

**Unresolved external/user preconditions: None**

All inputs required to begin Task reconciliation are present and satisfied. The sole remaining precondition checks are:

1. **Before runner-authority batch issuance**: Confirm design SHA-256 `9850e208...` and design-replan SHA-256 `7d389a84...`.
2. **Before runner-authority batch issuance**: Pi worktree state must be reconciled in place — no git discard/restore/checkout/clean.
3. **Before runner-authority batch issuance**: Confirm no target allowlist intersects `runner-capability-standardization` or any other active OpenSpec change.
4. **Before runner-authority batch issuance**: Confirm worktree policy — own-change untracked planning artifacts are expected; block unrelated tracked modifications, unrelated untracked files, and generated outputs.
5. **Before any modifying attempt**: Confirm a new explicit human-approved batch identity has been issued through the normal OpenSpec workflow for `deterministic-apply-verify-review-flow-runner-authority-g2-g6`.
6. **Before recovery batch issuance**: Confirm spec SHA-256 `374a8fb1...` AND design SHA-256 `9850e208...`.
7. **Before each Apply batch**: Confirm no target allowlist intersects `runner-capability-standardization` or any other active OpenSpec change.
8. **Before each Apply batch**: Confirm worktree policy — own-change untracked planning artifacts are expected; block unrelated tracked modifications, unrelated untracked files, and generated outputs.
9. **Before repository-wide test**: Confirm `openspec/baseline-health.yaml` known failure fingerprint matches and no additional failures exist.
10. **Before proposed effect-authority batch attempt**: Confirm named human approval for proposed batch `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority`; Spec/Design replan is NOT required per Review verdict.
11. **Before runner-authority G2-G6 repair-1 batch attempt**: Confirm a new exact user message authorizing batch identity `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-1`; the message must contain the exact batch identity string; addresses `VERIFY-G2-G6-TARGETED-GEN-OPEN-SPEC-PATH` and `VERIFY-G2-G6-AFFECTED-CORE-PROMPT-PROFILE-BYTE-DRIFT`.
12. **Before runner-authority G2-G6 repair-2 batch attempt**: Confirm a new exact user message authorizing batch identity `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-2`; the message must contain the exact batch identity string; addresses `APPLY-G2-G6-REP1-LEXICAL-TOKENS-ORACLE-DRIFT` (lexical tokens: 79051→79092); LEGACY_BYTES (365_242) is preserved from repair-1.
13. **Before runner-authority G2-G6 prompt-profile-oracle-completion batch attempt**: Confirm a new exact user message authorizing batch identity `deterministic-apply-verify-review-flow-runner-authority-prompt-profile-oracle-completion`; the message must contain the exact batch identity string; addresses `APPLY-G2-G6-REP2-SHA256-ORACLE-DRIFT` (SHA256: 4eb4caaeb...→617d5891...); LEGACY_BYTES (365_242 from repair-1) and LEGACY_LEXICAL_TOKENS (79_092 from repair-2) are preserved; **NOT repair-3** — G1 `repair-3` remains PROHIBITED.
14. **Before provider-capture repair batch attempt**: Confirm a new exact user message authorizing batch identity `deterministic-apply-verify-review-flow-runner-authority-provider-capture-repair`; the message must contain the exact batch identity string; addresses `REVIEW-RA-FINAL-B1` (provider/global re-read), `REVIEW-RA-FINAL-B2` (malformed null/non-object evidence), `REVIEW-RA-FINAL-B3` (non-Apply tests); 6-file ceiling: OpenCode adapter TS + generated JS + reachability test, Pi adapter TS + generated JS + reachability test; TDD: new tests must RED before source changes; existing authority tests preserved.
15. **Before mode-taxonomy repair batch attempt**: Confirm a new exact user message authorizing batch identity `deterministic-apply-verify-review-flow-runner-authority-mode-taxonomy-repair`; the message must contain the exact batch identity string; addresses `REVIEW-RA-PC-B4` (invalid mode fails open — unknown/null/string/object → invalid-evidence with zero resolver/bridge/effect), `REVIEW-RA-PC-B5` (OpenCode AUTHZ_MISSING vs Pi invalid-evidence taxonomy mismatch for missing receipt); 6-file ceiling: OpenCode adapter TS + generated JS + reachability test, Pi adapter TS + generated JS + reachability test; TDD: new tests must RED before source changes; B1-B3 and all prior tests preserved.

---

## Phase Result Data

- **Status:** `preconditions_reassessed`
- **Unresolved external preconditions:** none
- **Verifiable preconditions before Apply:** 15 (spec digest, design digest, design-replan digest, Pi worktree reconciliation, target exclusion, worktree clean, human batch approval for runner-authority, recovery batch digest, human batch approval for effect-authority, baseline regression, repair-1 batch authorization, repair-2 batch authorization, oracle-completion batch authorization, provider-capture repair batch authorization, mode-taxonomy repair batch authorization)
- **Blockers to Tasks:** none
- **Blockers to Apply (beyond Tasks completion):** spec SHA-256 drift, design SHA-256 drift, design-replan SHA-256 drift, Pi worktree state, target intersection, worktree state, baseline regression, missing human batch approval for runner-authority batch, missing user authorization for repair-1 batch, missing user authorization for repair-2 batch, missing user authorization for oracle-completion batch, missing user authorization for provider-capture repair batch, missing user authorization for mode-taxonomy repair batch
- **Runner-authority batch ceiling:** exactly 8 files (2 source + 2 test + 2 generated + 2 canonical); G2 BLOCKED; repair-3 PROHIBITED
- **Recovery batch ceiling (G1):** exactly 8 files (4 source + 4 test); G2 BLOCKED; repair-3 PROHIBITED
- **Effect-authority proposed batch:** `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority` — bounded to exactly 8 files (same ceiling as G1); **NOT APPROVED** — requires named human approval
- **Runner-authority G2-G6 repair-1 batch:** `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-1` — bounded to exactly 1 file (`prompt-profile.test.ts`); **NOT APPROVED** — requires exact user authorization message; addresses VERIFY-G2-G6 findings
- **Runner-authority G2-G6 repair-2 batch:** `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-2` — bounded to exactly 1 file (`prompt-profile.test.ts`); **NOT APPROVED** — requires exact user authorization message; addresses APPLY-G2-G6-REP1-LEXICAL-TOKENS-ORACLE-DRIFT; LEGACY_BYTES (365_242) preserved
- **Runner-authority G2-G6 prompt-profile-oracle-completion batch:** `deterministic-apply-verify-review-flow-runner-authority-prompt-profile-oracle-completion` — bounded to exactly 1 file (`prompt-profile.test.ts`); **NOT APPROVED** — requires exact user authorization message; **NOT repair-3** — G1 `repair-3` remains PROHIBITED; addresses APPLY-G2-G6-REP2-SHA256-ORACLE-DRIFT; LEGACY_BYTES (365_242) and LEGACY_LEXICAL_TOKENS (79_092) preserved
- **Provider-capture repair batch:** `deterministic-apply-verify-review-flow-runner-authority-provider-capture-repair` — bounded to exactly 6 files (2 canonical adapter TS + 2 generated JS + 2 reachability test); **NOT APPROVED** — requires exact user authorization message; addresses REVIEW-RA-FINAL-B1 (provider/global re-read), REVIEW-RA-FINAL-B2 (malformed null/non-object evidence), REVIEW-RA-FINAL-B3 (non-Apply tests); TDD: new tests must RED before source changes; existing authority tests preserved
- **Mode-taxonomy repair batch:** `deterministic-apply-verify-review-flow-runner-authority-mode-taxonomy-repair` — bounded to exactly 6 files (2 canonical adapter TS + 2 generated JS + 2 reachability test); **NOT APPROVED** — requires exact user authorization message; addresses REVIEW-RA-PC-B4 (invalid mode fails open — unknown/null/string/object → invalid-evidence), REVIEW-RA-PC-B5 (OpenCode AUTHZ_MISSING vs Pi invalid-evidence taxonomy mismatch for missing receipt); TDD: new tests must RED before source changes; B1-B3 and all prior tests preserved
- **Spec/Design replan required for runner-authority:** NO per design-replan-runner-authority.md verdict
- **Spec/Design replan required for effect-authority:** NO per Review verdict in `review-effect-authority.md`

(End of file — total lines: ~90)

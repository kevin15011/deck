# Verify Report — Adaptive Developer Team Redesign

**Result:** passed  
**Verified:** 2026-08-04T07:12:20Z

## Requirement audit

| Requirement | Result | Evidence |
|---|---|---|
| REQ-001 canonical inventory | pass | Core catalog and both adapter plans materialize exactly the ordered seven-role inventory; Onboard and Archive are standalone skills. |
| REQ-002 proportional activation | pass | Lead content and leadership/runtime tests cover direct deltas, non-file-count routing, compact handoffs, and conditional specialists. |
| REQ-003 Apply and TDD | pass | Apply Fast/Deep own vertical implementation and proportional RED/GREEN, characterization, contract, visual, config, and documentation evidence. |
| REQ-004 Quality and safety | pass | Quality is read-only and protected-risk driven; low-risk paths skip it; canonical Git discard protection is byte-exact on all installed agent surfaces. |
| REQ-005 OpenSpec persistence | pass | Lead owns Delta, Working Brief, and Full SDD selection and remains the centralized writer. |
| REQ-006 capability preservation | pass | Package composition covers all canonical roles on their applicable surfaces; Serena gives both Apply roles read/write tools and other roles read-only tools. |
| REQ-007 Setup readiness | pass | Runtime, hooks, authority, and detailed preparation content use `deck-setup`; ready state is cached, and repairs are component-scoped and idempotent. |
| REQ-008 runner reconciliation | pass | OpenCode and Pi tests prove fresh install, candidate-first promotion, exact legacy quarantine, user-file preservation, rollback, failure recovery, idempotency, and no active legacy inventory. |
| REQ-009 model migration | pass | Direct mappings migrate deterministically; merged-role conflicts remain unset; TUI and launch paths use the seven canonical IDs. |
| REQ-010 compatibility/generated outputs | pass | Legacy IDs remain interpretation/retirement inputs only; no physical aliases are planned; generated hook assets were rebuilt from canonical TypeScript. |

## Verification evidence

- `bunx tsc --noEmit` — passed with zero errors.
- `bun test tests/documentation-governance.test.ts` — 10 passed, 0 failed.
- Focused core readiness, prompt, migration, capability, TUI, runtime, runner-install, rollback, and reachability suites — passed.
- `bun run scripts/generate-runner-execution-assets.ts` — completed; generated OpenCode and Pi assets contain no legacy active agent IDs.
- `bun run test` — 4,197 passed, 0 failed across 249 files; 16,450 expectations.
- `bun run deck openspec validate --json --change adaptive-developer-team-redesign --root /home/dev/deck` — 1 valid change, 0 errors, 0 warnings.
- `git diff --check` — passed.
- Active non-test/non-generated source scan outside explicit compatibility modules found no obsolete `deck-developer-*` or `deck-init` materialization references.

## Residual risk

No blocking residual risk was found. Historical OpenSpec records and internal compatibility content intentionally retain former IDs so upgrades and archived sessions remain interpretable; installers do not materialize those IDs.

## Post-verification live reinstall repair

The user's first live OpenCode reinstall exposed a missing default-composition
binding for Serena: the adapter had injectable root/revalidator seams but its
no-options production factory did not materialize them. Core now resolves the
Deck-owned root through the same safe bootstrap boundary and builds the exact
path/fingerprint revalidator; OpenCode composes both lazily while preserving
explicit-root fail-closed behavior. The regression was reproduced RED, then
verified with `116` affected tests, TypeScript, a read-only real-default root
resolution, and the repository-wide suite (`4,199 pass`, `0 fail`; `16,459`
expectations). The agent did not run the live installer; user confirmation is
still required by the Serena Design contract.

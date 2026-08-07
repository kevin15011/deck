# Review Report: First-Class Codex CLI Runner Support

## Decision

**APPROVED with explicit product gaps.**

## Review scope

Independent Quality reviewed the complete candidate iteratively across:

- architecture and runner-neutral boundaries;
- trust, authorization, consent, secret handling, filesystem transactions, recovery, and rollback;
- native Codex roles, skills, standalone bundles, bootstrap skills, AGENTS, TOML, MCP, shared binaries, models, and reasoning;
- package instruction translation and package/provider dispositions;
- generic CLI/TUI/doctor/synchronization composition;
- Pi/OpenCode compatibility and generated assets;
- public documentation and capability claims.

## Material findings repaired

- Crash-safe journals, operation-scoped rollback receipts, CAS conflicts, interrupted rollback recovery, and verify-failure rollback.
- Option-injection protection for exec/resume.
- Valid native skill frontmatter and durable ownership manifests.
- Complete expected-state verification and exact informed previews.
- Real installed-version feature gating and distinct unsupported/blocked states.
- No constructor-time user-home writes.
- Public removal of unbound first-class bridge promotion and protected-control support claims.
- Codex-native model/memory TUI behavior and package-instruction wording.
- Idempotent content-only synchronization with no install effects.
- Registry-driven synthetic runner selection, dashboard, package detail, and routing.
- Full adapter ownership of runner mappings, collision-safe contributions, runner-neutral core diagnostics, and non-actionable `not-applicable` capabilities.

## Final findings

- Blocker: 0
- High: 0
- Medium: 0

## Approved gaps

- Trusted Codex host enforcement remains deferred and visible; all shipped modes are `static-compatible`.
- Engram remains deferred for Codex.
- The documented Node/Bun pathname race remains an accepted platform limitation.
- Windows support remains undeclared.

## Recommendation

The candidate is ready for user acceptance. Commit, push, or archive only when explicitly requested.

## User-feedback delta review

Quality independently reviewed the package-count correction through multiple adversarial passes. The final review confirmed:

- exactly five optional package toggles for Pi, OpenCode, and Codex;
- `code-economy` is always-on and non-toggleable;
- Home and dashboard share canonical-plus-adapter support resolution;
- stale unsupported selections cannot enter persistence actions or the final install bundle;
- synthetic partial-support runners work end-to-end;
- transaction-level journal batching preserves crash safety and operation isolation.

Final delta findings: Blocker 0, High 0, Medium 0.

## Codex model-discovery delta review

Quality confirmed that only authenticated live results become editable, bundled results remain visibly stale and non-editable, Retry forces rescan, both-command failure exposes no fabricated models, and subprocess boundaries are deterministic and secret-free. Dynamic model-specific efforts—including `max` and `ultra`—are preserved without changing Pi/OpenCode behavior.

Final model-discovery findings: Blocker 0, High 0, Medium 0.

## Review & Install and Supermemory OAuth delta review

Quality independently exercised the malformed-inventory failure path, credential-free MCP materialization, and native OAuth status reporting. Initial review found incorrect Codex 0.146 status parsing, missing fresh-selection materialization, and a retained token-capture route. Apply repaired each root cause with regression coverage; subsequent user feedback assigned interactive login exclusively to the user.

The final review confirmed:

- malformed inventory is visible and fail-closed with no plan or apply effect;
- Codex writes the exact Supermemory endpoint without a bearer-token field;
- Codex-only setup cannot capture or persist a manual token, while Pi and mixed Pi/Codex behavior remain correct;
- Deck never invokes OAuth, opens a browser, starts a callback listener, or emits an authorization URL during installation;
- only total installation success after typed configuration verification exposes the inert user-owned login command;
- blocked, pending, stale, mismatched, failed, cancelled, partial, contradictory, and missing-evidence paths expose no OAuth next step;
- Codex 0.146 `enabled: true` and `auth_status: "oauth"` values are parsed strictly;
- the dashboard consumes runner-neutral verification evidence with no Codex-specific downcast.

Final OAuth/inventory findings: Blocker 0, High 0, Medium 0, advisory 0. The candidate remains approved for user acceptance.

## Static-compatible review-readiness delta review

Quality reproduced the user-visible blocker with the current project configuration and confirmed that no user setting was missing. The final implementation keeps the six protected controls visible, required, blocked, and classified as gaps while narrowly excluding only their typed `static-compatible-gap` disposition from executable install work and readiness. Unsupported runtime/version, selected Engram, collisions, malformed inventory, stale plans, and OAuth precondition failures remain fail-closed. The TUI now exposes specific genuine blocker reasons.

Final readiness findings: Blocker 0, High 0, Medium 0, advisory 0. The candidate remains approved for user acceptance.

## User-owned OAuth product correction

Acceptance feedback established that account authorization must be initiated explicitly by the user rather than by Review & Install. The candidate now treats `codex mcp login supermemory` as inert post-install guidance, shown only after overall successful installation. No production path can execute login or propagate browser/callback/authorization-URL effects. Configured-but-unauthorized remains a visible pending user action rather than an installation blocker.

Quality confirmed strict Codex 0.146 status parsing, exact credential-free MCP verification, total-success-only follow-up rendering, failed/cancelled/partial suppression, Doctor semantics, static-compatible readiness, malformed-inventory containment, Pi/OpenCode compatibility, and removal of obsolete executor/action vocabulary.

Final user-owned OAuth findings: Blocker 0, High 0, Medium 0, advisory 0. The candidate remains approved for user acceptance.

## Codex model-assignment rehydration delta review

Quality confirmed seven-role apply/read round trips, native-to-canonical model normalization, preservation of unavailable installed models and dynamic reasoning values, resolved project-root propagation, rehydration-before-discovery ordering, harmless missing files, safe malformed input, and Pi/OpenCode compatibility. An initial review found that symlinked `.codex` or `.codex/agents` ancestors could redirect bounded reads outside the project; Apply reused the established ancestor-safe path inspection and added regression fixtures.

The final review confirmed that current project state restores `openai-codex/gpt-5.6-sol` plus `high` without migration and that symlink, root-escape, non-directory, non-file, oversized, malformed, or ambiguous paths cannot import assignments or crash startup.

Final model-rehydration findings: Blocker 0, High 0, Medium 0, advisory 0. The candidate remains approved for user acceptance.

## Direct Codex root Lead launch delta review

Quality confirmed the upstream limitation: Codex 0.146 has no OpenCode-style Tab selector or native `--agent` flag for the root session. The final Deck launch uses a bounded static developer-instruction override rather than a synthetic user prompt or auto-spawned Lead child. New interactive/exec roots receive Lead behavior plus persisted model/reasoning; resume routes remain untouched.

Review covered valid TOML/config grammar, bounded non-secret bootstrap text, exact stdin-only exec prompts, option-shaped/quoted/newline/NUL/oversized input, EPIPE and redaction, generic executor closure, no prompt leakage, no dangerous overrides or global writes, static-compatible claims, and Pi/OpenCode compatibility. An initial review found inherited-stdin input could produce a structurally invalid ready exec plan; Apply normalized all deterministic Codex exec plans to the generic executable stdin contract.

Final direct-Lead findings: Blocker 0, High 0, Medium 0, advisory 0. The candidate remains approved for user acceptance.

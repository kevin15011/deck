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

Review covered valid TOML/config grammar, bounded non-secret bootstrap text, exact stdin-only exec prompts, option-shaped/quoted/newline/NUL/oversized input, EPIPE and redaction, generic executor closure, no prompt leakage, no global writes, static-compatible claims, and Pi/OpenCode compatibility. Its historical conclusion that no dangerous override existed was explicitly superseded by the user-approved 2026-08-10 always-on bypass amendment. An initial review found inherited-stdin input could produce a structurally invalid ready exec plan; Apply normalized all deterministic Codex exec plans to the generic executable stdin contract.

Final direct-Lead findings: Blocker 0, High 0, Medium 0, advisory 0. The candidate remains approved for user acceptance.

## Always-on dangerous Codex launch policy delta review

Quality reviewed the user-approved policy as a protected security delta. The first pass found that an option-shaped model value could duplicate the reserved token and that install-only dry-run omitted policy disclosure. Apply added strict scalar checks, a final exact-cardinality/position invariant, persisted-assignment rejection, and a runner-neutral static policy diagnostic.

The final review confirmed exact token placement/cardinality for all four modes, stdin-only same-string prompts, install-only no-spawn behavior, process-local scope, no project/global persistence, warning/Doctor/docs coverage, static-compatible classification, trust preservation, root Lead behavior, resume non-reinjection, prompt bounds/redaction, and Pi/OpenCode isolation.

Bypass delta findings: Blocker 0, High 0, Medium 0, advisory 0. Delta correctness is approved.

Overall candidate findings remain: two inherited materialization blockers—marker text accepted without manifest-backed ownership and unowned-byte drift/comment loss during removal—plus the previously catalogued Medium backlog. Therefore the overall decision is CHANGES REQUESTED and the branch is not ready for push, merge, or release.

## Shared Serena launcher delta review

Quality confirmed that Codex now reuses the same Core/Deck private Serena installation as OpenCode and Pi, blocks broken configuration, provisions only through an authorized Core action, repairs only legacy Deck-managed entries, and revalidates launcher/config readiness during apply and verify. The initial absolute project serialization reviewed here was later rejected as non-portable and is superseded by the portable proxy review below. No global PATH change or unnecessary reinstall occurs.

The first review found that Doctor built a plan before refreshing Serena readiness and that independent inventories could retain stale evidence. Apply reordered Doctor composition and made public inspections fresh while keeping operation-local one-use evidence bounded. Final probes confirmed consistent healthy/missing Doctor states, ready→missing and missing→ready transitions, exact resolver counts, and no redundant bootstrap.

The tracked `deck-release-publish` skill now has valid Codex YAML frontmatter and passes governance parsing.

Serena/frontmatter delta findings: Blocker 0, High 0, Medium 0, advisory 0. Delta correctness is approved. Overall merge/release remains blocked only by inherited materialization ownership/byte-preservation findings and existing backlog.

## Portable Serena proxy pre-commit review

Pre-commit Quality rejected the intermediate absolute project path and found missing Serena preparation at several plan call sites. Apply replaced the project entry with the portable hidden Deck proxy, added an explicit `full | content-only` planning scope, routed normal call sites through one prepare/build contract, and kept content-only sync/backup free of runtime/MCP/config effects. Public inventory now requires a fresh effective-proxy probe. Parent-targeted signal forwarding and a 2-second compiled-binary startup bound were added after adversarial review and real smoke evidence.

Current project config and manifest were regenerated transactionally using a temporary current Linux binary on PATH. They contain no home path and the committed proxy bytes are portable across user directories, subject to the documented requirement that the effective Deck binary supports `internal serena-mcp`.

Portable Serena delta findings: Blocker 0, High 0, Medium 0, advisory 0 after repair. Commit checkpoint is acceptable for this delta once final Git hygiene passes. Overall merge/release remains blocked by inherited marker-ownership and unowned-byte-preservation findings.

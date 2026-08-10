# Verify Report: First-Class Codex CLI Runner Support

## Result

**PASS with approved capability gaps.**

## Functional evidence

- Codex is registered through the adapter composition root and generic TUI routing.
- Interactive, exec, resume-by-ID, and resume-latest plans are feature-gated and remain `static-compatible` in shipped composition.
- Seven roles and agent-bound skills, 29 external standalone bundles with support files, and both bootstrap skills are planned, installed, verified, synchronized, and rolled back through owned manifests.
- Package instructions preserve six-ID order/defaults and translate to Codex-native wording without changing Pi/OpenCode canonical output.
- MCP, shared-binary, none/Supermemory, model/reasoning, doctor, TUI, and content-sync behavior passed focused evidence.
- Dry-run preview performs no mutation.

## Verification commands and results

| Gate | Result |
|---|---|
| Focused Codex/core/CLI/TUI/doctor/sync/bridge/package tests | Passed throughout iterative Apply and Quality review |
| Pi/OpenCode focused regressions | Passed |
| Independent pre-broad Quality review | GO; no blocker, High, or Medium findings |
| First `bun test --timeout 30000` | 4303 passed, 1 failed: core purity boundary violation |
| Root-cause focused repair tests | Core purity/registry/parity, all adapters, doctor/TUI passed |
| Final `bun test --timeout 30000` | 4308 passed, 0 failed; 17,274 assertions; 270 files |
| `bunx tsc --noEmit` | Passed |
| `bun run build` | Passed for linux-x64, linux-arm64, darwin-x64, darwin-arm64 |
| Built linux-x64 `version` smoke | Passed: Deck 0.2.6, target linux-x64 |
| Built linux-x64 Codex `--dry-run` smoke | Passed; full preview rendered; temporary project remained empty |
| OpenSpec registry validation | 0 errors, 0 warnings before final report update |
| `git diff --check` | Passed |

## Broad failure and resolution

The first broad run caught concrete runner/provider mappings introduced in `@deck/core`. The purity audit was not weakened. Mappings and dispositions moved to immutable adapter-owned contributions; required protected omissions became error gaps; collisions became deterministic errors; core diagnostic semantics became runner-neutral; and real Codex parity propagated to inventory, review, doctor, and TUI. The final broad run passed.

## Accepted gaps

- The shipped Codex composition does not own a guaranteed authenticated external hook-host lifecycle. All production modes remain `static-compatible`; trusted host, invocation authorization, dossier, controlled effects, registry coordination, and bound verification are explicit gaps.
- Engram remains deferred for Codex; none and Supermemory are supported.
- Node/Bun lacks `openat`/`renameat2` path-resolution guards. Deck performs immediate ancestor/target/hash/mode revalidation and atomic replacement, but a concurrent writable actor can still race final pathname resolution.
- Windows compatibility is not declared by this change.

## Repository state

No commit or push was performed. Build artifacts were generated under `dist/` through the canonical build command.

## User-feedback delta verification

The Codex package selector initially consumed the full capability inventory, producing approximately 25 catalog entries and 19 selectable rows. The corrected package-instruction contract exposes only the five optional IDs shared with Pi/OpenCode; `code-economy` remains baseline-only.

Verification covered both Home and dashboard paths, adapter support intersection, stale unsupported persisted values, final installer-boundary filtering, synthetic partial-support runners, and transaction journal batching. Independent Quality reported no blocker, High, or Medium findings.

Final post-delta gates:

- `bun test --timeout 30000`: 4319 passed, 0 failed; 17,315 assertions; 270 files.
- `bunx tsc --noEmit`: passed.
- `bun run build`: passed for all four release targets.
- `git diff --check`: passed before final artifact reconciliation.

## Codex live-model inventory delta

The previous Codex adapter filtered Deck's static `MODEL_CATALOG`, so the Developer Team TUI could omit models and reasoning efforts actually offered by Codex. The adapter now discovers the authenticated catalog through released `codex debug models`, with an explicitly stale/non-editable bundled fallback and rescan action.

Coverage includes hidden filtering, priority/display/default/upgrade metadata, canonical/native IDs, per-model `max`/`ultra` efforts, cache and rescan, malformed/truncated/bounded output, timeout/SIGKILL, stream limits, spawn races, no-shell/ignored-stdin behavior, secret-free errors, and real DeckApp degraded-to-live transitions.

Post-model-discovery gates:

- `bun test --timeout 30000`: 4333 passed, 0 failed; 17,354 assertions; 272 files.
- `bunx tsc --noEmit`: passed.
- `bun run build`: passed for all four release targets.
- Independent Quality: no blocker, High, or Medium findings.

## Review & Install and native Supermemory OAuth delta

The dashboard now validates and normalizes runner inventory before review. Malformed, missing, or mismatched capability inventories produce a visible fail-closed plan and invoke no plan/apply effects.

Codex Supermemory configuration is credential-free project state: the exact remote MCP table is materialized without `bearer_token_env_var`. Deck never invokes native OAuth during installation. Typed runner-neutral post-apply evidence gates an inert user-owned follow-up, and only an overall successful run displays `codex mcp login supermemory`. Blocked, pending, contradictory, stale, failed, cancelled, partial, or unverifiable runs display no OAuth next step. Codex 0.146 status parsing requires exactly `enabled: true` and `auth_status: "oauth"`; malformed or legacy external output fails safely. Pi token behavior and OpenCode native OAuth behavior remain unchanged.

Final post-delta gates:

- Focused implementation checks: 274 passed, 0 failed after the final repair.
- Independent Quality recheck: approved; no blocker, High, Medium, or advisory finding.
- `bun test --timeout 30000`: 4354 passed, 0 failed; 17,443 assertions; 275 files.
- `bunx tsc --noEmit`: passed.
- `bun run build`: passed for linux-x64, linux-arm64, darwin-x64, and darwin-arm64.
- No live OAuth login was executed; tests inject process behavior and avoid account/browser side effects.

## Static-compatible Review & Install readiness delta

Acceptance testing exposed that the six approved protected-control gaps were being treated as executable blocked actions. The adapter now assigns a typed review disposition to exactly those static-compatible gaps. They remain required blocked inventory gaps and visible warnings, but do not participate in install-plan readiness or imply executable work. Genuine blocked capabilities remain blocking, and the TUI reports their first specific reason.

Post-readiness gates:

- Current-project production-composition probe: `plan.ready: true`, six visible static-gap warnings, zero blocked/manual gap actions, no first-class claim.
- Focused implementation checks: 322 passed, 0 failed.
- Independent Quality regression checks: approved; no blocker, High, Medium, or advisory finding.
- `bun test --timeout 30000`: 4356 passed, 0 failed; 17,455 assertions; 275 files.
- `bunx tsc --noEmit`: passed.
- `bun run build`: passed for all four release targets.

## User-owned Supermemory authorization delta

Acceptance feedback superseded the earlier installer-initiated OAuth sequence. Review & Install now owns only credential-free MCP materialization and semantic verification. It contains no OAuth executor, browser launch, callback listener, or authorization-URL path. The exact native login command is inert post-install guidance shown only after total success; any failed, cancelled, partial, stale, blocked, or unverifiable outcome suppresses it. Configured-but-unauthorized status is a pending user action rather than installation failure, while missing or malformed MCP configuration remains an error.

Final user-owned authorization gates:

- Focused final Quality evidence: 188 passed, 0 failed.
- `bun test`: 4349 passed, 0 failed.
- `bunx tsc --noEmit`: passed.
- `bun run build`: passed for linux-x64, linux-arm64, darwin-x64, and darwin-arm64.
- `git diff --check`: passed.
- Independent Quality: approved with no blocker, High, Medium, or advisory finding.

## Codex model-assignment rehydration delta

Deck now rehydrates model and reasoning assignments from the exact project-local Codex role files written by installation. Native slugs normalize to canonical Deck IDs without filtering against the current live catalog, allowing unavailable installed assignments to remain visible. The TUI supplies the resolved project root and preserves assignments while discovery determines availability.

The reader is bounded and read-only. It rejects malformed/non-string/oversized values, root escapes, symlinked or non-directory ancestors, non-file role paths, and ambiguous filesystem failures. Missing paths are harmless, and unsafe reads surface fixed project-relative Doctor diagnostics without exposing external paths.

Final rehydration gates:

- Focused final Quality evidence: 88 passed, 0 failed.
- `bun test --timeout 30000`: 4352 passed, 0 failed; 17,465 assertions; 274 files.
- `bunx tsc --noEmit`: passed.
- `bun run build`: passed for all four release targets.
- `git diff --check`: passed.
- Independent Quality: approved with no findings.

## Direct Codex root Lead launch delta

Because Codex 0.146 has no native root-agent selector, Deck now uses a bounded static developer-instruction bootstrap for new Developer Team interactive and exec sessions. The root starts with Lead behavior and the verified persisted Lead model/reasoning without requiring a user role-selection prompt. The mechanism remains explicitly instruction-level and static-compatible.

Interactive launch contains no positional bootstrap or synthetic user turn. Exec uses `codex exec -` with a bounded typed stdin payload; user text is absent from argv, environment, previews, and diagnostics. Every ready exec plan normalizes to the generic executable stdin contract. Resume routes preserve existing sessions without reinjection. Option-injection, NUL, size, EPIPE, capture, redaction, and trust boundaries remain intact. The sandbox/approval conclusion in this historical verification was explicitly superseded by the user-approved 2026-08-10 always-on bypass amendment.

Final direct-Lead gates:

- Focused final Quality evidence: 100 passed, 0 failed, plus 48 Pi/OpenCode/composition/documentation regressions.
- `bun test --timeout 30000`: 4360 passed, 0 failed; 17,514 assertions; 274 files.
- `bunx tsc --noEmit`: passed.
- `bun run build`: passed for all four release targets.
- `git diff --check`: passed.
- Independent Quality: approved with no findings.

## Always-on dangerous Codex launch policy delta

The amended REQ-CDX-RUN-005 is implemented for interactive, exec, resume-by-ID, and resume-latest. Every ready plan contains the fixed bypass token exactly once at argv position zero. Final invariants reject reserved-token aliases and all option-shaped argv-producing model/reasoning values, including unsafe persisted role assignments. Exec prompts remain stdin-only, and installation never persists the policy.

Install-only remains no-plan/no-spawn. Its dry-run preview receives the same high-risk future-launch disclosure through a runner-neutral adapter policy diagnostic. Pi and OpenCode do not receive the token or warning. Doctor and public docs disclose the scope and consequence.

Final bypass gates:

- Focused final security evidence: 110 passed, 0 failed, plus adversarial plan probes for all four modes.
- `bun test --timeout 30000`: 4365 passed, 0 failed; 17,563 assertions; 274 files.
- `bunx tsc --noEmit`: passed.
- `bun run build`: passed for all four release targets.
- `git diff --check`: passed.
- OpenSpec validation: 0 errors, 0 warnings.
- Delta correctness: PASS.

Overall verification remains blocked for release by the independently reproduced marker-ownership and unowned-byte-preservation violations and the existing Medium backlog. These are inherited findings, not regressions introduced by the bypass delta.

## Shared Serena launcher and release-skill frontmatter delta

Codex now consumes Core's canonical Deck-owned Serena readiness evidence instead of assuming a PATH command. The initial absolute project serialization recorded in this section was rejected by pre-commit portability review and is superseded by the portable proxy evidence below. Missing/unusable evidence blocks configuration unless an explicitly authorized Core provisioning action succeeds. Apply and verify revalidate launcher reachability and configuration semantics; independent inventory/Doctor calls refresh readiness, while one operation reuses bounded one-use evidence.

Final Serena gates:

- Focused final Quality evidence: 158 passed, 0 failed, plus independent Doctor, freshness, one-operation, canonical-argv, collision, and frontmatter probes.
- `bun test --timeout 30000`: 4373 passed, 0 failed; 17,606 assertions; 274 files.
- `bunx tsc --noEmit`: passed.
- `bun run build`: passed for all four release targets.
- `git diff --check`: passed.
- Serena delta correctness: PASS with no finding.

Overall release verification remains blocked by the inherited materialization ownership and byte-preservation findings.

## Portable Serena proxy and content-only composition delta

Commit-eligible Codex config now contains no user-specific launcher path. It invokes the stable hidden Deck proxy with fixed arguments and inherited environment-name declarations. The proxy resolves Core's private Serena runtime read-only, forwards inherited stdio/signals, never shells out or bootstraps, and is included in compiled binaries. Exact proxy capability is bounded and mandatory for readiness.

Normal planning uses a shared prepare-and-build contract. Content-only synchronization and backup explicitly skip runtime preparation and preserve existing config bytes/hash without adopting drift or rewriting runtime state. Full managed migration converts legacy bare/absolute entries to the portable proxy; unowned collisions remain blocked.

Final portable Serena gates:

- Focused implementation evidence: 617 passed before timeout repair; 270 passed for bounded compiled-probe repair.
- `bun test --timeout 30000`: 4387 passed, 0 failed; 17,665 assertions; 275 files.
- `bunx tsc --noEmit`: passed.
- `bun run build`: passed for all four release targets.
- Extracted Linux x64 release archive: `internal serena-mcp --probe` returned `deck-serena-mcp-proxy-v1`.
- Current portable project config/manifest hashes are consistent; diff scan found no secret or absolute home path.
- `git diff --check`: passed.

Overall release verification remains blocked only by separately inherited materialization ownership and unowned-byte-preservation findings/backlog.

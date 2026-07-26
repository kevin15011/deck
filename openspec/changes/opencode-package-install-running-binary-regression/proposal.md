# Draft Proposal: OpenCode Package Install Running-Binary Regression

## Proposal Status

- **Change ID:** `opencode-package-install-running-binary-regression`
- **Mode:** Automatic
- **Status:** Collaborative draft awaiting explicit human approval
- **Authoritative input:** `exploration.md` at SHA-256 `fde0cbd4b3f6f9ee34ca868ef39e13c66b06cd1e6e85edb7aff96417c7fb5fe2`
- **Approval boundary:** Creating this draft does not approve the change. Spec and Design remain blocked until the Orchestrator records explicit human approval.

## Problem and Causality

The just-completed rollout exposed a real OpenCode Runner Setup failure while `codebase-memory-mcp` was already active. The latest published upstream v0.9.0 release fails to identify its long-running process name on Linux and then attempts to overwrite the executing binary directly. That replacement fails, so the external installer correctly exits unsuccessfully.

The archived `agent-skill-registry-discovery` change did not modify the installer, required-tool detection, package action, or dashboard path. It was trigger context, not the source of the defect. The evidence instead identifies a pre-existing upstream running-binary replacement defect exposed by two pre-existing Deck gaps:

1. OpenCode required-tool detection can miss valid installed evidence and schedule an unnecessary install.
2. Deck retains external diagnostics internally but reduces the visible failure to `Package install reported a failure.`

The user wants the surfaced regression repaired without falsely attributing causality, hiding genuine installer failures, or making Deck responsible for unsafe process or binary replacement behavior.

## Intent

Define Runner Setup as idempotent capability assurance: confirm that required capabilities are usable and install only those that are genuinely missing. Existing installation evidence must be strong, package-relevant, and checked again immediately before any external installer is invoked.

When strong evidence shows that the capability is already present, Runner Setup will report an explicit already-present outcome and will not run the installer. When a capability is absent and its installer fails, the action will remain failed. The dashboard will identify the failed package/action and surface a bounded, sanitized, actionable cause instead of showing only the generic failure sentence.

This repair will remain package-agnostic where the shared OpenCode evidence and package-action contracts support it. It will not hard-code success around the v0.9.0 error text or create a codebase-memory-specific replacement mechanism.

## Measurable Outcomes

The change will be successful when:

1. Runner Setup does not classify an OpenCode tool as missing solely because default config files are absent when strong configured-command, executable, or supported install-target evidence proves it is present.
2. Installed evidence is rechecked at the external-effect boundary; if the package became or remained positively present, the downloader and installer are not invoked and the result explicitly says that no install ran.
3. A genuinely missing package still invokes its configured installer, and any nonzero or otherwise unsuccessful installer result remains visibly failed and continues to gate only its matching dependent work under existing policy.
4. Progress and completion views identify the failed action or package and display a useful sanitized cause with strict content and size bounds, while existing redacted diagnostic evidence remains available for debugging.
5. Shared behavior applies consistently to supported OpenCode package actions for which trustworthy installed evidence exists, without matching one package version or one upstream error string as the sole decision rule.
6. Focused automated coverage proves evidence handling, execution-time rechecking, truthful failure normalization, dependent-action gating, sanitization, and rendering without network access, live user-state access, process killing, or real installation.
7. A disposable Linux sandbox/manual lane demonstrates that an already-present active v0.9.0 binary is not overwritten by Runner Setup, only the harness-owned child PID is cleaned up, and the real user configuration and binary locations remain unchanged.

## Scope

### Required Work

- Correct OpenCode required-tool evidence evaluation so supported command/configuration and executable evidence is considered before declaring a tool missing.
- Require positive evidence to resolve to the expected package capability and a usable regular executable or other equally strong adapter-authoritative proof; existence alone is insufficient.
- Recheck installed evidence immediately before invoking an external installer so stale plans do not become accidental reinstall or upgrade attempts.
- Represent `already present; installer not run` explicitly without claiming a fresh install.
- Preserve genuine installer failure semantics, matching-capability gating, and continuation of unrelated actions.
- Normalize a bounded user-safe cause from installer diagnostics by removing control/progress noise, redacting sensitive material and private home paths, and retaining useful failure information.
- Render the action/package identity and normalized cause in Runner Setup progress and completion output.
- Add focused deterministic tests and the bounded sandbox/manual verification described below.

### Likely File-Impact Boundary

Design may reduce this list. Expanding it requires concrete evidence that the bounded behavior cannot be implemented within these existing responsibilities.

| Surface | Likely responsibility |
|---|---|
| `packages/adapter-opencode/src/required-tools.ts` and tests | Strong installed-evidence evaluation without the premature all-missing result. |
| `packages/adapter-opencode/src/install-tools.ts` and tests | Effect-boundary recheck and bounded external diagnostic normalization, if this remains the correct installer boundary. |
| `apps/cli/src/tui/runner-dashboard/action-runner.ts` and existing contract tests | Explicit already-present outcome, truthful failed result, and safe cause propagation. |
| `apps/cli/src/tui/screens/runner-dashboard-screens.tsx` and existing TUI render tests | Bounded action/package failure-cause presentation. |

`installation-plan.ts`, `capability-plan.ts`, and `app.tsx` are not presumed to change. Design may justify a minimal additive contract crossing one of those boundaries, but not a broader installer redesign.

### Exclusions

- Implicitly upgrading or forcibly reinstalling a capability that is already installed.
- Explicit upgrade or reinstall of an active MCP binary; that requires a fixed upstream release or a separately approved ownership-safe upgrade flow.
- Modifying, patching, vendoring, or replacing upstream `codebase-memory-mcp` code or its release process.
- Killing or restarting processes by name, command substring, ambiguous PID discovery, `pgrep -f`, port guess, or any ownership inference based only on presence.
- Overwriting an executing binary or inventing a Deck-owned binary staging, activation, rollback, checksum, or replacement mechanism.
- Converting a genuine installer failure into success merely because an older or unusable target exists.
- Exposing raw unbounded stderr, credentials, control sequences, progress output, or private absolute paths in the dashboard.
- Broad runner catalog, package-plan, configuration-resolution, or cross-runner redesign; Pi and unsupported package systems are outside this repair.
- Changes to `runner-capability-standardization`, archived OpenSpec history, shared registry schemas, user-home state, or external repositories.
- Network calls, live user configuration, real installer execution, or non-harness process management in automated tests.

### Optional Follow-up

A deliberate upgrade/reinstall workflow for active MCP binaries may be proposed separately after an upstream release includes ownership-safe transactional activation, or after a separate design establishes an equally safe host protocol. It is not required for this repair and must not be inferred from Runner Setup.

## High-Level Approach

1. Reuse one authoritative OpenCode installed-evidence concept across planning and the immediate pre-install check rather than adding unrelated detection paths.
2. Treat a positive recheck as an explicit idempotent no-op; treat absence as permission to attempt the existing configured installer, not as permission to manage running processes.
3. Preserve external installer truth while deriving one bounded, sanitized user-facing cause for the action result and dashboard.
4. Exercise the common evidence/result contracts with package-agnostic fixtures, plus a codebase-memory fixture that preserves the observed regression evidence.
5. Keep detailed interfaces, status compatibility, exact evidence precedence, bounds, and rendering composition for Spec and Design after approval.

## Consequential Choices

- Runner Setup is install-missing capability assurance, not an implicit upgrade surface.
- A skip requires strong positive evidence and an immediate recheck; weak or stale evidence cannot suppress a needed install.
- Existing presence does not redeem a failed installer once a genuine install attempt is required.
- Deck owns detection quality and actionable diagnostics, but upstream owns active-binary replacement.
- Safety takes precedence over convenience: Deck will not kill processes or infer ownership from names or command lines.
- The correction should use shared OpenCode package semantics where trustworthy evidence is available, while keeping the change bounded to the observed path.
- The archived rollout remains recorded as the context in which the defect surfaced, not as its cause.

## Dependencies

- The completed authoritative exploration and its preserved causality, runtime trace, safety constraints, and current test evidence.
- Existing OpenCode adapter authority for required-tool catalogs, effective command/configuration evidence, and package installation; the repair must reuse that authority rather than invent an independent filesystem scan.
- Existing secret redaction and diagnostic handling, strengthened as needed for bounded dashboard presentation.
- Deterministic Bun test seams for filesystem, PATH/configuration, downloader, shell, and TUI rendering behavior.
- A disposable Linux sandbox or container for manual active-binary verification. Any upstream script used there must be content/version identified and isolated from real user state.
- A future fixed upstream release or separately approved upgrade design for explicit active-binary upgrades. This dependency does not block the install-missing repair.
- Coordinator validation and atomic serialization of this phase's registry intent, followed by explicit human Proposal approval, before Spec or Design starts.

## Verification Direction

Automated checks will use injected dependencies and fresh temporary HOME/XDG/PATH roots. They will not fetch the mutable upstream script, inspect or modify live OpenCode state, or invoke process-management commands.

Manual reinstall verification will use one disposable Linux root. It will seed the identified v0.9.0 binary, start only a harness-owned child, exercise Runner Setup against sandboxed evidence, and confirm the external installer is not invoked for the already-present capability. Cleanup may terminate only the exact PID created and retained by the harness. Before/after evidence must show that the real user's OpenCode configuration and binary locations were not changed. A separate missing-package lane must preserve a genuine installer failure and its sanitized actionable cause; it must not be represented as successful reinstall support.

## Risks and Mitigations

**Overall risk: Medium.** The change is bounded and has no data migration, but false installed evidence could skip a required tool, while diagnostic handling touches untrusted external output.

| Risk | Potential impact | Proposal-level mitigation |
|---|---|---|
| False positive installed evidence | A missing or broken capability is not installed. | Require package-relevant, executable, adapter-authoritative evidence and recheck it at the effect boundary. |
| False negative evidence | Runner Setup repeats the observed accidental reinstall. | Evaluate supported evidence even when default config files are absent and cover each evidence source deterministically. |
| Time-of-check/time-of-use drift | The plan and execution see different installation states. | Recheck immediately before the external effect and make the no-op result explicit. |
| Status ambiguity | A skipped installer appears as a successful fresh install. | Preserve a distinct already-present outcome or message compatible with existing action semantics. |
| Diagnostic leakage or noise | Secrets, paths, control text, or excessive output reach the dashboard. | Apply existing redaction plus explicit path, control-text, line, and character bounds before rendering. |
| Shared-package regression | A generic fix suppresses valid installs for another tool. | Use package-agnostic contract tests with positive and negative evidence, while limiting production scope to OpenCode. |
| Upstream or platform drift | A future release behaves differently or Windows replacement semantics diverge. | Do not classify by one error string or implement activation; keep true replacement upstream-owned. |

## Rollback

Rollback will revert the OpenCode evidence/recheck behavior and dashboard result/rendering changes as one coherent source-and-test change through normal version-control history. No schema, persisted data, or user configuration migration requires reversal. Existing external installer behavior can then resume unchanged, including truthful failure, while the regression remains documented for a later repair.

Rollback must preserve this OpenSpec history and recorded approval/decision evidence. It must not delete user files, stop external processes, modify upstream binaries, touch `runner-capability-standardization`, or use destructive Git operations without the permanent informed-confirmation flow.

## Unresolved Decisions

No product-scope decision blocks approval. Spec and Design must resolve these bounded implementation-contract questions without expanding scope:

1. The compatible result vocabulary for `already present; installer not run` while avoiding a false fresh-install claim.
2. The authoritative supported evidence set and precedence for effective OpenCode command/configuration resolution, including supported project/user and JSON/JSONC behavior.
3. The exact sanitization, redaction, line, and character bounds for one actionable cause.
4. Whether the bounded cause is rendered inline or through an equally visible bounded details treatment on progress and completion views.

The publication timing of an upstream transactional release remains unresolved externally, but it affects only the excluded explicit-upgrade path.

## Approval Question

**As the client, system owner, domain authority, and active stakeholder, do you approve this proposal's causality framing, install-missing Runner Setup semantics, measurable outcomes, bounded scope and exclusions, safety choices, dependencies, Medium risk, verification direction, rollback, and downstream decision set so the Orchestrator may record approval and begin Spec and Design?**

Please respond with explicit approval or requested revisions. Draft completion alone is not approval, and Automatic mode does not waive this approval gate.

## Handoff Readiness

After explicit approval is recorded, Spec and Design can proceed from this shared boundary. Spec should formalize observable behavior and failure/safety contracts without selecting architecture. Design should choose the smallest compatible evidence, result, sanitization, and rendering boundaries. Any consequential scope expansion must return to Proposal review rather than being inferred downstream.

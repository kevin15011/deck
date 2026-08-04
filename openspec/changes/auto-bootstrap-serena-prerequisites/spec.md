# Serena Prerequisite Bootstrap Specification

## Purpose and boundaries

**Approved scope basis:** `sha256:d4cc905b11ca6604f2760b3ab11abafa466a8815258f53f0979f4bb8481e8184` (approved revised proposal). This specification applies only to an interactive Deck TUI **Review & Install** operation in which the user explicitly selects Serena for the current OpenCode or Pi flow. It does not authorize `runner-capability-standardization`, automatic language-server tooling, implicit/startup/deck-init/global installation, or work on the closed `opencode-package-install-running-binary-regression` change.

The selected official `uv` installer is remote executable content. The approved scope accepts its residual supply-chain risk. Deck MUST NOT represent the controlled endpoint or its downloaded content as independently integrity-verified, checksum-verified, pinned to a release, or attested by Deck.

## Requirements

### Explicit selection and scope

**REQ-SERENA-GATE-001 (MUST).** Serena bootstrap, installation, validation, and Serena MCP configuration MUST run only after an explicit Serena selection for the current interactive TUI install operation. A default or preselected value alone MUST NOT satisfy this gate. No non-TUI, implicit, startup, project-initialization, bulk, or unrelated-capability flow MAY trigger this behavior.

#### Scenario: Unselected Serena is inert
- **GIVEN** a TUI install operation without an explicit Serena selection
- **WHEN** the operation runs for either runner
- **THEN** it performs no Serena prerequisite acquisition, installation, readiness validation, or Serena MCP configuration write.

#### Scenario: Explicit selection is runner-scoped
- **GIVEN** the user explicitly selects Serena in an OpenCode or Pi TUI install operation
- **WHEN** that operation starts
- **THEN** only the selected runner's Serena flow may run and unrelated selected capabilities remain independently processed.

### Reuse and controlled prerequisite bootstrap

**REQ-SERENA-REUSE-001 (MUST).** Before mutating external state, the flow MUST determine whether Deck-owned user-storage `uv` and Serena state is usable. A usable Serena installation with fresh resolved-executable readiness evidence MUST be reused without bootstrap or reinstall. A found but unusable or indeterminate Serena executable MUST fail closed without replacement installation or MCP configuration. State outside Deck-owned user storage MUST NOT be modified or automatically treated as reusable Serena state.

**REQ-SERENA-BOOTSTRAP-001 (MUST).** When selected Serena is missing and a usable Deck-owned `uv` is unavailable, the flow MUST begin only at the fixed official HTTPS endpoint `https://astral.sh/uv/install.sh` and acquire it through a controlled noninteractive process. Because that official endpoint selects the current installer asset through redirects, Core MAY follow at most five server-provided redirects. Every hop MUST remain HTTPS and MUST NOT contain embedded credentials or a custom port; missing, malformed, insecure, or excess redirects MUST fail closed. No redirect URL is user-controlled, and the whole chain remains subject to one timeout and one response-size bound. It MUST set `UV_UNMANAGED_INSTALL` to Deck-owned user storage, resolve and validate the resulting `uv` executable, and stop before Serena installation if that validation fails. Python needed by the Serena tool installation MUST be acquired only through supported `uv` behavior; the flow MUST NOT require, bootstrap, or manage a separate system Python installation.

**REQ-SERENA-BOUNDARY-001 (MUST).** The bootstrap and Serena flow MUST use only controlled URL, argument, environment, and executable values: it MUST permit no user-controlled URL or arguments and no shell interpolation. It MUST NOT modify `PATH`, shell profiles, global Python, system Python, or system directories, and MUST NOT use `pipx` or a fallback installer. All automatic `uv` and `uv`-managed Serena state MUST remain in Deck-owned user storage. It MUST NOT claim that the official installer or its content is independently integrity-verified, checksum-verified, release-pinned, or attested by Deck.

#### Scenario: Ready installation is reused
- **GIVEN** a usable Deck-owned Serena installation has fresh resolved-executable readiness evidence
- **WHEN** the user explicitly selects Serena
- **THEN** no bootstrap or Serena installer is invoked, and configuration remains subject to the readiness and existing-config gates.

#### Scenario: Existing unusable Serena fails closed
- **GIVEN** a Serena executable is found but fails readiness validation or cannot yield resolved-executable evidence
- **WHEN** the user explicitly selects Serena
- **THEN** the result is a failed or blocked Serena outcome, no replacement installer runs, and no Serena MCP configuration is written.

#### Scenario: Missing uv uses the controlled official installer
- **GIVEN** selected Serena is missing and usable Deck-owned `uv` is unavailable
- **WHEN** prerequisite preparation runs
- **THEN** the bootstrap begins only at `https://astral.sh/uv/install.sh`, follows only a bounded secure server-provided redirect chain, `UV_UNMANAGED_INSTALL` targets Deck-owned user storage, and Serena installation begins only after resolved-path `uv` validation succeeds.

#### Scenario: Bootstrap safety boundary is enforced
- **GIVEN** a selected Serena flow requires `uv` bootstrap
- **WHEN** it prepares the controlled child process
- **THEN** no user-supplied URL or argument is used, no shell interpolation, `PATH` or profile change, global/system Python change, or system-directory write occurs, and no `pipx` command is invoked.

#### Scenario: Official installer failure has no fallback
- **GIVEN** the controlled official installer fails, is unavailable, or produces no usable resolved `uv` executable
- **WHEN** preparation ends
- **THEN** no Serena install or MCP configuration is attempted, no fallback installer is invoked, and the TUI reports a redacted actionable failure without claiming independent installer verification.

### Serena package identity and installation

**REQ-SERENA-COMMAND-001 (MUST).** After resolved-path `uv` validation and only when Serena is missing, the flow MUST invoke the resolved `uv` executable with exactly `tool install -p 3.13 serena-agent`. It MUST NOT install the obsolete `serena` package. Python acquisition, if needed, is delegated to `uv`.

**REQ-SERENA-SOURCE-001 (MUST).** Serena package/source metadata displayed or passed through either runner's selectable installation flow MUST identify `serena-agent`; stale repository or generic Python-tool source identities MUST NOT be presented as the installable Serena package.

#### Scenario: Exact Serena command follows uv validation
- **GIVEN** selected Serena is missing and a resolved Deck-owned `uv` executable is usable
- **WHEN** installation begins
- **THEN** the sole Serena install invocation is the resolved `uv` path followed by `tool install -p 3.13 serena-agent`.

### Cancellation and partial outcomes

**REQ-SERENA-CANCEL-001 (MUST).** Cancellation MUST prevent all not-yet-started Serena work and all Serena MCP configuration writes. If cancellation occurs while a controlled child process is running, the flow MUST request its termination, await a known termination outcome before reporting a terminal result, and MUST NOT claim success from an unknown outcome. It MUST preserve partial Deck-owned tool state for a later explicit readiness check and MUST NOT delete user tools or configuration as cleanup.

#### Scenario: Cancellation before mutation
- **GIVEN** Serena has been explicitly selected but no bootstrap or install command has started
- **WHEN** the user cancels
- **THEN** no Serena external command or configuration write occurs and the TUI reports cancellation.

#### Scenario: Cancellation during an active command
- **GIVEN** a Serena prerequisite or installation child process is active
- **WHEN** the user cancels
- **THEN** remaining work and configuration are skipped, termination is requested and observed before the final result, and any later retry begins with fresh readiness checks.

### Readiness evidence and MCP configuration

**REQ-SERENA-READY-001 (MUST).** A successful Serena outcome MUST include fresh evidence that the absolute Deck-managed Serena executable entry is usable. Because `uv tool install` may publish that entry as a symlink, it MAY be accepted only when its canonical target is a regular executable contained in the same Deck-owned Serena root. Readiness and immediate pre-write revalidation MUST bind both the managed entry and target identities so a dangling, escaping, retargeted, non-regular, or non-executable link fails closed. Serena MCP configuration MUST reference the validated absolute managed entry rather than an unverified bare command. Installer exit status alone MUST NOT satisfy readiness.

**REQ-SERENA-MCP-GATE-001 (MUST).** A bootstrap, installer, readiness, path-validation, cancellation, partial, or configuration failure MUST prevent a new Serena MCP configuration write. A known-good existing Serena configuration for the selected runner MUST remain unchanged on every failed, cancelled, or no-op path. A failed or cancelled attempt MUST NOT configure or launch Serena MCP with bare `serena`.

#### Scenario: Fresh readiness enables configuration
- **GIVEN** the exact Serena command succeeds and fresh validation returns a usable absolute managed Serena entry, either a regular executable or a stable contained `uv`-managed symlink
- **WHEN** the selected runner has no known-good Serena configuration
- **THEN** its Serena MCP configuration may be written using that validated managed entry and reports a configured outcome; a dangling, escaping, or retargeted symlink is rejected without a writer call.

#### Scenario: Post-install executable is not ready
- **GIVEN** the Serena install command exits successfully but readiness cannot resolve a usable executable
- **WHEN** configuration would otherwise begin
- **THEN** Serena is reported unready and no MCP configuration write occurs.

#### Scenario: Known-good configuration is preserved
- **GIVEN** the selected runner already has a known-good Serena MCP configuration
- **WHEN** Serena is reused, fails, or is cancelled
- **THEN** that configuration is not replaced, deleted, or otherwise modified.

#### Scenario: Failed or cancelled work never falls back to bare Serena
- **GIVEN** a selected Serena flow fails or is cancelled before validated resolved-executable readiness
- **WHEN** it reaches its final outcome
- **THEN** it writes no new MCP configuration and does not configure or launch MCP with bare `serena`.

### TUI outcome UX

**REQ-SERENA-UX-001 (MUST).** The TUI MUST present concise progress for, as applicable, **preparing uv**, **installing Serena**, **validating Serena**, and **configuring MCP**. It MUST suppress raw installer and child-process streams. Terminal outcomes MUST identify success, reuse, failure, cancellation, or partial state and provide a bounded, actionable, redacted reason; they MUST NOT expose credentials, tokens, private paths, control sequences, or unbounded diagnostic output.

#### Scenario: Successful flow is progressful but quiet
- **GIVEN** a selected Serena flow requires bootstrap, installation, validation, and configuration
- **WHEN** it succeeds
- **THEN** the TUI renders the applicable four concise stages and does not render raw installer stdout or stderr.

#### Scenario: Unsafe diagnostic data is redacted
- **GIVEN** a bootstrap or installer failure contains a token, private path, control characters, or excessive output
- **WHEN** the TUI renders the failure
- **THEN** it shows only bounded redacted actionable diagnostics and identifies the failed stage.

### Runner parity and compatibility

**REQ-SERENA-PARITY-001 (MUST).** OpenCode and Pi TUI flows MUST provide equivalent explicit-selection, reuse, controlled-bootstrap, exact-command, cancellation, readiness, configuration-gating, and redaction semantics. Their runner-specific MCP configuration formats MAY differ, but neither runner MAY bypass readiness evidence or overwrite a known-good configuration. This requirement MUST NOT expand into runner capability standardization.

#### Scenario: Equivalent runner outcomes
- **GIVEN** equivalent mocked Serena readiness and command outcomes for OpenCode and Pi
- **WHEN** each flow runs from an explicit selection
- **THEN** both produce equivalent semantic outcomes for reuse, installation, blocked readiness, cancellation, and MCP gating.

### Verification and deferred manual validation

**REQ-SERENA-TEST-001 (MUST).** Automated unit, adapter-contract, and render-level TUI tests MUST deterministically mock installer acquisition, process execution, Python acquisition, readiness/path resolution, cancellation, and MCP writes. The install-facing tests MUST perform zero real external I/O: no network call, real installer or process invocation, or user-home filesystem write. They MUST cover the requirements above for both runners.

**REQ-SERENA-MANUAL-001 (MUST).** Live functional confirmation is deferred until after implementation. The only manual acceptance action is a user-run `bun run deck:run` through the development TUI; it is not an automated test gate and MUST NOT be executed by an agent during specification, implementation, verification, or review.

#### Scenario: Automated evidence has no external effects
- **GIVEN** the automated Serena test suite runs
- **WHEN** it covers successful, failed, cancelled, reused, and unready paths for both runners
- **THEN** all install-facing external boundaries are mocked and the tests perform no network, real process, installer, or user-home write.

#### Scenario: Manual validation is deferred
- **GIVEN** implementation and automated checks are complete
- **WHEN** live TUI acceptance is requested
- **THEN** the user may run `bun run deck:run` manually, and no agent substitutes a live installer, network action, or home-directory write for that validation.

## Coordination precondition (not a product behavior requirement)

**P-CLI-001 remains active.** `apps/cli/src/tui/app.tsx` is shared with the active `opencode-configured-providers-filter` change. Before any future shared TUI edit, the coordinator MUST serialize ownership, obtain a clean handoff, and require the future implementer to reread the landed file. This specification neither changes that condition nor absorbs provider-filter or menu-windowing work.

## Producer self-audit

- **Invariants:** Explicit selection gates all effects; only the fixed official HTTPS installer endpoint may bootstrap `uv`; `UV_UNMANAGED_INSTALL` and all automatic tool state remain Deck-owned; exact Serena installation and fresh resolved-path validation gate MCP configuration; unsafe outcomes fail closed.
- **Superseded scope:** Custom archives, release pins, checksums, attestation/provenance evidence, platform archive decoding, and the former P-SEC-001 trust-manifest approach are not requirements of this approved scope and MUST NOT be represented as providing installer integrity.
- **Boundaries:** OpenCode and Pi interactive TUI flows only; no language-server tooling, implicit/global installation, runner capability standardization, or historical regression reopening.
- **Open coordination blocker:** P-CLI-001 remains unresolved. The existing preconditions artifact still describes the superseded P-SEC-001 approach and requires coordinator-owned reconciliation before Apply; this specification does not modify that artifact.
- **Readiness gaps:** No live installer, network, user-home write, or manual TUI run was performed during this phase.
- **Rollback/test direction:** Future rollback preserves user tools and known-good configuration; deterministic mocked unit, adapter-contract, and render-level tests prove all gates before later user-run validation.

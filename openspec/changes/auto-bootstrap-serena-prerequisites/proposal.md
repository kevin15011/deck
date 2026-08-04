# Proposal: Auto-bootstrap Serena prerequisites

**Change ID:** `auto-bootstrap-serena-prerequisites`  
**Status:** Revised draft — material security-scope change; not approved. The prior approval does not authorize reconciliation or implementation of this revision.  
**Workflow:** Interactive SDD; the user is the client, system owner, domain authority, and active stakeholder.

## Revision basis and intent

Authoritative user decision, quoted verbatim for traceability: `Acepto usar el instalador oficial de uv`.

When a user explicitly selects Serena in Deck's interactive TUI, Deck may noninteractively invoke the official `uv` installer from the fixed allowlisted HTTPS endpoint `https://astral.sh/uv/install.sh` through a controlled process. It must set `UV_UNMANAGED_INSTALL` to a Deck-owned user location, use the resulting resolved `uv` path, run exactly `uv tool install -p 3.13 serena-agent`, and validate a usable resolved Serena executable before configuring MCP. This replaces the earlier custom pinned-archive/attestation bootstrap proposal.

The problem remains that the older `uv tool install serena` / `pipx install serena` paths are outdated and a failed install can otherwise be followed by an MCP configuration write.

## Measurable outcome

For an explicit Serena selection in either runner, the TUI reports concise stages—preparing `uv`, installing Serena, validating Serena, and configuring MCP—without exposing raw installer or child-process streams. Success requires validated Serena readiness and a resolved executable path handed to the selected runner's MCP configuration path. Failure, cancellation, or an unready executable produces a bounded, actionable, redacted reason and leaves no new or replacement Serena MCP configuration. No public outcome after a failure or cancellation may start MCP with a bare `serena` command.

## Scope

### In scope

- The applicable Deck TUI runner-install flows for **OpenCode and Pi**. This is intentionally not an OpenCode-only change.
- Explicit-selection-only preflight and idempotent reuse of ready Deck-owned `uv` and Serena state. If a usable Deck-owned `uv` is absent, controlled noninteractive invocation of only the allowlisted official HTTPS installer is permitted with `UV_UNMANAGED_INSTALL` directed to a Deck-owned user location.
- The controlled installer process has no user-controlled URL or arguments, no shell interpolation, no shell-profile or PATH modification, no `pipx` invocation, no global/system Python modification, and no write to system directories. Any permitted `uv`-managed state must remain in Deck-owned user storage.
- Use of the resolved `uv` executable path to run exactly `uv tool install -p 3.13 serena-agent`, followed by Serena readiness and resolved-executable validation before any MCP configuration.
- Executable-path handoff to runner-specific MCP configuration rather than an unverified or bare `serena` command.
- Fail-closed MCP gating: do not write or replace Serena MCP configuration after installer, install, readiness, path-validation, or cancellation failure; retain an already-valid configuration unchanged.
- Concise redacted TUI progress and failures, bounded diagnostics, and child-process cancellation. Cancellation prevents remaining work and configuration writes; an in-flight child process must be terminated and its outcome handled before the flow reports its final state.
- Strict mocked unit, adapter-contract, and render-level TUI coverage. Tests must make no network call, real installer/process invocation, or user-home write. Functional confirmation remains limited to the user later running `bun run deck:run` through the development TUI.

### Out of scope

- Custom pinned archives, archive/executable digests, attestation/provenance verification, or any claim of independent artifact verification for the official installer.
- Automatic installation of language servers, per-language-server dependencies, or other language tooling.
- Non-TUI, implicit, startup, Deck-initialization, project-initialization, or bulk package installs.
- Actual installer execution, network access, process execution, user-home writes, or live functional validation by an agent in this proposal or later automated test phases.
- `runner-capability-standardization`; prompts, skills, generated/materialized runner files, registry YAML, configuration, source, tests, Git state, and changes to historical OpenSpec changes or their artifacts.

## Approach

1. Treat `uv` as the only automatic base prerequisite and Serena as the explicitly requested tool; inspect Deck-owned readiness before any controlled mutation.
2. When needed, use the fixed official installer endpoint only through a controlled non-shell-interpolated process with `UV_UNMANAGED_INSTALL`; do not use `pipx`, profiles, PATH edits, system locations, or global/system Python.
3. Use the resulting resolved `uv` path for exactly `uv tool install -p 3.13 serena-agent`; then re-check Serena and capture its resolved executable path.
4. Configure only the selected runner and only after validated readiness and path resolution. Any non-success outcome is terminal for the flow and cannot emit a bare `serena` MCP command.
5. Keep remote-installer and child-process output internal. Map bounded stage results to compact redacted TUI messages, propagate cancellation to child processes, and make a repeated successful invocation a reuse path.
6. Use dependency injection and deterministic mocks for installer acquisition, process execution, readiness, cancellation, path resolution, and MCP writes. Reserve the real user-driven TUI run for later user-only functional confirmation.

## Dependencies and active intersections

- **Dependencies:** the user's accepted use of the official remote installer; availability of the fixed HTTPS endpoint; the upstream Serena package contract (`uv tool install -p 3.13 serena-agent`); current OpenCode/Pi capability and MCP paths; and the strict mocked-I/O policy in `openspec/config.yaml`.
- `opencode-configured-providers-filter` is active and shares `apps/cli/src/tui/app.tsx`. P-CLI-001 remains required: the coordinator must serialize ownership and obtain a clean handoff before any future shared TUI edit. This proposal must not absorb provider-filter or menu-windowing work.
- Prior OpenCode/Pi installer-path evidence may inform discovery, but no historical change or artifact is reopened or modified.

## Residual risk and safeguards

The official installer is remote executable content. The user has accepted the residual supply-chain risk of executing it; this proposal does **not** claim independent artifact, digest, attestation, provenance, or release verification.

Retained safeguards are a fixed official HTTPS endpoint allowlist, no user-controlled URL or arguments, no shell interpolation, `UV_UNMANAGED_INSTALL` to a Deck-owned user location, prohibition of profile/PATH/system/global-Python changes and `pipx`, bounded redacted diagnostics with no raw output, child-process cancellation, resolved-executable validation, and fail-closed MCP configuration gating. These safeguards reduce exposure but do not independently authenticate immutable installer content.

## Rollback

Revert the future canonical source and tests as one normal change if this flow misbehaves. Preserve existing validated Serena/MCP state, do not delete user-home tools or configuration as rollback, do not rewrite registry history, and do not use destructive Git operations.

## Open decisions and approval gate

- The exact Deck-owned user-storage layout and any reuse/migration rule for pre-existing non-Deck-managed `uv` or Serena state must be defined during post-approval Spec/Design reconciliation without relaxing this proposal's ownership and no-system-write boundary.
- P-CLI-001 remains unresolved and continues to block Apply until the coordinator records the required `app.tsx` ownership/order evidence.
- Under the currently approved artifacts, P-SEC-001's pinned-archive/attestation manifest is still an Apply hard stop. It is proposed to be superseded by this accepted-official-installer scope **only after** this revised proposal's exact digest receives new explicit approval and the coordinator records that transition. Drafting this revision does not supersede P-SEC-001.
- After that approval, Spec, Design, Tasks, and Preconditions require renewed reconciliation to this scope before Apply. No implementation is authorized by this draft.

## Approval request

**Do you approve the exact digest of this revised proposal as the authoritative scope for `auto-bootstrap-serena-prerequisites`: explicit Serena selection in the Deck TUI for both OpenCode and Pi; controlled official `uv` installer use with `UV_UNMANAGED_INSTALL` in Deck-owned user storage; exactly `uv tool install -p 3.13 serena-agent`; resolved-path validation before fail-closed MCP configuration; redacted cancellable progress; mocked no-I/O tests; and later user-only `bun run deck:run` confirmation?**

Only the coordinator may record the approval receipt and digest. Until it does, renewed Spec/Design/Tasks reconciliation and Apply must not start.

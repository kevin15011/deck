# Technical Design: Auto-bootstrap Serena prerequisites

**Change ID:** `auto-bootstrap-serena-prerequisites`  
**Design status:** Scope-reconciled with approved Proposal `sha256:d4cc905b11ca6604f2760b3ab11abafa466a8815258f53f0979f4bb8481e8184` and approved Spec `sha256:d60592b9b705df3a0dbeaf2203fd08cf4c4fecd2d3fb3d960141b1f5d38729ae`. The former P-SEC-001 trust-manifest gate is superseded; P-CLI-001 remains active.  
**Scope:** Interactive Deck TUI **Review & Install** for OpenCode and Pi, and only when Serena was explicitly selected during the current operation.

## Context and constraints

The current adapters contain separate obsolete Serena paths: OpenCode requires a separately installed Python and selects `uv` or `pipx`, while Pi attempts `uv tool install serena` and then `pipx install serena`. Existing planning/configuration paths can also write a bare `serena` command without carrying fresh executable evidence from installation to MCP configuration.

The approved revision replaces the custom pinned `uv` archive downloader, trust manifest, attestation/digest checks, platform target classifier, and tar decoder with controlled use of the official installer at exactly `https://astral.sh/uv/install.sh`. That installer is remote executable content. The user has explicitly accepted this residual supply-chain risk. Deck does **not** independently verify, checksum, release-pin, attest, or establish provenance for the installer or the artifacts it obtains.

Core remains the runner-neutral policy/execution boundary, adapters retain runner-native MCP serialization, and the CLI remains the explicit-selection, progress, and cancellation boundary. This change does not modify `runner-capability-standardization`, language-server tooling, startup, `deck-init`, bulk/global install behavior, historical OpenSpec artifacts, prompts, skills, generated files, registry YAML, or Git state.

No adaptive context was loaded. Official OpenSpec artifacts, repository source, tests, and architecture documentation are authoritative. Skill discovery was reported `missing` with reason `file_absent`; bounded direct discovery over generic project sources and the active OpenCode runner was used. `.atl/skill-registry.md` was not generated or changed, and no additional capability skill was needed.

## Goals and non-goals

### Goals

1. Require current-operation explicit Serena selection before every Serena effect.
2. Reuse ready Deck-owned Serena and `uv`; fail closed on found-but-unusable or indeterminate Serena.
3. If Deck-owned `uv` is absent, fetch only the fixed official installer endpoint and execute its bytes through a controlled noninteractive child-process boundary.
4. Run exactly `uv tool install -p 3.13 serena-agent` by resolved executable path and direct argument array in Deck-scoped tool, binary, Python, and cache locations.
5. Carry resolved Serena readiness evidence to an immediate pre-MCP revalidation and adapter-owned atomic configuration write.
6. Preserve OpenCode/Pi semantic parity, fixed-stage redacted progress, known-outcome cancellation, idempotent recovery, and deterministic no-real-I/O tests.

### Non-goals

- Independent installer or artifact integrity, checksum, release, attestation, or provenance verification.
- Custom release archives, target/libc classification, archive parsing, `pipx`, a separate system Python, language servers, or Serena optional language tooling.
- Replacing a found but unusable Serena, force-upgrading tools, deleting partial tool state, editing profiles or `PATH`, or writing system/global locations.
- Non-TUI, implicit, startup, initialization, bulk, or unrelated-capability installation.
- General runner installer/capability standardization or reopening historical changes.

## Architecture decisions

### AD-1: One Core Serena bootstrap service with injected effects

Add `packages/core/src/serena-bootstrap.ts` as the runner-neutral owner of authorization validation, Deck-owned path resolution, readiness, fixed installer acquisition/execution, Serena installation, cancellation, redaction, and typed outcomes. It must not import a runner adapter or TUI state. OpenCode and Pi project their existing catalog entries and result families into and out of this service.

All external effects are supplied through one dependency object: HTTPS fetch, filesystem inspection/directory creation, child-process execution, path canonicalization, executable probing, clock/timers, and platform/home-data resolution. Production defaults implement those seams. Tests replace every seam and never perform network, process, installer, or user-home I/O.

```ts
type SerenaBootstrapAuthorization = Readonly<{
  kind: "interactive-tui-explicit-selection";
  runner: "opencode" | "pi";
  operationId: string;
}>;

type SerenaBootstrapStage =
  | "preparing-uv"
  | "installing-serena"
  | "validating-serena";

type SerenaReadinessEvidence = Readonly<{
  capabilityId: "serena";
  state: "ready";
  resolvedExecutablePath: string;
  source: "existing-deck-tool" | "installed-deck-tool";
  probe: "serena-help";
  fingerprint: string;
}>;

type SerenaBootstrapResult =
  | { outcome: "reused" | "installed"; evidence: SerenaReadinessEvidence }
  | { outcome: "failed"; stage: SerenaBootstrapStage; code: SerenaBootstrapErrorCode; diagnostic: SafeDiagnostic }
  | { outcome: "cancelled"; stage: SerenaBootstrapStage; mutationStarted: boolean }
  | { outcome: "partial"; stage: SerenaBootstrapStage; code: "termination-unknown" };
```

The authorization object is evidence, not a reusable security token. Existing exported convenience functions that could install Serena without it become non-mutating compatibility wrappers that return a blocked result.

### AD-2: Explicit selection is ephemeral and runner-scoped

`RunnerDashboardState` gains an in-memory `explicitlySelectedCapabilities` map. Serena is not explicitly selected by defaults, package-instruction preferences, existing configuration, or inventory. Only a user action that selects Serena during the current Review & Install operation records `serena: true`; deselection removes it. A new operation or runner change resets it.

Both plan builders and `runRunnerReviewPlan` require ordinary Serena selection, current-operation explicit selection, matching operation ID, and the selected runner before dispatch. A stale or handcrafted plan fails before adapter invocation. No authorization state is persisted to Deck config, runner config, OpenSpec state, profiles, or any registry.

### AD-3: Controlled official installer execution, with accepted residual risk

The only installer URL constant is:

```text
https://astral.sh/uv/install.sh
```

When Serena is missing, Core first probes the deterministic Deck-owned `uv` path. If it is absent, the default acquisition seam:

1. issues the first HTTPS `GET` to that exact URL, with no user-controlled URL, query string, credentials, cookies, authorization headers, or fetch options;
2. manually follows at most five server-provided redirects and requires every hop to remain HTTPS without embedded credentials or a custom port; missing, malformed, insecure, or excess redirects fail closed, while no volatile CDN hostname/path inventory becomes a correctness dependency;
3. requires a successful terminal response and applies one operation-wide timeout plus a fixed response-size bound;
4. retains the bounded installer bytes only for this operation and does not persist, parse, rewrite, hash, or describe them as verified;
5. spawns the fixed absolute POSIX interpreter `/bin/sh` directly with `shell: false`, no command string, no user-controlled executable or arguments, piped stdio, and the installer bytes as standard input; and
6. closes standard input, captures bounded stdout/stderr internally, and waits for child close/error before classifying the result.

This is intentional execution of remote shell content, not “shell-free” installation. “No shell interpolation” means Deck never constructs or passes a shell command string and never interpolates user data into executable, arguments, URL, script bytes, or environment assignments. The remote script itself controls its downstream behavior and downloads; that is part of the explicitly accepted residual risk. Deck makes no independent integrity or provenance claim about either stage.

Missing-`uv` bootstrap is enabled only where `/bin/sh` is the fixed supported interpreter and the Deck user-data root is valid. Other platforms may reuse already-ready Deck-owned `uv`, but otherwise fail before fetch with an actionable unsupported-bootstrap result. There is no PowerShell, alternate URL, package-manager, archive, or `pipx` fallback.

### AD-4: Deck-owned storage and fixed environments

Resolve one absolute, canonical, per-user root through Deck's injected user-data resolver:

```text
<deck-data-root>/tools/serena/
  uv/              # UV_UNMANAGED_INSTALL; expected executable uv/uv
  uv-tools/        # UV_TOOL_DIR
  bin/             # UV_TOOL_BIN_DIR; expected Serena executable
  python/          # UV_PYTHON_INSTALL_DIR
  python-bin/      # UV_PYTHON_BIN_DIR
  cache/           # UV_CACHE_DIR
```

The resolver rejects relative, root/system, non-user-owned, symlink-escaping, or containment-ambiguous destinations before network or mutation. Directories are created with user-only permissions where supported. Deck never writes `/usr`, `/opt`, another user's home, or a system Python location.

The installer child receives a newly constructed allowlisted environment, not `process.env`:

```text
PATH=/usr/bin:/bin
LC_ALL=C
UV_UNMANAGED_INSTALL=<deck-data-root>/tools/serena/uv
UV_NO_MODIFY_PATH=1
```

`UV_UNMANAGED_INSTALL` is the primary installer contract: upstream documentation states that it installs to the supplied directory, prevents profile/environment modification, and disables self-update. `UV_NO_MODIFY_PATH=1` is retained as defense in depth. Deck never invokes `uv self update`.

After installation, Core resolves only `<...>/uv/uv`, validates containment and stable file identity, and directly probes that absolute path with `['--version']`. Exit status from the remote installer alone is not readiness.

The Serena child receives another newly constructed allowlisted environment:

```text
PATH=/usr/bin:/bin
LC_ALL=C
UV_TOOL_DIR=<deck-data-root>/tools/serena/uv-tools
UV_TOOL_BIN_DIR=<deck-data-root>/tools/serena/bin
UV_PYTHON_INSTALL_DIR=<deck-data-root>/tools/serena/python
UV_PYTHON_BIN_DIR=<deck-data-root>/tools/serena/python-bin
UV_CACHE_DIR=<deck-data-root>/tools/serena/cache
```

The sole mutation command is:

```text
command: <resolved-deck-owned-uv-path>
args: ["tool", "install", "-p", "3.13", "serena-agent"]
```

It uses `shell: false` and no `--force`, retry loop, fallback, `pipx`, obsolete `serena` package, global/system Python, profile edit, or PATH mutation. Python 3.13 acquisition is delegated to `uv` and remains under the fixed Python directories. Catalog and selectable-plan source identity is `serena-agent` for both runners.

### AD-5: Readiness is stable resolved-path evidence

Readiness considers only deterministic candidates inside the canonical Deck-owned Serena root: the expected `UV_TOOL_BIN_DIR` Serena executable and an existing runner entry only when its absolute path resolves to that same owned root. It never performs a shell lookup or automatically reuses state outside Deck-owned storage.

For each candidate, Core rejects NUL/unsafe tokens, non-absolute paths, containment escapes, missing/empty/non-regular files, dangling links, non-executable files, and identity changes during inspection. The expected `UV_TOOL_BIN_DIR` entry may be a symlink because that is the normal `uv tool install` layout, but only when its canonical target is a regular executable inside the same owned root. Core fingerprints both link and target, probes the absolute managed entry with `['--help']`, bounded output, timeout, fixed environment, and `shell: false`, and repeats the same containment/identity checks immediately before configuration. Found-but-unusable or indeterminate Serena blocks replacement installation.

Evidence retains the stable absolute managed command path and fingerprints its complete executable identity: the regular file itself, or both the contained symlink and canonical target. Immediately before MCP configuration, the action runner invokes the injected revalidator, requires the same path and fingerprint, and checks cancellation again. A changed, retargeted, escaping, or stale executable prevents the writer call.

### AD-6: Evidence-carrying results and adapter-owned atomic MCP writes

The package-install result gains typed optional `serenaReadiness`. Serena `already-present`/`executed` results are satisfied only with valid ready evidence; failed, skipped, cancelled, or partial results cannot carry it. The action runner retains evidence privately by capability and never renders its path.

On success, the selected adapter receives only:

```text
[<resolved-serena-path>, "start-mcp-server", "--context", "ide", "--project-from-cwd"]
```

- OpenCode serializes the complete array as local `mcp.serena.command`.
- Pi serializes element zero as `mcpServers.serena.command` and the remaining four elements as `args`.

Each adapter validates the absolute owned path and exact arguments, reads and parses existing configuration before mutation, preserves unrelated entries, and performs an adapter-owned same-directory temporary-file plus atomic-rename merge. Equivalent known-good Serena entries return `unchanged` with no write. Malformed/unreadable configuration fails without rewriting.

OpenCode moves Serena configuration into `configWrites`. Pi narrows each `write-pi-mcp-config` action to its named capability. Direct adapter paths use the same evidence/revalidation gate. On bootstrap, install, readiness, cancellation, partial, or revalidation failure, the writer is not called. A legacy bare-command Serena entry remains untouched on failure/cancellation and may be migrated only after selected-operation success; no failed/cancelled path creates or replaces configuration with bare `serena`.

### AD-7: Cancellation waits for a known process outcome

One `AbortController` belongs to the current Review & Install operation. Its signal crosses the action runner, adapter, Core, fetch, probe, and process seams. Escape/quit requests cancellation but keeps the progress view active with a fixed “Cancellation requested; waiting for the active command to stop” state.

Core checks the signal before every fetch, directory mutation, spawn, probe, and config write. For a running child it requests termination through a direct process API, waits a bounded grace period, and may escalate without a shell. It reports `cancelled` only after close/error confirms the outcome. If termination cannot be confirmed, it reports `partial/termination-unknown`; both outcomes skip all later Serena stages and MCP writes.

Cancellation cleanup never deletes installed/partial `uv`, Python, Serena tool state, or runner configuration. A later explicit operation starts with fresh readiness checks.

### AD-8: Fixed stages, bounded redaction, and single-flight serialization

Core emits stage enums, never installer streams. The CLI maps them to the fixed labels **Preparing uv**, **Installing Serena**, and **Validating Serena**; it emits **Configuring MCP** only after immediate evidence revalidation and just before the writer. Reuse omits inapplicable stages.

Child stdout/stderr stays in bounded internal buffers used only for outcome classification. Public results use fixed code-to-message templates. Redaction removes credentials, URL secrets, private roots, control/format characters, and excessive lines/scalars/UTF-8 bytes. Raw exception text, script bytes, environment values, and resolved private paths do not cross Core into adapter callbacks, debug logs, or rendering.

Concurrent Serena operations for the same canonical Deck root share a Core single-flight. Followers retain independent cancellation and revalidate the leader result. This avoids concurrent installer/tool mutations without introducing a general installer framework.

## Data flow

```mermaid
sequenceDiagram
  actor User
  participant UI as CLI TUI
  participant Run as Action runner
  participant Adapter as Selected adapter
  participant Core as Serena bootstrap service
  participant Endpoint as astral.sh fixed endpoint
  participant SH as /bin/sh child
  participant UV as Resolved uv child
  participant Config as Adapter MCP writer

  User->>UI: Explicitly select Serena and confirm
  UI->>Run: Selected runner + ephemeral authorization + abort signal
  Run->>Adapter: Authorized Serena install action
  Adapter->>Core: bootstrapSerena(injected effects)
  Core->>Core: Resolve Deck-owned Serena readiness
  alt Serena ready
    Core-->>Run: reused + resolved-path evidence
  else Serena unusable/indeterminate
    Core-->>Run: failed; no mutation/config
  else Serena missing
    Core->>Core: Resolve/probe Deck-owned uv
    opt uv missing and platform supported
      Core->>Endpoint: GET exact initial URL; follow bounded secure redirects
      Endpoint-->>Core: Remote installer bytes
      Core->>SH: Direct spawn; fixed env; script on stdin
      SH-->>Core: Known bounded child outcome
      Core->>Core: Resolve/probe expected uv path
    end
    Core->>UV: Direct args: tool install -p 3.13 serena-agent
    UV-->>Core: Known bounded child outcome
    Core->>Core: Resolve/probe Serena
    Core-->>Run: installed + resolved-path evidence
  end
  Run->>Run: Abort check + immediate evidence revalidation
  alt valid and config differs
    Run->>Config: Absolute path + fixed MCP args
    Config-->>Run: Atomic created/updated
  else equivalent config
    Config-->>Run: unchanged; no write
  else failed/cancelled/partial/stale
    Run-->>UI: Fail closed; writer not called
  end
```

## State, compatibility, recovery, and migration

- **Repository runtime state:** none. Runtime never writes OpenSpec or registry artifacts.
- **Ephemeral state:** operation ID, explicit-selection map, abort controller, stage events, and readiness evidence exist only for the current operation.
- **External user state:** only the Deck Serena root and at most one selected-runner Serena MCP entry.
- **Reuse:** ready Deck-owned Serena skips bootstrap/install; ready Deck-owned `uv` skips remote installer execution. Outside-root state is observed only to avoid unsafe replacement and is never modified or automatically reused.
- **Idempotency:** equivalent MCP configuration is unchanged; same-root operations are single-flight; each retry begins with fresh path/readiness checks.
- **Partial recovery:** no `--force`, destructive cleanup, or automatic repair. Valid partial Deck-owned state may be reused after probing; unusable/indeterminate Serena blocks and requires user-directed recovery outside this flow.
- **Migration:** no data migration. A legacy bare Serena MCP entry is lazily replaced only after fresh selected-operation success and pre-write revalidation.
- **Compatibility:** non-Serena capabilities and install-result semantics remain unchanged. OpenCode and Pi keep native config formats but share security and outcome semantics.

## Public and internal contract changes

1. `@deck/core` exports the bootstrap service, typed authorization/outcomes, readiness evidence, and revalidator contract.
2. Core/CLI dashboard contracts add ephemeral explicit-selection and operation identity.
3. The package installer context carries authorization, abort signal, and stage callback; Serena results may carry readiness evidence.
4. Action-runner dependencies add the operation signal and injected Serena revalidator.
5. Adapter Serena entry points require authorization/evidence; unauthenticated compatibility wrappers are non-mutating.
6. MCP writer results distinguish `created | updated | unchanged`; Serena writers require an absolute command path and exact fixed arguments.
7. No prompt, skill, system instruction, registry, public network API, package dependency, or lockfile contract changes.

## Verification strategy

All install-facing tests use injected fakes and fixture paths. The production redirect policy may be exercised only through its injected fake fetch transport. No automated test may perform a real network fetch or call `/bin/sh`, `uv`, Serena, a user-home writer, or a real MCP writer.

### Core

- Explicit authorization and Deck-root containment; unselected/default-only/runner-mismatched calls have zero effects.
- Existing ready Serena/`uv` reuse; outside-root state is not reused; unusable/indeterminate Serena blocks replacement.
- Exact initial installer URL and bounded secure manual-redirect policy; fixed method/options; operation-wide body/time bounds; no credentials or user input.
- Exact `/bin/sh` direct-spawn shape, installer bytes only on stdin, fixed allowlisted environment, no shell command string, and no fallback.
- Exact resolved `uv` path, direct argument array, Deck-scoped uv/tool/Python/cache environment, and no profile/PATH/system/pipx/self-update behavior.
- Installer success without ready `uv`, uv success without ready Serena, stable evidence, redaction, single-flight, and retry recovery.
- Cancellation before each effect and during each child process, including confirmed and unknown termination.

### Adapters, action runner, and TUI

- Both catalogs/plans identify `serena-agent`, require current-operation explicit selection, and preserve equivalent outcomes.
- OpenCode config ordering and Pi capability-specific dispatch prevent incidental Serena writes.
- Failed/cancelled/partial/missing/stale evidence never invokes either writer; changed path/fingerprint fails closed.
- Both writers validate the absolute path and exact args, preserve unrelated entries, reject malformed config, atomically merge, and return unchanged without a write for equivalent config.
- Render tests show only applicable fixed stages and bounded terminal outcomes, never raw streams/private paths.
- Escape/quit waits for known child outcome and prevents remaining stages/configuration.

Focused Bun tests cover the Core service, both adapter install/plan/config paths, the runner-install contract, and render-level TUI behavior, followed by affected package tests, TypeScript checking, and repository-wide `bun test` subject to the baseline ledger. This Design phase runs none of those commands.

After implementation and automated verification, only the user may perform live functional confirmation:

```sh
bun run deck:run
```

No agent runs that command, the installer, network access, or user-home effects during Design, Apply, Verify, or Review.

## Rollout and rollback

Roll out OpenCode and Pi together only after shared Core, cancellation, readiness, config-gating, parity, and render tests pass. Do not ship one runner with weaker semantics. Operational diagnostics are stage/code/outcome only; no raw output or private paths.

Rollback is a normal source revert of future implementation/tests. It preserves Deck-owned uv/Python/Serena state and existing runner configuration, performs no automatic deletion, rewrites no registry history, and uses no destructive Git command.

## Coordination and hard stops

- **P-SEC-001 is superseded, not active.** Its trust-manifest, pinned archive, digest, attestation, target-classifier, and archive-decoder conditions belong to the replaced design. They must not be carried into future Tasks/Apply or cited as proof that the official installer is verified. `preconditions.md` still contains the stale condition and requires coordinator-owned reconciliation; this Design does not edit it.
- **P-CLI-001 remains the Apply serialization blocker.** `apps/cli/src/tui/app.tsx` is shared with `opencode-configured-providers-filter`. The coordinator must decide order, obtain a clean handoff, require a pre-edit reread, and rerun provider-filter/menu tests. Serena work must not absorb that change.
- Existing `tasks.md` still describes the superseded archive mechanism. It must be reconciled by the proper Task phase before Apply; this Design-only phase does not edit it.
- If a future target conflicts with uncommitted ownership, Apply stops for coordinator reconciliation and never overwrites or discards work.
- No target intersects `runner-capability-standardization`.

There is no unresolved technical decision in this Design. Apply remains blocked by P-CLI-001 and by coordinator-owned downstream Tasks/Preconditions reconciliation, not by P-SEC-001.

## Exact future editable targets and file estimate

This is the exact implementation allowlist for future Tasks/Apply; it grants no modification authority in this Design phase.

### Core (5 files)

- `packages/core/src/serena-bootstrap.ts`
- `packages/core/src/serena-bootstrap.test.ts`
- `packages/core/src/index.ts`
- `packages/core/src/runner-adapter.ts`
- `packages/core/src/runner-adapter.test.ts`

These files own the shared controlled-installer/readiness service and neutral contracts. No trust-manifest, target-classifier, downloader archive, tar-decoder, attestation, or digest module/file is permitted.

### OpenCode adapter (12 files)

- `packages/adapter-opencode/src/capability-catalog.ts`
- `packages/adapter-opencode/src/capability-catalog.test.ts`
- `packages/adapter-opencode/src/installation-plan.ts`
- `packages/adapter-opencode/src/installation-plan.test.ts`
- `packages/adapter-opencode/src/capability-plan.ts`
- `packages/adapter-opencode/src/capability-plan.test.ts`
- `packages/adapter-opencode/src/install-tools.ts`
- `packages/adapter-opencode/src/install-tools.test.ts`
- `packages/adapter-opencode/src/runner-adapter.ts`
- `packages/adapter-opencode/src/runner-adapter.test.ts`
- `packages/adapter-opencode/src/opencode-mcp-config.ts`
- `packages/adapter-opencode/src/opencode-mcp-config.test.ts`

### Pi adapter (12 files)

- `packages/adapter-pi/src/capability-catalog.ts`
- `packages/adapter-pi/src/capability-catalog.test.ts`
- `packages/adapter-pi/src/installation-plan.ts`
- `packages/adapter-pi/src/installation-plan.test.ts`
- `packages/adapter-pi/src/capability-plan.ts`
- `packages/adapter-pi/src/capability-plan.test.ts`
- `packages/adapter-pi/src/install-tools.ts`
- `packages/adapter-pi/src/install-tools.test.ts`
- `packages/adapter-pi/src/pi-mcp-config.ts`
- `packages/adapter-pi/src/pi-mcp-config.test.ts`
- `packages/adapter-pi/src/runner-adapter.ts`
- `packages/adapter-pi/src/runner-adapter.test.ts`

### CLI TUI (9 files)

- `apps/cli/src/tui/runner-dashboard/state.ts`
- `apps/cli/src/tui/runner-dashboard/reducer.ts`
- `apps/cli/src/tui/runner-dashboard/reducer.test.ts`
- `apps/cli/src/tui/runner-dashboard/action-runner.ts`
- `apps/cli/src/tui/runner-dashboard/action-runner.test.ts`
- `apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts`
- `apps/cli/src/tui/screens/runner-dashboard-screens.tsx`
- `apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx`
- `apps/cli/src/tui/app.tsx`

**Estimated future implementation impact:** 38 files: 20 production files (1 added, 19 modified) and 18 test files (1 added, 17 modified). Including this Design artifact, the total anticipated change footprint is 39 files. This is smaller than the superseded archive design and contains no archive/trust/provenance support files, no new dependency, and no lockfile change. Any required target outside this allowlist returns to Design/Task reconciliation rather than expanding Apply scope.

## Alternatives and tradeoffs

| Alternative | Decision | Rationale / tradeoff |
|---|---|---|
| Keep the pinned archive/trust-manifest design | Superseded | More independent controls, but materially larger custom downloader/parser/provenance scope rejected by the approved revision. |
| Execute the official installer | Chosen with explicit risk acceptance | Smallest approved bootstrap; remote mutable executable content remains a supply-chain risk Deck does not independently verify. |
| Persist installer to disk before execution | Rejected | Adds lifecycle/cleanup surface without improving approved trust; bounded stdin execution is smaller. |
| Follow the server-selected redirect chain with bounded transport rules | Chosen after live correction | The exact official endpoint already controls the executable bytes and its current asset location. Five-hop, HTTPS-only, no-credential/no-custom-port handling preserves stable safety controls without coupling Deck to volatile CDN hostnames. |
| Maintain a CDN hostname/path allowlist | Rejected after live evidence | It added false precision and broke the official flow when infrastructure changed, while not independently authenticating content that the trusted initial endpoint could serve directly. |
| Follow unrestricted redirects | Rejected | Would remove hop and transport bounds. |
| `curl | sh` command string | Rejected | Couples download and execution, introduces shell command composition, and weakens injection/testing boundaries. |
| `pipx`, system Python, PowerShell, or package-manager fallback | Rejected | Violates the approved exact path and storage boundary. |
| Reuse arbitrary PATH installations | Rejected | Cannot prove Deck ownership or prevent modifying outside-scope state. |
| Put the flow in each adapter or the CLI | Rejected | Duplicates security/cancellation policy and invites runner drift. |
| Persist explicit selection | Rejected | A prior/default preference cannot authorize a later operation. |
| Configure bare `serena` | Rejected | Discards resolved-path evidence and can resolve differently at runner startup. |

## Risks and safeguards

| Risk | Level | Safeguard |
|---|---|---|
| Official installer or its downstream content is compromised/mutated | High, accepted residual | Exact initial HTTPS endpoint, bounded HTTPS-only redirects, no credentials/user URL/args, bounded fetch/process, Deck-owned destinations, and explicit no-verification claim. |
| Remote script performs behavior beyond Deck's direct control | High, accepted residual | Noninteractive isolated child, fixed minimal environment, unmanaged install path, no profile/PATH edits, bounded output/time, cancellation, and no fallback. |
| Installer writes outside intended locations | High | `UV_UNMANAGED_INSTALL`, `UV_NO_MODIFY_PATH`, fixed user-owned root, minimal environment, post-install expected-path validation, and tests of Deck's invocation contract. These controls reduce but cannot prove remote-script behavior. |
| TOCTOU between readiness and MCP write | High | Canonical resolved path/fingerprint plus immediate same-evidence revalidation. |
| Cancellation leaves partial tools | Medium | Known process outcome, no success claim, no config write, preserve state, and fresh retry probes. |
| Private data leaks from process output | High | Internal bounded capture, fixed messages, redaction, and no raw streams/paths in callbacks or logs. |
| Pi/OpenCode config drift or incidental Serena write | High | Shared evidence contract, capability-specific dispatch, adapter-owned atomic merges, and parity tests. |
| Active `app.tsx` collision | High | P-CLI-001 ownership serialization and regression reruns. |
| Fixed endpoint unavailable or unsupported platform lacks `/bin/sh` | Medium | Fail closed before Serena/config mutation; no alternate endpoint or fallback. |

## Exact Implementation Instructions

No EII applies. This change does not modify Deck-owned prompts, skills, or system instructions.

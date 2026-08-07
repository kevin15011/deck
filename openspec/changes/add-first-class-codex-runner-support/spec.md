# Specification: First-Class Codex CLI Runner Support

## Source

- Exploration: `exploration.md`
- Proposal: `proposal.md`
- Related official changes: `hexagonal-architecture-memory-refactor`, `pi-support-parity-opencode`, `deck-as-installer-runner-agnostic`, `model-reasoning-effort-capability`, `installer-sync-opencode-skills`, and `reuse-opencode-install-plan-for-verify`.

## Requirements

### Capability: Runner composition and launch

REQ-CDX-ARCH-001: Deck MUST use `RunnerAdapter` and `AdapterRegistry` as the authoritative operational path for Codex runtime inspection, installation, verification, diagnostics, and launch planning.

REQ-CDX-ARCH-002: Deck MUST retain runner capability/parity data as declarative metadata and MUST NOT create a third operational runner abstraction for Codex.

REQ-CDX-ARCH-003: Deck MUST provide a runner-neutral launch-plan contract that supports interactive, exec, and resume modes without allowing adapters to spawn processes directly.

REQ-CDX-ARCH-004: The CLI MUST own process spawning, terminal inheritance, output capture, signal handling, exit-code propagation, and secret redaction.

REQ-CDX-ARCH-005: Codex MUST be registered in the CLI composition root, and TUI modules MUST NOT import `@deck/adapter-codex` directly.

REQ-CDX-ARCH-006: Codex first-class activation MUST provide a trusted runner-host bridge for host input, dossier revision continuity, one-use invocation authorization, controlled effects, centralized registry writing, and bound verification evidence.

REQ-CDX-ARCH-007: If a stable released Codex surface cannot provide REQ-CDX-ARCH-006, Deck MUST classify the integration as `static-compatible`, MUST remove claims that protected controls are enforced, and MUST expose each unavailable control as a capability gap.

REQ-CDX-ARCH-008: Codex adapters MUST own runner-native inspection and configuration effects behind typed project-scoped plan/apply/verify/backup/rollback contracts; the CLI MUST own authorization, orchestration, and launch process effects.

REQ-CDX-ARCH-009: Runner inspection MUST accept an explicit project root and MUST return typed evidence rather than `unknown` for Codex-required readiness and ownership data.

REQ-CDX-ARCH-010: Each interactive, exec, resume-by-ID, and resume-latest production route MUST be labeled first-class only when that exact route traverses or is observably bound to the selected trusted host bridge; any unbound mode MUST remain individually `static-compatible`.

### Capability: Safe project materialization

REQ-CDX-MAT-001: Deck MUST materialize Codex Developer Team roles as Deck-owned files under `.codex/agents/` using collision-safe names.

REQ-CDX-MAT-002: Deck MUST materialize canonical skills under `.agents/skills/deck-*/SKILL.md` and MUST preserve all non-Deck skills.

REQ-CDX-MAT-003: Deck MUST own only a marker-delimited section of `AGENTS.md`, MUST preserve all unowned bytes, and MUST NOT create `AGENTS.override.md`.

REQ-CDX-MAT-004: Deck MUST detect `AGENTS.override.md` and nested instruction precedence that can shadow Deck content and MUST expose the condition as a diagnostic.

REQ-CDX-MAT-005: Deck MUST restrict `.codex/config.toml` changes to an allowlist of Deck-owned keys and tables required for agents, MCP, and supported multi-agent behavior.

REQ-CDX-MAT-006: Deck MUST preserve comments, formatting, order, and unrelated TOML content outside owned source spans.

REQ-CDX-MAT-007: A same-ID unowned role, skill, MCP table, or managed marker collision MUST block that item instead of overwriting it.

REQ-CDX-MAT-008: Installation MUST support immutable planning, preview, backup, per-file atomic apply, semantic verification, idempotency, and optimistic rollback.

REQ-CDX-MAT-009: Every file mutation MUST declare the confined relative path, expected preimage kind/hash/mode, intended postimage hash/mode, ownership evidence, and restore-or-delete rollback action.

REQ-CDX-MAT-010: Immediately before each write, Deck MUST reject path escape, symlinks, non-regular targets, changed preimages, and unsupported ownership or permission states.

REQ-CDX-MAT-011: Multi-file apply MUST use per-file atomic replacement plus a recoverable transaction journal; Deck MUST NOT describe the whole multi-file operation as filesystem-atomic.

REQ-CDX-MAT-012: Backups and journals MUST use the existing Deck backup boundary, restrictive permissions equivalent to `0600`, bounded retention, and diagnostics that never expose backed-up secret values.

REQ-CDX-MAT-013: `--local-only` MUST exclude only exact newly created, untracked, fully Deck-owned files through Git's effective worktree-aware `info/exclude` path. It MUST NOT hide tracked files, shared-file edits, or broad user-owned directories; visible tracked/shared mutations MUST be reported, and a request for zero visible tracked changes MUST block any required shared-file mutation.

### Capability: Runtime execution

REQ-CDX-RUN-001: `deck codex developer` MUST install or verify the selected Developer Team and then launch Codex interactively with inherited terminal I/O.

REQ-CDX-RUN-002: Deck MUST provide an explicit Codex exec mode that propagates the Codex exit status and does not require app-server.

REQ-CDX-RUN-003: Deck SHOULD support resume-by-ID and resume-latest when the detected Codex build exposes those capabilities.

REQ-CDX-RUN-004: Unsupported launch modes MUST return a structured capability diagnostic and MUST NOT guess command-line flags.

REQ-CDX-RUN-005: Deck MUST default to no sandbox or approval-policy override and MUST NOT emit dangerous bypass flags automatically.

REQ-CDX-RUN-006: Deck MUST define and enforce a documented minimum supported Codex version or equivalent feature-probe contract before declaring the runner ready.

REQ-CDX-RUN-007: Launch inputs MUST discriminate interactive, exec, resume-by-ID, and resume-latest modes and MUST return `unsupported` separately from `blocked`.

REQ-CDX-RUN-008: Launch environment changes MUST be typed as an allowlisted overlay, MUST identify sensitive keys for redaction, and MUST NOT replace the complete inherited environment implicitly.

REQ-CDX-RUN-009: Exec output capture MUST define bounded stdout/stderr handling, stdin behavior, signal outcomes, truncation diagnostics, and secret redaction.

REQ-CDX-RUN-010: The public Codex CLI grammar MUST be `deck codex developer`, `deck codex developer --install-only`, `deck codex developer exec -- <prompt...>`, `deck codex developer resume <session-id>`, or `deck codex developer resume --last`, with optional `--dry-run`, `--local-only`, and `--yes` only where applicable.

REQ-CDX-RUN-011: When a direct command requires project mutation, Deck MUST preview the plan and obtain interactive confirmation. In non-interactive execution it MUST fail without mutation unless `--yes` is present.

### Capability: Agents, models, MCP, memory, and shared tools

REQ-CDX-INT-001: Every selected Developer Team agent MUST map to a Codex-native role with its instructions, model assignment, reasoning assignment, and supported tool/MCP context.

REQ-CDX-INT-002: Deck MUST map only confirmed model and reasoning values. Unknown reasoning support MUST result in omission rather than a fabricated default.

REQ-CDX-INT-003: Deck MUST add explicit Codex mappings to the canonical capability/parity registry for agents, skills, instructions, MCP, models, memory, shared binaries, launch, doctor, and TUI.

REQ-CDX-INT-004: Deck MUST treat missing, deferred, blocked, and not-applicable Codex capabilities as explicit observable states.

REQ-CDX-INT-005: Deck MUST reuse a compatible context-mode, codebase-memory, RTK, or Serena binary before attempting installation.

REQ-CDX-INT-006: A reusable binary MUST pass the existing observable usability contract; binary presence alone MUST NOT satisfy an MCP-backed capability.

REQ-CDX-INT-007: Deck MUST configure and semantically verify applicable Codex MCP entries for Context7, context-mode, codebase-memory, Serena, and the selected supported memory provider.

REQ-CDX-INT-008: Supermemory credentials MUST remain outside project files and MUST be redacted from plans, diagnostics, and reports.

REQ-CDX-INT-009: Initial Engram support MAY be deferred, but its state MUST be reported as an explicit capability gap rather than silently omitted.

### Capability: Standalone skills and packages

REQ-CDX-PKG-001: Deck MUST materialize every entry in the canonical `STANDALONE_SKILLS` catalog for Codex; the current baseline is 29 external standalone skills.

REQ-CDX-PKG-002: Each external standalone skill MUST preserve its original `SKILL.md` frontmatter/body and every bundled support file at its relative package path.

REQ-CDX-PKG-003: Deck MUST install and verify `deck-onboard` and `deck-archive` as bootstrap standalone skills independently from the external standalone catalog and agent-bound skills.

REQ-CDX-PKG-004: Deck MUST distinguish agent-bound skills, external standalone skills, bootstrap skills, package instructions, runtime capabilities/packages, and runner-internal/silent packages in plans, manifests, diagnostics, and parity reports.

REQ-CDX-PKG-005: Codex configuration MUST support all six canonical package-instruction IDs in deterministic order: `codebase-memory`, `code-economy`, `context-mode`, `rtk`, `adaptive-memory`, and `serena`.

REQ-CDX-PKG-006: Codex package-instruction defaults MUST preserve the current policy of `code-economy: true` and all other package-instruction IDs disabled unless a separately approved policy changes it.

REQ-CDX-PKG-007: Enabled package instructions MUST be composed only onto their declared session, agent, or skill surfaces and MUST translate runner/tool references to verified Codex-native names without changing canonical intent.

REQ-CDX-PKG-008: Selecting a package instruction MUST NOT by itself mark its runtime capability ready; executable, MCP, provider, hook, or tool-policy readiness MUST be verified independently where applicable.

REQ-CDX-PKG-009: Every package or capability applicable to Codex MUST use the canonical support status vocabulary (`supported`, `runner-specific`, `shared`, `manual-verified`, `gap`, `blocked`, or `not-applicable`) plus a typed provision mode where needed; runner-specific Pi/OpenCode packages MUST NOT be copied to Codex without an explicit Codex mapping.

REQ-CDX-PKG-010: Core parity metadata and Codex adapter catalog/install metadata MUST agree on the fields owned by the parity schema, including capability ID, support status, provision mode, executable, and MCP server. A separate instruction-bundle validator MUST validate required surfaces and tool policies against canonical instruction metadata; validation MUST detect semantic disagreement rather than only mapping presence.

REQ-CDX-PKG-011: Codex content synchronization MUST detect, plan, back up, apply, and verify agent role files, agent-bound skills, all external standalone bundles, both bootstrap skills, and base/selected instruction composition. Synchronization MUST still process managed content when zero optional package instructions are selected.

REQ-CDX-PKG-012: Binary and development builds MUST expose identical standalone skill bundles; generated standalone content MUST be updated only through the canonical generator and MUST pass freshness/idempotency checks.

REQ-CDX-PKG-013: Content-only synchronization MUST NOT install or update runtime packages, MCP servers, memory providers, shared binaries, or runner-native optional capabilities; those effects remain in explicit install/review flows.

### Capability: Trust, security, and ownership

REQ-CDX-SEC-001: Deck MUST NOT mark a repository trusted or instruct Codex to bypass trust automatically.

REQ-CDX-SEC-002: Deck MUST report when project-local Codex configuration is materialized but inactive because trust is absent or indeterminate.

REQ-CDX-SEC-003: Deck MUST NOT write credentials, alternate API endpoints, provider secrets, or denylisted security settings into project-local Codex configuration.

REQ-CDX-SEC-004: Deck MUST NOT weaken Codex sandbox or approval defaults during installation.

REQ-CDX-SEC-005: Persistent rollback MUST compare the current target hash to the installed hash and MUST stop on post-install user edits.

### Capability: User experience and verification

REQ-CDX-UX-001: Codex MUST appear as a supported runtime in environment selection and MUST no longer be labeled as a placeholder.

REQ-CDX-UX-002: Doctor MUST report Codex binary/version readiness, trust/config activation, roles, skills, instructions, MCP, shared binaries, drift, and capability gaps.

REQ-CDX-UX-003: The runner dashboard and Developer Team flow MUST consume registered adapter metadata instead of expanding closed Pi/OpenCode unions for Codex-specific behavior.

REQ-CDX-UX-004: Diagnostics MUST be understandable without relying only on color or icons and MUST include a safe recommended action.

REQ-CDX-VER-001: Automated tests MUST use temporary filesystems, injected process runners, deterministic fixtures, no network, no real installations, and no user-home writes.

REQ-CDX-VER-002: Verification MUST cover Codex adapter tests, CLI launch contracts, runner install contracts, render-only TUI tests, Pi/OpenCode regressions, type checking, the full test suite, and binary build.

REQ-CDX-VER-003: Documentation MUST state supported Codex versions/features, project trust behavior, materialized paths, ownership rules, rollback behavior, launch modes, and known gaps.

REQ-CDX-VER-004: The implementation MUST preserve the broad baseline or document only pre-existing failures through the approved baseline ledger workflow.

REQ-CDX-VER-005: The released-version compatibility matrix MUST cover roles, skills, multi-agent enablement, project trust/config, denylisted project settings, MCP stdio/HTTP, interactive/exec/resume grammar, model keys, reasoning keys, and the selected runner-host bridge surface.

## Acceptance scenarios

### Scenario: Codex is composed through one operational registry

**Given** the CLI starts with Pi, OpenCode, and Codex support
**When** it resolves the selected runner
**Then** it obtains the Codex implementation from `AdapterRegistry`
**And** no TUI module imports the Codex adapter directly

> Covers: REQ-CDX-ARCH-001, REQ-CDX-ARCH-002, REQ-CDX-ARCH-005

### Scenario: First-class execution has trusted host authority

**Given** Codex is advertised as a first-class Developer Team runner
**When** a role attempts a protected effect
**Then** trusted host input, dossier continuity, and one-use invocation authorization are validated
**And** registry and verification effects remain bound to the authorized invocation

> Covers: REQ-CDX-ARCH-006, REQ-CDX-ARCH-008, REQ-CDX-ARCH-009

### Scenario: Every first-class launch route is bridge-bound

**Given** interactive, exec, and resume modes are advertised for Codex
**When** Deck classifies each production launch route
**Then** only routes that traverse or are observably bound to the trusted bridge are first-class
**And** every unbound route is individually labeled `static-compatible`

> Covers: REQ-CDX-ARCH-006, REQ-CDX-ARCH-007, REQ-CDX-ARCH-010

### Scenario: Missing trusted surface degrades honestly

**Given** the supported Codex release cannot expose a stable trusted runner-host event
**When** Deck installs or diagnoses Codex
**Then** the runner is classified as `static-compatible`
**And** prompts and diagnostics do not claim invocation authorization or controlled effects are enforced
**And** unavailable controls are explicit gaps

> Covers: REQ-CDX-ARCH-007, REQ-CDX-INT-003, REQ-CDX-INT-004

### Scenario: Native roles and skills are complete

**Given** a selected Developer Team manifest
**When** Deck materializes Codex project assets
**Then** every selected role has a Deck-owned native role file
**And** every selected canonical skill has a Deck-owned skill directory
**And** non-Deck roles and skills remain unchanged

> Covers: REQ-CDX-MAT-001, REQ-CDX-MAT-002, REQ-CDX-INT-001

### Scenario: Existing user TOML is preserved

**Given** `.codex/config.toml` contains comments, unusual formatting, unrelated keys, and user MCP entries
**When** Deck applies a Codex installation plan
**Then** only Deck-owned source spans change
**And** every unowned byte remains unchanged
**And** the resulting TOML reparses semantically

> Covers: REQ-CDX-MAT-005, REQ-CDX-MAT-006, REQ-CDX-MAT-008

### Scenario: Plan-time preimage changes before apply

**Given** Deck previewed a file mutation
**And** the target changed before apply
**When** Deck performs the immediate pre-write comparison
**Then** the mutation is rejected without overwriting the new content
**And** the transaction journal records a recoverable conflict

> Covers: REQ-CDX-MAT-009, REQ-CDX-MAT-010, REQ-CDX-MAT-011

### Scenario: Unsafe filesystem target is rejected

**Given** a planned target is a symlink, non-regular file, or escapes the project root
**When** Deck validates the mutation manifest
**Then** apply is blocked before backup or write

> Covers: REQ-CDX-MAT-009, REQ-CDX-MAT-010

### Scenario: Backup and interrupted apply are recoverable

**Given** a multi-file Codex installation fails after one or more replacements
**When** Deck reopens the restrictive transaction journal
**Then** it identifies every prepared and applied target
**And** restores or deletes only hash-matching postimages
**And** reports no backed-up secret values

> Covers: REQ-CDX-MAT-011, REQ-CDX-MAT-012, REQ-CDX-SEC-005

### Scenario: Local-only exclusion is exact and honest

**Given** a worktree contains new Deck-owned files plus tracked or shared Codex targets
**When** the user confirms `--local-only`
**Then** Deck resolves the effective Git exclude path and excludes only exact untracked fully owned files
**And** tracked or shared mutations remain visible and are reported
**And** Deck blocks required shared-file mutation when the user requires zero visible tracked changes

> Covers: REQ-CDX-MAT-013, REQ-CDX-RUN-010, REQ-CDX-RUN-011

### Scenario: Unowned collision blocks safely

**Given** a user already owns a role, skill, MCP table, or marker using a Deck target identifier
**When** Deck reviews or applies the installation
**Then** the item is reported as a collision
**And** Deck does not overwrite it

> Covers: REQ-CDX-MAT-007

### Scenario: Instructions respect Codex precedence

**Given** a project contains existing `AGENTS.md`, nested instructions, or `AGENTS.override.md`
**When** Deck materializes its instruction section
**Then** existing content is preserved
**And** Deck does not create an override file
**And** any shadowing condition is visible in doctor/review diagnostics

> Covers: REQ-CDX-MAT-003, REQ-CDX-MAT-004, REQ-CDX-UX-002

### Scenario: Interactive launch succeeds

**Given** Codex is ready and the Developer Team verifies successfully
**When** the user runs `deck codex developer`
**Then** the adapter returns an interactive launch plan
**And** the CLI spawns Codex with inherited terminal I/O
**And** the final exit status is propagated

> Covers: REQ-CDX-ARCH-003, REQ-CDX-ARCH-004, REQ-CDX-RUN-001

### Scenario: Exec mode is bounded and deterministic

**Given** Codex exec is supported by the detected release
**When** the user runs `deck codex developer exec -- <prompt...>`
**Then** Deck executes the discriminated exec plan
**And** uses an allowlisted environment overlay
**And** bounds and redacts captured output
**And** propagates exit or signal outcome

> Covers: REQ-CDX-RUN-002, REQ-CDX-RUN-007, REQ-CDX-RUN-008, REQ-CDX-RUN-009, REQ-CDX-RUN-010

### Scenario: Mutation requires consent

**Given** a direct Codex command requires project file changes
**When** execution is interactive
**Then** Deck previews the exact plan and requests confirmation before apply
**And** when execution is non-interactive without `--yes`, Deck exits without mutation

> Covers: REQ-CDX-RUN-010, REQ-CDX-RUN-011

### Scenario: Unsupported resume mode is explicit

**Given** the detected Codex build lacks a required resume capability
**When** the user requests that mode
**Then** Deck returns a structured unsupported-capability diagnostic
**And** Deck does not guess or execute an unverified flag

> Covers: REQ-CDX-RUN-003, REQ-CDX-RUN-004, REQ-CDX-RUN-006

### Scenario: Security policy remains user-controlled

**Given** Codex has its default trust, sandbox, and approval configuration
**When** Deck installs or launches the Developer Team without explicit user overrides
**Then** Deck does not change project trust
**And** Deck does not weaken sandbox or approval settings
**And** no credentials are written to project files

> Covers: REQ-CDX-RUN-005, REQ-CDX-SEC-001, REQ-CDX-SEC-003, REQ-CDX-SEC-004

### Scenario: Shared MCP-backed capability is complete

**Given** `codebase-memory-mcp` is already installed and usable
**When** Deck prepares Codex integration
**Then** Deck reuses the binary without reinstalling it
**And** writes or verifies the Codex MCP entry
**And** does not report the capability ready until both checks pass

> Covers: REQ-CDX-INT-005, REQ-CDX-INT-006, REQ-CDX-INT-007

### Scenario: Memory credentials and deferred providers are explicit

**Given** Supermemory is selected and Engram is not yet supported for Codex
**When** Deck builds plans and diagnostics
**Then** Supermemory credentials remain outside project files and are redacted
**And** Engram appears as a deferred capability gap

> Covers: REQ-CDX-INT-008, REQ-CDX-INT-009

### Scenario: Complete standalone skill catalog is installed

**Given** the canonical external catalog contains 29 standalone skill bundles
**When** Deck builds and applies the Codex content plan
**Then** every catalog ID has a Deck-owned `.agents/skills/<skillId>/SKILL.md`
**And** each bundle's support files and relative paths are preserved
**And** unrelated user skills remain unchanged

> Covers: REQ-CDX-PKG-001, REQ-CDX-PKG-002, REQ-CDX-PKG-004

### Scenario: Bootstrap skills remain independently complete

**Given** the Developer Team installation includes lifecycle support
**When** Deck materializes Codex skills
**Then** `deck-onboard` and `deck-archive` are installed and verified
**And** they are not counted as external catalog entries or agent-bound skills

> Covers: REQ-CDX-PKG-003, REQ-CDX-PKG-004

### Scenario: Package instructions preserve defaults and order

**Given** a new Codex runner configuration
**When** Deck normalizes package instructions
**Then** all six canonical IDs exist in canonical order
**And** only `code-economy` is enabled by default

> Covers: REQ-CDX-PKG-005, REQ-CDX-PKG-006

### Scenario: Package instruction does not imply runtime readiness

**Given** `codebase-memory` instructions are selected but its binary or MCP entry is unavailable
**When** Deck builds review and parity output
**Then** the instruction bundle may be composed on its declared surfaces
**And** the runtime capability remains an explicit gap or blocker

> Covers: REQ-CDX-PKG-007, REQ-CDX-PKG-008, REQ-CDX-INT-006, REQ-CDX-INT-007

### Scenario: Silent packages receive an explicit Codex disposition

**Given** Pi defines internal `pi-mermaid` and user-facing optional `pi-hud`
**And** OpenCode defines internal `opencode-mermaid-renderer` and `deck-model-variants`
**When** Codex capability mappings are validated
**Then** each applicable canonical capability has a Codex disposition
**And** runner-specific packages are not copied automatically
**And** semantic metadata disagreement is reported

> Covers: REQ-CDX-PKG-009, REQ-CDX-PKG-010

### Scenario: Content-only upgrade synchronizes every skill class

**Given** Codex has stale managed agents, standalone bundles, or bootstrap skills
**And** no package instruction is enabled
**When** Deck runs runner content synchronization
**Then** it still detects, plans, backs up, applies, and verifies roles plus stale managed content
**And** it does not invoke runtime package, MCP, provider, shared-binary, or optional-capability installation
**And** binary and development bundle outputs remain equivalent

> Covers: REQ-CDX-PKG-011, REQ-CDX-PKG-012, REQ-CDX-PKG-013

### Scenario: Unknown reasoning support is safe

**Given** an assigned model has no confirmed Codex reasoning-level contract
**When** Deck builds the role or launch plan
**Then** it omits the reasoning override
**And** reports no fabricated level

> Covers: REQ-CDX-INT-001, REQ-CDX-INT-002

### Scenario: Codex is visible as supported

**Given** Codex is installed or selected
**When** the user opens environment selection, dashboard, or doctor
**Then** Codex is not labeled as a placeholder
**And** readiness, drift, and capability gaps are displayed with safe actions

> Covers: REQ-CDX-UX-001, REQ-CDX-UX-002, REQ-CDX-UX-003, REQ-CDX-UX-004

### Scenario: Untrusted project is visible

**Given** Deck has safely materialized project-local Codex configuration
**And** Codex considers the project untrusted or trust is indeterminate
**When** doctor and review report readiness
**Then** they report `materialized-but-inactive`
**And** Deck does not alter trust

> Covers: REQ-CDX-SEC-001, REQ-CDX-SEC-002

### Scenario: Rollback protects later edits

**Given** Deck installed Codex files and the user edited one afterward
**When** rollback is requested
**Then** Deck detects the hash mismatch
**And** refuses to discard the later edit
**And** reports a rollback conflict

> Covers: REQ-CDX-MAT-008, REQ-CDX-SEC-005

### Scenario: Repository-wide regression gates pass

**Given** all implementation phases are complete
**When** the change is verified
**Then** focused Codex tests pass
**And** Pi/OpenCode focused tests pass
**And** contract, render-only TUI, type-check, full test, and build gates pass against the baseline ledger

> Covers: REQ-CDX-VER-001, REQ-CDX-VER-002, REQ-CDX-VER-004

### Scenario: Public compatibility documentation is complete

**Given** Codex support is release-ready
**When** documentation governance runs
**Then** the documented matrix identifies supported released Codex versions and features
**And** documents trust, paths, ownership, consent, rollback, launch modes, execution-control status, and known gaps

> Covers: REQ-CDX-VER-003, REQ-CDX-VER-005

## Explicit deferred capabilities

- Codex app-server as the primary interactive/exec transport; it remains eligible as a released trusted-bridge surface.
- Unreleased or emerging plugin manifests and lifecycle hooks.
- Dynamic model inventory without a stable interface.
- Global Codex configuration mutation.
- Engram parity until its Codex contract is proven.

## Requirement traceability

| Requirement group | Design sections | Task phases | Acceptance evidence |
|---|---|---|---|
| REQ-CDX-ARCH-001..005 | Architectural decision; CLI composition changes | 1, 2.1 | Operational registry scenario; composition tests |
| REQ-CDX-ARCH-006..010 | Trusted execution boundary; effect ownership | 0.4, 1.2, 4.1 | Trusted host, route binding, and degraded-mode scenarios; bridge tests |
| REQ-CDX-MAT-001..007 | Materialization layout; ownership; TOML strategy | 2.3..2.8 | Roles/skills, TOML, instructions, collision scenarios |
| REQ-CDX-MAT-008..013 | Transaction, rollback, and exact local exclusion | 2.8..2.11 | Preimage, unsafe target, rollback, local-only scenarios |
| REQ-CDX-RUN-001..011 | Launch contract; CLI consent and grammar | 1.1, 1.3, 3.1..3.3 | Interactive, exec, resume, consent scenarios |
| REQ-CDX-INT-001..009 | Capability mapping; model/reasoning; MCP/memory | 4.2..4.5 | Roles/skills, shared MCP, reasoning, memory scenarios |
| REQ-CDX-PKG-001..013 | Content/package inventories; sync; metadata parity | 2.3..2.6, 4.2..4.6, 6.1 | Standalone, bootstrap, defaults, readiness, runner-specific-package, and sync scenarios |
| REQ-CDX-SEC-001..005 | Trust/security; transaction protections | 2.2, 2.7..2.9, 3.1 | Security, trust, unsafe target, rollback scenarios |
| REQ-CDX-UX-001..004 | Targeted TUI and doctor changes | 5.1..5.4 | Supported-runtime and trust scenarios |
| REQ-CDX-VER-001..005 | Compatibility and verification design | 0.2, 6 | Broad gates and documentation scenarios |

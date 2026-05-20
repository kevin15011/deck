# Spec: Silent Visual Explanations

## Source

- Proposal: `silent-visual-explanations` proposal artifact
- Exploration: `silent-visual-explanations` exploration artifact
- Capabilities affected: `visual-explanations`, `runner-skill-package-adapters`, `pi-runner-dashboard`, `pi-runner-installation`, `openspec-workflow`, `developer-team-installation`

## Requirements

### Capability: visual-explanations

REQ-VISUAL-001: Deck MUST provide a Deck-owned visual explanation skill intended to help users quickly understand Orchestrator responses through brief diagrams or visual summaries.
  Priority: MUST
  Surface: UI
  Rationale: Users should get quick visual explanations without choosing or learning Mermaid.

REQ-VISUAL-002: The visual explanation skill MUST be installed or assigned for the Orchestrator by default and MUST NOT be assigned by default to Proposal, Spec, Design, or Task agents.
  Priority: MUST
  Surface: Permission
  Rationale: The Orchestrator produces the visible user-facing synthesis; SDD subagents produce artifacts and handoffs.

REQ-VISUAL-003: Visual explanations MUST be explanatory only and MUST NOT replace or supersede OpenSpec artifacts, Spec Registry state, phase handoffs, or written decisions.
  Priority: MUST
  Surface: Data
  Rationale: OpenSpec remains the authoritative workflow record.

REQ-VISUAL-004: User-facing visual explanation copy SHOULD avoid exposing Mermaid syntax, Mermaid configuration, or Mermaid as a user decision.
  Priority: SHOULD
  Surface: UI
  Rationale: Visual rendering support is internal and should not add dashboard/user complexity.

### Capability: runner-skill-package-adapters

REQ-ADAPTER-001: Runner installation support MUST report idempotent outcomes for internal packages and skills using externally observable statuses such as created, unchanged, updated, installed, skipped, ready, failed, or conflict.
  Priority: MUST
  Surface: Integration
  Rationale: Users and tests need clear install outcomes without duplicated runner-specific semantics.

REQ-ADAPTER-002: Runner installation support MUST validate whether an internal package or skill is already available before attempting installation.
  Priority: MUST
  Surface: Integration
  Rationale: Validation-before-install preserves idempotence and avoids unnecessary installs.

REQ-ADAPTER-003: Runner installation feedback MAY include minimal technical package names when needed for troubleshooting or review, but MUST NOT present internal visual-rendering support as an optional feature choice.
  Priority: MUST
  Surface: UI
  Rationale: Technical transparency is allowed only as install feedback, not as configuration UX.

### Capability: pi-runner-dashboard

REQ-DASH-001: The Pi runner dashboard MUST NOT present Mermaid, `runner-mermaid`, or visual rendering as an optional or configurable dashboard capability.
  Priority: MUST
  Surface: UI
  Rationale: Mermaid support is internal Pi support, not a user-facing selection.

REQ-DASH-002: The Pi runner dashboard MUST group user choices under `Packages`, `Adaptive Memory`, and `Teams`, with `Review & Install` as the final review/action surface.
  Priority: MUST
  Surface: UI
  Rationale: The dashboard should focus on user-facing choices and a final review step.

REQ-DASH-003: The Pi runner dashboard SHOULD show visual support only as minimal install/review feedback such as ready, installing, unchanged, or failed when that feedback is relevant.
  Priority: SHOULD
  Surface: UI
  Rationale: Users may need install status without being asked to configure visual rendering.

REQ-DASH-004: Dashboard review content MUST distinguish user-selected choices from internal required support.
  Priority: MUST
  Surface: UI
  Rationale: Users should understand what they chose versus what Deck installs silently to support those choices.

### Capability: pi-runner-installation

REQ-PIINSTALL-001: Pi installation MUST treat `pi-mermaid` as internal visual support required for Pi visual explanations.
  Priority: MUST
  Surface: Integration
  Rationale: Pi needs rendering support while keeping Mermaid silent in the dashboard.

REQ-PIINSTALL-002: Pi installation MUST validate whether `pi-mermaid` is already installed before attempting to install it.
  Priority: MUST
  Surface: Integration
  Rationale: Existing installs should be treated as ready/unchanged.

REQ-PIINSTALL-003: When `pi-mermaid` is missing, Pi installation MUST install it silently without requiring a user dashboard selection.
  Priority: MUST
  Surface: Integration
  Rationale: Required internal support should not become a configuration decision.

REQ-PIINSTALL-004: If `pi-mermaid` validation or installation fails, Pi installation MUST surface a clear install failure in review/install feedback without making OpenSpec artifacts invalid or replaced.
  Priority: MUST
  Surface: UI
  Rationale: Failures must be actionable while preserving workflow authority.

### Capability: openspec-workflow

REQ-OPENSPEC-001: OpenSpec artifacts and Spec Registry entries MUST remain the authoritative source for approved changes, states, decisions, and phase handoffs.
  Priority: MUST
  Surface: Data
  Rationale: Visual summaries are aids, not workflow records.

REQ-OPENSPEC-002: Visual explanations MAY summarize OpenSpec content, but MUST NOT introduce new requirements, alter approval state, or override registry status.
  Priority: MUST
  Surface: Data
  Rationale: Explanations must not mutate or supersede formal artifacts.

### Capability: developer-team-installation

REQ-TEAMINSTALL-001: Existing developer-team installation behavior MUST preserve externally observable idempotent semantics for agents and skills.
  Priority: MUST
  Surface: Integration
  Rationale: This change may reuse the pattern, but must not regress existing install outcomes.

REQ-TEAMINSTALL-002: The visual explanation skill MUST NOT change default developer-team agent selection or install all SDD subagent skills beyond the Orchestrator assignment specified for this change.
  Priority: MUST
  Surface: Permission
  Rationale: The proposal explicitly limits default assignment to the Orchestrator.

## Acceptance Scenarios

### Capability: visual-explanations

#### Scenario: Orchestrator receives visual explanation support
**Given** a runner installation includes the default Orchestrator support
**When** visual explanation support is installed
**Then** the Orchestrator has access to the Deck-owned visual explanation skill and SDD subagents do not receive it by default
> Covers: REQ-VISUAL-001, REQ-VISUAL-002, REQ-TEAMINSTALL-002

#### Scenario: Visual output remains explanatory
**Given** an Orchestrator response includes a diagram or visual summary
**When** the response references an OpenSpec change or phase result
**Then** the visual content is presented only as an explanation and does not change artifacts, registry state, approvals, or phase handoffs
> Covers: REQ-VISUAL-003, REQ-OPENSPEC-001, REQ-OPENSPEC-002

#### Scenario: User is not asked to learn Mermaid
**Given** visual explanations are available
**When** the user views Orchestrator-facing help or dashboard copy
**Then** the copy does not require Mermaid syntax knowledge or Mermaid configuration choices
> Covers: REQ-VISUAL-004, REQ-DASH-001

### Capability: runner-skill-package-adapters

#### Scenario: Existing internal support is unchanged
**Given** an internal package or skill is already available for a runner
**When** installation planning or installation runs
**Then** availability is validated first and the outcome is reported as ready, unchanged, skipped, or equivalent non-install status
> Covers: REQ-ADAPTER-001, REQ-ADAPTER-002

#### Scenario: Missing internal support is installed
**Given** an internal package or skill is required and not available
**When** installation runs
**Then** the support is installed and the outcome is reported as installed, created, updated, or equivalent success status
> Covers: REQ-ADAPTER-001, REQ-ADAPTER-002

#### Scenario: Technical package name appears only as feedback
**Given** internal visual support requires a technical package
**When** review/install feedback is shown
**Then** the technical package name may appear only as status or troubleshooting feedback and not as a selectable feature
> Covers: REQ-ADAPTER-003, REQ-DASH-004

### Capability: pi-runner-dashboard

#### Scenario: Dashboard groups user choices
**Given** a user opens the Pi runner dashboard
**When** the dashboard renders selectable setup choices
**Then** choices are grouped under `Packages`, `Adaptive Memory`, and `Teams`, and the final action surface is `Review & Install`
> Covers: REQ-DASH-002

#### Scenario: Mermaid is hidden from configuration
**Given** a user opens the Pi runner dashboard
**When** the user reviews available configurable options
**Then** Mermaid, `runner-mermaid`, and visual rendering are not presented as optional or configurable capabilities
> Covers: REQ-DASH-001

#### Scenario: Review distinguishes silent support
**Given** visual support is required internally
**When** the user reaches `Review & Install`
**Then** the review distinguishes user-selected choices from internal required support and may show visual support status only as minimal install feedback
> Covers: REQ-DASH-003, REQ-DASH-004

### Capability: pi-runner-installation

#### Scenario: Existing `pi-mermaid` is ready
**Given** `pi-mermaid` is already installed for Pi
**When** Pi installation runs
**Then** Deck validates its presence before install and reports it as ready, unchanged, skipped, or equivalent without reinstalling it
> Covers: REQ-PIINSTALL-001, REQ-PIINSTALL-002

#### Scenario: Missing `pi-mermaid` installs silently
**Given** `pi-mermaid` is not installed for Pi
**When** Pi installation runs
**Then** Deck installs `pi-mermaid` as internal support without requiring a dashboard selection and reports a successful install outcome
> Covers: REQ-PIINSTALL-001, REQ-PIINSTALL-002, REQ-PIINSTALL-003

#### Scenario: `pi-mermaid` install fails
**Given** `pi-mermaid` is required and installation cannot complete
**When** Pi installation runs
**Then** the review/install feedback shows a clear failure for visual support and OpenSpec artifacts remain authoritative and unchanged by the failure message
> Covers: REQ-PIINSTALL-004, REQ-OPENSPEC-001

### Capability: developer-team-installation

#### Scenario: Existing team install semantics remain stable
**Given** developer-team agents or skills are already installed
**When** installation runs after this change
**Then** existing externally observable idempotent outcomes for those agents and skills are preserved
> Covers: REQ-TEAMINSTALL-001

## Validation Rules

| Field / Input | Rule | Error Message | REQ-ID |
|---|---|---|---|
| Pi visual support selection | User must not be required to select Mermaid or `pi-mermaid` as a configurable option | Visual support is installed automatically for Pi when required. | REQ-DASH-001, REQ-PIINSTALL-003 |
| Visual skill assignment | Default assignment must target Orchestrator and exclude Proposal, Spec, Design, and Task agents | Visual explanations are assigned to Orchestrator by default only. | REQ-VISUAL-002, REQ-TEAMINSTALL-002 |
| Internal package installation | Availability must be validated before install | Internal support availability could not be verified before installation. | REQ-ADAPTER-002, REQ-PIINSTALL-002 |
| Visual explanation content | Visuals must not alter requirements, approvals, registry state, or phase handoffs | Visual explanations are non-authoritative; use OpenSpec artifacts and registry for authoritative state. | REQ-VISUAL-003, REQ-OPENSPEC-002 |

## Error Contracts

| Condition | Error Code | Message | Status |
|---|---|---|---|
| Required Pi visual support validation fails | visual_support_validation_failed | Could not verify Pi visual explanation support. | Install feedback failure |
| Required `pi-mermaid` installation fails | visual_support_install_failed | Could not install Pi visual explanation support. | Install feedback failure |
| Internal skill installation conflicts with an existing runner skill | visual_skill_conflict | Visual explanation skill could not be installed because an existing skill conflicts. | Install feedback conflict |
| Visual output is treated as authoritative workflow state | visual_not_authoritative | Visual explanations are explanatory only; use OpenSpec artifacts and registry for authoritative state. | User-facing warning or validation failure |

## States and Transitions

| State | Description | Entry Criteria |
|---|---|---|
| Not checked | Internal support availability has not been validated | Before install planning or validation runs |
| Ready | Required internal support is present and usable | Validation succeeds for existing support |
| Missing | Required internal support is not present | Validation completes and support is absent |
| Installing | Required internal support is being installed | Missing support is selected automatically for install |
| Installed | Required internal support was installed successfully | Silent install completes successfully |
| Failed | Required internal support validation or installation failed | Validation or installation returns an error |
| Conflict | A required skill/package cannot be installed cleanly because of an existing conflicting item | Conflict is detected during validation or install |

| From | To | Trigger | Side Effects |
|---|---|---|---|
| Not checked | Ready | Validation finds existing support | Reports ready/unchanged/skipped feedback |
| Not checked | Missing | Validation does not find required support | Schedules silent install |
| Missing | Installing | Installation begins | May show minimal technical install feedback |
| Installing | Installed | Installation succeeds | Reports installed/created/updated success feedback |
| Installing | Failed | Installation fails | Reports clear failure feedback |
| Not checked | Failed | Validation fails | Reports clear validation failure feedback |
| Not checked | Conflict | Validation detects conflicting support | Reports conflict feedback |

## Open Questions

- For OpenCode, should this phase install only the Orchestrator visual skill and defer renderer support, or block OpenCode visual behavior until an equivalent renderer is defined?
- Should `pi-mermaid` live in `PI_INSTALLABLE_TOOLS` as a required internal package or in a new internal runner package catalog?

## Compliance Matrix

| REQ-ID | Scenario(s) | Status |
|---|---|---|
| REQ-VISUAL-001 | Orchestrator receives visual explanation support | Defined |
| REQ-VISUAL-002 | Orchestrator receives visual explanation support | Defined |
| REQ-VISUAL-003 | Visual output remains explanatory | Defined |
| REQ-VISUAL-004 | User is not asked to learn Mermaid | Defined |
| REQ-ADAPTER-001 | Existing internal support is unchanged; Missing internal support is installed | Defined |
| REQ-ADAPTER-002 | Existing internal support is unchanged; Missing internal support is installed | Defined |
| REQ-ADAPTER-003 | Technical package name appears only as feedback | Defined |
| REQ-DASH-001 | Mermaid is hidden from configuration; User is not asked to learn Mermaid | Defined |
| REQ-DASH-002 | Dashboard groups user choices | Defined |
| REQ-DASH-003 | Review distinguishes silent support | Defined |
| REQ-DASH-004 | Review distinguishes silent support; Technical package name appears only as feedback | Defined |
| REQ-PIINSTALL-001 | Existing `pi-mermaid` is ready; Missing `pi-mermaid` installs silently | Defined |
| REQ-PIINSTALL-002 | Existing `pi-mermaid` is ready; Missing `pi-mermaid` installs silently | Defined |
| REQ-PIINSTALL-003 | Missing `pi-mermaid` installs silently | Defined |
| REQ-PIINSTALL-004 | `pi-mermaid` install fails | Defined |
| REQ-OPENSPEC-001 | Visual output remains explanatory; `pi-mermaid` install fails | Defined |
| REQ-OPENSPEC-002 | Visual output remains explanatory | Defined |
| REQ-TEAMINSTALL-001 | Existing team install semantics remain stable | Defined |
| REQ-TEAMINSTALL-002 | Orchestrator receives visual explanation support | Defined |

# Tasks: Silent Visual Explanations

## Source

- Spec: silent-visual-explanations spec artifact
- Design: silent-visual-explanations design artifact
- Capabilities affected: `visual-explanations`, `runner-skill-package-adapters`, `pi-runner-dashboard`, `pi-runner-installation`, `openspec-workflow`, `developer-team-installation`

## Task Groups

### Group: Shared / Contracts

#### Task 1: Create visual explanations skill content
**Owner**: General Apply
**Priority**: P0
**Complexity**: Low
**Parallel**: Yes
**Depends on**: none

**Description**
Create `packages/core/src/teams/developer/visual-explanations-content.ts` containing the Deck-owned visual explanation skill content. The content must be explanatory-only (REQ-VISUAL-003), intended for brief diagrams or visual summaries that improve quick user understanding (REQ-VISUAL-001). Must not reference Mermaid syntax as a user decision (REQ-VISUAL-004). Include clear guidance that visual output must not introduce new requirements, alter approval state, or override registry status (REQ-OPENSPEC-002).

**Files**
- `packages/core/src/teams/developer/visual-explanations-content.ts` — create

**Verification**
Unit test or content review confirming: (1) skill content is explanatory-only, (2) no Mermaid syntax/configuration exposure, (3) non-authoritative guidance is present.

---

#### Task 2: Compose visual skill into Orchestrator content registry
**Owner**: General Apply
**Priority**: P0
**Complexity**: Low
**Parallel**: No — depends on Task 1
**Depends on**: Task 1

**Description**
Modify `packages/core/src/teams/developer/content-registry.ts` to import and compose `deck-visual-explanations` skill content into the Orchestrator skill only. Proposal/Spec/Design/Task agent skills must not include this content (REQ-VISUAL-002, REQ-TEAMINSTALL-002). Add/update tests confirming: (1) Orchestrator skill includes visual explanation content, (2) SDD subagent skills do not. Also update or add `packages/adapter-opencode/src/developer-team-install.test.ts` to confirm Orchestrator-only skill content without renderer assumption.

**Files**
- `packages/core/src/teams/developer/content-registry.ts` — modify
- `packages/core/src/teams/developer/content-registry.test.ts` — modify
- `packages/adapter-opencode/src/developer-team-install.test.ts` — modify

**Verification**
Tests pass confirming Orchestrator skill includes `deck-visual-explanations` content and SDD subagent skills do not. Existing idempotent install semantics preserved (REQ-TEAMINSTALL-001).

---

### Group: Backend

#### Task 3: Create internal runner packages module
**Owner**: Backend Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: Yes
**Depends on**: none

**Description**
Create `packages/adapter-pi/src/internal-runner-packages.ts` — a Pi-only internal package catalog for silent runner support. Define `pi-mermaid` as a required internal package with `source: "npm:pi-mermaid"`, detector names `pi-mermaid` / `npm:pi-mermaid`, and idempotent status semantics (created/unchanged/updated/installed/skipped/ready/failed/conflict per REQ-ADAPTER-001, REQ-ADAPTER-002). Include validation-before-install logic and install action metadata. This catalog is separate from `PI_INSTALLABLE_TOOLS` (Design decision: new internal catalog, not `PI_INSTALLABLE_TOOLS`). Add unit tests covering ready/missing/install/conflict detection.

**Files**
- `packages/adapter-pi/src/internal-runner-packages.ts` — create
- `packages/adapter-pi/src/internal-runner-packages.test.ts` — create

**Verification**
Unit tests pass for: (1) pi-mermaid detected as ready when present, (2) pi-mermaid detected as missing when absent, (3) install action generated for missing package, (4) conflict detection, (5) `PI_INSTALLABLE_TOOLS` does not include `pi-mermaid`.

---

#### Task 4: Update capability-catalog and capability-inventory
**Owner**: Backend Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: No — depends on Task 3
**Depends on**: Task 3

**Description**
Modify `packages/adapter-pi/src/capability-catalog.ts` to remove `runner-mermaid` from visible user-facing catalog entries; if compatibility requires the `CapabilityId` to remain, mark it internal/deprecated and exclude it from dashboard selectors. Modify `packages/adapter-pi/src/capability-inventory.ts` to detect `pi-mermaid` as internal visual support instead of treating `runner-mermaid` as `pending-source` for Pi or `blocked` for OpenCode; delegate `pi-mermaid` detection to the internal runner packages module (Task 3). Add/update tests confirming Mermaid is absent from user-facing capability summaries and `pi-mermaid` detection delegates correctly.

**Files**
- `packages/adapter-pi/src/capability-catalog.ts` — modify
- `packages/adapter-pi/src/capability-inventory.ts` — modify
- `packages/adapter-pi/src/capability-catalog.test.ts` — modify
- `packages/adapter-pi/src/capability-inventory.test.ts` — modify

**Verification**
Tests confirm: (1) `runner-mermaid` is not in user-facing capability summaries (REQ-DASH-001), (2) `pi-mermaid` detection uses internal catalog, (3) no `pending-source` or `blocked` status for visual support in Pi inventory.

---

#### Task 5: Update capability-plan for silent internal support
**Owner**: Backend Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: No — depends on Tasks 3, 4
**Depends on**: Task 3, Task 4

**Description**
Modify `packages/adapter-pi/src/capability-plan.ts` to replace the `runner-mermaid` manual pending flow with automatic silent internal support actions. When `pi-mermaid` is missing, schedule an automatic install action titled `Install visual explanation support`; when present, report validation/ready feedback (REQ-PIINSTALL-001, REQ-PIINSTALL-002, REQ-PIINSTALL-003). No longer block Developer Team application while visual support is unresolved. Add/update tests covering: missing-package silent install action, existing-package ready feedback, and removal of pending manual step.

**Files**
- `packages/adapter-pi/src/capability-plan.ts` — modify
- `packages/adapter-pi/src/capability-plan.test.ts` — modify

**Verification**
Tests confirm: (1) missing `pi-mermaid` produces automatic silent install action, (2) ready `pi-mermaid` produces validation/ready feedback only, (3) Developer Team application is no longer blocked by visual support status.

---

#### Task 6: Update installation-plan, install-tools, and adapter-pi exports
**Owner**: Backend Apply
**Priority**: P1
**Complexity**: Medium
**Parallel**: No — depends on Tasks 3, 5
**Depends on**: Task 3, Task 5

**Description**
Modify `packages/adapter-pi/src/installation-plan.ts` to preserve the `PI_INSTALLABLE_TOOLS` public catalog boundary and add assertions/tests that `pi-mermaid` is excluded from it. Modify `packages/adapter-pi/src/install-tools.ts` to reuse the existing Pi package install execution path (`pi install npm:pi-mermaid`) for internal package install specs. Modify `packages/adapter-pi/src/index.ts` to export internal runner support helpers if needed by CLI/tests. Add/update tests confirming: (1) `PI_INSTALLABLE_TOOLS` excludes `pi-mermaid`, (2) internal package install uses existing executor, (3) failure produces clear feedback codes (`visual_support_install_failed`, `visual_support_validation_failed` per Spec error contracts).

**Files**
- `packages/adapter-pi/src/installation-plan.ts` — modify
- `packages/adapter-pi/src/install-tools.ts` — modify
- `packages/adapter-pi/src/index.ts` — modify
- `packages/adapter-pi/src/installation-plan.test.ts` — modify
- `packages/adapter-pi/src/install-tools.test.ts` — modify

**Verification**
Tests pass confirming: (1) `pi-mermaid` not in `PI_INSTALLABLE_TOOLS`, (2) internal install action resolution and execution delegates to existing Pi installer, (3) failure feedback maps to Spec error contracts.

---

#### Task 7: Backend adapter-pi and opencode developer-team install tests
**Owner**: Backend Apply
**Priority**: P1
**Complexity**: Medium
**Parallel**: No — depends on Tasks 4, 5, 6
**Depends on**: Task 4, Task 5, Task 6

**Description**
Update integration-level test coverage for the full adapter-pi capability/inventory/plan/install chain. Update `packages/adapter-pi/src/developer-team-install.test.ts` to confirm: (1) existing idempotent agent/skill file application results preserved (`created | unchanged | updated` per REQ-TEAMINSTALL-001), (2) Orchestrator skill content includes visual explanations, (3) SDD subagent skills do not include visual explanations (REQ-VISUAL-002, REQ-TEAMINSTALL-002). Update `packages/adapter-opencode/src/developer-team-install.test.ts` to confirm Orchestrator receives visual skill content via core registry without assuming renderer support (Design: defer OpenCode renderer).

**Files**
- `packages/adapter-pi/src/developer-team-install.test.ts` — modify
- `packages/adapter-opencode/src/developer-team-install.test.ts` — modify

**Verification**
All adapter-pi and adapter-opencode test suites pass. Existing idempotent install semantics preserved. Orchestrator-only visual skill assignment confirmed for both Pi and OpenCode runners.

---

### Group: Frontend

#### Task 8: Restructure dashboard state and selectors
**Owner**: Frontend Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: No — depends on Tasks 4, 5
**Depends on**: Task 4, Task 5

**Description**
Modify `apps/cli/src/tui/pi-runner-dashboard/state.ts` to replace runner capability and visual-helper screens with the new grouping: `Packages`, `Adaptive Memory`, `Teams`, and `Review & Install` (REQ-DASH-002). Modify `apps/cli/src/tui/pi-runner-dashboard/selectors.ts` to produce section summaries that exclude Mermaid/`runner-mermaid` from selectable options (REQ-DASH-001). Review/install section must distinguish user-selected choices from internal required support (REQ-DASH-004). Update state constants, cursor limits, and section navigation accordingly. Add/update tests for new state shape and selector output.

**Files**
- `apps/cli/src/tui/pi-runner-dashboard/state.ts` — modify
- `apps/cli/src/tui/pi-runner-dashboard/selectors.ts` — modify
- `apps/cli/src/tui/pi-runner-dashboard/state.test.ts` — modify
- `apps/cli/src/tui/pi-runner-dashboard/selectors.test.ts` — modify

**Verification**
Tests confirm: (1) dashboard sections are `Packages`, `Adaptive Memory`, `Teams`, `Review & Install`, (2) Mermaid/`runner-mermaid` absent from selectable summaries, (3) review distinguishes user selections from internal support.

---

#### Task 9: Update dashboard screens and action runner
**Owner**: Frontend Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: No — depends on Task 8
**Depends on**: Task 8

**Description**
Modify `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` for updated user-facing copy: section headers match new grouping, Mermaid is not presented as a configurable option, and review feedback shows minimal visual support status (`ready`/`installing`/`failed`) only (REQ-DASH-003, REQ-DASH-004). Modify `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` to resolve internal package install actions and produce result messages using feedback codes from Spec error contracts. Technical package name `npm:pi-mermaid` may appear only in diagnostics/source fields, not as a selectable feature (REQ-ADAPTER-003). Add/update render and action-runner tests.

**Files**
- `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` — modify
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — modify
- `apps/cli/src/tui/screens/pi-runner-dashboard-screens.test.tsx` — modify
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts` — modify

**Verification**
Tests confirm: (1) user-facing copy uses new section headers, (2) Mermaid not visible as selectable/configurable, (3) visual support appears only as minimal install/review feedback, (4) action runner resolves internal package installs with correct status messages, (5) failure feedback uses Spec error codes.

---

#### Task 10: Frontend dashboard integration tests
**Owner**: Frontend Apply
**Priority**: P1
**Complexity**: Low
**Parallel**: No — depends on Tasks 8, 9
**Depends on**: Task 8, Task 9

**Description**
Add/update end-to-end dashboard test coverage confirming the full user flow: user opens dashboard, sees `Packages` / `Adaptive Memory` / `Teams` / `Review & Install` sections (REQ-DASH-002); Mermaid is absent from configuration (REQ-DASH-001); review distinguishes user-selected choices from silent internal support (REQ-DASH-004); visual support status is minimal feedback only (REQ-DASH-003). Verify accessibility: dashboard copy does not rely on diagrams (Design: Accessibility).

**Files**
- `apps/cli/src/tui/pi-runner-dashboard/*.test.tsx?` — modify

**Verification**
Integration tests pass for complete dashboard flow: grouping correctness, Mermaid absence, review distinction, minimal feedback, and accessibility baseline.

## Dependency Graph

```
Task 1 (Shared) ─── Skill content
  → Task 2 (Shared) ─── Registry composition

Task 3 (Backend) ─── Internal runner packages
  → Task 4 (Backend) ─── Capability catalog + inventory
    → Task 5 (Backend) ─── Capability plan
  → Task 5 (Backend) ─── Capability plan
  → Task 6 (Backend) ─── Installation plan + install tools

Task 4 + Task 5 → Task 8 (Frontend) ─── Dashboard state + selectors
Task 8 → Task 9 (Frontend) ─── Dashboard screens + action runner
Task 8 + Task 9 → Task 10 (Frontend) ─── Dashboard integration tests

Tasks 4, 5, 6 → Task 7 (Backend) ─── Adapter-pi + opencode dev-team tests
```

## Parallelization Plan

| Phase | Tasks | Can Run in Parallel |
|---|---|---|
| Shared | 1, 2 | No — Task 2 depends on Task 1 |
| Backend | 3 | Yes — independent of Shared |
| Backend | 4 | No — depends on Task 3 |
| Backend + Shared | 3 ∥ 1 | Yes — independent modules |
| Backend | 5 | No — depends on Tasks 3, 4 |
| Backend | 6 | No — depends on Tasks 3, 5 |
| Backend | 7 | No — depends on Tasks 4, 5, 6 |
| Frontend | 8 | No — depends on Tasks 4, 5 (section names and inventory contracts) |
| Frontend | 9 | No — depends on Task 8 |
| Frontend | 10 | No — depends on Tasks 8, 9 |

Concurrent starts possible: Tasks 1 and 3 can begin simultaneously (Shared content + Backend internal catalog).

## Responsibility Contracts

| Contract / Boundary | Owner | Consumers | Notes |
|---|---|---|---|
| Visual skill content (`visual-explanations-content.ts`) | General Apply | Backend Apply (via content-registry) | Content is explanatory-only; Orchestrator-targeted |
| Content registry composition | General Apply | Backend Apply (Pi/OpenCode dev-team install) | Only Orchestrator receives visual skill |
| Internal runner package catalog (`internal-runner-packages.ts`) | Backend Apply | Frontend Apply (via capability-plan action titles) | Provides detection metadata and install actions |
| Capability layer (catalog, inventory, plan) | Backend Apply | Frontend Apply (via state/selectors) | Section names and summary data flow to dashboard |
| Dashboard state shape and selectors | Frontend Apply | Frontend Apply (screens, action runner) | New grouping: Packages/Adaptive Memory/Teams/Review & Install |
| `PI_INSTALLABLE_TOOLS` boundary | Backend Apply | Backend Apply (installation-plan) | Must not include `pi-mermaid`; enforced by tests |

## Complexity Summary

| Complexity | Count | Task Numbers |
|---|---|---|
| Low | 3 | 1, 2, 10 |
| Medium | 7 | 3, 4, 5, 6, 7, 8, 9 |
| High | 0 | — |

## Flagged for Splitting

- Task 6 (installation-plan + install-tools + exports): touches 3 implementation files and 2 test files. If implementation proves larger than expected, split into (a) installation-plan + boundary tests and (b) install-tools + action executor tests.
- Task 9 (screens + action-runner): two distinct TUI concerns. If render changes are substantial, split into (a) screens copy/layout and (b) action-runner result handling.

## Review Workload Forecast

| Signal | Value |
|---|---|
| Estimated changed lines | 400–800 |
| 400-line budget risk | Medium |
| Scope reduction recommended | No |
| Sequential work slices recommended | Yes — Shared → Backend core → Backend tests → Frontend state → Frontend screens → Frontend tests |
| Decision needed before Apply | No — Spec open questions resolved by Design decisions |

**Rationale**: 2 new files, ~12 modified implementation files, ~8 modified or new test files. Each task is scoped to 1–5 files. The dependency chain enforces sequential slices within each domain, but Shared and Backend can start concurrently. Medium 400-line risk because dashboard restructuring and capability layer changes are cross-cutting but decomposed into focused tasks.

## Open Questions / Blockers

- **OpenCode renderer support** (Spec open question): Resolved by Design — install Orchestrator skill content only; defer renderer support to a future change. Non-blocking for current tasks (allowed-with-stub).
- **Internal catalog vs `PI_INSTALLABLE_TOOLS`** (Spec open question): Resolved by Design — new internal runner package catalog, not `PI_INSTALLABLE_TOOLS`. Non-blocking.

No implementation-blocking questions remain — tasks are ready for Apply.
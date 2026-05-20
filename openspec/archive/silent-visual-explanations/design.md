# Design: Silent Visual Explanations

## Source

- Proposal: `silent-visual-explanations` proposal artifact
- Exploration: `silent-visual-explanations` exploration artifact
- Capabilities affected: `visual-explanations`, `runner-skill-package-adapters`, `pi-runner-dashboard`, `pi-runner-installation`, `openspec-workflow`, `developer-team-installation`
- Spec status: available

## Current Architecture Context

- `packages/adapter-pi/src/capability-catalog.ts` models `runner-mermaid` as a required visible capability with Pi implementation `pi-mermaid`, but `source: "TBD"` and `installKind: "pending"`.
- `packages/adapter-pi/src/capability-inventory.ts` special-cases `runner-mermaid` as `pending-source` for Pi and `blocked` for OpenCode; it does not detect installed `pi-mermaid`.
- `packages/adapter-pi/src/capability-plan.ts` turns required `runner-mermaid` into a pending manual step and blocks Developer Team application while unresolved.
- `packages/adapter-pi/src/installation-plan.ts` defines user/prerequisite `PI_INSTALLABLE_TOOLS`; it does not include `pi-mermaid` and is also used by dashboard package planning.
- Pi dashboard state/selectors/screens expose five sections: `Runner Capabilities`, `Adaptive Memory`, `Runner UI / visual helpers`, `Teams`, `Review & Install`; Mermaid is visible in selectors and render tests.
- Pi/OpenCode developer-team installers already build agent and skill files from `packages/core/src/teams/developer/content-registry.ts` and apply files idempotently with `created | unchanged | updated` results.
- Pi and OpenCode agent frontmatter currently references one agent-specific skill (`skill: ${agent.skillId}`), so Orchestrator-only visual support should be composed into the Orchestrator skill content rather than assuming multi-skill frontmatter support.

## Proposed Architecture

Decision: hide Mermaid from user choices, install `pi-mermaid` through a new internal Pi runner package catalog, and add a Deck-owned visual explanation skill fragment to the Orchestrator skill only.

- Keep `PI_INSTALLABLE_TOOLS` for user-facing/prerequisite package choices. Do **not** add `pi-mermaid` there.
- Add a narrow internal runner support layer for:
  - Pi internal packages: `pi-mermaid` as required, silent, `source: "npm:pi-mermaid"`, detector names `pi-mermaid` / `npm:pi-mermaid`.
  - Assigned Deck skill fragments: `deck-visual-explanations` assigned to `deck-developer-orchestrator` only.
- Retire `runner-mermaid` from dashboard-visible capability summaries and sections. If compatibility requires the `CapabilityId` to remain temporarily, mark it internal/deprecated and exclude it from dashboard selectors and user-selectable state.
- Replace dashboard grouping with `Packages`, `Adaptive Memory`, `Teams`, and `Review & Install`.
- Review/install may show minimal technical feedback such as `Visual explanation support: ready/installing/failed` and, where useful for troubleshooting, `npm:pi-mermaid`; it must not present Mermaid as a selectable feature.

### Component / Module Boundaries

| Component | Responsibility | Change Type |
|---|---|---|
| `packages/adapter-pi/src/internal-runner-packages.ts` | Pi-only internal package catalog, detection, and install action metadata for silent runner support | new |
| `packages/adapter-pi/src/capability-*` | User-facing package/capability inventory and review plan; delegates internal visual support to internal catalog | modified |
| `packages/adapter-pi/src/install-tools.ts` / action runner | Execute `pi install npm:pi-mermaid` via existing Pi package installer path after validation | modified |
| `apps/cli/src/tui/pi-runner-dashboard/*` | Dashboard state, selectors, copy, and review grouping: Packages / Adaptive Memory / Teams / Review & Install | modified |
| `packages/core/src/teams/developer/visual-explanations-content.ts` | Deck-owned visual explanation skill content, explanatory-only guidance | new |
| `packages/core/src/teams/developer/content-registry.ts` | Compose visual explanation skill content into Orchestrator skill only | modified |
| `packages/adapter-pi/src/developer-team-install.ts` | Preserve existing idempotent file application while consuming updated Orchestrator skill content | unchanged/modified tests |
| `packages/adapter-opencode/src/developer-team-install.ts` | Receives Orchestrator skill content through core registry; no renderer package install yet | unchanged/modified tests |

### Data Flow

1. Dashboard/preflight collects `PiRequiredToolsReview.installedPackages` and tool status.
2. Pi capability inventory builds user-facing package statuses and separately calls internal package inventory for `pi-mermaid`.
3. Review plan:
   - user-selected packages produce normal package/manual/config/team actions;
   - missing internal `pi-mermaid` produces an automatic silent install action titled `Install visual explanation support`;
   - ready internal `pi-mermaid` produces validation/ready feedback only.
4. `runPiRunnerReviewPlan` executes config writes, automatic package installs, team application, and validations using existing result redaction.
5. Developer Team install reads core content registry; only `deck-developer-orchestrator` skill content includes the visual explanation skill section.
6. Orchestrator may use visual summaries in user-facing synthesis; OpenSpec artifacts and Spec Registry remain authoritative.

### API / Contract Implications

| Endpoint / Interface | Change | Backward Compatible |
|---|---|---|
| `PI_INSTALLABLE_TOOLS` | Remains user/prerequisite catalog; excludes `pi-mermaid` | yes |
| New Pi internal package catalog | Adds internal install specs and detector metadata for `pi-mermaid` | additive |
| `BuildPiRunnerReviewPlanState` / `PiRunnerAction` | May need internal package id/source fields or widened install spec lookup | partial |
| `getDashboardSectionSummaries` | Returns `packages`, `adaptive-memory`, `teams`, `review-install` sections | no for internal TUI tests |
| `getRunnerCapabilitySummaries` | Replace/rename with package summaries excluding Mermaid | partial |
| `getAgentContent("deck-developer-orchestrator")` | Orchestrator skill body includes Deck visual explanation guidance | yes; content changes only |

### State / Persistence Implications

- No OpenSpec or Spec Registry persistence changes.
- Pi installs `npm:pi-mermaid` into the Pi runner environment when missing.
- Developer Team install may update existing `.pi/skills/deck-developer-orchestrator/SKILL.md` and `.opencode/skills/deck-developer-orchestrator/SKILL.md` because core Orchestrator skill content changes.
- Dashboard state shape is internal runtime state; rename/remove screens without data migration unless a persisted dashboard state is later discovered.

### Migration / Backward Compatibility

- Existing `pi-mermaid` installations are detected and reported as ready/unchanged/skipped; no reinstall.
- Do not uninstall or remove existing `pi-mermaid` during rollback.
- Existing Developer Team install semantics remain `created | unchanged | updated`; Orchestrator skill may become `updated` once due to new content.
- Keep temporary compatibility aliases for `runner-mermaid` only where needed to avoid type churn, but exclude from user-facing dashboard output.

## File Impact Estimate

| File / Path | Action | Rationale |
|---|---|---|
| `packages/adapter-pi/src/internal-runner-packages.ts` | create | Internal `pi-mermaid` catalog and detector/action helpers |
| `packages/adapter-pi/src/index.ts` | modify | Export internal runner support helpers if needed by CLI/tests |
| `packages/adapter-pi/src/capability-catalog.ts` | modify | Remove/hide `runner-mermaid` from visible catalog; align sections with Packages |
| `packages/adapter-pi/src/capability-inventory.ts` | modify | Detect `pi-mermaid` as internal visual support instead of pending source |
| `packages/adapter-pi/src/capability-plan.ts` | modify | Add silent internal support actions and remove Mermaid manual pending flow |
| `packages/adapter-pi/src/installation-plan.ts` | modify | Preserve public catalog boundary; add tests/assertions that `pi-mermaid` is excluded |
| `packages/adapter-pi/src/install-tools.ts` | modify | Reuse Pi install execution for internal package install specs |
| `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` | modify | Resolve internal package install actions and result messages |
| `apps/cli/src/tui/pi-runner-dashboard/state.ts` | modify | Replace runner capability/visual-helper screens with Packages grouping |
| `apps/cli/src/tui/pi-runner-dashboard/selectors.ts` | modify | Section summaries and package summaries exclude Mermaid choices |
| `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` | modify | User-facing copy and review feedback |
| `packages/core/src/teams/developer/visual-explanations-content.ts` | create | Deck-owned Orchestrator visual skill content |
| `packages/core/src/teams/developer/content-registry.ts` | modify | Compose visual skill content into Orchestrator skill only |
| `packages/adapter-pi/src/*.{test.ts}` | modify | Capability, inventory, plan, install, and developer-team install coverage |
| `packages/adapter-opencode/src/developer-team-install.test.ts` | modify | Confirm Orchestrator-only skill content without renderer assumption |
| `packages/core/src/teams/developer/content-registry.test.ts` | modify | Confirm visual skill is Orchestrator-only and non-authoritative |
| `apps/cli/src/tui/pi-runner-dashboard/*.test.tsx?` | modify | Dashboard render/action-runner tests for new grouping and silent install feedback |

## Testing Strategy

- Unit: internal package catalog detects ready/missing `pi-mermaid`; `PI_INSTALLABLE_TOOLS` excludes `pi-mermaid`.
- Unit: review plan schedules silent automatic install when missing and validation/ready feedback when present.
- Unit: action runner uses `pi install npm:pi-mermaid` via mocked installer and reports failures clearly.
- UI/render: dashboard shows `Packages`, `Adaptive Memory`, `Teams`, `Review & Install`; Mermaid is absent from selectable/configurable copy.
- Content/install: Orchestrator skill contains `deck-visual-explanations`; Proposal/Spec/Design/Task skill outputs do not; existing idempotent statuses remain stable.

## Observability / Error Handling

- Map validation/install failures to clear feedback codes/messages equivalent to `visual_support_validation_failed` and `visual_support_install_failed`.
- Use action titles like `Visual explanation support` by default; include `npm:pi-mermaid` only in diagnostics/source fields for troubleshooting.
- Preserve existing secret redaction for dashboard diagnostics and install result rendering.

## Security / Performance / Accessibility Considerations

- Security: no secrets introduced; visuals must not alter OpenSpec/registry authority.
- Performance: one additional package detection/install check during review planning/install.
- Accessibility: dashboard copy must not rely on diagrams; visual explanations are supplemental to text.

## Tradeoffs

| Decision | Chosen | Rejected Alternative | Rationale |
|---|---|---|---|
| Pi package catalog | New internal runner package catalog | Add `pi-mermaid` to `PI_INSTALLABLE_TOOLS` | Keeps silent required support out of user-facing package choices while reusing install execution |
| Orchestrator visual skill materialization | Compose Deck visual skill content into Orchestrator's existing skill | Add a separate globally installed skill for all agents | Current runner frontmatter uses one skill and `inheritSkills: false`; composition preserves Orchestrator-only assignment |
| Dashboard grouping | Packages / Adaptive Memory / Teams / Review & Install | Keep Runner Capabilities + visual helpers | Matches approved UX and removes Mermaid as a user concept |
| OpenCode renderer | Install Orchestrator skill content only; defer renderer support | Block all OpenCode visual skill installation | Separates behavioral guidance from unresolved renderer implementation |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Internal package catalog duplicates public install metadata | Medium | Medium | Keep catalog narrow: required internal packages only; reuse install executor |
| Dashboard screen renames break navigation/tests | Medium | Medium | Update state constants, cursor limits, selectors, and render tests together |
| `pi-mermaid` detection differs from Pi installed package reporting | Medium | Medium | Match normalized names `pi-mermaid` and `npm:pi-mermaid`; test installedPackages/tool review variants |
| Visual skill composition updates existing Orchestrator skill unexpectedly | Medium | Low | Preserve idempotent `updated` result semantics and document one-time content update |
| Users see Mermaid in prominent copy | Medium | Medium | Add render assertions that selectable screens omit Mermaid/`runner-mermaid` |

## Open Decisions

- OpenCode renderer support — decide in a future change whether to install an OpenCode renderer package/equivalent or keep visual guidance text-only for OpenCode.

## Dependencies

- `pi-mermaid` must be installable via `pi install npm:pi-mermaid`.
- Existing Pi/OpenCode Developer Team installers must retain idempotent file apply semantics.

## Next Steps

Ready for Task (`deck-developer-task`) to break this design into implementation tasks, combined with Spec.

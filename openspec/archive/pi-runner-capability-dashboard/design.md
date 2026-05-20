# Design: Dashboard por capacidades para Pi Runner

## Source

- Proposal: `pi-runner-capability-dashboard` proposal artifact
- Capabilities affected: `pi-runner-capability-dashboard`, `pi-runner-global-capabilities`, `pi-runner-adaptive-memory-selection`, `pi-runner-ui-visual-helpers`, `pi-runner-team-configuration`, `pi-runner-install-review-plan`, `pi-runner-installation-flow`, `developer-team-installation`, `developer-team-model-configuration`, `adaptive-memory-configuration`
- Spec status: not yet available
- Registry mode: deferred; `state.yaml` and `events.yaml` were read for context and must be updated by the Orchestrator only.

## Current Architecture Context

- `apps/cli/src/tui/app.tsx` currently owns the Pi install wizard as one large `Screen` union plus local React state, cursor limits, `continueFromCurrent`, `goBack`, toggles, install effects, memory setup, model config, and render selection.
- Current Pi flow is linear and package/tool oriented:
  - `environment-selection` → `environment-check` → `pi-preflight-checking` → `pi-preflight` → `required-tools` → `optional-tools` → `installation-review` → `installing` → `team-selection` → model/memory/team review screens.
- Existing package/tool plan lives in `packages/adapter-pi/src/installation-plan.ts`:
  - required: `sub-agents` (`npm:pi-subagents`), `mcp-packages` (`npm:pi-mcp-adapter`);
  - optional: `context-mode`, `codebase-memory`, `rtk`, `context7`, `engram-memory`.
- Existing detection lives in `packages/adapter-pi/src/required-tools.ts` via `pi list` plus PATH checks for `rtk`, `codebase-memory-mcp`, and `engram`.
- Existing install execution lives in `packages/adapter-pi/src/install-tools.ts`; `pi-package` actions run `pi install <source>`, while `external` tools return manual-install results.
- Developer Team screens are already extracted in `apps/cli/src/tui/screens/developer-team-screens.tsx`, but their transitions/state remain in `app.tsx`.
- Model configuration to preserve:
  - `packages/adapter-pi/src/model-config.ts` detects providers from Pi settings, `pi --list-models`, and env vars;
  - agent assignments persist as `model: provider/model` and `thinking: off|minimal|low|medium|high|xhigh` frontmatter;
  - `supportsThinkingForModel()` forces `off` for `opencode-go` and Kimi K2.6;
  - `buildDeveloperTeamInstallPlan()` preserves defaults and validates model/thinking compatibility.
- Adaptive memory is already represented by core config providers `none`, `engram`, `supermemory` in `packages/core/src/config/deck-config.ts`.
- Current TUI can collect Supermemory config and write Pi MCP credentials, but `createMemoryProviderForSelection()` only creates Engram, so immediate TUI team install does not inject Supermemory even after configuration. Launch path `apps/cli/src/pi-launch-command.ts` does construct Supermemory after validating `.deck/config.json` and Pi MCP config.
- `pi-hud` and the Pi-specific Mermaid implementation `pi-mermaid` are not present in current install/detection catalogs; they are only documented as target UX in `docs/prompts/pi-runner-install-ux.md`.

## Proposed Architecture

Replace the Pi branch of the package wizard with a dashboard flow backed by pure capability inventory and review-plan modules. `DeckApp` should become a shell/router for top-level flows, while Pi Runner dashboard state, transitions, and plan generation move into dedicated testable modules.

### Architectural decisions

- Ask by capability, not package:
  - UI stores selected `CapabilityId`s and adaptive-memory provider state.
  - Pure plan builder maps selected capabilities to technical actions and package/tool sources.
- Dashboard sections, not yes/no wizard:
  1. Runner Capabilities globales
  2. Adaptive Memory global
  3. Runner UI / visual helpers
  4. Teams
  5. Review & Install
- Capability policy is not a flat optional list:
  - `rtk`, `context-mode`, and `codebase-memory` are configurable runner capabilities.
  - Mermaid is a mandatory visual documentation capability for runners; it is not an optional toggle.
  - `pi-mermaid` is the Pi runner implementation of the mandatory Mermaid capability, not the global concept itself.
  - OpenCode needs its own Mermaid implementation mapping, which must not be conflated with `pi-mermaid` unless a future source decision explicitly reuses it.
  - `pi-hud` is an optional Runner UI helper limited to Pi.
- Excluded from dashboard capability catalog:
  - `@juicesharp/rpiv-todo`
  - `@juicesharp/rpiv-ask-user-question`
- `context7` should not be surfaced in the new dashboard by default. Existing legacy catalog entries may remain until cleanup, but the new capability plan must not select it unless a future capability explicitly adds it.
- `engram-memory` must not be a global runner capability. It becomes a technical action only when `adaptiveMemory.provider === "engram"`.
- Adaptive Memory state is single-choice:
  - `none` default;
  - `engram` creates/uses Engram provider and adds Engram technical action when missing;
  - `supermemory` writes non-secret Deck config plus Pi MCP credential handoff and should construct a Supermemory provider for immediate Developer Team installation after validation.
- Preserve current model-config behavior by reusing existing model inventory, assignment, thinking, and Developer Team install functions. The dashboard only changes where users enter those screens.

## Component / Module Boundaries

| Component | Responsibility | Change Type |
|---|---|---|
| `packages/adapter-pi/src/capability-catalog.ts` | New pure catalog of dashboard capability metadata and mapping to tool/action sources. Excludes rpiv todo/ask-user and excludes Context7 from visible dashboard. | create |
| `packages/adapter-pi/src/capability-inventory.ts` | Convert `PiRequiredToolsReview`, runtime/preflight data, and known gaps into capability readiness: `ready`, `missing`, `manual`, `pending-source`, `blocked`. | create |
| `packages/adapter-pi/src/capability-plan.ts` | Build `PiRunnerReviewPlan` from selected capabilities, adaptive-memory provider, team selections, model assignments, and current detection. | create |
| `packages/adapter-pi/src/installation-plan.ts` | Keep legacy package plan; optionally expose shared tool metadata for capability mapping without making UI package-centric. | modify |
| `packages/adapter-pi/src/required-tools.ts` | Add or structure detection for capability inventory; keep existing package/tool review compatibility. Add `pi-hud` detector only for Pi and `pi-mermaid` detector as the Pi implementation of required Mermaid only after canonical detector/source decision. | modify |
| `packages/adapter-pi/src/install-tools.ts` | Execute generated install actions or remain package executor called by action runner; external actions remain manual, not failed UX. | modify |
| `packages/adapter-pi/src/developer-team-install.ts` | Preserve model/thinking behavior; consume resolved adaptive-memory provider from dashboard plan. | modified |
| `packages/adapter-pi/src/model-config.ts` | Provider/model/thinking behavior remains unchanged and reused by dashboard Developer Team detail. | unchanged |
| `apps/cli/src/tui/pi-runner-dashboard/state.ts` | Dashboard state types: sections, selected capabilities, adaptive-memory provider, team state, model config snapshot, runtime review, plan. | create |
| `apps/cli/src/tui/pi-runner-dashboard/reducer.ts` | Pure navigation/state transitions for dashboard screens, cursor behavior, toggles, provider selection, and review entry. | create |
| `apps/cli/src/tui/pi-runner-dashboard/selectors.ts` | Derived section summaries, cursor limits, compatibility summaries, and action counts. | create |
| `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` | Bridge from `PiRunnerReviewPlan` actions to existing installers/config writers/team apply. | create |
| `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` | Ink screens for dashboard, details, teams, Developer Team detail, review plan, and progress. | create |
| `apps/cli/src/tui/screens/developer-team-screens.tsx` | Reuse existing model/adaptive-memory input screens where practical; add props only if needed for dashboard context/status. | modify |
| `apps/cli/src/tui/app.tsx` | Reduce to shell/router: start Pi Runner dashboard, pass IO/runtime adapters, preserve `Configure models` menu route. | modify |
| `apps/cli/src/pi-launch-command.ts` | Share memory provider resolution logic or expose helper so TUI install and launch both support Supermemory injection consistently. | modify |
| `packages/adapter-supermemory/src/index.ts` | No architectural change; used by shared provider resolver for dashboard install. | unchanged |
| `packages/core/src/config/deck-config.ts` | No schema change expected; already supports `none`, `engram`, `supermemory` and rejects secrets. | unchanged |

## Data Flow

1. User chooses Pi Runner installation/configuration from Home.
2. `DeckApp` routes to `pi-runner-dashboard` and supplies IO adapters:
   - runtime detection (`detectSelectedRuntimes`);
   - Pi preflight (`inspectPiEnvironment`);
   - tool review (`reviewPiRequiredTools`);
   - config writers and installers.
3. Dashboard initializes `PiRunnerDashboardState`:
   - `selectedCapabilities`: default policy from Spec if provided; otherwise no hidden package default beyond required prerequisites;
   - `adaptiveMemory.provider`: `none` by default;
   - `teams["developer-team"].selected`: selectable in Teams section, not automatically tied to package tools unless current behavior/Spec says default selected;
   - existing model/thinking assignments are hydrated via `readDeveloperTeamModelConfigAssignments()` when Developer Team detail/model config opens.
4. `buildPiRunnerCapabilityInventory(review, preflight, config)` maps detected packages/binaries to capability status.
5. Section screens edit dashboard state:
   - Runner Capabilities toggles RTK/context-mode/codebase-memory and shows mandatory Mermaid readiness plus optional pi-hud availability;
   - Adaptive Memory selects exactly one provider and collects Supermemory fields when selected;
   - Runner UI / visual helpers presents `pi-hud` as optional Pi-only and Mermaid as mandatory visual documentation requirement, mapping Pi to `pi-mermaid`, with pending/manual/blocking status until sources are confirmed;
   - Teams selects Developer Team and opens Developer Team detail;
   - Developer Team detail opens the existing provider/model/thinking subflow.
6. `buildPiRunnerReviewPlan(state, inventory)` creates grouped actions:
   - automatic Pi package installs;
   - manual external steps;
   - config writes (`.deck/config.json`, Pi MCP config);
   - team application;
   - validation checks.
7. Review screen renders action groups and readiness. It must show manual/pending items as non-automatic actions, not as failed installs.
8. Install progress executes only executable actions. Manual/pending-source items remain listed as follow-up actions.
9. Complete screen shows per-action result and any memory diagnostics with secrets redacted.

### Proposed core types

```ts
type CapabilityId = "rtk" | "context-mode" | "codebase-memory" | "pi-hud" | "runner-mermaid";
type RunnerScope = "pi" | "opencode" | "all";
type CapabilityRequirementLevel = "required" | "optional" | "configurable";
type AdaptiveMemoryProviderChoice = "none" | "engram" | "supermemory";
type CapabilityStatus = "ready" | "missing" | "manual" | "pending-source" | "blocked";
type TechnicalActionKind =
  | "install-pi-package"
  | "manual-external-install"
  | "write-deck-config"
  | "write-pi-mcp-config"
  | "apply-team-bundle"
  | "validate"
  | "noop";

type CapabilityToolMapping = {
  capabilityId: CapabilityId;
  runnerScope: RunnerScope;
  requirementLevel: CapabilityRequirementLevel;
  toolId?: InstallablePiToolId;
  source?: string;
  installKind?: "pi-package" | "external" | "pending";
  detector?: { piPackageNames?: string[]; commands?: string[] };
};

type PiRunnerDashboardState = {
  screen: PiRunnerDashboardScreen;
  cursor: number;
  selectedCapabilities: Partial<Record<CapabilityId, boolean>>; // only configurable/optional capabilities are user-toggled; required capabilities like runner-mermaid are derived into the plan
  adaptiveMemory: {
    provider: AdaptiveMemoryProviderChoice;
    supermemory?: SupermemorySetupValues;
    status?: string;
  };
  teams: Record<string, PiRunnerTeamState>;
  runtime: {
    piCommand?: string;
    preflight?: PiPreflightResult;
    toolsReview?: PiRequiredToolsReview;
  };
  plan?: PiRunnerReviewPlan;
};

type PiRunnerReviewPlan = {
  groups: {
    automaticInstalls: PiRunnerAction[];
    manualSteps: PiRunnerAction[];
    configWrites: PiRunnerAction[];
    teamApplications: PiRunnerAction[];
    validations: PiRunnerAction[];
  };
  diagnostics: PiRunnerPlanDiagnostic[];
};
```

## Screen / Navigation Design

| Screen | Purpose | Notes |
|---|---|---|
| `pi-runner-dashboard` | Section overview with readiness/action counts. | Primary screen; no linear package wizard. |
| `runner-capabilities-detail` | Toggle RTK, context-mode, codebase-memory; show mapping/status. | Also shows mandatory Mermaid readiness and links visual detail. |
| `adaptive-memory-detail` | Single-choice `None`, `Engram`, `Supermemory`. | Default `None`; no provider active until selected. |
| `supermemory-token/user-id/team-id/org-id` | Existing Supermemory subform. | Reuse redaction and Pi MCP handoff behavior. |
| `runner-ui-visual-helpers-detail` | Configure/view visual helpers. | `pi-hud` is optional Pi-only; Mermaid is required for runners, maps to `pi-mermaid` in Pi, and is marked pending/blocking/manual until package/detection is confirmed. |
| `teams-detail` | Select Developer Team and future team placeholders if present. | Shows compatibility/consumption summary per team. |
| `developer-team-detail` | Developer Team status, model summary, actions. | Actions: Configure models, use defaults/current assignments, reset model assignments if Spec approves. |
| Existing model screens | Provider/model/thinking per agent. | Preserve behavior; entered from Developer Team detail and Home `Configure models`. |
| `review-plan` | Grouped action review. | User confirms executable actions; manual/pending shown separately. |
| `install-progress` | Execute actions and stream result. | Per capability/action progress. |
| `complete` | Summary and diagnostics. | Reuse/extend current `CompleteScreen`. |

### Decoupling from `app.tsx`

- Keep `DeckApp` responsible for:
  - Home menu;
  - top-level routing between legacy non-Pi flows and Pi Runner dashboard;
  - passing runtime IO dependencies;
  - terminal frame dimensions and exit handling.
- Move Pi dashboard concerns into `apps/cli/src/tui/pi-runner-dashboard/*`:
  - reducer handles screen transitions, cursor, back stack, toggle/select events;
  - selectors compute menu items and summaries;
  - action runner executes review-plan actions.
- Keep existing model-config route from Home:
  - `Configure models` should continue to hydrate assignments and open the same model screens;
  - model screens can be reused through a shared `ModelConfigFlowState` or existing state adapter, but provider/model/thinking semantics must remain unchanged.
- Avoid duplicating Developer Team model logic in dashboard; route to existing functions and screens.

## Capability → Tool / Action Model

| Capability / Provider | User-facing section | Technical mapping | Action behavior |
|---|---|---|---|
| `context-mode` | Runner Capabilities | `toolId: context-mode`, `source: npm:context-mode`, `installKind: pi-package`, detected by `pi list`. | Auto install when selected and missing. |
| `codebase-memory` | Runner Capabilities | `toolId: codebase-memory`, `source: DeusData/codebase-memory-mcp`, `installKind: external`, detected by `codebase-memory-mcp`. | Manual external action when selected and missing. Not an adaptive-memory provider. |
| `rtk` | Runner Capabilities | `toolId: rtk`, `source: rtk-ai/rtk`, `installKind: external`, detected by `rtk`. | Manual external action when selected and missing. |
| `pi-hud` | Runner UI / visual helpers | Optional Pi-only helper; no confirmed current source/detector. | `pending-source` optional action; not auto-installed until source is confirmed; not included for OpenCode. |
| `runner-mermaid` | Runner UI / visual helpers / runner prerequisite | Mandatory visual documentation capability for runners. Implementation is runner-specific: Pi maps to `pi-mermaid`; OpenCode mapping is TBD. | Required `pending-source`/manual/blocking action until source is confirmed; not user-toggleable as optional. |
| Adaptive `none` | Adaptive Memory | Existing `activeProvider: none`. | Write/keep non-secret Deck config only if user confirms disabling memory. No provider injection. |
| Adaptive `engram` | Adaptive Memory | `createEngramMemoryProvider()` plus technical `engram-memory` external source `Gentleman-Programming/engram`. | Engram action appears only when selected. Manual external action if `engram` missing; provider used for Developer Team memory injection. |
| Adaptive `supermemory` | Adaptive Memory | `.deck/config.json` non-secret config + `~/.pi/agent/mcp.json` credential handoff + `createSupermemoryMemoryProvider()`. | No package action; write/validate config and inject provider if valid. Token redacted and never stored in Deck config. |
| `sub-agents` prerequisite | Review Plan prerequisites | Existing required `npm:pi-subagents`. | Auto install if missing; not exposed as dashboard capability toggle. |
| `mcp-packages` prerequisite | Review Plan prerequisites | Existing required `npm:pi-mcp-adapter`. | Auto install if missing; not exposed as dashboard capability toggle. |

## Team Compatibility / Consumption

| Team | Selection | Consumes | Inherits / Compatible | Notes |
|---|---|---|---|---|
| Developer Team | Selectable in Teams section | Base Pi agent/skill install; selected Adaptive Memory provider for agent/skill memory injection; model/thinking assignments; required Mermaid availability via Pi implementation `pi-mermaid`. | RTK, context-mode, codebase-memory as runner environment capabilities; pi-hud optional Pi-only; Mermaid required for runner visual documentation. | Display explicit labels: `consumes directly`, `available in runner`, `manual required`, `pending source`, `required`, `optional`, `not selected`. |
| Future teams | Not part of current implementation unless catalog already includes them. | Unknown. | Unknown. | If shown, disabled/placeholder until real team profile exists. |

Implementation model:

```ts
type TeamCapabilityConsumption = "required" | "consumes-directly" | "inherits-runner" | "compatible" | "not-used" | "unknown";

type TeamCapabilityProfile = {
  teamId: string;
  installable: boolean;
  capabilities: Partial<Record<CapabilityId | "adaptive-memory", TeamCapabilityConsumption>>;
  diagnostics: string[];
};
```

## API / Contract Implications

| Endpoint / Interface | Change | Backward Compatible |
|---|---|---|
| `buildPiInstallationPlan(options)` | Legacy package plan remains available; new dashboard should prefer `buildPiRunnerReviewPlan()` for capability-driven actions. | yes |
| `InstallablePiToolId` | `engram-memory` remains legacy technical tool but is no longer selected as global capability. `pi-hud` should not be added until Pi-only source/detection is known; `pi-mermaid` should be added only as the Pi implementation of required Mermaid after source/detection is known. | yes |
| `reviewPiRequiredTools(options)` | Existing return shape can remain; capability inventory consumes it. Future detectors can extend tool list only after source decision, with Mermaid required by runner, Pi mapped to `pi-mermaid`, and pi-hud optional Pi-only. | yes |
| `buildDeveloperTeamInstallPlan(projectRoot, options)` | Continue accepting `modelAssignments`, `thinkingAssignments`, and `memoryProvider`; dashboard passes a resolved provider. | yes |
| `createMemoryProviderForSelection` / launch memory resolver | TUI should share provider resolution with launch path or add an equivalent helper so Supermemory can be injected immediately. | partial |
| `.deck/config.json` | Existing schema already supports `none`, `engram`, `supermemory`; no token fields. | yes |
| Pi MCP config `~/.pi/agent/mcp.json` | Supermemory credential handoff remains external to Deck config. | yes |

## State / Persistence Implications

- No new persistent schema is required for the dashboard itself.
- Dashboard selections are ephemeral until Review & Install is confirmed.
- Existing persistence remains:
  - `.deck/config.json` for non-secret adaptive-memory config;
  - `~/.pi/agent/mcp.json` for Supermemory token handoff;
  - `<project>/.pi/agents/*.md` and `<project>/.pi/skills/*/SKILL.md` for Developer Team application;
  - model/thinking frontmatter in Developer Team agent files.
- If product later requires persistent global capability preferences, add a separate config decision; do not overload package install state as user preference.

## Migration / Backward Compatibility

- No data migration required.
- Existing Developer Team agent files remain readable; dashboard hydrates model/thinking assignments with `readDeveloperTeamModelConfigAssignments()` before model editing or team application.
- Existing `.deck/config.json` remains valid; missing config resolves to default `activeProvider: none`.
- Existing Supermemory MCP config behavior remains; token is never moved into Deck config.
- The old package-oriented Pi screens can be removed from the Pi branch after tests cover the dashboard. Non-Pi/OpenCode flow can remain unchanged unless separately redesigned.
- Rollback path: route Home `Start installation` back to the previous Pi wizard and keep `Configure models` unchanged.

## File Impact Estimate

| File / Path | Action | Rationale |
|---|---|---|
| `openspec/changes/pi-runner-capability-dashboard/design.md` | create | Required design artifact. |
| `packages/adapter-pi/src/capability-catalog.ts` | create | Capability metadata and capability→tool/action mapping. |
| `packages/adapter-pi/src/capability-inventory.ts` | create | Pure readiness builder from current review/preflight/config. |
| `packages/adapter-pi/src/capability-plan.ts` | create | Pure grouped Review Plan builder. |
| `packages/adapter-pi/src/capability-plan.test.ts` | create | Unit coverage for action grouping, defaults, Engram-only action, exclusions. |
| `packages/adapter-pi/src/capability-inventory.test.ts` | create | Unit coverage for status mapping, required pending Mermaid mapped to `pi-mermaid` for Pi, and optional Pi-only pi-hud. |
| `packages/adapter-pi/src/installation-plan.ts` | modify | Share existing tool metadata while preventing dashboard from being package-centric. |
| `packages/adapter-pi/src/required-tools.ts` | modify | Feed inventory; future detector extension for required Mermaid mapped to `pi-mermaid` in Pi and optional Pi-only pi-hud after source decision. |
| `packages/adapter-pi/src/install-tools.ts` | modify | Align manual external actions with Review Plan semantics. |
| `apps/cli/src/tui/pi-runner-dashboard/state.ts` | create | Dashboard state and screen types. |
| `apps/cli/src/tui/pi-runner-dashboard/reducer.ts` | create | Testable navigation/state transitions. |
| `apps/cli/src/tui/pi-runner-dashboard/selectors.ts` | create | Section summaries, cursor limits, compatibility labels. |
| `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` | create | Executes Review Plan actions via existing installers/config/team apply. |
| `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` | create | Ink UI for dashboard sections, review, progress. |
| `apps/cli/src/tui/app.tsx` | modify | Shell/router only for Pi dashboard; preserve Home `Configure models`. |
| `apps/cli/src/tui/screens/developer-team-screens.tsx` | modify | Reuse/adapt existing Developer Team detail/model/memory screens. |
| `apps/cli/src/tui/pi-runner-dashboard/reducer.test.ts` | create | Navigation/back/cursor and section state tests. |
| `apps/cli/src/tui/pi-runner-dashboard/render.test.tsx` | create | Dashboard and Review Plan render tests. |
| `apps/cli/src/pi-launch-command.ts` | modify | Share Supermemory/Engram provider resolution with TUI install path. |

## Testing Strategy

- Adapter unit tests:
  - capability catalog excludes rpiv todo/ask-user and Context7 from dashboard capabilities;
  - default adaptive-memory provider is `none`;
  - `engram-memory` appears only for `adaptiveMemory.provider === "engram"`;
  - Supermemory creates config/write/validate actions, not package install actions;
  - external tools produce manual actions, not failed automatic actions;
  - Mermaid produces required pending-source/manual/blocking diagnostics until a runner-specific source is defined; Pi diagnostics name `pi-mermaid` as the implementation;
  - pi-hud produces optional pending-source diagnostics only for Pi.
- TUI reducer tests:
  - dashboard section navigation, back stack, cursor limits, toggles;
  - adaptive-memory single-choice behavior;
  - Developer Team selection and transition to model config;
  - review-plan entry/return behavior.
- Render tests:
  - section dashboard shows required section names and action counts;
  - Teams screen shows Developer Team selectable and capability consumption/compatibility;
  - Review Plan groups automatic/manual/config/team/validation actions.
- Preservation tests:
  - existing model provider/model/thinking tests should remain green;
  - add regression that Dashboard model config writes the same model/thinking frontmatter as current `Configure models` route.
- Integration-style action-runner tests:
  - mock Pi command/config writers/team apply and assert correct action ordering and redacted Supermemory diagnostics.

## Observability / Error Handling

- Review Plan should classify unsupported or missing external capabilities as `manual` or `pending-source`, not generic install failures.
- Supermemory diagnostics must remain redacted; token values must never appear in Deck config, status, logs, or rendered output.
- Plan diagnostics should include source/detector uncertainty for optional `pi-hud` and required Mermaid implementation (`pi-mermaid` for Pi, OpenCode mapping TBD).
- Install progress should show action group and capability context so users can distinguish package install, manual step, config write, team apply, and validation.

## Security / Performance / Accessibility Considerations

- Security:
  - preserve existing Supermemory secret separation: token only in Pi MCP config;
  - maintain fail-closed Supermemory validation before injecting MCP tools;
  - do not use adaptive memory as authority over OpenSpec/Spec Registry.
- Performance:
  - keep inventory/plan builders pure and cheap;
  - run Pi preflight/tool review once per dashboard refresh, not on every cursor move.
- Accessibility/UX:
  - avoid wizard yes/no prompts;
  - each section must show status text, not color-only indicators;
  - manual/pending items must be visible before install confirmation.

## Tradeoffs

| Decision | Chosen | Rejected Alternative | Rationale |
|---|---|---|---|
| Dashboard foundation | Extract pure capability inventory/plan before TUI wiring. | Add dashboard screens directly inside `app.tsx`. | Reduces coupling, makes plan/navigation testable, and prevents capability logic from becoming package wizard logic. |
| Capability model | Store user choices as capabilities and map internally to tools/actions. | Ask users to select `InstallablePiToolId`s. | Matches product direction and allows Engram/Supermemory/team actions without exposing packages as decision units. |
| Adaptive Memory | Single-choice `none`/`engram`/`supermemory`, default `none`. | Auto-enable Engram or allow multiple providers. | Matches confirmed decision and existing core contract. |
| Engram installability | Include `engram-memory` only when Engram provider is selected. | Keep `engram-memory` as global optional tool. | Avoids confusing Engram provider with generic runner capability. |
| Supermemory injection | Share/align TUI provider resolution with launch path. | Keep current TUI behavior that writes config but does not inject provider during immediate install. | Prevents mismatch between install-time and launch-time behavior. |
| Mermaid/pi-hud policy | Show Mermaid as required for runners with runner-specific implementation (`pi-mermaid` for Pi), and pi-hud as optional Pi-only, both with `pending-source` until source/detector is confirmed. | Treat `pi-mermaid` as the global concept, treat Mermaid as optional, or invent package sources. | Preserves required UX without conflating concept and implementation. |
| Developer Team models | Reuse existing model screens/functions. | Rewrite model config for dashboard. | Preserves provider/model/thinking semantics and reduces regression risk. |
| Context7 | Do not surface in dashboard plan by default. | Keep as visible global capability. | Proposal lists RTK/context-mode/codebase-memory as configurable runner capabilities, Mermaid as required runner capability with `pi-mermaid` as Pi implementation, and pi-hud as optional Pi-only; Context7 is not included. |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Navigation regressions from replacing linear wizard. | Medium | High | Use reducer/back-stack tests before wiring action execution. |
| Model config behavior changes accidentally. | Medium | High | Reuse existing model functions/screens and add dashboard preservation regression tests. |
| Supermemory install-time injection remains inconsistent with launch. | Medium | Medium | Extract/share provider resolution and validate Pi MCP config before team install. |
| Mermaid/pi-hud affordances imply installability without known sources. | High | Medium | Render Mermaid as required pending/manual/blocking with runner-specific implementation (`pi-mermaid` for Pi), and pi-hud as optional pending; omit auto-install until canonical sources are decided. |
| Manual external tools look like failed installs. | Medium | Medium | Review Plan separates manual actions and install results from failures. |
| Global runner setup vs project-local Developer Team application remains ambiguous. | Medium | Medium | Make Review Plan grouping explicit and keep open decision for persistence/location semantics. |

## Open Decisions

- Canonical package sources, detectors, and install commands for required Mermaid by runner —`pi-mermaid` for Pi and a separate OpenCode mapping— plus optional Pi-only `pi-hud` — product/engineering decision needed before auto-install.
- Whether Pi Runner capability preferences should persist globally, project-locally, or remain one-run Review Plan state — product/engineering decision needed.
- Whether Home `Start installation` should still include multi-environment selection before the Pi dashboard, or route directly to Pi Runner dashboard while OpenCode remains a separate legacy flow — product/UX decision needed.

## Dependencies

- Existing Pi adapter install/review APIs: `buildPiInstallationPlan`, `reviewPiRequiredTools`, `installPiTools`.
- Existing Developer Team APIs: `buildDeveloperTeamInstallPlan`, `applyDeveloperTeamInstall`, `verifyDeveloperTeamInstall`, model config helpers.
- Existing adaptive-memory config and providers: `@deck/core/config/deck-config`, `@deck/adapter-engram`, `@deck/adapter-supermemory`.
- Canonical source/detection decisions for required Mermaid by runner —`pi-mermaid` for Pi and a separate OpenCode mapping— plus optional Pi-only `pi-hud` before they can become automatic install actions.

## Next Steps

Ready for Task (`deck-developer-task`) to break this design into implementation tasks, combined with Spec.

# Design: Orchestrator Personality Selector

## Source

- Proposal: `orchestrator-personality-selector` proposal artifact
- Registry context: `state.yaml` and `events.yaml` were requested but are not present in the change directory at design time.
- Capabilities affected:
  - `orchestrator-personality-selection`
  - `orchestrator-personality-persistence`
  - `orchestrator-personality-aware-output`
  - `deck-installation-flow`
  - `orchestrator-pipeline`
- Spec status: not yet available
- Skill registry: `.atl/skill-registry.md` checked; relevant project skill is `deck-developer-design`, already loaded. No additional stack-specific design rules were present beyond registry loading protocol.
- Adaptive context: Supermemory recall returned general user/project preferences but no authoritative prior design for this change. Official OpenSpec/code context is authoritative.

## Current Architecture Context

| Area | Current shape | Relevant files |
|---|---|---|
| Deck config | `DeckConfig` and `NormalizedDeckConfig` are centralized in core. `readDeckConfig()` returns defaults when `.deck/config.json` is absent; `writeDeckConfig()` validates, normalizes, creates `.deck/`, and writes normalized JSON. Unknown top-level fields are rejected. | `packages/core/src/config/deck-config.ts`, `packages/core/src/config/deck-config.test.ts` |
| TUI flow | `DeckApp` stores flow state with React `useState`. `Screen` is a local union in `apps/cli/src/tui/app.tsx`. `environment-selection` currently routes directly to Pi/OpenCode preflight. Screen rendering is conditional within `DeckApp`. | `apps/cli/src/tui/app.tsx` |
| Flow helpers | Developer Team helper functions return `NextScreen` values for team/review/install transitions. Current `NextScreen` does not include environment-selection or personality-selection. | `apps/cli/src/developer-team-flow.ts`, `apps/cli/src/developer-team-flow.test.ts` |
| Menu rendering | Simple single/multi-select display uses `MenuList` with `items`, `cursor`, and optional `hint`/`checked`. | `apps/cli/src/tui/components/menu-list.tsx` |
| Orchestrator pipeline | `runOrchestratorPipeline(input, config)` computes audit validation, risk, quality routing, loop action, and returns machine-readable result fields plus human-readable strings such as `blockReason` and `qualityDecision.skipReason`. Non-test callers are not currently present in the indexed code graph. | `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts`, `quality-router.ts`, `loop-breaker.ts` |

## Proposed Architecture

Add a runner-neutral personality preference to Deck config, collect it during the TUI install flow immediately after environment selection, and pass the normalized value into orchestrator pipeline configuration wherever the pipeline is invoked. The personality changes only human-facing explanation text; decision logic, risk scoring, routing, loop thresholds, and machine-readable result fields remain unchanged.

### Architecture Overview

1. **TUI input**: `DeckApp` routes `environment-selection -> personality-selection -> first preflight`.
2. **Config persistence**: `PersonalitySelectionScreen` selection is stored in `DeckApp` state and persisted as top-level `.deck/config.json.orchestratorPersonality` using core config helpers.
3. **Config contract**: `packages/core/src/config/deck-config.ts` owns the canonical union, default, validation, and normalization.
4. **Orchestrator runtime**: invocation boundaries read `readDeckConfig(projectRoot).orchestratorPersonality` and pass it into `PipelineConfig` or `OrchestratorPipelineInput`.
5. **Output shaping**: `runOrchestratorPipeline()` uses the personality to format human-facing strings while preserving all machine fields.

### Config Schema

| Field | Contract | Default | Persistence |
|---|---|---|---|
| `orchestratorPersonality` | `"guia" \| "pragmatica" \| "ahorro-extremo"` | `"pragmatica"` | Top-level field in project-local `.deck/config.json` via `writeDeckConfig(projectRoot, config)` |

Recommended core definitions:

```ts
export const ORCHESTRATOR_PERSONALITIES = ["guia", "pragmatica", "ahorro-extremo"] as const;
export type OrchestratorPersonality = (typeof ORCHESTRATOR_PERSONALITIES)[number];
export const DEFAULT_ORCHESTRATOR_PERSONALITY: OrchestratorPersonality = "pragmatica";
```

Schema integration decisions:

- Extend `DeckConfig` with `orchestratorPersonality?: OrchestratorPersonality`.
- Extend `NormalizedDeckConfig` with `orchestratorPersonality: OrchestratorPersonality`.
- Add `orchestratorPersonality` to the top-level known-field allowlist.
- Add a normalizer that defaults missing/null config input to `"pragmatica"` and rejects unsupported values with `DECK_CONFIG_INVALID_SHAPE` or a dedicated `ORCHESTRATOR_PERSONALITY_INVALID` error code.
- Preserve the current config version (`1`) because this is a backward-compatible optional field with a default.
- When TUI writes personality, merge with existing normalized config rather than constructing a partial config that would drop `adaptiveMemory` or `packageInstructions` selections.

### TUI Screen Design

| Element | Design |
|---|---|
| Screen component name | `PersonalitySelectionScreen` |
| Location | Prefer `apps/cli/src/tui/app.tsx` near `EnvironmentSelectionScreen` for consistency with existing install-flow screens. Extract later only if screen count grows. |
| Props / inputs | `{ cursor: number; selected: OrchestratorPersonality }` |
| Options | `guia` label `Guía`, hint `Explicaciones completas y educativas`; `pragmatica` label `Pragmática`, hint `Balance entre contexto y brevedad`; `ahorro-extremo` label `Ahorro extremo`, hint `Salida mínima; omite detalle no crítico` |
| State | Add `selectedPersonality` to `DeckApp`, initialized from `readDeckConfig(resolveProjectRoot()).orchestratorPersonality` with fallback to `"pragmatica"` if config read fails or file is absent. Use the existing generic `cursor` for selection navigation. |
| Cursor limit | `getCursorLimit()` returns `2` for `personality-selection`. |
| Continue behavior | On Enter, select option by `cursor`, update `selectedPersonality`, persist merged config, then route to Pi/OpenCode preflight based on selected environments. |
| Back behavior | Existing `esc`/back handling should return to `environment-selection` when on `personality-selection`. |
| Render routing | Add conditional render branch before preflight screens and add title `Orchestrator personality`. |

Navigation routing:

- Extend local TUI `Screen` union with `"personality-selection"`.
- Extend `apps/cli/src/developer-team-flow.ts` `NextScreen` with `"personality-selection"` only if the helper is reused for install routing.
- Add `getNextScreenAfterEnvironmentSelection(context)` to centralize the new hop:
  - if selected environments are empty: caller stays on `environment-selection`.
  - if Pi or OpenCode installation is selected: return `"personality-selection"`.
  - otherwise return `"complete"` as defensive fallback.
- Add a small helper for the post-personality route, either in `developer-team-flow.ts` or locally in `DeckApp`, that preserves current preflight precedence:
  - Pi selected -> `"pi-preflight-checking"`
  - else OpenCode selected -> `"opencode-preflight-checking"`
  - else `"complete"`

### Orchestrator Integration

| Integration point | Design |
|---|---|
| Where personality is read | At the orchestration invocation boundary: `readDeckConfig(projectRoot).orchestratorPersonality`. Do not read the filesystem inside pure scoring/routing helpers. |
| How it is passed | Add optional `personality?: OrchestratorPersonality` to `PipelineConfig` with fallback to `DEFAULT_ORCHESTRATOR_PERSONALITY`. If a future caller already builds `OrchestratorPipelineInput`, it may pass personality there only if config-level `PipelineConfig` proves awkward; do not add both unless needed. |
| Output behavior | `guia` expands human-facing explanations with rationale/why-it-matters context; `pragmatica` preserves current message style; `ahorro-extremo` returns one-line summaries while keeping critical warning facts. |
| Methods/paths affected | `runOrchestratorPipeline()` for invalid audit `blockReason`; `quality-router` skip/override text either by passing personality into `routeQuality()` or by post-formatting `qualityDecision.skipReason`; loop-breaker output only if/when a human-facing loop message field exists. Current `loopAction` stays unchanged. |
| Machine contract | `outcome`, `auditValid`, `riskResult`, `qualityRouted`, `qualityDecision.invokeQuality`, `qualityDecision.checksToRun`, `qualityDecision.requiresReplanOrOverride`, `qualityDecision.stateValidationRequired`, and `loopAction` do not vary by personality. |

Recommended implementation shape:

- Keep formatting deterministic and pure via a small formatter module, e.g. `packages/sdd-runtime/src/orchestrator/personality-output.ts`.
- Formatter inputs should be structured facts (`missingFields`, `invalidFields`, `enforcementMode`, `riskScore`, `threshold`, `overrideName`) rather than prebuilt paragraphs.
- `pragmatica` should match current strings closely to reduce snapshot/test churn.
- `ahorro-extremo` must still include mandatory facts for blocked/critical states, e.g. `Self-audit invalid: missing=[...], invalid=[...]`.
- `guia` may add explanatory suffixes such as why a valid self-audit matters, why quality was skipped, or why an override matters, but should not alter decisions.

### Component / Module Boundaries

| Component | Responsibility | Change Type |
|---|---|---|
| `packages/core/src/config/deck-config.ts` | Canonical config schema, validation, defaulting, persistence path. | modified |
| `apps/cli/src/tui/app.tsx` | Install-flow state, navigation, screen rendering, config write on personality selection. | modified |
| `apps/cli/src/developer-team-flow.ts` | Pure navigation helpers for install-flow transitions. | modified |
| `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts` | Accept active personality and apply it to human-facing pipeline result text. | modified |
| `packages/sdd-runtime/src/orchestrator/personality-output.ts` | Pure message formatter for personality-specific explanations. | new |
| `packages/sdd-runtime/src/orchestrator/quality-router.ts` | Either remains decision-only or receives personality-aware formatting through a narrow parameter. Prefer keeping decisions separate and formatting in pipeline. | modified/unchanged |
| Tests | Config, TUI render/routing, and orchestrator formatting coverage. | modified |

### Data Flow

```text
User starts TUI install
  -> selects environments
  -> sees PersonalitySelectionScreen
  -> chooses guia/pragmatica/ahorro-extremo
  -> DeckApp merges selection into readDeckConfig(projectRoot)
  -> writeDeckConfig(projectRoot, mergedConfig) writes .deck/config.json
  -> flow continues to Pi/OpenCode preflight and install

Later orchestration run
  -> invocation boundary reads readDeckConfig(projectRoot)
  -> passes orchestratorPersonality to runOrchestratorPipeline(..., { personality })
  -> pipeline computes the same decisions as today
  -> formatter shapes only block/skip/explanation strings
  -> callers receive stable machine fields plus personality-shaped text
```

### API / Contract Implications

| Endpoint / Interface | Change | Backward Compatible |
|---|---|---|
| `DeckConfig` | Adds optional top-level `orchestratorPersonality`. | yes |
| `NormalizedDeckConfig` | Adds required normalized `orchestratorPersonality`. | partial — TypeScript consumers must handle the new property, runtime behavior defaults safely. |
| `validateDeckConfig()` / `readDeckConfig()` / `writeDeckConfig()` | Normalize and validate the new field. | yes for existing config files |
| TUI `Screen` union | Adds `"personality-selection"`. | internal only |
| `NextScreen` in `developer-team-flow.ts` | Adds `"personality-selection"` if helper returns it. | internal only |
| `PipelineConfig` | Adds optional `personality`. | yes |
| `OrchestratorPipelineResult` | Existing machine fields unchanged. Avoid adding required fields. Optional human message fields may be added only if Spec requires. | yes if optional-only |

### State / Persistence Implications

- `.deck/config.json` stores the personality at top level:

```json
{
  "version": 1,
  "orchestratorPersonality": "pragmatica",
  "adaptiveMemory": { "activeProvider": "none" },
  "packageInstructions": {
    "pi": { "codebase-memory": false, "context-mode": false, "rtk": false, "adaptive-memory": false },
    "opencode": { "codebase-memory": false, "context-mode": false, "rtk": false, "adaptive-memory": false }
  }
}
```

- Existing configs without the field normalize to `"pragmatica"`.
- Config writes from other TUI paths that currently construct partial config objects must preserve `orchestratorPersonality`; otherwise later adaptive-memory selection can erase the user's personality choice.

### Migration / Backward Compatibility

- No data migration required.
- Existing `.deck/config.json` files continue to validate and normalize with `orchestratorPersonality: "pragmatica"`.
- Rollback is safe because older code will reject unknown top-level fields only when reading config through strict validation; if rollback is expected, users may need to remove the field manually or rollback should include tolerance for unknown `orchestratorPersonality`. This is a minor rollback caveat because proposal rollback says the optional field can be ignored, but current validator rejects unknown top-level fields.

## File Impact Estimate

| File / Path | Action | Rationale |
|---|---|---|
| `openspec/changes/orchestrator-personality-selector/design.md` | create | Formal design artifact. |
| `packages/core/src/config/deck-config.ts` | modify | Add personality union/default, top-level field validation, normalization, and normalized schema. |
| `packages/core/src/config/deck-config.test.ts` | modify | Cover defaulting, accepted values, invalid values, read/write persistence, and no config-version bump. |
| `apps/cli/src/tui/app.tsx` | modify | Add TUI state, `PersonalitySelectionScreen`, cursor limit, rendering, navigation, and merged config write. |
| `apps/cli/src/developer-team-flow.ts` | modify | Add environment-to-personality routing helper and extend `NextScreen` as needed. |
| `apps/cli/src/developer-team-flow.test.ts` | modify | Cover environment selection routes to personality and post-personality preflight precedence. |
| `apps/cli/src/tui/developer-team-flow.test.tsx` | modify | Render test for personality screen labels, hints, default selected state, and cursor indicator. |
| `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts` | modify | Accept/default personality and call formatter for human-facing strings. |
| `packages/sdd-runtime/src/orchestrator/personality-output.ts` | create | Pure formatting helpers for `guia`, `pragmatica`, and `ahorro-extremo`. |
| `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.test.ts` | modify | Verify decisions are invariant and explanation verbosity changes by personality. |
| `packages/sdd-runtime/src/orchestrator/quality-router.ts` | modify/unchanged | Prefer unchanged decision logic; modify only if formatter needs structured skip facts from router. |
| `packages/sdd-runtime/package.json` | modify if required | Add explicit `@deck/core` dependency only if implementation imports shared personality types from core. |

## Testing Strategy

- **Core config unit tests**
  - Missing config returns `orchestratorPersonality: "pragmatica"`.
  - All three allowed values validate and persist.
  - Invalid value rejects with config error and field path `orchestratorPersonality`.
  - Existing adaptive-memory/package-instruction config is preserved when personality is merged and written.
- **TUI render/routing tests**
  - Personality screen renders three options with labels and hints.
  - Cursor highlighting works through `MenuList`.
  - Environment selection routes to personality before preflight.
  - Personality continue routes to Pi first when both Pi and OpenCode are selected, preserving current preflight precedence.
- **Orchestrator unit tests**
  - `pragmatica` output matches current strings or intentionally minimal deltas.
  - `guia` includes expanded rationale.
  - `ahorro-extremo` produces one-line explanations containing mandatory facts.
  - Risk score, quality routing, loop action, and outcomes are identical across personalities for the same input.

## Observability / Error Handling

- Config persistence errors in `DeckApp` should surface as a local status/error message and keep the user on `personality-selection` rather than silently continuing.
- Do not log selected personality as telemetry unless a separate telemetry decision is made; no existing telemetry hook was identified.
- Formatter functions should be total: unknown/undefined personality normalizes to `"pragmatica"` before use.

## Security / Performance / Accessibility Considerations

- Security: No secrets are introduced. The field is a non-sensitive enum and remains compatible with recursive secret-field rejection.
- Performance: Negligible; one config read/write during install and simple string formatting during orchestration.
- Accessibility/usability: Labels include Spanish names requested by proposal plus hints explaining verbosity tradeoffs. Default `Pragmática` minimizes friction.

## Tradeoffs

| Decision | Chosen | Rejected Alternative | Rationale |
|---|---|---|---|
| Config location | Top-level `orchestratorPersonality` in `.deck/config.json` | Per-runner nested config | User communication preference is transversal; top-level avoids Pi/OpenCode drift and satisfies future adapters. |
| Default | `pragmatica` | `guia` or `ahorro-extremo` | Preserves current balanced behavior and minimizes surprise/token changes for existing users. |
| TUI placement | After environment selection, before preflight | Before environment selection or after tool review | Proposal requires first config step after environment selection; users know the install target before choosing communication style. |
| Formatting boundary | Pure formatter called by pipeline | Embed conditionals throughout scoring/router/loop code | Keeps decision logic isolated and makes invariance testing straightforward. |
| Pipeline input shape | Optional `personality` in `PipelineConfig` | Required field or global config read inside pipeline | Optional preserves backward compatibility; external config reads would make pure unit tests and non-project callers harder. |
| Config writes | Merge with existing normalized config | Write a partial config object | Avoids erasing adaptive-memory/package-instruction/personality fields across independent TUI flows. |

## Alternatives Rejected

| Alternative | Why rejected |
|---|---|
| Post-install manual-only configuration | Low discoverability and fails first-run onboarding goal. |
| Per-runner personalities | Adds UI/schema complexity without a stated use case; personality is a user preference, not runner capability. |
| CLI flag/env var as primary mechanism | Useful future extension but out of scope and not persistent across runner environments. |
| Personality changes orchestrator decisions | Explicitly out of scope; would couple communication style to risk/quality behavior. |
| Agent prompt/persona rewriting in this change | Proposal open question is unresolved; design keeps scope to orchestrator pipeline output to avoid changing agent reasoning/behavior. |
| Silently accepting unknown personality strings | Makes typos hard to detect and weakens config contract. Strict enum validation is safer. |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Existing strict config validation makes rollback with leftover `orchestratorPersonality` fail. | Medium | Medium | Rollback instructions should remove the field or keep a compatibility allowlist during rollback. |
| `ahorro-extremo` removes context users need for critical failures. | Medium | Medium | Mandatory one-line summaries must retain critical facts: outcome, missing/invalid fields, critical/override status. |
| Partial config writes from existing TUI paths erase personality selection. | Medium | Medium | Centralize/mandate merge-before-write for personality and update memory-provider persistence path. |
| Type duplication between core and sdd-runtime drifts. | Low | Medium | Prefer importing the shared core type or add explicit package dependency if required by workspace rules. |
| No non-test orchestrator pipeline caller exists in indexed code. | Medium | Low | Design invocation-boundary behavior now; Task phase should verify real external callers or future integration path before claiming end-to-end runtime effect. |

## Open Decisions

- Should personality eventually influence installed orchestrator agent prompts/skills, or only the pure `sdd-runtime` orchestrator pipeline output? This design chooses pipeline output only because proposal excludes logic changes and lists prompt impact as an open question.
- Should rollback compatibility require the old validator to ignore `orchestratorPersonality`, or is manual field removal acceptable? Proposal assumes harmless ignore, but current validator rejects unknown fields.
- If telemetry is added later, which analytics sink should record personality selection? No existing telemetry/logging hook was identified.

## Dependencies

- No external dependencies.
- Internal dependency consideration: `packages/sdd-runtime` may need an explicit dependency on `@deck/core` if it imports shared personality types/constants rather than defining a local compatible union.

## Next Steps

Ready for Task (`deck-developer-task`) to break this design into implementation tasks, combined with Spec.

## Mermaid Summary Source

```mermaid
flowchart TD
    A[TUI: environment-selection] --> B[TUI: personality-selection]
    B -->|merge + write| C[.deck/config.json\norchestratorPersonality]
    B --> D{Selected environment}
    D -->|Pi first| E[pi-preflight-checking]
    D -->|OpenCode only| F[opencode-preflight-checking]
    C --> G[readDeckConfig(projectRoot)]
    G --> H[runOrchestratorPipeline config.personality]
    H --> I[Same decisions\nrisk/quality/loop]
    H --> J[Personality-shaped human text\nblockReason / skipReason]
```

# Review Report: configure-packages-instruction-injection

## Summary

**Overall Rating**: REQUEST CHANGES
**Scope**: general, backend, frontend, integration
**Files Reviewed**: 31

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | `CapabilityInstructionBundle` parallels `MemoryInjectionBundle` well. Core composition boundary is respected. Dashboard hardcodes canonical IDs in three places. Inline type duplication in `runner-capability.ts` weakens type safety. |
| Security | ✅ Strong | Secret-field rejection recurses into `packageInstructions`. No credentials persisted. Config validation is strict. |
| Scalability | ✅ Strong | In-memory filter over tiny static arrays; negligible impact. |
| Maintainability | ⚠️ Adequate | Adding a new package requires edits in 5+ files due to scattered hardcoded ID lists. Inline type duplication is a maintenance risk. |
| Code Quality | ⚠️ Adequate | Types are mostly clean; some inline imports and shallow `Object.freeze`. JSDoc is good. |
| Backend | ⚠️ Adequate | Pi and OpenCode adapters correctly pass bundles through. Fallback bundle-building from config in adapters is defensive but untested. OpenCode orchestrator prompt bypasses composed instructions. |
| Frontend | ⚠️ Adequate | Dashboard section is distinct from Packages. Toggles update state and invalidate plan. Render tests cover labels. Config write logic has a cross-runner overwrite bug. |
| Integration | ❌ Weak | Dashboard action runner overwrites the other runner's `packageInstructions` when writing config. OpenCode orchestrator prompt does not receive capability instructions. Type contract in `runner-capability.ts` duplicates bundle shape. |

## Findings

### BLOCKER
- **Integration**: Dashboard action runner overwrites cross-runner `packageInstructions` when persisting config.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — `writeDeckConfigAction` (~lines 281–351)
  - **Evidence**:
    ```ts
    const config: NormalizedDeckConfig = {
      ...
      packageInstructions: {
        pi: { "codebase-memory": packageInstructions["codebase-memory"] ?? false, ... },
        opencode: { "codebase-memory": false, ... },
      },
    };
    if (runnerKey === "opencode") {
      config.packageInstructions!.pi = {
        "codebase-memory": packageInstructions["codebase-memory"] ?? false,
        ...
      };
    }
    ```
  - **Recommendation**: Read existing config via `readDeckConfig(projectRoot)` before writing, then merge only the active runner's toggles into the existing shape. Do not initialize the non-active runner to all-false; preserve its current values. If no config exists, use `getDefaultDeckConfig()` as the base.

### MAJOR
- **Architecture**: `DeveloperTeamManifestInput` duplicates `CapabilityInstructionBundle` shape inline instead of importing the canonical type.
  - **File**: `packages/core/src/runner-capability.ts` — `DeveloperTeamManifestInput` (~lines 112–128)
  - **Evidence**:
    ```ts
    capabilityInstructions?: {
      instructions: readonly {
        packageId: string;
        surface: string;
        markdown: string;
        ...
      }[];
    };
    ```
  - **Recommendation**: Import `CapabilityInstructionBundle` from `./teams/developer/instruction-bundles/index` and use it directly. Same for `DeveloperTeamInstallPlanInput` and `DeveloperTeamVerifyInput` — replace inline `import(...)` types with a top-level import.

- **Integration**: OpenCode orchestrator prompt bypasses composed capability instructions.
  - **File**: `packages/adapter-opencode/src/prompt-generation.ts` — `buildPromptContent` (~lines 61–84)
  - **Evidence**:
    ```ts
    const isOrchestrator = agent.id === "deck-developer-orchestrator";
    const baseContent = isOrchestrator ? ORCHESTRATOR_SYSTEM_PROMPT : content.agentBody;
    ```
    For orchestrator, `content.agentBody` (which includes composed instructions) is discarded.
  - **Recommendation**: Compose capability instructions into `ORCHESTRATOR_SYSTEM_PROMPT` when `capabilityInstructions` is provided, or use `content.agentBody` for orchestrator too if the adapter can tolerate it. At minimum, call `composeCapabilityInstructions(ORCHESTRATOR_SYSTEM_PROMPT, capabilityInstructions, { surface: "agent", agentId: agent.id })`.

- **Maintainability**: Dashboard hardcodes canonical instruction package IDs in three separate files.
  - **Files**:
    - `apps/cli/src/tui/pi-runner-dashboard/selectors.ts` — `CANONICAL_INSTRUCTION_PACKAGES`
    - `apps/cli/src/tui/pi-runner-dashboard/input-handler.ts` — `instructionIds`
    - `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` — `packages` array
  - **Evidence**: All three define `["codebase-memory", "context-mode", "rtk"]` independently.
  - **Recommendation**: Export a constant from `@deck/core` (e.g., `INSTRUCTION_BUNDLE_PACKAGE_IDS`) and import it in all three files. This centralizes the canonical list.

### MINOR
- **Testing**: No test coverage for `writeDeckConfigAction` cross-runner behavior.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts`
  - **Recommendation**: Add a test that verifies writing for `pi` preserves existing `opencode` toggles and vice-versa.

- **Testing**: OpenCode prompt generation lacks tests for capability instruction injection.
  - **File**: `packages/adapter-opencode/src/prompt-generation.ts`
  - **Recommendation**: Modify `prompt-generation.test.ts` (or create it) to assert that enabled package instructions appear in generated prompt files, including the orchestrator prompt.

- **Code Quality**: `composeCapabilityInstructions` team filter is overly permissive.
  - **File**: `packages/core/src/teams/developer/instruction-bundles/index.ts` — `composeCapabilityInstructions` (~line 147)
  - **Evidence**:
    ```ts
    if (fragment.teamId !== undefined && context.teamId !== undefined && fragment.teamId !== context.teamId) return false;
    ```
    If `fragment.teamId` is set but `context.teamId` is undefined, the fragment passes.
  - **Recommendation**: Decide whether undefined `context.teamId` should match any team or fail closed. If fail-closed, change to `if (fragment.teamId !== undefined && fragment.teamId !== context.teamId) return false;`.

- **Code Quality**: `getEnabledPackageInstructionIds` silently returns `[]` for unknown runner strings.
  - **File**: `packages/core/src/teams/developer/instruction-bundles/index.ts` (~line 76)
  - **Evidence**: `const runnerConfig = config.packageInstructions[runner]; if (!runnerConfig) return [];`
  - **Recommendation**: Since the type `PackageInstructionRunnerId` prevents invalid inputs, this is defensive. No action required unless runtime strings are expected.

### NIT
- **Code Quality**: `DeveloperTeamInstallPlanInput` and `DeveloperTeamVerifyInput` use inline `import()` types.
  - **File**: `packages/core/src/runner-capability.ts` (~lines 196, 223)
  - **Recommendation**: Replace with top-level `import type { CapabilityInstructionBundle } from "./teams/developer/instruction-bundles/index";`.

- **Code Quality**: `buildCapabilityInstructionBundle` uses shallow `Object.freeze`.
  - **File**: `packages/core/src/teams/developer/instruction-bundles/index.ts` (~line 118)
  - **Recommendation**: Either deep-freeze, document that immutability is best-effort, or omit freeze since the array is not exported for mutation.

- **Documentation**: `DeveloperTeamManifestInput` JSDoc does not mention `capabilityInstructions`.
  - **File**: `packages/core/src/runner-capability.ts`
  - **Recommendation**: Add a JSDoc line describing the field.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  1. `runner-capability.ts` uses an inline anonymous type for `capabilityInstructions` instead of the canonical `CapabilityInstructionBundle` type. The design explicitly says to use the named type.
  2. OpenCode prompt generation does not compose capability instructions into the orchestrator prompt. The design states "package instructions are present in the generated prompt file content."
  3. Dashboard `action-runner.ts` does not read existing config before merging `packageInstructions`, causing cross-runner overwrites. The design says "preserves existing Adaptive Memory behavior" but does not explicitly mention reading existing config; however, per-runner independence is a core goal.
  4. Dashboard selectors, input handler, and screens hardcode package IDs instead of importing the canonical constants from core. The design implies adapters should use core constants.

## Open Questions

1. Should `getEnabledPackageInstructionIds` throw for an invalid runner string, or is the type system sufficient?
2. Is the orchestrator prompt in OpenCode intentionally exempt from capability instructions, or was it simply missed?
3. Should `action-runner.ts` be refactored to always read existing config before writing, to avoid losing unrelated fields?

## Registry Intent

- **Registry Write**: deferred
- **Registry Intent**: artifact `review-report.md`, phase `review`, status `changes_requested`, event `review.changes_requested`
- **Registry Blocker**: none

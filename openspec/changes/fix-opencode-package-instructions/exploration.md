# Exploration: Package Instructions Not Injected into OpenCode Prompts

## Goal
Investigate why the "Package Instructions (configured)" section is not appearing in generated OpenCode prompt files at `~/.config/opencode/prompts/deck-developer/*.md` despite being enabled in `.deck/config.json`.

## Current State

### Configuration
The `.deck/config.json` file has `packageInstructions.opencode` configured with all packages enabled:
```json
{
  "packageInstructions": {
    "opencode": {
      "codebase-memory": true,
      "context-mode": true,
      "rtk": true,
      "adaptive-memory": true
    }
  }
}
```

### Expected Flow
1. Prompt generation reads the Deck config
2. Gets enabled package instruction IDs for the "opencode" runner
3. Builds a `CapabilityInstructionBundle` from those IDs
4. Passes the bundle to `buildPromptGenerationPlan()`
5. `getAgentContent()` composes the bundle fragments into the prompt content
6. The generated prompts include the "Package Instructions (configured)" section

### Actual Flow
The `opencode-launch-command.ts` CLI launcher **does NOT pass capability instructions** to `buildOpenCodeDeveloperTeamInstallPlan()`:

```typescript
// apps/cli/src/opencode-launch-command.ts:184-189
const installPlan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, {
  configDir,
  memoryInjection: resolvedMemory.memoryInjection,
  memoryProvider: resolvedMemory.provider,
  supportedMemoryProviderIds: options.supportedMemoryProviderIds ?? SUPPORTED_OPENCODE_LAUNCH_MEMORY_PROVIDER_IDS,
  // ❌ MISSING: capabilityInstructions
});
```

### Verification
The generated prompt files at `~/.config/opencode/prompts/deck-developer/*.md` (timestamped May 22 22:33) do NOT contain "Package Instructions":
- `grep -r "Package Instructions" ~/.config/opencode/prompts/deck-developer/` returns no matches
- The prompts only contain the base agent content + skill reference

### Related Code Paths

**Working path (TUI/Dashboard):**
- `runner-capabilities.ts:184-196` correctly builds capability instructions from config:
  ```typescript
  const resolvedCapabilityInstructions = capabilityInstructions ?? (() => {
    try {
      const { readDeckConfig } = require("@deck/core/config/deck-config");
      const { getEnabledPackageInstructionIds, buildCapabilityInstructionBundle } = require("@deck/core/teams/developer/instruction-bundles/index");
      const config = readDeckConfig(input.projectRoot);
      const enabledIds = getEnabledPackageInstructionIds(config, "opencode");
      return enabledIds.length > 0 ? buildCapabilityInstructionBundle(enabledIds) : undefined;
    } catch {
      return undefined;
    }
  })();
  ```

**Broken path (CLI Launch):**
- `opencode-launch-command.ts` completely omits capability instructions
- The same issue likely exists in the Pi launch command

## Relevant Files

| File | Role |
|------|------|
| `apps/cli/src/opencode-launch-command.ts` | CLI launcher that is missing capabilityInstructions parameter |
| `packages/adapter-opencode/src/runner-capabilities.ts:184-196` | Shows correct implementation pattern for building capability instructions from config |
| `packages/adapter-opencode/src/developer-team-install.ts:250` | Accepts capabilityInstructions in options |
| `packages/adapter-opencode/src/prompt-generation.ts:66` | Passes capabilityInstructions to getAgentContent |
| `packages/core/src/teams/developer/content-registry.ts:198-220` | Composes capability instructions into agent content |
| `packages/core/src/teams/developer/instruction-bundles/index.ts:75-122` | Builds capability instruction bundles from enabled IDs |

## Root Cause

The `opencode-launch-command.ts` file was implemented without including the capability instructions resolution logic that exists in `runner-capabilities.ts`. The CLI launcher is a separate code path from the TUI/dashboard installer, and this feature was missed during implementation.

## Fix Required

Add capability instructions resolution to `opencode-launch-command.ts`:

```typescript
// Import required functions
import { 
  readDeckConfig,
  getEnabledPackageInstructionIds,
  buildCapabilityInstructionBundle 
} from "@deck/core/teams/developer/instruction-bundles";

// In runOpenCodeLaunch(), before calling buildOpenCodeDeveloperTeamInstallPlan:
const capabilityInstructions = (() => {
  try {
    const config = readDeckConfig(projectRoot);
    const enabledIds = getEnabledPackageInstructionIds(config, "opencode");
    return enabledIds.length > 0 ? buildCapabilityInstructionBundle(enabledIds) : undefined;
  } catch {
    return undefined;
  }
})();

// Then pass to buildOpenCodeDeveloperTeamInstallPlan:
const installPlan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, {
  configDir,
  memoryInjection: resolvedMemory.memoryInjection,
  memoryProvider: resolvedMemory.provider,
  supportedMemoryProviderIds: options.supportedMemoryProviderIds ?? SUPPORTED_OPENCODE_LAUNCH_MEMORY_PROVIDER_IDS,
  capabilityInstructions, // ✅ ADD THIS
});
```

## Risks
- **Low risk**: The fix is additive and follows existing patterns in the codebase
- The capability instructions logic is already battle-tested in `runner-capabilities.ts`
- If config reading fails, the catch block returns `undefined`, which is safe (no instructions appended)

## Recommendation

Proceed with the fix. The pattern is well-established in `runner-capabilities.ts` and the tests in `prompt-generation.test.ts` already verify that capability instructions are correctly passed through when provided.

## Ready for Proposal

**Yes** - The investigation is complete. The bug is clearly identified and the fix is straightforward following existing patterns in the codebase.

## Open Questions

1. Should the Pi launch command (`pi-launch-command.ts`) also be checked for the same issue?
2. Is there a way to share this logic between CLI and TUI paths to prevent divergence?

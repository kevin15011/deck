# Exploration: How Deck Core Manages AGENTS.md

## Goal

Understand how Deck's core system injects/modifies content in AGENTS.md and other config files to determine where the adaptive memory protocol content should live.

## Key Findings

### Finding 1: Deck Does NOT Directly Manage `~/.config/opencode/AGENTS.md`

The `AGENTS.md` file at `~/.config/opencode/AGENTS.md` is **not managed by Deck core**. It contains a single `codebase-memory-mcp` block with `<!-- codebase-memory-mcp:start/end -->` markers that appear to be managed by an external process (likely OpenCode CLI or a separate installer).

**Evidence:**
- No code in `/home/kevinlb/deck` reads or writes to `~/.config/opencode/AGENTS.md`
- The file is at the OpenCode config level (`~/.config/opencode/`), not project level
- Deck's adapters write to `~/.config/opencode/opencode.json` (agent config) and `~/.config/opencode/prompts/` (prompt files)

### Finding 2: Deck's "Managed Blocks" are Package Instructions

Deck manages **Package Instructions** — not AGENTS.md blocks. These are defined in:
- `/home/kevinlb/deck/packages/core/src/teams/developer/instruction-bundles/`

**Current Package Instructions:**
| Package | File | Description |
|---------|------|-------------|
| `codebase-memory` | `codebase-memory.ts` | MCP graph tools for code discovery |
| `context-mode` | `context-mode.ts` | Context mode tools for large-output commands |
| `rtk` | `rtk.ts` | RTK CLI proxy for token optimization |

### Finding 3: Package Instruction Architecture

Each package instruction follows this pattern:

```typescript
// packages/core/src/teams/developer/instruction-bundles/{package}.ts
export function build{Package}InstructionBundle(): CapabilityInstructionBundle {
  const fragments: CapabilityInstructionFragment[] = [
    {
      packageId: "{package-id}",
      surface: "agent",  // or "skill", "session"
      markdown: `## {Package Name}
...
`,
    },
    // Can have multiple fragments for different surfaces
  ];
  return { instructions: Object.freeze(fragments) };
}
```

**Composition Flow:**
1. **Config** (`.deck/config.json`) → `packageInstructions.{runner}.{packageId}` boolean
2. **Bundle Builder** (`instruction-bundles/index.ts`) → Collects enabled packages
3. **Content Registry** (`content-registry.ts`) → Composes fragments into agent/skill content
4. **Adapter** (`adapter-opencode` or `adapter-pi`) → Writes to runner-specific files

### Finding 4: Where Package Instructions Appear

Package instructions are **NOT injected into AGENTS.md**. They appear in:

1. **Agent prompt files** (e.g., `~/.config/opencode/prompts/deck-developer/deck-developer-orchestrator.md`)
   - Under the section: `## Package Instructions (configured)`

2. **Skill files** (e.g., `{project}/.opencode/skills/deck-developer-orchestrator/SKILL.md`)
   - Under the section: `## Package Instructions (configured)`

### Finding 5: Config Schema for Package Instructions

**Config Location:** `.deck/config.json`

```json
{
  "packageInstructions": {
    "pi": {
      "codebase-memory": true,
      "context-mode": true,
      "rtk": true
    },
    "opencode": {
      "codebase-memory": true,
      "context-mode": true,
      "rtk": true
    }
  }
}
```

**Schema Definition:** `packages/core/src/config/deck-config.ts`
- `PACKAGE_INSTRUCTION_PACKAGE_IDS = ["codebase-memory", "context-mode", "rtk"]`
- `PACKAGE_INSTRUCTION_RUNNERS = ["pi", "opencode"]`

### Finding 6: The Correct Pattern for Adding a New Managed Injection

To add the adaptive memory protocol as a **Package Instruction**:

1. **Create new instruction bundle file:**
   ```
   packages/core/src/teams/developer/instruction-bundles/adaptive-memory-protocol.ts
   ```

2. **Export bundle builder:**
   ```typescript
   export function buildAdaptiveMemoryProtocolInstructionBundle(): CapabilityInstructionBundle
   ```

3. **Register in index.ts:**
   - Add `"adaptive-memory-protocol"` to `CapabilityInstructionPackageId` type
   - Add to `PACKAGE_BUILDERS` record
   - Add to `PACKAGE_ORDER` array

4. **Update deck-config.ts:**
   - Add `"adaptive-memory-protocol"` to `PACKAGE_INSTRUCTION_PACKAGE_IDS`
   - Add to default config (all runners, default `false`)

5. **Update CLI TUI state:**
   - Add to `CANONICAL_INSTRUCTION_PACKAGE_IDS` in `apps/cli/src/tui/pi-runner-dashboard/state.ts`

## Relevant Files

| File | Role |
|------|------|
| `packages/core/src/teams/developer/instruction-bundles/index.ts` | Bundle composition logic, PACKAGE_BUILDERS registry |
| `packages/core/src/teams/developer/instruction-bundles/codebase-memory.ts` | Example package instruction (reference pattern) |
| `packages/core/src/teams/developer/instruction-bundles/context-mode.ts` | Example package instruction (reference pattern) |
| `packages/core/src/teams/developer/content-registry.ts` | Content composition with capability instructions |
| `packages/core/src/config/deck-config.ts` | Config schema, PACKAGE_INSTRUCTION_PACKAGE_IDS |
| `packages/adapter-opencode/src/developer-team-install.ts` | OpenCode adapter that applies instructions |
| `apps/cli/src/tui/pi-runner-dashboard/state.ts` | CLI TUI package instruction toggles |

## Constraints

- Package instructions are **additive only** — they append to agent/skill content, never replace
- Package instructions are **config-driven** — enabled/disabled via `.deck/config.json`
- Package instructions are **surface-specific** — can target agent, skill, or session surfaces
- Package instructions are **runner-agnostic** — same bundle works for Pi and OpenCode

## Risks

| Risk | Mitigation |
|------|------------|
| Adding too many packages bloats prompts | Keep package content concise; use config toggles |
| Package content conflicts with skills | Follow existing authority rule pattern; memory is advisory |
| Config validation rejects new package | Must update PACKAGE_INSTRUCTION_PACKAGE_IDS const |

## Recommendation

For the adaptive memory protocol, **use the Package Instruction pattern**, not AGENTS.md injection:

1. Create `packages/core/src/teams/developer/instruction-bundles/adaptive-memory-protocol.ts`
2. Define behavioral rules (save triggers, search triggers, session summary) in the markdown
3. Include provider routing table in the content (since agents can't read config at runtime)
4. Register the package ID and config schema updates
5. Agents will receive the protocol via the standard package instruction injection flow

This approach is:
- **Consistent** with existing codebase-memory, context-mode, and rtk packages
- **Configurable** via `.deck/config.json` toggles
- **Runner-agnostic** — works for both Pi and OpenCode
- **Additive** — doesn't modify existing AGENTS.md managed blocks

## Open Questions

1. Should the adaptive memory protocol be a **Package Instruction** (injected into all agents) or a **session-level instruction** (injected only into orchestrator)?
   - Current Package Instructions pattern injects into both agent and skill surfaces
   - The protocol may only need to be in the orchestrator's session context

2. The design mentions AGENTS.md should contain the protocol — but Deck doesn't manage AGENTS.md
   - Is there a separate OpenCode plugin/installer that manages AGENTS.md?
   - Should Deck extend to manage AGENTS.md blocks?

## Ready for Proposal

**Yes** — The exploration reveals the Package Instruction pattern is the correct approach for Deck-managed content injection. The proposal should frame the adaptive memory protocol as a new Package Instruction rather than an AGENTS.md managed block.

---

**Artifact Path:** `openspec/changes/adaptive-memory-protocol/exploration.md`
**State Path:** `openspec/changes/adaptive-memory-protocol/state.yaml`
**Events Path:** `openspec/changes/adaptive-memory-protocol/events.yaml`

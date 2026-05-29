# Exploration 6: Post-Reinstall Failure Root Cause Analysis

**Date**: 2026-05-30
**Agent**: deck-developer-explorer
**Trigger**: User reported 3 verified failures after reinstall OpenCode

## Outcome

Of 3 reported failures, **1 is CONFIRMED** (container tags phrase), **1 is ALREADY FIXED** (Authorization), **1 requires reclassification** (tools present but session surface split causes behavioral gap).

## Failure Analysis

### Failure 1: Authorization as literal token — ALREADY FIXED / CLAIM INACCURATE

**User claim**: `~/.config/opencode/opencode.json` has `Bearer [REDACTED]` literal token instead of env interpolation.

**Evidence**:
- Installed `opencode.json` line 229: `"Authorization": "Bearer {env:SUPERMEMORY_API_KEY}"` — uses `{env:}` interpolation ✅
- Source `writeSupermemoryOpenCodeMcpConfig` at `opencode-mcp-config.ts:314`: `Authorization: \`Bearer {env:SUPERMEMORY_API_KEY}\`` — always writes interpolation ✅
- Git history confirms this function has NEVER written a literal token
- `SUPERMEMORY_API_KEY` env var IS set (confirmed in environment)
- Single write path: `runner-adapter.ts:594-598` → `writeSupermemoryOpenCodeMcpConfig`

**Verdict**: **NOT A FAILURE.** Installed config is correct. Source has always used env interpolation. Claim may be based on pre-reinstall state that was fixed by `1a005c7` (context-mode MCP migration) or by the R27 hotfix (sm_project_ underscore).

### Failure 2: Container tags phrase in 14 prompts — CONFIRMED

**User claim**: 14 prompts contain phrase `DO NOT use container tags like u:, p:, t:, o:`; contract says don't mention those tags.

**Root cause**:
- Source: `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts`
- Line 33 (surface: "agent"): `**DO NOT use container tags** like u:, p:, t:, o:. Save memories as plain content. Scoping is automatic.`
- Line 180 (surface: "session"): `DO NOT use container tags like u:, p:, t:, o:. Save memories as plain content.`
- Line 260 (surface: "skill"): `DO NOT use container tags like u:, p:, t:, o:. Save memories as plain content. Scoping is automatic.`
- All 14 deck-developer-* installed skills contain this phrase (confirmed)

**Why the test didn't catch it**:
- `adaptive-memory.test.ts:169` — test named "does NOT contain container tag instructions"
- Line 176-177: `const containsNoTagPhrase = md.toLowerCase().includes("do not use container tags"); expect(containsNoTagPhrase).toBe(true);`
- **The test ASSERTS the phrase IS present** despite the name saying "NOT contain"
- Negative checks at lines 181-188 only prevent TABLE format (`| \`u:\` |`), not inline enumeration
- **Misleading test name masks the contract violation**

**Propagation path**:
1. `buildAdaptiveMemoryInstructionBundle()` → 3 fragments with the phrase
2. `getAgentContent` → `applyAgentContentComposition` → `appendCapabilityInstructions` → composed into skillBody
3. `buildSkillFileContent` → writes to `~/.config/opencode/skills/*/SKILL.md`
4. All 14 deck-developer skills receive the "skill" surface fragment

**Repair**:
- File: `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts`
- Lines 33, 180, 260: Remove explicit tag enumeration
- Replace with: `"Memories are scoped automatically. Save content as-is without any prefix notation."` or similar
- Update test: `adaptive-memory.test.ts:169-189` — fix test name AND assertion to actually verify absence of enumerated tags

### Failure 3: Prompts don't define memory/recall tools — RECLASSIFIED

**User claim**: Prompts have Adaptive Memory but don't define `memory`/`recall` tools; orchestrator recall count = 0.

**Evidence**:
- ALL 14 installed deck-developer skills have:
  - `### Provider: Supermemory` ✅
  - `**memory** (action: "save")` ✅
  - `**recall** (query: "...")` ✅
- Skill surface fragment (lines 249-300) includes full tool definitions
- `appendCapabilityInstructions` composes with surface "skill" → tool defs present

**HOWEVER — critical architectural split found**:

`prompt-generation.ts:264`:
```typescript
const memorySurface = agent.id === "deck-developer-orchestrator" ? "session" : "agent";
```

- **Orchestrator PROMPT** (agentBody) uses surface `"session"` — NO tool definitions
- **Orchestrator SKILL** (SKILL.md) uses surface `"skill"` — HAS tool definitions
- Session surface fragment (lines 170-244) has "DO NOT container tags" but NOT "Provider: Supermemory" with tools

**Why "recall count = 0"**:
1. Orchestrator prompt tells it about Adaptive Memory but NOT which tools to call
2. Tool names in prompts (`memory`, `recall`) don't match actual MCP names (`supermemory_memory`, `supermemory_recall`)
3. Orchestrator relies on skill file for tool definitions, but skill loading is deferred
4. `VALIDATED_MEMORY_PROVIDERS` at line 186 lists `["memory", "recall", "whoAmI"]` — un-namespaced, matching prompt but not runtime tools

**Verdict**: Tools ARE defined in skill files but NOT in orchestrator's prompt. The session/agent surface split creates a gap where the orchestrator's main prompt lacks actionable tool instructions. This is a behavioral, not structural, failure.

## Root Cause Summary Table

| # | Failure | Source File | Function/Line | Root Cause | Status |
|---|---------|-------------|---------------|------------|--------|
| 1 | Authorization literal token | — | — | NOT A FAILURE. Installed config uses env interpolation correctly | ❌ Claim inaccurate |
| 2 | Container tags phrase | `adaptive-memory.ts` | Lines 33, 180, 260 | Bundle explicitly enumerates forbidden tags in all 3 surface fragments | ✅ CONFIRMED |
| 3 | No tool definitions | `prompt-generation.ts` | Line 264 | Orchestrator prompt uses "session" surface which lacks tool defs; tools only in "skill" surface | ⚠️ RECLASSIFIED |

## Minimal Repair Plan

### Failure 2 — Container tags phrase (priority: HIGH)
1. **Edit** `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts`
   - Line 33: Replace `**DO NOT use container tags** like u:, p:, t:, o:. Save memories as plain content. Scoping is automatic.`
     → `Memories are scoped automatically. Save content as-is — no prefix notation needed.`
   - Line 180: Replace `DO NOT use container tags like u:, p:, t:, o:. Save memories as plain content.`
     → `Memories are scoped automatically. Save content as-is without any prefix notation.`
   - Line 260: Same pattern as line 33
2. **Fix test** `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.test.ts`
   - Line 169: Rename test to `"ensures automatic scoping without enumerating tag prefixes"`
   - Lines 176-177: Assert the phrase does NOT enumerate `u:`, `p:`, `t:`, `o:`
   - Add: `expect(md).not.toMatch(/like u:.*p:.*t:.*o:/);`
3. **Reinstall** skills to propagate fix

### Failure 3 — Session surface gap (priority: MEDIUM)
1. **Edit** `packages/adapter-opencode/src/prompt-generation.ts`
   - Line 264: Consider changing orchestrator surface from `"session"` to `"agent"` to include tool definitions
   - OR: Add tool definitions to session surface fragment in `adaptive-memory.ts`
2. **Consider** updating tool names in prompts to match MCP namespaced names (`supermemory_memory` vs `memory`)

### Failure 1 — No action needed
Installed config is correct. No repair required.

## Tests to Add/Update

1. `adaptive-memory.test.ts:169` — Fix misleading test name + add assertion against tag enumeration
2. Add test: assert no surface fragment contains `like u:, p:, t:, o:` pattern
3. Add test: assert orchestrator prompt gets tool definitions (currently session surface lacks them)
4. Add test: verify tool names in prompts match actual MCP tool names (namespacing)

## Confidence

| Failure | Confidence | Basis |
|---------|-----------|-------|
| F1 Authorization | 95% | Source + installed file + git history all confirm env interpolation |
| F2 Container tags | 99% | Source lines verified, installed files verified, test gap confirmed |
| F3 Tools gap | 85% | Tools present in skill files, but session/agent surface split is real |

## Blockers

- None for Failure 2 repair
- Failure 3 repair requires design decision: change surface mapping OR add tools to session fragment
- Failure 1 requires user confirmation that claim was based on stale observation

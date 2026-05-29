# Exploration: TUI stuck at personality-selection after Supermemory token-only repairs

## Goal
Investigate why the TUI does not advance past "Choose orchestrator personality" screen after the Supermemory token-only repairs were applied.

## Outcome
**Root cause found.** Data migration gap. `SUPERMEMORY_FIELDS` was cleaned to token-only (3 fields only), but the existing `.deck/config.json` still contains `userId`, `teamId`, `orgId`. Every time the personality-selection handler calls `readDeckConfig()`, `assertKnownFields` throws `DECK_CONFIG_UNKNOWN_FIELD` for those stale fields. The `try/catch` in the handler swallows the error silently (no logging), returning early without calling `resetCursor`. Result: screen never changes.

## Evidence

### Debug log (`/tmp/deck-debug.txt`)
```
19:42:04.129 useInput: return/enter at screen=personality-selection key.return=true input="\r"
19:42:04.129 continueFromCurrent: calling...
19:42:04.130 continueFromCurrent: dispatched
19:42:04.132 continueFromCurrent: done
[repeated 8+ times — screen never changes]
```
No error lines appear because the catch block has no logging.

### Existing config (`.deck/config.json`)
```json
{
  "adaptiveMemory": {
    "activeProvider": "supermemory",
    "supermemory": {
      "mcpServerName": "supermemory",
      "searchMode": "memories",
      "maxMemoriesPerSession": 7,
      "userId": "kevin",      // ← UNKNOWN FIELD (removed from SUPERMEMORY_FIELDS)
      "teamId": "developer",  // ← UNKNOWN FIELD
      "orgId": "GCO"          // ← UNKNOWN FIELD
    }
  }
}
```

### Code path (exact)
1. `apps/cli/src/tui/app.tsx:1021` — `if (screen === "personality-selection")`
2. `app.tsx:1031` — `resolveProjectRoot({ require: true })` → returns `process.cwd()`
3. `app.tsx:1032` — `readDeckConfig(projectRoot)` → calls `validateDeckConfig()`
4. `deck-config.ts:234` → `validateDeckConfig()` → `normalizeAdaptiveMemoryConfig()`
5. `deck-config.ts:469-473` → `normalizeSupermemoryConfig(value.supermemory, ...)`
6. `deck-config.ts:495` — `assertKnownFields(value, SUPERMEMORY_FIELDS, "adaptiveMemory.supermemory", configPath)`
7. `deck-config.ts:805-813` — **THROWS** `DECK_CONFIG_UNKNOWN_FIELD` for `userId`, `teamId`, `orgId`
8. `app.tsx:1037` — `catch (error) { return; }` — silently swallows, stays on screen

### SUPERMEMORY_FIELDS (current, post-repair)
```typescript
// deck-config.ts:190-194
const SUPERMEMORY_FIELDS = new Set([
  "mcpServerName",
  "searchMode",
  "maxMemoriesPerSession",
]);
// userId, teamId, orgId were REMOVED by hotfix R5/R18/R19
```

### assertKnownFields (exact code)
```typescript
// deck-config.ts:799-814
function assertKnownFields(value, allowedFields, fieldPath, configPath): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new DeckConfigError(
        "DECK_CONFIG_UNKNOWN_FIELD",
        `Unknown Deck config field: ${fieldPath}.${key}`,
        { configPath, fieldPath: `${fieldPath}.${key}` },
      );
    }
  }
}
```

### Flow diagram
```
User presses Enter on personality-selection
  → continueFromCurrent() called
    → screen === "personality-selection" (line 1021)
    → personalities[cursor] = { id: "pragmatica", ... } (line 1026)
    → setSelectedPersonality(selected.id) (line 1028)
    → try:
      → resolveProjectRoot({ require: true }) → returns cwd (line 1031)
      → readDeckConfig(projectRoot) → validateDeckConfig() → normalizeSupermemoryConfig()
        → assertKnownFields(config.supermemory, SUPERMEMORY_FIELDS, ...)
        → THROWS: "Unknown field: adaptiveMemory.supermemory.userId" ❌
    → catch(error): return early (line 1039) — NO LOGGING
    → resetCursor(nextScreen) NEVER REACHED ❌
  → Screen stays "personality-selection"
```

## Root Cause (file/function/line)

| # | File | Function | Line | Issue |
|---|------|----------|------|-------|
| 1 | `packages/core/src/config/deck-config.ts` | `normalizeSupermemoryConfig()` | 495 | `assertKnownFields` rejects `userId/teamId/orgId` from stale config |
| 2 | `apps/cli/src/tui/app.tsx` | `continueFromCurrent()` | 1037-1039 | `catch(error) { return; }` swallows error silently, no debug log |
| 3 | `.deck/config.json` | N/A | N/A | Contains stale `userId/teamId/orgId` fields from pre-token-only era |

**Primary cause:** Data migration gap. The code was updated to reject these fields (correct per token-only contract), but no migration step was added to strip them from existing configs.

**Contributing cause:** Silent error swallowing in the personality-selection handler makes the bug invisible in debug logs.

## Relation to Supermemory Token-Only Changes

**Directly caused by.** The `redesign-supermemory-mcp-memory` change (specifically repair tasks R5, R18, R19) correctly removed `userId/teamId/orgId` from `SUPERMEMORY_FIELDS` and from the validation code. However, no migration was added to strip these fields from existing `.deck/config.json` files. When a user with an existing config runs the TUI, `readDeckConfig` fails because the config file contains fields that are now rejected.

This is a **regression** introduced by the token-only repair: before the repair, these fields were accepted and the config read succeeded.

## Minimal Fix

### Option A: Strip stale fields on read (recommended, 1 file)
In `normalizeSupermemoryConfig()`, strip unknown fields BEFORE calling `assertKnownFields`:

```typescript
// deck-config.ts:normalizeSupermemoryConfig(), before line 494
// Strip deprecated fields from existing configs (migration)
if (typeof value === "object" && value !== null) {
  const stripped = { ...value };
  delete (stripped as any).userId;
  delete (stripped as any).teamId;
  delete (stripped as any).orgId;
  delete (stripped as any).projectId;
  value = stripped;
}
```

### Option B: Use allowlist instead of reject (cleaner, same file)
Replace `assertKnownFields` call with selective field extraction, ignoring unknowns:

```typescript
// deck-config.ts:normalizeSupermemoryConfig(), line 494-495
// Replace: assertPlainObject + assertKnownFields
// With: extract only known fields
assertPlainObject(value, "adaptiveMemory.supermemory", configPath);
// No assertKnownFields — just extract what we need
```

### Option C: Add debug logging to catch block (defensive, 1 line)
```typescript
// app.tsx:1037-1039
} catch (error) {
  debug(`personality-selection: config error: ${error instanceof Error ? error.message : String(error)}`);
  return;
}
```

**Recommendation:** Option A (strip on read) + Option C (add debug logging). This handles the migration AND makes future similar issues debuggable.

## Tests to Update/Add

### Update
- `packages/core/src/config/deck-config.test.ts` — Add test: "readDeckConfig strips deprecated userId/teamId/orgId from existing config"
- `packages/core/src/config/deck-config.test.ts` — Add test: "writeDeckConfig after reading stale config produces clean output"

### Add
- `packages/core/src/config/deck-config.test.ts` — Test: "config with supermemory userId/teamId/orgId reads successfully (migration)"
- `apps/cli/src/tui/developer-team-flow.test.tsx` — Test: "personality-selection advances when stale config exists"

## Confidence

**95%** — The evidence chain is complete: debug logs show Enter pressed + dispatched + done but no screen change. Code analysis shows the exact throw path. Config file confirms stale fields. The only uncertainty is whether there might be ADDITIONAL failure points after this one is fixed.

## Blockers

- **None for the fix itself.** The fix is straightforward.
- **Process note:** The `fix-supermemory-userid-validation` change also exists in OpenSpec as a separate change. It should be checked for overlap — this exploration may supersede or complement it.

# Exploration: Post-Reinstall MCP Config Auth & Project Format

## Goal
Determine why `x-sm-project` was written as `sm-project-kevin15011-deck` instead of `sm_project_kevin15011-deck`, and whether Authorization was ever written as a literal token instead of env interpolation.

## Current State

### Installed config (actual `~/.config/opencode/opencode.json`)
```json
{
  "type": "remote",
  "url": "https://mcp.supermemory.ai/mcp",
  "oauth": false,
  "headers": {
    "Authorization": "Bearer {env:SUPERMEMORY_API_KEY}",
    "x-sm-project": "sm-project-kevin15011-deck"
  },
  "enabled": true
}
```

- **Authorization**: Correct format with env interpolation.
- **x-sm-project**: WRONG — `sm-project-kevin15011-deck` instead of `sm_project_kevin15011-deck`.

## Root Cause

### Issue #1: x-sm-project underscore stripped — CONFIRMED BUG

**File**: `packages/adapter-opencode/src/opencode-mcp-config.ts`
**Function**: `deriveSmProjectIdentifier` (line 209-245)
**Buggy line**: 231

```typescript
const projectId = `sm_project_${parts[0]}-${parts[1]}`
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, "-");
  //                    ^ BUG: underscore NOT in allowed chars
```

**Mechanism**:
1. Template literal produces `sm_project_kevin15011-deck`
2. Regex `/[^a-z0-9-]/g` matches underscore `_` (not in `[a-z0-9-]`)
3. Replaces `_` with `-`, producing `sm-project-kevin15011-deck`

**Proof** (simulated):
```
Template:   sm_project_kevin15011-deck
After regex: sm-project-kevin15011-deck
```

**Why the fallback path (line 241) works correctly**:
```typescript
const dirName = workDir.split(/[/\\]/).pop()
  ?.toLowerCase().replace(/[^a-z0-9_]/g, "-") || "unknown";
//                                         ^ underscore IS allowed
return { projectId: `sm_project_${dirName}`, ... };
// Prefix added AFTER regex, so preserved
```

The git remote path applies the regex to the ENTIRE string including prefix → underscore stripped.
The directory fallback applies regex to dirName only, then prepends `sm_project_` → underscore preserved.

### Issue #2: Authorization as literal token — NOT REPRODUCIBLE

**Finding**: The code has ALWAYS written `Bearer {env:SUPERMEMORY_API_KEY}` (env interpolation). Git history confirms no change to this behavior.

```typescript
// opencode-mcp-config.ts:314 — always env interpolation
Authorization: `Bearer {env:SUPERMEMORY_API_KEY}`,
```

The actual installed config confirms correct format. The token value IS written to `.bashrc`/`.zshrc` via `appendSupermemoryEnvToShellConfig` — this is by design so the env var is available at runtime.

**Likely explanation**: User may have confused:
- The `.bashrc` export (`export SUPERMEMORY_API_KEY="<actual-token>"`) with the MCP config
- Or was describing a previous state before the current code was deployed

## Single Write Path — No Dual-Path Issue

Only ONE code path writes the supermemory MCP entry for OpenCode:

1. `action-runner.ts:565` → `writer({ token, serverName: "supermemory" })`
2. → `runner-adapter.ts:594` → detects supermemory, calls `writeSupermemoryOpenCodeMcpConfig`
3. → `opencode-mcp-config.ts:256` → writes to `~/.config/opencode/opencode.json`

The `config-merge.ts` (used by `developer-team-install.ts`) only touches `agent` and `plugin` sections, NOT `mcp`. So the team bundle install does NOT overwrite MCP config.

The generic `writeOpenCodeMcpConfig` (line 401) is NOT used for supermemory — the capability-based path (line 470-472) returns a no-op for supermemory.

## Relevant Files
- `packages/adapter-opencode/src/opencode-mcp-config.ts` — **BUG HERE** (line 231 regex)
- `packages/adapter-opencode/src/opencode-mcp-config.test.ts` — test gap (no assertion on `sm_project_` prefix)
- `packages/adapter-opencode/src/runner-adapter.ts` — caller, correct dispatch
- `apps/cli/src/tui/runner-dashboard/action-runner.ts` — TUI caller, correct dispatch
- `packages/adapter-opencode/src/config-merge.ts` — NOT involved (only agent/plugin)

## Constraints
- Cannot modify `~/.config/opencode` directly — fix must be in source/installer
- REQ-R26 contract mandates `sm_project_` prefix (not legacy `p:`)

## Risks
- Regex fix must preserve both underscore (for prefix) AND hyphen (for org-repo separator)
- Test coverage gap means existing tests pass despite the bug

## Options and Tradeoffs

### Option A: Fix regex to allow underscores
```typescript
.replace(/[^a-z0-9_-]/g, "-");
```
- Pros: Minimal change, preserves all existing behavior, just adds `_` to allowed chars
- Cons: None significant
- Effort: Low

### Option B: Separate prefix from sanitized part
```typescript
const orgRepo = `${parts[0]}-${parts[1]}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
const projectId = `sm_project_${orgRepo}`;
```
- Pros: More explicit, prefix never goes through regex
- Cons: Slightly more code change
- Effort: Low

**Recommendation**: Option A — single character fix, lowest risk.

## Tests to Update

1. **`opencode-mcp-config.test.ts:20-40`** ("always includes x-sm-project header"):
   - Add assertion: `expect(config.mcp.supermemory.headers["x-sm-project"]).toMatch(/^sm_project_/);`
   - This catches the underscore-stripping bug

2. **`opencode-mcp-config.test.ts`** — add test specifically for git remote derivation:
   - Mock `execSync` to return a git remote URL
   - Assert the output has `sm_project_` prefix (not `sm-project-`)

## Recommendation
Fix the regex on line 231 of `opencode-mcp-config.ts` from `/[^a-z0-9-]/g` to `/[^a-z0-9_-]/g`. Add a test assertion for `sm_project_` prefix. Re-run installation to correct the installed config.

## Open Questions
- None. Root cause is clear.

## Confidence
- **x-sm-project**: 100% — root cause confirmed with code reading, simulation, and installed config evidence
- **Authorization**: 95% — code analysis shows no path that writes literal token; installed config confirms env interpolation; user's claim likely refers to .bashrc export or transient previous state

## Registry Blockers
- None

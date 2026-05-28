# Binary Compatibility Audit — Exploration

**Change**: binary-compatibility-audit
**Phase**: explore
**Status**: completed
**Author**: deck-developer-explorer
**Created**: 2026-05-25

---

## Executive Summary

Deck CLI can be compiled to standalone binaries for Linux and macOS with approximately 2-3 days of focused work. Three critical blockers exist (Bun.spawn, workspace:* imports, process.cwd project root detection) that require targeted fixes, but none represent fundamental architectural problems. The gentle-ai project provides a proven distribution model (Homebrew for macOS, GitHub Releases for Linux, self-upgrade) that Deck can replicate with Bun compile as the build tool.

---

## Critical Blockers

### 1. Bun.spawn() — `apps/cli/src/main.tsx:60`

**Issue**: The Pi launch flow uses `Bun.spawn()` for process creation. This is a Bun-specific API that may not work in compiled binary mode.

```typescript
// main.tsx:60-66
const child = Bun.spawn([plan.command, ...plan.args], {
  cwd: plan.cwd,
  env: plan.env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
```

**Fix Required**: Replace with `child_process.spawn` from Node.js, which is available in Bun's compiled output and compatible with binary distribution.

**Effort**: Low (1-2 hours)

### 2. workspace:* Imports — `apps/cli/package.json`

**Issue**: The CLI package declares dependencies via workspace:* references:

```json
"dependencies": {
  "@deck/adapter-engram": "workspace:*",
  "@deck/adapter-opencode": "workspace:*",
  "@deck/adapter-pi": "workspace:*",
  "@deck/adapter-supermemory": "workspace:*",
  "@deck/core": "workspace:*"
}
```

These are resolved by Bun's package manager at runtime. In a compiled binary, these must be bundled at build time.

**Fix Required**: Use `bun build --target=bun-linux-x64 --outfile=deck apps/cli/src/main.tsx` which inlines all workspace dependencies. The `--compile` flag produces a standalone executable.

**Effort**: Medium (1 day to validate bundling works correctly)

### 3. process.cwd() Project Root Detection — `apps/cli/src/project-root.ts`

**Issue**: Project root detection walks up from `process.cwd()` looking for workspace markers (package.json with workspaces field). This assumes the deck monorepo is present on the machine.

```typescript
// project-root.ts:14-37
export function resolveProjectRoot(startDir: string = process.cwd()): string {
  let current = startDir;
  while (true) {
    if (isDeckProjectRoot(current)) return current;
    // ... walk up
  }
}
```

**Fix Required**: This is actually NOT a blocker for the binary use case. The binary's purpose is global configuration at `~/.config/.deck/`, not per-project detection. However, for features that need project context, a separate detection mechanism should be introduced that doesn't assume deck repo is present.

**Resolution (per team decision)**: Deck is a global installer. Config lives at `~/.config/.deck/`. Project root detection is not required for core flows. The `resolveProjectRoot` function will be refactored to focus on config path resolution rather than workspace detection.

**Effort**: Low (refactor, not a blocker)

---

## High Risk Issues

### 4. Skills File Loading — `packages/core/skills/external.ts`

**Issue**: `getStandaloneSkills()` reads skill content from the monorepo structure. The binary must bundle these.

**Affected Files**:
- `packages/core/src/skills/external.ts`
- `packages/core/src/skills/index.ts`
- All skill files in `.opencode/skills/deck-developer-*/SKILL.md`

**Resolution**: Skills will be embedded in the binary at build time. A new module `packages/core/src/skills/bundled.ts` will expose a `getBundledSkill(skillId: string): string | undefined` API that returns pre-bundled skill content.

**Effort**: Medium

### 5. Runtime Detection via PATH

**Issue**: `runtime-detection.ts` uses PATH to locate Pi, OpenCode, Claude, Codex. This is generally safe but the binary's location may affect PATH resolution in edge cases.

**Affected File**: `apps/cli/src/runtime-detection.ts`

**Resolution**: This pattern is platform-standard and should work in binary mode. No changes required.

**Effort**: None

---

## Medium Risk Issues

### 6. TTY Detection — `main.tsx:70`

```typescript
} else if (process.stdin.isTTY) {
  render(<DeckApp />, { ... });
}
```

**Issue**: Behavior may differ in compiled binary mode depending on how the binary is invoked (script wrapper vs direct exec).

**Resolution**: Test during build validation. Should work with Ink's standard detection.

**Effort**: None (testing only)

### 7. Ink Rendering Compatibility

**Issue**: Ink's `render()` and `renderToString()` use React internally. Bun compile should handle this correctly, but validation is required.

**Resolution**: Smoke test the TUI on target platforms before release.

**Effort**: Testing only

### 8. Config Path Resolution — Throughout

**Issue**: Many files reference `~/.config/opencode/` directly. For the binary, config will live at `~/.config/.deck/`. The `deck-config.ts` module needs to resolve both.

**Affected File**: `packages/core/src/config/deck-config.ts`

**Resolution**: Support dual paths: runner config at `~/.config/opencode/` (existing) and deck config at `~/.config/.deck/` (new). `deck doctor` will report both.

**Effort**: Medium

---

## Low Risk Issues

### 9. Supermemory Adapter fetch() Usage

The Supermemory adapter uses the global `fetch` API which is available in Bun and binary mode.

**Status**: No changes required

### 10. Engram Adapter

Uses the Engram MCP client, standard Node.js APIs. Should work in binary mode.

**Status**: No changes required

---

## Gentle-AI Reference Findings

The gentle-ai project at `/home/kevinlb/gentle-ai` uses Go for binary distribution with proven patterns:

### Distribution Model
- **macOS**: Homebrew tap (`brew install gentleman-programming/tap/deck`)
- **Linux**: Binary download from GitHub Releases + install.sh
- **Windows**: (not in scope for Deck)

### Self-Upgrade Flow
```go
// From gentle-ai/internal/update/
// 1. Check latest release via GitHub API
// 2. Download appropriate binary for platform/arch
// 3. Verify checksum
// 4. Atomic replace with backup
// 5. Restore on failure
```

### Version Injection
Build-time version via ldflags:
```bash
go build -ldflags="-s -w -X main.version=$VERSION -X main.commit=$COMMIT"
```

For Bun, equivalent approach using environment variables at build time.

### Release Artifacts
```
deck_v1.0.0_linux_x64.tar.gz
deck_v1.0.0_linux_arm64.tar.gz
deck_v1.0.0_macos_x64.tar.gz
deck_v1.0.0_macos_arm64.tar.gz
checksums.txt
```

---

## Recommended Build Approach

### Build Command
```bash
bun build --compile \
  --target=bun-linux-x64 \
  --outfile=dist/deck-linux-x64 \
  apps/cli/src/main.tsx

bun build --compile \
  --target=bun-linux-arm64 \
  --outfile=dist/deck-linux-arm64 \
  apps/cli/src/main.tsx

bun build --compile \
  --target=bun-macos-x64 \
  --outfile=dist/deck-macos-x64 \
  apps/cli/src/main.tsx

bun build --compile \
  --target=bun-macos-arm64 \
  --outfile=dist/deck-macos-arm64 \
  apps/cli/src/main.tsx
```

### Skills Bundling
Skills will be embedded at build time using a build script that:
1. Reads all `.opencode/skills/deck-developer-*/SKILL.md`
2. Generates `packages/core/src/skills/bundled-content.ts` with string exports
3. The bundle is included in the compiled binary

### macOS Ad-Hoc Signing
```bash
codesign -s - dist/deck-macos-*
```

### Homebrew Formula (conceptual)
```ruby
# Formula at https://github.com/gentleman-programming/homebrew-tap
class Deck < Formula
  desc "AI Runner Installer & Configuration Tool"
  homepage "https://github.com/gentleman-programming/deck"
  url "https://github.com/gentleman-programming/deck/releases/download/vVERSION/deck_VERSION_macos_arm64.tar.gz"
  sha256 "CHECKSUM_FROM_CHECKSUMS.TXT"
  version "VERSION"
  arm64 u: :apple_silicon, os: :macos
  x86_64 u: :intel, os: :macos

  def install
    bin.install "deck"
  end
end
```

---

## File-by-File Analysis

| File | Status | Notes |
|------|--------|-------|
| `apps/cli/src/main.tsx` | **BLOCKER** | Bun.spawn needs replacement |
| `apps/cli/src/project-root.ts` | **REFACTOR** | Global config path focus, not workspace detection |
| `apps/cli/src/runtime-detection.ts` | OK | PATH-based detection works |
| `apps/cli/src/pi-launch-command.ts` | **BLOCKER** | Uses Bun.spawn |
| `apps/cli/src/opencode-launch-command.ts` | **REFACTOR** | Hardcoded paths need abstraction |
| `apps/cli/src/doctor-command/doctor-diagnostics.ts` | OK | Uses homedir() safely |
| `apps/cli/src/tui/app.tsx` | OK | Ink rendering, needs smoke test |
| `packages/core/src/config/deck-config.ts` | **REFACTOR** | Dual config path support |
| `packages/core/src/skills/external.ts` | **REFACTOR** | Bundled skills support |
| `packages/adapter-*/src/index.ts` | OK | Standard imports |

---

## Open Questions (at time of audit)

1. **Build tool**: Bun `--compile` chosen, requires validation
2. **Skills strategy**: Embedded in binary, requires build script
3. **macOS signing**: Ad-hoc, requires codesign step
4. **Version channel**: Stable only
5. **Upgrade UX**: Interactive with `--yes` flag
6. **Project root behavior**: Global config at `~/.config/.deck/`, TUI works from any directory

All six resolved in subsequent team discussion.

---

## Next Steps

1. Propose: Create formal proposal document ✅ (done)
2. Spec: Define requirements and acceptance criteria
3. Design: Define architecture, file impact, build pipeline
4. Tasks: Break down implementation
5. Apply: Implement changes
6. Verify: Test, typecheck, review
7. Archive: Close change, preserve traceability

---

## Registry

- **Artifact Path**: `openspec/changes/binary-compatibility-audit/exploration.md`
- **State Path**: `openspec/changes/binary-compatibility-audit/state.yaml`
- **Events Path**: `openspec/changes/binary-compatibility-audit/events.yaml`
- **Recorded**: phase `explore`, status `completed`, event `binary_compatibility_audit_completed`
- **Registry Blocker**: none
# Archive Summary: binary-compilation

**Change**: binary-compilation
**Archived**: 2026-05-25
**Commit**: bb37387

---

## Summary

Successfully implemented standalone binary compilation for Deck CLI, enabling distribution as native binaries for Linux and macOS (x64 and arm64) without requiring Bun runtime or monorepo dependency at execution time.

---

## What Was Built

### Binary Build System
- `scripts/build-binaries.ts` — builds all 4 targets (linux-x64/arm64, darwin-x64/arm64)
- `scripts/generate-build-info.ts` — injects version/commit/date at build time
- `scripts/generate-skill-bundle.ts` — embeds skills into binary

### Runtime Abstractions
- `apps/cli/src/runtime/process.ts` — child_process wrappers (replaces Bun.spawn)
- `apps/cli/src/runtime/paths.ts` — global config resolution at ~/.config/.deck/
- `apps/cli/src/runtime/build-info.ts` — build metadata access

### Self-Upgrade System
- `apps/cli/src/upgrade-command/index.ts` — upgrade orchestrator
- `apps/cli/src/upgrade-command/github-release.ts` — GitHub Releases API integration
- `apps/cli/src/upgrade-command/install.ts` — download, verify, extract, atomic replace

### TUI Enhancements
- Doctor diagnostics for binary mode (version, config paths, skill count)
- Pi-launch works from binary (child_process spawn, not Bun.spawn)

### Distribution
- `.github/workflows/release.yml` — CI for multi-platform builds
- `Formula/deck.rb` — Homebrew formula for macOS

---

## Commands Added

| Command | Description |
|---------|-------------|
| `bun run build` | Build all 4 platform binaries |
| `bun run build:dry-run` | Build only current platform |
| `bun run deck:run` | Build + run TUI |
| `./dist/cli/deck --version` | Print binary version info |
| `./dist/cli/deck doctor` | Run doctor diagnostics |
| `./dist/cli/deck upgrade` | Self-upgrade from GitHub Releases |

---

## Verification

- **Tests**: 1650 pass (37 pre-existing failures unrelated to this change)
- **Binary build**: Success for all 4 targets
- **TUI**: Launches correctly from binary
- **Doctor**: Reports binary diagnostics correctly
- **Development workflow**: `bun run deck` still works

---

## Decisions Made

1. **Build tool**: Bun `--compile`
2. **Skills strategy**: Embedded in binary at build time
3. **macOS signing**: Ad-hoc (`codesign -s -`)
4. **Version channel**: Stable only
5. **Upgrade UX**: Interactive with `--yes` flag
6. **Config location**: Global at `~/.config/.deck/`

---

## Follow-up Items

1. **Asset naming alignment**: CI release naming should match `deck_v{VERSION}_{OS}-{ARCH}.tar.gz`
2. **Codebase Memory MCP**: Not configured in OpenCode MCP - can be added manually if needed

---

## Files Changed

**42 files changed, 3645 insertions(+), 110 deletions(-)**

Key new directories:
- `apps/cli/src/runtime/` — runtime abstractions
- `apps/cli/src/upgrade-command/` — self-upgrade system
- `scripts/` — build scripts
- `.github/workflows/` — CI workflow
- `Formula/` — Homebrew formula

---

## Registry

| Artifact | Path |
|----------|------|
| Proposal | `openspec/changes/binary-compilation/proposal.md` |
| Spec | `openspec/changes/binary-compilation/spec.md` |
| Design | `openspec/changes/binary-compilation/design.md` |
| Tasks | `openspec/changes/binary-compilation/tasks.md` |
| Apply Progress | `openspec/changes/binary-compilation/apply-progress.md` |
| State | `openspec/changes/binary-compilation/state.yaml` |
| Events | `openspec/changes/binary-compilation/events.yaml` |
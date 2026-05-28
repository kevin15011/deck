# Proposal: Complete OpenCode Adapter for Developer Team

## Intent

The OpenCode adapter (`packages/adapter-opencode`) currently generates markdown agent files in `.opencode/agents/`, which is the wrong format for OpenCode. OpenCode uses `~/.config/opencode/opencode.json` for agent definitions, `~/.config/opencode/prompts/` for prompt files, and `~/.config/opencode/commands/` for slash commands. This change makes `deck opencode developer` work as seamlessly as `deck pi developer` — same core content, same team-scoped IDs, same philosophy, only the runtime adapter changes.

## Scope

### In Scope
- Adapter rewrite: config generation, prompts, commands, skills with correct OpenCode formats
- Model assignments per agent with `reasoningEffort` levels (like Pi adapter)
- Safe config merge into user's `~/.config/opencode/opencode.json` (backup + atomic write + JSON validation)
- CLI integration: `deck opencode <team>` parsing and launch command
- Tests for all new code
- Adaptive memory integration (same as Pi, Engram-only for OpenCode)

### Out of Scope
- Console UI (`apps/console`) changes
- Other adapters (Claude, Codex)
- Other teams/environments
- TUI dashboard for OpenCode

## Capabilities

### New Capabilities
- `opencode-config-merge`: Safe read-merge-write of `~/.config/opencode/opencode.json` with backup and validation
- `opencode-model-config`: Model assignments and `reasoningEffort` per agent role
- `opencode-launch-command`: CLI launch integration for `deck opencode developer`
- `opencode-prompt-generation`: Thin prompt wrappers referencing core content and skills
- `opencode-command-generation`: Slash commands (`/sdd-apply`, `/sdd-explore`, etc.) routing to orchestrator
- `opencode-internal-plugin-mermaid`: Silent installation of `opencode-mermaid-renderer` plugin (parallel to Pi's `pi-mermaid`)

### Modified Capabilities
- None (existing specs remain unchanged; this is adapter-layer work only)

## Approach

1. **Rewrite `packages/adapter-opencode/src/developer-team-install.ts`** to generate OpenCode-native artifacts instead of markdown agent files:
   - Agent entries for `opencode.json` with `mode: "primary"` (orchestrator) / `"subagent"` (11 others), `model`, `reasoningEffort`, `prompt.file`, `tools`, `permission.task`, and `hidden: true`
   - Prompt files in `~/.config/opencode/prompts/deck-developer/` that reference core content
   - Command files in `~/.config/opencode/commands/`
   - Skills in `.opencode/skills/{skillId}/SKILL.md` with correct OpenCode frontmatter

2. **Add `model-config.ts`** to the OpenCode adapter (parallel to Pi's) defining default models per agent role and `reasoningEffort` support.

3. **Add config merge module** in the adapter: read existing `opencode.json`, validate, inject `deck-developer-*` entries under namespace prefix, create backup, write atomically, verify valid JSON.

4. **Add CLI integration** in `apps/cli/`:
   - `opencode-launch-command.ts` — builds OpenCode launch with correct agent
   - Update `cli-args.ts` — add `deck opencode <team>` parsing
   - Update `main.tsx` — add `opencode-launch` branch

5. **Add silent mermaid plugin installation** (parallel to Pi's `internal-runner-packages.ts`):
   - `internal-opencode-packages.ts` in the adapter — catalog with `opencode-mermaid-renderer` as the only entry
   - Detects if plugin is in `opencode.json`'s `plugin` array
   - Missing → silently adds `"opencode-mermaid-renderer"` to plugin array during config merge
   - Not user-facing, not in dashboard, not selectable — pure silent install
   - Uses `beautiful-mermaid` under the hood (same as the plugin) to render mermaid → ASCII in terminal
   - Does not block Developer Team install if plugin install fails

6. **Preserve core sharing** — no duplication of instructions; all content comes from `@deck/core` via `getAgentContent()` and `composeAdaptiveMemory()`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/adapter-opencode/src/` | Rewritten | Generate correct OpenCode artifacts (config, prompts, commands, skills) |
| `packages/adapter-opencode/src/internal-opencode-packages.ts` | New | Silent mermaid plugin catalog + detection (parallel to Pi's `internal-runner-packages.ts`) |
| `packages/adapter-opencode/src/model-config.ts` | New | Model assignments and reasoningEffort per agent |
| `packages/adapter-opencode/src/config-merge.ts` | New | Safe merge into `~/.config/opencode/opencode.json` |
| `apps/cli/src/opencode-launch-command.ts` | New | Launch command for OpenCode runner |
| `apps/cli/src/cli-args.ts` | Modified | Add `opencode` subcommand parsing |
| `apps/cli/src/main.tsx` | Modified | Route `opencode-launch` branch |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Config corruption of user's `opencode.json` | Med | Backup before write, atomic write, JSON validation after write |
| Absolute paths in `{file:...}` references | High | Generate at install time; paths are machine-specific by design |
| Permission conflicts with existing agents | Low | Use `deck-developer-*` prefix to avoid collisions |
| OpenCode schema changes breaking config | Low | Pin to known schema version; validate before write |
| Mermaid plugin install fails | Low | Non-blocking — graceful degradation, agents still emit mermaid code blocks |

## Rollback Plan

1. The adapter creates a timestamped backup of `~/.config/opencode/opencode.json` before every merge.
2. On failure, restore the backup file.
3. New files (prompts, commands, skills) can be removed by ID prefix: delete all entries matching `deck-developer-*`, remove `~/.config/opencode/prompts/deck-developer/`, remove `~/.config/opencode/commands/deck-*`, and remove `.opencode/skills/`.

## Dependencies

- `@deck/core` teams/content-registry and adaptive-memory (already exists)
- OpenCode CLI installed and accessible in PATH

## Success Criteria

- [ ] `deck opencode developer` parses correctly and launches OpenCode with the orchestrator agent
- [ ] `opencode.json` contains 12 `deck-developer-*` agent entries with correct mode, model, and permissions
- [ ] Prompt files exist in `~/.config/opencode/prompts/deck-developer/`
- [ ] Command files exist in `~/.config/opencode/commands/`
- [ ] Skills exist in `.opencode/skills/` with valid OpenCode frontmatter
- [ ] Config merge is safe: backup created, atomic write, valid JSON verified
- [ ] All new code has unit tests passing with `bun test`
- [ ] Adaptive memory injects correctly when `--memory=engram` is passed
- [ ] `opencode-mermaid-renderer` plugin silently installed in `opencode.json` plugin array
- [ ] Mermaid plugin detection works: "ready" when present, "missing" when absent, silent install on missing

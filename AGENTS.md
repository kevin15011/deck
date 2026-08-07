# Deck Agent Guide

> **Audience:** AI agents working in this repository.
> **Authority:** explanatory navigation and safety map; OpenSpec and source remain authoritative.
> **Maintainer:** Deck maintainers.
> **Evidence:** [contributor guidance](CONTRIBUTING.md), [OpenSpec configuration](openspec/config.yaml), [registry schema](openspec/registry-schema.md), and [Git safety source](packages/core/src/teams/developer/git-safety.ts).

## Authority order

Use active/promoted OpenSpec artifacts and registry records for requirements and lifecycle. Use source, tests, package metadata, workflows, scripts, schemas, and generated outputs for runtime and volatile facts. Treat this file as navigation, not a competing procedure.

## Safe editing

Never hand-edit generated outputs such as `packages/core/src/skills/external/content.generated.ts` or `apps/cli/src/runtime/build-info.generated.ts`. Preserve historical `openspec/changes/**` and `openspec/archive/**` content unless the normal OpenSpec lifecycle explicitly authorizes it.

Git-discard operations require the canonical protection workflow in [git-safety.ts](packages/core/src/teams/developer/git-safety.ts): explain the irreversible effect and require a new message containing the exact command before execution.

## Navigate

Read [CONTRIBUTING.md](CONTRIBUTING.md) for commands and contribution procedure, [architecture](docs/architecture.md) for stable boundaries, and [OpenSpec configuration](openspec/config.yaml) for SDD context. Symbol and graph tools are optional navigation aids; repository sources and OpenSpec artifacts are the authority.
<!-- deck:developer-team:start -->
## Deck Developer Team (static-compatible)
Use the Deck-provided native roles and skills for collaboration.
Protected invocation authorization, controlled effects, centralized registry writes, and bound verification are not host-enforced on this launch route.

## Package Instructions (configured)

These instructions are enabled by the runner's native package instruction system.

Adaptive memory is provided by the runner's configured memory system. The active provider injects its tool instructions into agent prompts.

### Automatic Scoping

Memories are scoped automatically:
- **User**: Derived from your Supermemory token — no userId input needed.
- **Project**: Derived from x-sm-project header in MCP config — no manual scoping needed.

Save memories as plain content. Scoping is automatic.

When coordinating work, be aware that sub-agents may save and search memories as part of their workflow. Agents should proactively save after significant decisions, bug fixes, discoveries, or pattern establishment.

Before ending a session, ensure a session summary is saved covering: goal, instructions discovered, technical findings, accomplished items, next steps, and relevant files.

**OPENSPEC IS OFFICIAL CONTEXT — ADAPTIVE MEMORY IS ADVISORY.**

If adaptive memory contradicts an OpenSpec artifact, the OpenSpec artifact wins. Always.

If memory operations fail or tools are unavailable, agents continue working normally — memory is never blocking.

### Provider: Supermemory

When the configured memory provider is "supermemory", use these MCP tools:

- `memory` (action: "save", content: "...") — commit a memory
- `memory` (action: "forget", content: "...") — remove a memory
- `recall` (query: "...", includeProfile?: boolean) — retrieve relevant memories

The Supermemory MCP server exposes these tools natively. Do not call raw MCP tools directly — use the tool names shown above.

Scoping is automatic: user from token, project from x-sm-project header. No manual containerTag required.

### Decision Examples

1. **Architecture decision made**
   - *Trigger*: Team chooses Zustand over Redux for state management
   - *Suggested topic key*: architecture/state-management
   - *Example content*: **What**: Chose Zustand over Redux. **Why**: Redux boilerplate too heavy for our use case. **Where**: src/store/.

2. **User preference correction**
   - *Trigger*: User corrects naming style assumption
   - *Suggested topic key*: preference/kevin
   - *Example content*: **What**: User prefers kebab-case CSS classes. **Where**: src/components/.

3. **Non-obvious discovery**
   - *Trigger*: Subtle memory leak found in useEffect cleanup
   - *Suggested topic key*: discovery/react-hooks-cleanup
   - *Example content*: **What**: useEffect without cleanup retains stale closures. **Where**: src/hooks/useAudioPlayer.ts.

4. **Bug fix with root cause**
   - *Trigger*: Fixed N+1 query in UserList
   - *Suggested topic key*: bugfix/n-plus-one-user-list
   - *Example content*: **What**: Fixed by eager-loading organization. **Where**: src/models/User.ts.

5. **Session-close summary**
   - *Trigger*: Ending session after implementation work
   - *Suggested topic key*: session/2026-05-23-deck-refactor
   - *Example content*: **Goal**: Refactor skills for parallel execution. **Accomplished**: Tasks 1-2.

### Suggested Topic Keys

| Work Type | Topic Key Pattern | Example |
|---|---|---|
| Architecture | architecture/<component-name> | architecture/auth-model |
| Bugfix | bugfix/<issue-description> | bugfix/null-pointer-list |
| Performance | performance/<area> | performance/user-list-query |
| Config | config/<what-changed> | config/database-url |
| Preference | preference/<user-name> | preference/kevin |
| Pattern | pattern/<pattern-name> | pattern/naming-convention |
| Discovery | discovery/<what-found> | discovery/react-hooks-cleanup |
| Session | session/<date>- <context> | session/2026-05-23-deck-refactor |
| Team | team/<topic> | team/onboarding-docs |
| Security | security/<concern> | security/api-key-storage |

### Save Trigger Matrix

| Lifecycle Moment | Save Action | Topic Key | Content Focus |
|---|---|---|---|
| Architecture decision made | Save immediately | architecture/<component> | What was decided, why |
| Bug fix completed | Save immediately | bugfix/<issue> | What was fixed, root cause |
| User preference learned | Save immediately | preference/<user> | What the preference is |
| Session close | Save before ending | session/<date>- <context> | Goal, discoveries, next steps |
| Non-obvious discovery | Save immediately | discovery/<what-found> | What was found, context |
| Configuration change | Save immediately | config/<what-changed> | What changed, why |
| Pattern established | Save immediately | pattern/<pattern-name> | What pattern, where |

### Provider: Engram

When the configured memory provider is "engram", use Engram's documented tool interface. The Engram adapter injects its specific instructions; follow those instead of these generic ones.

## Serena Delegation Guidance

### Apply Delegation (editing/refactoring)

When delegating to apply agents (`deck-apply-fast`, `deck-apply-deep`) for tasks involving symbolic editing or refactoring:
- Require the use of Serena edit tools (`serena_replace_symbol_body`, `serena_rename_symbol`, `serena_insert_after_symbol`, `serena_insert_before_symbol`) as first preference.
- If the agent cannot use them, require explicit report: "Serena edit tools unavailable; fallback used: [tool]."

### Non-Apply Delegation (search/navigation/diagnostics)

When delegating to non-apply agents (explorer, proposal, spec, design, task, verify, review):
- Suggest Serena read-only tools (`serena_find_symbol`, `serena_find_referencing_symbols`, `serena_find_implementations`, `serena_find_declaration`, `serena_get_symbols_overview`, `serena_get_diagnostics_for_file`) when appropriate for symbolic search, navigation, or diagnostics.
- Do NOT request write-capable tools to non-apply agents; respect the tool policy by role.

### Guidance Assumptions

This guidance is present because the Serena package is available. The delegation instructions assume Serena capabilities are available when needed.
<!-- deck:developer-team:end -->

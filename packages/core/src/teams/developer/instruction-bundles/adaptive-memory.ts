import type {
  CapabilityInstructionBundle,
  CapabilityInstructionFragment,
} from "./index";

/**
 * Canonical instruction content for the adaptive-memory package.
 *
 * Adaptive memory persists decisions, discoveries, and context across sessions.
 * It is ADVISORY — OpenSpec artifacts and Spec Registry are ALWAYS authoritative.
 *
 * CONTRACT (2026-05-29): No manual container tag prefixes.
 * - User identity is derived from the Supermemory token/API key.
 * - Project scoping is automatic via x-sm-project header in MCP config.
 * - Memories are saved as normal content without prefixes.
 */
export function buildAdaptiveMemoryInstructionBundle(): CapabilityInstructionBundle {
  const fragments: CapabilityInstructionFragment[] = [
    {
      packageId: "adaptive-memory",
      surface: "agent",
      markdown: `Adaptive memory is provided by the runner's configured memory system. The active provider injects its tool instructions into agent prompts.

### Automatic Scoping

Memories are scoped automatically without manual prefixes:

- **User scope**: Derived from your Supermemory token/API key. The token identifies you — no userId needed.
- **Project scope**: Derived from x-sm-project header in MCP config (git remote, path, or explicit config). No manual scoping needed.

Save memories as plain content. Scoping is automatic.

### When to Save (proactive)

Call the memory save operation IMMEDIATELY after any of these (don't wait to be asked):

- Architecture or design decision made
- Bug fix completed (include root cause)
- Non-obvious discovery about the codebase
- Configuration change or environment setup
- Pattern established (naming, structure, convention)
- User preference or constraint learned
- Gotcha, edge case, or unexpected behavior found

### Save Format

- **What**: One sentence — what was done
- **Why**: What motivated it (user request, bug, performance, etc.)
- **Where**: Files or paths affected (omit if none)
- **Learned**: Gotchas, edge cases, things that surprised you (omit if none)

### Topic Keys

For evolving topics (architecture decisions, ongoing features), reuse the same topic key to update a single memory instead of creating duplicates. Different topics must never overwrite each other.

### When to Search

Reactive: any variation of "remember", "recall", "what did we do", "how did we solve", "recordar", "acordate", or references to past work.

Proactive: when starting work that might overlap with past sessions, or the user mentions a topic with no current context.

### Session Close

Before ending a session, write a brief summary covering:

- Goal: what was the session about
- Instructions: user preferences or constraints discovered
- Discoveries: technical findings, gotchas, non-obvious learnings
- Accomplished: completed items with key details
- Next Steps: what remains for the next session
- Relevant Files: paths and what they do

### Authority Rule

**OPENSPEC IS OFFICIAL CONTEXT — ADAPTIVE MEMORY IS ADVISORY.**

OpenSpec artifacts and Spec Registry entries are ALWAYS authoritative. Adaptive memory is advisory and MUST NOT override official specifications, requirements, designs, tasks, or approved change history.

If adaptive memory contradicts an OpenSpec artifact, the OpenSpec artifact wins. Always.

### Fail-Open

If the memory provider is unavailable, tools are missing, or operations error: continue working normally. Never block agent work or surface errors to the user for memory issues.

### Session Limit

Soft maximum of 7 memories per session. Prefer saving fewer high-quality observations over many low-value ones.

### Provider: Supermemory

When the configured memory provider is "supermemory", use these MCP tools:

- \`memory\` (action: "save", content: "...") — commit a memory
- \`memory\` (action: "forget", content: "...") — remove a memory
- \`recall\` (query: "...", includeProfile?: boolean) — retrieve relevant memories

The Supermemory MCP server exposes these tools natively. Do not call raw MCP tools directly — use the tool names shown above.

Scoping is automatic: user from token, project from x-sm-project header. No manual containerTag required.

### Decision Examples

Here are concrete scenarios showing when to save, what topic key to use, and what content to include:

1. **Architecture decision made**
   - *Trigger*: Team chooses Zustand over Redux for state management
   - *Suggested topic key*: architecture/state-management
   - *Example content*: **What**: Chose Zustand over Redux for global state. **Why**: Redux requires too much boilerplate for our use case; Zustand's minimal API fits better. **Where**: src/store/, package.json. **Learned**: Zustand's context integration requires explicit provider wrapping.

2. **User preference correction**
   - *Trigger*: User corrects the agent's assumption about preferred naming style
   - *Suggested topic key*: preference/kevin
   - *Example content*: **What**: User prefers kebab-case for CSS class names, not camelCase. **Why**: Explicit correction during CSS review. **Where**: src/components/.

3. **Non-obvious discovery**
   - *Trigger*: Agent discovers a subtle memory leak in a useEffect cleanup
   - *Suggested topic key*: discovery/react-hooks-cleanup
   - *Example content*: **What**: useEffect without cleanup closure retains stale references. **Why**: Found while investigating slow re-renders. **Where**: src/hooks/useAudioPlayer.ts. **Learned**: Always verify cleanup functions capture current props, not stale closures.

4. **Bug fix with root cause**
   - *Trigger*: Fixed N+1 query in UserList that loaded relationships lazily
   - *Suggested topic key*: bugfix/n-plus-one-user-list
   - *Example content*: **What**: Fixed N+1 query by eager-loading organization relationship. **Why**: User reported 30+ queries on user list page. **Where**: src/models/User.ts, src/queries/users.ts. **Learned**: Eloquent's with() method accepts array of relations; chaining .whereHas() on eager-loaded relations requires joined hint.

5. **Session-close summary**
   - *Trigger*: Ending a session after completing implementation work
   - *Suggested topic key*: session/2026-05-23-deck-refactor
   - *Example content*: **Goal**: Refactor deck-developer-* skills for parallel execution. **Accomplished**: Split orchestrator into discrete waves, implemented Task 1-2 (memoryBundle type + instruction bundle). **Next Steps**: Backend wave 1 (Tasks 3, 4, 6). **Relevant Files**: packages/adapter-opencode/src/developer-team-install.ts, packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts.

### Suggested Topic Keys

Use stable, descriptive topic keys. Reuse the same key when updating an existing memory. Avoid creating duplicate memories for the same topic:

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

Call the memory save operation IMMEDIATELY after any of these lifecycle moments:

| Lifecycle Moment | Save Action | Topic Key | Content Focus |
|---|---|---|---|
| Architecture decision made | Save immediately | architecture/<component> | What was decided, why, alternatives rejected |
| Bug fix completed | Save immediately | bugfix/<issue> | What was fixed, root cause, where |
| User preference learned | Save immediately | preference/<user> | What the preference is, who stated it |
| Session close | Save before ending | session/<date>- <context> | Goal, instructions, discoveries, accomplished, next steps |
| Non-obvious discovery | Save immediately | discovery/<what-found> | What was found, context, implications |
| Configuration change | Save immediately | config/<what-changed> | What changed, why, files affected |
| Pattern established | Save immediately | pattern/<pattern-name> | What pattern, where, why adopted |

### Provider: Engram

When the configured memory provider is "engram", use Engram's documented tool interface. The Engram adapter injects its specific instructions; follow those instead of these generic ones.`,
    },
    {
      packageId: "adaptive-memory",
      surface: "session",
      markdown: `Adaptive memory is provided by the runner's configured memory system. The active provider injects its tool instructions into agent prompts.

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

- \`memory\` (action: "save", content: "...") — commit a memory
- \`memory\` (action: "forget", content: "...") — remove a memory
- \`recall\` (query: "...", includeProfile?: boolean) — retrieve relevant memories

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

When the configured memory provider is "engram", use Engram's documented tool interface. The Engram adapter injects its specific instructions; follow those instead of these generic ones.`,
    },
    {
      packageId: "adaptive-memory",
      surface: "skill",
      markdown: `Adaptive memory is provided by the runner's configured memory system. The active provider injects its tool instructions into agent prompts.

### Automatic Scoping

Memories are scoped automatically without manual prefixes:

- **User scope**: Derived from your Supermemory token/API key. No userId needed.
- **Project scope**: Derived from x-sm-project header in MCP config. No manual scoping.

Save memories as plain content. Scoping is automatic.

### When to Save (proactive)

Save immediately after: architecture/design decisions, bug fixes (include root cause), non-obvious discoveries, configuration changes, established patterns, user preferences, gotchas or edge cases.

### Save Format

- **What**: One sentence — what was done
- **Why**: What motivated it (user request, bug, performance, etc.)
- **Where**: Files or paths affected (omit if none)
- **Learned**: Gotchas and edge cases (omit if none)

### When to Search

Reactive: "remember", "recall", "what did we do", "how did we solve", or references to past work. Proactive: when starting work that may overlap with past sessions.

### Session Close

Before ending: summarize goal, instructions, discoveries, accomplished items, next steps, and relevant files.

### Authority Rule

**OPENSPEC IS OFFICIAL CONTEXT — ADAPTIVE MEMORY IS ADVISORY.**

OpenSpec artifacts and Spec Registry are ALWAYS authoritative. Adaptive memory is advisory — it must never override official specifications.

### Fail-Open

If memory operations error or tools are unavailable: continue working normally. Never block agent work or surface errors to the user for memory issues.

### Provider: Supermemory

When the configured memory provider is "supermemory", use these MCP tools:

- \`memory\` (action: "save", content: "...") — commit a memory
- \`memory\` (action: "forget", content: "...") — remove a memory
- \`recall\` (query: "...", includeProfile?: boolean) — retrieve relevant memories

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

When the configured memory provider is "engram", use Engram's documented tool interface. The Engram adapter injects its specific instructions; follow those instead of these generic ones.`,
    },
  ];

  return { instructions: Object.freeze(fragments) };
}
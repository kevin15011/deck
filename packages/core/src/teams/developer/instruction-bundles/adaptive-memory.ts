import type {
  CapabilityInstructionBundle,
  CapabilityInstructionFragment,
} from "./index";

/**
 * Canonical instruction content for the adaptive-memory package.
 *
 * Adaptive memory persists decisions, discoveries, and context across sessions.
 * It is ADVISORY — OpenSpec artifacts and Spec Registry are ALWAYS authoritative.
 */
export function buildAdaptiveMemoryInstructionBundle(): CapabilityInstructionBundle {
  const fragments: CapabilityInstructionFragment[] = [
    {
      packageId: "adaptive-memory",
      surface: "agent",
      markdown: `## Adaptive Memory

Adaptive memory is configured via \`.deck/config.json\` (field: \`adaptiveMemory.activeProvider\`). The active provider injects its tool instructions into agent prompts. You MUST follow the provider-specific tools and container conventions.

### Container Tag Conventions

Use the appropriate container tag for the scope of what you're saving:

| Prefix | Scope | Example |
|--------|-------|---------|
| \`u:\` | User — personal learnings, preferences, corrections | \`u:kevin\` |
| \`t:\` | Team — team conventions, decisions, shared patterns | \`t:developer-team\` |
| \`o:\` | Organization — org-wide standards | \`o:GCO\` |
| \`p:\` | Project — project-specific heuristics, conventions, retrospectives | \`p:deck\` |

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

OpenSpec artifacts and Spec Registry entries are ALWAYS authoritative. Adaptive memory is advisory and MUST NOT override official specifications, requirements, designs, tasks, or approved change history.

If adaptive memory contradicts an OpenSpec artifact, the OpenSpec artifact wins. Always.

### Fail-Open

If the memory provider is unavailable, tools are missing, or operations error: continue working normally. Never block agent work or surface errors to the user for memory issues.

### Session Limit

Soft maximum of 7 memories per session. Prefer saving fewer high-quality observations over many low-value ones.

### Provider: Supermemory

When \`adaptiveMemory.activeProvider\` is \`supermemory\`, use these tools:

- **\`supermemory_memory\`** (action: "save") — commit a memory to the configured container
- **\`supermemory_recall\`** (query: "...") — retrieve relevant memories from memory

Tool binding is prepared by the Supermemory adapter; do not call raw MCP tools directly.

### Provider: Engram

When \`adaptiveMemory.activeProvider\` is \`engram\`, use Engram's documented tool interface. The Engram adapter injects its specific instructions; follow those instead of these generic ones.`,
    },
    {
      packageId: "adaptive-memory",
      surface: "session",
      markdown: `## Adaptive Memory

Adaptive memory is configured via \`.deck/config.json\` (field: \`adaptiveMemory.activeProvider\`). The active provider injects its tool instructions into agent prompts.

### Container Tag Conventions

| Prefix | Scope | Example |
|--------|-------|---------|
| \`u:\` | User — personal learnings, preferences | \`u:kevin\` |
| \`t:\` | Team — team conventions, decisions | \`t:developer-team\` |
| \`o:\` | Organization — org-wide standards | \`o:GCO\` |
| \`p:\` | Project — project-specific heuristics | \`p:deck\` |

When coordinating work, be aware that sub-agents may save and search memories as part of their workflow. Agents should proactively save after significant decisions, bug fixes, discoveries, or pattern establishment.

Before ending a session, ensure a session summary is saved covering: goal, instructions discovered, technical findings, accomplished items, next steps, and relevant files.

If memory operations fail or tools are unavailable, agents continue working normally — memory is never blocking.`,
    },
    {
      packageId: "adaptive-memory",
      surface: "skill",
      markdown: `## Adaptive Memory

Adaptive memory is configured via \`.deck/config.json\` (field: \`adaptiveMemory.activeProvider\`). The active provider injects its tool instructions into agent prompts. You MUST follow the provider-specific tools and container conventions.

### Container Tag Conventions

Use the appropriate container tag for the scope of what you're saving:

| Prefix | Scope | Example |
|--------|-------|---------|
| \`u:\` | User — personal learnings, preferences, corrections | \`u:kevin\` |
| \`t:\` | Team — team conventions, decisions, shared patterns | \`t:developer-team\` |
| \`o:\` | Organization — org-wide standards | \`o:GCO\` |
| \`p:\` | Project — project-specific heuristics, conventions, retrospectives | \`p:deck\` |

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

OpenSpec artifacts and Spec Registry are ALWAYS authoritative. Adaptive memory is advisory — it must never override official specifications.

### Fail-Open

If memory operations error or tools are unavailable: continue working normally. Never block agent work or surface errors for memory issues.

### Provider: Supermemory

When \`adaptiveMemory.activeProvider\` is \`supermemory\`, use these tools:

- **\`supermemory_memory\`** (action: "save") — commit a memory to the configured container
- **\`supermemory_recall\`** (query: "...") — retrieve relevant memories from memory

Tool binding is prepared by the Supermemory adapter; do not call raw MCP tools directly.

### Provider: Engram

When \`adaptiveMemory.activeProvider\` is \`engram\`, use Engram's documented tool interface. The Engram adapter injects its specific instructions; follow those instead of these generic ones.`,
    },
  ];

  return { instructions: Object.freeze(fragments) };
}
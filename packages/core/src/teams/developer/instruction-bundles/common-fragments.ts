/**
 * Common instruction fragments shared across multiple instruction bundles.
 *
 * These functions generate the base markdown content that is reused by
 * the adaptive-memory, codebase-memory, context-mode, and rtk bundles.
 *
 * The content that repeats across surface variants (agent/skill/session) includes:
 * - Container Tag Conventions
 * - When to Save / When to Search
 * - Save Format
 * - Authority Rule
 * - Fail-Open provision
 */

import type { CapabilityInstructionSurface } from "./index";

// ---------------------------------------------------------------------------
// Container Tag Conventions
// ---------------------------------------------------------------------------

/**
 * Returns the Container Tag Conventions markdown for adaptive-memory.
 * Used by agent and skill surfaces.
 */
export function adaptiveMemoryContainerTagConventions(): string {
  return `### Container Tag Conventions

Use the appropriate container tag for the scope of what you're saving:

| Prefix | Scope | Example |
|--------|-------|---------|
| \`u:\` | User — personal learnings, preferences, corrections | \`u:kevin\` |
| \`t:\` | Team — team conventions, decisions, shared patterns | \`t:developer-team\` |
| \`o:\` | Organization — org-wide standards | \`o:GCO\` |
| \`p:\` | Project — project-specific heuristics, conventions, retrospectives | \`p:deck\` |`;
}

// ---------------------------------------------------------------------------
// Save Format
// ---------------------------------------------------------------------------

/**
 * Returns the Save Format markdown for adaptive-memory.
 */
export function adaptiveMemorySaveFormat(): string {
  return `### Save Format

- **What**: One sentence — what was done
- **Why**: What motivated it (user request, bug, performance, etc.)
- **Where**: Files or paths affected (omit if none)
- **Learned**: Gotchas, edge cases, things that surprised you (omit if none)`;
}

// ---------------------------------------------------------------------------
// Authority Rule
// ---------------------------------------------------------------------------

/**
 * Returns the Authority Rule markdown for adaptive-memory.
 */
export function adaptiveMemoryAuthorityRule(): string {
  return `### Authority Rule

OpenSpec artifacts and Spec Registry entries are ALWAYS authoritative. Adaptive memory is advisory and MUST NOT override official specifications, requirements, designs, tasks, or approved change history.

If adaptive memory contradicts an OpenSpec artifact, the OpenSpec artifact wins. Always.`;
}

// ---------------------------------------------------------------------------
// Fail-Open
// ---------------------------------------------------------------------------

/**
 * Returns the Fail-Open provision markdown for adaptive-memory.
 */
export function adaptiveMemoryFailOpen(): string {
  return `### Fail-Open

If the memory provider is unavailable, tools are missing, or operations error: continue working normally. Never block agent work or surface errors to the user for memory issues.`;
}

// ---------------------------------------------------------------------------
// When to Save (proactive)
// ---------------------------------------------------------------------------

/**
 * Returns the "When to Save" markdown for adaptive-memory.
 */
export function adaptiveMemoryWhenToSave(): string {
  return `### When to Save (proactive)

Call the memory save operation IMMEDIATELY after any of these (don't wait to be asked):

- Architecture or design decision made
- Bug fix completed (include root cause)
- Non-obvious discovery about the codebase
- Configuration change or environment setup
- Pattern established (naming, structure, convention)
- User preference or constraint learned
- Gotcha, edge case, or unexpected behavior found`;
}

// ---------------------------------------------------------------------------
// When to Search
// ---------------------------------------------------------------------------

/**
 * Returns the "When to Search" markdown for adaptive-memory.
 */
export function adaptiveMemoryWhenToSearch(): string {
  return `### When to Search

Reactive: any variation of "remember", "recall", "what did we do", "how did we solve", "recordar", "acordate", or references to past work.

Proactive: when starting work that might overlap with past sessions, or the user mentions a topic with no current context.`;
}

// ---------------------------------------------------------------------------
// Session Close
// ---------------------------------------------------------------------------

/**
 * Returns the Session Close markdown for adaptive-memory.
 */
export function adaptiveMemorySessionClose(): string {
  return `### Session Close

Before ending a session, write a brief summary covering:

- Goal: what was the session about
- Instructions: user preferences or constraints discovered
- Discoveries: technical findings, gotchas, non-obvious learnings
- Accomplished: completed items with key details
- Next Steps: what remains for the next session
- Relevant Files: paths and what they do`;
}

// ---------------------------------------------------------------------------
// Topic Keys
// ---------------------------------------------------------------------------

/**
 * Returns the Topic Keys markdown for adaptive-memory.
 */
export function adaptiveMemoryTopicKeys(): string {
  return `### Topic Keys

For evolving topics (architecture decisions, ongoing features), reuse the same topic key to update a single memory instead of creating duplicates. Different topics must never overwrite each other.`;
}

// ---------------------------------------------------------------------------
// Session Limit
// ---------------------------------------------------------------------------

/**
 * Returns the Session Limit markdown for adaptive-memory.
 */
export function adaptiveMemorySessionLimit(): string {
  return `### Session Limit

Soft maximum of 7 memories per session. Prefer saving fewer high-quality observations over many low-value ones.`;
}

// ---------------------------------------------------------------------------
// Full common fragments for each surface
// ---------------------------------------------------------------------------

/**
 * Returns the full set of common fragments for adaptive-memory agent surface.
 */
export function adaptiveMemoryAgentCommonFragments(): string[] {
  return [
    adaptiveMemoryContainerTagConventions(),
    adaptiveMemoryWhenToSave(),
    adaptiveMemorySaveFormat(),
    adaptiveMemoryTopicKeys(),
    adaptiveMemoryWhenToSearch(),
    adaptiveMemorySessionClose(),
    adaptiveMemoryAuthorityRule(),
    adaptiveMemoryFailOpen(),
    adaptiveMemorySessionLimit(),
  ];
}

/**
 * Returns the full set of common fragments for adaptive-memory skill surface.
 * Note: skill surface omits some agent-specific sections for brevity.
 */
export function adaptiveMemorySkillCommonFragments(): string[] {
  return [
    adaptiveMemoryContainerTagConventions(),
    adaptiveMemoryWhenToSave(),
    adaptiveMemorySaveFormat(),
    adaptiveMemoryWhenToSearch(),
    adaptiveMemorySessionClose(),
    adaptiveMemoryAuthorityRule(),
    adaptiveMemoryFailOpen(),
  ];
}

/**
 * Returns the full set of common fragments for adaptive-memory session surface.
 */
export function adaptiveMemorySessionCommonFragments(): string[] {
  return [
    adaptiveMemoryContainerTagConventions(),
    adaptiveMemoryWhenToSearch(),
    adaptiveMemorySessionClose(),
    adaptiveMemoryAuthorityRule(),
    adaptiveMemoryFailOpen(),
  ];
}
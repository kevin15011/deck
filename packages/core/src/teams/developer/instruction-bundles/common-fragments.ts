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
  return `### Canonical Supermemory Scope

Do not choose or type container tags manually. Deck owns the canonical project scope and installs it through the runner configuration. Provider account identity remains external to Deck configuration and is never written into prompts.`;
}

// ---------------------------------------------------------------------------
// Save Format
// ---------------------------------------------------------------------------

/**
 * Returns the Save Format markdown for adaptive-memory.
 */
export function adaptiveMemorySaveFormat(): string {
  return `### Explicit User-Requested Memory

If the user explicitly asks to save or forget information, pass only the user-approved content through the runner-exposed memory tool. Do not add hidden topic keys, quotas, credentials, raw logs, provider responses, or OpenSpec artifacts.`;
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
  return `### Conversation Capture

Automatic Adaptive Memory requires a Deck-managed session. Direct runner launches remain runner-standalone/static-compatible: static tools and instructions may work, but automatic recall/capture is not provided by design. Agents must not run a manual proactive-save lifecycle, invent topic keys, chase a semantic quota, create routine memory summaries, or try to autobootstrap Deck Runtime.

Use explicit memory writes only when the user directly asks to remember or forget something and the runner-exposed provider tool supports that action.`;
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
  return `### Session Lifecycle

The conversation capture contract is tied to the runner session's stable customId only when a real executing transport is available. Do not write a mandatory end-of-session memory summary; normal final responses are enough unless the user explicitly asks to remember something.`;
}

// ---------------------------------------------------------------------------
// Topic Keys
// ---------------------------------------------------------------------------

/**
 * Returns the Topic Keys markdown for adaptive-memory.
 */
export function adaptiveMemoryTopicKeys(): string {
  return `### Provider-Native Learning

Supermemory owns extraction, relationship building, profiles, ranking, temporal updates, and deduplication. Do not duplicate that model with agent-authored topic keys.`;
}

// ---------------------------------------------------------------------------
// Session Limit
// ---------------------------------------------------------------------------

/**
 * Returns the Session Limit markdown for adaptive-memory.
 */
export function adaptiveMemorySessionLimit(): string {
  return `### Context Bounds

Recall remains demand-driven, scoped to the canonical project container, limited to five results and about 1,500 tokens by default. There is no per-session semantic write quota.`;
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

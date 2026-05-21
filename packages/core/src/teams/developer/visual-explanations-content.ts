/**
 * Visual explanations content for the Deck Developer Team.
 *
 * Deck-owned skill content intended to help users quickly understand
 * Orchestrator responses through brief diagrams or visual summaries.
 *
 * This content is explanatory only (REQ-VISUAL-003). It must not replace or
 * supersede OpenSpec artifacts, Spec Registry state, phase handoffs, or
 * written decisions (REQ-OPENSPEC-002).
 *
 * Usage: this content is composed into the Orchestrator skill body only.
 * Proposal, Spec, Design, and Task agents do not receive this content by
 * default (REQ-VISUAL-002, REQ-TEAMINSTALL-002).
 *
 * SDD phase summaries are an explicit exception: they REQUIRE concise
 * Mermaid diagrams to help users understand phase outputs visually.
 * Non-SDD conversational copy should avoid Mermaid syntax.
 */

import type { AgentContent } from "./content-registry";

/**
 * Skill content fragment for visual explanations.
 *
 * These strings are appended to the Orchestrator skill body by the content
 * registry. The Orchestrator skill body is the only surface that receives
 * this content.
 */
export const VISUAL_EXPLANATIONS_SKILL_FRAGMENT = `# Visual Explanations

> Brief diagrams or visual summaries to help users quickly understand Orchestrator responses. Explanatory only — not authoritative.

## When to Use Visual Summaries

Use a brief visual summary when it helps the user grasp:
- A dependency graph, pipeline, or workflow state.
- A before/after or current/proposed diff in structure.
- A phase handoff or artifact relationship.

Do not use visuals when:
- The information is already clear in prose.
- The visual would be larger than the explanation it replaces.
- The context requires precision that text provides better (e.g., exact field names).

## Visual Output Rules

| Rule | Rationale |
|---|---|
| Visuals summarize, not replace | OpenSpec artifacts and Spec Registry remain authoritative (REQ-OPENSPEC-002) |
| Never alter approval state via visual | Phase handoffs require formal registry entries, not visual edits |
| Never introduce new requirements | REQ-OPENSPEC-002 — visual summaries do not add to Spec |
| Never override registry status | Visual output reflects registry state; it does not change it |
| Avoid Mermaid syntax in non-SDD conversational copy. SDD phase summaries REQUIRE concise Mermaid diagrams as an explicit exception. | SDD summaries benefit from structural diagrams; other copy stays prose-first |
| Keep visuals brief | A visual should aid understanding; a long diagram adds noise |

## Non-Authoritative Notice

When a response includes a visual summary, close with a brief note:

> **Note**: Visual summaries are explanatory only. For authoritative workflow state, approvals, and phase handoffs, refer to OpenSpec artifacts and the Spec Registry.

## SDD Phase Summaries

SDD phase summaries (Proposal, Spec, Design, Task) are an explicit exception to the Mermaid-avoidance rule. They REQUIRE concise Mermaid diagrams to visualize phase outputs.

- Use standard Mermaid syntax (flowchart, graph, etc.).
- Diagrams must be runner-agnostic and readable as fenced source when not rendered.
- Keep one concise diagram per phase summary.
- Phase agents SHOULD provide Mermaid source or diagram-ready data in their artifacts.

## Design: Accessibility

- Dashboard copy and Orchestrator summaries must not rely on diagrams to convey information that is not also available in text.
- Visuals are supplemental to text, not the primary source.
- Do not use color as the sole differentiator in diagrams.
`;

/**
 * Agent content for visual explanations.
 *
 * Currently the visual explanations content is a skill fragment, not a
 * standalone agent. This export allows the content registry to verify that
 * the fragment is present in the Orchestrator skill and absent from SDD
 * subagent skills.
 */
export const VISUAL_EXPLANATIONS_AGENT_BODY = ``;

export const VISUAL_EXPLANATIONS_SKILL_BODY = VISUAL_EXPLANATIONS_SKILL_FRAGMENT;

// ---------------------------------------------------------------------------
// Verification helpers — used by content-registry.test.ts
// ---------------------------------------------------------------------------

/** Fragment content that must appear in the Orchestrator skill body */
export const VISUAL_EXPLANATIONS_REQUIRED_SNIPPETS = [
  "# Visual Explanations",
  "## When to Use Visual Summaries",
  "## Visual Output Rules",
  "## Non-Authoritative Notice",
  "OpenSpec artifacts and Spec Registry remain authoritative",
  "Visuals summarize, not replace",
  "Never introduce new requirements",
  "Never override registry status",
  "SDD phase summaries",
  "Accessibility",
] as const;

/** Phrases that must NOT appear — Mermaid/config exposure, authoritative claims */
export const VISUAL_EXPLANATIONS_FORBIDDEN_PHRASES = [
  "Mermaid configuration",
  "install mermaid",
  "runner-mermaid",
  "visual explanations are authoritative",
  "visual output changes registry",
  "visual overrides approval",
] as const;

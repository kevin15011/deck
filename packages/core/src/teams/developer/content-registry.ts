import { renderDeveloperTeamContextAuthorityGuidance } from "../../memory/adaptive-context-renderer";

import { deckInitSkillContent } from "../../skills/bootstrap/deck-init-content";
import { deckOnboardSkillContent } from "../../skills/bootstrap/deck-onboard-content";

/**
 * Runner-agnostic content registry for the Developer Team.
 *
 * Adapters call these functions to retrieve canonical agent and team
 * content without knowing the internal structure or branching logic.
 *
 * Two registry functions:
 *
 * 1. getAgentContent(agentId) → { agentBody, skillBody }
 *    Returns the body content for a known agent. All current Developer Team
 *    catalog agents have real content. Structured placeholders remain only
 *    as a defensive fallback for future catalog entries that have not been
 *    implemented yet.
 *
 * 2. getTeamSessionInstructions(teamId) → string | undefined
 *    Returns session-level instructions for a team. For the Developer Team,
 *    this is the orchestrator's full operating rules. Adapters map this to
 *    their runtime-specific session initialization mechanism.
 *
 * Design note: "session instructions" is preferred over "system prompt"
 * because "system prompt" is a runtime concept tied to specific AI platforms.
 * The content itself is runner-neutral — it describes team behavior, not
 * how a particular runner loads it.
 */

import { DEVELOPER_TEAM_AGENTS } from "./catalog";
import {
  ORCHESTRATOR_AGENT_BODY,
  ORCHESTRATOR_SKILL_BODY,
  getOrchestratorSystemPrompt,
} from "./orchestrator-content";
import { DEFAULT_ORCHESTRATOR_PERSONALITY, type OrchestratorPersonality } from "../../config/deck-config";
import { EXPLORER_AGENT_BODY, EXPLORER_SKILL_BODY } from "./explorer-content";
import { PROPOSAL_AGENT_BODY, PROPOSAL_SKILL_BODY } from "./proposal-content";
import { SPEC_AGENT_BODY, SPEC_SKILL_BODY } from "./spec-content";
import { DESIGN_AGENT_BODY, DESIGN_SKILL_BODY } from "./design-content";
import { TASK_AGENT_BODY, TASK_SKILL_BODY } from "./task-content";
import { APPLY_GENERAL_AGENT_BODY, APPLY_GENERAL_SKILL_BODY } from "./apply-general-content";
import { APPLY_BACKEND_AGENT_BODY, APPLY_BACKEND_SKILL_BODY } from "./apply-backend-content";
import { APPLY_FRONTEND_AGENT_BODY, APPLY_FRONTEND_SKILL_BODY } from "./apply-frontend-content";
import { VERIFY_AGENT_BODY, VERIFY_SKILL_BODY } from "./verify-content";
import { REVIEW_AGENT_BODY, REVIEW_SKILL_BODY } from "./review-content";
import { ARCHIVE_AGENT_BODY, ARCHIVE_SKILL_BODY } from "./archive-content";
import {
  VISUAL_EXPLANATIONS_SKILL_FRAGMENT,
  VISUAL_EXPLANATIONS_AGENT_BODY,
  VISUAL_EXPLANATIONS_SKILL_BODY,
} from "./visual-explanations-content";
import type { CapabilityInstructionBundle } from "./instruction-bundles/index";
import {
  composeCapabilityInstructions,
  type CapabilityInstructionCompositionContext,
} from "./instruction-bundles/index";
import { getDeveloperTeamCatalog } from "./catalog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Result type for error-returning operations
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// Error type for content registry operations
export interface AgentContentError {
  agentId: string;
  message: string;
  suggestions: string[];
  fallbackAvailable: boolean;
}

export type AgentContent = {
  /** Body for the agent definition file (after runtime frontmatter) */
  agentBody: string;
  /** Body for the skill definition file (after runtime frontmatter) */
  skillBody: string;
};

export type ContentRegistryOptions = {
  /** Optional capability instruction bundle to compose into agent/skill/session content */
  capabilityInstructions?: CapabilityInstructionBundle;
  /** Optional orchestrator personality for session prompt selection */
  personality?: OrchestratorPersonality;
};

/** Options for getAgentContentResult */
export type ContentRegistryResultOptions = {
  /** Optional capability instruction bundle to compose into agent/skill/session content */
  capabilityInstructions?: CapabilityInstructionBundle;
  /** When true, returns fallback content for catalog agents without real content */
  fallback?: boolean;
  /** Optional orchestrator personality (affects session prompt, not agent content) */
  personality?: OrchestratorPersonality;
};

// ---------------------------------------------------------------------------
// Internal: content map for agents with real (non-placeholder) content
// ---------------------------------------------------------------------------

const REAL_CONTENT: Record<string, { agentBody: string; skillBody: string }> = {
  "deck-developer-orchestrator": {
    agentBody: ORCHESTRATOR_AGENT_BODY,
    // Visual explanations are composed into the Orchestrator skill only.
    // Proposal, Spec, Design, and Task agents do not receive this content
    // by default (REQ-VISUAL-002, REQ-TEAMINSTALL-002).
    skillBody: `${ORCHESTRATOR_SKILL_BODY.trimEnd()}\n\n${VISUAL_EXPLANATIONS_SKILL_FRAGMENT}\n`,
  },
  "deck-developer-explorer": {
    agentBody: EXPLORER_AGENT_BODY,
    skillBody: EXPLORER_SKILL_BODY,
  },
  "deck-developer-proposal": {
    agentBody: PROPOSAL_AGENT_BODY,
    skillBody: PROPOSAL_SKILL_BODY,
  },
  "deck-developer-spec": {
    agentBody: SPEC_AGENT_BODY,
    skillBody: SPEC_SKILL_BODY,
  },
  "deck-developer-design": {
    agentBody: DESIGN_AGENT_BODY,
    skillBody: DESIGN_SKILL_BODY,
  },
  "deck-developer-task": {
    agentBody: TASK_AGENT_BODY,
    skillBody: TASK_SKILL_BODY,
  },
  "deck-developer-apply-general": {
    agentBody: APPLY_GENERAL_AGENT_BODY,
    skillBody: APPLY_GENERAL_SKILL_BODY,
  },
  "deck-developer-apply-backend": {
    agentBody: APPLY_BACKEND_AGENT_BODY,
    skillBody: APPLY_BACKEND_SKILL_BODY,
  },
  "deck-developer-apply-frontend": {
    agentBody: APPLY_FRONTEND_AGENT_BODY,
    skillBody: APPLY_FRONTEND_SKILL_BODY,
  },
  "deck-developer-verify": {
    agentBody: VERIFY_AGENT_BODY,
    skillBody: VERIFY_SKILL_BODY,
  },
  "deck-developer-review": {
    agentBody: REVIEW_AGENT_BODY,
    skillBody: REVIEW_SKILL_BODY,
  },
  "deck-developer-archive": {
    agentBody: ARCHIVE_AGENT_BODY,
    skillBody: ARCHIVE_SKILL_BODY,
  },
  "deck-init": {
    agentBody: extractBody(deckInitSkillContent),
    skillBody: deckInitSkillContent,
  },
  "deck-onboard": {
    agentBody: extractBody(deckOnboardSkillContent),
    skillBody: deckOnboardSkillContent,
  },
};

const CONTEXT_AUTHORITY_GUIDANCE = renderDeveloperTeamContextAuthorityGuidance();

// ---------------------------------------------------------------------------
// Internal: helper to extract body from bootstrap skill content
// ---------------------------------------------------------------------------

/** Extract body content from bootstrap skill content (skip YAML frontmatter). */
function extractBody(content: string): string {
  const lines = content.split('\n');
  // Skip lines until we hit non-frontmatter content (starts with #)
  const bodyStart = lines.findIndex(l => l.startsWith('#'));
  return lines.slice(bodyStart).join('\n');
}

// ---------------------------------------------------------------------------
// Internal: placeholder builders
// ---------------------------------------------------------------------------

function buildPlaceholderAgentBody(displayName: string, description: string): string {
  return [
    `# ${displayName}`,
    "",
    `> ${description}`,
    "",
    "## Project Standards (auto-resolved)",
    "",
    "<!-- Orchestrator will inject stack-specific rules at runtime. -->",
    "",
    "## Instructions",
    "",
    `<!-- Placeholder: ${displayName} prompt implementation pending review of source methodology. -->`,
    "",
  ].join("\n");
}

function buildPlaceholderSkillBody(displayName: string, description: string): string {
  return [
    `# ${displayName} Skill`,
    "",
    `> ${description}`,
    "",
    `<!-- Placeholder: ${displayName} skill implementation pending review of source methodology. -->`,
    "",
    "## Instructions",
    "",
    "<!-- Placeholder: detailed skill methodology will be adapted from the matching source skill. -->",
    "",
  ].join("\n");
}

function appendContextAuthorityGuidance(content: string): string {
  return `${content.trimEnd()}\n\n${CONTEXT_AUTHORITY_GUIDANCE}\n`;
}

function withContextAuthorityGuidance(content: AgentContent): AgentContent {
  return {
    agentBody: appendContextAuthorityGuidance(content.agentBody),
    skillBody: appendContextAuthorityGuidance(content.skillBody),
  };
}

function appendCapabilityInstructions(
  baseContent: string,
  bundle: CapabilityInstructionBundle | undefined,
  context: CapabilityInstructionCompositionContext,
): string {
  return composeCapabilityInstructions(baseContent, bundle, context);
}

/**
 * Applies composition layers to agent content in the correct order:
 * 1. context-authority guidance (already applied via withAuthority)
 * 2. sub-agent personality fragment (non-orchestrator agents only)
 * 3. capability instruction fragments (if bundle provided)
 */
function applyAgentContentComposition(
  withAuthority: AgentContent,
  agentId: string,
  bundle: CapabilityInstructionBundle | undefined,
): AgentContent {
  // Step 2: no sub-agent personality fragment (removed ahorro-extremo)
  const isOrchestrator = agentId === "deck-developer-orchestrator";
  const withFragment = isOrchestrator ? withAuthority : withAuthority;

  // Step 3: append capability instructions if provided
  if (!bundle) {
    return withFragment;
  }
  return {
    agentBody: appendCapabilityInstructions(
      withFragment.agentBody,
      bundle,
      { surface: "agent", agentId },
    ),
    skillBody: appendCapabilityInstructions(
      withFragment.skillBody,
      bundle,
      { surface: "skill", skillId: `${agentId}-skill` },
    ),
  };
}

// ---------------------------------------------------------------------------
// Registry: agent content
// ---------------------------------------------------------------------------

/**
 * Returns the agent body and skill body content for a known agent.
 *
 * For all agents in the Developer Team catalog, returns their detailed prompts.
 * For unknown agent IDs not in the catalog, returns a structured placeholder.
 *
 * When options.capabilityInstructions is provided, package instruction fragments
 * are composed into both agentBody and skillBody after context-authority guidance.
 *
 * Returns undefined for agent IDs not in the Developer Team catalog.
 *
 * @deprecated Use getAgentContentResult() instead. This wrapper will be removed
 *             in a future release.
 */
export function getAgentContent(
  agentId: string,
  options?: ContentRegistryOptions,
): AgentContent | undefined {
  const result = getAgentContentResult(agentId, options);
  if (result.ok) {
    return result.value;
  }
  // Legacy behavior: returns undefined for unknown agents
  return undefined;
}

/**
 * Returns the agent body and skill body content for a known agent.
 *
 * Uses a Result type to distinguish between successful retrieval and error cases.
 * For agents with real content in REAL_CONTENT, returns ok: true with content.
 * For unknown agents, returns ok: false with suggestions and fallback availability.
 *
 * When options.capabilityInstructions is provided, package instruction fragments
 * are composed into both agentBody and skillBody after context-authority guidance.
 *
 * When options.fallback is true and the agentId exists in the catalog but has no
 * real content, returns generic fallback content instead of an error.
 */
export function getAgentContentResult(
  agentId: string,
  options?: ContentRegistryResultOptions,
): Result<AgentContent, AgentContentError> {
  const real = REAL_CONTENT[agentId];
  if (real) {
    const withAuthority = withContextAuthorityGuidance(real);
    const composed = applyAgentContentComposition(
      withAuthority,
      agentId,
      options?.capabilityInstructions,
    );
    return { ok: true, value: composed };
  }

  // Not in REAL_CONTENT - check catalog
  const catalog = getDeveloperTeamCatalog();
  const catalogAgent = catalog.find((a) => a.id === agentId);
  const allAgentIds = catalog.map((a) => a.id);

  // Determine fallback content if requested
  if (options?.fallback) {
    if (catalogAgent) {
      // Agent exists in catalog but has no real content — fallback is appropriate
      const fallbackContent = getUnknownAgentContent(agentId, []);
      const withAuthority = withContextAuthorityGuidance(fallbackContent);
      const composed = applyAgentContentComposition(
        withAuthority,
        agentId,
        options?.capabilityInstructions,
      );
      return { ok: true, value: composed };
    }
    // Agent is NOT in catalog — cannot provide fallback, return error
    // Fallback is only for known catalog agents that lack real content
  }

  // Not found - generate error with suggestions
  const suggestions = findSimilarAgentIds(agentId, allAgentIds);

  if (catalogAgent) {
    // Agent is in catalog but has no real content
    return {
      ok: false,
      error: {
        agentId,
        message: `Agent "${agentId}" not found in content registry`,
        suggestions,
        fallbackAvailable: true,
      },
    };
  }

  // Unknown agent - not in catalog at all
  return {
    ok: false,
    error: {
      agentId,
      message: `Agent "${agentId}" not found in content registry`,
      suggestions,
      fallbackAvailable: false,
    },
  };
}

/**
 * Generates suggestions for unknown agent IDs using Levenshtein distance and prefix matching.
 *
 * Ranking: prefix matches first (score 0), then Levenshtein distance ascending.
 * Limited to maximum 3 suggestions.
 */
function findSimilarAgentIds(query: string, candidates: string[]): string[] {
  const suggestions: Array<{ id: string; score: number }> = [];

  for (const id of candidates) {
    // Prefix match has highest priority (score 0)
    if (id.startsWith(query) || query.startsWith(id)) {
      suggestions.push({ id, score: 0 });
    } else {
      // Levenshtein distance
      const dist = levenshteinDistance(query, id);
      if (dist <= 3) {
        suggestions.push({ id, score: dist });
      }
    }
  }

  // Sort by score, then limit to 3
  return suggestions
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((s) => s.id);
}

/**
 * Standard Levenshtein distance implementation.
 * Returns the minimum number of single-character edits needed to transform a into b.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Returns generic fallback content for an unknown agent.
 * Used when options.fallback is true but the agent has no real content.
 */
export function getUnknownAgentContent(agentId: string, _suggestions: string[]): AgentContent {
  return {
    agentBody: [
      `# Unknown Agent: ${agentId}`,
      "",
      `> This agent is not recognized by the Developer Team content registry.`,
      "",
      "## Context",
      "",
      "This agent ID is not registered with real content. The Orchestrator should",
      "either route to a known agent or report this as an unresolved agent reference.",
      "",
      "## Project Standards (auto-resolved)",
      "",
      "<!-- Orchestrator will inject stack-specific rules at runtime. -->",
      "",
      "## Instructions",
      "",
      "Contact the Developer Team maintainers to register content for this agent.",
      "",
    ].join("\n"),
    skillBody: [
      `# Unknown Agent Skill: ${agentId}`,
      "",
      `> This skill is not recognized by the Developer Team content registry.`,
      "",
      "## Instructions",
      "",
      "Contact the Developer Team maintainers to register content for this skill.",
      "",
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Registry: team session instructions
// ---------------------------------------------------------------------------

/**
 * Returns session-level instructions for a team.
 *
 * For the Developer Team, this is the orchestrator's full operating rules
 * covering delegation, dependency graph, apply routing, artifact store,
 * and project AI notes.
 *
 * Adapters map this to their runtime-specific session initialization mechanism.
 *
 * When options.capabilityInstructions is provided, matching session-surface
 * fragments are appended after context-authority guidance.
 *
 * Returns undefined for unknown team IDs.
 */
export function getTeamSessionInstructions(
  teamId: string,
  options?: ContentRegistryOptions,
): string | undefined {
  if (teamId === "developer-team") {
    const personality = options?.personality ?? DEFAULT_ORCHESTRATOR_PERSONALITY;
    const orchestratorPrompt = getOrchestratorSystemPrompt(personality);
    const base = appendContextAuthorityGuidance(orchestratorPrompt);
    if (!options?.capabilityInstructions) {
      return base;
    }
    return appendCapabilityInstructions(
      base,
      options.capabilityInstructions,
      { surface: "session" },
    );
  }

  return undefined;
}
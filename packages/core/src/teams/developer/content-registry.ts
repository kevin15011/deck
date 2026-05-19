import { renderDeveloperTeamContextAuthorityGuidance } from "../../memory/adaptive-context-renderer";

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
import { ORCHESTRATOR_AGENT_BODY, ORCHESTRATOR_SKILL_BODY, ORCHESTRATOR_SYSTEM_PROMPT } from "./orchestrator-content";
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentContent = {
  /** Body for the agent definition file (after runtime frontmatter) */
  agentBody: string;
  /** Body for the skill definition file (after runtime frontmatter) */
  skillBody: string;
};

// ---------------------------------------------------------------------------
// Internal: content map for agents with real (non-placeholder) content
// ---------------------------------------------------------------------------

const REAL_CONTENT: Record<string, { agentBody: string; skillBody: string }> = {
  "deck-developer-orchestrator": {
    agentBody: ORCHESTRATOR_AGENT_BODY,
    skillBody: ORCHESTRATOR_SKILL_BODY,
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
};

const CONTEXT_AUTHORITY_GUIDANCE = renderDeveloperTeamContextAuthorityGuidance();

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

// ---------------------------------------------------------------------------
// Registry: agent content
// ---------------------------------------------------------------------------

/**
 * Returns the agent body and skill body content for a known agent.
 *
 * For all agents in the Developer Team catalog, returns their detailed prompts.
 * For unknown agent IDs not in the catalog, returns a structured placeholder.
 *
 * Returns undefined for agent IDs not in the Developer Team catalog.
 */
export function getAgentContent(agentId: string): AgentContent | undefined {
  const real = REAL_CONTENT[agentId];
  if (real) {
    return withContextAuthorityGuidance(real);
  }

  // Look up in catalog for placeholder
  const agent = DEVELOPER_TEAM_AGENTS.find((a) => a.id === agentId);
  if (!agent) {
    return undefined;
  }

  return withContextAuthorityGuidance({
    agentBody: buildPlaceholderAgentBody(agent.displayName, agent.description),
    skillBody: buildPlaceholderSkillBody(agent.displayName, agent.description),
  });
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
 * Returns undefined for unknown team IDs.
 */
export function getTeamSessionInstructions(teamId: string): string | undefined {
  if (teamId === "developer-team") {
    return appendContextAuthorityGuidance(ORCHESTRATOR_SYSTEM_PROMPT);
  }

  return undefined;
}

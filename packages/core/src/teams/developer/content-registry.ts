/**
 * Runner-agnostic content registry for the Developer Team.
 *
 * Adapters call these functions to retrieve canonical agent and team
 * content without knowing the internal structure or branching logic.
 *
 * Two registry functions:
 *
 * 1. getAgentContent(agentId) → { agentBody, skillBody }
 *    Returns the body content for a known agent. For agents with real
 *    content (orchestrator, explorer, proposal, spec, design), returns their detailed prompts.
 *    For other agents, returns a structured placeholder that includes
 *    the agent's display name and description from the catalog.
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
};

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

// ---------------------------------------------------------------------------
// Registry: agent content
// ---------------------------------------------------------------------------

/**
 * Returns the agent body and skill body content for a known agent.
 *
 * For agents with real content (orchestrator, explorer, proposal, spec, design), returns their
 * detailed prompts. For all other agents in the catalog, returns a
 * structured placeholder.
 *
 * Returns undefined for agent IDs not in the Developer Team catalog.
 */
export function getAgentContent(agentId: string): AgentContent | undefined {
  const real = REAL_CONTENT[agentId];
  if (real) {
    return real;
  }

  // Look up in catalog for placeholder
  const agent = DEVELOPER_TEAM_AGENTS.find((a) => a.id === agentId);
  if (!agent) {
    return undefined;
  }

  return {
    agentBody: buildPlaceholderAgentBody(agent.displayName, agent.description),
    skillBody: buildPlaceholderSkillBody(agent.displayName, agent.description),
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
 * Returns undefined for unknown team IDs.
 */
export function getTeamSessionInstructions(teamId: string): string | undefined {
  if (teamId === "developer-team") {
    return ORCHESTRATOR_SYSTEM_PROMPT;
  }

  return undefined;
}

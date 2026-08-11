import {
  renderWebSearchInstructions,
  renderWebSearchRoleInstructions,
  type WebSearchRole,
} from "../../../web-search-capability";
import { DEVELOPER_TEAM_AGENTS } from "../catalog";
import type { CapabilityInstructionBundle } from "./index";

const canonicalAgentIds = Object.freeze(DEVELOPER_TEAM_AGENTS.map((agent) => agent.id));
const canonicalSkillIds = Object.freeze(DEVELOPER_TEAM_AGENTS.map((agent) => agent.skillId));

/**
 * Shared provider-neutral Web Search instructions for runner materializers.
 *
 * Common evidence/safety policy is bounded to the Developer Team session and
 * canonical role IDs. Role fragments use exact agent/skill IDs so standalone
 * and bootstrap skills cannot inherit Web Search accidentally.
 */
export function buildWebSearchInstructionBundle(): CapabilityInstructionBundle {
  const common = renderWebSearchInstructions();
  const roleFragments = DEVELOPER_TEAM_AGENTS.flatMap((agent) => {
    const role = agent.displayName as WebSearchRole;
    const roleInstructions = renderWebSearchRoleInstructions(role);
    return [
      Object.freeze({
        packageId: "web-search" as const,
        surface: "agent" as const,
        teamId: "developer-team",
        agentIds: Object.freeze([agent.id]),
        markdown: roleInstructions,
      }),
      Object.freeze({
        packageId: "web-search" as const,
        surface: "skill" as const,
        teamId: "developer-team",
        skillIds: Object.freeze([agent.skillId]),
        markdown: roleInstructions,
      }),
    ];
  });

  return {
    instructions: Object.freeze([
      Object.freeze({
        packageId: "web-search",
        surface: "session",
        teamId: "developer-team",
        markdown: renderWebSearchInstructions(),
      }),
      Object.freeze({
        packageId: "web-search",
        surface: "session",
        teamId: "developer-team",
        markdown: renderWebSearchRoleInstructions("Lead"),
      }),
      Object.freeze({
        packageId: "web-search",
        surface: "agent",
        teamId: "developer-team",
        agentIds: canonicalAgentIds,
        markdown: common,
      }),
      Object.freeze({
        packageId: "web-search",
        surface: "skill",
        teamId: "developer-team",
        skillIds: canonicalSkillIds,
        markdown: common,
      }),
      ...roleFragments,
    ]),
  };
}

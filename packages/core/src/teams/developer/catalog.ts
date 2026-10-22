/**
 * Canonical, runner-neutral Developer Team inventory.
 *
 * The seven entries below are the desired state installed by every runner.
 * Legacy IDs are kept separately for history/model migration and MUST NOT be
 * materialized as aliases.
 */

export type DeveloperTeamAgent = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  skillId: string;
  continuityRole: "work" | "review";
};

export const DEVELOPER_TEAM_AGENTS: readonly DeveloperTeamAgent[] = Object.freeze([
  {
    id: "deck-lead",
    name: "deck-lead",
    displayName: "Lead",
    description: "Owns the user outcome, selects the smallest safe route, coordinates specialists, and can implement clear low-risk deltas directly.",
    continuityRole: "work",
    skillId: "deck-lead",
  },
  {
    id: "deck-investigate",
    name: "deck-investigate",
    displayName: "Investigate",
    description: "Traces unfamiliar code and production composition, locates causes and risks, and returns a compact evidence-backed handoff.",
    continuityRole: "work",
    skillId: "deck-investigate",
  },
  {
    id: "deck-architect",
    name: "deck-architect",
    displayName: "Architect",
    description: "Plans proportionally from a compact Working Brief through Full SDD only when durable design decisions justify the cost.",
    continuityRole: "work",
    skillId: "deck-architect",
  },
  {
    id: "deck-apply-fast",
    name: "deck-apply-fast",
    displayName: "Apply Fast",
    description: "Implements clear, routine, localized, or pattern-based changes as a complete vertical slice with proportional tests.",
    continuityRole: "work",
    skillId: "deck-apply-fast",
  },
  {
    id: "deck-apply-deep",
    name: "deck-apply-deep",
    displayName: "Apply Deep",
    description: "Implements algorithmic, concurrent, performance-sensitive, protocol, migration, or difficult debugging work requiring deep reasoning.",
    continuityRole: "work",
    skillId: "deck-apply-deep",
  },
  {
    id: "deck-quality",
    name: "deck-quality",
    displayName: "Quality",
    description: "Independently verifies behavior, architecture, regression risk, security, and protected boundaries without modifying the candidate.",
    continuityRole: "review",
    skillId: "deck-quality",
  },
  {
    id: "deck-setup",
    name: "deck-setup",
    displayName: "Setup",
    description: "Repairs only missing, stale, invalid, or indeterminate project-readiness components discovered by the once-per-session preflight.",
    continuityRole: "work",
    skillId: "deck-setup",
  },
]);

export const LEGACY_DEVELOPER_TEAM_AGENT_ID_MAP = Object.freeze({
  "deck-developer-orchestrator": "deck-lead",
  "deck-developer-explorer": "deck-investigate",
  "deck-developer-proposal": "deck-architect",
  "deck-developer-spec": "deck-architect",
  "deck-developer-design": "deck-architect",
  "deck-developer-task": "deck-architect",
  "deck-developer-apply-general": "deck-apply-fast",
  "deck-developer-apply-backend": "deck-apply-deep",
  "deck-developer-apply-frontend": "deck-apply-deep",
  "deck-developer-verify": "deck-quality",
  "deck-developer-review": "deck-quality",
  "deck-developer-archive": "deck-lead",
  "deck-init": "deck-setup",
  "deck-onboard": "deck-lead",
} as const satisfies Record<string, string>);

export const DEVELOPER_TEAM_LEGACY_AGENT_IDS = Object.freeze(
  Object.keys(LEGACY_DEVELOPER_TEAM_AGENT_ID_MAP),
);

export function resolveLegacyDeveloperTeamAgentId(agentId: string): string | undefined {
  return LEGACY_DEVELOPER_TEAM_AGENT_ID_MAP[
    agentId as keyof typeof LEGACY_DEVELOPER_TEAM_AGENT_ID_MAP
  ];
}

export function getDeveloperTeamCatalog(): readonly DeveloperTeamAgent[] {
  return DEVELOPER_TEAM_AGENTS;
}

/** Classify actual materialized role identity, including legacy canonical mappings. Unknown stays fresh. */
export function developerRoleContinuity(roleId: string | undefined): "work" | "review" | "unknown" {
  if (!roleId) return "unknown";
  const canonical = resolveLegacyDeveloperTeamAgentId(roleId) ?? roleId;
  return DEVELOPER_TEAM_AGENTS.find(role => role.id === canonical)?.continuityRole ?? "unknown";
}

/**
 * Canonical Developer Team agent definitions.
 *
 * Runtime-neutral: these definitions describe WHAT agents exist in the
 * Developer Team, their roles, and their IDs. Runtime adapters
 * consume these to materialize runtime-specific files.
 *
 * IDs are team-scoped to prevent collisions across multiple teams:
 *   deck-developer-orchestrator, deck-developer-explorer, etc.
 */

export type DeveloperTeamAgent = {
  /** File-safe, team-scoped ID, e.g. "deck-developer-orchestrator" */
  id: string;
  /** Agent name (same as id for deterministic pairing) */
  name: string;
  /** Human-readable display name, e.g. "Orchestrator Agent" */
  displayName: string;
  /** Short description for agent/skill frontmatter */
  description: string;
  /** Matching skill ID — mirrors agent ID for deterministic pairing */
  skillId: string;
};

export const DEVELOPER_TEAM_AGENTS: readonly DeveloperTeamAgent[] = [
  {
    id: "deck-developer-orchestrator",
    name: "deck-developer-orchestrator",
    displayName: "Orchestrator Agent",
    description:
      "Coordinates the Developer Team, delegates work, enforces workflow safety, and synthesizes results.",
    skillId: "deck-developer-orchestrator",
  },
  {
    id: "deck-developer-explorer",
    name: "deck-developer-explorer",
    displayName: "Explorer Agent",
    description:
      "Investigates code, architecture, constraints, risks, and approaches before commitment.",
    skillId: "deck-developer-explorer",
  },
  {
    id: "deck-developer-proposal",
    name: "deck-developer-proposal",
    displayName: "Proposal Agent",
    description:
      "Turns an idea into a formal change proposal with intent, scope, approach, risks, and rollback.",
    skillId: "deck-developer-proposal",
  },
  {
    id: "deck-developer-spec",
    name: "deck-developer-spec",
    displayName: "Spec Agent",
    description: "Defines formal requirements and acceptance scenarios.",
    skillId: "deck-developer-spec",
  },
  {
    id: "deck-developer-design",
    name: "deck-developer-design",
    displayName: "Design Agent",
    description:
      "Defines technical architecture, tradeoffs, file impact, and implementation approach.",
    skillId: "deck-developer-design",
  },
  {
    id: "deck-developer-task",
    name: "deck-developer-task",
    displayName: "Task Agent",
    description:
      "Converts Spec and Design into atomic, routed implementation tasks.",
    skillId: "deck-developer-task",
  },
  {
    id: "deck-developer-apply-general",
    name: "deck-developer-apply-general",
    displayName: "General Apply Agent",
    description:
      "Implements small, shared, cross-cutting, config, script, or general tasks.",
    skillId: "deck-developer-apply-general",
  },
  {
    id: "deck-developer-apply-backend",
    name: "deck-developer-apply-backend",
    displayName: "Backend Apply Agent",
    description:
      "Implements backend/API/service/database/auth/server-side tasks.",
    skillId: "deck-developer-apply-backend",
  },
  {
    id: "deck-developer-apply-frontend",
    name: "deck-developer-apply-frontend",
    displayName: "Frontend Apply Agent",
    description:
      "Implements UI/component/state/accessibility/frontend test tasks.",
    skillId: "deck-developer-apply-frontend",
  },
  {
    id: "deck-developer-verify",
    name: "deck-developer-verify",
    displayName: "Verify Agent",
    description:
      "Checks compliance with specs, tasks, tests, build/typecheck, and basic design coherence.",
    skillId: "deck-developer-verify",
  },
  {
    id: "deck-developer-review",
    name: "deck-developer-review",
    displayName: "Review Agent",
    description:
      "Reviews engineering quality: architecture, security, scalability, maintainability.",
    skillId: "deck-developer-review",
  },
  {
    id: "deck-developer-archive",
    name: "deck-developer-archive",
    displayName: "Archive Agent",
    description:
      "Closes the change, preserves traceability, and updates project AI notes when useful.",
    skillId: "deck-developer-archive",
  },
  {
    id: "deck-init",
    name: "deck-init",
    displayName: "Init Agent",
    description:
      "Trigger: deck init, initialize deck, startsdd. Initialize SDD context, index codebase, bootstrap openspec.",
    skillId: "deck-init",
  },
  {
    id: "deck-onboard",
    name: "deck-onboard",
    displayName: "Onboard Agent",
    description:
      "Trigger: deck onboard, start sdd, learn sdd. Interactive SDD walkthrough using Deck's developer team.",
    skillId: "deck-onboard",
  },
] as const;

export function getDeveloperTeamCatalog(): readonly DeveloperTeamAgent[] {
  return DEVELOPER_TEAM_AGENTS;
}

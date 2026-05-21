/**
 * DeveloperTeamManifest — canonical intermediate representation for Developer Team installation.
 *
 * Core builds this manifest from:
 * - Canonical agent definitions and content (from content-registry)
 * - Optional model assignments (from ModelCatalog + caller overrides)
 * - Optional memory injection bundle (from AdaptiveMemoryProvider resolution)
 *
 * Adapters serialize this manifest to their runner-native format.
 *
 * REQ-DTM-001, REQ-DTM-003
 */

import { DEVELOPER_TEAM_AGENTS, type DeveloperTeamAgent } from "./catalog";
import { getAgentContent } from "./content-registry";
import { getDefaultForAgent } from "../../model-catalog";
import type {
  ModelCatalog,
  DeveloperTeamDefaultModelAssignment,
  ReasoningLevel,
} from "../../model-catalog";
import type {
  TeamEntry,
  MemoryInjectionBundle,
  MemoryDiagnostic,
  DeveloperTeamManifest,
  DeveloperTeamManifestAgent,
  DeveloperTeamManifestSkill,
} from "../../runner-capability";
import type { CapabilityInstructionBundle } from "./instruction-bundles/index";

// Re-export model catalog types for convenience
export type { ModelCatalog, DeveloperTeamDefaultModelAssignment, ReasoningLevel };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { DeveloperTeamManifest, DeveloperTeamManifestAgent, DeveloperTeamManifestSkill };

export type BuildManifestOptions = {
  team: TeamEntry;
  modelAssignments?: readonly DeveloperTeamModelAssignmentOverride[];
  memoryBundle?: MemoryInjectionBundle;
  memoryDiagnostics?: readonly MemoryDiagnostic[];
  /** Optional capability instruction bundle to compose into agent and skill content */
  capabilityInstructions?: CapabilityInstructionBundle;
};

export type DeveloperTeamModelAssignmentOverride = {
  agentId: string;
  modelId: string;
  reasoning?: ReasoningLevel;
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a canonical DeveloperTeamManifest from core content and optional inputs.
 *
 * The builder accepts optional inputs without knowing provider-specific details.
 * Memory injection is passed through unchanged — core does not build it.
 */
export function buildDeveloperTeamManifest(options: BuildManifestOptions): DeveloperTeamManifest {
  const { team, modelAssignments = [], memoryBundle, memoryDiagnostics = [], capabilityInstructions } = options;

  // Index overrides by agentId for fast lookup
  const overrideByAgent = new Map<string, DeveloperTeamModelAssignmentOverride>();
  for (const override of modelAssignments) {
    overrideByAgent.set(override.agentId, override);
  }

  // Build agent manifests
  const agents: DeveloperTeamManifestAgent[] = [];
  for (const agentDef of DEVELOPER_TEAM_AGENTS) {
    const content = getAgentContent(agentDef.id, { capabilityInstructions });
    const override = overrideByAgent.get(agentDef.id);
    const defaultModel = getDefaultForAgent(agentDef.id);

    const modelId = override?.modelId ?? defaultModel?.modelId;
    const reasoning = override?.reasoning ?? defaultModel?.reasoning;

    agents.push({
      agentId: agentDef.id,
      displayName: agentDef.displayName,
      instruction: content?.agentBody ?? buildPlaceholderAgentBody(agentDef),
      model: modelId,
      reasoning,
      memoryBundle: memoryBundle,
    });
  }

  // Build skill manifests
  const skills: DeveloperTeamManifestSkill[] = [];
  for (const agentDef of DEVELOPER_TEAM_AGENTS) {
    const content = getAgentContent(agentDef.id, { capabilityInstructions });

    skills.push({
      agentId: agentDef.id,
      skillId: agentDef.skillId,
      body: content?.skillBody ?? buildPlaceholderSkillBody(agentDef),
      memoryBundle: memoryBundle,
    });
  }

  return {
    team,
    agents,
    skills,
    memoryDiagnostics,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildPlaceholderAgentBody(agent: DeveloperTeamAgent): string {
  return [
    `# ${agent.displayName}`,
    "",
    `> ${agent.description}`,
    "",
    "## Project Standards (auto-resolved)",
    "",
    "<!-- Orchestrator will inject stack-specific rules at runtime. -->",
    "",
    "## Instructions",
    "",
    `<!-- Placeholder: ${agent.displayName} prompt implementation pending review of source methodology. -->`,
    "",
  ].join("\n");
}

function buildPlaceholderSkillBody(agent: DeveloperTeamAgent): string {
  return [
    `# ${agent.displayName} Skill`,
    "",
    `> ${agent.description}`,
    "",
    `<!-- Placeholder: ${agent.displayName} skill implementation pending review of source methodology. -->`,
    "",
    "## Instructions",
    "",
    "<!-- Placeholder: detailed skill methodology will be adapted from the matching source skill. -->",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Verification helpers
// ---------------------------------------------------------------------------

/**
 * Returns all agent IDs that have a default model assignment in the catalog.
 */
export function getCataloguedAgentIds(): readonly string[] {
  return DEVELOPER_TEAM_AGENTS.map((a) => a.id);
}

/**
 * Checks whether the manifest has a complete model assignment for every
 * Developer Team agent.
 */
export function isManifestModelComplete(manifest: DeveloperTeamManifest): boolean {
  return manifest.agents.every((agent) => agent.model !== undefined);
}

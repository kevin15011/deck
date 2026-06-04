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
import { getAgentContentResult, type AgentContent } from "./content-registry";
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
  DeveloperTeamManifestStandaloneSkill,
} from "../../runner-capability";
import type { CapabilityInstructionBundle } from "./instruction-bundles/index";
import { getStandaloneSkills, getStandaloneSkillBody } from "../../skills/external";

// Re-export model catalog types for convenience
export type { ModelCatalog, DeveloperTeamDefaultModelAssignment, ReasoningLevel };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { DeveloperTeamManifest, DeveloperTeamManifestAgent, DeveloperTeamManifestSkill, DeveloperTeamManifestStandaloneSkill };

export type BuildManifestOptions = {
  team: TeamEntry;
  modelAssignments?: readonly DeveloperTeamModelAssignmentOverride[];
  memoryBundle?: MemoryInjectionBundle;
  memoryDiagnostics?: readonly MemoryDiagnostic[];
  /** Optional capability instruction bundle to compose into agent and skill content */
  capabilityInstructions?: CapabilityInstructionBundle;
  /** When true, validate manifest completeness and add errors/warnings. Default: false */
  strict?: boolean;
};

/**
 * Result type for manifest building with diagnostic information.
 * In strict mode, errors and warnings capture validation issues.
 */
export interface ManifestBuildResult {
  manifest: DeveloperTeamManifest;
  warnings: string[];
  errors: string[];
}

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
 *
 * In strict mode, performs validations:
 * - Placeholder detection: warns if any agent uses placeholder content
 * - Model assignment validation: errors if modelAssignments references unknown agents
 * - Memory/capability conflict: warns if both memoryBundle and capabilityInstructions inject to same surface
 *
 * @returns ManifestBuildResult containing the manifest plus any warnings or errors
 */
export function buildDeveloperTeamManifest(options: BuildManifestOptions): ManifestBuildResult {
  const { team, modelAssignments = [], memoryBundle, memoryDiagnostics = [], capabilityInstructions, strict = false } = options;

  // Index overrides by agentId for fast lookup
  const overrideByAgent = new Map<string, DeveloperTeamModelAssignmentOverride>();
  for (const override of modelAssignments) {
    overrideByAgent.set(override.agentId, override);
  }

  const warnings: string[] = [];
  const errors: string[] = [];

  // Build agent manifests
  const agents: DeveloperTeamManifestAgent[] = [];
  for (const agentDef of DEVELOPER_TEAM_AGENTS) {
    const contentResult = getAgentContentResult(agentDef.id, { capabilityInstructions });
    const override = overrideByAgent.get(agentDef.id);
    const defaultModel = getDefaultForAgent(agentDef.id);

    const modelId = override?.modelId ?? defaultModel?.modelId;
    const reasoning = override?.reasoning ?? defaultModel?.reasoning;

    // Determine if we're using fallback/placeholder content
    let usedPlaceholder = false;
    if (contentResult.ok) {
      // Check if content has placeholder markers
      usedPlaceholder = contentResult.value.agentBody.includes("<!-- Placeholder:") ||
                       contentResult.value.agentBody.includes("pending review of source methodology");
    } else {
      // contentResult.ok is false — we're using the generated placeholder
      usedPlaceholder = true;
    }

    const instruction = contentResult.ok ? contentResult.value.agentBody : buildPlaceholderAgentBody(agentDef);

    agents.push({
      agentId: agentDef.id,
      displayName: agentDef.displayName,
      instruction,
      model: modelId,
      reasoning,
      memoryBundle: memoryBundle,
    });

    // Strict mode: check for placeholder
    if (strict && usedPlaceholder) {
      errors.push(`Agent '${agentDef.id}' has no real content (placeholder used)`);
    }
  }

  // Build skill manifests
  const skills: DeveloperTeamManifestSkill[] = [];
  for (const agentDef of DEVELOPER_TEAM_AGENTS) {
    const contentResult = getAgentContentResult(agentDef.id, { capabilityInstructions });

    const body = contentResult.ok ? contentResult.value.skillBody : buildPlaceholderSkillBody(agentDef);

    skills.push({
      agentId: agentDef.id,
      skillId: agentDef.skillId,
      body,
      memoryBundle: memoryBundle,
    });
  }

  // Build standalone skill manifests (not bound to agents)
  const standaloneSkills: DeveloperTeamManifestStandaloneSkill[] = [];
  for (const skillDef of getStandaloneSkills()) {
    const body = getStandaloneSkillBody(skillDef.skillId);
    if (body !== undefined) {
      standaloneSkills.push({
        skillId: skillDef.skillId,
        body,
      });
    }
  }

  // Strict mode: validate model assignments reference existing agents
  if (strict) {
    const catalogAgentIds = new Set(DEVELOPER_TEAM_AGENTS.map((a) => a.id));
    for (const override of modelAssignments) {
      if (!catalogAgentIds.has(override.agentId)) {
        errors.push(`Model assignment references unknown agent: '${override.agentId}'`);
      }
    }
  }

  // Strict mode: check memory/capability conflict per (agentId, surface)
  if (strict && memoryBundle && capabilityInstructions) {
    // Build sets of (agentId, surface) targeted by each bundle
    // Memory targets: specific agent IDs or '*' for global
    const memoryTargets = new Map<string, boolean>(); // key = "agentId:surface", value = isGlobal
    for (const frag of memoryBundle.instructions) {
      if (frag.agentIds && frag.agentIds.length > 0) {
        for (const agentId of frag.agentIds) {
          memoryTargets.set(`${agentId}:${frag.surface}`, false);
        }
      } else if (!frag.agentIds && !frag.skillIds) {
        // Global fragment — applies to all agents
        memoryTargets.set(`*:${frag.surface}`, true);
      }
    }

    // Capability targets: all are global (no per-agent targeting in current design)
    const capabilityHasGlobal = new Set<string>(); // surfaces with global capability injection
    for (const frag of capabilityInstructions.instructions) {
      capabilityHasGlobal.add(frag.surface);
    }

    // Report conflicts:
    // - Specific memory target + capability has global for same surface = conflict
    // - Global memory target + capability has global for same surface = conflict
    for (const [target, isGlobal] of memoryTargets) {
      const surface = target.split(":")[1];
      if (capabilityHasGlobal.has(surface)) {
        warnings.push(
          `Memory and capability both inject to ${target} — verify they don't conflict`,
        );
      }
    }
  }

  return {
    manifest: {
      team,
      agents,
      skills,
      standaloneSkills,
      memoryDiagnostics,
    },
    warnings,
    errors,
  };
}

/**
 * @deprecated Use buildDeveloperTeamManifest with { strict: false } for explicit behavior.
 *             This wrapper exists for backward compatibility.
 */
export function buildDeveloperTeamManifestLegacy(options: BuildManifestOptions): DeveloperTeamManifest {
  const result = buildDeveloperTeamManifest({ ...options, strict: false });
  return result.manifest;
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
 * Returns all canonical Developer Team agent IDs.
 * (Previously returned defaults; now returns the full agent list since defaults may be empty.)
 */
export function getDeveloperTeamAgentIds(): readonly string[] {
  return DEVELOPER_TEAM_AGENTS.map((a) => a.id);
}

/**
 * Checks whether the manifest has a complete model assignment for every
 * Developer Team agent.
 */
export function isManifestModelComplete(manifest: DeveloperTeamManifest): boolean {
  return manifest.agents.every((agent) => agent.model !== undefined);
}

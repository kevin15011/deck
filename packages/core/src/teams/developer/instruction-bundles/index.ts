/**
 * CapabilityInstructionBundle — runner-neutral package instruction bundle and helpers.
 *
 * Core builds aggregate instruction bundles from per-package canonical content.
 * Adapters read normalized config, resolve enabled package IDs, build the bundle,
 * and pass it to the content registry for composition.
 *
 * This module is parallel to but separate from Adaptive Memory. Package instructions
 * are official configured prompt content; adaptive memory is auxiliary context.
 * Both can coexist without interference.
 */

import { buildAdaptiveMemoryInstructionBundle } from "./adaptive-memory";
import { buildCodebaseMemoryInstructionBundle } from "./codebase-memory";
import { buildCodeEconomyInstructionBundle } from "./code-economy";
import { buildContextModeInstructionBundle } from "./context-mode";
import { buildRtkInstructionBundle } from "./rtk";
import { buildSerenaInstructionBundle, getSerenaToolPolicy } from "./serena";
import type { NormalizedDeckConfig } from "../../../config/deck-config";
import type { PackageInstructionRunnerId, PackageInstructionPackageId } from "../../../config/deck-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CapabilityInstructionSurface = "session" | "agent" | "skill";

export type CapabilityInstructionPackageId = "adaptive-memory" | "codebase-memory" | "code-economy" | "context-mode" | "rtk" | "serena";

export type CapabilityInstructionFragment = {
  packageId: CapabilityInstructionPackageId;
  surface: CapabilityInstructionSurface;
  markdown: string;
  teamId?: string;
  agentIds?: readonly string[];
  skillIds?: readonly string[];
};

export type CapabilityInstructionBundle = {
  instructions: readonly CapabilityInstructionFragment[];
};

export type CapabilityInstructionCompositionContext = {
  surface: CapabilityInstructionSurface;
  teamId?: string;
  agentId?: string;
  skillId?: string;
};

// ---------------------------------------------------------------------------
// Capability Tool Policy Types
// ---------------------------------------------------------------------------

/**
 * Target agents for capability tool policy.
 * These are the apply agents that receive symbolic editing tools when package is selected.
 */
export type CapabilityToolPolicyTargetAgents = readonly [
  "deck-developer-apply-backend",
  "deck-developer-apply-frontend",
  "deck-developer-apply-general",
];

/**
 * Tool policy for a capability package.
 * Declares which tools are enabled/disabled for specific agents and surfaces.
 */
export type CapabilityToolPolicy = {
  /** Package ID this policy applies to */
  packageId: CapabilityInstructionPackageId;
  /** Tools enabled for the target agents */
  enabledTools: readonly string[];
  /** Tools explicitly disabled (not exposed to agents) */
  disabledTools: readonly string[];
  /** Target agents that receive enabled tools when package is selected */
  targetAgents: CapabilityToolPolicyTargetAgents;
  /** Read-only tools available to ALL agents (including non-apply) */
  readOnlyTools?: readonly string[];
  /** Write-capable tools available ONLY to apply agents */
  writeTools?: readonly string[];
};

/**
 * Resolve tools for a specific agent based on its role.
 * Non-apply agents receive readOnlyTools only.
 * Apply agents receive readOnlyTools + writeTools.
 *
 * @param agentId - The agent ID to resolve tools for
 * @param policy - The capability tool policy
 * @returns Array of tool names the agent can use
 */
export function resolveToolsForAgent(
  agentId: string,
  policy: CapabilityToolPolicy,
): string[] {
  const isApplyAgent = policy.targetAgents.includes(agentId as CapabilityToolPolicyTargetAgents[number]);
  const readOnly = policy.readOnlyTools ?? [];
  const write = policy.writeTools ?? [];

  if (isApplyAgent) {
    // Apply agents get both read-only and write tools
    return [...readOnly, ...write];
  }
  // Non-apply agents get only read-only tools
  return [...readOnly];
}

/**
 * Bundle of capability tool policies per package.
 * Used by adapters to resolve dynamic tool lists for agents.
 */
export type CapabilityToolPolicyBundle = {
  /** Tool policies keyed by package ID */
  policies: Partial<Record<CapabilityInstructionPackageId, CapabilityToolPolicy>>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACKAGE_BUILDERS: Record<CapabilityInstructionPackageId, () => CapabilityInstructionBundle> = {
  "codebase-memory": buildCodebaseMemoryInstructionBundle,
  "code-economy": buildCodeEconomyInstructionBundle,
  "context-mode": buildContextModeInstructionBundle,
  rtk: buildRtkInstructionBundle,
  "adaptive-memory": buildAdaptiveMemoryInstructionBundle,
  serena: buildSerenaInstructionBundle,
};

// Canonical package order — used for deterministic bundle ordering
const PACKAGE_ORDER: CapabilityInstructionPackageId[] = [
  "codebase-memory",
  "code-economy",
  "context-mode",
  "rtk",
  "adaptive-memory",
  "serena",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the list of enabled package IDs for a given runner scope from
 * the normalized Deck config.
 */
export function getEnabledPackageInstructionIds(
  config: NormalizedDeckConfig,
  runner: PackageInstructionRunnerId,
): CapabilityInstructionPackageId[] {
  const runnerConfig = config.packageInstructions[runner];
  if (!runnerConfig) return [];

  const enabled: CapabilityInstructionPackageId[] = [];
  for (const pkg of PACKAGE_ORDER) {
    if (runnerConfig[pkg] === true) {
      enabled.push(pkg);
    }
  }
  return enabled;
}

/**
 * Build a CapabilityInstructionBundle from a list of enabled package IDs.
 *
 * Deduplicates input and preserves canonical package ordering.
 * Returns an empty bundle when no packages are enabled.
 */
export function buildCapabilityInstructionBundle(
  packageIds: readonly CapabilityInstructionPackageId[],
): CapabilityInstructionBundle {
  // Deduplicate while preserving canonical order
  const seen = new Set<CapabilityInstructionPackageId>();
  const unique: CapabilityInstructionPackageId[] = [];

  for (const pkg of PACKAGE_ORDER) {
    if ((packageIds as readonly string[]).includes(pkg) && !seen.has(pkg)) {
      seen.add(pkg);
      unique.push(pkg);
    }
  }

  // Collect all fragments from each package builder
  const allFragments: CapabilityInstructionFragment[] = [];
  for (const pkg of unique) {
    const builder = PACKAGE_BUILDERS[pkg];
    if (builder) {
      const bundle = builder();
      allFragments.push(...bundle.instructions);
    }
  }

  return { instructions: Object.freeze(allFragments) };
}

/**
 * Compose matching capability instruction fragments into a base string.
 *
 * Filtering rules (all must match for a fragment to be included):
 * - fragment.surface must equal context.surface
 * - If fragment.teamId is set, it must equal context.teamId
 * - If fragment.agentIds is set, it must include context.agentId
 * - If fragment.skillIds is set, it must include context.skillId
 *
 * When no matching fragments exist, returns the base string unchanged.
 * When matching fragments exist, appends a labeled section with all matching markdown.
 */
export function composeCapabilityInstructions(
  base: string,
  bundle: CapabilityInstructionBundle | undefined,
  context: CapabilityInstructionCompositionContext,
): string {
  if (!bundle || bundle.instructions.length === 0) {
    return base;
  }

  const matching = bundle.instructions.filter((fragment) => {
    // Surface must match
    if (fragment.surface !== context.surface) return false;

    // Team filter — only apply when context.teamId is defined
    if (fragment.teamId !== undefined && context.teamId !== undefined && fragment.teamId !== context.teamId) return false;

    // Agent filter
    if (fragment.agentIds !== undefined && fragment.agentIds.length > 0) {
      if (context.agentId === undefined || !fragment.agentIds.includes(context.agentId)) {
        return false;
      }
    }

    // Skill filter
    if (fragment.skillIds !== undefined && fragment.skillIds.length > 0) {
      if (context.skillId === undefined || !fragment.skillIds.includes(context.skillId)) {
        return false;
      }
    }

    return true;
  });

  if (matching.length === 0) {
    return base;
  }

  const fragmentTexts = matching.map((f) => f.markdown).join("\n\n");

  return `${base.trimEnd()}\n\n## Package Instructions (configured)\n\nThese instructions are enabled by the runner's native package instruction system.\n\n${fragmentTexts}\n`;
}

/**
 * Get the tool policy for a specific package if available.
 * Returns undefined when package doesn't have a defined tool policy.
 */
export function getCapabilityToolPolicy(
  packageId: CapabilityInstructionPackageId,
): CapabilityToolPolicy | undefined {
  if (packageId === "serena") {
    return getSerenaToolPolicy();
  }
  // Future packages can add their policies here
  return undefined;
}

/**
 * Build a CapabilityToolPolicyBundle from enabled package IDs.
 * Returns empty policies when no relevant packages are enabled.
 *
 * This helper is parallel to buildCapabilityInstructionBundle() but operates on
 * tool level rather than markdown text level. Used by adapters for dynamic tool
 * resolution.
 */
export function buildCapabilityToolPolicyBundle(
  packageIds: readonly CapabilityInstructionPackageId[],
): CapabilityToolPolicyBundle {
  const policies: Record<CapabilityInstructionPackageId, CapabilityToolPolicy> = {} as Record<
    CapabilityInstructionPackageId,
    CapabilityToolPolicy
  >;

  // Deduplicate while preserving order
  const unique = packageIds.filter((pkg, idx) => packageIds.indexOf(pkg) === idx);

  for (const pkg of unique) {
    const policy = getCapabilityToolPolicy(pkg);
    if (policy) {
      policies[pkg] = policy;
    }
  }

  // Cast to match the bundle type - empty when no policies added
  return { policies: policies } as CapabilityToolPolicyBundle;
}

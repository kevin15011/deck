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

import { buildCodebaseMemoryInstructionBundle } from "./codebase-memory";
import { buildContextModeInstructionBundle } from "./context-mode";
import { buildRtkInstructionBundle } from "./rtk";
import type { NormalizedDeckConfig } from "../../../config/deck-config";
import type { PackageInstructionRunnerId, PackageInstructionPackageId } from "../../../config/deck-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CapabilityInstructionSurface = "session" | "agent" | "skill";

export type CapabilityInstructionPackageId = "codebase-memory" | "context-mode" | "rtk";

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
// Constants
// ---------------------------------------------------------------------------

const PACKAGE_BUILDERS: Record<CapabilityInstructionPackageId, () => CapabilityInstructionBundle> = {
  "codebase-memory": buildCodebaseMemoryInstructionBundle,
  "context-mode": buildContextModeInstructionBundle,
  rtk: buildRtkInstructionBundle,
};

// Canonical package order — used for deterministic bundle ordering
const PACKAGE_ORDER: CapabilityInstructionPackageId[] = [
  "codebase-memory",
  "context-mode",
  "rtk",
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

  return `${base.trimEnd()}\n\n## Package Instructions (configured)\n\nThese instructions are enabled by \`.deck/config.json\` package instruction toggles.\n\n${fragmentTexts}\n`;
}
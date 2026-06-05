/**
 * Model configuration for OpenCode Developer Team agents.
 *
 * Default model assignments and reasoningEffort per agent role.
 * Mirrors the pattern from Pi's model-config.ts.
 *
 * Canonical model defaults are consumed from @deck/core's ModelCatalog.
 * This module provides OpenCode-specific overlays: opencode.json reading
 * and reasoningEffort mapping.
 *
 * @deprecated Import DeveloperTeamModelAssignments and DeveloperTeamThinkingAssignments
 * from @deck/core instead. These types are now runner-agnostic.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import { getModelCatalog, type DeveloperTeamDefaultModelAssignment } from "@deck/core";
import {
  resolveReasoningEffortSupport,
  type ResolveReasoningSupportInput,
} from "@deck/core";
import type {
  DeveloperTeamModelAssignments as CoreModelAssignments,
  DeveloperTeamThinkingAssignments as CoreThinkingAssignments,
} from "@deck/core";
import type { OpenCodeConfig } from "./types";

export type OpenCodeModelConfig = {
  model?: string; // undefined when not explicitly configured
  reasoningEffort?: "low" | "medium" | "high";
};

export type OpenCodeThinkingLevel = "off" | "low" | "medium" | "high";

export const OPENCODE_THINKING_LEVELS: readonly OpenCodeThinkingLevel[] = ["off", "low", "medium", "high"];

/**
 * @deprecated Use DeveloperTeamModelAssignments from @deck/core instead.
 * This type is now runner-agnostic and lives in @deck/core.
 */
export type DeveloperTeamModelAssignments = CoreModelAssignments;

/**
 * @deprecated Use DeveloperTeamThinkingAssignments from @deck/core instead.
 * This type is now runner-agnostic and lives in @deck/core.
 */
export type DeveloperTeamThinkingAssignments = CoreThinkingAssignments;

// ---------------------------------------------------------------------------
// Model configuration - EXPLICIT ONLY
//
// REQ-MC-005: No hardcoded defaults. Models must be explicitly configured
// by the user via installer/config flow. This adapter reads user config
// from opencode.json and applies CLI overrides only.
// ---------------------------------------------------------------------------

// Empty defaults - no hardcoded models.
// Models are only set when explicitly configured via CLI or config file.
const EMPTY_DEFAULT_MODELS: Record<string, OpenCodeModelConfig> = Object.freeze({});

export const DEFAULT_OPENCODE_MODELS: Readonly<Record<string, OpenCodeModelConfig>> = EMPTY_DEFAULT_MODELS;

// ---------------------------------------------------------------------------
// Thinking/reasoning helpers - delegate to core resolver
// ---------------------------------------------------------------------------

export type SupportsThinkingOptions = {
  /** Explicit runner signal for reasoning support. When provided, wins over catalog. */
  runnerSupportsReasoning?: boolean | null;
};

/**
 * Check if a model supports thinking/reasoning effort.
 *
 * Uses the core resolver with precedence:
 * 1. Runner signal (if provided) - wins over catalog
 * 2. Catalog fallback (supportsReasoning explicit or derived from capabilities)
 * 3. Unknown/no confirmation - returns false
 *
 * @param model - Model ID (e.g., "anthropic/claude-sonnet-4")
 * @param options - Optional runner signal
 * @returns true if model supports reasoning, false otherwise
 */
export function supportsThinkingForOpenCodeModel(model?: string, options?: SupportsThinkingOptions): boolean {
  if (!model) {
    // No model = default to true (allow user to select)
    return true;
  }

  const catalog = getModelCatalog();

  // Build resolver input
  const resolverInput: ResolveReasoningSupportInput = {
    modelId: model,
    runnerSupportsReasoning: options?.runnerSupportsReasoning,
    catalog,
  };

  const result = resolveReasoningEffortSupport(resolverInput);
  return result.supportsReasoning;
}

/**
 * Get default thinking level for a model.
 *
 * @param model - Model ID
 * @param options - Optional runner signal
 * @returns "low" if model supports thinking, "off" otherwise
 */
export function getDefaultThinkingForOpenCodeModel(model?: string, options?: SupportsThinkingOptions): OpenCodeThinkingLevel {
  return supportsThinkingForOpenCodeModel(model, options) ? "low" : "off";
}

/**
 * Resolve thinking level for a model.
 *
 * Returns undefined when the resolver doesn't confirm support, regardless of requested level.
 *
 * @param model - Model ID
 * @param requested - Requested thinking level
 * @param options - Optional runner signal
 * @returns The thinking level if supported, undefined otherwise
 */
export function resolveThinkingForOpenCodeModel(
  model: string | undefined,
  requested?: OpenCodeThinkingLevel,
  options?: SupportsThinkingOptions,
): OpenCodeThinkingLevel | undefined {
  if (!supportsThinkingForOpenCodeModel(model, options)) {
    return undefined; // Model doesn't support reasoning
  }

  return requested ?? getDefaultThinkingForOpenCodeModel(model, options);
}

export function parseOpenCodeThinkingLevel(value: string | undefined): OpenCodeThinkingLevel | undefined {
  const normalized = value?.trim();
  return OPENCODE_THINKING_LEVELS.includes(normalized as OpenCodeThinkingLevel) ? (normalized as OpenCodeThinkingLevel) : undefined;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Capability map type: modelId -> runner signal (true/false)
 * null means no explicit runner signal (use catalog)
 */
export type ReasoningCapabilityMap = Record<string, boolean | null>;

/**
 * Resolve the model config for an agent.
 *
 * Priority: CLI override > config overrides > defaults.
 * Filters reasoningEffort based on model capability.
 *
 * @param agentId       - Agent identifier
 * @param cliOverride   - Model override from CLI flag (highest priority)
 * @param configOverrides - Per-agent model overrides from config file
 * @param reasoningEffortOverrides - Per-agent reasoning effort overrides
 * @param catalog - Optional catalog (uses global if not provided)
 * @param capabilityMap - Optional map of modelId -> runner signal
 */
export function resolveModelConfig(
  agentId: string,
  cliOverride?: string,
  configOverrides?: Record<string, string>,
  reasoningEffortOverrides?: Record<string, OpenCodeThinkingLevel>,
  catalog?: ReturnType<typeof getModelCatalog>,
  capabilityMap?: ReasoningCapabilityMap,
): OpenCodeModelConfig {
  const defaults = DEFAULT_OPENCODE_MODELS[agentId]; // undefined when no defaults

  // Determine the model for this agent
  const model = cliOverride ?? configOverrides?.[agentId];

  // If no defaults, no config, no CLI override, and no reasoning override: return empty/undefined
  // This prevents inventing a model when none is configured
  // Note: empty string cliOverride is treated as absent (falsy in || check below)
  const hasModelOverride = model !== undefined && model !== "";
  const hasReasoningOverride = reasoningEffortOverrides && Object.prototype.hasOwnProperty.call(reasoningEffortOverrides, agentId);
  if (!defaults && !hasModelOverride && !hasReasoningOverride) {
    return {}; // Empty config - no model set
  }

  const resolveEffort = (): "low" | "medium" | "high" | undefined => {
    const override = reasoningEffortOverrides?.[agentId];
    if (override === "off") return undefined;
    if (override !== undefined) {
      // Check if model supports reasoning before returning the override
      if (!model) {
        // No model = no reasoning (REQ-OMC-005)
        return undefined;
      }

      // Get runner signal from capabilityMap if available
      const runnerSignal = capabilityMap?.[model] ?? null;

      // Build resolver input
      const catalogToUse = catalog ?? getModelCatalog();
      const resolverInput: ResolveReasoningSupportInput = {
        modelId: model,
        runnerSupportsReasoning: runnerSignal !== null ? runnerSignal : undefined,
        catalog: catalogToUse,
      };

      const result = resolveReasoningEffortSupport(resolverInput);
      if (!result.supportsReasoning) {
        // Model doesn't support reasoning - omit the key
        return undefined;
      }

      return override;
    }
    // If no override, check if we have defaults and validate them
    if (defaults?.reasoningEffort) {
      // Need to validate defaults against the resolver
      if (!model) {
        // No model = no reasoning (REQ-OMC-005)
        return undefined;
      }
      // Get runner signal from capabilityMap if available
      const runnerSignal = capabilityMap?.[model] ?? null;
      // Build resolver input
      const catalogToUse = catalog ?? getModelCatalog();
      const resolverInput: ResolveReasoningSupportInput = {
        modelId: model,
        runnerSupportsReasoning: runnerSignal !== null ? runnerSignal : undefined,
        catalog: catalogToUse,
      };
      const result = resolveReasoningEffortSupport(resolverInput);
      if (!result.supportsReasoning) {
        // Model doesn't support reasoning - omit the key
        return undefined;
      }
      return defaults.reasoningEffort;
    }
    return undefined;
  };

  if (cliOverride !== undefined) {
    return { model: cliOverride, reasoningEffort: resolveEffort() };
  }

  if (configOverrides && Object.prototype.hasOwnProperty.call(configOverrides, agentId)) {
    return { model: configOverrides[agentId], reasoningEffort: resolveEffort() };
  }

  // Handle reasoning-only override (no model)
  if (hasReasoningOverride) {
    // No model = no reasoning (REQ-OMC-005)
    if (!model) {
      return {};
    }
    return { reasoningEffort: resolveEffort() };
  }

  return { ...defaults };
}

// ---------------------------------------------------------------------------
// Config file reading
// ---------------------------------------------------------------------------

export type OpenCodeDeveloperTeamModelConfigAssignments = {
  modelAssignments: Record<string, string>;
  thinkingAssignments: Record<string, OpenCodeThinkingLevel>;
  /** Effective thinking assignments after filtering by model capability */
  effectiveThinkingAssignments?: Record<string, OpenCodeThinkingLevel>;
};

export function readOpenCodeDeveloperTeamModelConfigAssignments(
  configDir?: string,
  options?: { exists?: typeof existsSync; readFile?: (path: string, encoding: "utf-8") => string },
): OpenCodeDeveloperTeamModelConfigAssignments {
  const exists = options?.exists ?? existsSync;
  const readFile = options?.readFile ?? readFileSync;

  const configPath = join(configDir ?? join(homedir(), ".config", "opencode"), "opencode.json");
  const modelAssignments: Record<string, string> = {};
  const thinkingAssignments: Record<string, OpenCodeThinkingLevel> = {};
  const effectiveThinkingAssignments: Record<string, OpenCodeThinkingLevel> = {};

  if (!exists(configPath)) {
    return { modelAssignments, thinkingAssignments };
  }

  try {
    const config = JSON.parse(readFile(configPath, "utf-8")) as {
      agent?: Record<string, { model?: string; reasoningEffort?: string }>;
    };

    const agentConfig = config.agent ?? {};
    const catalog = getModelCatalog();

    for (const agent of DEVELOPER_TEAM_AGENTS) {
      const entry = agentConfig[agent.id];
      if (entry?.model) {
        modelAssignments[agent.id] = entry.model;

        // Parse and validate thinking level
        const parsed = parseOpenCodeThinkingLevel(entry.reasoningEffort);
        if (parsed) {
          thinkingAssignments[agent.id] = parsed;

          // Check if model actually supports reasoning using resolver
          const resolverInput: ResolveReasoningSupportInput = {
            modelId: entry.model,
            catalog,
          };
          const result = resolveReasoningEffortSupport(resolverInput);

          // Only include effective thinking if model supports it
          if (result.supportsReasoning) {
            effectiveThinkingAssignments[agent.id] = parsed;
          }
          // If not supported, effective is undefined (won't be shown in TUI)
        }
      }
    }
  } catch {
    // Config unreadable — return empty
  }

  return {
    modelAssignments,
    thinkingAssignments,
    effectiveThinkingAssignments,
  };
}

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
// Thinking/reasoning helpers
// ---------------------------------------------------------------------------

export function supportsThinkingForOpenCodeModel(model?: string): boolean {
  if (!model) return true;
  // Models that don't support reasoningEffort
  if (model.endsWith("/deepseek-v4-flash")) return false;
  return true;
}

export function getDefaultThinkingForOpenCodeModel(model?: string): OpenCodeThinkingLevel {
  return supportsThinkingForOpenCodeModel(model) ? "low" : "off";
}

export function resolveThinkingForOpenCodeModel(model: string | undefined, requested?: OpenCodeThinkingLevel): OpenCodeThinkingLevel | undefined {
  if (!supportsThinkingForOpenCodeModel(model)) return undefined;
  return requested ?? getDefaultThinkingForOpenCodeModel(model);
}

export function parseOpenCodeThinkingLevel(value: string | undefined): OpenCodeThinkingLevel | undefined {
  const normalized = value?.trim();
  return OPENCODE_THINKING_LEVELS.includes(normalized as OpenCodeThinkingLevel) ? (normalized as OpenCodeThinkingLevel) : undefined;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the model config for an agent.
 *
 * Priority: CLI override > config overrides > defaults.
 *
 * @param agentId       - Agent identifier
 * @param cliOverride   - Model override from CLI flag (highest priority)
 * @param configOverrides - Per-agent model overrides from config file
 */
export function resolveModelConfig(
  agentId: string,
  cliOverride?: string,
  configOverrides?: Record<string, string>,
  reasoningEffortOverrides?: Record<string, OpenCodeThinkingLevel>,
): OpenCodeModelConfig {
  const defaults = DEFAULT_OPENCODE_MODELS[agentId]; // undefined when no defaults

  // If no defaults, no config, no CLI override, and no reasoning override: return empty/undefined
  // This prevents inventing a model when none is configured
  // Note: empty string cliOverride is treated as absent (falsy in || check below)
  const hasModelOverride = cliOverride || (configOverrides && Object.prototype.hasOwnProperty.call(configOverrides, agentId));
  const hasReasoningOverride = reasoningEffortOverrides && Object.prototype.hasOwnProperty.call(reasoningEffortOverrides, agentId);
  if (!defaults && !hasModelOverride && !hasReasoningOverride) {
    return {}; // Empty config - no model set
  }

  const resolveEffort = (): "low" | "medium" | "high" | undefined => {
    const override = reasoningEffortOverrides?.[agentId];
    if (override === "off") return undefined;
    if (override !== undefined) return override;
    return defaults?.reasoningEffort;
  };

  if (cliOverride !== undefined) {
    return { model: cliOverride, reasoningEffort: resolveEffort() };
  }

  if (configOverrides && Object.prototype.hasOwnProperty.call(configOverrides, agentId)) {
    return { model: configOverrides[agentId], reasoningEffort: resolveEffort() };
  }

  // Handle reasoning-only override (no model)
  if (hasReasoningOverride) {
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

  if (!exists(configPath)) {
    return { modelAssignments, thinkingAssignments };
  }

  try {
    const config = JSON.parse(readFile(configPath, "utf-8")) as {
      agent?: Record<string, { model?: string; reasoningEffort?: string }>;
    };

    const agentConfig = config.agent ?? {};
    for (const agent of DEVELOPER_TEAM_AGENTS) {
      const entry = agentConfig[agent.id];
      if (entry?.model) {
        modelAssignments[agent.id] = entry.model;
        const parsed = parseOpenCodeThinkingLevel(entry.reasoningEffort);
        if (parsed) thinkingAssignments[agent.id] = parsed;
      }
    }
  } catch {
    // Config unreadable — return empty
  }

  return { modelAssignments, thinkingAssignments };
}
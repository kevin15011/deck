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
  model: string;
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
// Default model map — consumed from core ModelCatalog
// ---------------------------------------------------------------------------

// Build from core's canonical developerTeamDefaults, mapping to OpenCode's
// reasoningEffort field name. The model IDs are canonical; the reasoning
// mapping is OpenCode-specific.
function buildDefaultOpenCodeModels(): Record<string, OpenCodeModelConfig> {
  const catalog = getModelCatalog();
  const result: Record<string, OpenCodeModelConfig> = {};

  for (const assignment of catalog.developerTeamDefaults) {
    result[assignment.agentId] = {
      model: assignment.modelId,
      reasoningEffort: assignment.reasoning ? mapReasoningToOpenCode(assignment.reasoning) : undefined,
    };
  }

  return Object.freeze(result);
}

function mapReasoningToOpenCode(reasoning: import("@deck/core").ReasoningLevel): "low" | "medium" | "high" | undefined {
  switch (reasoning) {
    case "high":
    case "xhigh":
      return "high";
    case "medium":
      return "medium";
    case "minimal":
    case "low":
      return "low";
    case "off":
    default:
      return undefined;
  }
}

export const DEFAULT_OPENCODE_MODELS: Readonly<Record<string, OpenCodeModelConfig>> = buildDefaultOpenCodeModels();

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
  const defaults = DEFAULT_OPENCODE_MODELS[agentId] ?? { model: "" };

  const resolveEffort = (): "low" | "medium" | "high" | undefined => {
    const override = reasoningEffortOverrides?.[agentId];
    if (override === "off") return undefined;
    if (override !== undefined) return override;
    return defaults.reasoningEffort;
  };

  if (cliOverride !== undefined) {
    return { model: cliOverride, reasoningEffort: resolveEffort() };
  }

  if (configOverrides && Object.prototype.hasOwnProperty.call(configOverrides, agentId)) {
    return { model: configOverrides[agentId], reasoningEffort: resolveEffort() };
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
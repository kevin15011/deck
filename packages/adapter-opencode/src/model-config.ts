/**
 * Model configuration for OpenCode Developer Team agents.
 *
 * Default model assignments and reasoningEffort per agent role.
 * Mirrors the pattern from Pi's model-config.ts.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import type { OpenCodeConfig } from "./types";

export type OpenCodeModelConfig = {
  model: string;
  reasoningEffort?: "low" | "medium" | "high";
};

export type OpenCodeThinkingLevel = "off" | "low" | "medium" | "high";

export const OPENCODE_THINKING_LEVELS: readonly OpenCodeThinkingLevel[] = ["off", "low", "medium", "high"];

// ---------------------------------------------------------------------------
// Default model map — 12 agents
// ---------------------------------------------------------------------------

export const DEFAULT_OPENCODE_MODELS: Record<string, OpenCodeModelConfig> = {
  "deck-developer-orchestrator": { model: "openai/gpt-5.5", reasoningEffort: "high" },
  "deck-developer-explorer": { model: "opencode-go/kimi-k2.6" },
  "deck-developer-proposal": { model: "opencode-go/kimi-k2.6" },
  "deck-developer-spec": { model: "zai-coding-plan/glm-5.1" },
  "deck-developer-design": { model: "openai/gpt-5.5" },
  "deck-developer-task": { model: "zai-coding-plan/glm-5.1" },
  "deck-developer-apply-general": { model: "minimax-coding-plan/MiniMax-M2.7" },
  "deck-developer-apply-backend": { model: "minimax-coding-plan/MiniMax-M2.7" },
  "deck-developer-apply-frontend": { model: "minimax-coding-plan/MiniMax-M2.7" },
  "deck-developer-verify": { model: "openai/gpt-5.5" },
  "deck-developer-review": { model: "opencode-go/kimi-k2.6" },
  "deck-developer-archive": { model: "opencode-go/deepseek-v4-flash" },
};

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
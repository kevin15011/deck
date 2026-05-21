/**
 * Shared types for OpenCode config and agent entries.
 */

/**
 * Top-level OpenCode config shape.
 * Only defines the fields we care about; others are preserved as `[key: string]: unknown`.
 */
export type OpenCodeConfig = {
  agent?: Record<string, AgentEntry>;
  mcp?: Record<string, unknown>;
  plugin?: string[];
  model?: string;
  provider?: Record<string, unknown>;
  permission?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * An agent entry in opencode.json's `agent` section.
 */
export type AgentEntry = {
  description: string;
  mode: "primary" | "subagent";
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
  /** Prompt reference in OpenCode's {file:/absolute/path} format */
  prompt: string;
  tools?: Record<string, boolean>;
  permission?: { task?: Record<string, string> };
  hidden?: boolean;
  variant?: string;
};
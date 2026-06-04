/**
 * ModelCatalog — canonical model metadata and Developer Team default assignments.
 *
 * This catalog is the single source of truth for:
 * - Which model providers exist
 * - Which models each provider offers
 * - What capabilities each model has
 * - Default model assignments for Developer Team agents
 *
 * The catalog is intentionally free of runner-specific field names (thinkingLevel,
 * reasoningEffort), environment variable names, or runtime configuration keys.
 * Adapters map these canonical types to their native equivalents.
 *
 * REQ-MC-001, REQ-MC-003, REQ-MC-004
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelCapability =
  | "tool-use"
  | "vision"
  | "reasoning"
  | "local"
  | (string & {});

export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type ModelProviderEntry = {
  id: string;
  displayName: string;
};

export type ModelEntry = {
  id: string;
  displayName: string;
  providerId: string;
  capabilities: readonly ModelCapability[];
  supportsReasoning?: boolean;
};

export type DeveloperTeamDefaultModelAssignment = {
  agentId: string;
  modelId: string;
  reasoning?: ReasoningLevel;
};

export type ModelCatalog = {
  providers: readonly ModelProviderEntry[];
  models: readonly ModelEntry[];
  developerTeamDefaults: readonly DeveloperTeamDefaultModelAssignment[];
};

// ---------------------------------------------------------------------------
// Canonical provider registry
// ---------------------------------------------------------------------------

const PROVIDERS: readonly ModelProviderEntry[] = [
  { id: "opencode-go", displayName: "OpenCode Go" },
  { id: "openai-codex", displayName: "OpenAI Subscription / Codex" },
  { id: "anthropic", displayName: "Anthropic (Claude)" },
  { id: "openai", displayName: "OpenAI API" },
  { id: "google", displayName: "Google (Gemini)" },
  { id: "groq", displayName: "Groq" },
  { id: "ollama", displayName: "Ollama (local)" },
  { id: "mistral", displayName: "Mistral AI" },
  { id: "zai-coding-plan", displayName: "ZAI Coding Plan" },
  { id: "minimax-coding-plan", displayName: "MiniMax Coding Plan" },
];

// ---------------------------------------------------------------------------
// Canonical model registry
// ---------------------------------------------------------------------------

const MODELS: readonly ModelEntry[] = [
  // opencode-go
  {
    id: "opencode-go/kimi-k2.6",
    displayName: "Kimi K2.6",
    providerId: "opencode-go",
    capabilities: ["tool-use", "reasoning"],
  },
  {
    id: "opencode-go/qwen3.6-plus",
    displayName: "Qwen 3.6 Plus",
    providerId: "opencode-go",
    capabilities: ["tool-use", "reasoning"],
  },
  {
    id: "opencode-go/deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    providerId: "opencode-go",
    capabilities: ["tool-use", "reasoning"],
  },
  {
    id: "opencode-go/deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    providerId: "opencode-go",
    capabilities: ["tool-use"],
    supportsReasoning: false,
  },
  // openai-codex
  {
    id: "openai-codex/gpt-5.5",
    displayName: "GPT-5.5",
    providerId: "openai-codex",
    capabilities: ["tool-use", "reasoning"],
  },
  {
    id: "openai-codex/gpt-5.4",
    displayName: "GPT-5.4",
    providerId: "openai-codex",
    capabilities: ["tool-use", "reasoning"],
  },
  {
    id: "openai-codex/gpt-5.1-codex-mini",
    displayName: "GPT-5.1 Codex Mini",
    providerId: "openai-codex",
    capabilities: ["tool-use", "reasoning"],
  },
  // anthropic
  {
    id: "anthropic/claude-sonnet-4",
    displayName: "Claude Sonnet 4",
    providerId: "anthropic",
    capabilities: ["tool-use", "vision", "reasoning"],
  },
  {
    id: "anthropic/claude-opus-4",
    displayName: "Claude Opus 4",
    providerId: "anthropic",
    capabilities: ["tool-use", "vision", "reasoning"],
  },
  {
    id: "anthropic/claude-haiku-4",
    displayName: "Claude Haiku 4",
    providerId: "anthropic",
    capabilities: ["tool-use", "vision", "reasoning"],
  },
  // openai
  {
    id: "openai/gpt-4o",
    displayName: "GPT-4o",
    providerId: "openai",
    capabilities: ["tool-use", "vision"],
  },
  {
    id: "openai/gpt-4o-mini",
    displayName: "GPT-4o Mini",
    providerId: "openai",
    capabilities: ["tool-use"],
  },
  {
    id: "openai/gpt-4-turbo",
    displayName: "GPT-4 Turbo",
    providerId: "openai",
    capabilities: ["tool-use", "vision"],
  },
  {
    id: "openai/gpt-5.5",
    displayName: "GPT-5.5",
    providerId: "openai",
    capabilities: ["tool-use", "reasoning"],
  },
  // google
  {
    id: "google/gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    providerId: "google",
    capabilities: ["tool-use", "vision", "reasoning"],
  },
  {
    id: "google/gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    providerId: "google",
    capabilities: ["tool-use", "vision"],
  },
  // groq
  {
    id: "groq/llama-3.3-70b",
    displayName: "Llama 3.3 70B",
    providerId: "groq",
    capabilities: ["tool-use"],
  },
  {
    id: "groq/mixtral-8x7b",
    displayName: "Mixtral 8x7B",
    providerId: "groq",
    capabilities: ["tool-use"],
  },
  // ollama
  {
    id: "ollama/llama3.3",
    displayName: "Llama 3.3",
    providerId: "ollama",
    capabilities: ["tool-use", "local"],
  },
  {
    id: "ollama/qwen2.5-coder",
    displayName: "Qwen 2.5 Coder",
    providerId: "ollama",
    capabilities: ["tool-use", "local"],
  },
  {
    id: "ollama/deepseek-coder-v2",
    displayName: "DeepSeek Coder V2",
    providerId: "ollama",
    capabilities: ["tool-use", "local"],
  },
  // mistral
  {
    id: "mistral/mistral-large",
    displayName: "Mistral Large",
    providerId: "mistral",
    capabilities: ["tool-use", "reasoning"],
  },
  {
    id: "mistral/mistral-medium",
    displayName: "Mistral Medium",
    providerId: "mistral",
    capabilities: ["tool-use"],
  },
  // zai-coding-plan
  {
    id: "zai-coding-plan/glm-5.1",
    displayName: "GLM-5.1",
    providerId: "zai-coding-plan",
    capabilities: ["tool-use", "reasoning"],
  },
  // minimax-coding-plan
  {
    id: "minimax-coding-plan/MiniMax-M2.7",
    displayName: "MiniMax M2.7",
    providerId: "minimax-coding-plan",
    capabilities: ["tool-use", "reasoning"],
  },
];

// ---------------------------------------------------------------------------
// Developer Team default model assignments
//
// REQ-MC-005: Developer Team model configuration is now EXPLICIT ONLY.
// The only source of truth for models is the model installation/configuration
// flow (via installer/config). There are NO hardcoded defaults in core.
//
// Adapters (OpenCode, Pi) must read model configuration from user config
// files and NOT from any hardcoded defaults in the codebase.
// ---------------------------------------------------------------------------

const DEVELOPER_TEAM_DEFAULTS: readonly DeveloperTeamDefaultModelAssignment[] = [];

// ---------------------------------------------------------------------------
// Catalog export
// ---------------------------------------------------------------------------

export const MODEL_CATALOG: ModelCatalog = Object.freeze({
  providers: PROVIDERS,
  models: MODELS,
  developerTeamDefaults: DEVELOPER_TEAM_DEFAULTS,
});

export function getModelCatalog(): ModelCatalog {
  return MODEL_CATALOG;
}

export function getProviders(): readonly ModelProviderEntry[] {
  return PROVIDERS;
}

export function getModels(): readonly ModelEntry[] {
  return MODELS;
}

export function getDeveloperTeamDefaults(): readonly DeveloperTeamDefaultModelAssignment[] {
  return DEVELOPER_TEAM_DEFAULTS;
}

export function findModel(modelId: string): ModelEntry | undefined {
  return MODELS.find((m) => m.id === modelId);
}

export function findProvider(providerId: string): ModelProviderEntry | undefined {
  return PROVIDERS.find((p) => p.id === providerId);
}

export function getModelsForProvider(providerId: string): readonly ModelEntry[] {
  return MODELS.filter((m) => m.providerId === providerId);
}

export function getDefaultForAgent(agentId: string): DeveloperTeamDefaultModelAssignment | undefined {
  return DEVELOPER_TEAM_DEFAULTS.find((a) => a.agentId === agentId);
}

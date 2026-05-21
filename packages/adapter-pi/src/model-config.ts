/**
 * Pi model configuration for Developer Team.
 *
 * Detects configured providers from Pi settings, `pi --list-models`, and
 * environment variable fallbacks. Offers model choices per provider and
 * tracks agent-level model assignments.
 *
 * The canonical model data is consumed from @deck/core's ModelCatalog.
 * This module provides Pi-specific overlays: env-var mapping,
 * `pi --list-models` parsing, and PiThinkingLevel mapping.
 */

import { getProviders, getModelsForProvider, type ModelProviderEntry } from "@deck/core";

export type PiProvider = {
  id: string;
  displayName: string;
  envVars: readonly string[];
} & ModelProviderEntry;

export type PiModel = {
  id: string;
  displayName: string;
  providerId: string;
  thinking?: boolean;
};

export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export const PI_THINKING_LEVELS: readonly PiThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

export type DeveloperTeamModelAssignments = Record<string, string>;
export type DeveloperTeamThinkingAssignments = Record<string, PiThinkingLevel>;

export type DeveloperTeamModelConfigAssignments = {
  modelAssignments: DeveloperTeamModelAssignments;
  thinkingAssignments: DeveloperTeamThinkingAssignments;
};

export type PiSettings = {
  defaultProvider?: string;
  defaultModel?: string;
};

// ---------------------------------------------------------------------------
// Canonical provider registry (consumed from core)
// ---------------------------------------------------------------------------

// Pi-specific provider metadata: env vars for detection
const PI_PROVIDER_ENV_VARS: Record<string, readonly string[]> = {
  "opencode-go": ["OPENCODE_API_KEY"],
  "openai-codex": ["OPENAI_API_KEY"],
  "anthropic": ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"],
  "openai": ["OPENAI_API_KEY"],
  "google": ["GEMINI_API_KEY"],
  "groq": ["GROQ_API_KEY"],
  "ollama": ["OLLAMA_HOST"],
  "mistral": ["MISTRAL_API_KEY"],
};

export const PI_PROVIDERS: readonly PiProvider[] = getProviders().map((p) => ({
  ...p,
  envVars: PI_PROVIDER_ENV_VARS[p.id] ?? [],
})) as readonly PiProvider[];

// ---------------------------------------------------------------------------
// Canonical model registry (consumed from core)
// ---------------------------------------------------------------------------

// Build DEFAULT_MODELS_BY_PROVIDER from core's model catalog at module load time.
// This eliminates duplication between Pi's hardcoded model list and the canonical
// catalog in core. The data is identical; only the source differs.
function buildDefaultModelsFromCore(): Readonly<Record<string, readonly PiModel[]>> {
  try {
    // Dynamic import to avoid any potential circular dependency issues during module init
    const { getProviders, getModelsForProvider } = require("@deck/core");
    const result: Record<string, readonly PiModel[]> = {};
    for (const provider of getProviders()) {
      const models = getModelsForProvider(provider.id);
      if (models.length > 0) {
        result[provider.id] = models.map((m: { id: string; displayName: string; providerId: string }) => ({
          id: m.id,
          displayName: m.displayName,
          providerId: m.providerId,
        }));
      }
    }
    return Object.freeze(result);
  } catch {
    // Fallback: empty record. Tests or edge cases that don't need model data
    // will use listModelsForProvider with explicit modelsOutput.
    return Object.freeze({});
  }
}

export const DEFAULT_MODELS_BY_PROVIDER: Readonly<Record<string, readonly PiModel[]>> = buildDefaultModelsFromCore();

export type DetectProvidersOptions = {
  env?: Record<string, string | undefined>;
  settings?: PiSettings;
  settingsPath?: string;
  readFile?: (path: string, encoding: "utf-8") => string;
  runCommand?: (command: string, args: string[]) => { stdout: string; stderr?: string; exitCode: number };
};

export function detectConfiguredProviders(options?: DetectProvidersOptions): PiProvider[] {
  const env = options?.env ?? process.env;
  const providerIds = new Set<string>();

  const settings = options?.settings ?? readPiSettings(options);

  if (settings?.defaultProvider) {
    providerIds.add(settings.defaultProvider);
  }

  if (options?.runCommand) {
    try {
      const result = options.runCommand("pi", ["--list-models"]);
      if (result.exitCode === 0) {
        const output = result.stdout || result.stderr || "";
        for (const providerId of parsePiListModelProviders(output)) {
          providerIds.add(providerId);
        }
      }
    } catch {
      // Fall through to env-based detection.
    }
  }

  for (const provider of PI_PROVIDERS) {
    if (provider.envVars.some((envVar) => hasValue(env[envVar]))) {
      providerIds.add(provider.id);
    }
  }

  return [...providerIds].map(resolveProvider).filter((provider): provider is PiProvider => provider !== undefined);
}

function readPiSettings(options?: DetectProvidersOptions): PiSettings | undefined {
  if (!options?.settingsPath || !options.readFile) return undefined;
  try {
    return JSON.parse(options.readFile(options.settingsPath, "utf-8")) as PiSettings;
  } catch {
    return undefined;
  }
}

export type ListModelsOptions = {
  runCommand?: (command: string, args: string[]) => { stdout: string; stderr?: string; exitCode: number };
  modelsOutput?: string;
};

export type PiModelInventory = {
  providers: PiProvider[];
  modelsByProvider: Record<string, PiModel[]>;
};

export function listModelsForProvider(providerId: string, options?: ListModelsOptions): PiModel[] {
  const defaults = DEFAULT_MODELS_BY_PROVIDER[providerId];

  if (options?.modelsOutput) {
    const parsed = parsePiListModelsOutput(options.modelsOutput, providerId);
    if (parsed.length > 0) return parsed;
  }

  // Prefer pi --list-models when available and testable.
  if (options?.runCommand) {
    try {
      const result = options.runCommand("pi", ["--list-models"]);
      if (result.exitCode === 0) {
        const output = result.stdout || result.stderr || "";
        const parsed = parsePiListModelsOutput(output, providerId);
        if (parsed.length > 0) return parsed;
      }
    } catch {
      // Fall back to defaults
    }
  }

  return defaults ? [...defaults] : [];
}

export function buildModelInventoryFromPiListModels(stdout: string): PiModelInventory {
  const modelsByProvider: Record<string, PiModel[]> = {};

  for (const providerId of parsePiListModelProviders(stdout)) {
    const models = parsePiListModelsOutput(stdout, providerId);
    if (models.length > 0) {
      modelsByProvider[providerId] = models;
    }
  }

  return {
    providers: Object.keys(modelsByProvider).map(resolveProvider).filter((provider): provider is PiProvider => provider !== undefined),
    modelsByProvider,
  };
}

export function parsePiListModelsOutput(stdout: string, providerId: string): PiModel[] {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("provider"));

  return lines.flatMap((line) => parsePiListModelLine(line, providerId));
}

function parsePiListModelProviders(stdout: string): string[] {
  const providers = new Set<string>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("provider")) continue;
    const first = trimmed.split(/\s+/)[0];
    const providerId = first.includes("/") ? first.split("/")[0] : first;
    if (providerId) providers.add(providerId);
  }
  return [...providers];
}

function parsePiListModelLine(line: string, requestedProviderId: string): PiModel[] {
  const columns = line.split(/\s+/);
  if (columns.length === 0) return [];

  const first = columns[0];
  if (first.includes("/")) {
    const [providerId, modelName] = first.split("/", 2);
    if (providerId !== requestedProviderId || !modelName) return [];
    return [{ id: first, displayName: humanizeModelName(modelName), providerId }];
  }

  const providerId = first;
  const modelName = columns[1];
  if (providerId !== requestedProviderId || !modelName) return [];
  const thinking = parseThinkingCapability(columns[4]);
  return [{ id: `${providerId}/${modelName}`, displayName: humanizeModelName(modelName), providerId, thinking }];
}

export function getDefaultThinkingForModel(model?: string): PiThinkingLevel {
  return supportsThinkingForModel(model) ? "low" : "off";
}

export function supportsThinkingForModel(model?: string | PiModel): boolean {
  if (!model) return true;

  const modelId = typeof model === "string" ? model : model.id;
  const providerId = typeof model === "string" ? model.split("/", 1)[0] : model.providerId;

  if (typeof model !== "string" && model.thinking === false) return false;

  // Pi's OpenCode Go provider currently rejects persisted assistant messages that
  // include a `reasoning` field for some models even when `pi --list-models`
  // advertises thinking support. Keep subagents compatible by disabling thinking
  // for that provider unless/until Pi exposes a safer per-model schema.
  if (providerId === "opencode-go") return false;
  if (modelId.endsWith("/kimi-k2.6") || modelId === "kimi-k2.6") return false;

  return true;
}

export function supportsDeveloperTeamModel(model?: string | PiModel): boolean {
  void model;
  return true;
}

export function resolveThinkingForModel(model: string | PiModel | undefined, requested?: PiThinkingLevel): PiThinkingLevel | undefined {
  if (!supportsThinkingForModel(model)) return undefined;
  return requested ?? getDefaultThinkingForModel(typeof model === "string" ? model : model?.id);
}

export function parsePiThinkingLevel(value: string | undefined): PiThinkingLevel | undefined {
  const normalized = value?.trim();
  return PI_THINKING_LEVELS.includes(normalized as PiThinkingLevel) ? (normalized as PiThinkingLevel) : undefined;
}

function parseThinkingCapability(value: string | undefined): boolean | undefined {
  if (value === "yes") return true;
  if (value === "no") return false;
  return undefined;
}

function resolveProvider(providerId: string): PiProvider | undefined {
  return PI_PROVIDERS.find((provider) => provider.id === providerId) ?? {
    id: providerId,
    displayName: humanizeProviderName(providerId),
    envVars: [],
  };
}

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function humanizeProviderName(providerId: string): string {
  return providerId
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeModelName(modelName: string): string {
  return modelName
    .split(/[-_]/)
    .map((part) => part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

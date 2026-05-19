/**
 * Pi model configuration for Developer Team.
 *
 * Detects configured providers from Pi settings, `pi --list-models`, and
 * environment variable fallbacks. Offers model choices per provider and
 * tracks agent-level model assignments.
 */

export type PiProvider = {
  id: string;
  displayName: string;
  envVars: readonly string[];
};

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

export const PI_PROVIDERS: readonly PiProvider[] = [
  { id: "opencode-go", displayName: "OpenCode Go", envVars: ["OPENCODE_API_KEY"] },
  { id: "openai-codex", displayName: "OpenAI Subscription / Codex", envVars: ["OPENAI_API_KEY"] },
  { id: "anthropic", displayName: "Anthropic (Claude)", envVars: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"] },
  { id: "openai", displayName: "OpenAI API", envVars: ["OPENAI_API_KEY"] },
  { id: "google", displayName: "Google (Gemini)", envVars: ["GEMINI_API_KEY"] },
  { id: "groq", displayName: "Groq", envVars: ["GROQ_API_KEY"] },
  { id: "ollama", displayName: "Ollama (local)", envVars: ["OLLAMA_HOST"] },
  { id: "mistral", displayName: "Mistral AI", envVars: ["MISTRAL_API_KEY"] },
] as const;

export const DEFAULT_MODELS_BY_PROVIDER: Readonly<Record<string, readonly PiModel[]>> = {
  "opencode-go": [
    { id: "opencode-go/kimi-k2.6", displayName: "Kimi K2.6", providerId: "opencode-go" },
    { id: "opencode-go/qwen3.6-plus", displayName: "Qwen 3.6 Plus", providerId: "opencode-go" },
    { id: "opencode-go/deepseek-v4-pro", displayName: "DeepSeek V4 Pro", providerId: "opencode-go" },
  ],
  "openai-codex": [
    { id: "openai-codex/gpt-5.5", displayName: "GPT-5.5", providerId: "openai-codex" },
    { id: "openai-codex/gpt-5.4", displayName: "GPT-5.4", providerId: "openai-codex" },
    { id: "openai-codex/gpt-5.1-codex-mini", displayName: "GPT-5.1 Codex Mini", providerId: "openai-codex" },
  ],
  anthropic: [
    { id: "anthropic/claude-sonnet-4", displayName: "Claude Sonnet 4", providerId: "anthropic" },
    { id: "anthropic/claude-opus-4", displayName: "Claude Opus 4", providerId: "anthropic" },
    { id: "anthropic/claude-haiku-4", displayName: "Claude Haiku 4", providerId: "anthropic" },
  ],
  openai: [
    { id: "openai/gpt-4o", displayName: "GPT-4o", providerId: "openai" },
    { id: "openai/gpt-4o-mini", displayName: "GPT-4o Mini", providerId: "openai" },
    { id: "openai/gpt-4-turbo", displayName: "GPT-4 Turbo", providerId: "openai" },
  ],
  google: [
    { id: "google/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", providerId: "google" },
    { id: "google/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", providerId: "google" },
  ],
  groq: [
    { id: "groq/llama-3.3-70b", displayName: "Llama 3.3 70B", providerId: "groq" },
    { id: "groq/mixtral-8x7b", displayName: "Mixtral 8x7B", providerId: "groq" },
  ],
  ollama: [
    { id: "ollama/llama3.3", displayName: "Llama 3.3", providerId: "ollama" },
    { id: "ollama/qwen2.5-coder", displayName: "Qwen 2.5 Coder", providerId: "ollama" },
    { id: "ollama/deepseek-coder-v2", displayName: "DeepSeek Coder V2", providerId: "ollama" },
  ],
  mistral: [
    { id: "mistral/mistral-large", displayName: "Mistral Large", providerId: "mistral" },
    { id: "mistral/mistral-medium", displayName: "Mistral Medium", providerId: "mistral" },
  ],
};

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

export function resolveThinkingForModel(model: string | PiModel | undefined, requested?: PiThinkingLevel): PiThinkingLevel {
  if (!supportsThinkingForModel(model)) return "off";
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

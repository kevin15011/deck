import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DECK_CONFIG_VERSION = 1;
export const DECK_CONFIG_RELATIVE_PATH = join(".deck", "config.json");

export type AdaptiveMemoryActiveProvider = "none" | (string & {});

export const SUPERMEMORY_SEARCH_MODES = ["memories", "documents"] as const;
export type SupermemorySearchMode = (typeof SUPERMEMORY_SEARCH_MODES)[number];

export type DeckSupermemoryConfig = {
  /** Non-secret MCP server label used by Pi/MCP config. Defaults to "supermemory". */
  mcpServerName?: string;
  /** Required when Supermemory is the active provider. Never a token or credential. */
  userId?: string;
  /** Optional only when a caller has an explicit/derived project identity; never invented here. */
  projectId?: string;
  teamId?: string;
  orgId?: string;
  searchMode?: SupermemorySearchMode;
  maxMemoriesPerSession?: number;
};

export type DeckAdaptiveMemoryConfig = {
  activeProvider?: AdaptiveMemoryActiveProvider;
  supermemory?: DeckSupermemoryConfig;
};

export type DeckConfig = {
  version?: typeof DECK_CONFIG_VERSION;
  adaptiveMemory?: DeckAdaptiveMemoryConfig;
};

export type NormalizedDeckConfig = {
  version: typeof DECK_CONFIG_VERSION;
  adaptiveMemory: {
    activeProvider: AdaptiveMemoryActiveProvider;
    supermemory?: DeckSupermemoryConfig;
  };
};

export type DeckConfigErrorCode =
  | "DECK_CONFIG_INVALID_JSON"
  | "DECK_CONFIG_INVALID_SHAPE"
  | "DECK_CONFIG_UNSUPPORTED_VERSION"
  | "DECK_CONFIG_UNKNOWN_FIELD"
  | "ADAPTIVE_MEMORY_UNSUPPORTED_PROVIDER"
  | "SUPERMEMORY_CREDENTIAL_IN_DECK_CONFIG"
  | "SUPERMEMORY_USER_ID_REQUIRED"
  | "SUPERMEMORY_CONFIG_INVALID";

export class DeckConfigError extends Error {
  readonly code: DeckConfigErrorCode;
  readonly configPath?: string;
  readonly fieldPath?: string;

  constructor(
    code: DeckConfigErrorCode,
    message: string,
    options?: { configPath?: string; fieldPath?: string },
  ) {
    super(message);
    this.name = "DeckConfigError";
    this.code = code;
    this.configPath = options?.configPath;
    this.fieldPath = options?.fieldPath;
  }
}

export type ActiveMemoryProviderSource = "cli" | "config" | "default";

export type ActiveMemoryProviderResolution = {
  activeProvider: AdaptiveMemoryActiveProvider;
  source: ActiveMemoryProviderSource;
  config: NormalizedDeckConfig;
  supermemory?: DeckSupermemoryConfig;
};

const SECRET_FIELD_PATTERN =
  /(?:token|secret|credential|credentials|api[-_]?key|password|private[-_]?key|access[-_]?key|auth(?:orization)?)/i;

const TOP_LEVEL_FIELDS = new Set(["version", "adaptiveMemory"]);
const ADAPTIVE_MEMORY_FIELDS = new Set(["activeProvider", "supermemory"]);
const SUPERMEMORY_FIELDS = new Set([
  "mcpServerName",
  "userId",
  "projectId",
  "teamId",
  "orgId",
  "searchMode",
  "maxMemoriesPerSession",
]);

export function getDeckConfigPath(projectRoot: string): string {
  return join(projectRoot, DECK_CONFIG_RELATIVE_PATH);
}

export function getDefaultDeckConfig(): NormalizedDeckConfig {
  return {
    version: DECK_CONFIG_VERSION,
    adaptiveMemory: {
      activeProvider: "none",
    },
  };
}

export function readDeckConfig(projectRoot: string): NormalizedDeckConfig {
  const configPath = getDeckConfigPath(projectRoot);
  if (!existsSync(configPath)) {
    return getDefaultDeckConfig();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (error) {
    throw new DeckConfigError(
      "DECK_CONFIG_INVALID_JSON",
      `Deck config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { configPath },
    );
  }

  return validateDeckConfig(parsed, { configPath });
}

export function writeDeckConfig(projectRoot: string, config: unknown): NormalizedDeckConfig {
  const configPath = getDeckConfigPath(projectRoot);
  const normalized = validateDeckConfig(config, { configPath });
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
  return normalized;
}

export function validateDeckConfig(
  config: unknown,
  options?: { configPath?: string },
): NormalizedDeckConfig {
  if (config === undefined || config === null) {
    return getDefaultDeckConfig();
  }

  assertPlainObject(config, "config", options?.configPath);
  rejectSecretFields(config, "config", options?.configPath);
  assertKnownFields(config, TOP_LEVEL_FIELDS, "config", options?.configPath);

  const version = config.version ?? DECK_CONFIG_VERSION;
  if (version !== DECK_CONFIG_VERSION) {
    throw new DeckConfigError(
      "DECK_CONFIG_UNSUPPORTED_VERSION",
      `Unsupported Deck config version: ${String(version)}. Expected ${DECK_CONFIG_VERSION}.`,
      { configPath: options?.configPath, fieldPath: "version" },
    );
  }

  const adaptiveMemory = normalizeAdaptiveMemoryConfig(
    config.adaptiveMemory,
    options?.configPath,
  );

  return {
    version: DECK_CONFIG_VERSION,
    adaptiveMemory,
  };
}

export function resolveActiveMemoryProvider(options?: {
  cliProvider?: string;
  config?: unknown;
  projectRoot?: string;
}): ActiveMemoryProviderResolution {
  const configPath = options?.projectRoot ? getDeckConfigPath(options.projectRoot) : undefined;
  const hasConfigFile = configPath ? existsSync(configPath) : false;
  const config =
    options?.config !== undefined
      ? validateDeckConfig(options.config, { configPath })
      : options?.projectRoot
        ? readDeckConfig(options.projectRoot)
        : getDefaultDeckConfig();

  const cliProvider = options?.cliProvider;
  if (cliProvider !== undefined) {
    const activeProvider = parseActiveProvider(cliProvider, "cliProvider", configPath);
    return buildResolution(activeProvider, "cli", config, configPath);
  }

  const activeProvider = config.adaptiveMemory.activeProvider ?? "none";
  const source: ActiveMemoryProviderSource =
    options?.config !== undefined || hasConfigFile ? "config" : "default";
  return buildResolution(activeProvider, source, config, configPath);
}

function buildResolution(
  activeProvider: AdaptiveMemoryActiveProvider,
  source: ActiveMemoryProviderSource,
  config: NormalizedDeckConfig,
  configPath?: string,
): ActiveMemoryProviderResolution {
  if (activeProvider === "supermemory") {
    const supermemory = config.adaptiveMemory.supermemory;
    if (!hasNonEmptyString(supermemory?.userId)) {
      throw new DeckConfigError(
        "SUPERMEMORY_USER_ID_REQUIRED",
        "Supermemory configuration requires an explicit userId.",
        { configPath, fieldPath: "adaptiveMemory.supermemory.userId" },
      );
    }
    return { activeProvider, source, config, supermemory };
  }

  return { activeProvider, source, config };
}

function normalizeAdaptiveMemoryConfig(
  value: unknown,
  configPath?: string,
): NormalizedDeckConfig["adaptiveMemory"] {
  if (value === undefined || value === null) {
    return { activeProvider: "none" };
  }

  assertPlainObject(value, "adaptiveMemory", configPath);
  assertKnownFields(value, ADAPTIVE_MEMORY_FIELDS, "adaptiveMemory", configPath);

  const activeProvider = value.activeProvider === undefined
    ? "none"
    : parseActiveProvider(value.activeProvider, "adaptiveMemory.activeProvider", configPath);

  const supermemory = normalizeSupermemoryConfig(
    value.supermemory,
    activeProvider,
    configPath,
  );

  if (activeProvider === "supermemory" && !hasNonEmptyString(supermemory?.userId)) {
    throw new DeckConfigError(
      "SUPERMEMORY_USER_ID_REQUIRED",
      "Supermemory configuration requires an explicit userId.",
      { configPath, fieldPath: "adaptiveMemory.supermemory.userId" },
    );
  }

  return supermemory ? { activeProvider, supermemory } : { activeProvider };
}

function normalizeSupermemoryConfig(
  value: unknown,
  activeProvider: AdaptiveMemoryActiveProvider,
  configPath?: string,
): DeckSupermemoryConfig | undefined {
  if (value === undefined || value === null) {
    if (activeProvider === "supermemory") {
      return {
        mcpServerName: "supermemory",
        searchMode: "memories",
        maxMemoriesPerSession: 7,
      };
    }
    return undefined;
  }

  assertPlainObject(value, "adaptiveMemory.supermemory", configPath);
  assertKnownFields(value, SUPERMEMORY_FIELDS, "adaptiveMemory.supermemory", configPath);

  const normalized: DeckSupermemoryConfig = {
    mcpServerName: normalizeOptionalString(
      value.mcpServerName,
      "adaptiveMemory.supermemory.mcpServerName",
      configPath,
      { defaultValue: "supermemory" },
    ),
    searchMode: normalizeSearchMode(value.searchMode, configPath),
    maxMemoriesPerSession: normalizeMaxMemoriesPerSession(
      value.maxMemoriesPerSession,
      configPath,
    ),
  };

  const userId = normalizeOptionalString(
    value.userId,
    "adaptiveMemory.supermemory.userId",
    configPath,
  );
  if (userId !== undefined) normalized.userId = userId;

  const projectId = normalizeOptionalString(
    value.projectId,
    "adaptiveMemory.supermemory.projectId",
    configPath,
  );
  if (projectId !== undefined) normalized.projectId = projectId;

  const teamId = normalizeOptionalString(
    value.teamId,
    "adaptiveMemory.supermemory.teamId",
    configPath,
  );
  if (teamId !== undefined) normalized.teamId = teamId;

  const orgId = normalizeOptionalString(
    value.orgId,
    "adaptiveMemory.supermemory.orgId",
    configPath,
  );
  if (orgId !== undefined) normalized.orgId = orgId;

  return normalized;
}

function parseActiveProvider(
  value: unknown,
  fieldPath: string,
  configPath?: string,
): AdaptiveMemoryActiveProvider {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DeckConfigError(
      "ADAPTIVE_MEMORY_UNSUPPORTED_PROVIDER",
      `Unsupported adaptive-memory provider: ${String(value)}.`,
      { configPath, fieldPath },
    );
  }
  return value as AdaptiveMemoryActiveProvider;
}

function normalizeSearchMode(value: unknown, configPath?: string): SupermemorySearchMode {
  if (value === undefined) return "memories";
  if (typeof value !== "string" || !SUPERMEMORY_SEARCH_MODES.includes(value as SupermemorySearchMode)) {
    throw new DeckConfigError(
      "SUPERMEMORY_CONFIG_INVALID",
      `Invalid Supermemory searchMode: ${String(value)}.`,
      { configPath, fieldPath: "adaptiveMemory.supermemory.searchMode" },
    );
  }
  return value as SupermemorySearchMode;
}

function normalizeMaxMemoriesPerSession(value: unknown, configPath?: string): number {
  if (value === undefined) return 7;
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > 7) {
    throw new DeckConfigError(
      "SUPERMEMORY_CONFIG_INVALID",
      "Supermemory maxMemoriesPerSession must be an integer from 1 to 7.",
      { configPath, fieldPath: "adaptiveMemory.supermemory.maxMemoriesPerSession" },
    );
  }
  return value;
}

function normalizeOptionalString(
  value: unknown,
  fieldPath: string,
  configPath?: string,
  options?: { defaultValue?: string },
): string | undefined {
  if (value === undefined) return options?.defaultValue;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DeckConfigError(
      fieldPath.endsWith("userId") ? "SUPERMEMORY_USER_ID_REQUIRED" : "SUPERMEMORY_CONFIG_INVALID",
      `${fieldPath} must be a non-empty string when provided.`,
      { configPath, fieldPath },
    );
  }
  return value.trim();
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertPlainObject(
  value: unknown,
  fieldPath: string,
  configPath?: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DeckConfigError(
      "DECK_CONFIG_INVALID_SHAPE",
      `${fieldPath} must be an object.`,
      { configPath, fieldPath },
    );
  }
}

function assertKnownFields(
  value: Record<string, unknown>,
  allowedFields: Set<string>,
  fieldPath: string,
  configPath?: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new DeckConfigError(
        "DECK_CONFIG_UNKNOWN_FIELD",
        `Unknown Deck config field: ${fieldPath}.${key}`,
        { configPath, fieldPath: `${fieldPath}.${key}` },
      );
    }
  }
}

function rejectSecretFields(value: unknown, fieldPath: string, configPath?: string): void {
  if (typeof value !== "object" || value === null) return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${fieldPath}.${key}`;
    if (SECRET_FIELD_PATTERN.test(key)) {
      throw new DeckConfigError(
        "SUPERMEMORY_CREDENTIAL_IN_DECK_CONFIG",
        "Deck config may not store Supermemory credentials.",
        { configPath, fieldPath: childPath },
      );
    }
    rejectSecretFields(child, childPath, configPath);
  }
}

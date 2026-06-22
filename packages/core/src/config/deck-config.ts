import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { AdapterRegistry } from "../adapter-registry";

// Import global config path resolver from T5
// Lazy import to avoid circular dependencies
let globalPaths: typeof import("../../../../apps/cli/src/runtime/paths.js") | null = null;

async function getGlobalPaths() {
  if (!globalPaths) {
    try {
      globalPaths = await import("../../../../apps/cli/src/runtime/paths.js");
    } catch {
      // Global paths module not available (e.g., in tests or before paths.ts is built)
      globalPaths = null;
    }
  }
  return globalPaths;
}

export const DECK_CONFIG_VERSION = 1;
export const DECK_CONFIG_RELATIVE_PATH = join(".deck", "config.json");

export type AdaptiveMemoryActiveProvider = "none" | (string & {});

export const SUPERMEMORY_SEARCH_MODES = ["memories", "documents"] as const;
export type SupermemorySearchMode = (typeof SUPERMEMORY_SEARCH_MODES)[number];

export type DeckSupermemoryConfig = {
  /** Non-secret MCP server label used by Pi/MCP config. Defaults to "supermemory". */
  mcpServerName?: string;
  /** @deprecated - user identity derived from token automatically */
  userId?: never;
  /** @deprecated - project scoping via x-sm-project header */
  projectId?: never;
  /** @deprecated - project scoping via x-sm-project header */
  teamId?: never;
  /** @deprecated - no longer used */
  orgId?: never;
  searchMode?: SupermemorySearchMode;
  maxMemoriesPerSession?: number;
};

export type DeckAdaptiveMemoryConfig = {
  activeProvider?: AdaptiveMemoryActiveProvider;
  supermemory?: DeckSupermemoryConfig;
};

// ---------------------------------------------------------------------------
// Orchestrator Personality Config
// ---------------------------------------------------------------------------

export const ORCHESTRATOR_PERSONALITIES = ["guia", "pragmatica"] as const;
export type OrchestratorPersonality = (typeof ORCHESTRATOR_PERSONALITIES)[number];
export const DEFAULT_ORCHESTRATOR_PERSONALITY: OrchestratorPersonality = "pragmatica";

// ---------------------------------------------------------------------------
// Package Instruction Config
// ---------------------------------------------------------------------------

/** Dynamic runner ID for package instructions — validated at runtime against AdapterRegistry. */
export type PackageInstructionRunnerId = string & {};

export const PACKAGE_INSTRUCTION_PACKAGE_IDS = ["codebase-memory", "code-economy", "context-mode", "rtk", "adaptive-memory", "serena"] as const;
export type PackageInstructionPackageId = (typeof PACKAGE_INSTRUCTION_PACKAGE_IDS)[number];

/**
 * Validate runner keys against registered adapters.
 *
 * @param keys - Runner keys found in packageInstructions config
 * @param registry - Adapter registry to validate against
 * @throws DeckConfigError if any key is not registered
 */
export function validateRunnerKeys(keys: string[], registry: AdapterRegistry): void {
  for (const key of keys) {
    if (!registry.has(key)) {
      const registered = registry.list().map((a) => a.runnerId);
      throw new DeckConfigError(
        "DECK_CONFIG_UNKNOWN_FIELD",
        `Unknown runner key '${key}'. Registered runners: [${registered.join(", ")}].`,
        { fieldPath: `packageInstructions.${key}` },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// SDD Phase / Profile types
// ---------------------------------------------------------------------------

export const SDD_PHASES = [
  "explore",
  "proposal",
  "spec",
  "design",
  "tasks",
  "apply",
  "verify",
  "review",
  "archive",
  "onboard",
] as const;
export type SDDPhase = (typeof SDD_PHASES)[number];

export type ProfileStrategy = "generated-multi" | "external-single-active";

export type PhaseOverrides = Partial<Record<SDDPhase, Record<string, unknown>>>;

export interface Profile {
  name: string;
  description?: string;
  phaseOverrides?: PhaseOverrides;
  strategy?: ProfileStrategy;
}

// ---------------------------------------------------------------------------
// DeckConfig / NormalizedDeckConfig
// ---------------------------------------------------------------------------

export type DeckPackageInstructionRunnerConfig = Partial<
  Record<PackageInstructionPackageId, boolean>
>;

export type DeckPackageInstructionConfig = Partial<Record<PackageInstructionRunnerId, DeckPackageInstructionRunnerConfig>>;

export type DeckConfig = {
  version?: typeof DECK_CONFIG_VERSION;
  adaptiveMemory?: DeckAdaptiveMemoryConfig;
  packageInstructions?: DeckPackageInstructionConfig;
  orchestratorPersonality?: OrchestratorPersonality;
  profiles?: Profile[];
  activeProfile?: string;
};

export type NormalizedDeckConfig = {
  version: typeof DECK_CONFIG_VERSION;
  adaptiveMemory: {
    activeProvider: AdaptiveMemoryActiveProvider;
    supermemory?: DeckSupermemoryConfig;
  };
  packageInstructions: Record<PackageInstructionRunnerId, Record<PackageInstructionPackageId, boolean>>;
  orchestratorPersonality: OrchestratorPersonality;
  profiles: Profile[];
  activeProfile: string;
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

const TOP_LEVEL_FIELDS = new Set(["version", "adaptiveMemory", "packageInstructions", "orchestratorPersonality", "profiles", "activeProfile"]);
const ADAPTIVE_MEMORY_FIELDS = new Set(["activeProvider", "supermemory"]);
const SUPERMEMORY_FIELDS = new Set([
  "mcpServerName",
  "searchMode",
  "maxMemoriesPerSession",
]);
const PACKAGE_INSTRUCTION_PACKAGE_FIELDS = new Set(PACKAGE_INSTRUCTION_PACKAGE_IDS);

export function getDeckConfigPath(projectRoot: string): string {
  return join(projectRoot, DECK_CONFIG_RELATIVE_PATH);
}

export function getDefaultDeckConfig(): NormalizedDeckConfig {
  return {
    version: DECK_CONFIG_VERSION,
    adaptiveMemory: {
      activeProvider: "none",
    },
    packageInstructions: {
      pi: { "codebase-memory": false, "code-economy": true, "context-mode": false, rtk: false, "adaptive-memory": false, serena: false },
      opencode: { "codebase-memory": false, "code-economy": true, "context-mode": false, rtk: false, "adaptive-memory": false, serena: false },
    },
    orchestratorPersonality: DEFAULT_ORCHESTRATOR_PERSONALITY,
    profiles: [],
    activeProfile: "default",
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

// ============================================================================
// Global Config APIs (Task 6)
// ============================================================================

/**
 * Error code for global config operations.
 */
export type GlobalConfigErrorCode =
  | "GLOBAL_CONFIG_PATH_RESOLUTION_FAILED"
  | "GLOBAL_CONFIG_READ_ERROR"
  | "GLOBAL_CONFIG_WRITE_ERROR";

/**
 * Error class for global config operations.
 */
export class GlobalConfigError extends Error {
  readonly code: GlobalConfigErrorCode;

  constructor(code: GlobalConfigErrorCode, message: string) {
    super(message);
    this.name = "GlobalConfigError";
    this.code = code;
  }
}

/**
 * Get the global Deck config file path.
 *
 * Uses the path resolver from Task 5 (apps/cli/src/runtime/paths.ts).
 *
 * @returns Full path to global config.json
 * @throws {GlobalConfigError} If path resolution fails
 */
export async function getGlobalDeckConfigPath(): Promise<string> {
  const paths = await getGlobalPaths();
  if (!paths) {
    throw new GlobalConfigError(
      "GLOBAL_CONFIG_PATH_RESOLUTION_FAILED",
      "Cannot resolve global config path: path resolver not available",
    );
  }
  return paths.getGlobalDeckConfigPath();
}

/**
 * Read the global Deck config.
 *
 * Reads from the global config file at $XDG_CONFIG_HOME/.deck/config.json
 * (or fallback locations). Returns default config if no global config exists.
 *
 * @returns Normalized global Deck config
 * @throws {GlobalConfigError} If read fails
 */
export async function readGlobalDeckConfig(): Promise<NormalizedDeckConfig> {
  const paths = await getGlobalPaths();
  if (!paths) {
    // Return default if path resolver not available
    return getDefaultDeckConfig();
  }

  const configPath = await paths.getGlobalDeckConfigPath();

  if (!existsSync(configPath)) {
    return getDefaultDeckConfig();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (error) {
    throw new GlobalConfigError(
      "GLOBAL_CONFIG_READ_ERROR",
      `Global config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return validateDeckConfig(parsed, { configPath });
}

/**
 * Write the global Deck config.
 *
 * Writes to the global config file at $XDG_CONFIG_HOME/.deck/config.json
 * (or default location). Creates directories as needed.
 *
 * @param config - Config object to write
 * @returns Normalized config that was written
 * @throws {GlobalConfigError} If write fails
 */
export async function writeGlobalDeckConfig(config: unknown): Promise<NormalizedDeckConfig> {
  const paths = await getGlobalPaths();
  if (!paths) {
    throw new GlobalConfigError(
      "GLOBAL_CONFIG_WRITE_ERROR",
      "Cannot write global config: path resolver not available",
    );
  }

  const configPath = await paths.getGlobalDeckConfigPath();
  const normalized = validateDeckConfig(config, { configPath });

  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
  } catch (error) {
    throw new GlobalConfigError(
      "GLOBAL_CONFIG_WRITE_ERROR",
      `Failed to write global config: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return normalized;
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
  options?: { configPath?: string; registry?: AdapterRegistry },
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

  const packageInstructions = normalizePackageInstructionConfig(
    config.packageInstructions,
    options?.configPath,
    options,
  );

  const orchestratorPersonality = normalizeOrchestratorPersonalityConfig(
    config.orchestratorPersonality,
    options?.configPath,
  );

  const profiles = normalizeProfiles(config.profiles, config.activeProfile, options?.configPath);
  const activeProfile = profiles.length === 0 || config.activeProfile === undefined
    ? "default"
    : (config.activeProfile as string);

  assertValidActiveProfile(activeProfile, profiles, options?.configPath);

  return {
    version: DECK_CONFIG_VERSION,
    adaptiveMemory,
    packageInstructions,
    orchestratorPersonality,
    profiles,
    activeProfile,
  };
}

export function resolveActiveMemoryProvider(options?: {
  cliProvider?: string;
  config?: unknown;
  projectRoot?: string;
}): ActiveMemoryProviderResolution {
  // Cache configPath to avoid double resolution
  const configPath = options?.projectRoot ? getDeckConfigPath(options.projectRoot) : undefined;
  const hasConfigFile = configPath ? existsSync(configPath) : false;
  const config =
    options?.config !== undefined
      ? validateDeckConfig(options.config, { configPath })
      : configPath && options?.projectRoot
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

  return supermemory ? { activeProvider, supermemory } : { activeProvider };
}

const DEPRECATED_SUPERMEMORY_FIELDS = new Set(["userId", "teamId", "orgId", "projectId"]);

/**
 * Strip deprecated fields from a raw config object in place.
 * These fields are no longer stored in config (identity now derived from token automatically).
 */
function stripDeprecatedSupermemoryFields(value: Record<string, unknown>): void {
  for (const field of DEPRECATED_SUPERMEMORY_FIELDS) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete value[field];
  }
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

  // Strip deprecated fields BEFORE assertKnownFields to avoid "unknown field" rejection
  stripDeprecatedSupermemoryFields(value);

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

  return normalized;
}

function normalizePackageInstructionConfig(
  value: unknown,
  configPath?: string,
  options?: { registry?: AdapterRegistry },
): NormalizedDeckConfig["packageInstructions"] {
  // Default: code-economy is ALWAYS true for supported runners (pi, opencode)
  // getDefaultDeckConfig() provides defaults for pi + opencode for backward compat
  const defaultResult: NormalizedDeckConfig["packageInstructions"] = {
    pi: { "codebase-memory": false, "code-economy": true, "context-mode": false, rtk: false, "adaptive-memory": false, serena: false },
    opencode: { "codebase-memory": false, "code-economy": true, "context-mode": false, rtk: false, "adaptive-memory": false, serena: false },
  };

  if (value === undefined || value === null) {
    return defaultResult;
  }

  assertPlainObject(value, "packageInstructions", configPath);
  // If empty object, return defaults for backward compat
  if (Object.keys(value).length === 0) {
    return defaultResult;
  }

  // Validate each runner key against registry if provided
  if (options?.registry) {
    validateRunnerKeys(Object.keys(value), options.registry);
  }

  // Normalize: start from empty object, apply provided values (any runner key allowed)
  const result: NormalizedDeckConfig["packageInstructions"] = {};

  for (const [runner, runnerValue] of Object.entries(value)) {
    if (runnerValue === undefined || runnerValue === null) {
      // Skip null/undefined runner entries
      continue;
    }

    assertPlainObject(runnerValue, `packageInstructions.${runner}`, configPath);

    // Initialize runner entry: code-economy is ALWAYS true for supported runners (pi, opencode)
    // Other packages default to false
    result[runner as PackageInstructionRunnerId] = {
      "codebase-memory": false,
      "code-economy": true,
      "context-mode": false,
      rtk: false,
      "adaptive-memory": false,
      serena: false,
    };

    // Validate each package key in this runner
    for (const pkgKey of Object.keys(runnerValue)) {
      if (!PACKAGE_INSTRUCTION_PACKAGE_FIELDS.has(pkgKey as PackageInstructionPackageId)) {
        throw new DeckConfigError(
          "DECK_CONFIG_UNKNOWN_FIELD",
          `Unknown Deck config field: packageInstructions.${runner}.${pkgKey}`,
          { configPath, fieldPath: `packageInstructions.${runner}.${pkgKey}` },
        );
      }
    }

    // Normalize package booleans
    // IMPORTANT: code-economy is ALWAYS true for supported runners - cannot be disabled
    // Invalid values (non-boolean) are normalized to true for code-economy only
    for (const pkg of PACKAGE_INSTRUCTION_PACKAGE_IDS) {
      const pkgValue = (runnerValue as Record<string, unknown>)[pkg];
      if (pkgValue !== undefined) {
        // code-economy: force to true for ANY value (including invalid non-boolean)
        // This is a baseline, not a user toggle - invalid values are normalized, not rejected
        if (pkg === "code-economy") {
          result[runner as PackageInstructionRunnerId][pkg] = true;
        } else {
          // Other packages: reject non-boolean values
          if (typeof pkgValue !== "boolean") {
            throw new DeckConfigError(
              "DECK_CONFIG_INVALID_SHAPE",
              `packageInstructions.${runner}.${pkg} must be a boolean.`,
              { configPath, fieldPath: `packageInstructions.${runner}.${pkg}` },
            );
          }
          result[runner as PackageInstructionRunnerId][pkg] = pkgValue;
        }
      }
      // If undefined, keep default (code-economy: true, others: false)
    }
  }

  return result;
}

function normalizeOrchestratorPersonalityConfig(
  value: unknown,
  configPath?: string,
): OrchestratorPersonality {
  if (value === undefined || value === null) {
    return DEFAULT_ORCHESTRATOR_PERSONALITY;
  }

  if (typeof value !== "string") {
    throw new DeckConfigError(
      "DECK_CONFIG_INVALID_SHAPE",
      `orchestratorPersonality must be a string.`,
      { configPath, fieldPath: "orchestratorPersonality" },
    );
  }

  if (!ORCHESTRATOR_PERSONALITIES.includes(value as OrchestratorPersonality)) {
    throw new DeckConfigError(
      "DECK_CONFIG_INVALID_SHAPE",
      `orchestratorPersonality must be one of: ${ORCHESTRATOR_PERSONALITIES.join(", ")}`,
      { configPath, fieldPath: "orchestratorPersonality" },
    );
  }

  return value as OrchestratorPersonality;
}

function normalizeProfiles(
  profiles: unknown,
  activeProfile: unknown,
  configPath?: string,
): Profile[] {
  // Handle null/undefined → empty array
  if (profiles === undefined || profiles === null) {
    return [];
  }

  if (!Array.isArray(profiles)) {
    throw new DeckConfigError(
      "DECK_CONFIG_INVALID_SHAPE",
      `"profiles" must be an array.`,
      { configPath, fieldPath: "profiles" },
    );
  }

  // Check for duplicate names
  const seenNames = new Set<string>();
  for (const profile of profiles) {
    if (typeof profile !== "object" || profile === null) {
      throw new DeckConfigError(
        "DECK_CONFIG_INVALID_SHAPE",
        `"profiles" must contain only objects with a "name" field.`,
        { configPath, fieldPath: "profiles" },
      );
    }

    const p = profile as Record<string, unknown>;

    if (typeof p.name !== "string" || p.name.trim().length === 0) {
      throw new DeckConfigError(
        "DECK_CONFIG_INVALID_SHAPE",
        `"profiles" entries must have a non-empty "name" field.`,
        { configPath, fieldPath: "profiles" },
      );
    }

    if (seenNames.has(p.name)) {
      throw new DeckConfigError(
        "DECK_CONFIG_INVALID_SHAPE",
        `Duplicate profile name: "${p.name}"`,
        { configPath, fieldPath: "profiles" },
      );
    }
    seenNames.add(p.name);

    // Validate phaseOverrides keys
    if (p.phaseOverrides !== undefined && p.phaseOverrides !== null) {
      if (typeof p.phaseOverrides !== "object" || Array.isArray(p.phaseOverrides)) {
        throw new DeckConfigError(
          "DECK_CONFIG_INVALID_SHAPE",
          `"phaseOverrides" must be an object.`,
          { configPath, fieldPath: "profiles" },
        );
      }

      const phaseOverrides = p.phaseOverrides as Record<string, unknown>;
      for (const phaseKey of Object.keys(phaseOverrides)) {
        if (!SDD_PHASES.includes(phaseKey as SDDPhase)) {
          throw new DeckConfigError(
            "DECK_CONFIG_UNKNOWN_FIELD",
            `Unknown phase: "${phaseKey}". Valid phases: ${SDD_PHASES.join(", ")}.`,
            { configPath, fieldPath: `profiles.phaseOverrides.${phaseKey}` },
          );
        }
      }
    }

    // Validate strategy value
    if (p.strategy !== undefined && p.strategy !== null) {
      if (typeof p.strategy !== "string") {
        throw new DeckConfigError(
          "DECK_CONFIG_INVALID_SHAPE",
          `"strategy" must be a string.`,
          { configPath, fieldPath: "profiles" },
        );
      }

      const validStrategies: ProfileStrategy[] = ["generated-multi", "external-single-active"];
      if (!validStrategies.includes(p.strategy as ProfileStrategy)) {
        throw new DeckConfigError(
          "DECK_CONFIG_INVALID_SHAPE",
          `"strategy" must be one of: ${validStrategies.join(", ")}.`,
          { configPath, fieldPath: "profiles" },
        );
      }
    }
  }

  return profiles as Profile[];
}

function assertValidActiveProfile(activeProfile: string, profiles: Profile[], configPath?: string): void {
  if (activeProfile === "default") return; // implicit default is always valid
  const profileNames = profiles.map((p) => p.name);
  if (!profileNames.includes(activeProfile)) {
    throw new DeckConfigError(
      "DECK_CONFIG_INVALID_SHAPE",
      `Unknown profile: "${activeProfile}". Available profiles: ${profileNames.join(", ")}`,
      { configPath, fieldPath: "activeProfile" },
    );
  }
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

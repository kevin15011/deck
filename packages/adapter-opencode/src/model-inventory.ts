/**
 * OpenCode model inventory loader.
 *
 * Reads runner-owned model cache from ~/.cache/opencode/models.json
 * and merges custom provider data from OpenCode config.
 *
 * Design: runner-model-recognition-effort-levels / design.md § OpenCode cache parser shape
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { RunnerModelInventory, RunnerModelProvider, RunnerModelEntry, RunnerModelSource } from "@deck/core";

export type ModelInventoryOptions = {
  /** Override the default OpenCode cache path */
  cachePath?: string;
  /** Override the default config directory */
  configDir?: string;
  /** Override the default auth file path */
  authPath?: string;
  /** File system existence check (for testing) */
  exists?: typeof existsSync;
  /** File read function (for testing) */
  readFile?: (path: string, encoding: "utf-8") => string;
  /** Inject configured provider IDs (for testing; skips auth file read) */
  configuredProviderIds?: string[];
  /** Inject environment variables (for testing; defaults to process.env) */
  env?: Record<string, string | undefined>;
};

/**
 * OpenCode cache JSON shape (flexible: provider map vs array, model map vs array)
 */
interface OpenCodeCacheRoot {
  providers?: Record<string, OpenCodeProviderData> | OpenCodeProviderData[];
  models?: Record<string, OpenCodeModelData> | OpenCodeModelData[];
  [key: string]: unknown;
}

interface OpenCodeProviderData {
  id?: string;
  name?: string;
  env?: string[];
  env_vars?: string[];
  [key: string]: unknown;
}

interface OpenCodeModelData {
  id?: string;
  name?: string;
  family?: string;
  tool_call?: boolean;
  reasoning?: boolean;
  cost?: number;
  limit?: number;
  /** Legacy variants field (kept for compatibility; superseded by reasoning_options when present). */
  variants?: string[];
  /**
   * Real OpenCode cache reasoning options.
   * Shape: `[{ type: "effort", values: ["high", "max"] }, { type: "budget_tokens", min: 1024 }]`
   * Only entries with `type === "effort"` and a string-array `values` contribute variants.
   */
  reasoning_options?: OpenCodeReasoningOption[];
  [key: string]: unknown;
}

/**
 * Single reasoning_options entry from the OpenCode cache.
 * `type` is typically `"effort"` (discrete levels via `values`) or `"budget_tokens"` (token budget via `min`).
 */
interface OpenCodeReasoningOption {
  type?: unknown;
  values?: unknown;
  min?: unknown;
  [key: string]: unknown;
}

/**
 * Load OpenCode model inventory from runner-owned cache.
 *
 * Priority:
 * 1. Runner cache (~/.cache/opencode/models.json)
 * 2. Custom providers from OpenCode config (merged, cache wins on ID collision)
 *
 * Filtering:
 * Only providers that are configured (via auth.json or env vars) are included.
 * If no configured providers can be determined, returns empty inventory with diagnostics.
 *
 * @returns RunnerModelInventory with diagnostics for any degraded scenarios
 */
export function loadModelInventory(options?: ModelInventoryOptions): RunnerModelInventory {
  const exists = options?.exists ?? existsSync;
  const readFile = options?.readFile ?? readFileSync;
  const env = options?.env ?? process.env;

  const cachePath = options?.cachePath ?? join(homedir(), ".cache", "opencode", "models.json");
  const configDir = options?.configDir ?? join(homedir(), ".config", "opencode");
  const configPath = join(configDir, "opencode.json");
  const authPath = options?.authPath ?? join(homedir(), ".local", "share", "opencode", "auth.json");

  const diagnostics: string[] = [];
  const providers: RunnerModelProvider[] = [];
  const modelsByProvider: Record<string, RunnerModelEntry[]> = {};

  // 1. Load runner cache
  let cacheData: OpenCodeCacheRoot | null = null;
  // Keep raw provider data for env-var filtering
  let rawProviderDataMap: Record<string, OpenCodeProviderData> = {};
  if (exists(cachePath)) {
    try {
      const content = readFile(cachePath, "utf-8");
      cacheData = JSON.parse(content) as OpenCodeCacheRoot;
      rawProviderDataMap = extractRawProviderDataMap(cacheData);
    } catch {
      diagnostics.push(`inventory-source-invalid: Malformed cache at ${cachePath}`);
    }
  } else {
    diagnostics.push(`inventory-source-unavailable: Cache not found at ${cachePath}`);
  }

  // 2. Determine configured provider IDs (from auth file + env vars)
  const configuredProviderIds = resolveConfiguredProviderIds(
    options?.configuredProviderIds,
    authPath,
    rawProviderDataMap,
    env,
    exists,
    readFile,
    diagnostics,
  );

  // 3. Parse providers and models from cache (filtered to configured)
  if (cacheData) {
    // Detect flat provider map shape (real OpenCode cache format)
    if (isFlatProviderMapShape(cacheData)) {
      const parsed = parseFlatProviderMapFromCache(cacheData, configuredProviderIds);
      for (const provider of parsed.providers) {
        providers.push(provider);
        modelsByProvider[provider.id] = [];
      }
      for (const model of parsed.models) {
        const existing = modelsByProvider[model.providerId];
        if (existing) {
          existing.push(model);
        }
      }
    } else {
      // Legacy shape: explicit providers/models keys
      const parsedProviders = parseProvidersFromCache(cacheData, configuredProviderIds);
      for (const provider of parsedProviders) {
        providers.push(provider);
        modelsByProvider[provider.id] = [];
      }

      const parsedModels = parseModelsFromCache(cacheData, modelsByProvider);
      for (const model of parsedModels) {
        const existing = modelsByProvider[model.providerId];
        if (existing) {
          existing.push(model);
        } else {
          diagnostics.push(`Invalid model entry ignored: provider ${model.providerId} not found`);
        }
      }
    }
  }

  // 4. Ensure all providers used by models are in the providers list (only if configured)
  for (const providerId of Object.keys(modelsByProvider)) {
    if (!providers.find((p) => p.id === providerId)) {
      // Only auto-create if provider is configured
      if (configuredProviderIds.has(providerId)) {
        providers.push({
          id: providerId,
          displayName: providerId,
          source: "runner-cache" as RunnerModelSource,
        });
      }
    }
  }

  // 5. Merge custom providers from OpenCode config
  if (exists(configPath)) {
    try {
      const content = readFile(configPath, "utf-8");
      const config = JSON.parse(content) as { provider?: Record<string, unknown> };
      const customProviders = mergeCustomProviders(config.provider, diagnostics);
      for (const provider of customProviders) {
        // Only include if configured
        if (configuredProviderIds.has(provider.id)) {
          // Cache wins on ID collision
          if (!modelsByProvider[provider.id]) {
            providers.push(provider);
            modelsByProvider[provider.id] = [];
          }
        }
      }
    } catch {
      diagnostics.push(`inventory-source-invalid: Malformed config at ${configPath}`);
    }
  }

  // 6. If no configured providers found, add diagnostic
  if (configuredProviderIds.size === 0) {
    diagnostics.push("inventory-no-configured-providers: No auth-configured or env-configured providers found");
  }

  return {
    providers,
    modelsByProvider,
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
  };
}

/**
 * Extract raw provider data map from cache for env-var filtering.
 * Handles both flat provider map and legacy shapes.
 */
function extractRawProviderDataMap(cache: OpenCodeCacheRoot): Record<string, OpenCodeProviderData> {
  const result: Record<string, OpenCodeProviderData> = {};

  if (isFlatProviderMapShape(cache)) {
    for (const [key, value] of Object.entries(cache)) {
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        result[key] = value as OpenCodeProviderData;
      }
    }
  } else if (cache.providers && typeof cache.providers === "object" && !Array.isArray(cache.providers)) {
    for (const [id, data] of Object.entries(cache.providers)) {
      result[id] = data as OpenCodeProviderData;
    }
  } else if (cache.providers && Array.isArray(cache.providers)) {
    for (const entry of cache.providers) {
      const providerData = entry as OpenCodeProviderData;
      if (providerData.id) {
        result[providerData.id] = providerData;
      }
    }
  }

  return result;
}

/**
 * Resolve configured provider IDs from auth file and/or env vars.
 * Returns a Set of configured provider IDs (possibly empty if none configured).
 */
function resolveConfiguredProviderIds(
  injectedIds: string[] | undefined,
  authPath: string,
  rawProviderDataMap: Record<string, OpenCodeProviderData>,
  env: Record<string, string | undefined>,
  exists: typeof existsSync,
  readFile: (path: string, encoding: "utf-8") => string,
  diagnostics: string[],
): Set<string> {
  // If injected, use that directly
  if (injectedIds !== undefined) {
    return new Set(injectedIds.filter(isValidProviderId));
  }

  const configuredIds = new Set<string>();

  // 1. Load auth file
  if (exists(authPath)) {
    try {
      const content = readFile(authPath, "utf-8");
      const authData = JSON.parse(content) as Record<string, unknown>;
      for (const key of Object.keys(authData)) {
        if (isValidProviderId(key)) {
          configuredIds.add(key);
        }
      }
    } catch {
      diagnostics.push(`inventory-source-invalid: Malformed auth file at ${authPath}`);
    }
  }

  // 2. Check env vars for providers with env/env_vars metadata
  for (const [providerId, providerData] of Object.entries(rawProviderDataMap)) {
    if (!isValidProviderId(providerId)) continue;
    // Skip if already configured via auth
    if (configuredIds.has(providerId)) continue;

    const envVars = providerData.env ?? providerData.env_vars;
    if (Array.isArray(envVars) && envVars.length > 0) {
      // Check if ALL required env vars are present
      const allPresent = envVars.every((varName) => {
        if (typeof varName !== "string") return false;
        const value = env[varName];
        return typeof value === "string" && value.length > 0;
      });
      if (allPresent) {
        configuredIds.add(providerId);
      }
    }
  }

  return configuredIds;
}

/**
 * Parse providers from cache (handles both map and array shapes)
 */
/**
 * Detect if cache has flat provider map shape (real OpenCode cache format).
 * Flat shape: top-level keys are provider IDs, each containing nested models.
 * Example: { "openai": { "name": "OpenAI", "models": { "gpt-4": {...} } } }
 */
function isFlatProviderMapShape(cache: OpenCodeCacheRoot): boolean {
  // If it has explicit "providers" or "models" keys, it's not the flat shape
  if (cache.providers !== undefined || cache.models !== undefined) {
    return false;
  }

  // Check if any top-level key looks like a provider (has models or name/id fields)
  for (const [key, value] of Object.entries(cache)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const providerData = value as Record<string, unknown>;
      // If it has models array/object or name/id, treat as provider
      if (providerData.models !== undefined || providerData.name !== undefined || providerData.id !== undefined) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Parse flat provider map shape (real OpenCode cache format).
 * Each top-level key is a provider ID containing nested models.
 */
function parseFlatProviderMapFromCache(
  cache: OpenCodeCacheRoot,
  configuredProviderIds: Set<string>,
): { providers: RunnerModelProvider[]; models: RunnerModelEntry[] } {
  const providers: RunnerModelProvider[] = [];
  const models: RunnerModelEntry[] = [];
  const modelsByProvider: Record<string, RunnerModelEntry[]> = {};

  for (const [providerId, value] of Object.entries(cache)) {
    if (!isValidProviderId(providerId)) continue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;

    // Filter to configured providers only
    if (!configuredProviderIds.has(providerId)) {
      continue;
    }

    const providerData = value as OpenCodeProviderData & { models?: Record<string, OpenCodeModelData> | OpenCodeModelData[] };

    // Add provider
    providers.push({
      id: providerId,
      displayName: providerData.name ?? providerId,
      envVars: providerData.env ?? providerData.env_vars,
      source: "runner-cache" as RunnerModelSource,
    });

    modelsByProvider[providerId] = [];

    // Parse nested models
    if (providerData.models) {
      const providerModels = parseModelsFromProvider(providerId, providerData.models);
      for (const model of providerModels) {
        models.push(model);
        modelsByProvider[providerId].push(model);
      }
    }
  }

  return { providers, models };
}

/**
 * Parse models from a provider's nested models field.
 */
function parseModelsFromProvider(
  providerId: string,
  modelsData: Record<string, OpenCodeModelData> | OpenCodeModelData[],
): RunnerModelEntry[] {
  const result: RunnerModelEntry[] = [];
  const validProviders: Record<string, unknown> = { [providerId]: [] };

  // Handle model map: { "gpt-4": { ... } }
  if (typeof modelsData === "object" && !Array.isArray(modelsData)) {
    for (const [modelId, modelData] of Object.entries(modelsData)) {
      if (!modelId || typeof modelId !== "string") continue;

      // Construct canonical model ID: <providerId>/<modelId> unless already prefixed
      const canonicalId = modelId.includes("/") ? modelId : `${providerId}/${modelId}`;

      const parsed = parseModelEntry(
        canonicalId,
        { ...modelData, providerId } as OpenCodeModelData & { providerId: string },
        validProviders,
      );
      if (parsed) {
        result.push(parsed);
      }
    }
  }

  // Handle model array: [{ id: "gpt-4", ... }]
  if (Array.isArray(modelsData)) {
    for (const entry of modelsData) {
      const modelData = entry as OpenCodeModelData;
      const modelId = modelData.id;
      if (!modelId || typeof modelId !== "string") continue;

      // Construct canonical model ID: <providerId>/<modelId> unless already prefixed
      const canonicalId = modelId.includes("/") ? modelId : `${providerId}/${modelId}`;

      const parsed = parseModelEntry(
        canonicalId,
        { ...modelData, providerId } as OpenCodeModelData & { providerId: string },
        validProviders,
      );
      if (parsed) {
        result.push(parsed);
      }
    }
  }

  return result;
}

function parseProvidersFromCache(
  cache: OpenCodeCacheRoot,
  configuredProviderIds: Set<string>,
): RunnerModelProvider[] {
  const result: RunnerModelProvider[] = [];

  // Handle provider map: { "openai": { ... } }
  if (cache.providers && typeof cache.providers === "object" && !Array.isArray(cache.providers)) {
    for (const [id, data] of Object.entries(cache.providers)) {
      const providerData = data as OpenCodeProviderData;
      if (!id || typeof id !== "string") continue;
      if (!isValidProviderId(id)) continue;

      // Filter to configured providers only
      if (!configuredProviderIds.has(id)) {
        continue;
      }

      result.push({
        id,
        displayName: providerData.name ?? id,
        envVars: providerData.env ?? providerData.env_vars,
        source: "runner-cache" as RunnerModelSource,
      });
    }
  }

  // Handle provider array: [{ id: "openai", ... }]
  if (cache.providers && Array.isArray(cache.providers)) {
    for (const entry of cache.providers) {
      const providerData = entry as OpenCodeProviderData;
      const id = providerData.id;
      if (!id || typeof id !== "string") continue;
      if (!isValidProviderId(id)) continue;

      // Filter to configured providers only
      if (!configuredProviderIds.has(id)) {
        continue;
      }

      result.push({
        id,
        displayName: providerData.name ?? id,
        envVars: providerData.env ?? providerData.env_vars,
        source: "runner-cache" as RunnerModelSource,
      });
    }
  }

  return result;
}

/**
 * Parse models from cache (handles both map and array shapes)
 */
function parseModelsFromCache(
  cache: OpenCodeCacheRoot,
  validProviders: Record<string, unknown>,
): RunnerModelEntry[] {
  const result: RunnerModelEntry[] = [];

  // Handle model map: { "openai/gpt-5.5": { ... } }
  if (cache.models && typeof cache.models === "object" && !Array.isArray(cache.models)) {
    for (const [id, data] of Object.entries(cache.models)) {
      const modelData = data as OpenCodeModelData;
      if (!id || typeof id !== "string") continue;

      // Infer providerId from model ID if not present (e.g., "openai/gpt-5.5" -> "openai")
      const inferredProviderId = modelData.providerId ?? id.split("/")[0];
      const parsed = parseModelEntry(
        id,
        { ...modelData, providerId: inferredProviderId } as OpenCodeModelData & { providerId: string },
        validProviders,
      );
      if (parsed) {
        result.push(parsed);
      }
    }
  }

  // Handle model array: [{ id: "openai/gpt-5.5", providerId: "openai", ... }]
  if (cache.models && Array.isArray(cache.models)) {
    for (const entry of cache.models) {
      const modelData = entry as OpenCodeModelData;
      const id = modelData.id;
      if (!id || typeof id !== "string") continue;

      // Infer providerId from model ID if not present (e.g., "openai/gpt-5.5" -> "openai")
      const inferredProviderId = modelData.providerId ?? id.split("/")[0];
      const parsed = parseModelEntry(
        id,
        { ...modelData, providerId: inferredProviderId } as OpenCodeModelData & { providerId: string },
        validProviders,
      );
      if (parsed) {
        result.push(parsed);
      }
    }
  }

  return result;
}

/**
 * Parse a single model entry with validation
 * @param id - Model ID (e.g., "openai/gpt-5.5")
 * @param data - Model data from cache (may include inferred providerId)
 * @param validProviders - Map of valid provider IDs (will be auto-created if missing)
 * @returns Parsed model entry or null if invalid
 */
function parseModelEntry(
  id: string,
  data: OpenCodeModelData & { providerId?: string },
  validProviders: Record<string, unknown>,
): RunnerModelEntry | null {
  // Accept providerId from data or use empty string (will be validated below)
  const providerId = data.providerId ?? "";
  if (!providerId || typeof providerId !== "string") return null;
  if (!isValidModelId(id)) return null;

  // If provider doesn't exist, auto-create it (handles inferred providerId from model ID)
  if (!validProviders[providerId]) {
    if (isValidProviderId(providerId)) {
      // Mark provider as valid AND initialize empty array for models
      validProviders[providerId] = [];
    } else {
      return null;
    }
  }

  // Filter out unavailable providers (tool_call = false)
  const toolCall = data.tool_call;
  if (toolCall === false) return null;

  // Default supportsTools to false when tool_call is missing (unknown)
  // This is safer than defaulting to true which may display providers
  // whose cache record does not confirm tool-call support
  const supportsTools = toolCall === true;

  // Extract effort variants. The real OpenCode cache uses
  // `reasoning_options: [{ type: "effort", values: [...] }]` rather than a
  // top-level `variants` field. Prefer reasoning_options when it yields
  // effort values; fall back to the legacy `variants` field for backward
  // compatibility (and for tests/fixtures that still use it).
  // Models with only `budget_tokens` options (or no options at all) get an
  // empty variants array — the caller treats empty as "no confirmed levels".
  const effortVariants = extractEffortVariants(data.reasoning_options);
  const rawVariants = effortVariants.length > 0 ? effortVariants : data.variants;
  const validatedVariants = validateAndDedupVariants(rawVariants);

  return {
    id,
    providerId,
    displayName: data.name ?? id,
    supportsTools,
    supportsReasoning: data.reasoning ?? null,
    variants: validatedVariants,
    source: "runner-cache" as RunnerModelSource,
  };
}

/**
 * Extract discrete effort level strings from `reasoning_options`.
 *
 * The real OpenCode cache stores per-model reasoning options as an array of
 * `{ type, values?, min? }` entries. Only entries with `type === "effort"`
 * AND a `values` array of strings contribute discrete effort levels (the kind
 * the TUI effort picker can render). Entries with `type === "budget_tokens"`
 * (or any other type) are ignored — those models surface no discrete levels,
 * which downstream code interprets as "hide the picker / fail-closed".
 *
 * Returns an empty array when `options` is missing or yields no effort values.
 */
function extractEffortVariants(options: OpenCodeReasoningOption[] | undefined): string[] {
  if (!Array.isArray(options)) {
    return [];
  }

  const result: string[] = [];
  for (const opt of options) {
    if (!opt || typeof opt !== "object") continue;
    if (opt.type !== "effort") continue;
    if (!Array.isArray(opt.values)) continue;

    for (const v of opt.values) {
      if (typeof v === "string") {
        result.push(v);
      }
    }
  }

  return result;
}

/**
 * Validate and deduplicate variant strings (same logic as model-variants.ts)
 */
function validateAndDedupVariants(variants: string[] | undefined): readonly string[] {
  if (!variants || !Array.isArray(variants)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const variant of variants) {
    if (typeof variant !== "string") {
      continue;
    }

    const trimmed = variant.trim();

    // Skip empty strings
    if (!trimmed) {
      continue;
    }

    // Skip control characters
    if (/[\x00-\x1F\x7F]/.test(trimmed)) {
      continue;
    }

    // Deduplicate
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  return result;
}

/**
 * Merge custom providers from OpenCode config
 */
function mergeCustomProviders(
  configProviders: Record<string, unknown> | undefined,
  diagnostics: string[],
): RunnerModelProvider[] {
  const result: RunnerModelProvider[] = [];

  if (!configProviders || typeof configProviders !== "object") {
    return result;
  }

  for (const [id, data] of Object.entries(configProviders)) {
    if (!isValidProviderId(id)) {
      diagnostics.push(`Invalid provider entry ignored: ${id}`);
      continue;
    }

    // Custom providers get "runner-config" source
    result.push({
      id,
      displayName: id,
      source: "runner-config" as RunnerModelSource,
    });
  }

  return result;
}

/**
 * Validate provider ID (non-empty, no path traversal)
 */
function isValidProviderId(id: string): boolean {
  return !!id && id.length > 0 && !id.includes("..") && !id.includes("/");
}

/**
 * Validate model ID (non-empty, contains provider prefix)
 */
function isValidModelId(id: string): boolean {
  return !!id && id.length > 0 && id.includes("/");
}

// Re-export types for consumers
export type { RunnerModelProvider, RunnerModelEntry, RunnerModelInventory, RunnerModelSource };
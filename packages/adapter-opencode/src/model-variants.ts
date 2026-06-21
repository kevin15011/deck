/**
 * OpenCode variant cache loader and lookup.
 *
 * Loads Deck-owned variant cache from ~/.cache/deck/opencode/model-variants.json
 * and provides per-model variant lookup.
 *
 * Design: runner-model-recognition-effort-levels / design.md § OpenCode variant cache shape
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type VariantCacheOptions = {
  /** Override the default variant cache path */
  cachePath?: string;
  /** File system existence check (for testing) */
  exists?: typeof existsSync;
  /** File read function (for testing) */
  readFile?: (path: string, encoding: "utf-8") => string;
};

/**
 * Deck-owned variant cache schema
 */
export interface ModelVariantCache {
  schemaVersion: number;
  runner: string;
  generatedAt: string;
  providers: Record<string, Record<string, readonly string[]>>;
}

/**
 * Variant cache validation result
 */
export interface VariantCacheResult {
  /** Valid cache data */
  cache: ModelVariantCache | null;
  /** Diagnostic messages */
  diagnostics: string[];
}

/**
 * Control character regex (matches any control character)
 */
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;

/**
 * Load and validate the variant cache.
 *
 * @returns VariantCacheResult with cache (null if invalid/missing) and diagnostics
 */
export function loadVariantCache(options?: VariantCacheOptions): VariantCacheResult {
  const exists = options?.exists ?? existsSync;
  const readFile = options?.readFile ?? readFileSync;

  const cachePath = options?.cachePath ?? join(homedir(), ".cache", "deck", "opencode", "model-variants.json");
  const diagnostics: string[] = [];

  // Missing cache - return empty with diagnostic
  if (!exists(cachePath)) {
    return { cache: null, diagnostics: ["variant-cache-unavailable: Cache not found"] };
  }

  // Load and parse
  let data: unknown;
  try {
    const content = readFile(cachePath, "utf-8");
    data = JSON.parse(content);
  } catch {
    return { cache: null, diagnostics: ["variant-cache-invalid: Malformed cache JSON"] };
  }

  // Validate schema
  if (!isValidVariantCache(data)) {
    return { cache: null, diagnostics: ["variant-cache-invalid: Invalid cache schema"] };
  }

  return { cache: data as ModelVariantCache, diagnostics: [] };
}

/**
 * Check if data is a valid variant cache
 */
function isValidVariantCache(data: unknown): data is ModelVariantCache {
  if (!data || typeof data !== "object") return false;

  const cache = data as Record<string, unknown>;

  // Check schemaVersion
  if (typeof cache.schemaVersion !== "number" || cache.schemaVersion !== 1) {
    return false;
  }

  // Check runner
  if (typeof cache.runner !== "string" || cache.runner !== "opencode") {
    return false;
  }

  // Check generatedAt - must be parseable as date
  if (typeof cache.generatedAt !== "string") {
    return false;
  }
  if (Number.isNaN(Date.parse(cache.generatedAt))) {
    return false;
  }

  // Check providers structure - must be an object, not an array
  if (!cache.providers || typeof cache.providers !== "object") {
    return false;
  }
  if (Array.isArray(cache.providers)) {
    return false; // Reject arrays for providers
  }

  // Validate each provider's model map
  const providers = cache.providers as Record<string, unknown>;
  for (const [providerId, providerData] of Object.entries(providers)) {
    if (!providerId || typeof providerId !== "string") continue;
    if (!providerData || typeof providerData !== "object") {
      return false; // Provider value must be an object
    }
    const providerRecord = providerData as Record<string, unknown>;
    for (const [modelId, modelVariants] of Object.entries(providerRecord)) {
      if (!modelId || typeof modelId !== "string") continue;
      if (!Array.isArray(modelVariants)) {
        return false; // Model variants must be an array
      }
      // Each element must be a string
      for (const v of modelVariants) {
        if (typeof v !== "string") {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Get variants for a specific provider and model.
 *
 * @param providerId - Provider ID (e.g., "openai")
 * @param modelId - Model ID (e.g., "openai/gpt-5.5")
 * @returns Array of validated variant strings, empty if not found
 */
export function variantsFor(
  providerId: string,
  modelId: string,
  options?: VariantCacheOptions,
): readonly string[] {
  const result = loadVariantCache(options);

  if (!result.cache) {
    return [];
  }

  const providerVariants = result.cache.providers[providerId];
  if (!providerVariants) {
    return [];
  }

  const modelVariants = providerVariants[modelId];
  if (!modelVariants) {
    return [];
  }

  // Validate and deduplicate
  return validateAndDedupVariants(modelVariants);
}

/**
 * Validate variant strings and deduplicate while preserving order.
 *
 * Rules:
 * - Trim whitespace
 * - Reject empty strings
 * - Reject control characters
 * - Deduplicate preserving first occurrence order
 */
function validateAndDedupVariants(variants: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const variant of variants) {
    const trimmed = variant?.trim();

    // Skip empty
    if (!trimmed) {
      continue;
    }

    // Skip control characters
    if (CONTROL_CHARS.test(trimmed)) {
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
 * Check if a variant is valid for a specific model.
 *
 * @param providerId - Provider ID
 * @param modelId - Model ID
 * @param candidate - Candidate variant string
 * @returns true if candidate is in the model's confirmed variants
 */
export function isVariantSupportedForModel(
  providerId: string,
  modelId: string,
  candidate: string,
  options?: VariantCacheOptions,
): boolean {
  const variants = variantsFor(providerId, modelId, options);
  return variants.includes(candidate.trim());
}

/**
 * Normalize a variant key for storage.
 *
 * @param value - Raw variant string
 * @returns Normalized string or null if invalid
 */
export function normalizeVariantKey(value: string | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();

  if (!trimmed) return null;
  if (CONTROL_CHARS.test(trimmed)) return null;

  return trimmed;
}

/**
 * Sanitize a persisted variant for a specific model.
 *
 * If the persisted variant is not in the current confirmed variants,
 * returns undefined (meaning it should be cleared).
 *
 * @param providerId - Provider ID
 * @param modelId - Model ID
 * @param persisted - Previously persisted variant value
 * @returns The validated variant or undefined if stale/invalid
 */
export function sanitizePersistedVariantForModel(
  providerId: string,
  modelId: string,
  persisted: string | undefined,
  options?: VariantCacheOptions,
): string | undefined {
  if (!persisted) return undefined;

  const normalized = normalizeVariantKey(persisted);
  if (!normalized) return undefined;

  // Check if it's in the current confirmed set
  if (isVariantSupportedForModel(providerId, modelId, normalized, options)) {
    return normalized;
  }

  // Stale - return undefined to trigger cleanup
  return undefined;
}
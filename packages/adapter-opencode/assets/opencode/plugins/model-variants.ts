/**
 * Deck model-variants plugin - auto-installed by Deck.
 * DO NOT EDIT - this file is managed by Deck.
 *
 * This plugin discovers per-model thinking variants from OpenCode's
 * provider API and writes them to Deck's variant cache.
 *
 * Uses OpenCode's supported plugin API: input.client.provider.list()
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE_DIR = join(homedir(), ".cache", "deck", "opencode");
const CACHE_PATH = join(CACHE_DIR, "model-variants.json");
const SCHEMA_VERSION = 1;
const RUNNER = "opencode";

/**
 * Discover variants using OpenCode's supported provider API.
 * Returns: Record<providerId, Record<modelId, variants[]>>
 */
function discoverVariants(): Record<string, Record<string, string[]>> {
  const variants: Record<string, Record<string, string[]>> = {};

  // Use OpenCode's supported plugin API: input.client.provider.list()
  // This is the OpenCode-recommended way to access provider data
  try {
    // @ts-expect-error - input is an OpenCode plugin API global
    const providers = input?.client?.provider?.list();

    if (Array.isArray(providers)) {
      for (const provider of providers) {
        const providerId = provider.id ?? provider.name;
        if (!providerId) continue;

        const models = provider.models ?? [];
        for (const model of models) {
          const modelId = model.id ?? model.name;
          if (!modelId) continue;

          // Extract variant keys from the model
          // Handle both array shape (thinking_levels[]) and object shape (variants: { minimal: true, low: true, ... })
          let modelVariantKeys: string[] = [];
          if (Array.isArray(model.variants)) {
            // Array shape: variants: ["minimal", "low", "medium", "high"]
            modelVariantKeys = model.variants.filter(Boolean);
          } else if (model.variants && typeof model.variants === "object") {
            // Object shape: variants: { minimal: true, low: true, medium: true, high: true }
            // Use Object.keys() to extract variant names
            modelVariantKeys = Object.keys(model.variants).filter((key) => model.variants?.[key]);
          } else if (Array.isArray(model.thinking_levels)) {
            // Legacy field name
            modelVariantKeys = model.thinking_levels.filter(Boolean);
          }
          if (modelVariantKeys.length > 0) {
            variants[providerId] ??= {};
            // Deduplicate while preserving order
            variants[providerId][modelId] = [...new Set(modelVariantKeys)];
          }
        }
      }
    }
  } catch {
    // API unavailable - variants remain empty
  }

  return variants;
}

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true, mode: 0o755 });
  }
}

function writeCache(variants: Record<string, Record<string, string[]>>): void {
  ensureCacheDir();
  const cache = {
    schemaVersion: SCHEMA_VERSION,
    runner: RUNNER,
    generatedAt: new Date().toISOString(),
    providers: variants,
  };
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
  } catch {
    // Write failed - safe degradation
  }
}

/**
 * Plugin activate function - called by OpenCode at startup.
 */
export function activate(): void {
  writeCache(discoverVariants());
}

// Run on load if executed directly
if (require.main === module) {
  activate();
}

export default { activate };
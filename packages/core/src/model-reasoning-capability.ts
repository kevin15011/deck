/**
 * Model Reasoning Capability Resolver
 *
 * Hybrid resolver for determining if a model supports reasoning/thinking effort.
 *
 * Precedence:
 * 1. Runner signal (explicit true/false) - always wins
 * 2. Catalog (explicit supportsReasoning or derived from capabilities)
 * 3. Unknown/no confirmation - default to false (safe default)
 *
 * REQ-MRE-001 through REQ-MRE-006
 */

import type { ModelCatalog, ModelEntry } from "./model-catalog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReasoningSupportSource = "runner" | "catalog" | "unknown";

export type ResolveReasoningSupportInput = {
  modelId?: string;
  runnerSupportsReasoning?: boolean | null;
  catalog?: ModelCatalog;
};

export type ResolveReasoningSupportResult = {
  supportsReasoning: boolean;
  source: ReasoningSupportSource;
};

// ---------------------------------------------------------------------------
// Helper: Check if model explicitly supports reasoning from catalog
// ---------------------------------------------------------------------------

/**
 * Checks if a model supports reasoning based on explicit catalog entry.
 *
 * Note: This helper checks the explicit `supportsReasoning` field only.
 * If `supportsReasoning` is undefined, it returns undefined (unknown) rather
 * than deriving from capabilities. The main resolver handles that derivation.
 *
 * @param model - The model entry from the catalog (optional)
 * @returns true/false if explicitly set, undefined if not set
 */
export function catalogSupportsReasoning(model?: ModelEntry): boolean | undefined {
  if (!model) {
    return undefined;
  }

  // Explicit support takes priority - this beats derived capabilities
  if (typeof model.supportsReasoning === "boolean") {
    return model.supportsReasoning;
  }

  // No explicit support - resolver will derive from capabilities as fallback
  return undefined;
}

// ---------------------------------------------------------------------------
// Main Resolver
// ---------------------------------------------------------------------------

/**
 * Resolves reasoning effort support with hybrid precedence.
 *
 * Precedence order:
 * 1. Runner signal (if explicitly true or false) - always wins
 * 2. Catalog fallback:
 *    - Explicit supportsReasoning takes priority
 *    - If undefined, derive from capabilities.includes("reasoning")
 * 3. Unknown/no confirmation: returns false with source "unknown"
 *
 * @param input - Resolution input containing modelId, optional runner signal, and optional catalog
 * @returns Result with supportsReasoning flag and source of determination
 */
export function resolveReasoningEffortSupport(
  input: ResolveReasoningSupportInput
): ResolveReasoningSupportResult {
  const { modelId, runnerSupportsReasoning, catalog } = input;

  // 1. Runner signal takes precedence (REQ-MRE-002, REQ-MRE-003)
  // Only true|false count as explicit signal; null/undefined fall through to catalog
  if (runnerSupportsReasoning === true) {
    return {
      supportsReasoning: true,
      source: "runner",
    };
  }

  if (runnerSupportsReasoning === false) {
    return {
      supportsReasoning: false,
      source: "runner",
    };
  }

  // 2. Catalog fallback (REQ-MRE-004)
  if (catalog && modelId) {
    // Use the provided catalog's models, or fall back to global if not provided
    const models = catalog.models ?? [];
    const model = models.find((m: ModelEntry) => m.id === modelId);

    if (model) {
      // Check explicit support first - this beats capabilities derivation
      const explicitSupport = catalogSupportsReasoning(model);
      if (typeof explicitSupport === "boolean") {
        return {
          supportsReasoning: explicitSupport,
          source: "catalog",
        };
      }

      // No explicit support - derive from capabilities (REQ-MRE-005)
      const derived = model.capabilities.includes("reasoning");
      return {
        supportsReasoning: derived,
        source: "catalog",
      };
    }

    // Model not found in catalog
    return {
      supportsReasoning: false,
      source: "unknown",
    };
  }

  // 3. Unknown/no confirmation - safe default (REQ-MRE-005, REQ-MRE-006)
  return {
    supportsReasoning: false,
    source: "unknown",
  };
}

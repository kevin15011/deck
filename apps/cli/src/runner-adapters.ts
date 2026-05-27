/**
 * CLI adapter registry composition root.
 *
 * This file is the SOLE place that imports concrete adapter packages
 * (@deck/adapter-pi, @deck/adapter-opencode). It wires them into the
 * AdapterRegistry so that app.tsx can use getAdapter() without any
 * runner-specific knowledge.
 *
 * Design: runner-decoupling-refactor / design.md § CLI Bootstrap and Adapter Registration
 * Task: 2.3 — Create CLI adapter registry composition root
 */

import { createAdapterRegistry, type AdapterRegistry } from "@deck/core";
import { createPiRunnerAdapter } from "@deck/adapter-pi";
import { createOpenCodeRunnerAdapter } from "@deck/adapter-opencode";

/**
 * Singleton registry instance for use by getAdapter() and listAdapters().
 * Lazily created on first access.
 */
let _defaultRegistry: AdapterRegistry | undefined;

function _getDefaultRegistry(): AdapterRegistry {
  if (!_defaultRegistry) {
    _defaultRegistry = createDefaultAdapterRegistry();
  }
  return _defaultRegistry;
}

/**
 * Create the default adapter registry with all registered runner adapters.
 *
 * Call this once in main.tsx and pass the resulting registry to DeckApp.
 */
export function createDefaultAdapterRegistry(): AdapterRegistry {
  const registry = createAdapterRegistry();

  // Register Pi runner adapter
  registry.register("pi", createPiRunnerAdapter());

  // Register OpenCode runner adapter
  registry.register("opencode", createOpenCodeRunnerAdapter());

  return registry;
}

/**
 * Convenience lookup — delegates to registry.get().
 * Throws RunnerNotRegisteredError if the runner is not found.
 */
export function getAdapter(runnerId: string): import("@deck/core").RunnerAdapter {
  const registry = _getDefaultRegistry();
  return registry.tryGet(runnerId)
    ?? registry.resolveByEnvironment(runnerId)
    ?? registry.get(runnerId);
}

/**
 * Convenience listing — delegates to registry.list().
 */
export function listAdapters(): readonly import("@deck/core").RunnerAdapter[] {
  return _getDefaultRegistry().list();
}

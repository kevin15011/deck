/**
 * AdapterRegistry — generic registry for RunnerAdapter instances keyed by RunnerId.
 *
 * This module provides the core registry used by the CLI composition root to
 * register concrete runner adapters (Pi, OpenCode, etc.) and by the TUI to
 * resolve adapters at runtime.
 *
 * Design: runner-decoupling-refactor / design.md § AdapterRegistry
 * Error contracts: runner-decoupling-refactor / spec.md § Error Contracts
 */

import type { RunnerAdapter } from "./runner-adapter";
import type { RunnerId } from "./runner-capability";
import type { RunnerEnvironmentId } from "./runner-capability";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when a lookup is made for a runner ID that is not registered.
 *
 * Message format: "Runner '{id}' is not registered. Available runners: [{list}].
 *                  Register the adapter in CLI bootstrap."
 */
export class RunnerNotRegisteredError extends Error {
  readonly runnerId: RunnerId;

  constructor(runnerId: RunnerId, availableRunners: readonly RunnerId[]) {
    const list = availableRunners.length > 0 ? availableRunners.join(", ") : "(none)";
    const message = `Runner '${runnerId}' is not registered. Available runners: [${list}]. Register the adapter in CLI bootstrap.`;
    super(message);
    this.name = "RunnerNotRegisteredError";
    this.runnerId = runnerId;
  }
}

/**
 * Thrown when a duplicate runner ID is registered.
 *
 * Message format: "Runner '{id}' is already registered. Each runner ID must be unique."
 */
export class DuplicateRunnerError extends Error {
  readonly runnerId: RunnerId;

  constructor(runnerId: RunnerId) {
    const message = `Runner '${runnerId}' is already registered. Each runner ID must be unique.`;
    super(message);
    this.name = "DuplicateRunnerError";
    this.runnerId = runnerId;
  }
}

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

export interface AdapterRegistry {
  /**
   * Register a runner adapter.
   *
   * @throws `DuplicateRunnerError` if `id` is already registered
   * @throws `DuplicateRunnerError` if `adapter.runnerId !== id`
   * @throws `DuplicateRunnerError` if `adapter.environmentIds` is empty
   */
  register(id: RunnerId, adapter: RunnerAdapter): void;

  /**
   * Look up a registered adapter by runner ID.
   *
   * @throws `RunnerNotRegisteredError` if `id` is not registered
   */
  get(id: RunnerId): RunnerAdapter;

  /**
   * Look up a registered adapter by runner ID, returning `undefined` if not found.
   * Does not throw.
   */
  tryGet(id: RunnerId): RunnerAdapter | undefined;

  /**
   * Returns all registered adapters in registration order.
   */
  list(): readonly RunnerAdapter[];

  /**
   * Resolve the adapter that owns a given environment ID.
   * Returns `undefined` if no adapter claims that environment.
   */
  resolveByEnvironment(environmentId: RunnerEnvironmentId): RunnerAdapter | undefined;

  /**
   * Check whether a runner ID is registered.
   */
  has(id: RunnerId): boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an isolated registry instance.
 *
 * Each call returns a new registry. This avoids process-global mutable state
 * and supports custom registries for tests and fixture use.
 */
export function createAdapterRegistry(): AdapterRegistry {
  const adapters = new Map<RunnerId, RunnerAdapter>();

  return {
    register(id: RunnerId, adapter: RunnerAdapter): void {
      if (adapters.has(id)) {
        throw new DuplicateRunnerError(id);
      }
      if (adapter.runnerId !== id) {
        throw new DuplicateRunnerError(id);
      }
      if (adapter.environmentIds.length === 0) {
        throw new DuplicateRunnerError(id);
      }
      adapters.set(id, adapter);
    },

    get(id: RunnerId): RunnerAdapter {
      const adapter = adapters.get(id);
      if (adapter === undefined) {
        throw new RunnerNotRegisteredError(id, [...adapters.keys()]);
      }
      return adapter;
    },

    tryGet(id: RunnerId): RunnerAdapter | undefined {
      return adapters.get(id);
    },

    list(): readonly RunnerAdapter[] {
      return [...adapters.values()];
    },

    resolveByEnvironment(environmentId: RunnerEnvironmentId): RunnerAdapter | undefined {
      for (const adapter of adapters.values()) {
        if (adapter.environmentIds.includes(environmentId)) {
          return adapter;
        }
      }
      return undefined;
    },

    has(id: RunnerId): boolean {
      return adapters.has(id);
    },
  };
}

/**
 * Runner Capability Registry — CLI composition root.
 *
 * This module is the composition root for the Deck CLI. It wires together:
 * - Runner adapter factories (Pi, OpenCode)
 * - Memory provider factories (Engram, Supermemory)
 *
 * The registry produces a `RunnerCapabilityCatalog` that maps runner IDs to
 * their `RunnerCapabilities` objects. The CLI entry point (main.tsx) uses
 * this catalog to select and inject the appropriate capabilities into the TUI.
 *
 * This module MUST NOT import TUI components — only adapters and core.
 */

import type { RunnerCapabilities, AdaptiveMemoryProvider } from "@deck/core";

// ---------------------------------------------------------------------------
// Runner adapter factories
// ---------------------------------------------------------------------------

import { createPiRunnerCapabilities } from "@deck/adapter-pi";
import { createOpenCodeRunnerCapabilities } from "@deck/adapter-opencode";

// ---------------------------------------------------------------------------
// Memory provider factories
// ---------------------------------------------------------------------------

import { createEngramMemoryProvider } from "@deck/adapter-engram";
import { createSupermemoryMemoryProvider } from "@deck/adapter-supermemory";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A memory provider registration entry.
 * The CLI uses this to discover available providers and create provider instances.
 */
export type MemoryProviderRegistration = {
  id: string;
  displayName: string;
  description?: string;
  /**
   * Creates a memory provider instance.
   * Some providers (like Engram) need no config; others (like Supermemory) need userId etc.
   */
  createProvider(config?: Record<string, string>): AdaptiveMemoryProvider;
};

/**
 * The runner capability catalog produced by the composition root.
 */
export type RunnerCapabilityCatalog = {
  /** Map of runner ID -> RunnerCapabilities object */
  runners: Record<string, RunnerCapabilities>;

  /** Ordered list of registered runner IDs */
  runnerIds: readonly string[];

  /** Registered memory provider factories */
  memoryProviders: readonly MemoryProviderRegistration[];

  /** Look up a runner by ID */
  getRunner(id: string): RunnerCapabilities | undefined;

  /** Check if a runner ID is registered */
  hasRunner(id: string): boolean;

  /**
   * Get the capability resolver for a given runner scope.
   * Returns undefined if the runner doesn't have capabilities exposed.
   */
  getCapabilityResolver(runnerScope: string): import("@deck/core").RunnerCapabilityResolver | undefined;
};

// ---------------------------------------------------------------------------
// Memory provider factory
// ---------------------------------------------------------------------------

/**
 * Creates the registry of available memory providers.
 *
 * CONTRACT (Repair 2026-05-29):
 * - Supermemory NO requiere userId/teamId/orgId manual.
 * - El usuario se deriva del token. Solo token es input manual.
 */
export function createMemoryProviders(): readonly MemoryProviderRegistration[] {
  return [
    {
      id: "engram",
      displayName: "Engram Memory (Experimental)",
      description: "Experimental persistent memory provider with session search and write capabilities.",
      createProvider: () => createEngramMemoryProvider(),
    },
    {
      id: "supermemory",
      displayName: "Supermemory MCP",
      description: "MCP-only adaptive memory with automatic user/project scoping. Uses tools: memory, recall, whoAmI. No team/org scopes. Token-only config.",
      createProvider: () => {
        // CONTRACT: token-only — no userId required
        return createSupermemoryMemoryProvider();
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Runner capability registry
// ---------------------------------------------------------------------------

/**
 * Creates the runner capability catalog — the CLI composition root.
 *
 * This function:
 * 1. Creates RunnerCapabilities objects for each supported runner (Pi, OpenCode)
 * 2. Registers available memory providers
 * 3. Returns a catalog that maps runner IDs to capabilities
 *
 * The TUI receives the catalog from the composition root; it never imports
 * adapter packages directly.
 */
export function createRunnerCapabilityRegistry(): RunnerCapabilityCatalog {
  // Create runner capabilities from adapter factories
  const piCapabilities = createPiRunnerCapabilities();
  const opencodeCapabilities = createOpenCodeRunnerCapabilities();

  // Build runner catalog
  const runners: Record<string, RunnerCapabilities> = {
    [piCapabilities.id]: piCapabilities,
    [opencodeCapabilities.id]: opencodeCapabilities,
  };

  const runnerIds = Object.keys(runners);

  // Create memory provider registrations
  const memoryProviders = createMemoryProviders();

  return {
    runners,
    runnerIds: runnerIds as readonly string[],
    memoryProviders,
    getRunner(id: string): RunnerCapabilities | undefined {
      return runners[id];
    },
    hasRunner(id: string): boolean {
      return id in runners;
    },
    getCapabilityResolver(runnerScope: string): import("@deck/core").RunnerCapabilityResolver | undefined {
      const runner = runners[runnerScope];
      if (!runner || !runner.capabilities) return undefined;
      return runner.capabilities;
    },
  };
}
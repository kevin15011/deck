/**
 * Runner Capability Registry — CLI composition root.
 *
 * This module is the composition root for the Deck CLI. It wires together:
 * - Runner adapter factories (Pi, OpenCode)
 *
 * The registry produces a `RunnerCapabilityCatalog` that maps runner IDs to
 * their `RunnerCapabilities` objects. The CLI entry point (main.tsx) uses
 * this catalog to select and inject the appropriate capabilities into the TUI.
 *
 * This module MUST NOT import TUI components — only adapters and core.
 */

import { composeRunnerCapabilityContributions, type RunnerCapabilities, type RunnerCapabilityContribution } from "@deck/core";

// ---------------------------------------------------------------------------
// Runner adapter factories
// ---------------------------------------------------------------------------

import { createPiRunnerCapabilities, PI_RUNNER_CAPABILITY_CONTRIBUTION } from "@deck/adapter-pi";
import { createOpenCodeRunnerCapabilities, OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION } from "@deck/adapter-opencode";
import { CODEX_RUNNER_CAPABILITY_CONTRIBUTION } from "@deck/adapter-codex";

import { getWebSearchProviderDescriptor, isSupportedWebSearchProvider, SUPPORTED_WEB_SEARCH_PROVIDER_IDS } from "./web-search-provider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The runner capability catalog produced by the composition root.
 */
export type RunnerCapabilityCatalog = {
  /** Map of runner ID -> RunnerCapabilities object */
  runners: Record<string, RunnerCapabilities>;

  /** Ordered list of registered runner IDs */
  runnerIds: readonly string[];

  /** Provider implementations accepted by the current CLI composition root. */
  webSearchProviderIds: readonly string[];

  /** Resolve a provider descriptor without exposing credential values. */
  getWebSearchProvider(provider: string | undefined): ReturnType<typeof getWebSearchProviderDescriptor>;

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

export function createRunnerParityContributions(): readonly RunnerCapabilityContribution[] {
  const contributions = Object.freeze([
    PI_RUNNER_CAPABILITY_CONTRIBUTION,
    OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION,
    CODEX_RUNNER_CAPABILITY_CONTRIBUTION,
  ]);
  composeRunnerCapabilityContributions(contributions);
  return contributions;
}

// ---------------------------------------------------------------------------
// Runner capability registry
// ---------------------------------------------------------------------------

/**
 * Creates the runner capability catalog — the CLI composition root.
 *
 * This function:
 * 1. Creates RunnerCapabilities objects for each supported runner (Pi, OpenCode)
 * 2. Returns a catalog that maps runner IDs to capabilities
 *
 * The TUI receives the catalog from the composition root; it never imports
 * adapter packages directly.
 */
/**
 * @deprecated Read-only compatibility projection for one release. Runtime effects and
 * composition must resolve through AdapterRegistry; remove after remaining TUI consumers migrate.
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

  return {
    runners,
    runnerIds: runnerIds as readonly string[],
    webSearchProviderIds: SUPPORTED_WEB_SEARCH_PROVIDER_IDS,
    getWebSearchProvider(provider: string | undefined) {
      return isSupportedWebSearchProvider(provider) ? getWebSearchProviderDescriptor(provider) : undefined;
    },
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

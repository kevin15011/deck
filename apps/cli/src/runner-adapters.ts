import { currentBuildIdentity } from "./runtime/build-identity";
import { contributionHash } from "@deck/core";
import { guardRunnerAdapter } from "./runner-mutation-admission";
/**
 * CLI adapter registry composition root.
 *
 * This file is the SOLE place that imports concrete adapter packages
 * (@deck/adapter-pi, @deck/adapter-opencode, @deck/adapter-codex). It wires them into the
 * AdapterRegistry so that app.tsx can use getAdapter() without any
 * runner-specific knowledge.
 *
 * Design: runner-decoupling-refactor / design.md § CLI Bootstrap and Adapter Registration
 * Task: 2.3 — Create CLI adapter registry composition root
 */

import { createAdapterRegistry, type AdapterRegistry } from "@deck/core";
import { createPiRunnerAdapter, createCodebaseGuardInvocation } from "@deck/adapter-pi";
import { createOpenCodeRunnerAdapter } from "@deck/adapter-opencode";
import { createCodexRunnerAdapter } from "@deck/adapter-codex";
import { createClaudeRunnerAdapter } from "../../../packages/adapter-claude/src/index";
import { getWebSearchProviderDescriptor } from "./web-search-provider";
import { readOwnedTavilyCredential } from "./web-search-shell-profile";
import { basename, join, resolve } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { getDeckStateDir } from "./runtime/paths";

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
export type DefaultAdapterRegistryOptions = {
  pi?: Parameters<typeof createPiRunnerAdapter>[0];
  opencode?: Parameters<typeof createOpenCodeRunnerAdapter>[0];
  codex?: Parameters<typeof createCodexRunnerAdapter>[0];
  claude?: Parameters<typeof createClaudeRunnerAdapter>[0];
};

/** Self-referencing `deck internal <name>` argv: the running binary, or the dev runtime plus `main.*` (the canary points at itself). */
export function deckInternalCommand(name: string): string[] {
  return [process.execPath, ...(process.argv[1] && /(?:^|[/\\])main\.[cm]?[jt]sx?$/.test(process.argv[1]) ? [resolve(process.argv[1])] : []), "internal", name];
}

/** Canonical payload for compiled stable/canary; runtime plus real main script for development. */
export function deckCodebaseGuardInvocation() {
  const invocation = deckInternalCommand("codebase-mcp-guard-v1");
  const executable = realpathSync(invocation[0]!);
  const candidate = invocation.length === 4 ? invocation[1] : undefined;
  // Same Bun virtual-entry boundary used by Pi's self-invocation helper: virtual scripts are not OS files.
  const virtual = candidate?.startsWith("/$bunfs/") || candidate?.startsWith("B:/$bunfs/");
  const script = candidate && !virtual && existsSync(candidate) && realpathSync(candidate) !== executable ? candidate : undefined;
  if (/^(bun|node)(\.exe)?$/i.test(basename(executable)) && !script) throw new Error("pi-codebase-guard-invalid");
  return createCodebaseGuardInvocation(executable, script);
}

export function createDefaultAdapterRegistry(options: DefaultAdapterRegistryOptions = {}): AdapterRegistry {
  const registry = createAdapterRegistry();
  const guard = (adapter: import("@deck/core").RunnerAdapter) => guardRunnerAdapter(adapter, undefined, async projectRoot => {
    const { refreshSharedSkillCatalogView } = await import("../../../packages/core/src/skill-discovery/shared");
    // Install authority is not Setup authority: refresh the advisory view without publishing.
    await refreshSharedSkillCatalogView({ projectRoot, providers: registry.list().flatMap(a => a.skillDiscovery ? [a.skillDiscovery] : []) });
  }, adapter.mutationRoot ? {path: join(getDeckStateDir(), "runner-fences", `${adapter.runnerId}-${contributionHash(resolve(adapter.mutationRoot)).slice(0,16)}.json`), self:currentBuildIdentity(),stateSchema:adapter.stateSchema ?? 1} : undefined);
  registry.register("pi", guard(createPiRunnerAdapter({
    codebaseGuardInvocation: deckCodebaseGuardInvocation,

    webSearchProviderResolver: getWebSearchProviderDescriptor,
    webSearchCredential: () => process.env.TAVILY_API_KEY?.trim() || readOwnedTavilyCredential(),
    ...options.pi,
  })));
  registry.register("opencode", guard(createOpenCodeRunnerAdapter({
    webSearchProviderResolver: getWebSearchProviderDescriptor,
    webSearchCredential: () => process.env.TAVILY_API_KEY?.trim() || readOwnedTavilyCredential(),
    ...options.opencode,
  })));
  registry.register("codex", guard(createCodexRunnerAdapter({
    webSearchProviderResolver: getWebSearchProviderDescriptor,
    webSearchCredential: () => process.env.TAVILY_API_KEY?.trim() || readOwnedTavilyCredential(),
    serenaProxyCommand: deckInternalCommand("serena-mcp"),
    ...options.codex,
  })));
  registry.register("claude", guard(createClaudeRunnerAdapter({
    nativeSessionStartCommand: deckInternalCommand("project-readiness"),
    webSearchProviderResolver: getWebSearchProviderDescriptor,
    webSearchCredential: () => process.env.TAVILY_API_KEY?.trim() || readOwnedTavilyCredential(),
    serenaProxyCommand: deckInternalCommand("serena-mcp"),
    ...options.claude,
  })));
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

import type { RunnerModelDiscoveryError, RunnerModelInventory, RunnerModelInventoryResult } from "@deck/core";
import { discoverOpenCodeModels, type OpenCodeModelDiscoveryDependencies } from "./opencode-models-cli";
import { buildDiscoveryFingerprint, ModelInventoryCache } from "./model-inventory-cache";
import type { OpenCodeDiscoveryContext } from "./model-discovery-context";

export type ModelInventoryOptions = {
  dependencies: Pick<OpenCodeModelDiscoveryDependencies, "commandRunner" | "resolveExecutable" | "env" | "now">;
  projectRoot: string;
  mode?: "prefer-cache" | "rescan";
  cache?: ModelInventoryCache;
  /** Optional metadata is an intersection-only display enricher. */
  metadataById?: Readonly<Record<string, { displayName?: string; envVars?: readonly string[]; supportsTools?: boolean; supportsReasoning?: boolean | null }>>;
  fingerprint?: string;
  context?: OpenCodeDiscoveryContext;
  deadlineAt?: number;
  signal?: AbortSignal;
  preloadedLastKnownGood?: { inventory: RunnerModelInventory; discoveredAt: number } | undefined;
  readLastKnownGood?: (fingerprint: string) => Promise<{ inventory: RunnerModelInventory; discoveredAt: number } | undefined>;
  writeLastKnownGood?: (snapshot: { fingerprint: string; inventory: RunnerModelInventory; discoveredAt: number }) => Promise<void>;
};

/** @deprecated Synchronous cache authority was removed; use discoverModelInventory. */
export function loadModelInventory(_options?: unknown): RunnerModelInventory {
  return { providers: [], modelsByProvider: {}, diagnostics: ["runner-discovery-required"] };
}

function toResultError(error: RunnerModelDiscoveryError): RunnerModelInventoryResult {
  return { state: "blocked", inventory: null, source: "none", error };
}

/** Enrichment can fill display metadata for runner IDs but never membership or variants. */
export function enrichRunnerInventory(inventory: RunnerModelInventory, metadataById: ModelInventoryOptions["metadataById"]): RunnerModelInventory {
  if (!metadataById) return inventory;
  const modelsByProvider: Record<string, typeof inventory.modelsByProvider[string]> = {};
  for (const provider of inventory.providers) {
    modelsByProvider[provider.id] = (inventory.modelsByProvider[provider.id] ?? []).map((model) => {
      const metadata = metadataById[model.id];
      return !metadata ? model : {
        ...model,
        displayName: model.displayName || metadata.displayName || model.id,
        supportsTools: model.supportsTools ?? metadata.supportsTools,
        supportsReasoning: model.supportsReasoning ?? metadata.supportsReasoning,
        metadataSource: "runner+cache" as const,
      };
    });
  }
  return { ...inventory, modelsByProvider };
}

/** Runner-only discovery coordinator: memory -> live -> compatible LKG -> blocked. */
export async function discoverModelInventory(options: ModelInventoryOptions): Promise<RunnerModelInventoryResult> {
  const fingerprint = options.fingerprint ?? await buildDiscoveryFingerprint(options.context ?? {
    schema: 2,
    runner: { realPath: "opencode", stat: { logicalPath: "opencode", realPath: null, exists: false, kind: "missing", size: null, mtimeMs: null, ctimeMs: null, mode: null, dev: null, ino: null, safeDigest: null, digestDisposition: "not-applicable" }, version: null },
    scope: { projectRoot: options.projectRoot, workspaceRoot: options.projectRoot }, configCandidates: [],
    authFile: { logicalPath: "auth", realPath: null, exists: false, kind: "missing", size: null, mtimeMs: null, ctimeMs: null, mode: null, dev: null, ino: null },
    pluginFiles: [], controlEnvironment: {}, credentialEnvironment: [],
  });
  const cache = options.cache ?? new ModelInventoryCache({ now: options.dependencies.now });
  const isActive = () => !options.signal?.aborted && (options.deadlineAt === undefined || options.dependencies.now() < options.deadlineAt);
  const lkg = options.preloadedLastKnownGood ?? await options.readLastKnownGood?.(fingerprint);
  const timeoutError: RunnerModelDiscoveryError = { code: "timeout", message: "OpenCode model discovery timed out. Try again.", retryable: true };
  if (!isActive()) return lkg ? { state: "stale", inventory: lkg.inventory, source: "last-known-good", discoveredAt: lkg.discoveredAt, fingerprint, error: timeoutError } : toResultError(timeoutError);
  try {
    const cached = await cache.getOrDiscover(fingerprint, options.mode, async () => {
      const remainingMs = options.deadlineAt === undefined ? undefined : Math.max(0, options.deadlineAt - options.dependencies.now());
      if (remainingMs === 0) throw timeoutError;
      const live = await discoverOpenCodeModels({ projectRoot: options.projectRoot, timeoutMs: remainingMs, signal: options.signal, dependencies: options.dependencies });
      if (!live.ok) throw live.error;
      return enrichRunnerInventory(live.inventory, options.metadataById);
    }, isActive);
    if (cached.source === "live" && isActive()) await options.writeLastKnownGood?.({ fingerprint, inventory: cached.inventory, discoveredAt: cached.discoveredAt });
    return { state: "ready", inventory: cached.inventory, source: cached.source, discoveredAt: cached.discoveredAt, fingerprint };
  } catch (reason) {
    const error: RunnerModelDiscoveryError = reason && typeof reason === "object" && "code" in reason
      ? reason as RunnerModelDiscoveryError
      : { code: "command-failed", message: "OpenCode model discovery failed. Run opencode models --verbose to check the runner.", retryable: true };
    if (lkg && options.dependencies.now() - lkg.discoveredAt <= 24 * 60 * 60_000) {
      return { state: "stale", inventory: lkg.inventory, source: "last-known-good", discoveredAt: lkg.discoveredAt, fingerprint, error };
    }
    return toResultError(error);
  }
}

import { readDeckConfig, type CapabilityCatalogEntry, type RunnerAdapter, type WebSearchReadinessCode, type WebSearchReadinessState } from "@deck/core";
import { normalizeDashboardCapabilityInventory } from "./tui/runner-dashboard/inventory";
import { getWebSearchProviderDescriptor } from "./web-search-provider";

const PRODUCTION_WEB_SEARCH_RUNNERS = ["pi", "opencode"] as const;
const WEB_SEARCH_READINESS_STATES = new Set<WebSearchReadinessState>([
  "disabled",
  "enabled-unconfigured",
  "configured-but-not-materialized",
  "ready",
  "unsupported",
]);
const WEB_SEARCH_READINESS_CODES = new Set<WebSearchReadinessCode>([
  "disabled",
  "unsupported-runner",
  "provider-unconfigured",
  "credential-missing",
  "executable-missing",
  "mcp-not-materialized",
  "mcp-config-conflict",
  "ready",
]);

export type StandaloneWebSearchSmokeReport = Readonly<{
  webSearch: Readonly<{ enabled: boolean; provider?: string }>;
  provider: string | null;
  runners: Readonly<Record<string, Readonly<{ state: string; code: string }>>>;
}>;

/**
 * Small runtime hook used to prove a compiled Deck binary resolves the
 * provider through its entrypoint bundle rather than workspace modules.
 * The report intentionally contains readiness identifiers only.
 */
export async function inspectStandaloneWebSearchReadiness(options: Readonly<{
  projectRoot: string;
  adapters: readonly Pick<RunnerAdapter, "runnerId" | "environmentIds" | "getCapabilityInventory">[];
}>): Promise<StandaloneWebSearchSmokeReport> {
  const config = readDeckConfig(options.projectRoot);
  const provider = getWebSearchProviderDescriptor(config.webSearch.provider);
  const runners: Record<string, { state: string; code: string }> = {};

  for (const runnerId of PRODUCTION_WEB_SEARCH_RUNNERS) {
    const adapter = options.adapters.find((candidate) => candidate.runnerId === runnerId);
    if (!adapter) {
      runners[runnerId] = { state: "unavailable", code: "inventory-unavailable" };
      continue;
    }
    const environmentId = adapter.environmentIds[0];
    if (!environmentId) {
      runners[runnerId] = { state: "unavailable", code: "inventory-unavailable" };
      continue;
    }
    try {
      const inventory = await adapter.getCapabilityInventory({
        projectRoot: options.projectRoot,
        runnerId,
        environmentId,
      });
      const normalized = normalizeDashboardCapabilityInventory(inventory, runnerId, environmentId);
      const webSearch = normalized.ok
        ? normalized.inventory.capabilities.find((entry) => entry.capabilityId === "web-search")
        : undefined;
      runners[runnerId] = isWebSearchReadinessEntry(webSearch)
        ? { state: webSearch.webSearchReadiness.state, code: webSearch.webSearchReadiness.code }
        : { state: "unavailable", code: "inventory-invalid" };
    } catch {
      runners[runnerId] = { state: "unavailable", code: "inventory-unavailable" };
    }
  }

  return {
    webSearch: {
      enabled: config.webSearch.enabled,
      ...(config.webSearch.provider ? { provider: config.webSearch.provider } : {}),
    },
    provider: provider?.providerId ?? null,
    runners,
  };
}

/** The compiled binary succeeds only after both production inventories validate. */
export function isStandaloneWebSearchSmokeSuccessful(report: StandaloneWebSearchSmokeReport): boolean {
  return report.webSearch.enabled
    && report.provider === "tavily"
    && PRODUCTION_WEB_SEARCH_RUNNERS.every((runnerId) => {
      const runner = report.runners[runnerId];
      return runner !== undefined
        && runner.code !== "inventory-unavailable"
        && runner.code !== "inventory-invalid"
        && WEB_SEARCH_READINESS_STATES.has(runner.state as WebSearchReadinessState)
        && WEB_SEARCH_READINESS_CODES.has(runner.code as WebSearchReadinessCode);
    });
}

function isWebSearchReadinessEntry(
  entry: CapabilityCatalogEntry | undefined,
): entry is CapabilityCatalogEntry & Required<Pick<CapabilityCatalogEntry, "webSearchReadiness">> {
  const readiness = entry?.webSearchReadiness;
  return entry?.capabilityId === "web-search"
    && readiness !== undefined
    && readiness.capabilityId === "web-search"
    && typeof readiness.enabled === "boolean"
    && WEB_SEARCH_READINESS_STATES.has(readiness.state)
    && WEB_SEARCH_READINESS_CODES.has(readiness.code)
    && Array.isArray(readiness.diagnostics)
    && readiness.diagnostics.every((diagnostic) => typeof diagnostic === "string");
}

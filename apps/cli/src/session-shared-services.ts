import { type PersonalMcpAvailability } from "@deck/core/session/personal-mcp";
import type { CapabilityAvailability } from "@deck/core/session/mcp";
/** Shared provider composition; credentials remain in host memory and spawn environment only. */
import type { NormalizedDeckConfig, RunnerAdapter } from "@deck/core";
import type { ChildMcpServerSpec } from "@deck/core/session/driver";
import type { ChildMcpContext, ChildMcpResolver, SessionMemoryPort } from "@deck/session-host";
import { SessionCodebaseReadinessError, type SessionCodebaseReadiness } from "./session-codebase-readiness";
import { createSupermemoryRuntimeHost } from "./supermemory-runtime-host";
import { getWebSearchProviderDescriptor } from "./web-search-provider";
import { startGlobalMemoryTransport } from "./session-global-memory-transport";
import { prepareSessionNativeMemory, type NativeMemoryPreparationEffects } from "./session-native-memory";

export type SessionMemoryContext = { sessionId: string; projectRoot: string; leadRunnerId: string };

export function createSessionMemoryPort(
  context: SessionMemoryContext,
  config: NormalizedDeckConfig,
  createRuntime: typeof createSupermemoryRuntimeHost = createSupermemoryRuntimeHost,
): SessionMemoryPort | undefined {
  if (context.leadRunnerId !== "pi") return undefined;
  if (config.adaptiveMemory.enabled !== true || config.adaptiveMemory.activeProvider !== "supermemory") return undefined;
  let runtime: ReturnType<typeof createRuntime> | undefined;
  const get = () => runtime ??= createRuntime({
    projectRoot: context.projectRoot, sessionId: context.sessionId, runnerId: context.leadRunnerId,
    deckConfig: config, role: "lead", deferInitialRecallToLoopback: true,
  });
  return {
    async recall(query) {
      const result = await (await get()).explicitRecall(query);
      return { ok: result.ok, ...(result.advisoryText ? { advisoryText: result.advisoryText } : {}) };
    },
    async propose(content) { return { ok: (await (await get()).explicitRemember(content)).ok }; },
    async close() { if (runtime) (await runtime).recordLifecycle("runtime-cleanup"); },
  };
}

export async function resolveSessionChildMcp(
  adapter: RunnerAdapter | undefined,
  config: NormalizedDeckConfig,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  managed?: { readiness: SessionCodebaseReadiness; context: ChildMcpContext },
  nativeMemoryEffects?: NativeMemoryPreparationEffects,
  startGlobalTransport: typeof startGlobalMemoryTransport = startGlobalMemoryTransport,
): Promise<ChildMcpResolver> {
  const memory = managed ? prepareSessionNativeMemory(adapter?.runnerId ?? "", managed.context.projectRoot, config, environment, nativeMemoryEffects) : undefined;
  const configured = { ...await adapter?.readSessionMcpServers?.() };
  // Ordinary servers, skills and plugins stay in the native loader. Only Codebase
  // needs a task binding prepared by the managed recovery service.
  const servers: Record<string, ChildMcpServerSpec> = managed
    ? (configured["codebase-memory"] ? { "codebase-memory": configured["codebase-memory"] } : {})
    : configured;
  const suppressedMcpServers: string[] = [];
  const memoryProviderIds = [...new Set(["supermemory", "adaptive-memory", ...(config.adaptiveMemory.supermemory?.mcpServerName ? [config.adaptiveMemory.supermemory.mcpServerName] : [])])];
  // Claude persists an explicit trusted selection. Codex and OpenCode use the global web
  // policy in their native install plans; their absent optional selection seam is intentional.
  const selected = adapter?.readSelectedCapabilityIds?.();
  const enabled = config.webSearch.enabled && (selected === undefined || selected.includes("web-search"));
  let envOverlay: Record<string, string> | undefined = memory?.envOverlay;
  let webSearch: ChildMcpResolver["webSearch"] = { enabled: false };
  if (enabled) {
    const provider = getWebSearchProviderDescriptor(config.webSearch.provider);
    if (!provider) throw new Error("web-search-provider-unconfigured: select a supported Deck provider");
    const credential = environment[provider.credentialEnvVar]?.trim();
    if (!credential) throw new Error("web-search-credential-missing: configured provider credential is unavailable");
    const [command, ...args] = provider.command;
    servers[provider.semanticServerId] = { command, args, env: {} };
    envOverlay = { ...envOverlay, [provider.credentialEnvVar]: credential };
    webSearch = { enabled: true, serverId: provider.semanticServerId };
  }
  const capabilityAvailability: CapabilityAvailability[] = [];
  const personalMcpAvailability: PersonalMcpAvailability[] = [];
  let release: (() => Promise<void>) | undefined;
  let releases: Array<() => Promise<void>> = [];
  let releasing: Promise<void> | undefined;
  const releaseResources = () => releasing ??= (async () => {
    const pending = releases;
    const results = await Promise.allSettled(pending.map(close => Promise.resolve().then(close)));
    releases = pending.filter((_, index) => results[index]?.status === "rejected");
    if (releases.length) throw new Error("session-resource-release-failed");
  })().finally(() => { releasing = undefined; });
  try {
    if (memory?.globalTransportToken) {
      const transport = await startGlobalTransport({ token: memory.globalTransportToken, signal: managed?.context.signal });
      releases.push(() => transport.close());
      const credentialKey = adapter?.runnerId === "claude" ? "SUPERMEMORY_CC_API_KEY" : "SUPERMEMORY_API_KEY";
      envOverlay = { ...envOverlay, [credentialKey]: transport.token, SUPERMEMORY_API_URL: transport.apiUrl,
        ...(adapter?.runnerId === "claude" ? { SUPERMEMORY_MCP_URL: transport.mcpUrl } : {}) };
    }
    const codebase = servers["codebase-memory"];
    if (managed) {
      if (!codebase) capabilityAvailability.push({ capabilityId: "codebase-memory", status: "unselected" });
      else {
        try {
          if (codebase.transport === "http") throw new SessionCodebaseReadinessError("unsupported");
          const prepared = await managed.readiness.ensure(codebase, managed.context, envOverlay);
          servers["codebase-memory"] = prepared;
          releases.push(() => managed.readiness.release(prepared));
          capabilityAvailability.push({ capabilityId: "codebase-memory", status: "ready" });
        } catch (error) {
          if (managed.context.signal.aborted || !(error instanceof SessionCodebaseReadinessError) || error.kind === "cancelled") throw error;
          delete servers["codebase-memory"];
          suppressedMcpServers.push("codebase-memory");
          capabilityAvailability.push({ capabilityId: "codebase-memory", status: "unavailable", reasonCode: `codebase-memory-${error.kind}` });
        }
      }
    }
    if (releases.length) {
      release = releaseResources;
    }
  } catch (error) {
    await Promise.allSettled(releases.map(close => Promise.resolve().then(close)));
    throw error;
  }

  return {
    ...(managed ? { capabilityAvailability, personalMcpAvailability, suppressedMcpServers } : {}),
    ...(memory ? { nativeMemory: memory.nativeMemory } : {}),
    runnerPackages: () => Object.keys(servers), memoryProviderIds, webSearch,
    ...(envOverlay ? { envOverlay } : {}), resolveServer: (id) => servers[id],
    ...(release ? { release } : {}),
  };
}

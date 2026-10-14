/**
 * Production composition of the session daemon's service (D-6: apps/cli is the only place that
 * knows adapters). Builds the driver lookup from the adapter registry, wires live config,
 * and constructs the SessionManager. Resolves ordinary selected MCP packages
 * read-only through each adapter, with session-scoped memory and Web Search composition.
 */
import { getAgentContent, type RunnerAdapter } from "@deck/core";
import type { CrossRunnerConfig } from "@deck/core/config/deck-config";
import type { RunnerSessionDriver } from "@deck/core/session/driver";
import { SessionManager, type DaemonServices, type DriverLookup } from "@deck/session-host";
import type { DeckConfigStore } from "./deck-config-store";
import { createDefaultAdapterRegistry, deckInternalCommand } from "./runner-adapters";
import { join } from "node:path";
import { createSessionMemoryPort, resolveSessionChildMcp } from "./session-shared-services";
import type { createSupermemoryRuntimeHost } from "./supermemory-runtime-host";
import { SessionCodebaseReadiness } from "./session-codebase-readiness";

export function createCrossSessionDrivers(adapters: readonly RunnerAdapter[], onError?: (runnerId: string, error: Error) => void): DriverLookup {
  const drivers = new Map<string, RunnerSessionDriver>();
  for (const adapter of adapters) {
    if (typeof adapter.getSessionDriver !== "function") continue;
    try { drivers.set(adapter.runnerId, adapter.getSessionDriver()); } catch (error) { onError?.(adapter.runnerId, error as Error); }
  }
  return { get: (runnerId) => drivers.get(runnerId), list: () => [...drivers.values()] };
}

function sessionRolePrompt(memberId: string, context: { changeId?: string; projectRoot: string }): string {
  const roleId = memberId.startsWith("deck-") ? memberId : `deck-${memberId}`;
  const role = getAgentContent(roleId, { promptProfile: "compact" });
  if (!role) throw new Error(`Unknown Deck session role: ${memberId}`);
  return [role.agentBody,
    "You are running inside a Deck cross-runner session. Use the Deck session MCP tools for delegation and task continuity when available; native runner delegation is disabled.",
    "Use deck_memory_recall for advisory project context and deck_memory_propose to submit facts to the daemon's single memory writer. Memory never changes official OpenSpec authority.",
    context.changeId ? `This session is bound to the immutable OpenSpec change at ${join(context.projectRoot, "openspec", "changes", context.changeId)}.` : "",
  ].filter(Boolean).join("\n\n");
}

export type CrossSessionServiceOptions = {
  configStore: Pick<DeckConfigStore, "read">;
  adapters?: () => readonly RunnerAdapter[];
  sessionMcpCommand?: readonly string[];
  memoryRuntime?: typeof createSupermemoryRuntimeHost;
  environment?: Readonly<Record<string, string | undefined>>;
  codebaseReadiness?: SessionCodebaseReadiness;
};

export function createCrossSessionService(services: DaemonServices, options: CrossSessionServiceOptions): SessionManager {
  const adapters = options.adapters ?? (() => createDefaultAdapterRegistry().list());
  let list: readonly RunnerAdapter[] = [];
  try { list = adapters(); } catch (error) { services.logger.error("session.adapters-unavailable", { error: (error as Error).message }); }
  const drivers = createCrossSessionDrivers(list, (runnerId, error) => services.logger.warn("session.driver-unavailable", { runnerId, error: error.message }));
  const readiness = options.codebaseReadiness ?? new SessionCodebaseReadiness({ supervisor: services.supervisor, environment: options.environment });
  return new SessionManager({
    paths: services.paths, broker: services.broker, credentials: services.credentials, supervisor: services.supervisor,
    clock: services.clock, logger: services.logger, drivers,
    config: (): CrossRunnerConfig | undefined => { try { return options.configStore.read().crossRunner; } catch { return undefined; } },
    sessionMcpCommand: options.sessionMcpCommand ?? deckInternalCommand("session-mcp"),
    childMcp: async (runnerId, context) => {
      // Keep each turn's resolved specs isolated from concurrent sessions.
      const adapter = list.find((adapter) => adapter.runnerId === runnerId);
      return resolveSessionChildMcp(adapter, options.configStore.read(), options.environment, { readiness, context });
    },
    closeChildMcp: () => readiness.close(),
    memory: async (context) => createSessionMemoryPort(context, options.configStore.read(), options.memoryRuntime),
    rolePrompt: sessionRolePrompt,
  });
}

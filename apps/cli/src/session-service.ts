import { preparationCapabilities } from "./preparation-capabilities";
import { validateClaudeSessionIntent } from "../../../packages/adapter-claude/src/session-skills";
import { renderSessionOverlay, type SessionOverlaySection } from "@deck/core/session/overlay";
import { composeSessionStartContextV1 } from "../../../packages/sdd-runtime/src/execution/session-start-context";
import { createHash } from "node:crypto";
import { ProjectPreparationService } from "../../../packages/sdd-runtime/src/execution/project-preparation";
import { isCodebaseMemoryEnabled } from "@deck/core";
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import { prepareSessionNativeRole, prepareSessionNativeSkills } from "./session-native-skills";
import {readScopedTaskDiff} from "./session-task-diff";
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
import type { NativeMemoryPreparationEffects } from "./session-native-memory";
import { discoverSessionModels } from "./session-model-catalog";

export function createCrossSessionDrivers(adapters: readonly RunnerAdapter[], onError?: (runnerId: string, error: Error) => void): DriverLookup {
  const drivers = new Map<string, RunnerSessionDriver>();
  for (const adapter of adapters) {
    if (typeof adapter.getSessionDriver !== "function") continue;
    try { drivers.set(adapter.runnerId, adapter.getSessionDriver()); } catch (error) { onError?.(adapter.runnerId, error as Error); }
  }
  return { get: (runnerId) => drivers.get(runnerId), list: () => [...drivers.values()] };
}

export type { SessionRolePromptTask } from "@deck/core/session/overlay";
export type SessionRolePromptContext = import("@deck/core/session/overlay").SessionOverlayContext;

export function sessionRolePrompt(memberId: string, context: SessionRolePromptContext): string {
  const roleId = memberId.startsWith("deck-") ? memberId : `deck-${memberId}`;
  const isLead = roleId === "deck-lead";
  const role = context.runnerId === "claude" || context.runnerId === "codex" || context.runnerId === "opencode" || context.runnerId === "pi" ? undefined : getAgentContent(roleId, { promptProfile: "compact" });
  if (!DEVELOPER_TEAM_AGENTS.some(agent => agent.id === roleId)) throw new Error(`Unknown Deck session role: ${memberId}`);
  const sections: SessionOverlaySection[] = [{ kind: "session-notice" }];
  if (isLead) sections.push({ kind: "delegation", context }, { kind: "task-roster", tasks: context.tasks });
  sections.push({ kind: "memory-status" });
  if (context.changeId) sections.push({ kind: "change-binding", changePath: join(context.projectRoot, "openspec", "changes", context.changeId) });
  return [role?.agentBody, renderSessionOverlay(roleId, sections)].filter(Boolean).join("\n\n");
}

export type CrossSessionServiceOptions = {
  configStore: Pick<DeckConfigStore, "read">;
  adapters?: () => readonly RunnerAdapter[];
  sessionMcpCommand?: readonly string[];
  memoryRuntime?: typeof createSupermemoryRuntimeHost;
  environment?: Readonly<Record<string, string | undefined>>;
  codebaseReadiness?: SessionCodebaseReadiness;
  nativeMemoryEffects?: NativeMemoryPreparationEffects;
};

export function createCrossSessionService(services: DaemonServices, options: CrossSessionServiceOptions): SessionManager {
  const adapters = options.adapters ?? (() => createDefaultAdapterRegistry().list());
  let list: readonly RunnerAdapter[] = [];
  try { list = adapters(); } catch (error) { services.logger.error("session.adapters-unavailable", { error: (error as Error).message }); }
  const drivers = createCrossSessionDrivers(list, (runnerId, error) => services.logger.warn("session.driver-unavailable", { runnerId, error: error.message }));
  const readiness = options.codebaseReadiness ?? new SessionCodebaseReadiness({ supervisor: services.supervisor, environment: options.environment });
  const projectPreparation = new ProjectPreparationService({ registryProvider: runnerId => list.find(adapter => adapter.runnerId === runnerId)?.skillDiscovery });
  return new SessionManager({
    projectPreparation,
    preparationScope: input => {
      const config = options.configStore.read();
      const byRunner = new Map([...new Set(Object.values(input.members).map(a => a.runnerId))].map(runnerId => [runnerId, {
        ...preparationCapabilities(config, runnerId), ...list.find(adapter => adapter.runnerId === runnerId)?.readPreparationCapabilities?.(config),
      }]));
      return { projectRoot: input.projectRoot, sessionId: input.sessionId, epoch: input.epoch,
        policyDigest: createHash("sha256").update(JSON.stringify(Object.entries(input.members).map(([id, a]) => [id, a.runnerId, byRunner.get(a.runnerId)!]))).digest("hex"),
        members: Object.entries(input.members).map(([memberId, a]) => ({ memberId, runnerId: a.runnerId, bindingId: `${memberId}@${a.runnerId}`, capabilities: byRunner.get(a.runnerId)! })),
      };
    },
    sessionStartContext: composeSessionStartContextV1,
    paths: services.paths, broker: services.broker, credentials: services.credentials, supervisor: services.supervisor,
    clock: services.clock, logger: services.logger, drivers,
    config: (): CrossRunnerConfig | undefined => options.configStore.read().crossRunner,
    sessionMcpCommand: options.sessionMcpCommand ?? deckInternalCommand("session-mcp"),
    childMcp: async (runnerId, context) => {
      // Keep each turn's resolved specs isolated from concurrent sessions.
      const adapter = list.find((adapter) => adapter.runnerId === runnerId);
      const nativeSkills = await prepareSessionNativeSkills(adapter, options.configStore.read(), check => services.logger.warn("claude.session-skills-unverified", { check }));
      const resolver = await resolveSessionChildMcp(adapter, options.configStore.read(), options.environment, { readiness, context, nativeSkills }, options.nativeMemoryEffects);
      const validateLaunch = nativeSkills ? () => validateClaudeSessionIntent(nativeSkills, options.configStore.read()) : undefined;
      // Managed preparation may await a backend. Recheck intent after that wait,
      // and release the binding if the generation was revoked in the meantime.
      try { validateLaunch?.(); }
      catch (error) { await resolver.release?.(); throw error; }
      return { ...resolver, ...(nativeSkills ? { nativeSkills, validateLaunch } : {}),
        ...(adapter?.runnerId === "codex" || adapter?.runnerId === "opencode" || adapter?.runnerId === "pi" ? { prepareNativeRole: async (roleId: string) => {
          return prepareSessionNativeRole(adapter, roleId);
        } } : {}),
      };
    },
    closeChildMcp: () => readiness.close(),
    memory: async (context) => createSessionMemoryPort(context, options.configStore.read(), options.memoryRuntime),
    rolePrompt: sessionRolePrompt,
    assignedRoleId: memberId => { const roleId=memberId.startsWith("deck-")?memberId:`deck-${memberId}`; return DEVELOPER_TEAM_AGENTS.some(role => role.id === roleId) ? roleId : undefined; },
    scopedDiff: readScopedTaskDiff,
    modelCatalog: (projectRoot, projectConfigTrusted, signal) => discoverSessionModels(list, drivers, projectRoot, projectConfigTrusted, signal),
  });
}

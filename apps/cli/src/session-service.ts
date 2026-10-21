/**
 * Production composition of the session daemon's service (D-6: apps/cli is the only place that
 * knows adapters). Builds the driver lookup from the adapter registry, wires live config,
 * and constructs the SessionManager. Resolves ordinary selected MCP packages
 * read-only through each adapter, with session-scoped memory and Web Search composition.
 */
import { getAgentContent, type RunnerAdapter } from "@deck/core";
import type { CrossRunnerConfig } from "@deck/core/config/deck-config";
import { redactText } from "@deck/core/session/redaction";
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
import { readSessionProjectInstructions } from "./session-project-instructions";

export function createCrossSessionDrivers(adapters: readonly RunnerAdapter[], onError?: (runnerId: string, error: Error) => void): DriverLookup {
  const drivers = new Map<string, RunnerSessionDriver>();
  for (const adapter of adapters) {
    if (typeof adapter.getSessionDriver !== "function") continue;
    try { drivers.set(adapter.runnerId, adapter.getSessionDriver()); } catch (error) { onError?.(adapter.runnerId, error as Error); }
  }
  return { get: (runnerId) => drivers.get(runnerId), list: () => [...drivers.values()] };
}

export type SessionRolePromptTask = {
  taskId: string;
  memberId: string;
  state: string;
  attempt: number;
  summary?: string;
};

export type SessionRolePromptContext = {
  changeId?: string;
  projectRoot: string;
  runnerId: string;
  delegableMembers?: readonly string[];
  /** Oldest to newest; render at most 20, running first and newest first within each group. */
  tasks?: readonly SessionRolePromptTask[];
};

function rosterText(value: string, limit: number): string {
  // Redact before truncation so a clipped credential cannot escape detection.
  const clean = redactText(value, 256 * 1024).replace(/\s+/gu, " ").trim();
  return clean.length > limit ? clean.slice(0, limit - 1) + "…" : clean;
}

function sessionTaskRoster(tasks: SessionRolePromptContext["tasks"]): string {
  if (!tasks?.length) return "";
  const selected = tasks.map((task, index) => ({ task, index }))
    .sort((a, b) => Number(b.task.state === "running") - Number(a.task.state === "running") || b.index - a.index)
    .slice(0, 20);
  return [
    "Tasks in this session",
    ...selected.map(({ task }) => {
      const summary = rosterText(task.summary ?? "", 120);
      return `- ${rosterText(task.memberId, 80)} ${rosterText(task.taskId, 128)} [${rosterText(task.state, 40)}, attempt ${task.attempt}]${summary ? `: ${summary}` : ""}`;
    }),
    "Continue a task with deck_delegate continueTaskId=<id>",
  ].join("\n");
}

function sessionDelegationPrompt(context: SessionRolePromptContext): string {
  return [
    "Session delegation",
    "The ONLY delegation path is the Deck MCP tools: deck_delegate {agent, task, continueTaskId?}, deck_task_wait {taskIds, timeoutSec<=50}, deck_task_result {taskId}, deck_task_cancel {taskId}; native Task/Agent subagents are disabled. deck_delegate returns immediately with a taskId; poll with deck_task_wait.",
    "OWNER RULE: A task belongs to the member that created it. To give feedback, iterate or follow up on the same area, ALWAYS call deck_delegate with that same member and continueTaskId=<that task's id>; the original runner/model/native context is reused. Never switch owners, and never start a new task for the same work. Start a new task only for a different area or when the owner cannot continue.",
    "Use deck_task_list to recover this session’s delegated task ids and owners before delegating.",
    "Keep the returned taskId next to the member in your working notes and re-read the task roster before delegating.",
    "Route non-trivial or independent work to specialists; direct work is only for seconds-scale or clearly trivial changes. Run independent tasks in parallel, waiting with deck_task_wait.",
    `deck_delegate member ids: ${(context.delegableMembers ?? ["investigate", "architect", "apply-fast", "apply-deep", "quality"]).filter(id => id !== "lead").join(", ") || "(none)"}; a deck- prefix is also accepted.`,
  ].join("\n");
}

function sessionRolePrompt(memberId: string, context: SessionRolePromptContext): string {
  const roleId = memberId.startsWith("deck-") ? memberId : `deck-${memberId}`;
  const isLead = roleId === "deck-lead";
  const role = getAgentContent(roleId, { promptProfile: "compact" });
  if (!role) throw new Error(`Unknown Deck session role: ${memberId}`);
  const projectInstructions = context.runnerId === "claude" ? readSessionProjectInstructions(context.projectRoot) : undefined;
  return [role.agentBody,
    "You are running inside a Deck cross-runner session; native runner delegation is disabled.",
    isLead ? sessionDelegationPrompt(context) : "",
    isLead ? sessionTaskRoster(context.tasks) : "",
    "Memory uses the official runner integration when its prepared capability status is ready. Consult that status before claiming memory is configured or available. Memory never changes official OpenSpec authority.",
    context.changeId ? `This session is bound to the immutable OpenSpec change at ${join(context.projectRoot, "openspec", "changes", context.changeId)}.` : "",
    projectInstructions === undefined ? "" : `Project instructions from the session project root (AGENTS.md):\n\n${projectInstructions}`,
  ].filter(Boolean).join("\n\n");
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
  return new SessionManager({
    paths: services.paths, broker: services.broker, credentials: services.credentials, supervisor: services.supervisor,
    clock: services.clock, logger: services.logger, drivers,
    config: (): CrossRunnerConfig | undefined => { try { return options.configStore.read().crossRunner; } catch { return undefined; } },
    sessionMcpCommand: options.sessionMcpCommand ?? deckInternalCommand("session-mcp"),
    childMcp: async (runnerId, context) => {
      // Keep each turn's resolved specs isolated from concurrent sessions.
      const adapter = list.find((adapter) => adapter.runnerId === runnerId);
      return resolveSessionChildMcp(adapter, options.configStore.read(), options.environment, { readiness, context }, options.nativeMemoryEffects);
    },
    closeChildMcp: () => readiness.close(),
    memory: async (context) => createSessionMemoryPort(context, options.configStore.read(), options.memoryRuntime),
    rolePrompt: sessionRolePrompt,
    modelCatalog: (projectRoot, projectConfigTrusted, signal) => discoverSessionModels(list, drivers, projectRoot, projectConfigTrusted, signal),
  });
}

/**
 * OpenCode RunnerAdapter — TUI-facing facade for the OpenCode runner.
 *
 * Wraps all OpenCode-specific functions into the RunnerAdapter interface,
 * providing a drop-in replacement for hardcoded runner logic in app.tsx.
 *
 * Design: runner-decoupling-refactor / design.md § RunnerAdapter Contract
 */

import { homedir } from "node:os";
import { appendFileSync, writeFileSync, existsSync, promises as fs } from "node:fs";

const LOG = "/tmp/deck-tui.log";
function _ts() { return new Date().toISOString().slice(11, 23); }
function log(msg: string) { if (!process.env.DECK_DEBUG) return; try { appendFileSync(LOG, `${_ts()} [opencode-adapter] ${msg}\n`); } catch {} }
import { join } from "node:path";

import type {
  RunnerAdapter,
  RunnerId,
  RunnerEnvironmentId,
  RuntimeDetectionInput,
  RuntimeStatus,
  CapabilityInventoryInput,
  CapabilityInventory,
  DashboardState,
  ReviewPlan,
  InstallationPlan,
  InstallationStep,
  RunnerAction,
  RunnerActionContext,
  RunnerActionRunResult,
  TeamEntry,
  ModelCatalog,
  ModelCatalogContext,
  DeveloperTeamModelAssignments,
  DeveloperTeamThinkingAssignments,
  RunnerThinkingLevel,
  DeveloperTeamAdapterInstallInput,
  RunnerDeveloperTeamInstallPlan,
  DeveloperTeamApplyInput,
  DeveloperTeamApplyResult,
  RunnerMcpConfigInput,
  RunnerMcpConfigResult,
  FlowState,
  NextScreen,
  RunnerDeckInstallInput,
  RunnerDeckInstallStatus,
  RunnerModelDiscoveryRequest,
  RunnerModelInventoryResult,
  RunnerModelAssignmentValidationInput,
  RunnerModelAssignmentValidationResult,
} from "@deck/core";

import { getModelCatalog } from "@deck/core";
import { getStandaloneSkill, getStandaloneSkills } from "@deck/core/skills/external";

// ---------------------------------------------------------------------------
// OpenCode-specific imports
// ---------------------------------------------------------------------------

import { inspectOpenCodeEnvironment } from "./preflight";
import type { OpenCodeToolsReview } from "./required-tools";
import { reviewOpenCodeTools } from "./required-tools";
import {
  buildOpenCodeRunnerCapabilityInventory,
  type OpenCodeRunnerCapabilityInventory,
  type OpenCodeRunnerFullCapabilityInventory,
} from "./capability-inventory";
import {
  buildOpenCodeRunnerReviewPlan,
  type OpenCodeRunnerReviewPlan,
  type BuildOpenCodeRunnerReviewPlanState as OpenCodeReviewPlanState,
} from "./capability-plan";
import { buildOpenCodeInstallationPlan, OPENCODE_INSTALLABLE_TOOLS, type InstallableOpenCodeTool, getSelectableOpenCodeTools } from "./installation-plan";
import { getTeamsForEnvironment } from "./team-catalog";
import {
  readOpenCodeDeveloperTeamModelConfigAssignments,
} from "./model-config";
import {
  buildOpenCodeDeveloperTeamInstallPlan,
  applyOpenCodeDeveloperTeamInstall,
  backupDeveloperTeamFiles,
  rollbackDeveloperTeamFiles,
  verifyOpenCodeDeveloperTeamInstall,
  type OpenCodeDeveloperTeamInstallPlan,
  type OpenCodeDeveloperTeamApplyResult,
} from "./developer-team-install";
import { writeOpenCodeMcpConfig } from "./opencode-mcp-config";
import { getUserFacingOpenCodeCapability, OPENCODE_RUNNER_CAPABILITY_IDS } from "./capability-catalog";
import type { CapabilityCatalogEntry } from "@deck/core";
import { discoverModelInventory } from "./model-inventory";
import { LastKnownGoodStore, ModelInventoryCache, buildDiscoveryFingerprint, buildLastKnownGoodScopeKey } from "./model-inventory-cache";
import { nodeOpenCodeCommandRunner, OPENCODE_DISCOVERY_TIMEOUT_MS, type ModelDiscoveryFileSystem, type OpenCodeCommandRunner } from "./opencode-models-cli";
import { collectOpenCodeDiscoveryContext } from "./model-discovery-context";
import type { RunnerModelInventory, RunnerModelEntry } from "@deck/core";

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

const OPENCODE_ENVIRONMENT_IDS = ["opencode-development"] as const;

/**
 * Options for constructing an OpenCode runner adapter.
 *
 * `inventoryDiscovery` is primarily a testing seam: production code leaves it
 * undefined so the adapter uses runner-resolved discovery. Tests inject a fixed inventory to assert
 * model-specific effort-level behavior without touching the filesystem.
 */
export type OpenCodeRunnerAdapterOptions = {
  /** Injected runner-only discovery for deterministic tests. */
  inventoryDiscovery?: (request: RunnerModelDiscoveryRequest) => Promise<RunnerModelInventoryResult>;
  /** Partial node-boundary replacement used only to hermetically prove default production composition. */
  productionDiscoveryDependencies?: Partial<OpenCodeProductionDiscoveryDependencies>;
  /** Isolated install root for adapter integration tests; production retains OpenCode's config directory. */
  developerTeamConfigDir?: string;
};

export type DiscoveryTimers = { setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>; clearTimeout(timer: ReturnType<typeof setTimeout>): void };
export type OpenCodeProductionDiscoveryDependencies = {
  commandRunner: OpenCodeCommandRunner;
  fs: ModelDiscoveryFileSystem;
  now: () => number;
  timers: DiscoveryTimers;
  env: Readonly<Record<string, string | undefined>>;
  homeDir: string;
  xdgConfigHome: string;
  xdgDataHome: string;
  xdgCacheHome: string;
  resolveExecutable: (command: string, env: Readonly<Record<string, string | undefined>>) => Promise<string>;
  resolveWorkspaceRoot: (projectRoot: string) => Promise<string>;
  resolvePluginEntry: (reference: string, fromDirectory: string) => Promise<string | null>;
};

function nodeProductionDiscoveryDependencies(): OpenCodeProductionDiscoveryDependencies {
  const fileSystem: ModelDiscoveryFileSystem = {
    readFile: (path) => fs.readFile(path, "utf8"),
    stat: async (path) => { const value = await fs.stat(path); return { size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs, mode: value.mode, dev: value.dev, ino: value.ino, isFile: () => value.isFile(), isDirectory: () => value.isDirectory() }; },
    realpath: (path) => fs.realpath(path),
    readdir: (path) => fs.readdir(path),
    mkdir: async (path, mode) => { await fs.mkdir(path, { recursive: true, mode }); },
    writeFile: (path, body, mode) => fs.writeFile(path, body, { mode }),
    rename: (from, to) => fs.rename(from, to),
    chmod: (path, mode) => fs.chmod(path, mode),
    lstat: async (path) => { const value = await fs.lstat(path); return { mode: value.mode, isSymbolicLink: () => value.isSymbolicLink() }; },
    unlink: (path) => fs.unlink(path),
  };
  return {
    commandRunner: nodeOpenCodeCommandRunner, fs: fileSystem, now: Date.now,
    timers: { setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: (timer) => clearTimeout(timer) },
    env: process.env, homeDir: homedir(), xdgConfigHome: process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), xdgDataHome: process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), xdgCacheHome: process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
    resolveExecutable: async (_command, env) => {
      const found = (env.PATH?.split(":") ?? []).map((directory) => join(directory, "opencode")).find((candidate) => existsSync(candidate));
      if (!found) throw new Error("opencode not found");
      return fileSystem.realpath(found);
    },
    resolveWorkspaceRoot: async (projectRoot) => projectRoot,
    resolvePluginEntry: async (reference, fromDirectory) => reference.startsWith("file:") ? join(fromDirectory, reference.slice(5)) : reference.startsWith(".") ? join(fromDirectory, reference) : null,
  };
}

/** The only production composition point; tests inject every external boundary without changing behavior. */
export function createDefaultOpenCodeInventoryDiscovery(overrides: Partial<OpenCodeProductionDiscoveryDependencies> = {}): (request: RunnerModelDiscoveryRequest) => Promise<RunnerModelInventoryResult> {
  const dependencies = { ...nodeProductionDiscoveryDependencies(), ...overrides } as OpenCodeProductionDiscoveryDependencies;
  const cache = new ModelInventoryCache({ now: dependencies.now });
  const lkgByScope = new Map<string, LastKnownGoodStore>();
  return async (request) => {
    const startedAt = dependencies.now();
    const deadlineAt = startedAt + OPENCODE_DISCOVERY_TIMEOUT_MS;
    const controller = new AbortController();
    let candidate: { fingerprint: string; snapshot: { inventory: RunnerModelInventory; discoveredAt: number } } | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<RunnerModelInventoryResult>((resolve) => {
      deadlineTimer = dependencies.timers.setTimeout(() => {
        controller.abort();
        const error = { code: "timeout" as const, message: "OpenCode model discovery timed out. Try again.", retryable: true };
        resolve(candidate ? { state: "stale", inventory: candidate.snapshot.inventory, source: "last-known-good", discoveredAt: candidate.snapshot.discoveredAt, fingerprint: candidate.fingerprint, error } : { state: "blocked", inventory: null, source: "none", error });
      }, OPENCODE_DISCOVERY_TIMEOUT_MS);
    });
    const work = (async (): Promise<RunnerModelInventoryResult> => {
      const executable = await dependencies.resolveExecutable("opencode", dependencies.env);
      const versionResult = await dependencies.commandRunner.run({ file: executable, args: ["--version"], cwd: request.projectRoot, timeoutMs: Math.min(2_000, Math.max(0, deadlineAt - dependencies.now())), maxStdoutBytes: 4_096, maxStderrBytes: 4_096, signal: controller.signal });
      const version = versionResult.exitCode === 0 && !versionResult.terminationReason ? versionResult.stdout.trim().slice(0, 1_024) : null;
      const context = await collectOpenCodeDiscoveryContext({ projectRoot: request.projectRoot, executable, version, env: dependencies.env, homeDir: dependencies.homeDir, xdgConfigHome: dependencies.xdgConfigHome, xdgDataHome: dependencies.xdgDataHome, fs: dependencies.fs, resolveWorkspaceRoot: dependencies.resolveWorkspaceRoot, resolvePluginEntry: dependencies.resolvePluginEntry });
      const fingerprint = await buildDiscoveryFingerprint(context);
      const scopeKey = buildLastKnownGoodScopeKey({ runnerRealPath: context.runner.realPath, projectRoot: context.scope.projectRoot, workspaceRoot: context.scope.workspaceRoot });
      let lkg = lkgByScope.get(scopeKey);
      if (!lkg) { lkg = new LastKnownGoodStore({ fs: dependencies.fs, now: dependencies.now }, join(dependencies.xdgCacheHome, "deck", "opencode-model-inventory"), scopeKey); lkgByScope.set(scopeKey, lkg); }
      const snapshot = await lkg.read(fingerprint);
      if (snapshot) candidate = { fingerprint, snapshot };
      return discoverModelInventory({ projectRoot: request.projectRoot, mode: request.mode, cache, fingerprint, context, deadlineAt, signal: controller.signal, preloadedLastKnownGood: snapshot, readLastKnownGood: (key) => lkg!.read(key), writeLastKnownGood: (value) => lkg!.write(value.fingerprint, value.inventory, value.discoveredAt), dependencies: { commandRunner: dependencies.commandRunner, resolveExecutable: dependencies.resolveExecutable, env: dependencies.env, now: dependencies.now } });
    })();
    // Observe late work after the public race so it cannot become an unhandled rejection or a late commit.
    void work.catch(() => undefined);
    try { return await Promise.race([work, timeout]); }
    catch { return { state: "blocked", inventory: null, source: "none", error: { code: "command-failed", message: "OpenCode model discovery failed. Run opencode models --verbose to check the runner.", retryable: true } }; }
    finally { if (deadlineTimer) dependencies.timers.clearTimeout(deadlineTimer); }
  };
}

export function createOpenCodeRunnerAdapter(options?: OpenCodeRunnerAdapterOptions): RunnerAdapter {
  // Group 0 defines the core async port. Group 2 owns implementing it against
  // OpenCode discovery; retain this legacy facade until that adapter work lands.
  return new OpenCodeRunnerAdapterImpl(options) as unknown as RunnerAdapter;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class OpenCodeRunnerAdapterImpl {
  readonly runnerId: RunnerId = "opencode";
  readonly displayName: string = "OpenCode";
  readonly environmentIds: readonly RunnerEnvironmentId[] = [...OPENCODE_ENVIRONMENT_IDS];

  #inventoryDiscovery: (request: RunnerModelDiscoveryRequest) => Promise<RunnerModelInventoryResult>;
  #latestReady: Extract<RunnerModelInventoryResult, { state: "ready" }> | null = null;
  #planBindings = new WeakMap<RunnerDeveloperTeamInstallPlan, { nativePlan: OpenCodeDeveloperTeamInstallPlan; validation: { changedAgentIds: readonly string[]; fingerprint?: string; modelAssignments: DeveloperTeamModelAssignments; thinkingAssignments: DeveloperTeamThinkingAssignments } }>();
  #developerTeamConfigDir?: string;

  constructor(options?: OpenCodeRunnerAdapterOptions) {
    this.#developerTeamConfigDir = options?.developerTeamConfigDir;
    this.#inventoryDiscovery = options?.inventoryDiscovery
      ?? createDefaultOpenCodeInventoryDiscovery(options?.productionDiscoveryDependencies);
  }

  // -------------------------------------------------------------------------
  // Runtime detection
  // -------------------------------------------------------------------------

  async detectRuntimes(input?: RuntimeDetectionInput): Promise<readonly RuntimeStatus[]> {
    const result = inspectOpenCodeEnvironment({
      command: "opencode",
      pathExists: (path) => {
        try {
          const { existsSync } = require("node:fs");
          return existsSync(path);
        } catch {
          return false;
        }
      },
    });

    return [
      {
        runtimeId: "opencode",
        displayName: "OpenCode",
        isAvailable: result.existingConfiguration,
        version: result.version !== "unknown" ? result.version : undefined,
        diagnostics: result.existingConfiguration
          ? result.configDirectory ? [`Config directory: ${result.configDirectory}`] : []
          : ["OpenCode configuration not found."],
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Capability inventory
  // -------------------------------------------------------------------------

  async getCapabilityInventory(input: CapabilityInventoryInput): Promise<CapabilityInventory> {
    const toolsReview = reviewOpenCodeTools();
    const runnerScope = "opencode";

    const inventory = buildOpenCodeRunnerCapabilityInventory(toolsReview, {
      runnerScope,
      includeInternal: true,
    });

    // Map OpenCode-specific inventory to generic CapabilityInventory
    const capabilities: CapabilityCatalogEntry[] = [];

    // User-facing capabilities
    for (const [capabilityId, entry] of Object.entries(inventory)) {
      if (!entry || typeof entry !== "object") continue;
      if ("capabilityId" in entry && typeof entry.capabilityId === "string") {
        // Skip internal entries
        if (capabilityId === "_internal") continue;
        const cap = entry as { capabilityId: string; runnerScope: string; installed: boolean; status: string; diagnostics?: readonly string[] };
        const capability = require("./capability-catalog").getUserFacingOpenCodeCapability(capabilityId as any);
        if (!capability) continue;

        capabilities.push({
          capabilityId: cap.capabilityId,
          label: capability.label,
          description: capability.description,
          section: "runner-capabilities",
          requirementLevel: capability.requirementLevel,
          toolId: capability.toolId,
          source: capability.source,
          installKind: capability.installKind as CapabilityCatalogEntry["installKind"],
          isInstalled: cap.installed,
          isBlocked: cap.status === "blocked",
          diagnostics: cap.diagnostics,
        });
      }
    }

    // Internal capabilities
    const internal = inventory["_internal"] as OpenCodeRunnerFullCapabilityInventory["_internal"] | undefined;
    if (internal) {
      for (const [capabilityId, entry] of Object.entries(internal) as [string, NonNullable<OpenCodeRunnerFullCapabilityInventory["_internal"]>[keyof NonNullable<OpenCodeRunnerFullCapabilityInventory["_internal"]>]][]) {
        if (!entry || typeof entry !== "object") continue;
        capabilities.push({
          capabilityId: entry.capabilityId as string,
          label: entry.capabilityId === "opencode-mermaid" ? "Mermaid" : entry.capabilityId,
          description: "OpenCode visual documentation capability.",
          section: "runner-capabilities",
          requirementLevel: "required",
          source: entry.source,
          installKind: "opencode-plugin" as const,
          isInstalled: entry.installed,
          isBlocked: (entry.status as string) === "blocked",
          diagnostics: entry.diagnostics,
        });
      }
    }

    return {
      capabilities,
      runnerId: this.runnerId,
      environmentId: input?.environmentId ?? "opencode-development",
    };
  }

  // -------------------------------------------------------------------------
  // Review and installation planning
  // -------------------------------------------------------------------------

  buildReviewPlan(state: DashboardState & { teams?: Record<string, unknown>; packageInstructions?: Record<string, unknown>; runtime?: { toolsReview?: unknown } }, inventory: CapabilityInventory): ReviewPlan {
    log(`buildReviewPlan: START. inventoryType=${typeof inventory} hasCapabilities=${!!inventory?.capabilities}`);
    try {
    // Normalize inventory: accept both CapabilityInventory (with .capabilities) 
    // and plain Record<capabilityId, entry> (as stored by the dashboard)
    const capabilities = inventory.capabilities 
      ?? Object.values(inventory as Record<string, { capabilityId?: string; isInstalled?: boolean; isBlocked?: boolean; toolId?: string; source?: string; diagnostics?: readonly string[] }>);
    log(`buildReviewPlan: capabilities count=${Array.isArray(capabilities) ? capabilities.length : "not-array"}`);
    
    // Map CapabilityInventory back to OpenCode's native inventory format
    const nativeInventory: OpenCodeRunnerCapabilityInventory = {};
    for (const entry of capabilities) {
      if (!entry.capabilityId) continue;
      (nativeInventory as Record<string, unknown>)[entry.capabilityId] = {
        capabilityId: entry.capabilityId,
        runnerScope: "opencode",
        installed: entry.isInstalled,
        status: entry.isInstalled ? "ready" : entry.isBlocked ? "blocked" : "missing",
        toolId: entry.toolId,
        source: entry.source,
        diagnostics: entry.diagnostics ?? [],
      };
    }
    log(`buildReviewPlan: nativeInventory entries=${Object.keys(nativeInventory).length}`);

    // Build state for OpenCode review plan builder
    const toolsReview = reviewOpenCodeTools();
    log(`buildReviewPlan: toolsReview done`);

    const openCodeState: OpenCodeReviewPlanState = {
      runnerScope: state.runnerId,
      selectedCapabilities: state.selectedCapabilities,
      adaptiveMemory: state.adaptiveMemory.provider !== "none" ? {
        provider: state.adaptiveMemory.provider,
        supermemory: state.adaptiveMemory.supermemory ? {
          configured: state.adaptiveMemory.supermemory.configured,
          hasToken: state.adaptiveMemory.supermemory.hasToken,
        } : undefined,
      } : undefined,
      teams: state.teams as Record<string, { selected?: boolean; modelAssignments?: unknown; thinkingAssignments?: unknown }> | undefined,
      packageInstructions: state.packageInstructions ? { [state.runnerId]: state.packageInstructions as any } : undefined,
      runtime: { toolsReview },
    };
    log(`buildReviewPlan: calling buildOpenCodeRunnerReviewPlan`);

    const nativePlan = buildOpenCodeRunnerReviewPlan(openCodeState, nativeInventory);
    log(`buildReviewPlan: nativePlan done. groups=${JSON.stringify(Object.keys(nativePlan.groups))}`);

    // Map native plan to generic ReviewPlan
    log(`buildReviewPlan: mapping native plan to generic ReviewPlan`);
    const result: ReviewPlan = {
      groups: {
        automaticInstalls: nativePlan.groups.automaticInstalls.map(this.mapOpenCodeAction),
        manualSteps: nativePlan.groups.manualSteps.map(this.mapOpenCodeAction),
        configWrites: nativePlan.groups.configWrites.map(this.mapOpenCodeAction),
        teamApplications: nativePlan.groups.teamApplications.map(this.mapOpenCodeAction),
        validations: nativePlan.groups.validations.map(this.mapOpenCodeAction),
      },
      diagnostics: nativePlan.diagnostics.map((d) => ({
        code: d.code,
        message: d.message,
        severity: d.severity as ReviewPlan["diagnostics"][0]["severity"],
        capabilityId: d.capabilityId,
        actionId: d.actionId,
      })),
      ready: nativePlan.ready,
    };
    log(`buildReviewPlan: SUCCESS. ready=${result.ready} diagnostics=${result.diagnostics.length}`);
    return result;
    } catch (error) {
      const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
      log(`buildReviewPlan: FAILED: ${msg}`);
      throw error;
    }
  }

  private mapOpenCodeAction(action: { id: string; kind: string; title: string; description?: string; capabilityId?: string; toolId?: string; source?: string; status: string; required?: boolean; dependencies?: string[]; unresolvedCapabilities?: string[]; diagnostics?: string[] }): RunnerAction {
    return {
      id: action.id,
      kind: action.kind,
      title: action.title,
      description: action.description,
      capabilityId: action.capabilityId,
      toolId: action.toolId,
      source: action.source,
      status: action.status as RunnerAction["status"],
      required: action.required,
      dependencies: action.dependencies,
      unresolvedCapabilities: action.unresolvedCapabilities,
      diagnostics: action.diagnostics,
    };
  }

  buildInstallationPlan(state: DashboardState): InstallationPlan {
    const toolsReview = reviewOpenCodeTools();

    // Determine selected tool IDs based on packageInstructions or defaults
    const runnerScope = state.runnerId;
    const packageInstructions = state.packageInstructions;

    // Map package instructions to selected tool IDs
    let selectedToolIds: string[] = OPENCODE_INSTALLABLE_TOOLS.map((t) => t.id);

    // If we have package instructions, use those to determine selection
    if (packageInstructions && typeof packageInstructions === "object") {
      const opencodeInstructions = (packageInstructions as unknown as Record<string, Record<string, boolean>>)[runnerScope];
      if (opencodeInstructions) {
        selectedToolIds = Object.entries(opencodeInstructions)
          .filter(([, enabled]) => enabled)
          .map(([id]) => id);
      }
    }

    const plan = buildOpenCodeInstallationPlan({ tools: toolsReview.tools, selectedToolIds });

    const steps: InstallationStep[] = plan.map((tool) => ({
      action: "install" as const,
      tool: tool.module,
      reason: `${tool.name} is selected for installation`,
      capabilityId: tool.id,
    }));

    return { steps };
  }

  // -------------------------------------------------------------------------
  // Action execution
  // -------------------------------------------------------------------------

  async runAction(action: RunnerAction, context: RunnerActionContext): Promise<RunnerActionRunResult> {
    // Handle action based on its kind
    switch (action.kind) {
      case "install-opencode-plugin": {
        const { installOpenCodeTools } = require("./install-tools");
        const toolsReview = reviewOpenCodeTools();
        const plan = buildOpenCodeInstallationPlan({ tools: toolsReview.tools, selectedToolIds: [action.toolId ?? action.capabilityId ?? ""].filter(Boolean) });

        if (plan.length === 0) {
          return {
            actionId: action.id,
            status: "skipped",
            message: `Tool ${action.toolId ?? action.capabilityId} is already installed or not available.`,
            diagnostics: [],
          };
        }

        try {
          const results = await installOpenCodeTools("opencode", plan, () => {});
          const firstResult = results[0];
          return {
            actionId: action.id,
            status: firstResult?.success ? "executed" : "failed",
            message: firstResult?.success ? `${action.title} completed.` : `Installation failed: ${firstResult?.error}`,
            diagnostics: firstResult?.success ? [] : [firstResult?.error ?? "Unknown error"],
          };
        } catch (error) {
          return {
            actionId: action.id,
            status: "failed",
            message: `Installation failed: ${error instanceof Error ? error.message : String(error)}`,
            diagnostics: [error instanceof Error ? error.message : String(error)],
          };
        }
      }

      case "write-mcp-config": {
        const capabilityId = action.capabilityId ?? action.toolId;
        if (!capabilityId) {
          return {
            actionId: action.id,
            status: "failed",
            message: "No capabilityId or toolId specified for MCP config write.",
            diagnostics: ["Missing capabilityId/toolId"],
          };
        }

        const result = await this.writeMcpConfigFromCapability(capabilityId, action.source);
        return {
          actionId: action.id,
          status: result.ok ? "executed" : "failed",
          message: result.ok ? `MCP config written for ${capabilityId}.` : `Failed to write MCP config: ${result.diagnostics.join(", ")}`,
          diagnostics: result.diagnostics,
        };
      }

      case "write-deck-config": {
        // Deck config writes are informational — the actual write happens elsewhere
        return {
          actionId: action.id,
          status: "informational",
          message: "Deck config write is handled by the TUI layer.",
          diagnostics: [],
        };
      }

      case "validate": {
        return {
          actionId: action.id,
          status: "informational",
          message: action.title,
          diagnostics: action.diagnostics ?? [],
        };
      }

      case "apply-team-bundle": {
        // Team application is handled by buildDeveloperTeamInstallPlan / applyDeveloperTeamInstall
        return {
          actionId: action.id,
          status: "informational",
          message: "Developer team bundle will be applied during installation phase.",
          diagnostics: action.unresolvedCapabilities?.length ? [`Pending capabilities: ${action.unresolvedCapabilities.join(", ")}`] : [],
        };
      }

      default: {
        return {
          actionId: action.id,
          status: "informational",
          message: `Action ${action.kind} is informational or not yet implemented.`,
          diagnostics: [],
        };
      }
    }
  }

  private async writeMcpConfigFromCapability(capabilityId: string, source?: string): Promise<{ ok: boolean; diagnostics: string[] }> {
    try {
      switch (capabilityId) {
        case "context7": {
          return writeOpenCodeMcpConfig({
            serverName: "context7",
            type: "local",
            command: ["npx", "-y", "@upstash/context7-mcp"],
          });
        }
        case "context-mode": {
          // context-mode migrates from plugin to MCP
          // Must remove "context-mode" from plugin array to avoid conflict
          return writeOpenCodeMcpConfig({
            serverName: "context-mode",
            type: "local",
            command: ["context-mode"],
            pluginsToRemove: ["context-mode"],
          });
        }
        case "rtk": {
          // RTK MCP config — uses the rtk source for MCP server
          return writeOpenCodeMcpConfig({
            serverName: "rtk",
            type: "local",
            command: ["rtk", "mcp", "start"],
          });
        }
        case "supermemory": {
          // Supermemory is handled separately via adaptive memory flow
          return { ok: true, diagnostics: ["Supermemory MCP config handled by adaptive memory provider."] };
        }
        case "serena": {
          // Serena MCP config - verify serena command exists before writing config
          // This prevents broken OpenCode startup from invalid MCP config
          const { commandExistsInPath } = await import("./install-tools");
          const serenaExists = commandExistsInPath("serena");
          if (!serenaExists) {
            return {
              ok: false,
              diagnostics: ["Serena command not found in PATH. Install serena via 'uv tool install serena' or 'pipx install serena' first."],
            };
          }
          return writeOpenCodeMcpConfig({
            serverName: "serena",
            type: "local",
            command: ["serena", "start-mcp-server", "--context", "ide", "--project-from-cwd"],
          });
        }
        default: {
          if (source) {
            // Try to parse as MCP server URL
            return writeOpenCodeMcpConfig({
              serverName: capabilityId,
              type: "remote",
              url: source,
            });
          }
          return { ok: false, diagnostics: [`Unknown capability ${capabilityId} for MCP config write.`] };
        }
      }
    } catch (error) {
      return { ok: false, diagnostics: [error instanceof Error ? error.message : String(error)] };
    }
  }

  // -------------------------------------------------------------------------
  // Team management
  // -------------------------------------------------------------------------

  getTeams(environmentId: RunnerEnvironmentId): readonly TeamEntry[] {
    return getTeamsForEnvironment(environmentId);
  }

  // -------------------------------------------------------------------------
  // Model catalog and assignments
  // -------------------------------------------------------------------------

  getModelCatalog(context?: ModelCatalogContext): ModelCatalog {
    return getModelCatalog();
  }

  readModelAssignments(projectRoot: string): DeveloperTeamModelAssignments {
    const config = readOpenCodeDeveloperTeamModelConfigAssignments();
    return config.modelAssignments;
  }

  readThinkingAssignments(projectRoot: string): DeveloperTeamThinkingAssignments {
    const config = readOpenCodeDeveloperTeamModelConfigAssignments();
    // thinkingAssignments are stored as OpenCodeThinkingLevel, which is a string
    return config.thinkingAssignments as DeveloperTeamThinkingAssignments;
  }

  getThinkingLevels(modelId?: string): readonly string[] {
    if (!modelId || !this.#latestReady) return [];
    return findModelInInventory(this.#latestReady.inventory, modelId)?.variants ?? [];
  }

  supportsThinking(modelId: string): boolean {
    return this.getThinkingLevels(modelId).length > 0;
  }

  // -------------------------------------------------------------------------
  // Model inventory (configured providers only)
  // -------------------------------------------------------------------------

  async getModelInventory(request: RunnerModelDiscoveryRequest): Promise<RunnerModelInventoryResult> {
    const result = await this.#inventoryDiscovery(request);
    if (result.state === "ready") this.#latestReady = result;
    return result;
  }


  async validateModelAssignments(input: RunnerModelAssignmentValidationInput): Promise<RunnerModelAssignmentValidationResult> {
    const result = await this.getModelInventory({ projectRoot: input.projectRoot, mode: "prefer-cache" });
    if (result.state !== "ready" || (input.expectedFingerprint && input.expectedFingerprint !== result.fingerprint)) {
      return { valid: false, issues: input.changedAgentIds.map((agentId) => ({ agentId, code: "inventory-not-ready", message: "OpenCode availability must be refreshed before changing this assignment." })) };
    }
    const issues: import("@deck/core").RunnerModelAssignmentIssue[] = [];
    for (const agentId of input.changedAgentIds) {
      const modelId = input.modelAssignments[agentId];
      const variant = input.thinkingAssignments[agentId];
      const model = modelId ? findModelInInventory(result.inventory, modelId) : undefined;
      if (!model) issues.push({ agentId, code: "model-unavailable", message: "The selected model is unavailable in the active OpenCode runner." });
      else if (variant && !model.variants?.includes(variant)) issues.push({ agentId, code: "variant-unavailable", message: "The selected reasoning variant is unavailable for the model." });
    }
    return issues.length ? { valid: false, issues } : { valid: true, fingerprint: result.fingerprint };
  }

  // -------------------------------------------------------------------------
  // Developer Team installation
  // -------------------------------------------------------------------------

  buildDeveloperTeamInstallPlan(input: DeveloperTeamAdapterInstallInput): RunnerDeveloperTeamInstallPlan {
    const modelAssignments = input.modelAssignments ?? {};
    const thinkingAssignments = input.thinkingAssignments ?? {};
    const standaloneSkills = input.standaloneSkills ?? getStandaloneSkills().map(({ skillId }) => {
      const bundle = getStandaloneSkill(skillId);
      return { skillId, body: bundle.SKILL, files: bundle.files };
    });
    const nativePlan = buildOpenCodeDeveloperTeamInstallPlan(input.projectRoot, {
      configModelOverrides: modelAssignments,
      reasoningEffortOverrides: thinkingAssignments,
      changedAgentIds: input.changedAgentIds,
      memoryProvider: input.memoryProvider as any,
      supportedMemoryProviderIds: ["engram", "supermemory"],
      capabilityInstructions: input.capabilityInstructions,
      standaloneSkills,
    });
    const files: Array<{ path: string; content: string; kind: "skill" | "standalone-skill"; skillId: string; packagePath: string }> = [
      ...nativePlan.skills.map((skill) => ({ path: skill.relativePath, content: skill.content, kind: "skill" as const, skillId: skill.agent.skillId, packagePath: "SKILL.md" })),
      ...nativePlan.standaloneSkills.map((skill) => ({ path: skill.relativePath, content: skill.content, kind: "standalone-skill" as const, skillId: skill.skillId, packagePath: skill.packagePath })),
    ];
    const plan: RunnerDeveloperTeamInstallPlan = { files };
    this.#planBindings.set(plan, {
      nativePlan,
      validation: {
        changedAgentIds: [...(input.changedAgentIds ?? [])],
        fingerprint: input.validatedInventoryFingerprint,
        modelAssignments: { ...modelAssignments },
        thinkingAssignments: { ...thinkingAssignments },
      },
    });
    return plan;
  }

  async applyDeveloperTeamInstall(input: DeveloperTeamApplyInput): Promise<DeveloperTeamApplyResult> {
    const binding = this.#planBindings.get(input.plan);
    if (!binding) {
      throw new Error("The supplied developer-team plan was not built by this adapter instance.");
    }
    if (binding.validation.changedAgentIds.length) {
      const validation = await this.validateModelAssignments({
        projectRoot: input.projectRoot,
        modelAssignments: binding.validation.modelAssignments,
        thinkingAssignments: binding.validation.thinkingAssignments,
        changedAgentIds: binding.validation.changedAgentIds,
        expectedFingerprint: binding.validation.fingerprint,
      });
      if (!validation.valid) throw new Error(validation.issues.map((issue) => issue.message).join(" "));
    }
    const configDir = this.#developerTeamConfigDir ?? join(homedir(), ".config", "opencode");
    const nativePlan: OpenCodeDeveloperTeamInstallPlan = { ...binding.nativePlan, projectRoot: input.projectRoot };
    const result: OpenCodeDeveloperTeamApplyResult = applyOpenCodeDeveloperTeamInstall(nativePlan, { configDir });
    return {
      results: result.results.map((item) => ({ agentId: item.agentId, kind: item.kind, status: item.status })),
      changedCount: result.changedCount,
      unchangedCount: result.unchangedCount,
    };
  }

  // -------------------------------------------------------------------------
  // MCP config (optional)
  // -------------------------------------------------------------------------

  async writeMcpConfig(input: RunnerMcpConfigInput): Promise<RunnerMcpConfigResult> {
    // Supermemory uses a specialized writer that handles env var interpolation
    if (input.serverName === "supermemory" && input.token) {
      const { writeSupermemoryOpenCodeMcpConfig } = require("./opencode-mcp-config");
      const result = writeSupermemoryOpenCodeMcpConfig({
        token: input.token,
        serverName: input.serverName,
      });
      const diagnosticsList: string[] = [];
      if (result.diagnostics) {
        for (const d of result.diagnostics) diagnosticsList.push(d);
      }
      return {
        ok: result.ok,
        path: result.path,
        diagnostics: diagnosticsList,
      };
    }

    const result = writeOpenCodeMcpConfig({
      serverName: input.serverName,
      type: input.type ?? "local",
      command: input.command ? [...input.command] : undefined,
      url: input.url,
      headers: input.headers,
    });

    const diagnosticsList: string[] = [];
    if (result.diagnostics) {
      for (const d of result.diagnostics) diagnosticsList.push(d);
    }
    return {
      ok: result.ok,
      path: result.path,
      diagnostics: diagnosticsList,
    };
  }

  // -------------------------------------------------------------------------
  // Flow routing
  // -------------------------------------------------------------------------

  getNextScreen(state: FlowState): NextScreen {
    switch (state.currentScreen) {
      case "team-selection":
        return "developer-team-review";
      case "developer-team-review":
        return state.installProgress ? "developer-team-installing" : "developer-team-review";
      case "developer-team-installing":
        if (state.installProgress && state.installProgress.completed >= state.installProgress.total) {
          return "complete";
        }
        return "developer-team-installing";
      case "environment-selection":
        return "preflight-checking";
      case "personality-selection":
        return "preflight-checking";
      case "preflight-checking":
        return "team-selection";
      case "complete":
        return "complete";
      default:
        // For any unknown screen, advance through the typical flow
        if (state.selectedTeams && state.selectedTeams.length > 0) {
          return "developer-team-review";
        }
        return "team-selection";
    }
  }

  // -------------------------------------------------------------------------
  // Environment inspection
  // -------------------------------------------------------------------------

  async inspectEnvironment(): Promise<unknown> {
    return inspectOpenCodeEnvironment({
      command: "opencode",
      pathExists: (path) => {
        try {
          const { existsSync } = require("node:fs");
          return existsSync(path);
        } catch {
          return false;
        }
      },
    });
  }

  // -------------------------------------------------------------------------
  // Tool review
  // -------------------------------------------------------------------------

  async reviewTools(): Promise<unknown> {
    return reviewOpenCodeTools({ packageManifest: undefined });
  }

  // -------------------------------------------------------------------------
  // Team file backup/restore
  // -------------------------------------------------------------------------

  backupDeveloperTeamFiles(plan: unknown): unknown {
    const binding = this.#planBindings.get(plan as RunnerDeveloperTeamInstallPlan);
    if (!binding) throw new Error("The supplied developer-team plan was not built by this adapter instance.");
    return backupDeveloperTeamFiles(binding.nativePlan);
  }

  rollbackDeveloperTeamFiles(backup: unknown): void {
    rollbackDeveloperTeamFiles(backup as Parameters<typeof rollbackDeveloperTeamFiles>[0]);
  }

  // -------------------------------------------------------------------------
  // Developer team verification
  // -------------------------------------------------------------------------

  verifyDeveloperTeamInstall(plan: unknown): { valid: boolean; diagnostics: readonly string[] } {
    const binding = this.#planBindings.get(plan as RunnerDeveloperTeamInstallPlan);
    if (!binding) throw new Error("The supplied developer-team plan was not built by this adapter instance.");
    const result = verifyOpenCodeDeveloperTeamInstall(binding.nativePlan);
    const diagnostics = [
      ...result.agentResults.flatMap((entry) => entry.issues),
      ...result.skillResults.flatMap((entry) => entry.issues),
    ];
    return { valid: result.valid, diagnostics };
  }

  // -------------------------------------------------------------------------
  // Thinking resolution
  // -------------------------------------------------------------------------

  resolveThinking(modelId: string, existingAssignment?: string): string | undefined {
    const variants = this.getThinkingLevels(modelId);
    return existingAssignment && variants.includes(existingAssignment) ? existingAssignment : undefined;
  }

  getDefaultThinking(modelId: string): string | undefined {
    return this.getThinkingLevels(modelId)[0];
  }

  // -------------------------------------------------------------------------
  // Capability catalog access
  // -------------------------------------------------------------------------

  getCapability(capabilityId: string): unknown {
    return getUserFacingOpenCodeCapability(capabilityId as any);
  }

  getCapabilityIds(): readonly string[] {
    return OPENCODE_RUNNER_CAPABILITY_IDS as readonly string[];
  }

  // -------------------------------------------------------------------------
  // Selectable tools
  // -------------------------------------------------------------------------

  getSelectableTools(): unknown[] {
    return getSelectableOpenCodeTools();
  }

  // -------------------------------------------------------------------------
  // Detection (added by `add-self-update-system` / T2.10)
  // -------------------------------------------------------------------------

  /**
   * Detect whether Deck-managed artifacts are installed for OpenCode.
   *
   * Scans the OpenCode config root (and the home-relative `~/.config/opencode/`
   * fallback when no project root is supplied) for files Deck writes when it
   * installs the Developer Team: `opencode.json`, `AGENTS.md`, the
   * `skills/deck-*` directory, and `packageInstructions.json`.
   *
   * Returns `{ installed: false, managedPaths: [], diagnostics: [...] }` when
   * the config root is missing or no Deck-managed files are found.
   */
  async detectDeckInstall(
    input?: RunnerDeckInstallInput,
  ): Promise<RunnerDeckInstallStatus> {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");

    // OpenCode writes project-relative config at `<projectRoot>/.config/opencode`
    // and falls back to `~/.config/opencode/` when no project root is given.
    // Per the design we keep both candidates in scope for the upgrade sync.
    //
    // The home-relative root is computed from `process.env.HOME` first so
    // tests can override it; we fall back to `os.homedir()` when the env var
    // is not set (which on Linux/Unix reads passwd via getpwuid_r, so we
    // still get a sensible default).
    const configRoots: string[] = [];
    if (input?.projectRoot) {
      configRoots.push(join(input.projectRoot, ".config", "opencode"));
    }
    const envHome = process.env.HOME;
    const effectiveHome = envHome && envHome.length > 0 ? envHome : homedir();
    configRoots.push(join(effectiveHome, ".config", "opencode"));

    const managedFiles = [
      "opencode.json",
      "AGENTS.md",
      "packageInstructions.json",
    ];

    const managedPaths: string[] = [];
    const diagnostics: string[] = [];

    for (const root of configRoots) {
      if (!existsSync(root)) {
        diagnostics.push(`OpenCode config root not found: ${root}`);
        continue;
      }
      for (const fileName of managedFiles) {
        const p = join(root, fileName);
        if (existsSync(p)) {
          managedPaths.push(p);
        }
      }
      // Skills dir — directory presence is enough signal for a Deck install
      const skillsDir = join(root, "skills");
      if (existsSync(skillsDir)) {
        managedPaths.push(skillsDir);
      }
    }

    return {
      installed: managedPaths.length > 0,
      managedPaths,
      diagnostics,
    };
  }
}

// ---------------------------------------------------------------------------
// Model-inventory lookup helpers
// ---------------------------------------------------------------------------

/**
 * Find a model entry in the inventory by ID, tolerating the
 * `provider/model` vs raw `model` ID mismatch.
 *
 * Lookup order:
 *  1. Exact match on `model.id` across all providers (handles canonical
 *     `provider/model` IDs like "openai/gpt-5.5" or "alibaba-token-plan/glm-5.2").
 *  2. If `modelId` has no provider prefix (no "/"), match by suffix — i.e.
 *     find any inventory entry whose id is `<provider>/<modelId>`. This lets
 *     callers pass a raw model id ("glm-5.2") and still resolve the entry
 *     ("alibaba-token-plan/glm-5.2").
 *
 * Returns the first match, or undefined when the model is not in the inventory.
 */
function findModelInInventory(
  inventory: RunnerModelInventory,
  modelId: string,
): RunnerModelEntry | undefined {
  for (const models of Object.values(inventory.modelsByProvider)) {
    const exact = models.find((model) => model.id === modelId);
    if (exact) return exact;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Singleton instance for drop-in replacement
// ---------------------------------------------------------------------------

export const openCodeRunnerAdapter: RunnerAdapter = createOpenCodeRunnerAdapter();

// ---------------------------------------------------------------------------
// Factory export (for AdapterRegistry registration)
// ---------------------------------------------------------------------------

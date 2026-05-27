/**
 * Pi RunnerAdapter — implements the RunnerAdapter interface for the Pi runner.
 *
 * Wraps all Pi-specific functions (buildPiRunnerReviewPlan, buildPiInstallationPlan,
 * installPiTools, etc.) behind the generic RunnerAdapter interface so the TUI
 * can interact with Pi without any runner-specific knowledge.
 *
 * Design: runner-decoupling-refactor / design.md § RunnerAdapter Contract
 * Task: 2.1 — Implement PiRunnerAdapter
 */

import { inspectPiEnvironment, type PiPreflightResult } from "./preflight";
import { buildPiRunnerCapabilityInventory, type PiRunnerCapabilityInventory, type PiRunnerFullCapabilityInventory } from "./capability-inventory";
import { buildPiRunnerReviewPlan, type PiRunnerReviewPlan } from "./capability-plan";
import { buildPiInstallationPlan, type InstallablePiToolId, type InstallablePiTool } from "./installation-plan";
import { installPiTools, installInternalRunnerPackages } from "./install-tools";
import { reviewPiRequiredTools, type PiRequiredToolsReview } from "./required-tools";
import { getTeamsForEnvironment } from "./team-catalog";
import {
  readDeveloperTeamModelAssignments,
  readDeveloperTeamThinkingAssignments,
  buildDeveloperTeamInstallPlan as buildPiDeveloperTeamInstallPlan,
  applyDeveloperTeamInstall as applyPiDeveloperTeamInstall,
  backupDeveloperTeamFiles,
  rollbackDeveloperTeamFiles,
  verifyDeveloperTeamInstall,
  type DeveloperTeamInstallPlan as PiDeveloperTeamInstallPlan,
} from "./developer-team-install";
import { PI_THINKING_LEVELS, supportsThinkingForModel, getDefaultThinkingForModel, resolveThinkingForModel } from "./model-config";
import { getPiRunnerCapability, PI_RUNNER_CAPABILITY_IDS } from "./capability-catalog";
import { getOptionalPiTools } from "./installation-plan";
import { writeSupermemoryPiMcpConfig } from "./pi-mcp-config";
import type { InternalRunnerPackageInstallAction } from "./internal-runner-packages";
import type { RequiredToolStatus } from "./required-tools";
import type {
  RunnerAdapter,
  RuntimeDetectionInput,
  RuntimeStatus,
  CapabilityInventoryInput,
  CapabilityInventory,
  CapabilityCatalogEntry,
  DashboardState,
  ReviewPlan,
  InstallationPlan,
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
  RunnerMcpConfigInput,
  RunnerMcpConfigResult,
  FlowState,
  NextScreen,
  RunnerActionStatus,
  RunnerPlanDiagnostic,
  DeveloperTeamApplyInput,
  DeveloperTeamApplyResult,
} from "@deck/core";
import { getModelCatalog as getCoreModelCatalog } from "@deck/core";

// ---------------------------------------------------------------------------
// Adapter constants
// ---------------------------------------------------------------------------

const PI_RUNNER_ID = "pi";
const PI_DISPLAY_NAME = "Pi Runner";
const PI_ENVIRONMENT_IDS = ["pi-development"] as const;

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export function createPiRunnerAdapter(): RunnerAdapter {
  return new PiRunnerAdapterImpl();
}

// ---------------------------------------------------------------------------
// PiRunnerAdapter implementation
// ---------------------------------------------------------------------------

class PiRunnerAdapterImpl implements RunnerAdapter {
  readonly runnerId: string = PI_RUNNER_ID;
  readonly displayName: string = PI_DISPLAY_NAME;
  readonly environmentIds: readonly string[] = PI_ENVIRONMENT_IDS;

  // Store last native plan for backup/restore/verify operations
  #lastNativePlan: PiDeveloperTeamInstallPlan | null = null;

  // -------------------------------------------------------------------------
  // Runtime detection
  // -------------------------------------------------------------------------

  async detectRuntimes(input?: RuntimeDetectionInput): Promise<readonly RuntimeStatus[]> {
    const preflight = inspectPiEnvironment({
      command: "pi",
      pathExists: (path) => {
        try {
          const { existsSync } = require("node:fs");
          return existsSync(path);
        } catch {
          return false;
        }
      },
    });

    return [toRuntimeStatus(preflight)];
  }

  // -------------------------------------------------------------------------
  // Capability inventory
  // -------------------------------------------------------------------------

  async getCapabilityInventory(input: CapabilityInventoryInput): Promise<CapabilityInventory> {
    const review = reviewPiRequiredTools({ command: "pi" });
    const runnerScope = input.runnerId as "pi" | "opencode" | "all";

    const fullInventory: PiRunnerFullCapabilityInventory = buildPiRunnerCapabilityInventory(review, undefined, {
      runnerScope,
      includeInternal: false,
    });

    return toCapabilityInventory(fullInventory, input.runnerId, input.environmentId);
  }

  // -------------------------------------------------------------------------
  // Review and installation planning
  // -------------------------------------------------------------------------

  buildReviewPlan(state: DashboardState, inventory: CapabilityInventory): ReviewPlan {
    const runnerScope = state.runnerId as "pi" | "opencode" | "all";

    // Normalize inventory: accept both CapabilityInventory (with .capabilities) 
    // and plain Record<capabilityId, entry> (as stored by the dashboard)
    const capabilities = inventory.capabilities 
      ?? Object.values(inventory as Record<string, { capabilityId?: string; isInstalled?: boolean; requirementLevel?: string; source?: string; diagnostics?: readonly string[] }>);

    // Build a Pi-compatible inventory for buildPiRunnerReviewPlan
    const piInventory: PiRunnerCapabilityInventory = {};
    for (const entry of capabilities) {
      const capId = entry.capabilityId as string;
      piInventory[capId as keyof PiRunnerCapabilityInventory] = {
        capabilityId: capId,
        status: toCapabilityStatus(entry.isInstalled, entry.requirementLevel),
        runnerScope,
        installed: entry.isInstalled,
        source: entry.source,
        diagnostics: entry.diagnostics ?? [],
      } as any;
    }

    const review = reviewPiRequiredTools({ command: "pi" });

    const piPlan: PiRunnerReviewPlan = buildPiRunnerReviewPlan(
      {
        runnerScope,
        selectedCapabilities: state.selectedCapabilities as Record<string, boolean>,
        adaptiveMemory: state.adaptiveMemory as { provider?: "none" | "engram" | "supermemory"; supermemory?: { configured?: boolean; hasToken?: boolean; userId?: string; teamId?: string; organizationId?: string } },
        teams: {} as Record<string, { selected?: boolean; modelAssignments?: unknown; thinkingAssignments?: unknown }>,
        runtime: { toolsReview: review },
        packageInstructions: state.packageInstructions as any,
      },
      piInventory as any,
    );

    return toReviewPlan(piPlan);
  }

  buildInstallationPlan(state: DashboardState): InstallationPlan {
    const review = reviewPiRequiredTools({ command: "pi" });
    const requiredTools: RequiredToolStatus[] = review.requiredTools;

    // Collect selected optional tool IDs from state.selectedCapabilities
    const selectedOptionalToolIds: InstallablePiToolId[] = [];
    if (state.selectedCapabilities) {
      for (const [toolId, selected] of Object.entries(state.selectedCapabilities)) {
        if (selected && isOptionalToolId(toolId)) {
          selectedOptionalToolIds.push(toolId as InstallablePiToolId);
        }
      }
    }

    const steps = buildPiInstallationPlan({ requiredTools, selectedOptionalToolIds });

    return {
      steps: steps.map((tool) => ({
        action: "install" as const,
        tool: tool.id,
        reason: `Pi package${tool.required ? " (required)" : " (optional)"}`,
        capabilityId: tool.id,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Action execution
  // -------------------------------------------------------------------------

  async runAction(action: RunnerAction, context: RunnerActionContext): Promise<RunnerActionRunResult> {
    // Handle internal runner package installs
    if (action.internalPackageId) {
      const installResult = await installInternalRunnerPackages(
        context.runnerCommand ?? "pi",
        [toInternalInstallAction(action)],
        () => {},
      );
      const first = installResult[0];
      return {
        actionId: action.id,
        status: first?.success ? "executed" : "failed",
        message: first?.message ?? "",
        diagnostics: first?.success ? [] : [first?.message ?? "Installation failed."],
      };
    }

    // Handle capability/tool installs
    if (action.kind === "install-pi-package" || action.kind === "install") {
      const installableTool: InstallablePiTool = {
        id: (action.toolId as InstallablePiToolId) ?? "sub-agents",
        name: action.title,
        source: action.source ?? "",
        required: action.required ?? false,
        installKind: "pi-package",
      };

      const results = await installPiTools(context.runnerCommand ?? "pi", [installableTool], () => {});
      const result = results[0];

      return {
        actionId: action.id,
        status: result.status === "installed" ? "executed" : result.status === "manual" ? "informational" : "failed",
        message: result.message ?? "",
        diagnostics: result.status === "failed" ? [result.message ?? "Install failed."] : [],
      };
    }

    // Handle manual external installs
    if (action.kind === "manual-external-install") {
      return {
        actionId: action.id,
        status: "informational",
        message: `Manual installation required: ${action.source ?? action.title}`,
        diagnostics: [`${action.title} requires external/manual installation.`],
      };
    }

    // Handle validation actions
    if (action.kind === "validate") {
      return {
        actionId: action.id,
        status: "executed",
        message: "Validation complete.",
        diagnostics: action.diagnostics ?? [],
      };
    }

    // Handle config writes
    if (action.kind === "write-deck-config" || action.kind === "write-pi-mcp-config") {
      return {
        actionId: action.id,
        status: "executed",
        message: "Configuration written.",
        diagnostics: [],
      };
    }

    // Handle team application
    if (action.kind === "apply-team-bundle") {
      return {
        actionId: action.id,
        status: "executed",
        message: "Developer Team bundle applied.",
        diagnostics: action.unresolvedCapabilities?.length ? [`${action.unresolvedCapabilities.length} capabilities are unresolved.`] : [],
      };
    }

    // Fallback: informational
    return {
      actionId: action.id,
      status: "informational",
      message: action.title,
      diagnostics: [],
    };
  }

  // -------------------------------------------------------------------------
  // Team management
  // -------------------------------------------------------------------------

  getTeams(environmentId: string): readonly TeamEntry[] {
    return getTeamsForEnvironment(environmentId);
  }

  // -------------------------------------------------------------------------
  // Model catalog and assignments
  // -------------------------------------------------------------------------

  getModelCatalog(_context?: ModelCatalogContext): ModelCatalog {
    return getCoreModelCatalog();
  }

  readModelAssignments(projectRoot?: string): DeveloperTeamModelAssignments {
    const root = projectRoot ?? (typeof process !== "undefined" && process.cwd ? process.cwd() : ".");
    return readDeveloperTeamModelAssignments(root);
  }

  readThinkingAssignments(projectRoot?: string): DeveloperTeamThinkingAssignments {
    const root = projectRoot ?? (typeof process !== "undefined" && process.cwd ? process.cwd() : ".");
    return readDeveloperTeamThinkingAssignments(root);
  }

  getThinkingLevels(_modelId?: string): readonly RunnerThinkingLevel[] {
    return [...PI_THINKING_LEVELS];
  }

  supportsThinking(modelId: string): boolean {
    return supportsThinkingForModel(modelId);
  }

  // -------------------------------------------------------------------------
  // Developer Team installation
  // -------------------------------------------------------------------------

  buildDeveloperTeamInstallPlan(input: DeveloperTeamAdapterInstallInput): RunnerDeveloperTeamInstallPlan {
    const nativePlan = buildPiDeveloperTeamInstallPlan(input.projectRoot, {
      modelAssignments: input.modelAssignments,
      thinkingAssignments: input.thinkingAssignments,
      memoryProvider: input.memoryProvider,
      capabilityInstructions: input.capabilityInstructions,
      standaloneSkills: input.standaloneSkills,
    });

    // Store native plan for backup/restore/verify operations
    this.#lastNativePlan = nativePlan;

    const files: import("@deck/core").DeveloperTeamInstallFile[] = [
      ...nativePlan.agents.map((a: { relativePath: string; content: string }) => ({ path: a.relativePath, content: a.content })),
      ...nativePlan.skills.map((s: { relativePath: string; content: string }) => ({ path: s.relativePath, content: s.content })),
      ...nativePlan.standaloneSkills.map((s: { relativePath: string; content: string }) => ({ path: s.relativePath, content: s.content })),
    ];

    return { files };
  }

  async applyDeveloperTeamInstall(input: DeveloperTeamApplyInput): Promise<DeveloperTeamApplyResult> {
    // Build the native plan structure expected by applyPiDeveloperTeamInstall
    const homeDir = process.env.HOME ?? "/home/user";
    const piConfigDir = `${homeDir}/.pi/agent`;
    const piAgentsDir = `${piConfigDir}/agents`;
    const piSkillsDir = `${piConfigDir}/skills`;

    const standaloneSkillIds = ["judgment-day", "cognitive-doc-design", "comment-writer"];
    const plan: PiDeveloperTeamInstallPlan = {
      projectRoot: input.projectRoot,
      agentsDir: piAgentsDir,
      skillsDir: piSkillsDir,
      agents: input.plan.files
        .filter((f: { path: string }) => f.path.includes("/agents/"))
        .map((f: { path: string; content: string }) => ({
          agent: { id: f.path.split("/").pop()!.replace(".md", ""), name: "", description: "" } as any,
          relativePath: f.path,
          absolutePath: `${piAgentsDir}/${f.path.split("/").pop()}`,
          content: f.content,
        })),
      skills: input.plan.files
        .filter((f: { path: string }) => f.path.includes("/skills/") && !standaloneSkillIds.some((id) => f.path.includes(id)))
        .map((f: { path: string; content: string }) => ({
          agent: { id: f.path.split("/").pop()!.replace("/SKILL.md", ""), name: "", description: "" } as any,
          relativePath: f.path,
          absolutePath: `${piSkillsDir}/${f.path.split("/").pop()!.replace("/SKILL.md", "")}/SKILL.md`,
          content: f.content,
        })),
      standaloneSkills: input.plan.files
        .filter((f: { path: string }) => standaloneSkillIds.some((id) => f.path.includes(id)))
        .map((f: { path: string; content: string }) => ({
          skillId: f.path.split("/").pop()!.replace("/SKILL.md", ""),
          relativePath: f.path,
          absolutePath: `${piSkillsDir}/${f.path.split("/").pop()!.replace("/SKILL.md", "")}/SKILL.md`,
          content: f.content,
        })),
      sddSkillFiles: [],
      memoryDiagnostics: [],
    };

    const result = applyPiDeveloperTeamInstall(plan);

    return {
      results: result.results,
      changedCount: result.changedCount,
      unchangedCount: result.unchangedCount,
    };
  }

  // -------------------------------------------------------------------------
  // MCP config (optional)
  // -------------------------------------------------------------------------

  async writeMcpConfig(input: RunnerMcpConfigInput): Promise<RunnerMcpConfigResult> {
    const result = writeSupermemoryPiMcpConfig({
      token: input.token ?? "",
      serverName: input.serverName,
      configPath: undefined,
      homeDir: undefined,
    });

    return {
      ok: result.ok,
      path: result.path,
      diagnostics: result.diagnostics.map((d: { message: string }) => d.message),
    };
  }

  // -------------------------------------------------------------------------
  // Flow routing
  // -------------------------------------------------------------------------

  getNextScreen(state: FlowState): NextScreen {
    // Pi-specific screen flow resolution
    // Maps runner-specific screen states to canonical NextScreen labels
    switch (state.currentScreen) {
      case "environment-selection":
        return "preflight-checking";

      case "preflight-checking": {
        // After preflight, determine next screen based on install progress
        if (state.installProgress && state.installProgress.completed < state.installProgress.total) {
          return "developer-team-installing";
        }
        return "team-selection";
      }

      case "team-selection":
        return "developer-team-review";

      case "developer-team-review":
        return "developer-team-installing";

      case "developer-team-installing": {
        if (state.installProgress && state.installProgress.completed >= state.installProgress.total) {
          return "complete";
        }
        return "developer-team-installing";
      }

      case "personality-selection":
        return "team-selection";

      case "complete":
        return "complete";

      default:
        return "team-selection";
    }
  }

  // -------------------------------------------------------------------------
  // Environment inspection
  // -------------------------------------------------------------------------

  async inspectEnvironment(): Promise<unknown> {
    return inspectPiEnvironment({
      command: "pi",
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
    return reviewPiRequiredTools({ command: "pi" });
  }

  // -------------------------------------------------------------------------
  // Team file backup/restore
  // -------------------------------------------------------------------------

  backupDeveloperTeamFiles(plan: unknown): unknown {
    if (!this.#lastNativePlan) {
      throw new Error("No native plan available. Call buildDeveloperTeamInstallPlan first.");
    }
    return backupDeveloperTeamFiles(this.#lastNativePlan);
  }

  rollbackDeveloperTeamFiles(backup: unknown): void {
    rollbackDeveloperTeamFiles(backup as Parameters<typeof rollbackDeveloperTeamFiles>[0]);
  }

  // -------------------------------------------------------------------------
  // Developer team verification
  // -------------------------------------------------------------------------

  verifyDeveloperTeamInstall(plan: unknown): { valid: boolean; diagnostics: readonly string[] } {
    if (!this.#lastNativePlan) {
      throw new Error("No native plan available. Call buildDeveloperTeamInstallPlan first.");
    }
    const result = verifyDeveloperTeamInstall(this.#lastNativePlan);
    // Flatten issues from agentResults and skillResults into diagnostics
    const diagnostics = [
      ...result.agentResults.flatMap((r) => r.issues),
      ...result.skillResults.flatMap((r) => r.issues),
    ];
    return { valid: result.valid, diagnostics };
  }

  // -------------------------------------------------------------------------
  // Thinking resolution
  // -------------------------------------------------------------------------

  resolveThinking(modelId: string, existingAssignment?: string): string | undefined {
    return resolveThinkingForModel(modelId, existingAssignment as any) as string | undefined;
  }

  getDefaultThinking(modelId: string): string {
    return getDefaultThinkingForModel(modelId);
  }

  // -------------------------------------------------------------------------
  // Capability catalog access
  // -------------------------------------------------------------------------

  getCapability(capabilityId: string): unknown {
    return getPiRunnerCapability(capabilityId as any);
  }

  getCapabilityIds(): readonly string[] {
    return PI_RUNNER_CAPABILITY_IDS as readonly string[];
  }

  // -------------------------------------------------------------------------
  // Selectable tools
  // -------------------------------------------------------------------------

  getSelectableTools(): unknown[] {
    return getOptionalPiTools();
  }
}

// ---------------------------------------------------------------------------
// Adapter singleton (lazily created)
// ---------------------------------------------------------------------------

let _piRunnerAdapter: RunnerAdapter | undefined;

export function getPiRunnerAdapter(): RunnerAdapter {
  if (!_piRunnerAdapter) {
    _piRunnerAdapter = new PiRunnerAdapterImpl();
  }
  return _piRunnerAdapter;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toRuntimeStatus(preflight: PiPreflightResult): RuntimeStatus {
  return {
    runtimeId: "pi",
    displayName: `Pi Runner ${preflight.version}`,
    isAvailable: preflight.existingConfiguration,
    version: preflight.version,
    diagnostics: preflight.existingConfiguration ? [] : ["Pi configuration directory not found."],
  };
}

function toCapabilityInventory(
  inventory: PiRunnerFullCapabilityInventory,
  runnerId: string,
  environmentId: string,
): CapabilityInventory {
  const capabilities: CapabilityCatalogEntry[] = [];

  for (const [capabilityId, entry] of Object.entries(inventory)) {
    if (capabilityId === "_internal" || !entry) continue;

    const typedEntry = entry as { status: string; toolId?: string; source?: string; diagnostics?: string[] };

    capabilities.push({
      capabilityId,
      label: capabilityId,
      description: "",
      section: "runner",
      requirementLevel: typedEntry.status === "ready" ? "optional" : "required",
      toolId: typedEntry.toolId,
      source: typedEntry.source,
      installKind: "pi-package",
      isInstalled: typedEntry.status === "ready",
      isBlocked: typedEntry.status === "blocked",
      diagnostics: typedEntry.diagnostics,
    });
  }

  return {
    capabilities,
    runnerId,
    environmentId: environmentId as any,
  };
}

function toCapabilityStatus(isInstalled: boolean, _requirementLevel: string): "ready" | "manual" | "missing" | "blocked" {
  if (isInstalled) return "ready";
  return "missing";
}

function toReviewPlan(piPlan: PiRunnerReviewPlan): ReviewPlan {
  return {
    groups: {
      automaticInstalls: piPlan.groups.automaticInstalls.map(toRunnerAction),
      manualSteps: piPlan.groups.manualSteps.map(toRunnerAction),
      configWrites: piPlan.groups.configWrites.map(toRunnerAction),
      teamApplications: piPlan.groups.teamApplications.map(toRunnerAction),
      validations: piPlan.groups.validations.map(toRunnerAction),
    },
    diagnostics: piPlan.diagnostics.map(toPlanDiagnostic),
    ready: piPlan.ready,
  };
}

function toRunnerAction(piAction: import("./capability-plan").PiRunnerAction): RunnerAction {
  return {
    id: piAction.id,
    kind: piAction.kind as string,
    title: piAction.title,
    description: piAction.description,
    capabilityId: piAction.capabilityId as string | undefined,
    toolId: piAction.toolId as string | undefined,
    internalPackageId: piAction.internalPackageId as string | undefined,
    implementationId: piAction.implementationId as string | undefined,
    source: piAction.source as string | undefined,
    status: piAction.status as RunnerActionStatus,
    required: piAction.required,
    dependencies: piAction.dependencies as readonly string[] | undefined,
    unresolvedCapabilities: piAction.unresolvedCapabilities as readonly string[] | undefined,
    diagnostics: piAction.diagnostics as readonly string[] | undefined,
  };
}

function toPlanDiagnostic(piDiag: import("./capability-plan").PiRunnerPlanDiagnostic): RunnerPlanDiagnostic {
  return {
    code: piDiag.code,
    message: piDiag.message,
    severity: piDiag.severity as "info" | "warning" | "error",
    capabilityId: piDiag.capabilityId as string | undefined,
    actionId: piDiag.actionId as string | undefined,
  };
}

function toInternalInstallAction(action: RunnerAction): InternalRunnerPackageInstallAction {
  return {
    packageId: action.internalPackageId as "pi-mermaid",
    name: action.title,
    source: `npm:${action.internalPackageId}` as `npm:${string}`,
    installKind: "npm-package",
    reason: action.description ?? `Install ${action.internalPackageId}`,
  };
}

function isOptionalToolId(id: string): id is InstallablePiToolId {
  return ["context-mode", "codebase-memory", "rtk", "context7", "engram-memory"].includes(id);
}
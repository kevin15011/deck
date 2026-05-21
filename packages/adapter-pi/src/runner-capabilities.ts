/**
 * Pi RunnerCapabilities factory.
 *
 * Composes Pi's preflight, install, model, memory, team, and manifest functions
 * into the core RunnerCapabilities interface.
 */

import { inspectPiEnvironment } from "./preflight";
import type { PiToolInstallResult } from "./install-tools";
import type { InstallablePiTool, InstallablePiToolId } from "./installation-plan";
import type { RequiredToolStatus } from "./required-tools";
import type { PiThinkingLevel } from "./model-config";
import type { DeveloperTeamInstallPlan, DeveloperTeamApplyResult, DeveloperTeamVerifyResult, BackupManifest } from "./developer-team-install";
import { buildDeveloperTeamInstallPlan, applyDeveloperTeamInstall, verifyDeveloperTeamInstall, backupDeveloperTeamFiles, rollbackDeveloperTeamFiles } from "./developer-team-install";
import { readDeveloperTeamModelAssignments, readDeveloperTeamThinkingAssignments } from "./developer-team-install";
import { getTeamsForEnvironment, PI_DEVELOPMENT_TEAMS } from "./team-catalog";
import type { DeveloperTeamModelAssignments, DeveloperTeamThinkingAssignments } from "./model-config";
import type {
  RunnerCapabilities,
  RunnerEnvironment,
  RunnerEnvironmentInspectInput,
  RunnerEnvironmentInspection,
  RunnerInstallationInput,
  RunnerToolInstallInput,
  RunnerToolInstallResult,
  RunnerToolReviewInput,
  RunnerToolReviewResult,
  RunnerDeveloperTeamInstallPlan,
  RunnerDeveloperTeamApplyResult,
  RunnerDeveloperTeamVerifyResult,
  DeveloperTeamManifest,
  AdaptiveMemoryProvider,
} from "@deck/core";
import type { TeamEntry } from "@deck/core";
import { getModelCatalog } from "@deck/core";

// ---------------------------------------------------------------------------
// Environment catalog
// ---------------------------------------------------------------------------

const PI_ENVIRONMENTS: readonly RunnerEnvironment[] = [
  { id: "pi-development", displayName: "Pi Development" },
];

// ---------------------------------------------------------------------------
// Environment inspection
// ---------------------------------------------------------------------------

async function inspectEnvironment(input: RunnerEnvironmentInspectInput): Promise<RunnerEnvironmentInspection> {
  try {
    const result = inspectPiEnvironment({
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

    return {
      environmentId: input.environmentId,
      isConfigured: result.existingConfiguration,
      diagnostics: result.existingConfiguration ? [] : ["Pi configuration directory not found."],
    };
  } catch (error) {
    return {
      environmentId: input.environmentId,
      isConfigured: false,
      diagnostics: [error instanceof Error ? error.message : "Unknown error during inspection."],
    };
  }
}

// ---------------------------------------------------------------------------
// Tool capabilities
// ---------------------------------------------------------------------------

function buildInstallationPlan(input: RunnerInstallationInput) {
  const { buildCapabilityInstallationPlan } = require("./capability-plan");
  const requiredTools = getRequiredToolStatuses();
  const selectedOptionalToolIds: Array<"sub-agents" | "mcp-packages" | "context-mode" | "codebase-memory" | "rtk" | "context7" | "engram-memory"> = ["sub-agents", "mcp-packages"];

  return buildCapabilityInstallationPlan({ requiredTools, selectedOptionalToolIds });
}

function getRequiredToolStatuses(): RequiredToolStatus[] {
  const { reviewPiRequiredTools } = require("./required-tools");
  const result = reviewPiRequiredTools({ command: "pi" });
  return result.requiredTools;
}

async function installTools(input: RunnerToolInstallInput): Promise<RunnerToolInstallResult> {
  const plan = buildInstallationPlan({ projectRoot: input.projectRoot, environmentId: input.environmentId });

  const { installPiTools } = require("./install-tools");
  const installableTools: InstallablePiTool[] = plan.steps
    .filter((step: { action: string }) => step.action === "install")
    .map((step: { tool: string }) => ({
      id: step.tool as "sub-agents" | "mcp-packages" | "context-mode" | "codebase-memory" | "rtk" | "context7" | "engram-memory",
      name: step.tool,
      source: step.tool,
      required: true,
      installKind: "pi-package" as const,
    }));

  const results: PiToolInstallResult[] = await installPiTools("pi", installableTools, () => {});
  const firstResult = results[0];

  return {
    installed: firstResult?.status === "installed",
    tool: firstResult?.tool,
  };
}

async function reviewTools(input: RunnerToolReviewInput): Promise<RunnerToolReviewResult> {
  const { reviewPiRequiredTools } = require("./required-tools");
  const result = reviewPiRequiredTools({ command: "pi" });

  return {
    tools: result.installedPackages,
    missing: result.requiredTools.filter((t: { name: string; installed: boolean }) => !t.installed).map((t: { name: string }) => t.name),
  };
}

function getOptionalTools(): readonly import("@deck/core").RunnerToolOptionalTool[] {
  const { PI_INSTALLABLE_TOOLS } = require("./installation-plan");
  return PI_INSTALLABLE_TOOLS.filter((tool: { required: boolean }) => !tool.required).map((tool: InstallablePiTool) => ({
    id: tool.id,
    name: tool.name,
    source: tool.source,
    installKind: tool.installKind,
  }));
}

// ---------------------------------------------------------------------------
// Capability catalog
// ---------------------------------------------------------------------------

function getPiCapability(capabilityId: string): import("@deck/core").RunnerCapabilityCatalogEntry | undefined {
  const { getPiRunnerCapability } = require("./capability-catalog");
  const entry = getPiRunnerCapability(capabilityId as any);
  if (!entry) return undefined;
  return {
    capabilityId: entry.capabilityId,
    label: entry.label,
    description: entry.description,
    section: entry.section,
    runnerScope: entry.runnerScope,
    requirementLevel: entry.requirementLevel,
    toolId: entry.toolId,
    source: entry.source,
    installKind: entry.installKind,
    isInternal: entry.isInternal,
  };
}

function getPiUserFacingIds(): readonly string[] {
  const { PI_RUNNER_CAPABILITY_IDS } = require("./capability-catalog");
  return PI_RUNNER_CAPABILITY_IDS as readonly string[];
}

// ---------------------------------------------------------------------------
// Team capabilities
// ---------------------------------------------------------------------------

function getTeamsForRunnerEnvironment(environmentId: string): readonly TeamEntry[] {
  return getTeamsForEnvironment(environmentId);
}

function buildDeveloperTeamManifest(input: import("@deck/core").DeveloperTeamManifestInput): DeveloperTeamManifest {
  const modelAssignments: DeveloperTeamModelAssignments = {};
  const thinkingAssignments: DeveloperTeamThinkingAssignments = {};

  if (input.modelAssignments) {
    for (const assignment of input.modelAssignments) {
      modelAssignments[assignment.agentId] = assignment.modelId;
      if (assignment.reasoning) {
        thinkingAssignments[assignment.agentId] = assignment.reasoning as PiThinkingLevel;
      }
    }
  }

  // Build capability instruction bundle from config if not already provided
  const capabilityInstructions = input.capabilityInstructions;
  const resolvedCapabilityInstructions = capabilityInstructions ?? (() => {
    try {
      const { readDeckConfig } = require("@deck/core/config/deck-config");
      const { getEnabledPackageInstructionIds, buildCapabilityInstructionBundle } = require("@deck/core/teams/developer/instruction-bundles/index");
      const config = readDeckConfig(input.projectRoot);
      const enabledIds = getEnabledPackageInstructionIds(config, "pi");
      return enabledIds.length > 0 ? buildCapabilityInstructionBundle(enabledIds) : undefined;
    } catch {
      return undefined;
    }
  })();

  const plan = buildDeveloperTeamInstallPlan(input.projectRoot, {
    modelAssignments,
    thinkingAssignments,
    supportedMemoryProviderIds: ["engram", "supermemory"],
    capabilityInstructions: resolvedCapabilityInstructions,
  });

  const agents = plan.agents.map((a) => ({
    agentId: a.agent.id,
    displayName: a.agent.name,
    instruction: a.content,
    model: modelAssignments[a.agent.id],
    reasoning: thinkingAssignments[a.agent.id],
    memoryBundle: undefined,
  }));

  const skills = plan.skills.map((s) => ({
    agentId: s.agent.id,
    skillId: s.agent.skillId,
    body: s.content,
    memoryBundle: undefined,
  }));

  return {
    team: PI_DEVELOPMENT_TEAMS[0],
    agents,
    skills,
    memoryDiagnostics: plan.memoryDiagnostics,
  };
}

function buildTeamInstallPlan(input: import("@deck/core").DeveloperTeamInstallPlanInput): RunnerDeveloperTeamInstallPlan {
  const modelAssignments: DeveloperTeamModelAssignments = {};
  const thinkingAssignments: DeveloperTeamThinkingAssignments = {};

  for (const agent of input.manifest.agents) {
    modelAssignments[agent.agentId] = agent.model ?? "";
    if (agent.reasoning) {
      thinkingAssignments[agent.agentId] = agent.reasoning as PiThinkingLevel;
    }
  }

  const plan = buildDeveloperTeamInstallPlan(input.projectRoot, {
    modelAssignments,
    thinkingAssignments,
  });

  const files: import("@deck/core").DeveloperTeamInstallFile[] = [
    ...plan.agents.map((a) => ({ path: a.relativePath, content: a.content })),
    ...plan.skills.map((s) => ({ path: s.relativePath, content: s.content })),
  ];

  return { files };
}

async function applyTeamInstall(input: import("@deck/core").DeveloperTeamApplyInput): Promise<RunnerDeveloperTeamApplyResult> {
  const plan: DeveloperTeamInstallPlan = {
    projectRoot: input.projectRoot,
    agentsDir: `${input.projectRoot}/.pi/agents`,
    skillsDir: `${input.projectRoot}/.pi/skills`,
    agents: input.plan.files
      .filter((f: { path: string }) => f.path.includes("/agents/"))
      .map((f: { path: string; content: string }) => ({
        agent: { id: f.path.split("/").pop()!.replace(".md", ""), name: "", description: "" } as any,
        relativePath: f.path,
        absolutePath: `${input.projectRoot}/${f.path}`,
        content: f.content,
      })),
    skills: input.plan.files
      .filter((f: { path: string }) => f.path.includes("/skills/"))
      .map((f: { path: string; content: string }) => ({
        agent: { id: f.path.split("/").pop()!.replace("/SKILL.md", ""), name: "", description: "" } as any,
        relativePath: f.path,
        absolutePath: `${input.projectRoot}/${f.path}`,
        content: f.content,
      })),
    memoryDiagnostics: [],
  };

  const result: DeveloperTeamApplyResult = applyDeveloperTeamInstall(plan);

  return {
    success: true,
    appliedFiles: result.results.map((r) => r.agentId),
  };
}

async function verifyTeamInstall(input: import("@deck/core").DeveloperTeamVerifyInput): Promise<RunnerDeveloperTeamVerifyResult> {
  const plan = buildDeveloperTeamInstallPlan(input.projectRoot);
  const result: DeveloperTeamVerifyResult = verifyDeveloperTeamInstall(plan);

  return {
    isInstalled: result.valid,
    missingFiles: result.agentResults.filter((r) => !r.valid).map((r) => r.agentId),
  };
}

// ---------------------------------------------------------------------------
// Model capabilities
// ---------------------------------------------------------------------------

function getCatalog(_input?: import("@deck/core").RunnerModelCatalogInput): import("@deck/core").ModelCatalog {
  return getModelCatalog();
}

function readAssignments(input: import("@deck/core").RunnerModelAssignmentReadInput): import("@deck/core").RunnerModelAssignments {
  const assignments = readDeveloperTeamModelAssignments(input.projectRoot);
  const thinking = readDeveloperTeamThinkingAssignments(input.projectRoot);

  const result = getModelCatalog().developerTeamDefaults.map((default_assignment) => ({
    agentId: default_assignment.agentId,
    modelId: assignments[default_assignment.agentId] ?? default_assignment.modelId,
    reasoning: thinking[default_assignment.agentId] ?? default_assignment.reasoning,
  }));

  return { assignments: result };
}

function resolveAssignment(input: import("@deck/core").RunnerModelResolveInput): import("@deck/core").RunnerResolvedModelAssignment {
  const defaults = getModelCatalog().developerTeamDefaults;
  const defaultAssignment = defaults.find((a) => a.agentId === input.agentId);

  return {
    agentId: input.agentId,
    modelId: input.modelId ?? defaultAssignment?.modelId ?? "",
    reasoning: input.reasoning ?? defaultAssignment?.reasoning,
  };
}

// ---------------------------------------------------------------------------
// Memory capabilities
// ---------------------------------------------------------------------------

function getProviders(_input: import("@deck/core").RunnerMemoryProviderInput): readonly AdaptiveMemoryProvider[] {
  // Providers are registered at composition time (Task 17).
  // Return empty array here; the CLI registry injects actual providers.
  return [];
}

function getSupportedProviderIds(): readonly string[] {
  return ["engram", "supermemory"];
}

// ---------------------------------------------------------------------------
// Install capabilities
// ---------------------------------------------------------------------------

function buildInstallPlan(input: import("@deck/core").RunnerInstallPlanInput): import("@deck/core").RunnerInstallPlan {
  const { buildCapabilityInstallationPlan } = require("./capability-plan");
  const requiredToolStatuses = getRequiredToolStatuses();
  const requiredTools = requiredToolStatuses.map((t) => t.name);
  const selectedOptionalToolIds = input.selectedOptionalToolIds ?? [];

  const plan = buildCapabilityInstallationPlan({ requiredTools, selectedOptionalToolIds });

  return {
    steps: plan.map((step: { action: string; tool: string; reason?: string }) => ({
      action: step.action as "install" | "configure" | "skip",
      tool: step.tool,
      reason: step.reason,
    })),
  };
}

function applyInstallPlan(options: import("@deck/core").RunnerInstallApplyOptions): Promise<readonly import("@deck/core").RunnerInstallResult[]> {
  const { installPiTools } = require("./install-tools");
  const { buildPiInstallationPlan } = require("./install-plan");

  const installableTools: InstallablePiTool[] = options.tools.map((tool: import("@deck/core").InstallableTool) => ({
    id: tool.id as InstallablePiToolId,
    name: tool.name,
    source: tool.source,
    required: true,
    installKind: tool.installKind as "pi-package" | "external",
  }));

  return installPiTools(options.command, installableTools, options.onResult ?? (() => {}));
}

function reviewInstallTools(input: import("@deck/core").RunnerToolsReviewInput): Promise<import("@deck/core").RunnerToolsReviewResult> {
  const { reviewPiRequiredTools } = require("./required-tools");
  const result = reviewPiRequiredTools({ command: input.command });

  return Promise.resolve({
    tools: result.requiredTools.map((t: { name: string }) => t.name),
    missing: result.requiredTools.filter((t: { name: string; installed: boolean }) => !t.installed).map((t: { name: string }) => t.name),
    installedPackages: result.installedPackages,
  });
}

// ---------------------------------------------------------------------------
// Developer Team capabilities
// ---------------------------------------------------------------------------

function buildTeamInstallPlanFromInput(input: import("@deck/core").DeveloperTeamInstallInput): import("@deck/core").RunnerDeveloperTeamInstallPlan {
  const modelAssignments: DeveloperTeamModelAssignments = {};
  const thinkingAssignments: DeveloperTeamThinkingAssignments = {};

  if (input.modelAssignments) {
    for (const assignment of input.modelAssignments) {
      modelAssignments[assignment.agentId] = assignment.modelId;
      if (assignment.reasoning) {
        thinkingAssignments[assignment.agentId] = assignment.reasoning as PiThinkingLevel;
      }
    }
  }

  const plan = buildDeveloperTeamInstallPlan(input.projectRoot, {
    modelAssignments,
    thinkingAssignments,
    preserveMissingThinkingAssignments: true,
    capabilityInstructions: input.capabilityInstructions,
  });

  const files: import("@deck/core").DeveloperTeamInstallFile[] = [
    ...plan.agents.map((a) => ({ path: a.relativePath, content: a.content })),
    ...plan.skills.map((s) => ({ path: s.relativePath, content: s.content })),
  ];

  return { files };
}

function applyTeamInstallFromPlan(input: import("@deck/core").DeveloperTeamApplyInput): Promise<import("@deck/core").DeveloperTeamApplyResult> {
  const modelAssignments: DeveloperTeamModelAssignments = {};
  const thinkingAssignments: DeveloperTeamThinkingAssignments = {};

  for (const file of input.plan.files) {
    if (file.path.includes("/agents/")) {
      const agentId = file.path.split("/").pop()!.replace(".md", "");
      // Extract model/thinking from content if present - for now use empty
    }
  }

  const plan: DeveloperTeamInstallPlan = {
    projectRoot: input.projectRoot,
    agentsDir: `${input.projectRoot}/.pi/agents`,
    skillsDir: `${input.projectRoot}/.pi/skills`,
    agents: input.plan.files
      .filter((f) => f.path.includes("/agents/"))
      .map((f) => ({
        agent: { id: f.path.split("/").pop()!.replace(".md", ""), name: "", description: "" } as any,
        relativePath: f.path,
        absolutePath: `${input.projectRoot}/${f.path}`,
        content: f.content,
      })),
    skills: input.plan.files
      .filter((f) => f.path.includes("/skills/"))
      .map((f) => ({
        agent: { id: f.path.split("/").pop()!.replace("/SKILL.md", ""), name: "", description: "" } as any,
        relativePath: f.path,
        absolutePath: `${input.projectRoot}/${f.path}`,
        content: f.content,
      })),
    memoryDiagnostics: [],
  };

  const result: DeveloperTeamApplyResult = applyDeveloperTeamInstall(plan);

  return Promise.resolve({
    results: result.results,
  });
}

function verifyTeamInstallFromPlan(input: import("@deck/core").DeveloperTeamVerifyInput): Promise<import("@deck/core").DeveloperTeamVerifyResult> {
  const plan = buildDeveloperTeamInstallPlan(input.projectRoot);
  const result: DeveloperTeamVerifyResult = verifyDeveloperTeamInstall(plan);

  return Promise.resolve({
    valid: result.valid,
    agentResults: result.agentResults.map((r) => ({ agentId: r.agentId, valid: r.valid })),
  });
}

function backupTeamFiles(plan: import("@deck/core").RunnerDeveloperTeamInstallPlan): import("@deck/core").BackupManifest {
  const nativePlan: DeveloperTeamInstallPlan = {
    projectRoot: "",
    agentsDir: "",
    skillsDir: "",
    agents: plan.files
      .filter((f) => f.path.includes("/agents/"))
      .map((f) => ({
        agent: { id: f.path.split("/").pop()!.replace(".md", ""), name: "", description: "" } as any,
        relativePath: f.path,
        absolutePath: f.path,
        content: f.content,
      })),
    skills: plan.files
      .filter((f) => f.path.includes("/skills/"))
      .map((f) => ({
        agent: { id: f.path.split("/").pop()!.replace("/SKILL.md", ""), name: "", description: "" } as any,
        relativePath: f.path,
        absolutePath: f.path,
        content: f.content,
      })),
    memoryDiagnostics: [],
  };

  const backup = backupDeveloperTeamFiles(nativePlan);

  return {
    files: backup.entries.map((e) => ({
      path: e.absolutePath,
      originalContent: e.previousContent ?? undefined,
      backupPath: e.absolutePath + ".backup",
    })),
    createdAt: new Date().toISOString(),
  };
}

function rollbackTeamFiles(backup: import("@deck/core").BackupManifest): void {
  const nativeBackup: BackupManifest = {
    entries: backup.files.map((e) => ({
      absolutePath: e.path,
      previousContent: e.originalContent ?? null,
    })),
  };

  rollbackDeveloperTeamFiles(nativeBackup);
}

// ---------------------------------------------------------------------------
// Model Config capabilities
// ---------------------------------------------------------------------------

function readModelAssignments(projectRoot: string): import("@deck/core").ModelConfigAssignmentsResult {
  const assignments = readDeveloperTeamModelAssignments(projectRoot);
  const thinking = readDeveloperTeamThinkingAssignments(projectRoot);

  return {
    modelAssignments: assignments,
    thinkingAssignments: thinking,
  };
}

function resolveAgentModel(agentId: string, overrides?: import("@deck/core").ModelOverrideOptions): import("@deck/core").ModelConfigResult {
  const defaults = getModelCatalog().developerTeamDefaults;
  const defaultAssignment = defaults.find((a) => a.agentId === agentId);

  return {
    agentId,
    modelId: overrides?.modelId ?? defaultAssignment?.modelId ?? "",
    reasoning: overrides?.reasoning ?? defaultAssignment?.reasoning,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPiRunnerCapabilities(): RunnerCapabilities {
  return {
    id: "pi",
    displayName: "Pi",
    environments: PI_ENVIRONMENTS,
    inspectEnvironment,
    tools: {
      buildInstallationPlan,
      installTools,
      reviewTools,
      getOptionalTools,
    },
    teams: {
      getTeamsForEnvironment: getTeamsForRunnerEnvironment,
      buildDeveloperTeamManifest,
      buildDeveloperTeamInstallPlan: buildTeamInstallPlan,
      applyDeveloperTeamInstall: applyTeamInstall,
      verifyDeveloperTeamInstall: verifyTeamInstall,
    },
    models: {
      getCatalog,
      readAssignments,
      resolveAssignment,
    },
    memory: {
      getProviders,
      getSupportedProviderIds,
    },
    capabilities: {
      getCapability: getPiCapability,
      getUserFacingIds: getPiUserFacingIds,
    },
    install: {
      buildPlan: buildInstallPlan,
      applyPlan: applyInstallPlan,
      reviewTools: reviewInstallTools,
      installTools,
    },
    developerTeam: {
      buildInstallPlan: buildTeamInstallPlanFromInput,
      applyInstall: applyTeamInstallFromPlan,
      verifyInstall: verifyTeamInstallFromPlan,
      backupFiles: backupTeamFiles,
      rollbackFiles: rollbackTeamFiles,
    },
    modelConfig: {
      readAssignments: readModelAssignments,
      resolveModel: resolveAgentModel,
    },
  };
}
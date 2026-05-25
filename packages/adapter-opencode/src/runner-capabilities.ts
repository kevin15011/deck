/**
 * OpenCode RunnerCapabilities factory.
 *
 * Composes OpenCode's preflight, install, model, memory, team, and manifest functions
 * into the core RunnerCapabilities interface.
 */

import { inspectOpenCodeEnvironment } from "./preflight";
import type { OpenCodeToolInstallResult } from "./install-tools";
import type { InstallableOpenCodeTool } from "./installation-plan";
import type { OpenCodeThinkingLevel } from "./model-config";
import type { OpenCodeDeveloperTeamInstallPlan, OpenCodeDeveloperTeamApplyResult, OpenCodeDeveloperTeamVerifyResult, BackupManifest } from "./developer-team-install";
import { buildOpenCodeDeveloperTeamInstallPlan, applyOpenCodeDeveloperTeamInstall, verifyOpenCodeDeveloperTeamInstall, backupDeveloperTeamFiles, rollbackDeveloperTeamFiles } from "./developer-team-install";
import { readOpenCodeDeveloperTeamModelConfigAssignments } from "./model-config";
import { getTeamsForEnvironment, OPENCODE_DEVELOPMENT_TEAMS } from "./team-catalog";
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
  TeamEntry,
} from "@deck/core";
import { getModelCatalog } from "@deck/core";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Environment catalog
// ---------------------------------------------------------------------------

const OPENCODE_ENVIRONMENTS: readonly RunnerEnvironment[] = [
  { id: "opencode-development", displayName: "OpenCode Development" },
];

// ---------------------------------------------------------------------------
// Environment inspection
// ---------------------------------------------------------------------------

async function inspectEnvironment(input: RunnerEnvironmentInspectInput): Promise<RunnerEnvironmentInspection> {
  try {
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

    return {
      environmentId: input.environmentId,
      isConfigured: result.existingConfiguration,
      diagnostics: result.existingConfiguration ? [] : ["OpenCode configuration directory not found."],
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
  const { buildOpenCodeInstallationPlan, OPENCODE_INSTALLABLE_TOOLS } = require("./installation-plan");
  const { reviewOpenCodeTools } = require("./required-tools");

  const toolsReview = reviewOpenCodeTools();
  const selectedToolIds: Array<"rtk" | "context-mode" | "codebase-memory" | "context7" | "engram-memory"> = [];

  const plan = buildOpenCodeInstallationPlan({ tools: toolsReview.tools, selectedToolIds });

  const steps = plan.map((tool: InstallableOpenCodeTool) => ({
    action: "install" as const,
    tool: tool.module,
    reason: `${tool.name} is selected for installation`,
  }));

  return { steps };
}

async function installTools(input: RunnerToolInstallInput): Promise<RunnerToolInstallResult> {
  const { installOpenCodeTools } = require("./install-tools");
  const { buildOpenCodeInstallationPlan, OPENCODE_INSTALLABLE_TOOLS } = require("./installation-plan");
  const { reviewOpenCodeTools } = require("./required-tools");

  const toolsReview = reviewOpenCodeTools();
  const selectedToolIds = OPENCODE_INSTALLABLE_TOOLS.filter((t: InstallableOpenCodeTool) => t.required).map((t: InstallableOpenCodeTool) => t.id);

  const plan = buildOpenCodeInstallationPlan({ tools: toolsReview.tools, selectedToolIds });

  const results: OpenCodeToolInstallResult[] = await installOpenCodeTools("opencode", plan, () => {});
  const firstResult = results[0];

  return {
    installed: firstResult?.success ?? false,
    tool: firstResult?.tool,
  };
}

async function reviewTools(input: RunnerToolReviewInput): Promise<RunnerToolReviewResult> {
  const { reviewOpenCodeTools } = require("./required-tools");
  const result = reviewOpenCodeTools();

  return {
    tools: result.installedPackages,
    missing: result.tools.filter((t: { name: string; installed: boolean }) => !t.installed).map((t: { name: string }) => t.name),
  };
}

function getOptionalTools(): readonly import("@deck/core").RunnerToolOptionalTool[] {
  const { OPENCODE_INSTALLABLE_TOOLS } = require("./installation-plan");
  return OPENCODE_INSTALLABLE_TOOLS.filter((tool: { required: boolean }) => !tool.required).map((tool: InstallableOpenCodeTool) => ({
    id: tool.id,
    name: tool.name,
    source: tool.module,
    installKind: tool.installKind,
  }));
}

// ---------------------------------------------------------------------------
// Capability catalog
// ---------------------------------------------------------------------------

function getOpenCodeCapability(capabilityId: string): import("@deck/core").RunnerCapabilityCatalogEntry | undefined {
  const { getOpenCodeRunnerCapability } = require("./capability-catalog");
  const entry = getOpenCodeRunnerCapability(capabilityId as any);
  if (!entry) return undefined;
  return {
    capabilityId: entry.capabilityId,
    label: entry.label,
    description: entry.description,
    section: "runner-capabilities",
    runnerScope: entry.runnerScope,
    requirementLevel: entry.requirementLevel,
    toolId: entry.toolId,
    source: entry.source,
    installKind: entry.installKind,
    isInternal: entry.isInternal,
  };
}

function getOpenCodeUserFacingIds(): readonly string[] {
  const { OPENCODE_RUNNER_CAPABILITY_IDS } = require("./capability-catalog");
  return OPENCODE_RUNNER_CAPABILITY_IDS as readonly string[];
}

// ---------------------------------------------------------------------------
// Team capabilities
// ---------------------------------------------------------------------------

function getTeamsForRunnerEnvironment(environmentId: string): readonly TeamEntry[] {
  return getTeamsForEnvironment(environmentId);
}

function buildDeveloperTeamManifest(input: import("@deck/core").DeveloperTeamManifestInput): DeveloperTeamManifest {
  const modelAssignments: DeveloperTeamModelAssignments = {};
  const reasoningAssignments: DeveloperTeamThinkingAssignments = {};

  if (input.modelAssignments) {
    for (const assignment of input.modelAssignments) {
      modelAssignments[assignment.agentId] = assignment.modelId;
      if (assignment.reasoning) {
        reasoningAssignments[assignment.agentId] = assignment.reasoning as OpenCodeThinkingLevel;
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
      const enabledIds = getEnabledPackageInstructionIds(config, "opencode");
      return enabledIds.length > 0 ? buildCapabilityInstructionBundle(enabledIds) : undefined;
    } catch {
      return undefined;
    }
  })();

  const plan = buildOpenCodeDeveloperTeamInstallPlan(input.projectRoot, {
    configModelOverrides: modelAssignments,
    reasoningEffortOverrides: reasoningAssignments,
    supportedMemoryProviderIds: ["engram", "supermemory"],
    capabilityInstructions: resolvedCapabilityInstructions,
  });

  const agents = plan.skills.map((s) => {
    // Find the agent entry for this skill
    const agentEntry = Object.entries(plan.agentEntries).find(([, entry]) => {
      // Map skill back to agent - OpenCode skills correspond to agents
      const skillId = s.agent.skillId;
      return skillId && entry.description === s.agent.description;
    });

    return {
      agentId: s.agent.id,
      displayName: s.agent.name,
      instruction: s.content,
      model: modelAssignments[s.agent.id],
      reasoning: reasoningAssignments[s.agent.id],
      memoryBundle: plan.memoryBundle,
    };
  });

  const skills = plan.skills.map((s) => ({
    agentId: s.agent.id,
    skillId: s.agent.skillId,
    body: s.content,
    memoryBundle: plan.memoryBundle,
  }));

  const standaloneSkills = plan.standaloneSkills.map((s) => ({
    skillId: s.skillId,
    body: s.content,
  }));

  return {
    team: OPENCODE_DEVELOPMENT_TEAMS[0],
    agents,
    skills,
    standaloneSkills,
    memoryDiagnostics: plan.memoryDiagnostics,
  };
}

function buildTeamInstallPlan(input: import("@deck/core").DeveloperTeamInstallPlanInput): RunnerDeveloperTeamInstallPlan {
  const modelAssignments: DeveloperTeamModelAssignments = {};
  const reasoningAssignments: DeveloperTeamThinkingAssignments = {};

  for (const agent of input.manifest.agents) {
    modelAssignments[agent.agentId] = agent.model ?? "";
    if (agent.reasoning) {
      reasoningAssignments[agent.agentId] = agent.reasoning as OpenCodeThinkingLevel;
    }
  }

  const plan = buildOpenCodeDeveloperTeamInstallPlan(input.projectRoot, {
    configModelOverrides: modelAssignments,
    reasoningEffortOverrides: reasoningAssignments,
    capabilityInstructions: input.capabilityInstructions,
    standaloneSkills: input.manifest.standaloneSkills,
  });

  // OpenCode writes skill files, prompt files, and command files
  const files: import("@deck/core").DeveloperTeamInstallFile[] = [
    ...plan.skills.map((s) => ({ path: s.relativePath, content: s.content })),
    ...plan.standaloneSkills.map((s) => ({ path: s.relativePath, content: s.content })),
    // Prompt and command files would be added from promptGenerationPlan and commandGenerationPlan
  ];

  return { files };
}

async function applyTeamInstall(input: import("@deck/core").DeveloperTeamApplyInput): Promise<RunnerDeveloperTeamApplyResult> {
  // Resolve runner config directory — skills/prompts go to ~/.config/opencode, NOT projectRoot
  const configDir = join(process.env.HOME ?? "/home/user", ".config", "opencode");
  const skillsDir = join(configDir, "skills");

  // Separate agent-bound skills from standalone skills via the path pattern
  const agentSkillFiles = input.plan.files.filter((f: { path: string }) => f.path.includes("/skills/") && !f.path.includes("judgment-day") && !f.path.includes("cognitive-doc-design") && !f.path.includes("comment-writer"));
  const standaloneSkillFiles = input.plan.files.filter((f: { path: string }) =>
    f.path.includes("judgment-day") ||
    f.path.includes("cognitive-doc-design") ||
    f.path.includes("comment-writer")
  );

  const plan: OpenCodeDeveloperTeamInstallPlan = {
    projectRoot: input.projectRoot,
    agentsDir: join(configDir, "agents"),
    skillsDir: join(configDir, "skills"),
    agents: [],
    skills: agentSkillFiles.map((f: { path: string; content: string }) => ({
      agent: { id: f.path.split("/").pop()!.replace("/SKILL.md", ""), name: "", description: "", skillId: "" } as any,
      relativePath: f.path,
      absolutePath: join(skillsDir, f.path.split("/").pop()!.replace("/SKILL.md", ""), "SKILL.md"),
      content: f.content,
    })),
    standaloneSkills: standaloneSkillFiles.map((f: { path: string; content: string }) => ({
      skillId: f.path.split("/").pop()!.replace("/SKILL.md", ""),
      relativePath: f.path,
      absolutePath: join(skillsDir, f.path.split("/").pop()!.replace("/SKILL.md", ""), "SKILL.md"),
      content: f.content,
    })),
    memoryDiagnostics: [],
    agentEntries: {},
    promptGenerationPlan: {} as ReturnType<typeof import("./prompt-generation").buildPromptGenerationPlan>,
    commandGenerationPlan: {} as ReturnType<typeof import("./command-generation").buildCommandGenerationPlan>,
    mermaidPluginStatus: "missing",
  };

  const result: OpenCodeDeveloperTeamApplyResult = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

  return {
    success: true,
    appliedFiles: result.results.map((r) => r.agentId),
  };
}

async function verifyTeamInstall(input: import("@deck/core").DeveloperTeamVerifyInput): Promise<RunnerDeveloperTeamVerifyResult> {
  const plan = buildOpenCodeDeveloperTeamInstallPlan(input.projectRoot, {
    capabilityInstructions: input.capabilityInstructions,
  });
  const result: OpenCodeDeveloperTeamVerifyResult = verifyOpenCodeDeveloperTeamInstall(plan);

  return {
    isInstalled: result.valid,
    missingFiles: result.skillResults.filter((r) => !r.valid).map((r) => r.agentId),
  };
}

// ---------------------------------------------------------------------------
// Model capabilities
// ---------------------------------------------------------------------------

function getCatalog(_input?: import("@deck/core").RunnerModelCatalogInput): import("@deck/core").ModelCatalog {
  return getModelCatalog();
}

function readAssignments(input: import("@deck/core").RunnerModelAssignmentReadInput): import("@deck/core").RunnerModelAssignments {
  const config = readOpenCodeDeveloperTeamModelConfigAssignments();

  const result = getModelCatalog().developerTeamDefaults.map((default_assignment) => ({
    agentId: default_assignment.agentId,
    modelId: config.modelAssignments[default_assignment.agentId] ?? default_assignment.modelId,
    reasoning: config.thinkingAssignments[default_assignment.agentId] ?? default_assignment.reasoning,
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

function getProviders(_input: import("@deck/core").RunnerMemoryProviderInput): readonly import("@deck/core").AdaptiveMemoryProvider[] {
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
  const { buildOpenCodeInstallationPlan, OPENCODE_INSTALLABLE_TOOLS } = require("./installation-plan");
  const { reviewOpenCodeTools } = require("./required-tools");

  const toolsReview = reviewOpenCodeTools();
  const selectedToolIds = (input.selectedOptionalToolIds ?? []) as string[];

  const plan = buildOpenCodeInstallationPlan({ tools: toolsReview.tools, selectedToolIds });

  const steps = plan.map((tool: InstallableOpenCodeTool) => ({
    action: "install" as const,
    tool: tool.module,
    reason: `${tool.name} is selected for installation`,
  }));

  return { steps };
}

function applyInstallPlan(options: import("@deck/core").RunnerInstallApplyOptions): Promise<readonly import("@deck/core").RunnerInstallResult[]> {
  const { installOpenCodeTools } = require("./install-tools");
  const { buildOpenCodeInstallationPlan, OPENCODE_INSTALLABLE_TOOLS } = require("./installation-plan");
  const { reviewOpenCodeTools } = require("./required-tools");

  const toolsReview = reviewOpenCodeTools();
  const selectedToolIds = OPENCODE_INSTALLABLE_TOOLS.filter((t: InstallableOpenCodeTool) => t.required).map((t: InstallableOpenCodeTool) => t.id);

  const plan = buildOpenCodeInstallationPlan({ tools: toolsReview.tools, selectedToolIds });

  return installOpenCodeTools(options.command, plan, options.onResult ?? (() => {}));
}

function reviewInstallTools(input: import("@deck/core").RunnerToolsReviewInput): Promise<import("@deck/core").RunnerToolsReviewResult> {
  const { reviewOpenCodeTools } = require("./required-tools");
  const result = reviewOpenCodeTools();

  return Promise.resolve({
    tools: result.tools.map((t: { name: string }) => t.name),
    missing: result.tools.filter((t: { name: string; installed: boolean }) => !t.installed).map((t: { name: string }) => t.name),
    installedPackages: result.installedPackages,
  });
}

// ---------------------------------------------------------------------------
// Developer Team capabilities
// ---------------------------------------------------------------------------

function buildTeamInstallPlanFromInput(input: import("@deck/core").DeveloperTeamInstallInput): import("@deck/core").RunnerDeveloperTeamInstallPlan {
  const modelAssignments: DeveloperTeamModelAssignments = {};
  const reasoningAssignments: DeveloperTeamThinkingAssignments = {};

  if (input.modelAssignments) {
    for (const assignment of input.modelAssignments) {
      modelAssignments[assignment.agentId] = assignment.modelId;
      if (assignment.reasoning) {
        reasoningAssignments[assignment.agentId] = assignment.reasoning as OpenCodeThinkingLevel;
      }
    }
  }

  const plan = buildOpenCodeDeveloperTeamInstallPlan(input.projectRoot, {
    configModelOverrides: modelAssignments,
    reasoningEffortOverrides: reasoningAssignments,
    capabilityInstructions: input.capabilityInstructions,
  });

  const files: import("@deck/core").DeveloperTeamInstallFile[] = [
    ...plan.skills.map((s) => ({ path: s.relativePath, content: s.content })),
    ...plan.standaloneSkills.map((s) => ({ path: s.relativePath, content: s.content })),
  ];

  return { files };
}

function applyTeamInstallFromPlan(input: import("@deck/core").DeveloperTeamApplyInput): Promise<import("@deck/core").DeveloperTeamApplyResult> {
  // Resolve runner config directory — skills go to ~/.config/opencode/skills, NOT projectRoot
  const configDir = join(process.env.HOME ?? "/home/user", ".config", "opencode");
  const skillsDir = join(configDir, "skills");

  // Separate standalone skills from agent-bound skills
  const standaloneSkillIds = ["judgment-day", "cognitive-doc-design", "comment-writer"];
  const plan: OpenCodeDeveloperTeamInstallPlan = {
    projectRoot: input.projectRoot,
    agentsDir: join(configDir, "agents"),
    skillsDir: join(configDir, "skills"),
    agents: [],
    skills: input.plan.files
      .filter((f) => f.path.includes("/skills/") && !standaloneSkillIds.some((id) => f.path.includes(id)))
      .map((f) => ({
        agent: { id: f.path.split("/").pop()!.replace("/SKILL.md", ""), name: "", description: "", skillId: "" } as any,
        relativePath: f.path,
        absolutePath: join(skillsDir, f.path.split("/").pop()!.replace("/SKILL.md", ""), "SKILL.md"),
        content: f.content,
      })),
    standaloneSkills: input.plan.files
      .filter((f) => standaloneSkillIds.some((id) => f.path.includes(id)))
      .map((f) => ({
        skillId: f.path.split("/").pop()!.replace("/SKILL.md", ""),
        relativePath: f.path,
        absolutePath: join(skillsDir, f.path.split("/").pop()!.replace("/SKILL.md", ""), "SKILL.md"),
        content: f.content,
      })),
    memoryDiagnostics: [],
    agentEntries: {},
    promptGenerationPlan: {} as ReturnType<typeof import("./prompt-generation").buildPromptGenerationPlan>,
    commandGenerationPlan: {} as ReturnType<typeof import("./command-generation").buildCommandGenerationPlan>,
    mermaidPluginStatus: "missing",
  };

  const result: OpenCodeDeveloperTeamApplyResult = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

  return Promise.resolve({
    results: result.results,
    changedCount: result.changedCount,
    unchangedCount: result.unchangedCount,
  });
}

function verifyTeamInstallFromPlan(input: import("@deck/core").DeveloperTeamVerifyInput): Promise<import("@deck/core").DeveloperTeamVerifyResult> {
  const plan = buildOpenCodeDeveloperTeamInstallPlan(input.projectRoot);
  const result: OpenCodeDeveloperTeamVerifyResult = verifyOpenCodeDeveloperTeamInstall(plan);

  return Promise.resolve({
    valid: result.valid,
    skillResults: result.skillResults.map((r) => ({ agentId: r.agentId, valid: r.valid })),
  });
}

function backupTeamFiles(plan: import("@deck/core").RunnerDeveloperTeamInstallPlan): import("@deck/core").BackupManifest {
  const standaloneSkillIds = ["judgment-day", "cognitive-doc-design", "comment-writer"];
  const nativePlan: OpenCodeDeveloperTeamInstallPlan = {
    projectRoot: "",
    agentsDir: "",
    skillsDir: "",
    agents: [],
    skills: plan.files
      .filter((f) => f.path.includes("/skills/") && !standaloneSkillIds.some((id) => f.path.includes(id)))
      .map((f) => ({
        agent: { id: f.path.split("/").pop()!.replace("/SKILL.md", ""), name: "", description: "", skillId: "" } as any,
        relativePath: f.path,
        absolutePath: f.path,
        content: f.content,
      })),
    standaloneSkills: plan.files
      .filter((f) => standaloneSkillIds.some((id) => f.path.includes(id)))
      .map((f) => ({
        skillId: f.path.split("/").pop()!.replace("/SKILL.md", ""),
        relativePath: f.path,
        absolutePath: f.path,
        content: f.content,
      })),
    memoryDiagnostics: [],
    agentEntries: {},
    promptGenerationPlan: {} as ReturnType<typeof import("./prompt-generation").buildPromptGenerationPlan>,
    commandGenerationPlan: {} as ReturnType<typeof import("./command-generation").buildCommandGenerationPlan>,
    mermaidPluginStatus: "missing",
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

function readModelAssignments(_projectRoot: string): import("@deck/core").ModelConfigAssignmentsResult {
  const config = readOpenCodeDeveloperTeamModelConfigAssignments();

  return {
    modelAssignments: config.modelAssignments,
    thinkingAssignments: config.thinkingAssignments,
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

export function createOpenCodeRunnerCapabilities(): RunnerCapabilities {
  return {
    id: "opencode",
    displayName: "OpenCode",
    environments: OPENCODE_ENVIRONMENTS,
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
      getCapability: getOpenCodeCapability,
      getUserFacingIds: getOpenCodeUserFacingIds,
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
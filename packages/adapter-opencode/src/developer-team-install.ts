import { ROLE_TOOL_POLICY, isReadOnlyRole, readOnlyMcpTools } from "@deck/core/session/role-tool-policy";
import { assertNoContributionSymlink, readRunnerContributions, contributionHash } from "@deck/core";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";

import {
  DEVELOPER_TEAM_AGENTS,
} from "@deck/core/teams/developer/catalog";
import type { DeveloperTeamAgent } from "@deck/core/teams/developer/catalog";
import {
  buildCapabilityInstructionBundle,
  composeCapabilityInstructions,
  getEnabledPackageInstructionIds,
} from "@deck/core/teams/developer/instruction-bundles";

// Inline verification for adapter — uses core directly at runtime (Task 6)
// TODO: restore import when @deck/core exports are fully typed
type OrchestratorInvariantSurface = "session" | "agent" | "skill" | "manifest";

interface InvariantVerificationResult {
  pass: boolean;
  missing: string[];
}

/**
 * Verify invariant presence inline (copied from core for adapter isolation)
 */
function verifyInvariantPresence(
  content: string,
  surface: OrchestratorInvariantSurface,
): InvariantVerificationResult {
  const criticalIds = [
    "INV-001",
    "INV-002",
    "INV-003",
    "INV-004",
    "INV-005",
  ];
  const missing: string[] = [];

  const hasCompactReference = /^## Runtime Contract Reference$/m.test(content)
    && content.includes("Runtime-Enforced Team Contract remains binding");
  const hasAdaptiveReference = /^## Team Contract Reference$/m.test(content)
    && content.includes("Adaptive Developer Team Contract remains binding");
  if (hasCompactReference || hasAdaptiveReference) {
    return { pass: true, missing: [] };
  }

  return { pass: false, missing: criticalIds };
}
import { type ModificationAuthorization } from "../../core/src/teams/developer/orchestrator-invariants";
import { translateOpenCodeCapabilityInstructions } from "./instruction-translation";
import { getAgentContent, type DeveloperTeamPromptProfileV1 } from "@deck/core/teams/developer/content-registry";
import { DEFAULT_ORCHESTRATOR_PERSONALITY, type OrchestratorPersonality } from "@deck/core/config/deck-config";
import { type CapabilityInstructionBundle } from "@deck/core";
import { getBootstrapSkillFiles } from "@deck/core/skills/bootstrap";

import { buildPromptGenerationPlan, applyPromptGeneration, buildPromptReference, } from "./prompt-generation";
import { buildCommandGenerationPlan, applyCommandGeneration } from "./command-generation";
import { mergeAndWrite } from "./config-merge";
import { resolveModelConfig, DEFAULT_OPENCODE_MODELS } from "./model-config";
import { detectMermaidPluginStatus, internalOpenCodePluginSpecifiers } from "./internal-opencode-packages";
import type { AgentEntry, OpenCodeConfig } from "./types";
import modelVariantsPluginAssetPath from "../assets/opencode/plugins/model-variants.generated.js" with { type: "file" };
import executionPluginAssetPath from "../assets/opencode/plugins/developer-team-execution.generated.js" with { type: "file" };

// ---------------------------------------------------------------------------
// Types (re-export)
// ---------------------------------------------------------------------------

export type OpenCodePlannedAgentFile = {
  agent: DeveloperTeamAgent;
  relativePath: string;
  absolutePath: string;
  content: string;
};

export type OpenCodePlannedSkillFile = {
  agent: DeveloperTeamAgent;
  relativePath: string;
  absolutePath: string;
  content: string;
};

export type OpenCodePlannedStandaloneSkillFile = {
  skillId: string;
  packagePath: string;
  relativePath: string;
  absolutePath: string;
  content: string;
};

export type OpenCodePlannedExecutionPluginFile = {
  relativePath: string;
  absolutePath: string;
  content: string;
};

export type OpenCodeDeveloperTeamInstallPlan = {
  projectRoot: string;
  agentsDir: string;
  skillsDir: string;
  agents: OpenCodePlannedAgentFile[];
  skills: OpenCodePlannedSkillFile[];
  standaloneSkills: OpenCodePlannedStandaloneSkillFile[];
  executionPlugin?: OpenCodePlannedExecutionPluginFile;
  modelVariantsPlugin?: OpenCodePlannedExecutionPluginFile;
  /** Agent entries for opencode.json config merge */
  agentEntries: Record<string, AgentEntry>;
  promptGenerationPlan: ReturnType<typeof buildPromptGenerationPlan>;
  commandGenerationPlan: ReturnType<typeof buildCommandGenerationPlan>;
  mermaidPluginStatus: "ready" | "missing";
  /** Captured capability instruction bundle for verify reconciliation */
  capabilityInstructions?: CapabilityInstructionBundle;
  /** Resolved orchestrator personality used during plan construction */
  personality?: OrchestratorPersonality;
  /** Effective prompt profile after rollout receipt validation. */
  promptProfile: DeveloperTeamPromptProfileV1;
  changedAgentIds?: readonly string[];
};

export type OpenCodeBundleApplyResult = {
  agentId: string;
  kind: "agent" | "skill" | "prompt" | "command" | "plugin";
  status: "created" | "unchanged" | "updated";
  absolutePath: string;
};

export type OpenCodeDeveloperTeamApplyResult = {
  results: OpenCodeBundleApplyResult[];
  configMergeResult?: {
    status: "created" | "updated" | "unchanged";
    backupPath: string;
    pluginsAdded: string[];
  };
  changedCount: number;
  unchangedCount: number;
  fileResults: OpenCodeBundleApplyResult[];

};

export type OpenCodeBundleVerifyResult = {
  agentId: string;
  valid: boolean;
  issues: string[];
};

export type OpenCodeDeveloperTeamVerifyResult = {
  valid: boolean;
  agentResults: OpenCodeBundleVerifyResult[];
  skillResults: OpenCodeBundleVerifyResult[];
  pluginResults?: OpenCodeBundleVerifyResult[];
};

function validateStandaloneSkillId(skillId: string): void {
  if (!/^[a-z0-9_-]+$/i.test(skillId)) {
    throw new Error(`Invalid skillId "${skillId}": must contain only alphanumeric characters, underscores, and hyphens`);
  }
}

function validateStandalonePackagePath(filePath: string): void {
  if (!filePath || filePath.startsWith("/") || filePath.includes("\\")) {
    throw new Error(`Invalid standalone skill package path "${filePath}": must be a relative POSIX path`);
  }
  const segments = filePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Invalid standalone skill package path "${filePath}": must not contain empty, current, or parent segments`);
  }
}

function buildStandaloneSkillFiles(
  skillsDir: string,
  standaloneSkills: readonly { skillId: string; body: string; files?: Record<string, string> }[],
  capabilityInstructions?: CapabilityInstructionBundle,
): OpenCodePlannedStandaloneSkillFile[] {
  const planned: OpenCodePlannedStandaloneSkillFile[] = [];
  for (const skill of standaloneSkills) {
    validateStandaloneSkillId(skill.skillId);
    const packageFiles: Record<string, string> = {
      "SKILL.md": composeCapabilityInstructions(skill.body, capabilityInstructions, { surface: "skill", teamId: "developer-team", skillId: skill.skillId }),
      ...(skill.files ?? {}),
    };
    for (const [packagePath, content] of Object.entries(packageFiles)) {
      validateStandalonePackagePath(packagePath);
      planned.push({
        skillId: skill.skillId,
        packagePath,
        relativePath: `skills/${skill.skillId}/${packagePath}`,
        absolutePath: join(skillsDir, skill.skillId, ...packagePath.split("/")),
        content,
      });
    }
  }
  return planned;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** Tools available to subagents by default */
const SUBAGENT_BASE_TOOLS: Record<string, boolean> = {
  bash: true,
  edit: true,
  read: true,
  write: true,
};

/** Tools available to the orchestrator (includes delegation) */
const ORCHESTRATOR_TOOLS: Record<string, boolean> = {
  bash: true,
  delegate: true,
  delegation_list: true,
  delegation_read: true,
  edit: true,
  read: true,
  write: true,
};

// ---------------------------------------------------------------------------
// Agent entry builder
// ---------------------------------------------------------------------------

function buildAgentEntry(
  agent: DeveloperTeamAgent,
  promptReference: string,
  options?: {
    cliModelOverride?: string;
    configModelOverrides?: Record<string, string>;
    reasoningEffortOverrides?: Record<string, string>;
    capabilityMap?: Record<string, boolean | null>;
    changedAgentIds?: readonly string[];
  },
): AgentEntry {
  const isOrchestrator = agent.id === "deck-lead";
  const isChanged = options?.changedAgentIds?.includes(agent.id) ?? false;
  const hasPersistedModel = Object.prototype.hasOwnProperty.call(options?.configModelOverrides ?? {}, agent.id);
  const hasPersistedReasoning = Object.prototype.hasOwnProperty.call(options?.reasoningEffortOverrides ?? {}, agent.id);
  const readOnly = isReadOnlyRole(agent.id);
  const allowed = [...ROLE_TOOL_POLICY.builtins, ...readOnlyMcpTools(Object.keys(ROLE_TOOL_POLICY.mcp), (server, tool) => [`${server}_${server === "web-search" ? `tavily_${tool}` : tool}`])];
  const modelConfig = isChanged || hasPersistedModel ? resolveModelConfig(
    agent.id,
    options?.cliModelOverride,
    options?.configModelOverrides,
    options?.reasoningEffortOverrides as Record<string, "off" | "low" | "medium" | "high"> | undefined,
    undefined,
    options?.capabilityMap,
  ) : undefined;
  const tools = readOnly ? { "*": false, bash: false, edit: false, write: false, ...Object.fromEntries(allowed.map(tool => [tool, true])) } : isOrchestrator ? ORCHESTRATOR_TOOLS : SUBAGENT_BASE_TOOLS;
  const entry: AgentEntry = {
    description: agent.description,
    mode: isOrchestrator ? "primary" : "subagent",
    prompt: promptReference,
    tools,
  };
  if (readOnly) entry.permission = { "*": "deny", ...Object.fromEntries(allowed.map(tool => [tool, "allow"])) };
  // Exact persisted assignments are re-emitted so legacy IDs can migrate onto the
  // seven-role inventory. An explicit change may additionally clear the variant.
  if (isChanged || hasPersistedModel) {
    const model = options?.configModelOverrides?.[agent.id] ?? modelConfig?.model;
    if (model) entry.model = model;
  }
  if (hasPersistedReasoning || isChanged) {
    entry.variant = options?.reasoningEffortOverrides?.[agent.id] ?? "";
  }
  if (isOrchestrator) {
    const subagents = DEVELOPER_TEAM_AGENTS.filter((candidate) => candidate.id !== "deck-lead");
    entry.permission = { task: { "*": "deny", ...Object.fromEntries(subagents.map((candidate) => [candidate.id, "allow"])) } };
    entry.hidden = false;
  } else {
    entry.hidden = true;
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Skill file content builder
// ---------------------------------------------------------------------------

function buildSkillFileContent(
  agent: DeveloperTeamAgent,
  capabilityInstructions?: CapabilityInstructionBundle,
  personality?: OrchestratorPersonality,
  promptProfile: DeveloperTeamPromptProfileV1 = "compact",
): string {
  const content = getAgentContent(agent.id, capabilityInstructions
    ? { capabilityInstructions, personality, promptProfile }
    : { personality, promptProfile });
  if (!content) {
    throw new Error(`No content found for agent ${agent.id} in core registry.`);
  }

  // This ensures byte-for-byte match for verification
  const skillBodyPlain = content.skillBody;

  // deck-onboard is user-invocable (no delegate_only), others are delegated
  const isUserInvocable = agent.skillId === "deck-onboard";

  return [
    "---",
    `name: ${agent.skillId}`,
    `description: "${agent.description}"`,
    "disable-model-invocation: true",
    `user-invocable: ${isUserInvocable ? "true" : "false"}`,
    "license: MIT",
    "metadata:",
    "  author: gentleman-programming",
    '  version: "3.0"',
    isUserInvocable ? "" : "  delegate_only: true",
    "---",

    skillBodyPlain,

  ].join("\n");
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export function getOpenCodeExecutionProbeCapabilities() {
  return Object.freeze({
    invocationHook: true,
    freshAgentHook: true,
  });
}

export function buildOpenCodeDeveloperTeamInstallPlan(
  projectRoot: string,
  options?: {
    configDir?: string;
    cliModelOverride?: string;
    configModelOverrides?: Record<string, string>;
    reasoningEffortOverrides?: Record<string, string>;
    changedAgentIds?: readonly string[];
    /** Optional personality override; when absent, uses the default personality. */
    personality?: OrchestratorPersonality;
    /**
     * Optional modification authorization for apply agents.
     * When provided, authorization card is injected into apply-agent prompts (REQ-OA-005).
     * This enables runtime authorization card injection during install-time prompt generation.
     */
    authorization?: ModificationAuthorization;
    /**
     * Optional map of modelId -> runner signal (true/false).
     * When provided, runner signal takes precedence over catalog fallback.
     * This enables the TUI to pass runtime capability detection results.
     */
    capabilityMap?: Record<string, boolean | null>;
    capabilityInstructions?: CapabilityInstructionBundle;
    standaloneSkills?: readonly { skillId: string; body: string; files?: Record<string, string> }[];
  },
): OpenCodeDeveloperTeamInstallPlan {
  const configDir = options?.configDir ?? join(process.env.HOME ?? "/home/user", ".config", "opencode");
  const agentsDir = join(configDir, "agents");
  const skillsDir = join(configDir, "skills");
  const executionPlugin: OpenCodePlannedExecutionPluginFile = {
    relativePath: "plugins/developer-team-execution.js",
    absolutePath: join(configDir, "plugins", "developer-team-execution.js"),
    content: readFileSync(typeof executionPluginAssetPath === "string" ? executionPluginAssetPath : new URL("../assets/opencode/plugins/developer-team-execution.generated.js", import.meta.url), "utf-8"),
  };

  const capabilityInstructions = options?.capabilityInstructions
    ? translateOpenCodeCapabilityInstructions(options.capabilityInstructions)
    : undefined;

  const resolvedPersonality: OrchestratorPersonality = options?.personality ?? DEFAULT_ORCHESTRATOR_PERSONALITY;
  const promptProfile = "compact" as const;

  // Build agent entries for opencode.json
  const agentEntries: Record<string, AgentEntry> = {};
  for (const agent of DEVELOPER_TEAM_AGENTS) {
    const promptReference = buildPromptReference(configDir, agent.id);
    agentEntries[agent.id] = buildAgentEntry(agent, promptReference, {
      cliModelOverride: options?.cliModelOverride,
      configModelOverrides: options?.configModelOverrides,
      reasoningEffortOverrides: options?.reasoningEffortOverrides,
      capabilityMap: options?.capabilityMap,
      changedAgentIds: options?.changedAgentIds,
    });
  }

  // Build skill files
  const skills: OpenCodePlannedSkillFile[] = DEVELOPER_TEAM_AGENTS.map((agent) => {
    const relativePath = `skills/${agent.skillId}/SKILL.md`;
    const absolutePath = join(skillsDir, agent.skillId, "SKILL.md");
    const content = buildSkillFileContent(agent, capabilityInstructions, resolvedPersonality, promptProfile);
    return { agent, relativePath, absolutePath, content };
  });

  // Build standalone skill package files (verbatim, no generated frontmatter).
  const standaloneSkills = [
    ...buildStandaloneSkillFiles(skillsDir, options?.standaloneSkills ?? [], capabilityInstructions),
    ...getBootstrapSkillFiles().map((skill): OpenCodePlannedStandaloneSkillFile => ({
      skillId: skill.skillId,
      packagePath: "SKILL.md",
      relativePath: `skills/${skill.skillId}/SKILL.md`,
      absolutePath: join(skillsDir, skill.skillId, "SKILL.md"),
      content: composeCapabilityInstructions(skill.content, capabilityInstructions, { surface: "skill", teamId: "developer-team", skillId: skill.skillId }),
    })),
  ];

  // This ensures provider isolation and OpenSpec authority are maintained
  // REQ-OA-005: Pass authorization to enable runtime authorization card injection
  const promptGenerationPlan = buildPromptGenerationPlan({
    configDir,
    projectRoot,
    capabilityInstructions,
    personality: resolvedPersonality,
    promptProfile,
    authorization: options?.authorization,
  });

  // Command generation plan
  const commandGenerationPlan = buildCommandGenerationPlan({ configDir });

  // Detect mermaid plugin status (will be resolved during apply using the merged config)
  const mermaidPluginStatus: "ready" | "missing" = "missing";

  return {
    projectRoot,
    agentsDir,
    skillsDir,
    agents: [], // Skills are in skills[]
    skills,
    standaloneSkills,
    executionPlugin,
    modelVariantsPlugin: {
      relativePath: "plugins/deck-model-variants.js",
      absolutePath: join(configDir, "plugins/deck-model-variants.js"),
      content: readFileSync(typeof modelVariantsPluginAssetPath === "string" ? modelVariantsPluginAssetPath : new URL("../assets/opencode/plugins/model-variants.generated.js", import.meta.url), "utf-8"),
    },
    agentEntries,
    promptGenerationPlan,
    commandGenerationPlan,
    mermaidPluginStatus,
    capabilityInstructions,
    personality: resolvedPersonality,
    promptProfile,
    changedAgentIds: options?.changedAgentIds,
  };
}

function assertOpenCodeCandidateFiles(
  plan: OpenCodeDeveloperTeamInstallPlan,
  exists: typeof existsSync,
  readFile: typeof readFileSync,
): void {
  const expected = [
    ...plan.skills,
    ...plan.standaloneSkills,
    ...plan.promptGenerationPlan,
    ...[plan.executionPlugin, plan.modelVariantsPlugin].filter((file): file is OpenCodePlannedExecutionPluginFile => !!file),
  ];
  for (const planned of expected) {
    if (!exists(planned.absolutePath) || readFile(planned.absolutePath, "utf-8") !== planned.content) {
      throw new Error(`Developer Team candidate verification failed for ${planned.absolutePath}.`);
    }
  }
  const configPath = join(dirname(plan.skillsDir), "opencode.json");
  const config = JSON.parse(readFile(configPath, "utf-8")) as OpenCodeConfig;
  for (const agent of DEVELOPER_TEAM_AGENTS) {
    if (!config.agent?.[agent.id]) {
      throw new Error(`Developer Team candidate configuration is missing ${agent.id}.`);
    }
  }
}

export function applyOpenCodeDeveloperTeamInstall(
  plan: OpenCodeDeveloperTeamInstallPlan,
  options?: {
    writeFile?: typeof writeFileSync;
    readFile?: typeof readFileSync;
    exists?: typeof existsSync;
    mkdir?: typeof mkdirSync;
    unlink?: typeof unlinkSync;
    configDir?: string;
  },
): OpenCodeDeveloperTeamApplyResult {
  const writeFile = options?.writeFile ?? writeFileSync;
  const readFile = options?.readFile ?? readFileSync;
  const exists = options?.exists ?? existsSync;
  const mkdir = options?.mkdir ?? mkdirSync;
  const unlink = options?.unlink ?? unlinkSync;
  const configDir = options?.configDir ?? dirname(plan.skillsDir);
  const opencodeConfigPath = join(configDir, "opencode.json");
  const fileBackup = backupDeveloperTeamFiles(plan, { exists, readFile });
  const previousConfig = exists(opencodeConfigPath) ? readFile(opencodeConfigPath, "utf-8") : null;

  try {

  // 1. Config merge (agents + mermaid plugin)
  if (!exists(configDir)) mkdir(configDir, { recursive: true });
  const mermaidPlugins = internalOpenCodePluginSpecifiers(configDir);

  let configMergeResult: OpenCodeDeveloperTeamApplyResult["configMergeResult"];
  try {
    const mergeResult = mergeAndWrite({
      configPath: opencodeConfigPath,
      agentEntries: plan.agentEntries,

      pluginsToAdd: mermaidPlugins,
      pluginReplacements: { "deck-model-variants": mermaidPlugins[1]! },
      readFile,
      writeFile,
      renameFile: (from, to) => require("node:fs").renameSync(from, to),
      exists,
    });
    configMergeResult = {
      status: mergeResult.status,
      backupPath: mergeResult.backupPath,
      pluginsAdded: mergeResult.pluginsAdded,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[deck] opencode.json config merge failed: ${message}`);
    throw new Error(`Failed to write model configuration to opencode.json: ${message}`);
  }

  // 2. Write skills and track actual status
  const results: OpenCodeBundleApplyResult[] = [];
  for (const planned of plan.skills) {
    const skillDir = join(planned.absolutePath, "..");
    if (!exists(skillDir)) {
      mkdir(skillDir, { recursive: true });
    }
    if (exists(planned.absolutePath)) {
      const existing = readFile(planned.absolutePath, "utf-8");
      if (existing !== planned.content) {
        writeFile(planned.absolutePath, planned.content, "utf-8");
        results.push({ agentId: planned.agent.id, kind: "skill" as const, status: "updated" as const, absolutePath: planned.absolutePath });
      } else {
        results.push({ agentId: planned.agent.id, kind: "skill" as const, status: "unchanged" as const, absolutePath: planned.absolutePath });
      }
    } else {
      writeFile(planned.absolutePath, planned.content, "utf-8");
      results.push({ agentId: planned.agent.id, kind: "skill" as const, status: "created" as const, absolutePath: planned.absolutePath });
    }
  }

  // 3. Write standalone skills (verbatim, no generated frontmatter)
  for (const planned of plan.standaloneSkills) {
    const skillDir = dirname(planned.absolutePath);
    if (!exists(skillDir)) {
      mkdir(skillDir, { recursive: true });
    }
    if (exists(planned.absolutePath)) {
      const existing = readFile(planned.absolutePath, "utf-8");
      if (existing !== planned.content) {
        writeFile(planned.absolutePath, planned.content, "utf-8");
        results.push({ agentId: planned.skillId, kind: "skill" as const, status: "updated" as const, absolutePath: planned.absolutePath });
      } else {
        results.push({ agentId: planned.skillId, kind: "skill" as const, status: "unchanged" as const, absolutePath: planned.absolutePath });
      }
    } else {
      writeFile(planned.absolutePath, planned.content, "utf-8");
      results.push({ agentId: planned.skillId, kind: "skill" as const, status: "created" as const, absolutePath: planned.absolutePath });
    }
  }

  for (const plugin of [plan.executionPlugin, plan.modelVariantsPlugin].filter((file): file is OpenCodePlannedExecutionPluginFile => !!file)) {
    const dir = dirname(plugin.absolutePath);
    mkdir(dir, { recursive: true });
    const existingContent = exists(plugin.absolutePath) ? readFile(plugin.absolutePath, "utf-8") : null;
    const status = existingContent === null ? "created" as const : existingContent === plugin.content ? "unchanged" as const : "updated" as const;
    if (status !== "unchanged") writeFile(plugin.absolutePath, plugin.content, "utf-8");
    results.push({ agentId: "developer-team-execution", kind: "plugin", status, absolutePath: plugin.absolutePath });
  }

  // 5. Write prompt files with idempotency
  for (const planned of plan.promptGenerationPlan) {
    const dir = dirname(planned.absolutePath);
    mkdir(dir, { recursive: true });
    const existingContent = exists(planned.absolutePath) ? readFile(planned.absolutePath, "utf-8") : null;
    if (existingContent === null) {
      writeFile(planned.absolutePath, planned.content, "utf-8");
      results.push({ agentId: planned.agent.id, kind: "prompt" as const, status: "created" as const, absolutePath: planned.absolutePath });
    } else if (existingContent !== planned.content) {
      writeFile(planned.absolutePath, planned.content, "utf-8");
      results.push({ agentId: planned.agent.id, kind: "prompt" as const, status: "updated" as const, absolutePath: planned.absolutePath });
    } else {
      results.push({ agentId: planned.agent.id, kind: "prompt" as const, status: "unchanged" as const, absolutePath: planned.absolutePath });
    }
  }

  // 5. Command generation is intentionally empty for Deck-owned installs.
  // Deck must not generate, write, or manage OpenCode `sdd-*` command files;
  // pre-existing user command files are left untouched.
  for (const planned of plan.commandGenerationPlan) {
    const dir = dirname(planned.absolutePath);
    mkdir(dir, { recursive: true });
    const existingContent = exists(planned.absolutePath) ? readFile(planned.absolutePath, "utf-8") : null;
    if (existingContent === null) {
      writeFile(planned.absolutePath, planned.content, "utf-8");
      results.push({ agentId: planned.commandId, kind: "command" as const, status: "created" as const, absolutePath: planned.absolutePath });
    } else if (existingContent !== planned.content) {
      writeFile(planned.absolutePath, planned.content, "utf-8");
      results.push({ agentId: planned.commandId, kind: "command" as const, status: "updated" as const, absolutePath: planned.absolutePath });
    } else {
      results.push({ agentId: planned.commandId, kind: "command" as const, status: "unchanged" as const, absolutePath: planned.absolutePath });
    }
  }

  // 6. Verify the promoted candidate.
  assertOpenCodeCandidateFiles(plan, exists, readFile);

  // Retire only files whose current bytes still match Deck ownership evidence.
  // Backup includes these paths so both failed apply and explicit rollback restore them.
  for (const file of retiredSkillFiles(plan)) unlink(file.absolutePath);

  // 7. Compute aggregate counts
  const changedCount = results.filter((r) => r.status !== "unchanged").length + (configMergeResult && configMergeResult.status !== "unchanged" ? 1 : 0);
  const unchangedCount = results.filter((r) => r.status === "unchanged").length + (configMergeResult && configMergeResult.status === "unchanged" ? 1 : 0);

  return { results, configMergeResult, changedCount, unchangedCount, fileResults: results };
  } catch (error) {
    rollbackDeveloperTeamFiles(fileBackup, { writeFile, unlink });
    if (previousConfig === null) {
      try { unlink(opencodeConfigPath); } catch { /* config was never promoted or already removed */ }
    } else {
      writeFile(opencodeConfigPath, previousConfig, "utf-8");
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Verify (for skill files only — opencode.json is managed by config merge)
// ---------------------------------------------------------------------------

export function verifyOpenCodeDeveloperTeamInstall(
  plan: OpenCodeDeveloperTeamInstallPlan,
  options?: { exists?: typeof existsSync; readFile?: typeof readFileSync },
): OpenCodeDeveloperTeamVerifyResult {
  const exists = options?.exists ?? existsSync;
  const readFile = options?.readFile ?? readFileSync;

  const skillResults: OpenCodeBundleVerifyResult[] = plan.skills.map((planned) => {
    const issues: string[] = [];

    if (!exists(planned.absolutePath)) {
      return { agentId: planned.agent.id, valid: false, issues: ["File does not exist."] };
    }

    const content = readFile(planned.absolutePath, "utf-8");

    if (!content.includes(`description:`)) {
      issues.push("Missing description field in frontmatter.");
    } else if (!content.includes(planned.agent.description)) {
      issues.push(`Description mismatch for skill ${planned.agent.skillId}.`);
    }

    if (!content.includes("disable-model-invocation: true")) {
      issues.push("Missing disable-model-invocation in frontmatter.");
    }

    if (!content.includes("user-invocable: false")) {
      issues.push("Missing user-invocable in frontmatter.");
    }
    if (!content.includes("delegate_only: true")) {
      issues.push("Missing delegate_only in metadata.");
    }

    const registryContent = getAgentContent(planned.agent.id, {
      capabilityInstructions: plan.capabilityInstructions,
      personality: plan.personality,
      promptProfile: plan.promptProfile,
    });
    if (registryContent) {
      const headingMatch = registryContent.skillBody.match(/^# .+$/m);
      if (headingMatch && !content.includes(headingMatch[0])) {
        issues.push(`Missing expected heading "${headingMatch[0]}".`);
      }
    }

    // Task 1: Exact-match check against planned.content (hardened verification)
    // Compare content byte-for-byte - any difference means stale/out-of-sync
    if (content !== planned.content) {
      issues.push(`Content mismatch for skill ${planned.agent.skillId}; installed file differs from planned content.`);
      // Log diagnostic details for debugging
      logMismatchDiagnostic(
        planned.agent.skillId,
        planned.absolutePath,
        content,
        planned.content,
      );
    }

    // Task 6: Verify orchestrator invariant presence
    // Only verify for orchestrator skill, not other agents
    if (planned.agent.id === "deck-lead") {
      const surface: OrchestratorInvariantSurface = "skill";
      const invariantCheck = verifyInvariantPresence(content, surface);
      if (!invariantCheck.pass) {
        for (const missingId of invariantCheck.missing) {
          issues.push(`Missing orchestrator invariant ${missingId} on skill surface.`);
        }
      }
    }

    return { agentId: planned.agent.id, valid: issues.length === 0, issues };
  });

  const standaloneResults: OpenCodeBundleVerifyResult[] = plan.standaloneSkills.map((planned) => {
    const issues: string[] = [];
    if (!exists(planned.absolutePath)) {
      return { agentId: planned.skillId, valid: false, issues: [`File does not exist: ${planned.packagePath}.`] };
    }
    const content = readFile(planned.absolutePath, "utf-8");
    if (content !== planned.content) {
      issues.push(`Content mismatch for standalone skill ${planned.skillId}/${planned.packagePath}; installed file differs from planned content.`);
      logMismatchDiagnostic(`${planned.skillId}/${planned.packagePath}`, planned.absolutePath, content, planned.content);
    }
    return { agentId: planned.skillId, valid: issues.length === 0, issues };
  });

  const pluginResults: OpenCodeBundleVerifyResult[] = [plan.executionPlugin, plan.modelVariantsPlugin].filter((file): file is OpenCodePlannedExecutionPluginFile => !!file).map(plugin => {
    const valid = exists(plugin.absolutePath) && readFile(plugin.absolutePath, "utf-8") === plugin.content;
    return { agentId: plugin.relativePath, valid, issues: valid ? [] : ["Managed plugin is missing or changed."] };
  });

  const promptResults: OpenCodeBundleVerifyResult[] = plan.promptGenerationPlan.map((planned) => {
    if (!exists(planned.absolutePath)) return { agentId: planned.agent.id, valid: false, issues: ["Prompt file does not exist."] };
    const content = readFile(planned.absolutePath, "utf-8");
    return { agentId: planned.agent.id, valid: content === planned.content, issues: content === planned.content ? [] : ["Prompt content mismatch."] };
  });
  const configResults: OpenCodeBundleVerifyResult[] = (() => {
    const configPath = join(dirname(plan.skillsDir), "opencode.json");
    if (!exists(configPath)) return [{ agentId: "opencode-config", valid: false, issues: ["opencode.json does not exist."] }];
    try {
      const config = JSON.parse(readFile(configPath, "utf-8")) as OpenCodeConfig;
      const missing = DEVELOPER_TEAM_AGENTS.filter((agent) => !config.agent?.[agent.id]).map((agent) => agent.id);

      const issues = [
        ...missing.map((agentId) => `Missing agent configuration: ${agentId}`),

      ];
      return [{ agentId: "opencode-config", valid: issues.length === 0, issues }];
    } catch {
      return [{ agentId: "opencode-config", valid: false, issues: ["opencode.json is invalid JSON."] }];
    }
  })();

  return {
    valid: skillResults.every((r) => r.valid) && standaloneResults.every((r) => r.valid) && pluginResults.every((r) => r.valid) && promptResults.every((r) => r.valid) && configResults.every((r) => r.valid),
    agentResults: [...promptResults, ...configResults],
    skillResults: [...skillResults, ...standaloneResults],
    pluginResults,
  };
}

// ---------------------------------------------------------------------------
// Backup (for skill files)
// ---------------------------------------------------------------------------

export type FileBackupEntry = {
  absolutePath: string;
  previousContent: string | null;
};

export type BackupManifest = {
  entries: FileBackupEntry[];
};

// ---------------------------------------------------------------------------
// Mismatch diagnostic helper (writes to /tmp/deck-debug.txt)
// ---------------------------------------------------------------------------

/**
 * Simple hash function using Node's crypto module.
 * Returns a short stable hash (SHA256, hex, first 16 chars).
 */
function simpleHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Append diagnostic info about content mismatch to debug log.
 * Only writes when mismatch actually occurs.
 */
function logMismatchDiagnostic(
  skillId: string,
  installedPath: string,
  actual: string,
  planned: string,
): void {
  // Calculate lengths and hashes
  const actualLen = actual.length;
  const plannedLen = planned.length;
  const actualHash = simpleHash(actual);
  const plannedHash = simpleHash(planned);

  // Find first differing index
  let firstDiffIdx: number | null = null;
  const minLen = Math.min(actualLen, plannedLen);
  for (let i = 0; i < minLen; i++) {
    if (actual[i] !== planned[i]) {
      firstDiffIdx = i;
      break;
    }
  }
  if (firstDiffIdx === null && actualLen !== plannedLen) {
    firstDiffIdx = minLen; // differs at length boundary
  }

  // Snippets around first difference (±30 chars)
  let actualSnippet = "";
  let plannedSnippet = "";
  if (firstDiffIdx !== null && firstDiffIdx >= 0) {
    const start = Math.max(0, firstDiffIdx - 30);
    const end = Math.min(firstDiffIdx + 30, minLen);
    const beforeStart = Math.max(0, firstDiffIdx - 10);
    actualSnippet = actual.slice(start, end);
    plannedSnippet = planned.slice(start, end);
    // Escape newlines for readability
    actualSnippet = actualSnippet.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    plannedSnippet = plannedSnippet.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  }

  // Normalized comparisons
  const actualNorm = actual.replace(/\r\n/g, "\n");
  const plannedNorm = planned.replace(/\r\n/g, "\n");
  const matchesNormalizedNewlines = actualNorm === plannedNorm;
  const matchesTrimEnd = actual.trimEnd() === planned.trimEnd();
  const matchesNormalizedTrimEnd = actualNorm.trimEnd() === plannedNorm.trimEnd();

  // Build diagnostic message
  const lines: string[] = [];
  lines.push(`[MISMATCH] skill=${skillId} path=${installedPath}`);
  lines.push(`  actualLen=${actualLen} plannedLen=${plannedLen} actualHash=${actualHash} plannedHash=${plannedHash}`);
  lines.push(`  firstDiffIdx=${firstDiffIdx === null ? "none" : firstDiffIdx}`);
  if (firstDiffIdx !== null) {
    lines.push(`  actualSnippet: "${actualSnippet}"`);
    lines.push(`  plannedSnippet: "${plannedSnippet}"`);
  }
  lines.push(`  matchesNormalizedNewlines=${matchesNormalizedNewlines}`);
  lines.push(`  matchesTrimEnd=${matchesTrimEnd}`);
  lines.push(`  matchesNormalizedTrimEnd=${matchesNormalizedTrimEnd}`);

  const msg = lines.join("\n");

  // Append to debug log (best-effort, silent failure)
  try {
    const fs = require("node:fs");
    fs.appendFileSync("/tmp/deck-debug.txt", msg + "\n");
  } catch {
    // Silently ignore — this is diagnostic-only
  }
}

function retiredSkillFiles(plan: OpenCodeDeveloperTeamInstallPlan): FileBackupEntry[] {
  const root = dirname(plan.skillsDir);
  const manifest = readRunnerContributions(join(root, "deck/manifest.json"));
  if (manifest?.runnerId !== "opencode" || manifest.root !== root) return [];
  const retired = join(plan.skillsDir, "test-driven-development", "SKILL.md");
  const receipt = manifest.contributions.find(entry => entry.path === retired && entry.selector.kind === "file");
  if (!receipt || !existsSync(retired)) return [];
  assertNoContributionSymlink(retired);
  const content = readFileSync(retired, "utf8");
  return contributionHash(content) === receipt.hash ? [{ absolutePath: retired, previousContent: content }] : [];
}

export function backupDeveloperTeamFiles(
  plan: OpenCodeDeveloperTeamInstallPlan,
  options?: { exists?: typeof existsSync; readFile?: (path: string, encoding: "utf-8") => string },
): BackupManifest {
  const exists = options?.exists ?? existsSync;
  const readFile = options?.readFile ?? readFileSync;

  const entries: FileBackupEntry[] = [
    ...retiredSkillFiles(plan),
    ...plan.skills.map((planned) => {
      if (exists(planned.absolutePath)) {
        return { absolutePath: planned.absolutePath, previousContent: readFile(planned.absolutePath, "utf-8") };
      }
      return { absolutePath: planned.absolutePath, previousContent: null };
    }),
    ...plan.standaloneSkills.map((planned) => {
      if (exists(planned.absolutePath)) {
        return { absolutePath: planned.absolutePath, previousContent: readFile(planned.absolutePath, "utf-8") };
      }
      return { absolutePath: planned.absolutePath, previousContent: null };
    }),
    ...[plan.executionPlugin, plan.modelVariantsPlugin].filter((file): file is OpenCodePlannedExecutionPluginFile => !!file).map(plugin => ({
      absolutePath: plugin.absolutePath,
      previousContent: exists(plugin.absolutePath) ? readFile(plugin.absolutePath, "utf-8") : null,
    })),
    ...plan.promptGenerationPlan.map((planned) => ({
      absolutePath: planned.absolutePath,
      previousContent: exists(planned.absolutePath) ? readFile(planned.absolutePath, "utf-8") : null,
    })),
  ];

  return { entries };
}

// ---------------------------------------------------------------------------
// Rollback (for skill files)
// ---------------------------------------------------------------------------

export function rollbackDeveloperTeamFiles(
  backup: BackupManifest,
  options?: { writeFile?: typeof writeFileSync; unlink?: typeof unlinkSync },
): void {
  const writeFile = options?.writeFile ?? writeFileSync;
  const unlink = options?.unlink ?? unlinkSync;

  for (const entry of backup.entries) {
    if (entry.previousContent === null) {
      try {
        unlink(entry.absolutePath);
      } catch {
        // ignore
      }
    } else {
      writeFile(entry.absolutePath, entry.previousContent, "utf-8");
    }
  }
}

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import type { DeveloperTeamAgent } from "@deck/core/teams/developer/catalog";
import {
  buildCapabilityInstructionBundle,
  getEnabledPackageInstructionIds,
} from "@deck/core/teams/developer/instruction-bundles";
import {
  composeAdaptiveMemory,
  resolveMemoryInjection,
  type AdaptiveMemoryCompositionResult,
  type AdaptiveMemoryProvider,
  type MemoryDiagnostic as CoreMemoryDiagnostic,
  type MemoryInjectionBundle,
  type MemoryToolBinding,
} from "@deck/core/memory/adaptive-memory";
import { getAgentContent } from "@deck/core/teams/developer/content-registry";
import type { CapabilityInstructionBundle } from "@deck/core";

import { buildPromptGenerationPlan, applyPromptGeneration, buildPromptReference } from "./prompt-generation";
import { buildCommandGenerationPlan, applyCommandGeneration } from "./command-generation";
import { mergeAndWrite } from "./config-merge";
import { resolveModelConfig, DEFAULT_OPENCODE_MODELS } from "./model-config";
import { detectMermaidPluginStatus, INTERNAL_OPENCODE_PACKAGE_IDS } from "./internal-opencode-packages";
import type { AgentEntry, OpenCodeConfig } from "./types";

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
  memoryDiagnostics: MemoryDiagnostic[];
  /** Agent entries for opencode.json config merge */
  agentEntries: Record<string, AgentEntry>;
  promptGenerationPlan: ReturnType<typeof buildPromptGenerationPlan>;
  commandGenerationPlan: ReturnType<typeof buildCommandGenerationPlan>;
  mermaidPluginStatus: "ready" | "missing";
  /** Captured capability instruction bundle for verify reconciliation */
  capabilityInstructions?: CapabilityInstructionBundle;
};

export type OpenCodeBundleApplyResult = {
  agentId: string;
  kind: "agent" | "skill";
  status: "created" | "unchanged" | "updated";
};

export type OpenCodeDeveloperTeamApplyResult = {
  results: OpenCodeBundleApplyResult[];
  configMergeResult?: {
    status: "created" | "updated" | "unchanged";
    backupPath: string;
    pluginsAdded: string[];
  };
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
};

/** Re-export MemoryDiagnostic from core for backward compatibility. */
export type MemoryDiagnostic = CoreMemoryDiagnostic;

const SUPPORTED_OPENCODE_MEMORY_PROVIDER_IDS = ["engram", "supermemory"] as const;

/** Options for memory injection during OpenCode Developer Team install. */
export type MemoryInjectionOptions = {
  /** A pre-built memory injection bundle (takes precedence over provider). */
  memoryInjection?: MemoryInjectionBundle;
  /** A memory provider that will build the injection bundle. Ignored if memoryInjection is set. */
  memoryProvider?: AdaptiveMemoryProvider;
  /** Provider IDs accepted by this adapter/caller registry. */
  supportedMemoryProviderIds?: Iterable<string>;
  /**
   * Pre-built capability instruction bundle. When provided, the bundle's
   * fragments are composed into skill content via the content registry.
   */
  capabilityInstructions?: CapabilityInstructionBundle;
  /**
   * Standalone skill definitions to include in the install plan.
   * When provided, these skills are written as-is (verbatim) to .opencode/skills/{skillId}/SKILL.md
   * without generating agent-bound frontmatter.
   */
  standaloneSkills?: readonly { skillId: string; body: string }[];
};

// ---------------------------------------------------------------------------
// Memory injection resolution (delegated to core)
// ---------------------------------------------------------------------------

function resolveOpenCodeMemoryInjection(
  options?: MemoryInjectionOptions,
): { bundle: MemoryInjectionBundle | undefined; diagnostics: MemoryDiagnostic[] } {
  return resolveMemoryInjection({
    memoryInjection: options?.memoryInjection,
    memoryProvider: options?.memoryProvider,
    supportedProviderIds: options?.supportedMemoryProviderIds ?? SUPPORTED_OPENCODE_MEMORY_PROVIDER_IDS,
    buildContext: { teamId: "developer-team" },
  });
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** Tools available to all subagents */
const SUBAGENT_TOOLS: Record<string, boolean> = {
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
  options?: { cliModelOverride?: string; configModelOverrides?: Record<string, string>; reasoningEffortOverrides?: Record<string, import("./model-config").OpenCodeThinkingLevel> },
): AgentEntry {
  const isOrchestrator = agent.id === "deck-developer-orchestrator";
  const modelConfig = resolveModelConfig(agent.id, options?.cliModelOverride, options?.configModelOverrides, options?.reasoningEffortOverrides);

  const entry: AgentEntry = {
    description: agent.description,
    mode: isOrchestrator ? "primary" : "subagent",
    model: modelConfig.model,
    prompt: promptReference,
    tools: isOrchestrator ? ORCHESTRATOR_TOOLS : SUBAGENT_TOOLS,
  };

  if (modelConfig.reasoningEffort) {
    entry.reasoningEffort = modelConfig.reasoningEffort;
  }

  if (isOrchestrator) {
    // Orchestrator: deny-by-default + allowlist all subagents
    const subagents = DEVELOPER_TEAM_AGENTS.filter((a) => a.id !== "deck-developer-orchestrator");
    const permissionTask: Record<string, string> = {
      "*": "deny",
      ...Object.fromEntries(subagents.map((a) => [a.id, "allow"])),
    };
    entry.permission = { task: permissionTask };
    entry.hidden = false;
    entry.variant = "";
  } else {
    // Subagents: hidden
    entry.hidden = true;
    entry.variant = "";
  }

  return entry;
}

// ---------------------------------------------------------------------------
// Skill file content builder
// ---------------------------------------------------------------------------

function buildSkillFileContent(
  agent: DeveloperTeamAgent,
  memoryBundle?: MemoryInjectionBundle,
  capabilityInstructions?: CapabilityInstructionBundle,
): string {
  const content = getAgentContent(agent.id, capabilityInstructions ? { capabilityInstructions } : undefined);
  if (!content) {
    throw new Error(`No content found for agent ${agent.id} in core registry.`);
  }

  const skillResult = memoryBundle
    ? composeAdaptiveMemory(content.skillBody, memoryBundle, {
        surface: "skill",
        teamId: "developer-team",
        skillId: agent.skillId,
      })
    : { content: content.skillBody, toolBindings: [] as readonly MemoryToolBinding[] };

  return [
    "---",
    `name: ${agent.skillId}`,
    `description: "${agent.description}"`,
    "disable-model-invocation: true",
    "user-invocable: false",
    "license: MIT",
    "metadata:",
    "  author: gentleman-programming",
    '  version: "3.0"',
    "  delegate_only: true",
    "---",
    "",
    skillResult.content,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export function buildOpenCodeDeveloperTeamInstallPlan(
  projectRoot: string,
  options?: MemoryInjectionOptions & {
    configDir?: string;
    cliModelOverride?: string;
    configModelOverrides?: Record<string, string>;
    reasoningEffortOverrides?: Record<string, import("./model-config").OpenCodeThinkingLevel>;
  },
): OpenCodeDeveloperTeamInstallPlan {
  const configDir = options?.configDir ?? join(process.env.HOME ?? "/home/user", ".config", "opencode");
  const agentsDir = join(projectRoot, ".opencode", "agents");
  const skillsDir = join(projectRoot, ".opencode", "skills");

  const { bundle: memoryBundle, diagnostics: memoryDiagnostics } = resolveOpenCodeMemoryInjection(options);

  const capabilityInstructions = options?.capabilityInstructions;

  // Build agent entries for opencode.json
  const agentEntries: Record<string, AgentEntry> = {};
  for (const agent of DEVELOPER_TEAM_AGENTS) {
    const promptReference = buildPromptReference(configDir, agent.id);
    agentEntries[agent.id] = buildAgentEntry(agent, promptReference, {
      cliModelOverride: options?.cliModelOverride,
      configModelOverrides: options?.configModelOverrides,
      reasoningEffortOverrides: options?.reasoningEffortOverrides,
    });
  }

  // Build skill files
  const skills: OpenCodePlannedSkillFile[] = DEVELOPER_TEAM_AGENTS.map((agent) => {
    const relativePath = `.opencode/skills/${agent.skillId}/SKILL.md`;
    const absolutePath = join(projectRoot, relativePath);
    const content = buildSkillFileContent(agent, memoryBundle, capabilityInstructions);
    return { agent, relativePath, absolutePath, content };
  });

  // Build standalone skill files (verbatim, no generated frontmatter)
  const standaloneSkills: OpenCodePlannedStandaloneSkillFile[] = (options?.standaloneSkills ?? []).map((skill) => {
    const relativePath = `.opencode/skills/${skill.skillId}/SKILL.md`;
    const absolutePath = join(projectRoot, relativePath);
    return { skillId: skill.skillId, relativePath, absolutePath, content: skill.body };
  });

  // Prompt generation plan
  const promptGenerationPlan = buildPromptGenerationPlan({ configDir, projectRoot, capabilityInstructions });

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
    memoryDiagnostics,
    agentEntries,
    promptGenerationPlan,
    commandGenerationPlan,
    mermaidPluginStatus,
    capabilityInstructions,
  };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

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
  const configDir = options?.configDir ?? join(process.env.HOME ?? "/home/user", ".config", "opencode");
  const opencodeConfigPath = join(configDir, "opencode.json");

  // 1. Config merge (agents + mermaid plugin)
  const mermaidPlugins = INTERNAL_OPENCODE_PACKAGE_IDS.filter(() => plan.mermaidPluginStatus === "missing");

  let configMergeResult: OpenCodeDeveloperTeamApplyResult["configMergeResult"];
  try {
    const mergeResult = mergeAndWrite({
      configPath: opencodeConfigPath,
      agentEntries: plan.agentEntries,
      pluginsToAdd: mermaidPlugins,
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
        results.push({ agentId: planned.agent.id, kind: "skill" as const, status: "updated" as const });
      } else {
        results.push({ agentId: planned.agent.id, kind: "skill" as const, status: "unchanged" as const });
      }
    } else {
      writeFile(planned.absolutePath, planned.content, "utf-8");
      results.push({ agentId: planned.agent.id, kind: "skill" as const, status: "created" as const });
    }
  }

  // 3. Write standalone skills (verbatim, no generated frontmatter)
  for (const planned of plan.standaloneSkills) {
    const skillDir = join(planned.absolutePath, "..");
    if (!exists(skillDir)) {
      mkdir(skillDir, { recursive: true });
    }
    if (exists(planned.absolutePath)) {
      const existing = readFile(planned.absolutePath, "utf-8");
      if (existing !== planned.content) {
        writeFile(planned.absolutePath, planned.content, "utf-8");
        results.push({ agentId: planned.skillId, kind: "skill" as const, status: "updated" as const });
      } else {
        results.push({ agentId: planned.skillId, kind: "skill" as const, status: "unchanged" as const });
      }
    } else {
      writeFile(planned.absolutePath, planned.content, "utf-8");
      results.push({ agentId: planned.skillId, kind: "skill" as const, status: "created" as const });
    }
  }

  // 3. Write prompt files
  applyPromptGeneration(plan.promptGenerationPlan, {
    writeFile: writeFile as (path: string, content: string, encoding: "utf-8") => void,
    mkdir: mkdir as (path: string, opts: { recursive: true }) => void,
  });

  // 4. Write command files
  applyCommandGeneration(plan.commandGenerationPlan, {
    writeFile: writeFile as (path: string, content: string, encoding: "utf-8") => void,
    mkdir: mkdir as (path: string, opts: { recursive: true }) => void,
  });

  return { results, configMergeResult };
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

    const registryContent = getAgentContent(planned.agent.id, plan.capabilityInstructions ? { capabilityInstructions: plan.capabilityInstructions } : undefined);
    if (registryContent) {
      const headingMatch = registryContent.skillBody.match(/^# .+$/m);
      if (headingMatch && !content.includes(headingMatch[0])) {
        issues.push(`Missing expected heading "${headingMatch[0]}".`);
      }
    }

    return { agentId: planned.agent.id, valid: issues.length === 0, issues };
  });

  return {
    valid: skillResults.every((r) => r.valid),
    agentResults: [],
    skillResults,
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

export function backupDeveloperTeamFiles(
  plan: OpenCodeDeveloperTeamInstallPlan,
  options?: { exists?: typeof existsSync; readFile?: (path: string, encoding: "utf-8") => string },
): BackupManifest {
  const exists = options?.exists ?? existsSync;
  const readFile = options?.readFile ?? readFileSync;

  const entries: FileBackupEntry[] = plan.skills.map((planned) => {
    if (exists(planned.absolutePath)) {
      return { absolutePath: planned.absolutePath, previousContent: readFile(planned.absolutePath, "utf-8") };
    }
    return { absolutePath: planned.absolutePath, previousContent: null };
  });

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
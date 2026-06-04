import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import type { DeveloperTeamAgent } from "@deck/core/teams/developer/catalog";
import {
  buildCapabilityInstructionBundle,
  buildCapabilityToolPolicyBundle,
  getEnabledPackageInstructionIds,
} from "@deck/core/teams/developer/instruction-bundles";
// import { verifyOrchestratorInvariantPresence, type OrchestratorInvariantSurface } from "@deck/core/teams/developer/orchestrator-invariants";

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

  const hasHeader = /^## Orchestrator Invariants$/m.test(content);
  if (!hasHeader) {
    return { pass: false, missing: criticalIds };
  }

  for (const id of criticalIds) {
    if (!content.includes(id)) {
      missing.push(id);
    }
  }

  return { pass: missing.length === 0, missing };
}
import {
  composeAdaptiveMemory,
  resolveMemoryInjection,
  type AdaptiveMemoryCompositionResult,
  type AdaptiveMemoryProvider,
  type MemoryDiagnostic as CoreMemoryDiagnostic,
  type MemoryInjectionBundle,
  type MemoryToolBinding,
} from "@deck/core/memory/adaptive-memory";
import { type ModificationAuthorization } from "../../core/src/teams/developer/orchestrator-invariants";
import { getAgentContent } from "@deck/core/teams/developer/content-registry";
import { readDeckConfig } from "@deck/core/config/deck-config";
import { DEFAULT_ORCHESTRATOR_PERSONALITY, type OrchestratorPersonality } from "@deck/core/config/deck-config";
import type { CapabilityInstructionBundle } from "@deck/core";

import { buildPromptGenerationPlan, applyPromptGeneration, buildPromptReference } from "./prompt-generation";
import { buildCommandGenerationPlan, applyCommandGeneration } from "./command-generation";
import { mergeAndWrite } from "./config-merge";
import { resolveModelConfig, DEFAULT_OPENCODE_MODELS } from "./model-config";
import { detectMermaidPluginStatus, INTERNAL_OPENCODE_PACKAGE_IDS } from "./internal-opencode-packages";
import { validateSupermemoryOpenCodeMcpConfig } from "./opencode-mcp-config";
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
  /** Memory injection bundle resolved from provider or pre-built injection. */
  memoryBundle?: MemoryInjectionBundle;
  /** Resolved orchestrator personality used during plan construction */
  personality?: OrchestratorPersonality;
};

export type OpenCodeBundleApplyResult = {
  agentId: string;
  kind: "agent" | "skill" | "prompt" | "command";
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

/**
 * Validated memory providers and their expected tool names.
 * Used for provider/tool binding validation during install.
 */
const VALIDATED_MEMORY_PROVIDERS: Record<string, readonly string[]> = {
  // SupercodeMemory MCP-only: tools documented in MCP v4
  supermemory: ["memory", "recall", "whoAmI"],
  // Engram: tools from Engram adapter
  engram: ["memory", "recall", "listProjects", "whoAmI"],
};

/**
 * Validates provider/tool bindings from memory bundle.
 * Returns diagnostics for any invalid or missing tool bindings.
 * This is a fail-open validation — it logs diagnostics but doesn't block.
 */
function validateMemoryBundleTools(
  bundle: MemoryInjectionBundle | undefined,
  providerId?: string,
): MemoryDiagnostic[] {
  const diagnostics: MemoryDiagnostic[] = [];

  if (!bundle) {
    return diagnostics; // No bundle = no validation needed (fail-open)
  }

  // Validate toolBindings exist and contain expected tools
  const toolBindings = bundle.toolBindings;
  if (!toolBindings || toolBindings.length === 0) {
    // Empty toolBindings is acceptable for "none" provider scenario
    return diagnostics;
  }

  // If provider ID known, validate against expected tools
  if (providerId && VALIDATED_MEMORY_PROVIDERS[providerId]) {
    const expectedTools = VALIDATED_MEMORY_PROVIDERS[providerId];
    const providedTools = new Set<string>();

    for (const binding of toolBindings) {
      for (const tool of binding.toolNames) {
        providedTools.add(tool);
      }
    }

    // Check for known obsolete tools (shouldn't happen but defensive check)
    const obsoleteTools = ["execute", "search_docs"];
    for (const obs of obsoleteTools) {
      if (providedTools.has(obs)) {
        diagnostics.push({
          code: "unsupported_memory_provider",
          message: `Obsolete tool '${obs}' found in memory binding. Expected MCP tools: ${expectedTools.join(", ")}`,
          providerId,
          details: { observedTool: obs, expectedTools },
        });
      }
    }
  }

  return diagnostics;
}

function resolveOpenCodeMemoryInjection(
  options?: MemoryInjectionOptions,
  configDir?: string,
): { bundle: MemoryInjectionBundle | undefined; diagnostics: MemoryDiagnostic[] } {
  const result = resolveMemoryInjection({
    memoryInjection: options?.memoryInjection,
    memoryProvider: options?.memoryProvider,
    supportedProviderIds: options?.supportedMemoryProviderIds ?? SUPPORTED_OPENCODE_MEMORY_PROVIDER_IDS,
    buildContext: { teamId: "developer-team" },
  });

  const { bundle: memoryBundle, diagnostics } = result;

  // Validate tool bindings from the provider (fail-open)
  // Determine provider ID from options or infer from bundle
  let providerId: string | undefined;
  if (options?.memoryProvider) {
    providerId = options.memoryProvider.id;
  } else if (memoryBundle && memoryBundle.toolBindings.length > 0) {
    // Infer from tool names as fallback
    const toolNames = new Set<string>();
    for (const b of memoryBundle.toolBindings) {
      for (const t of b.toolNames) toolNames.add(t);
    }
    if (toolNames.has("memory") && toolNames.has("recall")) {
      providerId = "supermemory";
    } else if (toolNames.has("listProjects")) {
      providerId = "engram";
    }
  }

  // Add validation diagnostics
  const validationDiags = validateMemoryBundleTools(memoryBundle, providerId);
  const allDiagnostics = [...diagnostics, ...validationDiags];

  return { bundle: memoryBundle, diagnostics: allDiagnostics };
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

/**
 * Get target agents from tool policy bundle.
 * Returns apply agents list from policy, falls back to empty array if no serena policy.
 */
function getTargetAgentsFromPolicy(
  toolPolicyBundle?: ReturnType<typeof buildCapabilityToolPolicyBundle>,
): readonly string[] {
  return toolPolicyBundle?.policies?.serena?.targetAgents ?? [];
}

/**
 * Build Serena tools dict from tool policy.
 * Returns a Record<string, boolean> from policy.enabledTools, or empty if no serena policy.
 */
function buildSerenaToolsDict(
  toolPolicyBundle?: ReturnType<typeof buildCapabilityToolPolicyBundle>,
): Record<string, boolean> {
  const enabledTools = toolPolicyBundle?.policies?.serena?.enabledTools;
  if (!enabledTools || enabledTools.length === 0) {
    return {};
  }
  return Object.fromEntries(enabledTools.map((t) => [t, true])) as Record<string, boolean>;
}

/**
 * Resolve Serena tools for a specific agent based on role.
 * Non-apply agents get only read-only tools.
 * Apply agents get read-only + write tools.
 */
function resolveSerenaToolsForAgent(
  agentId: string,
  toolPolicyBundle?: ReturnType<typeof buildCapabilityToolPolicyBundle>,
): Record<string, boolean> {
  const policy = toolPolicyBundle?.policies?.serena;
  if (!policy) {
    return {};
  }

  const isApplyAgent = policy.targetAgents.includes(agentId as "deck-developer-apply-backend" | "deck-developer-apply-frontend" | "deck-developer-apply-general");
  const readOnly = policy.readOnlyTools ?? [];
  const write = policy.writeTools ?? [];

  let allowedTools: string[];
  if (isApplyAgent) {
    // Apply agents get both read-only and write tools
    allowedTools = [...readOnly, ...write];
  } else {
    // Non-apply agents get only read-only tools
    allowedTools = [...readOnly];
  }

  return Object.fromEntries(allowedTools.map((t) => [t, true])) as Record<string, boolean>;
}

function buildAgentEntry(
  agent: DeveloperTeamAgent,
  promptReference: string,
  toolPolicyBundle?: ReturnType<typeof buildCapabilityToolPolicyBundle>,
  options?: { cliModelOverride?: string; configModelOverrides?: Record<string, string>; reasoningEffortOverrides?: Record<string, string> },
): AgentEntry {
  const isOrchestrator = agent.id === "deck-developer-orchestrator";
  const serenaTools = resolveSerenaToolsForAgent(agent.id, toolPolicyBundle);
  const modelConfig = resolveModelConfig(agent.id, options?.cliModelOverride, options?.configModelOverrides, options?.reasoningEffortOverrides as Record<string, "off" | "low" | "medium" | "high"> | undefined);

  let tools: Record<string, boolean>;

  if (isOrchestrator) {
    tools = ORCHESTRATOR_TOOLS;
  } else if (Object.keys(serenaTools).length > 0) {
    // Combine base + Serena tools (role-based: read-only for non-apply, read+write for apply)
    tools = { ...SUBAGENT_BASE_TOOLS, ...serenaTools };
  } else {
    // Default: base tools only
    tools = SUBAGENT_BASE_TOOLS;
  }

  const entry: AgentEntry = {
    description: agent.description,
    mode: isOrchestrator ? "primary" : "subagent",
    model: modelConfig.model,
    prompt: promptReference,
    tools,
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
  personality?: OrchestratorPersonality,
): string {
  const content = getAgentContent(agent.id, capabilityInstructions ? { capabilityInstructions, personality } : { personality });
  if (!content) {
    throw new Error(`No content found for agent ${agent.id} in core registry.`);
  }

  // Skip adaptive memory injection for skill files - only apply to agent prompts
  // The installed skill files DON'T have adaptive memory sections, so planned content must match
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

export function buildOpenCodeDeveloperTeamInstallPlan(
  projectRoot: string,
  options?: MemoryInjectionOptions & {
    configDir?: string;
    cliModelOverride?: string;
    configModelOverrides?: Record<string, string>;
    reasoningEffortOverrides?: Record<string, string>;
    /** Optional personality override; when absent, reads from .deck/config.json */
    personality?: OrchestratorPersonality;
    /**
     * Optional modification authorization for apply agents.
     * When provided, authorization card is injected into apply-agent prompts (REQ-OA-005).
     * This enables runtime authorization card injection during install-time prompt generation.
     */
    authorization?: ModificationAuthorization;
  },
): OpenCodeDeveloperTeamInstallPlan {
  const configDir = options?.configDir ?? join(process.env.HOME ?? "/home/user", ".config", "opencode");
  const agentsDir = join(configDir, "agents");
  const skillsDir = join(configDir, "skills");

  const { bundle: memoryBundle, diagnostics: memoryDiagnostics } = resolveOpenCodeMemoryInjection(options, configDir);

  const capabilityInstructions = options?.capabilityInstructions;

  // Build tool policies from capability instructions for dynamic tool resolution
  const toolPolicyBundle =
    capabilityInstructions && capabilityInstructions.instructions.length > 0
      ? buildCapabilityToolPolicyBundle(
          capabilityInstructions.instructions.map((f) => f.packageId) as Parameters<typeof buildCapabilityToolPolicyBundle>[0],
        )
      : undefined;

  // Resolve personality: use explicit option or read from config
  const resolvedPersonality: OrchestratorPersonality = options?.personality ?? (() => {
    try {
      const config = readDeckConfig(projectRoot);
      return config.orchestratorPersonality;
    } catch {
      return DEFAULT_ORCHESTRATOR_PERSONALITY;
    }
  })();

  // Build agent entries for opencode.json
  const agentEntries: Record<string, AgentEntry> = {};
  for (const agent of DEVELOPER_TEAM_AGENTS) {
    const promptReference = buildPromptReference(configDir, agent.id);
    agentEntries[agent.id] = buildAgentEntry(agent, promptReference, toolPolicyBundle, {
      cliModelOverride: options?.cliModelOverride,
      configModelOverrides: options?.configModelOverrides,
      reasoningEffortOverrides: options?.reasoningEffortOverrides,
    });
  }

  // Build skill files
  const skills: OpenCodePlannedSkillFile[] = DEVELOPER_TEAM_AGENTS.map((agent) => {
    const relativePath = `skills/${agent.skillId}/SKILL.md`;
    const absolutePath = join(skillsDir, agent.skillId, "SKILL.md");
    const content = buildSkillFileContent(agent, memoryBundle, capabilityInstructions, resolvedPersonality);
    return { agent, relativePath, absolutePath, content };
  });

  // Build standalone skill files (verbatim, no generated frontmatter)
  // Validate skillId to prevent path traversal attacks
  const standaloneSkills: OpenCodePlannedStandaloneSkillFile[] = (options?.standaloneSkills ?? []).map((skill) => {
    if (!/^[a-z0-9_-]+$/i.test(skill.skillId)) {
      throw new Error(`Invalid skillId "${skill.skillId}": must contain only alphanumeric characters, underscores, and hyphens`);
    }
    const relativePath = `skills/${skill.skillId}/SKILL.md`;
    const absolutePath = join(skillsDir, skill.skillId, "SKILL.md");
    return { skillId: skill.skillId, relativePath, absolutePath: join(skillsDir, skill.skillId, "SKILL.md"), content: skill.body };
  });

  // Prompt generation plan - pass memoryBundle for provider-specific adaptive memory injection
  // This ensures provider isolation and OpenSpec authority are maintained
  // REQ-OA-005: Pass authorization to enable runtime authorization card injection
  const promptGenerationPlan = buildPromptGenerationPlan({
    configDir,
    projectRoot,
    capabilityInstructions,
    personality: resolvedPersonality,
    memoryBundle,
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
    memoryDiagnostics,
    agentEntries,
    promptGenerationPlan,
    commandGenerationPlan,
    mermaidPluginStatus,
    capabilityInstructions,
    memoryBundle,
    personality: resolvedPersonality,
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
    const skillDir = join(planned.absolutePath, "..");
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

  // 5. Write command files with idempotency
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

  // 6. Compute aggregate counts
  const changedCount = results.filter((r) => r.status !== "unchanged").length + (configMergeResult && configMergeResult.status !== "unchanged" ? 1 : 0);
  const unchangedCount = results.filter((r) => r.status === "unchanged").length + (configMergeResult && configMergeResult.status === "unchanged" ? 1 : 0);

  return { results, configMergeResult, changedCount, unchangedCount, fileResults: results };
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

    // deck-onboard is user-invocable: true, others are user-invocable: false
    if (planned.agent.skillId === "deck-onboard") {
      if (!content.includes("user-invocable: true")) {
        issues.push("Missing user-invocable in frontmatter.");
      }
      // deck-onboard should NOT have delegate_only
      if (content.includes("delegate_only: true")) {
        issues.push("Unexpected delegate_only in deck-onboard (should be user-invocable, not delegated).");
      }
    } else {
      if (!content.includes("user-invocable: false")) {
        issues.push("Missing user-invocable in frontmatter.");
      }
      if (!content.includes("delegate_only: true")) {
        issues.push("Missing delegate_only in metadata.");
      }
    }

    const registryContent = getAgentContent(planned.agent.id, {
      capabilityInstructions: plan.capabilityInstructions,
      personality: plan.personality,
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
    if (planned.agent.id === "deck-developer-orchestrator") {
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

export function backupDeveloperTeamFiles(
  plan: OpenCodeDeveloperTeamInstallPlan,
  options?: { exists?: typeof existsSync; readFile?: (path: string, encoding: "utf-8") => string },
): BackupManifest {
  const exists = options?.exists ?? existsSync;
  const readFile = options?.readFile ?? readFileSync;

  const entries: FileBackupEntry[] = [
    ...plan.skills.map((planned) => {
      if (exists(planned.absolutePath)) {
        return { absolutePath: planned.absolutePath, previousContent: readFile(planned.absolutePath, "utf-8") };
      }
      return { absolutePath: planned.absolutePath, previousContent: null };
    }),
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
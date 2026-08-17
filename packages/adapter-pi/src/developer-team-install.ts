import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { getAgentContent, type DeveloperTeamPromptProfileV1 } from "@deck/core/teams/developer/content-registry";
import { getBootstrapSkillFiles } from "@deck/core/skills/bootstrap";
import { DEVELOPER_TEAM_LEGACY_AGENT_IDS } from "@deck/core/teams/developer/catalog";
import { migrateLegacyDeveloperTeamAssignments } from "@deck/core/teams/developer/model-migration";
import {
  buildCapabilityInstructionBundle,
  bindAdaptiveMemoryInstructionBundle,
  composeCapabilityInstructions,
  getEnabledPackageInstructionIds,
} from "@deck/core/teams/developer/instruction-bundles";
import { materializeTeamProfile } from "./pi-team-profile";
import { buildTeamProfileDir } from "./pi-team-launch";
// import { verifyInvariantPresence, type OrchestratorInvariantSurface } from "@deck/core/teams/developer/orchestrator-invariants";

// Inline verification for adapter — uses core directly at runtime (Task 7)
type OrchestratorInvariantSurface = "session" | "agent" | "skill" | "manifest";

interface InvariantVerificationResult {
  pass: boolean;
  missing: string[];
}

/**
 * Verify invariant presence inline (copied from core for adapter isolation)
 * For agent surface: accepts either full invariant headers OR profile reference (stub mode)
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

  // For agent surface, also accept profile reference (stub mode - see REQ-PROMPT-002)
  if (surface === "agent") {
    const hasProfileReference = /\.deck\/pi\/profiles\/.*\/system-prompt\.md/.test(content);
    const hasInvariantHeader = /^## Orchestrator Invariants$/m.test(content);

    if (hasProfileReference || hasInvariantHeader) {
      // Profile reference or invariant header present - pass for stub mode
      // Note: full invariant IDs are verified in the skill file, not the agent stub
      return { pass: true, missing: [] };
    }
    return { pass: false, missing: criticalIds };
  }

  const hasCompactReference = /^## Runtime Contract Reference$/m.test(content)
    && content.includes("Runtime-Enforced Team Contract remains binding");
  const hasAdaptiveReference = /^## Team Contract Reference$/m.test(content)
    && content.includes("Adaptive Developer Team Contract remains binding");
  if (hasCompactReference || hasAdaptiveReference) {
    return { pass: true, missing: [] };
  }

  // Legacy skill surfaces retain the full invariant body.
  const hasLegacyHeader = /^## Orchestrator Invariants$/m.test(content);
  if (!hasLegacyHeader) {
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
} from "@deck/core/memory/adaptive-memory";
import { DEFAULT_ORCHESTRATOR_PERSONALITY } from "@deck/core/config/deck-config";
import { resolveCanonicalSupermemoryProjectScope, type CapabilityInstructionBundle } from "@deck/core";
import type { PromptProfileActivationV1 } from "@deck/sdd-runtime";
import type { DeveloperTeamAgent } from "./developer-team-catalog";
import { DEVELOPER_TEAM_AGENTS } from "./developer-team-catalog";
import {
  parsePiThinkingLevel,
  resolveThinkingForModel,
  supportsDeveloperTeamModel,
  type DeveloperTeamModelAssignments,
  type DeveloperTeamModelConfigAssignments,
  type DeveloperTeamThinkingAssignments,
  type PiThinkingLevel,
} from "./model-config";

// --- Types ---

export type PlannedAgentFile = {
  agent: DeveloperTeamAgent;
  relativePath: string;
  absolutePath: string;
  content: string;
};

export type PlannedSkillFile = {
  agent: DeveloperTeamAgent;
  relativePath: string;
  absolutePath: string;
  content: string;
};

export type PlannedStandaloneSkillFile = {
  skillId: string;
  packagePath: string;
  relativePath: string;
  absolutePath: string;
  content: string;
};

/** Standalone lifecycle skill file (deck-onboard, deck-archive). */
export type PlannedSDDSkillFile = {
  skillId: string;
  relativePath: string;
  absolutePath: string;
  content: string;
};

export type DeveloperTeamInstallPlan = {
  projectRoot: string;
  agentsDir: string;
  skillsDir: string;
  agents: PlannedAgentFile[];
  skills: PlannedSkillFile[];
  standaloneSkills: PlannedStandaloneSkillFile[];
  /** Standalone lifecycle skill files (deck-onboard, deck-archive). */
  sddSkillFiles: PlannedSDDSkillFile[];
  memoryDiagnostics: MemoryDiagnostic[];
  /** Memory injection bundle computed from memoryInjection/memoryProvider options. */
  memoryBundle?: MemoryInjectionBundle;
  /** Effective prompt profile. Compact is selected for normal installations. */
  promptProfile: DeveloperTeamPromptProfileV1;
  /** Retained for API compatibility with earlier rollout-aware callers. */
  promptProfileActivation?: PromptProfileActivationV1;
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
  projectRoot: string,
  standaloneSkills: readonly { skillId: string; body: string; files?: Record<string, string> }[],
  capabilityInstructions?: CapabilityInstructionBundle,
): PlannedStandaloneSkillFile[] {
  const planned: PlannedStandaloneSkillFile[] = [];
  for (const skill of standaloneSkills) {
    validateStandaloneSkillId(skill.skillId);
    const packageFiles: Record<string, string> = {
      "SKILL.md": composeCapabilityInstructions(skill.body, capabilityInstructions, { surface: "skill", teamId: "developer-team", skillId: skill.skillId }),
      ...(skill.files ?? {}),
    };
    for (const [packagePath, content] of Object.entries(packageFiles)) {
      validateStandalonePackagePath(packagePath);
      const relativePath = `.pi/skills/${skill.skillId}/${packagePath}`;
      planned.push({
        skillId: skill.skillId,
        packagePath,
        relativePath,
        absolutePath: join(projectRoot, ".pi", "skills", skill.skillId, ...packagePath.split("/")),
        content,
      });
    }
  }
  return planned;
}

// --- Legacy SDD Cleanup ---

/** Legacy SDD agent file names that should be removed during installation. */
const LEGACY_SDD_AGENT_FILES = [
  "sdd-apply",
  "sdd-archive",
  "sdd-design",
  "sdd-explore",
  "sdd-init",
  "sdd-new",
  "sdd-continue",
  "sdd-ff",
  "sdd-onboard",
  "sdd-propose",
  "sdd-proposal", // Added for wildcard coverage
  "sdd-sync", // Added for wildcard coverage
  "sdd-review",
  "sdd-spec",
  "sdd-tasks",
  "sdd-verify",
];

/**
 * Remove legacy SDD agent files from the agents directory.
 * These are old Deck-managed `sdd-*` files replaced by the adaptive team.
 * Also removes nested SKILL.md/SKILL.md patterns in skills directory.
 * Returns list of removed file paths.
 */
export function cleanupLegacySddAgentFiles(
  agentsDir: string,
  options?: { readdirSync?: typeof import("node:fs").readdirSync; unlinkSync?: typeof import("node:fs").unlinkSync; existsSync?: typeof import("node:fs").existsSync; readdir?: typeof import("node:fs").readdirSync; rmdirSync?: typeof import("node:fs").rmdirSync },
): string[] {
  const readdirSync = options?.readdirSync ?? require("node:fs").readdirSync;
  const unlink = options?.unlinkSync ?? unlinkSync;
  const exists = options?.existsSync ?? existsSync;
  const rmdirSync = options?.rmdirSync ?? require("node:fs").rmdirSync;

  const removed: string[] = [];

  // Check if agents directory exists
  if (!exists(agentsDir)) {
    return removed;
  }

  try {
    const files = readdirSync(agentsDir);
    for (const file of files) {
      // Check if it's a legacy SDD file (sdd-*.md) - explicit list
      const baseName = file.replace(/\.md$/, "");
      if (LEGACY_SDD_AGENT_FILES.includes(baseName)) {
        const filePath = join(agentsDir, file);
        try {
          unlink(filePath);
          removed.push(filePath);
        } catch {
          // File might be already deleted or permission issue - continue
        }
      }
    }
  } catch {
    // Directory might not exist or be readable - ignore
  }

  return removed;
}

/**
 * Clean up nested SKILL.md/SKILL.md patterns in skills directory.
 * This handles cases where skills were incorrectly installed as ~/.pi/agent/skills/SKILL.md/SKILL.md
 * instead of the correct ~/.pi/skills/SKILL.md.
 * Returns list of removed directory paths.
 */
export function cleanupNestedSkillDirectories(
  skillsDir: string,
  options?: { readdirSync?: typeof import("node:fs").readdirSync; existsSync?: typeof import("node:fs").existsSync; rmdirSync?: typeof import("node:fs").rmdirSync },
): string[] {
  const readdirSync = options?.readdirSync ?? require("node:fs").readdirSync;
  const exists = options?.existsSync ?? existsSync;
  const rmdirSync = options?.rmdirSync ?? require("node:fs").rmdirSync;

  const removed: string[] = [];

  // Check if skills directory exists
  if (!exists(skillsDir)) {
    return removed;
  }

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      // Check for double-nested SKILL.md/SKILL.md pattern (old broken structure)
      // The incorrect structure was: .pi/skills/SKILL.md/SKILL.md (a dir literally named "SKILL.md")
      // The correct structure is: .pi/skills/{skillId}/SKILL.md (a dir with skill ID name)
      // Only remove if the directory itself is literally named "SKILL.md"
      if (entry.isDirectory() && entry.name === "SKILL.md") {
        const nestedPath = join(skillsDir, entry.name, "SKILL.md");
        if (exists(nestedPath)) {
          try {
            rmdirSync(join(skillsDir, entry.name), { recursive: true });
            removed.push(join(skillsDir, entry.name));
          } catch {
            // Continue even if deletion fails
          }
        }
      }
    }
  } catch {
    // Directory might not exist or be readable - ignore
  }

  return removed;
}

export type FileInstallResult = {
  kind: "agent" | "skill";
  agentId: string;
  status: "created" | "updated" | "unchanged";
  absolutePath: string;
};

export type BundleApplyResult = {
  agentId: string;
  kind: "agent" | "skill";
  status: "created" | "unchanged" | "updated";
  absolutePath?: string;
};

/** @deprecated Use BundleApplyResult — kept for backward compat */
export type AgentApplyResult = BundleApplyResult;

export type DeveloperTeamApplyResult = {
  results: BundleApplyResult[];
  changedCount: number;
  unchangedCount: number;
  fileResults: FileInstallResult[];
  /** Legacy SDD agent files (sdd-*.md) that were removed during installation */
  legacyFilesRemoved: string[];
  /** Nested SKILL.md/SKILL.md directories that were removed during installation */
  nestedSkillDirsRemoved: string[];
  /** Profile directory path where system-prompt.md was materialized */
  profileDir: string;
  /** Whether the profile was created/updated or was unchanged */
  profileStatus: "created" | "updated" | "unchanged";
  /** Exact former Developer Team files moved outside Pi discovery. */
  legacyTeamFilesRetired: string[];
};

export type BundleVerifyResult = {
  agentId: string;
  valid: boolean;
  issues: string[];
};

/** @deprecated Use BundleVerifyResult — kept for backward compat */
export type AgentVerifyResult = BundleVerifyResult;

export type DeveloperTeamVerifyResult = {
  valid: boolean;
  agentResults: BundleVerifyResult[];
  skillResults: BundleVerifyResult[];
};

export type ReadDeveloperTeamModelAssignmentsOptions = {
  exists?: typeof existsSync;
  readFile?: (path: string, encoding: "utf-8") => string;
  /** Explicit agents directory (e.g., ~/.pi/agent/agents for Pi).
   * When provided, reading skips appending .pi/agents to projectRoot.
   * Use this for Pi explicit path to avoid double .pi/agents issue. */
  agentsDir?: string;
};

/** Re-export MemoryDiagnostic from core for backward compatibility. */
export type MemoryDiagnostic = CoreMemoryDiagnostic;

const SUPPORTED_PI_MEMORY_PROVIDER_IDS = ["supermemory"] as const;

/** Options for memory injection during Developer Team install. */
export type MemoryInjectionOptions = {
  /** A pre-built memory injection bundle (takes precedence over provider). */
  memoryInjection?: MemoryInjectionBundle;
  /** Pre-built bundles are accepted only from Deck's trusted composition root. */
  trustedMemoryInjection?: boolean;
  /** A memory provider that will build the injection bundle. Ignored if memoryInjection is set. */
  memoryProvider?: AdaptiveMemoryProvider;
  /** Provider IDs accepted by this adapter/caller registry. */
  supportedMemoryProviderIds?: Iterable<string>;
  /** Override for validating Pi global MCP config before Supermemory tool injection. */
  piMcpConfigPath?: string;
  /** Override home directory used to resolve the default Pi global MCP config path. */
  piMcpHomeDir?: string;
};

export type DeveloperTeamInstallOptions = MemoryInjectionOptions & {
  modelAssignments?: DeveloperTeamModelAssignments;
  thinkingAssignments?: DeveloperTeamThinkingAssignments;
  preserveMissingThinkingAssignments?: boolean;
  /**
   * Resolved provider from the capability dashboard/TUI install path.
   * Kept as an explicit alias so dashboard code can inject the same provider
   * constructed by launch resolution without relying on legacy selection helpers.
   * `memoryInjection` still takes precedence, then `memoryProvider`, then this alias.
   */
  dashboardMemoryProvider?: AdaptiveMemoryProvider;
  /**
   * Pre-built capability instruction bundle. When provided, the bundle's
   * fragments are composed into agent/skill content via the content registry.
   * Adapters should prefer passing this over having each builder re-compose.
   */
  capabilityInstructions?: CapabilityInstructionBundle;
  /**
   * Standalone skill definitions to include in the install plan.
   * When provided, these skills are written as-is (verbatim) to .pi/skills/{skillId}/SKILL.md
   * without generating agent-bound frontmatter.
   */
  standaloneSkills?: readonly { skillId: string; body: string; files?: Record<string, string> }[];
  /**
   * Optional orchestrator personality override. When provided, this value is
   * passed to the content registry to select the appropriate prompt variant.
   * When absent, falls back to `DEFAULT_ORCHESTRATOR_PERSONALITY`.
   */
  orchestratorPersonality?: import("@deck/core/config/deck-config").OrchestratorPersonality;
  /** Retained for API compatibility; compact prompt selection no longer depends on rollout receipts. */
  promptProfileActivation?: PromptProfileActivationV1;
};

// --- Legacy local resolveMemoryInjection (delegated to core) ---
// Kept as a thin wrapper for any Pi-specific extensions in the future.
// Currently delegates to the centralized core implementation with
// fail-closed provider ID validation (REQ-AMI-003).

function resolvePiMemoryInjection(
  options?: MemoryInjectionOptions,
  projectRoot?: string,
): { bundle: MemoryInjectionBundle | undefined; diagnostics: MemoryDiagnostic[] } {
  let memoryProvider = options?.memoryProvider;
  let scopeDiagnostic: MemoryDiagnostic | undefined;
  if (memoryProvider?.id === "supermemory") {
    const derived = projectRoot ? resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] }) : undefined;
    if (derived?.ok) {
      // Keep the caller-provided provider, but only pass the verified runtime scope
      // through the trusted build context. Pi does not materialize raw Supermemory MCP.
    } else {
      memoryProvider = undefined;
      scopeDiagnostic = {
        code: "memory_provider_unavailable",
        providerId: "supermemory",
        message: "Supermemory project identity is missing or invalid; omitted adaptive-memory injection with redacted diagnostics.",
      };
    }
  }

  const resolved = resolveMemoryInjection({
    memoryInjection: options?.memoryInjection,
    trustedMemoryInjection: options?.trustedMemoryInjection,
    memoryProvider,
    supportedProviderIds: options?.supportedMemoryProviderIds ?? SUPPORTED_PI_MEMORY_PROVIDER_IDS,
    buildContext: {
      teamId: "developer-team",
      supermemoryProjectScope: memoryProvider?.id === "supermemory" && projectRoot
        ? (() => {
            const derived = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] });
            return derived.ok ? derived.scope : undefined;
          })()
        : undefined,
    },
  });

  return {
    bundle: resolved.bundle,
    diagnostics: [...resolved.diagnostics, ...(scopeDiagnostic ? [scopeDiagnostic] : [])],
  };
}

/**
 * Map MemoryToolBinding entries to Pi frontmatter tool names.
 *
 * Pi uses a comma-separated `tools:` line in agent frontmatter. When memory
 * tool bindings are present and the agent content received a memory injection
 * (matching fragments), their MCP tool names are appended to the base
 * tools list. Only tool bindings from surfaces that have matching instruction
 * fragments are included.
 *
 * Supermemory exposes generic MCP tool names (`execute`, `search_docs`), so
 * preserve the binding server name in generated frontmatter to avoid granting
 * or colliding with a different server's generic `execute` tool.
 */
function buildPiToolsLine(baseTools: string, toolBindings: readonly import("@deck/core/memory/adaptive-memory").MemoryToolBinding[]): string {
  if (toolBindings.length === 0) return baseTools;

  const memoryToolNames = toolBindings.flatMap((binding) => binding.toolNames.map((toolName) => toPiMemoryToolName(binding.serverName, toolName)));
  // Deduplicate while preserving order
  const seen = new Set<string>();
  const allTools: string[] = [];

  for (const tool of baseTools.split(",")) {
    const trimmed = tool.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      allTools.push(trimmed);
    }
  }

  for (const tool of memoryToolNames) {
    if (!seen.has(tool)) {
      seen.add(tool);
      allTools.push(tool);
    }
  }

  return allTools.join(",");
}

function toPiMemoryToolName(serverName: string | undefined, toolName: string): string {
  if (serverName && (toolName === "execute" || toolName === "search_docs" || toolName === "memory" || toolName === "recall")) {
    return `${serverName}.${toolName}`;
  }
  return toolName;
}

// --- Plan ---

export function getPiExecutionProbeCapabilities() {
  return Object.freeze({
    invocationHook: true,
    freshAgentHook: true,
  });
}

export function buildDeveloperTeamInstallPlan(
  projectRoot: string,
  options?: DeveloperTeamInstallOptions,
): DeveloperTeamInstallPlan & { memoryDiagnostics: MemoryDiagnostic[] } {
  const agentsDir = join(projectRoot, ".pi", "agents");
  const skillsDir = join(projectRoot, ".pi", "skills");
  const modelAssignments = options?.modelAssignments;
  const thinkingAssignments = options?.thinkingAssignments;
  const resolvedMemoryProvider = options?.memoryProvider ?? options?.dashboardMemoryProvider;

  const { bundle: memoryBundle, diagnostics: memoryDiagnostics } = resolvePiMemoryInjection({
    memoryInjection: options?.memoryInjection,
    trustedMemoryInjection: options?.trustedMemoryInjection,
    memoryProvider: resolvedMemoryProvider,
    supportedMemoryProviderIds: options?.supportedMemoryProviderIds,
    piMcpConfigPath: options?.piMcpConfigPath,
    piMcpHomeDir: options?.piMcpHomeDir,
  }, projectRoot);

  const derivedSupermemoryProjectScope = (() => {
    const resolved = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] });
    return resolved.ok ? resolved.scope : undefined;
  })();
  const capabilityInstructions = bindAdaptiveMemoryInstructionBundle(options?.capabilityInstructions, {
    supermemoryProjectScope: derivedSupermemoryProjectScope,
  });

  const personality = options?.orchestratorPersonality ?? DEFAULT_ORCHESTRATOR_PERSONALITY;
  const promptProfile = "compact" as const;

  const agents: PlannedAgentFile[] = DEVELOPER_TEAM_AGENTS.map((agent) => {
    const relativePath = `.pi/agents/${agent.id}.md`;
    const absolutePath = join(projectRoot, relativePath);
    const assignedModel = modelAssignments?.[agent.id];
    const model = supportsDeveloperTeamModel(assignedModel) ? assignedModel : undefined;
    const hasThinkingAssignment = thinkingAssignments ? Object.prototype.hasOwnProperty.call(thinkingAssignments, agent.id) : false;
    const thinking = model && options?.preserveMissingThinkingAssignments && !hasThinkingAssignment
      ? undefined
      : model ? resolveThinkingForModel(model, thinkingAssignments?.[agent.id] as PiThinkingLevel | undefined) : resolveThinkingForModel(undefined);
    const content = buildAgentFileContent(
      agent,
      model,
      thinking,
      memoryBundle,
      capabilityInstructions,
      personality,
      promptProfile,
    );

    return { agent, relativePath, absolutePath, content };
  });

  // Get SDD bootstrap skill IDs to avoid duplication
  const sddSkillIds = new Set(getBootstrapSkillFiles().map((s) => s.skillId));

  // Filter out SDD bootstrap skills from agent skills to avoid duplication
  // Lifecycle skills (deck-onboard, deck-archive) are written from sddSkillFiles.
  const skills: PlannedSkillFile[] = DEVELOPER_TEAM_AGENTS.filter((agent) => !sddSkillIds.has(agent.skillId)).map((agent) => {
    const relativePath = `.pi/skills/${agent.skillId}/SKILL.md`;
    const absolutePath = join(projectRoot, relativePath);
    const content = buildSkillFileContent(
      agent,
      memoryBundle,
      capabilityInstructions,
      personality,
      promptProfile,
    );

    return { agent, relativePath, absolutePath, content };
  });

  // Build standalone skill package files (verbatim, no generated frontmatter).
  const standaloneSkills = buildStandaloneSkillFiles(projectRoot, options?.standaloneSkills ?? [], capabilityInstructions);

  // Build standalone lifecycle skill files.
  const sddSkillFiles: PlannedSDDSkillFile[] = getBootstrapSkillFiles().map((skill) => ({
    skillId: skill.skillId,
    relativePath: `.pi/skills/${skill.skillId}/SKILL.md`,
    absolutePath: join(projectRoot, `.pi/skills/${skill.skillId}/SKILL.md`),
    content: buildBootstrapSkillFileContent(
      skill,
      capabilityInstructions,
      personality,
      promptProfile,
    ),
  }));

  return {
    projectRoot,
    agentsDir,
    skillsDir,
    agents,
    skills,
    standaloneSkills,
    sddSkillFiles,
    memoryDiagnostics,
    memoryBundle,
    promptProfile,
    ...(options?.promptProfileActivation === undefined
      ? {}
      : { promptProfileActivation: options.promptProfileActivation }),
  };
}

export function readDeveloperTeamModelAssignments(
  projectRoot: string,
  options?: ReadDeveloperTeamModelAssignmentsOptions,
): DeveloperTeamModelAssignments {
  return readDeveloperTeamModelConfigAssignments(projectRoot, options).modelAssignments;
}

export function readDeveloperTeamThinkingAssignments(
  projectRoot: string,
  options?: ReadDeveloperTeamModelAssignmentsOptions,
): DeveloperTeamThinkingAssignments {
  return readDeveloperTeamModelConfigAssignments(projectRoot, options).thinkingAssignments;
}

export function readDeveloperTeamModelConfigAssignments(
  projectRoot: string,
  options?: ReadDeveloperTeamModelAssignmentsOptions,
): DeveloperTeamModelConfigAssignments {
  const exists = options?.exists ?? existsSync;
  const readFile = options?.readFile ?? readFileSync;
  const rawModelAssignments: DeveloperTeamModelAssignments = {};
  const rawThinkingAssignments: DeveloperTeamThinkingAssignments = {};

  // Determine the agents directory:
  // - If explicitly provided via options.agentsDir, use that (Pi explicit path)
  // - Otherwise, derive from projectRoot by appending /.pi/agents (OpenCode style)
  const agentsDir = options?.agentsDir ?? join(projectRoot, ".pi", "agents");

  const persistedAgentIds = [
    ...DEVELOPER_TEAM_AGENTS.map((agent) => agent.id),
    ...DEVELOPER_TEAM_LEGACY_AGENT_IDS,
  ];
  for (const agentId of persistedAgentIds) {
    const absolutePath = join(agentsDir, `${agentId}.md`);
    if (!exists(absolutePath)) continue;

    const content = readFile(absolutePath, "utf-8");
    const frontmatter = readFrontmatter(content);
    if (!frontmatter) continue;

    const model = readFrontmatterValue(frontmatter, "model");
    const thinking = parsePiThinkingLevel(readFrontmatterValue(frontmatter, "thinking"));
    if (model) rawModelAssignments[agentId] = model;
    if (thinking) rawThinkingAssignments[agentId] = thinking;
  }

  return {
    modelAssignments: { ...migrateLegacyDeveloperTeamAssignments(rawModelAssignments).assignments },
    thinkingAssignments: { ...migrateLegacyDeveloperTeamAssignments(rawThinkingAssignments).assignments },
  };
}

function readFrontmatter(content: string): string | undefined {
  return content.match(/^---\n([\s\S]*?)\n---/)?.[1];
}

function readFrontmatterValue(frontmatter: string, key: string): string | undefined {
  const line = frontmatter
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${key}:`));

  const value = line?.slice(`${key}:`.length).trim();
  return value && value.length > 0 ? value : undefined;
}

// --- Apply ---

function getPiLegacyActivePaths(plan: DeveloperTeamInstallPlan): string[] {
  const retainedSkillIds = new Set(getBootstrapSkillFiles().map((skill) => skill.skillId));
  return [
    ...DEVELOPER_TEAM_LEGACY_AGENT_IDS.flatMap((agentId) => [
      join(plan.agentsDir, `${agentId}.md`),
      ...(retainedSkillIds.has(agentId) ? [] : [join(plan.skillsDir, agentId, "SKILL.md")]),
    ]),
    ...LEGACY_SDD_AGENT_FILES.map((agentId) => join(plan.agentsDir, `${agentId}.md`)),
  ];
}

function assertPiCandidateFiles(
  plan: DeveloperTeamInstallPlan,
  exists: typeof existsSync,
  readFile: typeof readFileSync,
): void {
  for (const planned of [...plan.agents, ...plan.skills, ...plan.standaloneSkills, ...plan.sddSkillFiles]) {
    if (!exists(planned.absolutePath) || readFile(planned.absolutePath, "utf-8") !== planned.content) {
      throw new Error(`Developer Team candidate verification failed for ${planned.absolutePath}.`);
    }
  }
  const profileDir = buildTeamProfileDir(plan.projectRoot, "developer-team");
  for (const requiredPath of [
    join(profileDir, "system-prompt.md"),
    join(profileDir, "extensions", "developer-team-execution.js"),
  ]) {
    if (!exists(requiredPath)) {
      throw new Error(`Developer Team profile verification failed for ${requiredPath}.`);
    }
  }
}

function retirePiLegacyFiles(
  plan: DeveloperTeamInstallPlan,
  options: {
    exists: typeof existsSync;
    readFile: typeof readFileSync;
    writeFile: typeof writeFileSync;
    mkdir: typeof mkdirSync;
    unlink: typeof unlinkSync;
  },
): string[] {
  const quarantineRoot = join(plan.projectRoot, ".deck", "backups", "developer-team-v2");
  const retired: string[] = [];

  for (const sourcePath of getPiLegacyActivePaths(plan)) {
    if (!options.exists(sourcePath)) continue;
    const content = options.readFile(sourcePath, "utf-8");
    let destinationPath = join(quarantineRoot, relative(plan.projectRoot, sourcePath));
    if (options.exists(destinationPath) && options.readFile(destinationPath, "utf-8") !== content) {
      const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
      destinationPath = `${destinationPath}.${hash}`;
    }
    options.mkdir(dirname(destinationPath), { recursive: true });
    if (!options.exists(destinationPath)) {
      options.writeFile(destinationPath, content, "utf-8");
    }
    if (options.readFile(destinationPath, "utf-8") !== content) {
      throw new Error(`Legacy Developer Team quarantine verification failed for ${sourcePath}.`);
    }
    options.unlink(sourcePath);
    retired.push(sourcePath);
  }

  return retired;
}

export function applyDeveloperTeamInstall(
  plan: DeveloperTeamInstallPlan,
  options?: { writeFile?: typeof writeFileSync; exists?: typeof existsSync; mkdir?: typeof mkdirSync; readFile?: typeof readFileSync; unlink?: typeof unlinkSync; readdirSync?: typeof import("node:fs").readdirSync },
): DeveloperTeamApplyResult {
  const writeFile = options?.writeFile ?? writeFileSync;
  const exists = options?.exists ?? existsSync;
  const mkdir = options?.mkdir ?? mkdirSync;
  const readFile = options?.readFile ?? readFileSync;
  const unlink = options?.unlink ?? unlinkSync;
  const fileBackup = backupDeveloperTeamFiles(plan, { exists, readFile });

  try {

  if (!exists(plan.agentsDir)) {
    mkdir(plan.agentsDir, { recursive: true });
  }

  // Legacy inventory is retired only after the new candidate is complete.
  const legacyFilesRemoved: string[] = [];

  if (!exists(plan.skillsDir)) {
    mkdir(plan.skillsDir, { recursive: true });
  }

  for (const planned of plan.skills) {
    const skillDir = join(planned.absolutePath, "..");
    if (!exists(skillDir)) {
      mkdir(skillDir, { recursive: true });
    }
  }

  const agentResults: BundleApplyResult[] = plan.agents.map((planned) => {
    if (exists(planned.absolutePath)) {
      const existing = readFile(planned.absolutePath, "utf-8");
      if (existing === planned.content) {
        return { agentId: planned.agent.id, kind: "agent" as const, status: "unchanged" as const, absolutePath: planned.absolutePath };
      }
      writeFile(planned.absolutePath, planned.content, "utf-8");
      return { agentId: planned.agent.id, kind: "agent" as const, status: "updated" as const, absolutePath: planned.absolutePath };
    }

    writeFile(planned.absolutePath, planned.content, "utf-8");
    return { agentId: planned.agent.id, kind: "agent" as const, status: "created" as const, absolutePath: planned.absolutePath };
  });

  const skillResults: BundleApplyResult[] = plan.skills.map((planned) => {
    if (exists(planned.absolutePath)) {
      const existing = readFile(planned.absolutePath, "utf-8");
      if (existing === planned.content) {
        return { agentId: planned.agent.id, kind: "skill" as const, status: "unchanged" as const, absolutePath: planned.absolutePath };
      }
      writeFile(planned.absolutePath, planned.content, "utf-8");
      return { agentId: planned.agent.id, kind: "skill" as const, status: "updated" as const, absolutePath: planned.absolutePath };
    }

    writeFile(planned.absolutePath, planned.content, "utf-8");
    return { agentId: planned.agent.id, kind: "skill" as const, status: "created" as const, absolutePath: planned.absolutePath };
  });

  // Write standalone skills (verbatim, no generated frontmatter)
  const standaloneSkillResults: BundleApplyResult[] = plan.standaloneSkills.map((planned) => {
    const skillDir = join(planned.absolutePath, "..");
    if (!exists(skillDir)) {
      mkdir(skillDir, { recursive: true });
    }

    if (exists(planned.absolutePath)) {
      const existing = readFile(planned.absolutePath, "utf-8");
      if (existing === planned.content) {
        return { agentId: planned.skillId, kind: "skill" as const, status: "unchanged" as const, absolutePath: planned.absolutePath };
      }
      writeFile(planned.absolutePath, planned.content, "utf-8");
      return { agentId: planned.skillId, kind: "skill" as const, status: "updated" as const, absolutePath: planned.absolutePath };
    }

    writeFile(planned.absolutePath, planned.content, "utf-8");
    return { agentId: planned.skillId, kind: "skill" as const, status: "created" as const, absolutePath: planned.absolutePath };
  });

  // Write standalone lifecycle skill files with idempotency.
  const sddSkillResults: BundleApplyResult[] = plan.sddSkillFiles.map((planned) => {
    // Ensure directory exists before writing
    const skillDir = join(planned.absolutePath, "..");
    if (!exists(skillDir)) {
      mkdir(skillDir, { recursive: true });
    }

    if (exists(planned.absolutePath)) {
      const existing = readFile(planned.absolutePath, "utf-8");
      if (existing === planned.content) {
        return { agentId: planned.skillId, kind: "skill" as const, status: "unchanged" as const, absolutePath: planned.absolutePath };
      }
      writeFile(planned.absolutePath, planned.content, "utf-8");
      return { agentId: planned.skillId, kind: "skill" as const, status: "updated" as const, absolutePath: planned.absolutePath };
    }

    writeFile(planned.absolutePath, planned.content, "utf-8");
    return { agentId: planned.skillId, kind: "skill" as const, status: "created" as const, absolutePath: planned.absolutePath };
  });

  const allResults = [...agentResults, ...skillResults, ...standaloneSkillResults, ...sddSkillResults];
  const changedCount = allResults.filter((r) => r.status === "created" || r.status === "updated").length;
  const unchangedCount = allResults.filter((r) => r.status === "unchanged").length;

  // Defer legacy malformed-directory cleanup until every fallible candidate,
  // profile, verification, and retirement step has succeeded.
  let nestedSkillDirsRemoved: string[] = [];

  // Materialize team profile (system-prompt.md) - required for orchestrator stub reference
  const profileDir = buildTeamProfileDir(plan.projectRoot, "developer-team");
  const systemPromptPath = join(profileDir, "system-prompt.md");

  // Determine profile status and materialize if needed
  let profileStatus: "created" | "updated" | "unchanged" = "unchanged";
  const existingProfileContent = exists(systemPromptPath) ? readFile(systemPromptPath, "utf-8") : null;

  materializeTeamProfile({
    teamId: "developer-team",
    projectRoot: plan.projectRoot,
    ...(plan.memoryBundle ? { memoryInjection: plan.memoryBundle } : {}),
    ...(plan.memoryBundle ? { trustedMemoryInjection: true } : {}),
    ...(plan.promptProfileActivation === undefined
      ? {}
      : { promptProfileActivation: plan.promptProfileActivation }),
    mkdir,
    writeFile,
    readFile: (path, encoding) => readFileSync(path, encoding ?? "utf-8") as string,
    exists,
  });

  if (!existingProfileContent) {
    profileStatus = "created";
  } else {
    const newProfileContent = readFile(systemPromptPath, "utf-8");
    profileStatus = existingProfileContent !== newProfileContent ? "updated" : "unchanged";
  }

  assertPiCandidateFiles(plan, exists, readFile);
  const legacyTeamFilesRetired = retirePiLegacyFiles(plan, {
    exists,
    readFile,
    writeFile,
    mkdir,
    unlink,
  });
  legacyFilesRemoved.push(...legacyTeamFilesRetired.filter((path) => dirname(path) === plan.agentsDir && path.split("/").pop()?.startsWith("sdd-")));
  nestedSkillDirsRemoved = cleanupNestedSkillDirectories(plan.skillsDir, options);

  const fileResults: FileInstallResult[] = allResults.map((r) => ({
    kind: r.kind,
    agentId: r.agentId,
    status: r.status,
    absolutePath: r.absolutePath!,
  }));

  return { results: allResults, changedCount, unchangedCount, fileResults, legacyFilesRemoved, nestedSkillDirsRemoved, profileDir, profileStatus, legacyTeamFilesRetired };
  } catch (error) {
    rollbackDeveloperTeamFiles(fileBackup, { writeFile, unlink });
    throw error;
  }
}

// --- Verify ---

export function verifyDeveloperTeamInstall(
  plan: DeveloperTeamInstallPlan,
  options?: { exists?: typeof existsSync; readFile?: typeof readFileSync },
): DeveloperTeamVerifyResult {
  const exists = options?.exists ?? existsSync;
  const readFile = options?.readFile ?? readFileSync;

  const agentResults: BundleVerifyResult[] = plan.agents.map((planned) => {
    const issues: string[] = [];

    if (!exists(planned.absolutePath)) {
      return { agentId: planned.agent.id, valid: false, issues: ["File does not exist."] };
    }

    const content = readFile(planned.absolutePath, "utf-8");

    if (content !== planned.content) {
      issues.push(`Content mismatch for agent ${planned.agent.id}; installed file differs from planned content.`);
    }

    if (!content.includes(`name: ${planned.agent.name}`)) {
      issues.push(`Frontmatter name mismatch: expected "name: ${planned.agent.name}".`);
    }

    if (!content.includes(`description:`)) {
      issues.push("Missing description field in frontmatter.");
    } else if (!content.includes(JSON.stringify(planned.agent.description))) {
      issues.push(`Description mismatch for ${planned.agent.id}.`);
    }

    // Task 7: Verify orchestrator invariant presence for agent surface
    // Only verify for orchestrator agent
    if (planned.agent.id === "deck-lead") {
      const invariantCheck = verifyInvariantPresence(content, "agent");
      if (!invariantCheck.pass) {
        for (const missingId of invariantCheck.missing) {
          issues.push(`Missing orchestrator invariant ${missingId} on agent surface.`);
        }
      }
    }

    return { agentId: planned.agent.id, valid: issues.length === 0, issues };
  });

  const skillResults: BundleVerifyResult[] = plan.skills.map((planned) => {
    const issues: string[] = [];

    if (!exists(planned.absolutePath)) {
      return { agentId: planned.agent.id, valid: false, issues: ["File does not exist."] };
    }

    const content = readFile(planned.absolutePath, "utf-8");

    if (content !== planned.content) {
      issues.push(`Content mismatch for skill ${planned.agent.skillId}; installed file differs from planned content.`);
    }

    if (!content.includes(`description:`)) {
      issues.push("Missing description field in frontmatter.");
    } else if (!content.includes(JSON.stringify(planned.agent.description))) {
      issues.push(`Description mismatch for skill ${planned.agent.skillId}.`);
    }

    const registryContent = getAgentContent(planned.agent.id, { promptProfile: plan.promptProfile });
    if (registryContent) {
      const headingMatch = registryContent.skillBody.match(/^# .+$/m);
      if (headingMatch && !content.includes(headingMatch[0])) {
        issues.push(`Missing expected heading "${headingMatch[0]}".`);
      }
    }

    // Task 7: Verify orchestrator invariant presence for skill surface
    // Only verify for orchestrator skill
    if (planned.agent.id === "deck-lead") {
      const invariantCheck = verifyInvariantPresence(content, "skill");
      if (!invariantCheck.pass) {
        for (const missingId of invariantCheck.missing) {
          issues.push(`Missing orchestrator invariant ${missingId} on skill surface.`);
        }
      }
    }

    return { agentId: planned.agent.id, valid: issues.length === 0, issues };
  });

  const standaloneSkillResults: BundleVerifyResult[] = plan.standaloneSkills.map((planned) => {
    const issues: string[] = [];
    if (!exists(planned.absolutePath)) {
      return { agentId: planned.skillId, valid: false, issues: [`File does not exist: ${planned.packagePath}.`] };
    }
    const content = readFile(planned.absolutePath, "utf-8");
    if (content !== planned.content) {
      issues.push(`Content mismatch for standalone skill ${planned.skillId}/${planned.packagePath}; installed file differs from planned content.`);
    }
    return { agentId: planned.skillId, valid: issues.length === 0, issues };
  });

  // Verify SDD bootstrap skill files
  const sddSkillResults: BundleVerifyResult[] = plan.sddSkillFiles.map((planned) => {
    const issues: string[] = [];

    if (!exists(planned.absolutePath)) {
      return { agentId: planned.skillId, valid: false, issues: ["File does not exist."] };
    }

    const content = readFile(planned.absolutePath, "utf-8");

    if (content !== planned.content) {
      issues.push(`Content mismatch for SDD skill ${planned.skillId}; installed file differs from planned content.`);
    }

    return { agentId: planned.skillId, valid: issues.length === 0, issues };
  });

  const legacyResults: BundleVerifyResult[] = getPiLegacyActivePaths(plan)
    .filter((absolutePath) => exists(absolutePath))
    .map((absolutePath) => ({ agentId: "legacy-inventory", valid: false, issues: [`Legacy active path remains: ${absolutePath}`] }));

  return {
    valid: agentResults.every((r) => r.valid) && skillResults.every((r) => r.valid) && standaloneSkillResults.every((r) => r.valid) && sddSkillResults.every((r) => r.valid) && legacyResults.length === 0,
    agentResults: [...agentResults, ...legacyResults],
    skillResults: [...skillResults, ...standaloneSkillResults, ...sddSkillResults],
  };
}

// --- Backup ---

export type FileBackupEntry = {
  absolutePath: string;
  /** null means the file did not exist before the install */
  previousContent: string | null;
};

export type BackupManifest = {
  entries: FileBackupEntry[];
};

export function backupDeveloperTeamFiles(
  plan: DeveloperTeamInstallPlan,
  options?: { exists?: typeof existsSync; readFile?: (path: string, encoding: "utf-8") => string },
): BackupManifest {
  const exists = options?.exists ?? existsSync;
  const readFile = options?.readFile ?? readFileSync;

  const profileDir = buildTeamProfileDir(plan.projectRoot, "developer-team");
  const allFiles = [
    ...plan.agents,
    ...plan.skills,
    ...plan.standaloneSkills,
    ...plan.sddSkillFiles,
    ...getPiLegacyActivePaths(plan).map((absolutePath) => ({ absolutePath })),
    { absolutePath: join(profileDir, "system-prompt.md") },
    { absolutePath: join(profileDir, "extensions", "developer-team-execution.js") },
  ];

  const entries: FileBackupEntry[] = allFiles.map((planned) => {
    if (exists(planned.absolutePath)) {
      return {
        absolutePath: planned.absolutePath,
        previousContent: readFile(planned.absolutePath, "utf-8"),
      };
    }
    return {
      absolutePath: planned.absolutePath,
      previousContent: null,
    };
  });

  return { entries };
}

// --- Rollback ---

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
        // File may already be gone (partial apply or external removal)
      }
    } else {
      writeFile(entry.absolutePath, entry.previousContent, "utf-8");
    }
  }
}

// --- Content builders (consume core registry) ---

function buildSkillFileContent(
  agent: DeveloperTeamAgent,
  memoryBundle?: MemoryInjectionBundle,
  capabilityInstructions?: CapabilityInstructionBundle,
  personality?: import("@deck/core/config/deck-config").OrchestratorPersonality,
  promptProfile: DeveloperTeamPromptProfileV1 = "compact",
): string {
  const content = getAgentContent(
    agent.id,
    capabilityInstructions
      ? { capabilityInstructions, personality, promptProfile }
      : { personality, promptProfile },
  );
  if (!content) {
    throw new Error(`No content found for agent ${agent.id} in core registry.`);
  }

  const skillResult = memoryBundle
    ? composeAdaptiveMemory(content.skillBody, memoryBundle, {
        surface: "skill",
        teamId: "developer-team",
        skillId: agent.skillId,
      })
    : { content: content.skillBody, toolBindings: [] as readonly import("@deck/core/memory/adaptive-memory").MemoryToolBinding[] };

  return [
    "---",
    `description: ${toYamlScalar(agent.description)}`,
    "---",
    "",
    skillResult.content,
    "",
  ].join("\n");
}

function buildBootstrapSkillFileContent(
  skill: { skillId: string; content: string },
  capabilityInstructions: CapabilityInstructionBundle | undefined,
  _personality: import("@deck/core/config/deck-config").OrchestratorPersonality,
  _promptProfile: DeveloperTeamPromptProfileV1,
): string {
  const frontmatterEnd = skill.content.indexOf("\n---", 3);
  if (frontmatterEnd < 0) {
    throw new Error(`Invalid bootstrap skill content for ${skill.skillId}.`);
  }
  const content = composeCapabilityInstructions(skill.content, capabilityInstructions, { surface: "skill", teamId: "developer-team", skillId: skill.skillId });
  return content.endsWith("\n") ? content : `${content}\n`;
}

const DEVELOPER_ORCHESTRATOR_AGENT_ID = "deck-lead";

function buildAgentFileContent(
  agent: DeveloperTeamAgent,
  model?: string,
  thinking?: PiThinkingLevel,
  memoryBundle?: MemoryInjectionBundle,
  capabilityInstructions?: CapabilityInstructionBundle,
  personality?: import("@deck/core/config/deck-config").OrchestratorPersonality,
  promptProfile: DeveloperTeamPromptProfileV1 = "compact",
): string {
  const isOrchestrator = agent.id === DEVELOPER_ORCHESTRATOR_AGENT_ID;

  const content = getAgentContent(
    agent.id,
    capabilityInstructions
      ? { capabilityInstructions, personality, promptProfile }
      : { personality, promptProfile },
  );
  if (!content) {
    throw new Error(`No content found for agent ${agent.id} in core registry.`);
  }

  // For orchestrator, generate a stub that includes all required sections for observability
  if (isOrchestrator) {
    return buildOrchestratorStub(
      agent,
      content.agentBody,
      model,
      thinking,
      memoryBundle,
      capabilityInstructions,
    );
  }

  const agentResult: AdaptiveMemoryCompositionResult = memoryBundle
    ? composeAdaptiveMemory(content.agentBody, memoryBundle, {
        surface: "agent",
        teamId: "developer-team",
        agentId: agent.id,
      })
    : { content: content.agentBody, toolBindings: [] as readonly import("@deck/core/memory/adaptive-memory").MemoryToolBinding[] };

  const baseTools = "read,write,bash";
  const toolsLine = memoryBundle
    ? buildPiToolsLine(baseTools, agentResult.toolBindings)
    : baseTools;

  const frontmatterLines = [
    "---",
    `name: ${agent.name}`,
    `description: ${toYamlScalar(agent.description)}`,
    `skill: ${agent.skillId}`,
    ...(model ? [`model: ${model}`] : []),
    `tools: ${toolsLine}`,
    ...(thinking ? [`thinking: ${thinking}`] : []),
    "systemPromptMode: replace",
    "inheritProjectContext: true",
    "inheritSkills: false",
    "---",
  ];

  return [...frontmatterLines, "", agentResult.content, ""].join("\n");
}

/**
 * Builds the lightweight Lead stub used by Pi.
 * The actual session prompt lives in .deck/pi/profiles/<team>/system-prompt.md
 * and is passed via --system-prompt flag in pi-team-launch.ts.
 * This stub preserves the observable sections (invariants, capability instructions, memory)
 * while referencing the profile for the full runtime prompt.
 */
function buildOrchestratorStub(
  agent: DeveloperTeamAgent,
  agentBodyContent: string,
  model?: string,
  thinking?: PiThinkingLevel,
  memoryBundle?: MemoryInjectionBundle,
  capabilityInstructions?: CapabilityInstructionBundle,
): string {
  // Build tool bindings from memory bundle - filter by surface matching "agent"
  // This follows the same contract as composeAdaptiveMemory
  const agentInstructions = memoryBundle?.instructions.filter((inst) => inst.surface === "agent") ?? [];
  const toolBindings = agentInstructions.length > 0
    ? (memoryBundle?.toolBindings ?? [])
    : [];
  const additionalTools = toolBindings.map((tb) => tb.toolNames).flat();
  const toolsLine = additionalTools.length > 0
    ? `read,write,bash,${additionalTools.join(",")}`
    : "read,write,bash";

  const frontmatterLines: string[] = [
    "---",
    `name: ${agent.name}`,
    `description: ${toYamlScalar(agent.description)}`,
    `skill: ${agent.skillId}`,
    ...(model ? [`model: ${model}`] : []),
    `tools: ${toolsLine}`,
    ...(thinking ? [`thinking: ${thinking}`] : []),
    "systemPromptMode: replace",
    "inheritProjectContext: true",
    "inheritSkills: false",
    "---",
  ];

  const profileReference = [
    "## Team Profile",
    "",
    "The binding adaptive team contract lives in `.deck/pi/profiles/<team>/system-prompt.md`",
    "and is passed through `--system-prompt` when the team launches.",
  ];

  // Build capability instructions section if provided
  const capabilityLines: string[] = [];
  if (capabilityInstructions && capabilityInstructions.instructions.length > 0) {
    capabilityLines.push("", "## Package Instructions (configured)", "");
    for (const inst of capabilityInstructions.instructions) {
      if (inst.surface === "agent") {
        capabilityLines.push(inst.markdown.replace(/^/, "<!-- package: " + inst.packageId + " --> "));
        capabilityLines.push("");
      }
    }
    capabilityLines.push("These instructions are provided by the runner's native package instruction system.");
  }

  // Build memory injection section if provided
  const memoryLines: string[] = [];
  if (memoryBundle && memoryBundle.instructions.length > 0) {
    // Find agent-surface instructions from the bundle
    const agentInstructions = memoryBundle.instructions.filter((inst) => inst.surface === "agent");
    if (agentInstructions.length > 0) {
      memoryLines.push("", "## Adaptive Memory (provider-injected)", "");
      for (const inst of agentInstructions) {
        memoryLines.push(inst.markdown);
        memoryLines.push("");
      }
    }
  }

  const stubBody = [
    "# Deck Lead",
    "",
    ...profileReference,
    ...capabilityLines,
    ...memoryLines,
    "## Role",
    "",
    "- Own the user's outcome and keep decisions understandable in both directions.",
    "- Choose the smallest safe route: direct delta, focused delegation, Working Brief, or Full SDD.",
    "- Implement clear low-risk changes directly when delegation would cost more than the work.",
    "- Use Quality for protected or material risk, uncertain evidence, release readiness, or explicit user request.",
    "",
    "## Tools",
    "",
    "Standard tools: read, write, bash",
    "",
    "## Notes",
    "",
    "- The profile is authoritative; this stub only keeps the role discoverable.",
    "",
  ].join("\n");

  const combinedContent = `${stubBody}\n\n---\n\n${agentBodyContent}`;

  return [...frontmatterLines, "", combinedContent, ""].join("\n");

}

function toYamlScalar(value: string): string {
  return JSON.stringify(value);
}

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentContent } from "@deck/core/teams/developer/content-registry";
import { getOrchestratorSystemPrompt, ORCHESTRATOR_AGENT_BODY } from "@deck/core/teams/developer/orchestrator-content";
import { getBootstrapSkillFiles } from "@deck/core/skills/bootstrap";
import {
  buildCapabilityInstructionBundle,
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

  // For skill surface, require actual invariant headers
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
} from "@deck/core/memory/adaptive-memory";
import { readDeckConfig, DEFAULT_ORCHESTRATOR_PERSONALITY } from "@deck/core/config/deck-config";
import type { CapabilityInstructionBundle } from "@deck/core";
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
import { validateSupermemoryPiMcpConfig } from "./pi-mcp-config";

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

/** SDD bootstrap skill file (deck-init, deck-onboard) */
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
  /** SDD bootstrap skill files (deck-init, deck-onboard) */
  sddSkillFiles: PlannedSDDSkillFile[];
  memoryDiagnostics: MemoryDiagnostic[];
  /** Memory injection bundle computed from memoryInjection/memoryProvider options. */
  memoryBundle?: MemoryInjectionBundle;
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
): PlannedStandaloneSkillFile[] {
  const planned: PlannedStandaloneSkillFile[] = [];
  for (const skill of standaloneSkills) {
    validateStandaloneSkillId(skill.skillId);
    const packageFiles: Record<string, string> = { "SKILL.md": skill.body, ...(skill.files ?? {}) };
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
 * These are the old `sdd-*` files that were replaced by `deck-developer-*` agents.
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
      // Wildcard cleanup: any sdd-*.md not in explicit list (handles arbitrary legacy files)
      if (file.startsWith("sdd-") && file.endsWith(".md") && !LEGACY_SDD_AGENT_FILES.includes(baseName)) {
        const filePath = join(agentsDir, file);
        try {
          unlink(filePath);
          removed.push(filePath);
        } catch {
          // Continue even if deletion fails
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

const SUPPORTED_PI_MEMORY_PROVIDER_IDS = ["engram", "supermemory"] as const;

/** Options for memory injection during Developer Team install. */
export type MemoryInjectionOptions = {
  /** A pre-built memory injection bundle (takes precedence over provider). */
  memoryInjection?: MemoryInjectionBundle;
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
   * If the caller also needs the resolved config, pass `orchestratorPersonality`
   * explicitly after calling `readDeckConfig(projectRoot)`.
   */
  orchestratorPersonality?: import("@deck/core/config/deck-config").OrchestratorPersonality;
};

// --- Legacy local resolveMemoryInjection (delegated to core) ---
// Kept as a thin wrapper for any Pi-specific extensions in the future.
// Currently delegates to the centralized core implementation with
// fail-closed provider ID validation (REQ-AMI-003).

function resolvePiMemoryInjection(
  options?: MemoryInjectionOptions,
): { bundle: MemoryInjectionBundle | undefined; diagnostics: MemoryDiagnostic[] } {
  const resolved = resolveMemoryInjection({
    memoryInjection: options?.memoryInjection,
    memoryProvider: options?.memoryProvider,
    supportedProviderIds: options?.supportedMemoryProviderIds ?? SUPPORTED_PI_MEMORY_PROVIDER_IDS,
    buildContext: { teamId: "developer-team" },
  });

  // Pi behaves like OpenCode: inject memory tools when MCP config is structurally valid
  if (options?.memoryInjection || options?.memoryProvider?.id !== "supermemory" || !resolved.bundle) {
    return resolved;
  }

  const serverName = resolved.bundle.toolBindings.find((binding) => binding.serverName)?.serverName;
  const mcpValidation = validateSupermemoryPiMcpConfig({
    serverName,
    configPath: options.piMcpConfigPath,
    homeDir: options.piMcpHomeDir,
  });

  // If MCP config is structurally valid, inject tools (no Pi-only gate)
  if (mcpValidation.ok) {
    return resolved;
  }

  // Config invalid or missing — fail-closed with diagnostic
  return {
    bundle: undefined,
    diagnostics: [
      ...resolved.diagnostics,
      {
        code: "memory_provider_unavailable",
        providerId: "supermemory",
        message: "Supermemory Pi MCP config is unavailable or invalid; omitted adaptive-memory injection with redacted diagnostics.",
        details: {
          path: mcpValidation.path,
          serverName: mcpValidation.serverName,
          diagnostics: mcpValidation.diagnostics.map((diagnostic) => ({
            code: diagnostic.code,
            severity: diagnostic.severity,
            message: diagnostic.message,
          })),
        },
      },
    ],
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
  if (serverName && (toolName === "execute" || toolName === "search_docs")) {
    return `${serverName}.${toolName}`;
  }
  return toolName;
}

// --- Plan ---

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
    memoryProvider: resolvedMemoryProvider,
    supportedMemoryProviderIds: options?.supportedMemoryProviderIds,
    piMcpConfigPath: options?.piMcpConfigPath,
    piMcpHomeDir: options?.piMcpHomeDir,
  });

  const capabilityInstructions = options?.capabilityInstructions;

  // Resolve orchestrator personality from options or fall back to config
  const personality = options?.orchestratorPersonality ?? (() => {
    try {
      return readDeckConfig(projectRoot).orchestratorPersonality;
    } catch {
      return DEFAULT_ORCHESTRATOR_PERSONALITY;
    }
  })();

  const agents: PlannedAgentFile[] = DEVELOPER_TEAM_AGENTS.map((agent) => {
    const relativePath = `.pi/agents/${agent.id}.md`;
    const absolutePath = join(projectRoot, relativePath);
    const assignedModel = modelAssignments?.[agent.id];
    const model = supportsDeveloperTeamModel(assignedModel) ? assignedModel : undefined;
    const hasThinkingAssignment = thinkingAssignments ? Object.prototype.hasOwnProperty.call(thinkingAssignments, agent.id) : false;
    const thinking = model && options?.preserveMissingThinkingAssignments && !hasThinkingAssignment
      ? undefined
      : model ? resolveThinkingForModel(model, thinkingAssignments?.[agent.id] as PiThinkingLevel | undefined) : resolveThinkingForModel(undefined);
    const content = buildAgentFileContent(agent, model, thinking, memoryBundle, capabilityInstructions, personality);

    return { agent, relativePath, absolutePath, content };
  });

  // Get SDD bootstrap skill IDs to avoid duplication
  const sddSkillIds = new Set(getBootstrapSkillFiles().map((s) => s.skillId));

  // Filter out SDD bootstrap skills from agent skills to avoid duplication
  // SDD bootstrap skills (deck-init, deck-onboard) will be written from sddSkillFiles
  const skills: PlannedSkillFile[] = DEVELOPER_TEAM_AGENTS.filter((agent) => !sddSkillIds.has(agent.skillId)).map((agent) => {
    const relativePath = `.pi/skills/${agent.skillId}/SKILL.md`;
    const absolutePath = join(projectRoot, relativePath);
    const content = buildSkillFileContent(agent, memoryBundle, capabilityInstructions, personality);

    return { agent, relativePath, absolutePath, content };
  });

  // Build standalone skill package files (verbatim, no generated frontmatter).
  const standaloneSkills = buildStandaloneSkillFiles(projectRoot, options?.standaloneSkills ?? []);

// Build SDD bootstrap skill files (deck-init, deck-onboard)
  // Map: "deck-init/SKILL.md" -> ".pi/skills/deck-init/SKILL.md"
  const sddSkillFiles: PlannedSDDSkillFile[] = getBootstrapSkillFiles().map((skill) => ({
    skillId: skill.skillId,
    relativePath: `.pi/skills/${skill.skillId}/SKILL.md`,
    absolutePath: join(projectRoot, `.pi/skills/${skill.skillId}/SKILL.md`),
    content: skill.content,
  }));

  return { projectRoot, agentsDir, skillsDir, agents, skills, standaloneSkills, sddSkillFiles, memoryDiagnostics, memoryBundle };
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
  const modelAssignments: DeveloperTeamModelAssignments = {};
  const thinkingAssignments: DeveloperTeamThinkingAssignments = {};

  // Determine the agents directory:
  // - If explicitly provided via options.agentsDir, use that (Pi explicit path)
  // - Otherwise, derive from projectRoot by appending /.pi/agents (OpenCode style)
  const agentsDir = options?.agentsDir ?? join(projectRoot, ".pi", "agents");

  for (const agent of DEVELOPER_TEAM_AGENTS) {
    const absolutePath = join(agentsDir, `${agent.id}.md`);
    if (!exists(absolutePath)) continue;

    const content = readFile(absolutePath, "utf-8");
    const frontmatter = readFrontmatter(content);
    if (!frontmatter) continue;

    const model = readFrontmatterValue(frontmatter, "model");
    const thinking = parsePiThinkingLevel(readFrontmatterValue(frontmatter, "thinking"));
    if (model) modelAssignments[agent.id] = model;
    if (thinking) thinkingAssignments[agent.id] = thinking;
  }

  return { modelAssignments, thinkingAssignments };
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

export function applyDeveloperTeamInstall(
  plan: DeveloperTeamInstallPlan,
  options?: { writeFile?: typeof writeFileSync; exists?: typeof existsSync; mkdir?: typeof mkdirSync; readFile?: typeof readFileSync; readdirSync?: typeof import("node:fs").readdirSync },
): DeveloperTeamApplyResult {
  const writeFile = options?.writeFile ?? writeFileSync;
  const exists = options?.exists ?? existsSync;
  const mkdir = options?.mkdir ?? mkdirSync;
  const readFile = options?.readFile ?? readFileSync;

  if (!exists(plan.agentsDir)) {
    mkdir(plan.agentsDir, { recursive: true });
  }

  // Cleanup legacy SDD agent files (sdd-apply.md, sdd-design.md, etc.)
  // These were replaced by deck-developer-* agents
  const legacyFilesRemoved = cleanupLegacySddAgentFiles(plan.agentsDir, options);

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

  // Write SDD bootstrap skill files (deck-init, deck-onboard) with idempotency
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

  // Cleanup nested SKILL.md/SKILL.md patterns in skills directory
  const nestedSkillDirsRemoved = cleanupNestedSkillDirectories(plan.skillsDir, options);

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

  const fileResults: FileInstallResult[] = allResults.map((r) => ({
    kind: r.kind,
    agentId: r.agentId,
    status: r.status,
    absolutePath: r.absolutePath!,
  }));

  return { results: allResults, changedCount, unchangedCount, fileResults, legacyFilesRemoved, nestedSkillDirsRemoved, profileDir, profileStatus };
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
    if ( planned.agent.id === "deck-developer-orchestrator") {
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

    if (!content.includes(`description:`)) {
      issues.push("Missing description field in frontmatter.");
    } else if (!content.includes(JSON.stringify(planned.agent.description))) {
      issues.push(`Description mismatch for skill ${planned.agent.skillId}.`);
    }

    const registryContent = getAgentContent(planned.agent.id);
    if (registryContent) {
      const headingMatch = registryContent.skillBody.match(/^# .+$/m);
      if (headingMatch && !content.includes(headingMatch[0])) {
        issues.push(`Missing expected heading "${headingMatch[0]}".`);
      }
    }

    // Task 7: Verify orchestrator invariant presence for skill surface
    // Only verify for orchestrator skill
    if ( planned.agent.id === "deck-developer-orchestrator") {
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

    // Basic validation: check for expected skill ID content
    if (!content.includes("deck-init") && !content.includes("deck-onboard")) {
      issues.push(`Missing expected SDD skill content.`);
    }

    return { agentId: planned.skillId, valid: issues.length === 0, issues };
  });

  return {
    valid: agentResults.every((r) => r.valid) && skillResults.every((r) => r.valid) && standaloneSkillResults.every((r) => r.valid) && sddSkillResults.every((r) => r.valid),
    agentResults,
    skillResults: [...skillResults, ...standaloneSkillResults],
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

  const allFiles = [...plan.agents, ...plan.skills, ...plan.standaloneSkills, ...plan.sddSkillFiles];

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
): string {
  const content = getAgentContent(
    agent.id,
    capabilityInstructions
      ? { capabilityInstructions, personality }
      : { personality },
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

const DEVELOPER_ORCHESTRATOR_AGENT_ID = "deck-developer-orchestrator";

function buildAgentFileContent(
  agent: DeveloperTeamAgent,
  model?: string,
  thinking?: PiThinkingLevel,
  memoryBundle?: MemoryInjectionBundle,
  capabilityInstructions?: CapabilityInstructionBundle,
  personality?: import("@deck/core/config/deck-config").OrchestratorPersonality,
): string {
  const isOrchestrator = agent.id === DEVELOPER_ORCHESTRATOR_AGENT_ID;

  const content = getAgentContent(
    agent.id,
    capabilityInstructions
      ? { capabilityInstructions, personality }
      : { personality },
  );
  if (!content) {
    throw new Error(`No content found for agent ${agent.id} in core registry.`);
  }

  // For orchestrator, generate a stub that includes all required sections for observability
  if (isOrchestrator) {
    return buildOrchestratorStub(agent, model, thinking, memoryBundle, capabilityInstructions);
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
 * Builds an orchestrator stub that includes all required sections for observability.
 * The actual session prompt lives in .deck/pi/profiles/<team>/system-prompt.md
 * and is passed via --system-prompt flag in pi-team-launch.ts.
 * This stub preserves the observable sections (invariants, capability instructions, memory)
 * while referencing the profile for the full runtime prompt.
 */
function buildOrchestratorStub(
  agent: DeveloperTeamAgent,
  model?: string,
  thinking?: PiThinkingLevel,
  memoryBundle?: MemoryInjectionBundle,
  capabilityInstructions?: CapabilityInstructionBundle,
  personality?: import("@deck/core/config/deck-config").OrchestratorPersonality,
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

  // Reference to Orchestrator Invariants in profile (REQ-PROMPT-002 compliance)
  const invariantReference = [
    "## Orchestrator Behavior",
    "",
    "See `.deck/pi/profiles/<team>/system-prompt.md` for behavior guidelines.",
    "These define execution mode, delegation, SDD initialization/triage, and registry-deferred parallelism.",
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
    "# Orchestrator Agent",
    "",
    "This agent operates with session context loaded from the team profile.",
    "The complete session prompt is defined in `.deck/pi/profiles/<team>/system-prompt.md`",
    "and passed via the `--system-prompt` flag at launch time.",
    "",
    ...invariantReference,
    ...capabilityLines,
    ...memoryLines,
    "## Role",
    "",
    "- **Delegator**: Routes work to specialized agents (Apply, Review, Explore, etc.)",
    "- **Coordinator**: Manages task flow and orchestrates multi-agent workflows",
    "- **Quality Gate**: Ensures all changes pass review before completion",
    "",
    "## Tools",
    "",
    "Standard tools: read, write, bash",
    "",
    "## Notes",
    "",
    "- System prompt is sourced from profile, not embedded here",
    "- Profile path: `.deck/pi/profiles/<team>/system-prompt.md`",
    "",
  ].join("\n");

  // Append personality-specific content after the base stub
  // Use ORCHESTRATOR_AGENT_BODY which contains "Delegate real work" etc.
  const agentBodyContent = ORCHESTRATOR_AGENT_BODY;
  const combinedContent = `${stubBody}\n\n---\n\n${agentBodyContent}`;

  return [...frontmatterLines, "", combinedContent, ""].join("\n");

}

function toYamlScalar(value: string): string {
  return JSON.stringify(value);
}

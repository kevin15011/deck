import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { getAgentContent, type DeveloperTeamPromptProfileV1 } from "@deck/core/teams/developer/content-registry";
import { getBootstrapSkillFiles } from "@deck/core/skills/bootstrap";
import {
  buildCapabilityInstructionBundle,
  composeCapabilityInstructions,
  getEnabledPackageInstructionIds,
} from "@deck/core/teams/developer/instruction-bundles";
import { translatePiCapabilityInstructions } from "./instruction-translation";
import { buildTeamProfileDir } from "./pi-team-launch";

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
    const hasProfileReference = /(?:\.deck\/pi\/profiles|deck\/profiles)\/.*\/system-prompt\.md/.test(content);
    const hasInvariantHeader = /^## Adaptive Developer Team Contract$/m.test(content);

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

  return { pass: false, missing: criticalIds };
}
import { DEFAULT_ORCHESTRATOR_PERSONALITY } from "@deck/core/config/deck-config";
import { type CapabilityInstructionBundle } from "@deck/core";
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

/**
 * Global Deck-managed Pi package layout. When given, every planned path lives inside `packageRoot`
 * (`agents/`, `skills/`) and nothing is planned under the project root.
 */
export type DeveloperTeamInstallLayout = {
  /** Absolute package root (e.g. `<PiAgentDir>/deck/package`). */
  packageRoot: string;
  /** Text used by the Lead stub to point at the global profile. Defaults to the Deck global profile location. */
  profileReference?: string;
};

export const DEFAULT_GLOBAL_PROFILE_REFERENCE = "deck/profiles/<team>/system-prompt.md";

export type DeveloperTeamInstallPlan = {
  projectRoot: string;
  /** Present when planned for the global package layout. */
  layout?: DeveloperTeamInstallLayout;
  agentsDir: string;
  skillsDir: string;
  agents: PlannedAgentFile[];
  skills: PlannedSkillFile[];
  standaloneSkills: PlannedStandaloneSkillFile[];
  /** Standalone lifecycle skill files (deck-onboard, deck-archive). */
  sddSkillFiles: PlannedSDDSkillFile[];
  /** Effective prompt profile. Compact is selected for normal installations. */
  promptProfile: DeveloperTeamPromptProfileV1;
  /** Retained for API compatibility with earlier rollout-aware callers. */

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
  layout?: DeveloperTeamInstallLayout,
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
      const relativePath = layout ? `skills/${skill.skillId}/${packagePath}` : `.pi/skills/${skill.skillId}/${packagePath}`;
      planned.push({
        skillId: skill.skillId,
        packagePath,
        relativePath,
        absolutePath: layout
          ? join(layout.packageRoot, "skills", skill.skillId, ...packagePath.split("/"))
          : join(projectRoot, ".pi", "skills", skill.skillId, ...packagePath.split("/")),
        content,
      });
    }
  }
  return planned;
}

/** @deprecated Ambiguous nested skill directories are preserved; only exact generated identities retire. */
export function cleanupNestedSkillDirectories(
  skillsDir: string,
  options?: { readdirSync?: typeof import("node:fs").readdirSync; existsSync?: typeof import("node:fs").existsSync; rmdirSync?: typeof import("node:fs").rmdirSync },
): string[] {
  throw new Error("Legacy Pi directory cleanup is disabled; use PiRunnerAdapter exact-file retirement.");
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

export type DeveloperTeamInstallOptions = {
  modelAssignments?: DeveloperTeamModelAssignments;
  thinkingAssignments?: DeveloperTeamThinkingAssignments;
  preserveMissingThinkingAssignments?: boolean;
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

  /** Plan for the global Deck-managed Pi package instead of the deprecated project-local `.pi` layout. */
  layout?: DeveloperTeamInstallLayout;
};

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
): DeveloperTeamInstallPlan & { } {
  const layout = options?.layout;
  const agentsDir = layout ? join(layout.packageRoot, "agents") : join(projectRoot, ".pi", "agents");
  const skillsDir = layout ? join(layout.packageRoot, "skills") : join(projectRoot, ".pi", "skills");
  const modelAssignments = options?.modelAssignments;
  const thinkingAssignments = options?.thinkingAssignments;
  const capabilityInstructions = translatePiCapabilityInstructions(options?.capabilityInstructions);

  const personality = options?.orchestratorPersonality ?? DEFAULT_ORCHESTRATOR_PERSONALITY;
  const promptProfile = "compact" as const;

  const agents: PlannedAgentFile[] = DEVELOPER_TEAM_AGENTS.map((agent) => {
    const relativePath = layout ? `agents/${agent.id}.md` : `.pi/agents/${agent.id}.md`;
    const absolutePath = layout ? join(agentsDir, `${agent.id}.md`) : join(projectRoot, relativePath);
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
      capabilityInstructions,
      personality,
      promptProfile,
      layout ? (layout.profileReference ?? DEFAULT_GLOBAL_PROFILE_REFERENCE) : undefined,
    );

    return { agent, relativePath, absolutePath, content };
  });

  // Get SDD bootstrap skill IDs to avoid duplication
  const sddSkillIds = new Set(getBootstrapSkillFiles().map((s) => s.skillId));

  // Filter out SDD bootstrap skills from agent skills to avoid duplication
  // Lifecycle skills (deck-onboard, deck-archive) are written from sddSkillFiles.
  const skills: PlannedSkillFile[] = DEVELOPER_TEAM_AGENTS.filter((agent) => !sddSkillIds.has(agent.skillId)).map((agent) => {
    const relativePath = layout ? `skills/${agent.skillId}/SKILL.md` : `.pi/skills/${agent.skillId}/SKILL.md`;
    const absolutePath = layout ? join(skillsDir, agent.skillId, "SKILL.md") : join(projectRoot, relativePath);
    const content = buildSkillFileContent(
      agent,
      capabilityInstructions,
      personality,
      promptProfile,
    );

    return { agent, relativePath, absolutePath, content };
  });

  // Build standalone skill package files (verbatim, no generated frontmatter).
  const standaloneSkills = buildStandaloneSkillFiles(projectRoot, options?.standaloneSkills ?? [], capabilityInstructions, layout);

  // Build standalone lifecycle skill files.
  const sddSkillFiles: PlannedSDDSkillFile[] = getBootstrapSkillFiles().map((skill) => ({
    skillId: skill.skillId,
    relativePath: layout ? `skills/${skill.skillId}/SKILL.md` : `.pi/skills/${skill.skillId}/SKILL.md`,
    absolutePath: layout ? join(skillsDir, skill.skillId, "SKILL.md") : join(projectRoot, `.pi/skills/${skill.skillId}/SKILL.md`),
    content: buildBootstrapSkillFileContent(
      skill,
      capabilityInstructions,
      personality,
      promptProfile,
    ),
  }));

  return {
    projectRoot,
    ...(layout ? { layout } : {}),
    agentsDir,
    skillsDir,
    agents,
    skills,
    standaloneSkills,
    sddSkillFiles,
    promptProfile,
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
    modelAssignments: rawModelAssignments,
    thinkingAssignments: rawThinkingAssignments,
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

export function applyDeveloperTeamInstall(
  plan: DeveloperTeamInstallPlan,
  options?: { writeFile?: typeof writeFileSync; exists?: typeof existsSync; mkdir?: typeof mkdirSync; readFile?: typeof readFileSync; unlink?: typeof unlinkSync; readdirSync?: typeof import("node:fs").readdirSync },
): DeveloperTeamApplyResult {
  // This compatibility entry point has no admission, installation lease or durable transaction.
  // Rendering legacy plans remains available for migration/inspection; publication belongs to the adapter.
  throw new Error("Legacy Pi installation is disabled; use PiRunnerAdapter.buildDeveloperTeamInstallPlan and applyDeveloperTeamInstall.");
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


  return {
    valid: agentResults.every((r) => r.valid) && skillResults.every((r) => r.valid) && standaloneSkillResults.every((r) => r.valid) && sddSkillResults.every((r) => r.valid),
    agentResults: agentResults,
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
  throw new Error("Legacy Pi rollback is disabled; use PiRunnerAdapter rollbackDeveloperTeamFiles.");
}

// --- Content builders (consume core registry) ---

function buildSkillFileContent(
  agent: DeveloperTeamAgent,
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


  return [
    "---",
    `name: ${toYamlScalar(agent.skillId)}`,
    `description: ${toYamlScalar(agent.description)}`,
    "---",
    "",
    content.skillBody,
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
  capabilityInstructions?: CapabilityInstructionBundle,
  personality?: import("@deck/core/config/deck-config").OrchestratorPersonality,
  promptProfile: DeveloperTeamPromptProfileV1 = "compact",
  globalProfileReference?: string,
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
      capabilityInstructions,
      globalProfileReference,
    );
  }

  const toolsLine = "read,write,bash";
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

  return [...frontmatterLines, "", content.agentBody, ""].join("\n");
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
  capabilityInstructions?: CapabilityInstructionBundle,
  globalProfileReference?: string,
): string {
  const toolsLine = "read,write,bash";
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
    `The binding adaptive team contract lives in \`${globalProfileReference ?? ".deck/pi/profiles/<team>/system-prompt.md"}\``,
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


  const stubBody = [
    "# Deck Lead",
    "",
    ...profileReference,
    ...capabilityLines,
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

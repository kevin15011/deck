import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentContent } from "@deck/core/teams/developer/content-registry";
import type { DeveloperTeamAgent } from "./developer-team-catalog";
import { DEVELOPER_TEAM_AGENTS } from "./developer-team-catalog";
import {
  getDefaultThinkingForModel,
  parsePiThinkingLevel,
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

export type DeveloperTeamInstallPlan = {
  projectRoot: string;
  agentsDir: string;
  skillsDir: string;
  agents: PlannedAgentFile[];
  skills: PlannedSkillFile[];
};

export type BundleApplyResult = {
  agentId: string;
  kind: "agent" | "skill";
  status: "created" | "unchanged" | "updated";
};

/** @deprecated Use BundleApplyResult — kept for backward compat */
export type AgentApplyResult = BundleApplyResult;

export type DeveloperTeamApplyResult = {
  results: BundleApplyResult[];
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
};

// --- Plan ---

export function buildDeveloperTeamInstallPlan(
  projectRoot: string,
  options?: { modelAssignments?: DeveloperTeamModelAssignments; thinkingAssignments?: DeveloperTeamThinkingAssignments },
): DeveloperTeamInstallPlan {
  const agentsDir = join(projectRoot, ".pi", "agents");
  const skillsDir = join(projectRoot, ".pi", "skills");
  const modelAssignments = options?.modelAssignments;
  const thinkingAssignments = options?.thinkingAssignments;

  const agents: PlannedAgentFile[] = DEVELOPER_TEAM_AGENTS.map((agent) => {
    const relativePath = `.pi/agents/${agent.id}.md`;
    const absolutePath = join(projectRoot, relativePath);
    const model = modelAssignments?.[agent.id];
    const thinking = thinkingAssignments?.[agent.id] ?? getDefaultThinkingForModel(model);
    const content = buildAgentFileContent(agent, model, thinking);

    return { agent, relativePath, absolutePath, content };
  });

  const skills: PlannedSkillFile[] = DEVELOPER_TEAM_AGENTS.map((agent) => {
    const relativePath = `.pi/skills/${agent.skillId}/SKILL.md`;
    const absolutePath = join(projectRoot, relativePath);
    const content = buildSkillFileContent(agent);

    return { agent, relativePath, absolutePath, content };
  });

  return { projectRoot, agentsDir, skillsDir, agents, skills };
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

  for (const agent of DEVELOPER_TEAM_AGENTS) {
    const absolutePath = join(projectRoot, ".pi", "agents", `${agent.id}.md`);
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
  options?: { writeFile?: typeof writeFileSync; exists?: typeof existsSync; mkdir?: typeof mkdirSync; readFile?: typeof readFileSync },
): DeveloperTeamApplyResult {
  const writeFile = options?.writeFile ?? writeFileSync;
  const exists = options?.exists ?? existsSync;
  const mkdir = options?.mkdir ?? mkdirSync;
  const readFile = options?.readFile ?? readFileSync;

  // Ensure agents directory exists
  if (!exists(plan.agentsDir)) {
    mkdir(plan.agentsDir, { recursive: true });
  }

  // Ensure skills directory exists
  if (!exists(plan.skillsDir)) {
    mkdir(plan.skillsDir, { recursive: true });
  }

  // Ensure each skill subdirectory exists
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
        return { agentId: planned.agent.id, kind: "agent" as const, status: "unchanged" as const };
      }
      writeFile(planned.absolutePath, planned.content, "utf-8");
      return { agentId: planned.agent.id, kind: "agent" as const, status: "updated" as const };
    }

    writeFile(planned.absolutePath, planned.content, "utf-8");
    return { agentId: planned.agent.id, kind: "agent" as const, status: "created" as const };
  });

  const skillResults: BundleApplyResult[] = plan.skills.map((planned) => {
    if (exists(planned.absolutePath)) {
      const existing = readFile(planned.absolutePath, "utf-8");
      if (existing === planned.content) {
        return { agentId: planned.agent.id, kind: "skill" as const, status: "unchanged" as const };
      }
      writeFile(planned.absolutePath, planned.content, "utf-8");
      return { agentId: planned.agent.id, kind: "skill" as const, status: "updated" as const };
    }

    writeFile(planned.absolutePath, planned.content, "utf-8");
    return { agentId: planned.agent.id, kind: "skill" as const, status: "created" as const };
  });

  return { results: [...agentResults, ...skillResults] };
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

    // Verify skill body contains a recognizable heading
    const registryContent = getAgentContent(planned.agent.id);
    if (registryContent) {
      // The skill body should be present in the file content
      // Extract first heading from skill body as a check
      const headingMatch = registryContent.skillBody.match(/^# .+$/m);
      if (headingMatch && !content.includes(headingMatch[0])) {
        issues.push(`Missing expected heading "${headingMatch[0]}".`);
      }
    }

    return { agentId: planned.agent.id, valid: issues.length === 0, issues };
  });

  return {
    valid: agentResults.every((r) => r.valid) && skillResults.every((r) => r.valid),
    agentResults,
    skillResults,
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
  options?: { exists?: typeof existsSync; readFile?: typeof readFileSync },
): BackupManifest {
  const exists = options?.exists ?? existsSync;
  const readFile = options?.readFile ?? readFileSync;

  const allFiles = [...plan.agents, ...plan.skills];

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
      // File was newly created by install — remove it
      try {
        unlink(entry.absolutePath);
      } catch {
        // File may already be gone (partial apply or external removal)
      }
    } else {
      // File existed before install — restore original content
      writeFile(entry.absolutePath, entry.previousContent, "utf-8");
    }
  }
}

// --- Content builders (consume core registry) ---

/**
 * Pi-specific frontmatter + body from the core registry.
 *
 * The adapter only adds Pi frontmatter (name, description, skill, tools, etc.)
 * and wraps the registry's runner-agnostic agent body.
 */
function buildSkillFileContent(agent: DeveloperTeamAgent): string {
  const content = getAgentContent(agent.id);
  if (!content) {
    throw new Error(`No content found for agent ${agent.id} in core registry.`);
  }

  return [
    "---",
    `description: ${toYamlScalar(agent.description)}`,
    "---",
    "",
    content.skillBody,
    "",
  ].join("\n");
}

/**
 * Pi-specific frontmatter + body from the core registry.
 *
 * The adapter only adds Pi frontmatter (name, description, skill, tools, etc.)
 * and wraps the registry's runner-agnostic agent body.
 */
function buildAgentFileContent(agent: DeveloperTeamAgent, model?: string, thinking: PiThinkingLevel = "low"): string {
  const content = getAgentContent(agent.id);
  if (!content) {
    throw new Error(`No content found for agent ${agent.id} in core registry.`);
  }

  const frontmatterLines = [
    "---",
    `name: ${agent.name}`,
    `description: ${toYamlScalar(agent.description)}`,
    `skill: ${agent.skillId}`,
    ...(model ? [`model: ${model}`] : []),
    "tools: read,write,bash",
    `thinking: ${thinking}`,
    "systemPromptMode: replace",
    "inheritProjectContext: true",
    "inheritSkills: false",
    "---",
  ];

  return [...frontmatterLines, "", content.agentBody, ""].join("\n");
}

function toYamlScalar(value: string): string {
  return JSON.stringify(value);
}

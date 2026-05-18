import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import type { DeveloperTeamAgent } from "@deck/core/teams/developer/catalog";
import { getAgentContent } from "@deck/core/teams/developer/content-registry";

// ---------------------------------------------------------------------------
// Types
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

export type OpenCodeDeveloperTeamInstallPlan = {
  projectRoot: string;
  agentsDir: string;
  skillsDir: string;
  agents: OpenCodePlannedAgentFile[];
  skills: OpenCodePlannedSkillFile[];
};

export type OpenCodeBundleApplyResult = {
  agentId: string;
  kind: "agent" | "skill";
  status: "created" | "unchanged" | "updated";
};

export type OpenCodeDeveloperTeamApplyResult = {
  results: OpenCodeBundleApplyResult[];
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

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Build an OpenCode-specific installation plan for the Developer Team.
 *
 * OpenCode uses `.opencode/agents/` for agent markdown files and
 * `.opencode/skills/<skill-id>/SKILL.md` for skill files. The adapter
 * consumes canonical agent definitions and content from `@deck/core` and
 * wraps them with minimal OpenCode-appropriate frontmatter.
 */
export function buildOpenCodeDeveloperTeamInstallPlan(projectRoot: string): OpenCodeDeveloperTeamInstallPlan {
  const agentsDir = join(projectRoot, ".opencode", "agents");
  const skillsDir = join(projectRoot, ".opencode", "skills");

  const agents: OpenCodePlannedAgentFile[] = DEVELOPER_TEAM_AGENTS.map((agent) => {
    const relativePath = `.opencode/agents/${agent.id}.md`;
    const absolutePath = join(projectRoot, relativePath);
    const content = buildAgentFileContent(agent);

    return { agent, relativePath, absolutePath, content };
  });

  const skills: OpenCodePlannedSkillFile[] = DEVELOPER_TEAM_AGENTS.map((agent) => {
    const relativePath = `.opencode/skills/${agent.skillId}/SKILL.md`;
    const absolutePath = join(projectRoot, relativePath);
    const content = buildSkillFileContent(agent);

    return { agent, relativePath, absolutePath, content };
  });

  return { projectRoot, agentsDir, skillsDir, agents, skills };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export function applyOpenCodeDeveloperTeamInstall(
  plan: OpenCodeDeveloperTeamInstallPlan,
  options?: { writeFile?: typeof writeFileSync; exists?: typeof existsSync; mkdir?: typeof mkdirSync; readFile?: typeof readFileSync },
): OpenCodeDeveloperTeamApplyResult {
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

  const agentResults: OpenCodeBundleApplyResult[] = plan.agents.map((planned) => {
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

  const skillResults: OpenCodeBundleApplyResult[] = plan.skills.map((planned) => {
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

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export function verifyOpenCodeDeveloperTeamInstall(
  plan: OpenCodeDeveloperTeamInstallPlan,
  options?: { exists?: typeof existsSync; readFile?: typeof readFileSync },
): OpenCodeDeveloperTeamVerifyResult {
  const exists = options?.exists ?? existsSync;
  const readFile = options?.readFile ?? readFileSync;

  const agentResults: OpenCodeBundleVerifyResult[] = plan.agents.map((planned) => {
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
    } else if (!content.includes(planned.agent.description)) {
      issues.push(`Description mismatch for ${planned.agent.id}.`);
    }

    return { agentId: planned.agent.id, valid: issues.length === 0, issues };
  });

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

    // Verify skill body contains a recognizable heading from core registry
    const registryContent = getAgentContent(planned.agent.id);
    if (registryContent) {
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

// ---------------------------------------------------------------------------
// Content builders (consume core registry)
// ---------------------------------------------------------------------------

/**
 * OpenCode-specific frontmatter + body from the core registry.
 *
 * The adapter only adds minimal frontmatter (name, description, skill)
 * and wraps the registry's runner-agnostic skill body.
 */
function buildSkillFileContent(agent: DeveloperTeamAgent): string {
  const content = getAgentContent(agent.id);
  if (!content) {
    throw new Error(`No content found for agent ${agent.id} in core registry.`);
  }

  return [
    "---",
    `description: ${agent.description}`,
    "---",
    "",
    content.skillBody,
    "",
  ].join("\n");
}

/**
 * OpenCode-specific frontmatter + body from the core registry.
 *
 * The adapter only adds minimal frontmatter (name, description, skill)
 * and wraps the registry's runner-agnostic agent body.
 */
function buildAgentFileContent(agent: DeveloperTeamAgent): string {
  const content = getAgentContent(agent.id);
  if (!content) {
    throw new Error(`No content found for agent ${agent.id} in core registry.`);
  }

  return [
    "---",
    `name: ${agent.name}`,
    `description: ${agent.description}`,
    `skill: ${agent.skillId}`,
    "---",
    "",
    content.agentBody,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export type FileBackupEntry = {
  absolutePath: string;
  /** null means the file did not exist before the install */
  previousContent: string | null;
};

export type BackupManifest = {
  entries: FileBackupEntry[];
};

export function backupDeveloperTeamFiles(
  plan: OpenCodeDeveloperTeamInstallPlan,
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

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

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

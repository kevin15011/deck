/**
 * Prompt file generation for OpenCode Developer Team.
 *
 * Generates thin wrapper prompt files in `~/.config/opencode/prompts/deck-developer/`.
 * Each prompt references the skill file at an absolute path.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import type { DeveloperTeamAgent } from "@deck/core/teams/developer/catalog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlannedPromptFile = {
  agent: DeveloperTeamAgent;
  absolutePath: string;
  content: string;
};

export type GeneratePromptFilesOptions = {
  configDir?: string;
  projectRoot?: string;
  /** Override writeFile for DI in tests */
  writeFile?: (path: string, content: string, encoding: "utf-8") => void;
  /** Override mkdir for DI in tests */
  mkdir?: (path: string, opts: { recursive: true }) => void;
};

// ---------------------------------------------------------------------------
// Orchestrator prompt template
// ---------------------------------------------------------------------------

function buildOrchestratorPrompt(skillPath: string): string {
  return [
    `You are the Deck Developer Team Orchestrator. Read your skill file at ${skillPath} and follow it exactly.`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Subagent prompt template
// ---------------------------------------------------------------------------

function buildSubagentPrompt(phase: string, skillPath: string): string {
  return [
    `You are a Deck Developer Team agent for the ${phase} phase, not the orchestrator. Do this phase's work yourself. Do NOT delegate, Do NOT call task/delegate, and Do NOT launch sub-agents. Read your skill file at ${skillPath} and follow it exactly.`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Phase name mapping
// ---------------------------------------------------------------------------

function getPhaseName(agentId: string): string {
  const map: Record<string, string> = {
    "deck-developer-orchestrator": "Orchestrator",
    "deck-developer-explorer": "Explorer",
    "deck-developer-proposal": "Proposal",
    "deck-developer-spec": "Spec",
    "deck-developer-design": "Design",
    "deck-developer-task": "Task",
    "deck-developer-apply-general": "Apply (General)",
    "deck-developer-apply-backend": "Apply (Backend)",
    "deck-developer-apply-frontend": "Apply (Frontend)",
    "deck-developer-verify": "Verify",
    "deck-developer-review": "Review",
    "deck-developer-archive": "Archive",
  };
  return map[agentId] ?? agentId;
}

// ---------------------------------------------------------------------------
// Generate plan
// ---------------------------------------------------------------------------

export function buildPromptGenerationPlan(options: { configDir: string; projectRoot: string }): PlannedPromptFile[] {
  const { configDir, projectRoot } = options;
  const promptsDir = join(configDir, "prompts", "deck-developer");

  return DEVELOPER_TEAM_AGENTS.map((agent): PlannedPromptFile => {
    const skillPath = join(projectRoot, ".opencode", "skills", agent.skillId, "SKILL.md");
    const promptPath = join(promptsDir, `${agent.id}.md`);
    const isOrchestrator = agent.id === "deck-developer-orchestrator";
    const content = isOrchestrator
      ? buildOrchestratorPrompt(skillPath)
      : buildSubagentPrompt(getPhaseName(agent.id), skillPath);

    return { agent, absolutePath: promptPath, content };
  });
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export function applyPromptGeneration(
  plan: PlannedPromptFile[],
  options?: GeneratePromptFilesOptions,
): void {
  const writeFile = options?.writeFile ?? writeFileSync;
  const mkdir = options?.mkdir ?? mkdirSync;

  for (const planned of plan) {
    const dir = dirname(planned.absolutePath);
    mkdir(dir, { recursive: true });
    writeFile(planned.absolutePath, planned.content, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Prompt file reference builder (for use by agent config generation)
// ---------------------------------------------------------------------------

/**
 * Build the OpenCode `{file:/absolute/path}` prompt reference for an agent.
 */
export function buildPromptReference(configDir: string, agentId: string): string {
  const promptPath = join(configDir, "prompts", "deck-developer", `${agentId}.md`);
  return `{file:${promptPath}}`;
}
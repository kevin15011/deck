/**
 * Prompt file generation for OpenCode Developer Team.
 *
 * Generates prompt files in `~/.config/opencode/prompts/deck-developer/`.
 * Prompts include the canonical system prompt from @deck/core so all runners
 * share the same orchestrator philosophy, delegation rules, and SDD workflow.
 * The adapter only formats for OpenCode's agent-prompt file convention.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import type { DeveloperTeamAgent } from "@deck/core/teams/developer/catalog";
import { getAgentContent, getTeamSessionInstructions } from "@deck/core/teams/developer/content-registry";
import type { CapabilityInstructionBundle } from "@deck/core";
import { type OrchestratorPersonality } from "@deck/core/config/deck-config";

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
  /** Optional capability instruction bundle for prompt content composition. */
  capabilityInstructions?: CapabilityInstructionBundle;
  /** Optional orchestrator personality for session prompt selection. */
  personality?: OrchestratorPersonality;
  /** Override writeFile for DI in tests */
  writeFile?: (path: string, content: string, encoding: "utf-8") => void;
  /** Override mkdir for DI in tests */
  mkdir?: (path: string, opts: { recursive: true }) => void;
};

// ---------------------------------------------------------------------------
// Prompt content builder using core content registry
// ---------------------------------------------------------------------------

function buildPromptContent(
  agent: DeveloperTeamAgent,
  skillPath: string,
  capabilityInstructions: CapabilityInstructionBundle | undefined,
  personality: OrchestratorPersonality | undefined,
): string {
  const content = getAgentContent(agent.id, capabilityInstructions ? { capabilityInstructions, personality } : { personality });
  if (!content) {
    throw new Error(`No content found for agent ${agent.id} in core registry.`);
  }

  const isOrchestrator = agent.id === "deck-developer-orchestrator";
  const baseContent = isOrchestrator
    ? (getTeamSessionInstructions("developer-team", { capabilityInstructions, personality }) ??
      content.agentBody)
    : content.agentBody;

  return [
    baseContent,
    "",
    "---",
    "",
    "## Skill Reference",
    "",
    `Read your skill file at ${skillPath} and follow it exactly.`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Generate plan
// ---------------------------------------------------------------------------

export function buildPromptGenerationPlan(
  options: { configDir: string; projectRoot: string; capabilityInstructions?: CapabilityInstructionBundle; personality?: OrchestratorPersonality },
): PlannedPromptFile[] {
  const { configDir, projectRoot, capabilityInstructions, personality } = options;
  const promptsDir = join(configDir, "prompts", "deck-developer");

  return DEVELOPER_TEAM_AGENTS.map((agent): PlannedPromptFile => {
    const skillPath = join(projectRoot, ".opencode", "skills", agent.skillId, "SKILL.md");
    const promptPath = join(promptsDir, `${agent.id}.md`);
    const content = buildPromptContent(agent, skillPath, capabilityInstructions, personality);

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

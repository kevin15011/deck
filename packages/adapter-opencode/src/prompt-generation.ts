/**
 * Prompt file generation for OpenCode Developer Team.
 *
 * Generates prompt files in `~/.config/opencode/prompts/deck-team/`.
 * Prompts include the canonical system prompt from @deck/core so all runners
 * share the same orchestrator philosophy, delegation rules, and SDD workflow.
 * The adapter only formats for OpenCode's agent-prompt file convention.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import type { DeveloperTeamAgent } from "@deck/core/teams/developer/catalog";
import { getAgentContent, getTeamSessionInstructions, type DeveloperTeamPromptProfileV1 } from "@deck/core/teams/developer/content-registry";
import type { CapabilityInstructionBundle } from "@deck/core";
import { type OrchestratorPersonality } from "@deck/core/config/deck-config";
import { type MemoryInjectionBundle } from "@deck/core/memory/adaptive-memory";
import { composeApplyAgentPrompt } from "@deck/core/teams/developer/orchestrator-content";
import type { ModificationAuthorization } from "../../core/src/teams/developer/orchestrator-invariants";

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
  /** Effective profile selected by the rollout gate. Defaults to legacy. */
  promptProfile?: DeveloperTeamPromptProfileV1;
  /** @deprecated OpenCode memory is owned by the official plugin; ignored. */
  memoryBundle?: MemoryInjectionBundle;
  /** @deprecated Raw Supermemory MCP detection no longer affects OpenCode prompts; ignored. */
  activeMemoryProviderFromConfig?: "supermemory";
  /**
   * Optional modification authorization for apply agents.
   * When provided for apply agents (general/backend/frontend), the authorization card
   * is injected at runtime into the prompt, satisfying REQ-OA-005.
   */
  authorization?: ModificationAuthorization;
  /** Override writeFile for DI in tests */
  writeFile?: (path: string, content: string, encoding: "utf-8") => void;
  /** Override mkdir for DI in tests */
  mkdir?: (path: string, opts: { recursive: true }) => void;
};

// ---------------------------------------------------------------------------
// Skill Loading Gate builder
// ---------------------------------------------------------------------------

/**
 * Build the mandatory skill loading gate that prepends all generated prompts.
 * This ensures the agent loads its corresponding skill BEFORE any reasoning or tool use.
 */
function buildSkillLoadingGate(skillId: string, skillPath: string): string {
  return [
    "# Skill Loading Gate",
    "",
    "**MANDATORY FIRST ACTION**: Before reading, analyzing, or using ANY tool, you MUST:",
    "",
    "1. Call the `skill` tool with `name` equal to your skillId:",
    "   - tool: skill",
    "   - arguments:",
    `     name: "${skillId}"`,
    "",
    "2. Wait for the skill content to be loaded.",
    "3. ONLY THEN proceed with reasoning, analysis, or tool invocations.",
    "",
    "**DO NOT** skip this step. The skill file is located at:",
    `**${skillPath}**`,
    "",
    "This ensures you have the exact workflow, testing rules, and return formats for this agent role before starting work.",
    "",
    "---",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Prompt content builder using core content registry
// ---------------------------------------------------------------------------

// Apply agent IDs - these receive authorization card injection at runtime
const APPLY_AGENT_IDS = [
  "deck-apply-fast",
  "deck-apply-deep",
] as const;

export function removeDeckMemoryClaimsForOpenCode(content: string): string {
  return content
    .split("\n")
    .map((line) => line
      .replace(
        "- Use only the configured capabilities relevant to the outcome. OpenSpec, source, tests, and current runner evidence outrank adaptive memory.",
        "- Use only the configured capabilities relevant to the outcome. OpenSpec, source, tests, and current runner evidence are authoritative.",
      )
      .replace("configured adaptive memory, and ", ""))
    .filter((line) => !/adaptive[ -](?:context|memory)/i.test(line))
    .join("\n");
}

/**
 * Build prompt content without Deck-owned memory policy. The official
 * Supermemory plugin owns all OpenCode memory behavior.
 *
 * @param agent - The agent to build prompt for
 * @param skillPath - Path to the skill file
 * @param capabilityInstructions - Optional capability instructions bundle
 * @param personality - Optional orchestrator personality
 * @param authorization - Optional modification authorization for apply agents (injects real authorization card at runtime)
 */
function buildPromptContent(
  agent: DeveloperTeamAgent,
  skillPath: string,
  capabilityInstructions: CapabilityInstructionBundle | undefined,
  personality: OrchestratorPersonality | undefined,
  promptProfile: DeveloperTeamPromptProfileV1,
  authorization?: ModificationAuthorization,
): string {
  const content = getAgentContent(agent.id, capabilityInstructions
    ? { capabilityInstructions, personality, promptProfile }
    : { personality, promptProfile });
  if (!content) {
    throw new Error(`No content found for agent ${agent.id} in core registry.`);
  }

  const isOrchestrator = agent.id === "deck-lead";
  let baseContent = isOrchestrator
    ? (getTeamSessionInstructions("developer-team", {
      capabilityInstructions,
      personality,
      promptProfile,
      skillDiscoveryRuntimeContext: { activeRunnerId: "opencode" },
    }) ??
      content.agentBody)
    : content.agentBody;
  baseContent = removeDeckMemoryClaimsForOpenCode(baseContent);

  // REQ-OA-005: Inject authorization card for apply agents when authorization is provided
  // This ensures the apply agent receives real authorization context at runtime,
  // making the Self-Rejection Instruction's "may proceed" clause reachable.
  const isApplyAgent = APPLY_AGENT_IDS.includes(agent.id as (typeof APPLY_AGENT_IDS)[number]);
  if (isApplyAgent && authorization) {
    baseContent = composeApplyAgentPrompt(baseContent, authorization);
  }

  // Prepend the Skill Loading Gate
  const skillLoadingGate = buildSkillLoadingGate(agent.skillId, skillPath);

  // Append skill reference
  const skillReference = [
    "---",
    "",
    "## Skill Reference",
    "",
    `Read your skill file at ${skillPath} and follow it exactly.`,
    "",
  ].join("\n");

  // Build final content: skill gate + canonical content + reference.
  return [
    skillLoadingGate,
    baseContent,
    skillReference,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Generate plan
// ---------------------------------------------------------------------------

export function buildPromptGenerationPlan(
  options: {
    configDir: string;
    projectRoot: string;
    capabilityInstructions?: CapabilityInstructionBundle;
    personality?: OrchestratorPersonality;
    promptProfile?: DeveloperTeamPromptProfileV1;
    /** @deprecated OpenCode memory is owned by the official plugin; ignored. */
    memoryBundle?: MemoryInjectionBundle;
    /** @deprecated Raw Supermemory MCP detection no longer affects OpenCode prompts; ignored. */
    activeMemoryProviderFromConfig?: "supermemory";
    /**
     * Optional modification authorization for apply agents.
     * When provided, authorization card is injected into apply-agent prompts (REQ-OA-005).
     */
    authorization?: ModificationAuthorization;
  },
): PlannedPromptFile[] {
  const { configDir, capabilityInstructions, personality, authorization } = options;
  const promptProfile = options.promptProfile ?? "compact";

  const effectiveCapabilityInstructions = capabilityInstructions
    ? { instructions: Object.freeze(capabilityInstructions.instructions.filter((fragment) => fragment.packageId !== "adaptive-memory")) }
    : undefined;

  const promptsDir = join(configDir, "prompts", "deck-team");

  return DEVELOPER_TEAM_AGENTS.map((agent): PlannedPromptFile => {
    const skillPath = join(configDir, "skills", agent.skillId, "SKILL.md");
    const promptPath = join(promptsDir, `${agent.id}.md`);
    const content = buildPromptContent(
      agent,
      skillPath,
      effectiveCapabilityInstructions,
      personality,
      promptProfile,
      authorization,
    );

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
  const promptPath = join(configDir, "prompts", "deck-team", `${agentId}.md`);
  return `{file:${promptPath}}`;
}

// ---------------------------------------------------------------------------
// Runtime authorization card injection (for orchestrator delegation)
// ---------------------------------------------------------------------------

/**
 * Compose an apply-agent prompt with authorization card at runtime.
 *
 * This function is called by the orchestrator when delegating modifying work
 * to an apply agent. It injects the authorization card (with change name,
 * task IDs, allowed file scope, and refusal instruction) into the base
 * apply-agent prompt.
 *
 * REQ-OA-005: The Orchestrator MUST inject a compact invariant/authorization
 * card into every apply-agent prompt so that specialist agents can self-reject
 * untriaged or unauthorized modifying work.
 *
 * @param basePrompt - The base apply-agent prompt content (e.g., from reading the prompt file)
 * @param auth - The modification authorization from the orchestrator's delegation context
 * @returns The composed prompt with authorization card prepended
 */
export function composeApplyAgentPromptWithAuth(
  basePrompt: string,
  auth: ModificationAuthorization,
): string {
  return composeApplyAgentPrompt(basePrompt, auth);
}

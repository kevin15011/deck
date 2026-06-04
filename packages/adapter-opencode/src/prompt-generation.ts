/**
 * Prompt file generation for OpenCode Developer Team.
 *
 * Generates prompt files in `~/.config/opencode/prompts/deck-developer/`.
 * Prompts include the canonical system prompt from @deck/core so all runners
 * share the same orchestrator philosophy, delegation rules, and SDD workflow.
 * The adapter only formats for OpenCode's agent-prompt file convention.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import type { DeveloperTeamAgent } from "@deck/core/teams/developer/catalog";
import { getAgentContent, getTeamSessionInstructions } from "@deck/core/teams/developer/content-registry";
import { buildAdaptiveMemoryInstructionBundle } from "../../core/src/teams/developer/instruction-bundles/adaptive-memory";
import type { CapabilityInstructionBundle } from "@deck/core";
import { type OrchestratorPersonality } from "@deck/core/config/deck-config";
import { type MemoryInjectionBundle, ADAPTIVE_MEMORY_SECTION_HEADING, ADAPTIVE_MEMORY_AUXILIARY_POLICY } from "@deck/core/memory/adaptive-memory";
import { composeApplyAgentPrompt } from "@deck/core/teams/developer/orchestrator-content";
import type { ModificationAuthorization } from "../../core/src/teams/developer/orchestrator-invariants";

// Provider IDs for isolation - ensure prompts don't mix tools from different providers
const VALID_SUPERMEMORY_TOOL_NAMES = ["memory", "recall", "whoAmI"];
const VALID_ENGRAM_TOOL_NAMES = ["mem_save", "mem_recall", "mem_context", "mem_search", "mem_get_observation"];

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
  /** Optional memory injection bundle for provider-specific instructions (supermemory/engram). */
  memoryBundle?: MemoryInjectionBundle;
  /**
   * Detected active memory provider from MCP config.
   * Used for provider filtering when memoryBundle is undefined (REQ-R25).
   * Pass "supermemory" or "engram" if MCP config has Supermemory server enabled.
   */
  activeMemoryProviderFromConfig?: "supermemory" | "engram";
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

/**
 * Determine the active memory provider from tool bindings or explicit config.
 * Returns "supermemory" or "engram" based on the tools present or explicit config.
 *
 * REQ-R25 (2026-05-29): When memoryBundle is undefined but MCP config has Supermemory
 * enabled, use the explicit provider for filtering to prevent Engram leak.
 *
 * R31 FIX: When explicitProvider is provided, prioritize it over bundle.toolBindings check.
 * This ensures provider detection works when we're injecting the default instruction bundle
 * (which has NO toolBindings) but the provider is known from config.
 */
function determineActiveProvider(
  bundle: MemoryInjectionBundle | undefined,
  explicitProvider?: "supermemory" | "engram",
): "supermemory" | "engram" | "unknown" {
  // R31 FIX: Priority is explicitProvider > bundle.tools check
  if (explicitProvider === "supermemory" || explicitProvider === "engram") {
    return explicitProvider;
  }

  if (!bundle || bundle.toolBindings.length === 0) {
    return "unknown";
  }

  // Collect all tool names from bindings
  const toolNames = new Set<string>();
  for (const binding of bundle.toolBindings) {
    for (const tool of binding.toolNames) {
      toolNames.add(tool);
    }
  }

  // Supermemory has memory + recall (Engram has listProjects)
  if (toolNames.has("memory") && toolNames.has("recall") && !toolNames.has("listProjects")) {
    return "supermemory";
  }
  if (toolNames.has("listProjects") || toolNames.has("mem_save")) {
    return "engram";
  }

  // Fallback: assume Supermemory if memory+recall present
  if (toolNames.has("memory") && toolNames.has("recall")) {
    return "supermemory";
  }

  return "unknown";
}

/**
 * Filter markdown content to exclude the inactive provider section.
 * Removes "### Provider: {otherProvider}" section and its content.
 *
 * Uses simple line-based filtering for robustness:
 * - Find line starting with "### Provider: {inactive}"
 * - Remove that line and all following lines until next "### " or "## " or end
 */
function filterProviderSections(
  markdown: string,
  activeProvider: "supermemory" | "engram" | "unknown",
): string {
  if (activeProvider === "unknown") {
    return markdown;
  }

  const inactiveProvider = activeProvider === "supermemory" ? "engram" : "supermemory";

  // Split into lines for easier processing
  const lines = markdown.split("\n");
  const filteredLines: string[] = [];
  let skipping = false;

  for (const line of lines) {
    // Check if this line starts the inactive provider section (case-insensitive)
    if (line.trim().toLowerCase() === `### provider: ${inactiveProvider}`.toLowerCase()) {
      skipping = true;
      continue;
    }

    // If we're skipping and hit a new section heading (### or ##), stop skipping
    if (skipping && (line.startsWith("### ") || line.startsWith("## "))) {
      skipping = false;
    }

    if (!skipping) {
      filteredLines.push(line);
    }
  }

  return filteredLines.join("\n").trim();
}

/**
 * Filter tool bindings to only include validated tools for the active provider.
 * This prevents cross-contamination between providers (e.g., Engram shouldn't receive Supermemory tools).
 */
function filterToolBindingsByProvider(
  bundle: MemoryInjectionBundle,
  providerId: string,
): MemoryInjectionBundle["toolBindings"] {
  const validToolNames =
    providerId === "supermemory" ? VALID_SUPERMEMORY_TOOL_NAMES : VALID_ENGRAM_TOOL_NAMES;

  return bundle.toolBindings.filter((binding) =>
    binding.toolNames.every((toolName) => validToolNames.includes(toolName)),
  );
}

/**
 * Build provider-specific adaptive memory content section.
 * Ensures provider isolation by excluding the inactive provider's section.
 * REQ-R25 (2026-05-29): Active provider determines which section appears.
 */
function buildProviderAdaptiveMemorySection(
  bundle: MemoryInjectionBundle | undefined,
  surface: "session" | "agent" | "skill",
  explicitProvider?: "supermemory" | "engram",
): string {
  if (!bundle || bundle.instructions.length === 0) {
    return "";
  }

  // Determine active provider from explicit config or tool bindings
  const activeProvider = determineActiveProvider(bundle, explicitProvider);

  // Filter fragments by surface context
  const matchingFragments = bundle.instructions.filter(
    (fragment) => fragment.surface === surface,
  );

  if (matchingFragments.length === 0) {
    return "";
  }

  // Filter markdown content to exclude inactive provider section
  const filteredMarkdown = matchingFragments.map((fragment) => ({
    ...fragment,
    markdown: filterProviderSections(fragment.markdown, activeProvider),
  }));

  // Build the adaptive memory section with explicit hierarchy
  const adaptiveSection = [
    ADAPTIVE_MEMORY_SECTION_HEADING,
    "",
    ADAPTIVE_MEMORY_AUXILIARY_POLICY,
    "",
    ...filteredMarkdown.flatMap((fragment) => [fragment.markdown.trim(), ""]),
  ]
    .join("\n")
    .trimEnd();

  return `\n\n---\n\n${adaptiveSection}\n`;
}

// ---------------------------------------------------------------------------
// Prompt content builder using core content registry
// ---------------------------------------------------------------------------

// Apply agent IDs - these receive authorization card injection at runtime
const APPLY_AGENT_IDS = [
  "deck-developer-apply-general",
  "deck-developer-apply-backend",
  "deck-developer-apply-frontend",
] as const;

/**
 * Build prompt content with optional explicit provider for filtering.
 * REQ-R25 (2026-05-29): explicitProvider enables filtering even when memoryBundle is undefined.
 *
 * @param agent - The agent to build prompt for
 * @param skillPath - Path to the skill file
 * @param capabilityInstructions - Optional capability instructions bundle
 * @param personality - Optional orchestrator personality
 * @param memoryBundle - Optional memory injection bundle
 * @param explicitProvider - Explicit provider for filtering
 * @param authorization - Optional modification authorization for apply agents (injects real authorization card at runtime)
 */
function buildPromptContent(
  agent: DeveloperTeamAgent,
  skillPath: string,
  capabilityInstructions: CapabilityInstructionBundle | undefined,
  personality: OrchestratorPersonality | undefined,
  memoryBundle?: MemoryInjectionBundle,
  explicitProvider?: "supermemory" | "engram",
  authorization?: ModificationAuthorization,
): string {
  const content = getAgentContent(agent.id, capabilityInstructions ? { capabilityInstructions, personality } : { personality });
  if (!content) {
    throw new Error(`No content found for agent ${agent.id} in core registry.`);
  }

  const isOrchestrator = agent.id === "deck-developer-orchestrator";
  let baseContent = isOrchestrator
    ? (getTeamSessionInstructions("developer-team", { capabilityInstructions, personality }) ??
      content.agentBody)
    : content.agentBody;

  // REQ-OA-005: Inject authorization card for apply agents when authorization is provided
  // This ensures the apply agent receives real authorization context at runtime,
  // making the Self-Rejection Instruction's "may proceed" clause reachable.
  const isApplyAgent = APPLY_AGENT_IDS.includes(agent.id as (typeof APPLY_AGENT_IDS)[number]);
  if (isApplyAgent && authorization) {
    baseContent = composeApplyAgentPrompt(baseContent, authorization);
  }

  // Determine surface for memory injection
  const memorySurface = agent.id === "deck-developer-orchestrator" ? "session" : "agent";
  const providerMemoryContent = buildProviderAdaptiveMemorySection(memoryBundle, memorySurface, explicitProvider);

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

  // REQ-R26: Filter provider sections from capabilityInstructions based on active provider.
  // When memoryBundle has tools OR explicitProvider from config, filter out the inactive provider's section
  // from the composed content (agentBody/skillBody that includes adaptive-memory instructions).
  const activeProvider = determineActiveProvider(memoryBundle, explicitProvider);
  const filteredBaseContent =
    activeProvider !== "unknown" ? filterProviderSections(baseContent, activeProvider) : baseContent;

  // Build final content: skill gate + filtered base content + provider-specific memory + reference
  return [
    skillLoadingGate,
    filteredBaseContent,
    providerMemoryContent,
    skillReference,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Generate plan
// ---------------------------------------------------------------------------

/**
 * Detect if Supermemory MCP server is configured in opencode.json.
 * Returns "supermemory" if supermemory server entry exists with valid config.
 * This enables provider filtering even when memoryBundle is undefined (REQ-R25).
 */
function detectSupermemoryProviderFromConfig(configDir: string): "supermemory" | "engram" | null {
  try {
    const configPath = join(configDir, "opencode.json");
    if (!existsSync(configPath)) {
      return null;
    }
    const content = readFileSync(configPath, "utf-8");
    const config = JSON.parse(content) as Record<string, unknown>;
    const mcp = config.mcp as Record<string, unknown> | undefined;

    if (!mcp) {
      return null;
    }

    // Check for supermemory server entry
    const smEntry = mcp.supermemory;
    if (
      smEntry &&
      typeof smEntry === "object" &&
      (smEntry as Record<string, unknown>).type === "remote"
    ) {
      return "supermemory";
    }

    return null;
  } catch {
    return null;
  }
}

export function buildPromptGenerationPlan(
  options: {
    configDir: string;
    projectRoot: string;
    capabilityInstructions?: CapabilityInstructionBundle;
    personality?: OrchestratorPersonality;
    /** Optional memory injection bundle for provider-specific adaptive memory injection. */
    memoryBundle?: MemoryInjectionBundle;
    /**
     * Detected active memory provider from MCP config.
     * Used for filtering when memoryBundle is undefined (REQ-R25).
     * Auto-detects from opencode.json if not provided.
     */
    activeMemoryProviderFromConfig?: "supermemory" | "engram";
    /**
     * Optional modification authorization for apply agents.
     * When provided, authorization card is injected into apply-agent prompts (REQ-OA-005).
     */
    authorization?: ModificationAuthorization;
  },
): PlannedPromptFile[] {
  const { configDir, projectRoot, capabilityInstructions, personality, memoryBundle, authorization } = options;

  // REQ-R25: Auto-detect provider from MCP config if not explicitly provided
  const explicitProvider =
    options.activeMemoryProviderFromConfig ?? detectSupermemoryProviderFromConfig(configDir);

  // R31: If a provider is detected but no memoryBundle is provided,
  // use the default instruction bundle so prompts include tool references.
  // This ensures Supermemory prompts have `memory`/`recall` even without explicit bundle.
  // Note: buildAdaptiveMemoryInstructionBundle returns CapabilityInstructionBundle, not MemoryInjectionBundle.
  const effectiveCapabilityInstructions = capabilityInstructions ?? (explicitProvider ? buildAdaptiveMemoryInstructionBundle() : undefined);

  const promptsDir = join(configDir, "prompts", "deck-developer");

  return DEVELOPER_TEAM_AGENTS.map((agent): PlannedPromptFile => {
    const skillPath = join(configDir, "skills", agent.skillId, "SKILL.md");
    const promptPath = join(promptsDir, `${agent.id}.md`);
    const content = buildPromptContent(
      agent,
      skillPath,
      effectiveCapabilityInstructions,
      personality,
      memoryBundle,
      explicitProvider ?? undefined,
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
  const promptPath = join(configDir, "prompts", "deck-developer", `${agentId}.md`);
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

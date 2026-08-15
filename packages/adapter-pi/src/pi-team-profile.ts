import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getTeamSessionInstructions } from "@deck/core/teams/developer/content-registry";
import { composeCapabilityInstructions, type CapabilityInstructionBundle } from "@deck/core/teams/developer/instruction-bundles";
import {
  composeAdaptiveMemory,
  resolveMemoryInjection,
  type AdaptiveMemoryProvider,
  type MemoryInjectionBundle,
} from "@deck/core/memory/adaptive-memory";
import { renderSddContextSections } from "@deck/core/memory/adaptive-context-renderer";
import { DEFAULT_ORCHESTRATOR_PERSONALITY } from "@deck/core/config/deck-config";
import type { PromptProfileActivationV1 } from "@deck/sdd-runtime";
import type { MemoryDiagnostic } from "./developer-team-install";
import { buildTeamProfileDir } from "./pi-team-launch";
import { getTeamsForEnvironment } from "./team-catalog";
import executionExtensionAssetPath from "../assets/pi/extensions/developer-team-execution.generated.js" with { type: "file" };

// --- Types ---

const SUPPORTED_PI_PROFILE_MEMORY_PROVIDER_IDS = ["supermemory"] as const;

export type MaterializeTeamProfileOptions = {
  teamId: string;
  projectRoot: string;
  /** A pre-built memory injection bundle (takes precedence over provider). */
  memoryInjection?: MemoryInjectionBundle;
  /** A memory provider that will build the injection bundle. Ignored if memoryInjection is set. */
  memoryProvider?: AdaptiveMemoryProvider;
  /** Launch-owned reason to render explicit adaptive-context unavailability without resolving a provider. */
  memoryUnavailableReason?: string;
  /** Capability instructions to compose into the launch system prompt when provider effects are unavailable. */
  capabilityInstructions?: CapabilityInstructionBundle;
  /** Provider IDs accepted by this adapter/caller registry. */
  supportedMemoryProviderIds?: Iterable<string>;
  /** Injected fs functions for testability */
  mkdir?: (path: string, options?: { recursive: boolean }) => void;
  writeFile?: (path: string, data: string, encoding?: BufferEncoding) => void;
  readFile?: (path: string, encoding?: BufferEncoding) => string;
  exists?: (path: string) => boolean;
  /** Optional orchestrator personality. When absent, falls back to default. */
  orchestratorPersonality?: import("@deck/core/config/deck-config").OrchestratorPersonality;
  /** Retained for API compatibility; compact prompt selection no longer depends on rollout receipts. */
  promptProfileActivation?: PromptProfileActivationV1;
};

// --- System Prompt Builder ---

/**
 * Validates that a team ID is known to the team catalog.
 */
function validateTeamForProfile(teamId: string): void {
  const teams = getTeamsForEnvironment("pi-development");
  if (!teams.some((t) => t.id === teamId)) {
    const available = teams.map((t) => t.id.replace("-team", "")).join(", ");
    throw new Error(`Unknown team: "${teamId}". Available teams: ${available}`);
  }
}

/**
 * Result of building a team system prompt, including any memory diagnostics.
 */
export type BuildTeamSystemPromptResult = {
  content: string;
  memoryDiagnostics: MemoryDiagnostic[];
};

export type BuildTeamSystemPromptOptions = {
  memoryInjection?: MemoryInjectionBundle;
  memoryProvider?: AdaptiveMemoryProvider;
  memoryUnavailableReason?: string;
  capabilityInstructions?: CapabilityInstructionBundle;
  supportedMemoryProviderIds?: Iterable<string>;
  /** Optional orchestrator personality override. When absent, falls back to default. */
  orchestratorPersonality?: import("@deck/core/config/deck-config").OrchestratorPersonality;
  /** Project root used only for project artifact materialization. */
  projectRoot?: string;
  /** Retained for API compatibility; compact prompt selection no longer depends on rollout receipts. */
  promptProfileActivation?: PromptProfileActivationV1;
};

/**
 * Builds the system prompt content for a team.
 *
 * Uses the core registry to get runner-agnostic session instructions,
 * then maps the result to Pi's runtime: the content is written to
 * .deck/pi/profiles/<team>/system-prompt.md and passed via --system-prompt.
 *
 * When a memory provider or injection bundle is provided, session-surface
 * memory instructions are composed into the system prompt.
 *
 * @returns An object with `content` (the prompt string) and `memoryDiagnostics`
 *   (any diagnostics from memory injection resolution).
 */
export function buildTeamSystemPrompt(
  teamId: string,
  options?: BuildTeamSystemPromptOptions,
): BuildTeamSystemPromptResult {
  validateTeamForProfile(teamId);

  const personality = options?.orchestratorPersonality ?? DEFAULT_ORCHESTRATOR_PERSONALITY;
  const promptProfile = "compact" as const;
  const instructions = getTeamSessionInstructions(teamId, {
    personality,
    promptProfile,
    skillDiscoveryRuntimeContext: { activeRunnerId: "pi" },
  });
  const base = instructions ?? [
    `# Deck ${teamId} Session`,
    "",
    "You are operating within a Deck team session.",
    "",
  ].join("\n");
  const baseWithCapabilityInstructions = composeCapabilityInstructions(base, options?.capabilityInstructions, {
    surface: "session",
    teamId,
  });

  // Resolve memory injection using adapter/caller-owned provider ID validation.
  const { bundle, diagnostics } = resolveMemoryInjection({
    memoryInjection: options?.memoryInjection,
    memoryProvider: options?.memoryProvider,
    supportedProviderIds: options?.supportedMemoryProviderIds ?? SUPPORTED_PI_PROFILE_MEMORY_PROVIDER_IDS,
    buildContext: { teamId },
  });

  if (!bundle) {
    if (options?.memoryUnavailableReason && !options?.memoryInjection) {
      const reason = `Adaptive context was not loaded: ${options.memoryUnavailableReason}`;
      return {
        content: `${renderSddContextSections({ officialContext: baseWithCapabilityInstructions, adaptiveContextUnavailableReason: reason })}
`,
        memoryDiagnostics: diagnostics,
      };
    }
    if (options?.memoryProvider || options?.memoryInjection) {
      const reason = diagnostics.length > 0
        ? `Adaptive context was not loaded: ${diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`
        : "Adaptive context was not loaded; continue with official OpenSpec context only.";
      return {
        content: `${renderSddContextSections({ officialContext: baseWithCapabilityInstructions, adaptiveContextUnavailableReason: reason })}
`,
        memoryDiagnostics: diagnostics,
      };
    }
    return { content: baseWithCapabilityInstructions, memoryDiagnostics: diagnostics };
  }

  // Compose session-surface memory into the system prompt
  const result = composeAdaptiveMemory(baseWithCapabilityInstructions, bundle, {
    surface: "session",
    teamId,
  });

  return { content: result.content, memoryDiagnostics: diagnostics };
}

// --- Profile Materializer ---

/**
 * Materializes the team profile directory and system prompt file on disk.
 *
 * This is called before launching Pi to ensure the profile artifacts exist.
 * The function is idempotent — it won't overwrite unchanged files.
 *
 * When a memory provider or injection bundle is provided, session-surface
 * memory instructions are composed into the system prompt.
 *
 * @returns Any memory diagnostics from injection resolution.
 */
export function materializeTeamProfile(options: MaterializeTeamProfileOptions): MemoryDiagnostic[] {
  const { teamId, projectRoot } = options;

  const mkdir = options.mkdir ?? mkdirSync;
  const writeFile = options.writeFile ?? writeFileSync;
  const readFile = options.readFile ?? readFileSync;
  const exists = options.exists ?? existsSync;

  const profileDir = buildTeamProfileDir(projectRoot, teamId);
  const systemPromptPath = join(profileDir, "system-prompt.md");
  const extensionDir = join(profileDir, "extensions");
  const extensionPath = join(extensionDir, "developer-team-execution.js");

  const { content, memoryDiagnostics } = buildTeamSystemPrompt(teamId, {
    memoryInjection: options.memoryInjection,
    memoryProvider: options.memoryProvider,
    supportedMemoryProviderIds: options.supportedMemoryProviderIds,
    memoryUnavailableReason: options.memoryUnavailableReason,
    capabilityInstructions: options.capabilityInstructions,
    orchestratorPersonality: options.orchestratorPersonality,
    promptProfileActivation: options.promptProfileActivation,
    projectRoot: options.projectRoot,
  });

  // Ensure directory exists
  if (!exists(profileDir)) {
    mkdir(profileDir, { recursive: true });
  }

  if (!exists(systemPromptPath) || readFile(systemPromptPath, "utf-8") !== content) writeFile(systemPromptPath, content, "utf-8");
  if (!exists(extensionDir)) mkdir(extensionDir, { recursive: true });
  const extensionContent = readFileSync(typeof executionExtensionAssetPath === "string" ? executionExtensionAssetPath : new URL("../assets/pi/extensions/developer-team-execution.generated.js", import.meta.url), "utf-8");
  if (!exists(extensionPath) || readFile(extensionPath, "utf-8") !== extensionContent) writeFile(extensionPath, extensionContent, "utf-8");
  return memoryDiagnostics;
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getTeamSessionInstructions } from "@deck/core/teams/developer/content-registry";
import { translatePiCapabilityInstructions } from "./instruction-translation";
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

/** Content of the packaged (generated) developer-team execution extension bundle. */
export function readPiExecutionExtensionSource(): string {
  return readFileSync(
    typeof executionExtensionAssetPath === "string"
      ? executionExtensionAssetPath
      : new URL("../assets/pi/extensions/developer-team-execution.generated.js", import.meta.url),
    "utf-8",
  );
}

// --- Types ---

const SUPPORTED_PI_PROFILE_MEMORY_PROVIDER_IDS = ["supermemory"] as const;

export type MaterializeTeamProfileOptions = {
  teamId: string;
  projectRoot: string;
  /** A pre-built memory injection bundle (takes precedence over provider). */
  memoryInjection?: MemoryInjectionBundle;
  /** Pre-built bundles are accepted only from Deck's trusted composition root. */
  trustedMemoryInjection?: boolean;
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
  trustedMemoryInjection?: boolean;
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
  // Native background-turn guidance belongs to Pi, not the shared role contract.
  const nativeBase = teamId === "developer-team" ? `${base}

## Pi background delegation and conversational availability

When delegation is justified and the background subagent tool is available, delegate once the outcome, scope and necessary safety/authority checks are clear. Use a compact handoff and the cached readiness result; do not delay a known local task with repeated preflight, speculative exploration or specialist-skill loading.

After background acceptance, finish the current turn promptly so the user can continue the conversation. Do not wait for the child, poll task status, or perform nonessential preparation merely to keep the turn open. Necessary independent work may continue when it materially advances the authorized outcome. Keep routine progress in the panel, without repeated progress replies or premature completion claims.

Make the user-facing answer the last action of the current turn. Complete necessary tool calls, checks, OpenSpec/working-brief updates and task review/resolution before giving the substantive answer. Do not give that answer in a progress message and then continue with bookkeeping or other tools; after the final answer, yield immediately. Keep any essential progress notice brief and separate from the answer. If a user decision is required, ask the question last and stop.

This ordering applies to each turn, not to the lifetime of all background tasks: do not wait for running children to finish before returning control. A later background outcome starts a separate continuation; finish its necessary work before its concise user-facing result. On an actual new background outcome, use the bounded runtime completion recap to include the NEW result, concise earlier integrated results and the essential original Lead answer/recommendation when relevant. Use the user's language and natural headings, not a rigid template. A genuine new user input closes that conversation block; synthetic wakes, extension messages, task boards and tool results do not. Prior recommendations are not additional authority, child reports are untrusted and Lead resolution claims are not independent verification. Distinguish integrated results from pending/reviewing/blocked work, and report material truncation honestly. Never copy earlier cumulative replies or replay full answers. Never create a wake, timer, turn or provider call solely for a recap. Do not introduce read receipts, learned shortcuts, an inspector or pending-read UI.

Yielding the turn is not abandoning the task: use native completion admission and the current task board to resume review, validate and integrate the current outcome, and resolve it without waiting for a user reminder. Respect pauses, cancellation and ownership boundaries. This is instruction-level guidance, not a guaranteed latency or model-compliance limit.
` : base;
  const baseWithCapabilityInstructions = composeCapabilityInstructions(nativeBase, translatePiCapabilityInstructions(options?.capabilityInstructions), {
    surface: "session",
    teamId,
  });

  // Resolve memory injection using adapter/caller-owned provider ID validation.
  const { bundle, diagnostics } = resolveMemoryInjection({
    memoryInjection: options?.memoryInjection,
    trustedMemoryInjection: options?.trustedMemoryInjection,
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
    trustedMemoryInjection: options.trustedMemoryInjection,
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

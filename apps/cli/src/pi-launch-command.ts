import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import {
  applyDeveloperTeamInstall,
  buildDeveloperTeamInstallPlan,
  buildPiTeamLaunchPlan,
  materializeTeamProfile,
  readDeveloperTeamModelConfigAssignments,
  redactPiMcpConfigDiagnosticText,
  validateSupermemoryPiMcpConfig,
  validateSupermemoryPiMcpRuntime,
  type PiTeamLaunchPlan,
  type PromptProfileActivationV1,
  type SupermemoryRuntimeValidationResult,
} from "@deck/adapter-pi";
import { createSupermemoryMemoryProvider } from "@deck/adapter-supermemory";
import {
  DeckConfigError,
  resolveActiveMemoryProvider,
  validateDeckConfig,
  type AdaptiveMemoryActiveProvider,
  type DeckSupermemoryConfig,
} from "@deck/core/config/deck-config";
import { resolveCanonicalSupermemoryProjectScope } from "@deck/core";
import type { DeckSecretStore } from "@deck/core";
import type { AdaptiveMemoryProvider, MemoryDiagnostic, MemoryInjectionBundle } from "@deck/core/memory/adaptive-memory";
import type { SupermemoryRuntimeTransport } from "@deck/adapter-supermemory/runtime";
import { getStandaloneSkill, getStandaloneSkills } from "@deck/core/skills/external";
import {
  buildCapabilityInstructionBundle,
  getEnabledCapabilityInstructionIds,
  type CapabilityInstructionBundle,
} from "@deck/core/teams/developer/instruction-bundles";
import { createSupermemoryRuntimeHost, type SupermemoryRunnerLoopbackBridge } from "./supermemory-runtime-host";

// --- Types ---

const SUPPORTED_PI_LAUNCH_MEMORY_PROVIDER_IDS = ["supermemory"] as const;

type SupermemoryRuntimeValidator = (options: {
  serverName?: string;
  configPath?: string;
  homeDir?: string;
  timeoutMs?: number;
}) => Promise<SupermemoryRuntimeValidationResult>;

export type RunPiLaunchOptions = {
  teamId: string;
  projectRoot: string;
  flags: {
    continue?: boolean;
    resume?: boolean;
  };
  /** Legacy/pre-constructed memory provider. Prefer cliMemoryProvider/config resolution for launch paths. */
  memoryProvider?: AdaptiveMemoryProvider;
  /** Explicit CLI provider override from --memory. Precedence: CLI > global Deck config > none. */
  cliMemoryProvider?: string;
  /** Optional in-memory Deck config override for tests and production composition. */
  deckConfig: unknown;
  /** Direct dashboard selection; normalized through the same safe config path as global Deck config. */
  activeProvider?: AdaptiveMemoryActiveProvider;
  /** Non-secret Supermemory config from dashboard/global Deck config. Never include tokens here. */
  supermemory?: DeckSupermemoryConfig;
  /** Provider IDs accepted by this launch surface. Defaults to Pi-supported providers. */
  supportedMemoryProviderIds?: Iterable<string>;
  /** Override for validating Pi global MCP config before Supermemory injection. */
  piMcpConfigPath?: string;
  /** Override home directory used to resolve the default Pi global MCP config path. */
  piMcpHomeDir?: string;
  /** Override for authenticated Supermemory runtime validation. */
  supermemoryRuntimeValidator?: SupermemoryRuntimeValidator;
  /** Per-request Supermemory validation timeout for each non-mutating probe. Defaults to 3000ms. */
  supermemoryValidationTimeoutMs?: number;
  supermemoryRuntime?: { secretStore?: DeckSecretStore; apiKey?: string; transport?: SupermemoryRuntimeTransport; stateHome?: string };
  /** Check if a command exists in PATH */
  commandExists?: (command: string) => boolean;
  /** Override the Pi command path */
  piCommand?: string;
  /** Retained for API compatibility; compact prompts are active by default. */
  promptProfileActivation?: PromptProfileActivationV1;
  /** If true, don't spawn Pi — just return the plan */
  dryRun?: boolean;
};

export type MemoryProviderDiagnostic = {
  code: "unsupported_memory_provider" | "memory_provider_unavailable" | "multiple_memory_providers" | "untrusted_memory_injection" | "supermemory_runtime";
  message: string;
  providerId?: string;
};

export type PiLaunchResult =
  | { status: "error"; message: string; memoryDiagnostics: MemoryProviderDiagnostic[] }
  | { status: "ready"; plan: PiTeamLaunchPlan; profileDir: string; memoryDiagnostics: MemoryProviderDiagnostic[]; loopbackBridge?: SupermemoryRunnerLoopbackBridge }
  | { status: "launched"; plan: PiTeamLaunchPlan; memoryDiagnostics: MemoryProviderDiagnostic[]; loopbackBridge?: SupermemoryRunnerLoopbackBridge };

export type ResolvedPiAdaptiveMemoryProvider = {
  provider?: AdaptiveMemoryProvider;
  memoryInjection?: MemoryInjectionBundle;
  memoryUnavailableReason?: string;
  diagnostics: MemoryProviderDiagnostic[];
};

export type ResolvePiAdaptiveMemoryProviderOptions = {
  /** Preconstructed provider from an install/dashboard flow. Cannot be combined with config resolution. */
  memoryProvider?: AdaptiveMemoryProvider;
  /** CLI override; precedence remains CLI > Deck config > none for launch. */
  cliMemoryProvider?: string;
  /** Project root used for diagnostics and runner-native materialization; not a preference source. */
  projectRoot?: string;
  /** Required in production launch paths; tests may use the explicit legacy-compatibility wrapper. */
  deckConfig?: unknown;
  /** Direct dashboard selection; enables immediate provider construction without writing secrets to Deck config. */
  activeProvider?: AdaptiveMemoryActiveProvider;
  /** Non-secret Supermemory config from dashboard/global Deck config. Never include tokens here. */
  supermemory?: DeckSupermemoryConfig;
  supportedMemoryProviderIds?: Iterable<string>;
  piMcpConfigPath?: string;
  piMcpHomeDir?: string;
  unavailableContext?: "launch" | "install";
};

type ResolvedActiveMemory = {
  activeProvider: AdaptiveMemoryActiveProvider;
  supermemory?: DeckSupermemoryConfig;
};

type ResolvedLaunchMemory = ResolvedPiAdaptiveMemoryProvider;

// --- Command ---

/**
 * Prepares and optionally launches a Pi session for a Deck team.
 *
 * Memory provider resolution uses CLI > Deck config > none and constructs
 * exactly one provider. Supermemory injection is fail-closed: missing/incomplete
 * non-secret config, missing/malformed Pi MCP config, or failing provider health
 * launches without adaptive-memory injection and returns redacted diagnostics.
 */
export async function runPiLaunch(options: RunPiLaunchOptions): Promise<PiLaunchResult> {
  if (options.deckConfig === undefined && !options.memoryProvider) {
    return {
      status: "error",
      memoryDiagnostics: [{ code: "memory_provider_unavailable", message: "Global Deck config is not ready: DECK_CONFIG_REQUIRED at config." }],
      message: "Pi launch requires a valid caller-resolved global Deck config.",
    };
  }
  const { teamId, projectRoot, flags, dryRun = false } = options;
  const commandExists = options.commandExists ?? defaultCommandExists;
  const piCommand = options.piCommand ?? "pi";
  const supportedMemoryProviderIds = options.supportedMemoryProviderIds ?? SUPPORTED_PI_LAUNCH_MEMORY_PROVIDER_IDS;

  if (!commandExists(piCommand)) {
    return {
      status: "error",
      memoryDiagnostics: [],
      message: `Pi command not found: "${piCommand}". Install Pi first or check your PATH.`,
    };
  }

  const resolvedMemory = await resolveLaunchMemoryProvider(options);
  const allDiagnostics: MemoryProviderDiagnostic[] = [...resolvedMemory.diagnostics];
  const capabilityInstructions = buildPiLaunchCapabilityInstructions(options);
  let runtimeMemoryInjection: MemoryInjectionBundle | undefined;
  let loopbackBridge: SupermemoryRunnerLoopbackBridge | undefined;
  if (options.deckConfig !== undefined) {
    try {
      const deckConfig = validateDeckConfig(options.deckConfig);
      const runtimeDeckConfig = options.cliMemoryProvider === "none"
        ? { ...deckConfig, adaptiveMemory: { ...deckConfig.adaptiveMemory, enabled: false, activeProvider: "none" as const } }
        : options.cliMemoryProvider === "supermemory"
          ? { ...deckConfig, adaptiveMemory: { ...deckConfig.adaptiveMemory, enabled: true, activeProvider: "supermemory" as const } }
          : deckConfig;
      const runtimeHost = await createSupermemoryRuntimeHost({
        projectRoot,
        teamId,
        deckConfig: runtimeDeckConfig,
        runnerId: "pi",
        role: "lead",
        launchMode: "interactive",
        secretStore: options.supermemoryRuntime?.secretStore,
        apiKey: options.supermemoryRuntime?.apiKey,
        transport: options.supermemoryRuntime?.transport,
        stateHome: options.supermemoryRuntime?.stateHome,
        deferInitialRecallToLoopback: true,
      });
      allDiagnostics.push(...runtimeHost.diagnostics.filter((diagnostic) => diagnostic.severity !== "info").map((diagnostic) => ({ code: "supermemory_runtime" as const, providerId: "supermemory", message: diagnostic.message })));
      loopbackBridge = runtimeHost.enabled && !dryRun ? await runtimeHost.startLoopbackBridge() : undefined;
    } catch (error) {
      allDiagnostics.push({ code: "supermemory_runtime", providerId: "supermemory", message: redactedConfigErrorMessage(error, "launch") });
    }
  }

  const profileDiagnostics = materializeTeamProfile({
    teamId,
    projectRoot,
    supportedMemoryProviderIds,
    ...(runtimeMemoryInjection ?? resolvedMemory.memoryInjection ? { memoryInjection: runtimeMemoryInjection ?? resolvedMemory.memoryInjection } : {}),
    ...(runtimeMemoryInjection ?? resolvedMemory.memoryInjection ? { trustedMemoryInjection: true } : {}),
    ...(resolvedMemory.provider ? { memoryProvider: resolvedMemory.provider } : {}),
    ...(resolvedMemory.memoryUnavailableReason ? { memoryUnavailableReason: resolvedMemory.memoryUnavailableReason } : {}),
    ...(capabilityInstructions ? { capabilityInstructions } : {}),
    promptProfileActivation: options.promptProfileActivation,
  });

  allDiagnostics.push(...profileDiagnostics.map(toLaunchMemoryDiagnostic));

  if (resolvedMemory.provider || resolvedMemory.memoryInjection || resolvedMemory.memoryUnavailableReason) {
    const { modelAssignments, thinkingAssignments } = readDeveloperTeamModelConfigAssignments(projectRoot);
    const standaloneSkills = getStandaloneSkills().map((skill) => {
      const bundle = getStandaloneSkill(skill.skillId);
      return { skillId: skill.skillId, body: bundle.SKILL, files: bundle.files };
    });
    const installPlan = buildDeveloperTeamInstallPlan(projectRoot, {
      ...(runtimeMemoryInjection ?? resolvedMemory.memoryInjection ? { memoryInjection: runtimeMemoryInjection ?? resolvedMemory.memoryInjection } : {}),
      ...(runtimeMemoryInjection ?? resolvedMemory.memoryInjection ? { trustedMemoryInjection: true } : {}),
      ...(resolvedMemory.provider ? { memoryProvider: resolvedMemory.provider } : {}),
      supportedMemoryProviderIds,
      modelAssignments,
      thinkingAssignments,
      preserveMissingThinkingAssignments: true,
      ...(capabilityInstructions ? { capabilityInstructions } : {}),
      standaloneSkills,
      piMcpConfigPath: options.piMcpConfigPath,
      piMcpHomeDir: options.piMcpHomeDir,
      promptProfileActivation: options.promptProfileActivation,
    });
    applyDeveloperTeamInstall(installPlan);
    allDiagnostics.push(...installPlan.memoryDiagnostics.map(toLaunchMemoryDiagnostic));
  }

  const plan = buildPiTeamLaunchPlan({ teamId, projectRoot, flags, piCommand });
  if (loopbackBridge) Object.assign(plan.env, Object.fromEntries(Object.entries(loopbackBridge.envOverlay).map(([key, entry]) => [key, entry.value])));
  const memoryDiagnostics = dedupeDiagnostics(allDiagnostics);

  if (dryRun) {
    return { status: "ready", plan, profileDir: plan.profileDir, memoryDiagnostics, ...(loopbackBridge ? { loopbackBridge } : {}) };
  }

  return { status: "launched", plan, memoryDiagnostics, ...(loopbackBridge ? { loopbackBridge } : {}) };
}

function buildPiLaunchCapabilityInstructions(options: RunPiLaunchOptions): CapabilityInstructionBundle | undefined {
  try {
    const deckConfig = validateDeckConfig(options.deckConfig);
    const enabledIds = getEnabledCapabilityInstructionIds(deckConfig, "pi");
    const activeMemoryEnabled = options.activeProvider === "supermemory" || deckConfig.adaptiveMemory.enabled === true;
    if (activeMemoryEnabled && !enabledIds.includes("adaptive-memory")) {
      enabledIds.push("adaptive-memory");
    }
    if (enabledIds.length === 0) return undefined;
    const derived = resolveCanonicalSupermemoryProjectScope({ projectRoot: options.projectRoot, remotes: [] });
    return buildCapabilityInstructionBundle(enabledIds, {
      supermemoryProjectScope: derived.ok ? derived.scope : undefined,
    });
  } catch {
    return undefined;
  }
}


async function resolveLaunchMemoryProvider(options: RunPiLaunchOptions): Promise<ResolvedLaunchMemory> {
  const diagnostics: MemoryProviderDiagnostic[] = [];

  if (options.memoryProvider && hasConfigResolutionInput(options)) {
    return {
      diagnostics: [
        {
          code: "multiple_memory_providers",
          providerId: options.memoryProvider.id,
          message: "Exactly one adaptive-memory provider may be active; preconstructed provider cannot be combined with CLI/config/dashboard resolution.",
        },
      ],
    };
  }

  if (options.memoryProvider) {
    return { provider: options.memoryProvider, diagnostics };
  }

  const resolved = resolveActiveProviderInput(options);
  if ("diagnostics" in resolved) return resolved;

  const activeProvider = resolved.activeProvider;
  if (activeProvider === "none") return { diagnostics };

  if (!supportsProvider(activeProvider, options.supportedMemoryProviderIds ?? SUPPORTED_PI_LAUNCH_MEMORY_PROVIDER_IDS)) {
    return {
      diagnostics: [
        {
          code: "unsupported_memory_provider",
          providerId: activeProvider,
          message: `Unsupported memory provider '${activeProvider}'; launched without adaptive-memory injection.`,
        },
      ],
    };
  }

  if (activeProvider === "supermemory") {
    const supermemory = resolved.supermemory;
    // Token-only config: configured check removed since DeckSupermemoryConfig no longer
    // carries a configured flag — runtime validation below handles availability.

    const validator = options.supermemoryRuntimeValidator ?? validateSupermemoryPiMcpRuntime;
    const runtimeValidation = await validator({
      serverName: supermemory?.mcpServerName ?? "supermemory",
      configPath: options.piMcpConfigPath,
      homeDir: options.piMcpHomeDir,
      timeoutMs: options.supermemoryValidationTimeoutMs ?? 3000,
    });

    if (!runtimeValidation.ok) {
      const detail = runtimeValidation.diagnostics.map((diagnostic) => [diagnostic.message, diagnostic.detail].filter(Boolean).join(" ")).join(" ");
      const message = redactLaunchDiagnosticText(`Supermemory runtime validation failed; launched without adaptive-memory injection. ${detail}`.trim());
      return { diagnostics: [{ code: "memory_provider_unavailable", providerId: "supermemory", message }], memoryUnavailableReason: message };
    }

    try {
      const derived = resolveCanonicalSupermemoryProjectScope({ projectRoot: options.projectRoot, remotes: [] });
      if (!derived.ok) {
        const message = "Supermemory project identity is missing or invalid; launched without adaptive-memory injection.";
        return { diagnostics: [{ code: "memory_provider_unavailable", providerId: "supermemory", message }], memoryUnavailableReason: message };
      }
      const provider = createSupermemoryMemoryProvider({
        mcpServerName: runtimeValidation.serverName,
        authenticatedRuntimeValidated: true,
        projectScope: derived.scope,
      });
      return { memoryInjection: provider.buildInjection({}), diagnostics };
    } catch (error) {
      if (error instanceof Error && error.message.includes("Container tag")) return providerConstructionUnavailable("supermemory", "launch");
      const message = redactLaunchDiagnosticText(`Supermemory provider could not build validated adaptive-memory injection; launched without adaptive-memory injection. ${error instanceof Error ? error.message : String(error)}`);
      return { diagnostics: [{ code: "memory_provider_unavailable", providerId: "supermemory", message }], memoryUnavailableReason: message };
    }
  }

  return { diagnostics };
}

function resolveActiveProviderInput(options: ResolvePiAdaptiveMemoryProviderOptions): ResolvedActiveMemory | { diagnostics: MemoryProviderDiagnostic[] } {
  if (options.activeProvider !== undefined) {
    try {
      const normalized = validateDeckConfig({
        version: 1,
        adaptiveMemory: {
          activeProvider: options.activeProvider,
          ...(options.supermemory !== undefined ? { supermemory: options.supermemory } : {}),
        },
      });
      return {
        activeProvider: normalized.adaptiveMemory.activeProvider,
        supermemory: normalized.adaptiveMemory.supermemory,
      };
    } catch (error) {
      return {
        diagnostics: [
          {
            code: "memory_provider_unavailable",
            providerId: inferProviderIdFromError(error) ?? inferProviderId(options.activeProvider, { adaptiveMemory: { activeProvider: options.activeProvider } }),
            message: redactedConfigErrorMessage(error, options.unavailableContext ?? "launch"),
          },
        ],
      };
    }
  }

  let resolved: ReturnType<typeof resolveActiveMemoryProvider>;
  try {
    resolved = resolveActiveMemoryProvider({
      cliProvider: options.cliMemoryProvider,
      ...(options.deckConfig !== undefined ? { config: options.deckConfig } : { projectRoot: options.projectRoot }),
    });
  } catch (error) {
    return {
      diagnostics: [
        {
          code: "memory_provider_unavailable",
          providerId: inferProviderIdFromError(error) ?? inferProviderId(options.cliMemoryProvider, options.deckConfig),
          message: redactedConfigErrorMessage(error, options.unavailableContext ?? "launch"),
        },
      ],
    };
  }

  return { activeProvider: resolved.activeProvider, supermemory: resolved.supermemory };
}

function hasConfigResolutionInput(options: ResolvePiAdaptiveMemoryProviderOptions): boolean {
  return options.cliMemoryProvider !== undefined
    || options.deckConfig !== undefined
    || options.activeProvider !== undefined
    || options.supermemory !== undefined;
}

/**
 * Shared Pi adaptive-memory provider resolver for TUI install paths.
 * It has no import-time side effects and never persists Supermemory tokens to
 * Deck config; callers must hand off credentials through Pi MCP config.
 */
export async function resolvePiAdaptiveMemoryProvider(
  options: ResolvePiAdaptiveMemoryProviderOptions,
): Promise<ResolvedPiAdaptiveMemoryProvider> {
  const diagnostics: MemoryProviderDiagnostic[] = [];
  const context = options.unavailableContext ?? "launch";

  if (options.memoryProvider && hasConfigResolutionInput(options)) {
    return {
      diagnostics: [
        {
          code: "multiple_memory_providers",
          providerId: options.memoryProvider.id,
          message: "Exactly one adaptive-memory provider may be active; preconstructed provider cannot be combined with CLI/config/dashboard resolution.",
        },
      ],
    };
  }

  if (options.memoryProvider) return { provider: options.memoryProvider, diagnostics };

  const resolved = resolveActiveProviderInput(options);
  if ("diagnostics" in resolved) return resolved;

  const activeProvider = resolved.activeProvider;
  if (activeProvider === "none") return { diagnostics };

  if (!supportsProvider(activeProvider, options.supportedMemoryProviderIds ?? SUPPORTED_PI_LAUNCH_MEMORY_PROVIDER_IDS)) {
    return {
      diagnostics: [
        {
          code: "unsupported_memory_provider",
          providerId: activeProvider,
          message: `Unsupported memory provider '${activeProvider}'; ${context === "install" ? "installed" : "launched"} without adaptive-memory injection.`,
        },
      ],
    };
  }

  if (activeProvider === "supermemory") {
    const supermemory = resolved.supermemory;
    // Token-only config: configured check removed since DeckSupermemoryConfig no longer
    // carries a configured flag — MCP config validation below handles availability.

    const mcpValidation = validateSupermemoryPiMcpConfig({
      serverName: supermemory?.mcpServerName ?? "supermemory",
      configPath: options.piMcpConfigPath,
      homeDir: options.piMcpHomeDir,
    });

    if (!mcpValidation.ok) {
      return unavailable(
        "supermemory",
        `Supermemory Pi MCP config is unavailable or invalid; ${context === "install" ? "installed" : "launched"} without adaptive-memory injection. ${mcpValidation.diagnostics.map((diagnostic) => diagnostic.message).join(" ")}`,
      );
    }

    const derived = options.projectRoot
      ? resolveCanonicalSupermemoryProjectScope({ projectRoot: options.projectRoot, remotes: [] })
      : undefined;
    if (!derived?.ok || derived.scope !== mcpValidation.projectScope) {
      return unavailable(
        "supermemory",
        `Supermemory Pi MCP config scope is unavailable or does not match the canonical project scope; ${context === "install" ? "installed" : "launched"} without adaptive-memory injection.`,
      );
    }

    try {
      const provider = createSupermemoryMemoryProvider({
        // Token-only: user identity derived from token; project scope requires header + explicit per-operation containerTag.
        mcpServerName: mcpValidation.serverName,
        authenticatedRuntimeValidated: true,
        projectScope: derived.scope,
        configuredProjectScope: mcpValidation.projectScope,
      });
      return { provider, diagnostics };
    } catch (error) {
      if (error instanceof Error && error.message.includes("Container tag")) return providerConstructionUnavailable("supermemory", context);
      const message = redactLaunchDiagnosticText(`Supermemory provider could not be constructed; ${context === "install" ? "installed" : "launched"} without adaptive-memory injection. ${error instanceof Error ? error.message : String(error)}`);
      return unavailable("supermemory", message);
    }
  }

  return { diagnostics };
}

function unavailable(providerId: string, message: string): ResolvedPiAdaptiveMemoryProvider {
  return { diagnostics: [{ code: "memory_provider_unavailable", providerId, message }] };
}

function providerConstructionUnavailable(providerId: string, context: "launch" | "install"): ResolvedPiAdaptiveMemoryProvider {
  return unavailable(providerId, `Adaptive-memory provider '${providerId}' could not be constructed. ${capitalizedContext(context)} without adaptive-memory injection.`);
}

function capitalizedContext(context: "launch" | "install"): string {
  return context === "install" ? "Installed" : "Launched";
}

function redactLaunchDiagnosticText(value: string): string {
  return redactPiMcpConfigDiagnosticText(value)
    .replace(/(bad\s+token\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(token\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(secret\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\bsupermemory-[A-Za-z0-9_-]+/gi, "supermemory-[REDACTED]");
}

function dedupeDiagnostics(diagnostics: MemoryProviderDiagnostic[]): MemoryProviderDiagnostic[] {
  const seen = new Set<string>();
  const deduped: MemoryProviderDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = [diagnostic.code, diagnostic.providerId ?? "", diagnostic.message.replace(/\s+/g, " ").trim()].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(diagnostic);
  }
  return deduped;
}

function supportsProvider(providerId: string, supportedProviderIds: Iterable<string>): boolean {
  return new Set(supportedProviderIds).has(providerId);
}

function inferProviderId(cliProvider: string | undefined, deckConfig: unknown): AdaptiveMemoryActiveProvider | undefined {
  if (cliProvider === "supermemory" || cliProvider === "none") return cliProvider;
  if (typeof deckConfig === "object" && deckConfig !== null && !Array.isArray(deckConfig)) {
    const adaptiveMemory = (deckConfig as { adaptiveMemory?: unknown }).adaptiveMemory;
    if (typeof adaptiveMemory === "object" && adaptiveMemory !== null && !Array.isArray(adaptiveMemory)) {
      const activeProvider = (adaptiveMemory as { activeProvider?: unknown }).activeProvider;
      if (activeProvider === "supermemory" || activeProvider === "none") return activeProvider;
    }
  }
  return undefined;
}

function inferProviderIdFromError(error: unknown): AdaptiveMemoryActiveProvider | undefined {
  if (error instanceof DeckConfigError && error.code.startsWith("SUPERMEMORY_")) return "supermemory";
  return undefined;
}

function redactedConfigErrorMessage(error: unknown, context: "launch" | "install"): string {
  const suffix = `${capitalizedContext(context)} without adaptive-memory injection.`;
  if (error instanceof DeckConfigError) {
    return `${error.message} ${suffix}`;
  }
  return `Adaptive-memory provider configuration could not be resolved; ${suffix}`;
}

function toLaunchMemoryDiagnostic(diagnostic: MemoryDiagnostic): MemoryProviderDiagnostic {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.providerId ? { providerId: diagnostic.providerId } : {}),
  };
}

function defaultCommandExists(command: string): boolean {
  const path = process.env.PATH ?? "";
  return path.split(delimiter).some((dir) => {
    try {
      accessSync(join(dir, command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

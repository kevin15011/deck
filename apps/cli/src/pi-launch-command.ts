import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { buildPiTeamLaunchPlan, materializeTeamProfile, type PiTeamLaunchPlan } from "@deck/adapter-pi";
import {
  applyDeveloperTeamInstall,
  buildDeveloperTeamInstallPlan,
  readDeveloperTeamModelConfigAssignments,
  validateSupermemoryPiMcpConfig,
} from "@deck/adapter-pi";
import { createEngramMemoryProvider } from "@deck/adapter-engram";
import { createSupermemoryMemoryProvider } from "@deck/adapter-supermemory";
import {
  DeckConfigError,
  resolveActiveMemoryProvider,
  validateDeckConfig,
  type AdaptiveMemoryActiveProvider,
  type DeckSupermemoryConfig,
} from "@deck/core/config/deck-config";
import type { AdaptiveMemoryProvider, MemoryDiagnostic } from "@deck/core/memory/adaptive-memory";

// --- Types ---

const SUPPORTED_PI_LAUNCH_MEMORY_PROVIDER_IDS = ["engram", "supermemory"] as const;

export type RunPiLaunchOptions = {
  teamId: string;
  projectRoot: string;
  flags: {
    continue?: boolean;
    resume?: boolean;
  };
  /** Legacy/pre-constructed memory provider. Prefer cliMemoryProvider/config resolution for launch paths. */
  memoryProvider?: AdaptiveMemoryProvider;
  /** Explicit CLI provider override from --memory. Precedence: CLI > .deck/config.json > none. */
  cliMemoryProvider?: string;
  /** Optional in-memory Deck config override for tests. Defaults to reading .deck/config.json from projectRoot. */
  deckConfig?: unknown;
  /** Direct dashboard selection; normalized through the same safe config path as .deck/config.json. */
  activeProvider?: AdaptiveMemoryActiveProvider;
  /** Non-secret Supermemory config from dashboard/.deck/config.json. Never include tokens here. */
  supermemory?: DeckSupermemoryConfig;
  /** Provider IDs accepted by this launch surface. Defaults to Pi-supported providers. */
  supportedMemoryProviderIds?: Iterable<string>;
  /** Override for validating Pi global MCP config before Supermemory injection. */
  piMcpConfigPath?: string;
  /** Override home directory used to resolve the default Pi global MCP config path. */
  piMcpHomeDir?: string;
  /** Check if a command exists in PATH */
  commandExists?: (command: string) => boolean;
  /** Override the Pi command path */
  piCommand?: string;
  /** If true, don't spawn Pi — just return the plan */
  dryRun?: boolean;
};

export type MemoryProviderDiagnostic = {
  code: "unsupported_memory_provider" | "memory_provider_unavailable" | "multiple_memory_providers";
  message: string;
  providerId?: string;
};

export type PiLaunchResult =
  | { status: "error"; message: string; memoryDiagnostics: MemoryProviderDiagnostic[] }
  | { status: "ready"; plan: PiTeamLaunchPlan; profileDir: string; memoryDiagnostics: MemoryProviderDiagnostic[] }
  | { status: "launched"; plan: PiTeamLaunchPlan; memoryDiagnostics: MemoryProviderDiagnostic[] };

export type ResolvedPiAdaptiveMemoryProvider = {
  provider?: AdaptiveMemoryProvider;
  diagnostics: MemoryProviderDiagnostic[];
};

export type ResolvePiAdaptiveMemoryProviderOptions = {
  /** Preconstructed provider from an install/dashboard flow. Cannot be combined with config resolution. */
  memoryProvider?: AdaptiveMemoryProvider;
  /** CLI override; precedence remains CLI > .deck/config.json > none for launch. */
  cliMemoryProvider?: string;
  /** Project root used to read .deck/config.json when deckConfig is not provided. */
  projectRoot?: string;
  /** In-memory Deck config, useful for TUI/dashboard install before launch. */
  deckConfig?: unknown;
  /** Direct dashboard selection; enables immediate provider construction without writing secrets to Deck config. */
  activeProvider?: AdaptiveMemoryActiveProvider;
  /** Non-secret Supermemory config from dashboard/.deck/config.json. Never include tokens here. */
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

// --- Command ---

/**
 * Prepares and optionally launches a Pi session for a Deck team.
 *
 * Memory provider resolution uses CLI > .deck/config.json > none and constructs
 * exactly one provider. Supermemory injection is fail-closed: missing/incomplete
 * non-secret config, missing/malformed Pi MCP config, or failing provider health
 * launches without adaptive-memory injection and returns redacted diagnostics.
 */
export function runPiLaunch(options: RunPiLaunchOptions): PiLaunchResult {
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

  const resolvedMemory = resolvePiAdaptiveMemoryProvider(options);
  const memoryProvider = resolvedMemory.provider;
  const allDiagnostics: MemoryProviderDiagnostic[] = [...resolvedMemory.diagnostics];

  const profileDiagnostics = materializeTeamProfile({
    teamId,
    projectRoot,
    supportedMemoryProviderIds,
    ...(memoryProvider ? { memoryProvider } : {}),
  });

  allDiagnostics.push(...profileDiagnostics.map(toLaunchMemoryDiagnostic));

  if (memoryProvider) {
    const { modelAssignments, thinkingAssignments } = readDeveloperTeamModelConfigAssignments(projectRoot);
    const installPlan = buildDeveloperTeamInstallPlan(projectRoot, {
      memoryProvider,
      supportedMemoryProviderIds,
      modelAssignments,
      thinkingAssignments,
      piMcpConfigPath: options.piMcpConfigPath,
      piMcpHomeDir: options.piMcpHomeDir,
    });
    applyDeveloperTeamInstall(installPlan);
    allDiagnostics.push(...installPlan.memoryDiagnostics.map(toLaunchMemoryDiagnostic));
  }

  const plan = buildPiTeamLaunchPlan({
    teamId,
    projectRoot,
    flags,
    piCommand,
  });

  if (dryRun) {
    return {
      status: "ready",
      plan,
      profileDir: plan.profileDir,
      memoryDiagnostics: allDiagnostics,
    };
  }

  return {
    status: "launched",
    plan,
    memoryDiagnostics: allDiagnostics,
  };
}

/**
 * Shared Pi adaptive-memory provider resolver for launch and TUI install paths.
 * It has no import-time side effects and never persists Supermemory tokens to
 * `.deck/config.json`; callers must hand off credentials through Pi MCP config.
 */
export function resolvePiAdaptiveMemoryProvider(options: ResolvePiAdaptiveMemoryProviderOptions): ResolvedPiAdaptiveMemoryProvider {
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
          message: `Unsupported memory provider '${activeProvider}'; ${context === "install" ? "installed" : "launched"} without adaptive-memory injection.`,
        },
      ],
    };
  }

  if (activeProvider === "engram") {
    try {
      return { provider: createEngramMemoryProvider(), diagnostics };
    } catch {
      return providerConstructionUnavailable("engram", context);
    }
  }

  if (activeProvider === "supermemory") {
    const supermemory = resolved.supermemory;
    if (!supermemory?.userId) {
      return unavailable("supermemory", `Supermemory configuration is incomplete; userId is required. ${capitalizedContext(context)} without adaptive-memory injection.`);
    }

    const mcpValidation = validateSupermemoryPiMcpConfig({
      serverName: supermemory.mcpServerName,
      configPath: options.piMcpConfigPath,
      homeDir: options.piMcpHomeDir,
    });

    if (!mcpValidation.ok) {
      return unavailable(
        "supermemory",
        `Supermemory Pi MCP config is unavailable or invalid; ${context === "install" ? "installed" : "launched"} without adaptive-memory injection. ${mcpValidation.diagnostics.map((diagnostic) => diagnostic.message).join(" ")}`,
      );
    }

    try {
      const provider = createSupermemoryMemoryProvider({
        userId: supermemory.userId,
        teamId: supermemory.teamId,
        orgId: supermemory.orgId,
        mcpServerName: mcpValidation.serverName,
        searchMode: supermemory.searchMode === "memories" ? "memories" : undefined,
        maxMemoriesPerSession: supermemory.maxMemoriesPerSession,
        authenticatedRuntimeValidated: true,
      });

      return { provider, diagnostics };
    } catch {
      return providerConstructionUnavailable("supermemory", context);
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
      projectRoot: options.projectRoot,
      ...(options.deckConfig !== undefined ? { config: options.deckConfig } : {}),
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

function unavailable(providerId: string, message: string): ResolvedPiAdaptiveMemoryProvider {
  return { diagnostics: [{ code: "memory_provider_unavailable", providerId, message }] };
}

function providerConstructionUnavailable(providerId: string, context: "launch" | "install"): ResolvedPiAdaptiveMemoryProvider {
  return unavailable(providerId, `Adaptive-memory provider '${providerId}' could not be constructed. ${capitalizedContext(context)} without adaptive-memory injection.`);
}

function capitalizedContext(context: "launch" | "install"): string {
  return context === "install" ? "Installed" : "Launched";
}

function supportsProvider(providerId: string, supportedProviderIds: Iterable<string>): boolean {
  return new Set(supportedProviderIds).has(providerId);
}

function inferProviderId(cliProvider: string | undefined, deckConfig: unknown): AdaptiveMemoryActiveProvider | undefined {
  if (cliProvider === "engram" || cliProvider === "supermemory" || cliProvider === "none") return cliProvider;
  if (typeof deckConfig === "object" && deckConfig !== null && !Array.isArray(deckConfig)) {
    const adaptiveMemory = (deckConfig as { adaptiveMemory?: unknown }).adaptiveMemory;
    if (typeof adaptiveMemory === "object" && adaptiveMemory !== null && !Array.isArray(adaptiveMemory)) {
      const activeProvider = (adaptiveMemory as { activeProvider?: unknown }).activeProvider;
      if (activeProvider === "engram" || activeProvider === "supermemory" || activeProvider === "none") return activeProvider;
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

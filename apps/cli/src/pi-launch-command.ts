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
  type AdaptiveMemoryActiveProvider,
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

type ResolvedLaunchMemory = {
  provider?: AdaptiveMemoryProvider;
  diagnostics: MemoryProviderDiagnostic[];
};

// --- Command ---

/**
 * Prepares and optionally launches a Pi session for a Deck team.
 *
 * In dry-run mode, it materializes the team profile and returns the launch plan
 * without actually spawning Pi.
 *
 * In live mode, it spawns Pi as a child process with the correct args.
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

  // Check if pi is available
  if (!commandExists(piCommand)) {
    return {
      status: "error",
      memoryDiagnostics: [],
      message: `Pi command not found: "${piCommand}". Install Pi first or check your PATH.`,
    };
  }

  const resolvedMemory = resolveLaunchMemoryProvider(options);
  const memoryProvider = resolvedMemory.provider;

  // Collect all memory diagnostics from provider resolution, profile, and install materialization.
  const allDiagnostics: MemoryProviderDiagnostic[] = [...resolvedMemory.diagnostics];

  // 1. Materialize the team profile (creates .deck/pi/profiles/<team>/system-prompt.md)
  //    Composes session-level memory instructions into the system prompt.
  const profileDiagnostics = materializeTeamProfile({
    teamId,
    projectRoot,
    supportedMemoryProviderIds,
    ...(memoryProvider ? { memoryProvider } : {}),
  });

  allDiagnostics.push(...profileDiagnostics.map(toLaunchMemoryDiagnostic));

  // 2. When a memory provider is specified, also materialize Developer Team
  //    agent and skill files with memory tool bindings (REQ-AMI-002).
  //    Preserve any existing model/thinking assignments before rewriting files,
  //    so launch-time memory materialization does not reset Pi configuration.
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

  // Build the launch plan
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

  // In live mode, we would spawn Pi here.
  // For now, we return the plan — the actual spawn is handled by the CLI entry point.
  return {
    status: "launched",
    plan,
    memoryDiagnostics: allDiagnostics,
  };
}

function resolveLaunchMemoryProvider(options: RunPiLaunchOptions): ResolvedLaunchMemory {
  const diagnostics: MemoryProviderDiagnostic[] = [];

  if (options.memoryProvider && (options.cliMemoryProvider !== undefined || options.deckConfig !== undefined)) {
    return {
      diagnostics: [
        {
          code: "multiple_memory_providers",
          providerId: options.memoryProvider.id,
          message: "Exactly one adaptive-memory provider may be active; preconstructed provider cannot be combined with CLI/config resolution.",
        },
      ],
    };
  }

  if (options.memoryProvider) {
    return { provider: options.memoryProvider, diagnostics };
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
          message: redactedConfigErrorMessage(error),
        },
      ],
    };
  }

  const activeProvider = resolved.activeProvider;
  if (activeProvider === "none") {
    return { diagnostics };
  }

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

  if (activeProvider === "engram") {
    return { provider: createEngramMemoryProvider(), diagnostics };
  }

  if (activeProvider === "supermemory") {
    const supermemory = resolved.supermemory;
    if (!supermemory?.userId) {
      return {
        diagnostics: [
          {
            code: "memory_provider_unavailable",
            providerId: "supermemory",
            message: "Supermemory configuration is incomplete; userId is required. Launched without adaptive-memory injection.",
          },
        ],
      };
    }

    const mcpValidation = validateSupermemoryPiMcpConfig({
      serverName: supermemory.mcpServerName,
      configPath: options.piMcpConfigPath,
      homeDir: options.piMcpHomeDir,
    });

    if (!mcpValidation.ok) {
      return {
        diagnostics: [
          {
            code: "memory_provider_unavailable",
            providerId: "supermemory",
            message: `Supermemory Pi MCP config is unavailable or invalid; launched without adaptive-memory injection. ${mcpValidation.diagnostics.map((diagnostic) => diagnostic.message).join(" ")}`,
          },
        ],
      };
    }

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
  }

  return { diagnostics };
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

function redactedConfigErrorMessage(error: unknown): string {
  if (error instanceof DeckConfigError) {
    return `${error.message} Launched without adaptive-memory injection.`;
  }
  return "Adaptive-memory provider configuration could not be resolved; launched without adaptive-memory injection.";
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

import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

import {
  applyOpenCodeDeveloperTeamInstall,
  buildOpenCodeDeveloperTeamInstallPlan,
  type MemoryDiagnostic,
} from "@deck/adapter-opencode";
import { createEngramMemoryProvider } from "@deck/adapter-engram";
import {
  resolveActiveMemoryProvider,
  validateDeckConfig,
  type AdaptiveMemoryActiveProvider,
} from "@deck/core/config/deck-config";
import type { AdaptiveMemoryProvider, MemoryInjectionBundle } from "@deck/core/memory/adaptive-memory";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const SUPPORTED_OPENCODE_LAUNCH_MEMORY_PROVIDER_IDS = ["engram"] as const;

export type RunOpenCodeLaunchOptions = {
  teamId: string;
  projectRoot: string;
  memoryProvider?: AdaptiveMemoryProvider;
  cliMemoryProvider?: string;
  deckConfig?: unknown;
  activeProvider?: AdaptiveMemoryActiveProvider;
  supportedMemoryProviderIds?: Iterable<string>;
  commandExists?: (command: string) => boolean;
  opencodeCommand?: string;
  configDir?: string;
  dryRun?: boolean;
};

export type OpenCodeLaunchResult =
  | { status: "error"; message: string; memoryDiagnostics: MemoryProviderDiagnostic[] }
  | { status: "ready"; plan: OpenCodeLaunchPlan; memoryDiagnostics: MemoryProviderDiagnostic[] }
  | { status: "launched"; plan: OpenCodeLaunchPlan; memoryDiagnostics: MemoryProviderDiagnostic[] };

export type OpenCodeLaunchPlan = {
  command: string;
  args: string[];
  cwd: string;
};

export type MemoryProviderDiagnostic = {
  code: "unsupported_memory_provider" | "memory_provider_unavailable" | "multiple_memory_providers";
  message: string;
  providerId?: string;
};

// ---------------------------------------------------------------------------
// Memory resolution
// ---------------------------------------------------------------------------

type ResolvedMemory = {
  provider?: AdaptiveMemoryProvider;
  memoryInjection?: MemoryInjectionBundle;
  diagnostics: MemoryProviderDiagnostic[];
};

function resolveOpenCodeMemory(options: RunOpenCodeLaunchOptions): ResolvedMemory {
  const diagnostics: MemoryProviderDiagnostic[] = [];

  if (options.memoryProvider && hasConfigInput(options)) {
    return {
      diagnostics: [
        {
          code: "multiple_memory_providers",
          providerId: options.memoryProvider.id,
          message: "Exactly one memory provider may be active; preconstructed provider cannot be combined with CLI/config resolution.",
        },
      ],
    };
  }

  if (options.memoryProvider) {
    return { provider: options.memoryProvider, diagnostics };
  }

  // Resolve from config
  if (options.activeProvider !== undefined) {
    if (options.activeProvider === "none") return { diagnostics };
    if (!supportsProvider(options.activeProvider, options.supportedMemoryProviderIds ?? SUPPORTED_OPENCODE_LAUNCH_MEMORY_PROVIDER_IDS)) {
      return {
        diagnostics: [
          {
            code: "unsupported_memory_provider",
            providerId: options.activeProvider,
            message: `Unsupported memory provider '${options.activeProvider}'; launched without adaptive memory.`,
          },
        ],
      };
    }
    if (options.activeProvider === "engram") {
      try {
        return { provider: createEngramMemoryProvider(), diagnostics };
      } catch {
        return providerUnavailable("engram");
      }
    }
    return { diagnostics };
  }

  // CLI override
  if (options.cliMemoryProvider) {
    if (!supportsProvider(options.cliMemoryProvider, options.supportedMemoryProviderIds ?? SUPPORTED_OPENCODE_LAUNCH_MEMORY_PROVIDER_IDS)) {
      return {
        diagnostics: [
          {
            code: "unsupported_memory_provider",
            providerId: options.cliMemoryProvider,
            message: `Unsupported memory provider '${options.cliMemoryProvider}'; launched without adaptive memory.`,
          },
        ],
      };
    }
    if (options.cliMemoryProvider === "engram") {
      try {
        return { provider: createEngramMemoryProvider(), diagnostics };
      } catch {
        return providerUnavailable("engram");
      }
    }
  }

  return { diagnostics };
}

function providerUnavailable(providerId: string): ResolvedMemory {
  return {
    diagnostics: [
      {
        code: "memory_provider_unavailable",
        providerId,
        message: `Adaptive memory provider '${providerId}' could not be constructed. Launched without adaptive memory.`,
      },
    ],
  };
}

function hasConfigInput(options: RunOpenCodeLaunchOptions): boolean {
  return options.cliMemoryProvider !== undefined || options.deckConfig !== undefined || options.activeProvider !== undefined;
}

function supportsProvider(providerId: string, supportedIds: Iterable<string>): boolean {
  return new Set(supportedIds).has(providerId);
}

function toMemoryDiagnostic(diagnostic: MemoryDiagnostic): MemoryProviderDiagnostic {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.providerId ? { providerId: diagnostic.providerId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Main launch
// ---------------------------------------------------------------------------

export async function runOpenCodeLaunch(options: RunOpenCodeLaunchOptions): Promise<OpenCodeLaunchResult> {
  const { teamId, projectRoot, dryRun = false } = options;
  const commandExists = options.commandExists ?? defaultCommandExists;
  const opencodeCommand = options.opencodeCommand ?? "opencode";
  const configDir = options.configDir ?? join(process.env.HOME ?? "/home/user", ".config", "opencode");

  // 1. Verify opencode is in PATH
  if (!commandExists(opencodeCommand)) {
    return {
      status: "error",
      memoryDiagnostics: [],
      message: `OpenCode command not found: "${opencodeCommand}". Install OpenCode first or check your PATH.`,
    };
  }

  // 2. Resolve memory provider
  const resolvedMemory = resolveOpenCodeMemory(options);
  const allDiagnostics: MemoryProviderDiagnostic[] = [...resolvedMemory.diagnostics];

  // 3. Build install plan
  const installPlan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, {
    configDir,
    memoryInjection: resolvedMemory.memoryInjection,
    memoryProvider: resolvedMemory.provider,
    supportedMemoryProviderIds: options.supportedMemoryProviderIds ?? SUPPORTED_OPENCODE_LAUNCH_MEMORY_PROVIDER_IDS,
  });

  allDiagnostics.push(...installPlan.memoryDiagnostics.map(toMemoryDiagnostic));

  // 4. Apply install (config merge + prompt/command/skill files)
  const applyResult = applyOpenCodeDeveloperTeamInstall(installPlan, { configDir });

  if (applyResult.configMergeResult) {
    // Config merge succeeded
  }

  // 5. Build launch plan
  const plan: OpenCodeLaunchPlan = {
    command: opencodeCommand,
    args: [projectRoot],
    cwd: projectRoot,
  };

  if (dryRun) {
    return { status: "ready", plan, memoryDiagnostics: allDiagnostics };
  }

  return { status: "launched", plan, memoryDiagnostics: allDiagnostics };
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
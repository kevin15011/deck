import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { buildPiTeamLaunchPlan, materializeTeamProfile, type PiTeamLaunchPlan } from "@deck/adapter-pi";
import {
  applyDeveloperTeamInstall,
  buildDeveloperTeamInstallPlan,
  readDeveloperTeamModelConfigAssignments,
} from "@deck/adapter-pi";
import type { AdaptiveMemoryProvider, MemoryDiagnostic } from "@deck/core/memory/adaptive-memory";

// --- Types ---

const SUPPORTED_PI_LAUNCH_MEMORY_PROVIDER_IDS = ["engram"] as const;

export type RunPiLaunchOptions = {
  teamId: string;
  projectRoot: string;
  flags: {
    continue?: boolean;
    resume?: boolean;
  };
  /** Memory provider to inject into the team session prompt and agent/skill files. Undefined = no memory. */
  memoryProvider?: AdaptiveMemoryProvider;
  /** Provider IDs accepted by this launch surface. Defaults to CLI-supported providers. */
  supportedMemoryProviderIds?: Iterable<string>;
  /** Check if a command exists in PATH */
  commandExists?: (command: string) => boolean;
  /** Override the Pi command path */
  piCommand?: string;
  /** If true, don't spawn Pi — just return the plan */
  dryRun?: boolean;
};

export type MemoryProviderDiagnostic = {
  code: "unsupported_memory_provider" | "memory_provider_unavailable";
  message: string;
  providerId?: string;
};

export type PiLaunchResult =
  | { status: "error"; message: string; memoryDiagnostics: MemoryProviderDiagnostic[] }
  | { status: "ready"; plan: PiTeamLaunchPlan; profileDir: string; memoryDiagnostics: MemoryProviderDiagnostic[] }
  | { status: "launched"; plan: PiTeamLaunchPlan; memoryDiagnostics: MemoryProviderDiagnostic[] };

// --- Command ---

/**
 * Prepares and optionally launches a Pi session for a Deck team.
 *
 * In dry-run mode, it materializes the team profile and returns the launch plan
 * without actually spawning Pi.
 *
 * In live mode, it spawns Pi as a child process with the correct args.
 *
 * When a memory provider is specified, this command:
 * 1. Materializes the team session profile with memory instructions composed
 *    into the system prompt (session-level injection).
 * 2. Materializes Developer Team agent and skill files with memory tool bindings
 *    in their frontmatter (agent/skill-level injection).
 *
 * This ensures that `--memory=engram` guarantees runtime binding metadata for
 * all materialized content, not just the session profile (REQ-AMI-002), while
 * preserving pre-existing Pi model/thinking assignments in `.pi/agents`.
 */
export function runPiLaunch(options: RunPiLaunchOptions): PiLaunchResult {
  const { teamId, projectRoot, flags, memoryProvider, dryRun = false } = options;
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

  // Collect all memory diagnostics from both profile and install materialization
  const allDiagnostics: MemoryProviderDiagnostic[] = [];

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

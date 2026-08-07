/**
 * CLI argument parser for `deck` commands.
 *
 * Supports:
 * - `deck` (no args) → TUI mode
 * - `deck doctor` → run doctor diagnostics
 * - `deck rollback` → restore the most-recent backup (REQ-RBK-001)
 * - `deck pi developer` → launch Pi with Developer Team
 * - `deck pi developer --continue` → continue Developer Team session
 * - `deck pi developer --resume` → resume picker for Developer Team session
 * - `deck pi developer --memory=engram` → enable Engram memory provider (experimental)
 * - `deck pi developer --memory=supermemory` → enable Supermemory MCP memory provider
 * - `deck pi developer --memory=none` → explicitly disable memory provider (default)
 */

import { MAX_RUNNER_STDIN_PAYLOAD_BYTES, type RunnerStdinPayload } from "@deck/core";

export type ParsedArgs =
  | { command: "tui" }
  | { command: "doctor" }
  | { command: "version" }
  | {
      command: "upgrade";
      flags: {
        /** Automatic yes mode - skip confirmations */
        yes?: boolean;
      };
    }
  | {
      command: "rollback";
      flags: {
        /** Force rollback even if the backup is referenced by an active operation. */
        force?: boolean;
        /** Optional explicit backup id; defaults to the most recent. */
        backupId?: string;
      };
    }
  | {
      command: "openspec-validate";
      flags: {
        /** Output JSON instead of human-readable text. */
        json?: boolean;
        /** Validate only this specific change id. */
        changeId?: string;
        /** Project root directory. */
        root?: string;
      };
    }
  | {
      command: "skill-registry-validate" | "skill-registry-discover" | "skill-registry-refresh";
      flags: {
        /** Active runner selected for discovery. Refresh may resolve this interactively. */
        runner?: string;
        /** Project root directory. */
        root?: string;
        /** Output stable JSON instead of human-readable text. */
        json?: boolean;
      };
    }
  | {
      command: "pi-launch";
      teamId: string;
      flags: {
        continue?: boolean;
        resume?: boolean;
      };
      /** Memory provider selection, e.g. "engram" or "supermemory". Undefined means no memory. */
      memoryProvider?: string;
    }
  | {
      command: "runner-launch";
      runnerId: "codex" | "opencode";
      teamId: "developer-team";
      launch:
        | { mode: "interactive" }
        | { mode: "exec"; prompt: readonly string[]; stdin: "closed"; stdinPayload: RunnerStdinPayload }
        | { mode: "resume-by-id"; sessionId: string }
        | { mode: "resume-latest" };
      installOnly?: boolean;
      dryRun?: boolean;
      localOnly?: boolean;
      yes?: boolean;
    }
  | {
      command: "error";
      message: string;
    };

/**
 * Known team slugs mapped to canonical team IDs.
 */
const PI_TEAM_SLUGS: Record<string, string> = {
  developer: "developer-team",
};

/**
 * Supported memory provider identifiers for Pi.
 */
export const SUPPORTED_MEMORY_PROVIDERS = ["engram", "supermemory"] as const;
export type SupportedMemoryProvider = (typeof SUPPORTED_MEMORY_PROVIDERS)[number];

function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "") return true;
  if (value === "true") return true;
  if (value === "false") return false;
  return true;
}

/** Canonical, bounded serialization for `deck codex developer exec -- <prompt...>`. */
export function serializeCodexExecPrompt(tokens: readonly string[]): { ok: true; payload: RunnerStdinPayload } | { ok: false; message: string } {
  const content = tokens.join(" ");
  if (content.includes("\0")) return { ok: false, message: "Codex exec prompts cannot contain NUL bytes." };
  if (Buffer.byteLength(content, "utf8") > MAX_RUNNER_STDIN_PAYLOAD_BYTES) {
    return { ok: false, message: "Codex exec prompt exceeds the supported stdin payload limit." };
  }
  return { ok: true, payload: { type: "utf8", content } };
}

/**
 * Parse raw CLI arguments into a structured command.
 */
function parseCodexArgs(rest: string[]): ParsedArgs {
  if (rest[0] !== "developer") {
    return { command: "error", message: "Usage: deck codex developer [--install-only] [--dry-run] [--yes] [--local-only] [exec -- <prompt...> | resume <session-id> | resume --last]\nCodex 0.145.0+ is supported. Deck never enables project trust; the shipped registry has no external hook-host binding, so every production route is currently static-compatible." };
  }

  const tokens = rest.slice(1);
  const separatorIndex = tokens.indexOf("--");
  const deckFlagRegion = separatorIndex >= 0 ? tokens.slice(0, separatorIndex) : tokens;
  const dryRun = deckFlagRegion.includes("--dry-run");
  const localOnly = deckFlagRegion.includes("--local-only");
  const yes = deckFlagRegion.includes("--yes");
  const installOnly = deckFlagRegion.includes("--install-only");
  const deckFlags = new Set(["--dry-run", "--local-only", "--yes", "--install-only"]);
  const filtered = [
    ...deckFlagRegion.filter((token) => !deckFlags.has(token)),
    ...(separatorIndex >= 0 ? ["--", ...tokens.slice(separatorIndex + 1)] : []),
  ];

  let launch: Extract<ParsedArgs, { command: "runner-launch" }>["launch"] = { mode: "interactive" };
  if (filtered[0] === "exec") {
    if (filtered[1] !== "--" || filtered.length < 3) {
      return { command: "error", message: "Usage: deck codex developer exec -- <prompt...>" };
    }
    const serialized = serializeCodexExecPrompt(filtered.slice(2));
    if (!serialized.ok) return { command: "error", message: serialized.message };
    launch = { mode: "exec", prompt: filtered.slice(2), stdin: "closed", stdinPayload: serialized.payload };
  } else if (filtered[0] === "resume") {
    if (filtered.length !== 2) {
      return { command: "error", message: "Usage: deck codex developer resume <session-id> | resume --last" };
    }
    launch = filtered[1] === "--last"
      ? { mode: "resume-latest" }
      : { mode: "resume-by-id", sessionId: filtered[1]! };
  } else if (filtered.length > 0) {
    return { command: "error", message: `Unknown Codex developer argument: ${filtered[0]}` };
  }

  if (installOnly && launch.mode !== "interactive") {
    return { command: "error", message: "--install-only cannot be combined with exec or resume." };
  }

  return {
    command: "runner-launch",
    runnerId: "codex",
    teamId: "developer-team",
    launch,
    ...(installOnly ? { installOnly: true } : {}),
    ...(dryRun ? { dryRun: true } : {}),
    ...(localOnly ? { localOnly: true } : {}),
    ...(yes ? { yes: true } : {}),
  };
}

export function parseArgs(argv: string[]): ParsedArgs {
  // argv[0] is typically the runtime, argv[1] is the script
  // We skip those — the caller should pass only the user args
  const args = argv.slice(0);

  if (args.length === 0) {
    return { command: "tui" };
  }

  const [first, ...rest] = args;

  if (first === "doctor") {
    if (rest.length > 0) {
      return {
        command: "error",
        message: "El comando `deck doctor` no acepta argumentos adicionales.",
      };
    }
    return { command: "doctor" };
  }

  if (first === "version") {
    if (rest.length > 0) {
      return {
        command: "error",
        message: "El comando `deck version` no acepta argumentos.",
      };
    }
    return { command: "version" };
  }

  if (first === "upgrade" || first === "update") {
    // Both `deck upgrade` and `deck update` route to the same handler.
    // `upgrade` is the historical command; `update` is the new alias added
    // by `add-self-update-system` / T2.11. The flag vocabulary is shared.
    // Parse flags for upgrade command
    let yesMode = false;
    for (const flag of rest) {
      if (flag === "--yes" || flag === "-y") {
        yesMode = true;
      } else if (flag.startsWith("--yes=") || flag.startsWith("-y=")) {
        const value = parseBooleanFlag(flag.slice(flag.indexOf("=") + 1));
        yesMode = value === true;
      } else {
        return {
          command: "error",
          message: `Flag desconocido para ${first}: ${flag}. Usa --help para ver el uso.`,
        };
      }
    }
    return {
      command: "upgrade",
      flags: {
        ...(yesMode ? { yes: true } : {}),
      },
    };
  }

  if (first === "rollback") {
    // `deck rollback` restores the most-recent backup (REQ-RBK-001).
    // Accepts `--force` to bypass the "backup referenced by state"
    // protection, and `--backup <id>` to target a specific backup.
    let force = false;
    let backupId: string | undefined;
    for (let i = 0; i < rest.length; i += 1) {
      const flag = rest[i]!;
      if (flag === "--force") {
        force = true;
      } else if (flag === "--backup" || flag === "--backup-id") {
        const value = rest[i + 1];
        if (value === undefined || value.startsWith("--")) {
          return {
            command: "error",
            message: `Flag ${flag} requires a value.`,
          };
        }
        backupId = value;
        i += 1;
      } else if (flag.startsWith("--backup=")) {
        backupId = flag.slice("--backup=".length);
      } else if (flag.startsWith("--backup-id=")) {
        backupId = flag.slice("--backup-id=".length);
      } else {
        return {
          command: "error",
          message: `Flag desconocido para rollback: ${flag}. Usa --help para ver el uso.`,
        };
      }
    }
    return {
      command: "rollback",
      flags: {
        ...(force ? { force: true } : {}),
        ...(backupId ? { backupId } : {}),
      },
    };
  }

  if (first === "openspec") {
    // `deck openspec validate` command
    if (rest.length === 0 || rest[0] !== "validate") {
      return {
        command: "error",
        message: "Usage: deck openspec validate [--json] [--change <id>] [--root <path>]",
      };
    }

    // Parse subcommand and flags
    const flags = rest.slice(1);
    let jsonMode = false;
    let changeId: string | undefined;
    let rootDir: string | undefined;

    for (let i = 0; i < flags.length; i += 1) {
      const flag = flags[i]!;
      if (flag === "--json") {
        jsonMode = true;
      } else if (flag === "--change") {
        const value = flags[i + 1];
        if (value === undefined || value.startsWith("--")) {
          return {
            command: "error",
            message: `Flag --change requires a value.`,
          };
        }
        changeId = value;
        i += 1;
      } else if (flag.startsWith("--change=")) {
        changeId = flag.slice("--change=".length);
      } else if (flag === "--root") {
        const value = flags[i + 1];
        if (value === undefined || value.startsWith("--")) {
          return {
            command: "error",
            message: `Flag --root requires a value.`,
          };
        }
        rootDir = value;
        i += 1;
      } else if (flag.startsWith("--root=")) {
        rootDir = flag.slice("--root=".length);
      } else {
        return {
          command: "error",
          message: `Flag desconocido para openspec validate: ${flag}. Usa --help para ver el uso.`,
        };
      }
    }

    return {
      command: "openspec-validate",
      flags: {
        ...(jsonMode ? { json: true } : {}),
        ...(changeId ? { changeId } : {}),
        ...(rootDir ? { root: rootDir } : {}),
      },
    };
  }

  if (first === "skill-registry") {
    return parseSkillRegistryArgs(rest);
  }

  if (first === "codex") {
    return parseCodexArgs(rest);
  }

  if (first === "opencode") {
    if (rest[0] !== "developer" || rest.some((token, index) => index > 0 && !["--yes", "--dry-run", "--install-only"].includes(token))) {
      return { command: "error", message: "Usage: deck opencode developer [--install-only] [--dry-run] [--yes]" };
    }
    return {
      command: "runner-launch",
      runnerId: "opencode",
      teamId: "developer-team",
      launch: { mode: "interactive" },
      ...(rest.includes("--install-only") ? { installOnly: true } : {}),
      ...(rest.includes("--dry-run") ? { dryRun: true } : {}),
      ...(rest.includes("--yes") ? { yes: true } : {}),
    };
  }

  if (first !== "pi") {
    return { command: "tui" };
  }

  // `deck pi ...`
  if (rest.length === 0) {
    return {
      command: "error",
      message: "Usage: deck pi <team> [--continue | --resume] [--memory=engram|supermemory|none]\nAvailable teams: developer",
    };
  }

  const [teamSlug, ...flags] = rest;
  const teamId = PI_TEAM_SLUGS[teamSlug];

  if (!teamId) {
    const available = Object.keys(PI_TEAM_SLUGS).join(", ");
    return {
      command: "error",
      message: `Unknown Pi team: ${teamSlug}. Available teams: ${available}`,
    };
  }

  // Parse flags
  let shouldContinue = false;
  let shouldResume = false;
  let memoryProvider: string | undefined;

  for (const flag of flags) {
    if (flag === "--continue") {
      shouldContinue = true;
    } else if (flag.startsWith("--continue=")) {
      const value = parseBooleanFlag(flag.slice("--continue=".length));
      shouldContinue = value === true;
    } else if (flag === "--resume") {
      shouldResume = true;
    } else if (flag.startsWith("--resume=")) {
      const value = parseBooleanFlag(flag.slice("--resume=".length));
      shouldResume = value === true;
    } else if (flag === "--memory") {
      memoryProvider = "";
    } else if (flag.startsWith("--memory=")) {
      memoryProvider = flag.slice("--memory=".length);
    }
  }

  // --continue and --resume are mutually exclusive
  if (shouldContinue && shouldResume) {
    return {
      command: "error",
      message: "Error: --continue and --resume are mutually exclusive. Use one or the other.",
    };
  }

  // Validate memory provider if specified
  if (memoryProvider !== undefined) {
    if (memoryProvider === "" || memoryProvider === "none") {
      // Explicitly disabled — treat as no provider
      memoryProvider = undefined;
    } else if (!SUPPORTED_MEMORY_PROVIDERS.includes(memoryProvider as SupportedMemoryProvider)) {
      const available = [...SUPPORTED_MEMORY_PROVIDERS, "none"].join(", ");
      return {
        command: "error",
        message: `Unsupported memory provider: ${memoryProvider}. Available providers: ${available}`,
      };
    }
  }

  return {
    command: "pi-launch",
    teamId,
    flags: {
      ...(shouldContinue ? { continue: true } : {}),
      ...(shouldResume ? { resume: true } : {}),
    },
    ...(memoryProvider ? { memoryProvider } : {}),
  };
}

function parseSkillRegistryArgs(args: string[]): ParsedArgs {
  const [subcommand, ...flags] = args;
  if (subcommand !== "validate" && subcommand !== "discover" && subcommand !== "refresh") {
    return {
      command: "error",
      message: "Usage: deck skill-registry <validate|discover|refresh> [options]",
    };
  }

  let runner: string | undefined;
  let root: string | undefined;
  let json = false;
  const seen = new Set<string>();

  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i]!;
    if (flag === "--json") {
      if (seen.has("json")) return duplicateSkillRegistryFlag(flag);
      seen.add("json");
      json = true;
      continue;
    }

    if (flag === "--runner" || flag === "--root") {
      const key = flag.slice(2);
      if (seen.has(key)) return duplicateSkillRegistryFlag(flag);
      const value = flags[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return {
          command: "error",
          message: `Flag ${flag} requires a value.`,
        };
      }
      seen.add(key);
      if (key === "runner") runner = value;
      else root = value;
      i += 1;
      continue;
    }

    if (flag.startsWith("--runner=") || flag.startsWith("--root=")) {
      const separator = flag.indexOf("=");
      const key = flag.slice(2, separator);
      const value = flag.slice(separator + 1);
      if (seen.has(key)) return duplicateSkillRegistryFlag(flag);
      if (!value) {
        return {
          command: "error",
          message: `Flag --${key} requires a value.`,
        };
      }
      seen.add(key);
      if (key === "runner") runner = value;
      else root = value;
      continue;
    }

    return {
      command: "error",
      message: `Unknown flag for skill-registry ${subcommand}: ${flag}.`,
    };
  }

  if ((subcommand === "validate" || subcommand === "discover") && !runner) {
    return {
      command: "error",
      message: `Usage: deck skill-registry ${subcommand} --runner <id> [--root <path>] [--json]`,
    };
  }

  const command = `skill-registry-${subcommand}` as
    | "skill-registry-validate"
    | "skill-registry-discover"
    | "skill-registry-refresh";
  return {
    command,
    flags: {
      ...(runner ? { runner } : {}),
      ...(root ? { root } : {}),
      ...(json ? { json: true } : {}),
    },
  };
}

function duplicateSkillRegistryFlag(flag: string): ParsedArgs {
  return {
    command: "error",
    message: `Duplicate flag for skill-registry: ${flag}.`,
  };
}

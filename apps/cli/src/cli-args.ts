import { parseCodebaseGuardArgs, type CodebaseGuardArgs } from "@deck/adapter-pi";
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
 * - `deck pi developer --memory=supermemory` → enable Supermemory adaptive memory
 * - `deck pi developer --memory=none` → explicitly disable memory provider (default)
 */

import { MAX_RUNNER_STDIN_PAYLOAD_BYTES, type RunnerStdinPayload } from "@deck/core";

export type DaemonSubcommand = { action: "start" | "status" | "stop" | "restart"; json: boolean };
export const WEB_USAGE = "Usage: deck web [--no-open] [--json]\nStart the local workspace from any directory. Opens the browser unless --no-open or --json is supplied. Creates no project or session.";
export const DAEMON_USAGE = "Usage: deck daemon <start|status|stop|restart> [--json]\nThe daemon runs in the background. Ctrl+C and /detach close the client, not the daemon.\nStop and restart refuse running work or pending approvals. Restart uses the invoking Deck executable and preserves session history and runner assignments.";

/** `deck session <action>` grammar (XR-9.2, XR-12.1). */
export type SessionSubcommand =
  | { action: "web"; operation: "status" | "enable" | "disable" | "pair" | "devices"; json: boolean }
  | { action: "devices-revoke"; deviceId: string }
  | { action: "list"; json: boolean }
  | { action: "attach"; sessionId: string }
  | { action: "stop"; sessionId: string }
  | { action: "status"; json: boolean }
  | { action: "self-test"; json: boolean }
  | { action: "ack-claude-tos"; yes: boolean }
  | { action: "prune"; dryRun: boolean; json: boolean; maxAgeDays?: number; keep?: number };

export type ParsedArgs =
  | { command: "tui" }
  | { command: "doctor" }
  | { command: "claude-native-launch"; launch: { mode: "interactive" } | { mode: "resume-by-id"; sessionId: string } | { mode: "resume-latest" } }
  | { command: "claude-team-launch" }
  | {
      command: "supermemory-migration-dry-run";
      flags: {
        destinationScope: string;
        inventoryPath: string;
      };
    }
  | { command: "version" }
  | { command: "internal-codebase-mcp-guard-v1"; guard: CodebaseGuardArgs }
  | { command: "internal-serena-mcp"; probe: boolean }
  | { command: "internal-supermemory-runtime-smoke" }
  | { command: "internal-codex-memory-hook" }
  | { command: "internal-memory-mcp" }
  | { command: "internal-session-daemon" }
  | { command: "internal-daemon-restart-helper"; intentPath:string }
  | { command: "internal-session-mcp" }
  | { command: "internal-child-anchor"; argv: string[] }
  | { command: "cross-launch"; flags: { changeId?: string } }
  | { command: "session"; sub: SessionSubcommand }
  | { command: "daemon"; sub: DaemonSubcommand }
  | { command: "daemon-help" }
  | { command: "web"; flags: { json: boolean; noOpen: boolean } }
  | { command: "web-help" }
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
      /** Opt-in removal of legacy Deck artifacts left by earlier versions (backed up first). */
      cleanupLegacy?: boolean;
      /** Legacy CLI memory override. Undefined means no memory; Supermemory is the only supported backend. */
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
      cleanupLegacy?: boolean;
      verbose?: boolean;
      yes?: boolean;
      memoryProvider?: "supermemory" | "none";
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
export const SUPPORTED_MEMORY_PROVIDERS = ["supermemory"] as const;
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
    return { command: "error", message: "Usage: deck codex developer [--install-only] [--dry-run] [--yes] [--verbose] [--cleanup-legacy] [exec -- <prompt...> | resume <session-id> | resume --last]\nCodex 0.145.0+ is supported. Deck installs globally and writes nothing into projects; use --dry-run or --verbose for details." };
  }

  const tokens = rest.slice(1);
  const separatorIndex = tokens.indexOf("--");
  const deckFlagRegion = separatorIndex >= 0 ? tokens.slice(0, separatorIndex) : tokens;
  const dryRun = deckFlagRegion.includes("--dry-run");
  const localOnly = deckFlagRegion.includes("--local-only");
  const cleanupLegacy = deckFlagRegion.includes("--cleanup-legacy");
  const verbose = deckFlagRegion.includes("--verbose");
  const yes = deckFlagRegion.includes("--yes");
  const installOnly = deckFlagRegion.includes("--install-only");
  let memoryProvider: "supermemory" | "none" | undefined;
  for (const flag of deckFlagRegion) {
    if (flag === "--memory") return { command: "error", message: "--memory requires a value: supermemory or none." };
    if (flag.startsWith("--memory=")) {
      const value = flag.slice("--memory=".length);
      if (value !== "supermemory" && value !== "none") return { command: "error", message: `Unsupported memory provider: ${value}. Available providers: supermemory, none` };
      memoryProvider = value;
    }
  }
  const deckFlags = new Set(["--dry-run", "--local-only", "--yes", "--install-only", "--cleanup-legacy", "--verbose"]);
  const filtered = [
    ...deckFlagRegion.filter((token) => !deckFlags.has(token) && !token.startsWith("--memory=")),
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
    ...(cleanupLegacy ? { cleanupLegacy: true } : {}),
    ...(verbose ? { verbose: true } : {}),
    ...(yes ? { yes: true } : {}),
    ...(memoryProvider ? { memoryProvider } : {}),
  };
}

const SESSION_USAGE = "Usage: deck session list|attach <id>|stop <id>|status|self-test|prune|ack-claude-tos|pair|devices [revoke <id>]|web <status|enable|disable|pair|devices> [options]";
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function parseCrossArgs(rest: string[]): ParsedArgs {
  const usage: ParsedArgs = { command: "error", message: "Usage: deck cross developer [--change <id>]" };
  if (rest[0] !== "developer") return usage;
  let changeId: string | undefined;
  for (let i = 1; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (token === "--change") {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith("-") || value.length === 0) return usage;
      changeId = value;
      i += 1;
    } else if (token.startsWith("--change=") && token.length > "--change=".length) {
      changeId = token.slice("--change=".length);
    } else {
      return usage;
    }
  }
  return { command: "cross-launch", flags: changeId === undefined ? {} : { changeId } };
}

function parseSessionArgs(rest: string[]): ParsedArgs {
  const usage: ParsedArgs = { command: "error", message: SESSION_USAGE };
  const [action, ...tokens] = rest;
  const onlyJson = (): boolean | undefined => {
    if (tokens.length === 0) return false;
    return tokens.length === 1 && tokens[0] === "--json" ? true : undefined;
  };
  switch (action) {
    case "web": {
      const operation = tokens[0];
      if (!["status", "enable", "disable", "pair", "devices"].includes(operation ?? "")) return usage;
      if (tokens.length > 2 || (tokens.length === 2 && tokens[1] !== "--json")) return usage;
      return { command: "session", sub: { action, operation: operation as "status" | "enable" | "disable" | "pair" | "devices", json: tokens.length === 2 } };
    }
    case "pair": case "devices": {
      if (action === "devices" && tokens.length === 2 && tokens[0] === "revoke" && SAFE_SESSION_ID.test(tokens[1]!)) {
        return { command: "session", sub: { action: "devices-revoke", deviceId: tokens[1]! } };
      }
      const json = onlyJson();
      return json === undefined ? usage : { command: "session", sub: { action: "web", operation: action, json } };
    }
    case "list": case "status": case "self-test": {
      const json = onlyJson();
      return json === undefined ? usage : { command: "session", sub: { action, json } };
    }
    case "attach": case "stop":
      return tokens.length === 1 && SAFE_SESSION_ID.test(tokens[0]!) && !tokens[0]!.includes("..") ? { command: "session", sub: { action, sessionId: tokens[0]! } } : usage;
    case "ack-claude-tos":
      return tokens.length === 0 || (tokens.length === 1 && tokens[0] === "--yes") ? { command: "session", sub: { action, yes: tokens.length === 1 } } : usage;
    case "prune": {
      let dryRun = false;
      let json = false;
      let maxAgeDays: number | undefined;
      let keep: number | undefined;
      const number = (text: string | undefined): number | undefined => (text !== undefined && /^\d+$/.test(text) ? Number(text) : undefined);
      for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i]!;
        if (token === "--dry-run") dryRun = true;
        else if (token === "--json") json = true;
        else if (token === "--max-age-days" || token === "--keep") {
          const value = number(tokens[i + 1]);
          if (value === undefined) return usage;
          if (token === "--keep") keep = value; else maxAgeDays = value;
          i += 1;
        } else if (token.startsWith("--max-age-days=") || token.startsWith("--keep=")) {
          const [flag, raw] = token.split("=") as [string, string];
          const value = number(raw);
          if (value === undefined) return usage;
          if (flag === "--keep") keep = value; else maxAgeDays = value;
        } else return usage;
      }
      return { command: "session", sub: { action, dryRun, json, ...(maxAgeDays === undefined ? {} : { maxAgeDays }), ...(keep === undefined ? {} : { keep }) } };
    }
    default: return usage;
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  // argv[0] is typically the runtime, argv[1] is the script
  // We skip those — the caller should pass only the user args
  const args = argv.slice(0);

  if (args.length === 0) {
    return { command: "tui" };
  }

  const [first, ...rest] = args;

  if (first === "internal") {
    if (rest[0] === "codebase-mcp-guard-v1") {
      const guard = parseCodebaseGuardArgs(rest.slice(1));
      return guard ? { command: "internal-codebase-mcp-guard-v1", guard } : { command: "error", message: "Invalid Codebase guard invocation." };
    }
    if (rest.length === 2 && rest[0] === "serena-mcp" && rest[1] === "--probe") return { command: "internal-serena-mcp", probe: true };
    if (rest.length === 1 && rest[0] === "serena-mcp") return { command: "internal-serena-mcp", probe: false };
    if (rest.length === 1 && rest[0] === "supermemory-runtime-smoke") return { command: "internal-supermemory-runtime-smoke" };
    if (rest.length === 1 && rest[0] === "codex-memory-hook") return { command: "internal-codex-memory-hook" };
    if (rest.length === 1 && rest[0] === "memory-mcp") return { command: "internal-memory-mcp" };
    if (rest.length === 2 && rest[0] === "daemon-restart-helper" && rest[1]!.startsWith("/")) return {command:"internal-daemon-restart-helper",intentPath:rest[1]!};
    if (rest.length === 1 && rest[0] === "session-daemon") return { command: "internal-session-daemon" };
    if (rest.length === 1 && rest[0] === "session-mcp") return { command: "internal-session-mcp" };
    if (rest[0] === "child-anchor") {
      const argv = rest[1] === "--" ? rest.slice(2) : rest.slice(1);
      return argv.length > 0 ? { command: "internal-child-anchor", argv } : { command: "error", message: "Usage: deck internal child-anchor -- <command> [args...]" };
    }
    return { command: "error", message: "Usage: deck internal serena-mcp" };
  }

  if (first === "web") {
    if (rest.length === 1 && ["--help", "-h"].includes(rest[0]!)) return { command: "web-help" };
    if (new Set(rest).size !== rest.length || rest.some(flag => !["--json", "--no-open"].includes(flag))) return {command:"error",message:WEB_USAGE};
    return {command:"web",flags:{json:rest.includes("--json"),noOpen:rest.includes("--no-open")}};
  }
  if (first === "cross") return parseCrossArgs(rest);
  if (first === "session") return parseSessionArgs(rest);
  if (first === "daemon") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) return { command: "daemon-help" };
    const [action, ...flags] = rest;
    if (!["start", "status", "stop", "restart"].includes(action ?? "") || flags.length > 1 || flags.some((f) => f !== "--json")) return { command: "error", message: DAEMON_USAGE };
    return { command: "daemon", sub: { action: action as DaemonSubcommand["action"], json: flags.includes("--json") } };
  }

  if (first === "--version" || first === "-v") {
    return rest.length === 0 ? { command: "version" } : { command: "error", message: "`deck --version` takes no arguments." };
  }

  if (first === "doctor") {
    if (rest.length > 0) {
      return {
        command: "error",
        message: "El comando `deck doctor` no acepta argumentos adicionales.",
      };
    }
    return { command: "doctor" };
  }

  if (first === "supermemory") {
    if (rest[0] !== "migrate" || rest[1] !== "--dry-run") {
      return {
        command: "error",
        message: "Usage: deck supermemory migrate --dry-run --destination-scope <scope> --inventory <path>",
      };
    }
    let destinationScope: string | undefined;
    let inventoryPath: string | undefined;
    for (let i = 2; i < rest.length; i += 1) {
      const flag = rest[i]!;
      if (flag === "--destination-scope") {
        destinationScope = rest[i + 1];
        i += 1;
      } else if (flag.startsWith("--destination-scope=")) {
        destinationScope = flag.slice("--destination-scope=".length);
      } else if (flag === "--inventory") {
        inventoryPath = rest[i + 1];
        i += 1;
      } else if (flag.startsWith("--inventory=")) {
        inventoryPath = flag.slice("--inventory=".length);
      } else {
        return { command: "error", message: `Unknown Supermemory migration flag: ${flag}` };
      }
    }
    if (!destinationScope?.trim() || !inventoryPath?.trim()) {
      return {
        command: "error",
        message: "Usage: deck supermemory migrate --dry-run --destination-scope <scope> --inventory <path>",
      };
    }
    return {
      command: "supermemory-migration-dry-run",
      flags: { destinationScope: destinationScope.trim(), inventoryPath: inventoryPath.trim() },
    };
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

  if (first === "claude") {
    if (rest.length === 1 && rest[0] === "developer") return { command: "claude-team-launch" };
    const usage = "Usage: deck claude developer | deck claude native [resume <session-id> | resume --last]. Developer delivers the team as plugin files; memory uses the official Supermemory plugin when selected, and protected execution is instruction-level. Native uses safe mode without Deck team files.";
    if (rest[0] !== "native") return { command: "error", message: usage };
    if (rest.length === 1) return { command: "claude-native-launch", launch: { mode: "interactive" } };
    if (rest.length === 3 && rest[1] === "resume") {
      if (rest[2] === "--last") return { command: "claude-native-launch", launch: { mode: "resume-latest" } };
      if (rest[2] && !rest[2].startsWith("-") && !/[\0\r\n]/.test(rest[2]) && Buffer.byteLength(rest[2], "utf8") <= 1024) {
        return { command: "claude-native-launch", launch: { mode: "resume-by-id", sessionId: rest[2] } };
      }
    }
    return { command: "error", message: usage };
  }

  if (first === "codex") {
    return parseCodexArgs(rest);
  }

  if (first === "opencode") {
    let memoryProvider: "supermemory" | "none" | undefined;
    const valid = rest.every((token, index) => {
      if (index === 0) return token === "developer";
      if (["--yes", "--dry-run", "--install-only", "--verbose"].includes(token)) return true;
      if (token.startsWith("--memory=")) {
        const value = token.slice("--memory=".length);
        if (value === "supermemory" || value === "none") {
          memoryProvider = value;
          return true;
        }
      }
      return false;
    });
    if (!valid) {
      return { command: "error", message: "Usage: deck opencode developer [--install-only] [--dry-run] [--yes] [--verbose] [--memory=supermemory|none]" };
    }
    return {
      command: "runner-launch",
      runnerId: "opencode",
      teamId: "developer-team",
      launch: { mode: "interactive" },
      ...(rest.includes("--install-only") ? { installOnly: true } : {}),
      ...(rest.includes("--dry-run") ? { dryRun: true } : {}),
      ...(rest.includes("--yes") ? { yes: true } : {}),
      ...(rest.includes("--verbose") ? { verbose: true } : {}),
      ...(memoryProvider ? { memoryProvider } : {}),
    };
  }

  if (first !== "pi") {
    return { command: "tui" };
  }

  // `deck pi ...`
  if (rest.length === 0) {
    return {
      command: "error",
      message: "Usage: deck pi <team> [--continue | --resume] [--memory=supermemory|none] [--cleanup-legacy]\nAvailable teams: developer",
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
  let cleanupLegacy = false;

  for (const flag of flags) {
    if (flag === "--cleanup-legacy") {
      cleanupLegacy = true;
    } else if (flag === "--continue") {
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
    if (memoryProvider === "") {
      return { command: "error", message: "--memory requires a value: supermemory or none." };
    } else if (memoryProvider === "none") {
      // Explicitly disabled — preserve the override through launch.
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
    ...(cleanupLegacy ? { cleanupLegacy: true } : {}),
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

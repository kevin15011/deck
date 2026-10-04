import { isAbsolute, join, normalize } from "node:path";

export const PI_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
export const DEFAULT_PI_AGENT_DIR_SEGMENTS = [".pi", "agent"] as const;

export type PiAgentDirResolution =
  | Readonly<{ ok: true; dir: string; source: "env" | "default" }>
  | Readonly<{ ok: false; code: "PI_AGENT_DIR_EMPTY" | "PI_AGENT_DIR_RELATIVE" | "PI_AGENT_DIR_INVALID" | "PI_AGENT_HOME_INVALID"; message: string }>;

function stripTrailingSeparators(path: string): string {
  return path.length > 1 ? path.replace(/[\\/]+$/, "") || "/" : path;
}

/**
 * Single source of truth for the Pi agent directory: `PI_CODING_AGENT_DIR` when set to a non-empty absolute
 * path, otherwise `<home>/.pi/agent`. An empty or relative override is a blocking diagnostic.
 */
export function resolvePiAgentDir(
  env: Readonly<Record<string, string | undefined>>,
  homeDirectory: string,
): PiAgentDirResolution {
  const override = env[PI_AGENT_DIR_ENV];
  if (override !== undefined) {
    if (override.trim().length === 0) {
      return { ok: false, code: "PI_AGENT_DIR_EMPTY", message: `${PI_AGENT_DIR_ENV} is set but empty; set it to an absolute directory or unset it.` };
    }
    if (override.includes("\0")) {
      return { ok: false, code: "PI_AGENT_DIR_INVALID", message: `${PI_AGENT_DIR_ENV} contains an invalid character.` };
    }
    if (!isAbsolute(override)) {
      return { ok: false, code: "PI_AGENT_DIR_RELATIVE", message: `${PI_AGENT_DIR_ENV} must be an absolute path (got a relative path); set it to an absolute directory or unset it.` };
    }
    return { ok: true, dir: stripTrailingSeparators(normalize(override)), source: "env" };
  }
  if (!homeDirectory || homeDirectory.includes("\0") || !isAbsolute(homeDirectory)) {
    return { ok: false, code: "PI_AGENT_HOME_INVALID", message: "Cannot resolve the default Pi agent directory because the home directory is not an absolute path." };
  }
  return { ok: true, dir: join(homeDirectory, ...DEFAULT_PI_AGENT_DIR_SEGMENTS), source: "default" };
}

/** Like {@link resolvePiAgentDir} but throws a blocking error so callers cannot write before validation. */
export function requirePiAgentDir(env: Readonly<Record<string, string | undefined>>, homeDirectory: string): string {
  const resolved = resolvePiAgentDir(env, homeDirectory);
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.dir;
}

export type PiAgentPaths = Readonly<{
  agentDir: string;
  settings: string;
  mcp: string;
  deckRoot: string;
  manifest: string;
  packageRoot: string;
  profilesRoot: string;
  /** Path as `pi install <abs path>` stores it in `settings.json` `packages` (relative to the agent dir). */
  packageSettingsEntry: string;
}>;

export function piAgentPaths(agentDir: string): PiAgentPaths {
  const deckRoot = join(agentDir, "deck");
  return Object.freeze({
    agentDir,
    settings: join(agentDir, "settings.json"),
    mcp: join(agentDir, "mcp.json"),
    deckRoot,
    manifest: join(deckRoot, "manifest.json"),
    packageRoot: join(deckRoot, "package"),
    profilesRoot: join(deckRoot, "profiles"),
    packageSettingsEntry: "deck/package",
  });
}

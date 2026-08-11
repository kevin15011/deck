/**
 * Deck runtime path resolver.
 *
 * Resolves Deck runtime paths following the XDG Base Directory specification.
 * Active Deck preferences use only `$XDG_CONFIG_HOME/deck/config.json`, or
 * `~/.config/deck/config.json` when `XDG_CONFIG_HOME` is unset.
 *
 * XDG split layout (introduced by `add-self-update-system`):
 *   - `$XDG_CONFIG_HOME/deck/` (default `~/.config/deck/`) for `config.yaml` and the
 *     compatibility-read `config.json` (legacy `~/.config/.deck/config.json` is
 *     one-shot migrated here).
 *   - `$XDG_STATE_HOME/deck/` (default `~/.local/state/deck/`) for `state.yaml`,
 *     `manifest.json`, history and `logs/`.
 *   - `$XDG_CACHE_HOME/deck/` (default `~/.cache/deck/`) for `releases/vX.Y.Z/`
 *     and `backups/<ts>/`.
 *
 * @module
 */

import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

// Cache computed values to avoid recomputation
let cachedHomeDir: string | undefined;
let cachedXdgConfigHome: string | undefined;
let cachedXdgStateHome: string | undefined;
let cachedXdgCacheHome: string | undefined;

/**
 * Reset the module-level XDG path cache. Intended for tests that need to
 * exercise the resolvers under different `XDG_*_HOME` values; not exported
 * from the public API surface.
 *
 * @internal
 */
export function _resetDeckPathCache(): void {
  cachedHomeDir = undefined;
  cachedXdgConfigHome = undefined;
  cachedXdgStateHome = undefined;
  cachedXdgCacheHome = undefined;
}

// ============================================================================
// Types
// ============================================================================

export type ConfigPaths = {
  configDir: string;
  configPath: string;
};

export type DeckConfigMigrationCandidateKind =
  | "xdg-dot-deck"
  | "home-config-dot-deck"
  | "home-dot-deck";

export type DeckConfigMigrationCandidatePath = ConfigPaths & {
  kind: DeckConfigMigrationCandidateKind;
};

export type DeckXdgPaths = {
  /** `$XDG_CONFIG_HOME/deck/` (default `~/.config/deck/`) */
  configDir: string;
  /** `$XDG_CONFIG_HOME/deck/config.json` (canonical active Deck preferences) */
  configPath: string;
  /** `$XDG_CONFIG_HOME/deck/config.yaml` (new updater-preferences YAML) */
  configYamlPath: string;
  /** `$XDG_STATE_HOME/deck/` (default `~/.local/state/deck/`) */
  stateDir: string;
  /** `$XDG_STATE_HOME/deck/state.yaml` */
  statePath: string;
  /** `$XDG_STATE_HOME/deck/manifest.json` */
  manifestPath: string;
  /** `$XDG_STATE_HOME/deck/logs/` */
  logsDir: string;
  /** `$XDG_CACHE_HOME/deck/` (default `~/.cache/deck/`) */
  cacheDir: string;
  /** `$XDG_CACHE_HOME/deck/releases/` */
  releasesDir: string;
  /** `$XDG_CACHE_HOME/deck/backups/` */
  backupsDir: string;
};

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Get the home directory in a cross-platform way.
 */
function getHomeDir(): string {
  if (cachedHomeDir === undefined) {
    const home = process.env.HOME;
    cachedHomeDir = home && isAbsolute(home) ? home : homedir();
  }
  return cachedHomeDir;
}

/**
 * Get the XDG config home directory, if set and valid.
 */
function getXdgConfigHome(): string | undefined {
  if (cachedXdgConfigHome === undefined) {
    const xdg = process.env.XDG_CONFIG_HOME;
    if (xdg && xdg.length > 0 && xdg.startsWith("/")) {
      cachedXdgConfigHome = xdg;
    }
    // Already undefined
  }
  return cachedXdgConfigHome;
}

/**
 * Get the XDG state home directory, if set and valid.
 */
function getXdgStateHome(): string {
  if (cachedXdgStateHome === undefined) {
    const xdg = process.env.XDG_STATE_HOME;
    if (xdg && xdg.length > 0 && xdg.startsWith("/")) {
      cachedXdgStateHome = xdg;
    } else {
      cachedXdgStateHome = join(getHomeDir(), ".local", "state");
    }
  }
  return cachedXdgStateHome;
}

/**
 * Get the XDG cache home directory, if set and valid.
 */
function getXdgCacheHome(): string {
  if (cachedXdgCacheHome === undefined) {
    const xdg = process.env.XDG_CACHE_HOME;
    if (xdg && xdg.length > 0 && xdg.startsWith("/")) {
      cachedXdgCacheHome = xdg;
    } else {
      cachedXdgCacheHome = join(getHomeDir(), ".cache");
    }
  }
  return cachedXdgCacheHome;
}

/**
 * Get the new XDG config directory for Deck (post-migration layout).
 *
 * Resolution:
 *   - `$XDG_CONFIG_HOME/deck/` (when `XDG_CONFIG_HOME` is set and absolute)
 *   - `~/.config/deck/` (default)
 */
export function getDeckConfigDir(): string {
  const xdg = getXdgConfigHome();
  if (xdg) {
    return join(xdg, "deck");
  }
  return join(getHomeDir(), ".config", "deck");
}

/**
 * Get the new XDG state directory for Deck.
 *
 * Resolution:
 *   - `$XDG_STATE_HOME/deck/` (when `XDG_STATE_HOME` is set and absolute)
 *   - `~/.local/state/deck/` (default)
 */
export function getDeckStateDir(): string {
  return join(getXdgStateHome(), "deck");
}

/**
 * Get the new XDG cache directory for Deck.
 *
 * Resolution:
 *   - `$XDG_CACHE_HOME/deck/` (when `XDG_CACHE_HOME` is set and absolute)
 *   - `~/.cache/deck/` (default)
 */
export function getDeckCacheDir(): string {
  return join(getXdgCacheHome(), "deck");
}

/**
 * Get the full new XDG path bundle in one call.
 */
export function getDeckXdgPaths(): DeckXdgPaths {
  const configDir = getDeckConfigDir();
  const stateDir = getDeckStateDir();
  const cacheDir = getDeckCacheDir();

  return {
    configDir,
    configPath: join(configDir, "config.json"),
    configYamlPath: join(configDir, "config.yaml"),
    stateDir,
    statePath: join(stateDir, "state.yaml"),
    manifestPath: join(stateDir, "manifest.json"),
    logsDir: join(stateDir, "logs"),
    cacheDir,
    releasesDir: join(cacheDir, "releases"),
    backupsDir: join(cacheDir, "backups"),
  };
}

/**
  * Get the legacy Deck config directory that the XDG migration may import.
 *
  * This is migration-only metadata, not an active preference fallback.
  */
export function getDeckConfigMigrationCandidateDir(): string {
  const home = getHomeDir();
  const xdg = getXdgConfigHome();
  if (xdg) {
    return join(xdg, ".deck");
  }
  return join(home, ".config", ".deck");
}

/**
  * Get the canonical global Deck config directory.
 *
 * @returns Resolved config directory path
 */
export function getGlobalDeckConfigDir(): string {
  return getDeckConfigDir();
}

/**
 * Get the full path to the global Deck config file.
 *
 * @returns Full path to `config.json`
 */
export function getGlobalDeckConfigPath(): string {
  const configDir = getGlobalDeckConfigDir();
  return join(configDir, "config.json");
}

/**
 * Get the runner config directory for backward compatibility.
 *
 * This is the existing runner config location that should remain
 * supported (e.g., `~/.config/opencode/`).
 *
 * @returns Runner config directory path
 */
export function getRunnerConfigDir(): string {
  const home = getHomeDir();
  return join(home, ".config", "opencode");
}

/**
 * Get migration-candidate config paths only.
 *
 * These paths describe legacy locations that migration tooling may inspect.
 * They are not an active read order and must not be used as runtime preference
 * fallbacks.
 */
export function getDeckConfigMigrationCandidatePaths(): DeckConfigMigrationCandidatePath[] {
  const home = getHomeDir();
  const xdg = getXdgConfigHome();

  const paths: DeckConfigMigrationCandidatePath[] = [];

  if (xdg) {
    paths.push({
      kind: "xdg-dot-deck",
      configDir: join(xdg, ".deck"),
      configPath: join(xdg, ".deck", "config.json"),
    });
  }

  paths.push({
    kind: "home-config-dot-deck",
    configDir: join(home, ".config", ".deck"),
    configPath: join(home, ".config", ".deck", "config.json"),
  });

  paths.push({
    kind: "home-dot-deck",
    configDir: join(home, ".deck"),
    configPath: join(home, ".deck", "config.json"),
  });

  return paths;
}

/**
 * Check if the canonical global Deck config exists.
 *
 * Legacy migration candidates are intentionally excluded.
 */
export function canonicalGlobalDeckConfigExists(): boolean {
  const { existsSync } = require("node:fs");
  return existsSync(getGlobalDeckConfigPath());
}

/**
 * Resolve the first existing migration-candidate config path.
 *
 * Migration tooling may use this to decide whether a legacy import is needed.
 * Runtime preference reads must use the canonical global config path instead.
 */
export function resolveExistingDeckConfigMigrationCandidatePath(): string | undefined {
  const { existsSync } = require("node:fs");
  const paths = getDeckConfigMigrationCandidatePaths();

  for (const { configPath } of paths) {
    if (existsSync(configPath)) {
      return configPath;
    }
  }

  return undefined;
}

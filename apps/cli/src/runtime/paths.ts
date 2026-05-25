/**
 * Global Deck config path resolver.
 *
 * Resolves Deck global configuration paths following XDG Base Directory
 * specification with fallback to legacy ~/.deck location.
 *
 * Primary:   $XDG_CONFIG_HOME/.deck/config.json   (when XDG_CONFIG_HOME is set)
 * Default:   ~/.config/.deck/config.json
 * Fallback:  ~/.deck/config.json   (for migration from older installations)
 *
 * @module
 */

import { homedir } from "node:os";
import { join } from "node:path";

// Cache computed values to avoid recomputation
let cachedHomeDir: string | undefined;
let cachedXdgConfigHome: string | undefined;

// ============================================================================
// Types
// ============================================================================

export type ConfigPaths = {
  configDir: string;
  configPath: string;
};

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Get the home directory in a cross-platform way.
 */
function getHomeDir(): string {
  if (cachedHomeDir === undefined) {
    cachedHomeDir = homedir();
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
 * Get the global Deck config directory.
 *
 * Resolution order:
 * 1. $XDG_CONFIG_HOME/.deck (if XDG_CONFIG_HOME is set)
 * 2. ~/.config/.deck (default)
 * 3. ~/.deck (fallback for migration)
 *
 * @returns Resolved config directory path
 */
export function getGlobalDeckConfigDir(): string {
  const home = getHomeDir();
  const xdg = getXdgConfigHome();

  if (xdg) {
    return join(xdg, ".deck");
  }

  // Default: ~/.config/.deck
  return join(home, ".config", ".deck");
}

/**
 * Get the full path to the global Deck config file.
 *
 * @returns Full path to config.json
 */
export function getGlobalDeckConfigPath(): string {
  const configDir = getGlobalDeckConfigDir();
  return join(configDir, "config.json");
}

/**
 * Get the runner config directory for backward compatibility.
 *
 * This is the existing runner config location that should remain
 * supported (e.g., ~/.config/opencode/).
 *
 * @returns Runner config directory path
 */
export function getRunnerConfigDir(): string {
  const home = getHomeDir();
  return join(home, ".config", "opencode");
}

/**
 * Get all config paths in resolution order.
 *
 * Returns all paths that should be checked, in order of preference.
 * The first existing path should be used for reading; writes go to
 * the primary path.
 *
 * @returns Array of config paths to check
 */
export function getAllConfigPaths(): ConfigPaths[] {
  const home = getHomeDir();
  const xdg = getXdgConfigHome();

  const paths: ConfigPaths[] = [];

  // Primary (XDG or default)
  if (xdg) {
    paths.push({
      configDir: join(xdg, ".deck"),
      configPath: join(xdg, ".deck", "config.json"),
    });
  }

  // Default ~/.config/.deck
  paths.push({
    configDir: join(home, ".config", ".deck"),
    configPath: join(home, ".config", ".deck", "config.json"),
  });

  // Fallback ~/.deck
  paths.push({
    configDir: join(home, ".deck"),
    configPath: join(home, ".deck", "config.json"),
  });

  return paths;
}

/**
 * Check if the global Deck config exists (looking in all potential locations).
 *
 * @returns true if any config location has a config.json
 */
export function globalDeckConfigExists(): boolean {
  const { existsSync } = require("node:fs");
  const paths = getAllConfigPaths();

  for (const { configPath } of paths) {
    if (existsSync(configPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Resolve the first existing config path for reading.
 *
 * @returns The first existing config path, or undefined if none exist
 */
export function resolveExistingGlobalConfigPath(): string | undefined {
  const { existsSync } = require("node:fs");
  const paths = getAllConfigPaths();

  for (const { configPath } of paths) {
    if (existsSync(configPath)) {
      return configPath;
    }
  }

  return undefined;
}
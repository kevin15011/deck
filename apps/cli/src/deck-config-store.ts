import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  patchDeckConfigFile,
  readDeckConfigFilePreimage,
  readDeckConfigFile,
  validateDeckConfig,
  type DeckConfigFilePreimage,
  type NormalizedDeckConfig,
} from "@deck/core";

export type DeckConfigDiscovery = Readonly<{
  canonicalPath: string;
  canonicalExists: boolean;
  activePath?: string;
}>;

export type DeckConfigStorePaths = Readonly<{
  homeDir: string;
  xdgConfigHome: string;
  canonicalDir: string;
  canonicalPath: string;
}>;

export type DeckConfigStoreOptions = Readonly<{
  homeDir?: string;
  xdgConfigHome?: string;
  projectRoot?: string | null;
  allowDefaultEnvironment?: boolean;
}>;

export class DeckConfigEnvironmentError extends Error {
  readonly code = "DECK_CONFIG_ENVIRONMENT_REQUIRED" as const;

  constructor(message = "Deck config store requires caller-resolved homeDir and xdgConfigHome.") {
    super(message);
    this.name = "DeckConfigEnvironmentError";
  }
}

export class DeckConfigReadinessError extends Error {
  readonly code: "DECK_CONFIG_MISSING" | "DECK_CONFIG_INVALID";

  constructor(code: "DECK_CONFIG_MISSING" | "DECK_CONFIG_INVALID", message: string) {
    super(message);
    this.name = "DeckConfigReadinessError";
    this.code = code;
  }
}

export class DeckConfigStore {
  readonly paths: DeckConfigStorePaths;

  constructor(options: DeckConfigStoreOptions = {}) {
    if (!options.allowDefaultEnvironment && (!options.homeDir || !options.xdgConfigHome)) {
      throw new DeckConfigEnvironmentError();
    }
    const homeDir = resolve(options.homeDir ?? process.env.HOME ?? homedir());
    const envXdg = options.xdgConfigHome ?? process.env.XDG_CONFIG_HOME;
    const xdgConfigHome = envXdg && envXdg.length > 0 && envXdg.startsWith("/")
      ? resolve(envXdg)
      : join(homeDir, ".config");
    const canonicalDir = join(xdgConfigHome, "deck");
    this.paths = Object.freeze({
      homeDir,
      xdgConfigHome,
      canonicalDir,
      canonicalPath: join(canonicalDir, "config.json"),
    });
  }

  discover(): DeckConfigDiscovery {
    const canonicalExists = existsSync(this.paths.canonicalPath);
    return { canonicalPath: this.paths.canonicalPath, canonicalExists, ...(canonicalExists ? { activePath: this.paths.canonicalPath } : {}) };
  }

  read(): NormalizedDeckConfig {
    return readDeckConfigFile(this.paths.canonicalPath, { containmentRoot: this.paths.xdgConfigHome });
  }

  readRequired(): NormalizedDeckConfig {
    if (!this.discover().canonicalExists) {
      throw new DeckConfigReadinessError("DECK_CONFIG_MISSING", "Canonical global Deck config is required.");
    }
    return this.read();
  }

  patch(patch: (existing: NormalizedDeckConfig) => unknown): NormalizedDeckConfig {
    return patchDeckConfigFile(this.paths.canonicalPath, patch, { containmentRoot: this.paths.xdgConfigHome, maxRetries: 3 });
  }

  write(config: unknown): NormalizedDeckConfig {
    return patchDeckConfigFile(this.paths.canonicalPath, (existing) => mergeDeckConfig(existing, config), { containmentRoot: this.paths.xdgConfigHome, maxRetries: 3 });
  }

  preimage(): DeckConfigFilePreimage {
    return readDeckConfigFilePreimage(this.paths.canonicalPath, { containmentRoot: this.paths.xdgConfigHome });
  }

}

export function createDeckConfigStore(options: DeckConfigStoreOptions = {}): DeckConfigStore {
  return new DeckConfigStore(options);
}

export function createDeckConfigStoreFromEnvironment(options: Pick<DeckConfigStoreOptions, "projectRoot"> = {}): DeckConfigStore {
  return new DeckConfigStore({
    homeDir: process.env.HOME ?? homedir(),
    xdgConfigHome: process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.length > 0 ? process.env.XDG_CONFIG_HOME : join(process.env.HOME ?? homedir(), ".config"),
    projectRoot: options.projectRoot,
    allowDefaultEnvironment: true,
  });
}

function mergeRecord(existing: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return patch;
  const result: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    result[key] = mergeRecord(result[key], value);
  }
  return result;
}

function mergeDeckConfig(existing: NormalizedDeckConfig, patch: unknown): NormalizedDeckConfig {
  const merged = mergeRecord(existing, patch) as Record<string, unknown>;
  if (patch && typeof patch === "object" && !Array.isArray(patch) && "packageInstructions" in patch) {
    const packagePatch = (patch as { packageInstructions?: unknown }).packageInstructions;
    if (packagePatch && typeof packagePatch === "object" && !Array.isArray(packagePatch)) {
      merged.packageInstructions = { ...existing.packageInstructions };
      for (const [runner, runnerConfig] of Object.entries(packagePatch as Record<string, unknown>)) {
        (merged.packageInstructions as Record<string, unknown>)[runner] = validateDeckConfig({ packageInstructions: { [runner]: runnerConfig } }).packageInstructions[runner];
      }
    }
  }
  return validateDeckConfig(merged);
}

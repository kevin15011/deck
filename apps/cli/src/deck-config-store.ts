import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  DeckConfigError,
  getDeckConfigPath,
  getDefaultDeckConfig,
  patchDeckConfigFile,
  readDeckConfigFilePreimage,
  readDeckConfigFile,
  validateDeckConfig,
  writeDeckConfigFileAtomic,
  type DeckConfig,
  type DeckConfigFilePreimage,
  type NormalizedDeckConfig,
} from "@deck/core";

export type DeckConfigCandidateKind =
  | "canonical"
  | "legacy-xdg-dot-deck"
  | "legacy-home-config-dot-deck"
  | "legacy-home-dot-deck"
  | "legacy-project-dot-deck";

export type DeckConfigCandidateMetadata = Readonly<{
  kind: DeckConfigCandidateKind;
  path: string;
  digest: string;
}>;

export type InvalidDeckConfigCandidate = Readonly<{
  kind: DeckConfigCandidateKind;
  path: string;
  code: string;
}>;

export type DeckConfigMigrationConflict = Readonly<{
  code: "DECK_CONFIG_MIGRATION_CONFLICT";
  canonicalPath: string;
  candidates: readonly DeckConfigCandidateMetadata[];
  invalidCandidates: readonly InvalidDeckConfigCandidate[];
}>;

export type DeckConfigDiscovery = Readonly<{
  canonicalPath: string;
  canonicalExists: boolean;
  activePath?: string;
  validCandidates: readonly DeckConfigCandidateMetadata[];
  invalidCandidates: readonly InvalidDeckConfigCandidate[];
  differingLegacyCandidates: readonly DeckConfigCandidateMetadata[];
  conflict?: DeckConfigMigrationConflict;
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

export type DeckConfigMigrationSelection =
  | Readonly<{ action: "keep" }>
  | Readonly<{ action: "adopt"; candidatePath: string }>;

type Candidate = Readonly<{
  kind: DeckConfigCandidateKind;
  path: string;
}>;

type ValidProjection = Readonly<{
  candidate: Candidate;
  config: NormalizedDeckConfig;
  digest: string;
  projectionKey: string;
}>;

export class DeckConfigEnvironmentError extends Error {
  readonly code = "DECK_CONFIG_ENVIRONMENT_REQUIRED" as const;

  constructor(message = "Deck config store requires caller-resolved homeDir and xdgConfigHome.") {
    super(message);
    this.name = "DeckConfigEnvironmentError";
  }
}

export class DeckConfigMigrationConflictError extends Error {
  readonly conflict: DeckConfigMigrationConflict;

  constructor(conflict: DeckConfigMigrationConflict) {
    super("Deck config migration requires an explicit legacy source selection.");
    this.name = "DeckConfigMigrationConflictError";
    this.conflict = conflict;
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
  readonly #projectRoot: string | null;

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
    this.#projectRoot = options.projectRoot ? resolve(options.projectRoot) : null;
  }

  discover(): DeckConfigDiscovery {
    return this.#resolve(false).discovery;
  }

  read(): NormalizedDeckConfig {
    return this.#resolve(true).config;
  }

  readRequired(): NormalizedDeckConfig {
    const resolved = this.#resolve(false);
    if (resolved.discovery.conflict) throw new DeckConfigMigrationConflictError(resolved.discovery.conflict);
    if (!resolved.discovery.canonicalExists) {
      throw new DeckConfigReadinessError("DECK_CONFIG_MISSING", "Canonical global Deck config is required.");
    }
    return readDeckConfigFile(this.paths.canonicalPath, { containmentRoot: this.paths.xdgConfigHome });
  }

  patch(patch: (existing: NormalizedDeckConfig) => unknown): NormalizedDeckConfig {
    this.#ensureMutable();
    return patchDeckConfigFile(this.paths.canonicalPath, patch, { containmentRoot: this.paths.xdgConfigHome, maxRetries: 3 });
  }

  write(config: unknown): NormalizedDeckConfig {
    this.#ensureMutable();
    return patchDeckConfigFile(this.paths.canonicalPath, (existing) => mergeDeckConfig(existing, config), { containmentRoot: this.paths.xdgConfigHome, maxRetries: 3 });
  }

  preimage(): DeckConfigFilePreimage {
    this.#ensureMutable();
    return readDeckConfigFilePreimage(this.paths.canonicalPath, { containmentRoot: this.paths.xdgConfigHome });
  }

  selectMigration(selection: DeckConfigMigrationSelection): NormalizedDeckConfig {
    const resolved = this.#resolve(false);
    if (!resolved.discovery.conflict) return this.read();
    if (selection.action === "keep") {
      return writeDeckConfigFileAtomic(this.paths.canonicalPath, getDefaultDeckConfig(), { containmentRoot: this.paths.xdgConfigHome, expectedDigest: readDeckConfigFilePreimage(this.paths.canonicalPath, { containmentRoot: this.paths.xdgConfigHome }).digest });
    }
    const selectedPath = resolve(selection.candidatePath);
    const selected = resolved.validProjections.find((candidate) => resolve(candidate.candidate.path) === selectedPath);
    if (!selected) {
      throw new DeckConfigMigrationConflictError(resolved.discovery.conflict);
    }
    return writeDeckConfigFileAtomic(this.paths.canonicalPath, selected.config, { containmentRoot: this.paths.xdgConfigHome, expectedDigest: readDeckConfigFilePreimage(this.paths.canonicalPath, { containmentRoot: this.paths.xdgConfigHome }).digest });
  }

  #ensureMutable(): void {
    const resolved = this.#resolve(true);
    if (resolved.discovery.conflict) throw new DeckConfigMigrationConflictError(resolved.discovery.conflict);
  }

  #resolve(importUnique: boolean): { config: NormalizedDeckConfig; discovery: DeckConfigDiscovery; validProjections: readonly ValidProjection[] } {
    const candidates = this.#candidates();
    const canonical = candidates[0]!;
    const canonicalExists = existsSync(canonical.path);
    const invalidCandidates: InvalidDeckConfigCandidate[] = [];
    const validProjections: ValidProjection[] = [];

    for (const candidate of candidates) {
      if (!existsSync(candidate.path)) continue;
      try {
        validProjections.push(this.#readProjection(candidate));
      } catch (error) {
        invalidCandidates.push({
          kind: candidate.kind,
          path: candidate.path,
          code: error instanceof DeckConfigError ? error.code : "DECK_CONFIG_INVALID_JSON",
        });
      }
    }

    if (canonicalExists) {
      const config = readDeckConfigFile(canonical.path, { containmentRoot: this.paths.xdgConfigHome });
      const canonicalProjection = validProjections.find((entry) => entry.candidate.kind === "canonical");
      const differingLegacyCandidates = canonicalProjection
        ? validProjections
          .filter((entry) => entry.candidate.kind !== "canonical" && entry.projectionKey !== canonicalProjection.projectionKey)
          .map(metadataFor)
        : [];
      return {
        config,
        validProjections,
        discovery: {
          canonicalPath: canonical.path,
          canonicalExists: true,
          activePath: canonical.path,
          validCandidates: validProjections.map(metadataFor),
          invalidCandidates,
          differingLegacyCandidates,
        },
      };
    }

    const unique = new Map<string, ValidProjection>();
    for (const candidate of validProjections) {
      if (!unique.has(candidate.projectionKey)) unique.set(candidate.projectionKey, candidate);
    }
    if (unique.size === 1) {
      const projection = [...unique.values()][0]!;
      const config = importUnique ? writeDeckConfigFileAtomic(canonical.path, projection.config, { containmentRoot: this.paths.xdgConfigHome, expectedDigest: null }) : projection.config;
      return {
        config,
        validProjections,
        discovery: {
          canonicalPath: canonical.path,
          canonicalExists: false,
          activePath: importUnique ? canonical.path : projection.candidate.path,
          validCandidates: validProjections.map(metadataFor),
          invalidCandidates,
          differingLegacyCandidates: [],
        },
      };
    }

    if (unique.size > 1) {
      const conflict: DeckConfigMigrationConflict = {
        code: "DECK_CONFIG_MIGRATION_CONFLICT",
        canonicalPath: canonical.path,
        candidates: [...unique.values()].map(metadataFor),
        invalidCandidates,
      };
      const discovery = {
        canonicalPath: canonical.path,
        canonicalExists: false,
        validCandidates: validProjections.map(metadataFor),
        invalidCandidates,
        differingLegacyCandidates: [...unique.values()].map(metadataFor),
        conflict,
      } satisfies DeckConfigDiscovery;
      if (importUnique) throw new DeckConfigMigrationConflictError(conflict);
      return { config: getDefaultDeckConfig(), discovery, validProjections };
    }

    return {
      config: getDefaultDeckConfig(),
      validProjections,
      discovery: {
        canonicalPath: canonical.path,
        canonicalExists: false,
        validCandidates: [],
        invalidCandidates,
        differingLegacyCandidates: [],
      },
    };
  }

  #readProjection(candidate: Candidate): ValidProjection {
    const containmentRoot = this.#candidateContainmentRoot(candidate);
    readDeckConfigFile(candidate.path, containmentRoot ? { containmentRoot } : {});
    const rawText = readFileSync(candidate.path, "utf8");
    const digest = createHash("sha256").update(rawText).digest("hex");
    const raw = JSON.parse(rawText) as unknown;
    const projected = projectGlobalFields(raw, candidate.kind === "legacy-project-dot-deck");
    const config = validateDeckConfig(projected, { configPath: candidate.path });
    const projectionKey = stableStringify(projectGlobalFields(config, true));
    return { candidate, config, digest, projectionKey };
  }

  #candidateContainmentRoot(candidate: Candidate): string | undefined {
    if (candidate.kind === "canonical" || candidate.kind === "legacy-xdg-dot-deck") return this.paths.xdgConfigHome;
    if (candidate.kind === "legacy-home-config-dot-deck" || candidate.kind === "legacy-home-dot-deck") return this.paths.homeDir;
    if (candidate.kind === "legacy-project-dot-deck") return this.#projectRoot ?? undefined;
    return undefined;
  }

  #candidates(): readonly Candidate[] {
    const candidates: Candidate[] = [
      { kind: "canonical", path: this.paths.canonicalPath },
      { kind: "legacy-xdg-dot-deck", path: join(this.paths.xdgConfigHome, ".deck", "config.json") },
      { kind: "legacy-home-config-dot-deck", path: join(this.paths.homeDir, ".config", ".deck", "config.json") },
      { kind: "legacy-home-dot-deck", path: join(this.paths.homeDir, ".deck", "config.json") },
    ];
    if (this.#projectRoot) {
      candidates.push({ kind: "legacy-project-dot-deck", path: getDeckConfigPath(this.#projectRoot) });
    }
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      const normalized = resolve(candidate.path);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
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

function metadataFor(entry: ValidProjection): DeckConfigCandidateMetadata {
  return { kind: entry.candidate.kind, path: entry.candidate.path, digest: entry.digest };
}

function projectGlobalFields(value: unknown, omitProfiles: boolean): DeckConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of [
    "adaptiveMemory",
    "webSearch",
    "packageInstructions",
    "orchestratorPersonality",
    "developerTeamExecution",
  ]) {
    if (key in input) output[key] = input[key];
  }
  if (!omitProfiles) {
    if ("profiles" in input) output.profiles = input.profiles;
    if ("activeProfile" in input) output.activeProfile = input.activeProfile;
  }
  return output as DeckConfig;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

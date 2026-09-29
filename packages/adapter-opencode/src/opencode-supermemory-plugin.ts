import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveDefaultDeckDataRoot } from "@deck/core";

import { enumerateOpenCodeConfigCandidates } from "./model-discovery-context";

export const OPENCODE_SUPERMEMORY_PACKAGE_VERSION = "2.0.15";
export const OPENCODE_SUPERMEMORY_PACKAGE_SPEC = `opencode-supermemory@${OPENCODE_SUPERMEMORY_PACKAGE_VERSION}`;
export const OPENCODE_SUPERMEMORY_PACKAGE_INTEGRITY = "sha512-5rVGW0yxP+w4Iz71y7qkAjiiigSQArC/OqfEyfCoRNZPS1dCJQrdBcyYwrrSSwX/89qLKIIFRwmkl7l5xKYctQ==";

const PUBLISHED_ARTIFACT_DIGESTS = Object.freeze({
  "package.json": "d8efdecc9b36b04104bac1f14bc7a24ea51efd142e356c925126a9519ed6e69a",
  "dist/index.js": "7609aae38efb0f07a39759cab404e28b02d1e31e5d601a012f6efd83b202d1a7",
  "dist/server.js": "37e56a4860f41c7a51a1dfecff3b750c7442f3748a410e32ac56de6eda9a3414",
});

type ArtifactPath = keyof typeof PUBLISHED_ARTIFACT_DIGESTS;
type ArtifactDigests = Readonly<Record<ArtifactPath, string>>;

export type OwnedOpenCodeSupermemoryPaths = Readonly<{
  installRoot: string;
  packageDirectory: string;
  loaderPath: string;
  loaderLocator: string;
}>;

export type OpenCodeSupermemoryInspection = Readonly<{
  ready: boolean;
  code: "ready" | "missing" | "unsafe-owned-path" | "invalid-package-metadata" | "package-integrity-mismatch" | "artifact-digest-mismatch" | "loader-mismatch";
  diagnostic: string;
  paths: OwnedOpenCodeSupermemoryPaths;
}>;

export type OpenCodeSupermemoryRegistrationConflict = Readonly<{
  source: string;
  registration: string;
}>;

export type RunOpenCodeSupermemoryInstallCommand = (
  command: string,
  args: string[],
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

function contained(root: string, candidate: string): boolean {
  const suffix = relative(root, candidate);
  return suffix === "" || (!suffix.startsWith("..") && !isAbsolute(suffix));
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function ownerAndModeAreSafe(stat: Stats): boolean {
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return false;
  return (stat.mode & 0o022) === 0;
}

function safeReadOwned(path: string, maxBytes = 1024 * 1024): Buffer | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maxBytes || (stat.mode & 0o400) === 0 || !ownerAndModeAreSafe(stat)) return undefined;
    return readFileSync(descriptor);
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function isSafeDirectory(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isSafeOwnedDirectory(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o500) === 0o500 && ownerAndModeAreSafe(stat);
  } catch {
    return false;
  }
}

function canonicalizeAllowMissing(path: string): string {
  const missing: string[] = [];
  let cursor = resolve(path);
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(cursor.slice(parent.length + (parent.endsWith("/") ? 0 : 1)));
    cursor = parent;
  }
  const canonical = realpathSync(cursor);
  return missing.reduce((current, segment) => join(current, segment), canonical);
}

function hasUnsafeOwnedSegment(deckRoot: string, paths: OwnedOpenCodeSupermemoryPaths): boolean {
  const candidates = [
    dirname(deckRoot),
    deckRoot,
    join(deckRoot, "opencode"),
    join(deckRoot, "opencode", "supermemory"),
    paths.installRoot,
    join(paths.installRoot, "node_modules"),
    paths.packageDirectory,
    join(paths.packageDirectory, "dist"),
  ];
  return candidates.some((candidate) => existsSync(candidate) && !isSafeOwnedDirectory(candidate));
}

export function resolveOwnedOpenCodeSupermemoryPaths(input: {
  environment?: Readonly<Record<string, string | undefined>>;
  homeDirectory?: string;
} = {}): OwnedOpenCodeSupermemoryPaths {
  const environment = input.environment ?? process.env;
  const homeDirectory = input.homeDirectory ?? homedir();
  const deckRoot = canonicalizeAllowMissing(resolveDefaultDeckDataRoot(environment, homeDirectory));
  const installRoot = join(
    deckRoot,
    "opencode",
    "supermemory",
    OPENCODE_SUPERMEMORY_PACKAGE_VERSION,
  );
  const packageDirectory = join(installRoot, "node_modules", "opencode-supermemory");
  const loaderPath = join(installRoot, "opencode-supermemory-loader.mjs");
  return Object.freeze({
    installRoot,
    packageDirectory,
    loaderPath,
    loaderLocator: pathToFileURL(loaderPath).href,
  });
}

export function buildOpenCodeSupermemoryLoaderContent(): string {
  return [
    'import { SupermemoryPlugin } from "./node_modules/opencode-supermemory/dist/index.js";',
    'import ServerPlugin from "./node_modules/opencode-supermemory/dist/server.js";',
    "",
    "export default Object.freeze({",
    '  id: "opencode-supermemory",',
    "  server: (ctx) => SupermemoryPlugin(ctx),",
    "  setup: ServerPlugin.setup,",
    "});",
    "",
  ].join("\n");
}

function inspectInstalledArtifacts(
  paths: OwnedOpenCodeSupermemoryPaths,
  expectedArtifactDigests: ArtifactDigests,
): Omit<OpenCodeSupermemoryInspection, "paths"> {
  const packageBytes = safeReadOwned(join(paths.packageDirectory, "package.json"));
  if (!packageBytes) return { ready: false, code: "missing", diagnostic: "The Deck-owned official Supermemory package is not installed." };

  let packageJson: Record<string, unknown>;
  try {
    packageJson = JSON.parse(packageBytes.toString("utf8")) as Record<string, unknown>;
  } catch {
    return { ready: false, code: "invalid-package-metadata", diagnostic: "The Deck-owned Supermemory package metadata is invalid." };
  }
  if (packageJson.name !== "opencode-supermemory" || packageJson.version !== OPENCODE_SUPERMEMORY_PACKAGE_VERSION) {
    return { ready: false, code: "invalid-package-metadata", diagnostic: "The Deck-owned Supermemory package does not match the pinned package identity." };
  }

  const lockBytes = safeReadOwned(join(paths.installRoot, "package-lock.json"));
  if (!lockBytes) return { ready: false, code: "package-integrity-mismatch", diagnostic: "The Deck-owned Supermemory package lock is missing." };
  try {
    const lock = JSON.parse(lockBytes.toString("utf8")) as { packages?: Record<string, { version?: string; integrity?: string }> };
    const entry = Object.entries(lock.packages ?? {}).find(([key]) => {
      const candidate = canonicalizeAllowMissing(isAbsolute(key) ? key : join(paths.installRoot, key));
      return candidate === paths.packageDirectory && contained(paths.installRoot, candidate);
    })?.[1];
    if (entry?.version !== OPENCODE_SUPERMEMORY_PACKAGE_VERSION || entry.integrity !== OPENCODE_SUPERMEMORY_PACKAGE_INTEGRITY) {
      return { ready: false, code: "package-integrity-mismatch", diagnostic: "The Deck-owned Supermemory package lock does not match the pinned published artifact." };
    }
  } catch {
    return { ready: false, code: "package-integrity-mismatch", diagnostic: "The Deck-owned Supermemory package lock is invalid." };
  }

  for (const [relativePath, expectedDigest] of Object.entries(expectedArtifactDigests) as [ArtifactPath, string][]) {
    const bytes = safeReadOwned(join(paths.packageDirectory, ...relativePath.split("/")));
    if (!bytes || sha256(bytes) !== expectedDigest) {
      return { ready: false, code: "artifact-digest-mismatch", diagnostic: `The Deck-owned Supermemory artifact failed verification: ${relativePath}.` };
    }
  }
  return { ready: true, code: "ready", diagnostic: "The pinned official Supermemory package is verified." };
}

export function inspectOwnedOpenCodeSupermemory(input: {
  environment?: Readonly<Record<string, string | undefined>>;
  homeDirectory?: string;
  expectedArtifactDigests?: ArtifactDigests;
} = {}): OpenCodeSupermemoryInspection {
  const paths = resolveOwnedOpenCodeSupermemoryPaths(input);
  const deckRoot = canonicalizeAllowMissing(resolveDefaultDeckDataRoot(input.environment ?? process.env, input.homeDirectory ?? homedir()));
  if (!isAbsolute(deckRoot) || !contained(deckRoot, paths.installRoot)) {
    return { ready: false, code: "unsafe-owned-path", diagnostic: "The Deck-owned Supermemory installation path is unsafe.", paths };
  }
  if (hasUnsafeOwnedSegment(deckRoot, paths)) {
    return { ready: false, code: "unsafe-owned-path", diagnostic: "The Deck-owned Supermemory installation contains an unsafe path segment.", paths };
  }
  const artifactInspection = inspectInstalledArtifacts(paths, input.expectedArtifactDigests ?? PUBLISHED_ARTIFACT_DIGESTS);
  if (!artifactInspection.ready) return { ...artifactInspection, paths };
  const loaderBytes = safeReadOwned(paths.loaderPath, 16 * 1024);
  if (!loaderBytes || loaderBytes.toString("utf8") !== buildOpenCodeSupermemoryLoaderContent()) {
    return { ready: false, code: "loader-mismatch", diagnostic: "The Deck-owned Supermemory compatibility loader is missing or changed.", paths };
  }
  return { ...artifactInspection, paths };
}

function stripJsonComments(value: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index]!;
    const next = value[index + 1];
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      output += current;
      continue;
    }
    if (current === "/" && next === "/") {
      while (index < value.length && value[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      while (index < value.length - 1 && !(value[index] === "*" && value[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    output += current;
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

function pluginRegistrations(path: string): { status: "absent" | "readable" | "unsafe"; registrations: string[] } {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { status: "absent", registrations: [] }
      : { status: "unsafe", registrations: [] };
  }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 1024 * 1024 || (stat.mode & 0o444) === 0) return { status: "unsafe", registrations: [] };
    const parsed = JSON.parse(stripJsonComments(readFileSync(descriptor, "utf8"))) as { plugin?: unknown };
    if (parsed.plugin !== undefined && (!Array.isArray(parsed.plugin) || parsed.plugin.some((value) => typeof value !== "string"))) {
      return { status: "unsafe", registrations: [] };
    }
    return { status: "readable", registrations: Array.isArray(parsed.plugin) ? parsed.plugin : [] };
  } catch {
    return { status: "unsafe", registrations: [] };
  } finally {
    closeSync(descriptor);
  }
}

function isSupermemoryRegistration(value: string): boolean {
  return value.toLowerCase().includes("supermemory");
}

export function inspectOpenCodeSupermemoryRegistrations(input: {
  projectRoot: string;
  workspaceRoot?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  homeDirectory?: string;
  loaderLocator: string;
}): Readonly<{ ok: boolean; conflicts: readonly OpenCodeSupermemoryRegistrationConflict[] }> {
  const environment = input.environment ?? process.env;
  const homeDirectory = input.homeDirectory ?? homedir();
  const candidates = enumerateOpenCodeConfigCandidates({
    projectRoot: resolve(input.projectRoot),
    workspaceRoot: resolve(input.workspaceRoot ?? input.projectRoot),
    homeDir: homeDirectory,
    xdgConfigHome: environment.XDG_CONFIG_HOME,
    env: environment,
  });
  const conflicts: OpenCodeSupermemoryRegistrationConflict[] = [];
  const directories = new Set<string>();
  for (const candidate of candidates) {
    directories.add(candidate.directory);
    const inspection = pluginRegistrations(candidate.path);
    if (inspection.status === "unsafe") conflicts.push({ source: candidate.path, registration: "<uninspectable-config>" });
    for (const registration of inspection.registrations) {
      if (isSupermemoryRegistration(registration) && registration !== input.loaderLocator) {
        conflicts.push({ source: candidate.path, registration });
      }
    }
  }
  for (const directory of directories) {
    for (const pluginDirectory of [join(directory, "plugin"), join(directory, "plugins")]) {
      if (!existsSync(pluginDirectory)) continue;
      if (!isSafeDirectory(pluginDirectory)) {
        conflicts.push({ source: pluginDirectory, registration: "<uninspectable-plugin-directory>" });
        continue;
      }
      let entries: string[];
      try {
        entries = readdirSync(pluginDirectory);
      } catch {
        conflicts.push({ source: pluginDirectory, registration: "<uninspectable-plugin-directory>" });
        continue;
      }
      for (const entry of entries) {
        if (isSupermemoryRegistration(entry)) {
          const registration = pathToFileURL(join(pluginDirectory, entry)).href;
          if (registration !== input.loaderLocator) conflicts.push({ source: pluginDirectory, registration });
        }
      }
    }
  }
  return Object.freeze({ ok: conflicts.length === 0, conflicts: Object.freeze(conflicts) });
}

function ensureOwnedInstallRoot(paths: OwnedOpenCodeSupermemoryPaths, environment: Readonly<Record<string, string | undefined>>, homeDirectory: string): boolean {
  const deckRoot = canonicalizeAllowMissing(resolveDefaultDeckDataRoot(environment, homeDirectory));
  const dataHome = dirname(deckRoot);
  if (!isAbsolute(dataHome) || !contained(deckRoot, paths.installRoot)) return false;
  mkdirSync(dataHome, { recursive: true, mode: 0o700 });
  if (!isSafeOwnedDirectory(dataHome) || hasUnsafeOwnedSegment(deckRoot, paths)) return false;
  const relation = relative(dataHome, paths.installRoot);
  if (!relation || relation.startsWith("..") || isAbsolute(relation)) return false;
  let cursor = dataHome;
  for (const segment of relation.split(/[/\\]+/)) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) mkdirSync(cursor, { mode: 0o700 });
    if (!isSafeOwnedDirectory(cursor)) return false;
  }
  return !hasUnsafeOwnedSegment(deckRoot, paths);
}

function writeLoader(paths: OwnedOpenCodeSupermemoryPaths): void {
  const temporaryPath = `${paths.loaderPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, buildOpenCodeSupermemoryLoaderContent(), { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporaryPath, paths.loaderPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export async function installOwnedOpenCodeSupermemory(input: {
  projectRoot: string;
  workspaceRoot?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  homeDirectory?: string;
  expectedArtifactDigests?: ArtifactDigests;
  runInstallCommand: RunOpenCodeSupermemoryInstallCommand;
}): Promise<Readonly<{
  ok: boolean;
  outcome: "reused" | "installed" | "blocked" | "failed";
  diagnostic: string;
  paths: OwnedOpenCodeSupermemoryPaths;
}>> {
  const environment = input.environment ?? process.env;
  const homeDirectory = input.homeDirectory ?? homedir();
  const paths = resolveOwnedOpenCodeSupermemoryPaths({ environment, homeDirectory });
  const registrations = inspectOpenCodeSupermemoryRegistrations({
    projectRoot: input.projectRoot,
    workspaceRoot: input.workspaceRoot,
    environment,
    homeDirectory,
    loaderLocator: paths.loaderLocator,
  });
  if (!registrations.ok) {
    return { ok: false, outcome: "blocked", diagnostic: "External Supermemory plugin registration conflicts with Deck's loader-only adapter.", paths };
  }

  const existing = inspectOwnedOpenCodeSupermemory({ environment, homeDirectory, expectedArtifactDigests: input.expectedArtifactDigests });
  if (existing.ready) return { ok: true, outcome: "reused", diagnostic: existing.diagnostic, paths };
  if (!ensureOwnedInstallRoot(paths, environment, homeDirectory)) {
    return { ok: false, outcome: "blocked", diagnostic: "The Deck-owned Supermemory installation root is unsafe.", paths };
  }

  const command = await input.runInstallCommand("npm", [
    "install",
    "--prefix",
    paths.installRoot,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--save-exact",
    OPENCODE_SUPERMEMORY_PACKAGE_SPEC,
  ]);
  if (command.exitCode !== 0) {
    return { ok: false, outcome: "failed", diagnostic: "The pinned official Supermemory package installation failed.", paths };
  }
  const artifacts = inspectInstalledArtifacts(paths, input.expectedArtifactDigests ?? PUBLISHED_ARTIFACT_DIGESTS);
  if (!artifacts.ready) return { ok: false, outcome: "failed", diagnostic: artifacts.diagnostic, paths };
  writeLoader(paths);
  const verified = inspectOwnedOpenCodeSupermemory({ environment, homeDirectory, expectedArtifactDigests: input.expectedArtifactDigests });
  return verified.ready
    ? { ok: true, outcome: "installed", diagnostic: verified.diagnostic, paths }
    : { ok: false, outcome: "failed", diagnostic: verified.diagnostic, paths };
}

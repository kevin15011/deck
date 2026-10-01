import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  OpaqueSkillInventoryResultV1,
  OpaqueSkillObservationV1,
  SkillDiscoveryDiagnosticV1,
  SkillDiscoverySourceBindingV1,
  SkillDiscoverySourceDeclarationV1,
  SkillDiscoverySourceProviderV1,
  SkillDiscoverySourceSetV1,
  SkillLocatorResolutionV1,
} from "@deck/core";
import {
  SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA,
  SKILL_DISCOVERY_SOURCE_SCHEMA,
  SKILL_DISCOVERY_V1_BOUNDS,
} from "@deck/core";

export type OpenCodeSkillInventoryDiscovery = (input: {
  readonly projectRoot: string;
}) => Promise<OpaqueSkillInventoryResultV1>;

type OpenCodeSkillDiscoveryFileSystem = {
  readonly stat: (path: string) => Promise<{
    isDirectory: () => boolean;
    isFile: () => boolean;
  }>;
  readonly access?: (path: string) => Promise<void>;
  readonly readdir?: (path: string) => Promise<readonly string[]>;
  readonly realpath: (path: string) => Promise<string>;
};

export type OpenCodeSkillDiscoveryProviderOptions = {
  readonly configDir?: string;
  readonly homeDir?: string;
  readonly skillInventoryDiscovery?: OpenCodeSkillInventoryDiscovery;
  readonly fileSystem?: OpenCodeSkillDiscoveryFileSystem;
};

const OPENCODE_CONFIG_SKILLS_SOURCE_ID = "opencode-config-skills" as const;
const OPENCODE_LEGACY_SKILLS_SOURCE_ID = "opencode-legacy-skills" as const;
const OPENCODE_RUNNER_INVENTORY_SOURCE_ID = "opencode-inventory" as const;
const OPENCODE_SKILL_LOCATOR_PREFIX = "runner:opencode:";

function defaultOpenCodeSkillDiscoveryFileSystem(): OpenCodeSkillDiscoveryFileSystem {
  return {
    stat: async (path) => fs.stat(path),
    access: async (path) => fs.access(path),
    readdir: async (path) => fs.readdir(path),
    realpath: (path) => fs.realpath(path),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

function isNotFoundError(error: unknown): boolean {
  return errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR";
}

function safeDiagnostic(
  code: string,
  sourceId?: string,
): SkillDiscoveryDiagnosticV1 {
  return {
    code,
    ...(sourceId ? { source_id: sourceId } : {}),
    message: "OpenCode skill discovery could not fully evaluate this source.",
  };
}

function boundDiagnostics(
  diagnostics: readonly SkillDiscoveryDiagnosticV1[],
  sourceId?: string,
): readonly SkillDiscoveryDiagnosticV1[] {
  if (diagnostics.length <= SKILL_DISCOVERY_V1_BOUNDS.maxDiagnostics) return [...diagnostics];
  return [
    ...diagnostics.slice(0, SKILL_DISCOVERY_V1_BOUNDS.maxDiagnostics - 1),
    safeDiagnostic("diagnostic_limit_reached", sourceId),
  ];
}

function isSafeOpaqueId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 256
    && /^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(value)
    && value !== "."
    && value !== "..";
}

function copySignals(
  value: unknown,
  maxCount: number,
): { valid: true; value?: readonly string[] } | { valid: false } {
  if (value === undefined) return { valid: true };
  if (!Array.isArray(value) || value.length > maxCount || value.some((item) => typeof item !== "string")) {
    return { valid: false };
  }
  return { valid: true, value: [...value] as string[] };
}

function normalizeOpaqueInventoryResult(
  value: unknown,
): OpaqueSkillInventoryResultV1 {
  const raw = isRecord(value) ? value : {};
  const rawObservations = Array.isArray(raw.observations) ? raw.observations : [];
  const diagnostics: SkillDiscoveryDiagnosticV1[] = [];
  let indeterminate = raw.outcome !== "complete" || !Array.isArray(raw.observations);
  if (!Array.isArray(raw.observations)) diagnostics.push(safeDiagnostic("malformed_inventory", OPENCODE_RUNNER_INVENTORY_SOURCE_ID));
  if (rawObservations.length > SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords) {
    indeterminate = true;
    diagnostics.push(safeDiagnostic("truncated_output", OPENCODE_RUNNER_INVENTORY_SOURCE_ID));
  }

  const observations: OpaqueSkillObservationV1[] = [];
  for (const item of rawObservations.slice(0, SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords)) {
    if (!isRecord(item) || !isSafeOpaqueId(item.opaqueId) || typeof item.name !== "string" || !item.name.trim()) {
      diagnostics.push(safeDiagnostic("unsafe_opaque_id", OPENCODE_RUNNER_INVENTORY_SOURCE_ID));
      continue;
    }

    const taskSignals = copySignals(item.taskSignals, SKILL_DISCOVERY_V1_BOUNDS.maxTaskSignals);
    const technologySignals = copySignals(item.technologySignals, SKILL_DISCOVERY_V1_BOUNDS.maxTechnologySignals);
    const pathSignals = copySignals(item.pathSignals, SKILL_DISCOVERY_V1_BOUNDS.maxPathSignals);
    if (!taskSignals.valid || !technologySignals.valid || !pathSignals.valid) {
      diagnostics.push(safeDiagnostic("invalid_signal_bound", OPENCODE_RUNNER_INVENTORY_SOURCE_ID));
      continue;
    }

    const observation: OpaqueSkillObservationV1 = {
      opaqueId: item.opaqueId,
      name: item.name,
      ...(typeof item.description === "string" ? { description: item.description } : {}),
      ...(taskSignals.value ? { taskSignals: taskSignals.value } : {}),
      ...(technologySignals.value ? { technologySignals: technologySignals.value } : {}),
      ...(pathSignals.value ? { pathSignals: pathSignals.value } : {}),
      ...(item.observedCategory === "runner_exposed" || item.observedCategory === "deck_materialized"
        ? { observedCategory: item.observedCategory }
        : {}),
    };
    observations.push(observation);
  }

  const rawDiagnosticCount = Array.isArray(raw.diagnostics) ? raw.diagnostics.length : 0;
  const rawDiagnostics = Array.from(
    { length: Math.min(rawDiagnosticCount, SKILL_DISCOVERY_V1_BOUNDS.maxDiagnostics + 1) },
    () => safeDiagnostic("source_warning", OPENCODE_RUNNER_INVENTORY_SOURCE_ID),
  );
  const allDiagnostics = boundDiagnostics(
    [...diagnostics, ...rawDiagnostics],
    OPENCODE_RUNNER_INVENTORY_SOURCE_ID,
  );
  if (indeterminate) {
    return {
      outcome: "indeterminate",
      observations,
      reasonCode: "partial_source_evaluation",
      diagnostics: allDiagnostics,
    };
  }
  return { outcome: "complete", observations, diagnostics: allDiagnostics };
}

function deriveOpenCodeHomeDirectory(configDir: string): string {
  const absoluteConfigDir = resolve(configDir);
  const configParent = dirname(absoluteConfigDir);
  return basename(absoluteConfigDir) === "opencode" && basename(configParent) === ".config"
    ? dirname(configParent)
    : dirname(absoluteConfigDir);
}

function createSourceDeclaration(
  sourceId: string,
  sourceCategory: SkillDiscoverySourceDeclarationV1["sourceCategory"],
  scope: SkillDiscoverySourceDeclarationV1["scope"],
  locatorStrategy: SkillDiscoverySourceDeclarationV1["locatorStrategy"],
  expectedContent: SkillDiscoverySourceDeclarationV1["expectedContent"],
): SkillDiscoverySourceDeclarationV1 {
  return {
    schema: SKILL_DISCOVERY_SOURCE_SCHEMA,
    sourceId,
    sourceCategory,
    scope,
    runnerId: "opencode",
    locatorStrategy,
    expectedContent,
    safeLocatorBase: sourceId,
  };
}

function createFilesystemBinding(
  declaration: SkillDiscoverySourceDeclarationV1,
  absoluteRoot: string,
): SkillDiscoverySourceBindingV1 {
  const binding = {
    kind: "filesystem" as const,
    declaration,
    absoluteRoot,
    descriptorBasename: "SKILL.md" as const,
  } satisfies SkillDiscoverySourceBindingV1;
  // Runtime-only roots must not become enumerable serialization data.
  Object.defineProperty(binding, "absoluteRoot", { enumerable: false, value: absoluteRoot });
  return binding;
}

function pathIsWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function decodeLocatorPart(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function isSafeRelativeSkillPath(value: string): boolean {
  if (!value || value.startsWith("/") || value.startsWith("~") || value.includes("\\") || value.includes("\0")) return false;
  if (/^[A-Za-z]:/.test(value) || value.startsWith("//")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

async function inspectOpenCodeSkillRoot(
  fileSystem: OpenCodeSkillDiscoveryFileSystem,
  root: string,
): Promise<"available" | "absent" | "indeterminate"> {
  try {
    const stats = await fileSystem.stat(root);
    if (!stats.isDirectory()) return "indeterminate";
  } catch (error) {
    return isNotFoundError(error) ? "absent" : "indeterminate";
  }
  try {
    if (fileSystem.access) await fileSystem.access(root);
    else if (fileSystem.readdir) await fileSystem.readdir(root);
    else return "indeterminate";
    return "available";
  } catch {
    return "indeterminate";
  }
}

/**
 * Read-only OpenCode source provider. Generic project roots belong to core;
 * this adapter contributes only OpenCode's configured and legacy user roots,
 * plus an explicitly injected opaque runner inventory when available.
 */
export function createOpenCodeSkillDiscoveryProvider(
  options: OpenCodeSkillDiscoveryProviderOptions = {},
): SkillDiscoverySourceProviderV1 {
  const configDir = resolve(options.configDir ?? join(homedir(), ".config", "opencode"));
  const homeDir = resolve(options.homeDir ?? deriveOpenCodeHomeDirectory(configDir));
  const fileSystem = options.fileSystem ?? defaultOpenCodeSkillDiscoveryFileSystem();
  const filesystemSources = () => [
    {
      sourceId: OPENCODE_CONFIG_SKILLS_SOURCE_ID,
      root: join(configDir, "skills"),
    },
    {
      sourceId: OPENCODE_LEGACY_SKILLS_SOURCE_ID,
      root: join(homeDir, ".opencode", "skills"),
    },
  ] as const;
  const declarations = new Map<string, SkillDiscoverySourceDeclarationV1>([
    [OPENCODE_CONFIG_SKILLS_SOURCE_ID, createSourceDeclaration(OPENCODE_CONFIG_SKILLS_SOURCE_ID, "user_runner", "user", "runner_relative", "skill_md")],
    [OPENCODE_LEGACY_SKILLS_SOURCE_ID, createSourceDeclaration(OPENCODE_LEGACY_SKILLS_SOURCE_ID, "user_runner", "user", "runner_relative", "skill_md")],
  ]);
  const inventoryDeclaration = createSourceDeclaration(OPENCODE_RUNNER_INVENTORY_SOURCE_ID, "runner_exposed", "runner", "runner_opaque", "opaque_inventory_v1");

  const readCurrentInventory = (projectRoot: string): Promise<OpaqueSkillInventoryResultV1> => Promise.resolve()
    .then(() => options.skillInventoryDiscovery!({ projectRoot }))
    .then((result) => normalizeOpaqueInventoryResult(result))
    .catch(() => ({
      outcome: "indeterminate" as const,
      observations: [],
      reasonCode: "partial_source_evaluation" as const,
      diagnostics: [safeDiagnostic("inventory_unavailable", OPENCODE_RUNNER_INVENTORY_SOURCE_ID)],
    }));

  return {
    schema: SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA,
    runnerId: "opencode",
    async listSources(input): Promise<SkillDiscoverySourceSetV1> {
      const diagnostics: SkillDiscoveryDiagnosticV1[] = [];
      let indeterminate = false;
      const sources: SkillDiscoverySourceBindingV1[] = [];

      for (const source of filesystemSources()) {
        const state = await inspectOpenCodeSkillRoot(fileSystem, source.root);
        if (state === "indeterminate") {
          indeterminate = true;
          diagnostics.push(safeDiagnostic("source_unreadable", source.sourceId));
        }
        sources.push(createFilesystemBinding(declarations.get(source.sourceId)!, source.root));
      }

      if (options.skillInventoryDiscovery) {
        const inventorySnapshot = readCurrentInventory(input.projectRoot);
        const inventory = await inventorySnapshot;
        if (inventory.outcome === "indeterminate") indeterminate = true;
        diagnostics.push(...inventory.diagnostics);
        sources.push({
          kind: "opaque_inventory",
          declaration: inventoryDeclaration,
          readInventory: () => inventorySnapshot,
        });
      }

      const bounded = boundDiagnostics(diagnostics);
      return indeterminate
        ? { outcome: "indeterminate", sources, reasonCode: "partial_source_evaluation", diagnostics: bounded }
        : { outcome: "complete", sources, diagnostics: bounded };
    },
    async resolveLocator(input): Promise<SkillLocatorResolutionV1> {
      if (typeof input.locator !== "string" || !input.locator.startsWith(OPENCODE_SKILL_LOCATOR_PREFIX)) {
        return { status: "rejected", diagnostic: safeDiagnostic("locator_rejected") };
      }
      const token = input.locator.slice(OPENCODE_SKILL_LOCATOR_PREFIX.length);
      const separator = token.indexOf("/");
      if (separator <= 0) return { status: "rejected", diagnostic: safeDiagnostic("locator_rejected") };
      const sourceId = token.slice(0, separator);
      const encodedValue = token.slice(separator + 1);

      if (sourceId === OPENCODE_RUNNER_INVENTORY_SOURCE_ID) {
        if (!options.skillInventoryDiscovery) return { status: "rejected", diagnostic: safeDiagnostic("source_unavailable", sourceId) };
        const opaqueId = decodeLocatorPart(encodedValue);
        if (!isSafeOpaqueId(opaqueId)) return { status: "rejected", diagnostic: safeDiagnostic("unsafe_opaque_id", sourceId) };
        const inventory = await readCurrentInventory(input.projectRoot);
        if (inventory.outcome !== "complete") {
          return { status: "rejected", diagnostic: safeDiagnostic("inventory_unavailable", sourceId) };
        }
        return inventory.observations.some((observation) => observation.opaqueId === opaqueId)
          ? { status: "available", loadReference: opaqueId }
          : { status: "missing" };
      }

      const source = filesystemSources().find((candidate) => candidate.sourceId === sourceId);
      if (!source || !declarations.has(sourceId)) return { status: "rejected", diagnostic: safeDiagnostic("unknown_source") };
      const decodedPath = decodeLocatorPart(encodedValue);
      if (!decodedPath || !isSafeRelativeSkillPath(decodedPath) || (decodedPath !== "SKILL.md" && !decodedPath.endsWith("/SKILL.md"))) {
        return { status: "rejected", diagnostic: safeDiagnostic("locator_rejected", sourceId) };
      }

      const rootPath = resolve(source.root);
      const candidatePath = resolve(rootPath, decodedPath);
      if (!pathIsWithin(rootPath, candidatePath)) return { status: "rejected", diagnostic: safeDiagnostic("traversal_rejected", sourceId) };

      let canonicalRoot: string;
      try {
        canonicalRoot = await fileSystem.realpath(rootPath);
      } catch (error) {
        return isNotFoundError(error)
          ? { status: "missing" }
          : { status: "rejected", diagnostic: safeDiagnostic("source_unreadable", sourceId) };
      }

      let canonicalCandidate: string;
      try {
        canonicalCandidate = await fileSystem.realpath(candidatePath);
      } catch (error) {
        return isNotFoundError(error)
          ? { status: "missing" }
          : { status: "rejected", diagnostic: safeDiagnostic("locator_unavailable", sourceId) };
      }
      if (!pathIsWithin(resolve(canonicalRoot), resolve(canonicalCandidate))) {
        return { status: "rejected", diagnostic: safeDiagnostic("traversal_rejected", sourceId) };
      }
      try {
        const stats = await fileSystem.stat(canonicalCandidate);
        return stats.isFile()
          ? { status: "available", loadReference: canonicalCandidate }
          : { status: "rejected", diagnostic: safeDiagnostic("descriptor_rejected", sourceId) };
      } catch (error) {
        return isNotFoundError(error)
          ? { status: "missing" }
          : { status: "rejected", diagnostic: safeDiagnostic("locator_unavailable", sourceId) };
      }
    },
  };
}

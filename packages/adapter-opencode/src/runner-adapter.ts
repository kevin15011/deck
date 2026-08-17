/**
 * OpenCode RunnerAdapter — TUI-facing facade for the OpenCode runner.
 *
 * Wraps all OpenCode-specific functions into the RunnerAdapter interface,
 * providing a drop-in replacement for hardcoded runner logic in app.tsx.
 *
 * Design: runner-decoupling-refactor / design.md § RunnerAdapter Contract
 */

import { homedir } from "node:os";
import { appendFileSync, writeFileSync, readFileSync, existsSync, mkdirSync, accessSync, constants as fsConstants, promises as fs } from "node:fs";
import { createHash } from "node:crypto";

const LOG = "/tmp/deck-tui.log";
function _ts() { return new Date().toISOString().slice(11, 23); }
function log(msg: string) { if (!process.env.DECK_DEBUG) return; try { appendFileSync(LOG, `${_ts()} [opencode-adapter] ${msg}\n`); } catch {} }
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { mergeConfig } from "./config-merge";
import { INTERNAL_OPENCODE_PACKAGE_IDS } from "./internal-opencode-packages";
import { DEVELOPER_TEAM_LEGACY_AGENT_IDS } from "@deck/core/teams/developer/catalog";

import type {
  RunnerAdapter,
  RunnerId,
  RunnerEnvironmentId,
  RuntimeDetectionInput,
  RuntimeStatus,
  CapabilityInventoryInput,
  CapabilityInventory,
  DashboardState,
  ReviewPlan,
  InstallationPlan,
  InstallationStep,
  RunnerAction,
  RunnerActionContext,
  RunnerActionRunResult,
  TeamEntry,
  ModelCatalog,
  ModelCatalogContext,
  DeveloperTeamModelAssignments,
  DeveloperTeamThinkingAssignments,
  RunnerThinkingLevel,
  DeveloperTeamAdapterInstallInput,
  RunnerDeveloperTeamInstallPlan,
  DeveloperTeamApplyInput,
  DeveloperTeamApplyResult,
  RunnerMcpConfigInput,
  RunnerMcpConfigResult,
  FlowState,
  NextScreen,
  RunnerDeckInstallInput,
  RunnerDeckInstallStatus,
  RunnerModelDiscoveryRequest,
  RunnerModelInventoryResult,
  RunnerModelAssignmentValidationInput,
  RunnerModelAssignmentValidationResult,
  OpaqueSkillInventoryResultV1,
  OpaqueSkillObservationV1,
  SkillDiscoveryDiagnosticV1,
  SkillDiscoverySourceBindingV1,
  SkillDiscoverySourceDeclarationV1,
  SkillDiscoverySourceProviderV1,
  SkillDiscoverySourceSetV1,
  SkillLocatorResolutionV1,
  SerenaBootstrapAuthorization,
  SerenaBootstrapEffects,
  SerenaMcpWriter,
  SerenaMcpWriteResult,
  SerenaMcpWriterInput,
  SerenaOperationIdentity,
  SerenaReadinessEvidence,
  SerenaReadinessRevalidator,
  NormalizedDeckConfig,
} from "@deck/core";

import {
  getModelCatalog,
  getRunnerCapabilityMapping,
  PACKAGE_INSTRUCTION_PACKAGE_IDS,
  buildCapabilityInstructionBundle,
  bindAdaptiveMemoryInstructionBundle,
  getEnabledCapabilityInstructionIds,
  getConfigurablePackageInstructionMetadata,
  resolveCanonicalSupermemoryProjectScope,
  SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA,
  SKILL_DISCOVERY_SOURCE_SCHEMA,
  SKILL_DISCOVERY_V1_BOUNDS,
  SERENA_MCP_ARGS,
  createDefaultSerenaBootstrapEffects,
  createSerenaReadinessRevalidator,
  resolveSerenaOwnedRoot,
  runEvidenceGatedSerenaWriter,
  validateSerenaOperationAuthorization,
  validateSerenaReadinessEvidence,
  hasWebSearchProviderCredential,
  isWebSearchProviderDescriptor,
} from "@deck/core";

function requireDeckConfig(config: NormalizedDeckConfig | undefined, context: string): NormalizedDeckConfig {
  if (!config) throw new Error(`OpenCode ${context} requires caller-resolved global Deck config.`);
  return config;
}
import { getStandaloneSkill, getStandaloneSkills } from "@deck/core/skills/external";
import type { WebSearchProviderDescriptorV1 } from "@deck/core";

// ---------------------------------------------------------------------------
// OpenCode-specific imports
// ---------------------------------------------------------------------------

import { inspectOpenCodeEnvironment } from "./preflight";
import type { OpenCodeToolsReview, OpenCodeEvidenceContext } from "./required-tools";
import { createOpenCodeEvidenceContext, reviewOpenCodeTools } from "./required-tools";
import {
  buildOpenCodeRunnerCapabilityInventory,
  type OpenCodeRunnerCapabilityInventory,
  type OpenCodeRunnerFullCapabilityInventory,
} from "./capability-inventory";
import {
  buildOpenCodeRunnerReviewPlan,
  type OpenCodeRunnerReviewPlan,
  type BuildOpenCodeRunnerReviewPlanState as OpenCodeReviewPlanState,
} from "./capability-plan";
import { buildOpenCodeInstallationPlan, OPENCODE_INSTALLABLE_TOOLS, type InstallableOpenCodeTool, getSelectableOpenCodeTools } from "./installation-plan";
import { getTeamsForEnvironment } from "./team-catalog";
import {
  readOpenCodeDeveloperTeamModelConfigAssignments,
} from "./model-config";
import {
  buildOpenCodeDeveloperTeamInstallPlan,
  applyOpenCodeDeveloperTeamInstall,
  backupDeveloperTeamFiles,
  rollbackDeveloperTeamFiles,
  verifyOpenCodeDeveloperTeamInstall,
  type OpenCodeDeveloperTeamInstallPlan,
  type OpenCodeDeveloperTeamApplyResult,
} from "./developer-team-install";
import {
  writeOpenCodeMcpConfig,
  writeSerenaOpenCodeMcpConfig,
  type OpenCodeMcpConfigFileSystem,
} from "./opencode-mcp-config";
import { getUserFacingOpenCodeCapability, OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION, OPENCODE_RUNNER_CAPABILITY_IDS } from "./capability-catalog";
import { inspectOpenCodeWebSearchMcpConfig, resolveOpenCodeWebSearchReadiness, writeOpenCodeWebSearchMcpConfig } from "./web-search";
import type { CapabilityCatalogEntry } from "@deck/core";
import { discoverModelInventory } from "./model-inventory";
import { LastKnownGoodStore, ModelInventoryCache, buildDiscoveryFingerprint, buildLastKnownGoodScopeKey } from "./model-inventory-cache";
import { nodeOpenCodeCommandRunner, OPENCODE_DISCOVERY_TIMEOUT_MS, type ModelDiscoveryFileSystem, type OpenCodeCommandRunner } from "./opencode-models-cli";
import { collectOpenCodeDiscoveryContext } from "./model-discovery-context";
import type { RunnerModelInventory, RunnerModelEntry } from "@deck/core";
import {
  installOpenCodeTools,
  type InstallOpenCodeToolsOptions,
  type OpenCodeToolInstallResultExact,
  type SerenaBootstrapRunner,
} from "./install-tools";

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

const OPENCODE_ENVIRONMENT_IDS = ["opencode-development"] as const;

/**
 * Options for constructing an OpenCode runner adapter.
 *
 * `inventoryDiscovery` is primarily a testing seam: production code leaves it
 * undefined so the adapter uses runner-resolved discovery. Tests inject a fixed inventory to assert
 * model-specific effort-level behavior without touching the filesystem.
 */
export type OpenCodeRunnerAdapterOptions = {
  /** Injected runner-only discovery for deterministic tests. */
  inventoryDiscovery?: (request: RunnerModelDiscoveryRequest) => Promise<RunnerModelInventoryResult>;
  /** Partial node-boundary replacement used only to hermetically prove default production composition. */
  productionDiscoveryDependencies?: Partial<OpenCodeProductionDiscoveryDependencies>;
  /** Isolated install root for adapter integration tests; production retains OpenCode's config directory. */
  developerTeamConfigDir?: string;
  /** Optional read-only OpenCode inventory seam for runner-exposed skills. */
  skillInventoryDiscovery?: OpenCodeSkillInventoryDiscovery;
  /** Optional home directory seam used to resolve the legacy OpenCode root. */
  skillDiscoveryHomeDir?: string;
  /** Deterministic OpenCode package evidence review seam; production uses the runner context. */
  toolsReview?: OpenCodeToolsReview | ((context: RunnerActionContext) => OpenCodeToolsReview);
  /** Deterministic package installer seam for adapter contract tests. */
  installTools?: typeof installOpenCodeTools;
  /** Optional evidence context provider shared by preflight and effect-time rechecks. */
  evidenceContext?: (context: RunnerActionContext) => OpenCodeEvidenceContext;
  /** Injected Core Serena bootstrap seam; production composition supplies the effects. */
  serenaBootstrap?: SerenaBootstrapRunner;
  serenaBootstrapEffects?: SerenaBootstrapEffects;
  /** Immediate same-path/fingerprint revalidation before the OpenCode writer. */
  serenaRevalidator?: SerenaReadinessRevalidator;
  /** Adapter-owned writer seam; tests must inject this instead of a home writer. */
  serenaMcpWriter?: SerenaMcpWriter;
  serenaMcpFileSystem?: OpenCodeMcpConfigFileSystem;
  serenaOwnedRoot?: string;
  serenaConfigPath?: string;
  serenaStage?: InstallOpenCodeToolsOptions["onStage"];
  /** Provider descriptor selected by the CLI composition root. */
  webSearchProvider?: WebSearchProviderDescriptorV1;
  /** Resolve the selected provider without putting provider metadata in Core. */
  webSearchProviderResolver?: (provider: string | undefined) => WebSearchProviderDescriptorV1 | undefined;
};

export type DiscoveryTimers = { setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>; clearTimeout(timer: ReturnType<typeof setTimeout>): void };
export type OpenCodeProductionDiscoveryDependencies = {
  commandRunner: OpenCodeCommandRunner;
  fs: ModelDiscoveryFileSystem;
  now: () => number;
  timers: DiscoveryTimers;
  env: Readonly<Record<string, string | undefined>>;
  homeDir: string;
  xdgConfigHome: string;
  xdgDataHome: string;
  xdgCacheHome: string;
  resolveExecutable: (command: string, env: Readonly<Record<string, string | undefined>>) => Promise<string>;
  resolveWorkspaceRoot: (projectRoot: string) => Promise<string>;
  resolvePluginEntry: (reference: string, fromDirectory: string) => Promise<string | null>;
};

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

function commandAvailable(command: string, environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const pathValue = environment.PATH ?? "";
  const separator = process.platform === "win32" ? ";" : ":";
  return pathValue.split(separator).some((directory) => {
    try {
      accessSync(join(directory || process.cwd(), command), fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
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
  const inventoryCache = new Map<string, Promise<OpaqueSkillInventoryResultV1>>();
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

  const readInventory = (projectRoot: string): Promise<OpaqueSkillInventoryResultV1> => {
    const cacheKey = resolve(projectRoot);
    const cached = inventoryCache.get(cacheKey);
    if (cached) return cached;
    const pending = readCurrentInventory(projectRoot);
    inventoryCache.set(cacheKey, pending);
    return pending;
  };

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
        const inventory = await readInventory(input.projectRoot);
        if (inventory.outcome === "indeterminate") indeterminate = true;
        diagnostics.push(...inventory.diagnostics);
        sources.push({
          kind: "opaque_inventory",
          declaration: inventoryDeclaration,
          readInventory: () => readInventory(input.projectRoot),
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

function nodeProductionDiscoveryDependencies(): OpenCodeProductionDiscoveryDependencies {
  const fileSystem: ModelDiscoveryFileSystem = {
    readFile: (path) => fs.readFile(path, "utf8"),
    stat: async (path) => { const value = await fs.stat(path); return { size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs, mode: value.mode, dev: value.dev, ino: value.ino, isFile: () => value.isFile(), isDirectory: () => value.isDirectory() }; },
    realpath: (path) => fs.realpath(path),
    readdir: (path) => fs.readdir(path),
    mkdir: async (path, mode) => { await fs.mkdir(path, { recursive: true, mode }); },
    writeFile: (path, body, mode) => fs.writeFile(path, body, { mode }),
    rename: (from, to) => fs.rename(from, to),
    chmod: (path, mode) => fs.chmod(path, mode),
    lstat: async (path) => { const value = await fs.lstat(path); return { mode: value.mode, isSymbolicLink: () => value.isSymbolicLink() }; },
    unlink: (path) => fs.unlink(path),
  };
  return {
    commandRunner: nodeOpenCodeCommandRunner, fs: fileSystem, now: Date.now,
    timers: { setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: (timer) => clearTimeout(timer) },
    env: process.env, homeDir: homedir(), xdgConfigHome: process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), xdgDataHome: process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), xdgCacheHome: process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
    resolveExecutable: async (_command, env) => {
      const found = (env.PATH?.split(":") ?? []).map((directory) => join(directory, "opencode")).find((candidate) => existsSync(candidate));
      if (!found) throw new Error("opencode not found");
      return fileSystem.realpath(found);
    },
    resolveWorkspaceRoot: async (projectRoot) => projectRoot,
    resolvePluginEntry: async (reference, fromDirectory) => reference.startsWith("file:") ? join(fromDirectory, reference.slice(5)) : reference.startsWith(".") ? join(fromDirectory, reference) : null,
  };
}

/** The only production composition point; tests inject every external boundary without changing behavior. */
export function createDefaultOpenCodeInventoryDiscovery(overrides: Partial<OpenCodeProductionDiscoveryDependencies> = {}): (request: RunnerModelDiscoveryRequest) => Promise<RunnerModelInventoryResult> {
  const dependencies = { ...nodeProductionDiscoveryDependencies(), ...overrides } as OpenCodeProductionDiscoveryDependencies;
  const cache = new ModelInventoryCache({ now: dependencies.now });
  const lkgByScope = new Map<string, LastKnownGoodStore>();
  return async (request) => {
    const startedAt = dependencies.now();
    const deadlineAt = startedAt + OPENCODE_DISCOVERY_TIMEOUT_MS;
    const controller = new AbortController();
    let candidate: { fingerprint: string; snapshot: { inventory: RunnerModelInventory; discoveredAt: number } } | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<RunnerModelInventoryResult>((resolve) => {
      deadlineTimer = dependencies.timers.setTimeout(() => {
        controller.abort();
        const error = { code: "timeout" as const, message: "OpenCode model discovery timed out. Try again.", retryable: true };
        resolve(candidate ? { state: "stale", inventory: candidate.snapshot.inventory, source: "last-known-good", discoveredAt: candidate.snapshot.discoveredAt, fingerprint: candidate.fingerprint, error } : { state: "blocked", inventory: null, source: "none", error });
      }, OPENCODE_DISCOVERY_TIMEOUT_MS);
    });
    const work = (async (): Promise<RunnerModelInventoryResult> => {
      const executable = await dependencies.resolveExecutable("opencode", dependencies.env);
      const versionResult = await dependencies.commandRunner.run({ file: executable, args: ["--version"], cwd: request.projectRoot, timeoutMs: Math.min(2_000, Math.max(0, deadlineAt - dependencies.now())), maxStdoutBytes: 4_096, maxStderrBytes: 4_096, signal: controller.signal });
      const version = versionResult.exitCode === 0 && !versionResult.terminationReason ? versionResult.stdout.trim().slice(0, 1_024) : null;
      const context = await collectOpenCodeDiscoveryContext({ projectRoot: request.projectRoot, executable, version, env: dependencies.env, homeDir: dependencies.homeDir, xdgConfigHome: dependencies.xdgConfigHome, xdgDataHome: dependencies.xdgDataHome, fs: dependencies.fs, resolveWorkspaceRoot: dependencies.resolveWorkspaceRoot, resolvePluginEntry: dependencies.resolvePluginEntry });
      const fingerprint = await buildDiscoveryFingerprint(context);
      const scopeKey = buildLastKnownGoodScopeKey({ runnerRealPath: context.runner.realPath, projectRoot: context.scope.projectRoot, workspaceRoot: context.scope.workspaceRoot });
      let lkg = lkgByScope.get(scopeKey);
      if (!lkg) { lkg = new LastKnownGoodStore({ fs: dependencies.fs, now: dependencies.now }, join(dependencies.xdgCacheHome, "deck", "opencode-model-inventory"), scopeKey); lkgByScope.set(scopeKey, lkg); }
      const snapshot = await lkg.read(fingerprint);
      if (snapshot) candidate = { fingerprint, snapshot };
      return discoverModelInventory({ projectRoot: request.projectRoot, mode: request.mode, cache, fingerprint, context, deadlineAt, signal: controller.signal, preloadedLastKnownGood: snapshot, readLastKnownGood: (key) => lkg!.read(key), writeLastKnownGood: (value) => lkg!.write(value.fingerprint, value.inventory, value.discoveredAt), dependencies: { commandRunner: dependencies.commandRunner, resolveExecutable: dependencies.resolveExecutable, env: dependencies.env, now: dependencies.now } });
    })();
    // Observe late work after the public race so it cannot become an unhandled rejection or a late commit.
    void work.catch(() => undefined);
    try { return await Promise.race([work, timeout]); }
    catch { return { state: "blocked", inventory: null, source: "none", error: { code: "command-failed", message: "OpenCode model discovery failed. Run opencode models --verbose to check the runner.", retryable: true } }; }
    finally { if (deadlineTimer) dependencies.timers.clearTimeout(deadlineTimer); }
  };
}

export function createOpenCodeRunnerAdapter(options?: OpenCodeRunnerAdapterOptions): RunnerAdapter {
  // Group 0 defines the core async port. Group 2 owns implementing it against
  // OpenCode discovery; retain this legacy facade until that adapter work lands.
  return new OpenCodeRunnerAdapterImpl(options) as unknown as RunnerAdapter;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class OpenCodeRunnerAdapterImpl {
  readonly runnerId: RunnerId = "opencode";
  readonly displayName: string = "OpenCode";
  readonly environmentIds: readonly RunnerEnvironmentId[] = [...OPENCODE_ENVIRONMENT_IDS];
  readonly packageInstructionIds = PACKAGE_INSTRUCTION_PACKAGE_IDS;
  readonly ui = {
    environmentLabels: { "opencode-development": "OpenCode Development" },
    dashboard: { defaultSelectedTeamIds: ["developer-team"] },
    model: {
      providerSource: "Providers and models come from the active OpenCode runner.",
      missingChecks: ["~/.config/opencode/opencode.json agent model entries", "opencode models"],
      remediation: "Run `opencode models` to confirm OpenCode can see your providers.",
      defaultThinkingLevels: ["off", "low", "medium", "high"],
    },
    adaptiveMemory: {
      supermemory: {
        requiresExternalToken: false,
        selectionStatus: "Supermemory selected; OpenCode will request OAuth once through /connect.",
        configuredDiagnostics: ["OpenCode will authenticate Supermemory through native OAuth on first connection."],
      },
    },
  } as const;
  readonly skillDiscovery: SkillDiscoverySourceProviderV1;

  #inventoryDiscovery: (request: RunnerModelDiscoveryRequest) => Promise<RunnerModelInventoryResult>;
  #latestReady: Extract<RunnerModelInventoryResult, { state: "ready" }> | null = null;
  #planBindings = new WeakMap<RunnerDeveloperTeamInstallPlan, { nativePlan: OpenCodeDeveloperTeamInstallPlan; validation: { changedAgentIds: readonly string[]; fingerprint?: string; modelAssignments: DeveloperTeamModelAssignments; thinkingAssignments: DeveloperTeamThinkingAssignments } }>();
  #developerTeamConfigDir?: string;
  #toolsReview?: OpenCodeRunnerAdapterOptions["toolsReview"];
  #installTools: typeof installOpenCodeTools;
  #evidenceContext?: OpenCodeRunnerAdapterOptions["evidenceContext"];
  #serenaBootstrap?: SerenaBootstrapRunner;
  #serenaBootstrapEffects: SerenaBootstrapEffects;
  #serenaRevalidator?: SerenaReadinessRevalidator;
  #serenaMcpWriter?: SerenaMcpWriter;
  #serenaMcpFileSystem?: OpenCodeMcpConfigFileSystem;
  #serenaOwnedRoot?: string;
  #serenaOwnedRootIsExplicit: boolean;
  #serenaConfigPath?: string;
  #serenaStage?: InstallOpenCodeToolsOptions["onStage"];
  #webSearchProvider?: WebSearchProviderDescriptorV1;
  #webSearchProviderResolver?: OpenCodeRunnerAdapterOptions["webSearchProviderResolver"];
  #serenaEvidenceByOperation = new Map<string, { authorization: SerenaBootstrapAuthorization; operation: SerenaOperationIdentity; evidence: SerenaReadinessEvidence }>();

  constructor(options?: OpenCodeRunnerAdapterOptions) {
    this.#developerTeamConfigDir = options?.developerTeamConfigDir;
    this.#toolsReview = options?.toolsReview;
    this.#installTools = options?.installTools ?? installOpenCodeTools;
    this.#evidenceContext = options?.evidenceContext;
    this.#serenaBootstrap = options?.serenaBootstrap;
    this.#serenaBootstrapEffects = options?.serenaBootstrapEffects ?? createDefaultSerenaBootstrapEffects();
    this.#serenaRevalidator = options?.serenaRevalidator;
    this.#serenaMcpWriter = options?.serenaMcpWriter;
    this.#serenaMcpFileSystem = options?.serenaMcpFileSystem;
    this.#serenaOwnedRoot = options?.serenaOwnedRoot;
    this.#serenaOwnedRootIsExplicit = options !== undefined && Object.prototype.hasOwnProperty.call(options, "serenaOwnedRoot");
    this.#serenaConfigPath = options?.serenaConfigPath;
    this.#serenaStage = options?.serenaStage;
    this.#webSearchProvider = options?.webSearchProvider;
    this.#webSearchProviderResolver = options?.webSearchProviderResolver;
    this.#inventoryDiscovery = options?.inventoryDiscovery ?? createDefaultOpenCodeInventoryDiscovery(options?.productionDiscoveryDependencies);
    const configDir = this.#developerTeamConfigDir ?? join(homedir(), ".config", "opencode");
    this.skillDiscovery = createOpenCodeSkillDiscoveryProvider({
      configDir,
      homeDir: options?.skillDiscoveryHomeDir,
      skillInventoryDiscovery: options?.skillInventoryDiscovery,
    });
  }

  private getEvidenceContext(context: RunnerActionContext): OpenCodeEvidenceContext {
    return this.#evidenceContext?.(context) ?? createOpenCodeEvidenceContext({
      projectRoot: context.projectRoot,
      workspaceRoot: context.projectRoot,
      currentDirectory: context.projectRoot,
    });
  }

  private getToolsReview(context: RunnerActionContext): OpenCodeToolsReview {
    if (typeof this.#toolsReview === "function") return this.#toolsReview(context);
    if (this.#toolsReview) return this.#toolsReview;
    return reviewOpenCodeTools({
      projectRoot: context.projectRoot,
      workspaceRoot: context.projectRoot,
      evidenceContext: this.getEvidenceContext(context),
    });
  }

  private resolveWebSearchProvider(provider: string | undefined): WebSearchProviderDescriptorV1 | undefined {
    const selected = provider?.trim();
    if (!selected) return undefined;
    if (this.#webSearchProvider?.providerId === selected) return this.#webSearchProvider;
    return this.#webSearchProviderResolver?.(selected);
  }

  // -------------------------------------------------------------------------
  // Runtime detection
  // -------------------------------------------------------------------------

  async detectRuntimes(input?: RuntimeDetectionInput): Promise<readonly RuntimeStatus[]> {
    const result = inspectOpenCodeEnvironment({
      command: "opencode",
      pathExists: (path) => {
        try {
          const { existsSync } = require("node:fs");
          return existsSync(path);
        } catch {
          return false;
        }
      },
    });

    return [
      {
        runtimeId: "opencode",
        displayName: "OpenCode",
        isAvailable: result.existingConfiguration,
        version: result.version !== "unknown" ? result.version : undefined,
        diagnostics: result.existingConfiguration
          ? result.configDirectory ? [`Config directory: ${result.configDirectory}`] : []
          : ["OpenCode configuration not found."],
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Capability inventory
  // -------------------------------------------------------------------------

  async getCapabilityInventory(input: CapabilityInventoryInput): Promise<CapabilityInventory> {
    const actionContext: RunnerActionContext = {
      projectRoot: input.projectRoot,
      runnerId: this.runnerId,
      environmentId: input.environmentId,
    };
    const toolsReview = this.getToolsReview(actionContext);
    const runnerScope = "opencode";
    const deckConfig = requireDeckConfig(input.deckConfig, "capability inventory");
    const webSearchProvider = this.resolveWebSearchProvider(deckConfig.webSearch.provider);
    const webSearchConfigPath = join(this.#developerTeamConfigDir ?? join(homedir(), ".config", "opencode"), "opencode.json");
    const webSearchMcp = inspectOpenCodeWebSearchMcpConfig(webSearchConfigPath, webSearchProvider);
    const webSearchExecutableAvailable = webSearchProvider ? commandAvailable(webSearchProvider.command[0]!) : false;
    const webSearchReadiness = resolveOpenCodeWebSearchReadiness({
      enabled: deckConfig.webSearch.enabled,
      provider: webSearchProvider,
      credentialEnvironment: process.env,
      executableAvailable: webSearchExecutableAvailable,
      mcpConfigured: webSearchMcp.configured,
      mcpConfigConflict: webSearchMcp.conflict,
    });

    const inventory = buildOpenCodeRunnerCapabilityInventory(toolsReview, {
      runnerScope,
      includeInternal: true,
      webSearch: {
        readiness: webSearchReadiness.readiness,
        evidence: {
          enabled: deckConfig.webSearch.enabled,
          runnerSupported: true,
          providerConfigured: isWebSearchProviderDescriptor(webSearchProvider),
          credentialAvailable: hasWebSearchProviderCredential(webSearchProvider, process.env),
          executableAvailable: webSearchExecutableAvailable,
          mcpConfigured: webSearchMcp.configured,
          mcpConfigConflict: webSearchMcp.conflict,
        },
        provider: webSearchProvider,
      },
    });

    // Map OpenCode-specific inventory to generic CapabilityInventory
    const capabilities: CapabilityCatalogEntry[] = [];

    // User-facing capabilities
    for (const [capabilityId, entry] of Object.entries(inventory)) {
      if (!entry || typeof entry !== "object") continue;
      if ("capabilityId" in entry && typeof entry.capabilityId === "string") {
        // Skip internal entries
        if (capabilityId === "_internal") continue;
        const cap = entry as { capabilityId: string; runnerScope: string; installed: boolean; status: string; diagnostics?: readonly string[]; webSearchReadiness?: import("@deck/core").WebSearchReadinessResult; webSearchEvidence?: import("@deck/core").WebSearchReadinessEvidence; webSearchProvider?: WebSearchProviderDescriptorV1 };
        const capability = require("./capability-catalog").getUserFacingOpenCodeCapability(capabilityId as any);
        if (!capability) continue;

        capabilities.push({
          capabilityId: cap.capabilityId,
          label: capability.label,
          description: capability.description,
          section: "runner-capabilities",
          requirementLevel: capability.requirementLevel,
          toolId: capability.toolId,
          source: capability.source,
          // Runner-local install mechanics never cross the Core/dashboard port.
          installKind: capability.installKind === "opencode-plugin"
            ? "opencode-plugin"
            : capability.installKind === "external"
              ? "external"
              : "runner-native",
          supportStatus: getRunnerCapabilityMapping(cap.capabilityId, this.runnerId, [OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION])?.status,
          isInstalled: cap.installed,
           isBlocked: cap.capabilityId === "web-search"
             ? cap.webSearchReadiness?.code === "mcp-config-conflict"
             : cap.status === "blocked",
          diagnostics: cap.diagnostics,
           webSearchReadiness: cap.webSearchReadiness,
           webSearchEvidence: cap.webSearchEvidence,
           webSearchProvider: cap.webSearchProvider,
        });
      }
    }

    // Internal capabilities
    const internal = inventory["_internal"] as OpenCodeRunnerFullCapabilityInventory["_internal"] | undefined;
    if (internal) {
      for (const [capabilityId, entry] of Object.entries(internal) as [string, NonNullable<OpenCodeRunnerFullCapabilityInventory["_internal"]>[keyof NonNullable<OpenCodeRunnerFullCapabilityInventory["_internal"]>]][]) {
        if (!entry || typeof entry !== "object") continue;
        capabilities.push({
          capabilityId: entry.capabilityId as string,
          label: entry.capabilityId === "opencode-mermaid" ? "Mermaid" : entry.capabilityId,
          description: "OpenCode visual documentation capability.",
          section: "runner-capabilities",
          requirementLevel: "required",
          source: entry.source,
          installKind: "opencode-plugin" as const,
          supportStatus: getRunnerCapabilityMapping(entry.capabilityId as string, this.runnerId, [OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION])?.status,
          isInstalled: entry.installed,
          isBlocked: (entry.status as string) === "blocked",
          diagnostics: entry.diagnostics,
        });
      }
    }

    return {
      capabilities,
      runnerId: this.runnerId,
      environmentId: input.environmentId,
    };
  }

  // -------------------------------------------------------------------------
  // Review and installation planning
  // -------------------------------------------------------------------------

  buildReviewPlan(state: DashboardState & { teams?: Record<string, unknown>; packageInstructions?: Record<string, unknown>; runtime?: { toolsReview?: unknown } }, inventory: CapabilityInventory): ReviewPlan {
    log(`buildReviewPlan: START. inventoryType=${typeof inventory} hasCapabilities=${!!inventory?.capabilities}`);
    try {
    // Normalize inventory: accept both CapabilityInventory (with .capabilities) 
    // and plain Record<capabilityId, entry> (as stored by the dashboard)
    const capabilities = inventory.capabilities 
      ?? Object.values(inventory as Record<string, { capabilityId?: string; isInstalled?: boolean; isBlocked?: boolean; toolId?: string; source?: string; diagnostics?: readonly string[]; webSearchProvider?: WebSearchProviderDescriptorV1 }>);
    log(`buildReviewPlan: capabilities count=${Array.isArray(capabilities) ? capabilities.length : "not-array"}`);
    
    // Map CapabilityInventory back to OpenCode's native inventory format
    const nativeInventory: OpenCodeRunnerCapabilityInventory = {};
    for (const entry of capabilities) {
      if (!entry.capabilityId) continue;
      (nativeInventory as Record<string, unknown>)[entry.capabilityId] = {
        capabilityId: entry.capabilityId,
        runnerScope: "opencode",
        installed: entry.isInstalled,
        status: entry.webSearchReadiness?.state ?? (entry.isInstalled ? "ready" : entry.isBlocked ? "blocked" : "missing"),
        toolId: entry.toolId,
        source: entry.source,
        diagnostics: entry.diagnostics ?? [],
        webSearchReadiness: entry.webSearchReadiness,
        webSearchEvidence: entry.webSearchEvidence,
        webSearchProvider: entry.webSearchProvider,
      };
    }
    log(`buildReviewPlan: nativeInventory entries=${Object.keys(nativeInventory).length}`);

    // Build state for OpenCode review plan builder
    const toolsReview = reviewOpenCodeTools();
    log(`buildReviewPlan: toolsReview done`);

    const openCodeState: OpenCodeReviewPlanState = {
      runnerScope: state.runnerId,
      operationId: state.operationId,
      explicitlySelectedCapabilities: state.explicitlySelectedCapabilities,
      currentOperation: state.operationId
        ? {
            runner: "opencode",
            operationId: state.operationId,
            explicitlySelected: state.explicitlySelectedCapabilities?.serena === true,
          }
        : undefined,
      selectedCapabilities: state.selectedCapabilities,
      webSearchProvider: capabilities.find((entry) => entry.capabilityId === "web-search")?.webSearchProvider
        ?? state.webSearchProviderDescriptor,
      adaptiveMemory: state.adaptiveMemory.provider !== "none" ? {
        provider: state.adaptiveMemory.provider,
        supermemory: state.adaptiveMemory.supermemory ? {
          configured: state.adaptiveMemory.supermemory.configured,
          hasToken: state.adaptiveMemory.supermemory.hasToken,
          runtimeCredentialStored: state.adaptiveMemory.supermemory.runtimeCredentialStored,
          ephemeralTokenAvailable: state.adaptiveMemory.supermemory.ephemeralTokenAvailable,
          mcpOAuthReady: state.adaptiveMemory.supermemory.mcpOAuthReady,
        } : undefined,
      } : undefined,
      teams: state.teams as Record<string, { selected?: boolean; modelAssignments?: unknown; thinkingAssignments?: unknown }> | undefined,
      packageInstructions: {
        [state.runnerId]: buildCapabilityInstructionBundle(
          getConfigurablePackageInstructionMetadata(this.packageInstructionIds)
            .filter((entry) => state.packageInstructions[entry.id] === true)
            .map((entry) => entry.id),
        ),
      },
      runtime: { toolsReview },
    };
    log(`buildReviewPlan: calling buildOpenCodeRunnerReviewPlan`);

    const nativePlan = buildOpenCodeRunnerReviewPlan(openCodeState, nativeInventory);
    log(`buildReviewPlan: nativePlan done. groups=${JSON.stringify(Object.keys(nativePlan.groups))}`);

    // Map native plan to generic ReviewPlan
    log(`buildReviewPlan: mapping native plan to generic ReviewPlan`);
    const result: ReviewPlan = {
      groups: {
        automaticInstalls: nativePlan.groups.automaticInstalls.map(this.mapOpenCodeAction),
        manualSteps: nativePlan.groups.manualSteps.map(this.mapOpenCodeAction),
        configWrites: nativePlan.groups.configWrites.map(this.mapOpenCodeAction),
        teamApplications: nativePlan.groups.teamApplications.map(this.mapOpenCodeAction),
        validations: nativePlan.groups.validations.map(this.mapOpenCodeAction),
      },
      diagnostics: nativePlan.diagnostics.map((d) => ({
        code: d.code,
        message: d.message,
        severity: d.severity as ReviewPlan["diagnostics"][0]["severity"],
        capabilityId: d.capabilityId,
        actionId: d.actionId,
      })),
      ready: nativePlan.ready,
    };
    log(`buildReviewPlan: SUCCESS. ready=${result.ready} diagnostics=${result.diagnostics.length}`);
    return result;
    } catch (error) {
      const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
      log(`buildReviewPlan: FAILED: ${msg}`);
      throw error;
    }
  }

  private mapOpenCodeAction(action: { id: string; kind: string; title: string; description?: string; capabilityId?: string; toolId?: string; source?: string; status: string; required?: boolean; dependencies?: string[]; unresolvedCapabilities?: string[]; diagnostics?: string[] }): RunnerAction {
    return {
      id: action.id,
      kind: action.kind,
      title: action.title,
      description: action.description,
      capabilityId: action.capabilityId,
      toolId: action.toolId,
      source: action.source,
      status: action.status as RunnerAction["status"],
      required: action.required,
      dependencies: action.dependencies,
      unresolvedCapabilities: action.unresolvedCapabilities,
      diagnostics: action.diagnostics,
    };
  }

  buildInstallationPlan(state: DashboardState): InstallationPlan {
    const toolsReview = typeof this.#toolsReview === "function"
      ? this.#toolsReview({ projectRoot: process.cwd(), runnerId: this.runnerId, environmentId: state.environmentId })
      : this.#toolsReview ?? reviewOpenCodeTools();

    // Package-instruction toggles control prompt composition only. Tool installation
    // remains driven by the adapter's install catalog and explicit tool selection.
    const selectedToolIds = OPENCODE_INSTALLABLE_TOOLS
      .filter((tool) => tool.id !== "serena")
      .map((tool) => tool.id);
    if (hasExplicitSerenaDashboardSelection(state)) selectedToolIds.push("serena");

    const plan = buildOpenCodeInstallationPlan({ tools: toolsReview.tools, selectedToolIds });
    return {
      steps: [
        ...plan.map((tool) => ({
          action: "install" as const,
          tool: tool.module,
          reason: `${tool.name} is selected for installation`,
          capabilityId: tool.id,
        })),
        ...(state.selectedCapabilities["web-search"] ? [{
          action: "configure" as const,
          tool: "web-search",
          reason: "Configure the reviewed native Web Search MCP server",
          capabilityId: "web-search",
        }] : []),
      ],
    };
  }

  // -------------------------------------------------------------------------
  // Action execution
  // -------------------------------------------------------------------------

  async runAction(action: RunnerAction, context: RunnerActionContext): Promise<RunnerActionRunResult> {
    switch (action.kind) {
      case "install-opencode-plugin": {
        if (isSerenaAction(action)) {
          return this.runSerenaInstallAction(action, context);
        }

        const toolId = action.toolId ?? action.capabilityId;
        const toolsReview = this.getToolsReview(context);
        const plan = buildOpenCodeInstallationPlan({
          tools: toolsReview.tools,
          selectedToolIds: toolId ? [toolId] : [],
        });
        const evidence = toolId ? toolsReview.evidence?.[toolId as keyof NonNullable<OpenCodeToolsReview["evidence"]>] : undefined;

        if (plan.length === 0) {
          if (evidence?.state === "usable") {
            return projectOpenCodeInstallResult(action, {
              toolId: (toolId ?? "") as InstallableOpenCodeTool["id"],
              tool: action.title,
              outcome: "already-present",
              success: true,
              installerInvoked: false,
              message: `${action.title} already present; installer not run.`,
            });
          }
          return {
            actionId: action.id,
            status: "skipped",
            message: `Tool ${toolId ?? action.capabilityId} is not available for installation.`,
            diagnostics: [],
          };
        }

        try {
          const results = await this.#installTools(
            "opencode",
            plan,
            () => {},
            undefined,
            {
              projectRoot: context.projectRoot,
              evidenceContext: this.getEvidenceContext(context),
            },
          );
          const firstResult = results[0];
          if (!firstResult) {
            return {
              actionId: action.id,
              status: "failed",
              message: `${action.title} returned no package result.`,
              diagnostics: ["No package result returned."],
            };
          }
          return projectOpenCodeInstallResult(action, firstResult);
        } catch (error) {
          return {
            actionId: action.id,
            status: "failed",
            message: `Installation failed: ${error instanceof Error ? error.message : String(error)}`,
            diagnostics: ["Installation failed."],
          };
        }
      }

      case "write-mcp-config": {
        const capabilityId = action.capabilityId ?? action.toolId;
        if (!capabilityId) {
          return {
            actionId: action.id,
            status: "failed",
            message: "No capabilityId or toolId specified for MCP config write.",
            diagnostics: ["Missing capabilityId/toolId"],
          };
        }

        if (capabilityId === "serena") {
          if (action.toolId !== undefined && action.toolId !== "serena") {
            return failedSerenaAction(action.id, "Serena configuration action identity is invalid.");
          }
          return this.runSerenaMcpConfigAction(action, context);
        }

        const result = await this.writeMcpConfigFromCapability(capabilityId, action.source, context.webSearchProvider);
        return {
          actionId: action.id,
          status: result.ok ? "executed" : "failed",
          message: result.ok ? `MCP config written for ${capabilityId}.` : `Failed to write MCP config: ${result.diagnostics.join(", ")}`,
          diagnostics: result.diagnostics,
        };
      }

      case "write-deck-config": {
        // Deck config writes are informational — the actual write happens elsewhere
        return {
          actionId: action.id,
          status: "informational",
          message: "Deck config write is handled by the TUI layer.",
          diagnostics: [],
        };
      }

      case "validate": {
        return {
          actionId: action.id,
          status: "informational",
          message: action.title,
          diagnostics: action.diagnostics ?? [],
        };
      }

      case "apply-team-bundle": {
        // Team application is handled by buildDeveloperTeamInstallPlan / applyDeveloperTeamInstall
        return {
          actionId: action.id,
          status: "informational",
          message: "Developer team bundle will be applied during installation phase.",
          diagnostics: action.unresolvedCapabilities?.length ? [`Pending capabilities: ${action.unresolvedCapabilities.join(", ")}`] : [],
        };
      }

      default: {
        return {
          actionId: action.id,
          status: "informational",
          message: `Action ${action.kind} is informational or not yet implemented.`,
          diagnostics: [],
        };
      }
    }
  }

  private getSerenaOperationContext(context: RunnerActionContext):
    | { valid: true; authorization: SerenaBootstrapAuthorization; operation: SerenaOperationIdentity }
    | { valid: false; message: string } {
    if (context.runnerId !== "opencode") {
      return { valid: false, message: "Serena is not authorized for this runner operation." };
    }
    const operation = context.currentOperation ?? context.operation;
    if (!operation) {
      return { valid: false, message: "Serena requires a current install operation." };
    }
    const authorization = validateSerenaOperationAuthorization(context.serenaAuthorization, operation);
    if (!authorization.valid || authorization.authorization.runner !== "opencode") {
      return { valid: false, message: "Serena requires explicit selection in the current OpenCode install operation." };
    }
    return { valid: true, authorization: authorization.authorization, operation };
  }

  private serenaOperationKey(operation: SerenaOperationIdentity): string {
    return `${operation.runner}\u0000${operation.operationId}`;
  }

  private async ensureSerenaRuntime(signal?: AbortSignal): Promise<boolean> {
    if (!isSafeSerenaRoot(this.#serenaOwnedRoot)) {
      if (this.#serenaOwnedRootIsExplicit) return false;
      const resolvedRoot = await resolveSerenaOwnedRoot(
        this.#serenaBootstrapEffects,
        signal ?? new AbortController().signal,
      );
      if (!isSafeSerenaRoot(resolvedRoot)) return false;
      this.#serenaOwnedRoot = resolvedRoot;
    }
    this.#serenaRevalidator ??= createSerenaReadinessRevalidator(
      this.#serenaOwnedRoot,
      this.#serenaBootstrapEffects,
    );
    return true;
  }

  private async runSerenaInstallAction(action: RunnerAction, context: RunnerActionContext): Promise<RunnerActionRunResult> {
    const operationContext = this.getSerenaOperationContext(context);
    if (!operationContext.valid) return failedSerenaAction(action.id, operationContext.message);
    if (context.signal?.aborted) return cancelledSerenaAction(action.id);
    if (!await this.ensureSerenaRuntime(context.signal)) return failedSerenaAction(action.id, "Serena Deck-owned root is unavailable; setup was not started.");

    const tool = OPENCODE_INSTALLABLE_TOOLS.find((candidate) => candidate.id === "serena");
    if (!tool) return failedSerenaAction(action.id, "Serena installation metadata is unavailable.");

    let results: OpenCodeToolInstallResultExact[];
    try {
      results = await this.#installTools(
        "opencode",
        [tool],
        () => {},
        undefined,
        {
          projectRoot: context.projectRoot,
          signal: context.signal,
          evidenceContext: this.getEvidenceContext(context),
          serenaAuthorization: operationContext.authorization,
          serenaOperation: operationContext.operation,
          currentOperation: operationContext.operation,
          serenaBootstrap: this.#serenaBootstrap,
          serenaEffects: this.#serenaBootstrapEffects,
          onStage: this.#serenaStage,
        },
      );
    } catch {
      this.#serenaEvidenceByOperation.delete(this.serenaOperationKey(operationContext.operation));
      return failedSerenaAction(action.id, "Serena setup failed before readiness could be established.");
    }

    const result = results[0];
    if (!result) {
      this.#serenaEvidenceByOperation.delete(this.serenaOperationKey(operationContext.operation));
      return failedSerenaAction(action.id, "Serena setup returned no result.");
    }

    if (
      (result.outcome === "already-present" || result.outcome === "executed")
      && result.success
      && ((result.outcome === "already-present" && result.serenaBootstrapOutcome === "reused")
        || (result.outcome === "executed" && result.serenaBootstrapOutcome === "installed"))
      && result.serenaReadiness
    ) {
      const evidence = validateSerenaReadinessEvidence(result.serenaReadiness, this.#serenaOwnedRoot);
      if (evidence.valid) {
        this.#serenaEvidenceByOperation.set(this.serenaOperationKey(operationContext.operation), {
          authorization: operationContext.authorization,
          operation: operationContext.operation,
          evidence: evidence.evidence,
        });
      } else {
        this.#serenaEvidenceByOperation.delete(this.serenaOperationKey(operationContext.operation));
        return failedSerenaAction(action.id, "Serena setup returned invalid readiness evidence.");
      }
    } else {
      this.#serenaEvidenceByOperation.delete(this.serenaOperationKey(operationContext.operation));
    }

    return projectOpenCodeInstallResult(action, result);
  }

  private async runSerenaMcpConfigAction(action: RunnerAction, context: RunnerActionContext): Promise<RunnerActionRunResult> {
    const operationContext = this.getSerenaOperationContext(context);
    if (!operationContext.valid) return failedSerenaAction(action.id, operationContext.message);
    if (context.signal?.aborted) return cancelledSerenaAction(action.id);
    if (!await this.ensureSerenaRuntime(context.signal)) return failedSerenaAction(action.id, "Serena Deck-owned root is unavailable; configuration was not changed.");

    const retained = this.#serenaEvidenceByOperation.get(this.serenaOperationKey(operationContext.operation));
    const contextualEvidence = context.serenaReadiness
      ? validateSerenaReadinessEvidence(context.serenaReadiness, this.#serenaOwnedRoot)
      : undefined;
    const contextualHandoff = contextualEvidence && contextualEvidence.valid
      ? {
          authorization: operationContext.authorization,
          operation: operationContext.operation,
          evidence: contextualEvidence.evidence,
        }
      : undefined;
    const handoff = retained ?? contextualHandoff;
    if (!handoff) return failedSerenaAction(action.id, "Serena readiness evidence is unavailable; configuration was not changed.");
    if (!this.#serenaRevalidator) return failedSerenaAction(action.id, "Serena readiness could not be revalidated; configuration was not changed.");

    const revalidate: SerenaReadinessRevalidator = async (evidence) => {
      if (context.signal?.aborted) {
        return {
          valid: false as const,
          code: "stale-readiness-evidence" as const,
          diagnostic: { code: "cancelled", message: "Serena configuration was cancelled." },
        };
      }
      const refreshed = await this.#serenaRevalidator!(evidence);
      if (context.signal?.aborted) {
        return {
          valid: false as const,
          code: "stale-readiness-evidence" as const,
          diagnostic: { code: "cancelled", message: "Serena configuration was cancelled." },
        };
      }
      return refreshed;
    };

    const writer = this.#serenaMcpWriter ?? ((input: SerenaMcpWriterInput) => this.writeDefaultSerenaMcpConfig(input));
    const result = await runEvidenceGatedSerenaWriter(
      {
        authorization: handoff.authorization,
        operation: handoff.operation,
        readiness: handoff.evidence,
        command: handoff.evidence.resolvedExecutablePath,
        args: [...SERENA_MCP_ARGS],
        revalidate,
      },
      writer,
      this.#serenaOwnedRoot,
    );

    if (!result.ok) return failedSerenaAction(action.id, "Serena MCP configuration was not changed.");
    return {
      actionId: action.id,
      status: "executed",
      message: result.status === "unchanged"
        ? "Serena MCP configuration is unchanged."
        : `Serena MCP configuration ${result.status}.`,
      diagnostics: [],
    };
  }

  private writeDefaultSerenaMcpConfig(input: SerenaMcpWriterInput): SerenaMcpWriteResult {
    const ownedRoot = this.#serenaOwnedRoot;
    if (!isSafeSerenaRoot(ownedRoot)) {
      return {
        ok: false,
        code: "root-invalid",
        diagnostic: { code: "root-invalid", message: "Serena MCP configuration requires a Deck-owned root." },
      };
    }
    const result = writeSerenaOpenCodeMcpConfig({
      configPath: this.#serenaConfigPath,
      ownedRoot,
      readiness: input.readiness,
      command: [input.command, ...input.args],
      fileSystem: this.#serenaMcpFileSystem,
    });
    if (!result.ok || !result.status) {
      return {
        ok: false,
        code: "config-write-failed",
        diagnostic: { code: "config-write-failed", message: "Serena MCP configuration was not changed." },
      };
    }
    return { ok: true, status: result.status };
  }

  private async writeMcpConfigFromCapability(
    capabilityId: string,
    source?: string,
    webSearchProvider?: WebSearchProviderDescriptorV1,
  ): Promise<{ ok: boolean; diagnostics: string[] }> {
    try {
      switch (capabilityId) {
        case "context7": {
          return writeOpenCodeMcpConfig({
            serverName: "context7",
            type: "local",
            command: ["npx", "-y", "@upstash/context7-mcp"],
          });
        }
        case "context-mode": {
          // context-mode migrates from plugin to MCP
          // Must remove "context-mode" from plugin array to avoid conflict
          return writeOpenCodeMcpConfig({
            serverName: "context-mode",
            type: "local",
            command: ["context-mode"],
            pluginsToRemove: ["context-mode"],
          });
        }
        case "web-search": {
          const configDir = this.#developerTeamConfigDir ?? join(homedir(), ".config", "opencode");
          const result = writeOpenCodeWebSearchMcpConfig({
            configPath: join(configDir, "opencode.json"),
            provider: webSearchProvider,
          });
          return {
            ok: result.ok,
            diagnostics: [...result.diagnostics],
          };
        }
        case "rtk": {
          // RTK MCP config — uses the rtk source for MCP server
          return writeOpenCodeMcpConfig({
            serverName: "rtk",
            type: "local",
            command: ["rtk", "mcp", "start"],
          });
        }
        case "supermemory": {
          // Supermemory project memory is handled by Deck Runtime; raw OpenCode MCP is not materialized here.
          return { ok: true, diagnostics: ["Supermemory project memory is handled by Deck Runtime; raw OpenCode MCP is not materialized."] };
        }
        default: {
          if (source) {
            // Try to parse as MCP server URL
            return writeOpenCodeMcpConfig({
              serverName: capabilityId,
              type: "remote",
              url: source,
            });
          }
          return { ok: false, diagnostics: [`Unknown capability ${capabilityId} for MCP config write.`] };
        }
      }
    } catch (error) {
      return { ok: false, diagnostics: [error instanceof Error ? error.message : String(error)] };
    }
  }

  // -------------------------------------------------------------------------
  // Team management
  // -------------------------------------------------------------------------

  getTeams(environmentId: RunnerEnvironmentId): readonly TeamEntry[] {
    return getTeamsForEnvironment(environmentId);
  }

  buildLaunchPlan(input: import("@deck/core").RunnerLaunchInput): import("@deck/core").RunnerLaunchResult {
    if (input.mode !== "interactive") {
      return {
        status: "unsupported",
        code: `opencode-${input.mode}-unsupported`,
        diagnostics: [{ code: "unsupported-launch-mode", severity: "error", message: "OpenCode compatibility launch currently supports interactive mode only." }],
      };
    }
    return {
      status: "ready",
      plan: {
        command: "opencode",
        args: [input.projectRoot],
        cwd: input.projectRoot,
        stdio: "inherit",
        stdin: "inherit",
      },
      diagnostics: [],
    };
  }

  // -------------------------------------------------------------------------
  // Model catalog and assignments
  // -------------------------------------------------------------------------

  getModelCatalog(context?: ModelCatalogContext): ModelCatalog {
    return getModelCatalog();
  }

  readModelAssignments(projectRoot: string): DeveloperTeamModelAssignments {
    const config = readOpenCodeDeveloperTeamModelConfigAssignments();
    return config.modelAssignments;
  }

  readThinkingAssignments(projectRoot: string): DeveloperTeamThinkingAssignments {
    const config = readOpenCodeDeveloperTeamModelConfigAssignments();
    // thinkingAssignments are stored as OpenCodeThinkingLevel, which is a string
    return config.thinkingAssignments as DeveloperTeamThinkingAssignments;
  }

  getThinkingLevels(modelId?: string): readonly string[] {
    if (!modelId || !this.#latestReady) return [];
    return findModelInInventory(this.#latestReady.inventory, modelId)?.variants ?? [];
  }

  supportsThinking(modelId: string): boolean {
    return this.getThinkingLevels(modelId).length > 0;
  }

  // -------------------------------------------------------------------------
  // Model inventory (configured providers only)
  // -------------------------------------------------------------------------

  async getModelInventory(request: RunnerModelDiscoveryRequest): Promise<RunnerModelInventoryResult> {
    const result = await this.#inventoryDiscovery(request);
    if (result.state === "ready") this.#latestReady = result;
    return result;
  }


  async validateModelAssignments(input: RunnerModelAssignmentValidationInput): Promise<RunnerModelAssignmentValidationResult> {
    const result = await this.getModelInventory({ projectRoot: input.projectRoot, mode: "prefer-cache" });
    if (result.state !== "ready" || (input.expectedFingerprint && input.expectedFingerprint !== result.fingerprint)) {
      return { valid: false, issues: input.changedAgentIds.map((agentId) => ({ agentId, code: "inventory-not-ready", message: "OpenCode availability must be refreshed before changing this assignment." })) };
    }
    const issues: import("@deck/core").RunnerModelAssignmentIssue[] = [];
    for (const agentId of input.changedAgentIds) {
      const modelId = input.modelAssignments[agentId];
      const variant = input.thinkingAssignments[agentId];
      const model = modelId ? findModelInInventory(result.inventory, modelId) : undefined;
      if (!model) issues.push({ agentId, code: "model-unavailable", message: "The selected model is unavailable in the active OpenCode runner." });
      else if (variant && !model.variants?.includes(variant)) issues.push({ agentId, code: "variant-unavailable", message: "The selected reasoning variant is unavailable for the model." });
    }
    return issues.length ? { valid: false, issues } : { valid: true, fingerprint: result.fingerprint };
  }

  // -------------------------------------------------------------------------
  // Developer Team installation
  // -------------------------------------------------------------------------

  buildDeveloperTeamInstallPlan(input: DeveloperTeamAdapterInstallInput): RunnerDeveloperTeamInstallPlan {
    const modelAssignments = input.modelAssignments ?? {};
    const thinkingAssignments = input.thinkingAssignments ?? {};
    const derivedSupermemoryProjectScope = (() => {
      const resolved = resolveCanonicalSupermemoryProjectScope({ projectRoot: input.projectRoot, remotes: [] });
      return resolved.ok ? resolved.scope : undefined;
    })();
    const capabilityInstructions = bindAdaptiveMemoryInstructionBundle(input.capabilityInstructions ?? (() => {
      try {
        return buildCapabilityInstructionBundle(getEnabledCapabilityInstructionIds(requireDeckConfig(input.deckConfig, "developer team install"), "opencode"), {
          supermemoryProjectScope: derivedSupermemoryProjectScope,
        });
      } catch {
        return undefined;
      }
    })(), {
      supermemoryProjectScope: derivedSupermemoryProjectScope,
    });
    const standaloneSkills = input.standaloneSkills ?? getStandaloneSkills().map(({ skillId }) => {
      const bundle = getStandaloneSkill(skillId);
      return { skillId, body: bundle.SKILL, files: bundle.files };
    });
    const nativePlan = buildOpenCodeDeveloperTeamInstallPlan(input.projectRoot, {
      configDir: this.#developerTeamConfigDir,
      configModelOverrides: modelAssignments,
      reasoningEffortOverrides: thinkingAssignments,
      changedAgentIds: input.changedAgentIds,
      memoryProvider: input.memoryProvider as any,
      supportedMemoryProviderIds: ["supermemory"],
      capabilityInstructions,
      personality: requireDeckConfig(input.deckConfig, "developer team install").orchestratorPersonality,
      standaloneSkills,
    });
    const configDir = this.#developerTeamConfigDir ?? join(homedir(), ".config", "opencode");
    const configPath = join(configDir, "opencode.json");
    let blocked = false;
    const diagnostics: string[] = [];
    let existingConfig: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try { existingConfig = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>; }
      catch { blocked = true; diagnostics.push("Existing opencode.json is malformed; exact preview is unavailable and apply is blocked."); }
    }
    const mergedConfig = mergeConfig(existingConfig, nativePlan.agentEntries, [...INTERNAL_OPENCODE_PACKAGE_IDS], [...DEVELOPER_TEAM_LEGACY_AGENT_IDS]);
    const plannedFiles: Array<{ path: string; absolutePath: string; content: string; kind: import("@deck/core").DeveloperTeamInstallFile["kind"]; skillId?: string; packagePath?: string }> = [
      { path: "opencode.json", absolutePath: configPath, content: JSON.stringify(mergedConfig, null, 2), kind: "other" },
      ...nativePlan.skills.map((skill) => ({ path: skill.relativePath, absolutePath: skill.absolutePath, content: skill.content, kind: "skill" as const, skillId: skill.agent.skillId, packagePath: "SKILL.md" })),
      ...nativePlan.standaloneSkills.map((skill) => ({ path: skill.relativePath, absolutePath: skill.absolutePath, content: skill.content, kind: "standalone-skill" as const, skillId: skill.skillId, packagePath: skill.packagePath })),
      ...(nativePlan.executionPlugin ? [{ path: nativePlan.executionPlugin.relativePath, absolutePath: nativePlan.executionPlugin.absolutePath, content: nativePlan.executionPlugin.content, kind: "other" as const }] : []),
      ...nativePlan.promptGenerationPlan.map((file) => ({ path: relative(configDir, file.absolutePath), absolutePath: file.absolutePath, content: file.content, kind: "prompt" as const })),
      ...nativePlan.commandGenerationPlan.map((file) => ({ path: relative(configDir, file.absolutePath), absolutePath: file.absolutePath, content: file.content, kind: "command" as const })),
    ];
    const digest = (content: string) => createHash("sha256").update(content).digest("hex");
    const files: import("@deck/core").DeveloperTeamInstallFile[] = plannedFiles.map(({ absolutePath: _absolutePath, ...file }) => file);
    const mutationPreview = plannedFiles.filter((file) => !existsSync(file.absolutePath) || readFileSync(file.absolutePath, "utf8") !== file.content).map((file) => ({
      action: existsSync(file.absolutePath) ? "update" as const : "create" as const,
      path: file.absolutePath,
      preimage: existsSync(file.absolutePath) ? digest(readFileSync(file.absolutePath, "utf8")) : "absent",
      postimage: digest(file.content),
      ownership: "opencode-native-plan",
    }));
    const plan: RunnerDeveloperTeamInstallPlan = { files, mutationPreview, blocked, diagnostics };
    this.#planBindings.set(plan, {
      nativePlan,
      validation: {
        changedAgentIds: [...(input.changedAgentIds ?? [])],
        fingerprint: input.validatedInventoryFingerprint,
        modelAssignments: { ...modelAssignments },
        thinkingAssignments: { ...thinkingAssignments },
      },
    });
    return plan;
  }

  async applyDeveloperTeamInstall(input: DeveloperTeamApplyInput): Promise<DeveloperTeamApplyResult> {
    const binding = this.#planBindings.get(input.plan);
    if (!binding) {
      throw new Error("The supplied developer-team plan was not built by this adapter instance.");
    }
    if (binding.validation.changedAgentIds.length) {
      const validation = await this.validateModelAssignments({
        projectRoot: input.projectRoot,
        modelAssignments: binding.validation.modelAssignments,
        thinkingAssignments: binding.validation.thinkingAssignments,
        changedAgentIds: binding.validation.changedAgentIds,
        expectedFingerprint: binding.validation.fingerprint,
      });
      if (!validation.valid) throw new Error(validation.issues.map((issue) => issue.message).join(" "));
    }
    const configDir = this.#developerTeamConfigDir ?? join(homedir(), ".config", "opencode");
    const nativePlan: OpenCodeDeveloperTeamInstallPlan = { ...binding.nativePlan, projectRoot: input.projectRoot };
    const result: OpenCodeDeveloperTeamApplyResult = applyOpenCodeDeveloperTeamInstall(nativePlan, { configDir });
    return {
      results: result.results.map((item) => ({ agentId: item.agentId, kind: item.kind, status: item.status })),
      changedCount: result.changedCount,
      unchangedCount: result.unchangedCount,
    };
  }

  // -------------------------------------------------------------------------
  // MCP config (optional)
  // -------------------------------------------------------------------------

  async writeMcpConfig(input: RunnerMcpConfigInput): Promise<RunnerMcpConfigResult> {
    if (input.webSearchProvider) {
      const configPath = join(this.#developerTeamConfigDir ?? join(homedir(), ".config", "opencode"), "opencode.json");
      if (input.serverName !== input.webSearchProvider.semanticServerId) {
        return {
          ok: false,
          path: configPath,
          diagnostics: ["Web Search MCP action identity does not match the selected provider descriptor."],
        };
      }
      const result = writeOpenCodeWebSearchMcpConfig({
        configPath,
        provider: input.webSearchProvider,
      });
      return {
        ok: result.ok,
        path: result.path,
        diagnostics: [...result.diagnostics],
      };
    }
    if (input.serverName === "web-search") {
      const configPath = join(this.#developerTeamConfigDir ?? join(homedir(), ".config", "opencode"), "opencode.json");
      return {
        ok: false,
        path: configPath,
        diagnostics: ["Web Search provider selection is unavailable; no changes were written."],
      };
    }
    if (input.serverName === "serena") {
      return {
        ok: false,
        path: this.#serenaConfigPath ?? "",
        diagnostics: ["Serena configuration requires the current-operation evidence-gated action."],
      };
    }

    // Supermemory project memory is owned by Deck Runtime. The raw OpenCode MCP
    // surface is never materialized here; when the adapter has an explicit
    // config directory, this path may retire an exact stale Deck-managed entry.
    if (input.serverName === "supermemory") {
      const configPath = this.#developerTeamConfigDir ? join(this.#developerTeamConfigDir, "opencode.json") : undefined;
      if (!configPath) {
        return {
          ok: true,
          path: "",
          diagnostics: ["Raw OpenCode Supermemory MCP is absent-safe; no config directory was provided and no user config was inspected or written."],
        };
      }
      const { writeSupermemoryOpenCodeMcpConfig } = require("./opencode-mcp-config");
      const result = writeSupermemoryOpenCodeMcpConfig({
        serverName: input.serverName,
        configPath,
        projectRoot: input.projectRoot,
      });
      const diagnosticsList: string[] = [];
      if (result.diagnostics) {
        for (const d of result.diagnostics) diagnosticsList.push(d);
      }
      return {
        ok: result.ok,
        path: result.path,
        diagnostics: diagnosticsList,
      };
    }

    const result = writeOpenCodeMcpConfig({
      serverName: input.serverName,
      type: input.type ?? "local",
      command: input.command ? [...input.command] : undefined,
      url: input.url,
      headers: input.headers,
    });

    const diagnosticsList: string[] = [];
    if (result.diagnostics) {
      for (const d of result.diagnostics) diagnosticsList.push(d);
    }
    return {
      ok: result.ok,
      path: result.path,
      status: result.status,
      diagnostics: diagnosticsList,
    };
  }

  // -------------------------------------------------------------------------
  // Flow routing
  // -------------------------------------------------------------------------

  getNextScreen(state: FlowState): NextScreen {
    switch (state.currentScreen) {
      case "team-selection":
        return "developer-team-review";
      case "developer-team-review":
        return state.installProgress ? "developer-team-installing" : "developer-team-review";
      case "developer-team-installing":
        if (state.installProgress && state.installProgress.completed >= state.installProgress.total) {
          return "complete";
        }
        return "developer-team-installing";
      case "environment-selection":
        return "preflight-checking";
      case "personality-selection":
        return "preflight-checking";
      case "preflight-checking":
        return "team-selection";
      case "complete":
        return "complete";
      default:
        // For any unknown screen, advance through the typical flow
        if (state.selectedTeams && state.selectedTeams.length > 0) {
          return "developer-team-review";
        }
        return "team-selection";
    }
  }

  // -------------------------------------------------------------------------
  // Environment inspection
  // -------------------------------------------------------------------------

  async inspectEnvironment(): Promise<unknown> {
    return inspectOpenCodeEnvironment({
      command: "opencode",
      pathExists: (path) => {
        try {
          const { existsSync } = require("node:fs");
          return existsSync(path);
        } catch {
          return false;
        }
      },
    });
  }

  // -------------------------------------------------------------------------
  // Tool review
  // -------------------------------------------------------------------------

  async reviewTools(): Promise<unknown> {
    return reviewOpenCodeTools({ packageManifest: undefined });
  }

  // -------------------------------------------------------------------------
  // Team file backup/restore
  // -------------------------------------------------------------------------

  backupDeveloperTeamFiles(plan: unknown): import("@deck/core").RunnerBackupResult {
    const binding = this.#planBindings.get(plan as RunnerDeveloperTeamInstallPlan);
    if (!binding) throw new Error("The supplied developer-team plan was not built by this adapter instance.");
    return { payload: backupDeveloperTeamFiles(binding.nativePlan), diagnostics: [] };
  }

  async rollbackDeveloperTeamFiles(backup: unknown): Promise<import("@deck/core").RunnerRollbackResult> {
    const payload = (backup as import("@deck/core").RunnerBackupResult).payload;
    rollbackDeveloperTeamFiles(payload as Parameters<typeof rollbackDeveloperTeamFiles>[0]);
    return { status: "rolled-back", conflicts: [], diagnostics: [] };
  }

  // -------------------------------------------------------------------------
  // Developer team verification
  // -------------------------------------------------------------------------

  verifyDeveloperTeamInstall(plan: unknown): { valid: boolean; diagnostics: readonly string[] } {
    const binding = this.#planBindings.get(plan as RunnerDeveloperTeamInstallPlan);
    if (!binding) throw new Error("The supplied developer-team plan was not built by this adapter instance.");
    const result = verifyOpenCodeDeveloperTeamInstall(binding.nativePlan);
    const diagnostics = [
      ...result.agentResults.flatMap((entry) => entry.issues),
      ...result.skillResults.flatMap((entry) => entry.issues),
    ];
    return { valid: result.valid, diagnostics };
  }

  // -------------------------------------------------------------------------
  // Thinking resolution
  // -------------------------------------------------------------------------

  resolveThinking(modelId: string, existingAssignment?: string): string | undefined {
    const variants = this.getThinkingLevels(modelId);
    return existingAssignment && variants.includes(existingAssignment) ? existingAssignment : undefined;
  }

  getDefaultThinking(modelId: string): string | undefined {
    return this.getThinkingLevels(modelId)[0];
  }

  // -------------------------------------------------------------------------
  // Capability catalog access
  // -------------------------------------------------------------------------

  getCapability(capabilityId: string): unknown {
    return getUserFacingOpenCodeCapability(capabilityId as any);
  }

  getCapabilityIds(): readonly string[] {
    return OPENCODE_RUNNER_CAPABILITY_IDS as readonly string[];
  }

  // -------------------------------------------------------------------------
  // Selectable tools
  // -------------------------------------------------------------------------

  getSelectableTools(): unknown[] {
    return getSelectableOpenCodeTools();
  }

  // -------------------------------------------------------------------------
  // Detection (added by `add-self-update-system` / T2.10)
  // -------------------------------------------------------------------------

  /**
   * Detect whether Deck-managed artifacts are installed for OpenCode.
   *
   * Scans the OpenCode config root (and the home-relative `~/.config/opencode/`
   * fallback when no project root is supplied) for files Deck writes when it
   * installs the Developer Team: `opencode.json`, `AGENTS.md`, the
   * `skills/deck-*` directory, and `packageInstructions.json`.
   *
   * Returns `{ installed: false, managedPaths: [], diagnostics: [...] }` when
   * the config root is missing or no Deck-managed files are found.
   */
  async detectDeckInstall(
    input?: RunnerDeckInstallInput,
  ): Promise<RunnerDeckInstallStatus> {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");

    // OpenCode writes project-relative config at `<projectRoot>/.config/opencode`
    // and falls back to `~/.config/opencode/` when no project root is given.
    // Per the design we keep both candidates in scope for the upgrade sync.
    //
    // The home-relative root is computed from `process.env.HOME` first so
    // tests can override it; we fall back to `os.homedir()` when the env var
    // is not set (which on Linux/Unix reads passwd via getpwuid_r, so we
    // still get a sensible default).
    const configRoots: string[] = [];
    if (input?.projectRoot) {
      configRoots.push(join(input.projectRoot, ".config", "opencode"));
    }
    const envHome = process.env.HOME;
    const effectiveHome = envHome && envHome.length > 0 ? envHome : homedir();
    configRoots.push(join(effectiveHome, ".config", "opencode"));

    const managedFiles = [
      "opencode.json",
      "AGENTS.md",
      "packageInstructions.json",
    ];

    const managedPaths: string[] = [];
    const diagnostics: string[] = [];

    for (const root of configRoots) {
      if (!existsSync(root)) {
        diagnostics.push(`OpenCode config root not found: ${root}`);
        continue;
      }
      for (const fileName of managedFiles) {
        const p = join(root, fileName);
        if (existsSync(p)) {
          managedPaths.push(p);
        }
      }
      // Skills dir — directory presence is enough signal for a Deck install
      const skillsDir = join(root, "skills");
      if (existsSync(skillsDir)) {
        managedPaths.push(skillsDir);
      }
    }

    return {
      installed: managedPaths.length > 0,
      managedPaths,
      diagnostics,
    };
  }
}

// ---------------------------------------------------------------------------
// Model-inventory lookup helpers
// ---------------------------------------------------------------------------

/**
 * Find a model entry in the inventory by ID, tolerating the
 * `provider/model` vs raw `model` ID mismatch.
 *
 * Lookup order:
 *  1. Exact match on `model.id` across all providers (handles canonical
 *     `provider/model` IDs like "openai/gpt-5.5" or "alibaba-token-plan/glm-5.2").
 *  2. If `modelId` has no provider prefix (no "/"), match by suffix — i.e.
 *     find any inventory entry whose id is `<provider>/<modelId>`. This lets
 *     callers pass a raw model id ("glm-5.2") and still resolve the entry
 *     ("alibaba-token-plan/glm-5.2").
 *
 * Returns the first match, or undefined when the model is not in the inventory.
 */
function findModelInInventory(
  inventory: RunnerModelInventory,
  modelId: string,
): RunnerModelEntry | undefined {
  for (const models of Object.values(inventory.modelsByProvider)) {
    const exact = models.find((model) => model.id === modelId);
    if (exact) return exact;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Singleton instance for drop-in replacement
// ---------------------------------------------------------------------------

function projectOpenCodeInstallResult(
  action: RunnerAction,
  result: OpenCodeToolInstallResultExact,
): RunnerActionRunResult {
  const status: RunnerActionRunResult["status"] = result.outcome === "already-present"
    ? "skipped"
    : result.outcome === "executed"
      ? "executed"
      : result.outcome === "failed"
        ? "failed"
        : "skipped";
  const diagnostics = boundActionDiagnostics(result.cause ? [result.cause] : result.diagnostic?.lines ?? []);
  const raw = {
    id: result.toolId,
    outcome: result.outcome,
    ...(result.diagnostic ? {
      diagnostic: {
        stage: result.diagnostic.stage,
        code: result.diagnostic.code,
        ...(result.diagnostic.exitCode === undefined ? {} : { exitCode: result.diagnostic.exitCode }),
        lines: boundActionDiagnostics(result.diagnostic.lines),
      },
    } : {}),
  };
  return {
    actionId: action.id,
    status,
    message: result.message,
    diagnostics,
    raw,
  };
}

function isSerenaAction(action: RunnerAction): boolean {
  return action.capabilityId === "serena" && (action.toolId === undefined || action.toolId === "serena");
}

function hasExplicitSerenaDashboardSelection(state: DashboardState): boolean {
  return state.runnerId === "opencode"
    && state.selectedCapabilities.serena === true
    && state.explicitlySelectedCapabilities?.serena === true
    && typeof state.operationId === "string"
    && state.operationId.length > 0
    && state.operationId.length <= 200
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(state.operationId);
}

function isSafeSerenaRoot(root: string | undefined): root is string {
  if (!root || !root.startsWith("/") || root === "/" || root.includes("\0") || root.split("/").some((part) => part === "..")) return false;
  return !new Set(["/bin", "/sbin", "/usr", "/opt", "/etc", "/var", "/root"]).has(root.replace(/\/$/u, ""));
}

function failedSerenaAction(actionId: string, message: string): RunnerActionRunResult {
  return {
    actionId,
    status: "failed",
    message,
    diagnostics: ["Serena configuration and installation are fail-closed until current-operation evidence is valid."],
  };
}

function cancelledSerenaAction(actionId: string): RunnerActionRunResult {
  return {
    actionId,
    status: "skipped",
    message: "Serena setup was cancelled; configuration was not changed.",
    diagnostics: [],
  };
}

function boundActionDiagnostics(values: readonly string[]): readonly string[] {
  const result: string[] = [];
  let bytes = 0;
  for (const value of values) {
    if (result.length >= 8) break;
    const line = [...value].slice(0, 240).join("");
    const remaining = 1_280 - bytes;
    if (remaining <= 0) break;
    const bounded = Buffer.byteLength(line, "utf8") <= remaining
      ? line
      : Buffer.from(line, "utf8").subarray(0, remaining).toString("utf8");
    if (!bounded) continue;
    result.push(bounded);
    bytes += Buffer.byteLength(bounded, "utf8");
  }
  return result;
}

export const openCodeRunnerAdapter: RunnerAdapter = createOpenCodeRunnerAdapter();

// ---------------------------------------------------------------------------
// Factory export (for AdapterRegistry registration)
// ---------------------------------------------------------------------------

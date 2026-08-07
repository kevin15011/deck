/**
 * Pi RunnerAdapter — implements the RunnerAdapter interface for the Pi runner.
 *
 * Wraps all Pi-specific functions (buildPiRunnerReviewPlan, buildPiInstallationPlan,
 * installPiTools, etc.) behind the generic RunnerAdapter interface so the TUI
 * can interact with Pi without any runner-specific knowledge.
 *
 * Design: runner-decoupling-refactor / design.md § RunnerAdapter Contract
 * Task: 2.1 — Implement PiRunnerAdapter
 */

import { inspectPiEnvironment, type PiPreflightResult } from "./preflight";
import { accessSync, constants as fsConstants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { buildPiRunnerCapabilityInventory, type PiRunnerCapabilityInventory, type PiRunnerFullCapabilityInventory } from "./capability-inventory";
import { buildPiRunnerReviewPlan, type PiRunnerReviewPlan } from "./capability-plan";
import { buildPiInstallationPlan, getPiInstallableTool, type InstallablePiToolId, type InstallablePiTool } from "./installation-plan";
import { installPiTools, installInternalRunnerPackages } from "./install-tools";
import { reviewPiRequiredTools, type PiRequiredToolsReview } from "./required-tools";
import { getTeamsForEnvironment } from "./team-catalog";
import { buildPiTeamLaunchPlan } from "./pi-team-launch";
import {
  readDeveloperTeamModelAssignments,
  readDeveloperTeamThinkingAssignments,
  buildDeveloperTeamInstallPlan as buildPiDeveloperTeamInstallPlan,
  applyDeveloperTeamInstall as applyPiDeveloperTeamInstall,
  backupDeveloperTeamFiles,
  rollbackDeveloperTeamFiles,
  verifyDeveloperTeamInstall,
  type DeveloperTeamInstallPlan as PiDeveloperTeamInstallPlan,
} from "./developer-team-install";
import { PI_THINKING_LEVELS, supportsThinkingForModel, getDefaultThinkingForModel, resolveThinkingForModel } from "./model-config";
import { getPiRunnerCapability, PI_RUNNER_CAPABILITY_CONTRIBUTION, PI_RUNNER_CAPABILITY_IDS } from "./capability-catalog";
import { getOptionalPiTools } from "./installation-plan";
import {
  writeSupermemoryPiMcpConfig,
  writeContextModeMcpConfig,
  writeCodebaseMemoryMcpConfig,
  writeSerenaMcpConfig,
  writeContext7McpConfig,
  defaultPiMcpConfigPath,
  type PiMcpConfigFileSystem,
  type PiMcpConfigWriteResult,
  type WriteSerenaMcpConfigOptions,
} from "./pi-mcp-config";
import { mergeSettingsPackages } from "./settings-merge";
import type { InternalRunnerPackageInstallAction } from "./internal-runner-packages";
import type { RequiredToolStatus } from "./required-tools";
import type {
  RunnerAdapter,
  RuntimeDetectionInput,
  RuntimeStatus,
  CapabilityInventoryInput,
  CapabilityInventory,
  CapabilityCatalogEntry,
  DashboardState,
  ReviewPlan,
  InstallationPlan,
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
  RunnerMcpConfigInput,
  RunnerMcpConfigResult,
  FlowState,
  NextScreen,
  RunnerActionStatus,
  RunnerPlanDiagnostic,
  DeveloperTeamApplyInput,
  DeveloperTeamApplyResult,
  SkillDiscoveryDiagnosticV1,
  SkillDiscoverySourceBindingV1,
  SkillDiscoverySourceDeclarationV1,
  SkillDiscoverySourceProviderV1,
  OpaqueSkillInventoryResultV1,
  SkillLocatorResolutionV1,
  SerenaBootstrapAuthorization,
  SerenaOperationIdentity,
  SerenaReadinessEvidence,
  SerenaReadinessRevalidator,
} from "@deck/core";
import {
  getModelCatalog as getCoreModelCatalog,
  getRunnerCapabilityMapping,
  PACKAGE_INSTRUCTION_PACKAGE_IDS,
  buildCapabilityInstructionBundle,
  getConfigurablePackageInstructionMetadata,
  runEvidenceGatedSerenaWriter,
  SERENA_MCP_ARGS,
  validateSerenaOperationAuthorization,
  SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA,
  SKILL_DISCOVERY_SOURCE_SCHEMA,
} from "@deck/core";

// ---------------------------------------------------------------------------
// Adapter constants
// ---------------------------------------------------------------------------

const PI_RUNNER_ID = "pi";
const PI_DISPLAY_NAME = "Pi Runner";
const PI_ENVIRONMENT_IDS = ["pi-development"] as const;

export type PiRunnerAdapterOptions = {
  /** Runtime-only home override used by hermetic callers and tests. */
  readonly homeDirectory?: string;
  /** Optional runner-exposed inventory supplied by Pi itself. */
  readonly opaqueInventory?: () => Promise<OpaqueSkillInventoryResultV1>;
  /** Deterministic Serena installer projection seam. */
  readonly installTools?: typeof installPiTools;
  /** Injected Core effects for Serena bootstrap tests. */
  readonly serenaBootstrapEffects?: import("@deck/core").SerenaBootstrapEffects;
  /** Optional default revalidator used by the named Serena config action. */
  readonly serenaRevalidator?: SerenaReadinessRevalidator;
  /** Optional canonical Deck-owned Serena root for writer validation. */
  readonly serenaOwnedRoot?: string;
  /** Injected Serena writer seam; production uses the evidence-gated Pi writer. */
  readonly writeSerenaMcpConfig?: (options: WriteSerenaMcpConfigOptions) => PiMcpConfigWriteResult | Promise<PiMcpConfigWriteResult>;
  /** Named non-Serena writer seam for hermetic adapter tests. */
  readonly writeNamedMcpConfig?: (capabilityId: string, context: RunnerActionContext) => Promise<PiMcpConfigWriteResult> | PiMcpConfigWriteResult;
};

type PiSerenaActionContextExtensions = {
  readonly serenaRevalidator?: SerenaReadinessRevalidator;
  readonly serenaOwnedRoot?: string;
  readonly serenaBootstrapOutcome?: "reused" | "installed" | "failed" | "cancelled" | "partial";
  readonly piMcpConfigPath?: string;
  readonly homeDirectory?: string;
  readonly piMcpFileSystem?: PiMcpConfigFileSystem;
};

type PiFilesystemSourceDefinition = {
  readonly sourceId: string;
  readonly sourceCategory: "project_runner" | "user_runner";
  readonly scope: "project" | "user";
  readonly locatorStrategy: "project_relative" | "runner_relative";
  readonly safeLocatorBase: string;
  readonly getRoot: (projectRoot: string, homeDirectory: string) => string;
};

const PI_FILESYSTEM_SOURCE_DEFINITIONS: readonly PiFilesystemSourceDefinition[] = [
  {
    sourceId: "pi-project-skills",
    sourceCategory: "project_runner",
    scope: "project",
    locatorStrategy: "project_relative",
    safeLocatorBase: ".pi/skills",
    getRoot: (projectRoot) => join(projectRoot, ".pi", "skills"),
  },
  {
    sourceId: "pi-user-agent-skills",
    sourceCategory: "user_runner",
    scope: "user",
    locatorStrategy: "runner_relative",
    safeLocatorBase: "pi-user-agent-skills",
    getRoot: (_projectRoot, homeDirectory) => join(homeDirectory, ".pi", "agent", "skills"),
  },
  {
    sourceId: "pi-user-skills",
    sourceCategory: "user_runner",
    scope: "user",
    locatorStrategy: "runner_relative",
    safeLocatorBase: "pi-user-skills",
    getRoot: (_projectRoot, homeDirectory) => join(homeDirectory, ".pi", "skills"),
  },
];

const PI_OPAQUE_SOURCE_ID = "pi-runner-exposed";

/**
 * Construct the Pi-only source provider. It only declares Pi roots and never
 * consults the bundled standalone-skill catalog or another adapter.
 */
export function createPiSkillDiscoveryProvider(
  options: PiRunnerAdapterOptions = {},
): SkillDiscoverySourceProviderV1 {
  const homeDirectory = normalizeRuntimeDirectory(options.homeDirectory ?? process.env.HOME ?? homedir());

  return {
    schema: SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA,
    runnerId: PI_RUNNER_ID,

    async listSources(input): Promise<
      | { readonly outcome: "complete"; readonly sources: readonly SkillDiscoverySourceBindingV1[]; readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[] }
      | { readonly outcome: "indeterminate"; readonly sources: readonly SkillDiscoverySourceBindingV1[]; readonly reasonCode: "partial_source_evaluation"; readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[] }
    > {
      const projectRoot = normalizeProjectRoot(input.projectRoot);
      if (!projectRoot) {
        return {
          outcome: "indeterminate",
          sources: [],
          reasonCode: "partial_source_evaluation",
          diagnostics: [piDiagnostic("invalid_project_root")],
        };
      }

      const sources = buildPiFilesystemSources(projectRoot, homeDirectory);
      const diagnostics = sources
        .filter((source): source is Extract<SkillDiscoverySourceBindingV1, { readonly kind: "filesystem" }> => source.kind === "filesystem")
        .filter((source) => !isDeclaredRootReadable(source.absoluteRoot))
        .map((source) => piDiagnostic("source_unreadable", source.declaration.sourceId));

      if (options.opaqueInventory) {
        sources.push(buildPiOpaqueSource(options.opaqueInventory));
      }

      if (diagnostics.length > 0) {
        return {
          outcome: "indeterminate",
          sources,
          reasonCode: "partial_source_evaluation",
          diagnostics,
        };
      }

      return { outcome: "complete", sources, diagnostics: [] };
    },

    async resolveLocator(input): Promise<SkillLocatorResolutionV1> {
      const projectRoot = normalizeProjectRoot(input.projectRoot);
      if (!projectRoot || typeof input.locator !== "string") {
        return { status: "rejected", diagnostic: piDiagnostic("invalid_locator") };
      }

      const sources = buildPiFilesystemSources(projectRoot, homeDirectory);
      if (options.opaqueInventory) sources.push(buildPiOpaqueSource(options.opaqueInventory));

      if (input.locator.startsWith("project:")) {
        const projectRelativePath = decodeLocatorPath(input.locator.slice("project:".length));
        if (!projectRelativePath || !projectRelativePath.startsWith(".pi/skills/")) {
          return { status: "rejected", diagnostic: piDiagnostic("invalid_locator", "pi-project-skills") };
        }
        const source = sources.find((candidate) => candidate.declaration.sourceId === "pi-project-skills");
        if (!source || source.kind !== "filesystem") return { status: "missing" };
        return resolveFilesystemLocator(source.absoluteRoot, projectRelativePath.slice(".pi/skills/".length), source.declaration.sourceId);
      }

      const runnerLocator = parseRunnerLocator(input.locator);
      if (!runnerLocator) return { status: "rejected", diagnostic: piDiagnostic("invalid_locator") };
      if (runnerLocator.runnerId !== PI_RUNNER_ID) {
        return { status: "rejected", diagnostic: piDiagnostic("runner_mismatch") };
      }

      const source = sources.find((candidate) => candidate.declaration.sourceId === runnerLocator.sourceId);
      if (!source) return { status: "missing" };

      if (source.kind === "opaque_inventory") {
        return resolveOpaqueLocator(source, runnerLocator.resourcePath);
      }

      const relativePath = decodeLocatorPath(runnerLocator.resourcePath);
      if (!relativePath) return { status: "rejected", diagnostic: piDiagnostic("invalid_locator", source.declaration.sourceId) };
      return resolveFilesystemLocator(source.absoluteRoot, relativePath, source.declaration.sourceId);
    },
  };
}

function buildPiFilesystemSources(projectRoot: string, homeDirectory: string): SkillDiscoverySourceBindingV1[] {
  return PI_FILESYSTEM_SOURCE_DEFINITIONS.map((definition) => {
    const declaration: SkillDiscoverySourceDeclarationV1 = {
      schema: SKILL_DISCOVERY_SOURCE_SCHEMA,
      sourceId: definition.sourceId,
      sourceCategory: definition.sourceCategory,
      scope: definition.scope,
      runnerId: PI_RUNNER_ID,
      locatorStrategy: definition.locatorStrategy,
      expectedContent: "skill_md",
      safeLocatorBase: definition.safeLocatorBase,
    };
    return {
      kind: "filesystem",
      declaration,
      absoluteRoot: definition.getRoot(projectRoot, homeDirectory),
      descriptorBasename: "SKILL.md",
    };
  });
}

function buildPiOpaqueSource(readInventory: () => Promise<OpaqueSkillInventoryResultV1>): SkillDiscoverySourceBindingV1 {
  const declaration: SkillDiscoverySourceDeclarationV1 = {
    schema: SKILL_DISCOVERY_SOURCE_SCHEMA,
    sourceId: PI_OPAQUE_SOURCE_ID,
    sourceCategory: "runner_exposed",
    scope: "runner",
    runnerId: PI_RUNNER_ID,
    locatorStrategy: "runner_opaque",
    expectedContent: "opaque_inventory_v1",
    safeLocatorBase: PI_OPAQUE_SOURCE_ID,
  };
  return {
    kind: "opaque_inventory",
    declaration,
    readInventory: async () => {
      try {
        const result = await readInventory();
        if (result && (result.outcome === "complete" || result.outcome === "indeterminate") && Array.isArray(result.observations) && Array.isArray(result.diagnostics)) {
          return result;
        }
      } catch {
        // Convert runner inventory failures into a bounded partial result.
      }
      return {
        outcome: "indeterminate",
        observations: [],
        reasonCode: "partial_source_evaluation",
        diagnostics: [piDiagnostic("opaque_inventory_unavailable", PI_OPAQUE_SOURCE_ID)],
      };
    },
  };
}

function normalizeRuntimeDirectory(directory: string): string {
  return isAbsolute(directory) ? resolve(directory) : resolve(homedir());
}

function normalizeProjectRoot(projectRoot: string): string | undefined {
  return typeof projectRoot === "string" && projectRoot.length > 0 && isAbsolute(projectRoot) ? resolve(projectRoot) : undefined;
}

function isDeclaredRootReadable(root: string): boolean {
  if (!existsSync(root)) return true;
  try {
    const stats = statSync(root);
    if (!stats.isDirectory() || (stats.mode & 0o444) === 0 || (stats.mode & 0o111) === 0) return false;
    accessSync(root, fsConstants.R_OK | fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function parseRunnerLocator(locator: string): { runnerId: string; sourceId: string; resourcePath: string } | undefined {
  if (!locator.startsWith("runner:")) return undefined;
  const remainder = locator.slice("runner:".length);
  const runnerSeparator = remainder.indexOf(":");
  if (runnerSeparator <= 0) return undefined;
  const runnerId = remainder.slice(0, runnerSeparator);
  const token = remainder.slice(runnerSeparator + 1);
  const sourceSeparator = token.indexOf("/");
  if (sourceSeparator <= 0 || sourceSeparator === token.length - 1) return undefined;
  const sourceId = decodeLocatorComponent(token.slice(0, sourceSeparator));
  const resourcePath = token.slice(sourceSeparator + 1);
  return sourceId ? { runnerId, sourceId, resourcePath } : undefined;
}

function decodeLocatorPath(value: string): string | undefined {
  const decoded = decodeLocatorComponent(value);
  if (!decoded || !isSafeRelativeSkillPath(decoded)) return undefined;
  return decoded;
}

function decodeLocatorComponent(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return decoded && !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function isSafeRelativeSkillPath(value: string): boolean {
  if (!value || value.includes("\\") || value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:/u.test(value)) return false;
  if (!value.endsWith("/SKILL.md")) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function resolveFilesystemLocator(root: string, relativePath: string, sourceId: string): SkillLocatorResolutionV1 {
  if (!isSafeRelativeSkillPath(relativePath)) {
    return { status: "rejected", diagnostic: piDiagnostic("invalid_locator", sourceId) };
  }
  if (!isDeclaredRootReadable(root)) {
    return { status: "rejected", diagnostic: piDiagnostic("source_unreadable", sourceId) };
  }

  const candidate = resolve(root, relativePath);
  if (!isContained(root, candidate)) {
    return { status: "rejected", diagnostic: piDiagnostic("locator_outside_root", sourceId) };
  }
  if (!existsSync(candidate)) return { status: "missing" };

  try {
    const canonicalRoot = realpathSync(root);
    const canonicalCandidate = realpathSync(candidate);
    if (!isContained(canonicalRoot, canonicalCandidate)) {
      return { status: "rejected", diagnostic: piDiagnostic("locator_outside_root", sourceId) };
    }
    if (!statSync(candidate).isFile()) {
      return { status: "rejected", diagnostic: piDiagnostic("locator_not_file", sourceId) };
    }
    accessSync(candidate, fsConstants.R_OK);
    if (realpathSync(candidate) !== canonicalCandidate || !statSync(candidate).isFile()) {
      return { status: "rejected", diagnostic: piDiagnostic("locator_changed", sourceId) };
    }
    return { status: "available", loadReference: candidate };
  } catch {
    return { status: "rejected", diagnostic: piDiagnostic("locator_unavailable", sourceId) };
  }
}

async function resolveOpaqueLocator(
  source: Extract<SkillDiscoverySourceBindingV1, { readonly kind: "opaque_inventory" }>,
  resourcePath: string,
): Promise<SkillLocatorResolutionV1> {
  const opaqueId = decodeLocatorComponent(resourcePath);
  if (!opaqueId || !isSafeOpaqueId(opaqueId)) {
    return { status: "rejected", diagnostic: piDiagnostic("invalid_opaque_id", source.declaration.sourceId) };
  }
  const inventory = await source.readInventory();
  if (inventory.outcome !== "complete") {
    return { status: "rejected", diagnostic: piDiagnostic("opaque_inventory_incomplete", source.declaration.sourceId) };
  }
  if (!inventory.observations.some((observation) => observation.opaqueId === opaqueId)) return { status: "missing" };
  return { status: "available", loadReference: `pi:opaque:${encodeURIComponent(opaqueId)}` };
}

function isSafeOpaqueId(value: string): boolean {
  return !value.includes("/") && !value.includes("\\") && !value.startsWith("~") && !isAbsolute(value) && !/^[A-Za-z]:/u.test(value);
}

function isContained(root: string, candidate: string): boolean {
  const result = relative(resolve(root), resolve(candidate));
  return result !== "" && result !== ".." && !result.startsWith(`..${sep}`) && !isAbsolute(result);
}

function piDiagnostic(code: string, sourceId?: string): SkillDiscoveryDiagnosticV1 {
  const messages: Record<string, string> = {
    invalid_project_root: "Pi skill discovery received an invalid project root.",
    invalid_locator: "The Pi skill locator is invalid.",
    runner_mismatch: "The skill locator belongs to a different runner.",
    source_unreadable: "A declared Pi skill source could not be read.",
    locator_outside_root: "The skill locator is outside its declared source.",
    locator_not_file: "The selected Pi skill locator is not a regular file.",
    locator_changed: "The selected Pi skill locator changed during verification.",
    locator_unavailable: "The selected Pi skill locator is unavailable.",
    invalid_opaque_id: "The opaque Pi skill identifier is invalid.",
    opaque_inventory_unavailable: "The Pi skill inventory could not be evaluated completely.",
    opaque_inventory_incomplete: "The Pi skill inventory is incomplete.",
  };
  return {
    code,
    ...(sourceId ? { source_id: sourceId } : {}),
    message: messages[code] ?? "Pi skill discovery could not complete.",
  };
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export function createPiRunnerAdapter(options: PiRunnerAdapterOptions = {}): RunnerAdapter {
  return new PiRunnerAdapterImpl(options);
}

/**
 * Pure gate shared by Pi Serena install/config action dispatch. It deliberately
 * accepts a narrow structural context so tests and future orchestration can
 * validate a handcrafted action without reaching any external boundary.
 */
export function isPiSerenaActionAuthorized(
  action: Pick<RunnerAction, "kind" | "capabilityId">,
  context: Pick<RunnerActionContext, "runnerId" | "operationId" | "operation" | "currentOperation" | "serenaAuthorization" | "serenaReadiness">,
): boolean {
  if (
    context.runnerId !== PI_RUNNER_ID
    || action.capabilityId !== "serena"
    || action.kind !== "install-pi-package" && action.kind !== "write-pi-mcp-config"
  ) {
    return false;
  }

  const operation = context.currentOperation ?? context.operation;
  if (!operation || context.operationId !== undefined && context.operationId !== operation.operationId) return false;
  return validateSerenaOperationAuthorization(context.serenaAuthorization, operation).valid;
}

// ---------------------------------------------------------------------------
// PiRunnerAdapter implementation
// ---------------------------------------------------------------------------

class PiRunnerAdapterImpl implements RunnerAdapter {
  readonly runnerId: string = PI_RUNNER_ID;
  readonly displayName: string = PI_DISPLAY_NAME;
  readonly environmentIds: readonly string[] = PI_ENVIRONMENT_IDS;
  readonly packageInstructionIds = PACKAGE_INSTRUCTION_PACKAGE_IDS;
  readonly ui = {
    environmentLabels: { "pi-development": "Pi Development (Recommended)" },
    dashboard: { defaultSelectedTeamIds: [] },
    model: {
      providerSource: "Providers come from Pi settings and detected credentials.",
      missingChecks: ["~/.pi/agent/settings.json defaultProvider/defaultModel", "pi --list-models", "Provider env vars such as OPENCODE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY"],
      remediation: "Run `pi --list-models` or `pi config` to confirm Pi can see your providers.",
      defaultThinkingLevels: PI_THINKING_LEVELS,
      usesNativeCompatibilityChecks: true,
    },
    adaptiveMemory: {
      supermemory: {
        requiresExternalToken: true,
        selectionStatus: "Supermemory selected; provide an API key for the Pi MCP handoff.",
      },
      engram: { label: "Engram", detail: "Engram enables the derived engram-memory technical action." },
    },
  } as const;

  // Store last native plan for backup/restore/verify operations
  #lastNativePlan: PiDeveloperTeamInstallPlan | null = null;
  #installTools: typeof installPiTools;
  #serenaBootstrapEffects?: import("@deck/core").SerenaBootstrapEffects;
  #serenaRevalidator?: SerenaReadinessRevalidator;
  #serenaOwnedRoot?: string;
  #writeSerenaMcpConfig: (options: WriteSerenaMcpConfigOptions) => PiMcpConfigWriteResult | Promise<PiMcpConfigWriteResult>;
  #writeNamedMcpConfig: (capabilityId: string, context: RunnerActionContext) => Promise<PiMcpConfigWriteResult> | PiMcpConfigWriteResult;
  #serenaReadinessByOperation = new Map<string, SerenaReadinessEvidence>();

  // -------------------------------------------------------------------------
  // Runtime detection
  // -------------------------------------------------------------------------

  readonly skillDiscovery: SkillDiscoverySourceProviderV1;

  #homeDirectory: string;
  constructor(options: PiRunnerAdapterOptions = {}) {
    this.#homeDirectory = options.homeDirectory ?? process.env.HOME ?? homedir();
    this.skillDiscovery = createPiSkillDiscoveryProvider(options);
    this.#installTools = options.installTools ?? installPiTools;
    this.#serenaBootstrapEffects = options.serenaBootstrapEffects;
    this.#serenaRevalidator = options.serenaRevalidator;
    this.#serenaOwnedRoot = options.serenaOwnedRoot;
    this.#writeSerenaMcpConfig = options.writeSerenaMcpConfig ?? writeSerenaMcpConfig;
    this.#writeNamedMcpConfig = options.writeNamedMcpConfig ?? writeNamedPiMcpConfig;
  }

  async detectRuntimes(input?: RuntimeDetectionInput): Promise<readonly RuntimeStatus[]> {
    const preflight = inspectPiEnvironment({
      command: "pi",
      pathExists: (path) => {
        try {
          const { existsSync } = require("node:fs");
          return existsSync(path);
        } catch {
          return false;
        }
      },
    });

    return [toRuntimeStatus(preflight)];
  }

  // -------------------------------------------------------------------------
  // Capability inventory
  // -------------------------------------------------------------------------

  async getCapabilityInventory(input: CapabilityInventoryInput): Promise<CapabilityInventory> {
    const review = reviewPiRequiredTools({ command: "pi" });
    const runnerScope = input.runnerId as "pi" | "opencode" | "all";

    const fullInventory: PiRunnerFullCapabilityInventory = buildPiRunnerCapabilityInventory(review, undefined, {
      runnerScope,
      includeInternal: false,
    });

    return toCapabilityInventory(fullInventory, input.runnerId, input.environmentId);
  }

  // -------------------------------------------------------------------------
  // Review and installation planning
  // -------------------------------------------------------------------------

  buildReviewPlan(state: DashboardState, inventory: CapabilityInventory): ReviewPlan {
    const runnerScope = state.runnerId as "pi" | "opencode" | "all";

    // Normalize inventory: accept both CapabilityInventory (with .capabilities) 
    // and plain Record<capabilityId, entry> (as stored by the dashboard)
    const capabilities = inventory.capabilities 
      ?? Object.values(inventory as Record<string, { capabilityId?: string; isInstalled?: boolean; requirementLevel?: string; source?: string; diagnostics?: readonly string[] }>);

    // Build a Pi-compatible inventory for buildPiRunnerReviewPlan
    const piInventory: PiRunnerCapabilityInventory = {};
    for (const entry of capabilities) {
      const capId = entry.capabilityId as string;
      piInventory[capId as keyof PiRunnerCapabilityInventory] = {
        capabilityId: capId,
        status: toCapabilityStatus(entry.isInstalled, entry.requirementLevel),
        runnerScope,
        installed: entry.isInstalled,
        source: entry.source,
        diagnostics: entry.diagnostics ?? [],
      } as any;
    }

    const review = reviewPiRequiredTools({ command: "pi" });

    const piPlan: PiRunnerReviewPlan = buildPiRunnerReviewPlan(
      {
        runnerScope,
        selectedCapabilities: state.selectedCapabilities as Record<string, boolean>,
        explicitlySelectedCapabilities: state.explicitlySelectedCapabilities as Record<string, boolean> | undefined,
        operationId: state.operationId,
        currentOperation: state.operationId
          ? {
              runner: "pi",
              operationId: state.operationId,
              explicitlySelected: state.explicitlySelectedCapabilities?.serena === true,
            }
          : undefined,
        adaptiveMemory: state.adaptiveMemory as { provider?: "none" | "engram" | "supermemory"; supermemory?: { configured?: boolean; hasToken?: boolean; userId?: string; teamId?: string; organizationId?: string } },
        teams: {} as Record<string, { selected?: boolean; modelAssignments?: unknown; thinkingAssignments?: unknown }>,
        runtime: { toolsReview: review },
        packageInstructions: {
          [runnerScope]: buildCapabilityInstructionBundle(
            getConfigurablePackageInstructionMetadata(this.packageInstructionIds)
              .filter((entry) => state.packageInstructions[entry.id] === true)
              .map((entry) => entry.id),
          ),
        },
      },
      piInventory as any,
    );

    return toReviewPlan(piPlan);
  }

  buildInstallationPlan(state: DashboardState): InstallationPlan {
    const review = reviewPiRequiredTools({ command: "pi" });
    const requiredTools: RequiredToolStatus[] = review.requiredTools;

    // Collect selected optional tool IDs from state.selectedCapabilities
    const selectedOptionalToolIds: InstallablePiToolId[] = [];
    if (state.selectedCapabilities) {
      for (const [toolId, selected] of Object.entries(state.selectedCapabilities)) {
        if (selected && isOptionalToolId(toolId)) {
          selectedOptionalToolIds.push(toolId as InstallablePiToolId);
        }
      }
    }

    const steps = buildPiInstallationPlan({ requiredTools, selectedOptionalToolIds });

    return {
      steps: steps.map((tool) => ({
        action: "install" as const,
        tool: tool.id,
        reason: `Pi package${tool.required ? " (required)" : " (optional)"}`,
        capabilityId: tool.id,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Action execution
  // -------------------------------------------------------------------------

  async runAction(action: RunnerAction, context: RunnerActionContext): Promise<RunnerActionRunResult> {
    // Handle internal runner package installs
    if (action.internalPackageId) {
      const installResult = await installInternalRunnerPackages(
        context.runnerCommand ?? "pi",
        [toInternalInstallAction(action)],
        () => {},
      );
      const first = installResult[0];
      return {
        actionId: action.id,
        status: first?.success ? "executed" : "failed",
        message: first?.message ?? "",
        diagnostics: first?.success ? [] : [first?.message ?? "Installation failed."],
      };
    }

    // Handle capability/tool installs
    if (action.kind === "install-pi-package" || action.kind === "install") {
      // Look up the complete tool metadata from Pi catalog to preserve installKind
      const toolId = action.toolId as InstallablePiToolId | undefined;
      const catalogTool = toolId ? getPiInstallableTool(toolId) : undefined;

      const installableTool: InstallablePiTool = {
        id: toolId ?? "sub-agents",
        name: action.title,
        source: action.source ?? catalogTool?.source ?? "",
        required: action.required ?? false,
        // Use installKind from catalog, not hardcoded, so non-Serena Pi tools
        // retain their existing dispatch behavior.
        installKind: catalogTool?.installKind ?? "pi-package",
        capabilityId: catalogTool?.capabilityId,
      };

      const isSerena = action.capabilityId === "serena" || toolId === "serena";
      if (isSerena && !isPiSerenaActionAuthorized(action, context)) {
        return blockedSerenaActionResult(action, "Serena setup requires explicit selection in the current Pi operation.");
      }

      const operation = context.currentOperation ?? context.operation;
      const results = await this.#installTools(
        isSerena ? context.runnerCommand : context.runnerCommand ?? "pi",
        [installableTool],
        () => {},
        isSerena
          ? {
              serenaAuthorization: context.serenaAuthorization,
              serenaOperation: operation,
              currentOperation: operation,
              serenaBootstrapEffects: this.#serenaBootstrapEffects,
              serenaSignal: context.signal,
            }
          : undefined,
      );
      const result = results[0];
      if (!result) {
        return {
          actionId: action.id,
          status: "failed",
          message: "Pi installation returned no result.",
          diagnostics: ["Pi installation returned no result."],
        };
      }

      if (isSerena && result.serenaReadiness && operation) {
        this.#serenaReadinessByOperation.set(operation.operationId, result.serenaReadiness);
      }

      // Serena is Core-managed and does not participate in Pi package settings
      // migration. Preserve the existing merge behavior for every other tool.
      const mergeDiagnostics: string[] = [];
      if (!isSerena) {
        const homeDir = process.env.HOME ?? "/home/kevinlb";
        const settingsPath = `${homeDir}/.pi/agent/settings.json`;
        const fs = require("node:fs");

        let currentPackages: string[] = [];
        try {
          if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
            currentPackages = settings.packages || [];
          }
        } catch {
          // Ignore read errors
        }

        const mergeResult = mergeSettingsPackages({
          settingsPath: fs.existsSync(settingsPath) ? settingsPath : undefined,
          existingPackages: currentPackages,
          readFile: (path) => fs.readFileSync(path, "utf-8"),
          writeFile: (path, content) => fs.writeFileSync(path, content),
        });
        mergeDiagnostics.push(...mergeResult.diagnostics);
      }

      const allDiagnostics = [
        ...(["failed", "blocked", "cancelled", "partial"].includes(result.status) ? [result.message ?? "Install failed."] : []),
        ...(result.installKind ? [`[installKind=${result.installKind}]`] : []),
        ...mergeDiagnostics,
      ];

      // Map installPiTools result status to action-runner status
      // Success statuses: installed, reused, manual-verified, manual
      // Failure statuses: failed, blocked
      const statusMap: Record<string, "executed" | "informational" | "failed"> = {
        "installed": "executed",
        "reused": "executed",
        "manual-verified": "informational",
        "manual": "informational",
        "failed": "failed",
        "blocked": "failed",
        "cancelled": "failed",
        "partial": "failed",
      };

      return {
        actionId: action.id,
        status: statusMap[result.status] ?? "failed",
        message: result.message ?? "",
        diagnostics: allDiagnostics,
      };
    }

    // Handle manual external installs
    if (action.kind === "manual-external-install") {
      return {
        actionId: action.id,
        status: "informational",
        message: `Manual installation required: ${action.source ?? action.title}`,
        diagnostics: [`${action.title} requires external/manual installation.`],
      };
    }

    // Handle validation actions
    if (action.kind === "validate") {
      return {
        actionId: action.id,
        status: "executed",
        message: "Validation complete.",
        diagnostics: action.diagnostics ?? [],
      };
    }

    // Deck-config actions are not MCP actions. In particular, they cannot
    // become an incidental Serena configuration path.
    if (action.kind === "write-deck-config") {
      return {
        actionId: action.id,
        status: "informational",
        message: "Deck config write is handled by the dashboard state owner.",
        diagnostics: [],
      };
    }

    if (action.kind === "write-pi-mcp-config") {
      const capabilityId = action.capabilityId;
      if (capabilityId === "serena") {
        if (!isPiSerenaActionAuthorized(action, context)) {
          return blockedSerenaActionResult(action, "Serena MCP configuration requires explicit selection in the current Pi operation.");
        }

        const operation = context.currentOperation ?? context.operation;
        const operationId = operation?.operationId;
        const actionContext = context as RunnerActionContext & PiSerenaActionContextExtensions;
        if (
          actionContext.serenaBootstrapOutcome !== undefined
          && actionContext.serenaBootstrapOutcome !== "reused"
          && actionContext.serenaBootstrapOutcome !== "installed"
        ) {
          return blockedSerenaActionResult(action, "Serena readiness did not complete successfully before MCP configuration.");
        }
        const readiness = context.serenaReadiness
          ?? (operationId ? this.#serenaReadinessByOperation.get(operationId) : undefined);
        const revalidate = actionContext.serenaRevalidator ?? this.#serenaRevalidator;
        if (!readiness || !revalidate || !operation || !context.serenaAuthorization) {
          return blockedSerenaActionResult(action, "Serena readiness evidence is required before MCP configuration.");
        }

        const ownedRoot = actionContext.serenaOwnedRoot
          ?? this.#serenaOwnedRoot
          ?? inferSerenaOwnedRoot(readiness.resolvedExecutablePath);
        if (!ownedRoot) {
          return blockedSerenaActionResult(action, "Serena executable containment could not be established before MCP configuration.");
        }

        let gatedResult: Awaited<ReturnType<typeof runEvidenceGatedSerenaWriter>>;
        try {
          gatedResult = await runEvidenceGatedSerenaWriter(
            {
              authorization: context.serenaAuthorization,
              operation,
              readiness,
              command: readiness.resolvedExecutablePath,
              args: SERENA_MCP_ARGS,
              revalidate,
            },
            async (validatedInput) => {
              const result = await this.#writeSerenaMcpConfig({
                authorization: validatedInput.authorization,
                operation: validatedInput.operation,
                readiness: validatedInput.readiness,
                command: validatedInput.command,
                args: validatedInput.args,
                ownedRoot,
                configPath: actionContext.piMcpConfigPath,
                homeDir: actionContext.homeDirectory,
                fileSystem: actionContext.piMcpFileSystem,
              });
              return result.ok
                ? { ok: true, status: result.action as "created" | "updated" | "unchanged" }
                : {
                    ok: false,
                    code: result.diagnostics[0]?.code ?? "writer-failed",
                    diagnostic: {
                      code: result.diagnostics[0]?.code ?? "writer-failed",
                      message: result.diagnostics[0]?.message ?? "Serena MCP configuration was not changed.",
                    },
                  };
            },
            ownedRoot,
          );
        } catch {
          return blockedSerenaActionResult(action, "Serena MCP configuration was not changed.");
        }

        return {
          actionId: action.id,
          status: gatedResult.ok ? "executed" : "failed",
          message: gatedResult.ok ? `Serena MCP configuration ${gatedResult.status}.` : "Serena MCP configuration was not changed.",
          diagnostics: gatedResult.ok ? [] : ["Serena MCP configuration was not changed."],
        };
      }

      if (!capabilityId) {
        return {
          actionId: action.id,
          status: "failed",
          message: "Named Pi MCP capability is required.",
          diagnostics: ["Named Pi MCP capability is required."],
        };
      }

      const result = await this.#writeNamedMcpConfig(capabilityId, context);
      return {
        actionId: action.id,
        status: result.ok ? "executed" : "failed",
        message: result.ok ? `MCP configuration ${result.action} for ${capabilityId}.` : "MCP configuration was not changed.",
        diagnostics: result.ok ? [] : ["MCP configuration was not changed."],
      };
    }

    // Handle team application
    if (action.kind === "apply-team-bundle") {
      return {
        actionId: action.id,
        status: "executed",
        message: "Developer Team bundle applied.",
        diagnostics: action.unresolvedCapabilities?.length ? [`${action.unresolvedCapabilities.length} capabilities are unresolved.`] : [],
      };
    }

    // Fallback: informational
    return {
      actionId: action.id,
      status: "informational",
      message: action.title,
      diagnostics: [],
    };
  }

  // -------------------------------------------------------------------------
  // Team management
  // -------------------------------------------------------------------------

  getTeams(environmentId: string): readonly TeamEntry[] {
    return getTeamsForEnvironment(environmentId);
  }

  buildLaunchPlan(input: import("@deck/core").RunnerLaunchInput): import("@deck/core").RunnerLaunchResult {
    if (input.mode !== "interactive") return {
      status: "unsupported",
      code: `pi-${input.mode}-unsupported`,
      diagnostics: [{ code: "unsupported-launch-mode", severity: "error", message: "Pi generic compatibility launch currently supports interactive mode only." }],
    };
    const native = buildPiTeamLaunchPlan({ teamId: input.teamId, projectRoot: input.projectRoot });
    return {
      status: "ready",
      plan: {
        command: native.command,
        args: native.args,
        cwd: native.cwd,
        stdio: "inherit",
        stdin: "inherit",
        envOverlay: native.env.PI_SESSION_DIR ? { PI_SESSION_DIR: { value: native.env.PI_SESSION_DIR } } : undefined,
      },
      diagnostics: [],
    };
  }

  // -------------------------------------------------------------------------
  // Model catalog and assignments
  // -------------------------------------------------------------------------

  getModelCatalog(_context?: ModelCatalogContext): ModelCatalog {
    return getCoreModelCatalog();
  }

  readModelAssignments(projectRoot?: string): DeveloperTeamModelAssignments {
    // For Pi, read from the user's installed Pi agents directory (~/.pi/agent/agents)
    // For OpenCode, read from project root (.pi/agents)
    // This ensures model config persists correctly after applyDeveloperTeamInstall writes to ~/.pi/agent/agents
    const homeDir = process.env.HOME ?? "/home/user";
    const piAgentsDir = `${homeDir}/.pi/agent/agents`;
    const modelAssignments = readDeveloperTeamModelAssignments(piAgentsDir, { exists: require("node:fs").existsSync, readFile: require("node:fs").readFileSync, agentsDir: piAgentsDir });
    // If Pi agents dir is empty, fall back to project root (for migration/edge cases)
    if (Object.keys(modelAssignments).length === 0 && projectRoot) {
      return readDeveloperTeamModelAssignments(projectRoot, { agentsDir: undefined });
    }
    return modelAssignments;
  }

  readThinkingAssignments(projectRoot?: string): DeveloperTeamThinkingAssignments {
    // For Pi, read from the user's installed Pi agents directory (~/.pi/agent/agents)
    // For OpenCode, read from project root (.pi/agents)
    // This ensures thinking config persists correctly after applyDeveloperTeamInstall writes to ~/.pi/agent/agents
    const homeDir = process.env.HOME ?? "/home/user";
    const piAgentsDir = `${homeDir}/.pi/agent/agents`;
    const thinkingAssignments = readDeveloperTeamThinkingAssignments(piAgentsDir, { exists: require("node:fs").existsSync, readFile: require("node:fs").readFileSync, agentsDir: piAgentsDir });
    // If Pi agents dir is empty, fall back to project root (for migration/edge cases)
    if (Object.keys(thinkingAssignments).length === 0 && projectRoot) {
      return readDeveloperTeamThinkingAssignments(projectRoot, { agentsDir: undefined });
    }
    return thinkingAssignments;
  }

  getThinkingLevels(_modelId?: string): readonly RunnerThinkingLevel[] {
    return [...PI_THINKING_LEVELS];
  }

  supportsThinking(modelId: string): boolean {
    return supportsThinkingForModel(modelId);
  }

  // -------------------------------------------------------------------------
  // Developer Team installation
  // -------------------------------------------------------------------------

  buildDeveloperTeamInstallPlan(input: DeveloperTeamAdapterInstallInput): RunnerDeveloperTeamInstallPlan {
    const nativePlan = buildPiDeveloperTeamInstallPlan(input.projectRoot, {
      modelAssignments: input.modelAssignments,
      thinkingAssignments: input.thinkingAssignments,
      memoryProvider: input.memoryProvider,
      capabilityInstructions: input.capabilityInstructions,
      standaloneSkills: input.standaloneSkills,
    });
    this.#lastNativePlan = nativePlan;
    const configDir = join(this.#homeDirectory, ".pi", "agent");
    const planned = [
      ...nativePlan.agents.map((file) => ({ path: file.relativePath, absolutePath: join(configDir, "agents", file.relativePath.split("/").pop()!), content: file.content, kind: "agent" as const })),
      ...nativePlan.skills.map((file) => ({ path: file.relativePath, absolutePath: join(configDir, "skills", file.agent.skillId, "SKILL.md"), content: file.content, kind: "skill" as const, skillId: file.agent.skillId, packagePath: "SKILL.md" })),
      ...nativePlan.standaloneSkills.map((file) => ({ path: file.relativePath, absolutePath: join(configDir, "skills", file.skillId, file.packagePath), content: file.content, kind: "standalone-skill" as const, skillId: file.skillId, packagePath: file.packagePath })),
      ...nativePlan.sddSkillFiles.map((file) => ({ path: file.relativePath, absolutePath: join(configDir, "skills", file.skillId, "SKILL.md"), content: file.content, kind: "skill" as const, skillId: file.skillId, packagePath: "SKILL.md" })),
    ];
    const digest = (content: string) => createHash("sha256").update(content).digest("hex");
    return {
      files: planned.map(({ absolutePath: _absolutePath, ...file }) => file),
      mutationPreview: planned.filter((file) => !existsSync(file.absolutePath) || readFileSync(file.absolutePath, "utf8") !== file.content).map((file) => ({
        action: existsSync(file.absolutePath) ? "update" as const : "create" as const,
        path: file.absolutePath,
        preimage: existsSync(file.absolutePath) ? digest(readFileSync(file.absolutePath, "utf8")) : "absent",
        postimage: digest(file.content),
        ownership: "pi-native-plan",
      })),
    };
  }

  async applyDeveloperTeamInstall(input: DeveloperTeamApplyInput): Promise<DeveloperTeamApplyResult> {
    if (!this.#lastNativePlan) throw new Error("No native plan available. Call buildDeveloperTeamInstallPlan first.");
    const piConfigDir = `${this.#homeDirectory}/.pi/agent`;
    const piAgentsDir = `${piConfigDir}/agents`;
    const piSkillsDir = `${piConfigDir}/skills`;
    const plan: PiDeveloperTeamInstallPlan = {
      ...this.#lastNativePlan,
      projectRoot: input.projectRoot,
      agentsDir: piAgentsDir,
      skillsDir: piSkillsDir,
      agents: this.#lastNativePlan.agents.map((file) => ({ ...file, absolutePath: `${piAgentsDir}/${file.relativePath.split("/").pop()}` })),
      skills: this.#lastNativePlan.skills.map((file) => ({ ...file, absolutePath: `${piSkillsDir}/${file.agent.skillId}/SKILL.md` })),
      standaloneSkills: this.#lastNativePlan.standaloneSkills.map((file) => ({ ...file, absolutePath: `${piSkillsDir}/${file.skillId}/${file.packagePath}` })),
      sddSkillFiles: this.#lastNativePlan.sddSkillFiles.map((file) => ({ ...file, absolutePath: `${piSkillsDir}/${file.skillId}/SKILL.md` })),
    };
    const result = applyPiDeveloperTeamInstall(plan);
    this.#lastNativePlan = plan;
    return { results: result.results, changedCount: result.changedCount, unchangedCount: result.unchangedCount };
  }

  // -------------------------------------------------------------------------
  // MCP config (optional)
  // -------------------------------------------------------------------------

  async writeMcpConfig(input: RunnerMcpConfigInput): Promise<RunnerMcpConfigResult> {
    const result = writeSupermemoryPiMcpConfig({
      token: input.token ?? "",
      serverName: input.serverName,
      configPath: undefined,
      homeDir: undefined,
    });

    return {
      ok: result.ok,
      path: result.path,
      diagnostics: result.diagnostics.map((d: { message: string }) => d.message),
    };
  }

  // -------------------------------------------------------------------------
  // Flow routing
  // -------------------------------------------------------------------------

  getNextScreen(state: FlowState): NextScreen {
    // Pi-specific screen flow resolution
    // Maps runner-specific screen states to canonical NextScreen labels
    switch (state.currentScreen) {
      case "environment-selection":
        return "preflight-checking";

      case "preflight-checking": {
        // After preflight, determine next screen based on install progress
        if (state.installProgress && state.installProgress.completed < state.installProgress.total) {
          return "developer-team-installing";
        }
        return "team-selection";
      }

      case "team-selection":
        return "developer-team-review";

      case "developer-team-review":
        return "developer-team-installing";

      case "developer-team-installing": {
        if (state.installProgress && state.installProgress.completed >= state.installProgress.total) {
          return "complete";
        }
        return "developer-team-installing";
      }

      case "personality-selection":
        return "team-selection";

      case "complete":
        return "complete";

      default:
        return "team-selection";
    }
  }

  // -------------------------------------------------------------------------
  // Environment inspection
  // -------------------------------------------------------------------------

  async inspectEnvironment(): Promise<unknown> {
    return inspectPiEnvironment({
      command: "pi",
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
    return reviewPiRequiredTools({ command: "pi" });
  }

  // -------------------------------------------------------------------------
  // Team file backup/restore
  // -------------------------------------------------------------------------

  backupDeveloperTeamFiles(plan: unknown): import("@deck/core").RunnerBackupResult {
    if (!this.#lastNativePlan) throw new Error("No native plan available. Call buildDeveloperTeamInstallPlan first.");
    return { payload: backupDeveloperTeamFiles(this.#lastNativePlan), diagnostics: [] };
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
    if (!this.#lastNativePlan) {
      throw new Error("No native plan available. Call buildDeveloperTeamInstallPlan first.");
    }
    const result = verifyDeveloperTeamInstall(this.#lastNativePlan);
    // Flatten issues from agentResults and skillResults into diagnostics
    const diagnostics = [
      ...result.agentResults.flatMap((r) => r.issues),
      ...result.skillResults.flatMap((r) => r.issues),
    ];
    return { valid: result.valid, diagnostics };
  }

  // -------------------------------------------------------------------------
  // Thinking resolution
  // -------------------------------------------------------------------------

  resolveThinking(modelId: string, existingAssignment?: string): string | undefined {
    return resolveThinkingForModel(modelId, existingAssignment as any) as string | undefined;
  }

  getDefaultThinking(modelId: string): string {
    return getDefaultThinkingForModel(modelId);
  }

  // -------------------------------------------------------------------------
  // Capability catalog access
  // -------------------------------------------------------------------------

  getCapability(capabilityId: string): unknown {
    return getPiRunnerCapability(capabilityId as any);
  }

  getCapabilityIds(): readonly string[] {
    return PI_RUNNER_CAPABILITY_IDS as readonly string[];
  }

  // -------------------------------------------------------------------------
  // Selectable tools
  // -------------------------------------------------------------------------

  getSelectableTools(): unknown[] {
    return getOptionalPiTools();
  }
}

// ---------------------------------------------------------------------------
// Adapter singleton (lazily created)
// ---------------------------------------------------------------------------

let _piRunnerAdapter: RunnerAdapter | undefined;

export function getPiRunnerAdapter(): RunnerAdapter {
  if (!_piRunnerAdapter) {
    _piRunnerAdapter = new PiRunnerAdapterImpl();
  }
  return _piRunnerAdapter;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function blockedSerenaActionResult(action: RunnerAction, message: string): RunnerActionRunResult {
  return {
    actionId: action.id,
    status: "failed",
    message,
    diagnostics: [message],
  };
}

function inferSerenaOwnedRoot(executablePath: string): string | undefined {
  return executablePath.endsWith("/bin/serena")
    ? executablePath.slice(0, -"/bin/serena".length)
    : undefined;
}

async function writeNamedPiMcpConfig(
  capabilityId: string,
  context: RunnerActionContext,
): Promise<PiMcpConfigWriteResult> {
  const actionContext = context as RunnerActionContext & PiSerenaActionContextExtensions;
  const homeDir = actionContext.homeDirectory ?? process.env.HOME ?? "/home/kevinlb";
  const configPath = actionContext.piMcpConfigPath ?? defaultPiMcpConfigPath(homeDir);

  switch (capabilityId) {
    case "context-mode":
      return writeContextModeMcpConfig({ configPath, homeDir });
    case "codebase-memory-mcp":
      return writeCodebaseMemoryMcpConfig({ configPath, homeDir });
    case "context7":
      return writeContext7McpConfig({ configPath, homeDir });
    case "supermemory": {
      const token = context.supermemoryToken ?? process.env.SUPERMEMORY_API_KEY;
      if (!token) {
        return {
          ok: false,
          action: "failed",
          path: configPath,
          serverName: capabilityId,
          diagnostics: [],
        };
      }
      return writeSupermemoryPiMcpConfig({ token, configPath, homeDir });
    }
    default:
      return {
        ok: false,
        action: "failed",
        path: configPath,
        serverName: capabilityId,
        diagnostics: [],
      };
  }
}

function toRuntimeStatus(preflight: PiPreflightResult): RuntimeStatus {
  return {
    runtimeId: "pi",
    displayName: `Pi Runner ${preflight.version}`,
    isAvailable: preflight.existingConfiguration,
    version: preflight.version,
    diagnostics: preflight.existingConfiguration ? [] : ["Pi configuration directory not found."],
  };
}

function toCapabilityInventory(
  inventory: PiRunnerFullCapabilityInventory,
  runnerId: string,
  environmentId: string,
): CapabilityInventory {
  const capabilities: CapabilityCatalogEntry[] = [];

  for (const [capabilityId, entry] of Object.entries(inventory)) {
    if (capabilityId === "_internal" || !entry) continue;

    const typedEntry = entry as { status: string; toolId?: string; source?: string; diagnostics?: string[] };

    capabilities.push({
      capabilityId,
      label: capabilityId,
      description: "",
      section: "runner",
      requirementLevel: typedEntry.status === "ready" ? "optional" : "required",
      toolId: typedEntry.toolId,
      source: typedEntry.source,
      installKind: "pi-package",
      supportStatus: getRunnerCapabilityMapping(capabilityId, runnerId, [PI_RUNNER_CAPABILITY_CONTRIBUTION])?.status,
      isInstalled: typedEntry.status === "ready",
      isBlocked: typedEntry.status === "blocked",
      diagnostics: typedEntry.diagnostics,
    });
  }

  return {
    capabilities,
    runnerId,
    environmentId: environmentId as any,
  };
}

function toCapabilityStatus(isInstalled: boolean, _requirementLevel: string): "ready" | "manual" | "missing" | "blocked" {
  if (isInstalled) return "ready";
  return "missing";
}

function toReviewPlan(piPlan: PiRunnerReviewPlan): ReviewPlan {
  return {
    groups: {
      automaticInstalls: piPlan.groups.automaticInstalls.map(toRunnerAction),
      manualSteps: piPlan.groups.manualSteps.map(toRunnerAction),
      configWrites: piPlan.groups.configWrites.map(toRunnerAction),
      teamApplications: piPlan.groups.teamApplications.map(toRunnerAction),
      validations: piPlan.groups.validations.map(toRunnerAction),
    },
    diagnostics: piPlan.diagnostics.map(toPlanDiagnostic),
    ready: piPlan.ready,
  };
}

function toRunnerAction(piAction: import("./capability-plan").PiRunnerAction): RunnerAction {
  return {
    id: piAction.id,
    kind: piAction.kind as string,
    title: piAction.title,
    description: piAction.description,
    capabilityId: piAction.capabilityId as string | undefined,
    toolId: piAction.toolId as string | undefined,
    internalPackageId: piAction.internalPackageId as string | undefined,
    implementationId: piAction.implementationId as string | undefined,
    source: piAction.source as string | undefined,
    status: piAction.status as RunnerActionStatus,
    required: piAction.required,
    dependencies: piAction.dependencies as readonly string[] | undefined,
    unresolvedCapabilities: piAction.unresolvedCapabilities as readonly string[] | undefined,
    diagnostics: piAction.diagnostics as readonly string[] | undefined,
  };
}

function toPlanDiagnostic(piDiag: import("./capability-plan").PiRunnerPlanDiagnostic): RunnerPlanDiagnostic {
  return {
    code: piDiag.code,
    message: piDiag.message,
    severity: piDiag.severity as "info" | "warning" | "error",
    capabilityId: piDiag.capabilityId as string | undefined,
    actionId: piDiag.actionId as string | undefined,
  };
}

function toInternalInstallAction(action: RunnerAction): InternalRunnerPackageInstallAction {
  return {
    packageId: action.internalPackageId as "pi-mermaid",
    name: action.title,
    source: `npm:${action.internalPackageId}` as `npm:${string}`,
    installKind: "npm-package",
    reason: action.description ?? `Install ${action.internalPackageId}`,
  };
}

function isOptionalToolId(id: string): id is InstallablePiToolId {
  // Only codebase-memory-mcp is available (not codebase-memory) for OpenCode parity
  return ["context-mode", "codebase-memory-mcp", "rtk", "context7", "engram-memory"].includes(id);
}

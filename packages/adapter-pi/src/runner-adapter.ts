import { verifyPiInstallation } from "./installation-trust";
import { withInstallationUse, withInstallationMutation, trackInstallationProcess, InstallationBusyError } from "../../core/src/installation-use";
import { createPiSkillDiscoveryProvider } from "./skill-discovery-provider";
export { createPiSkillDiscoveryProvider } from "./skill-discovery-provider";
import { PrerequisiteEvidence, pinnedHookExecutable } from "../../core/src/session/prerequisite-evidence";
import { createPiSessionDriver } from "./session-driver/driver";
import { preparePiSessionRole } from "./session-driver/native-role";
import { inspectPiNativeSearch } from "./native-search";
import { buildCodebaseGuardEntry, parseCodebaseGuardEntry, type CodebaseGuardInvocation } from "./pi-codebase-guard-command";
import { hashJsonValue, matchesOwnedHash, parsePiManifest } from "./pi-manifest";
import { assertNoContributionSymlink } from "@deck/core";
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
import { planPiProjectSkillExclusions, assertPiProjectSkillExclusionTargets } from "./project-skill-exclusions";
import { piAgentPaths, resolvePiAgentDir, type PiAgentDirResolution } from "./agent-dir";
import { buildPiGlobalMaterialization, type PiGlobalMaterialization } from "./global-materialization";
import { createPiTools } from "./pi-owned-tools";
import { resolveDeckPiMcpServers, selectDeckPiMcpServerIds, type DeckPiMcpToolResolver } from "./pi-deck-mcp";
import { mcpServerForCapability } from "./pi-mcp-catalog";
import {
  applyPiGlobalPlan,
  createNodePiFileIO,
  planPiGlobalInstall,
  readPiManifest,
  readPiMcpServers,
  restorePiSnapshot,
  snapshotPiPlanTargets,
  verifyPiGlobalInstall,
  type PiFileIO,
  type PiGlobalPlan,
  type PiSnapshot,
} from "./pi-global-install";
import { evaluatePiVersion, PI_UPGRADE_HINT, type PiVersionEvaluation } from "./pi-version";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { buildPiRunnerCapabilityInventory, type PiRunnerCapabilityInventory, type PiRunnerFullCapabilityInventory } from "./capability-inventory";
import { buildPiRunnerReviewPlan, type PiRunnerReviewPlan } from "./capability-plan";
import { buildPiInstallationPlan, getPiInstallableTool, type InstallablePiToolId, type InstallablePiTool } from "./installation-plan";
import { installPiTools, installInternalRunnerPackages, type PiOwnedToolInstaller } from "./install-tools";
import { reviewPiRequiredTools, type PiRequiredToolsReview } from "./required-tools";
import {
  inspectPiWebSearchMcpConfig,
  resolvePiWebSearchReadiness,
} from "./web-search";
import { getTeamsForEnvironment } from "./team-catalog";
import { buildPiTeamLaunchPlan } from "./pi-team-launch";
import {
  readDeveloperTeamModelConfigAssignments,
  readDeveloperTeamModelAssignments,
  readDeveloperTeamThinkingAssignments,
  type DeveloperTeamInstallOptions,
} from "./developer-team-install";
import { PI_THINKING_LEVELS, supportsThinkingForModel, getDefaultThinkingForModel, resolveThinkingForModel } from "./model-config";
import { getPiRunnerCapability, getUserFacingCapability, PI_RUNNER_CAPABILITY_CONTRIBUTION, PI_RUNNER_CAPABILITY_IDS, type CapabilityId } from "./capability-catalog";
import { getOptionalPiTools } from "./installation-plan";
import {
  writeSupermemoryPiMcpConfig,
  writeSerenaMcpConfig,
  validateSupermemoryPiMcpConfig,
  type PiMcpConfigFileSystem,
  type PiMcpConfigWriteResult,
  type WriteSerenaMcpConfigOptions,
} from "./pi-mcp-config";
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
  SkillDiscoverySourceProviderV1,
  OpaqueSkillInventoryResultV1,
  SerenaBootstrapAuthorization,
  SerenaOperationIdentity,
  SerenaReadinessEvidence,
  SerenaReadinessRevalidator,
  WebSearchProviderDescriptorV1,
  NormalizedDeckConfig,
} from "@deck/core";
import {
  getModelCatalog as getCoreModelCatalog,
  getCanonicalCapability,
  getRunnerCapabilityMapping,
  PACKAGE_INSTRUCTION_PACKAGE_IDS,
  buildCapabilityInstructionBundle,
  bindAdaptiveMemoryInstructionBundle,
  getEnabledCapabilityInstructionIds,
  getConfigurablePackageInstructionMetadata,
  runEvidenceGatedSerenaWriter,
  createSerenaReadinessRevalidator,
  resolveSerenaOwnedRoot,
  SERENA_MCP_ARGS,
  resolveCanonicalSupermemoryProjectScope,
  validateSerenaOperationAuthorization,
  hasWebSearchProviderCredential,
  isWebSearchProviderDescriptor,
} from "@deck/core";

function requireDeckConfig(config: NormalizedDeckConfig | undefined, context: string): NormalizedDeckConfig {
  if (!config) throw new Error(`Pi ${context} requires caller-resolved global Deck config.`);
  return config;
}

// ---------------------------------------------------------------------------
// Adapter constants
// ---------------------------------------------------------------------------

const PI_RUNNER_ID = "pi";
const PI_DISPLAY_NAME = "Pi Runner";
const PI_ENVIRONMENT_IDS = ["pi-development"] as const;

export type PiRunnerAdapterOptions = {
  /** CLI-owned stable/canary/dev self invocation; evaluated only when a Codebase selection needs materialization. */
  readonly codebaseGuardInvocation?: () => CodebaseGuardInvocation;
  /** Runtime-only home override used by hermetic callers and tests. */
  readonly homeDirectory?: string;
  /** Environment used to resolve PI_CODING_AGENT_DIR (defaults to process.env). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Seam for `pi --version` (defaults to spawning the `pi` command with stdin ignored). */
  readonly piVersionProbe?: () => { exitCode: number; stdout: string; stderr?: string };
  /** Pi command used for the default version probe and the launch plan (default `pi`). */
  readonly piCommand?: string;
  /** File effects for the global install engine (hermetic tests inject failures here). */
  readonly piFileIO?: PiFileIO;
  /** Directory (under the Deck state home) that receives the backup of an opt-in legacy cleanup. */

  /** Deck-owned tool resolution (RTK, Codebase Memory, shared commands). Defaults to the production resolver. */
  readonly piTools?: PiToolResolution;
  /** Shared Web Search credential resolver (composition root); the value only ever reaches the launched process env. */
  readonly webSearchCredential?: () => string | undefined;
  /** Optional runner-exposed inventory supplied by Pi itself. */
  readonly opaqueInventory?: () => Promise<OpaqueSkillInventoryResultV1>;
  /** Deterministic Serena installer projection seam. */
  readonly installTools?: typeof installPiTools;
  /** Hermetic required-tools review seam for inventory consumers. */
  readonly requiredToolsReview?: () => PiRequiredToolsReview;
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
  /** Provider descriptor selected by the CLI composition root. */
  readonly webSearchProvider?: WebSearchProviderDescriptorV1;
  /** Resolve the selected provider without putting provider metadata in Core. */
  readonly webSearchProviderResolver?: (provider: string | undefined) => WebSearchProviderDescriptorV1 | undefined;
};

/** The subset of `PiTools` the adapter consumes (tests inject a fake). */
export type PiToolResolution = DeckPiMcpToolResolver & PiOwnedToolInstaller & { rtk: { command(): string | undefined } };

type PiSerenaActionContextExtensions = {
  readonly serenaRevalidator?: SerenaReadinessRevalidator;
  readonly serenaOwnedRoot?: string;
  readonly serenaBootstrapOutcome?: "reused" | "installed" | "failed" | "cancelled" | "partial";
  readonly piMcpConfigPath?: string;
  readonly homeDirectory?: string;
  readonly piMcpFileSystem?: PiMcpConfigFileSystem;
};

function normalizeRuntimeDirectory(directory: string): string {
  return isAbsolute(directory) ? resolve(directory) : resolve(homedir());
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
  readonly #preparationEvidence = new PrerequisiteEvidence();
  readPreparationGeneration() {
    const root = this.#readAgentDir(), evidence = this.#preparationEvidence;
    const source = evidence.read(join(root, "deck/manifest.json")), parsed = parsePiManifest(source);
    if (!parsed.ok) throw new Error("pi-generation-unverified");
    const files = Object.entries(parsed.manifest.files).filter(([path]) => path.startsWith("deck/package/") && (!path.includes("/skills/") || path.includes("/skills/deck-")));
    if (files.length > 256 || !files.some(([path]) => path === "deck/package/role-policy.json")) throw new Error("pi-generation-unverified");
    const hash = createHash("sha256").update(source);
    for (const [path] of files.sort()) {
      const target = resolve(root, path);
      if (!target.startsWith(resolve(root) + sep)) throw new Error("pi-generation-unverified");
      assertNoContributionSymlink(target);
      // The launch verifier owns content admission. Lifecycle invalidation needs
      // metadata only, including for Pi's large bundled execution assets.
      const stat = statSync(target, { bigint: true });
      if (!stat.isFile()) throw new Error("pi-generation-unverified");
      hash.update(path).update([stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].join(":"));
    }
    return hash.digest("hex");
  }
  readPreparationCapabilities(config: import("@deck/core").NormalizedDeckConfig) {
    const evidence = this.#preparationEvidence, root = this.#readAgentDir();
    let entry: any;
    try { entry = JSON.parse(evidence.read(join(root, "mcp.json"))).mcpServers?.context7; } catch { /* Missing selection is not enablement. */ }
    return {
      rtk: evidence.observe(config.packageInstructions.pi?.rtk === true, () => {
        const source = evidence.read(join(root, "deck/package/extensions/deck-tool-policy/config.json"));
        return [source, evidence.read(join(root, "deck/package/extensions/deck-tool-policy/impl.js")), evidence.executable(JSON.parse(source).rtkBinary)];
      }),
      context7: evidence.observe(!!entry && entry.disabled !== true && entry.enabled !== false, () => [entry.args ?? [], evidence.executable(entry.command, this.#env.PATH)]),
    };
  }

  readonly runnerId: string = PI_RUNNER_ID;
  readonly displayName: string = PI_DISPLAY_NAME;
  readonly environmentIds: readonly string[] = PI_ENVIRONMENT_IDS;
  async inspectNativeSearch(input: import("@deck/core").NativeSearchInspectionInput) { return inspectPiNativeSearch(input, this.#readAgentDir()); }
  readonly packageInstructionIds = PACKAGE_INSTRUCTION_PACKAGE_IDS;
  readonly ui = {
    environmentLabels: { "pi-development": "Pi" },
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
        selectionStatus: "Supermemory selected; the API key stays in Deck's secret store and reaches Pi only through the Deck loopback during Deck-managed sessions.",
      },
    },
  } as const;

  // Store last native plan for backup/restore/verify operations
  #installTools: typeof installPiTools;
  #requiredToolsReview: () => PiRequiredToolsReview;
  #serenaBootstrapEffects?: import("@deck/core").SerenaBootstrapEffects;
  #serenaRevalidator?: SerenaReadinessRevalidator;
  #serenaOwnedRoot?: string;
  #writeSerenaMcpConfig: (options: WriteSerenaMcpConfigOptions) => PiMcpConfigWriteResult | Promise<PiMcpConfigWriteResult>;
  #writeNamedMcpConfig: (capabilityId: string, context: RunnerActionContext) => Promise<PiMcpConfigWriteResult> | PiMcpConfigWriteResult;
  #webSearchProvider?: WebSearchProviderDescriptorV1;
  #webSearchProviderResolver?: PiRunnerAdapterOptions["webSearchProviderResolver"];
  #serenaReadinessByOperation = new Map<string, SerenaReadinessEvidence>();

  // -------------------------------------------------------------------------
  // Runtime detection
  // -------------------------------------------------------------------------

  readonly skillDiscovery: SkillDiscoverySourceProviderV1;

  #homeDirectory: string;
  #env: Readonly<Record<string, string | undefined>>;
  #agentDirResolution: PiAgentDirResolution;
  #piVersionProbe: () => { exitCode: number; stdout: string; stderr?: string };
  #piCommand: string;
  #fileIO: PiFileIO;
  #lastMaterialization: { materialization: PiGlobalMaterialization; enginePlan: PiGlobalPlan } | null = null;
  #piTools?: PiToolResolution;
  #webSearchCredential?: () => string | undefined;
  #codebaseGuardInvocation?: () => CodebaseGuardInvocation;
  constructor(options: PiRunnerAdapterOptions = {}) {
    this.#codebaseGuardInvocation = options.codebaseGuardInvocation;
    this.#homeDirectory = options.homeDirectory ?? process.env.HOME ?? homedir();
    this.#env = options.env ?? process.env;
    this.#agentDirResolution = resolvePiAgentDir(this.#env, this.#homeDirectory);
    this.#piCommand = options.piCommand ?? "pi";
    this.#piVersionProbe = options.piVersionProbe ?? (() => runPiVersionProbe(this.#piCommand));
    this.#fileIO = options.piFileIO ?? createNodePiFileIO();
    this.#piTools = options.piTools;
    this.#webSearchCredential = options.webSearchCredential;
    this.skillDiscovery = createPiSkillDiscoveryProvider(options);
    this.#installTools = options.installTools ?? installPiTools;
    this.#requiredToolsReview = options.requiredToolsReview ?? (() => reviewPiRequiredTools({ command: this.#piCommand, piTools: this.#tools() }));
    this.#serenaBootstrapEffects = options.serenaBootstrapEffects;
    this.#serenaRevalidator = options.serenaRevalidator;
    this.#serenaOwnedRoot = options.serenaOwnedRoot;
    this.#writeSerenaMcpConfig = options.writeSerenaMcpConfig ?? writeSerenaMcpConfig;
    this.#writeNamedMcpConfig = options.writeNamedMcpConfig ?? ((capabilityId, context) => this.#checkNamedMcpReadiness(capabilityId, context));
    this.#webSearchProvider = options.webSearchProvider;
    this.#webSearchProviderResolver = options.webSearchProviderResolver;
  }

  getSessionDriver() { return createPiSessionDriver({ command: this.#piCommand, baseEnv: this.#env }); }
  async prepareSessionNativeRole(roleId: string, config?: NormalizedDeckConfig) {
    const findings: import("@deck/core/session/driver").RunnerPreparationFinding[] = [];
    if (config) {
      const root = this.#readAgentDir();
      const plan = this.buildDeveloperTeamInstallPlan({projectRoot: root, environmentId: "pi-development", deckConfig: config});
      findings.push(...(plan.diagnosticEntries ?? []).filter(d => d.severity === "warning").map(d => ({kind: "W" as const, code:d.code, item:root, message:d.message})));
      try {
        const result = await this.applyDeveloperTeamInstall({projectRoot:root,environmentId:"pi-development",plan});
        if(result.changedCount) findings.push({kind:"H",code:"pi-content-refreshed",item:root,message:"Refreshed owned Pi content."});
      } catch(error) {
        if(!(error instanceof InstallationBusyError))throw error;
        findings.push({kind:"W",code:"pi-refresh-deferred",item:root,message:error.message});
      }
    }
    return {...preparePiSessionRole(this.#readAgentDir(), roleId), preparation:findings};
  }
  withNativeInstallationUse<T>(effect: () => Promise<T>): Promise<T> { return withInstallationUse(this.#readAgentDir(), effect); }
  trackNativeInstallationProcess(pid: number) { return trackInstallationProcess(this.#readAgentDir(), pid); }

  async #ensureSerenaRuntime(explicitRoot: string | undefined, signal?: AbortSignal): Promise<void> {
    let root = explicitRoot ?? this.#serenaOwnedRoot;
    if (!root) {
      try {
        root = await resolveSerenaOwnedRoot(this.#serenaBootstrapEffects, signal ?? new AbortController().signal);
      } catch {
        root = undefined;
      }
      if (!root) return;
      this.#serenaOwnedRoot = root;
    }
    this.#serenaRevalidator ??= createSerenaReadinessRevalidator(root, this.#serenaBootstrapEffects);
  }

  private resolveWebSearchProvider(provider: string | undefined): WebSearchProviderDescriptorV1 | undefined {
    const selected = provider?.trim();
    if (!selected) return undefined;
    if (this.#webSearchProvider?.providerId === selected) return this.#webSearchProvider;
    return this.#webSearchProviderResolver?.(selected);
  }

  /** The resolved Pi agent dir for read-only consumers (falls back to the default location when the override is invalid). */
  #readAgentDir(): string {
    return this.#agentDirResolution.ok ? this.#agentDirResolution.dir : join(this.#homeDirectory, ".pi", "agent");
  }

  /**
   * `write-pi-mcp-config` for Pi no longer writes `mcp.json` on its own: every Deck server is materialized
   * atomically with the Deck package (one manifest-owned transaction). This action verifies that the server
   * can actually be configured so the review plan reports failures early.
   */
  async #checkNamedMcpReadiness(capabilityId: string, context: RunnerActionContext): Promise<PiMcpConfigWriteResult> {
    const configPath = (context as RunnerActionContext & PiSerenaActionContextExtensions).piMcpConfigPath ?? piAgentPaths(this.#readAgentDir()).mcp;
    const server = mcpServerForCapability(capabilityId);
    const fail = (message: string): PiMcpConfigWriteResult => ({
      ok: false,
      action: "failed",
      path: configPath,
      serverName: server ?? capabilityId,
      diagnostics: [{ code: "PI_MCP_PROVIDER_UNAVAILABLE", severity: "error", message, path: configPath, serverName: server ?? capabilityId }],
    });
    const ok = (): PiMcpConfigWriteResult => ({
      ok: true,
      action: "unchanged",
      path: configPath,
      serverName: server ?? capabilityId,
      diagnostics: [{ code: "PI_MCP_CONFIG_UNCHANGED", severity: "info", message: `${server ?? capabilityId} MCP server is ready; it is ${PI_MCP_DEFERRED_MARK}.`, path: configPath, serverName: server ?? capabilityId }],
    });
    if (!server) return { ok: false, action: "failed", path: configPath, serverName: capabilityId, diagnostics: [] };
    if (capabilityId === "supermemory") return { ok: false, action: "failed", path: configPath, serverName: capabilityId, diagnostics: [] };
    let resolved: ReturnType<typeof resolveDeckPiMcpServers>;
    try {
      resolved = resolveDeckPiMcpServers({
        selected: [server],
        tools: this.#tools(),
        existingServers: readPiMcpServers(this.#fileIO, this.#readAgentDir()),
        ownedServerNames: Object.keys(readPiManifest(this.#fileIO, this.#readAgentDir())?.mcp.servers ?? {}),
        webSearchProvider: context.webSearchProvider ?? this.#webSearchProvider,
      });
    } catch (error) {
      return fail(`Unable to resolve the ${server} MCP server: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (Object.keys(resolved.servers).length === 0) return fail(resolved.diagnostics[0]?.message ?? `The ${server} MCP server cannot be configured.`);
    if (server === "web-search") {
      const provider = context.webSearchProvider ?? this.#webSearchProvider;
      if (!isWebSearchProviderDescriptor(provider)) return fail("Web Search provider selection is unavailable.");
      const credential = (() => { try { return (this.#webSearchCredential?.() ?? this.#env[provider.credentialEnvVar])?.trim(); } catch { return undefined; } })();
      if (!credential) return fail(`${provider.credentialEnvVar} is not available; Web Search cannot start. No credential was persisted.`);
    }
    return ok();
  }

  #tools(): PiToolResolution {
    this.#piTools ??= createPiTools({ homeDir: this.#homeDirectory, env: this.#env });
    return this.#piTools;
  }

  #agentDirDiagnostic(): string | undefined {
    return this.#agentDirResolution.ok ? undefined : this.#agentDirResolution.message;
  }

  #evaluatePiVersion(): PiVersionEvaluation {
    let output: string | undefined;
    try {
      const result = this.#piVersionProbe();
      const text = result.stdout.trim() || result.stderr?.trim() || "";
      output = result.exitCode === 0 && text ? text : undefined;
    } catch {
      output = undefined;
    }
    return evaluatePiVersion(output);
  }

  async detectRuntimes(input?: RuntimeDetectionInput): Promise<readonly RuntimeStatus[]> {
    const preflight = inspectPiEnvironment({
      command: this.#piCommand,
      homeDirectory: this.#homeDirectory,
      env: this.#env,
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
    const review = this.#requiredToolsReview();
    const runnerScope = input.runnerId as "pi" | "opencode" | "all";
    const deckConfig = requireDeckConfig(input.deckConfig, "capability inventory");
    const webSearchProvider = this.resolveWebSearchProvider(deckConfig.webSearch.provider);
    const webSearchMcp = inspectPiWebSearchMcpConfig(piAgentPaths(this.#readAgentDir()).mcp, webSearchProvider);
    const webSearchEvidence = {
      enabled: deckConfig.webSearch.enabled,
      runnerSupported: true,
      providerConfigured: isWebSearchProviderDescriptor(webSearchProvider),
      credentialAvailable: hasWebSearchProviderCredential(webSearchProvider, process.env),
      executableAvailable: webSearchProvider ? commandAvailable(webSearchProvider.command[0]!) : false,
      mcpConfigured: webSearchMcp.configured,
      mcpConfigConflict: webSearchMcp.conflict,
    } as const;

    const fullInventory: PiRunnerFullCapabilityInventory = buildPiRunnerCapabilityInventory(review, undefined, {
      runnerScope,
      includeInternal: false,
      webSearch: {
        readiness: resolvePiWebSearchReadiness({
          enabled: deckConfig.webSearch.enabled,
          provider: webSearchProvider,
          credentialEnvironment: process.env,
          executableAvailable: webSearchEvidence.executableAvailable,
          mcpConfigured: webSearchEvidence.mcpConfigured,
          mcpConfigConflict: webSearchEvidence.mcpConfigConflict,
        }).readiness,
        evidence: webSearchEvidence,
        provider: webSearchProvider,
      },
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
      ?? Object.values(inventory as Record<string, { capabilityId?: string; isInstalled?: boolean; requirementLevel?: string; source?: string; diagnostics?: readonly string[]; webSearchProvider?: WebSearchProviderDescriptorV1 }>);

    // Build a Pi-compatible inventory for buildPiRunnerReviewPlan
    const piInventory: PiRunnerCapabilityInventory = {};
    for (const entry of capabilities) {
      const capId = entry.capabilityId as string;
      piInventory[capId as keyof PiRunnerCapabilityInventory] = {
        capabilityId: capId,
        status: entry.webSearchReadiness?.state ?? toCapabilityStatus(entry.isInstalled, entry.requirementLevel),
        runnerScope,
        installed: entry.isInstalled,
        source: entry.source,
        diagnostics: entry.diagnostics ?? [],
        webSearchReadiness: entry.webSearchReadiness,
        webSearchEvidence: entry.webSearchEvidence,
        webSearchProvider: entry.webSearchProvider,
      } as any;
    }

    const review = this.#requiredToolsReview();

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
        adaptiveMemory: state.adaptiveMemory as { provider?: "none" | "supermemory"; supermemory?: { configured?: boolean; hasToken?: boolean; runtimeCredentialStored?: boolean; ephemeralTokenAvailable?: boolean; mcpOAuthReady?: boolean; userId?: string; teamId?: string; organizationId?: string } },
        teams: {} as Record<string, { selected?: boolean; modelAssignments?: unknown; thinkingAssignments?: unknown }>,
        runtime: { toolsReview: review },
        packageInstructions: {
          [runnerScope]: buildCapabilityInstructionBundle(
            getConfigurablePackageInstructionMetadata(this.packageInstructionIds)
              .filter((entry) => state.packageInstructions[entry.id] === true)
              .map((entry) => entry.id),
          ),
        },
        webSearchProvider: capabilities.find((entry) => entry.capabilityId === "web-search")?.webSearchProvider
          ?? state.webSearchProviderDescriptor,
      },
      piInventory as any,
    );

    return toReviewPlan(piPlan);
  }

  buildInstallationPlan(state: DashboardState): InstallationPlan {
    const review = this.#requiredToolsReview();
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
      steps: [
        ...steps.map((tool) => ({
          action: "install" as const,
          tool: tool.id,
          reason: `Pi package${tool.required ? " (required)" : " (optional)"}`,
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
    if ([action.capabilityId, action.toolId].some(id => id === "serena" || id === "context-mode")) return { actionId: action.id, status: "skipped", message: "Retired capability is disabled; no action performed.", diagnostics: [] };
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
        id: toolId ?? "context-mode",
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
          : { piTools: this.#tools() },
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

      // Pi package settings are owned exclusively by the Deck manifest transaction (global install plan).
      const mergeDiagnostics: string[] = [];

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
        // Mirror OpenCode: compose the Deck-owned root and the revalidator lazily
        // when production options do not inject them. Evidence is still required.
        if (!actionContext.serenaRevalidator && !this.#serenaRevalidator) {
          await this.#ensureSerenaRuntime(actionContext.serenaOwnedRoot, context.signal);
        }
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
                configPath: actionContext.piMcpConfigPath ?? piAgentPaths(this.#readAgentDir()).mcp,
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
      const deferred = result.ok ? result.diagnostics.find((diagnostic) => diagnostic.message.includes(PI_MCP_DEFERRED_MARK)) : undefined;
      const failure = result.ok ? undefined : result.diagnostics.find((diagnostic) => diagnostic.severity === "error")?.message;
      return {
        actionId: action.id,
        status: result.ok ? "executed" : "failed",
        message: result.ok ? (deferred?.message ?? `MCP configuration ${result.action} for ${capabilityId}.`) : (failure ?? "MCP configuration was not changed."),
        diagnostics: result.ok ? [] : [failure ?? "MCP configuration was not changed."],
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
    if (!this.#agentDirResolution.ok) {
      return { status: "blocked", code: "pi-agent-dir-invalid", diagnostics: [{ code: "pi-agent-dir-invalid", severity: "error", message: this.#agentDirResolution.message }] };
    }
    const version = this.#evaluatePiVersion();
    if (!version.supported && version.reason !== "unavailable") {
      return { status: "blocked", code: "pi-version-unsupported", diagnostics: [{ code: "pi-version-unsupported", severity: "error", message: version.diagnostic ?? PI_UPGRADE_HINT }] };
    }
    const nativeHints = input.runnerNative ?? {};
    const native = buildPiTeamLaunchPlan({
      teamId: input.teamId,
      projectRoot: input.projectRoot,
      agentDir: this.#agentDirResolution.dir,
      flags: {
        ...(nativeHints.continue === true ? { continue: true } : {}),
        ...(nativeHints.resume === true ? { resume: true } : {}),
      },
      piCommand: typeof nativeHints.piCommand === "string" && nativeHints.piCommand.trim() ? nativeHints.piCommand : this.#piCommand,
    });
    const overlay: Record<string, { value: string; sensitive?: boolean }> = {
      DECK_PI_SESSION: { value: "1" },
      DECK_PI_ROLE: { value: "lead" },
      // With memory off the Deck memory extension stays silent instead of reporting "unavailable" on every launch.
      ...(input.deckConfig.adaptiveMemory.enabled === true && input.deckConfig.adaptiveMemory.activeProvider === "supermemory" ? {} : { DECK_PI_MEMORY: { value: "disabled" } }),
      // A non-default agent directory must reach Pi itself, not only the Deck process.
      PI_CODING_AGENT_DIR: { value: this.#agentDirResolution.dir },
    };
    const diagnostics: { code: string; severity: "info" | "warning" | "error"; message: string }[] = version.diagnostic
      ? [{ code: "pi-version-unavailable", severity: "warning", message: version.diagnostic }]
      : [];
    if (!this.#tools().codebase.command()) diagnostics.push({ code: "codebase-memory-unavailable", severity: "warning", message: "Codebase Memory is unavailable for this execution. Use file listing, rg searches, and focused file reads. Review & Install can restore the reviewed executable; preparation never downloads it." });
    const sensitiveKeys: string[] = [];
    const webSearch = this.#webSearchLaunchCredential(input);
    if (webSearch.kind === "ready") {
      overlay[webSearch.envVar] = { value: webSearch.value, sensitive: true };
      sensitiveKeys.push(webSearch.envVar);
    } else if (webSearch.kind === "missing-credential") {
      diagnostics.push({ code: "pi-web-search-credential-missing", severity: "warning", message: "Web search is unavailable for this session: the shared Tavily credential was not found. Deck did not write a credential anywhere." });
    }
    return {
      status: "ready",
      plan: {
        command: native.command,
        args: native.args,
        cwd: native.cwd,
        stdio: "inherit",
        stdin: "inherit",
        executionClass: "static-compatible",
        launchLifecycle: { beforeSpawn: () => verifyPiInstallation(this.#readAgentDir()), afterExit: () => {} },
        envOverlay: overlay,
        ...(sensitiveKeys.length > 0 ? { sensitiveEnvAuthorization: { binding: PI_WEB_SEARCH_BINDING, keys: sensitiveKeys } } : {}),
      },
      diagnostics,
    };
  }

  // -------------------------------------------------------------------------
  // Model catalog and assignments
  // -------------------------------------------------------------------------

  getModelCatalog(_context?: ModelCatalogContext): ModelCatalog {
    return getCoreModelCatalog();
  }

  /**
   * Hands the shared Web Search credential to the launched Pi process only: Web Search is enabled, its Deck MCP
   * entry is configured, and a credential resolves. The value never reaches `mcp.json`, settings or agent files
   * (MCP stdio servers inherit the Pi environment, so the Tavily server receives it from there).
   */
  #webSearchLaunchCredential(input: import("@deck/core").RunnerLaunchInput):
    | { kind: "disabled" }
    | { kind: "missing-credential" }
    | { kind: "ready"; envVar: string; value: string } {
    const deckConfig = input.deckConfig;
    if (!deckConfig || deckConfig.webSearch?.enabled !== true) return { kind: "disabled" };
    const provider = this.resolveWebSearchProvider(deckConfig.webSearch.provider);
    if (!isWebSearchProviderDescriptor(provider)) return { kind: "disabled" };
    const agentDir = this.#readAgentDir();
    if (!(provider.semanticServerId in readPiMcpServers(this.#fileIO, agentDir))) return { kind: "disabled" };
    let token: string | undefined;
    try { token = (this.#webSearchCredential?.() ?? this.#env[provider.credentialEnvVar])?.trim(); } catch { token = undefined; }
    if (!token || /[\0\r\n]/.test(token)) return { kind: "missing-credential" };
    return { kind: "ready", envVar: provider.credentialEnvVar, value: token };
  }

  readModelAssignments(projectRoot?: string): DeveloperTeamModelAssignments {
    for (const agentsDir of this.#assignmentSources(projectRoot)) {
      const assignments = readDeveloperTeamModelAssignments(agentsDir, { exists: existsSync, readFile: readFileSync, agentsDir });
      if (Object.keys(assignments).length > 0) return assignments;
    }
    return {};
  }

  readThinkingAssignments(projectRoot?: string): DeveloperTeamThinkingAssignments {
    for (const agentsDir of this.#assignmentSources(projectRoot)) {
      const assignments = readDeveloperTeamThinkingAssignments(agentsDir, { exists: existsSync, readFile: readFileSync, agentsDir });
      if (Object.keys(assignments).length > 0) return assignments;
    }
    return {};
  }

  /**
   * Where persisted model/thinking assignments live, in precedence order: the Deck package agents (current),
   * then the pre-package global `<agent dir>/agents` and project `.pi/agents` locations so assignments survive
   * the upgrade to the global package layout.
   */
  #assignmentSources(projectRoot?: string): string[] {
    const agentDir = this.#readAgentDir();
    return [
      join(piAgentPaths(agentDir).packageRoot, "agents"),
      join(agentDir, "agents"),
      ...(projectRoot ? [join(projectRoot, ".pi", "agents")] : []),
    ];
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

  /** Owned RTK path, or null when the tool root is unavailable (a missing home must not break planning). */
  #ownedRtkCommand(): string | null {
    try {
      return this.#tools().rtk.command() ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Role model/thinking assignments exist only as frontmatter in the installed agent files, so a re-render of the
   * package must carry them over. Precedence (lowest first): project `.pi/agents`, pre-package `<agent dir>/agents`,
   * the installed package agents, then explicit assignments from the caller (per agent).
   */
  #mergeInstalledAssignments(input: DeveloperTeamAdapterInstallInput, agentDir: string): { modelAssignments: DeveloperTeamModelAssignments; thinkingAssignments: DeveloperTeamThinkingAssignments } {
    const modelAssignments: DeveloperTeamModelAssignments = {};
    const thinkingAssignments: DeveloperTeamThinkingAssignments = {};
    const sources = [
      join(input.projectRoot, ".pi", "agents"),
      join(agentDir, "agents"),
      join(piAgentPaths(agentDir).packageRoot, "agents"),
    ];
    for (const agentsDir of sources) {
      try {
        const read = readDeveloperTeamModelConfigAssignments(input.projectRoot, { agentsDir, exists: existsSync, readFile: readFileSync });
        Object.assign(modelAssignments, read.modelAssignments);
        Object.assign(thinkingAssignments, read.thinkingAssignments);
      } catch { /* an unreadable legacy source never blocks the install */ }
    }
    return {
      modelAssignments: { ...modelAssignments, ...(input.modelAssignments ?? {}) },
      thinkingAssignments: { ...thinkingAssignments, ...(input.thinkingAssignments ?? {}) },
    };
  }

  /** Capability instructions and install options shared by the plan and the legacy template check. */
  #resolveInstallOptions(input: DeveloperTeamAdapterInstallInput, agentDir: string): { capabilityInstructions: ReturnType<typeof bindAdaptiveMemoryInstructionBundle>; installOptions: DeveloperTeamInstallOptions } {
    const derivedSupermemoryProjectScope = (() => {
      const resolved = resolveCanonicalSupermemoryProjectScope({ projectRoot: input.projectRoot, remotes: [] });
      return resolved.ok ? resolved.scope : undefined;
    })();
    const configuredSupermemoryProjectScope = (() => {
      const validation = validateSupermemoryPiMcpConfig({
        configPath: piAgentPaths(agentDir).mcp,
        homeDir: this.#homeDirectory,
      });
      return validation.ok ? validation.projectScope : undefined;
    })();
    const capabilityInstructions = bindAdaptiveMemoryInstructionBundle(input.capabilityInstructions ?? (() => {
      try {
        return buildCapabilityInstructionBundle(getEnabledCapabilityInstructionIds(requireDeckConfig(input.deckConfig, "developer team install"), "pi"), {
          supermemoryProjectScope: derivedSupermemoryProjectScope,
          configuredSupermemoryProjectScope,
        });
      } catch {
        return undefined;
      }
    })(), {
      supermemoryProjectScope: derivedSupermemoryProjectScope,
      configuredSupermemoryProjectScope,
    });

    const preserved = this.#mergeInstalledAssignments(input, agentDir);
    return {
      capabilityInstructions,
      installOptions: {
        modelAssignments: preserved.modelAssignments,
        thinkingAssignments: preserved.thinkingAssignments,
        memoryProvider: input.memoryProvider,
        capabilityInstructions,
        orchestratorPersonality: requireDeckConfig(input.deckConfig, "developer team install").orchestratorPersonality,
        standaloneSkills: input.standaloneSkills,
        piMcpConfigPath: piAgentPaths(agentDir).mcp,
        piMcpHomeDir: this.#homeDirectory,
      },
    };
  }

  async detectDeckInstall() {
    const root = this.#readAgentDir();
    try {
      assertNoContributionSymlink(piAgentPaths(root).manifest);
      const manifest = readPiManifest(this.#fileIO, root);
      if (!manifest) return {installed:false,managedPaths:[]};
      const managedPaths = Object.entries(manifest.files).flatMap(([path,hash])=>{
        if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) return [];
        const absolute = join(root,path); assertNoContributionSymlink(absolute);
        const text = this.#fileIO.readText(absolute);
        return text !== undefined && matchesOwnedHash(path,hash,text) ? [absolute] : [];
      });
      return {installed:managedPaths.length > 0,managedPaths,diagnostics:managedPaths.length ? [] : ['Pi manifest has no unchanged owned artifacts; review installation conflicts.']};
    } catch {return {installed:false,managedPaths:[],diagnostics:['Pi installation ownership could not be established; nothing was adopted.']};}
  }

  buildDeveloperTeamInstallPlan(input: DeveloperTeamAdapterInstallInput): RunnerDeveloperTeamInstallPlan {
    // Blocking prerequisites: a valid agent dir and a supported Pi. Nothing is planned (or written) otherwise.
    const diagnosticEntries: { code: string; severity: "info" | "warning" | "error"; message: string }[] = [];
    if (!this.#agentDirResolution.ok) {
      this.#lastMaterialization = null;
      diagnosticEntries.push({ code: "PI_AGENT_DIR_INVALID", severity: "error", message: this.#agentDirResolution.message });
      return { files: [], mutationPreview: [], blocked: true, diagnostics: diagnosticEntries.map((entry) => entry.message), diagnosticEntries };
    }
    const agentDir = this.#agentDirResolution.dir;
    const version = this.#evaluatePiVersion();
    if (!version.supported && version.diagnostic) {
      diagnosticEntries.push({ code: `PI_VERSION_${(version.reason ?? "unsupported").toUpperCase().replace(/-/g, "_")}`, severity: version.reason === "unavailable" ? "warning" : "error", message: version.diagnostic });
    }
    if(version.supported && version.diagnostic) diagnosticEntries.push({code:"PI_VERSION_UNTESTED",severity:"warning",message:version.diagnostic});
    const versionBlocked = !version.supported && version.reason !== "unavailable";

    const { capabilityInstructions, installOptions } = this.#resolveInstallOptions(input, agentDir);

    const deckConfig = requireDeckConfig(input.deckConfig, "developer team install");
    const ownedMcp = Object.keys(readPiManifest(this.#fileIO, agentDir)?.mcp.servers ?? {});
    let mcpServers: Record<string, Record<string, unknown>> = {};
    let availableMcpServers: Record<string, Record<string, unknown>> = {};
    {
      const resolved = resolveDeckPiMcpServers({
        selected: selectDeckPiMcpServerIds({
          capabilityIds: input.capabilityIds?.filter(id => id !== "web-search" || inspectPiNativeSearch({ projectRoot: input.projectRoot }, agentDir).availability !== "available"),
          instructionPackageIds: capabilityInstructions?.instructions.map((fragment) => fragment.packageId) ?? [],
          webSearchEnabled: deckConfig.webSearch.enabled === true,
          ownedServers: ownedMcp,
        }),
        tools: this.#tools(),
        existingServers: readPiMcpServers(this.#fileIO, agentDir),
        ownedServerNames: ownedMcp,
        webSearchProvider: this.resolveWebSearchProvider(deckConfig.webSearch.provider),
      });
      availableMcpServers = resolved.servers;
      mcpServers = { ...resolved.servers };
      const existingCodebase = readPiMcpServers(this.#fileIO, agentDir)["codebase-memory"];
      if (!mcpServers["codebase-memory"] && existingCodebase && getEnabledCapabilityInstructionIds(deckConfig, "pi").includes("codebase-memory") &&
          hashJsonValue(existingCodebase) === readPiManifest(this.#fileIO, agentDir)?.mcp.servers["codebase-memory"]) mcpServers["codebase-memory"] = existingCodebase as Record<string, unknown>;
      if (this.#codebaseGuardInvocation && mcpServers["codebase-memory"]) {
        const current = mcpServers["codebase-memory"]!;
        const binary = parseCodebaseGuardEntry(current, agentDir)?.binary ?? current.command;
        if (typeof binary !== "string") throw new Error("pi-codebase-guard-invalid");
        const guarded = buildCodebaseGuardEntry(this.#codebaseGuardInvocation(), agentDir, binary);
        mcpServers["codebase-memory"] = guarded;
        if (availableMcpServers["codebase-memory"]) availableMcpServers = { ...availableMcpServers, "codebase-memory": guarded };
      }
      for (const diagnostic of resolved.diagnostics) diagnosticEntries.push(diagnostic);
    }

    const materialization = buildPiGlobalMaterialization({
      agentDir,
      projectRoot: input.projectRoot,
      mcpServers,
      availableMcpServers,
      legacyDeckEvidence: hasLegacyDeckInstallEvidence(this.#fileIO, agentDir),
      // RTK rewrite is pinned to the Deck-owned binary: an explicit selection must include RTK; a launch-time plan
      // (no explicit selection) keeps using the owned binary when it is usable.
      rtkBinary: input.capabilityIds === undefined || input.capabilityIds.includes("rtk") ? this.#ownedRtkCommand() : null,
      installOptions,
    });
    const enginePlan = planPiGlobalInstall(materialization.desired, this.#fileIO);
    try { planPiProjectSkillExclusions(enginePlan, input.projectRoot, materialization.desired.files, this.#fileIO); }
    catch {
      enginePlan.blocked = true;
      enginePlan.diagnostics.push({ code: "PI_PROJECT_SKILL_SETTINGS_INVALID", severity: "error", message: "Pi project skill exclusions could not be planned safely; repair malformed or symlinked project settings before installation." });
    }
    this.#lastMaterialization = { materialization, enginePlan };

    for (const diagnostic of enginePlan.diagnostics) diagnosticEntries.push({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message });
    for (const kept of enginePlan.kept) diagnosticEntries.push({ code: "PI_FILE_KEPT", severity: "info", message: `${kept.relPath} ${kept.reason}.` });
    const standalone = new Set(materialization.nativePlan.standaloneSkills.map((file) => file.skillId));
    const files = materialization.desired.files.map((file) => {
      const absolute = join(agentDir, ...file.relPath.split("/"));
      const skill = /^deck\/package\/skills\/([^/]+)\/(.+)$/.exec(file.relPath);
      const kind = file.relPath.startsWith("deck/package/agents/") ? "agent" as const
        : skill ? (standalone.has(skill[1]!) ? "standalone-skill" as const : "skill" as const)
        : "other" as const;
      return { path: absolute, content: file.content, kind, ...(skill ? { skillId: skill[1]!, packagePath: skill[2]! } : {}) };
    });
    return {
      files,
      automaticRefresh: true,
      mutationPreview: versionBlocked ? [] : enginePlan.mutationPreview.map((mutation) => ({ ...mutation })),
      blocked: enginePlan.blocked || versionBlocked,
      diagnostics: diagnosticEntries.map((entry) => entry.message),
      diagnosticEntries,
    };
  }

  async applyDeveloperTeamInstall(input: DeveloperTeamApplyInput): Promise<DeveloperTeamApplyResult> {
    if (!this.#agentDirResolution.ok) throw new Error(this.#agentDirResolution.message);
    if (!this.#lastMaterialization) throw new Error("No native plan available. Call buildDeveloperTeamInstallPlan first.");
    if (input.plan?.blocked) throw new Error(`Pi global install is blocked: ${(input.plan.diagnostics ?? []).join("; ") || "unresolved prerequisites"}`);
    const { materialization, enginePlan } = this.#lastMaterialization;
    assertPiProjectSkillExclusionTargets(enginePlan);
    const applied = enginePlan.writes.length === 0 && enginePlan.deletes.length === 0
      ? applyPiGlobalPlan(enginePlan, this.#fileIO)
      : await withInstallationMutation(this.#readAgentDir(), async () => applyPiGlobalPlan(enginePlan, this.#fileIO));
    const changed = new Set(applied.changes.map((change) => change.relPath));
    const results = materialization.desired.files.map((file) => ({
      agentId: file.relPath,
      kind: file.relPath.startsWith("deck/package/agents/") ? "agent" : file.relPath.includes("/skills/") ? "skill" : "other",
      status: (changed.has(file.relPath) ? (enginePlan.changes.find((change) => change.relPath === file.relPath)?.action === "create" ? "created" : "updated") : "unchanged") as "created" | "updated" | "unchanged",
    }));
    return {
      results,
      contributionManifestPath: join(this.#readAgentDir(), "deck", "manifest.json"),
      changedCount: applied.changedCount,
      unchangedCount: results.filter((result) => result.status === "unchanged").length,
    };
  }

  // -------------------------------------------------------------------------
  // MCP config (optional)
  // -------------------------------------------------------------------------

  async writeMcpConfig(input: RunnerMcpConfigInput): Promise<RunnerMcpConfigResult> {
    const result = writeSupermemoryPiMcpConfig({
      serverName: input.serverName,
      configPath: join(this.#readAgentDir(), "mcp.json"),
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
      command: this.#piCommand,
      homeDirectory: this.#homeDirectory,
      env: this.#env,
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
    return this.#requiredToolsReview();
  }

  // -------------------------------------------------------------------------
  // Team file backup/restore
  // -------------------------------------------------------------------------

  backupDeveloperTeamFiles(plan: unknown): import("@deck/core").RunnerBackupResult {
    if (!this.#lastMaterialization) throw new Error("No native plan available. Call buildDeveloperTeamInstallPlan first.");
    return { payload: { kind: PI_GLOBAL_SNAPSHOT_KIND, snapshot: snapshotPiPlanTargets(this.#lastMaterialization.enginePlan, this.#fileIO) }, diagnostics: [] };
  }

  async rollbackDeveloperTeamFiles(backup: unknown): Promise<import("@deck/core").RunnerRollbackResult> {
    const payload = (backup as import("@deck/core").RunnerBackupResult).payload as { kind?: string; snapshot?: PiSnapshot } | undefined;
    if (payload?.kind !== PI_GLOBAL_SNAPSHOT_KIND || !payload.snapshot) {
      return { status: "conflict", conflicts: [], diagnostics: ["Unrecognized Pi backup payload; nothing was restored."] };
    }
    const restored = restorePiSnapshot(payload.snapshot, this.#fileIO);
    return restored.restored
      ? { status: "rolled-back", conflicts: [], diagnostics: [] }
      : { status: "conflict", conflicts: restored.conflicts, diagnostics: restored.conflicts.map((path) => `${path} changed after apply; it was left untouched.`) };
  }

  // -------------------------------------------------------------------------
  // Developer team verification
  // -------------------------------------------------------------------------

  verifyDeveloperTeamInstall(plan: unknown): { valid: boolean; diagnostics: readonly string[] } {
    if (!this.#lastMaterialization) {
      throw new Error("No native plan available. Call buildDeveloperTeamInstallPlan first.");
    }
    const diagnostics: string[] = [];
    for (const write of this.#lastMaterialization.enginePlan.writes) {
      if (this.#fileIO.readText(write.path) !== write.content) diagnostics.push(`Pi content changed after refresh: ${write.path}`);
    }
    return {valid:diagnostics.length === 0, diagnostics};
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

const PI_GLOBAL_SNAPSHOT_KIND = "deck-pi-global-snapshot-v1";
const PI_MCP_DEFERRED_MARK = "applied with the Deck package install";
/** Binding recognized by the CLI launcher to forward exactly the Web Search credential variable. */
export const PI_WEB_SEARCH_BINDING = "deck-pi-web-search-v1";

/** `pi --version` with stdin ignored (a bare `pi` waits on a non-TTY stdin) and a bounded runtime. */
function runPiVersionProbe(command: string): { exitCode: number; stdout: string; stderr?: string } {
  try {
    const result = nodeSpawnSync(command, ["--version"], { stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, windowsHide: true });
    return { exitCode: result.status ?? 1, stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "" };
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: error instanceof Error ? error.message : "Unable to run pi." };
  }
}

/**
 * Earlier Deck versions installed Deck agents loose in `<agent dir>/agents` and required the community
 * `pi-subagents` / `pi-mcp-adapter` packages without recording a manifest. A leftover Deck agent file is the
 * evidence that those package entries were added by Deck.
 */
function hasLegacyDeckInstallEvidence(io: PiFileIO, agentDir: string): boolean {
  try {
    return io.exists(join(agentDir, "agents", "deck-lead.md")) || io.exists(join(agentDir, "skills", "deck-lead", "SKILL.md"));
  } catch {
    return false;
  }
}

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

function resolvePiSupermemoryProjectScope(projectRoot: string): string | undefined {
  try {
    const remote = execSync("git remote get-url origin", {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const resolved = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: remote ? [remote] : [] });
    return resolved.ok ? resolved.scope : undefined;
  } catch {
    return undefined;
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

    const capability = getUserFacingCapability(capabilityId as CapabilityId);
    if (!capability) continue;
    const typedEntry = entry as {
      status: string;
      toolId?: string;
      source?: string;
      diagnostics?: string[];
      webSearchReadiness?: import("@deck/core").WebSearchReadinessResult;
      webSearchEvidence?: import("@deck/core").WebSearchReadinessEvidence;
      webSearchProvider?: WebSearchProviderDescriptorV1;
    };
    const canonicalRequirement = getCanonicalCapability(capabilityId, [PI_RUNNER_CAPABILITY_CONTRIBUTION])?.requirement;
    const requirementLevel = canonicalRequirement === "required" || canonicalRequirement === "optional" || canonicalRequirement === "configurable"
      ? canonicalRequirement
      : capability.requirementLevel;
    const installKind: CapabilityCatalogEntry["installKind"] = capability.installKind === "pi-package"
      ? "pi-package"
      : capability.installKind === "external" || capability.installKind === "manual" || capability.installKind === "manual-verified"
        ? "external"
        : "runner-native";

    capabilities.push({
      capabilityId,
      label: capability.label,
      description: capability.description,
      section: capability.section,
      requirementLevel,
      toolId: typedEntry.toolId ?? capability.toolId,
      source: typedEntry.source ?? capability.source,
      installKind,
      supportStatus: getRunnerCapabilityMapping(capabilityId, runnerId, [PI_RUNNER_CAPABILITY_CONTRIBUTION])?.status,
      isInstalled: typedEntry.status === "ready",
      isBlocked: capabilityId === "web-search"
        ? typedEntry.webSearchReadiness?.code === "mcp-config-conflict"
        : typedEntry.status === "blocked",
      diagnostics: typedEntry.diagnostics,
      webSearchReadiness: typedEntry.webSearchReadiness,
      webSearchEvidence: typedEntry.webSearchEvidence,
      webSearchProvider: typedEntry.webSearchProvider,
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
  return ["context-mode", "codebase-memory-mcp", "rtk", "context7"].includes(id);
}

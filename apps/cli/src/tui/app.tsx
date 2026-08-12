import React, { useEffect, useMemo, useRef, useState } from "react";
import { readFileSync, existsSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Box, Text, useApp, useInput, useStdout } from "ink";

const LOG_FILE = "/tmp/deck-tui.log";
const DEBUG_FILE = "/tmp/deck-debug.txt";
function _ts() { return new Date().toISOString().slice(11, 23); }
function log(msg: string) {
  if (!process.env.DECK_DEBUG && !process.env.CI_DEBUG) return;
  const line = `${_ts()} ${msg}\n`;
  try { appendFileSync(LOG_FILE, line); } catch {}
  try { appendFileSync(DEBUG_FILE, line); } catch {}
}
function debug(msg: string) {
  const line = `${_ts()} ${msg}\n`;
  try { appendFileSync(DEBUG_FILE, line); } catch {}
  if (process.env.DECK_DEBUG_VERBOSE) console.error(`[deck] ${msg}`);
}
// Global error handlers
// (Removed debug global handlers — use DECK_DEBUG_VERBOSE for detailed logging)

// Initialize log file
if (process.env.DECK_DEBUG) {
  console.error(`[deck-tui-init] DECK_DEBUG is set, writing to ${LOG_FILE} and ${DEBUG_FILE}`);
  try { writeFileSync(LOG_FILE, `=== Deck TUI session ${new Date().toISOString()} ===\n`); } catch (e) { console.error(`[deck-tui-init] writeFileSync LOG failed: ${e}`); }
  try { writeFileSync(DEBUG_FILE, `=== Deck DEBUG session ${new Date().toISOString()} ===\n`); } catch {}
}

debug("app.tsx module loaded — DECK_DEBUG active");
import {
  type InstallableOpenCodeTool,
  type InstallableOpenCodeToolId,
  type OpenCodePreflightResult,
  type OpenCodeToolsReview,
  type OpenCodeToolInstallResult,
  type OpenCodeToolInstallResultExact,
} from "@deck/adapter-opencode";
import {
  type DeveloperTeamModelAssignments,
  type DeveloperTeamThinkingAssignments,
  type InstallablePiTool,
  type InstallablePiToolId,
  type PiModel,
  type PiPreflightResult,
  type PiProvider,
  type PiRequiredToolsReview,
  type PiToolInstallResult,
  type PiRunnerCapabilityInventory,
  type PiThinkingLevel,
  type AgentApplyResult,
  type DeveloperTeamApplyResult,
  PI_THINKING_LEVELS,
  writeSupermemoryPiMcpConfig,
  redactPiMcpConfigDiagnosticText,
  type PiMcpConfigWriteResult,
  buildPiInstallationPlan,
  installPiTools,
  listModelsForProvider,
  buildModelInventoryFromPiListModels,
  installInternalRunnerPackages,
  mergeSettingsPackages,
  detectConfiguredProviders,
} from "@deck/adapter-pi";
import {
  installOpenCodeTools,
  createOpenCodeEvidenceContext,
  OPENCODE_INSTALLABLE_TOOLS,
  getSelectableOpenCodeTools,
} from "@deck/adapter-opencode";
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import { getStandaloneSkills, getStandaloneSkillBody } from "@deck/core/skills/external";

import { createEngramMemoryProvider } from "@deck/adapter-engram";
import { createSupermemoryMemoryProvider } from "@deck/adapter-supermemory";
import type { AdaptiveMemoryProvider } from "@deck/core/memory/adaptive-memory";
import {
  getConfigurablePackageInstructionMetadata,
  PACKAGE_INSTRUCTION_CONFIGURATION_METADATA,
  type AdaptiveMemoryActiveProvider,
  type NormalizedDeckConfig,
  type PackageInstructionConfigurationMetadata,
} from "@deck/core/config/deck-config";
import { resolveCanonicalSupermemoryProjectScope } from "@deck/core/memory/canonical-supermemory-project";
import type { DeckConfigStore } from "../deck-config-store";
import { buildCapabilityInstructionBundle, getEnabledCapabilityInstructionIds, getEnabledPackageInstructionIds, prepareAndBuildDeveloperTeamInstallPlan } from "@deck/core";
import type {
  RunnerModelDiscoveryRequest,
  RunnerModelInventory,
  RunnerModelInventoryResult,
  RunnerVariantKey,
  RunnerAction,
  RunnerAdapter,
  RunnerId,
  CapabilityInventory,
  DashboardState,
  RunnerProjectInspection,
  SerenaBootstrapAuthorization,
  SerenaOperationIdentity,
} from "@deck/core";

import {
  getNextScreenAfterDeveloperTeamInstall,
  getNextScreenAfterDeveloperTeamReview,
  getNextScreenAfterEnvironmentSelection,
  getNextScreenAfterPiToolInstall,
  getNextScreenAfterTeamSelection,
} from "../developer-team-flow";
import { getEnvironmentOptions, getHomeMenuOptions } from "../menu-options";
import { buildEnvironmentMenuOptions, buildRunnerMenuOptions, resolveRunnerMenuSelection } from "./runner-options";
import { resolveProjectRoot } from "../project-root";
import { detectSelectedRuntimes, type EnvironmentId, type RuntimeStatus } from "../runtime-detection";
import { spawnSync } from "../runtime/process";
import { MenuList } from "./components/menu-list";
import { ScreenFrame } from "./screen-frame";
import {
  AgentModelAssignmentScreen,
  AgentModelConfigListScreen,
  DeveloperTeamInstallingScreen,
  DeveloperTeamReviewScreen,
  ModelProviderSelectionScreen,
  ModelSelectionScreen,
  NoProvidersScreen,
  CodexModelDiscoveryScreen,
  OpenCodeModelDiscoveryScreen,
  MemoryProviderSelectionScreen,
  SupermemorySetupScreen,
  type SupermemorySetupValues,
} from "./screens/developer-team-screens";
import {
  runRunnerReviewPlan,
  type RunnerActionRunResult,
  type RunnerPackageInstallResult,
  type RunnerSerenaActionContext,
  type RunnerSerenaOutcome,
  type RunnerSerenaStage,
} from "./runner-dashboard/action-runner";
import {
  getDashboardContinueEffect,
  getReviewPlanBlockerReason,
  getDashboardToggleAction,
  type RunnerDashboardContinueEffect,
} from "./runner-dashboard/input-handler";
import { reduceRunnerDashboard, type RunnerDashboardAction } from "./runner-dashboard/reducer";
import { normalizeDashboardCapabilityInventory } from "./runner-dashboard/inventory";
import { getToggleablePackageInstructionIds } from "./runner-dashboard/selectors";
import { createDefaultRunnerDashboardState, createRunnerReviewPlanFailure, loadRunnerPackageInstructionsFromConfig, runnerRequiresExternalSupermemoryToken, type RunnerDashboardState, type RunnerOperationIdentity, type RunnerReviewPlan } from "./runner-dashboard/state";
import { RunnerDashboardScreens } from "./screens/runner-dashboard-screens";
import { getAdapter, createDefaultAdapterRegistry } from "../runner-adapters";
import { getWebSearchProviderDescriptor } from "../web-search-provider";
import { persistWebSearchCredentialAndEnable, type WebSearchSetupResult } from "../web-search-setup";
import { HomeScreen } from "./screens/home-screen";
import { DoctorScreen } from "./screens/doctor-screen";
import { createOpenCodeDiscoveryCoordinator, getOpenCodeDiscoveryAction, type OpenCodeDiscoveryCoordinator } from "./opencode-discovery";
import { UpgradeConfirmScreen } from "./screens/upgrade-screen";
import { UpgradeProgressScreen, type UpgradeProgressStatus } from "./screens/upgrade-progress-screen";
import { RollbackScreen, type RollbackScreenMode } from "./screens/rollback-screen";
import {
  DEFAULT_RELEASE_CHECK_TIMEOUT_MS,
  runReleaseCheckWithTimeout,
  type ReleaseCheckDeps,
  type ReleaseCheckState,
} from "./release-check";
import type { ReleaseJson } from "../upgrade-command/release-descriptor";
import { detectInstallKind, runUpgradeOrchestrator, stageReleaseAssets } from "../upgrade-command/orchestrator";
import { getBuildInfo } from "../runtime/build-info";
import { resolveLatestBackupForCli, rollbackLatest, RollbackError } from "../upgrade-command/rollback";
import type { BackupManifest } from "../upgrade-command/backup-store";

type Screen =
  | "home"
  | "upgrade-confirm"
  | "upgrade-progress"
  | "rollback-confirm"
  | "rollback-progress"
  | "model-environment-selection"
  | "model-team-selection"
  | "environment-selection"
  | "personality-selection"
  | "pi-runner-dashboard"
  | "pi-preflight-checking"
  | "pi-preflight"
  | "required-tools"
  | "optional-tools"
  | "installation-review"
  | "installing"
  | "team-selection"
  | "agent-model-config-list"
  | "model-provider-selection"
  | "model-selection"
  | "agent-model-assignment"
  | "opencode-model-discovery"
  | "codex-model-discovery"
  | "no-providers"
  | "memory-provider-selection"
  | "supermemory-token"
  | "web-search-credential"
  // Removed: userId/teamId/orgId screens — token-only config
  | "developer-team-review"
  | "developer-team-installing"
  | "opencode-preflight-checking"
  | "codex-preflight-checking"
  | "configure-packages-runner-selection"
  | "configure-packages-detail"
  | "doctor"
  | "complete";

const HELP = "j/k or ↑/↓: navigate • space: toggle • enter: continue • esc: back • q: quit";

function nextRunnerOperation(
  runner: RunnerId,
  sequence: number,
): RunnerOperationIdentity {
  return {
    runner,
    operationId: `${runner}-review-install-${sequence}`,
    explicitlySelected: false,
  };
}

function isRunnerProjectInspection(value: unknown): value is RunnerProjectInspection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RunnerProjectInspection>;
  return typeof candidate.projectRoot === "string"
    && (candidate.state === "ready" || candidate.state === "degraded" || candidate.state === "blocked" || candidate.state === "unsupported")
    && typeof candidate.evidence === "object"
    && Array.isArray(candidate.diagnostics);
}

export async function runSerenaAdapterAction(
  adapter: Pick<RunnerAdapter, "runAction">,
  action: RunnerAction,
  context: RunnerSerenaActionContext,
  dashboardState: RunnerDashboardState,
  runnerCommand?: string,
): Promise<RunnerActionRunResult> {
  const result = await adapter.runAction(action, {
    projectRoot: context.projectRoot,
    runnerId: context.runnerId,
    environmentId: context.environmentId,
    operation: context.operation,
    currentOperation: context.currentOperation,
    operationId: context.operationId,
    serenaAuthorization: context.serenaAuthorization,
    serenaReadiness: context.serenaReadiness,
    webSearchProvider: context.webSearchProvider,
    signal: context.signal,
    runnerCommand,
    dashboardState,
    ...(context.serenaRevalidator ? { serenaRevalidator: context.serenaRevalidator } : {}),
    ...(context.serenaOwnedRoot ? { serenaOwnedRoot: context.serenaOwnedRoot } : {}),
  } as any);
  return {
    ...result,
    diagnostics: [...result.diagnostics],
  };
}

type MemoryProviderChoice = AdaptiveMemoryActiveProvider;

// ============================================================================
// Config resolution helpers (Task 7)
// ============================================================================

/**
 * Resolve Deck config from the caller-provided global config store.
 *
 * @param projectRoot - Resolved project root (may be null)
 * @returns Config object
 */
async function resolveDeckConfig(projectRoot: string | null, store: DeckConfigStore): Promise<NormalizedDeckConfig> {
  void projectRoot;
  return store.readRequired();
}

/**
 * Write Deck config to the caller-provided global config store.
 *
 * @param config - Config to write
 * @param projectRoot - Resolved project root (may be null)
 */
async function persistDeckConfig(config: NormalizedDeckConfig, projectRoot: string | null, store: DeckConfigStore): Promise<void> {
  void projectRoot;
  store.write(config);
}

function redactSecret(value: string): string {
  return value.length > 0 ? "[redacted]" : "";
}

export function buildSupermemoryDeckConfig(values: SupermemorySetupValues) {
  // Token-only config: no userId/teamId/orgId stored
  // User identity derived from token, project via x-sm-project header in MCP config
  return {
    version: 1,
    adaptiveMemory: {
      activeProvider: "supermemory" as const,
      supermemory: {
        mcpServerName: "supermemory",
      },
    },
  };
}

export function buildMemoryProviderConfig(choice: MemoryProviderChoice, values: SupermemorySetupValues) {
  if (choice === "supermemory") return buildSupermemoryDeckConfig(values);
  return { version: 1, adaptiveMemory: { activeProvider: choice } };
}

export function resolveDashboardMemoryProviderForInstall(
  runnerId: RunnerId,
  provider: AdaptiveMemoryActiveProvider,
  fallback: AdaptiveMemoryProvider | undefined,
): AdaptiveMemoryProvider | undefined {
  if (runnerId === "codex" && provider === "supermemory") {
    return createSupermemoryMemoryProvider({ mcpServerName: "supermemory" });
  }
  return fallback;
}

export function shouldUseLegacySupermemoryTokenRoute(selectedEnvironments: readonly EnvironmentId[]): boolean {
  return !selectedEnvironments.includes("codex-development") || selectedEnvironments.includes("pi-development");
}

export function createMemoryProviderForSelection(choice: MemoryProviderChoice, values?: SupermemorySetupValues): AdaptiveMemoryProvider | undefined {
  if (choice === "engram") return createEngramMemoryProvider();
  if (choice === "supermemory" && values) {
    return createSupermemoryMemoryProvider({
      // Token-only: no userId/teamId/orgId — user derived from token
      mcpServerName: "supermemory",
    });
  }
  return undefined;
}


type SupermemoryPiMcpWriter = (options: { token: string; serverName?: string; configPath?: string; homeDir?: string; projectScope: string }) => PiMcpConfigWriteResult;

export function handOffSupermemoryCredentialToPiMcp(
  values: SupermemorySetupValues,
  options?: { writer?: SupermemoryPiMcpWriter; configPath?: string; homeDir?: string; projectScope?: string },
): { success: boolean; message: string; path?: string } {
  const token = values.token.trim();
  if (!token) {
    return { success: false, message: "Supermemory token is required and must be stored outside Deck config." };
  }
  if (!options?.projectScope) {
    return { success: false, message: "Canonical x-sm-project scope is required to configure Supermemory in Pi MCP config." };
  }

  const writer = options?.writer ?? writeSupermemoryPiMcpConfig;
  const result = writer({ token, serverName: "supermemory", configPath: options?.configPath, homeDir: options?.homeDir, projectScope: options.projectScope });
  const diagnosticText = redactPiMcpConfigDiagnosticText(result.diagnostics.map((diagnostic) => diagnostic.message).join(" "));

  if (!result.ok) {
    return {
      success: false,
      path: result.path,
      message: `Unable to configure Supermemory in Pi MCP config at ${result.path}. ${diagnosticText || "Check file permissions and existing MCP config JSON, then try again."}`,
    };
  }

  return {
    success: true,
    path: result.path,
    message: `Supermemory MCP server '${result.serverName}' configured in Pi MCP config at ${result.path}; credential value is ${redactSecret(token)}.`,
  };
}

export function buildDashboardSupermemorySetupUpdate(values: SupermemorySetupValues, runtime: RunnerId = "pi"):
  | { ok: true; values: { configured: true; hasToken: boolean; diagnostics: string[] }; status: string }
  | { ok: false; message: string } {
  if (runtime === "codex") {
    return {
      ok: true,
      values: {
        configured: true,
        hasToken: false,
        diagnostics: ["Codex Supermemory authorization is user-owned after the reviewed MCP configuration is applied."],
      },
      status: "Dashboard Adaptive Memory: Supermemory configuration is ready. Deck will show the user-owned native OAuth next step after it applies and verifies the MCP configuration.",
    };
  }

  const normalizedValues = {
    token: values.token.trim(),
  };

  // Token-only: userId no longer required
  if (!normalizedValues.token) {
    return { ok: false, message: "Supermemory dashboard setup requires token before Review/Install." };
  }

  return {
    ok: true,
    values: {
      configured: true,
      hasToken: true,
      // userId no longer stored: derived from token automatically
      // teamId/orgId removed: project scoping via x-sm-project header
      diagnostics: [runtime === "pi"
        ? "Supermemory token captured ephemerally for Review & Install; no Pi MCP config was written yet."
        : "Supermemory token captured ephemerally for Review & Install; no Deck or OpenCode project file contains the credential."],
    },
    status: runtime === "pi"
      ? "Dashboard Adaptive Memory: Supermemory ready for Review & Install. Token: [redacted]; Pi MCP config will include x-sm-project header."
      : "Dashboard Adaptive Memory: Supermemory ready for OpenCode Review & Install. Token: [redacted]; provider credentials remain external.",
  };
}

// Global log function — set by DeckApp via useEffect
let globalAddLog: ((message: string) => void) | null = null;

// Global error handlers for debugging silent crashes
if (typeof process !== "undefined") {
  process.on("unhandledRejection", (reason) => {
    const msg = `[unhandledRejection] ${reason}`;
    globalAddLog?.(msg);
    console.error(msg);
  });
  process.on("uncaughtException", (error) => {
    const msg = `[uncaughtException] ${error}`;
    globalAddLog?.(msg);
    console.error(msg);
  });
}

// ---------------------------------------------------------------------------
// TUI model-inventory helpers (module scope)
//
// The OpenCode TUI model inventory is sourced from the adapter's resolved
// runner inventory. Cache and catalog data may enrich runner-reported entries,
// but they must never add provider, model, or variant availability.
//
// These helpers are pure and have no React state dependencies so they can be
// exercised directly from tests without rendering the TUI.
// ---------------------------------------------------------------------------

type TuiDetectedProvider = {
  id: string;
  displayName: string;
  envVars: readonly string[];
};

type TuiDetectedModel = {
  id: string;
  displayName: string;
  providerId: string;
  description?: string;
  priority?: number;
  thinking?: boolean;
  variants?: readonly RunnerVariantKey[];
  variantDescriptions?: Readonly<Record<RunnerVariantKey, string>>;
  defaultVariant?: RunnerVariantKey;
  upgrade?: {
    model: string;
    upgradeCopy?: string;
    modelLink?: string;
    migrationMarkdown?: string;
  } | null;
  inputModalities?: readonly string[];
  experimentalSupportedTools?: readonly string[];
  supportsParallelToolCalls?: boolean;
  supportsReasoningSummaryParameter?: boolean;
  supportsImageDetailOriginal?: boolean;
  supportsSearchTool?: boolean;
};

export type TuiModelInventory = {
  providers: TuiDetectedProvider[];
  modelsByProvider: Record<string, TuiDetectedModel[]>;
  diagnostics?: readonly string[];
};

/**
 * Map a runner-agnostic `RunnerModelInventory` (from `adapter.getModelInventory()`)
 * into the TUI's provider/model shape. Returns an empty inventory when the
 * input is null/undefined or has no providers.
 */
export function buildTuiInventoryFromAdapterInventory(
  raw: RunnerModelInventory | null | undefined,
): TuiModelInventory {
  if (!raw || !Array.isArray(raw.providers)) {
    return { providers: [], modelsByProvider: {} };
  }
  const providers: TuiDetectedProvider[] = raw.providers.map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    envVars: provider.envVars ?? [],
  }));
  const modelsByProvider: Record<string, TuiDetectedModel[]> = {};
  for (const provider of providers) modelsByProvider[provider.id] = [];

  for (const [providerId, models] of Object.entries(raw.modelsByProvider ?? {})) {
    if (!Array.isArray(models)) continue;
    const list = modelsByProvider[providerId] ?? (modelsByProvider[providerId] = []);
    for (const model of models) {
      list.push({
        id: model.id,
        displayName: model.displayName,
        providerId: model.providerId,
        ...(model.description === undefined ? {} : { description: model.description }),
        ...(model.priority === undefined ? {} : { priority: model.priority }),
        thinking: typeof model.supportsReasoning === "boolean" ? model.supportsReasoning : undefined,
        variants: model.variants ?? [],
        ...(model.variantDescriptions === undefined ? {} : { variantDescriptions: model.variantDescriptions }),
        ...(model.defaultVariant === undefined ? {} : { defaultVariant: model.defaultVariant }),
        ...(model.upgrade === undefined ? {} : { upgrade: model.upgrade }),
        ...(model.inputModalities === undefined ? {} : { inputModalities: model.inputModalities }),
        ...(model.experimentalSupportedTools === undefined ? {} : { experimentalSupportedTools: model.experimentalSupportedTools }),
        ...(model.supportsParallelToolCalls === undefined ? {} : { supportsParallelToolCalls: model.supportsParallelToolCalls }),
        ...(model.supportsReasoningSummaryParameter === undefined ? { } : { supportsReasoningSummaryParameter: model.supportsReasoningSummaryParameter }),
        ...(model.supportsImageDetailOriginal === undefined ? {} : { supportsImageDetailOriginal: model.supportsImageDetailOriginal }),
        ...(model.supportsSearchTool === undefined ? {} : { supportsSearchTool: model.supportsSearchTool }),
      });
    }
  }
  return { providers, modelsByProvider, ...(raw.diagnostics === undefined ? {} : { diagnostics: raw.diagnostics }) };
}

/**
 * Parse `opencode models` CLI stdout into the TUI's provider/model shape.
 *
 * Each non-empty line containing a `/` is treated as `<providerId>/<modelId>`.
 * Empty/non-matching lines are ignored. Used only as a fallback when the
 * adapter does not provide an inventory.
 */


/**
 * Safely resolve a `RunnerModelInventory` from an adapter, handling both
 * synchronous and Promise returns. Returns `null` when the adapter does not
 * expose `getModelInventory`, when the method throws, or when the returned
 * Promise rejects. Never throws.
 */



export type TuiRunnerModelDiscoveryState =
  | { kind: "loading" }
  | { kind: "ready"; inventory: TuiModelInventory; source: "live" | "memory"; diagnostics: readonly string[]; discoveredAt: number; fingerprint: string }
  | { kind: "empty"; source: "live" | "memory"; diagnostics: readonly string[]; discoveredAt: number; fingerprint: string }
  | { kind: "stale"; inventory: TuiModelInventory; source: "last-known-good" | "bundled" | "deck-fallback"; diagnostics: readonly string[]; discoveredAt: number; fingerprint: string; errorMessage: string }
  | { kind: "blocked"; source: "none"; diagnostics: readonly string[]; errorMessage: string };

export type TuiOpenCodeDiscoveryState = TuiRunnerModelDiscoveryState;
export type TuiCodexDiscoveryState = TuiRunnerModelDiscoveryState;

function inventoryHasModels(inventory: TuiModelInventory): boolean {
  return Object.values(inventory.modelsByProvider).some((models) => models.length > 0);
}

/** Maps the adapter's discriminated discovery contract into terminal UI state. */
export function buildTuiInventoryFromDiscoveryResult(
  result: RunnerModelInventoryResult,
): TuiOpenCodeDiscoveryState {
  if (result.state === "blocked") {
    return { kind: "blocked", source: "none", diagnostics: [], errorMessage: result.error.message };
  }

  const inventory = buildTuiInventoryFromAdapterInventory(result.inventory);
  if (result.state === "stale") {
    return {
      kind: "stale",
      inventory,
      source: result.source,
      diagnostics: result.inventory.diagnostics ?? [],
      discoveredAt: result.discoveredAt,
      fingerprint: result.fingerprint,
      errorMessage: result.error.message,
    };
  }

  return inventoryHasModels(inventory)
    ? { kind: "ready", inventory, source: result.source, diagnostics: result.inventory.diagnostics ?? [], discoveredAt: result.discoveredAt, fingerprint: result.fingerprint }
    : { kind: "empty", source: result.source, diagnostics: result.inventory.diagnostics ?? [], discoveredAt: result.discoveredAt, fingerprint: result.fingerprint };
}

/**
 * Requests adapter-owned OpenCode discovery. `rescan` only bypasses Deck's local
 * cache; this TUI boundary never adds a network-backed runner refresh flag.
 */
export async function resolveOpenCodeModelDiscovery(
  adapter: { getModelInventory?: (request: RunnerModelDiscoveryRequest) => Promise<RunnerModelInventoryResult> },
  request: RunnerModelDiscoveryRequest,
): Promise<TuiOpenCodeDiscoveryState> {
  if (typeof adapter.getModelInventory !== "function") {
    return { kind: "blocked", source: "none", diagnostics: [], errorMessage: "OpenCode model discovery is unavailable. Check the OpenCode runner and retry." };
  }
  try {
    return buildTuiInventoryFromDiscoveryResult(await adapter.getModelInventory(request));
  } catch {
    return { kind: "blocked", source: "none", diagnostics: [], errorMessage: "OpenCode model discovery failed. Check the OpenCode runner and retry." };
  }
}

export async function resolveCodexModelDiscovery(
  adapter: { getModelInventory?: (request: RunnerModelDiscoveryRequest) => Promise<RunnerModelInventoryResult> },
  request: RunnerModelDiscoveryRequest,
): Promise<TuiCodexDiscoveryState> {
  if (typeof adapter.getModelInventory !== "function") {
    return { kind: "blocked", source: "none", diagnostics: [], errorMessage: "Codex model discovery is unavailable. Check the Codex runner and retry." };
  }
  try {
    return buildTuiInventoryFromDiscoveryResult(await adapter.getModelInventory(request));
  } catch {
    return { kind: "blocked", source: "none", diagnostics: [], errorMessage: "Codex model discovery failed. Check the Codex runner and retry." };
  }
}


function humanizeProviderName(providerId: string): string {
  return providerId
    .split(/[-_]/)
    .map((part) => (part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function humanizeModelName(modelName: string): string {
  return modelName
    .split(/[-_]/)
    .map((part) =>
      part.length === 0
        ? part
        : part.toUpperCase() === part
          ? part
          : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

/** Narrow composition seam for deterministic discovery UI tests; defaults preserve production wiring. */
export type DeckAppDependencies = {
  getAdapter?: typeof getAdapter;
  adapterRegistry?: import("@deck/core").AdapterRegistry;
  resolveProjectRoot?: typeof resolveProjectRoot;
  runReleaseCheck?: typeof runReleaseCheckWithTimeout;
  configStore?: DeckConfigStore;
};

async function rollbackOrThrow(adapter: import("@deck/core").RunnerAdapter, backup: unknown): Promise<void> {
  const result = await adapter.rollbackDeveloperTeamFiles(backup);
  if (result.status === "conflict") throw new Error(result.diagnostics.join("; ") || `Rollback conflicts: ${result.conflicts.join(", ")}`);
}

function getSupportedPackageInstructionMetadata(
  adapter: Pick<RunnerAdapter, "packageInstructionIds"> | null | undefined,
): readonly PackageInstructionConfigurationMetadata[] {
  const supported = new Set(adapter?.packageInstructionIds ?? []);
  return PACKAGE_INSTRUCTION_CONFIGURATION_METADATA.filter((entry) => supported.has(entry.id));
}

function getConfiguredPackageInstructionIds(
  supportedMetadata: readonly PackageInstructionConfigurationMetadata[],
  toggles: Readonly<Record<string, boolean>>,
) {
  return supportedMetadata
    .filter((entry) => entry.defaultEnabled || (entry.configurable && toggles[entry.id] === true))
    .map((entry) => entry.id);
}

function getEnabledSupportedPackageInstructionIds(
  adapter: Pick<RunnerAdapter, "packageInstructionIds"> | null | undefined,
  enabledIds: readonly string[],
) {
  const enabled = new Set(enabledIds);
  return getSupportedPackageInstructionMetadata(adapter)
    .filter((entry) => enabled.has(entry.id))
    .map((entry) => entry.id);
}

function getEnabledSupportedCapabilityInstructionIds(
  adapter: Pick<RunnerAdapter, "packageInstructionIds"> | null | undefined,
  enabledIds: readonly string[],
) {
  const supported = getEnabledSupportedPackageInstructionIds(adapter, enabledIds);
  return (enabledIds as readonly string[]).includes("web-search") ? [...supported, "web-search" as const] : supported;
}

function packageInstructionTogglesFromConfig(
  supportedMetadata: readonly PackageInstructionConfigurationMetadata[],
  configured: Readonly<Record<string, boolean>>,
): Record<string, boolean> {
  return Object.fromEntries(
    supportedMetadata
      .filter((entry) => entry.configurable)
      .map((entry) => [entry.id, configured[entry.id] === true]),
  );
}

function packageInstructionConfigForPersistence(
  supportedMetadata: readonly PackageInstructionConfigurationMetadata[],
  toggles: Readonly<Record<string, boolean>>,
): Record<string, boolean> {
  return Object.fromEntries(supportedMetadata.map((entry) => [
    entry.id,
    entry.defaultEnabled || (entry.configurable && toggles[entry.id] === true),
  ]));
}

export function DeckApp(dependencies: DeckAppDependencies = {}) {
  const adapterRegistry = useMemo(
    () => dependencies.adapterRegistry ?? createDefaultAdapterRegistry(),
    [dependencies.adapterRegistry],
  );
  const adapterFor = dependencies.adapterRegistry
    ? (runnerId: string) => adapterRegistry.tryGet(runnerId)
      ?? adapterRegistry.resolveByEnvironment(runnerId)
      ?? adapterRegistry.get(runnerId)
    : dependencies.getAdapter ?? getAdapter;
  const runnerOptions = buildRunnerMenuOptions(adapterRegistry);
  const environmentOptions = buildEnvironmentMenuOptions(adapterRegistry, getEnvironmentOptions());
  const projectRootFor = dependencies.resolveProjectRoot ?? resolveProjectRoot;
  const releaseCheckFor = dependencies.runReleaseCheck ?? runReleaseCheckWithTimeout;
  const configStore = dependencies.configStore;
  if (!configStore) throw new Error("DeckApp requires caller-resolved global Deck config store.");
  const requiredConfigStore: DeckConfigStore = configStore;
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [screen, setScreen] = useState<Screen>("home");
  const [logs, setLogs] = useState<string[]>([]);

  // Helper to add logs (keeps last 20)
  function addLog(message: string) {
    setLogs((prev) => [...prev.slice(-20), `[${new Date().toLocaleTimeString()}] ${message}`]);
  }
  const [cursor, setCursor] = useState(0);
  const [homeCursor, setHomeCursor] = useState(0);
  const [selectedEnvironments, setSelectedEnvironments] = useState<EnvironmentId[]>([]);
  const [runtimeStatuses, setRuntimeStatuses] = useState<RuntimeStatus[]>([]);
  const [piPreflight, setPiPreflight] = useState<PiPreflightResult | null>(null);
  const [toolsReview, setToolsReview] = useState<PiRequiredToolsReview | null>(null);
  const [selectedOptionalTools, setSelectedOptionalTools] = useState<InstallablePiToolId[]>(() =>
    (adapterRegistry.tryGet("pi")?.getSelectableTools() ?? []).map((tool: any) => tool.id),
  );
  const [openCodePreflight, setOpenCodePreflight] = useState<OpenCodePreflightResult | null>(null);
  const [openCodeToolsReview, setOpenCodeToolsReview] = useState<OpenCodeToolsReview | null>(null);
  const [installResults, setInstallResults] = useState<(PiToolInstallResult | OpenCodeToolInstallResult)[]>([]);
  const [developerTeamResults, setDeveloperTeamResults] = useState<AgentApplyResult[]>([]);
  const [developerTeamCursor, setDeveloperTeamCursor] = useState(0);
  const [selectedTeams, setSelectedTeams] = useState<string[]>(() =>
    (adapterRegistry.tryGet("pi")?.getTeams("pi-development") ?? []).map((team: any) => team.id),
  );

  // Project root resolved once at startup; global preferences are injected separately.
  const [localResolvedProjectRoot] = useState<string | null>(() => projectRootFor());

  // Model configuration state
  const [detectedProviders, setDetectedProviders] = useState<PiProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<PiProvider | null>(null);
  const [providerModels, setProviderModels] = useState<PiModel[]>([]);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, PiModel[]>>({});
  const [selectedModel, setSelectedModel] = useState<PiModel | null>(null);
  const [modelAssignments, setModelAssignments] = useState<DeveloperTeamModelAssignments>({});
  const [thinkingAssignments, setThinkingAssignments] = useState<DeveloperTeamThinkingAssignments>({});
  const [openCodeDiscovery, setOpenCodeDiscovery] = useState<TuiOpenCodeDiscoveryState>({ kind: "loading" });
  const [codexDiscovery, setCodexDiscovery] = useState<TuiCodexDiscoveryState>({ kind: "loading" });
  const [openCodeAssignmentStates, setOpenCodeAssignmentStates] = useState<Record<string, "available" | "model-unavailable" | "variant-unavailable" | "unverified">>({});
  const [codexAssignmentStates, setCodexAssignmentStates] = useState<Record<string, "available" | "model-unavailable" | "variant-unavailable" | "unverified">>({});
  const [changedOpenCodeAgentIds, setChangedOpenCodeAgentIds] = useState<ReadonlySet<string>>(new Set());
  const [agentAssignmentIndex, setAgentAssignmentIndex] = useState(0);
  const [agentConfigCursor, setAgentConfigCursor] = useState(0);
  const [modelEnvironmentCursor, setModelEnvironmentCursor] = useState(0);
  const [modelTeamCursor, setModelTeamCursor] = useState(0);
  const [selectedModelEnvironment, setSelectedModelEnvironment] = useState<EnvironmentId | null>(null);
  const [modelConfigSource, setModelConfigSource] = useState<"install" | "menu" | "dashboard" | null>(null);
  const [modelConfigRuntime, setModelConfigRuntime] = useState<RunnerId>("pi");
  const openCodeProjectRootRef = useRef(localResolvedProjectRoot ?? process.cwd());
  const codexProjectRootRef = useRef(localResolvedProjectRoot ?? process.cwd());
  const openCodeDiscoveryCoordinatorRef = useRef<OpenCodeDiscoveryCoordinator<TuiOpenCodeDiscoveryState> | null>(null);
  if (!openCodeDiscoveryCoordinatorRef.current) {
    openCodeDiscoveryCoordinatorRef.current = createOpenCodeDiscoveryCoordinator<TuiOpenCodeDiscoveryState>({
      discover: (request) => resolveOpenCodeModelDiscovery(adapterFor("opencode"), request),
      getActiveIdentity: () => ({
        runtime: "opencode",
        projectRoot: openCodeProjectRootRef.current,
      }),
      loadingState: { kind: "loading" },
    });
  }
  const codexDiscoveryCoordinatorRef = useRef<OpenCodeDiscoveryCoordinator<TuiCodexDiscoveryState, "codex"> | null>(null);
  if (!codexDiscoveryCoordinatorRef.current) {
    codexDiscoveryCoordinatorRef.current = createOpenCodeDiscoveryCoordinator<TuiCodexDiscoveryState, "codex">({
      discover: (request) => resolveCodexModelDiscovery(adapterFor("codex"), request),
      getActiveIdentity: () => ({
        runtime: "codex",
        projectRoot: codexProjectRootRef.current,
      }),
      loadingState: { kind: "loading" },
    });
  }
  const [memoryProvider, setMemoryProvider] = useState<AdaptiveMemoryProvider | undefined>(undefined);
  const [memoryProviderChoice, setMemoryProviderChoice] = useState<MemoryProviderChoice>("none");
  const [supermemorySetup, setSupermemorySetup] = useState<SupermemorySetupValues>(() => ({ token: "" }));
  const [supermemoryError, setSupermemoryError] = useState<string | undefined>(undefined);
  const [memoryStatus, setMemoryStatus] = useState<string | undefined>(undefined);
  const [dashboardSupermemorySetupActive, setDashboardSupermemorySetupActive] = useState(false);
  // The Tavily value is kept only while the masked entry screen is active.
  // It is never copied into dashboard state, plans, config, diagnostics, or logs.
  const [dashboardWebSearchCredentialEntryActive, setDashboardWebSearchCredentialEntryActive] = useState(false);
  const [webSearchCredential, setWebSearchCredential] = useState("");
  const [webSearchCredentialError, setWebSearchCredentialError] = useState<string | undefined>(undefined);
  const [dashboardCompletionStatus, setDashboardCompletionStatus] = useState<string | undefined>(undefined);
  const [dashboardState, setDashboardState] = useState<RunnerDashboardState>(() => createDefaultRunnerDashboardState());
  const [dashboardInventory, setDashboardInventory] = useState<CapabilityInventory | null>(null);
  const [dashboardEnvironmentId, setDashboardEnvironmentId] = useState<EnvironmentId | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardActionResults, setDashboardActionResults] = useState<RunnerActionRunResult[]>([]);
  const [dashboardSerenaStages, setDashboardSerenaStages] = useState<RunnerSerenaStage[]>([]);
  const [dashboardSerenaOutcome, setDashboardSerenaOutcome] = useState<RunnerSerenaOutcome | undefined>(undefined);
  const [dashboardCancellationRequested, setDashboardCancellationRequested] = useState(false);
  const dashboardOperationSequenceRef = useRef(0);
  const dashboardAbortControllerRef = useRef<AbortController | null>(null);
  const dashboardInstallActiveRef = useRef(false);
  const dashboardExitRequestedRef = useRef(false);

  // Configure packages standalone flow
  const [configurePackagesRunner, setConfigurePackagesRunner] = useState<RunnerId | null>(null);
  const [configurePackagesCursor, setConfigurePackagesCursor] = useState(0);
  const [configurePackagesToggles, setConfigurePackagesToggles] = useState<Record<string, boolean>>({});
  const configurePackagesAdapter = useMemo(
    () => configurePackagesRunner ? adapterRegistry.tryGet(configurePackagesRunner) ?? null : null,
    [adapterRegistry, configurePackagesRunner],
  );
  const configurePackageMetadata = useMemo(
    () => getSupportedPackageInstructionMetadata(configurePackagesAdapter),
    [configurePackagesAdapter],
  );
  const configurePackageRows = useMemo(
    () => getConfigurablePackageInstructionMetadata(configurePackagesAdapter?.packageInstructionIds ?? []),
    [configurePackagesAdapter],
  );

  // Personality selection state
  const [selectedPersonality, setSelectedPersonality] = useState<"guia" | "pragmatica">(() => {
    try {
      return requiredConfigStore.readRequired().orchestratorPersonality;
    } catch {
      return "pragmatica";
    }
  });

  // -------------------------------------------------------------------------
  // T3.2 / T3.4 / T3.5: release-check + upgrade flow state
  // -------------------------------------------------------------------------
  // The release check is non-blocking: it is fired on mount and the home
  // screen renders immediately. Result feeds the home banner and the
  // "Update Deck" menu action. The check has a hard 5s timeout
  // (DEFAULT_RELEASE_CHECK_TIMEOUT_MS).
  const [releaseCheck, setReleaseCheck] = useState<ReleaseCheckState>({ kind: "pending" });
  // The descriptor captured by the release check, used as input to the
  // orchestrator when the user confirms the upgrade.
  const [upgradeDescriptor, setUpgradeDescriptor] = useState<ReleaseJson | null>(null);
  // Cursor for the upgrade confirm screen (0=Apply, 1=Cancel).
  const [upgradeCursor, setUpgradeCursor] = useState(0);
  // Progress status for the upgrade progress screen.
  const [upgradeProgress, setUpgradeProgress] = useState<UpgradeProgressStatus>({
    kind: "running",
    phase: "Downloading",
    completedCount: 0,
  });
  // Whether the binary item is to be skipped (Homebrew installs).
  const [upgradeBinarySkipped, setUpgradeBinarySkipped] = useState(false);
  // Rollback hint surfaced when a previous upgrade failed.
  const [upgradeRollbackHint, setUpgradeRollbackHint] = useState<string | undefined>(undefined);

  // -------------------------------------------------------------------------
  // T-FIX-1: user-initiated rollback (REQ-RBK-002) — TUI surface
  // -------------------------------------------------------------------------
  // The latest restorable backup, discovered synchronously on mount. The
  // home menu adds a "Roll back Deck" entry whenever this is non-null,
  // and the user is routed to the rollback-confirm screen on selection.
  const [rollbackManifest, setRollbackManifest] = useState<BackupManifest | null>(null);
  // Cursor for the rollback confirm screen (0=Run rollback, 1=Cancel).
  const [rollbackCursor, setRollbackCursor] = useState(0);
  // Snapshot of the result displayed by the rollback progress screen.
  const [rollbackStatus, setRollbackStatus] = useState<{
    mode: RollbackScreenMode;
    restoredCount?: number;
    reason?: string;
  } | null>(null);

  /**
   * Detect the most-recent restorable backup on mount so the home
   * menu can offer a "Roll back Deck" entry. Resolves to `null` when
   * no backup exists, when the disk is unreachable, or when the
   * manifest is corrupt. Never throws.
   */
  useEffect(() => {
    let cancelled = false;
    try {
      const latest = resolveLatestBackupForCli();
      if (!cancelled) setRollbackManifest(latest);
    } catch (err) {
      if (!cancelled) {
        log(`rollback availability probe failed: ${err instanceof Error ? err.message : String(err)}`);
        setRollbackManifest(null);
      }
    }
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Fire-and-forget release check on mount.
   *
   * Cancels on unmount to avoid `setState` on an unmounted component.
   * Hard timeout is enforced by `runReleaseCheckWithTimeout` — see
   * `release-check.ts`.
   */
  useEffect(() => {
    let cancelled = false;
    const deps: ReleaseCheckDeps = {};
    releaseCheckFor(DEFAULT_RELEASE_CHECK_TIMEOUT_MS, deps)
      .then((state) => {
        if (cancelled) return;
        setReleaseCheck(state);
        // Capture the descriptor so the upgrade confirm screen has it
        // without re-fetching. The `descriptor` field is only present
        // when the fetch came back as `descriptor`; for `available`
        // results sourced from the legacy path we leave it null and the
        // orchestrator will re-fetch on confirm.
      })
      .catch((err) => {
        if (cancelled) return;
        log(`release-check failed: ${err instanceof Error ? err.message : String(err)}`);
        setReleaseCheck({ kind: "network-error", error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Runtime-agnostic capability resolver — dispatches to the correct adapter based on runnerScope
  const dashboardCapabilityResolver = useMemo(() => ({
    getSupportedPackageInstructionIds: () => {
      return adapterFor(dashboardState.runnerScope).packageInstructionIds ?? [];
    },
  }), [dashboardState.runnerScope]);

  // Compute toggleable capability count for cursor clamping (configurable + optional only)
  const dashboardToggleableCount = useMemo(() => {
    if (dashboardState.screen !== "packages-detail") return 5; // default
    const toggleableIds = getToggleablePackageInstructionIds(dashboardState, dashboardCapabilityResolver);
    return toggleableIds.length;
  }, [dashboardState.screen, dashboardState.runnerScope]); // eslint-disable-line react-hooks/exhaustive-deps

  // Runtime-agnostic plan builder — dispatches to the correct adapter based on runnerScope
  const dashboardPlanBuilder = useMemo(() => {
    return (state: RunnerDashboardState, inventory: unknown) => {
      log(`dashboardPlanBuilder: called. runnerScope=${state.runnerScope} selectedCaps=${JSON.stringify(state.selectedCapabilities)} inventoryType=${typeof inventory}`);
      if (state.runnerScope === "all" || !dashboardEnvironmentId) {
        return createRunnerReviewPlanFailure("dashboard-inventory-invalid", "Runner capability inventory is unavailable. Return to Dashboard and retry.");
      }
      const normalizedInventory = normalizeDashboardCapabilityInventory(inventory, state.runnerScope, dashboardEnvironmentId);
      if (!normalizedInventory.ok) {
        return createRunnerReviewPlanFailure(normalizedInventory.diagnostic.code, normalizedInventory.diagnostic.message);
      }
      try {
        const adapter = adapterFor(state.runnerScope);
        log(`dashboardPlanBuilder: adapter=${adapter.runnerId}`);
        const adapterState: DashboardState & {
          teams: RunnerDashboardState["teams"];
          runtime: { toolsReview?: unknown };
        } = {
          runnerId: normalizedInventory.inventory.runnerId,
          environmentId: normalizedInventory.inventory.environmentId,
          selectedCapabilities: Object.fromEntries(
            Object.entries(state.selectedCapabilities).map(([capabilityId, selected]) => [capabilityId, selected === true]),
          ),
           explicitlySelectedCapabilities: Object.fromEntries(
             Object.entries(state.explicitlySelectedCapabilities).map(([capabilityId, selected]) => [capabilityId, selected === true]),
           ),
           operationId: state.operationId,
           webSearchProvider: state.webSearchProvider,
           webSearchProviderDescriptor: state.webSearchProviderDescriptor,
           adaptiveMemory: state.adaptiveMemory,
          packageInstructions: Object.fromEntries(
            Object.entries(state.packageInstructions).map(([packageId, enabled]) => [packageId, enabled === true]),
          ),
          teams: state.teams,
          runtime: { toolsReview: state.runtime.toolsReview },
        };
        const plan = adapter.buildReviewPlan(
          adapterState,
          normalizedInventory.inventory,
        );
        log(`dashboardPlanBuilder: SUCCESS. planSteps=${Array.isArray(plan) ? plan.length : "not-array"}`);
        return plan as RunnerReviewPlan;
      } catch {
        log("dashboardPlanBuilder: FAILED to build review plan");
        return createRunnerReviewPlanFailure();
      }
    };
  }, [dashboardEnvironmentId]);

  const installedPi = runtimeStatuses.find((status) => status.runtime === "pi" && status.installed && status.command);
  const installedOpenCode = runtimeStatuses.find((status) => status.runtime === "opencode" && status.installed && status.command);
  const installationPlan = useMemo(
    () =>
      toolsReview
        ? buildPiInstallationPlan({
            requiredTools: toolsReview.requiredTools,
            selectedOptionalToolIds: selectedOptionalTools,
          })
        : [],
    [selectedOptionalTools, toolsReview],
  );
  const openCodeInstallationPlan = useMemo(
    () => [],
    [],
  );

  // Set up global log function reference for process handlers
  useEffect(() => {
    globalAddLog = addLog;
    return () => {
      globalAddLog = null;
    };
  }, []);

  useInput((input, key) => {
    try { appendFileSync("/tmp/deck-debug.txt", `useInput TOP: key=${JSON.stringify(key)} screen=${screen}\n`); } catch {}
    try {
    if (screen === "web-search-credential") {
      handleWebSearchCredentialInput(input, key);
      return;
    }
    if (screen === "pi-runner-dashboard") {
      handleDashboardInput(input, key);
      return;
    }

    if (isSupermemoryInputScreen(screen)) {
      handleSupermemoryTextInput(input, key);
      return;
    }

    if (input === "q") {
      exit();
      return;
    }

    if (input === "r" && modelConfigRuntime === "opencode" && (
      screen === "opencode-model-discovery" || screen === "agent-model-config-list"
    )) {
      startOpenCodeModelDiscovery("rescan");
      return;
    }

    if (input === "r" && modelConfigRuntime === "codex" && screen === "codex-model-discovery") {
      startCodexModelDiscovery("rescan");
      return;
    }

    if (key.escape) {
      if (dashboardWebSearchCredentialEntryActive) {
        clearDashboardWebSearchCredential();
        setDashboardWebSearchCredentialEntryActive(false);
        resetCursor("pi-runner-dashboard");
        return;
      }
      if (dashboardSupermemorySetupActive) {
        clearDashboardSupermemoryEphemeralState();
        setDashboardSupermemorySetupActive(false);
        resetCursor("pi-runner-dashboard");
        return;
      }
      goBack();
      return;
    }

    if (key.upArrow || input === "k") {
      moveCursor(-1);
      return;
    }

    if (key.downArrow || input === "j") {
      moveCursor(1);
      return;
    }

    if (input === " ") {
      toggleCurrent();
      return;
    }

    if (key.return || input === "\n" || input === "\r") {
      debug(`useInput: return/enter at screen=${screen} key.return=${key.return} input=${JSON.stringify(input)}`);
      debug(`continueFromCurrent: calling...`);
      continueFromCurrent().then(() => debug("continueFromCurrent: done")).catch(e => debug(`continueFromCurrent error: ${e}`));
      debug(`continueFromCurrent: dispatched`);
    }
    } catch (error) {
      const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
      try { appendFileSync("/tmp/deck-debug.txt", `useInput UNCAUGHT: ${msg}\n`); } catch {}
      log(`useInput UNCAUGHT: ${msg}`);
    }
  });

  useEffect(() => {
    if (screen !== "installing") return;

    let cancelled = false;

    async function runInstall() {
      const results = await installPiTools(installedPi?.command, installationPlan, (result) => {
        if (!cancelled) setInstallResults((current) => [...current, result]);
      });

      if (!cancelled) {
        setInstallResults(results);
        goToNextEnvironmentOrComplete();
      }
    }

    void runInstall();

    return () => {
      cancelled = true;
    };
  }, [installationPlan, installedPi?.command, screen]);

  useEffect(() => {
    if (screen !== "pi-runner-dashboard" || dashboardState.screen !== "install-progress" || dashboardState.plan?.ready !== true) return;

    log(`useEffect[install-progress]: STARTING. screen=${screen} dashboardScreen=${dashboardState.screen} hasPlan=${!!dashboardState.plan}`);

    let cancelled = false;
    const controller = new AbortController();
    dashboardAbortControllerRef.current = controller;
    dashboardInstallActiveRef.current = true;
    setDashboardCancellationRequested(false);
    setDashboardSerenaStages([]);
    setDashboardSerenaOutcome(undefined);

    async function runDashboardInstall() {
      log(`runDashboardInstall: starting`);
      setDashboardActionResults([]);
      const adapter = adapterFor(dashboardState.runnerScope);
      log(`runDashboardInstall: adapter=${adapter.runnerId} projectRoot=${localResolvedProjectRoot ?? process.cwd()}`);
      const resolvedMemoryProvider = resolveDashboardMemoryProviderForInstall(
        adapter.runnerId,
        dashboardState.adaptiveMemory.provider,
        memoryProvider,
      );
      // Use stored project root, not the function
      const projectRoot = localResolvedProjectRoot ?? process.cwd();
      const environmentId = adapter.environmentIds[0];
      const currentOperation = dashboardState.currentOperation as SerenaOperationIdentity | undefined;
      const serenaAuthorization: SerenaBootstrapAuthorization | undefined = currentOperation?.explicitlySelected
        ? {
            kind: "interactive-tui-explicit-selection",
            runner: currentOperation.runner,
            operationId: currentOperation.operationId,
          }
        : undefined;
      // Log the plan action counts before execution
      const planGroups = dashboardState.plan?.groups;
      log(`runDashboardInstall: PLAN counts - automaticInstalls=${planGroups?.automaticInstalls?.length ?? 0}, manualSteps=${planGroups?.manualSteps?.length ?? 0}, configWrites=${planGroups?.configWrites?.length ?? 0}, teamApplications=${planGroups?.teamApplications?.length ?? 0}, validations=${planGroups?.validations?.length ?? 0}`);
      
      log(`runDashboardInstall: calling runRunnerReviewPlan`);
      const executionStart = Date.now();
      const runSerenaAction = async (action: import("@deck/core").RunnerAction, context: RunnerSerenaActionContext) => {
        if (action.kind === "install-pi-package" || action.kind === "install") {
          if (adapter.runnerId === "pi") {
            const piTool = {
              id: "serena",
              name: action.title,
              source: action.source ?? "serena-agent",
              required: action.required ?? false,
              installKind: "serena-agent",
              capabilityId: "serena",
            } as any;
            const installResults = await installPiTools(
              dashboardState.runtime.runnerCommand,
              [piTool],
              () => {},
              {
                serenaAuthorization: context.serenaAuthorization,
                serenaOperation: context.operation,
                currentOperation: context.currentOperation,
                serenaSignal: context.signal,
                onSerenaStage: context.onSerenaStage,
                ...(context.serenaRevalidator ? { serenaRevalidator: context.serenaRevalidator } : {}),
                ...(context.serenaOwnedRoot ? { serenaOwnedRoot: context.serenaOwnedRoot } : {}),
              } as any,
            );
            const result = installResults[0];
            if (!result) {
              return {
                actionId: action.id,
                status: "failed" as const,
                message: "Serena setup returned no result.",
                diagnostics: ["Serena setup returned no result."],
                serenaOutcome: "failed" as const,
                serenaStage: "validating-serena" as const,
              };
            }
            const status = result.status === "installed" || result.status === "reused"
              ? "executed"
              : result.status === "cancelled"
                ? "skipped"
                : "failed";
            return {
              actionId: action.id,
              status: status as RunnerActionRunResult["status"],
              message: result.message ?? "Serena setup completed.",
              diagnostics: [],
              serenaOutcome: result.serenaBootstrapOutcome ?? (result.status === "reused" ? "reused" : result.status === "installed" ? "installed" : result.status === "cancelled" ? "cancelled" : "failed"),
              serenaStage: result.serenaStage ?? "validating-serena",
              serenaReadiness: result.serenaReadiness,
            } as RunnerActionRunResult & { serenaReadiness?: unknown };
          }

          // Keep installation/reuse and MCP configuration on the same adapter
          // instance. The adapter retains current-operation readiness privately;
          // bypassing it here split the production flow and could leave a legacy
          // bare `serena` command untouched even though setup appeared complete.
          return runSerenaAdapterAction(
            adapter,
            action,
            context,
            dashboardState,
            dashboardState.runtime.runnerCommand,
          );
        }

        // Preserve the adapter's raw identified outcome. In particular,
        // `already-present` is Serena reuse, not cancellation; the shared
        // action runner projects that outcome and then allows the evidence-
        // gated MCP action to consume the adapter's retained readiness.
        return runSerenaAdapterAction(
          adapter,
          action,
          context,
          dashboardState,
          dashboardState.runtime.runnerCommand,
        );
      };
      const results = await runRunnerReviewPlan(dashboardState.plan!, {
        projectRoot: projectRoot,
        runnerCommand: dashboardState.runtime.runnerCommand,
        piCommand: "pi",
        installInternalRunnerPackages: async (piCmd: string | undefined, installActions: Array<{ packageId: string; name: string; source: string; installKind: string; reason: string }>, onResult: (result: { success: boolean; message?: string }) => void) => {
          log(`installInternalRunnerPackages (Pi): installing \${installActions.map((a: any) => a.packageId).join(", ")}`);
          const results = await installInternalRunnerPackages(piCmd ?? "pi", installActions as any, (r) => { onResult(r); });
          
          // After install, merge settings to replace stale packages
          const homeDir = process.env.HOME ?? "";
          const settingsPath = `${homeDir}/.pi/agent/settings.json`;
          try {
            if (require("node:fs").existsSync(settingsPath)) {
              const settings = JSON.parse(require("node:fs").readFileSync(settingsPath, "utf-8"));
              const mergeResult = mergeSettingsPackages({
                settingsPath,
                existingPackages: settings.packages || [],
                readFile: (p) => require("node:fs").readFileSync(p, "utf-8"),
                writeFile: (p, c) => require("node:fs").writeFileSync(p, c),
              });
              log(`mergeSettingsPackages: ${mergeResult.diagnostics.join(", ")}`);
            }
          } catch (err) {
            log(`mergeSettingsPackages error: ${(err as Error).message}`);
          }
          
          return results;
        },
        dashboardState,
        packageInstructionIds: adapter.packageInstructionIds,
        runnerId: adapter.runnerId,
        operationId: currentOperation?.operationId,
        currentOperation,
        serenaAuthorization,
        signal: controller.signal,
        onSerenaStage: (stage: RunnerSerenaStage) => {
          if (cancelled || controller.signal.aborted) return;
          setDashboardSerenaStages((current) => current.includes(stage) ? current : [...current, stage]);
        },
        runnerAction: runSerenaAction,
        supermemoryToken: dashboardState.adaptiveMemory.supermemory?.hasToken ? supermemorySetup.token.trim() || undefined : undefined,
         memoryProvider: resolvedMemoryProvider,
         resolvedMemoryProvider,
         webSearchProvider: dashboardState.webSearchProviderDescriptor,
         writeMcpConfig: async (options: { serverName: string; token?: string; type?: "local" | "remote"; command?: string[]; url?: string; headers?: Record<string, string>; webSearchProvider?: import("@deck/core").WebSearchProviderDescriptorV1 }, serenaContext?: RunnerSerenaActionContext) => {
          // For Pi runner, use the adapter's runAction for write-pi-mcp-config to write ALL MCP configs
           if (dashboardState.runnerScope === "pi" && (options.serverName === "context-mode" || options.serverName === "codebase-memory-mcp" || options.serverName === "serena" || options.serverName === "context7" || options.serverName === "codebase-memory" || options.serverName === options.webSearchProvider?.semanticServerId)) {
            const action = {
              id: `capability.${options.serverName}.mcp-config`,
              kind: "write-pi-mcp-config" as const,
              title: `Configure ${options.serverName} MCP`,
              capabilityId: options.serverName,
            };
            // Convert to RunnerAction format expected by adapter
            const piAction: import("@deck/core").RunnerAction = {
              id: action.id,
              kind: action.kind,
              title: action.title,
              capabilityId: action.capabilityId,
              status: "ready" as const,
            };
            const actionResult = await adapter.runAction(piAction as any, {
              projectRoot,
              runnerId: serenaContext?.runnerId ?? adapter.runnerId,
              environmentId: serenaContext?.environmentId ?? environmentId,
              operation: serenaContext?.operation,
              currentOperation: serenaContext?.currentOperation,
              operationId: serenaContext?.operationId,
              serenaAuthorization: serenaContext?.serenaAuthorization,
               serenaReadiness: serenaContext?.serenaReadiness,
               webSearchProvider: options.webSearchProvider,
              signal: serenaContext?.signal ?? controller.signal,
              runnerCommand: dashboardState.runtime.runnerCommand,
              dashboardState,
            } as any);
            return {
              ok: actionResult.status === "executed",
              path: `${process.env.HOME ?? "/home/kevinlb"}/.pi/agent/mcp.json`,
              diagnostics: [...(actionResult.diagnostics ?? [])],
            };
          }
          // Fall back to default behavior for OpenCode or supermemory
           return adapter.writeMcpConfig?.(options) ?? { ok: false, path: "", diagnostics: ["No MCP config writer available"] };
        },
        installPackages: async (runnerCommand: string | undefined, packages: Array<{ id: string; name: string; source: string }>, onResult: (result: RunnerPackageInstallResult) => void): Promise<RunnerPackageInstallResult[]> => {
          // For Pi runner, delegate to the adapter's existing action path; keep its behavior unchanged.
          if (dashboardState.runnerScope === "pi") {
            log(`installPackages (Pi): delegating to adapter.runAction for ${packages.map(p => p.id).join(", ")}`);
            const results: RunnerPackageInstallResult[] = [];

            for (const pkg of packages) {
              const action: import("@deck/core").RunnerAction = {
                id: `capability.${pkg.id}.install`,
                kind: "install-pi-package" as const,
                title: `Install ${pkg.name}`,
                capabilityId: pkg.id,
                toolId: pkg.id,
                source: pkg.source,
                status: "ready" as const,
              };

              try {
                const actionResult = await adapter.runAction(action as any, { runnerCommand: "pi" } as any);
                const outcome: RunnerPackageInstallResult["outcome"] = actionResult.status === "executed"
                  ? "executed"
                  : actionResult.status === "failed"
                    ? "failed"
                    : "skipped";
                const result: RunnerPackageInstallResult = {
                  id: pkg.id,
                  outcome,
                  success: outcome === "executed",
                  message: actionResult.message || (outcome === "executed" ? `Installed ${pkg.id}` : `Failed to install ${pkg.id}`),
                  ...(actionResult.diagnostics?.length ? { cause: actionResult.diagnostics[0] } : {}),
                };
                results.push(result);
                onResult(result);
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                log(`installPackages (Pi): error for ${pkg.id}: ${errorMsg}`);
                const result: RunnerPackageInstallResult = {
                  id: pkg.id,
                  outcome: "failed",
                  success: false,
                  message: errorMsg,
                };
                results.push(result);
                onResult(result);
              }
            }

            log(`installPackages (Pi): results=${results.map(r => `${r.success ? "ok" : "fail"}`).join(",")}`);
            return results;
          }

          const projectOpenCodeResult = (result: OpenCodeToolInstallResultExact): RunnerPackageInstallResult => ({
            id: result.toolId,
            outcome: result.outcome,
            success: result.success,
            message: result.message,
            installerInvoked: result.installerInvoked,
            ...(result.cause ? { cause: result.cause } : {}),
            ...(result.diagnostic ? {
              diagnostic: {
                stage: result.diagnostic.stage,
                code: result.diagnostic.code,
                ...(result.diagnostic.exitCode === undefined ? {} : { exitCode: result.diagnostic.exitCode }),
                lines: [...result.diagnostic.lines],
              },
            } : {}),
          });

          // OpenCode package identity is the exact catalog/tool ID; display names are not lookup keys.
          log(`installPackages (OpenCode): installing ${packages.map(p => `${p.id}(${p.source})`).join(", ")}`);
          const selectedToolIds = packages.map(p => p.id).filter(Boolean);
          const toolsToInstall = OPENCODE_INSTALLABLE_TOOLS.filter(t => selectedToolIds.includes(t.id));
          log(`installPackages (OpenCode): matched ${toolsToInstall.length}/${selectedToolIds.length} tools from catalog`);

          if (toolsToInstall.length === 0) {
            return packages.map((pkg) => ({
              id: pkg.id,
              outcome: "failed" as const,
              success: false,
              message: `No installable OpenCode tool matched id "${pkg.id}".`,
            }));
          }

          const installResults = await installOpenCodeTools(
            runnerCommand ?? "opencode",
            toolsToInstall,
            (result) => onResult(projectOpenCodeResult(result)),
            undefined,
            {
              projectRoot,
              evidenceContext: createOpenCodeEvidenceContext({ projectRoot }),
            },
          );

          // Preserve every returned result so the action runner can reject unknown/duplicate IDs.
          const results = installResults.map(projectOpenCodeResult);
          for (const pkg of packages) {
            if (!installResults.some((result) => result.toolId === pkg.id)) {
              results.push({
                id: pkg.id,
                outcome: "failed",
                success: false,
                message: `No package result returned for tool ID "${pkg.id}".`,
              });
            }
          }

          log(`installPackages (OpenCode): results=${results.map(r => `${r.id}:${r.outcome}`).join(",")}`);
          return results;
        },
        installTeamBundle: async (projectRoot: string, options?: { memoryProvider?: AdaptiveMemoryProvider; modelAssignments?: DeveloperTeamModelAssignments; thinkingAssignments?: DeveloperTeamThinkingAssignments; capabilityIds?: readonly string[] }) => {
          // Build capability instructions through the active adapter's registered runner ID.
          const deckConfig = requiredConfigStore.readRequired();
          const enabledIds = getEnabledCapabilityInstructionIds(deckConfig, adapter.runnerId);
          const capabilityInstructions = buildCapabilityInstructionBundle(
            getEnabledSupportedCapabilityInstructionIds(adapter, enabledIds),
          );

          const { plan } = await prepareAndBuildDeveloperTeamInstallPlan(adapter, {
            projectRoot,
            environmentId,
            modelAssignments: options?.modelAssignments,
            thinkingAssignments: options?.thinkingAssignments,
            memoryProvider: options?.memoryProvider,
            capabilityInstructions,
            capabilityIds: options?.capabilityIds,
            deckConfig,
          });

          const backup = adapter.backupDeveloperTeamFiles(plan);

          try {
            const applyResult = await adapter.applyDeveloperTeamInstall({
              projectRoot,
              plan,
              environmentId,
            });

            const verifyResult = await adapter.verifyDeveloperTeamInstall(plan);
            if (!verifyResult.valid) {
              await rollbackOrThrow(adapter, backup);
              const diagnosticsMsg =
                verifyResult.diagnostics.length > 0
                  ? `\nDetails: ${verifyResult.diagnostics.slice(0, 3).join("; ")}${verifyResult.diagnostics.length > 3 ? ` (+${verifyResult.diagnostics.length - 3} more)` : ""}`
                  : "";
              const failMsg = `Verification failed. Changes rolled back.${diagnosticsMsg}`;
              log(`[runDashboardInstall] verifyResult.valid=false diagnostics=${JSON.stringify(verifyResult.diagnostics)}`);
              throw new Error(failMsg);
            }

            return {
              results: applyResult.results,
              verificationEvidence: verifyResult.verificationEvidence ?? [],
              postInstallFollowUps: verifyResult.postInstallFollowUps ?? [],
            };
          } catch (error) {
            await rollbackOrThrow(adapter, backup);
            throw error instanceof Error ? error : new Error(String(error));
          }
        },
        onActionResult: (result: RunnerActionRunResult) => {
          if (!cancelled) setDashboardActionResults((current) => [...current, result]);
        },
      } as any);

      log(`runDashboardInstall: runRunnerReviewPlan DONE. results=${results.length} cancelled=${cancelled} duration=${Date.now() - executionStart}ms`);
      
      // Log detailed action result counters
      const statusCounts = { executed: 0, failed: 0, skipped: 0, informational: 0 };
      const configWriteResults: string[] = [];
      for (const r of results) {
        statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
        if (r.actionId.includes("mcp-config") || r.actionId.includes("pi-mcp-config")) {
          configWriteResults.push(`${r.actionId}:${r.status}`);
        }
      }
      log(`runDashboardInstall: RESULT counters - executed=${statusCounts.executed}, failed=${statusCounts.failed}, skipped=${statusCounts.skipped}, informational=${statusCounts.informational}`);
      if (configWriteResults.length > 0) {
        log(`runDashboardInstall: configWrites - ${configWriteResults.join(", ")}`);
      }
      
      // After execution, verify and log MCP config state
      const homeDir = process.env.HOME ?? "";
      const mcpConfigPath = `${homeDir}/.pi/agent/mcp.json`;
      const settingsPath = `${homeDir}/.pi/agent/settings.json`;
      try {
        if (require("node:fs").existsSync(mcpConfigPath)) {
          const mcpConfig = JSON.parse(require("node:fs").readFileSync(mcpConfigPath, "utf-8"));
          const mcpServers = Object.keys(mcpConfig.mcpServers ?? {}).sort().join(", ");
          log(`runDashboardInstall: mcp.json servers after install: ${mcpServers || "(empty)"}`);
        }
        if (require("node:fs").existsSync(settingsPath)) {
          const settings = JSON.parse(require("node:fs").readFileSync(settingsPath, "utf-8"));
          const packages = (settings.packages ?? []).filter((p: string) => p.includes("context7")).join(", ");
          log(`runDashboardInstall: settings.json context7 packages: ${packages || "(none)"}`);
        }
      } catch (e) {
        log(`runDashboardInstall: post-install verification error: ${(e as Error).message}`);
      }

      if (!cancelled) {
        setDashboardActionResults(results);
        const terminalSerenaResult = [...results].reverse().find((result) => result.serenaOutcome);
        if (terminalSerenaResult?.serenaOutcome) setDashboardSerenaOutcome(terminalSerenaResult.serenaOutcome);
        const resultStages = results
          .map((result) => result.serenaStage)
          .filter((stage): stage is RunnerSerenaStage => Boolean(stage));
        if (resultStages.length > 0) {
          setDashboardSerenaStages((current) => [...new Set([...current, ...resultStages])]);
        }
        setDashboardCompletionStatus(getDashboardCompletionStatus());
        clearDashboardSupermemoryEphemeralState();
        setDashboardState((current) => reduceRunnerDashboard(current, { type: "complete" }, dashboardPlanBuilder));
        log(`runDashboardInstall: state set to complete`);
      }
    }

    const installPromise = runDashboardInstall().catch((err) => {
      const msg = `[runDashboardInstall] FAILED: ${err instanceof Error ? err.stack : String(err)}`;
      log(msg);
      console.error(msg);
    }).finally(() => {
      dashboardInstallActiveRef.current = false;
      dashboardAbortControllerRef.current = null;
      if (dashboardExitRequestedRef.current) {
        dashboardExitRequestedRef.current = false;
        exit();
      }
    });
    void installPromise;

    return () => {
      cancelled = true;
      controller.abort();
      clearDashboardSupermemoryEphemeralState();
    };
  }, [dashboardState.screen, dashboardState.plan, dashboardState.runtime.runnerCommand, screen, supermemorySetup.token, selectedEnvironments, installedOpenCode?.command, openCodePreflight]);

  // T3.5: orchestrator effect — fires when the user has confirmed the
  // upgrade. Calls `runUpgradeOrchestrator` with the captured
  // descriptor. The orchestrator returns once; we update the progress
  // status to the matching terminal state (completed / failed /
  // rolled_back) so the progress screen can render the outcome.
  useEffect(() => {
    if (screen !== "upgrade-progress") return;
    if (!upgradeDescriptor) {
      // No descriptor to apply — should not happen because the
      // confirm screen is the only way to reach this state.
      setUpgradeProgress({ kind: "failed", reason: "No release descriptor available." });
      return;
    }

    let cancelled = false;
    setUpgradeProgress({ kind: "running", phase: "Downloading", completedCount: 0 });

    // Tick a coarse UI phase progress while the orchestrator runs.
    // The orchestrator returns only when finished, so this is purely
    // cosmetic — the actual upgrade work happens in the orchestrator.
    const phases = ["Staging", "Migrating", "Replacing binary", "Syncing content", "Verifying"];
    const tickers = phases.map((phase, idx) =>
      setTimeout(() => {
        if (cancelled) return;
        setUpgradeProgress((current) =>
          current.kind === "running" ? { kind: "running", phase, completedCount: idx + 1 } : current,
        );
      }, 800 * (idx + 1)),
    );

    const run = async () => {
      try {
        const currentVersion = getBuildInfo().version;
        // T11: Use real registry and caller-resolved global config (not placeholders)
        const realRegistry = createDefaultAdapterRegistry();
        const resolvedConfig = requiredConfigStore.readRequired();
        await stageReleaseAssets(upgradeDescriptor);
        const result = await runUpgradeOrchestrator({
          descriptor: upgradeDescriptor,
          targetVersion: upgradeDescriptor.version,
          currentVersion,
          deps: {
            installKind: detectInstallKind(),
            // Use process.execPath to correctly identify installed binary path.
            // In compiled Bun binaries, process.argv[0] can be "bun" while
            // process.execPath contains the actual binary path.
            currentBinaryPath: process.execPath ?? process.argv[0] ?? "",
            projectRoot: localResolvedProjectRoot ?? process.cwd(),
            // T11: Real registry with real adapters (pi, opencode)
            adapterRegistry: realRegistry,
            // T11: Real config (not default placeholder)
            readGlobalDeckConfig: () => resolvedConfig,
          },
        });
        if (cancelled) return;
        // T12: Map detailed outcomes to UI status
        if (result.status === "rolled_back") {
          // Build reason from binary/content outcomes
          let reason = "Upgrade failed; rolled back to the previous version.";
          if (result.binary.status !== "skipped" && result.binary.status !== "completed") {
            reason = `Binary ${result.binary.status}: rolled back.`;
          } else if (result.content.status === "partial_failure") {
            reason = "Content sync partial failure; rolled back.";
          }
          setUpgradeProgress({
            kind: "rolled_back",
            ...(result.backupId ? { backupId: result.backupId } : {}),
            reason,
          });
          return;
        }
        if (result.status === "partial_failure") {
          // T12: Show detailed failure info - binary was updated, some runners failed
          let reason = "One or more runners failed to sync.";
          const failedRunners: string[] = [];
          const succeededRunners: string[] = [];
          if (result.content.status === "partial_failure" && result.content.outcomes) {
            for (const outcome of result.content.outcomes) {
              const status = outcome.status as string;
              if (status === "failed" || status === "error") {
                failedRunners.push(outcome.runnerId);
              } else if (status === "completed" || status === "skipped" || status === "synced") {
                succeededRunners.push(outcome.runnerId);
              }
            }
            if (failedRunners.length > 0) {
              reason = `Failed to sync: ${failedRunners.join(", ")}.`;
            }
          }
          setUpgradeProgress({
            kind: "partial_failure",
            failedRunners,
            succeededRunners,
            ...(result.backupId ? { backupId: result.backupId } : {}),
            reason,
          });
          return;
        }
        setUpgradeProgress({
          kind: "completed",
          version: upgradeDescriptor.version,
          ...(result.backupId ? { backupId: result.backupId } : {}),
        });
      } catch (err) {
        if (cancelled) return;
        const reason = err instanceof Error ? err.message : String(err);
        setUpgradeProgress({ kind: "failed", reason });
        setUpgradeRollbackHint(
          "Run `deck rollback` from the CLI to restore the last backup.",
        );
      }
    };
    void run();

    return () => {
      cancelled = true;
      for (const t of tickers) clearTimeout(t);
    };
  }, [screen, upgradeDescriptor, localResolvedProjectRoot]);

  useEffect(() => {
    if (screen !== "developer-team-installing") return;

    let cancelled = false;

    async function runInstall() {
      // Use require: true for backward compatibility - file ops always need a path
      const projectRoot = projectRootFor({ require: true }) ?? process.cwd();

      // Determine environmentId based on selected environments
      const openCodeExclusive = selectedEnvironments.includes("opencode-development") && !selectedEnvironments.includes("pi-development");
      const environmentId = openCodeExclusive ? "opencode-development" : "pi-development";
      const adapter = adapterFor(environmentId);

      // Build capability instructions and standalone skills (only used by OpenCode, Pi ignores them)
      const deckConfig = requiredConfigStore.readRequired();
      const enabledIds = getEnabledCapabilityInstructionIds(deckConfig, "opencode");
      const capabilityInstructions = enabledIds.length > 0 ? buildCapabilityInstructionBundle(enabledIds) : undefined;
      const standaloneSkills = getStandaloneSkills().map((s: { skillId: string }) => ({ skillId: s.skillId, body: getStandaloneSkillBody(s.skillId)! }));

      const { plan } = await prepareAndBuildDeveloperTeamInstallPlan(adapter, {
        projectRoot,
        environmentId,
        modelAssignments,
        thinkingAssignments,
        memoryProvider,
        capabilityInstructions,
        standaloneSkills,
        deckConfig,
      });

      const backup = adapter.backupDeveloperTeamFiles(plan);

      try {
        const applyResult = await adapter.applyDeveloperTeamInstall({ projectRoot, plan, environmentId });
        const verifyResult = await adapter.verifyDeveloperTeamInstall(plan);

        if (!cancelled) {
          if (!verifyResult.valid) {
            await rollbackOrThrow(adapter, backup);
            setDeveloperTeamResults([]);
            const diagnosticsMsg =
              verifyResult.diagnostics.length > 0
                ? `\nDetails: ${verifyResult.diagnostics.slice(0, 3).join("; ")}${verifyResult.diagnostics.length > 3 ? ` (+${verifyResult.diagnostics.length - 3} more)` : ""}`
                : "";
            const failMsg = `Verification failed. Changes rolled back.${diagnosticsMsg}`;
            log(`[developer-team-installing] verifyResult.valid=false diagnostics=${JSON.stringify(verifyResult.diagnostics)}`);
            setInstallResults((current) => [
              ...current,
              { tool: "Developer Team", success: false, message: failMsg },
            ]);
          } else {
            setDeveloperTeamResults(applyResult.results as any);
          }

          const statuses = detectSelectedRuntimes(selectedEnvironments);
          const hasOpenCodeInstalled = statuses.some((s) => s.runtime === "opencode" && s.installed && s.command);
          const nextEnvironment = openCodeExclusive ? null : (selectedEnvironments.find((e) => e !== "pi-development") ?? null);
          const nextScreen = getNextScreenAfterDeveloperTeamInstall({
            selectedEnvironments,
            nextEnvironment,
          });

          resetCursor(nextScreen);
        }
      } catch (error) {
        if (!cancelled) {
          await rollbackOrThrow(adapter, backup);
          setDeveloperTeamResults([]);
          setInstallResults((current) => [
            ...current,
            {
              tool: "Developer Team",
              success: false,
              message: `Installation failed. Changes rolled back.${error instanceof Error ? ` ${error.message}` : ""}`,
            },
          ]);

          const statuses = detectSelectedRuntimes(selectedEnvironments);
          const hasOpenCodeInstalled = statuses.some((s) => s.runtime === "opencode" && s.installed && s.command);
          const nextEnvironment = openCodeExclusive ? null : (selectedEnvironments.find((e) => e !== "pi-development") ?? null);
          const nextScreen = getNextScreenAfterDeveloperTeamInstall({
            selectedEnvironments,
            nextEnvironment,
          });

          resetCursor(nextScreen);
        }
      }
    }

    runInstall();

    return () => {
      cancelled = true;
    };
  }, [screen, selectedEnvironments, openCodePreflight, modelAssignments, thinkingAssignments, memoryProvider]);

  function resetCursor(nextScreen: Screen, nextCursor = 0) {
    setScreen(nextScreen);
    setCursor(nextScreen === "home" ? homeCursor : nextCursor);
    if (nextScreen === "agent-model-config-list") setAgentConfigCursor(0);
    if (nextScreen === "developer-team-review") setDeveloperTeamCursor(0);
  }

  async function composeRegisteredRunnerDashboard(environmentId: EnvironmentId): Promise<boolean> {
    const adapter = adapterRegistry.resolveByEnvironment(environmentId);
    if (!adapter) return false;

    const projectRoot = projectRootFor({ require: true }) ?? process.cwd();
    const config = requiredConfigStore.readRequired();
    setDashboardError(null);

    try {
      const [runtimes, inspection, toolsReview, inventory] = await Promise.all([
        adapter.detectRuntimes({ projectRoot, environmentId }),
        adapter.inspectProject ? adapter.inspectProject(projectRoot) : adapter.inspectEnvironment(),
        adapter.reviewTools(),
        adapter.getCapabilityInventory({ projectRoot, environmentId, runnerId: adapter.runnerId, deckConfig: config }),
      ]);
      const normalizedInventory = normalizeDashboardCapabilityInventory(inventory, adapter.runnerId, environmentId);
      if (!normalizedInventory.ok) {
        setDashboardInventory(null);
        setDashboardEnvironmentId(environmentId);
        setDashboardError(`[dashboard inventory error] ${normalizedInventory.diagnostic.message}`);
        setDashboardState(createDefaultRunnerDashboardState({
          runnerScope: adapter.runnerId,
          runnerDisplayName: adapter.displayName,
          runnerUi: adapter.ui,
          runtime: { inspectionState: "blocked", diagnostics: [normalizedInventory.diagnostic.message] },
          packageInstructions: loadRunnerPackageInstructionsFromConfig(config, adapter.runnerId, adapter.packageInstructionIds),
        }));
        resetCursor("pi-runner-dashboard");
        return true;
      }
      const dashboardCapabilityInventory = normalizedInventory.inventory;
      const webSearchInventoryEntry = dashboardCapabilityInventory.capabilities.find((entry) => entry.capabilityId === "web-search");
      const webSearchProviderDescriptor = webSearchInventoryEntry?.webSearchProvider
        ?? getWebSearchProviderDescriptor(config.webSearch.provider);
      const webSearchEvidence = webSearchInventoryEntry?.webSearchEvidence;
      const webSearchReadiness = webSearchInventoryEntry?.webSearchReadiness;
      const projectInspection = isRunnerProjectInspection(inspection) ? inspection : undefined;
      const selectedTeamIds = new Set(adapter.ui?.dashboard?.defaultSelectedTeamIds ?? []);
      const teams = Object.fromEntries(adapter.getTeams(environmentId).map((team) => [team.id, {
        teamId: team.id,
        label: team.displayName,
        selected: selectedTeamIds.has(team.id),
      }]));
      const executionClass = adapter.ui?.dashboard?.executionClass;
      const routeEvidence = projectInspection?.evidence;
      const unavailable = projectInspection?.state === "unsupported"
        ? "unsupported"
        : projectInspection?.state === "blocked"
          ? "blocked"
          : undefined;
      const classifyRoute = (supported: boolean): "first-class" | "static-compatible" | "unsupported" | "blocked" =>
        unavailable ?? (supported && executionClass ? executionClass : "unsupported");
      const executionRoutes: RunnerDashboardState["runtime"]["executionRoutes"] = executionClass && routeEvidence
        ? {
            interactive: classifyRoute(routeEvidence.interactive === true),
            exec: classifyRoute(routeEvidence.exec === true),
            "resume-by-id": classifyRoute(routeEvidence.resume === true),
            "resume-latest": classifyRoute(routeEvidence.resumeLatest === true),
          }
        : undefined;
      dashboardOperationSequenceRef.current += 1;
      const operation = nextRunnerOperation(adapter.runnerId, dashboardOperationSequenceRef.current);

      setDashboardInventory(dashboardCapabilityInventory);
      setDashboardEnvironmentId(environmentId);
      setDashboardState(createDefaultRunnerDashboardState({
        runnerScope: adapter.runnerId,
        runnerDisplayName: adapter.displayName,
        runnerUi: adapter.ui,
         selectedCapabilities: { "web-search": config.webSearch.enabled },
         webSearchProvider: config.webSearch.provider,
         webSearchProviderDescriptor,
         webSearch: {
           provider: config.webSearch.provider,
           credentialAvailable: webSearchEvidence?.credentialAvailable ?? false,
           runnerSupported: webSearchEvidence?.runnerSupported ?? false,
           mcpConfigured: webSearchEvidence?.mcpConfigured ?? false,
           mcpConfigConflict: webSearchEvidence?.mcpConfigConflict ?? false,
           readiness: webSearchReadiness?.state ?? "disabled",
         },
        runtime: {
          runnerCommand: runtimes.find((runtime) => runtime.isAvailable)?.runtimeId ?? runtimes[0]?.runtimeId ?? adapter.runnerId,
          preflight: inspection,
          toolsReview,
          inspectionState: projectInspection?.state,
          diagnostics: projectInspection?.diagnostics.map((diagnostic) => diagnostic.message)
            ?? runtimes.flatMap((runtime) => runtime.diagnostics ?? []),
          ...(executionRoutes ? { executionRoutes } : {}),
        },
        operationId: operation.operationId,
        currentOperation: operation,
        capabilityStatuses: Object.fromEntries(dashboardCapabilityInventory.capabilities.map((entry) => [
          entry.capabilityId,
          entry.isBlocked ? "blocked" : entry.isInstalled ? "ready" : "missing",
        ])),
        teams,
        packageInstructions: loadRunnerPackageInstructionsFromConfig(config, adapter.runnerId, adapter.packageInstructionIds),
      }));
      setDashboardActionResults([]);
      setDashboardSerenaStages([]);
      setDashboardSerenaOutcome(undefined);
      setDashboardCancellationRequested(false);
      resetCursor("pi-runner-dashboard");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDashboardInventory(null);
      setDashboardEnvironmentId(environmentId);
      setDashboardError(`[dashboard preflight error] ${message}`);
      setDashboardState(createDefaultRunnerDashboardState({
        runnerScope: adapter.runnerId,
        runnerDisplayName: adapter.displayName,
        runnerUi: adapter.ui,
        runtime: { inspectionState: "blocked", diagnostics: [message] },
        packageInstructions: loadRunnerPackageInstructionsFromConfig(config, adapter.runnerId, adapter.packageInstructionIds),
      }));
      resetCursor("pi-runner-dashboard");
      return true;
    }
  }

  /**
   * Build the `RollbackAvailability` argument for `getHomeMenuOptions`
   * from the discovered manifest. Returns `null` when no backup is
   * available so the menu hides the "Roll back Deck" entry.
   */
  function rollbackAvailability(): { backupId: string; version: string } | null {
    if (!rollbackManifest) return null;
    return {
      backupId: rollbackManifest.backupId,
      version: rollbackManifest.deckVersionBefore,
    };
  }

  function getCursorLimit(): number {
    if (screen === "home") return getHomeMenuOptions(releaseCheck, rollbackAvailability()).length - 1;
    if (screen === "upgrade-confirm") return 1; // Apply, Cancel
    if (screen === "upgrade-progress") return 0;
    if (screen === "rollback-confirm") return 1; // Run rollback, Cancel
    if (screen === "rollback-progress") return 0;
    if (screen === "model-environment-selection") return environmentOptions.length - 1;
    if (screen === "model-team-selection") {
      const env = selectedModelEnvironment ?? "pi-development";
      const teams = adapterFor(env).getTeams(env) as any[];
      return Math.max(0, teams.length - 1);
    }
    if (screen === "environment-selection") return environmentOptions.length - 1;
    if (screen === "optional-tools") return getAdapter("pi").getSelectableTools().length - 1;
    if (screen === "installation-review") return 1;
    if (screen === "team-selection") return Math.max(0, getAdapter("pi").getTeams("pi-development").length - 1);
    if (screen === "memory-provider-selection") return 2;
    if (screen === "developer-team-review") return 1;
    if (screen === "agent-model-config-list") return DEVELOPER_TEAM_AGENTS.length;
    if (screen === "model-provider-selection") return Math.max(0, detectedProviders.length - 1);
    if (screen === "model-selection") return Math.max(0, providerModels.length - 1);
    if (screen === "agent-model-assignment") {
      const adapter = adapterFor(modelConfigRuntime);
      const supportsThinking = selectedModel
        ? getActiveThinkingLevels(selectedModel.id).length > 0 && adapter.supportsThinking(selectedModel.id)
        : false;
      if (!selectedModel || !supportsThinking) return 0;
      const thinkingLevels = getActiveThinkingLevels(selectedModel.id);
      return Math.max(0, thinkingLevels.length - 1);
    }
    if (screen === "opencode-model-discovery") return openCodeDiscovery.kind === "loading" ? 0 : 1;
    if (screen === "codex-model-discovery") return codexDiscovery.kind === "loading" ? 0 : 1;
    if (screen === "no-providers") return 0;
    if (screen === "personality-selection") return 1; // 2 options: guia, pragmatica
    if (screen === "configure-packages-runner-selection") return runnerOptions.length - 1;
    if (screen === "configure-packages-detail") return configurePackageRows.length + 1; // optional packages + Apply + Back
    return 0;
  }

  function moveCursor(delta: number) {
    const limit = getCursorLimit();
    const next = Math.min(limit, Math.max(0, cursor + delta));
    setCursor(next);
    if (screen === "home") setHomeCursor(next);
    if (screen === "model-environment-selection") setModelEnvironmentCursor(next);
    if (screen === "model-team-selection") setModelTeamCursor(next);
    if (screen === "agent-model-config-list") setAgentConfigCursor(next);
    if (screen === "developer-team-review") setDeveloperTeamCursor(next);
    if (screen === "configure-packages-runner-selection") setConfigurePackagesCursor(next);
    if (screen === "configure-packages-detail") setConfigurePackagesCursor(next);
    if (screen === "upgrade-confirm") setUpgradeCursor(next);
    if (screen === "rollback-confirm") setRollbackCursor(next);
  }

  function toggleCurrent() {
    if (screen === "environment-selection") {
      const option = environmentOptions[cursor];
      if (!option) return;
      const id = option.value as EnvironmentId;
      setSelectedEnvironments((current) =>
        current.includes(id) ? current.filter((environment) => environment !== id) : [...current, id],
      );
      return;
    }

    if (screen === "team-selection") {
      const teams = getAdapter("pi").getTeams("pi-development") as any[];
      const team = teams[cursor];
      if (!team) return;
      setSelectedTeams((current) =>
        current.includes(team.id) ? current.filter((id) => id !== team.id) : [...current, team.id],
      );
      return;
    }

    if (screen === "optional-tools") {
      const tool = getAdapter("pi").getSelectableTools()[cursor] as any;
      if (!tool) return;
      setSelectedOptionalTools((current) =>
        current.includes(tool.id) ? current.filter((selected) => selected !== tool.id) : [...current, tool.id],
      );
    }

    if (screen === "configure-packages-detail") {
      const pkg = configurePackageRows[configurePackagesCursor];
      if (!pkg) return;
      setConfigurePackagesToggles((current) => ({
        ...current,
        [pkg.id]: !current[pkg.id],
      }));
    }
  }

  async function continueFromCurrent() {
    if (screen === "home") {
      const action = getHomeMenuOptions(releaseCheck, rollbackAvailability())[homeCursor]?.value;
      if (action === "start-installation") resetCursor("environment-selection");
      if (action === "configure-packages") {
        setConfigurePackagesRunner(null);
        setConfigurePackagesCursor(0);
        resetCursor("configure-packages-runner-selection");
        return;
      }
      if (action === "update-deck") {
        // T3.1: the upgrade-tools placeholder is now a real action.
        // We always allow entering the upgrade confirm flow even if
        // the release check has not resolved yet (the screen itself
        // will gracefully render an empty item list and the user can
        // back out). The most useful path is "check resolved to
        // available" which captures the full descriptor.
        if (releaseCheck.kind === "available") {
          setUpgradeDescriptor(releaseCheck.descriptor);
          setUpgradeCursor(0);
          setUpgradeBinarySkipped(detectInstallKind() === "homebrew");
          setUpgradeRollbackHint(undefined);
          resetCursor("upgrade-confirm");
          return;
        }
        // Pending / none / network-error: surface a hint and stay on
        // home. This keeps the TUI responsive and matches REQ-TUI-007
        // (no banner / no upgrade option when the check failed).
        addLog(
          releaseCheck.kind === "pending"
            ? "Release check still running; try again in a moment."
            : releaseCheck.kind === "network-error"
              ? `Release check failed (${releaseCheck.error}); cannot upgrade.`
              : "No upgrade available."
        );
        return;
      }
      if (action === "configure-models") {
        setModelConfigSource("menu");
        resetCursor("model-environment-selection");
        return;
      }
      if (action === "doctor") resetCursor("doctor");
      if (action === "exit") exit();
      // REQ-RBK-002: user-initiated rollback entry point in the TUI.
      // The option is only rendered when a restorable backup exists,
      // so a non-null `rollbackManifest` is guaranteed when the user
      // picks this row. The confirm screen shows backup metadata; the
      // apply handler lives in the rollback-confirm branch below.
      if (action === "rollback-deck") {
        if (!rollbackManifest) {
          addLog("No backup available to roll back to.");
          return;
        }
        setRollbackCursor(0);
        setRollbackStatus({ mode: "confirm" });
        resetCursor("rollback-confirm");
        return;
      }
      return;
    }

    if (screen === "model-environment-selection") {
      const option = environmentOptions[modelEnvironmentCursor];
      if (!option) return;
      const environment = option.value as EnvironmentId;
      setSelectedModelEnvironment(environment);

      if (adapterRegistry.resolveByEnvironment(environment)) {
        resetCursor("model-team-selection");
      } else {
        resetCursor("complete");
      }
      return;
    }

    if (screen === "model-team-selection") {
      const env = selectedModelEnvironment ?? "pi-development";
      const teams = adapterFor(env).getTeams(env) as any[];
      const team = teams[modelTeamCursor];
      if (!team) return;

      if (team.id === "developer-team") {
        const selectedAdapter = adapterFor(env);
        const runtime = selectedAdapter.runnerId;
        const isO = runtime === "opencode";
        setModelConfigRuntime(runtime);
        hydrateDeveloperTeamModelConfig(runtime);

        if (isO) {
          startOpenCodeModelDiscovery();
        } else if (runtime === "codex") {
          startCodexModelDiscovery();
        } else if (selectedAdapter.getModelInventory) {
          const result = await selectedAdapter.getModelInventory({ projectRoot: localResolvedProjectRoot ?? process.cwd(), mode: "prefer-cache" });
          const inventory = buildTuiInventoryFromAdapterInventory(result && result.state !== "blocked" ? result.inventory : null);
          setDetectedProviders(inventory.providers);
          setModelsByProvider(inventory.modelsByProvider);
          resetCursor(inventory.providers.length > 0 ? "agent-model-config-list" : "no-providers");
        } else {
          const inventory = detectPiModelInventoryForTui();
          setDetectedProviders(inventory.providers);
          setModelsByProvider(inventory.modelsByProvider);
          if (inventory.providers.length === 0) {
            resetCursor("no-providers");
          } else {
            resetCursor("agent-model-config-list");
          }
        }
      }
      return;
    }

    if (screen === "environment-selection") {
      debug(`continueFromCurrent: environment-selection screen, selectedEnvironments.length=${selectedEnvironments.length}`);
      if (selectedEnvironments.length === 0) { debug("continueFromCurrent: no env selected, returning"); return; }
      const nextScreen = getNextScreenAfterEnvironmentSelection({
        selectedEnvironments,
        hasPiCommand: true, // not used by this helper
        nextEnvironment: selectedEnvironments[0] ?? null,
      });
      // Default cursor to Pragmática (index 1) on personality-selection screen
      resetCursor(nextScreen, nextScreen === "personality-selection" ? 1 : 0);
      return;
    }

    if (screen === "personality-selection") {
      const personalities: Array<{ id: "guia" | "pragmatica"; label: string }> = [
        { id: "guia", label: "Guía" },
        { id: "pragmatica", label: "Pragmática" },
      ];
      const selected = personalities[cursor];
      if (!selected) return;
      setSelectedPersonality(selected.id);
      try {
        requiredConfigStore.patch((existingConfig) => ({ ...existingConfig, orchestratorPersonality: selected.id }));
      } catch (error) {
        // Log config errors with error code only (no sensitive details)
        const errCode = error instanceof Error ? (error as { code?: string }).code : undefined;
        debug(`personality-selection config error: ${errCode ?? "UNKNOWN"}`);
        // Stay on screen, user can retry
        return;
      }
      const environmentId = selectedEnvironments.find((candidate) => adapterRegistry.resolveByEnvironment(candidate));
      if (!environmentId || !await composeRegisteredRunnerDashboard(environmentId)) resetCursor("complete");
      return;
    }

    if (screen === "configure-packages-runner-selection") {
      const selected = resolveRunnerMenuSelection(adapterRegistry, runnerOptions, configurePackagesCursor);
      if (!selected) {
        resetCursor("home");
        return;
      }
      const runner = selected.runnerId;
      const adapter = adapterRegistry.tryGet(runner);
      if (!adapter) {
        resetCursor("home");
        return;
      }
      const config = requiredConfigStore.readRequired();
      const instructions = loadRunnerPackageInstructionsFromConfig(config, runner, adapter.packageInstructionIds);
      const supportedMetadata = getSupportedPackageInstructionMetadata(adapter);
      setConfigurePackagesRunner(runner);
      setConfigurePackagesCursor(0);
      setConfigurePackagesToggles(packageInstructionTogglesFromConfig(supportedMetadata, instructions));
      resetCursor("configure-packages-detail");
      return;
    }

    if (screen === "configure-packages-detail") {
      const options = [
        ...configurePackageRows.map((entry) => ({ id: entry.id })),
        { id: "apply" },
        { id: "back" },
      ];
      const selected = options[configurePackagesCursor];
      if (!selected) return;

      if (selected.id === "back") {
        setConfigurePackagesRunner(null);
        setConfigurePackagesCursor(0);
        resetCursor("configure-packages-runner-selection");
        return;
      }

      if (selected.id === "apply" && configurePackagesRunner) {
        const adapter = configurePackagesAdapter;
        if (!adapter) return;
        const projectRoot = projectRootFor({ require: true }) ?? process.cwd();
        const updatedConfig = requiredConfigStore.patch((current) => ({
          ...current,
          packageInstructions: {
            ...current.packageInstructions,
            [configurePackagesRunner]: {
              ...packageInstructionConfigForPersistence(configurePackageMetadata, configurePackagesToggles),
            },
          },
        }));

        const environmentId = adapter.environmentIds[0];
        if (!environmentId) throw new Error(`Runner ${configurePackagesRunner} does not declare an environment.`);

        const configuredInstructionIds = [
          ...getConfiguredPackageInstructionIds(configurePackageMetadata, configurePackagesToggles),
          ...(updatedConfig.webSearch.enabled ? ["web-search" as const] : []),
        ] as Parameters<typeof buildCapabilityInstructionBundle>[0];
        const bundle = buildCapabilityInstructionBundle(configuredInstructionIds);

        // Generar y aplicar plan vía adapter (el adapter lee assignments internamente)
        const standaloneSkills = getStandaloneSkills().map((s: { skillId: string }) => ({ skillId: s.skillId, body: getStandaloneSkillBody(s.skillId)! }));
        const { plan } = await prepareAndBuildDeveloperTeamInstallPlan(adapter, {
          projectRoot,
          environmentId,
          capabilityInstructions: bundle,
          standaloneSkills,
          deckConfig: updatedConfig,
        });

        try {
          const result = await adapter.applyDeveloperTeamInstall({ projectRoot, plan, environmentId });
          const updatedCount = result.results.filter((r) => r.status === "updated").length;
          const createdCount = result.results.filter((r) => r.status === "created").length;
          setDashboardCompletionStatus(
            `Package instructions applied. ${updatedCount} updated, ${createdCount} created.`,
          );
        } catch (error) {
          setDashboardCompletionStatus(
            `Failed to apply: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        setConfigurePackagesRunner(null);
        setConfigurePackagesCursor(0);
        resetCursor("complete");
        return;
      }

      return;
    }

    if (screen === "pi-preflight") return resetCursor("required-tools");
    if (screen === "required-tools") return resetCursor("optional-tools");
    if (screen === "optional-tools") return resetCursor("installation-review");

    if (screen === "installation-review") {
      if (cursor === 0 && installationPlan.length > 0) resetCursor("installing");
      else goToNextEnvironmentOrComplete();
      return;
    }

    if (screen === "team-selection") {
      const hasOpenCode = selectedEnvironments.includes("opencode-development");
      const nextScreen = getNextScreenAfterTeamSelection({
        selectedTeams,
        nextEnvironment: selectedEnvironments[0] ?? null,
      });

      if (nextScreen === "developer-team-review") {
        // Insert model configuration before review
        const runtime = selectedEnvironments
          .map((environmentId) => adapterRegistry.resolveByEnvironment(environmentId)?.runnerId)
          .find((runnerId): runnerId is string => Boolean(runnerId)) ?? "pi";
        setModelConfigRuntime(runtime);
        hydrateDeveloperTeamModelConfig(runtime);
        setModelConfigSource("install");
        if (runtime === "opencode") {
          startOpenCodeModelDiscovery();
        } else if (runtime === "codex") {
          startCodexModelDiscovery();
        } else {
          const inventory = detectPiModelInventoryForTui();
          setDetectedProviders(inventory.providers);
          setModelsByProvider(inventory.modelsByProvider);
          if (inventory.providers.length === 0) resetCursor("no-providers");
          else resetCursor("agent-model-config-list");
        }
        return;
      }

      resetCursor(nextScreen);
      return;
    }

    if (screen === "model-provider-selection") {
      const provider = detectedProviders[cursor];
      if (!provider) return;
      setSelectedProvider(provider);
      const models = modelsByProvider[provider.id] ?? (modelConfigRuntime === "pi" ? listModelsForProvider(provider.id, { runCommand: runPiCommand }) : []);
      setProviderModels(models);
      setSelectedModel(null);
      resetCursor("model-selection");
      return;
    }

    if (screen === "agent-model-config-list") {
      if (modelConfigRuntime === "opencode" && openCodeDiscovery.kind === "stale") {
        resetCursor("opencode-model-discovery");
        return;
      }
      if (modelConfigRuntime === "codex" && codexDiscovery.kind !== "ready") {
        resetCursor("codex-model-discovery");
        return;
      }
      if (cursor === DEVELOPER_TEAM_AGENTS.length) {
        // Finish button
        if (modelConfigSource === "install") {
          // Persist model assignments before moving to next step
          await applyDeveloperTeamModelConfig();
          resetCursor("memory-provider-selection");
        } else if (modelConfigSource === "dashboard") {
          // For OpenCode and Pi, the dashboard plan builder has no team-application actions,
          // so persist model changes to disk immediately on Finish.
          if (modelConfigRuntime === "opencode" || modelConfigRuntime === "pi") {
            await applyDeveloperTeamModelConfig();
          }
          syncDashboardDeveloperTeamModelConfig();
          resetCursor("pi-runner-dashboard");
        } else {
          await applyDeveloperTeamModelConfig();
          resetCursor("complete");
        }
      } else {
        setAgentAssignmentIndex(cursor);
        resetCursor("model-provider-selection");
      }
      return;
    }

    if (screen === "model-selection") {
      const model = providerModels[cursor];
      if (!model) return;

      // Non-Pi variants are runner-owned; Pi keeps its fixed resolver.
      const thinkingLevels = getActiveThinkingLevels(model.id);
      const supportsThinking = thinkingLevels.length > 0 && adapterFor(modelConfigRuntime).supportsThinking(model.id);

      if (!supportsThinking) {
        // Model doesn't support reasoning - clean up and skip assignment screen
        const agent = DEVELOPER_TEAM_AGENTS[agentAssignmentIndex];
        if (agent) {
          setModelAssignments((current) => ({ ...current, [agent.id]: model.id }));
          setThinkingAssignments((current) => {
            const next = { ...current };
            delete next[agent.id];
            return next;
          });
          if (modelConfigRuntime === "opencode" || modelConfigRuntime === "codex") {
            setChangedOpenCodeAgentIds((current) => new Set(current).add(agent.id));
          }
        }
        setSelectedModel(null);
        resetCursor("agent-model-config-list");
        return;
      }

      setSelectedModel(model as any);
      const agent = DEVELOPER_TEAM_AGENTS[agentAssignmentIndex];
      const existingThinking = agent ? thinkingAssignments[agent.id] : undefined;

      const adapterDefault = adapterFor(modelConfigRuntime).getDefaultThinking(model.id);
      const defaultThinking = existingThinking && thinkingLevels.includes(existingThinking)
        ? existingThinking
        : thinkingLevels.includes(adapterDefault)
          ? adapterDefault
          : thinkingLevels[0];
      const thinkingIndex = thinkingLevels.indexOf(defaultThinking as any);
      resetCursor("agent-model-assignment", Math.max(0, thinkingIndex));
      return;
    }

    if (screen === "agent-model-assignment") {
      if (!selectedModel) return;
      const agent = DEVELOPER_TEAM_AGENTS[agentAssignmentIndex];
      if (!agent) return;

      const thinkingLevels = getActiveThinkingLevels(selectedModel.id);
      const thinking = thinkingLevels[cursor];

      setModelAssignments((current) => ({ ...current, [agent.id]: selectedModel.id }));
      setThinkingAssignments((current) => {
        const next = { ...current };
        if (thinking) next[agent.id] = thinking as any;
        else delete next[agent.id];
        return next;
      });
      if (modelConfigRuntime === "opencode" || modelConfigRuntime === "codex") {
        setChangedOpenCodeAgentIds((current) => new Set(current).add(agent.id));
      }
      setSelectedModel(null);
      resetCursor("agent-model-config-list");
      return;
    }

    if (screen === "opencode-model-discovery") {
      const action = getOpenCodeDiscoveryAction(openCodeDiscovery, cursor);
      if (action === "wait") return;
      if (action === "retry") startOpenCodeModelDiscovery("rescan");
      else goBack();
      return;
    }

    if (screen === "codex-model-discovery") {
      const action = getOpenCodeDiscoveryAction(codexDiscovery, cursor);
      if (action === "wait") return;
      if (action === "retry") startCodexModelDiscovery("rescan");
      else goBack();
      return;
    }

    if (screen === "no-providers") {
      if (modelConfigSource === "install") {
        resetCursor("memory-provider-selection");
      } else if (modelConfigSource === "dashboard") {
        resetCursor("pi-runner-dashboard");
      } else {
        resetCursor("home");
      }
      return;
    }

    if (screen === "memory-provider-selection") {
      const choice = (["none", "engram", "supermemory"] as const)[cursor];
      if (!choice) return;
      setMemoryProviderChoice(choice);
      setSupermemoryError(undefined);
      if (choice === "supermemory") {
        if (!shouldUseLegacySupermemoryTokenRoute(selectedEnvironments)) {
          setSupermemorySetup({ token: "" });
          setMemoryProvider(undefined);
          setMemoryStatus("Supermemory uses Codex native OAuth from the runner dashboard; no token was captured.");
          resetCursor("developer-team-review");
          return;
        }
        setDashboardSupermemorySetupActive(false);
        resetCursor("supermemory-token");
        return;
      }
      persistMemoryProviderSelection(choice, supermemorySetup);
      resetCursor("developer-team-review");
      return;
    }

    if (isSupermemoryInputScreen(screen)) {
      continueSupermemorySetup();
      return;
    }

    if (screen === "developer-team-review") {
      const hasOpenCode = selectedEnvironments.includes("opencode-development");
      const nextScreen = getNextScreenAfterDeveloperTeamReview({
        cursor: developerTeamCursor,
        selectedEnvironments,
        nextEnvironment: selectedEnvironments[0] ?? null,
      });

      resetCursor(nextScreen);
    }

    if (screen === "complete") resetCursor("home");

    if (screen === "doctor") resetCursor("home");

    // T3.4 / T3.5: upgrade confirm + progress enter handling.
    if (screen === "upgrade-confirm") {
      if (upgradeCursor === 0) {
        // Apply — transition to the progress screen. The effect above
        // fires the orchestrator.
        resetCursor("upgrade-progress");
      } else {
        // Cancel — back to home.
        setUpgradeRollbackHint(undefined);
        resetCursor("home");
      }
      return;
    }

    if (screen === "upgrade-progress") {
      if (
        upgradeProgress.kind === "completed" ||
        upgradeProgress.kind === "rolled_back" ||
        upgradeProgress.kind === "failed"
      ) {
        // Terminal state: Enter returns to home.
        resetCursor("home");
      }
      return;
    }

    // REQ-RBK-002: user-initiated rollback enter handling.
    if (screen === "rollback-confirm") {
      if (rollbackCursor === 0) {
        // Apply — fire the rollback library. The library call is
        // synchronous and mutates the filesystem, so we set the
        // running state synchronously and resolve the result on the
        // same tick. The "running" frame is brief by design; the
        // terminal `completed` / `failed` frame is what the user
        // will actually see.
        if (!rollbackManifest) {
          setRollbackStatus({ mode: "failed", reason: "No backup available." });
          resetCursor("rollback-progress");
          return;
        }
        setRollbackStatus({ mode: "running" });
        try {
          const result = rollbackLatest(rollbackManifest.deckVersionBefore);
          setRollbackStatus({ mode: "completed", restoredCount: result.restoredCount });
          addLog(
            `Rollback to v${result.rolledBackTo} complete (${result.restoredCount} files restored).`,
          );
        } catch (err) {
          const code = err instanceof RollbackError ? err.code : "UNKNOWN";
          const message = err instanceof Error ? err.message : String(err);
          setRollbackStatus({ mode: "failed", reason: `${code}: ${message}` });
          addLog(`Rollback failed (${code}).`);
        }
        resetCursor("rollback-progress");
      } else {
        // Cancel — back to home.
        setRollbackStatus(null);
        resetCursor("home");
      }
      return;
    }

    if (screen === "rollback-progress") {
      // Terminal state: Enter returns to home.
      if (rollbackStatus && (rollbackStatus.mode === "completed" || rollbackStatus.mode === "failed")) {
        setRollbackStatus(null);
        resetCursor("home");
      }
      return;
    }
  }

  async function handleDashboardInput(input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean }) {
    debug(`handleDashboardInput ENTER: input="${input}" key=${JSON.stringify(key)} screen=${dashboardState.screen}`);
    if (input === "q") {
      log("handleDashboardInput: q pressed → exit");
      if (dashboardInstallActiveRef.current) {
        dashboardExitRequestedRef.current = true;
        setDashboardCancellationRequested(true);
        dashboardAbortControllerRef.current?.abort();
        return;
      }
      clearDashboardSupermemoryEphemeralState();
      clearDashboardWebSearchCredential();
      exit();
      return;
    }
    if (key.escape) {
      log("handleDashboardInput: escape pressed");
      if (dashboardInstallActiveRef.current) {
        setDashboardCancellationRequested(true);
        dashboardAbortControllerRef.current?.abort();
        return;
      }
      if (dashboardState.screen === "dashboard") {
        clearDashboardSupermemoryEphemeralState();
        clearDashboardWebSearchCredential();
        resetCursor("environment-selection");
      } else {
        setDashboardState((current) => reduceRunnerDashboard(current, { type: "back" }, dashboardPlanBuilder));
      }
      return;
    }
    if (key.upArrow || input === "k") {
      // Use with-limit variant to support dynamic package counts for packages-detail screen
      if (dashboardState.screen === "packages-detail") {
        setDashboardState((current) => reduceRunnerDashboard(current, { type: "cursor-up-with-limit", packageCount: dashboardToggleableCount }, dashboardPlanBuilder));
      } else {
        setDashboardState((current) => reduceRunnerDashboard(current, { type: "cursor-up" }, dashboardPlanBuilder));
      }
      return;
    }
    if (key.downArrow || input === "j") {
      // Use with-limit variant to support dynamic package counts for packages-detail screen
      if (dashboardState.screen === "packages-detail") {
        setDashboardState((current) => reduceRunnerDashboard(current, { type: "cursor-down-with-limit", packageCount: dashboardToggleableCount }, dashboardPlanBuilder));
      } else {
        setDashboardState((current) => reduceRunnerDashboard(current, { type: "cursor-down" }, dashboardPlanBuilder));
      }
      return;
    }
    if (input === " ") {
      toggleDashboardCurrent();
      return;
    }
    if (key.return) {
      log(`handleDashboardInput: Enter pressed. dashboardScreen=${dashboardState.screen} cursor=${dashboardState.cursor}`);
      await continueDashboardCurrent();
    }
  }

  function toggleDashboardCurrent() {
    if (dashboardState.screen === "web-search-detail") {
      void continueDashboardCurrent();
      return;
    }
    const action = getDashboardToggleAction(dashboardState, dashboardCapabilityResolver);
    if (action) setDashboardState((current) => reduceRunnerDashboard(current, action, dashboardPlanBuilder));
  }

  async function continueDashboardCurrent() {
    log(`continueDashboardCurrent: screen=${dashboardState.screen} cursor=${dashboardState.cursor}`);
    const effect = getDashboardContinueEffect(dashboardState, {
      inventory: dashboardInventory,
      canRunPlan: canRunDashboardPlan(dashboardState),
    }, dashboardCapabilityResolver);
    log(`continueDashboardCurrent: effect.type=${effect.type} action=${(effect as any).action?.type ?? "n/a"}`);
    await applyDashboardContinueEffect(effect);
    log(`continueDashboardCurrent: done`);
  }

  async function applyDashboardContinueEffect(effect: RunnerDashboardContinueEffect) {
    // Helper to safely dispatch reducer actions that use dashboardPlanBuilder
    const safeDispatch = (action: RunnerDashboardAction) => {
      try {
        log(`safeDispatch: action=${action.type}`);
        setDashboardError(null);
        setDashboardState((state) => reduceRunnerDashboard(state, action, dashboardPlanBuilder));
        log(`safeDispatch: action=${action.type} DONE`);
      } catch (error) {
        const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
        log(`safeDispatch ERROR: action=${action.type} error=${msg}`);
        setDashboardError(`[dashboard error] ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    switch (effect.type) {
      case "dispatch":
        if (effect.action.type === "select-adaptive-memory" && effect.action.provider !== "supermemory") {
          clearDashboardSupermemoryEphemeralState();
        }
        safeDispatch(effect.action);
        return;
      case "open-web-search-credential":
        clearDashboardWebSearchCredential();
        setDashboardWebSearchCredentialEntryActive(true);
        resetCursor("web-search-credential");
        return;
      case "select-supermemory-and-open-setup":
        safeDispatch(effect.action);
        setDashboardSupermemorySetupActive(true);
        setMemoryProviderChoice("supermemory");
        setSupermemoryError(undefined);
        resetCursor("supermemory-token");
        return;
      case "open-developer-team-model-config": {
        const runtime = dashboardState.runnerScope;
        debug(`open-developer-team-model-config: START runtime=${runtime}`);
        if (runtime !== "all") setModelConfigRuntime(runtime);
        debug(`open-developer-team-model-config: after setModelConfigRuntime`);
        try {
          hydrateDeveloperTeamModelConfig(runtime !== "all" ? runtime : undefined);
          debug(`open-developer-team-model-config: after hydrateDeveloperTeamModelConfig`);
        } catch (e) {
          debug(`open-developer-team-model-config: hydrate ERROR: ${e}`);
        }
        setModelConfigSource("dashboard");
        if (runtime === "opencode") {
          startOpenCodeModelDiscovery();
          return;
        }
        if (runtime === "codex") {
          startCodexModelDiscovery();
          return;
        }
        const inventory = detectPiModelInventoryForTui();
        setDetectedProviders(inventory.providers);
        setModelsByProvider(inventory.modelsByProvider);
        if (inventory.providers.length === 0) resetCursor("no-providers");
        else resetCursor("agent-model-config-list");
        debug("open-developer-team-model-config: END");
        return;
      }
      case "reuse-developer-team-model-config": {
        const runtime = dashboardState.runnerScope;
        if (runtime !== "all") setModelConfigRuntime(runtime);
        hydrateDeveloperTeamModelConfig(runtime !== "all" ? runtime : undefined);
        // Use require: true for backward compatibility - reads need a path
        const targetRoot = projectRootFor({ require: true });
        const adapter = adapterFor(runtime);
        const modelAssignments = adapter.readModelAssignments(targetRoot ?? "");
        const thinkingAssignments = adapter.readThinkingAssignments(targetRoot ?? "");
        setDashboardState((state) => ({
          ...state,
          teams: {
            ...state.teams,
            "developer-team": {
              ...state.teams["developer-team"],
              modelAssignments,
              thinkingAssignments,
              status: "Modelos actuales/defaults conservados para Developer Team.",
            },
          },
          plan: undefined,
          planRevision: state.planRevision + 1,
          planGeneratedForRevision: undefined,
        }));
        return;
      }
      case "block-review-install":
        setDashboardState((state) => ({
          ...state,
          adaptiveMemory: {
            ...state.adaptiveMemory,
            status: effect.status,
          },
        }));
        return;
      case "complete-dashboard":
        await goToNextEnvironmentAfterDashboardComplete();
        return;
      case "none":
        return;
    }
  }

  function isSupermemoryInputScreen(value: Screen): value is "supermemory-token" {
    return value === "supermemory-token";
  }

  function clearDashboardWebSearchCredential() {
    setWebSearchCredential("");
  }

  function handleWebSearchCredentialInput(
    input: string,
    key: { return?: boolean; backspace?: boolean; delete?: boolean; escape?: boolean },
  ) {
    if (key.escape) {
      clearDashboardWebSearchCredential();
      setWebSearchCredentialError(undefined);
      setDashboardWebSearchCredentialEntryActive(false);
      resetCursor("pi-runner-dashboard");
      return;
    }
    if (key.backspace || key.delete) {
      setWebSearchCredential((current) => [...current].slice(0, -1).join(""));
      return;
    }
    if (key.return) {
      const result = persistWebSearchCredentialAndEnable({
        credential: webSearchCredential,
        projectRoot: localResolvedProjectRoot ?? process.cwd(),
        configStore: requiredConfigStore,
      });
      clearDashboardWebSearchCredential();
      if (!result.ok) {
        setWebSearchCredentialError(webSearchCredentialSetupError(result));
        return;
      }

      setWebSearchCredentialError(undefined);
      setDashboardWebSearchCredentialEntryActive(false);
      setDashboardState((current) => reduceRunnerDashboard({
        ...current,
        webSearchProvider: "tavily",
        webSearchProviderDescriptor: getWebSearchProviderDescriptor("tavily"),
        webSearch: {
          ...current.webSearch,
          provider: "tavily",
          credentialAvailable: true,
          readiness: current.webSearch.mcpConfigConflict ? "configured-but-not-materialized" : "configured-but-not-materialized",
        },
      }, {
        type: "set-capability",
        capabilityId: "web-search",
        selected: true,
      }, dashboardPlanBuilder));
      resetCursor("pi-runner-dashboard");
      return;
    }

    if (input.length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(input)) {
      setWebSearchCredential((current) => {
        const next = `${current}${input}`;
        return Buffer.byteLength(next, "utf8") <= 4096 ? next : current;
      });
    }
  }

  function supermemoryFieldForScreen(value: Screen): keyof SupermemorySetupValues | undefined {
    if (value === "supermemory-token") return "token";
    return undefined;
  }

  function handleSupermemoryTextInput(input: string, key: { return?: boolean; backspace?: boolean; delete?: boolean; escape?: boolean }) {
    if (key.escape) {
      if (dashboardSupermemorySetupActive) {
        clearDashboardSupermemoryEphemeralState();
        setDashboardSupermemorySetupActive(false);
        resetCursor("pi-runner-dashboard");
        return;
      }
      goBack();
      return;
    }
    if (!shouldUseLegacySupermemoryTokenRoute(selectedEnvironments)) {
      setSupermemorySetup({ token: "" });
      setSupermemoryError("Codex uses native OAuth; this token input is unavailable.");
      return;
    }
    if (key.return) {
      continueSupermemorySetup();
      return;
    }
    const field = supermemoryFieldForScreen(screen);
    if (!field) return;
    if (key.backspace || key.delete) {
      setSupermemorySetup((current) => ({ ...current, [field]: (current[field] ?? "").slice(0, -1) }));
      return;
    }
    if (input && !input.includes("") && input !== "q") {
      setSupermemorySetup((current) => ({ ...current, [field]: `${current[field]}${input}` }));
    }
  }

  function continueSupermemorySetup() {
    setSupermemoryError(undefined);
    // Token-only: after token is entered, complete setup directly
    if (screen === "supermemory-token") {
      if (!shouldUseLegacySupermemoryTokenRoute(selectedEnvironments)) {
        setSupermemorySetup({ token: "" });
        setSupermemoryError("Codex uses native OAuth; this token input is unavailable.");
        return;
      }
      if (!supermemorySetup.token.trim()) {
        setSupermemoryError("Supermemory token is required and must be stored outside Deck config.");
        return;
      }
      // Complete setup: go to dashboard review or developer-team-review
      if (dashboardSupermemorySetupActive) {
        if (persistDashboardSupermemorySelection(supermemorySetup)) {
          setDashboardSupermemorySetupActive(false);
          resetCursor("pi-runner-dashboard");
        }
        return;
      }
      if (persistMemoryProviderSelection("supermemory", supermemorySetup)) {
        resetCursor("developer-team-review");
      }
      return;
    }
    // Removed: userId/teamId/orgId screens — token-only config
  }

  function persistDashboardSupermemorySelection(values: SupermemorySetupValues): boolean {
    const setup = buildDashboardSupermemorySetupUpdate(values, dashboardState.runnerScope === "all" ? "pi" : dashboardState.runnerScope);
    if (!setup.ok) {
      setSupermemoryError(setup.message);
      return false;
    }

    setDashboardState((state) => reduceRunnerDashboard(
      reduceRunnerDashboard(state, {
        type: "update-supermemory",
        values: setup.values,
      }, dashboardPlanBuilder),
      { type: "navigate", screen: "dashboard" },
      dashboardPlanBuilder,
    ));
    setMemoryStatus(setup.status);
    return true;
  }

  function clearDashboardSupermemoryEphemeralState() {
    setSupermemorySetup((current) => ({ ...current, token: "" }));
    setDashboardState((current) => {
      if (current.adaptiveMemory.provider !== "supermemory" || !current.adaptiveMemory.supermemory?.hasToken) return current;
      return reduceRunnerDashboard(current, {
        type: "update-supermemory",
        values: { configured: false, hasToken: false, diagnostics: [] },
      }, dashboardPlanBuilder);
    });
  }

  function getDashboardRunBlockDiagnostics(state: RunnerDashboardState = dashboardState, token: string = supermemorySetup.token) {
    const diagnostics: { message: string }[] = [];
    if (state.plan?.ready !== true) {
      diagnostics.push({ message: getReviewPlanBlockerReason(state.plan) ?? "Review plan is not ready. Return to Dashboard and retry." });
    }
    if (state.adaptiveMemory.provider === "supermemory") {
      const setup = state.adaptiveMemory.supermemory;
      if (!setup?.configured) {
        diagnostics.push({ message: "Supermemory setup must be selected before Review/Install." });
      } else if (runnerRequiresExternalSupermemoryToken(state) && !setup.hasToken) {
        diagnostics.push({ message: "Supermemory requires an external token to run Review/Install on this runner." });
      } else if (runnerRequiresExternalSupermemoryToken(state) && !token.trim()) {
        diagnostics.push({ message: "Supermemory requires re-entering the external token before running Review/Install." });
      }
    }
    return diagnostics;
  }

  function canRunDashboardPlan(state: RunnerDashboardState): boolean {
    return state.plan?.ready === true && getDashboardRunBlockDiagnostics(state, supermemorySetup.token).length === 0;
  }

  function persistMemoryProviderSelection(choice: MemoryProviderChoice, values: SupermemorySetupValues): boolean {
    try {
      if (choice === "supermemory" && !shouldUseLegacySupermemoryTokenRoute(selectedEnvironments)) {
        setSupermemorySetup({ token: "" });
        setMemoryProvider(undefined);
        setSupermemoryError("Codex uses native OAuth; no Supermemory token was persisted.");
        return false;
      }
      if (choice === "supermemory") {
        if (!localResolvedProjectRoot) {
          const message = "Unable to resolve verified project root; Supermemory MCP setup was not written.";
          setMemoryProvider(undefined);
          setSupermemoryError(message);
          setMemoryStatus(`Supermemory MCP setup failed: ${message}`);
          return false;
        }
        const resolved = resolveCanonicalSupermemoryProjectScope({ projectRoot: localResolvedProjectRoot, remotes: [] });
        if (!resolved.ok) {
          const message = "Unable to resolve canonical x-sm-project scope from the current Git origin; Supermemory MCP setup was not written.";
          setMemoryProvider(undefined);
          setSupermemoryError(message);
          setMemoryStatus(`Supermemory MCP setup failed: ${message}`);
          return false;
        }
        const result = writeSupermemoryPiMcpConfig({ token: values.token.trim(), serverName: "supermemory", projectScope: resolved.scope });
        if (!result.ok) {
          const message = `Unable to configure Supermemory in Pi MCP config at ${result.path}. Check file permissions and existing MCP config JSON, then try again.`;
          setMemoryProvider(undefined);
          setSupermemoryError(message);
          setMemoryStatus(`Supermemory MCP setup failed: ${message}`);
          return false;
        }
      }

      const config = buildMemoryProviderConfig(choice, values);
      requiredConfigStore.patch((existing) => ({ ...existing, ...config }));
      setMemoryProvider(createMemoryProviderForSelection(choice, values));
      if (choice === "supermemory") {
        setMemoryStatus("Active adaptive-memory provider: Supermemory MCP. Token: [redacted]. Pi MCP config: ~/.pi/agent/mcp.json.");
      } else if (choice === "engram") {
        setMemoryStatus("Active adaptive-memory provider: Engram.");
      } else {
        setMemoryStatus("Adaptive memory disabled.");
      }
      return true;
    } catch (error) {
      setMemoryProvider(undefined);
      setSupermemoryError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  function detectPiProvidersForTui() {
    return detectConfiguredProviders({
      settingsPath: getPiSettingsPath(),
      readFile: readFileSync,
      runCommand: runPiCommand,
    });
  }

  function hydrateDeveloperTeamModelConfig(runtime?: RunnerId) {
    const effectiveRuntime = runtime ?? modelConfigRuntime;
    const adapter = adapterFor(effectiveRuntime);
    const projectRoot = projectRootFor({ require: true });
    const modelAssigns = adapter.readModelAssignments(projectRoot ?? undefined) || {};
    const thinkingAssigns = adapter.readThinkingAssignments(projectRoot ?? undefined) || {};

    // Discovery is informational: persisted model and variant strings must remain
    // raw until the user intentionally changes that agent.
    setModelAssignments(modelAssigns);
    setThinkingAssignments(thinkingAssigns);
    if (effectiveRuntime === "opencode") setChangedOpenCodeAgentIds(new Set());
  }

  /**
   * Resolve the thinking levels to render for the agent-model-assignment screen.
   *
   * - Pi: always returns the fixed PI_THINKING_LEVELS constant (Pi has a single
   *   fixed 6-level set across all supported models).
   * - OpenCode: returns adapter.getThinkingLevels(modelId) so the rendered
   *   options reflect the model's real reasoning_options variants
   *   (e.g. ["high","max"] or ["none","low","medium","high","xhigh"]).
   *   Fails closed (returns []) when the model is unknown/unsupported or the
   *   inventory cannot be loaded, which drives the "Thinking not supported" UX.
   *
   * `modelId` overrides `selectedModel.id` when the caller already has the
   * target model in hand (e.g. the model-selection handler, which hasn't
   * committed the selection to state yet).
   */
  function getActiveThinkingLevels(modelId?: string): readonly RunnerVariantKey[] {
    const adapter = adapterFor(modelConfigRuntime);
    const targetModelId = modelId ?? (selectedModel ? selectedModel.id : undefined);
    if (modelConfigRuntime !== "pi") {
      return adapter.getThinkingLevels(targetModelId);
    }
    return PI_THINKING_LEVELS;
  }

  function getThinkingLevelByCursor(index: number) {
    if (modelConfigRuntime !== "pi") {
      // Use model-specific levels from the adapter's inventory rather than the
      // hardcoded OPENCODE_THINKING_LEVELS constant.
      const levels = getActiveThinkingLevels();
      return levels[index] ?? "low";
    }
    return PI_THINKING_LEVELS[index] ?? "low";
  }

  function syncDashboardDeveloperTeamModelConfig() {
    setDashboardState((current) => ({
      ...current,
      teams: {
        ...current.teams,
        "developer-team": {
          ...current.teams["developer-team"],
          modelAssignments,
          thinkingAssignments,
        },
      },
      plan: undefined,
      planRevision: current.planRevision + 1,
      planGeneratedForRevision: undefined,
    }));
  }

  async function applyDeveloperTeamModelConfig() {
    const projectRoot = projectRootFor({ require: true });
    if (!projectRoot) {
      setInstallResults((current) => [
        ...current,
        { tool: "Developer Team models", success: false, message: "Project root not found." },
      ]);
      return;
    }
    const adapter = adapterFor(modelConfigRuntime);
    const requiresDynamicValidation = modelConfigRuntime === "opencode" || modelConfigRuntime === "codex";
    const changedAgentIds = requiresDynamicValidation ? [...changedOpenCodeAgentIds] : [];
    let validatedInventoryFingerprint: string | undefined;

    if (requiresDynamicValidation && changedAgentIds.length > 0) {
      const validation = await adapter.validateModelAssignments?.({
        projectRoot,
        modelAssignments,
        thinkingAssignments,
        changedAgentIds,
      });
      if (!validation || !validation.valid) {
        const message = !validation
          ? `${adapter.displayName} assignment validation is unavailable. Retry discovery before changing assignments.`
          : validation.issues.map((issue) => issue.message).join(" ");
        setInstallResults((current) => [
          ...current,
          { tool: "Developer Team models", success: false, message },
        ]);
        return;
      }
      validatedInventoryFingerprint = validation.fingerprint;
    }

    const deckConfig = requiredConfigStore.readRequired();
    const enabledIds = getEnabledCapabilityInstructionIds(deckConfig, modelConfigRuntime);
    const capabilityInstructions = enabledIds.length > 0 ? buildCapabilityInstructionBundle(enabledIds) : undefined;
    const standaloneSkills = modelConfigRuntime === "opencode"
      ? getStandaloneSkills().map((skill: { skillId: string }) => ({ skillId: skill.skillId, body: getStandaloneSkillBody(skill.skillId)! }))
      : undefined;
    const environmentId = adapter.environmentIds[0];
    if (!environmentId) throw new Error(`Runner ${adapter.runnerId} has no registered environment.`);

    const { plan } = await prepareAndBuildDeveloperTeamInstallPlan(adapter, {
      projectRoot,
      environmentId,
      modelAssignments,
      thinkingAssignments,
      changedAgentIds,
      validatedInventoryFingerprint,
      memoryProvider,
      capabilityInstructions,
      standaloneSkills,
      deckConfig,
    });
    const backup = adapter.backupDeveloperTeamFiles(plan);

    try {
      const applyResult = await adapter.applyDeveloperTeamInstall({
        projectRoot,
        plan,
        environmentId,
      });
      const verifyResult = await adapter.verifyDeveloperTeamInstall(plan);
      if (!verifyResult.valid) {
        await rollbackOrThrow(adapter, backup);
        setDeveloperTeamResults([]);
        const diagnosticsMsg = verifyResult.diagnostics.length > 0
          ? `\nDetails: ${verifyResult.diagnostics.slice(0, 3).join(";")}${verifyResult.diagnostics.length > 3 ? ` (+${verifyResult.diagnostics.length - 3} more)` : ""}`
          : "";
        setInstallResults((current) => [
          ...current,
          { tool: "Developer Team models", success: false, message: `Verification failed. Changes rolled back.${diagnosticsMsg}` },
        ]);
        return;
      }
      setDeveloperTeamResults(applyResult.results as any);
      if (requiresDynamicValidation) setChangedOpenCodeAgentIds(new Set());
    } catch (error) {
      await rollbackOrThrow(adapter, backup);
      setDeveloperTeamResults([]);
      setInstallResults((current) => [
        ...current,
        {
          tool: "Developer Team models",
          success: false,
          message: `Model configuration failed. Changes rolled back.${error instanceof Error ? ` ${error.message}` : ""}`,
        },
      ]);
    }
  }

  function detectPiModelInventoryForTui() {
    const listModelsResult = runPiCommand("pi", ["--list-models"]);
    const output = listModelsResult.stdout || listModelsResult.stderr || "";
    if (listModelsResult.exitCode === 0 && output.trim().length > 0) {
      const inventory = buildModelInventoryFromPiListModels(output);
      if (inventory.providers.length > 0) return inventory;
    }

    const providers: PiProvider[] = detectPiProvidersForTui();
    return {
      providers,
      modelsByProvider: Object.fromEntries(providers.map((provider) => [provider.id, listModelsForProvider(provider.id)])),
    };
  }

  function detectOpenCodeModelInventoryForTui(
    discovery: TuiOpenCodeDiscoveryState,
    assignmentSnapshot: {
      modelAssignments: DeveloperTeamModelAssignments;
      thinkingAssignments: DeveloperTeamThinkingAssignments;
    },
  ) {
    setOpenCodeDiscovery(discovery);

    if (discovery.kind === "ready" || discovery.kind === "stale") {
      setDetectedProviders(discovery.inventory.providers);
      setModelsByProvider(discovery.inventory.modelsByProvider);
    } else if (discovery.kind !== "loading") {
      setDetectedProviders([]);
      setModelsByProvider({});
    }

    if (discovery.kind === "loading") return;

    setOpenCodeAssignmentStates(modelAssignmentStatesForDiscovery(discovery, assignmentSnapshot));
  }

  function modelAssignmentStatesForDiscovery(
    discovery: TuiRunnerModelDiscoveryState,
    assignmentSnapshot: {
      modelAssignments: DeveloperTeamModelAssignments;
      thinkingAssignments: DeveloperTeamThinkingAssignments;
    },
  ): Record<string, "available" | "model-unavailable" | "variant-unavailable" | "unverified"> {
    const assignmentStates: Record<string, "available" | "model-unavailable" | "variant-unavailable" | "unverified"> = {};
    for (const [agentId, modelId] of Object.entries(assignmentSnapshot.modelAssignments)) {
      const variant = assignmentSnapshot.thinkingAssignments[agentId];
      if (discovery.kind === "stale" || discovery.kind === "blocked") {
        assignmentStates[agentId] = "unverified";
        continue;
      }
      if (discovery.kind !== "ready") continue;
      const model = Object.values(discovery.inventory.modelsByProvider)
        .flat()
        .find((entry) => entry.id === modelId);
      assignmentStates[agentId] = !model
        ? "model-unavailable"
        : variant && !(model.variants ?? []).includes(variant)
          ? "variant-unavailable"
          : "available";
    }
    return assignmentStates;
  }


  function startOpenCodeModelDiscovery(mode: RunnerModelDiscoveryRequest["mode"] = "prefer-cache") {
    const projectRoot = projectRootFor({ require: true }) ?? process.cwd();
    openCodeProjectRootRef.current = projectRoot;
    const assignmentSnapshot = {
      modelAssignments: { ...modelAssignments },
      thinkingAssignments: { ...thinkingAssignments },
    };
    let completedDiscovery: TuiOpenCodeDiscoveryState | undefined;
    resetCursor("opencode-model-discovery");
    const coordinator = openCodeDiscoveryCoordinatorRef.current!;
    void coordinator.start(
      { runtime: "opencode", projectRoot, mode },
      (discovery) => {
        if (discovery.kind !== "loading") completedDiscovery = discovery;
        detectOpenCodeModelInventoryForTui(discovery, assignmentSnapshot);
      },
    ).then((applied) => {
      if (applied && (completedDiscovery?.kind === "ready" || completedDiscovery?.kind === "stale")) {
        resetCursor("agent-model-config-list");
      }
    });
  }

  function startCodexModelDiscovery(mode: RunnerModelDiscoveryRequest["mode"] = "prefer-cache") {
    const projectRoot = projectRootFor({ require: true }) ?? process.cwd();
    codexProjectRootRef.current = projectRoot;
    const assignmentSnapshot = {
      modelAssignments: adapterFor("codex").readModelAssignments(projectRoot),
      thinkingAssignments: adapterFor("codex").readThinkingAssignments(projectRoot),
    };
    let completedDiscovery: TuiCodexDiscoveryState | undefined;
    resetCursor("codex-model-discovery");
    const coordinator = codexDiscoveryCoordinatorRef.current!;
    void coordinator.start(
      { runtime: "codex", projectRoot, mode },
      (discovery) => {
        if (discovery.kind !== "loading") completedDiscovery = discovery;
        setCodexDiscovery(discovery);
        if (discovery.kind === "ready") {
          setDetectedProviders(discovery.inventory.providers);
          setModelsByProvider(discovery.inventory.modelsByProvider);
        } else if (discovery.kind !== "loading") {
          setDetectedProviders([]);
          setModelsByProvider({});
        }
        if (discovery.kind !== "loading") setCodexAssignmentStates(modelAssignmentStatesForDiscovery(discovery, assignmentSnapshot));
      },
    ).then((applied) => {
      if (applied && completedDiscovery?.kind === "ready") resetCursor("agent-model-config-list");
    });
  }

  function runPiCommand(command: string, args: string[]) {
    const result = spawnSync(command, args);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  function getPiSettingsPath(): string {
    return join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "settings.json");
  }

  function goToNextEnvironmentOrComplete() {
    const statuses = detectSelectedRuntimes(selectedEnvironments);
    const hasPi = statuses.some((s) => s.runtime === "pi" && s.installed && s.command);
    const hasOpenCode = statuses.some((s) => s.runtime === "opencode" && s.installed && s.command);
    const nextScreen = getNextScreenAfterPiToolInstall({
      selectedEnvironments,
      hasPiCommand: hasPi,
      nextEnvironment: selectedEnvironments[0] ?? null,
    });

    resetCursor(nextScreen);
  }

  function getNextDashboardEnvironmentId(): EnvironmentId | undefined {
    const currentIndex = dashboardEnvironmentId ? selectedEnvironments.indexOf(dashboardEnvironmentId) : -1;
    return selectedEnvironments
      .slice(currentIndex + 1)
      .find((environmentId) => Boolean(adapterRegistry.resolveByEnvironment(environmentId)));
  }

  function getDashboardCompletionStatus(): string {
    const nextEnvironmentId = getNextDashboardEnvironmentId();
    const nextAdapter = nextEnvironmentId ? adapterRegistry.resolveByEnvironment(nextEnvironmentId) : undefined;
    return nextAdapter
      ? `Enter para continuar con ${nextAdapter.displayName}.`
      : "Enter para finalizar y volver a Home.";
  }

  async function goToNextEnvironmentAfterDashboardComplete() {
    const nextEnvironmentId = getNextDashboardEnvironmentId();
    if (!nextEnvironmentId || !await composeRegisteredRunnerDashboard(nextEnvironmentId)) resetCursor("home");
  }

  function goBack() {
    let next: Screen | undefined;

    if (screen === "agent-model-config-list" || screen === "no-providers") {
      next = modelConfigSource === "install" ? "team-selection" : modelConfigSource === "dashboard" ? "pi-runner-dashboard" : "model-team-selection";
    } else {
      const previous: Partial<Record<Screen, Screen>> = {
        "model-environment-selection": "home",
        "model-team-selection": "model-environment-selection",
        "environment-selection": "home",
        "personality-selection": "environment-selection",
        "pi-runner-dashboard": "environment-selection",
        "pi-preflight-checking": "environment-selection",
        "pi-preflight": "environment-selection",
        "required-tools": "pi-preflight",
        "optional-tools": "required-tools",
        "installation-review": "optional-tools",
        "installing": "installation-review",
        "team-selection": "installation-review",
        "agent-model-config-list": "team-selection",
        "model-provider-selection": "agent-model-config-list",
        "model-selection": "model-provider-selection",
        "agent-model-assignment": "model-selection",
        "opencode-model-discovery": "agent-model-config-list",
        "codex-model-discovery": "agent-model-config-list",
        "no-providers": "team-selection",
        "memory-provider-selection": "agent-model-config-list",
        "supermemory-token": "memory-provider-selection",
        // Removed: userId/teamId/orgId screens — token-only
        "developer-team-review": "memory-provider-selection",
        "developer-team-installing": "developer-team-review",
        "opencode-preflight-checking": "environment-selection",
        "codex-preflight-checking": "environment-selection",
        "configure-packages-runner-selection": "home",
        "configure-packages-detail": "configure-packages-runner-selection",
        "doctor": "home",
        complete: "home",
        "upgrade-confirm": "home",
        "upgrade-progress": "home",
        "rollback-confirm": "home",
        "rollback-progress": "home",
      };
      next = previous[screen];
    }

    if (next) resetCursor(next);
  }

  function dashboardDeveloperTeamContext() {
    if (modelConfigSource !== "dashboard") return undefined;
    return {
      source: "dashboard" as const,
      adaptiveMemoryProvider: dashboardState.adaptiveMemory.provider,
      capabilityStatuses: dashboardState.capabilityStatuses,
      returnLabel: "Volver al dashboard",
    };
  }

  const dashboardRunnerLabel = dashboardState.runnerScope === "all"
    ? "Runner"
    : adapterRegistry.tryGet(dashboardState.runnerScope)?.displayName ?? dashboardState.runnerDisplayName ?? dashboardState.runnerScope;

  return (
    <ScreenFrame title={screenTitle(screen, dashboardRunnerLabel)} help={HELP} width={stdout.columns || 72} height={stdout.rows || undefined} logs={logs}>
      {screen === "home" ? <HomeScreen cursor={homeCursor} releaseCheck={releaseCheck} /> : null}
      {screen === "upgrade-confirm" ? (
        releaseCheck.kind === "available" ? (
          <UpgradeConfirmScreen
            cursor={upgradeCursor}
            version={releaseCheck.version}
            {...(releaseCheck.tag ? { tag: releaseCheck.tag } : {})}
            items={releaseCheck.items}
            channel={releaseCheck.channel}
            binarySkipped={upgradeBinarySkipped}
            {...(upgradeRollbackHint ? { rollbackHint: upgradeRollbackHint } : {})}
          />
        ) : (
          // Defensive: should not happen because the home menu action is
          // only enabled when the release check resolves to `available`.
          <Text color="yellow">No upgrade available. Press Enter to return to Home.</Text>
        )
      ) : null}
      {screen === "upgrade-progress" ? (
        <UpgradeProgressScreen status={upgradeProgress} targetVersion={upgradeDescriptor?.version ?? "0.0.0"} />
      ) : null}
      {/* REQ-RBK-002: user-initiated rollback surface in the TUI. */}
      {screen === "rollback-confirm" && rollbackManifest ? (
        <RollbackScreen cursor={rollbackCursor} backup={rollbackManifest} mode="confirm" />
      ) : null}
      {screen === "rollback-progress" && rollbackManifest && rollbackStatus ? (
        <RollbackScreen
          cursor={0}
          backup={rollbackManifest}
          mode={rollbackStatus.mode}
          {...(rollbackStatus.restoredCount !== undefined ? { restoredCount: rollbackStatus.restoredCount } : {})}
          {...(rollbackStatus.reason ? { reason: rollbackStatus.reason } : {})}
        />
      ) : null}
      {screen === "doctor" ? <DoctorScreen /> : null}
      {screen === "model-environment-selection" ? <ModelEnvironmentSelectionScreen cursor={modelEnvironmentCursor} options={environmentOptions} /> : null}
      {screen === "model-team-selection" && selectedModelEnvironment ? (
        <ModelTeamSelectionScreen cursor={modelTeamCursor} environment={selectedModelEnvironment} teams={adapterFor(selectedModelEnvironment).getTeams(selectedModelEnvironment) as any[]} />
      ) : null}
      {screen === "environment-selection" ? (
        <EnvironmentSelectionScreen cursor={cursor} selected={selectedEnvironments} options={environmentOptions} />
      ) : null}
      {screen === "personality-selection" ? (
        <PersonalitySelectionScreen cursor={cursor} selected={selectedPersonality} />
      ) : null}
      {screen === "pi-runner-dashboard" ? (
        <RunnerDashboardScreens
          state={dashboardState}
          installResults={dashboardActionResults}
          completionStatus={dashboardCompletionStatus}
          canRunPlan={canRunDashboardPlan(dashboardState)}
          runBlockDiagnostics={getDashboardRunBlockDiagnostics(dashboardState)}
          capabilityResolver={dashboardCapabilityResolver}
          serenaStages={dashboardSerenaStages}
          serenaOutcome={dashboardSerenaOutcome}
          cancellationRequested={dashboardCancellationRequested}
          runnerLabel={dashboardRunnerLabel}
        />
      ) : null}
      {dashboardError && screen === "pi-runner-dashboard" ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="red" bold>DASHBOARD ERROR</Text>
          <Text color="red">{dashboardError}</Text>
        </Box>
      ) : null}
      {screen === "pi-preflight-checking" ? <CheckingScreen /> : null}
      {screen === "pi-preflight" && piPreflight ? <PiPreflightScreen preflight={piPreflight} /> : null}
      {screen === "required-tools" && toolsReview ? <RequiredToolsScreen review={toolsReview} /> : null}
      {screen === "optional-tools" ? <OptionalToolsScreen cursor={cursor} selected={selectedOptionalTools} /> : null}
      {screen === "installation-review" ? <InstallationReviewScreen cursor={cursor} plan={installationPlan} /> : null}
      {screen === "installing" ? <Text>Installing selected tools...</Text> : null}
      {screen === "team-selection" ? <TeamSelectionScreen cursor={cursor} selected={selectedTeams} /> : null}
      {screen === "agent-model-config-list" ? (
        <AgentModelConfigListScreen
          cursor={agentConfigCursor}
            modelAssignments={modelAssignments}
            thinkingAssignments={thinkingAssignments}
            assignmentStates={modelConfigRuntime === "opencode" ? openCodeAssignmentStates : modelConfigRuntime === "codex" ? codexAssignmentStates : undefined}
          discoveryState={modelConfigRuntime === "opencode" && openCodeDiscovery.kind === "stale" ? "stale" : undefined}
          dashboardContext={dashboardDeveloperTeamContext()}
          runtime={modelConfigRuntime}
        />
      ) : null}
      {screen === "model-provider-selection" ? (
        <ModelProviderSelectionScreen cursor={cursor} providers={detectedProviders} runtime={modelConfigRuntime} runnerLabel={adapterFor(modelConfigRuntime).displayName} modelUi={adapterFor(modelConfigRuntime).ui?.model} />
      ) : null}
      {screen === "model-selection" && selectedProvider ? (
        <ModelSelectionScreen cursor={cursor} provider={selectedProvider} models={providerModels} runtime={modelConfigRuntime} runnerLabel={adapterFor(modelConfigRuntime).displayName} modelUi={adapterFor(modelConfigRuntime).ui?.model} />
      ) : null}
      {screen === "agent-model-assignment" && selectedModel ? (
        <AgentModelAssignmentScreen
          cursor={cursor}
          agentIndex={agentAssignmentIndex}
          totalAgents={DEVELOPER_TEAM_AGENTS.length}
          modelId={selectedModel.id}
          defaultThinking={thinkingAssignments[DEVELOPER_TEAM_AGENTS[agentAssignmentIndex]?.id ?? ""] ?? adapterFor(modelConfigRuntime).getDefaultThinking(selectedModel.id) ?? getActiveThinkingLevels(selectedModel.id)[0] ?? ""}
          supportsThinking={getActiveThinkingLevels(selectedModel.id).length > 0 && adapterFor(modelConfigRuntime).supportsThinking(selectedModel.id)}
          runtime={modelConfigRuntime}
          runnerLabel={adapterFor(modelConfigRuntime).displayName}
          modelUi={adapterFor(modelConfigRuntime).ui?.model}
          thinkingLevels={modelConfigRuntime === "pi" ? undefined : getActiveThinkingLevels(selectedModel.id)}
        />
      ) : null}
      {screen === "opencode-model-discovery" ? (
        <OpenCodeModelDiscoveryScreen
          cursor={cursor}
          state={openCodeDiscovery}
        />
      ) : null}
      {screen === "codex-model-discovery" ? (
        <CodexModelDiscoveryScreen
          cursor={cursor}
          state={codexDiscovery}
        />
      ) : null}
      {screen === "no-providers" ? <NoProvidersScreen dashboardContext={dashboardDeveloperTeamContext()} runtime={modelConfigRuntime} runnerLabel={adapterFor(modelConfigRuntime).displayName} modelUi={adapterFor(modelConfigRuntime).ui?.model} /> : null}
      {screen === "memory-provider-selection" ? (
        <MemoryProviderSelectionScreen cursor={cursor} selectedProvider={memoryProviderChoice} status={memoryStatus} runtime={dashboardState.runnerScope === "all" ? modelConfigRuntime : dashboardState.runnerScope} />
      ) : null}
      {isSupermemoryInputScreen(screen) ? (
        <SupermemorySetupScreen screen={screen} values={supermemorySetup} error={supermemoryError} runtime={dashboardState.runnerScope === "all" ? modelConfigRuntime : dashboardState.runnerScope} />
      ) : null}
      {screen === "web-search-credential" ? (
        <WebSearchCredentialScreen value={webSearchCredential} error={webSearchCredentialError} />
      ) : null}
      {screen === "developer-team-review" ? (
        // Use require: true for backward compatibility - prop expects string
        <DeveloperTeamReviewScreen projectRoot={projectRootFor({ require: true })!} cursor={developerTeamCursor} dashboardContext={dashboardDeveloperTeamContext()} />
      ) : null}
      {screen === "developer-team-installing" ? (
        <DeveloperTeamInstallingScreen currentStep={agentAssignmentIndex} totalSteps={DEVELOPER_TEAM_AGENTS.length} />
      ) : null}
      {screen === "opencode-preflight-checking" ? <OpenCodeCheckingScreen /> : null}
      {screen === "codex-preflight-checking" ? <CodexCheckingScreen /> : null}
      {screen === "configure-packages-runner-selection" ? (
        <ConfigurePackagesRunnerSelection cursor={configurePackagesCursor} options={runnerOptions} />
      ) : null}
      {screen === "configure-packages-detail" ? (
        <ConfigurePackagesDetail
          cursor={configurePackagesCursor}
          adapter={configurePackagesAdapter}
          packages={configurePackageRows}
          baseline={configurePackageMetadata.find((entry) => entry.defaultEnabled)}
          toggles={configurePackagesToggles}
        />
      ) : null}
      {screen === "complete" ? <CompleteScreen results={installResults} developerTeamResults={developerTeamResults} status={dashboardCompletionStatus} /> : null}
    </ScreenFrame>
  );
}

function screenTitle(screen: Screen, runnerLabel?: string): string {
  const titles: Record<Screen, string> = {
    home: "Deck",
    "upgrade-confirm": "Update Deck",
    "upgrade-progress": "Update Deck",
    "rollback-confirm": "Rollback Deck",
    "rollback-progress": "Rollback Deck",
    "model-environment-selection": "Select runner for model config",
    "model-team-selection": "Select team for model config",
    "environment-selection": "Select environments",
    "personality-selection": "Choose Lead personality",
    "pi-runner-dashboard": `${runnerLabel ?? "Runner"} Setup Dashboard`,
    "pi-preflight-checking": "Checking Pi environment",
    "pi-preflight": "Pi Environment Preflight",
    "required-tools": "Review required tools",
    "optional-tools": "Select optional tools",
    "installation-review": "Installation review",
    installing: "Installing",
    "team-selection": "Select teams",
    "agent-model-config-list": "Configure Developer Team models",
    "model-provider-selection": "Select provider",
    "model-selection": "Select model",
    "agent-model-assignment": "Select reasoning level",
    "opencode-model-discovery": "OpenCode model discovery",
    "codex-model-discovery": "Codex model discovery",
    "no-providers": "No providers detected",
    "memory-provider-selection": "Adaptive memory provider",
    // Removed: userId/teamId/orgId screens — token-only config
    "supermemory-token": "Supermemory MCP token",
    "web-search-credential": "Tavily credential",
    "developer-team-review": "Developer Team",
    "developer-team-installing": "Installing Developer Team",
    "opencode-preflight-checking": "Checking OpenCode environment",
    "codex-preflight-checking": "Checking Codex environment",
    "configure-packages-runner-selection": "Configure Packages",
    "configure-packages-detail": "Configure Packages",
    doctor: "Doctor",
    complete: "Complete",
  };

  return titles[screen];
}

function CheckingScreen() {
  return (
    <Box flexDirection="column">
      <Text color="cyan">Inspecting Pi configuration...</Text>
      <Text dimColor>Deck is checking version, config directory, existing packages, and required tools.</Text>
    </Box>
  );
}

function OpenCodeCheckingScreen() {
  return (
    <Box flexDirection="column">
      <Text color="cyan">Inspecting OpenCode configuration...</Text>
      <Text dimColor>Deck is checking version, config directory, package manifest, and installed tools.</Text>
    </Box>
  );
}

function CodexCheckingScreen() {
  return (
    <Box flexDirection="column">
      <Text color="cyan">Inspecting Codex configuration...</Text>
      <Text dimColor>Deck is checking version, trust activation, managed content, bridge classification, MCP, and shared binaries.</Text>
    </Box>
  );
}

function ConfigurePackagesRunnerSelection({ cursor, options }: { cursor: number; options: readonly { id: string; label: string }[] }) {
  return (
    <Box flexDirection="column">
      <Text dimColor>Select a runner to configure package instructions for.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={[...options]}
        />
      </Box>
    </Box>
  );
}

function ConfigurePackagesDetail({
  cursor,
  adapter,
  packages,
  baseline,
  toggles,
}: {
  cursor: number;
  adapter: Pick<RunnerAdapter, "runnerId" | "displayName" | "environmentIds" | "ui"> | null;
  packages: readonly PackageInstructionConfigurationMetadata[];
  baseline?: PackageInstructionConfigurationMetadata;
  toggles: Record<string, boolean>;
}) {
  const environmentLabel = adapter?.environmentIds
    .map((environmentId) => adapter.ui?.environmentLabels[environmentId])
    .find((label): label is string => Boolean(label));

  return (
    <Box flexDirection="column">
      <Text bold>
        {adapter ? `Configure Packages — ${adapter.displayName}` : "Configure Packages"}
      </Text>
      <Text dimColor>
        Space toggles package instructions. Enter selects Apply or Back.
        {baseline ? ` ${baseline.label} is always enabled as the baseline.` : ""}
        {environmentLabel ? ` Target: ${environmentLabel}.` : ""}
      </Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={[
            ...packages.map((pkg) => ({
              id: pkg.id,
              label: `${toggles[pkg.id] ? "[x]" : "[ ]"} ${pkg.label}`,
              hint: pkg.description,
            })),
            { id: "apply", label: "Apply changes" },
            { id: "back", label: "Back" },
          ]}
        />
      </Box>
    </Box>
  );
}

export function PersonalitySelectionScreen({ cursor, selected }: { cursor: number; selected: "guia" | "pragmatica" | "ahorro" }) {
  const personalities = [
    { id: "guia" as const, label: "Guía (Teacher)", hint: "Full explanations with educational context", tokenCost: "high" },
    { id: "pragmatica" as const, label: "Pragmática (Pragmatic)", hint: "Balanced — what you need, nothing more", tokenCost: "medium" },
    { id: "ahorro" as const, label: "Ahorro extremo (Extreme saver)", hint: "Minimal explanations, maximum efficiency", tokenCost: "low" },
  ];

  return (
    <Box flexDirection="column">
      <Text dimColor>Controls how verbose Lead is when communicating decisions and rationale.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={personalities.map((p) => ({
            id: p.id,
            label: p.label,
            hint: `${p.hint} [tokens: ${p.tokenCost}]`,
          }))}
        />
      </Box>
    </Box>
  );
}

function EnvironmentSelectionScreen({ cursor, selected, options }: { cursor: number; selected: EnvironmentId[]; options: readonly { value: string; label: string }[] }) {
  return (
    <Box flexDirection="column">
      <Text dimColor>Choose one or more environments. Space toggles selection.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          multiselect
          items={options.map((option) => ({
            id: option.value,
            label: option.label,
            checked: selected.includes(option.value as EnvironmentId),
          }))}
        />
      </Box>
    </Box>
  );
}

function ModelEnvironmentSelectionScreen({ cursor, options }: { cursor: number; options: readonly { value: string; label: string; available?: boolean }[] }) {
  return (
    <Box flexDirection="column">
      <Text dimColor>Select which runner/environment owns the model configuration.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={options.map((option) => ({
            id: option.value,
            label: option.label,
            hint: option.available ? "available" : "not implemented yet",
          }))}
        />
      </Box>
    </Box>
  );
}

function ModelTeamSelectionScreen({ cursor, environment, teams }: { cursor: number; environment: EnvironmentId; teams: any[] }) {
  return (
    <Box flexDirection="column">
      <Text dimColor>Select which team you want to configure for {environment}.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={
            teams.length > 0
              ? teams.map((team) => ({ id: team.id, label: team.displayName, hint: team.description }))
              : [{ id: "none", label: "No configurable teams yet", hint: "not implemented" }]
          }
        />
      </Box>
    </Box>
  );
}

function EnvironmentCheckScreen({ statuses }: { statuses: RuntimeStatus[] }) {
  const installed = statuses.filter((status) => status.installed);
  const label = installed.length === 1 ? installed[0].environment.replace(" Development Environment", "") : "selected environments";

  return (
    <Box flexDirection="column">
      {statuses.map((status) => (
        <Box key={status.runtime} flexDirection="column" marginBottom={1}>
          <Text bold>{status.environment}</Text>
          <Text>
            {status.runtime}: {status.installed ? <Text color="green">Installed ({status.command})</Text> : <Text color="yellow">Not installed</Text>}
          </Text>
          {!status.installed ? <Text color="yellow">Deck will skip this environment.</Text> : null}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>Press Enter to inspect {label} configuration and required tools.</Text>
      </Box>
    </Box>
  );
}

function PiPreflightScreen({ preflight }: { preflight: PiPreflightResult }) {
  return (
    <Box flexDirection="column">
      <Text>Version: {preflight.version}</Text>
      <Text>Config directory: {preflight.configDirectory ?? "not found"}</Text>
      <Text>Existing configuration: {preflight.existingConfiguration ? "found" : "not found"}</Text>
      <Text>Preflight: {preflight.summary?.ready ? <Text color="green">ready</Text> : <Text color="yellow">attention required</Text>}</Text>
      {(preflight.checks ?? []).map((check) => (
        <Text key={check.id} color={check.status === "fail" ? "red" : check.status === "warn" ? "yellow" : "green"}>
          {check.id}: {check.message}
        </Text>
      ))}
    </Box>
  );
}

function OpenCodePreflightScreen({ preflight }: { preflight: OpenCodePreflightResult }) {
  return (
    <Box flexDirection="column">
      <Text>Version: {preflight.version}</Text>
      <Text>Config directory: {preflight.configDirectory ?? "not found"}</Text>
      <Text>Package manifest: {preflight.packageManifest ?? "not found"}</Text>
      <Text>Existing configuration: {preflight.existingConfiguration ? "found" : "not found"}</Text>
    </Box>
  );
}

function RequiredToolsScreen({ review }: { review: PiRequiredToolsReview }) {
  return (
    <Box flexDirection="column">
      <Text>Installed Pi packages: {review.installedPackages.length > 0 ? review.installedPackages.join(", ") : "none"}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Required for Deck Development Environment</Text>
        {review.tools.map((tool) => (
          <Text key={tool.name}>
            {tool.name}: {renderToolReadiness(tool.ready)} <Text dimColor>(available: {tool.available}, configured: {tool.configured})</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function OptionalToolsScreen({ cursor, selected }: { cursor: number; selected: InstallablePiToolId[] }) {
  return (
    <Box flexDirection="column">
      <Text dimColor>Optional tools are recommended but not required.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          multiselect
          items={(getAdapter("pi").getSelectableTools() as Array<{ id: string; name: string }>).map((tool) => ({
            id: tool.id,
            label: tool.name,
            hint: "recommended",
            checked: selected.includes(tool.id as any),
          }))}
        />
      </Box>
    </Box>
  );
}

function OpenCodeToolsScreen({ review }: { review: OpenCodeToolsReview }) {
  return (
    <Box flexDirection="column">
      <Text>Installed OpenCode packages: {review.installedPackages.length > 0 ? review.installedPackages.join(", ") : "none"}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Base tools for OpenCode Development Environment</Text>
        {review.toolStatuses.map((tool) => (
          <Text key={tool.name}>
            {tool.name}: {renderToolReadiness(tool.ready)} <Text dimColor>(available: {tool.available}, configured: {tool.configured})</Text>
          </Text>
        ))}
      </Box>
      {review.error ? <Text color="yellow">Warning: {review.error}</Text> : null}
    </Box>
  );
}

function OpenCodeToolSelectionScreen({ cursor, selected }: { cursor: number; selected: InstallableOpenCodeToolId[] }) {
  return (
    <Box flexDirection="column">
      <Text dimColor>OpenCode does not require MCP packages or subagents for this environment.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          multiselect
          items={getSelectableOpenCodeTools().map((tool) => ({
            id: tool.id,
            label: tool.name,
            hint: "recommended",
            checked: selected.includes(tool.id),
          }))}
        />
      </Box>
    </Box>
  );
}

function TeamSelectionScreen({ cursor, selected }: { cursor: number; selected: string[] }) {
  const teams = getAdapter("pi").getTeams("pi-development") as any[];
  return (
    <Box flexDirection="column">
      <Text dimColor>Select teams for Pi Development Environment.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          multiselect
          items={teams.map((team) => ({
            id: team.id,
            label: team.displayName,
            hint: team.description,
            checked: selected.includes(team.id),
          }))}
        />
      </Box>
    </Box>
  );
}

function renderToolReadiness(ready: "ready" | "available-unconfigured" | "missing") {
  if (ready === "ready") return <Text color="green">ready</Text>;
  if (ready === "available-unconfigured") return <Text color="yellow">available, not configured</Text>;
  return <Text color="yellow">missing</Text>;
}

function InstallationReviewScreen({ cursor, plan }: { cursor: number; plan: InstallablePiTool[] }) {
  return (
    <Box flexDirection="column">
      {plan.length === 0 ? <Text color="green">All selected tools are already installed.</Text> : null}
      {plan.length > 0 ? (
        <Box flexDirection="column">
          <Text bold>Deck will run</Text>
          {plan.map((tool) => (
            <Text key={tool.id}>  {tool.installKind === "external" ? `manual install ${tool.source}` : `pi install ${tool.source}`}</Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={
            plan.length > 0
              ? [
                  { id: "install", label: "Install selected Pi tools now" },
                  { id: "skip", label: "Skip installation" },
                ]
              : [{ id: "continue", label: "Continue" }]
          }
        />
      </Box>
    </Box>
  );
}

function OpenCodeInstallationReviewScreen({ cursor, plan }: { cursor: number; plan: InstallableOpenCodeTool[] }) {
  return (
    <Box flexDirection="column">
      {plan.length === 0 ? <Text color="green">All selected OpenCode tools are already installed.</Text> : null}
      {plan.length > 0 ? (
        <Box flexDirection="column">
          <Text bold>Deck will run</Text>
          {plan.map((tool) => (
            <Text key={tool.id}>
              {"  "}
              {tool.installKind === "external" ? `manual install ${tool.module}` : `opencode plugin ${tool.module} --global`}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={
            plan.length > 0
              ? [
                  { id: "install", label: "Install selected OpenCode tools now" },
                  { id: "skip", label: "Skip installation" },
                ]
              : [{ id: "continue", label: "Continue" }]
          }
        />
      </Box>
    </Box>
  );
}

export function CompleteScreen({ results, developerTeamResults, status }: { results: (PiToolInstallResult | OpenCodeToolInstallResult)[]; developerTeamResults: AgentApplyResult[]; status?: string }) {
  const hasResults = results.length > 0 || developerTeamResults.length > 0;

  if (!hasResults) {
    return (
      <Box flexDirection="column">
        <Text>{status || "Nothing was changed."}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Enter to return to Home.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Installation completed.</Text>
      {results.map((result, index) => (
        <Text key={`${result.tool}-${index}`} color={result.success ? "green" : "red"}>
          {result.success ? "✓" : "✗"} {result.tool}{result.message ? ` — ${result.message}` : ""}
        </Text>
      ))}
      {developerTeamResults.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Developer Team</Text>
          {developerTeamResults.map((result) => (
            <Text key={`${result.agentId}-${result.kind}`} color={result.status === "unchanged" ? "green" : result.status === "updated" ? "yellow" : "cyan"}>
              {result.status === "unchanged" ? "✓" : result.status === "updated" ? "↻" : "+"} {result.agentId} <Text dimColor>({result.kind}, {result.status})</Text>
            </Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>Press Enter to return to Home.</Text>
      </Box>
    </Box>
  );
}

/** Masked, ephemeral Tavily entry screen. It never renders the entered value. */
export function WebSearchCredentialScreen({ value, error }: { value: string; error?: string }) {
  const mask = value.length > 0 ? "•".repeat(Math.min([...value].length, 64)) : "…";
  return (
    <Box flexDirection="column">
      <Text bold>Tavily credential</Text>
      <Text dimColor>Enter TAVILY_API_KEY. With your explicit choice, Deck writes it as plaintext only to the active .bashrc or .zshrc profile.</Text>
      <Text dimColor>The value is masked here and never stored in Deck config, MCP config, review plans, logs, or diagnostics.</Text>
      <Box marginTop={1}>
        <Text>Credential: {mask}</Text>
      </Box>
      {error ? <Text color="red">{error}</Text> : null}
      <Box marginTop={1}>
        <Text dimColor>Press Enter to save and enable Web Search. Escape cancels without writing.</Text>
      </Box>
    </Box>
  );
}

/** Render a redacted, actionable result for the masked credential screen. */
export function webSearchCredentialSetupError(result: WebSearchSetupResult): string {
  if (result.profileStatus === "manual-cleanup-required") {
    const message = result.message ?? "Credential may remain because safe profile rollback could not be confirmed.";
    const guidance = result.guidance
      ?? "Inspect the reported profile path and, if necessary, remove only the exact Deck-owned Web Search block before retrying.";
    const path = result.profilePath ? ` Profile: ${result.profilePath}.` : "";
    return `${message} ${guidance}${path}`;
  }
  if (result.diagnosticCodes.includes("deck-config-write-failed")) {
    return "Credential was not enabled because Deck configuration could not be saved. Retry after resolving the project configuration.";
  }
  return "Credential could not be saved to the active shell profile. Check the selected shell and profile ownership, then retry.";
}

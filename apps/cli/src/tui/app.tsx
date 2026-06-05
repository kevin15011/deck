import React, { useEffect, useMemo, useState } from "react";
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
  type PiRunnerFullCapabilityInventory,
  type PiThinkingLevel,
  type AgentApplyResult,
  type DeveloperTeamApplyResult,
  PI_THINKING_LEVELS,
  writeSupermemoryPiMcpConfig,
  redactPiMcpConfigDiagnosticText,
  type PiMcpConfigWriteResult,
  buildPiInstallationPlan,
  installPiTools,
  inspectPiEnvironment,
  reviewPiRequiredTools,
  buildPiRunnerCapabilityInventory,
  listModelsForProvider,
  buildModelInventoryFromPiListModels,
} from "@deck/adapter-pi";
import {
  OPENCODE_THINKING_LEVELS,
  inspectOpenCodeEnvironment,
  reviewOpenCodeTools,
  buildOpenCodeRunnerCapabilityInventory,
  installOpenCodeTools,
  OPENCODE_INSTALLABLE_TOOLS,
} from "@deck/adapter-opencode";
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import { getStandaloneSkills, getStandaloneSkillBody } from "@deck/core/skills/external";

import { createEngramMemoryProvider } from "@deck/adapter-engram";
import { createSupermemoryMemoryProvider } from "@deck/adapter-supermemory";
import type { AdaptiveMemoryProvider } from "@deck/core/memory/adaptive-memory";
import { readDeckConfig, writeDeckConfig, readGlobalDeckConfig, writeGlobalDeckConfig, getDefaultDeckConfig, type AdaptiveMemoryActiveProvider, type NormalizedDeckConfig } from "@deck/core/config/deck-config";
import { buildCapabilityInstructionBundle, getEnabledPackageInstructionIds } from "@deck/core";

import {
  getNextScreenAfterDeveloperTeamInstall,
  getNextScreenAfterDeveloperTeamReview,
  getNextScreenAfterEnvironmentSelection,
  getNextScreenAfterPiToolInstall,
  getNextScreenAfterTeamSelection,
  getNextScreenAfterPersonalitySelection,
} from "../developer-team-flow";
import { getEnvironmentOptions, getHomeMenuOptions } from "../menu-options";
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
  MemoryProviderSelectionScreen,
  SupermemorySetupScreen,
  type SupermemorySetupValues,
} from "./screens/developer-team-screens";
import { runRunnerReviewPlan, type RunnerActionRunResult } from "./runner-dashboard/action-runner";
import {
  getDashboardContinueEffect,
  getDashboardToggleAction,
  type RunnerDashboardContinueEffect,
} from "./runner-dashboard/input-handler";
import { reduceRunnerDashboard } from "./runner-dashboard/reducer";
import { createDefaultRunnerDashboardState, loadRunnerPackageInstructionsFromConfig, type RunnerDashboardState } from "./runner-dashboard/state";
import { RunnerDashboardScreens } from "./screens/runner-dashboard-screens";
import { getAdapter } from "../runner-adapters";
import { HomeScreen } from "./screens/home-screen";
import { DoctorScreen } from "./screens/doctor-screen";
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
import { detectInstallKind, runUpgradeOrchestrator } from "../upgrade-command/orchestrator";
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
  | "no-providers"
  | "memory-provider-selection"
  | "supermemory-token"
  // Removed: userId/teamId/orgId screens — token-only config
  | "developer-team-review"
  | "developer-team-installing"
  | "opencode-preflight-checking"
  | "configure-packages-runner-selection"
  | "configure-packages-detail"
  | "doctor"
  | "complete";

const HELP = "j/k or ↑/↓: navigate • space: toggle • enter: continue • esc: back • q: quit";

type MemoryProviderChoice = AdaptiveMemoryActiveProvider;

// ============================================================================
// Config resolution helpers (Task 7)
// ============================================================================

/**
 * Resolve Deck config from project root or global config.
 *
 * This allows the TUI to work from any directory — when inside a Deck monorepo,
 * it uses project-local config; otherwise, it uses global config.
 *
 * @param projectRoot - Resolved project root (may be null)
 * @returns Config object
 */
async function resolveDeckConfig(projectRoot: string | null): Promise<NormalizedDeckConfig> {
  if (projectRoot) {
    try {
      return readDeckConfig(projectRoot);
    } catch {
      // Fall through to global config
    }
  }
  // Use global config when project root is unavailable
  try {
    return await readGlobalDeckConfig();
  } catch {
    return getDefaultDeckConfig();
  }
}

/**
 * Write Deck config to project root or global config.
 *
 * @param config - Config to write
 * @param projectRoot - Resolved project root (may be null)
 */
async function persistDeckConfig(config: NormalizedDeckConfig, projectRoot: string | null): Promise<void> {
  if (projectRoot) {
    try {
      writeDeckConfig(projectRoot, config);
      return;
    } catch {
      // Fall through to global config
    }
  }
  // Use global config when project root is unavailable
  try {
    await writeGlobalDeckConfig(config);
  } catch {
    // Silently fail — UI should not crash on config write errors
  }
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


type SupermemoryPiMcpWriter = (options: { token: string; serverName?: string; configPath?: string; homeDir?: string }) => PiMcpConfigWriteResult;

export function handOffSupermemoryCredentialToPiMcp(
  values: SupermemorySetupValues,
  options?: { writer?: SupermemoryPiMcpWriter; configPath?: string; homeDir?: string },
): { success: boolean; message: string; path?: string } {
  const token = values.token.trim();
  if (!token) {
    return { success: false, message: "Supermemory token is required and must be stored outside Deck config." };
  }

  const writer = options?.writer ?? writeSupermemoryPiMcpConfig;
  const result = writer({ token, serverName: "supermemory", configPath: options?.configPath, homeDir: options?.homeDir });
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

export function buildDashboardSupermemorySetupUpdate(values: SupermemorySetupValues):
  | { ok: true; values: { configured: true; hasToken: true; diagnostics: string[] }; status: string }
  | { ok: false; message: string } {
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
      diagnostics: ["Supermemory token captured ephemerally for Review & Install; no Pi MCP config was written yet."],
    },
    status: "Dashboard Adaptive Memory: Supermemory ready for Review & Install. Token: [redacted]; Pi MCP config will include x-sm-project header.",
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

export function DeckApp() {
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
  const [selectedOptionalTools, setSelectedOptionalTools] = useState<InstallablePiToolId[]>(
    getAdapter("pi").getSelectableTools().map((tool: any) => tool.id),
  );
  const [openCodePreflight, setOpenCodePreflight] = useState<OpenCodePreflightResult | null>(null);
  const [openCodeToolsReview, setOpenCodeToolsReview] = useState<OpenCodeToolsReview | null>(null);
  const [installResults, setInstallResults] = useState<(PiToolInstallResult | OpenCodeToolInstallResult)[]>([]);
  const [developerTeamResults, setDeveloperTeamResults] = useState<AgentApplyResult[]>([]);
  const [developerTeamCursor, setDeveloperTeamCursor] = useState(0);
  const [selectedTeams, setSelectedTeams] = useState<string[]>(
    getAdapter("pi").getTeams("pi-development").map((team: any) => team.id),
  );

  // Project root resolved once at startup (can be null for global config fallback)
  const [localResolvedProjectRoot] = useState<string | null>(() => resolveProjectRoot());

  // Model configuration state
  const [detectedProviders, setDetectedProviders] = useState<PiProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<PiProvider | null>(null);
  const [providerModels, setProviderModels] = useState<PiModel[]>([]);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, PiModel[]>>({});
  const [selectedModel, setSelectedModel] = useState<PiModel | null>(null);
  const [modelAssignments, setModelAssignments] = useState<DeveloperTeamModelAssignments>({});
  const [thinkingAssignments, setThinkingAssignments] = useState<DeveloperTeamThinkingAssignments>({});
  const [agentAssignmentIndex, setAgentAssignmentIndex] = useState(0);
  const [agentConfigCursor, setAgentConfigCursor] = useState(0);
  const [modelEnvironmentCursor, setModelEnvironmentCursor] = useState(0);
  const [modelTeamCursor, setModelTeamCursor] = useState(0);
  const [selectedModelEnvironment, setSelectedModelEnvironment] = useState<EnvironmentId | null>(null);
  const [modelConfigSource, setModelConfigSource] = useState<"install" | "menu" | "dashboard" | null>(null);
  const [modelConfigRuntime, setModelConfigRuntime] = useState<"pi" | "opencode">("pi");
  const [memoryProvider, setMemoryProvider] = useState<AdaptiveMemoryProvider | undefined>(undefined);
  const [memoryProviderChoice, setMemoryProviderChoice] = useState<MemoryProviderChoice>("none");
  const [supermemorySetup, setSupermemorySetup] = useState<SupermemorySetupValues>(() => ({ token: "" }));
  const [supermemoryError, setSupermemoryError] = useState<string | undefined>(undefined);
  const [memoryStatus, setMemoryStatus] = useState<string | undefined>(undefined);
  const [dashboardSupermemorySetupActive, setDashboardSupermemorySetupActive] = useState(false);
  const [dashboardCompletionStatus, setDashboardCompletionStatus] = useState<string | undefined>(undefined);
  const [dashboardState, setDashboardState] = useState<RunnerDashboardState>(() => createDefaultRunnerDashboardState());
  const [dashboardInventory, setDashboardInventory] = useState<PiRunnerFullCapabilityInventory>({});
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardActionResults, setDashboardActionResults] = useState<RunnerActionRunResult[]>([]);

  // Configure packages standalone flow
  const [configurePackagesRunner, setConfigurePackagesRunner] = useState<"pi" | "opencode" | null>(null);
  const [configurePackagesCursor, setConfigurePackagesCursor] = useState(0);
  const [configurePackagesToggles, setConfigurePackagesToggles] = useState<Record<string, boolean>>({});

  // Personality selection state
  const [selectedPersonality, setSelectedPersonality] = useState<"guia" | "pragmatica">(() => {
    // Use resolvedProjectRoot from state, which can be null
    try {
      if (localResolvedProjectRoot) {
        const config = readDeckConfig(localResolvedProjectRoot);
        return config.orchestratorPersonality;
      }
      // Fallback to default when outside monorepo
      return "pragmatica";
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
    runReleaseCheckWithTimeout(DEFAULT_RELEASE_CHECK_TIMEOUT_MS, deps)
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
    getCapability: (capabilityId: string) => {
      return getAdapter(dashboardState.runnerScope).getCapability(capabilityId) as any;
    },
    getUserFacingIds: () => {
      return getAdapter(dashboardState.runnerScope).getCapabilityIds() as string[];
    },
  }), [dashboardState.runnerScope]);

  // Runtime-agnostic plan builder — dispatches to the correct adapter based on runnerScope
  const dashboardPlanBuilder = useMemo(() => {
    return (state: RunnerDashboardState, inventory: unknown) => {
      log(`dashboardPlanBuilder: called. runnerScope=${state.runnerScope} selectedCaps=${JSON.stringify(state.selectedCapabilities)} inventoryType=${typeof inventory}`);
      try {
        const adapter = getAdapter(state.runnerScope);
        log(`dashboardPlanBuilder: adapter=${adapter.runnerId}`);
        const plan = adapter.buildReviewPlan(
          {
            runnerId: state.runnerScope as any,
            selectedCapabilities: state.selectedCapabilities,
            adaptiveMemory: state.adaptiveMemory as any,
            teams: state.teams as any,
            runtime: { toolsReview: state.runtime.toolsReview as any },
            packageInstructions: state.packageInstructions as any,
          },
          inventory as Parameters<ReturnType<typeof getAdapter>["buildReviewPlan"]>[1],
        );
        log(`dashboardPlanBuilder: SUCCESS. planSteps=${Array.isArray(plan) ? plan.length : "not-array"}`);
        return plan;
      } catch (error) {
        const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
        log(`dashboardPlanBuilder: FAILED: ${msg}`);
        throw error;
      }
    };
  }, []);

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
    try { appendFileSync("/tmp/deck-debug.txt", `useInput TOP: input="${input}" key=${JSON.stringify(key)} screen=${screen}\n`); } catch {}
    try {
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
    if (screen !== "pi-preflight-checking") return;

    let cancelled = false;

    async function runPreflight() {
      await new Promise((resolve) => setTimeout(resolve, 120));

      const selected = selectedEnvironments;
      const statuses = detectSelectedRuntimes(selected);
      const detectedPi = statuses.find((s) => s.runtime === "pi" && s.installed && s.command);

      if (!detectedPi?.command) {
        if (!cancelled) resetCursor("complete");
        return;
      }

      const preflight = inspectPiEnvironment({ command: detectedPi.command });
      const review = reviewPiRequiredTools({ command: detectedPi.command });

      if (!cancelled) {
        setPiPreflight(preflight);
        setToolsReview(review);
        const inventory = buildPiRunnerCapabilityInventory(review, preflight, { runnerScope: "pi" });
        setDashboardInventory(inventory);
        // Use resolvedProjectRoot from state, which can be null - fall back to default config
        const piConfig = localResolvedProjectRoot ? readDeckConfig(localResolvedProjectRoot) : getDefaultDeckConfig();
        setDashboardState(createDefaultRunnerDashboardState({
          runtime: { runnerCommand: detectedPi.command, preflight, toolsReview: review },
          capabilityStatuses: Object.fromEntries(
            Object.entries(inventory)
              .filter(([key]) => key !== '_internal')
              .map(([capabilityId, entry]) => [capabilityId, (entry as any)?.status]),
          ),
          packageInstructions: loadRunnerPackageInstructionsFromConfig(piConfig, "pi"),
        }));
        setDashboardActionResults([]);
        resetCursor("pi-runner-dashboard");
      }
    }

    void runPreflight();

    return () => {
      cancelled = true;
    };
  }, [screen, selectedEnvironments]);

  useEffect(() => {
    if (screen !== "opencode-preflight-checking") return;

    let cancelled = false;

    async function runOpenCodePreflight() {
      await new Promise((resolve) => setTimeout(resolve, 120));

      const selected = selectedEnvironments;
      const statuses = detectSelectedRuntimes(selected);
      const detectedOpenCode = statuses.find((s) => s.runtime === "opencode" && s.installed && s.command);

      if (!detectedOpenCode?.command) {
        if (!cancelled) resetCursor("complete");
        return;
      }

      const preflight = inspectOpenCodeEnvironment({ command: detectedOpenCode.command });
      const review = reviewOpenCodeTools({ packageManifest: preflight.packageManifest });

      if (!cancelled) {
        setOpenCodePreflight(preflight);
        setOpenCodeToolsReview(review);
        // Build OpenCode capability inventory and route to the same runner dashboard
        const inventory = buildOpenCodeRunnerCapabilityInventory(review, { runnerScope: "opencode", includeInternal: true });
        setDashboardInventory(inventory as any);
        // Use resolvedProjectRoot from state, which can be null - fall back to default config
        const opencodeConfig = localResolvedProjectRoot ? readDeckConfig(localResolvedProjectRoot) : getDefaultDeckConfig();
        setDashboardState(createDefaultRunnerDashboardState({
          runtime: { runnerCommand: detectedOpenCode.command, preflight, toolsReview: review as any },
          runnerScope: "opencode",
          capabilityStatuses: Object.fromEntries(
            Object.entries(inventory)
              .filter(([key]) => key !== '_internal')
              .map(([capabilityId, entry]) => [capabilityId, (entry as any)?.status]),
          ),
          teams: {
            "developer-team": {
              teamId: "developer-team",
              label: "Developer Team",
              selected: true,
            },
          },
          packageInstructions: loadRunnerPackageInstructionsFromConfig(opencodeConfig, "opencode"),
        }));
        setDashboardActionResults([]);
        resetCursor("pi-runner-dashboard");
      }
    }

    void runOpenCodePreflight();

    return () => {
      cancelled = true;
    };
  }, [screen, selectedEnvironments]);

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
    if (screen !== "pi-runner-dashboard" || dashboardState.screen !== "install-progress" || !dashboardState.plan) return;

    log(`useEffect[install-progress]: STARTING. screen=${screen} dashboardScreen=${dashboardState.screen} hasPlan=${!!dashboardState.plan}`);

    let cancelled = false;

    async function runDashboardInstall() {
      log(`runDashboardInstall: starting`);
      setDashboardActionResults([]);
      const adapter = getAdapter(dashboardState.runnerScope);
      log(`runDashboardInstall: adapter=${adapter.runnerId} projectRoot=${localResolvedProjectRoot ?? process.cwd()}`);
      const resolvedMemoryProvider = memoryProvider;
      // Use stored project root, not the function
      const projectRoot = localResolvedProjectRoot ?? process.cwd();
      const environmentId = adapter.environmentIds[0];
      log(`runDashboardInstall: calling runRunnerReviewPlan`);
      const results = await runRunnerReviewPlan(dashboardState.plan!, {
        projectRoot: projectRoot,
        runnerCommand: dashboardState.runtime.runnerCommand,
        dashboardState,
        supermemoryToken: dashboardState.adaptiveMemory.supermemory?.hasToken ? supermemorySetup.token.trim() || undefined : undefined,
        memoryProvider: resolvedMemoryProvider,
        resolvedMemoryProvider,
        writeMcpConfig: adapter.writeMcpConfig?.bind(adapter),
        installPackages: async (runnerCommand, packages, onResult) => {
          log(`installPackages (OpenCode): installing ${packages.map(p => `${p.id}(${p.source})`).join(", ")}`);
          // Use package.id as the catalog lookup key (not name/source)
          const selectedToolIds = packages.map(p => p.id).filter(Boolean);
          // Get the tools from the catalog (not re-reviewing installed status — plan already decided)
          const toolsToInstall = OPENCODE_INSTALLABLE_TOOLS.filter(t => selectedToolIds.includes(t.id));
          log(`installPackages (OpenCode): matched ${toolsToInstall.length}/${selectedToolIds.length} tools from catalog`);
          
          // Handle each requested package - return failure for zero matches
          if (toolsToInstall.length === 0) {
            // No matches - return honest failure for each requested package
            return packages.map(p => ({ 
              success: false, 
              message: `No installable OpenCode tool matched id "${p.id}".` 
            }));
          }
          
          // Handle partial matches - packages not in catalog should fail
          // Use Set<string> since pkg.id is string, but t.id is InstallableOpenCodeToolId (narrower)
          const matchedIds: Set<string> = new Set(toolsToInstall.map(t => t.id));
          const results: Array<{ success: boolean; message?: string }> = [];

          for (const pkg of packages) {
            if (!matchedIds.has(pkg.id)) {
              // This package was requested but not found in catalog - honest failure
              results.push({ 
                success: false, 
                message: `No installable OpenCode tool matched id "${pkg.id}".` 
              });
            }
          }
          
          // Install matched tools
          const installResults = await installOpenCodeTools("opencode", toolsToInstall, (r) => {
            onResult({ success: r.success, message: r.message });
          });
          
          // Map install results to the matched tools
          for (const tool of toolsToInstall) {
            // Match by tool.id (lowercase) or tool.name case-insensitively
            const installResult = installResults.find(r => 
              r.tool.toLowerCase() === tool.id.toLowerCase() || 
              r.tool.toLowerCase() === tool.name.toLowerCase()
            );
            results.push({ 
              success: installResult?.success ?? false, 
              message: installResult?.message 
            });
          }
          
          log(`installPackages (OpenCode): results=${results.map(r => `${r.success ? "ok" : "fail"}`).join(",")}`);
          return results;
        },
        installTeamBundle: async (projectRoot: string, options?: { memoryProvider?: AdaptiveMemoryProvider; modelAssignments?: DeveloperTeamModelAssignments; thinkingAssignments?: DeveloperTeamThinkingAssignments }) => {
          // Build capability instructions for OpenCode (Pi ignores undefined capabilityInstructions)
          const deckConfig = readDeckConfig(projectRoot);
          const enabledIds = getEnabledPackageInstructionIds(deckConfig, "opencode");
          const capabilityInstructions = enabledIds.length > 0 ? buildCapabilityInstructionBundle(enabledIds) : undefined;

          const plan = adapter.buildDeveloperTeamInstallPlan({
            projectRoot,
            environmentId,
            modelAssignments: options?.modelAssignments,
            thinkingAssignments: options?.thinkingAssignments,
            memoryProvider: options?.memoryProvider,
            capabilityInstructions,
          });

          const backup = adapter.backupDeveloperTeamFiles(plan);

          try {
            const applyResult = await adapter.applyDeveloperTeamInstall({
              projectRoot,
              plan,
              environmentId,
            });

            const verifyResult = adapter.verifyDeveloperTeamInstall(plan);
            if (!verifyResult.valid) {
              adapter.rollbackDeveloperTeamFiles(backup);
              const diagnosticsMsg =
                verifyResult.diagnostics.length > 0
                  ? `\nDetails: ${verifyResult.diagnostics.slice(0, 3).join("; ")}${verifyResult.diagnostics.length > 3 ? ` (+${verifyResult.diagnostics.length - 3} more)` : ""}`
                  : "";
              const failMsg = `Verification failed. Changes rolled back.${diagnosticsMsg}`;
              log(`[runDashboardInstall] verifyResult.valid=false diagnostics=${JSON.stringify(verifyResult.diagnostics)}`);
              throw new Error(failMsg);
            }

            return { results: applyResult.results };
          } catch (error) {
            adapter.rollbackDeveloperTeamFiles(backup);
            throw error instanceof Error ? error : new Error(String(error));
          }
        },
        onActionResult: (result: RunnerActionRunResult) => {
          if (!cancelled) setDashboardActionResults((current) => [...current, result]);
        },
      });

      log(`runDashboardInstall: runRunnerReviewPlan DONE. results=${results.length} cancelled=${cancelled}`);

      if (!cancelled) {
        setDashboardActionResults(results);
        setDashboardCompletionStatus(getDashboardCompletionStatus());
        clearDashboardSupermemoryEphemeralState();
        setDashboardState((current) => reduceRunnerDashboard(current, { type: "complete" }, dashboardPlanBuilder));
        log(`runDashboardInstall: state set to complete`);
      }
    }

    void runDashboardInstall().catch((err) => {
      const msg = `[runDashboardInstall] FAILED: ${err instanceof Error ? err.stack : String(err)}`;
      log(msg);
      console.error(msg);
    });

    return () => {
      cancelled = true;
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
            // The real registry is used here; tests inject a fake.
            adapterRegistry: {
              list: () => [],
              has: () => false,
              get: () => {
                throw new Error("No adapter available in the TUI upgrade path; use `deck upgrade` for the real path.");
              },
            },
            readDeckConfig: () => getDefaultDeckConfig(),
          },
        });
        if (cancelled) return;
        if (result.status === "rolled_back") {
          setUpgradeProgress({
            kind: "rolled_back",
            ...(result.backupId ? { backupId: result.backupId } : {}),
            reason: "Upgrade failed; rolled back to the previous version.",
          });
          return;
        }
        if (result.status === "partial_failure") {
          setUpgradeProgress({
            kind: "rolled_back",
            ...(result.backupId ? { backupId: result.backupId } : {}),
            reason: "One or more steps failed; rolled back.",
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
      const projectRoot = resolveProjectRoot({ require: true });

      // Determine environmentId based on selected environments
      const openCodeExclusive = selectedEnvironments.includes("opencode-development") && !selectedEnvironments.includes("pi-development");
      const environmentId = openCodeExclusive ? "opencode-development" : "pi-development";
      const adapter = getAdapter(environmentId);

      // Build capability instructions and standalone skills (only used by OpenCode, Pi ignores them)
      const deckConfig = readDeckConfig(projectRoot);
      const enabledIds = getEnabledPackageInstructionIds(deckConfig, "opencode");
      const capabilityInstructions = enabledIds.length > 0 ? buildCapabilityInstructionBundle(enabledIds) : undefined;
      const standaloneSkills = getStandaloneSkills().map((s: { skillId: string }) => ({ skillId: s.skillId, body: getStandaloneSkillBody(s.skillId)! }));

      const plan = adapter.buildDeveloperTeamInstallPlan({
        projectRoot,
        environmentId,
        modelAssignments,
        thinkingAssignments,
        memoryProvider,
        capabilityInstructions,
        standaloneSkills,
      });

      const backup = adapter.backupDeveloperTeamFiles(plan);

      try {
        const applyResult = await adapter.applyDeveloperTeamInstall({ projectRoot, plan, environmentId });
        const verifyResult = adapter.verifyDeveloperTeamInstall(plan);

        if (!cancelled) {
          if (!verifyResult.valid) {
            adapter.rollbackDeveloperTeamFiles(backup);
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
          adapter.rollbackDeveloperTeamFiles(backup);
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
    if (screen === "model-environment-selection") return getEnvironmentOptions().length - 1;
    if (screen === "model-team-selection") {
      const env = selectedModelEnvironment ?? "pi-development";
      const teams = getAdapter(env).getTeams(env) as any[];
      return Math.max(0, teams.length - 1);
    }
    if (screen === "environment-selection") return getEnvironmentOptions().length - 1;
    if (screen === "optional-tools") return getAdapter("pi").getSelectableTools().length - 1;
    if (screen === "installation-review") return 1;
    if (screen === "team-selection") return Math.max(0, getAdapter("pi").getTeams("pi-development").length - 1);
    if (screen === "memory-provider-selection") return 2;
    if (screen === "developer-team-review") return 1;
    if (screen === "agent-model-config-list") return DEVELOPER_TEAM_AGENTS.length;
    if (screen === "model-provider-selection") return Math.max(0, detectedProviders.length - 1);
    if (screen === "model-selection") return Math.max(0, providerModels.length - 1);
    if (screen === "agent-model-assignment") {
      const thinkingLevels = modelConfigRuntime === "opencode" ? OPENCODE_THINKING_LEVELS : PI_THINKING_LEVELS;
      const adapter = getAdapter(modelConfigRuntime);
      const supportsThinking = selectedModel ? adapter.supportsThinking(selectedModel.id) : false;
      return selectedModel && supportsThinking ? thinkingLevels.length - 1 : 0;
    }
    if (screen === "no-providers") return 0;
    if (screen === "personality-selection") return 1; // 2 options: guia, pragmatica
    if (screen === "configure-packages-runner-selection") return 2; // Pi, OpenCode, Back
    if (screen === "configure-packages-detail") return 4; // 3 packages + Apply + Back
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
      const option = getEnvironmentOptions()[cursor];
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
      const packages = ["codebase-memory", "context-mode", "rtk"];
      const pkg = packages[configurePackagesCursor];
      if (!pkg) return;
      setConfigurePackagesToggles((current) => ({
        ...current,
        [pkg]: !current[pkg],
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
      const option = getEnvironmentOptions()[modelEnvironmentCursor];
      if (!option) return;
      const environment = option.value as EnvironmentId;
      setSelectedModelEnvironment(environment);

      if (environment === "pi-development" || environment === "opencode-development") {
        resetCursor("model-team-selection");
      } else {
        resetCursor("complete");
      }
      return;
    }

    if (screen === "model-team-selection") {
      const env = selectedModelEnvironment ?? "pi-development";
      const teams = getAdapter(env).getTeams(env) as any[];
      const team = teams[modelTeamCursor];
      if (!team) return;

      if (team.id === "developer-team") {
        const isO = selectedModelEnvironment === "opencode-development";
        const runtime: "pi" | "opencode" = isO ? "opencode" : "pi";
        setModelConfigRuntime(runtime);
        hydrateDeveloperTeamModelConfig(runtime);

        if (isO) {
          const inventory = detectOpenCodeModelInventoryForTui();
          setDetectedProviders(inventory.providers);
          setModelsByProvider(inventory.modelsByProvider);
          if (inventory.providers.length === 0) {
            resetCursor("no-providers");
          } else {
            resetCursor("agent-model-config-list");
          }
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
        // Use require: true for backward compatibility - writes need a path
        const projectRoot = resolveProjectRoot({ require: true });
        const existingConfig = readDeckConfig(projectRoot);
        writeDeckConfig(projectRoot, {
          ...existingConfig,
          orchestratorPersonality: selected.id,
        });
      } catch (error) {
        // Log config errors with error code only (no sensitive details)
        const errCode = error instanceof Error ? (error as { code?: string }).code : undefined;
        debug(`personality-selection config error: ${errCode ?? "UNKNOWN"}`);
        // Stay on screen, user can retry
        return;
      }
      const nextScreen = getNextScreenAfterPersonalitySelection({
        selectedEnvironments,
        hasPiCommand: true,
        nextEnvironment: selectedEnvironments[0] ?? null,
      });
      resetCursor(nextScreen);
      return;
    }

    if (screen === "configure-packages-runner-selection") {
      const runners = [
        { id: "pi", label: "Pi" },
        { id: "opencode", label: "OpenCode" },
        { id: "back", label: "Back" },
      ];
      const selected = runners[configurePackagesCursor];
      if (!selected || selected.id === "back") {
        resetCursor("home");
        return;
      }
      const runner = selected.id as "pi" | "opencode";
      // Use resolvedProjectRoot from state, which can be null - fall back to default config
      const config = localResolvedProjectRoot ? readDeckConfig(localResolvedProjectRoot) : getDefaultDeckConfig();
      const instructions = loadRunnerPackageInstructionsFromConfig(config, runner);
      setConfigurePackagesRunner(runner);
      setConfigurePackagesCursor(0);
      setConfigurePackagesToggles({
        "codebase-memory": instructions["codebase-memory"] ?? false,
        "context-mode": instructions["context-mode"] ?? false,
        "rtk": instructions["rtk"] ?? false,
      });
      resetCursor("configure-packages-detail");
      return;
    }

    if (screen === "configure-packages-detail") {
      const options = [
        { id: "codebase-memory" },
        { id: "context-mode" },
        { id: "rtk" },
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
        // Use require: true for backward compatibility - writes need a path
        const projectRoot = resolveProjectRoot({ require: true });
        const existingConfig = readDeckConfig(projectRoot);
        const newPackageInstructions = {
          ...existingConfig.packageInstructions,
          [configurePackagesRunner]: {
            ...existingConfig.packageInstructions?.[configurePackagesRunner],
            ...configurePackagesToggles,
          },
        };
        writeDeckConfig(projectRoot, {
          ...existingConfig,
          packageInstructions: newPackageInstructions,
        });

        const adapter = getAdapter(configurePackagesRunner);

        // Construir bundle de instrucciones
        const enabledIds = Object.entries(configurePackagesToggles)
          .filter(([, enabled]) => enabled)
          .map(([id]) => id);
        const bundle = buildCapabilityInstructionBundle(enabledIds as any);

        // Generar y aplicar plan vía adapter (el adapter lee assignments internamente)
        const standaloneSkills = getStandaloneSkills().map((s: { skillId: string }) => ({ skillId: s.skillId, body: getStandaloneSkillBody(s.skillId)! }));
        const plan = adapter.buildDeveloperTeamInstallPlan({
          projectRoot,
          environmentId: configurePackagesRunner as any,
          capabilityInstructions: bundle,
          standaloneSkills,
        });

        try {
          const result = await adapter.applyDeveloperTeamInstall({ projectRoot, plan });
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
        const runtime: "pi" | "opencode" = selectedEnvironments.includes("opencode-development") && !selectedEnvironments.includes("pi-development") ? "opencode" : "pi";
        setModelConfigRuntime(runtime);
        hydrateDeveloperTeamModelConfig(runtime);
        const inventory = runtime === "opencode" ? detectOpenCodeModelInventoryForTui() : detectPiModelInventoryForTui();
        setDetectedProviders(inventory.providers);
        setModelsByProvider(inventory.modelsByProvider);
        setModelConfigSource("install");
        if (inventory.providers.length === 0) {
          resetCursor("no-providers");
        } else {
          resetCursor("agent-model-config-list");
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
      const models = modelsByProvider[provider.id] ?? (modelConfigRuntime === "opencode" ? [] : listModelsForProvider(provider.id, { runCommand: runPiCommand }));
      setProviderModels(models);
      setSelectedModel(null);
      resetCursor("model-selection");
      return;
    }

    if (screen === "agent-model-config-list") {
      if (cursor === DEVELOPER_TEAM_AGENTS.length) {
        // Finish button
        if (modelConfigSource === "install") {
          // Persist model assignments before moving to next step
          applyDeveloperTeamModelConfig();
          resetCursor("memory-provider-selection");
        } else if (modelConfigSource === "dashboard") {
          // For OpenCode and Pi, the dashboard plan builder has no team-application actions,
          // so persist model changes to disk immediately on Finish.
          if (modelConfigRuntime === "opencode" || modelConfigRuntime === "pi") {
            applyDeveloperTeamModelConfig();
          }
          syncDashboardDeveloperTeamModelConfig();
          resetCursor("pi-runner-dashboard");
        } else {
          applyDeveloperTeamModelConfig();
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

      // T7: Check if model supports thinking using the adapter's resolver
      const supportsThinking = getAdapter(modelConfigRuntime).supportsThinking(model.id);

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
        }
        setSelectedModel(null);
        resetCursor("agent-model-config-list");
        return;
      }

      setSelectedModel(model as any);
      const agent = DEVELOPER_TEAM_AGENTS[agentAssignmentIndex];
      const existingThinking = agent ? thinkingAssignments[agent.id] : undefined;

      const thinkingLevels = modelConfigRuntime === "opencode" ? OPENCODE_THINKING_LEVELS : PI_THINKING_LEVELS;

      const resolveThinking = getAdapter(modelConfigRuntime).resolveThinking(model.id, existingThinking as any);

      const defaultThinking = resolveThinking ?? (modelConfigRuntime === "opencode" ? "low" : "low");
      const thinkingIndex = thinkingLevels.indexOf(defaultThinking as any);
      resetCursor("agent-model-assignment", Math.max(0, thinkingIndex));
      return;
    }

    if (screen === "agent-model-assignment") {
      if (!selectedModel) return;
      const agent = DEVELOPER_TEAM_AGENTS[agentAssignmentIndex];
      if (!agent) return;

      const thinkingLevels = modelConfigRuntime === "opencode" ? OPENCODE_THINKING_LEVELS : PI_THINKING_LEVELS;
      const rawThinking = thinkingLevels[cursor] ?? "low";

      const thinking = getAdapter(modelConfigRuntime).resolveThinking(selectedModel.id, rawThinking as any);

      setModelAssignments((current) => ({ ...current, [agent.id]: selectedModel.id }));
      setThinkingAssignments((current) => {
        const next = { ...current };
        if (thinking) next[agent.id] = thinking as any;
        else delete next[agent.id];
        return next;
      });
      setSelectedModel(null);
      resetCursor("agent-model-config-list");
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

  function handleDashboardInput(input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean }) {
    debug(`handleDashboardInput ENTER: input="${input}" key=${JSON.stringify(key)} screen=${dashboardState.screen}`);
    if (input === "q") {
      log("handleDashboardInput: q pressed → exit");
      clearDashboardSupermemoryEphemeralState();
      exit();
      return;
    }
    if (key.escape) {
      log("handleDashboardInput: escape pressed");
      if (dashboardState.screen === "dashboard") {
        clearDashboardSupermemoryEphemeralState();
        resetCursor("environment-selection");
      } else {
        setDashboardState((current) => reduceRunnerDashboard(current, { type: "back" }, dashboardPlanBuilder));
      }
      return;
    }
    if (key.upArrow || input === "k") {
      setDashboardState((current) => reduceRunnerDashboard(current, { type: "cursor-up" }, dashboardPlanBuilder));
      return;
    }
    if (key.downArrow || input === "j") {
      setDashboardState((current) => reduceRunnerDashboard(current, { type: "cursor-down" }, dashboardPlanBuilder));
      return;
    }
    if (input === " ") {
      toggleDashboardCurrent();
      return;
    }
    if (key.return) {
      log(`handleDashboardInput: Enter pressed. dashboardScreen=${dashboardState.screen} cursor=${dashboardState.cursor}`);
      continueDashboardCurrent();
    }
  }

  function toggleDashboardCurrent() {
    const action = getDashboardToggleAction(dashboardState, dashboardCapabilityResolver);
    if (action) setDashboardState((current) => reduceRunnerDashboard(current, action, dashboardPlanBuilder));
  }

  function continueDashboardCurrent() {
    log(`continueDashboardCurrent: screen=${dashboardState.screen} cursor=${dashboardState.cursor}`);
    const effect = getDashboardContinueEffect(dashboardState, {
      inventory: dashboardInventory,
      canRunPlan: canRunDashboardPlan(dashboardState),
    }, dashboardCapabilityResolver);
    log(`continueDashboardCurrent: effect.type=${effect.type} action=${(effect as any).action?.type ?? "n/a"}`);
    applyDashboardContinueEffect(effect);
    log(`continueDashboardCurrent: done`);
  }

  function applyDashboardContinueEffect(effect: RunnerDashboardContinueEffect) {
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
        setModelConfigRuntime(runtime);
        debug(`open-developer-team-model-config: after setModelConfigRuntime`);
        try {
          hydrateDeveloperTeamModelConfig(runtime);
          debug(`open-developer-team-model-config: after hydrateDeveloperTeamModelConfig`);
        } catch (e) {
          debug(`open-developer-team-model-config: hydrate ERROR: ${e}`);
        }
        let inventory;
        try {
          inventory = runtime === "opencode" ? detectOpenCodeModelInventoryForTui() : detectPiModelInventoryForTui();
          debug(`open-developer-team-model-config: after detect inventory=${JSON.stringify({ providers: inventory.providers.length, modelsByProvider: Object.keys(inventory.modelsByProvider).length })}`);
        } catch (e) {
          debug(`open-developer-team-model-config: detect ERROR: ${e}`);
          inventory = { providers: [], modelsByProvider: {} };
        }
        setDetectedProviders(inventory.providers);
        setModelsByProvider(inventory.modelsByProvider);
        setModelConfigSource("dashboard");
        if (inventory.providers.length === 0) { debug("open-developer-team-model-config: no providers → no-providers"); resetCursor("no-providers"); }
        else { debug("open-developer-team-model-config: has providers → agent-model-config-list"); resetCursor("agent-model-config-list"); }
        debug("open-developer-team-model-config: END");
        return;
      }
      case "reuse-developer-team-model-config": {
        const runtime = dashboardState.runnerScope;
        setModelConfigRuntime(runtime);
        hydrateDeveloperTeamModelConfig(runtime);
        // Use require: true for backward compatibility - reads need a path
        const targetRoot = resolveProjectRoot({ require: true });
        const adapter = getAdapter(runtime);
        const assignments = adapter.readModelAssignments(targetRoot);
        setDashboardState((state) => ({
          ...state,
          teams: {
            ...state.teams,
            "developer-team": {
              ...state.teams["developer-team"],
              modelAssignments: assignments.modelAssignments,
              thinkingAssignments: assignments.thinkingAssignments as any,
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
        goToNextEnvironmentAfterDashboardComplete();
        return;
      case "none":
        return;
    }
  }

  function isSupermemoryInputScreen(value: Screen): value is "supermemory-token" {
    return value === "supermemory-token";
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
    if (key.return) {
      continueSupermemorySetup();
      return;
    }
    const field = supermemoryFieldForScreen(screen);
    if (!field) return;
    if (key.backspace || key.delete) {
      setSupermemorySetup((current) => ({ ...current, [field]: current[field].slice(0, -1) }));
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
    const setup = buildDashboardSupermemorySetupUpdate(values);
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
    if (state.adaptiveMemory.provider === "supermemory") {
      const setup = state.adaptiveMemory.supermemory;
      // Token-only: userId removed, project scoping via x-sm-project header
      if (!setup?.configured || !setup.hasToken) {
        diagnostics.push({ message: "Supermemory requires token to run Review/Install." });
      } else if (!token.trim()) {
        diagnostics.push({ message: "Supermemory requires re-entering the token before running Review/Install." });
      }
    }
    return diagnostics;
  }

  function canRunDashboardPlan(state: RunnerDashboardState): boolean {
    return getDashboardRunBlockDiagnostics(state, supermemorySetup.token).length === 0;
  }

  function persistMemoryProviderSelection(choice: MemoryProviderChoice, values: SupermemorySetupValues): boolean {
    try {
      if (choice === "supermemory") {
        const result = writeSupermemoryPiMcpConfig({ token: values.token.trim(), serverName: "supermemory" });
        if (!result.ok) {
          const message = `Unable to configure Supermemory in Pi MCP config at ${result.path}. Check file permissions and existing MCP config JSON, then try again.`;
          setMemoryProvider(undefined);
          setSupermemoryError(message);
          setMemoryStatus(`Supermemory MCP setup failed: ${message}`);
          return false;
        }
      }

      const config = buildMemoryProviderConfig(choice, values);
      // Use require: true for backward compatibility - writes need a path
      writeDeckConfig(resolveProjectRoot({ require: true }), config);
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

  function hydrateDeveloperTeamModelConfig(runtime?: "pi" | "opencode") {
    const effectiveRuntime = runtime ?? modelConfigRuntime;
    const adapter = getAdapter(effectiveRuntime);

    // T7: Clean up thinkingAssignments for models without confirmed reasoning support
    // Use both readModelAssignments and readThinkingAssignments to get the correct shapes
    const modelAssigns = adapter.readModelAssignments("") || {};
    const thinkingAssigns = adapter.readThinkingAssignments("") || {};

    // Filter thinking assignments to only keep those for models that support reasoning
    const cleanedThinking: DeveloperTeamThinkingAssignments = {};
    for (const [agentId, modelId] of Object.entries(modelAssigns)) {
      const supports = adapter.supportsThinking(modelId);
      if (supports && thinkingAssigns[agentId]) {
        cleanedThinking[agentId] = thinkingAssigns[agentId];
      }
      // If model doesn't support thinking, we don't preserve the thinking assignment (T7 cleanup)
    }

    setModelAssignments(modelAssigns);
    setThinkingAssignments(cleanedThinking);
  }

  function getThinkingLevelByCursor(index: number) {
    if (modelConfigRuntime === "opencode") {
      return OPENCODE_THINKING_LEVELS[index] ?? "low";
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
    const projectRoot = resolveProjectRoot({ require: true });
    if (!projectRoot) {
      setInstallResults((current) => [
        ...current,
        { tool: "Developer Team models", success: false, message: "Project root not found." },
      ]);
      return;
    }
    const adapter = getAdapter(modelConfigRuntime);

    // Build capability instructions (only used by OpenCode; Pi ignores undefined capabilityInstructions)
    const deckConfig = readDeckConfig(projectRoot);
    const enabledIds = getEnabledPackageInstructionIds(deckConfig, modelConfigRuntime);
    const capabilityInstructions = enabledIds.length > 0 ? buildCapabilityInstructionBundle(enabledIds) : undefined;

    const standaloneSkills =
      modelConfigRuntime === "opencode"
        ? getStandaloneSkills().map((s: { skillId: string }) => ({ skillId: s.skillId, body: getStandaloneSkillBody(s.skillId)! }))
        : undefined;

    const plan = adapter.buildDeveloperTeamInstallPlan({
      projectRoot,
      environmentId: modelConfigRuntime === "opencode" ? "opencode-development" : "pi-development",
      modelAssignments,
      thinkingAssignments,
      memoryProvider,
      capabilityInstructions,
      standaloneSkills,
    });

    const backup = adapter.backupDeveloperTeamFiles(plan);

    try {
      const applyResult = await adapter.applyDeveloperTeamInstall({
        projectRoot,
        plan,
        environmentId: modelConfigRuntime === "opencode" ? "opencode-development" : "pi-development",
      });
      const verifyResult = adapter.verifyDeveloperTeamInstall(plan);

      if (!verifyResult.valid) {
        adapter.rollbackDeveloperTeamFiles(backup);
        setDeveloperTeamResults([]);
        const diagnosticsMsg =
          verifyResult.diagnostics.length > 0
            ? `\nDetails: ${verifyResult.diagnostics.slice(0, 3).join("; ")}${verifyResult.diagnostics.length > 3 ? ` (+${verifyResult.diagnostics.length - 3} more)` : ""}`
            : "";
        const failMsg = `Verification failed. Changes rolled back.${diagnosticsMsg}`;
        log(`[configureDeveloperTeamModels] verifyResult.valid=false diagnostics=${JSON.stringify(verifyResult.diagnostics)}`);
        setInstallResults((current) => [
          ...current,
          { tool: "Developer Team models", success: false, message: failMsg },
        ]);
        return;
      }

      setDeveloperTeamResults(applyResult.results as any);
    } catch (error) {
      adapter.rollbackDeveloperTeamFiles(backup);
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

    const providers = detectPiProvidersForTui();
    return {
      providers,
      modelsByProvider: Object.fromEntries(providers.map((provider) => [provider.id, listModelsForProvider(provider.id)])),
    };
  }

  function detectOpenCodeModelInventoryForTui() {
    // Step 1: Read existing agent models from opencode.json
    const opencodeConfigPath = join(homedir(), ".config", "opencode", "opencode.json");
    if (existsSync(opencodeConfigPath)) {
      try {
        const config = JSON.parse(readFileSync(opencodeConfigPath, "utf-8")) as { agent?: Record<string, { model?: string; reasoningEffort?: string }> };
        const existingAgents = config.agent ?? {};
        const newModelAssignments: Record<string, string> = {};
        const newThinkingAssignments: Record<string, string> = {};
        for (const agent of DEVELOPER_TEAM_AGENTS) {
          const existing = existingAgents[agent.id];
          if (existing?.model) {
            newModelAssignments[agent.id] = existing.model;
            if (existing.reasoningEffort) {
              newThinkingAssignments[agent.id] = existing.reasoningEffort;
            }
          }
        }
        setModelAssignments((current) => ({ ...current, ...newModelAssignments }));
        setThinkingAssignments((current) => ({ ...current, ...newThinkingAssignments }) as any);
      } catch {
        // Config unreadable — no pre-selection
      }
    }

    // Step 2: Get available models from `opencode models`
    const listModelsResult = runOpenCodeCommand("opencode", ["models"]);
    log(`detectOpenCodeModelInventoryForTui: opencode models exitCode=${listModelsResult.exitCode} stdoutLen=${listModelsResult.stdout?.length ?? 0} stderrLen=${listModelsResult.stderr?.length ?? 0}`);
    const output = listModelsResult.stdout || listModelsResult.stderr || "";
    if (listModelsResult.exitCode === 0 && output.trim().length > 0) {
      const models = parseOpenCodeModelsOutput(output);
      const providers = [...new Set(models.map((m) => m.providerId))].map((id) => ({ id, displayName: humanizeProviderName(id), envVars: [] }));
      const modelsByProvider: Record<string, Array<{ id: string; displayName: string; providerId: string }>> = {};
      for (const model of models) {
        if (!modelsByProvider[model.providerId]) modelsByProvider[model.providerId] = [];
        modelsByProvider[model.providerId].push(model);
      }
      return { providers, modelsByProvider };
    }
    return { providers: [] as Array<{ id: string; displayName: string; envVars: string[] }>, modelsByProvider: {} };
  }

  function parseOpenCodeModelsOutput(output: string): Array<{ id: string; displayName: string; providerId: string }> {
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.includes("/"))
      .map((line) => {
        const [providerId, modelName] = line.split("/", 2);
        return {
          id: line,
          displayName: humanizeModelName(modelName ?? line),
          providerId: providerId ?? "unknown",
        };
      });
  }

  function runOpenCodeCommand(command: string, args: string[]) {
    const result = spawnSync(command, args);
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  }

  function humanizeProviderName(providerId: string): string {
    return providerId
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function humanizeModelName(modelName: string): string {
    return modelName
      .split(/[-_]/)
      .map((part) => part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
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

  function getNextScreenAfterDashboardComplete(): Screen {
    const statuses = detectSelectedRuntimes(selectedEnvironments);
    const hasOpenCode = statuses.some((s) => s.runtime === "opencode" && s.installed && s.command);
    if (selectedEnvironments.includes("opencode-development") && hasOpenCode) {
      return "opencode-preflight-checking";
    }
    return "home";
  }

  function getDashboardCompletionStatus(): string {
    return getNextScreenAfterDashboardComplete() === "opencode-preflight-checking"
      ? "Enter para continuar con OpenCode."
      : "Enter para finalizar y volver a Home.";
  }

  function goToNextEnvironmentAfterDashboardComplete() {
    resetCursor(getNextScreenAfterDashboardComplete());
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
        "no-providers": "team-selection",
        "memory-provider-selection": "agent-model-config-list",
        "supermemory-token": "memory-provider-selection",
        // Removed: userId/teamId/orgId screens — token-only
        "developer-team-review": "memory-provider-selection",
        "developer-team-installing": "developer-team-review",
        "opencode-preflight-checking": "environment-selection",
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

  return (
    <ScreenFrame title={screenTitle(screen, dashboardState.runnerScope)} help={HELP} width={stdout.columns || 72} height={stdout.rows || undefined} logs={logs}>
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
      {screen === "model-environment-selection" ? <ModelEnvironmentSelectionScreen cursor={modelEnvironmentCursor} /> : null}
      {screen === "model-team-selection" && selectedModelEnvironment ? (
        <ModelTeamSelectionScreen cursor={modelTeamCursor} environment={selectedModelEnvironment} />
      ) : null}
      {screen === "environment-selection" ? (
        <EnvironmentSelectionScreen cursor={cursor} selected={selectedEnvironments} />
      ) : null}
      {screen === "personality-selection" ? (
        <PersonalitySelectionScreen cursor={cursor} selected={selectedPersonality} />
      ) : null}
      {screen === "pi-runner-dashboard" ? (
        <RunnerDashboardScreens state={dashboardState} installResults={dashboardActionResults} completionStatus={dashboardCompletionStatus} canRunPlan={canRunDashboardPlan(dashboardState)} runBlockDiagnostics={getDashboardRunBlockDiagnostics(dashboardState)} capabilityResolver={dashboardCapabilityResolver} />
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
        <AgentModelConfigListScreen cursor={agentConfigCursor} modelAssignments={modelAssignments} thinkingAssignments={thinkingAssignments} dashboardContext={dashboardDeveloperTeamContext()} runtime={modelConfigRuntime} />
      ) : null}
      {screen === "model-provider-selection" ? (
        <ModelProviderSelectionScreen cursor={cursor} providers={detectedProviders} runtime={modelConfigRuntime} />
      ) : null}
      {screen === "model-selection" && selectedProvider ? (
        <ModelSelectionScreen cursor={cursor} provider={selectedProvider} models={providerModels} runtime={modelConfigRuntime} />
      ) : null}
      {screen === "agent-model-assignment" && selectedModel ? (
        <AgentModelAssignmentScreen
          cursor={cursor}
          agentIndex={agentAssignmentIndex}
          totalAgents={DEVELOPER_TEAM_AGENTS.length}
          modelId={selectedModel.id}
          defaultThinking={getAdapter(modelConfigRuntime).getDefaultThinking(selectedModel.id)}
          supportsThinking={getAdapter(modelConfigRuntime).supportsThinking(selectedModel.id)}
          runtime={modelConfigRuntime}
        />
      ) : null}
      {screen === "no-providers" ? <NoProvidersScreen dashboardContext={dashboardDeveloperTeamContext()} runtime={modelConfigRuntime} /> : null}
      {screen === "memory-provider-selection" ? (
        <MemoryProviderSelectionScreen cursor={cursor} selectedProvider={memoryProviderChoice} status={memoryStatus} />
      ) : null}
      {isSupermemoryInputScreen(screen) ? (
        <SupermemorySetupScreen screen={screen} values={supermemorySetup} error={supermemoryError} />
      ) : null}
      {screen === "developer-team-review" ? (
        // Use require: true for backward compatibility - prop expects string
        <DeveloperTeamReviewScreen projectRoot={resolveProjectRoot({ require: true })} cursor={developerTeamCursor} dashboardContext={dashboardDeveloperTeamContext()} />
      ) : null}
      {screen === "developer-team-installing" ? (
        <DeveloperTeamInstallingScreen currentStep={agentAssignmentIndex} totalSteps={DEVELOPER_TEAM_AGENTS.length} />
      ) : null}
      {screen === "opencode-preflight-checking" ? <OpenCodeCheckingScreen /> : null}
      {screen === "configure-packages-runner-selection" ? (
        <ConfigurePackagesRunnerSelection cursor={configurePackagesCursor} />
      ) : null}
      {screen === "configure-packages-detail" ? (
        <ConfigurePackagesDetail
          cursor={configurePackagesCursor}
          runner={configurePackagesRunner}
          toggles={configurePackagesToggles}
        />
      ) : null}
      {screen === "complete" ? <CompleteScreen results={installResults} developerTeamResults={developerTeamResults} status={dashboardCompletionStatus} /> : null}
    </ScreenFrame>
  );
}

function screenTitle(screen: Screen, runnerScope?: string): string {
  const titles: Record<Screen, string> = {
    home: "Deck",
    "upgrade-confirm": "Update Deck",
    "upgrade-progress": "Update Deck",
    "rollback-confirm": "Rollback Deck",
    "rollback-progress": "Rollback Deck",
    "model-environment-selection": "Select runner for model config",
    "model-team-selection": "Select team for model config",
    "environment-selection": "Select environments",
    "personality-selection": "Choose orchestrator personality",
    "pi-runner-dashboard": `OpenCode Runner capability dashboard`,
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
    "no-providers": "No providers detected",
    "memory-provider-selection": "Adaptive memory provider",
    // Removed: userId/teamId/orgId screens — token-only config
    "supermemory-token": "Supermemory MCP token",
    "developer-team-review": "Developer Team",
    "developer-team-installing": "Installing Developer Team",
    "opencode-preflight-checking": "Checking OpenCode environment",
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

function ConfigurePackagesRunnerSelection({ cursor }: { cursor: number }) {
  return (
    <Box flexDirection="column">
      <Text dimColor>Select a runner to configure package instructions for.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={[
            { id: "pi", label: "Pi" },
            { id: "opencode", label: "OpenCode" },
            { id: "back", label: "Back" },
          ]}
        />
      </Box>
    </Box>
  );
}

function ConfigurePackagesDetail({
  cursor,
  runner,
  toggles,
}: {
  cursor: number;
  runner: "pi" | "opencode" | null;
  toggles: Record<string, boolean>;
}) {
  const packages = [
    { id: "codebase-memory", label: "Codebase Memory", hint: "graph-based code discovery instructions" },
    { id: "context-mode", label: "Context Mode", hint: "batch execute and think-in-code instructions" },
    { id: "rtk", label: "RTK", hint: "fallback guidance for hook-less environments" },
  ];

  return (
    <Box flexDirection="column">
      <Text bold>
        {runner ? `Configure Packages — ${runner === "pi" ? "Pi" : "OpenCode"}` : "Configure Packages"}
      </Text>
      <Text dimColor>Space toggles package instructions. Enter selects Apply or Back.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={[
            ...packages.map((pkg) => ({
              id: pkg.id,
              label: `${toggles[pkg.id] ? "[x]" : "[ ]"} ${pkg.label}`,
              hint: pkg.hint,
            })),
            { id: "apply", label: "Apply changes" },
            { id: "back", label: "Back" },
          ]}
        />
      </Box>
    </Box>
  );
}

export function PersonalitySelectionScreen({ cursor, selected }: { cursor: number; selected: "guia" | "pragmatica" }) {
  const personalities = [
    { id: "guia" as const, label: "Guía (Teacher)", hint: "Full explanations with educational context", tokenCost: "high" },
    { id: "pragmatica" as const, label: "Pragmática (Pragmatic)", hint: "Balanced — what you need, nothing more", tokenCost: "medium" },
  ];

  return (
    <Box flexDirection="column">
      <Text dimColor>Controls how verbose the orchestrator is when communicating decisions and rationale.</Text>
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

function EnvironmentSelectionScreen({ cursor, selected }: { cursor: number; selected: EnvironmentId[] }) {
  return (
    <Box flexDirection="column">
      <Text dimColor>Choose one or more environments. Space toggles selection.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          multiselect
          items={getEnvironmentOptions().map((option) => ({
            id: option.value,
            label: option.label,
            checked: selected.includes(option.value as EnvironmentId),
          }))}
        />
      </Box>
    </Box>
  );
}

function ModelEnvironmentSelectionScreen({ cursor }: { cursor: number }) {
  return (
    <Box flexDirection="column">
      <Text dimColor>Select which runner/environment owns the model configuration.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={getEnvironmentOptions().map((option) => ({
            id: option.value,
            label: option.label,
            hint: option.value === "pi-development" || option.value === "opencode-development" ? "available" : "not implemented yet",
          }))}
        />
      </Box>
    </Box>
  );
}

function ModelTeamSelectionScreen({ cursor, environment }: { cursor: number; environment: EnvironmentId }) {
  const teams = getAdapter(environment).getTeams(environment) as any[];

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
      <Text>Agents support: <Text color="yellow">pending (placeholder)</Text></Text>
      <Text>Subagents support: <Text color="yellow">pending (placeholder)</Text></Text>
      <Text>MCP support: <Text color="yellow">pending (placeholder)</Text></Text>
      <Text>Model profiles: <Text color="yellow">pending (placeholder)</Text></Text>
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
          items={getAdapter("pi").getSelectableTools().map((tool) => ({
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

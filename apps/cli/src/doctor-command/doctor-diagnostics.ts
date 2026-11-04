import { REMEDIATION_MESSAGES, type RunnerAdmissionResult } from "@deck/core";
import { reviewRunnerCleanup } from "../runner-cleanup-doctor";
/**
 * Doctor diagnostics orchestrator.
 *
 * Runs a battery of isolated diagnostic checks across runtimes, packages,
 * tools and MCP configuration. Each sub-check is wrapped in
 * try/catch so a single failure does not abort the others (REQ-DIAG-007).
 *
 * The function never throws — it always returns a structured result
 * (REQ-DIAG-008) and never exposes credentials in any message (REQ-DIAG-009).
 *
 * Extended by redesign-doctor-diagnostics to include:
 * - Manifest/State/Deck Config checks (via doctor-checks.ts)
 * - Binary validation (executable + version)
 * - Runner config validation
 * - Summary with counts by severity
 */

import { accessSync, constants as fsConstants, existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import {
  createNodePiFileIO,
  inspectPiDeckInstall,
  inspectPiEnvironment,
  readDeckPiExtensionBundle,
  redact,
  resolvePiAgentDir,
  reviewPiRequiredTools,
  sourceDigestHeader,
  type PiDoctorCategory,
} from "@deck/adapter-pi";
import { inspectOpenCodeEnvironment, reviewOpenCodeTools } from "@deck/adapter-opencode";

import { detectSelectedRuntimes, type EnvironmentId } from "../runtime-detection";
import { getBuildInfo } from "../runtime/build-info.js";
import { getDeckXdgPaths } from "../runtime/paths.js";
import { runDeckChecks } from "./doctor-checks";
import { decideReleaseAvailability, fetchReleaseDescriptor } from "../upgrade-command/github-release.js";
import type { DeckConfigStore } from "../deck-config-store";
import type { NormalizedDeckConfig } from "@deck/core";
import { checkSessionWeb } from "../session-web-doctor";
import { reviewInteractiveSearchSessions } from "../interactive-search-review";
import type {
  DoctorCategoryResult,
  DoctorCheckItem,
  DoctorDiagnosticsResult,
  DoctorRuntimeResult,
  DoctorStatus,
  DoctorSummary,
  DoctorBinaryResult,
} from "./types";

// ---------------------------------------------------------------------------
// Known environment IDs
// ---------------------------------------------------------------------------
const ALL_ENVIRONMENT_IDS: EnvironmentId[] = [
  "pi-development",
  "opencode-development",
  "claude-development",
  "codex-development",
];

// ---------------------------------------------------------------------------
// Known MCP server entries to validate in OpenCode's opencode.json
// ---------------------------------------------------------------------------
const KNOWN_OPENCODE_MCP_SERVERS = [
  { name: "codebase-memory-mcp", label: "Codebase Memory MCP" },
  { name: "serena", label: "Serena MCP" },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns "ok" if no items are in error state, "error" if any item is in error, otherwise "warning". */
function deriveCategoryStatus(items: DoctorCheckItem[]): DoctorStatus {
  if (items.some((i) => i.status === "error")) return "error";
  if (items.some((i) => i.status === "warning")) return "warning";
  return "ok";
}

/** Check if a binary exists in PATH without instantiating any provider. */
function optionalToolBinaryAvailable(command: string): boolean {
  const path = process.env.PATH ?? "";
  const isWindows = process.platform === "win32";
  const suffixes = isWindows ? ["", ".exe"] : [""];
  return path.split(delimiter).some((dir) => {
    return suffixes.some((suffix) => {
      try {
        return existsSync(join(dir, command + suffix));
      } catch {
        return false;
      }
    });
  });
}

/** Read and parse opencode.json MCP section using sync fs (avoids async top-level issues). */
function readOpenCodeMcpSection(): Record<string, unknown> | null {
  try {
    const configPath = join(homedir(), ".config", "opencode", "opencode.json");
    if (!existsSync(configPath)) return null;
    const content = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return (parsed.mcp as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Runtime checks
// ---------------------------------------------------------------------------

/** Real-machine Pi install inspection: reads the Pi agent dir, runs `pi --version` and `pi list` (stdin ignored). */
function inspectPiDeckInstallOnMachine(input: { command: string; projectRoot?: string }): PiDoctorCategory[] {
  const home = process.env.HOME ?? homedir();
  const run = (args: string[]) => {
    const result = spawnSync(input.command, args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });
    return result.status === 0 && !result.error ? result.stdout : undefined;
  };
  return inspectPiDeckInstall({
    io: createNodePiFileIO(),
    agentDir: resolvePiAgentDir(process.env, home),
    projectRoot: input.projectRoot,
    piVersionOutput: run(["--version"]),
    piListOutput: run(["list"]),
    isExecutable: (path) => { try { accessSync(path, fsConstants.X_OK); return statSync(path).isFile(); } catch { return false; } },
    expectedBundleDigests: Object.fromEntries((["deck-subagents", "deck-tool-policy"] as const).map((name) => {
      try { return [name, sourceDigestHeader(readDeckPiExtensionBundle(name))]; } catch { return [name, undefined]; }
    })),
  });
}

function checkPiRuntime(
  command: string,
  dependencies: Pick<DoctorDiagnosticsDependencies, "inspectPiEnvironment" | "reviewPiRequiredTools" | "inspectPiDeckInstall">,
  projectRoot?: string,
): DoctorRuntimeResult {
  const result: DoctorRuntimeResult = {
    runtimeId: "pi",
    name: "Pi",
    installed: true,
    checks: [],
  };

  // Version + config directory
  try {
    const inspection = dependencies.inspectPiEnvironment({ command });
    result.version = inspection.version;
    result.checks.push({
      category: "Runtime",
      status: "ok",
      items: [
        {
          status: "ok",
          message:
            inspection.version !== "unknown"
              ? `Pi v${inspection.version} detected`
              : "Pi detected (version unknown)",
        },
      ],
    });
  } catch (err) {
    result.checks.push({
      category: "Runtime",
      status: "error",
      items: [{ status: "error", message: `Unable to inspect Pi runtime: ${redact(String(err))}` }],
    });
  }

  // Global Deck package: registration, manifest drift, extensions, MCP, optional tools, legacy and conflicts
  try {
    for (const entry of dependencies.inspectPiDeckInstall({ command, projectRoot })) {
      result.checks.push({
        category: entry.category,
        status: entry.status,
        items: entry.items.map((item) => ({ status: item.status, message: redact(item.message), ...(item.suggestion ? { suggestion: redact(item.suggestion) } : {}) })),
      });
    }
  } catch (err) {
    result.checks.push({
      category: "Pi Deck package",
      status: "error",
      items: [{ status: "error", message: `Pi Deck package inspection failed: ${redact(String(err))}` }],
    });
  }

  // Package review
  try {
    const review = dependencies.reviewPiRequiredTools({ command });
    if (review.error) {
      result.checks.push({
        category: "Packages",
        status: "error",
        items: [{ status: "error", message: redact(review.error) }],
      });
    } else {
      const items: DoctorCheckItem[] = review.requiredTools.map((tool) => ({
        status: tool.installed ? "ok" : "error",
        message: `${tool.name}: ${tool.installed ? "installed" : "not found"}`,
        suggestion: tool.installed ? undefined : `Install Pi package: ${tool.name}`,
      }));
      result.checks.push({
        category: "Packages",
        status: deriveCategoryStatus(items),
        items,
      });
    }
  } catch (err) {
    result.checks.push({
      category: "Packages",
      status: "error",
      items: [{ status: "error", message: `Package review failed: ${redact(String(err))}` }],
    });
  }

  return result;
}

function checkOpenCodeRuntime(
  command: string,
  dependencies: Pick<DoctorDiagnosticsDependencies, "inspectOpenCodeEnvironment" | "reviewOpenCodeTools">,
): DoctorRuntimeResult {
  const result: DoctorRuntimeResult = {
    runtimeId: "opencode",
    name: "OpenCode",
    installed: true,
    checks: [],
  };

  // Version + config directory
  try {
    const inspection = dependencies.inspectOpenCodeEnvironment({ command });
    result.version = inspection.version;
    result.checks.push({
      category: "Runtime",
      status: "ok",
      items: [
        {
          status: "ok",
          message:
            inspection.version !== "unknown"
              ? `OpenCode v${inspection.version} detected`
              : "OpenCode detected (version unknown)",
        },
      ],
    });
  } catch (err) {
    result.checks.push({
      category: "Runtime",
      status: "error",
      items: [{ status: "error", message: `Unable to inspect OpenCode runtime: ${redact(String(err))}` }],
    });
  }

  // Package review
  try {
    const review = dependencies.reviewOpenCodeTools();
    if (review.error) {
      result.checks.push({
        category: "Packages",
        status: "error",
        items: [{ status: "error", message: redact(review.error) }],
      });
    } else {
      const items: DoctorCheckItem[] = review.tools.map((tool) => ({
        status: tool.installed ? "ok" : "error",
        message: `${tool.name}: ${tool.installed ? "installed" : "not found"}`,
        suggestion: tool.installed ? undefined : `Install OpenCode package: ${tool.name}`,
      }));
      result.checks.push({
        category: "Packages",
        status: deriveCategoryStatus(items),
        items,
      });
    }
  } catch (err) {
    result.checks.push({
      category: "Packages",
      status: "error",
      items: [{ status: "error", message: `Package review failed: ${redact(String(err))}` }],
    });
  }

  return result;
}

function checkClaudeOrCodexRuntime(runtime: "claude" | "codex", installed: boolean): DoctorRuntimeResult {
  const name = runtime === "claude" ? "Claude" : "Codex";
  return {
    runtimeId: runtime,
    name,
    installed,
    version: undefined,
    checks: [
      {
        category: "Runtime",
        status: installed ? "ok" : "warning",
        items: [
          installed
            ? { status: "ok", message: `${name} detected` }
            : {
                status: "warning",
                message: `${name} not detected in PATH`,
                suggestion: `Install ${name} to enable this runtime`,
              },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Optional tool binary checks
// ---------------------------------------------------------------------------

function checkOptionalToolBinaries(
  binaryAvailable: typeof optionalToolBinaryAvailable,
): DoctorCategoryResult[] {
  const results: DoctorCategoryResult[] = [];

  // Check Serena binary separately
  const serenaItems: DoctorCheckItem[] = [];
  try {
    const available = binaryAvailable("serena");
    serenaItems.push({
      status: available ? "ok" : "warning",
      message: available
        ? "Serena binary found in PATH"
        : "Serena binary not found in PATH",
      suggestion: available
        ? undefined
        : "Install Serena MCP server for symbol editing capabilities",
    });
  } catch (err) {
    serenaItems.push({
      status: "error",
      message: `Unable to check Serena: ${redact(String(err))}`,
    });
  }

  results.push({
    category: "Serena",
    status: deriveCategoryStatus(serenaItems),
    items: serenaItems,
  });

  return results;
}

function checkOpenCodeMcp(
  readMcpSection: typeof readOpenCodeMcpSection,
): DoctorCategoryResult {
  const items: DoctorCheckItem[] = [];

  try {
    const mcpSection = readMcpSection();
    if (!mcpSection) {
      items.push({
        status: "warning",
        message: "opencode.json not found or mcp section missing; optional OpenCode MCP capabilities could not be inspected.",
      });
    } else {
      for (const known of KNOWN_OPENCODE_MCP_SERVERS) {
        const entry = mcpSection[known.name];
        if (entry && typeof entry === "object" && entry !== null) {
          const record = entry as Record<string, unknown>;
          const hasUrl = typeof record["url"] === "string";
          const hasType = typeof record["type"] === "string";
          // Local MCP has command array; remote MCP has url + type
          const commandArr = Array.isArray(record["command"]) ? record["command"] : undefined;
          const hasLocalConfig = commandArr && commandArr.length > 0;
          const hasRemoteConfig = hasUrl && hasType;
          items.push({
            status: hasLocalConfig || hasRemoteConfig ? "ok" : "warning",
            message: `${known.label}: ${hasLocalConfig ? "local" : hasRemoteConfig ? "remote" : "partial config"}`,
            suggestion:
              hasLocalConfig || hasRemoteConfig
                ? undefined
                : `${known.label} is missing required fields (command for local, or url/type for remote)`,
          });
        } else {
          items.push({
            status: "warning",
            message: `${known.label}: not configured`,
            suggestion: `Add ${known.name} to the mcp section in opencode.json`,
          });
        }
      }
    }
  } catch (err) {
    items.push({
      status: "error",
      message: `Unable to read opencode.json MCP section: ${redact(String(err))}`,
    });
  }

  return {
    category: "OpenCode MCP",
    status: deriveCategoryStatus(items),
    items,
  };
}

// ---------------------------------------------------------------------------
// Helper: Build binary upgrade availability check
// ---------------------------------------------------------------------------

/**
 * Build the binary upgrade availability check result.
 * Uses decideReleaseAvailability for commit-aware comparison.
 */
type DoctorDiagnosticsDependencies = Readonly<{
  reviewRunnerCleanup: typeof reviewRunnerCleanup;
  reviewInteractiveSearchSessions: typeof reviewInteractiveSearchSessions;
  detectSelectedRuntimes: typeof detectSelectedRuntimes;
  inspectPiEnvironment: typeof inspectPiEnvironment;
  reviewPiRequiredTools: typeof reviewPiRequiredTools;
  inspectPiDeckInstall: (input: { command: string; projectRoot?: string }) => PiDoctorCategory[];
  inspectOpenCodeEnvironment: typeof inspectOpenCodeEnvironment;
  reviewOpenCodeTools: typeof reviewOpenCodeTools;
  runDeckChecks: typeof runDeckChecks;
  fetchReleaseDescriptor: typeof fetchReleaseDescriptor;
  optionalToolBinaryAvailable: typeof optionalToolBinaryAvailable;
  readOpenCodeMcpSection: typeof readOpenCodeMcpSection;
  configStore?: DeckConfigStore;
  inspectRunnerAdmission?: (runnerId: string, projectRoot: string, config: NormalizedDeckConfig) => Promise<RunnerAdmissionResult | undefined>;
  inspectCodex: (projectRoot: string, deckConfig: NormalizedDeckConfig) => Promise<ReadonlyArray<{ category: string; status: DoctorStatus; message: string; suggestion?: string }>>;
}>;

const defaultDoctorDiagnosticsDependencies: DoctorDiagnosticsDependencies = {
  reviewRunnerCleanup,
  reviewInteractiveSearchSessions,
  detectSelectedRuntimes,
  inspectPiEnvironment,
  reviewPiRequiredTools,
  inspectPiDeckInstall: inspectPiDeckInstallOnMachine,
  inspectOpenCodeEnvironment,
  reviewOpenCodeTools,
  runDeckChecks,
  fetchReleaseDescriptor,
  optionalToolBinaryAvailable,
  readOpenCodeMcpSection,
  inspectRunnerAdmission: async (runnerId, projectRoot, config) => {
    const {getAdapter} = await import("../runner-adapters");
    const adapter = getAdapter(runnerId);
    if (!(await adapter.detectDeckInstall?.({projectRoot}))?.installed) return undefined;
    return adapter.evaluateSessionAdmission?.({config});
  },
  inspectCodex: async (projectRoot, deckConfig) => {
    const { getAdapter } = await import("../runner-adapters");
    const adapter = getAdapter("codex");
    return adapter.diagnoseProject?.(projectRoot, deckConfig) ?? [];
  },
};

function buildGlobalConfigDoctorCheck(store: DeckConfigStore | undefined): { config?: NormalizedDeckConfig; category: DoctorCategoryResult } {
  if (!store) {
    return {
      category: {
        category: "Global Deck Config",
        status: "error",
        items: [{ status: "error", message: "Doctor requires caller-resolved global Deck config store.", suggestion: "Run doctor through the CLI composition root." }],
      },
    };
  }
  try {
    const discovery = store.discover();
    if (!discovery.canonicalExists) {
      return {
        category: {
          category: "Global Deck Config",
          status: "error",
          items: [{ status: "error", message: "Canonical global Deck config is missing.", suggestion: "Create the canonical global config before running diagnostics." }],
        },
      };
    }
    const config = store.readRequired();
    return {
      config,
      category: {
        category: "Global Deck Config",
        status: "ok",
        items: [{ status: "ok", message: "Canonical global Deck config is ready." }],
      },
    };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "DECK_CONFIG_READ_FAILED";
    const field = typeof error === "object" && error !== null && "fieldPath" in error ? String((error as { fieldPath?: unknown }).fieldPath ?? "config") : "config";
    return {
      category: {
        category: "Global Deck Config",
        status: "error",
        items: [{ status: "error", message: `Global Deck config is not ready: ${code} at ${field}.`, suggestion: "Fix or migrate the global Deck config before running diagnostics." }],
      },
    };
  }
}

function redactCodexDoctorValue(value: string): string {
  return redact(value).replace(/\b(token|secret|credential|api[-_]?key|password)=\S+/gi, "$1=[REDACTED]");
}

async function buildBinaryUpgradeCheck(
  fetchDescriptor: typeof fetchReleaseDescriptor,
  globalConfig: Readonly<{ dir: string; exists: boolean }>,
): Promise<DoctorBinaryResult> {
  const buildInfo = getBuildInfo();
  let upgradeAvailable = false;
  let latestVersion: string | undefined;
  let latestCommit: string | undefined;
  let reason: string | undefined;

  try {
    const descriptor = await fetchDescriptor();
    if (descriptor && descriptor.kind === "descriptor") {
      latestVersion = descriptor.descriptor.version;
      latestCommit = descriptor.commit ?? undefined;
      const decision = decideReleaseAvailability(
        buildInfo.version,
        buildInfo.commit,
        latestVersion,
        latestCommit,
      );
      upgradeAvailable = decision.kind === "available";
      reason = decision.kind === "network-error" ? "Network error checking for updates" : decision.reason;
    } else if (descriptor && descriptor.kind === "legacy") {
      reason = descriptor.reason === "missing"
        ? "Release descriptor not found"
        : descriptor.reason === "invalid"
          ? "Invalid release descriptor"
          : descriptor.error ?? "Unknown error";
    } else {
      reason = "Could not fetch release information";
    }
  } catch (err) {
    reason = `Error checking releases: ${(err as Error).message}`;
  }

  return {
    buildInfo: {
      version: buildInfo.version,
      commit: buildInfo.commit,
      date: buildInfo.date,
      target: buildInfo.target,
      channel: buildInfo.channel,
    },
    executablePath: process.execPath ?? null,
    globalConfigDir: globalConfig.dir,
    globalConfigExists: globalConfig.exists,
    bundledSkillCount: 0,
    upgradeAvailable,
    latestVersion,
    latestCommit,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Helper: Calculate summary from all category results
// ---------------------------------------------------------------------------

function calculateSummary(
  deck: DoctorCategoryResult[],
  binary: DoctorCategoryResult[],
  runnerConfig: DoctorCategoryResult[],
  runtimes: DoctorRuntimeResult[],
  optionalTools: DoctorCategoryResult[],
  mcp: DoctorCategoryResult[],
): DoctorSummary {
  let ok = 0;
  let warning = 0;
  let error = 0;
  const sections: string[] = [];

  // Helper to count items in categories
  const countCategory = (categories: DoctorCategoryResult[]) => {
    for (const cat of categories) {
      sections.push(cat.category);
      if (cat.status === "error") error++;
      else if (cat.status === "warning") warning++;
      else ok++;
    }
  };

  // Count all categories
  countCategory(deck);
  countCategory(binary);
  countCategory(runnerConfig);

  // Runtime checks (each runtime is one category)
  for (const rt of runtimes) {
    sections.push(rt.name);
    if (rt.checks.some((c) => c.status === "error")) error++;
    else if (rt.checks.some((c) => c.status === "warning")) warning++;
    else ok++;
  }

  countCategory(optionalTools);
  countCategory(mcp);

  return { ok, warning, error, sections };
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run all doctor diagnostics and return a structured result.
 *
 * Never throws — every sub-check is wrapped in try/catch so one failure
 * does not prevent others from running (REQ-DIAG-007).
 *
 * Extended to include deck-owned checks (manifest, state, config, binaries, runner config).
 *
 * @returns DoctorDiagnosticsResult
 */
export async function runDoctorDiagnostics(
  overrides: Partial<DoctorDiagnosticsDependencies> = {},
  projectRoot?: string,
): Promise<DoctorDiagnosticsResult> {
  const dependencies: DoctorDiagnosticsDependencies = {
    reviewRunnerCleanup: overrides.reviewRunnerCleanup ?? defaultDoctorDiagnosticsDependencies.reviewRunnerCleanup,
    reviewInteractiveSearchSessions: overrides.reviewInteractiveSearchSessions ?? defaultDoctorDiagnosticsDependencies.reviewInteractiveSearchSessions,
    detectSelectedRuntimes: overrides.detectSelectedRuntimes ?? defaultDoctorDiagnosticsDependencies.detectSelectedRuntimes,
    inspectPiEnvironment: overrides.inspectPiEnvironment ?? defaultDoctorDiagnosticsDependencies.inspectPiEnvironment,
    reviewPiRequiredTools: overrides.reviewPiRequiredTools ?? defaultDoctorDiagnosticsDependencies.reviewPiRequiredTools,
    inspectPiDeckInstall: overrides.inspectPiDeckInstall ?? defaultDoctorDiagnosticsDependencies.inspectPiDeckInstall,
    inspectOpenCodeEnvironment: overrides.inspectOpenCodeEnvironment ?? defaultDoctorDiagnosticsDependencies.inspectOpenCodeEnvironment,
    reviewOpenCodeTools: overrides.reviewOpenCodeTools ?? defaultDoctorDiagnosticsDependencies.reviewOpenCodeTools,
    runDeckChecks: overrides.runDeckChecks ?? defaultDoctorDiagnosticsDependencies.runDeckChecks,
    fetchReleaseDescriptor: overrides.fetchReleaseDescriptor ?? defaultDoctorDiagnosticsDependencies.fetchReleaseDescriptor,
    optionalToolBinaryAvailable: overrides.optionalToolBinaryAvailable ?? defaultDoctorDiagnosticsDependencies.optionalToolBinaryAvailable,
    readOpenCodeMcpSection: overrides.readOpenCodeMcpSection ?? defaultDoctorDiagnosticsDependencies.readOpenCodeMcpSection,
    configStore: overrides.configStore,
    inspectRunnerAdmission: overrides.inspectRunnerAdmission ?? defaultDoctorDiagnosticsDependencies.inspectRunnerAdmission,
    inspectCodex: overrides.inspectCodex ?? defaultDoctorDiagnosticsDependencies.inspectCodex,
  };
  const runtimes: DoctorRuntimeResult[] = [];
  let optionalToolCritical = false;
  const globalConfigCheck = buildGlobalConfigDoctorCheck(dependencies.configStore);

  // 1. Runtime detection
  let runtimeStatuses: Awaited<ReturnType<typeof detectSelectedRuntimes>> = [];
  try {
    runtimeStatuses = dependencies.detectSelectedRuntimes(ALL_ENVIRONMENT_IDS);
  } catch {
    runtimeStatuses = [];
  }

  // 2. Per-runtime checks
  for (const status of runtimeStatuses) {
    if (!status.installed) {
      const name = status.runtime.charAt(0).toUpperCase() + status.runtime.slice(1);
      runtimes.push({
        runtimeId: status.runtime,
        name,
        installed: false,
        version: undefined,
        checks: [
          {
            category: "Runtime",
            status: "warning",
            items: [
              {
                status: "warning",
                message: `${name} not detected`,
                suggestion: `Install ${name} to use it with Deck`,
              },
            ],
          },
        ],
      });
      continue;
    }

    if (status.runtime === "pi") {
      runtimes.push(checkPiRuntime(status.command!, dependencies, projectRoot));
    } else if (status.runtime === "opencode") {
      runtimes.push(checkOpenCodeRuntime(status.command!, dependencies));
    } else if (status.runtime === "codex") {
      try {
        if (!projectRoot) {
          throw new Error("verified project root unavailable");
        }
        if (!globalConfigCheck.config) throw new Error("missing global config");
        const checks = await dependencies.inspectCodex(projectRoot, globalConfigCheck.config);
        runtimes.push({
          runtimeId: "codex",
          name: "Codex",
          installed: true,
          checks: checks.map((check) => ({ category: check.category, status: check.status, items: [{ status: check.status, message: redactCodexDoctorValue(check.message), ...(check.suggestion ? { suggestion: redactCodexDoctorValue(check.suggestion) } : {}) }] })),
        });
      } catch {
        runtimes.push({ runtimeId: "codex", name: "Codex", installed: true, checks: [{ category: "Runtime", status: "error", items: [{ status: "error", message: "Codex diagnostics require a verified project root.", suggestion: "Run Deck Doctor from a recognized Deck project with readable configuration." }] }] });
      }
    } else if (status.runtime === "claude") {
      runtimes.push(checkClaudeOrCodexRuntime(status.runtime, status.installed));
    }
  }

  // Session admission uses the same read-only checks as install and preparation.
  if (projectRoot && globalConfigCheck.config && dependencies.inspectRunnerAdmission) for (const runtime of runtimes.filter(r=>r.installed)) {
    try {
      const admission = await dependencies.inspectRunnerAdmission(runtime.runtimeId,projectRoot,globalConfigCheck.config);
      if (!admission) continue;
      const status = admission.verdict === "blocked" ? "error" as const : admission.verdict === "degraded" ? "warning" as const : "ok" as const;
      runtime.checks.push({category:"Session admission",status,items:admission.checks.length ? admission.checks.map(check=>({status:check.status === "fail" && check.required ? "error" as const : check.status === "pass" ? "ok" as const : "warning" as const,message:check.id,suggestion:REMEDIATION_MESSAGES[check.remediation]})) : [{status,message:admission.verdict}]});
    } catch { runtime.checks.push({category:"Session admission",status:"warning",items:[{status:"warning",message:"Installed session admission could not be inspected; run Review & Install."}]}); }
  }

  // 3. Optional tool binaries
  let optionalToolResults: DoctorCategoryResult[] = [];
  try {
    optionalToolResults = checkOptionalToolBinaries(dependencies.optionalToolBinaryAvailable);
  } catch (err) {
    optionalToolResults = [
      {
        category: "Optional Tools",
        status: "error",
        items: [{ status: "error", message: `Optional tool check failed: ${redact(String(err))}` }],
      },
    ];
  }

  if (optionalToolResults.some((r) => r.status === "error")) {
    optionalToolCritical = true;
  }

  // 4. MCP validation (synchronous, called directly)
  const mcpResults: DoctorCategoryResult[] = [checkOpenCodeMcp(dependencies.readOpenCodeMcpSection)];

  // 5. Deck-owned checks (manifest, state, config, binaries, runner config)
  let deckResults: DoctorCategoryResult[] = [];
  let binaryResults: DoctorCategoryResult[] = [];
  let runnerConfigResults: DoctorCategoryResult[] = [];
  try {
    const deckChecks = await dependencies.runDeckChecks();
    deckResults = [globalConfigCheck.category, ...deckChecks.deck];
    binaryResults = deckChecks.binary;
    runnerConfigResults = deckChecks.runnerConfig;
  } catch (err) {
    // If deck checks fail entirely, add error category
    deckResults = [
      globalConfigCheck.category,
      {
        category: "Deck Checks",
        status: "error",
        items: [{ status: "error", message: `Deck checks failed: ${redact(String(err))}` }],
      },
    ];
  }

  deckResults.push(await checkSessionWeb(globalConfigCheck.config?.crossRunner));

  // 6. Binary upgrade availability check (commit-aware)
  let binaryResult: DoctorBinaryResult;
  try {
    binaryResult = await buildBinaryUpgradeCheck(dependencies.fetchReleaseDescriptor, {
      dir: dependencies.configStore?.paths.canonicalDir ?? getDeckXdgPaths().configDir,
      exists: globalConfigCheck.category.status === "ok",
    });
  } catch (err) {
    binaryResult = {
      buildInfo: null,
      executablePath: null,
      globalConfigDir: "",
      globalConfigExists: false,
      bundledSkillCount: 0,
      upgradeAvailable: false,
      reason: `Error checking upgrade availability: ${redact(String(err))}`,
    };
  }

  // Review receipts without acknowledging changed settings or touching an open CLI.
  if (globalConfigCheck.config) {
    try {
      const diagnostics = await dependencies.reviewInteractiveSearchSessions(globalConfigCheck.config, projectRoot);
      if (diagnostics.length) runnerConfigResults.push({ category: "Interactive Search", status: "warning",
        items: diagnostics.map(item => ({ status: "warning", message: item.message })) });
    } catch {
      runnerConfigResults.push({ category: "Interactive Search", status: "warning", items: [{ status: "warning",
        message: "Interactive search configuration could not be reviewed. Reopen existing CLI sessions after configuration changes." }] });
    }
  }

  try {runnerConfigResults.push(await dependencies.reviewRunnerCleanup());} catch {runnerConfigResults.push({category:"Runner Migration",status:"warning",items:[{status:"warning",message:"Runner migration/recovery could not be inspected. Use deck runner cleanup --plan; activity unknown means deferred."}]});}

  // 7. Calculate summary
  const summary = calculateSummary(
    deckResults,
    binaryResults,
    runnerConfigResults,
    runtimes,
    optionalToolResults,
    mcpResults,
  );

  // 7. Determine hasCriticalErrors (including new deck/binary/runner checks)
  const noRuntimes = runtimes.length === 0 || runtimes.every((r) => r.installed === false);
  const hasCriticalErrors =
    noRuntimes ||
    optionalToolCritical ||
    mcpResults.some((r) => r.status === "error") ||
    runtimes.some((r) => r.checks.some((c) => c.category === "Runtime" && c.status === "error")) ||
    // New: deck, binary, runnerConfig critical errors
    deckResults.some((r) => r.status === "error") ||
    binaryResults.some((r) => r.status === "error") ||
    runnerConfigResults.some((r) => r.status === "error");

  return {
    runtimes,
    optionalTools: optionalToolResults,
    mcp: mcpResults,
    hasCriticalErrors,
    // New fields from redesign-doctor-diagnostics
    deck: deckResults,
    binaryCheck: binaryResults,
    runnerConfig: runnerConfigResults,
    summary,
    // Binary upgrade availability
    binary: binaryResult,
  };
}

/**
 * Doctor diagnostics orchestrator.
 *
 * Runs a battery of isolated diagnostic checks across runtimes, packages,
 * memory providers, and MCP configuration. Each sub-check is wrapped in
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

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { inspectPiEnvironment, redact, redactDiagnostic, reviewPiRequiredTools, validateSupermemoryPiMcpConfig } from "@deck/adapter-pi";
import { inspectOpenCodeEnvironment, reviewOpenCodeTools, validateSupermemoryOpenCodeMcpConfig } from "@deck/adapter-opencode";
import { inspectCodexSupermemoryMcpState } from "@deck/adapter-codex";

import { detectSelectedRuntimes, type EnvironmentId } from "../runtime-detection";
import { getBuildInfo } from "../runtime/build-info.js";
import { getDeckXdgPaths } from "../runtime/paths.js";
import { runDeckChecks } from "./doctor-checks";
import { decideReleaseAvailability, fetchReleaseDescriptor } from "../upgrade-command/github-release.js";
import type { DeckConfigStore } from "../deck-config-store";
import { resolveCanonicalSupermemoryProjectScope, type NormalizedDeckConfig } from "@deck/core";
import { createOwnerOnlyFileSecretStore, redactSecretDiagnostic } from "@deck/core";
import { createSupermemoryRuntime, createSupermemoryHttpTransport } from "@deck/adapter-supermemory/runtime";
import { checkSupermemoryObservabilitySink } from "../supermemory-observability";
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
// Known memory provider binaries (checked without instantiating providers)
// ---------------------------------------------------------------------------
const MEMORY_PROVIDERS: readonly { id: string; label: string; command: string }[] = [];

// ---------------------------------------------------------------------------
// Known MCP server entries to validate in OpenCode's opencode.json
// ---------------------------------------------------------------------------
const KNOWN_OPENCODE_MCP_SERVERS = [
  { name: "supermemory", label: "Supermemory MCP" },
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
function memoryBinaryAvailable(command: string): boolean {
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

function checkPiRuntime(
  command: string,
  dependencies: Pick<DoctorDiagnosticsDependencies, "inspectPiEnvironment" | "reviewPiRequiredTools">,
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
// Memory provider checks
// ---------------------------------------------------------------------------

function checkMemoryProviders(
  binaryAvailable: typeof memoryBinaryAvailable,
): DoctorCategoryResult[] {
  const results: DoctorCategoryResult[] = [];

  // Check configured memory providers.
  for (const provider of MEMORY_PROVIDERS) {
    const items: DoctorCheckItem[] = [];
    try {
      const available = binaryAvailable(provider.command);
      items.push({
        status: available ? "ok" : "warning",
        message: available
          ? `${provider.label} binary found in PATH`
          : `${provider.label} binary not found in PATH`,
        suggestion: available
          ? undefined
          : `Install ${provider.label} or ensure it is on your PATH`,
      });
    } catch (err) {
      items.push({
        status: "error",
        message: `Unable to check ${provider.label}: ${redact(String(err))}`,
      });
    }

    results.push({
      category: provider.label,
      status: deriveCategoryStatus(items),
      items,
    });
  }

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

async function checkSupermemoryRuntimeReadiness(
  config: NormalizedDeckConfig | undefined,
  projectRoot: string | undefined,
  dependencies: Pick<DoctorDiagnosticsDependencies, "readSupermemorySecret" | "checkSupermemoryApi" | "checkSupermemoryObservabilitySink">,
  runtimeStatuses: Awaited<ReturnType<typeof detectSelectedRuntimes>> = [],
): Promise<DoctorCategoryResult> {
  const items: DoctorCheckItem[] = [];
  if (!config) {
    items.push({ status: "warning", message: "Supermemory runtime readiness requires readable Deck config." });
  } else if (config.adaptiveMemory.enabled !== true) {
    items.push({ status: "ok", message: "Adaptive Memory runtime is disabled; no automatic Supermemory effects will run." });
  } else {
    items.push({ status: "ok", message: "Adaptive Memory runtime is enabled for Supermemory." });
    let scopeValue: string | undefined;
    if (!projectRoot) {
      items.push({ status: "error", message: "Supermemory runtime cannot verify canonical project scope without a verified project root." });
    } else {
      const scope = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] });
      if (scope.ok) scopeValue = scope.scope;
      items.push(scope.ok
        ? { status: "ok", message: "Canonical Supermemory runtime scope resolved." }
        : { status: "error", message: scope.diagnostics.map((diagnostic) => diagnostic.message).join(" ") });
    }
    let secret: string | undefined;
    try {
      secret = dependencies.readSupermemorySecret();
      items.push(secret ? { status: "ok", message: "Deck secret-store contains a Supermemory runtime credential." } : { status: "warning", message: "Deck secret-store does not contain a Supermemory runtime credential; automatic memory will fail open." });
    } catch (error) {
      items.push({ status: "warning", message: `Deck secret-store could not be inspected; automatic memory will fail open. ${redactSecretDiagnostic(error instanceof Error ? error.message : String(error))}` });
    }
    if (secret && scopeValue) {
      try {
        const checked = await dependencies.checkSupermemoryApi({ apiKey: secret, containerTag: scopeValue });
        const operations = checked?.operations ?? ["health", "profile", "search"];
        items.push({ status: "ok", message: `Supermemory API connectivity succeeded for the canonical scope (${operations.join(", ")}).` });
      } catch (error) {
        items.push({ status: "warning", message: `Supermemory API connectivity failed open. ${redactSecretDiagnostic(error instanceof Error ? error.message : String(error))}` });
      }
    }
    const sink = dependencies.checkSupermemoryObservabilitySink?.() ?? { ok: true, path: "", diagnostics: [] };
    items.push(sink.ok
      ? { status: "ok", message: "Supermemory content-free observability sink path inspected read-only; Doctor did not create, rotate, or write metrics." }
      : { status: "warning", message: `Supermemory observability sink inspection found a readiness issue; runtime still fails open. ${redactSecretDiagnostic(sink.diagnostics.join(" "))}` });
    items.push({ status: "ok", message: "Optional Supermemory MCP ad-hoc usage is unobservable-external-mcp: Deck cannot measure external MCP calls, and runtime metrics include only Deck-supervised automatic or explicit operations." });
  }
  items.push(...supermemoryRouteMatrixItems(runtimeStatuses));
  return { category: "Supermemory Runtime", status: deriveCategoryStatus(items), items };
}

function supermemoryRouteMatrixItems(runtimeStatuses: Awaited<ReturnType<typeof detectSelectedRuntimes>>): DoctorCheckItem[] {
  const installed = new Set(runtimeStatuses.filter((status) => status.installed).map((status) => status.runtime));
  const statusFor = (runtime: "opencode" | "pi" | "codex") => installed.has(runtime) ? "bridge-ready-on-deck-supervised-launch" : "runtime-not-detected";
  return [
    {
      status: "ok",
      message: `Deck-supervised native loopback route matrix: OpenCode interactive/resume ${statusFor("opencode")}; Pi interactive ${statusFor("pi")}; Codex exec/resume ${statusFor("codex")}. Direct launches without Deck's host loopback endpoint/token remain unsupported for automatic recall/capture.`,
    },
    {
      status: "ok",
      message: "Native context injection uses runner hook contracts: OpenCode model-message transform, Pi extension advisory return, and Codex hookSpecificOutput.additionalContext through the installed Deck binary. No Supermemory CLI package is required.",
    },
    {
      status: "ok",
      message: "Final-assistant capture remains runner-limited: OpenCode uses hook-exposed assistant chat events, Codex uses hook-exposed final events or its trusted bounded exec final-message file when available, and Pi remains unsupported unless Pi exposes a trusted final-assistant event.",
    },
  ];
}

// ---------------------------------------------------------------------------
// MCP validation
// ---------------------------------------------------------------------------

function checkPiMcp(
  validateSupermemoryPiMcpConfigFn: typeof validateSupermemoryPiMcpConfig,
): DoctorCategoryResult {
  try {
    const validation = validateSupermemoryPiMcpConfigFn();
    const items: DoctorCheckItem[] = validation.diagnostics.map((d) => ({
      status: d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "ok",
      message: redactDiagnostic(d).message,
    }));
    return {
      category: "Pi MCP",
      status: validation.ok ? "ok" : "error",
      items,
    };
  } catch (err) {
    return {
      category: "Pi MCP",
      status: "error",
      items: [{ status: "error", message: `MCP validation threw: ${redact(String(err))}` }],
    };
  }
}

function checkOpenCodeMcp(
  readMcpSection: typeof readOpenCodeMcpSection,
  validateSupermemoryMcp: typeof validateSupermemoryOpenCodeMcpConfig = validateSupermemoryOpenCodeMcpConfig,
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
        if (known.name === "supermemory") continue;
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

      const supermemoryValidation = validateSupermemoryMcp();
      const supermemoryDiagnostics = supermemoryValidation.diagnostics.join(" ");
      if (supermemoryValidation.ok) {
        items.push({
          status: "ok",
          message: supermemoryDiagnostics || "Raw Supermemory MCP is absent; Deck Runtime owns Adaptive Memory project isolation.",
        });
      } else {
        items.push({
          status: "warning",
          message: supermemoryDiagnostics || "Raw Supermemory MCP is present but not authorized for Deck project memory.",
          suggestion: supermemoryDiagnostics.includes("stale Deck-managed")
            ? "Run the Deck-owned retirement path; do not create a new raw Supermemory MCP entry."
            : "Leave unmanaged external entries unchanged; Deck Runtime does not treat them as project memory.",
        });
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

export function checkSupermemoryProjectScopeAgreement(input: {
  derivedScope?: string;
  configuredScopes?: Readonly<Record<string, string | undefined>>;
}): DoctorCategoryResult {
  const items: DoctorCheckItem[] = [];
  const scopePattern = /^sm_project_v1_[a-z0-9]+_[a-z0-9]+(?:_[a-z0-9]+)*$/;
  const derived = input.derivedScope?.trim();
  const derivedAvailable = !!derived && scopePattern.test(derived);
  const configuredEntries = Object.entries(input.configuredScopes ?? {});

  if (!derivedAvailable) {
    items.push({
      status: "warning",
      message: "Supermemory canonical project scope is missing or invalid; adaptive-memory project operations fail closed.",
      suggestion: "Run Doctor from a verified Git repository to compare runner MCP scopes; no default project scope is used.",
    });
  }

  for (const [runner, configuredValue] of configuredEntries) {
    const configured = configuredValue?.trim();
    if (!configured) {
      items.push({
        status: "warning",
        message: `Supermemory ${runner} MCP scope is missing; project memory operations are not authorized for that runner.`,
      });
      continue;
    }
    if (configured === "sm_project_default" || !scopePattern.test(configured)) {
      items.push({
        status: "error",
        message: `Supermemory ${runner} MCP scope is invalid or legacy/default; project memory operations are not authorized.`,
      });
      continue;
    }
    if (!derivedAvailable) {
      items.push({
        status: "warning",
        message: `Supermemory ${runner} MCP scope is present but could not be compared to a repository-derived scope; project memory operations remain fail-closed until verified.`,
      });
      continue;
    }
    if (configured !== derived) {
      items.push({
        status: "error",
        message: `Supermemory ${runner} MCP scope does not match the repository-derived scope; project memory operations are not authorized.`,
      });
      continue;
    }
    items.push({
      status: "ok",
      message: `Supermemory ${runner} MCP scope matches the repository-derived scope fingerprint.`,
    });
  }

  if (configuredEntries.length === 0) {
    items.push(derivedAvailable
      ? {
          status: "ok",
          message: "No raw Supermemory MCP scope materialization was found; Deck Runtime owns canonical project scope when Adaptive Memory is enabled.",
        }
      : {
          status: "warning",
          message: "No raw Supermemory MCP scope materialization was found, and no verified repository scope is available for Deck Runtime.",
        });
  }

  return {
    category: "Supermemory Project Scope",
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
  detectSelectedRuntimes: typeof detectSelectedRuntimes;
  inspectPiEnvironment: typeof inspectPiEnvironment;
  reviewPiRequiredTools: typeof reviewPiRequiredTools;
  validateSupermemoryPiMcpConfig: typeof validateSupermemoryPiMcpConfig;
  inspectOpenCodeEnvironment: typeof inspectOpenCodeEnvironment;
  reviewOpenCodeTools: typeof reviewOpenCodeTools;
  validateSupermemoryOpenCodeMcpConfig: typeof validateSupermemoryOpenCodeMcpConfig;
  runDeckChecks: typeof runDeckChecks;
  fetchReleaseDescriptor: typeof fetchReleaseDescriptor;
  memoryBinaryAvailable: typeof memoryBinaryAvailable;
  readOpenCodeMcpSection: typeof readOpenCodeMcpSection;
  configStore?: DeckConfigStore;
  readSupermemorySecret: () => string | undefined;
  checkSupermemoryApi: (input: { apiKey: string; containerTag: string }) => Promise<void | { operations: readonly string[] }>;
  checkSupermemoryObservabilitySink?: () => { ok: boolean; path: string; diagnostics: readonly string[] };
  inspectCodex: (projectRoot: string, deckConfig: NormalizedDeckConfig) => Promise<ReadonlyArray<{ category: string; status: DoctorStatus; message: string; suggestion?: string }>>;
}>;

const defaultDoctorDiagnosticsDependencies: DoctorDiagnosticsDependencies = {
  detectSelectedRuntimes,
  inspectPiEnvironment,
  reviewPiRequiredTools,
  validateSupermemoryPiMcpConfig,
  inspectOpenCodeEnvironment,
  reviewOpenCodeTools,
  validateSupermemoryOpenCodeMcpConfig,
  runDeckChecks,
  fetchReleaseDescriptor,
  memoryBinaryAvailable,
  readOpenCodeMcpSection,
  readSupermemorySecret: () => createOwnerOnlyFileSecretStore({ configHome: process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config") }).read("supermemory-api-key"),
  checkSupermemoryApi: async ({ apiKey, containerTag }) => {
    const runtime = createSupermemoryRuntime({ canonicalScope: containerTag, sessionId: "deck-doctor-supermemory", runnerId: "doctor", transport: createSupermemoryHttpTransport({ apiKey, timeoutMs: 3_000 }) });
    const health = await runtime.health({ dependency: "explicit-recall" });
    if (!health.ok) throw new Error(health.diagnostics.join(" "));
    const profile = await runtime.profile({ role: "setup", dependency: "explicit-recall" });
    if (!profile.ok && profile.reason !== "role_policy_skip") throw new Error(profile.diagnostics.join(" "));
    const search = await runtime.search({ role: "setup", query: "Deck Doctor Supermemory runtime connectivity", dependency: "explicit-recall" });
    if (!search.ok && search.reason !== "empty_query") throw new Error(search.diagnostics.join(" "));
    return { operations: ["health", "profile", "search"] };
  },
  checkSupermemoryObservabilitySink,
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
    if (discovery.conflict) {
      return {
        category: {
          category: "Global Deck Config",
          status: "error",
          items: [{ status: "error", message: `Global Deck config migration conflict at canonical path. Candidates: ${discovery.conflict.candidates.length}. Invalid: ${discovery.conflict.invalidCandidates.length}.`, suggestion: "Choose one legacy config to adopt before running diagnostics." }],
        },
      };
    }
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
  memory: DoctorCategoryResult[],
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

  countCategory(memory);
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
    detectSelectedRuntimes: overrides.detectSelectedRuntimes ?? defaultDoctorDiagnosticsDependencies.detectSelectedRuntimes,
    inspectPiEnvironment: overrides.inspectPiEnvironment ?? defaultDoctorDiagnosticsDependencies.inspectPiEnvironment,
    reviewPiRequiredTools: overrides.reviewPiRequiredTools ?? defaultDoctorDiagnosticsDependencies.reviewPiRequiredTools,
    validateSupermemoryPiMcpConfig: overrides.validateSupermemoryPiMcpConfig ?? defaultDoctorDiagnosticsDependencies.validateSupermemoryPiMcpConfig,
    inspectOpenCodeEnvironment: overrides.inspectOpenCodeEnvironment ?? defaultDoctorDiagnosticsDependencies.inspectOpenCodeEnvironment,
    reviewOpenCodeTools: overrides.reviewOpenCodeTools ?? defaultDoctorDiagnosticsDependencies.reviewOpenCodeTools,
    validateSupermemoryOpenCodeMcpConfig: overrides.validateSupermemoryOpenCodeMcpConfig ?? defaultDoctorDiagnosticsDependencies.validateSupermemoryOpenCodeMcpConfig,
    runDeckChecks: overrides.runDeckChecks ?? defaultDoctorDiagnosticsDependencies.runDeckChecks,
    fetchReleaseDescriptor: overrides.fetchReleaseDescriptor ?? defaultDoctorDiagnosticsDependencies.fetchReleaseDescriptor,
    memoryBinaryAvailable: overrides.memoryBinaryAvailable ?? defaultDoctorDiagnosticsDependencies.memoryBinaryAvailable,
    readOpenCodeMcpSection: overrides.readOpenCodeMcpSection ?? defaultDoctorDiagnosticsDependencies.readOpenCodeMcpSection,
    readSupermemorySecret: overrides.readSupermemorySecret ?? defaultDoctorDiagnosticsDependencies.readSupermemorySecret,
    checkSupermemoryApi: overrides.checkSupermemoryApi ?? defaultDoctorDiagnosticsDependencies.checkSupermemoryApi,
    checkSupermemoryObservabilitySink: overrides.checkSupermemoryObservabilitySink ?? defaultDoctorDiagnosticsDependencies.checkSupermemoryObservabilitySink,
    configStore: overrides.configStore,
    inspectCodex: overrides.inspectCodex ?? defaultDoctorDiagnosticsDependencies.inspectCodex,
  };
  const runtimes: DoctorRuntimeResult[] = [];
  let memoryCritical = false;
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
      runtimes.push(checkPiRuntime(status.command!, dependencies));
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

  // 3. Memory providers
  let memoryResults: DoctorCategoryResult[] = [];
  try {
    memoryResults = checkMemoryProviders(dependencies.memoryBinaryAvailable);
    memoryResults.push(await checkSupermemoryRuntimeReadiness(globalConfigCheck.config, projectRoot, dependencies, runtimeStatuses));
  } catch (err) {
    memoryResults = [
      {
        category: "Memory Providers",
        status: "error",
        items: [{ status: "error", message: `Memory check failed: ${redact(String(err))}` }],
      },
    ];
  }

  if (memoryResults.some((r) => r.status === "error")) {
    memoryCritical = true;
  }

  // 4. MCP validation (synchronous, called directly)
  const piMcpResult = checkPiMcp(dependencies.validateSupermemoryPiMcpConfig);
  let openCodeMcpSection: Record<string, unknown> | null = null;
  const opencodeMcpResult = checkOpenCodeMcp(() => {
    openCodeMcpSection = dependencies.readOpenCodeMcpSection();
    return openCodeMcpSection;
  }, dependencies.validateSupermemoryOpenCodeMcpConfig);
  const configuredScopes: Record<string, string | undefined> = {};
  if (piMcpResult.status !== "warning") {
    try {
      const piValidation = dependencies.validateSupermemoryPiMcpConfig();
      configuredScopes.Pi = piValidation.projectScope;
    } catch {
      configuredScopes.Pi = undefined;
    }
  }
  if (openCodeMcpSection !== null) {
    try {
      const openCodeValidation = dependencies.validateSupermemoryOpenCodeMcpConfig();
      if (openCodeValidation.ok && openCodeValidation.projectScope) {
        configuredScopes.OpenCode = openCodeValidation.projectScope;
      }
    } catch {
      // Raw OpenCode Supermemory MCP is optional; failed inspection is reported by the OpenCode MCP check.
    }
  }
  if (projectRoot) {
    try {
      const codexConfigPath = join(projectRoot, ".codex", "config.toml");
      if (existsSync(codexConfigPath)) {
        const codexState = inspectCodexSupermemoryMcpState(readFileSync(codexConfigPath, "utf-8"));
        configuredScopes.Codex = codexState.ok ? codexState.scope : undefined;
      }
    } catch {
      configuredScopes.Codex = undefined;
    }
  }
  const derivedScope = projectRoot
    ? (() => {
        const resolved = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] });
        return resolved.ok ? resolved.scope : undefined;
      })()
    : undefined;
  const scopeAgreementResult = checkSupermemoryProjectScopeAgreement({ derivedScope, configuredScopes });
  const mcpResults: DoctorCategoryResult[] = [piMcpResult, opencodeMcpResult, scopeAgreementResult];

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

  // 7. Calculate summary
  const summary = calculateSummary(
    deckResults,
    binaryResults,
    runnerConfigResults,
    runtimes,
    memoryResults,
    mcpResults,
  );

  // 7. Determine hasCriticalErrors (including new deck/binary/runner checks)
  const noRuntimes = runtimes.length === 0 || runtimes.every((r) => r.installed === false);
  const hasCriticalErrors =
    noRuntimes ||
    memoryCritical ||
    mcpResults.some((r) => r.status === "error") ||
    runtimes.some((r) => r.checks.some((c) => c.category === "Runtime" && c.status === "error")) ||
    // New: deck, binary, runnerConfig critical errors
    deckResults.some((r) => r.status === "error") ||
    binaryResults.some((r) => r.status === "error") ||
    runnerConfigResults.some((r) => r.status === "error");

  return {
    runtimes,
    memory: memoryResults,
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

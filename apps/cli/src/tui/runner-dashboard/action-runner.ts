/**
 * Runtime-agnostic action runner for the dashboard review plan.
 *
 * Works with any runner (Pi, OpenCode, etc.) via injected dependencies.
 * Each adapter provides its own implementations for runtime-specific actions.
 */

import { readFileSync, existsSync, writeFileSync, appendFileSync, readdirSync, statSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
  PACKAGE_INSTRUCTION_PACKAGE_IDS,
  normalizeSupportedPackageInstructionSelection,
  validateDeckConfig,
  type NormalizedDeckConfig,
  type PackageInstructionPackageId,
} from "@deck/core/config/deck-config";
import type { DeckConfigStore } from "../../deck-config-store";
import type { AdaptiveMemoryProvider } from "@deck/core/memory/adaptive-memory";
import {
  validateSerenaOperationAuthorization,
  validateSerenaReadinessEvidence,
  type SerenaBootstrapAuthorization,
  type SerenaOperationIdentity,
  type SerenaReadinessEvidence,
  type RunnerPostInstallFollowUp,
  type RunnerVerificationEvidence,
  type DeckSecretStore,
} from "@deck/core";
import { runnerRequiresExternalSupermemoryToken, type RunnerAction, type RunnerDashboardState, type RunnerReviewPlan } from "./state";
import type { DeveloperTeamModelAssignments, DeveloperTeamThinkingAssignments, WebSearchProviderDescriptorV1 } from "@deck/core";
// Canonical server name for codebase-memory MCP — defined locally to avoid adapter dependency in the runner
const CODEBASE_MEMORY_MCP_SERVER_NAME = "codebase-memory";

const LOG = "/tmp/deck-tui.log";
function _ts() { return new Date().toISOString().slice(11, 23); }
function log(msg: string) { if (!process.env.DECK_DEBUG) return; try { appendFileSync(LOG, `${_ts()} [action-runner] ${msg}\n`); } catch {} }

export type RunnerActionRunStatus = "executed" | "informational" | "skipped" | "failed";

export type RunnerActionRunResult = {
  actionId: string;
  status: RunnerActionRunStatus;
  message: string;
  diagnostics: string[];
  packageOutcome?: RunnerPackageInstallOutcome;
  cause?: string;
  raw?: unknown;
  /** Serena-only typed UI outcome; readiness evidence never crosses this boundary. */
  serenaOutcome?: RunnerSerenaOutcome;
  /** Serena-only fixed progress stage. */
  serenaStage?: RunnerSerenaStage;
  /** Non-secret post-apply facts retained only for this reviewed plan. */
  verificationEvidence?: readonly RunnerVerificationEvidence[];
  /** User-owned next steps emitted only by a successful verified installation. */
  postInstallFollowUps?: readonly RunnerPostInstallFollowUp[];
};

export type RunnerSerenaStage =
  | "preparing-uv"
  | "installing-serena"
  | "validating-serena"
  | "configuring-mcp";

export type RunnerSerenaOutcome = "reused" | "installed" | "failed" | "cancelled" | "partial";

export type RunnerSerenaActionContext = Readonly<{
  projectRoot: string;
  runnerId: string;
  environmentId: string;
  operationId: string;
  operation: SerenaOperationIdentity;
  currentOperation: SerenaOperationIdentity;
  serenaAuthorization: SerenaBootstrapAuthorization;
  signal?: AbortSignal;
  serenaReadiness?: SerenaReadinessEvidence;
  webSearchProvider?: WebSearchProviderDescriptorV1;
  onSerenaStage?: (stage: RunnerSerenaStage) => void;
  /** Adapter-specific optional gates are passed through without being serialized. */
  serenaRevalidator?: unknown;
  serenaOwnedRoot?: string;
}>;

export type RunnerSerenaExecutionState = {
  attempted: boolean;
  succeeded: boolean;
  outcome?: RunnerSerenaOutcome;
  stage?: RunnerSerenaStage;
  readiness?: SerenaReadinessEvidence;
};

export type RunnerActionExecutor = (
  action: RunnerAction,
  context: RunnerSerenaActionContext,
) => Promise<RunnerActionRunResult>;

export type RunnerPackageInstallOutcome = "already-present" | "executed" | "failed" | "skipped";

export type RunnerPackageInstallDiagnostic = {
  stage: string;
  code: string;
  exitCode?: number;
  lines: readonly string[];
};

export type RunnerPackageInstallResult = {
  id: string;
  outcome: RunnerPackageInstallOutcome;
  success: boolean;
  message: string;
  installerInvoked?: boolean;
  cause?: string;
  diagnostic?: RunnerPackageInstallDiagnostic;
  /** Private Serena handoff consumed only inside the current operation. */
  serenaReadiness?: SerenaReadinessEvidence;
  serenaBootstrapOutcome?: RunnerSerenaOutcome;
  serenaStage?: Exclude<RunnerSerenaStage, "configuring-mcp">;
};

/**
 * Generic package installer function — adapters provide their own.
 */
export type PackageInstallerFn = (
  runnerCommand: string | undefined,
  packages: Array<{ id: string; name: string; source: string }>,
  onResult: (result: RunnerPackageInstallResult) => void,
  context?: RunnerSerenaActionContext,
) => Promise<RunnerPackageInstallResult[]>;

/**
 * Generic team bundle installer — adapters provide their own.
 */
export type TeamBundleInstallerFn = (
  projectRoot: string,
  options?: {
    memoryProvider?: AdaptiveMemoryProvider;
    modelAssignments?: DeveloperTeamModelAssignments;
    thinkingAssignments?: DeveloperTeamThinkingAssignments;
    capabilityIds?: readonly string[];
  },
) => Promise<{
  results: Array<{ agentId: string; kind: string; status: string }>;
  verificationEvidence?: readonly RunnerVerificationEvidence[];
  postInstallFollowUps?: readonly RunnerPostInstallFollowUp[];
}>;

/**
 * Generic MCP config writer — adapters provide their own.
 * Supports runner-owned OAuth, token-based auth, and local MCP server config.
 */
export type McpConfigWriterFn = (options: {
  /** Server name (used by all types) */
  serverName: string;
  /** Verified project root for canonical non-secret project scope derivation. */
  projectRoot?: string;
  /** Optional token for runners that use API-key authentication. */
  token?: string;
  /** MCP server type: local (npx command) or remote (URL) */
  type?: "local" | "remote";
  /** For local MCP servers: command to execute (e.g., ["npx", "-y", "@upstash/context7-mcp"]) */
  command?: string[];
  /** For remote MCP servers: URL of the MCP server */
  url?: string;
  /** For remote MCP servers: optional headers */
  headers?: Record<string, string>;
  webSearchProvider?: WebSearchProviderDescriptorV1;
}, context?: RunnerSerenaActionContext) => Promise<{ ok: boolean; path: string; diagnostics?: string[] }>;

/**
 * Generic MCP config validator — adapters provide their own.
 */
export type McpConfigValidatorFn = (options: { token?: string; serverName?: string }) => { ok: boolean; diagnostics?: string[] };
export type SupermemoryReadOnlyApiValidatorFn = (options: { apiKey: string; projectRoot?: string }) => Promise<{ ok: boolean; diagnostics?: string[] }>;

/**
 * Dependencies for the action runner.
 * Adapters inject their runtime-specific implementations.
 */
export type RunnerActionRunnerDependencies = {
  projectRoot?: string;
  runnerCommand?: string;
  dashboardState?: RunnerDashboardState;
  packageInstructionIds?: readonly PackageInstructionPackageId[];
  supermemoryToken?: string;
  secretStore?: DeckSecretStore;
  validateSupermemoryReadOnlyApi?: SupermemoryReadOnlyApiValidatorFn;
  memoryProvider?: AdaptiveMemoryProvider;
  resolvedMemoryProvider?: AdaptiveMemoryProvider;
  /** Runtime-only provider descriptor selected by the CLI composition root. */
  webSearchProvider?: WebSearchProviderDescriptorV1;
  installPackages?: PackageInstallerFn;
  installTeamBundle?: TeamBundleInstallerFn;
  writeMcpConfig?: McpConfigWriterFn;
  validateMcpConfig?: McpConfigValidatorFn;
  configStore?: DeckConfigStore;
  writeDeckConfig?: (projectRoot: string, config: unknown) => NormalizedDeckConfig;
  onActionResult?: (result: RunnerActionRunResult) => void;
  onInstallResult?: (result: RunnerPackageInstallResult) => void;
  /** Current-operation Serena authorization and the single operation signal. */
  runnerId?: string;
  operationId?: string;
  currentOperation?: SerenaOperationIdentity;
  serenaAuthorization?: SerenaBootstrapAuthorization;
  signal?: AbortSignal;
  onSerenaStage?: (stage: RunnerSerenaStage) => void;
  /** Optional native adapter action seam used for runner-specific Serena gates. */
  runnerAction?: RunnerActionExecutor;
  runnerAdapter?: {
    runAction: (action: RunnerAction, context: RunnerSerenaActionContext) => Promise<unknown>;
  };
  serenaRevalidator?: unknown;
  serenaOwnedRoot?: string;
  /** Evidence is retained only for the current plan; it is never rendered. */
  serenaExecutionState?: RunnerSerenaExecutionState;
  serenaPlanValid?: boolean;
  // Backward-compatible aliases for Pi-specific tests
  piCommand?: string;
  writeSupermemoryPiMcpConfig?: McpConfigWriterFn;
  validateSupermemoryPiMcpConfig?: McpConfigValidatorFn;
  buildDeveloperTeamInstallPlan?: (projectRoot: string, options?: { memoryProvider?: AdaptiveMemoryProvider }) => { agents: unknown[]; skills: unknown[]; standaloneSkills: unknown[]; sddSkillFiles: unknown[]; };
  applyDeveloperTeamInstall?: (projectRoot: string, options?: { memoryProvider?: AdaptiveMemoryProvider }) => Promise<{ results: Array<{ agentId: string; kind: string; status: string }> }>;
  installInternalRunnerPackages?: (command: string | undefined, actions: Array<{ packageId: string; name: string; source: string; installKind: string; reason: string }>, onResult: (result: { success: boolean; message?: string }) => void) => Promise<Array<{ success: boolean; message?: string }>>;
  resolveAdaptiveMemoryProvider?: (options: { provider: string; supermemoryToken?: string; projectRoot?: string }) => AdaptiveMemoryProvider | undefined;
};

export function resolveSupermemoryRuntimeCredentialReadiness(options: {
  setup?: { runtimeCredentialStored?: boolean; hasToken?: boolean; configured?: boolean };
  secretStore?: Pick<DeckSecretStore, "read">;
}): { ready: boolean; diagnostics: string[]; reason: "state-ready" | "secret-ready" | "missing" | "read-error" } {
  if (options.setup?.runtimeCredentialStored === true || options.setup?.hasToken === true) {
    return { ready: true, diagnostics: [], reason: "state-ready" };
  }
  if (!options.secretStore) {
    return { ready: false, diagnostics: ["Supermemory Deck runtime API credential must be validated and stored before Review & Install; no Deck secret store was available for readiness verification."], reason: "missing" };
  }
  try {
    const stored = options.secretStore.read("supermemory-api-key")?.trim();
    if (stored) return { ready: true, diagnostics: [], reason: "secret-ready" };
    return { ready: false, diagnostics: ["Supermemory Deck runtime API credential must be validated and stored before Review & Install."], reason: "missing" };
  } catch (error) {
    return {
      ready: false,
      diagnostics: [redact(error instanceof Error ? error.message : String(error))],
      reason: "read-error",
    };
  }
}

export function getRunnerReviewPlanRunBlockDiagnostics(
  state?: RunnerDashboardState,
  options: { supermemoryToken?: string; secretStore?: Pick<DeckSecretStore, "read"> } = {},
): string[] {
  if (state?.adaptiveMemory.provider !== "supermemory") return [];

  const setup = state.adaptiveMemory.supermemory;
  const diagnostics: string[] = [];
  const readiness = resolveSupermemoryRuntimeCredentialReadiness({ setup, secretStore: options.secretStore });
  if (!setup?.configured && !readiness.ready) diagnostics.push("Supermemory setup is not configured for Review & Install.");
  if (!readiness.ready) diagnostics.push(...readiness.diagnostics);
  if (process.env.DECK_DEBUG) log(`Supermemory runtime readiness: ${readiness.ready ? "ready" : "not-ready"} (${readiness.reason}).`);
  diagnostics.push(...(setup?.diagnostics ?? []).filter(isBlockingSetupDiagnostic));
  return redactDiagnostics(diagnostics);
}

function getReviewedPlanExecutionBlocker(
  plan: RunnerReviewPlan,
  dependencies: RunnerActionRunnerDependencies,
): string | undefined {
  const state = dependencies.dashboardState;
  if (!state || state.plan !== plan) return undefined;
  if (!plan.ready) return "Review & Install requires a ready reviewed plan.";
  if (state.planGeneratedForRevision !== undefined && state.planGeneratedForRevision !== state.planRevision) {
    return "Review & Install is blocked because the reviewed plan is stale.";
  }
  const expectedOperation = state.currentOperation;
  const currentOperation = dependencies.currentOperation;
  if (!expectedOperation && !currentOperation) return undefined;
  if (!expectedOperation || !currentOperation
    || state.operationId !== expectedOperation.operationId
    || dependencies.operationId !== undefined && dependencies.operationId !== expectedOperation.operationId
    || currentOperation.operationId !== expectedOperation.operationId
    || currentOperation.runner !== expectedOperation.runner) {
    return "Review & Install is blocked because the reviewed operation identity changed.";
  }
  return undefined;
}

const TUI_DIAGNOSTIC_LINE_LIMIT = 8;
const TUI_DIAGNOSTIC_SCALAR_LIMIT = 240;
const TUI_DIAGNOSTIC_BYTE_LIMIT = 1_280;
const TUI_CAUSE_LINE_LIMIT = 2;
const TUI_CAUSE_BYTE_LIMIT = 320;
const PACKAGE_OUTCOMES = new Set<RunnerPackageInstallOutcome>(["already-present", "executed", "failed", "skipped"]);

function isRunnerPackageOutcome(value: unknown): value is RunnerPackageInstallOutcome {
  return typeof value === "string" && PACKAGE_OUTCOMES.has(value as RunnerPackageInstallOutcome);
}

function isSatisfiedPackageOutcome(outcome: RunnerPackageInstallOutcome): boolean {
  return outcome === "already-present" || outcome === "executed";
}

function packageInstallIntegrityFailure(action: RunnerAction, reason: string): RunnerActionRunResult {
  const safeReason = sanitizeActionText(reason) || "invalid package result";
  return {
    actionId: action.id,
    status: "failed",
    message: `Package installer result integrity failure: ${safeReason}.`,
    diagnostics: [safeReason],
    cause: safeReason,
  };
}

function validatePackageInstallResult(
  value: unknown,
  expectedIds: ReadonlySet<string>,
  seenIds: Set<string>,
): { result?: RunnerPackageInstallResult; reason?: string } {
  if (!value || typeof value !== "object") return { reason: "result is not an object" };
  const candidate = value as Record<string, unknown>;
  const id = candidate.id;
  if (typeof id !== "string" || id.length === 0) return { reason: "missing package ID" };
  if (!expectedIds.has(id)) return { reason: "unknown package ID" };
  if (seenIds.has(id)) return { reason: "duplicate package ID" };
  seenIds.add(id);

  const outcome = candidate.outcome;
  if (!isRunnerPackageOutcome(outcome)) return { reason: "missing or unknown package outcome" };
  if (typeof candidate.success !== "boolean") return { reason: "missing package success flag" };
  if (candidate.success !== isSatisfiedPackageOutcome(outcome)) return { reason: "package outcome and success disagree" };
  if (candidate.installerInvoked !== undefined && typeof candidate.installerInvoked !== "boolean") {
    return { reason: "invalid installer invocation flag" };
  }
  if (candidate.installerInvoked !== undefined && outcome !== "failed" && candidate.installerInvoked !== (outcome === "executed")) {
    return { reason: "package outcome and installer invocation disagree" };
  }
  if (candidate.cause !== undefined && typeof candidate.cause !== "string") return { reason: "invalid package cause" };
  if (typeof candidate.message !== "string") return { reason: "missing package message" };
  if (
    candidate.serenaBootstrapOutcome !== undefined
    && (id !== "serena" || !["reused", "installed", "failed", "cancelled", "partial"].includes(String(candidate.serenaBootstrapOutcome)))
  ) {
    return { reason: "invalid Serena outcome" };
  }
  if (candidate.serenaStage !== undefined && !["preparing-uv", "installing-serena", "validating-serena"].includes(String(candidate.serenaStage))) {
    return { reason: "invalid Serena stage" };
  }
  if (candidate.serenaReadiness !== undefined) {
    if (id !== "serena" || !validateSerenaReadinessEvidence(candidate.serenaReadiness).valid) {
      return { reason: "invalid Serena readiness evidence" };
    }
  }

  const diagnostic = candidate.diagnostic;
  if (diagnostic !== undefined) {
    if (!diagnostic || typeof diagnostic !== "object") return { reason: "invalid package diagnostic" };
    const diagnosticRecord = diagnostic as Record<string, unknown>;
    if (typeof diagnosticRecord.stage !== "string" || typeof diagnosticRecord.code !== "string" || !Array.isArray(diagnosticRecord.lines) || !diagnosticRecord.lines.every((line) => typeof line === "string")) {
      return { reason: "invalid package diagnostic fields" };
    }
    if (diagnosticRecord.exitCode !== undefined && typeof diagnosticRecord.exitCode !== "number") return { reason: "invalid package diagnostic exit code" };
  }

  return {
    result: {
      id,
      outcome,
      success: candidate.success,
      message: candidate.message,
      ...(typeof candidate.installerInvoked === "boolean" ? { installerInvoked: candidate.installerInvoked } : {}),
       ...(typeof candidate.cause === "string" ? { cause: candidate.cause } : {}),
       ...(typeof candidate.serenaBootstrapOutcome === "string" ? { serenaBootstrapOutcome: candidate.serenaBootstrapOutcome as RunnerSerenaOutcome } : {}),
       ...(typeof candidate.serenaStage === "string" ? { serenaStage: candidate.serenaStage as Exclude<RunnerSerenaStage, "configuring-mcp"> } : {}),
       ...(candidate.serenaReadiness ? { serenaReadiness: candidate.serenaReadiness as SerenaReadinessEvidence } : {}),
      ...(diagnostic ? {
        diagnostic: {
          stage: (diagnostic as Record<string, unknown>).stage as string,
          code: (diagnostic as Record<string, unknown>).code as string,
          ...((diagnostic as Record<string, unknown>).exitCode === undefined ? {} : { exitCode: (diagnostic as Record<string, unknown>).exitCode as number }),
          lines: (diagnostic as Record<string, unknown>).lines as readonly string[],
        },
      } : {}),
    },
  };
}

function projectPackageInstallResults(
  action: RunnerAction,
  packages: Array<{ id: string; name: string; source: string }>,
  installResults: unknown,
): RunnerActionRunResult {
  if (!Array.isArray(installResults) || installResults.length === 0) {
    return {
      actionId: action.id,
      status: "failed",
      message: `Package installer returned no result for ${action.source ?? action.toolId ?? action.id}; installation outcome is unknown.`,
      diagnostics: redactDiagnostics(action.diagnostics ?? []),
      cause: "Package installer returned no result.",
    };
  }

  const expectedIds = new Set(packages.map((pkg) => pkg.id));
  if (expectedIds.size !== packages.length) return packageInstallIntegrityFailure(action, "duplicate expected package ID");
  const seenIds = new Set<string>();
  const safeResults: RunnerPackageInstallResult[] = [];
  for (const installResult of installResults) {
    const validation = validatePackageInstallResult(installResult, expectedIds, seenIds);
    if (validation.reason) return packageInstallIntegrityFailure(action, validation.reason);
    safeResults.push(validation.result!);
  }

  const missingId = packages.some((pkg) => !seenIds.has(pkg.id));
  if (missingId) return packageInstallIntegrityFailure(action, "missing package result");

  const safeDiagnostics = boundTuiDiagnostics(safeResults.flatMap((result) => {
    const lines = result.diagnostic?.lines ?? [];
    return lines.length > 0 ? lines : result.cause ? [result.cause] : [];
  }));
  const hasFailed = safeResults.some((result) => result.outcome === "failed");
  const hasSkipped = safeResults.some((result) => result.outcome === "skipped");
  const allAlreadyPresent = safeResults.every((result) => result.outcome === "already-present");
  const allSkipped = safeResults.every((result) => result.outcome === "skipped");
  const outcome: RunnerPackageInstallOutcome = hasFailed || (hasSkipped && !allSkipped)
    ? "failed"
    : allAlreadyPresent
      ? "already-present"
      : allSkipped
        ? "skipped"
        : "executed";
  const status: RunnerActionRunStatus = outcome === "already-present"
    ? "skipped"
    : outcome === "executed"
      ? "executed"
      : outcome === "failed"
        ? "failed"
        : "skipped";
  const firstFailure = safeResults.find((result) => result.outcome === "failed" || result.outcome === "skipped");
  const first = safeResults[0]!;
  const causeLines = boundTuiDiagnostics([
    ...(firstFailure?.cause ? [firstFailure.cause] : []),
    ...(firstFailure?.diagnostic?.lines ?? []),
    ...safeDiagnostics,
  ]);
  const cause = status === "failed"
    ? boundTuiCause(causeLines.length > 0 ? causeLines : [failureFallback(firstFailure?.diagnostic)])
    : first.cause ? boundTuiCause([first.cause]) : undefined;
  const message = safeResults.length === 1
    ? sanitizeActionText(first.message) || "Package install completed."
    : outcome === "failed"
      ? "Package install reported a failure."
      : outcome === "already-present"
        ? "All requested packages already present; installers not run."
        : outcome === "skipped"
          ? "Package installation was skipped."
          : "Packages installed.";
  const diagnostic = first.diagnostic;
  const raw = {
    id: first.id,
    outcome,
    ...(diagnostic ? {
      diagnostic: {
        stage: diagnostic.stage,
        code: diagnostic.code,
        ...(diagnostic.exitCode === undefined ? {} : { exitCode: diagnostic.exitCode }),
        lines: safeDiagnostics,
      },
    } : {}),
  };

  return {
    actionId: action.id,
    status,
    packageOutcome: outcome,
    message,
    diagnostics: safeDiagnostics,
    ...(cause ? { cause } : {}),
    ...(action.capabilityId === "serena" ? {
      serenaOutcome: first.serenaBootstrapOutcome ?? inferSerenaOutcome(outcome, status === "failed" ? "failed" : outcome === "skipped" ? "cancelled" : "installed"),
      ...(first.serenaStage ? { serenaStage: first.serenaStage } : {}),
    } : {}),
    raw,
  };
}

function failureFallback(diagnostic?: RunnerPackageInstallDiagnostic): string {
  const stage = diagnostic?.stage === "post-install"
    ? "Post-install"
    : diagnostic?.stage
      ? diagnostic.stage.charAt(0).toUpperCase() + diagnostic.stage.slice(1)
      : "Install";
  return `${stage} failed${diagnostic?.exitCode === undefined ? "." : ` (exit ${diagnostic.exitCode}).`}`;
}

function boundTuiDiagnostics(values: readonly unknown[]): string[] {
  const sanitized = values
    .flatMap((value) => sanitizeActionText(value).split("\n"))
    .filter(Boolean);
  const meaningful = sanitized.filter((line) => /error|failed|failure|fatal|denied|permission|not found|no such|unable|cannot|text file busy|etxtbsy|exit|checksum|timeout|timed out|pgrep|copy/iu.test(line));
  const selected = meaningful.length > 0 ? meaningful : sanitized;
  const result: string[] = [];
  let bytes = 0;
  for (const line of selected) {
    if (result.length >= TUI_DIAGNOSTIC_LINE_LIMIT) break;
    const boundedScalars = truncateActionScalars(line, TUI_DIAGNOSTIC_SCALAR_LIMIT);
    const remaining = TUI_DIAGNOSTIC_BYTE_LIMIT - bytes;
    if (remaining <= 0) break;
    const bounded = truncateActionUtf8(boundedScalars, remaining);
    if (!bounded) continue;
    result.push(bounded);
    bytes += Buffer.byteLength(bounded, "utf8");
  }
  return [...new Set(result)];
}

function boundTuiCause(values: readonly unknown[]): string {
  const lines = boundTuiDiagnostics(values).slice(0, TUI_CAUSE_LINE_LIMIT);
  let cause = "";
  for (const line of lines) {
    const next = cause ? `${cause} · ${line}` : line;
    const bounded = truncateActionUtf8(next, TUI_CAUSE_BYTE_LIMIT);
    if (!bounded) break;
    cause = bounded;
    if (bounded !== next) break;
  }
  return cause;
}

function sanitizeActionText(value: unknown): string {
  let text = typeof value === "string" ? value.replace(/\r\n?/g, "\n") : String(value ?? "");
  text = stripVTControlCharacters(text)
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}]/gu, "");
  text = text.replace(/[\u2500-\u257f\u2580-\u259f\u2800-\u28ff◐◓◑◒◴◷◶◵⟳]/gu, "");

  const urls: string[] = [];
  text = text.replace(/\b(?:https?|wss?|git\+https?):\/\/[^\s]+/giu, (url) => {
    const token = `__DECK_TUI_URL_${urls.length}__`;
    urls.push(redactActionUrl(url));
    return token;
  });

  text = redactActionSecrets(text);
  const roots = [
    [process.env.XDG_CONFIG_HOME, "$XDG_CONFIG_HOME"],
    [process.env.XDG_CACHE_HOME, "$XDG_CACHE_HOME"],
    [process.env.XDG_STATE_HOME, "$XDG_STATE_HOME"],
    [process.env.HOME, "~"],
  ].filter((entry): entry is [string, string] => Boolean(entry[0])).sort((left, right) => right[0].length - left[0].length);
  for (const [root, replacement] of roots) text = text.split(root).join(replacement);
  text = text
    .replace(/(?<![\w:~])(?:[A-Za-z]:[\\/]|\\\\)[^\s,;]+/g, "<path>")
    .replace(/(?<![\w:~/])\/(?:[^\s,;<>"']+\/)*[^\s,;<>"']+/g, "<path>")
    .split("\n")
    .map((line) => redactActionSecrets(line).replace(/ +/g, " ").trim())
    .join("\n");
  text = text.replace(/__DECK_TUI_URL_(\d+)__/g, (_match, index: string) => urls[Number(index)] ?? "<url>");
  return text;
}

function redactActionSecrets(value: string): string {
  const keys = "token|secret|password|passwd|api-key|api_key|authorization|proxy-authorization|cookie|set-cookie|credential|client-secret|client_secret|access-key|access_key";
  return value
    .replace(new RegExp(`((?:${keys})\\s*[:=]\\s*)[^\\s,;]+`, "giu"), "$1[REDACTED]")
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, "[REDACTED]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED]");
}

function redactActionUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = "[REDACTED]";
      parsed.password = "[REDACTED]";
    }
    const secretKeys = /token|secret|password|passwd|key|authorization|credential|cookie/i;
    for (const key of [...parsed.searchParams.keys()]) if (secretKeys.test(key)) parsed.searchParams.set(key, "[REDACTED]");
    return parsed.toString();
  } catch {
    return redactActionSecrets(value);
  }
}

function truncateActionScalars(value: string, max: number): string {
  const scalars = [...value];
  if (scalars.length <= max) return value;
  return scalars.slice(0, Math.max(0, max - 1)).join("") + "…";
}

function truncateActionUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const suffix = "…";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  if (maxBytes <= suffixBytes) return Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8");
  const source = Buffer.from(value, "utf8");
  let end = maxBytes - suffixBytes;
  while (end > 0 && (source[end]! & 0xc0) === 0x80) end--;
  let prefix = source.subarray(0, end).toString("utf8");
  while (prefix.includes("\ufffd") && end > 0) {
    end--;
    prefix = source.subarray(0, end).toString("utf8");
  }
  return `${prefix}${suffix}`;
}

function isUnsatisfiedInstallResult(action: RunnerAction, result: RunnerActionRunResult): boolean {
  if (!action.id.startsWith("capability.")) return false;
  if (action.capabilityId === "serena") {
    return result.status === "failed"
      || result.serenaOutcome === "failed"
      || result.serenaOutcome === "cancelled"
      || result.serenaOutcome === "partial"
      || result.status === "skipped" && result.packageOutcome !== "already-present";
  }
  if (result.status === "failed") return true;
  return result.status === "skipped" && result.packageOutcome !== "already-present";
}

function hasSerenaAction(plan: RunnerReviewPlan): boolean {
  return Object.values(plan.groups).flat().some((action) => action.capabilityId === "serena");
}

function serenaActionKind(action: RunnerAction): "install" | "config" | undefined {
  if (action.capabilityId !== "serena") return undefined;
  if (action.kind === "write-mcp-config" || action.kind === "write-pi-mcp-config") return "config";
  if (action.kind === "install-opencode-plugin" || action.kind === "install-pi-package" || action.kind === "install") return "install";
  return undefined;
}

function getSerenaActionContext(
  dependencies: RunnerActionRunnerDependencies,
): { context: RunnerSerenaActionContext } | { error: string } {
  if (dependencies.serenaPlanValid === false) return { error: "Serena plan is stale or no longer matches the current operation." };
  const state = dependencies.dashboardState;
  const runner = dependencies.runnerId ?? (state?.runnerScope !== "all" ? state?.runnerScope : undefined);
  const operation = dependencies.currentOperation ?? state?.currentOperation;
  const operationId = dependencies.operationId ?? state?.operationId ?? operation?.operationId;

  if (runner !== "pi" && runner !== "opencode" && runner !== "codex") return { error: "Serena requires a selected runner operation." };
  if (!operation || operation.runner !== runner || operation.operationId !== operationId || operation.explicitlySelected !== true) {
    return { error: "Serena requires explicit selection in the current runner operation." };
  }
  if (state && state.explicitlySelectedCapabilities.serena !== true) {
    return { error: "Serena requires current-operation explicit selection." };
  }

  const serenaOperation: SerenaOperationIdentity = {
    runner,
    operationId: operation.operationId,
    explicitlySelected: operation.explicitlySelected,
  };
  const authorization = validateSerenaOperationAuthorization(dependencies.serenaAuthorization, serenaOperation);
  if (!authorization.valid || authorization.authorization.runner !== runner) {
    return { error: "Serena operation authorization is missing or stale." };
  }

  return {
    context: {
      projectRoot: dependencies.projectRoot ?? "",
      runnerId: runner,
      environmentId: `${runner}-development`,
      operationId: operation.operationId,
      operation: serenaOperation,
      currentOperation: serenaOperation,
      serenaAuthorization: authorization.authorization,
      webSearchProvider: dependencies.webSearchProvider,
      signal: dependencies.signal,
      onSerenaStage: dependencies.onSerenaStage,
      serenaRevalidator: dependencies.serenaRevalidator,
      serenaOwnedRoot: dependencies.serenaOwnedRoot,
    },
  };
}

function inferSerenaOutcome(value: unknown, fallback: RunnerSerenaOutcome): RunnerSerenaOutcome {
  if (value === "reused" || value === "installed" || value === "failed" || value === "cancelled" || value === "partial") return value;
  if (value === "already-present") return "reused";
  if (value === "executed") return "installed";
  return fallback;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inferSerenaStage(value: unknown, fallback: RunnerSerenaStage): RunnerSerenaStage {
  return value === "preparing-uv" || value === "installing-serena" || value === "validating-serena" || value === "configuring-mcp"
    ? value
    : fallback;
}

function safeSerenaResult(
  action: RunnerAction,
  value: unknown,
  defaultOutcome: RunnerSerenaOutcome,
  defaultStage: RunnerSerenaStage,
): RunnerActionRunResult {
  if (!value || typeof value !== "object") {
    return {
      actionId: action.id,
      status: "failed",
      message: "Serena setup returned no safe result; configuration was not changed.",
      diagnostics: ["Serena setup failed before configuration."],
      serenaOutcome: "failed",
      serenaStage: defaultStage,
    };
  }
  const candidate = value as Record<string, unknown>;
  const status = candidate.status === "executed" || candidate.status === "informational" || candidate.status === "skipped" || candidate.status === "failed"
    ? candidate.status
    : "failed";
  const outcome = inferSerenaOutcome(candidate.serenaOutcome ?? candidate.outcome ?? (isObjectRecord(candidate.raw) ? candidate.raw.outcome : undefined), defaultOutcome);
  const stage = inferSerenaStage(candidate.serenaStage ?? candidate.stage, defaultStage);
  const message = sanitizeActionText(candidate.message) || "Serena setup completed.";
  const diagnostics = boundTuiDiagnostics(Array.isArray(candidate.diagnostics) ? candidate.diagnostics : []);
  return {
    actionId: action.id,
    status,
    message,
    diagnostics,
    serenaOutcome: outcome,
    serenaStage: stage,
  };
}

function serenaBlockedResult(action: RunnerAction, message: string, stage: RunnerSerenaStage = "preparing-uv"): RunnerActionRunResult {
  return {
    actionId: action.id,
    status: "failed",
    message: sanitizeActionText(message) || "Serena setup was blocked; configuration was not changed.",
    diagnostics: ["Serena setup is fail-closed until current-operation evidence is valid."],
    serenaOutcome: "failed",
    serenaStage: stage,
  };
}

function serenaCancelledResult(action: RunnerAction, stage: RunnerSerenaStage = "preparing-uv"): RunnerActionRunResult {
  return {
    actionId: action.id,
    status: "skipped",
    message: "Serena setup was cancelled; configuration was not changed.",
    diagnostics: [],
    serenaOutcome: "cancelled",
    serenaStage: stage,
  };
}

function planIsCurrentForSerena(plan: RunnerReviewPlan, state: RunnerDashboardState | undefined): boolean {
  if (!state) return true;
  if (!state.plan) return false;
  return state.plan === plan && state.planGeneratedForRevision === state.planRevision;
}

async function runSerenaAction(
  action: RunnerAction,
  dependencies: RunnerActionRunnerDependencies,
): Promise<RunnerActionRunResult> {
  const actionKind = serenaActionKind(action);
  if (!actionKind) return serenaBlockedResult(action, "Serena action kind is not supported.");

  const operationContext = getSerenaActionContext(dependencies);
  if ("error" in operationContext) return serenaBlockedResult(action, operationContext.error);
  if (dependencies.signal?.aborted) return serenaCancelledResult(action);

  const executionState = dependencies.serenaExecutionState;
  if (!executionState) {
    return serenaBlockedResult(action, "Serena operation evidence is unavailable; configuration was not changed.");
  }

  if (actionKind === "config") {
    if (!executionState.attempted || !executionState.succeeded || !["reused", "installed"].includes(executionState.outcome ?? "")) {
      return {
        actionId: action.id,
        status: "skipped",
        message: "Skipped Serena MCP configuration because Serena install failed or readiness was not confirmed.",
        diagnostics: ["Serena MCP configuration was not changed."],
        serenaOutcome: executionState.outcome ?? "failed",
        serenaStage: executionState.stage ?? "validating-serena",
      };
    }
    if (!dependencies.runnerAction && !dependencies.runnerAdapter && !executionState.readiness) {
      return serenaBlockedResult(action, "Serena readiness evidence is unavailable; configuration was not changed.", "validating-serena");
    }

    dependencies.onSerenaStage?.("configuring-mcp");
    const context: RunnerSerenaActionContext = {
      ...operationContext.context,
      serenaReadiness: executionState.readiness,
      onSerenaStage: dependencies.onSerenaStage,
    };

    const nativeExecutor = dependencies.runnerAction ?? dependencies.runnerAdapter?.runAction;
    if (nativeExecutor) {
      try {
        const nativeResult = await nativeExecutor(action, context);
        const result = safeSerenaResult(action, nativeResult, "installed", "configuring-mcp");
        executionState.stage = "configuring-mcp";
        return result;
      } catch {
        return serenaBlockedResult(action, "Serena MCP configuration was not changed.", "configuring-mcp");
      }
    }

    const writer = dependencies.writeMcpConfig;
    const readiness = executionState.readiness;
    if (!writer || !readiness || !validateSerenaReadinessEvidence(readiness).valid) {
      return serenaBlockedResult(action, "Serena readiness evidence is unavailable; configuration was not changed.", "validating-serena");
    }

    try {
      const result = await writer({
        serverName: "serena",
        type: "local",
        command: [readiness.resolvedExecutablePath, "start-mcp-server", "--context", "ide", "--project-from-cwd"],
      }, context);
      if (!result.ok) {
        return {
          actionId: action.id,
          status: "failed",
          message: "Serena MCP configuration was not changed.",
          diagnostics: boundTuiDiagnostics(result.diagnostics ?? []),
          serenaOutcome: "failed",
          serenaStage: "configuring-mcp",
        };
      }
      executionState.stage = "configuring-mcp";
      return {
        actionId: action.id,
        status: "executed",
        message: result.diagnostics?.[0] ? sanitizeActionText(result.diagnostics[0]) : "Serena MCP configuration updated.",
        diagnostics: [],
        serenaOutcome: executionState.outcome,
        serenaStage: "configuring-mcp",
      };
    } catch {
      return serenaBlockedResult(action, "Serena MCP configuration was not changed.", "configuring-mcp");
    }
  }

  executionState.attempted = true;
  dependencies.onSerenaStage?.("preparing-uv");

  const nativeExecutor = dependencies.runnerAction ?? dependencies.runnerAdapter?.runAction;
  let result: RunnerActionRunResult;
  if (nativeExecutor) {
    try {
      const nativeValue = await nativeExecutor(action, operationContext.context);
      if (isObjectRecord(nativeValue) && nativeValue.serenaReadiness && validateSerenaReadinessEvidence(nativeValue.serenaReadiness).valid) {
        executionState.readiness = nativeValue.serenaReadiness as SerenaReadinessEvidence;
      }
      result = safeSerenaResult(action, nativeValue, "failed", "preparing-uv");
    } catch {
      result = serenaBlockedResult(action, "Serena setup failed before readiness could be established.");
    }
  } else {
    result = await runPackageInstall(action, dependencies);
  }

  const outcome = result.serenaOutcome ?? (
    result.status === "executed"
      ? result.packageOutcome === "already-present" ? "reused" : "installed"
      : result.status === "skipped"
        ? /cancel/i.test(result.message) ? "cancelled" : "failed"
        : "failed"
  );
  executionState.outcome = outcome;
  executionState.stage = result.serenaStage ?? executionState.stage ?? "validating-serena";
  executionState.succeeded = outcome === "reused" || outcome === "installed";
  if (!executionState.succeeded) executionState.readiness = undefined;
  return {
    ...result,
    serenaOutcome: outcome,
    serenaStage: executionState.stage,
  };
}

export async function runRunnerReviewPlan(
  plan: RunnerReviewPlan,
  dependencies: RunnerActionRunnerDependencies = {},
): Promise<RunnerActionRunResult[]> {
  log(`runRunnerReviewPlan: START`);
  log(`runRunnerReviewPlan: configWrites=${plan.groups.configWrites.length} automaticInstalls=${plan.groups.automaticInstalls.length} manualSteps=${plan.groups.manualSteps.length} teamApplications=${plan.groups.teamApplications.length} validations=${plan.groups.validations.length}`);
  log(`runRunnerReviewPlan: has installPackages=${!!dependencies.installPackages} has writeMcpConfig=${!!dependencies.writeMcpConfig} has installTeamBundle=${!!dependencies.installTeamBundle} has validateMcpConfig=${!!dependencies.validateMcpConfig}`);

  const runBlockDiagnostics = getRunnerReviewPlanRunBlockDiagnostics(dependencies.dashboardState, {
    supermemoryToken: dependencies.supermemoryToken,
    secretStore: dependencies.secretStore,
  });
  if (runBlockDiagnostics.length > 0) {
    const blockedResult: RunnerActionRunResult = {
      actionId: "review-plan.preflight",
      status: "failed",
      message: "Review & Install is blocked until Supermemory setup is complete.",
      diagnostics: runBlockDiagnostics,
    };
    dependencies.onActionResult?.(blockedResult);
    return [blockedResult];
  }

  const reviewedPlanBlocker = getReviewedPlanExecutionBlocker(plan, dependencies);
  if (reviewedPlanBlocker) {
    const blockedResult: RunnerActionRunResult = {
      actionId: "review-plan.preflight",
      status: "failed",
      message: "Review & Install is blocked before any action can run.",
      diagnostics: [reviewedPlanBlocker],
    };
    dependencies.onActionResult?.(blockedResult);
    return [blockedResult];
  }

  const results: RunnerActionRunResult[] = [];
  const unsatisfiedInstallCapabilities = new Set<string>();
  const satisfiedInstallCapabilities = new Set<string>();
  const serenaExecutionState = dependencies.serenaExecutionState ?? {
    attempted: false,
    succeeded: false,
  } satisfies RunnerSerenaExecutionState;
  const planDependencies: RunnerActionRunnerDependencies = {
    ...dependencies,
    serenaExecutionState,
    serenaPlanValid: planIsCurrentForSerena(plan, dependencies.dashboardState),
  };

  const runAndRecord = async (action: RunnerAction, deps: RunnerActionRunnerDependencies = planDependencies) => {
    const result = await runRunnerAction(action, deps);
    results.push(result);
    dependencies.onActionResult?.(result);
    return result;
  };

  for (const action of [...plan.groups.automaticInstalls, ...plan.groups.manualSteps]) {
    if (dependencies.signal?.aborted) return results;
    log(`runRunnerReviewPlan: install/manual ${action.id} kind=${action.kind} status=${action.status}`);
    const result = await runAndRecord(action);
    log(`runRunnerReviewPlan: install/manual ${action.id} result=${result.status} msg=${result.message?.substring(0, 100)}`);
    if (dependencies.signal?.aborted) return results;

    if (isUnsatisfiedInstallResult(action, result)) {
      const parts = action.id.split(".");
      if (parts.length >= 2) unsatisfiedInstallCapabilities.add(`${parts[0]}.${parts[1]}`);
    } else if (result.packageOutcome && isSatisfiedPackageOutcome(result.packageOutcome) && dependencies.dashboardState?.runnerScope !== "pi") {
      const parts = action.id.split(".");
      if (parts.length >= 2) satisfiedInstallCapabilities.add(`${parts[0]}.${parts[1]}`);
    }
  }

  log(`runRunnerReviewPlan: processing ${plan.groups.configWrites.length} configWrites`);
  for (const action of plan.groups.configWrites) {
    if (dependencies.signal?.aborted) return results;
    if (action.capabilityId === "serena" && serenaActionKind(action) === "config" && !serenaExecutionState.attempted) {
      const runner = planDependencies.runnerId ?? planDependencies.dashboardState?.runnerScope;
      const installAction: RunnerAction = {
        id: "capability.serena.install",
        kind: runner === "pi" ? "install-pi-package" : "install-opencode-plugin",
        title: "Validate Serena readiness",
        capabilityId: "serena",
        toolId: "serena",
        source: "serena-agent",
        status: "ready",
      };
      await runAndRecord(installAction);
    }

    if (action.kind === "write-mcp-config" || action.kind === "write-pi-mcp-config") {
      log(`runRunnerReviewPlan: configWrite action ${action.id} kind=${action.kind} capabilityId=${action.capabilityId}`);
      const capabilityPrefix = action.id.replace(".mcp-config", "");

      if (action.capabilityId !== "serena" && unsatisfiedInstallCapabilities.has(capabilityPrefix)) {
        const skippedResult: RunnerActionRunResult = {
          actionId: action.id,
          status: "skipped",
          message: `Skipped MCP config for '${capabilityPrefix}': install failed.`,
          diagnostics: [`Dependency ${capabilityPrefix}.install reported failure.`],
        };
        results.push(skippedResult);
        dependencies.onActionResult?.(skippedResult);
        log(`runRunnerReviewPlan: configWrite ${action.id} SKIPPED (install unsatisfied)`);
        continue;
      }

      const capabilityId = action.capabilityId as string | undefined;
      if (capabilityId && capabilityId !== "context7" && capabilityId !== "serena") {
        const executableName = capabilityId === "serena" ? "serena"
          : capabilityId === "rtk" ? "rtk"
          : capabilityId === "codebase-memory-mcp" ? "codebase-memory-mcp"
          : capabilityId === "context-mode" ? "context-mode"
          : null;

        if (executableName && !satisfiedInstallCapabilities.has(capabilityPrefix) && !checkExecutableExists(executableName)) {
          const failedResult: RunnerActionRunResult = {
            actionId: action.id,
            status: "failed",
            message: `Cannot write MCP config for '${capabilityId}': executable '${executableName}' not found on PATH.`,
            diagnostics: [`Binary '${executableName}' not found in PATH.`],
          };
          results.push(failedResult);
          dependencies.onActionResult?.(failedResult);
          log(`runRunnerReviewPlan: configWrite ${action.id} FAILED (executable not found)`);
          continue;
        }
      }
    }

    log(`runRunnerReviewPlan: configWrite ${action.id} kind=${action.kind} status=${action.status}`);
    await runAndRecord(action);
  }

  const memoryResolution = resolveMemoryProviderAfterConfigWrite(dependencies);
  if (memoryResolution.blocker) {
    results.push(memoryResolution.blocker);
    dependencies.onActionResult?.(memoryResolution.blocker);
    return results;
  }

  const teamDependencies = {
    ...dependencies,
    resolvedMemoryProvider: memoryResolution.provider,
  };

  for (const action of plan.groups.teamApplications) {
    if (dependencies.signal?.aborted) return results;
    log(`runRunnerReviewPlan: team ${action.id} kind=${action.kind}`);
    const result = await runAndRecord(action, teamDependencies);
    log(`runRunnerReviewPlan: team ${action.id} done`);
  }

  for (const action of plan.groups.validations) {
    if (dependencies.signal?.aborted) return results;
    log(`runRunnerReviewPlan: validation ${action.id} kind=${action.kind}`);
    await runAndRecord(action);
    log(`runRunnerReviewPlan: validation ${action.id} done`);
  }

  log(`runRunnerReviewPlan: COMPLETE. total results=${results.length}`);
  return results;
}

export async function runRunnerAction(
  action: RunnerAction,
  dependencies: RunnerActionRunnerDependencies = {},
): Promise<RunnerActionRunResult> {
  log(`runRunnerAction: ${action.id} kind=${action.kind} status=${action.status}`);

  if (dependencies.signal?.aborted) {
    return {
      actionId: action.id,
      status: "skipped",
      message: "Action cancelled before execution; no external effect was started.",
      diagnostics: [],
      ...(action.capabilityId === "serena" ? {
        serenaOutcome: "cancelled" as const,
        serenaStage: "preparing-uv" as const,
      } : {}),
    };
  }

  if (action.status === "blocked" || action.status === "pending" || action.kind === "pending-source" || action.kind === "noop") {
    return informationalResult(action, action.status === "blocked" ? "Blocked action requires follow-up before execution." : "Pending/no-op action recorded without execution.");
  }

  if (action.capabilityId === "serena") {
    try {
      return await runSerenaAction(action, dependencies);
    } catch {
      return serenaBlockedResult(action, "Serena setup failed before configuration could be changed.");
    }
  }

  if (action.kind === "manual-external-install") {
    return informationalResult(action, "Manual external install required; no command was executed.");
  }

  try {
    switch (action.kind) {
      case "install-pi-package":
      case "install-opencode-plugin":
      case "npm-install":
        return await runPackageInstall(action, dependencies);
      case "write-deck-config":
        return writeDeckConfigAction(action, dependencies);
      case "write-pi-mcp-config":
      case "write-mcp-config":
        return await writeMcpConfigAction(action, dependencies);
      case "apply-team-bundle":
        return await applyTeamBundleAction(action, dependencies);
      case "validate":
        return await validateAction(action, dependencies);
      default:
        log(`runRunnerAction: UNKNOWN KIND "${action.kind}" for ${action.id} — returning informational`);
        return informationalResult(action, "Action kind is informational for the dashboard runner.");
    }
  } catch (error) {
    return {
      actionId: action.id,
      status: "failed",
      message: redact(error instanceof Error ? error.message : String(error)),
      diagnostics: redactDiagnostics(action.diagnostics ?? []),
    };
  }
}

function sanitizePackageCallbackResult(value: RunnerPackageInstallResult): RunnerPackageInstallResult {
  const diagnostic = value.diagnostic;
  const safeLines = boundTuiDiagnostics(diagnostic?.lines ?? (value.cause ? [value.cause] : []));
  return {
    id: typeof value.id === "string" ? value.id : "",
    outcome: isRunnerPackageOutcome(value.outcome) ? value.outcome : "failed",
    success: value.success === true,
    message: sanitizeActionText(value.message) || "Package install completed.",
    ...(typeof value.installerInvoked === "boolean" ? { installerInvoked: value.installerInvoked } : {}),
    ...(value.cause ? { cause: boundTuiCause([value.cause]) } : {}),
    ...(value.serenaBootstrapOutcome ? { serenaBootstrapOutcome: value.serenaBootstrapOutcome } : {}),
    ...(value.serenaStage ? { serenaStage: value.serenaStage } : {}),
    ...(diagnostic ? {
      diagnostic: {
        stage: sanitizeActionText(diagnostic.stage),
        code: sanitizeActionText(diagnostic.code),
        ...(diagnostic.exitCode === undefined ? {} : { exitCode: diagnostic.exitCode }),
        lines: safeLines,
      },
    } : {}),
  };
}

async function runPackageInstall(
  action: RunnerAction,
  dependencies: RunnerActionRunnerDependencies,
): Promise<RunnerActionRunResult> {
  if (action.internalPackageId) {
    // Internal package — handled by the adapter's installer
    return await runInternalPackageInstall(action, dependencies);
  }

  if (!dependencies.runnerCommand && action.capabilityId !== "serena") {
    return skippedResult(action, "Runner command is required to install packages; run preflight or provide dependencies.runnerCommand before installation.");
  }

  const packageId = action.toolId ?? action.id;
  const packageName = action.source ?? action.toolId ?? action.id;
  const runner = dependencies.installPackages;
  if (!runner) {
    return skippedResult(action, "Package installer not provided; install requires adapter-specific package installer.");
  }

  const packages = [{ id: packageId, name: packageName, source: action.source ?? "" }];
  const serenaContext = action.capabilityId === "serena"
    ? (() => {
        const context = getSerenaActionContext(dependencies);
        return "context" in context ? context.context : undefined;
      })()
    : undefined;
  const installResults = await runner(
    dependencies.runnerCommand,
    packages,
    (result) => dependencies.onInstallResult?.(sanitizePackageCallbackResult(result)),
    serenaContext,
  );

  if (action.capabilityId === "serena" && dependencies.serenaExecutionState) {
    const candidate = installResults.find((result) => result?.id === packageId);
    if (candidate?.serenaReadiness && validateSerenaReadinessEvidence(candidate.serenaReadiness).valid) {
      dependencies.serenaExecutionState.readiness = candidate.serenaReadiness;
    } else if (candidate?.serenaReadiness !== undefined) {
      dependencies.serenaExecutionState.readiness = undefined;
    }
    if (candidate?.serenaBootstrapOutcome) dependencies.serenaExecutionState.outcome = candidate.serenaBootstrapOutcome;
    if (candidate?.serenaStage) dependencies.serenaExecutionState.stage = candidate.serenaStage;
  }

  return projectPackageInstallResults(action, packages, installResults);
}

async function runInternalPackageInstall(
  action: RunnerAction,
  dependencies: RunnerActionRunnerDependencies,
): Promise<RunnerActionRunResult> {
  const packageName = action.internalPackageId ?? action.id;
  const packageId = action.toolId ?? action.id;

  // Primary: use installInternalRunnerPackages if provided
  if (dependencies.installInternalRunnerPackages) {
    const runner = dependencies.installInternalRunnerPackages;
    const installActions = [{ packageId: packageName, name: packageName, source: action.source ?? "", installKind: "pi-package", reason: action.title }];

    const installResults = await runner(
      dependencies.piCommand,
      installActions,
      (result) => {
        dependencies.onActionResult?.({
          actionId: action.id,
          status: result.success ? "executed" : "failed",
          message: result.success ? `Installed ${packageName}.` : `Failed to install ${packageName}.`,
          diagnostics: result.message ? redactDiagnostics([result.message]) : [],
          raw: redactRaw(result),
        });
      },
    );

    const result = installResults[0];
    if (!result) {
      return {
        actionId: action.id,
        status: "failed",
        message: "Internal package installer returned no result.",
        diagnostics: redactDiagnostics(action.diagnostics ?? []),
      };
    }

    // Use action.title for human-readable messages (e.g. "Install visual explanation support")
    const title = action.title;
    // Strip "Install " prefix for display (e.g. "visual explanation support")
    const displayName = title.replace(/^install\s+/i, "");
    // Capitalize first letter for display (e.g. "Visual explanation support")
    const displayNameCapitalized = displayName.charAt(0).toUpperCase() + displayName.slice(1);

    return {
      actionId: action.id,
      status: result.success ? "executed" : "failed",
      message: result.success ? `Installed ${displayName}.` : `${displayNameCapitalized} install failed.`,
      diagnostics: result.message ? redactDiagnostics([result.message]) : [],
      raw: redactRaw(result),
    };
  }

  // Fallback: use installPackages if provided (backward compatibility)
  const runner = dependencies.installPackages;
  if (!runner) {
    return skippedResult(action, "Internal package installer not provided.");
  }

  const installResults = await runner(
    dependencies.runnerCommand,
    [{ id: packageId, name: packageName, source: action.source ?? "" }],
    (result) => {
      const displayName = action.title.replace(/^install\s+/i, "");
      const displayNameCapitalized = displayName.charAt(0).toUpperCase() + displayName.slice(1);
      dependencies.onActionResult?.({
        actionId: action.id,
        status: result.success ? "executed" : "failed",
        message: result.success ? `Installed ${displayName}.` : `${displayNameCapitalized} install failed.`,
        diagnostics: result.message ? redactDiagnostics([result.message]) : [],
        raw: redactRaw(result),
      });
    },
  );

  const result = installResults[0];
  if (!result) {
    return {
      actionId: action.id,
      status: "failed",
      message: "Internal package installer returned no result.",
      diagnostics: redactDiagnostics(action.diagnostics ?? []),
    };
  }

  return {
    actionId: action.id,
    status: result.success ? "executed" : "failed",
    message: result.success ? `Installed ${action.title.replace(/^install\s+/i, "")}.` : `${action.title.replace(/^install\s+/i, "").charAt(0).toUpperCase() + action.title.replace(/^install\s+/i, "").slice(1)} install failed.`,
    diagnostics: result.message ? redactDiagnostics([result.message]) : [],
    raw: redactRaw(result),
  };
}

function writeDeckConfigAction(
  action: RunnerAction,
  dependencies: RunnerActionRunnerDependencies,
): RunnerActionRunResult {
  const projectRoot = dependencies.projectRoot;
  if (!projectRoot) {
    return skippedResult(action, "Project root is required to update global Deck preferences.");
  }

  const state = dependencies.dashboardState;
  if (!state) {
    return skippedResult(action, "Dashboard state is required to update global Deck preferences.");
  }
  const provider = state.adaptiveMemory.provider ?? "none";

  const store = dependencies.configStore;
  if (!store && !dependencies.writeDeckConfig) return skippedResult(action, "Global Deck config store is required to update Deck preferences.");

  // Preserve every registered runner's config and update only the active runner.
  const currentRunner = state?.runnerScope && state.runnerScope !== "all" ? state.runnerScope : "pi";
  const currentPackageInstructions = normalizeSupportedPackageInstructionSelection(
    state.packageInstructions,
    dependencies.packageInstructionIds ?? PACKAGE_INSTRUCTION_PACKAGE_IDS,
  );
  const selectedWebSearch = state.selectedCapabilities["web-search"];
  const buildConfig = (current: NormalizedDeckConfig): NormalizedDeckConfig => {
    const webSearchEnabled = selectedWebSearch === undefined
      ? current.webSearch.enabled
      : selectedWebSearch === true;
    const webSearchProvider = state.webSearchProvider ?? current.webSearch.provider;
    return {
      ...current,
      adaptiveMemory: provider === "supermemory"
        ? {
            enabled: true,
            activeProvider: "supermemory" as const,
            supermemory: current.adaptiveMemory.supermemory ?? {},
          }
        : { enabled: false, activeProvider: "none" as const },
      webSearch: {
        enabled: webSearchEnabled,
        ...(webSearchProvider ? { provider: webSearchProvider } : {}),
      },
      packageInstructions: {
        ...current.packageInstructions,
        [currentRunner]: {
          ...currentPackageInstructions,
        },
      },
    };
  };

  const config = store ? store.patch(buildConfig) : buildConfig(validateDeckConfig({}));
  if (dependencies.writeDeckConfig) dependencies.writeDeckConfig(projectRoot, config);

  return {
    actionId: action.id,
    status: "executed",
    message: `Updated global Deck preferences with adaptive memory provider: ${provider}.`,
    diagnostics: redactDiagnostics(action.diagnostics ?? []),
    raw: redactRaw(config),
  };
}

async function writeMcpConfigAction(
  action: RunnerAction,
  dependencies: RunnerActionRunnerDependencies,
): Promise<RunnerActionRunResult> {
  // Support both generic writeMcpConfig and Pi-specific writeSupermemoryPiMcpConfig (backward compat)
  let writer = dependencies.writeMcpConfig;
  if (!writer && dependencies.writeSupermemoryPiMcpConfig) {
    // Adapt Pi-specific writer to generic interface for write-pi-mcp-config actions
    writer = async (options) => {
      // Supermemory bearer credentials are stored in the Deck secret store, not in runner MCP config.
      if (options.token) {
        return dependencies.writeSupermemoryPiMcpConfig!({ serverName: "supermemory" });
      }
      // For local MCP servers, call with the server config
      return dependencies.writeSupermemoryPiMcpConfig!(options);
    };
  }
  if (!writer) {
    return skippedResult(action, "MCP config writer not provided; requires adapter-specific implementation.");
  }

  // Determine the MCP server type based on capabilityId
  const capabilityId = action.capabilityId as string | undefined;

  if (capabilityId === "web-search") {
    if (!dependencies.writeMcpConfig) {
      return {
        actionId: action.id,
        status: "failed",
        message: "Web Search requires a provider-aware MCP writer; no MCP write was attempted.",
        diagnostics: ["Provider-aware Web Search MCP writer is unavailable."],
      };
    }
    const provider = dependencies.webSearchProvider;
    if (!provider) {
      return {
        actionId: action.id,
        status: "failed",
        message: "Web Search provider selection is unavailable; no MCP write was attempted.",
        diagnostics: ["Web Search provider selection is unavailable."],
      };
    }
    const result = await writer({
      serverName: provider.semanticServerId,
      type: "local",
      command: [...provider.command],
      webSearchProvider: provider,
    });
    if (!result.ok) {
      return {
        actionId: action.id,
        status: "failed",
        message: `Web Search MCP config write failed at ${result.path ?? "unknown path"}.`,
        diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...(result.diagnostics ?? [])]),
      };
    }
    return {
      actionId: action.id,
      status: "executed",
      message: `Web Search MCP config written successfully at ${result.path}.`,
      diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...(result.diagnostics ?? [])]),
    };
  }

  if (capabilityId === "context7") {
    // Context7 is a local MCP server
    const result = await writer({
      serverName: "context7",
      type: "local",
      command: ["npx", "-y", "@upstash/context7-mcp"],
    });
    if (!result.ok) {
      return {
        actionId: action.id,
        status: "failed",
        message: `MCP config write failed at ${result.path ?? "unknown path"}.`,
        diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...(result.diagnostics ?? [])]),
      };
    }
    return {
      actionId: action.id,
      status: "executed",
      message: `Context7 MCP config written successfully at ${result.path}.`,
      diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...(result.diagnostics ?? [])]),
    };
  }

  if (capabilityId === "serena") {
    // Serena is a local MCP server
    const result = await writer({
      serverName: "serena",
      type: "local",
      command: ["serena", "start-mcp-server", "--context", "ide", "--project-from-cwd"],
    });
    if (!result.ok) {
      return {
        actionId: action.id,
        status: "failed",
        message: `MCP config write failed at ${result.path ?? "unknown path"}.`,
        diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...(result.diagnostics ?? [])]),
      };
    }
    return {
      actionId: action.id,
      status: "executed",
      message: `Serena MCP config written successfully at ${result.path}.`,
      diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...(result.diagnostics ?? [])]),
    };
  }

  if (capabilityId === "context-mode") {
    // context-mode is a local MCP server (npm global install)
    const result = await writer({
      serverName: "context-mode",
      type: "local",
      command: ["context-mode"],
    });
    if (!result.ok) {
      return {
        actionId: action.id,
        status: "failed",
        message: `MCP config write failed at ${result.path ?? "unknown path"}.`,
        diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...(result.diagnostics ?? [])]),
      };
    }
    return {
      actionId: action.id,
      status: "executed",
      message: `context-mode MCP config written successfully at ${result.path}.`,
      diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...(result.diagnostics ?? [])]),
    };
  }

  if (capabilityId === "rtk") {
    // RTK is a local MCP server
    const result = await writer({
      serverName: "rtk",
      type: "local",
      command: ["rtk", "mcp", "start"],
    });
    if (!result.ok) {
      return {
        actionId: action.id,
        status: "failed",
        message: `MCP config write failed at ${result.path ?? "unknown path"}.`,
        diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...(result.diagnostics ?? [])]),
      };
    }
    return {
      actionId: action.id,
      status: "executed",
      message: `RTK MCP config written successfully at ${result.path}.`,
      diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...(result.diagnostics ?? [])]),
    };
  }

  if (capabilityId === "codebase-memory" || capabilityId === "codebase-memory-mcp") {
    // codebase-memory-mcp is a local MCP server. Uses canonical serverName from adapter-pi.
    const result = await writer({
      serverName: CODEBASE_MEMORY_MCP_SERVER_NAME,
      type: "local",
      command: ["codebase-memory-mcp"],
    });
    if (!result.ok) {
      return {
        actionId: action.id,
        status: "failed",
        message: `MCP config write failed at ${result.path ?? "unknown path"}.`,
        diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...(result.diagnostics ?? [])]),
      };
    }
    return {
      actionId: action.id,
      status: "executed",
      message: `codebase-memory MCP config written successfully at ${result.path}.`,
      diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...(result.diagnostics ?? [])]),
    };
  }

  // Default: Supermemory remote MCP. Runtime credentials are stored in Deck's
  // secret store after validation; runner MCP config must not persist API keys.
  const nativeOAuth = !runnerRequiresExternalSupermemoryToken(dependencies.dashboardState);

  const result = await writer({
    serverName: "supermemory",
    projectRoot: dependencies.projectRoot,
  });
  const safeResultDiagnostics = (result.diagnostics ?? []).filter((diagnostic) => !/x-supermemory-api-key|authorization|bearer|token/i.test(String(diagnostic)));
  if (!result.ok) {
    return {
      actionId: action.id,
      status: "failed",
      message: `MCP config write failed at ${result.path ?? "unknown path"}.`,
      diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...safeResultDiagnostics]),
      raw: redactRaw(result),
    };
  }

  return {
    actionId: action.id,
    status: "executed",
    message: nativeOAuth
      ? `Supermemory MCP config written successfully at ${result.path}. Optional runner OAuth is separate from Deck runtime credentials.`
      : `Supermemory MCP config written successfully at ${result.path}; if the runner MCP server requires auth, complete that runner-native step separately. Deck did not copy the API key.`,
    diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...safeResultDiagnostics]),
    raw: redactRaw(result),
  };
}

async function applyTeamBundleAction(
  action: RunnerAction,
  dependencies: RunnerActionRunnerDependencies,
): Promise<RunnerActionRunResult> {
  const projectRoot = dependencies.projectRoot;
  if (!projectRoot) {
    return skippedResult(action, "Project root is required to apply team bundle.");
  }

  const installer = dependencies.installTeamBundle;
  if (!installer) {
    return skippedResult(action, "Team bundle installer not provided; requires adapter-specific implementation.");
  }

  const memoryProvider = dependencies.resolvedMemoryProvider ?? dependencies.memoryProvider;
  const developerTeam = dependencies.dashboardState?.teams?.["developer-team"];
  const modelAssignments = developerTeam?.modelAssignments as DeveloperTeamModelAssignments | undefined;
  const thinkingAssignments = developerTeam?.thinkingAssignments as DeveloperTeamThinkingAssignments | undefined;

  log(`applyTeamBundleAction: developerTeam.selected=${developerTeam?.selected} hasModelAssignments=${!!modelAssignments} modelKeys=${modelAssignments ? Object.keys(modelAssignments).join(",") : "none"} hasThinkingAssignments=${!!thinkingAssignments}`);

  const installerOptions: {
    memoryProvider?: AdaptiveMemoryProvider;
    modelAssignments?: DeveloperTeamModelAssignments;
    thinkingAssignments?: DeveloperTeamThinkingAssignments;
    capabilityIds?: readonly string[];
  } = {};
  if (memoryProvider) installerOptions.memoryProvider = memoryProvider;
  if (modelAssignments) installerOptions.modelAssignments = modelAssignments;
  if (thinkingAssignments) installerOptions.thinkingAssignments = thinkingAssignments;
  installerOptions.capabilityIds = Object.entries(dependencies.dashboardState?.selectedCapabilities ?? {}).filter(([, enabled]) => enabled).map(([id]) => id);

  const installerResult = await installer(projectRoot, Object.keys(installerOptions).length > 0 ? installerOptions : undefined);

  const count = installerResult.results.length;

  return {
    actionId: action.id,
    status: "executed",
    message: `Developer Team bundle installed: ${count} agent(s).`,
    diagnostics: redactDiagnostics(action.diagnostics ?? []),
    raw: redactRaw(installerResult),
    ...(installerResult.verificationEvidence?.length ? { verificationEvidence: installerResult.verificationEvidence } : {}),
    ...(installerResult.postInstallFollowUps?.length ? { postInstallFollowUps: installerResult.postInstallFollowUps } : {}),
  };
}

export async function validateAndStoreSupermemoryRuntimeCredential(options: {
  token?: string;
  projectRoot?: string;
  projectScope?: string;
  secretStore?: DeckSecretStore;
  validateSupermemoryReadOnlyApi?: SupermemoryReadOnlyApiValidatorFn;
  diagnostics?: string[];
}): Promise<{ ok: true; diagnostics: string[] } | { ok: false; message: string; diagnostics: string[] }> {
  const diagnostics = redactDiagnostics(options.diagnostics ?? []);
  const token = options.token?.trim() || options.secretStore?.read("supermemory-api-key")?.trim();
  if (!token) {
    return {
      ok: false,
      message: "Supermemory runtime API key is required for Deck runtime validation; runner-native MCP OAuth does not make Deck runtime-ready.",
      diagnostics,
    };
  }

  if (!options.validateSupermemoryReadOnlyApi) {
    return {
      ok: false,
      message: "Supermemory runtime credential could not be validated with a read-only API check; setup is not runtime-ready.",
      diagnostics,
    };
  }

  const apiValidation = await options.validateSupermemoryReadOnlyApi({ apiKey: token, projectRoot: options.projectRoot });
  if (!apiValidation.ok) {
    return {
      ok: false,
      message: "Supermemory read-only API validation failed; credential was not stored and setup is not runtime-ready.",
      diagnostics: redactDiagnostics([...diagnostics, ...(apiValidation.diagnostics ?? [])]),
    };
  }

  diagnostics.push("Supermemory runtime API credential validated with a read-only API check.");
  if (!options.secretStore) {
    return {
      ok: false,
      message: "Deck secret store is unavailable; Supermemory setup is not runtime-ready.",
      diagnostics,
    };
  }

  try {
    options.secretStore.write("supermemory-api-key", token);
    diagnostics.push("Supermemory runtime API credential stored in the Deck secret store.");
    return { ok: true, diagnostics };
  } catch (error) {
    return {
      ok: false,
      message: "Supermemory runtime credential could not be stored; setup is not runtime-ready.",
      diagnostics: [...diagnostics, redact(error instanceof Error ? error.message : String(error))],
    };
  }
}

async function validateAction(
  action: RunnerAction,
  dependencies: RunnerActionRunnerDependencies,
): Promise<RunnerActionRunResult> {
  if (action.id === "adaptive-memory.supermemory.validate") {
    let validator = dependencies.validateMcpConfig;
    if (!validator && dependencies.validateSupermemoryPiMcpConfig) {
      // Backward-compatible Pi-specific validator alias
      validator = dependencies.validateSupermemoryPiMcpConfig;
    }
    if (!validator) {
      return skippedResult(action, "MCP config validator not provided.");
    }

    const result = validator({ serverName: "supermemory" });
    const redactedRaw = redactRaw(result);
    if (!result.ok) {
      return {
        actionId: action.id,
        status: "failed",
        message: "Supermemory MCP config validation failed. MCP authentication must be completed through the runner-native flow; Deck does not copy API keys into runner MCP config.",
        diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...((redactedRaw as { diagnostics?: Array<string | { message?: string; code?: string; severity?: string }> })?.diagnostics ?? [])]),
        raw: redactedRaw,
      };
    }

    const runtimeValidation = await validateAndStoreSupermemoryRuntimeCredential({
      token: dependencies.supermemoryToken,
      projectRoot: dependencies.projectRoot,
      secretStore: dependencies.secretStore,
      validateSupermemoryReadOnlyApi: dependencies.validateSupermemoryReadOnlyApi,
      diagnostics: action.diagnostics,
    });
    if (!runtimeValidation.ok) {
      return {
        actionId: action.id,
        status: "failed",
        message: runtimeValidation.message,
        diagnostics: runtimeValidation.diagnostics,
        raw: redactedRaw,
      };
    }

    const nativeOAuth = !runnerRequiresExternalSupermemoryToken(dependencies.dashboardState);
    return {
      actionId: action.id,
      status: "executed",
      message: nativeOAuth
        ? "Supermemory MCP config validated successfully. Optional runner OAuth is separate; Deck runtime API credential was validated and stored."
        : "Supermemory MCP config validated successfully. Deck runtime API credential was validated and stored; runner MCP authentication remains separate.",
      diagnostics: runtimeValidation.diagnostics,
      raw: redactedRaw,
    };
  }

  return informationalResult(action, "Validation action is informational.");
}

function resolveMemoryProviderAfterConfigWrite(
  dependencies: RunnerActionRunnerDependencies,
): { provider?: AdaptiveMemoryProvider; blocker?: RunnerActionRunResult } {
  const state = dependencies.dashboardState;
  if (!state || state.adaptiveMemory.provider === "none") {
    return { provider: undefined };
  }

  if (state.adaptiveMemory.provider === "supermemory") {
    const setup = state.adaptiveMemory.supermemory;
    if (!setup?.configured) {
      return {
        blocker: {
          actionId: "adaptive-memory.supermemory.resolve",
          status: "failed",
          message: "Supermemory configuration is required before team bundle installation.",
          diagnostics: ["Supermemory setup is incomplete."],
        },
      };
    }
  }

  const resolver = dependencies.resolveAdaptiveMemoryProvider;
  if (!resolver) {
    return { provider: dependencies.memoryProvider };
  }

  try {
    const resolved = resolver({
      provider: state.adaptiveMemory.provider,
      supermemoryToken: dependencies.supermemoryToken,
      projectRoot: dependencies.projectRoot,
    });
    return { provider: resolved };
  } catch (error) {
    return {
      blocker: {
        actionId: "adaptive-memory.resolve",
        status: "failed",
        message: `Failed to resolve adaptive memory provider: ${error instanceof Error ? error.message : String(error)}`,
        diagnostics: [],
      },
    };
  }
}

function informationalResult(action: RunnerAction, message: string): RunnerActionRunResult {
  return {
    actionId: action.id,
    status: "informational",
    message,
    diagnostics: redactDiagnostics(action.diagnostics ?? []),
  };
}

function skippedResult(action: RunnerAction, message: string): RunnerActionRunResult {
  return {
    actionId: action.id,
    status: "skipped",
    message,
    diagnostics: redactDiagnostics(action.diagnostics ?? []),
  };
}

function isBlockingSetupDiagnostic(diagnostic: string): boolean {
  const lower = diagnostic.toLowerCase();
  if (lower.includes("required") || lower.includes("blocked") || lower.includes("failed")) return true;
  // Security: any diagnostic mentioning a token sentinel (raw or redacted) is blocking.
  // Token sentinel patterns: sk-{20+ alphanum/- } and [REDACTED]/[redacted].
  if (/\bsk-[a-zA-Z0-9-]{20,}\b/.test(diagnostic)) return true;
  if (/\[REDACTED\]/i.test(diagnostic)) return true;
  return false;
}

function redactDiagnostics(diagnostics: Array<string | { message?: string; code?: string; severity?: string }>): string[] {
  return diagnostics.map((d) => {
    if (typeof d === "string") return redact(d);
    // Handle diagnostic objects with message/code/severity fields
    if (d && typeof d === "object") {
      const obj = d as Record<string, unknown>;
      const message = obj["message"];
      const redactedMessage = typeof message === "string" ? redact(message) : "[REDACTED]";
      return JSON.stringify({ ...obj, message: redactedMessage });
    }
    return redact(String(d));
  });
}

function redact(value: unknown): string {
  const str = typeof value === "string" ? value : String(value);
  return str
    .replace(/(x-supermemory-api-key\s*:\s*)[^\s,;\"]+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;\"]+/gi, "$1[REDACTED]")
    .replace(/sk-[a-zA-Z0-9-]{20,}/g, "[REDACTED]")
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, "[REDACTED]");
}

function redactRaw(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactRaw);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactRaw(val);
    }
    return result;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases for Pi-specific tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cross-platform executable lookup
// ---------------------------------------------------------------------------

/**
 * Check if an executable exists on the system PATH.
 * Works cross-platform (Windows, Linux, macOS) without relying on `which`.
 */
function checkExecutableExists(executableName: string): boolean {
  const pathEnv = process.env.PATH;
  if (!pathEnv) return false;

  // Add .exe extension on Windows
  const isWindows = process.platform === "win32";
  const names = isWindows 
    ? [executableName, `${executableName}.exe`, `${executableName}.cmd`, `${executableName}.bat`]
    : [executableName];

  const pathDirs = pathEnv.split(isWindows ? ";" : ":");

  for (const dir of pathDirs) {
    if (!dir) continue;
    const resolvedDir = pathResolve(dir);
    
    // Check if directory exists
    let dirEntries: string[] = [];
    try {
      if (existsSync(resolvedDir)) {
        dirEntries = readdirSync(resolvedDir);
      }
    } catch {
      continue; // Skip directories we can't read
    }

    for (const name of names) {
      if (dirEntries.includes(name)) {
        const fullPath = pathResolve(resolvedDir, name);
        // Verify it's actually a file (not a directory with same name)
        try {
          const stat = statSync(fullPath);
          if (stat.isFile()) {
            return true;
          }
        } catch {
          // stat failed, skip
        }
      }
    }
  }

  return false;
}
export const getPiRunnerReviewPlanRunBlockDiagnostics = getRunnerReviewPlanRunBlockDiagnostics;
export const runPiRunnerAction = runRunnerAction;
export const runPiRunnerReviewPlan = runRunnerReviewPlan;
export type PiRunnerActionRunStatus = RunnerActionRunStatus;
export type PiRunnerActionRunResult = RunnerActionRunResult;
export type PiRunnerActionRunnerDependencies = RunnerActionRunnerDependencies;

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { parseTOML } from "toml-eslint-parser";

import {
  DEVELOPER_TEAM,
  PACKAGE_INSTRUCTION_PACKAGE_IDS,
  getConfigurablePackageInstructionMetadata,
  buildCapabilityInstructionBundle,
  bindAdaptiveMemoryInstructionBundle,
  getEnabledCapabilityInstructionIds,
  getDefaultDeckConfig,
  getCanonicalCapability,
  getRunnerCapabilityMapping,
  resolveWebSearchReadiness,
  isWebSearchProviderDescriptor,
  resolveCanonicalSupermemoryProjectScope,
  bootstrapSerena,
  resolveExistingSerenaReadiness,
  type CapabilityInventory,
  type CapabilityInventoryInput,
  type DashboardState,
  type DeveloperTeamAdapterInstallInput,
  type DeveloperTeamApplyInput,
  type DeveloperTeamApplyResult,
  type DeveloperTeamOperationReceipt,
  type FlowState,
  type InstallationPlan,
  type ModelCatalog,
  type NextScreen,
  type ReviewPlan,
  type RunnerAction,
  type RunnerActionContext,
  type RunnerActionRunResult,
  type RunnerAdapter,
  type RunnerDiagnostic,
  type RunnerDeveloperTeamInstallPlan,
  type RunnerLaunchInput,
  type RunnerLaunchResult,
  type RunnerProjectInspection,
  type RuntimeDetectionInput,
  type RuntimeStatus,
  type RunnerModelAssignmentValidationInput,
  type RunnerModelAssignmentValidationResult,
  type RunnerModelEntry,
  type RunnerModelInventory,
  type RunnerModelInventoryResult,
  type RunnerModelDiscoveryRequest,
  type SerenaBootstrapEffects,
  type SerenaBootstrapRequest,
  type SerenaBootstrapResult,
  type SerenaExistingReadinessResult,
  type NormalizedDeckConfig,
  parseSkillDescriptor,
  type WebSearchProviderDescriptorV1,
} from "@deck/core";

function requireDeckConfig(config: NormalizedDeckConfig | undefined, context: string): NormalizedDeckConfig {
  if (!config) throw new Error(`Codex ${context} requires caller-resolved global Deck config.`);
  return config;
}
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/developer-team-catalog";

import { CODEX_MANIFEST_PATH, buildCodexDeveloperTeamInstallPlan } from "./developer-team-install";
import { CODEX_CAPABILITY_CATALOG, CODEX_RUNNER_CAPABILITY_CONTRIBUTION } from "./capability-catalog";
import { inspectCodexOwnedHookIds, mergeCodexOwnedHooks, mergeCodexProjectConfig } from "./codex-config";
import {
  CODEX_DEVELOPER_BYPASS_DIAGNOSTIC,
  buildCodexLaunchPlan,
  isSafeCodexLaunchScalar,
} from "./launch";
import { type CodexMcpServerId, buildCodexMcpServers, inspectCodexForeignMcpCommands, inspectCodexMcpServerCommand, inspectCodexMcpServerIds, inspectCodexSupermemoryMcpState, isCodexSerenaMcpConfigured, isCodexSupermemoryMcpConfigured, isCodexWebSearchMcpConfigured, isDeckManagedCodexMcpServer, mergeCodexMcpServers } from "./mcp-config";
import { createCodexTools, type CodexTools, type CodexToolOptions } from "./tools";
import { createNodeCodexFileEffects } from "./node-effects";
import {
  createDefaultCodexModelInventoryDiscovery,
  type CodexProductionModelDiscoveryDependencies,
} from "./codex-model-discovery";
import { inspectCodexProject, type CodexPreflightEffects } from "./preflight";
import { applyCodexMutationPlan, NODE_PATH_CAS_RESIDUAL_RISK, rollbackCodexTransaction, type CodexFileEffects } from "./transaction";
import type { CodexMutation, CodexMutationPlan, CodexPreimage } from "./types";

export type CodexRunnerAdapterOptions = {
  preflight?: CodexPreflightEffects;
  fileEffects?: CodexFileEffects;
  journalRoot?: string;
  /** The user's home, where `~/.agents/skills` lives; defaults to HOME. */
  userHome?: string;
  mcpCapabilityIds?: readonly string[];
  /** Injected Codex CLI inventory for deterministic adapter tests. */
  inventoryDiscovery?: (request: RunnerModelDiscoveryRequest) => Promise<RunnerModelInventoryResult>;
  /** Partial production command boundary replacement for hermetic discovery tests. */
  productionModelDiscoveryDependencies?: Partial<CodexProductionModelDiscoveryDependencies>;
  codebaseIndexReadiness?: (projectRoot: string) => boolean | Promise<boolean>;
  /** Codex user configuration directory (read-only duplicate detection); defaults to $CODEX_HOME or ~/.codex. */
  codexHome?: string;
  /** Deck-owned shared-tool seams (RTK, Codebase Memory, Context Mode, official Supermemory hooks). */
  tools?: CodexToolOptions;
  /** Read-only Core resolver for the exact Deck-owned Serena launcher. */
  serenaReadinessResolver?: (signal?: AbortSignal) => Promise<SerenaExistingReadinessResult>;
  /** Core-controlled installer seam for explicitly authorized Serena actions. */
  serenaBootstrap?: (request: SerenaBootstrapRequest, effects?: SerenaBootstrapEffects) => Promise<SerenaBootstrapResult>;
  serenaBootstrapEffects?: SerenaBootstrapEffects;
  /** Checks whether the effective `deck` command can serve the portable Serena proxy. */
  serenaProxyProbe?: () => Promise<DeckSerenaProxyReadiness>;
  /** Provider descriptor selected by the CLI composition root. */
  webSearchProvider?: WebSearchProviderDescriptorV1;
  /** Shared Web Search credential resolver (environment, then the Deck-owned shell profile); the value never reaches config files. */
  webSearchCredential?: () => string | undefined;
  /** Resolve the selected provider without putting provider metadata in Core. */
  webSearchProviderResolver?: (provider: string | undefined) => WebSearchProviderDescriptorV1 | undefined;
};

export type DeckSerenaProxyReadiness =
  | Readonly<{ state: "ready" }>
  | Readonly<{ state: "unsupported" | "indeterminate"; message: string }>;

/** Two seconds matches Deck Doctor's bounded binary-version probe while allowing compiled CLI startup. */
export const SERENA_PROXY_PROBE_TIMEOUT_MS = 2_000;
export const SERENA_PROXY_PROBE_MAX_OUTPUT_BYTES = 4 * 1024;

export type DeckSerenaProxyProbeResult = Readonly<{
  error?: NodeJS.ErrnoException;
  status?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string | Buffer | null;
}>;

export type DeckSerenaProxyProbeRequest = Readonly<{
  command: string;
  args: readonly string[];
  timeoutMs: number;
  maxOutputBytes: number;
}>;

export type DeckSerenaProxyProbeOptions = Readonly<{
  command?: string;
  timeoutMs?: number;
  run?: (request: DeckSerenaProxyProbeRequest) => DeckSerenaProxyProbeResult;
}>;

type PendingSerenaPreparation = Readonly<{
  readiness: SerenaExistingReadinessResult;
  proxy: DeckSerenaProxyReadiness;
}>;

function defaultDeckSerenaProxyProbeRun(request: DeckSerenaProxyProbeRequest): DeckSerenaProxyProbeResult {
  return spawnSync(request.command, [...request.args], {
    encoding: "utf8",
    timeout: request.timeoutMs,
    maxBuffer: request.maxOutputBytes,
    windowsHide: true,
    shell: false,
  });
}

/** Creates a bounded, fixed-argv probe for the effective Deck Serena proxy route. */
export function createDeckSerenaProxyProbe(
  options: DeckSerenaProxyProbeOptions = {},
): () => Promise<DeckSerenaProxyReadiness> {
  const timeoutMs = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? Math.floor(options.timeoutMs)
    : SERENA_PROXY_PROBE_TIMEOUT_MS;
  const request: DeckSerenaProxyProbeRequest = {
    command: options.command ?? "deck",
    args: ["internal", "serena-mcp", "--probe"],
    timeoutMs,
    maxOutputBytes: SERENA_PROXY_PROBE_MAX_OUTPUT_BYTES,
  };
  const run = options.run ?? defaultDeckSerenaProxyProbeRun;
  return async () => {
    const result = run(request);
    if (!result.error && result.status === 0 && `${result.stdout ?? ""}`.trim() === "deck-serena-mcp-proxy-v1") {
      return { state: "ready" };
    }
    if (result.error?.code === "ETIMEDOUT" || typeof result.signal === "string") {
      return {
        state: "indeterminate",
        message: "The effective `deck internal serena-mcp --probe` capability did not complete within the bounded check. Retry after verifying the active Deck installation.",
      };
    }
    if (result.error) {
      return {
        state: "indeterminate",
        message: "The effective `deck internal serena-mcp --probe` capability could not be checked. Retry after verifying the active Deck installation.",
      };
    }
    return {
      state: "unsupported",
      message: "The active `deck` command does not support `deck internal serena-mcp`. Update Deck on PATH, then rerun the full Codex install.",
    };
  };
}

function defaultSerenaProxyProbe(): Promise<DeckSerenaProxyReadiness> {
  return createDeckSerenaProxyProbe()();
}

type CodexOperationRecord = {
  readonly receipt: DeveloperTeamOperationReceipt;
  state: "planned" | "applying" | "applied" | "failed" | "rolled-back";
};

type ReadySerenaReadiness = Extract<SerenaExistingReadinessResult, { state: "ready" }>;

function codexMcpCapabilityIds(
  capabilityInstructions: ReturnType<typeof buildCapabilityInstructionBundle> | undefined,
  adapterCapabilityIds: readonly string[],
  inputCapabilityIds: readonly string[] | undefined,
): readonly string[] {
  return [...new Set([
    ...(capabilityInstructions?.instructions.map((fragment) => fragment.packageId) ?? []),
    ...adapterCapabilityIds,
    ...(inputCapabilityIds ?? []),
  ])];
}

const CODEX_ROLE_ASSIGNMENT_MAX_FILE_BYTES = 512 * 1024;
const CODEX_ROLE_ASSIGNMENT_MAX_VALUE_BYTES = 1024;
const CODEX_ROOT_LEAD_BOOTSTRAP = [
  "This Deck-created root session is instructed to act as Deck Lead; Codex has no native root custom-agent selector.",
  "Before acting, load and follow `.agents/skills/deck-lead/SKILL.md`.",
  "Own the user outcome, apply proportional routing, and keep OpenSpec writing centralized through the Lead.",
  "Do not ask the user to repeat or select a role.",
  "This is instruction-level, static-compatible guidance and does not claim host-enforced role selection.",
].join(" ");

type CodexRoleAssignmentRead = {
  modelAssignments: import("@deck/core").DeveloperTeamModelAssignments;
  thinkingAssignments: import("@deck/core").DeveloperTeamThinkingAssignments;
  diagnostics: readonly string[];
};

function tomlKeyName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const key = value as { keys?: unknown[] };
  if (!Array.isArray(key.keys)) return undefined;
  const parts: string[] = [];
  for (const part of key.keys) {
    if (!part || typeof part !== "object") return undefined;
    const candidate = part as { type?: string; name?: unknown; value?: unknown };
    const name = candidate.type === "TOMLBare" ? candidate.name : candidate.value;
    if (typeof name !== "string") return undefined;
    parts.push(name);
  }
  return parts.join(".");
}

function tomlStringValue(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { type?: string; value?: unknown };
  return candidate.type === "TOMLValue" && typeof candidate.value === "string" ? candidate.value : undefined;
}

function boundedAssignmentString(value: string | undefined): string | undefined {
  if (!value || value.trim() !== value || value.includes("\0") || Buffer.byteLength(value, "utf8") > CODEX_ROLE_ASSIGNMENT_MAX_VALUE_BYTES) return undefined;
  return value;
}

function nativeCodexModelSlug(modelId: string | undefined): string | undefined {
  const prefix = "openai-codex/";
  if (!modelId?.startsWith(prefix)) return undefined;
  const slug = boundedAssignmentString(modelId.slice(prefix.length));
  return slug && isSafeCodexLaunchScalar(slug) && !slug.includes("/") ? slug : undefined;
}

function safePersistedReasoning(value: string | undefined): string | undefined {
  const reasoning = boundedAssignmentString(value);
  return reasoning && isSafeCodexLaunchScalar(reasoning) ? reasoning : undefined;
}

function hasUnsafeCodexModelAssignment(value: string | undefined): boolean {
  if (!value) return false;
  return !isSafeCodexLaunchScalar(value)
    || (value.startsWith("openai-codex/") && !nativeCodexModelSlug(value));
}

function blockedUnsafeCodexLaunchScalar(): RunnerLaunchResult {
  return {
    status: "blocked",
    code: "codex-invalid-launch-scalar",
    diagnostics: [{
      code: "invalid-launch-scalar",
      severity: "error",
      message: "Codex model and reasoning assignments must be bounded non-option scalars and cannot override Deck's reserved launch policy token.",
    }],
  };
}

function readCodexRoleAssignments(codexHome?: string): CodexRoleAssignmentRead {
  const modelAssignments: import("@deck/core").DeveloperTeamModelAssignments = {};
  const thinkingAssignments: import("@deck/core").DeveloperTeamThinkingAssignments = {};
  const diagnostics: string[] = [];
  if (!codexHome || codexHome.trim().length === 0) return { modelAssignments, thinkingAssignments, diagnostics };

  // Assignments live in the user's Codex home (the global install); the "root" for path safety is that directory.
  const root = resolve(codexHome);
  const codexRoot = root;
  const codexDirectory = inspectSafeReadRoot(root);
  if (codexDirectory.state === "missing") return { modelAssignments, thinkingAssignments, diagnostics };
  if (codexDirectory.state === "unsafe") {
    diagnostics.push("The Codex home is unsafe or ambiguous; role assignments were ignored.");
    return { modelAssignments, thinkingAssignments, diagnostics };
  }
  const agentsRoot = join(codexRoot, "agents");
  const agentsDirectory = inspectSafeProjectReadPath(root, agentsRoot, "directory");
  if (agentsDirectory.state === "missing") return { modelAssignments, thinkingAssignments, diagnostics };
  if (agentsDirectory.state === "unsafe") {
    diagnostics.push("The Codex agents directory is unsafe or ambiguous; role assignments were ignored.");
    return { modelAssignments, thinkingAssignments, diagnostics };
  }
  for (const agent of DEVELOPER_TEAM_AGENTS) {
    const relativePath = `agents/${agent.id}.toml`;
    const filePath = join(agentsRoot, `${agent.id}.toml`);
    const safeFile = inspectSafeProjectReadPath(root, filePath, "file");
    if (safeFile.state !== "ready") {
      if (safeFile.state === "unsafe") diagnostics.push(`${relativePath} is unsafe or ambiguous; assignments were ignored.`);
      continue;
    }
    if (safeFile.stat.size > CODEX_ROLE_ASSIGNMENT_MAX_FILE_BYTES) {
      diagnostics.push(`${relativePath} exceeds the assignment read limit; assignments were ignored.`);
      continue;
    }
    let source: string;
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      diagnostics.push(`${relativePath} could not be read safely; assignments were ignored.`);
      continue;
    }

    let parsed: ReturnType<typeof parseTOML>;
    try {
      parsed = parseTOML(source, { tomlVersion: "1.0.0" });
    } catch {
      diagnostics.push(`${relativePath} is malformed; assignments were ignored.`);
      continue;
    }
    const fields = new Map<string, unknown>();
    let duplicateField = false;
    for (const node of parsed.body[0]?.body ?? []) {
      if (node.type !== "TOMLKeyValue") continue;
      const key = tomlKeyName(node.key);
      if (!key || (key !== "model" && key !== "model_reasoning_effort")) continue;
      if (fields.has(key)) {
        duplicateField = true;
        continue;
      }
      fields.set(key, node.value);
    }
    if (duplicateField) {
      diagnostics.push(`${relativePath} has ambiguous assignment fields; assignments were ignored.`);
      continue;
    }

    const nativeModel = fields.has("model") ? boundedAssignmentString(tomlStringValue(fields.get("model"))) : undefined;
    const reasoning = fields.has("model_reasoning_effort") ? boundedAssignmentString(tomlStringValue(fields.get("model_reasoning_effort"))) : undefined;
    if (fields.has("model") && !nativeModel) diagnostics.push(`${relativePath} has an invalid model assignment; it was ignored.`);
    if (fields.has("model_reasoning_effort") && !reasoning) diagnostics.push(`${relativePath} has an invalid reasoning assignment; it was ignored.`);
    if (nativeModel) modelAssignments[agent.id] = `openai-codex/${nativeModel}`;
    if (reasoning) thinkingAssignments[agent.id] = reasoning;
  }
  return { modelAssignments, thinkingAssignments, diagnostics };
}

/** The official Codex plugin owns memory alone, so Deck-runtime adaptive-memory prose is never materialized. */
function withoutAdaptiveMemoryFragments<T extends { instructions: readonly { packageId: string }[] } | undefined>(bundle: T): T {
  if (!bundle) return bundle;
  return { ...bundle, instructions: Object.freeze(bundle.instructions.filter((fragment) => fragment.packageId !== "adaptive-memory")) } as T;
}

/** Narrow binding for the only credentials Deck may hand a Codex child process (Web Search and official Supermemory plugin). */
export const CODEX_LAUNCH_ENV_BINDING = "deck-codex-launch-v1";

function operationReceiptFrom(value: unknown): DeveloperTeamOperationReceipt | undefined {
  const outer = value && typeof value === "object" && "payload" in value ? (value as { payload?: unknown }).payload : value;
  if (!outer || typeof outer !== "object") return undefined;
  const candidate = outer as Partial<DeveloperTeamOperationReceipt>;
  if (candidate.runnerId !== "codex" || typeof candidate.operationId !== "string" || !Array.isArray(candidate.transactions)) return undefined;
  if (candidate.transactions.some((entry) => !entry || typeof entry.kind !== "string" || typeof entry.id !== "string")) return undefined;
  return candidate as DeveloperTeamOperationReceipt;
}

function sha256(content: string): string { return createHash("sha256").update(content).digest("hex"); }

function findCodexModel(inventory: RunnerModelInventory | undefined, modelId: string): RunnerModelEntry | undefined {
  return inventory && Object.values(inventory.modelsByProvider)
    .flat()
    .find((model) => model.id === modelId || model.modelId === modelId);
}

function inspectSafeProjectPath(projectRoot: string, candidate: string) {
  const root = resolve(projectRoot);
  const absolute = resolve(candidate);
  if (absolute === root || !absolute.startsWith(`${root}${sep}`)) return null;
  let current = root;
  try {
    for (const segment of relative(root, absolute).split(sep)) {
      current = join(current, segment);
      if (!existsSync(current)) return null;
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) return null;
      if (current !== absolute && !stat.isDirectory()) return null;
    }
    return lstatSync(absolute);
  } catch {
    return null;
  }
}

/** The root itself must be a real directory (not a symlink); everything below it is checked by inspectSafeProjectReadPath. */
function inspectSafeReadRoot(root: string): { state: "missing" | "unsafe" | "ready" } {
  try {
    const stat = lstatSync(root);
    return stat.isDirectory() && !stat.isSymbolicLink() ? { state: "ready" } : { state: "unsafe" };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { state: "missing" } : { state: "unsafe" };
  }
}

type SafeProjectReadPath =
  | { state: "missing" | "unsafe" }
  | { state: "ready"; stat: Stats };

type AgentsPlanFile =
  | { state: "absent" }
  | { state: "file"; content: string; mode: number }
  | { state: "unsafe"; reason: string };

function inspectSafeProjectReadPath(projectRoot: string, candidate: string, expected: "file" | "directory"): SafeProjectReadPath {
  const root = resolve(projectRoot);
  const absolute = resolve(candidate);
  if (absolute === root || !absolute.startsWith(`${root}${sep}`)) return { state: "unsafe" };
  try {
    lstatSync(absolute);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { state: "missing" } : { state: "unsafe" };
  }
  const stat = inspectSafeProjectPath(root, absolute);
  if (!stat || (expected === "file" ? !stat.isFile() : !stat.isDirectory())) return { state: "unsafe" };
  return { state: "ready", stat };
}

function inspectAgentsPlanFile(projectRoot: string): AgentsPlanFile {
  const absolute = join(projectRoot, "AGENTS.md");
  try {
    lstatSync(absolute);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { state: "absent" }
      : { state: "unsafe", reason: "the target could not be inspected" };
  }
  const stat = inspectSafeProjectPath(projectRoot, absolute);
  if (!stat) return { state: "unsafe", reason: "the target or an ancestor is a symlink or otherwise unsafe" };
  if (!stat.isFile()) return { state: "unsafe", reason: "the target is not a regular file" };
  try {
    return { state: "file", content: readFileSync(absolute, "utf8"), mode: stat.mode & 0o777 };
  } catch {
    return { state: "unsafe", reason: "the regular target is unreadable" };
  }
}

function matchesAgentsPreimage(state: AgentsPlanFile, expected: CodexPreimage): boolean {
  if (expected.kind === "absent") return state.state === "absent";
  return state.state === "file" && sha256(state.content) === expected.hash && state.mode === expected.mode;
}

function defaultProbe(): ReturnType<CodexPreflightEffects["probe"]> {
  const version = spawnSync("codex", ["--version"], { encoding: "utf8" });
  if (version.error || version.status !== 0) return Promise.resolve({ found: false });
  const help = spawnSync("codex", ["--help"], { encoding: "utf8" });
  const exec = spawnSync("codex", ["exec", "--help"], { encoding: "utf8" });
  const resume = spawnSync("codex", ["resume", "--help"], { encoding: "utf8" });
  const match = `${version.stdout}`.match(/(\d+\.\d+\.\d+)/);
  return Promise.resolve({ found: true, version: match?.[1] ?? "0.0.0", help: `${help.stdout}`, execHelp: `${exec.stdout}`, resumeHelp: `${resume.stdout}` });
}

/** Where the global Codex install lives: the Codex home (CODEX_HOME or ~/.codex) and the user's home (~/.agents/skills). */
export type CodexInstallRoots = Readonly<{ codexHome: string; userHome: string }>;

const VIRTUAL_CODEX_PREFIX = ".codex/";

/** Maps a planner path (`.codex/**`, `.agents/skills/**`) to its real absolute location and owning root. */
function mapVirtualPath(roots: CodexInstallRoots, virtualPath: string): { root: string; relative: string; absolute: string } {
  if (virtualPath.startsWith(VIRTUAL_CODEX_PREFIX)) {
    const relativePath = virtualPath.slice(VIRTUAL_CODEX_PREFIX.length);
    return { root: roots.codexHome, relative: relativePath, absolute: join(roots.codexHome, relativePath) };
  }
  return { root: roots.userHome, relative: virtualPath, absolute: join(roots.userHome, virtualPath) };
}

function globalConfigPath(roots: CodexInstallRoots): string { return join(roots.codexHome, "config.toml"); }

function readGlobalConfigSource(roots: CodexInstallRoots): string | null {
  const stat = inspectSafeProjectPath(roots.codexHome, globalConfigPath(roots));
  return stat?.isFile() ? readFileSync(globalConfigPath(roots), "utf8") : null;
}

function defaultGlobalSnapshot(roots: CodexInstallRoots) {
  const listEntries = (path: string): string[] => {
    try {
      return readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory() || entry.isFile()).map((entry) => entry.name);
    } catch { return []; }
  };
  return {
    config: readGlobalConfigSource(roots),
    roles: listEntries(join(roots.codexHome, "agents")),
    skills: listEntries(join(roots.userHome, ".agents", "skills")),
    agentsInstructions: false,
  };
}

/**
 * Reads the current state of every planner-visible path from the real global roots, keyed by virtual path.
 * Reads never leave the two roots and never follow symlinks; a symlinked target is simply not recorded as an existing
 * regular file, so planning refuses to write through it.
 */
function readExistingGlobalFiles(
  roots: CodexInstallRoots,
  materializationScope: "full" | "content-only" = "full",
): { files: Map<string, string>; modes: Map<string, number>; agentsFile: AgentsPlanFile } {
  const empty = buildCodexDeveloperTeamInstallPlan({ projectRoot: roots.userHome, codexHome: roots.codexHome, existingFiles: new Map(), materializationScope });
  const existing = new Map<string, string>();
  const modes = new Map<string, number>();
  const record = (virtualPath: string) => {
    const mapped = mapVirtualPath(roots, virtualPath);
    const stat = inspectSafeProjectPath(mapped.root, mapped.absolute);
    if (stat?.isFile()) {
      existing.set(virtualPath, readFileSync(mapped.absolute, "utf8"));
      modes.set(virtualPath, stat.mode & 0o777);
    }
  };
  for (const virtualPath of new Set([...empty.mutations.map((mutation) => mutation.relativePath), ".codex/config.toml", ".codex/hooks.json", CODEX_MANIFEST_PATH])) record(virtualPath);
  const scanManagedDirectory = (virtualDirectory: string, nestedSkill: boolean): void => {
    const mapped = mapVirtualPath(roots, virtualDirectory);
    if (!inspectSafeProjectPath(mapped.root, mapped.absolute)?.isDirectory()) return;
    for (const entry of readdirSync(mapped.absolute, { withFileTypes: true })) {
      if (!entry.name.startsWith("deck-") || entry.isSymbolicLink()) continue;
      record(nestedSkill ? `${virtualDirectory}/${entry.name}/SKILL.md` : `${virtualDirectory}/${entry.name}`);
    }
  };
  scanManagedDirectory(".codex/agents", false);
  scanManagedDirectory(".agents/skills", true);
  const ownershipManifest = existing.get(CODEX_MANIFEST_PATH);
  if (ownershipManifest) {
    try {
      const parsed = JSON.parse(ownershipManifest) as { files?: Record<string, unknown> };
      for (const virtualPath of Object.keys(parsed.files ?? {})) {
        if (virtualPath.startsWith(".codex/") || virtualPath.startsWith(".agents/skills/")) record(virtualPath);
      }
    } catch {
      // The planner reads the malformed manifest itself and blocks safely.
    }
  }
  return { files: existing, modes, agentsFile: { state: "absent" } };
}

const CODEX_PROTECTED_CONTROL_IDS = new Set([
  "trusted-runner-host-bridge",
  "invocation-authorization",
  "execution-dossier",
  "controlled-effects",
  "registry-coordination",
  "bound-verification",
]);

function isApprovedStaticCompatibleGap(capabilityId: string): boolean {
  return CODEX_CAPABILITY_CATALOG.some((entry) => (
    entry.capabilityId === capabilityId
      && "reviewDisposition" in entry
      && entry.reviewDisposition === "static-compatible-gap"
  ));
}

function capabilityLabel(capabilityId: string): string {
  return capabilityId.split("-").map((part) => part.length > 0 ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part).join(" ");
}

class CodexRunnerAdapter implements RunnerAdapter {
  readonly runnerId = "codex";
  readonly displayName = "Codex CLI";
  readonly environmentIds = ["codex-development"] as const;
  readonly packageInstructionIds = PACKAGE_INSTRUCTION_PACKAGE_IDS;
  readonly ui = {
    environmentLabels: { "codex-development": "Codex Development" },
    dashboard: { defaultSelectedTeamIds: ["developer-team"], executionClass: "static-compatible" },
    model: {
      providerSource: "Providers, models, and reasoning levels come from `codex debug models` for the active account.",
      missingChecks: ["Supported Codex CLI version", "Authenticated Codex model catalog"],
      remediation: "Run `codex debug models` to confirm the current Codex model inventory before retrying.",
      defaultThinkingLevels: [],
    },
    adaptiveMemory: {
      supermemory: {
        requiresExternalToken: false,
        selectionStatus: "Supermemory selected; Review & Install installs the pinned official Codex plugin hooks. Launch uses the stored profile credential (child process only).",
        configuredDiagnostics: ["Official Supermemory plugin profile credentials are stored; no token is written to Codex configuration."],
      },
    },
  } as const;
  readonly #preflight: CodexPreflightEffects;
  readonly #fileEffects?: CodexFileEffects;
  readonly #journalRoot: string;
  readonly #userHome?: string;
  readonly #mcpCapabilityIds: readonly string[];
  readonly #inventoryDiscovery: (request: RunnerModelDiscoveryRequest) => Promise<RunnerModelInventoryResult>;
  #latestReadyInventory: Extract<RunnerModelInventoryResult, { state: "ready" }> | null = null;
  readonly #codebaseIndexReadiness: NonNullable<CodexRunnerAdapterOptions["codebaseIndexReadiness"]>;
  readonly #toolOptions: CodexToolOptions;
  readonly #codexHome?: string;
  #toolsInstance?: CodexTools;
  readonly #serenaReadinessResolver: NonNullable<CodexRunnerAdapterOptions["serenaReadinessResolver"]>;
  readonly #serenaBootstrap: NonNullable<CodexRunnerAdapterOptions["serenaBootstrap"]>;
  readonly #serenaBootstrapEffects?: SerenaBootstrapEffects;
  readonly #serenaProxyProbe: NonNullable<CodexRunnerAdapterOptions["serenaProxyProbe"]>;
  readonly #webSearchProvider?: WebSearchProviderDescriptorV1;
  readonly #webSearchProviderResolver?: CodexRunnerAdapterOptions["webSearchProviderResolver"];
  readonly #webSearchCredential: () => string | undefined;
  /** One-use Serena and effective Deck proxy evidence for a matching full plan. */
  readonly #pendingSerenaPreparationByProject = new Map<string, PendingSerenaPreparation>();
  readonly #serenaReadinessByPlan = new WeakMap<object, ReadySerenaReadiness>();
  readonly #nativePlans = new WeakMap<object, CodexMutationPlan>();
  readonly #planOperations = new WeakMap<object, CodexOperationRecord>();

  constructor(options: CodexRunnerAdapterOptions = {}) {
    this.#preflight = options.preflight ?? {
      probe: defaultProbe,
      inspectTrust: async () => "indeterminate",
      readProject: async () => defaultGlobalSnapshot(this.#roots),
    };
    this.#fileEffects = options.fileEffects;
    this.#userHome = options.userHome;
    this.#mcpCapabilityIds = options.mcpCapabilityIds ?? [];
    this.#inventoryDiscovery = options.inventoryDiscovery
      ?? createDefaultCodexModelInventoryDiscovery(options.productionModelDiscoveryDependencies);
    this.#codebaseIndexReadiness = options.codebaseIndexReadiness ?? ((projectRoot) => existsSync(join(projectRoot, ".codebase-memory", "graph.db")) || existsSync(join(projectRoot, ".codebase-memory", "graph.db.zst")));
    this.#toolOptions = options.tools ?? {};
    this.#codexHome = options.codexHome;
    this.#serenaBootstrapEffects = options.serenaBootstrapEffects;
    this.#serenaProxyProbe = options.serenaProxyProbe ?? defaultSerenaProxyProbe;
    this.#serenaReadinessResolver = options.serenaReadinessResolver
      ?? ((signal) => resolveExistingSerenaReadiness(this.#serenaBootstrapEffects, signal));
    this.#serenaBootstrap = options.serenaBootstrap ?? ((request, effects) => bootstrapSerena(request, effects));
    this.#webSearchProvider = options.webSearchProvider;
    this.#webSearchProviderResolver = options.webSearchProviderResolver;
    this.#webSearchCredential = options.webSearchCredential ?? (() => process.env.TAVILY_API_KEY?.trim() || undefined);
    this.#journalRoot = options.journalRoot ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "deck", "backups", "codex");
  }

  /** Real install roots: CODEX_HOME (default ~/.codex) and the user's home. Nothing is ever written under a project. */
  get #roots(): CodexInstallRoots {
    const fromEnv = process.env.CODEX_HOME && isAbsolute(process.env.CODEX_HOME) ? process.env.CODEX_HOME : undefined;
    return {
      codexHome: resolve(this.#codexHome ?? fromEnv ?? join(this.#tools.home, ".codex")),
      userHome: resolve(this.#userHome ?? this.#tools.home),
    };
  }

  /** MCP servers the user registered themselves in the global Codex config (Deck-marked blocks excluded): name to command. */
  #foreignMcpCommands(globalConfig?: string): ReadonlyMap<string, string> {
    try {
      const source = globalConfig ?? readGlobalConfigSource(this.#roots) ?? "";
      return inspectCodexForeignMcpCommands(source, { skipDeckManaged: true });
    } catch { return new Map(); }
  }

  get #tools(): CodexTools {
    this.#toolsInstance ??= createCodexTools(this.#toolOptions);
    return this.#toolsInstance;
  }

  #webSearchCredentialAvailable(provider: WebSearchProviderDescriptorV1 | undefined): boolean {
    if (!isWebSearchProviderDescriptor(provider)) return false;
    try { return Boolean(this.#webSearchCredential()?.trim()); } catch { return false; }
  }

  /** Absolute provider executable (for example the nvm-shimmed npx), or undefined when none is runnable. */
  #webSearchCommand(provider: WebSearchProviderDescriptorV1 | undefined): string | undefined {
    return provider ? this.#tools.resolveExecutable(provider.command[0]!) : undefined;
  }

  private resolveWebSearchProvider(provider: string | undefined): WebSearchProviderDescriptorV1 | undefined {
    const selected = provider?.trim();
    if (!selected) return undefined;
    if (this.#webSearchProvider?.providerId === selected) return this.#webSearchProvider;
    return this.#webSearchProviderResolver?.(selected);
  }

  async #resolveSerenaReadiness(signal?: AbortSignal): Promise<SerenaExistingReadinessResult> {
    return this.#serenaReadinessResolver(signal);
  }

  async #prepareSerena(projectRoot: string, signal?: AbortSignal): Promise<PendingSerenaPreparation> {
    const existing = this.#pendingSerenaPreparationByProject.get(resolve(projectRoot));
    if (existing) return existing;
    const readiness = await this.#resolveSerenaReadiness(signal);
    const proxy = readiness.state === "ready"
      ? await this.#serenaProxyProbe()
      : { state: "indeterminate" as const, message: "The Serena proxy cannot be used until Deck-owned Serena is ready." };
    const preparation = Object.freeze({ readiness, proxy });
    this.#pendingSerenaPreparationByProject.set(resolve(projectRoot), preparation);
    return preparation;
  }

  #takePendingSerenaPreparation(projectRoot: string): PendingSerenaPreparation | undefined {
    const key = resolve(projectRoot);
    const preparation = this.#pendingSerenaPreparationByProject.get(key);
    this.#pendingSerenaPreparationByProject.delete(key);
    return preparation;
  }

  #rememberPendingSerenaPreparation(projectRoot: string, preparation: PendingSerenaPreparation): void {
    this.#pendingSerenaPreparationByProject.set(resolve(projectRoot), preparation);
  }

  #inspectEffectiveConfiguredSupermemoryProjectScope(input: {
    existingCodexConfig: string;
    deckConfig: NormalizedDeckConfig;
    memoryProviderId: "none" | "supermemory";
    derivedSupermemoryProjectScope?: string;
    mcpCapabilityIds: readonly string[];
    serenaPreparation?: PendingSerenaPreparation;
  }): string | undefined {
    const existing = inspectCodexSupermemoryMcpState(input.existingCodexConfig);
    const existingScope = existing.ok ? existing.scope : undefined;
    const config = mergeCodexProjectConfig(input.existingCodexConfig, { multiAgent: true });
    if (config.status === "blocked") return existingScope;
    const webSearchProvider = this.resolveWebSearchProvider(input.deckConfig.webSearch.provider);
    const desiredMcp = buildCodexMcpServers({
      packageIds: input.mcpCapabilityIds,
      memoryProvider: input.memoryProviderId,
      supermemoryProjectScope: input.derivedSupermemoryProjectScope,
      serenaLauncherAvailable: input.serenaPreparation?.readiness.state === "ready",
      serenaProxyAvailable: input.serenaPreparation?.readiness.state === "ready" && input.serenaPreparation.proxy.state === "ready",
      webSearchProviderSupported: webSearchProvider !== undefined,
      webSearchProviderConfigured: input.deckConfig.webSearch.provider !== undefined,
      webSearchProvider,
      webSearchCredentialAvailable: this.#webSearchCredentialAvailable(webSearchProvider),
      webSearchExecutableAvailable: this.#webSearchCommand(webSearchProvider) !== undefined,
      webSearchCommand: this.#webSearchCommand(webSearchProvider),
    });
    const mcp = mergeCodexMcpServers(config.content, desiredMcp.servers);
    if (mcp.status === "blocked") return existingScope;
    const hooks = mergeCodexOwnedHooks(mcp.content, []);
    if (hooks.status === "blocked") return existingScope;
    const planned = inspectCodexSupermemoryMcpState(hooks.content);
    return planned.ok ? planned.scope : existingScope;
  }

  #selectedMcpCapabilityIds(
    input: DeveloperTeamAdapterInstallInput,
    capabilityInstructions: ReturnType<typeof buildCapabilityInstructionBundle> | undefined,
    configSource = "",
    webSearchEnabled = false,
  ): readonly string[] {
    const ids = new Set(codexMcpCapabilityIds(capabilityInstructions, this.#mcpCapabilityIds, input.capabilityIds));
    if (isDeckManagedCodexMcpServer(configSource, "serena")) ids.add("serena");
    // A launch-time plan carries no explicit TUI selection: keep what the reviewed install already put in the global
    // config instead of silently dropping it (a TUI-only choice such as Context7 must survive `deck codex developer`).
    if (input.capabilityIds === undefined) {
      for (const id of ["context7", "context-mode", "codebase-memory"] as const) if (isDeckManagedCodexMcpServer(configSource, id)) ids.add(id);
    }
    if (webSearchEnabled) ids.add("web-search");
    return [...ids];
  }

  async inspectProject(projectRoot: string): Promise<RunnerProjectInspection> {
    return inspectCodexProject(projectRoot, this.#preflight);
  }
  /** True when the global Codex config carries Deck-owned RTK or Supermemory hook blocks. */
  #deckHooksMaterialized(): boolean {
    try {
      const source = readGlobalConfigSource(this.#roots);
      return source !== null && inspectCodexOwnedHookIds(source).some((id) => id === "rtk" || id === "supermemory");
    } catch { return false; }
  }
  getLaunchPolicyDiagnostics() { return [CODEX_DEVELOPER_BYPASS_DIAGNOSTIC]; }
  async buildLaunchPlan(input: RunnerLaunchInput): Promise<RunnerLaunchResult> {
    return this.#withWebSearchCredential(await this.#buildBaseLaunchPlan(input), input);
  }
  /**
   * Hands the shared Web Search credential to the Codex child process only when Web Search is enabled and the global
   * Deck-owned MCP entry will read it through `env_vars`. The value is marked sensitive and never reaches config files.
   */
  #withWebSearchCredential(launch: RunnerLaunchResult, input: RunnerLaunchInput): RunnerLaunchResult {
    if (launch.status !== "ready" || input.deckConfig?.webSearch?.enabled !== true) return launch;
    const provider = this.resolveWebSearchProvider(input.deckConfig.webSearch.provider);
    if (!isWebSearchProviderDescriptor(provider)) return launch;
    let token: string | undefined;
    try { token = this.#webSearchCredential()?.trim(); } catch { token = undefined; }
    if (!token) return launch;
    try {
      const source = readGlobalConfigSource(this.#roots);
      if (source === null || !isCodexWebSearchMcpConfigured(source, provider, this.#webSearchCommand(provider))) return launch;
    } catch { return launch; }
    return {
      ...launch,
      plan: {
        ...launch.plan,
        envOverlay: { ...(launch.plan.envOverlay ?? {}), [provider.credentialEnvVar]: { value: token, sensitive: true } },
        sensitiveEnvAuthorization: {
          binding: CODEX_LAUNCH_ENV_BINDING,
          keys: [...new Set([...(launch.plan.sensitiveEnvAuthorization?.keys ?? []), provider.credentialEnvVar])],
        },
      },
    };
  }
  async #buildBaseLaunchPlan(input: RunnerLaunchInput): Promise<RunnerLaunchResult> {
    const inspection = await this.inspectProject(input.projectRoot);
    if (inspection.state === "unsupported") return { status: "unsupported", code: "codex-version-unsupported", diagnostics: inspection.diagnostics };
    if (inspection.state === "blocked") return { status: "blocked", code: "codex-preflight-blocked", diagnostics: inspection.diagnostics };
    const newSession = input.mode === "interactive" || input.mode === "exec";
    const features = {
      interactive: inspection.evidence.interactive === true,
      exec: inspection.evidence.exec === true,
      resumeById: inspection.evidence.resume === true,
      resumeLatest: inspection.evidence.resumeLatest === true,
      hookTrustBypass: inspection.evidence.hookTrustBypass === true && this.#deckHooksMaterialized(),
    };
    if (!newSession) {
      const launch = buildCodexLaunchPlan(input, features);
      return launch.status === "ready"
        ? { ...launch, diagnostics: [...inspection.diagnostics, ...launch.diagnostics] }
        : launch;
    }

    const persistedModels = this.readModelAssignments(input.projectRoot);
    const persistedReasoning = this.readThinkingAssignments(input.projectRoot);
    const explicitModel = input.modelId !== undefined;
    const explicitReasoning = input.reasoningLevel !== undefined;
    const requestedModel = explicitModel ? input.modelId : persistedModels["deck-lead"];
    const requestedReasoning = explicitReasoning ? input.reasoningLevel : persistedReasoning["deck-lead"];
    if (hasUnsafeCodexModelAssignment(requestedModel) || (requestedReasoning !== undefined && !isSafeCodexLaunchScalar(requestedReasoning))) {
      return blockedUnsafeCodexLaunchScalar();
    }
    const inventory = explicitModel || explicitReasoning
      ? await this.getModelInventory({ projectRoot: input.projectRoot, mode: "prefer-cache" })
      : undefined;
    const selectedModel = inventory?.state === "ready" && requestedModel
      ? findCodexModel(inventory.inventory, requestedModel)
      : undefined;

    const nativeModelId = explicitModel
      ? selectedModel?.modelId
      : nativeCodexModelSlug(requestedModel);
    const persistedModelReasoning = explicitModel
      ? selectedModel?.variants?.includes(safePersistedReasoning(requestedReasoning) ?? "") ? safePersistedReasoning(requestedReasoning) : undefined
      : safePersistedReasoning(requestedReasoning);
    const resolvedReasoning = explicitReasoning
      ? selectedModel?.variants?.includes(requestedReasoning ?? "") ? requestedReasoning : undefined
      : persistedModelReasoning;
    const availableReasoning = [...new Set([...(selectedModel?.variants ?? []), ...(resolvedReasoning ? [resolvedReasoning] : [])])];
    const launch = buildCodexLaunchPlan({ ...input, modelId: nativeModelId, reasoningLevel: resolvedReasoning }, features, availableReasoning, {
      developerInstructions: CODEX_ROOT_LEAD_BOOTSTRAP,
    });
    if (launch.status !== "ready") return launch;
    return {
      ...launch,
      diagnostics: [
        ...inspection.diagnostics,
        ...(explicitModel && !nativeModelId ? [{ code: "codex-model-omitted", severity: "warning" as const, message: "The requested model is not confirmed by Codex evidence and was omitted." }] : []),
        ...(explicitReasoning && !resolvedReasoning ? [{ code: "codex-reasoning-omitted", severity: "warning" as const, message: "The requested reasoning level is not confirmed by Codex evidence and was omitted." }] : []),
        ...launch.diagnostics,
      ],
    };
  }
  async detectRuntimes(input?: RuntimeDetectionInput): Promise<readonly RuntimeStatus[]> {
    const inspection = await this.inspectProject(input?.projectRoot ?? process.cwd());
    return [{ runtimeId: "codex", displayName: this.displayName, isAvailable: inspection.evidence.binary === true, version: typeof inspection.evidence.version === "string" ? inspection.evidence.version : undefined, diagnostics: inspection.diagnostics.map((diagnostic) => diagnostic.message) }];
  }
  async getCapabilityInventory(input: CapabilityInventoryInput): Promise<CapabilityInventory> {
    const serenaReadiness = await this.#resolveSerenaReadiness();
    const serenaProxy = serenaReadiness.state === "ready"
      ? await this.#serenaProxyProbe()
      : undefined;
    return this.#getCapabilityInventory(input, serenaReadiness, serenaProxy);
  }
  async #getCapabilityInventory(
    input: CapabilityInventoryInput,
    serenaReadiness: SerenaExistingReadinessResult,
    serenaProxy?: DeckSerenaProxyReadiness,
  ): Promise<CapabilityInventory> {
    const inspection = await this.inspectProject(input.projectRoot);
    const config = readGlobalConfigSource(this.#roots) ?? "";
    const deckConfig = requireDeckConfig(input.deckConfig, "operation");
    const webSearchProvider = this.resolveWebSearchProvider(deckConfig.webSearch.provider);
    const mcp = new Set(inspectCodexMcpServerIds(config));
    const hookIds = new Set(inspectCodexOwnedHookIds(config));
    const serenaConfigured = mcp.has("serena");
    const serenaMcpReady = serenaReadiness.state === "ready"
      && serenaProxy?.state === "ready"
      && isCodexSerenaMcpConfigured(config);
    const supportStatusFor = (capabilityId: string) => CODEX_CAPABILITY_CATALOG.find((entry) => entry.capabilityId === capabilityId)?.status
      ?? getRunnerCapabilityMapping(capabilityId, this.runnerId, [CODEX_RUNNER_CAPABILITY_CONTRIBUTION])?.status
      ?? "supported";
    const tools = this.#tools;
    const contextModeCommand = tools.contextMode.command();
    const codebaseCommand = tools.codebase.command();
    const rtkState = tools.rtk.state();
    const nodeReady = tools.node.command() !== undefined;
    const base = (capabilityId: string, label: string) => ({
      capabilityId,
      label,
      description: `${label} Codex readiness`,
      section: "tools",
      requirementLevel: "optional" as const,
      installKind: "runner-native" as const,
      supportStatus: supportStatusFor(capabilityId),
    });
    const foreign = this.#foreignMcpCommands(config);
    const canon = (path: string) => { try { return realpathSync(path); } catch { return path; } };
    const foreignOwner = (id: string, command: string | undefined) => command === undefined ? undefined : [...foreign].find(([name, other]) => name !== id && canon(other) === canon(command))?.[0];
    const mcpPinned = (id: string, command: string | undefined) => command !== undefined && (inspectCodexMcpServerCommand(config, id) === command || foreignOwner(id, command) !== undefined);
    const contextMode = (() => {
      const configured = mcp.has("context-mode") || foreignOwner("context-mode", contextModeCommand) !== undefined;
      const pinned = mcpPinned("context-mode", contextModeCommand);
      return {
        ...base("context-mode", "Context Mode"),
        isInstalled: contextModeCommand !== undefined && pinned,
        isBlocked: false,
        diagnostics: [
          ...(contextModeCommand === undefined ? ["context-mode: no verified executable (install through Review & Install)"] : []),
          ...(configured && contextModeCommand !== undefined && !pinned ? ["context-mode: MCP command is not pinned to the verified executable"] : []),
          ...(!configured ? ["context-mode: MCP configuration missing"] : []),
        ],
      };
    })();
    const indexReady = await this.#codebaseIndexReadiness(input.projectRoot);
    const codebase = (() => {
      const configured = mcp.has("codebase-memory") || foreignOwner("codebase-memory", codebaseCommand) !== undefined;
      const pinned = mcpPinned("codebase-memory", codebaseCommand);
      return {
        ...base("codebase-memory", "Codebase Memory"),
        isInstalled: codebaseCommand !== undefined && pinned && indexReady,
        isBlocked: tools.codebase.state() === "conflict" || tools.codebase.state() === "unusable" && codebaseCommand === undefined,
        diagnostics: [
          ...(codebaseCommand === undefined ? ["codebase-memory: no verified executable (install through Review & Install)"] : []),
          ...(configured && codebaseCommand !== undefined && !pinned ? ["codebase-memory: MCP command is not pinned to the verified executable"] : []),
          ...(!configured ? ["codebase-memory: MCP configuration missing"] : []),
          ...(!indexReady ? ["codebase-memory: project index not ready"] : []),
        ],
      };
    })();
    const rtk = {
      ...base("rtk", "RTK"),
      isInstalled: rtkState === "ready" && nodeReady && hookIds.has("rtk"),
      isBlocked: rtkState === "conflict" || rtkState === "unusable",
      diagnostics: [
        ...(rtkState !== "ready" ? [`rtk: Deck-owned pinned binary ${rtkState} (install through Review & Install)`] : []),
        ...(!nodeReady ? ["rtk: a Node.js 18+ runtime is required for the PreToolUse hook bridge"] : []),
        ...(rtkState === "ready" && !hookIds.has("rtk") ? ["rtk: PreToolUse hook not materialized"] : []),
      ],
    };
    const supermemoryScripts = tools.supermemory.scripts();
    const supermemory = {
      ...base("supermemory-tool-bindings", "Supermemory (official Codex plugin)"),
      isInstalled: supermemoryScripts !== undefined && nodeReady && hookIds.has("supermemory"),
      isBlocked: tools.supermemory.state() === "conflict",
      diagnostics: [
        ...(tools.supermemory.state() === "conflict" ? ["supermemory: owned plugin artifact differs from the pinned release"] : []),
        ...(supermemoryScripts === undefined && tools.supermemory.state() === "absent" ? ["supermemory: pinned official plugin hooks are not installed"] : []),
        ...(!nodeReady ? ["supermemory: a Node.js 18+ runtime is required for the plugin hooks"] : []),
        ...(supermemoryScripts !== undefined && !hookIds.has("supermemory") ? ["supermemory: plugin hooks not materialized in the project"] : []),
        ...(mcp.has("supermemory") ? ["supermemory: a raw Supermemory MCP entry exists; Deck does not use it beside the official plugin"] : []),
      ],
    };
    const webSearchEvidence = {
      enabled: deckConfig.webSearch.enabled,
      runnerSupported: true,
      providerConfigured: isWebSearchProviderDescriptor(webSearchProvider),
      credentialAvailable: this.#webSearchCredentialAvailable(webSearchProvider),
      executableAvailable: this.#webSearchCommand(webSearchProvider) !== undefined,
      mcpConfigured: webSearchProvider !== undefined && mcp.has(webSearchProvider.semanticServerId) && isCodexWebSearchMcpConfigured(config, webSearchProvider, this.#webSearchCommand(webSearchProvider)),
      // A Deck-marked entry that differs (for example the pre-pinning bare `npx`) is an upgradable owned entry, not a conflict.
      mcpConfigConflict: webSearchProvider !== undefined && mcp.has(webSearchProvider.semanticServerId) && !isCodexWebSearchMcpConfigured(config, webSearchProvider, this.#webSearchCommand(webSearchProvider)) && !isDeckManagedCodexMcpServer(config, webSearchProvider.semanticServerId as CodexMcpServerId),
    } as const;
    const webSearchReadiness = resolveWebSearchReadiness(webSearchEvidence);
    const webSearch = {
      capabilityId: "web-search",
      label: "Web Search",
      description: "Web Search Codex readiness",
      section: "tools",
      requirementLevel: "optional" as const,
      installKind: "runner-native" as const,
      supportStatus: supportStatusFor("web-search"),
      isInstalled: webSearchReadiness.state === "ready",
       isBlocked: webSearchReadiness.code === "mcp-config-conflict",
      diagnostics: [...webSearchReadiness.diagnostics],
      webSearchReadiness,
       webSearchEvidence,
       webSearchProvider,
    };
    const serena = {
      capabilityId: "serena",
      label: "Serena",
      description: "Serena Codex readiness",
      section: "tools",
      requirementLevel: "optional" as const,
      installKind: "runner-native" as const,
      supportStatus: supportStatusFor("serena"),
      isInstalled: serenaMcpReady,
      isBlocked: serenaReadiness.state === "unusable"
         || serenaReadiness.state === "indeterminate"
         || (serenaReadiness.state === "ready" && serenaProxy?.state !== "ready"),
      diagnostics: [
        ...(serenaReadiness.state === "ready"
          ? [`serena: Deck-owned executable ${serenaReadiness.evidence.source === "existing-deck-tool" ? "reused" : "installed"}`]
          : [`serena: executable ${serenaReadiness.state}`]),
        ...(serenaReadiness.state === "ready" && serenaProxy?.state !== "ready"
          ? [serenaProxy === undefined
            ? "serena: the effective `deck internal serena-mcp --probe` capability could not be confirmed."
            : serenaProxy.message]
          : []),
        `serena: MCP ${serenaConfigured ? "configured" : "not configured"}`,
        `serena: MCP ${serenaMcpReady ? "ready" : "not ready"}`,
      ],
    };
    const capabilities: CapabilityInventory["capabilities"][number][] = [
      { capabilityId: "codex-runtime", label: "Codex runtime", description: "Native roles, skills, materialization, and CLI launch", section: "runtime", requirementLevel: "required", installKind: "runner-native", supportStatus: "supported", isInstalled: inspection.evidence.binary === true, isBlocked: inspection.state === "blocked" || inspection.state === "unsupported", diagnostics: inspection.diagnostics.map((diagnostic) => diagnostic.message) },
      contextMode,
      codebase,
      rtk,
      serena,
      { ...base("context7", "Context7"), isInstalled: mcp.has("context7"), isBlocked: false, diagnostics: mcp.has("context7") ? [] : ["context7: MCP configuration missing"] },
      webSearch,
      supermemory,
    ];
    const existing = new Set(capabilities.map((entry) => entry.capabilityId));
    for (const entry of CODEX_CAPABILITY_CATALOG) {
      if (existing.has(entry.capabilityId)) continue;
      const canonical = getCanonicalCapability(entry.capabilityId, [CODEX_RUNNER_CAPABILITY_CONTRIBUTION]);
      const required = CODEX_PROTECTED_CONTROL_IDS.has(entry.capabilityId)
        || canonical?.requirement === "required"
        || canonical?.requirement === "internal-required";
      capabilities.push({
        capabilityId: entry.capabilityId,
        label: ("label" in entry ? entry.label : undefined) ?? capabilityLabel(entry.capabilityId),
        description: `${entry.status}: ${entry.provisionMode}`,
        section: CODEX_PROTECTED_CONTROL_IDS.has(entry.capabilityId) ? "execution-controls" : "adapter-dispositions",
        requirementLevel: required ? "required" : "optional",
        installKind: "runner-native",
        supportStatus: entry.status,
        isInstalled: entry.status === "supported" || entry.status === "shared",
        isBlocked: entry.status === "gap",
        diagnostics: entry.status === "gap" ? [`${entry.capabilityId}: ${entry.provisionMode}`] : [],
      });
    }
    return {
      runnerId: this.runnerId,
      environmentId: input.environmentId,
      capabilities,
    };
  }
  buildReviewPlan(state: DashboardState, inventory: CapabilityInventory): ReviewPlan {
    // Shared tools are selected either as capabilities or through their enabled package instructions (as for Claude).
    const selected = new Set([
      ...Object.entries(state.selectedCapabilities).filter(([, enabled]) => enabled).map(([id]) => id),
      ...(["rtk", "context-mode", "codebase-memory"] as const).filter((id) => state.packageInstructions[id] === true),
    ]);
    const byId = new Map(inventory.capabilities.map((capability) => [capability.capabilityId, capability]));
    const manualSteps: RunnerAction[] = [];
    const configWrites: RunnerAction[] = [];
    const automaticInstalls: RunnerAction[] = [];
    const enabledPackageInstructionIds = getConfigurablePackageInstructionMetadata(this.packageInstructionIds)
      .filter((entry) => state.packageInstructions[entry.id] === true)
      .map((entry) => entry.id);
    if (enabledPackageInstructionIds.length > 0) {
      configWrites.push({
        id: "package-instructions.codex.deck-config",
        kind: "write-deck-config",
        title: "Write Codex package instruction configuration",
        status: "ready",
        required: false,
        diagnostics: [`Optional instruction bundles: ${enabledPackageInstructionIds.join(", ")}`],
      });
    }
    if (state.selectedCapabilities["web-search"] !== undefined) {
      configWrites.push({
        id: "capability.web-search.deck-config",
        kind: "write-deck-config",
        title: "Persist Web Search selection",
        capabilityId: "web-search",
        status: "ready",
        required: false,
        diagnostics: ["Persist the current Web Search enabled/provider selection before native Codex MCP materialization."],
      });
    }
    const blockedCapabilityIds = new Set<string>();
    const staticCompatibleGapIds = new Set<string>();
    const staticCompatibleGapDiagnostics: Array<ReviewPlan["diagnostics"][number]> = [];
    const addStaticCompatibleGap = (capability: CapabilityInventory["capabilities"][number]) => {
      if (staticCompatibleGapIds.has(capability.capabilityId)) return;
      staticCompatibleGapIds.add(capability.capabilityId);
      staticCompatibleGapDiagnostics.push({
        code: `static-compatible-gap:${capability.capabilityId}`,
        severity: "warning",
        capabilityId: capability.capabilityId,
        message: `${capability.label} remains a static-compatible Codex gap; no first-class control is claimed or installed.`,
      });
    };
    const addBlockedCapability = (capability: CapabilityInventory["capabilities"][number]) => {
      if (blockedCapabilityIds.has(capability.capabilityId)) return;
      blockedCapabilityIds.add(capability.capabilityId);
      manualSteps.push({ id: `codex-gap:${capability.capabilityId}`, kind: "pending-source", title: capability.label, capabilityId: capability.capabilityId, status: "blocked", required: capability.requirementLevel === "required", diagnostics: capability.diagnostics });
    };
    for (const capability of inventory.capabilities) {
      if (capability.requirementLevel !== "required" || !capability.isBlocked) continue;
      if (isApprovedStaticCompatibleGap(capability.capabilityId)) addStaticCompatibleGap(capability);
      else addBlockedCapability(capability);
    }
    for (const capabilityId of selected) {
      const capability = byId.get(capabilityId);
      if (!capability) continue;
      if (capability.supportStatus === "not-applicable") continue;
      if (capabilityId === "serena" && !capability.isInstalled) {
        if (capability.isBlocked) {
          addBlockedCapability(capability);
        } else if (state.explicitlySelectedCapabilities?.serena === true) {
          manualSteps.push({
            id: "codex-serena-bootstrap",
            kind: "install",
            title: "Reuse or install Deck-owned Serena",
            capabilityId: "serena",
            status: "ready",
            required: false,
            diagnostics: ["The explicitly selected Core Serena flow validates an existing Deck-owned launcher before any Codex MCP configuration is planned."],
          });
        } else {
          manualSteps.push({
            id: "codex-serena-selection-required",
            kind: "authorization-required",
            title: "Explicitly select Serena before provisioning",
            capabilityId: "serena",
            status: "blocked",
            required: false,
            diagnostics: ["Serena is not ready. Explicit selection and current-operation authorization are required before Deck can provision it."],
          });
        }
        continue;
      }
      if (capability.isBlocked) {
        if (isApprovedStaticCompatibleGap(capability.capabilityId)) addStaticCompatibleGap(capability);
        else addBlockedCapability(capability);
      } else if (!capability.isInstalled && ["context-mode", "codebase-memory", "rtk", "context7", "web-search", "supermemory-tool-bindings"].includes(capabilityId)) {
        if (capabilityId === "web-search" && !capability.webSearchProvider) continue;
        const install = this.#toolInstallAction(capabilityId);
        if (install) automaticInstalls.push(install);
        configWrites.push({ id: `codex-config:${capabilityId}`, kind: "codex-config-preview", title: `Configure ${capability.label} through the reviewed Codex plan`, capabilityId, status: "ready" });
      }
    }
    if (state.adaptiveMemory.provider === "supermemory" && !byId.get("supermemory-tool-bindings")?.isInstalled) {
      if (!automaticInstalls.some((action) => action.kind === "install-codex-supermemory")) {
        const install = this.#toolInstallAction("supermemory-tool-bindings");
        if (install) automaticInstalls.push(install);
      }
      configWrites.push({ id: "codex-config:supermemory", kind: "codex-config-preview", title: "Register the official Supermemory plugin hooks through the reviewed Codex plan", capabilityId: "supermemory-tool-bindings", status: "ready" });
    }
    const teamApplications: RunnerAction[] = [{ id: "codex-developer-team", kind: "apply-team-bundle", title: "Apply and verify Codex Developer Team content", capabilityId: "developer-team", status: "ready", required: true }];
    const validations: RunnerAction[] = [
      { id: "codex-verify", kind: "validate", title: "Verify Codex managed content and runtime readiness", status: "ready", required: true },
    ];
    return {
      groups: { automaticInstalls, manualSteps, configWrites, teamApplications, validations },
      diagnostics: [
        ...staticCompatibleGapDiagnostics,
        ...manualSteps.map((action) => ({
          code: action.id,
          severity: action.status === "blocked" ? "error" as const : "info" as const,
          capabilityId: action.capabilityId,
          actionId: action.id,
          message: action.diagnostics?.join("; ") ?? action.title,
        })),
      ],
      ready: manualSteps.every((action) => action.status !== "blocked")
        && inventory.capabilities.every((capability) => capability.requirementLevel !== "required" || !capability.isBlocked || isApprovedStaticCompatibleGap(capability.capabilityId)),
    };
  }
  /** Reviewed Deck-owned install action for a capability whose executable or artifact is not yet verified. */
  #toolInstallAction(capabilityId: string): RunnerAction | undefined {
    const tools = this.#tools;
    switch (capabilityId) {
      case "rtk":
        return tools.rtk.state() === "ready" || !tools.rtk.supported()
          ? undefined
          : { id: "codex.tool.rtk.install", kind: "install-codex-rtk", title: "Install and verify the pinned RTK release in Deck-owned shared tools", capabilityId, status: tools.rtk.state() === "conflict" || tools.rtk.state() === "unusable" ? "blocked" : "ready", required: true };
      case "codebase-memory":
        return tools.codebase.command() !== undefined || !tools.codebase.supported()
          ? undefined
          : { id: "codex.tool.codebase-memory.install", kind: "install-codex-codebase", title: "Install and verify the pinned Codebase Memory native release in Deck-owned shared tools", capabilityId, status: tools.codebase.state() === "conflict" || tools.codebase.state() === "unusable" ? "blocked" : "ready", required: true };
      case "context-mode":
        return tools.contextMode.command() !== undefined
          ? undefined
          : { id: "codex.tool.context-mode.install", kind: "install-codex-tool", title: "Install and verify Context Mode in Deck-owned shared tools", capabilityId, status: "ready", required: true };
      case "supermemory-tool-bindings":
        return tools.supermemory.state() === "ready"
          ? undefined
          : { id: "codex.official-supermemory.install", kind: "install-codex-supermemory", title: "Install and verify the pinned official Codex Supermemory plugin hooks", capabilityId: "adaptive-memory", status: tools.supermemory.state() === "conflict" ? "blocked" : "ready", required: true };
      default:
        return undefined;
    }
  }
  buildInstallationPlan(state: DashboardState): InstallationPlan {
    const selected = Object.entries(state.selectedCapabilities).filter(([, enabled]) => enabled).map(([id]) => id);
    return {
      steps: [
        { action: "configure", tool: "codex", capabilityId: "developer-team", reason: "Materialize project-scoped Developer Team roles, skills, bootstrap content, and instructions" },
        ...selected.filter((id) => id === "serena").map((capabilityId) => ({ action: "install" as const, tool: capabilityId, capabilityId, reason: "Reuse or provision Serena through the explicitly authorized Core bootstrap before configuring Codex MCP" })),
        ...selected.filter((id) => ["context-mode", "codebase-memory", "rtk"].includes(id)).map((capabilityId) => ({ action: "install" as const, tool: capabilityId, capabilityId, reason: "Reuse or install the verified Deck-owned shared tool before pinning Codex MCP/hook configuration to its absolute path" })),
        ...selected.filter((id) => ["context-mode", "codebase-memory", "rtk", "context7", "web-search", "supermemory-tool-bindings"].includes(id)).map((capabilityId) => ({ action: "configure" as const, tool: capabilityId, capabilityId, reason: "Apply reviewed Codex MCP/hook configuration pinned to verified executables" })),
        { action: "validate", tool: "codex", capabilityId: "codex-runtime", reason: "Verify managed content, trust activation, route classification, and capability readiness" },
      ],
    };
  }
  async prepareDeveloperTeamInstall(input: DeveloperTeamAdapterInstallInput) {
    if (input.materializationScope === "content-only") return [];
    const config = requireDeckConfig(input.deckConfig, "operation");
    const existingConfig = readGlobalConfigSource(this.#roots) ?? "";
    const derivedSupermemoryProjectScope = (() => {
      const resolved = resolveCanonicalSupermemoryProjectScope({ projectRoot: input.projectRoot, remotes: [] });
      return resolved.ok ? resolved.scope : undefined;
    })();
    const capabilityInstructions = bindAdaptiveMemoryInstructionBundle(input.capabilityInstructions
      ?? buildCapabilityInstructionBundle(getEnabledCapabilityInstructionIds(config, "codex"), {
        supermemoryProjectScope: derivedSupermemoryProjectScope,
      }), {
      supermemoryProjectScope: derivedSupermemoryProjectScope,
    });
    if (!this.#selectedMcpCapabilityIds(input, capabilityInstructions, existingConfig, config.webSearch.enabled).includes("serena")) return [];
    const preparation = await this.#prepareSerena(input.projectRoot);
    if (preparation.readiness.state !== "ready") {
      return [{
        code: "codex-serena-launcher-not-ready",
        severity: "error" as const,
        message: "Serena is selected but no healthy Deck-owned launcher is ready. Use the explicitly authorized Serena action in Review; Deck will not write a bare MCP command.",
      }];
    }
    if (preparation.proxy.state !== "ready") {
      return [{
        code: "codex-serena-proxy-not-ready",
        severity: "error" as const,
        message: preparation.proxy.message,
      }];
    }
    return [];
  }
  async runAction(action: RunnerAction, context: RunnerActionContext): Promise<RunnerActionRunResult> {
    const toolResult = await this.#runToolInstallAction(action);
    if (toolResult) return toolResult;
    if (action.capabilityId !== "serena") {
      return { actionId: action.id, status: "informational", message: "Codex project effects are applied through the confirmed Developer Team plan.", diagnostics: [] };
    }
    const result = await this.#serenaBootstrap({
      authorization: context.serenaAuthorization,
      runner: "codex",
      operationId: context.operationId,
      operation: context.operation,
      currentOperation: context.currentOperation,
      signal: context.signal,
    }, this.#serenaBootstrapEffects);
    if (result.outcome !== "reused" && result.outcome !== "installed") {
      const message = result.outcome === "failed"
        ? result.diagnostic.message
        : "Serena provisioning did not produce validated readiness evidence.";
      return { actionId: action.id, status: "failed", message, diagnostics: [message] };
    }
    const readiness = await this.#resolveSerenaReadiness(context.signal);
    if (readiness.state !== "ready") {
      const message = "Serena provisioning completed without a reusable validated launcher; Codex MCP configuration was not planned.";
      return { actionId: action.id, status: "failed", message, diagnostics: [message] };
    }
    const proxy = await this.#serenaProxyProbe();
    const preparation = Object.freeze({ readiness, proxy });
    this.#rememberPendingSerenaPreparation(context.projectRoot, preparation);
    if (proxy.state !== "ready") {
      return { actionId: action.id, status: "failed", message: proxy.message, diagnostics: [proxy.message] };
    }
    return {
      actionId: action.id,
      status: "executed",
      message: result.outcome === "reused" ? "Reused the validated Deck-owned Serena launcher." : "Installed and validated the Deck-owned Serena launcher.",
      diagnostics: [],
      raw: { outcome: result.outcome },
    };
  }
  async #runToolInstallAction(action: RunnerAction): Promise<RunnerActionRunResult | undefined> {
    const tools = this.#tools;
    const fail = (message: string): RunnerActionRunResult => ({ actionId: action.id, status: "failed", message, diagnostics: [] });
    const ok = (message: string): RunnerActionRunResult => ({ actionId: action.id, status: "executed", message, diagnostics: [] });
    try {
      switch (action.kind) {
        case "install-codex-rtk": {
          if (action.capabilityId !== "rtk") return fail("Codex RTK install action is mismatched.");
          const outcome = await tools.rtk.install();
          return ok(outcome === "installed" ? "Pinned RTK installed and verified in Deck-owned shared tools; no global init was run." : "Pinned RTK verified without changes.");
        }
        case "install-codex-codebase": {
          if (action.capabilityId !== "codebase-memory") return fail("Codex Codebase Memory install action is mismatched.");
          if (tools.codebase.existing()) return ok("An existing shared Codebase Memory executable was verified and will be reused.");
          const outcome = await tools.codebase.install();
          return ok(outcome === "installed" ? "Pinned Codebase Memory native executable installed and verified; no session download is needed." : "Pinned Codebase Memory native executable verified without changes.");
        }
        case "install-codex-tool": {
          if (action.capabilityId !== "context-mode") return fail("Codex tool install action is unsupported.");
          if (tools.contextMode.command()) return ok("Context Mode is already available and verified.");
          return await tools.contextMode.install() ? ok("Context Mode was installed and verified.") : fail("Context Mode installation failed or its executable was not verified.");
        }
        case "install-codex-supermemory": {
          if (action.capabilityId !== "adaptive-memory") return fail("Codex Supermemory install action is mismatched.");
          const outcome = await tools.supermemory.install();
          return ok(outcome === "installed" ? "Pinned official Codex Supermemory plugin hooks installed and verified." : "Pinned official Codex Supermemory plugin hooks verified without changes.");
        }
        default:
          return undefined;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 160) : "unknown error";
      return fail(`${action.title} failed: ${detail}`);
    }
  }
  getTeams() { return [DEVELOPER_TEAM]; }
  getModelCatalog(): ModelCatalog {
    const inventory = this.#latestReadyInventory?.inventory;
    const models = inventory ? Object.values(inventory.modelsByProvider).flat().map((model) => ({
      id: model.id,
      displayName: model.displayName,
      providerId: model.providerId,
      capabilities: [
        ...(model.supportsTools ? ["tool-use"] : []),
        ...(model.supportsReasoning ? ["reasoning"] : []),
      ],
      supportsReasoning: model.supportsReasoning ?? undefined,
    })) : [];
    return {
      providers: inventory?.providers.map(({ id, displayName }) => ({ id, displayName })) ?? [],
      models,
      developerTeamDefaults: [],
    };
  }

  async getModelInventory(request: RunnerModelDiscoveryRequest): Promise<RunnerModelInventoryResult> {
    const result = await this.#inventoryDiscovery(request);
    this.#latestReadyInventory = result.state === "ready" ? result : null;
    return result;
  }
  /** Assignments are global: they live in the user's Codex home, whatever project is open. */
  readModelAssignments(_projectRoot?: string) { return readCodexRoleAssignments(this.#roots.codexHome).modelAssignments; }
  readThinkingAssignments(_projectRoot?: string) { return readCodexRoleAssignments(this.#roots.codexHome).thinkingAssignments; }
  getThinkingLevels(modelId?: string): readonly string[] {
    return modelId ? findCodexModel(this.#latestReadyInventory?.inventory, modelId)?.variants ?? [] : [];
  }
  supportsThinking(modelId: string): boolean {
    return this.getThinkingLevels(modelId).length > 0;
  }
  async validateModelAssignments(input: RunnerModelAssignmentValidationInput): Promise<RunnerModelAssignmentValidationResult> {
    const result = await this.getModelInventory({ projectRoot: input.projectRoot, mode: "prefer-cache" });
    if (result.state !== "ready" || (input.expectedFingerprint && input.expectedFingerprint !== result.fingerprint)) {
      return {
        valid: false,
        issues: input.changedAgentIds.map((agentId) => ({
          agentId,
          code: "inventory-not-ready",
          message: "Codex availability must be refreshed from the authenticated catalog before changing this assignment.",
        })),
      };
    }
    const issues: import("@deck/core").RunnerModelAssignmentIssue[] = [];
    for (const agentId of input.changedAgentIds) {
      const modelId = input.modelAssignments[agentId];
      const variant = input.thinkingAssignments[agentId];
      const model = modelId ? findCodexModel(result.inventory, modelId) : undefined;
      if (!model) issues.push({ agentId, code: "model-unavailable", message: "The selected model is unavailable in the active Codex account." });
      else if (variant && !model.variants?.includes(variant)) issues.push({ agentId, code: "variant-unavailable", message: "The selected reasoning effort is unavailable for this Codex model." });
    }
    return issues.length ? { valid: false, issues } : { valid: true, fingerprint: result.fingerprint };
  }
  buildDeveloperTeamInstallPlan(input: DeveloperTeamAdapterInstallInput): RunnerDeveloperTeamInstallPlan & { diagnostics: readonly string[] } {
    const materializationScope = input.materializationScope ?? "full";
    const roots = this.#roots;
    const existing = readExistingGlobalFiles(roots, materializationScope);
    const config = requireDeckConfig(input.deckConfig, "operation");
    const webSearchProvider = this.resolveWebSearchProvider(config.webSearch.provider);
    const existingCodexConfig = existing.files.get(".codex/config.toml") ?? "";
    const memoryProviderId = (input.memoryProvider?.id ?? config.adaptiveMemory.activeProvider) as "none" | "supermemory";
    // The official Codex plugin owns memory alone; Deck's runtime-backed adaptive-memory prose would misdescribe it.
    const enabledCapabilityInstructionIds = getEnabledCapabilityInstructionIds(config, "codex").filter((id) => id !== "adaptive-memory");
    const capabilityInstructions = withoutAdaptiveMemoryFragments(input.capabilityInstructions
      ?? buildCapabilityInstructionBundle(enabledCapabilityInstructionIds));
    const mcpCapabilityIds = materializationScope === "full"
      ? this.#selectedMcpCapabilityIds(input, capabilityInstructions, existingCodexConfig, config.webSearch.enabled)
      : [];
    const serenaPreparation = mcpCapabilityIds.includes("serena")
      ? this.#takePendingSerenaPreparation(input.projectRoot)
      : undefined;
    const tools = this.#tools;
    const nodeCommand = tools.node.command();
    const rtkBinary = tools.rtk.command();
    const supermemoryScripts = tools.supermemory.scripts();
    const rtkRequested = mcpCapabilityIds.includes("rtk") || (materializationScope === "full" && inspectCodexOwnedHookIds(existingCodexConfig).includes("rtk") && input.capabilityIds === undefined);
    let native = buildCodexDeveloperTeamInstallPlan({
      projectRoot: roots.userHome,
      codexHome: roots.codexHome,
      existingFiles: existing.files,
      existingModes: existing.modes,
      agentsFile: existing.agentsFile,
      modelAssignments: input.modelAssignments,
      thinkingAssignments: input.thinkingAssignments,
      capabilityInstructions,
      memoryProvider: memoryProviderId,
      mcpCapabilityIds,
      contextModeCommand: tools.contextMode.command(),
      codebaseMemoryCommand: tools.codebase.command(),
      foreignMcpCommands: this.#foreignMcpCommands(existingCodexConfig),
      ...(rtkRequested && rtkBinary && nodeCommand ? { rtkHook: { nodeCommand, rtkBinary } } : {}),
      ...(memoryProviderId === "supermemory" && supermemoryScripts && nodeCommand ? { supermemoryHooks: { nodeCommand, recallScript: supermemoryScripts.recall, flushScript: supermemoryScripts.flush } } : {}),
      webSearchProviderSupported: webSearchProvider !== undefined,
      webSearchProviderConfigured: config.webSearch.provider !== undefined,
      webSearchProvider,
      webSearchCredentialAvailable: this.#webSearchCredentialAvailable(webSearchProvider),
      webSearchExecutableAvailable: this.#webSearchCommand(webSearchProvider) !== undefined,
      webSearchCommand: this.#webSearchCommand(webSearchProvider),
      materializationScope,
      serenaLauncherAvailable: serenaPreparation?.readiness.state === "ready",
      serenaProxyAvailable: serenaPreparation?.readiness.state === "ready" && serenaPreparation.proxy.state === "ready",
      confirmedModels: this.#latestReadyInventory
        ? Object.values(this.#latestReadyInventory.inventory.modelsByProvider).flat().map((model) => model.id)
        : [],
      confirmedReasoningByModel: this.#latestReadyInventory
        ? Object.fromEntries(Object.values(this.#latestReadyInventory.inventory.modelsByProvider).flat().map((model) => [model.id, model.variants ?? []]))
        : {},
    });
    const extraDiagnostics: RunnerDiagnostic[] = [{ code: "node-path-cas-residual-risk", severity: "warning", message: NODE_PATH_CAS_RESIDUAL_RISK }];
    if (input.localOnly) {
      extraDiagnostics.push({ code: "codex-local-only-ignored", severity: "info", message: "--local-only has no effect for Codex: Deck installs globally under your Codex home and ~/.agents/skills and writes nothing into projects." });
    }
    const legacy = this.#detectLegacyProject(input.projectRoot);
    if (legacy.found) {
      extraDiagnostics.push({
        code: "codex-legacy-project-install",
        severity: "warning",
        message: `A previous per-project Deck install in ${input.projectRoot} (${legacy.unmodified.length + legacy.modified.length} files) overrides the global team files in this project. Run the Codex developer command with --cleanup-legacy to remove it; only unmodified Deck files are deleted and anything you changed is kept.`,
      });
    }
    native = { ...native, diagnostics: [...native.diagnostics, ...extraDiagnostics] };
    const files = native.mutations.filter((mutation) => mutation.operation !== "delete").map((mutation) => ({
      path: mutation.relativePath,
      content: mutation.content,
      kind: mutation.relativePath.includes("/skills/") ? "skill" as const : mutation.relativePath.includes("/agents/") ? "agent" as const : "other" as const,
    }));
    const plan = {
      files,
      ownershipReleases: native.ownershipReleases,
      diagnostics: native.diagnostics.map((diagnostic) => diagnostic.message),
      diagnosticEntries: native.diagnostics.map(({ code, severity, message }) => ({ code, severity, message })),
      blocked: native.blocked,
      mutationPreview: native.mutations.map((mutation) => ({
        action: mutation.operation === "delete" ? "delete" as const : mutation.expected.kind === "absent" ? "create" as const : "update" as const,
        path: mapVirtualPath(roots, mutation.relativePath).absolute,
        preimage: mutation.expected.kind === "absent" ? "absent" : mutation.expected.hash,
        postimage: mutation.operation === "delete" ? "absent" : mutation.postimageHash,
        ownership: `${mutation.ownership.kind}:${mutation.ownership.marker}`,
      })),
    };
    this.#nativePlans.set(plan, native);
    if (serenaPreparation?.readiness.state === "ready" && serenaPreparation.proxy.state === "ready") {
      this.#serenaReadinessByPlan.set(plan, serenaPreparation.readiness);
    }
    const receipt: DeveloperTeamOperationReceipt = Object.freeze({
      runnerId: "codex",
      operationId: randomUUID(),
      transactions: Object.freeze([
        Object.freeze({ kind: "native", id: randomUUID() }),
        Object.freeze({ kind: "native-skills", id: randomUUID() }),
      ]),
    });
    const operation: CodexOperationRecord = { receipt, state: "planned" };
    this.#planOperations.set(plan, operation);
    return plan;
  }

  /** Splits the virtual plan into one transaction per real root: the Codex home and the user's home (skills). */
  #splitPlan(native: CodexMutationPlan): ReadonlyArray<{ kind: "native-skills" | "native"; plan: CodexMutationPlan }> {
    const roots = this.#roots;
    const part = (kind: "native-skills" | "native", root: string, owns: (virtualPath: string) => boolean, strip: (virtualPath: string) => string) => ({
      kind,
      plan: {
        projectRoot: root,
        mutations: native.mutations.filter((mutation) => owns(mutation.relativePath)).map((mutation) => ({ ...mutation, relativePath: strip(mutation.relativePath) })),
        expectedFiles: native.expectedFiles.filter((file) => owns(file.relativePath)).map((file) => ({ ...file, relativePath: strip(file.relativePath) })),
        inventory: native.inventory,
        diagnostics: [],
        blocked: native.blocked,
      } satisfies CodexMutationPlan,
    });
    return [
      part("native-skills", roots.userHome, (path) => !path.startsWith(VIRTUAL_CODEX_PREFIX), (path) => path),
      part("native", roots.codexHome, (path) => path.startsWith(VIRTUAL_CODEX_PREFIX), (path) => path.slice(VIRTUAL_CODEX_PREFIX.length)),
    ];
  }

  async applyDeveloperTeamInstall(input: DeveloperTeamApplyInput): Promise<DeveloperTeamApplyResult> {
    const native = this.#nativePlans.get(input.plan as object);
    const operation = this.#planOperations.get(input.plan as object);
    if (!native || !operation) throw new Error("Codex apply requires the exact reviewed immutable plan.");
    if (operation.state !== "planned") throw new Error(`Codex operation ${operation.receipt.operationId} is already ${operation.state}.`);
    operation.state = "applying";
    const serenaReadiness = this.#serenaReadinessByPlan.get(input.plan as object);
    if (serenaReadiness) {
      const refreshed = await serenaReadiness.revalidate(serenaReadiness.evidence);
      if (!refreshed.valid) {
        operation.state = "failed";
        throw new Error("The validated Serena launcher is no longer reachable; Codex MCP configuration was not written.");
      }
      const proxy = await this.#serenaProxyProbe();
      if (proxy.state !== "ready") {
        operation.state = "failed";
        throw new Error("The effective `deck` command can no longer serve the portable Serena proxy; Codex MCP configuration was not written.");
      }
    }
    const effects = this.#fileEffects ?? createNodeCodexFileEffects({ journalRoot: this.#journalRoot });
    try {
      const appliedJournals: Awaited<ReturnType<typeof applyCodexMutationPlan>>["journal"][] = [];
      try {
        for (const part of this.#splitPlan(native)) {
          if (part.plan.mutations.length === 0) continue;
          const transaction = operation.receipt.transactions.find((entry) => entry.kind === part.kind);
          if (!transaction) throw new Error("Codex operation is missing a transaction identity.");
          const applied = await applyCodexMutationPlan(part.plan, effects, { journalId: transaction.id, operationId: operation.receipt.operationId, operationKind: transaction.kind });
          appliedJournals.push(applied.journal);
        }
      } catch (error) {
        // A later root failed after an earlier root committed: restore the earlier root so the install stays all-or-nothing.
        for (const journal of appliedJournals.reverse()) await rollbackCodexTransaction(journal, effects);
        throw error;
      }
      operation.state = "applied";
      const mutationByPath = new Map(native.mutations.map((mutation) => [mutation.relativePath, mutation]));
      const results: Array<{ agentId: string; kind: string; status: "unchanged" | "updated" | "created" }> = native.expectedFiles.map((expected) => {
        const mutation = mutationByPath.get(expected.relativePath);
        return {
          agentId: expected.relativePath,
          kind: expected.kind,
          status: mutation ? mutation.expected.kind === "absent" ? "created" as const : "updated" as const : "unchanged" as const,
        };
      });
      for (const mutation of native.mutations.filter((entry) => entry.operation === "delete")) {
        results.push({ agentId: mutation.relativePath, kind: mutation.ownership.kind, status: "updated" });
      }
      return {
        results,
        changedCount: native.mutations.length,
        unchangedCount: results.filter((result) => result.status === "unchanged").length,
        operation: operation.receipt,
      };
    } catch (error) {
      operation.state = "failed";
      throw error;
    }
  }
  getNextScreen(state: FlowState): NextScreen { return state.currentScreen === "preflight-checking" ? "team-selection" : state.currentScreen; }
  inspectEnvironment(): Promise<unknown> { return this.inspectProject(process.cwd()); }

  async detectDeckInstall(_input?: import("@deck/core").RunnerDeckInstallInput): Promise<import("@deck/core").RunnerDeckInstallStatus> {
    const roots = this.#roots;
    const manifestPath = mapVirtualPath(roots, CODEX_MANIFEST_PATH).absolute;
    const diagnostics: string[] = [];
    const managedPaths: string[] = [];
    if (inspectSafeProjectPath(roots.codexHome, manifestPath)?.isFile()) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown; files?: unknown };
        if (manifest.version !== 1 || !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) throw new Error("invalid manifest");
        managedPaths.push(manifestPath);
        for (const virtualPath of Object.keys(manifest.files)) {
          if ((!virtualPath.startsWith(".codex/") && !virtualPath.startsWith(".agents/skills/")) || virtualPath.split("/").includes("..")) {
            diagnostics.push(`Codex ownership manifest contains an unsafe managed path: ${virtualPath}.`);
            continue;
          }
          const mapped = mapVirtualPath(roots, virtualPath);
          if (inspectSafeProjectPath(mapped.root, mapped.absolute)?.isFile()) managedPaths.push(mapped.absolute);
          else if (existsSync(mapped.absolute)) diagnostics.push(`Codex ownership manifest contains an unsafe managed path: ${virtualPath}.`);
        }
      } catch {
        diagnostics.push("Codex Deck ownership manifest is malformed; sync is blocked until it is repaired.");
        return { installed: true, managedPaths: [manifestPath], diagnostics };
      }
    }
    return { installed: managedPaths.length > 0, managedPaths: [...new Set(managedPaths)].sort(), diagnostics };
  }

  /**
   * Finds a pre-global, per-project Deck install through its old ownership manifest. Read-only: files whose bytes still
   * match the recorded hash are "unmodified" (safe to remove on request); anything else is reported and preserved.
   */
  #detectLegacyProject(projectRoot: string): { found: boolean; manifestPath: string; unmodified: string[]; modified: string[] } {
    const result = { found: false, manifestPath: join(projectRoot, ".codex", "deck-manifest.json"), unmodified: [] as string[], modified: [] as string[] };
    try {
      if (!inspectSafeProjectPath(projectRoot, result.manifestPath)?.isFile()) return result;
      const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as { version?: unknown; files?: Record<string, unknown> };
      if (manifest.version !== 1 || !manifest.files || typeof manifest.files !== "object") return result;
      result.found = true;
      for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
        if (relativePath === "AGENTS.md" || typeof expectedHash !== "string" || relativePath.startsWith("/") || relativePath.split("/").includes("..")) continue;
        const absolute = join(projectRoot, relativePath);
        const stat = inspectSafeProjectPath(projectRoot, absolute);
        if (!stat?.isFile()) continue;
        (sha256(readFileSync(absolute, "utf8")) === expectedHash ? result.unmodified : result.modified).push(relativePath);
      }
    } catch { /* an unreadable legacy manifest is simply not reported as an install */ }
    return result;
  }

  /**
   * Opt-in removal of a legacy per-project Deck install. Only files whose bytes still equal the legacy manifest hash are
   * deleted (transactionally, with rollback); project config keeps everything outside Deck's marked blocks; modified or
   * unknown files are never touched. The caller must have obtained explicit consent before calling this.
   */
  async cleanupLegacyInstall(projectRoot: string): Promise<{ removed: readonly string[]; preserved: readonly string[]; diagnostics: readonly string[] }> {
    const legacy = this.#detectLegacyProject(projectRoot);
    if (!legacy.found) return { removed: [], preserved: [], diagnostics: ["No legacy per-project Deck install was found."] };
    const mutations: CodexMutation[] = [];
    const preserved = [...legacy.modified];
    const diagnostics: string[] = [];
    const manifest = JSON.parse(readFileSync(legacy.manifestPath, "utf8")) as { files: Record<string, string> };
    for (const relativePath of legacy.unmodified) {
      if (relativePath === ".codex/config.toml") continue; // handled below: only Deck's marker-owned blocks leave the file
      const absolute = join(projectRoot, relativePath);
      const content = readFileSync(absolute, "utf8");
      const mode = lstatSync(absolute).mode & 0o777;
      mutations.push({ operation: "delete", relativePath, expected: { kind: "file", hash: sha256(content), mode }, postimageHash: sha256(""), postimageMode: mode, ownership: { kind: "deck-file", marker: `legacy:${relativePath}` }, rollback: "restore", content: "" });
    }
    // A project config keeps everything outside Deck's marker-owned MCP and hook blocks, whether or not the user edited it.
    const configIndex = preserved.indexOf(".codex/config.toml");
    if (configIndex >= 0) preserved.splice(configIndex, 1);
    const configPath = join(projectRoot, ".codex", "config.toml");
    if (inspectSafeProjectPath(projectRoot, configPath)?.isFile() && (legacy.unmodified.includes(".codex/config.toml") || legacy.modified.includes(".codex/config.toml"))) {
      const source = readFileSync(configPath, "utf8");
      const withoutHooks = mergeCodexOwnedHooks(source, []);
      const withoutMcp = withoutHooks.status === "blocked" ? undefined : mergeCodexMcpServers(withoutHooks.content, []);
      if (!withoutMcp || withoutMcp.status === "blocked") {
        preserved.push(".codex/config.toml");
        diagnostics.push("The project's .codex/config.toml could not be edited safely and was kept; remove Deck's marked blocks yourself.");
      } else if (withoutMcp.content !== source) {
        const mode = lstatSync(configPath).mode & 0o777;
        const remaining = withoutMcp.content.trim();
        if (remaining === "" || remaining === "[features]\nmulti_agent = true") {
          mutations.push({ operation: "delete", relativePath: ".codex/config.toml", expected: { kind: "file", hash: sha256(source), mode }, postimageHash: sha256(""), postimageMode: mode, ownership: { kind: "toml-key", marker: "legacy:deck-only-config" }, rollback: "restore", content: "" });
        } else {
          mutations.push({ relativePath: ".codex/config.toml", expected: { kind: "file", hash: sha256(source), mode }, postimageHash: sha256(withoutMcp.content), postimageMode: mode, ownership: { kind: "toml-key", marker: "legacy:deck-marked-blocks" }, rollback: "restore", content: withoutMcp.content });
          diagnostics.push("Removed only Deck's marker-owned blocks from the project's .codex/config.toml; the rest of the file is yours and was kept.");
        }
      }
    }
    mutations.push(...(() => {
      const absolute = legacy.manifestPath;
      const content = readFileSync(absolute, "utf8");
      const mode = lstatSync(absolute).mode & 0o777;
      return [{ operation: "delete" as const, relativePath: ".codex/deck-manifest.json", expected: { kind: "file" as const, hash: sha256(content), mode }, postimageHash: sha256(""), postimageMode: mode, ownership: { kind: "deck-manifest" as const, marker: "legacy:manifest" }, rollback: "restore" as const, content: "" }];
    })());
    void manifest;
    if (mutations.length > 0) {
      const effects = this.#fileEffects ?? createNodeCodexFileEffects({ journalRoot: this.#journalRoot });
      await applyCodexMutationPlan({
        projectRoot,
        mutations,
        expectedFiles: [],
        inventory: { agentRoleIds: [], agentBoundSkillIds: [], externalStandaloneSkillIds: [], bootstrapSkillIds: [] },
        diagnostics: [],
        blocked: false,
      }, effects, { operationKind: "legacy-cleanup" });
    }
    if (preserved.length > 0) diagnostics.push(`Kept ${preserved.length} file(s) that no longer match Deck's recorded bytes: ${preserved.join(", ")}. Review them yourself.`);
    return { removed: mutations.filter((mutation) => mutation.operation === "delete").map((mutation) => mutation.relativePath), preserved, diagnostics };
  }

  async diagnoseProject(projectRoot: string, deckConfig: NormalizedDeckConfig): Promise<ReadonlyArray<{ category: string; status: "ok" | "warning" | "error"; message: string; suggestion?: string }>> {
    requireDeckConfig(deckConfig, "doctor diagnostics");
    const inspection = await this.inspectProject(projectRoot);
    const install = await this.detectDeckInstall({ projectRoot });
    const installInput = { projectRoot, environmentId: "codex-development" as const, deckConfig };
    await this.prepareDeveloperTeamInstall(installInput);
    const preparedSerena = this.#pendingSerenaPreparationByProject.get(resolve(projectRoot));
    const plan = this.buildDeveloperTeamInstallPlan(installInput);
    const freshReadiness = preparedSerena?.readiness ?? await this.#resolveSerenaReadiness();
    const freshProxy = preparedSerena?.proxy ?? (freshReadiness.state === "ready" ? await this.#serenaProxyProbe() : undefined);
    const inventory = await this.#getCapabilityInventory(
      { projectRoot, environmentId: "codex-development", runnerId: "codex", deckConfig },
      freshReadiness,
      freshProxy,
    );
    const roleAssignmentRead = readCodexRoleAssignments(this.#roots.codexHome);
    const effects = this.#fileEffects ?? createNodeCodexFileEffects({ journalRoot: this.#journalRoot });
    const journals = await effects.listJournals();
    const checks: Array<{ category: string; status: "ok" | "warning" | "error"; message: string; suggestion?: string }> = [];
    checks.push({ category: "Binary and version", status: inspection.state === "unsupported" || inspection.state === "blocked" ? "error" : "ok", message: inspection.evidence.binary === true ? `Codex ${String(inspection.evidence.version ?? "unknown")} detected.` : "Codex binary is unavailable.", suggestion: inspection.evidence.binary === true ? undefined : "Install a supported Codex CLI release." });
    checks.push({ category: "Trust activation", status: inspection.evidence.trust === "trusted" ? "ok" : "warning", message: inspection.evidence.trust === "trusted" ? "Project-local Codex configuration is trusted and active." : "Project trust is absent or indeterminate; Deck did not change trust.", suggestion: inspection.evidence.trust === "trusted" ? undefined : "Review the repository and activate trust through Codex if appropriate." });
    checks.push({ category: "Execution safety", status: "warning", message: "Deck always launches Codex Developer Team with --dangerously-bypass-approvals-and-sandbox; sandboxing and command approvals are disabled, so Codex may modify/delete files or run commands without approval.", suggestion: "Run this command only when you intend to grant Codex unrestricted execution for this launch." });
    checks.push({ category: "Managed content", status: plan.blocked ? "error" : plan.files.length > 0 && install.installed ? "warning" : "ok", message: plan.blocked ? plan.diagnostics.join("; ") : install.installed ? plan.files.length > 0 ? `${plan.files.length} managed files are stale or incomplete.` : "Roles, all skill classes, bootstrap skills, package instructions, and ownership metadata match." : "No Deck-managed Codex installation was detected.", suggestion: plan.blocked ? "Resolve collisions before applying the reviewed plan." : plan.files.length > 0 ? "Preview and confirm the Codex repair plan." : undefined });
    if (roleAssignmentRead.diagnostics.length > 0) {
      checks.push({
        category: "Model assignments",
        status: "warning",
        message: "Some Codex role model assignments could not be read safely.",
        suggestion: roleAssignmentRead.diagnostics[0],
      });
    }
    for (const capability of inventory.capabilities) {
      const notApplicable = capability.supportStatus === "not-applicable";
      checks.push({
        category: `Capability: ${capability.label}`,
        status: capability.isBlocked ? "error" : capability.isInstalled ? "ok" : "warning",
        message: capability.diagnostics?.join("; ") || (notApplicable
          ? `Not applicable to ${this.runnerId}.`
          : capability.capabilityId === "supermemory-tool-bindings" && capability.isInstalled
            ? "The pinned official Supermemory plugin hooks are installed; the launch injects the selected profile credential into the Codex process only."
            : capability.isInstalled ? "Ready." : "Not ready."),
        suggestion: capability.isInstalled || notApplicable
          ? undefined
          : capability.capabilityId === "supermemory-tool-bindings"
            ? "Select Supermemory in the Deck TUI (Review & Install) to install the pinned official Codex plugin hooks and store the profile credential."
            : capability.capabilityId === "serena"
              ? capability.isBlocked
                ? "Resolve the Deck-owned Serena launcher state before configuring Codex MCP."
                : "Explicitly select Serena in Review to reuse or provision it before configuring Codex MCP."
            : ["rtk", "context-mode", "codebase-memory"].includes(capability.capabilityId)
              ? "Select it in the Deck TUI (Review & Install) to install the verified Deck-owned shared tool and pin the Codex configuration to it."
              : "Review this capability in the Codex installation plan.",
      });
    }
    for (const mode of ["interactive", "exec", "resume-by-id", "resume-latest"] as const) {
      const launchInput: RunnerLaunchInput = mode === "exec"
        ? { projectRoot, teamId: "developer-team", mode, prompt: [], stdin: "closed", deckConfig }
        : mode === "resume-by-id"
          ? { projectRoot, teamId: "developer-team", mode, sessionId: "doctor-session", deckConfig }
          : { projectRoot, teamId: "developer-team", mode, deckConfig };
      const launch = await this.buildLaunchPlan(launchInput);
      checks.push({ category: `Execution route: ${mode}`, status: launch.status === "ready" ? "warning" : launch.status === "unsupported" ? "warning" : "error", message: launch.status === "ready" ? `${mode}: static-compatible.` : `${mode}: ${launch.status} (${launch.code}).`, suggestion: launch.status === "ready" ? "No shipped authenticated Codex host lifecycle is available; continue only with the documented static-compatible controls." : undefined });
    }
    const activeJournals = journals.filter((journal) => journal.state !== "verified" && journal.state !== "rolled-back");
    checks.push({ category: "Rollback and recovery", status: activeJournals.some((journal) => journal.state === "conflict") ? "error" : activeJournals.length > 0 ? "warning" : "ok", message: activeJournals.length === 0 ? "No incomplete Codex transactions." : `${activeJournals.length} transaction(s) require recovery; ${activeJournals.filter((journal) => journal.state === "conflict").length} contain conflicts.`, suggestion: activeJournals.length > 0 ? "Use the reviewed Codex recovery action; never discard user edits." : undefined });
    return checks;
  }
  reviewTools(): Promise<unknown> { return Promise.resolve({ runnerId: this.runnerId, staticCompatible: true }); }
  backupDeveloperTeamFiles(plan: unknown): import("@deck/core").RunnerBackupResult {
    const operation = plan && typeof plan === "object" ? this.#planOperations.get(plan) : undefined;
    return operation
      ? { payload: operation.receipt, diagnostics: [] }
      : { payload: undefined, diagnostics: ["Unknown Codex installation plan; no operation receipt was issued."] };
  }
  async rollbackDeveloperTeamFiles(backup: unknown): Promise<import("@deck/core").RunnerRollbackResult> {
    const receipt = operationReceiptFrom(backup);
    if (!receipt) return { status: "nothing-to-do", conflicts: [], diagnostics: ["No valid Codex operation receipt was supplied."] };
    const effects = this.#fileEffects ?? createNodeCodexFileEffects({ journalRoot: this.#journalRoot });
    const conflicts: string[] = [];
    const diagnostics: string[] = [];
    let found = 0;
    for (const transaction of [...receipt.transactions].reverse()) {
      const journal = await effects.readJournal(transaction.id);
      if (!journal) {
        diagnostics.push(`Transaction journal ${transaction.id} is unavailable.`);
        continue;
      }
      found += 1;
      if (journal.operationId !== receipt.operationId || journal.operationKind !== transaction.kind) {
        diagnostics.push(`Transaction journal ${transaction.id} does not belong to operation ${receipt.operationId}.`);
        continue;
      }
      const result = await rollbackCodexTransaction(journal, effects);
      conflicts.push(...result.conflicts);
    }
    if (found === 0) return { status: "nothing-to-do", conflicts: [], diagnostics };
    if (conflicts.length > 0 || diagnostics.length > 0) {
      diagnostics.push(...(conflicts.length > 0 ? [`Rollback conflicts: ${conflicts.join(", ")}`] : []));
      return { status: "conflict", conflicts, diagnostics };
    }
    return { status: "rolled-back", conflicts: [], diagnostics: [] };
  }
  async verifyDeveloperTeamInstall(plan: unknown): Promise<{ valid: boolean; diagnostics: readonly string[] }> {
    const native = this.#nativePlans.get(plan as object);
    if (!native) return { valid: false, diagnostics: ["Unknown Codex installation plan."] };
    const problems: string[] = [];
    const serenaReadiness = this.#serenaReadinessByPlan.get(plan as object);
    for (const expected of native.expectedFiles) {
      const path = mapVirtualPath(this.#roots, expected.relativePath).absolute;
      if (!existsSync(path)) {
        problems.push(`Missing: ${expected.relativePath}`);
        continue;
      }
      const stat = lstatSync(path);
      if (!stat.isFile()) {
        problems.push(`Missing: ${expected.relativePath}`);
        continue;
      }
      const content = readFileSync(path, "utf8");
      if (sha256(content) !== expected.hash) problems.push(`Drifted: ${expected.relativePath}`);
      if ((stat.mode & 0o777) !== expected.mode) problems.push(`Mode drifted: ${expected.relativePath}`);
      if (expected.kind === "config") {
        const semantic = mergeCodexProjectConfig(content, { multiAgent: true });
        if (semantic.status === "blocked" || semantic.content !== content) problems.push(`Invalid config semantics: ${expected.relativePath}`);
      }
      if ((expected.kind === "agent-skill" || expected.kind === "bootstrap-skill")
        && (!content.startsWith("---\n") || !parseSkillDescriptor(content, expected.relativePath.split("/").at(-2)).ok)) {
        problems.push(`Invalid skill descriptor: ${expected.relativePath}`);
      }
    }
    if (serenaReadiness) {
      const config = native.expectedFiles.find((expected) => expected.kind === "config");
      const configPath = config ? mapVirtualPath(this.#roots, config.relativePath).absolute : undefined;
      const configured = configPath && existsSync(configPath) ? isCodexSerenaMcpConfigured(readFileSync(configPath, "utf8")) : false;
      if (!configured) problems.push("Serena MCP launcher configuration is missing or drifted.");
      try {
        const refreshed = await serenaReadiness.revalidate(serenaReadiness.evidence);
        if (!refreshed.valid) problems.push("Serena launcher is no longer reachable after configuration.");
        const proxy = await this.#serenaProxyProbe();
        if (proxy.state !== "ready") problems.push("The effective `deck` command can no longer serve the portable Serena proxy after configuration.");
      } catch {
        problems.push("Serena launcher reachability could not be verified after configuration.");
      }
    }
    return {
      valid: problems.length === 0,
      diagnostics: problems,
    };
  }
  resolveThinking(modelId: string, existingAssignment?: string): string | undefined {
    return existingAssignment && this.getThinkingLevels(modelId).includes(existingAssignment) ? existingAssignment : undefined;
  }
  getDefaultThinking(modelId: string): string {
    const model = findCodexModel(this.#latestReadyInventory?.inventory, modelId);
    return model?.defaultVariant && model.variants?.includes(model.defaultVariant)
      ? model.defaultVariant
      : model?.variants?.[0] ?? "";
  }
  getCapability(capabilityId: string): unknown {
    if (capabilityId === "codex-runtime") {
      return { capabilityId, label: "Codex Runtime", description: "Static-compatible Codex runtime", requirementLevel: "required", supportStatus: "supported", status: "supported", runnerScope: this.runnerId };
    }
    const entry = CODEX_CAPABILITY_CATALOG.find((candidate) => candidate.capabilityId === capabilityId);
    const mapping = getRunnerCapabilityMapping(capabilityId, this.runnerId, [CODEX_RUNNER_CAPABILITY_CONTRIBUTION]);
    if (!entry && !mapping) return undefined;
    const canonical = getCanonicalCapability(capabilityId, [CODEX_RUNNER_CAPABILITY_CONTRIBUTION]);
    const status = entry?.status ?? mapping?.status ?? "gap";
    return {
      capabilityId,
      label: (entry && "label" in entry ? entry.label : undefined) ?? canonical?.label ?? capabilityLabel(capabilityId),
      description: entry ? `${entry.status}: ${entry.provisionMode}` : `${status} Codex capability`,
      requirementLevel: CODEX_PROTECTED_CONTROL_IDS.has(capabilityId)
        || canonical?.requirement === "required"
        || canonical?.requirement === "internal-required"
        ? "required"
        : canonical?.requirement ?? "optional",
      supportStatus: status,
      status,
      runnerScope: this.runnerId,
      implementations: { [this.runnerId]: { id: capabilityId, source: "@deck/adapter-codex", installKind: entry?.provisionMode ?? mapping?.installKind ?? "runner-native" } },
    };
  }
  getCapabilityIds(): readonly string[] {
    return ["codex-runtime", ...CODEX_CAPABILITY_CATALOG.map((entry) => entry.capabilityId)];
  }
  getSelectableTools(): unknown[] { return []; }
}

export function createCodexRunnerAdapter(options: CodexRunnerAdapterOptions = {}): RunnerAdapter {
  return new CodexRunnerAdapter(options);
}

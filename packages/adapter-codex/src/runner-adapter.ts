import { existsSync, lstatSync, readFileSync, readdirSync, type Stats } from "node:fs";
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
  getEnabledPackageInstructionIds,
  readDeckConfig,
  checkSharedBinaryUsability,
  getCanonicalCapability,
  getRunnerCapabilityMapping,
  type SharedBinaryUsabilityResult,
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
  parseSkillDescriptor,
} from "@deck/core";
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/developer-team-catalog";

import { buildCodexDeveloperTeamInstallPlan } from "./developer-team-install";
import { CODEX_CAPABILITY_CATALOG, CODEX_RUNNER_CAPABILITY_CONTRIBUTION } from "./capability-catalog";
import { mergeCodexProjectConfig } from "./codex-config";
import { buildCodexLaunchPlan } from "./launch";
import { composeLocalOnlyExclude } from "./local-only";
import { inspectCodexMcpServerIds, isCodexSupermemoryMcpConfigured } from "./mcp-config";
import { inspectCodexSupermemoryOAuth, type CodexSupermemoryOAuthStatus } from "./mcp-oauth";
import { createNodeCodexFileEffects } from "./node-effects";
import {
  createDefaultCodexModelInventoryDiscovery,
  type CodexProductionModelDiscoveryDependencies,
} from "./codex-model-discovery";
import { inspectCodexProject, type CodexPreflightEffects } from "./preflight";
import { applyCodexMutationPlan, NODE_PATH_CAS_RESIDUAL_RISK, rollbackCodexTransaction, type CodexFileEffects } from "./transaction";
import type { CodexMutationPlan } from "./types";

export type CodexRunnerAdapterOptions = {
  preflight?: CodexPreflightEffects;
  fileEffects?: CodexFileEffects;
  journalRoot?: string;
  gitEffects?: CodexGitEffects;
  mcpCapabilityIds?: readonly string[];
  /** Injected Codex CLI inventory for deterministic adapter tests. */
  inventoryDiscovery?: (request: RunnerModelDiscoveryRequest) => Promise<RunnerModelInventoryResult>;
  /** Partial production command boundary replacement for hermetic discovery tests. */
  productionModelDiscoveryDependencies?: Partial<CodexProductionModelDiscoveryDependencies>;
  sharedBinaryUsability?: (command: string) => Promise<SharedBinaryUsabilityResult>;
  codebaseIndexReadiness?: (projectRoot: string) => boolean | Promise<boolean>;
  /** Read-only native Codex OAuth status inspection; injected for hermetic tests. */
  supermemoryOAuthStatus?: (projectRoot: string) => Promise<CodexSupermemoryOAuthStatus>;
};

export type CodexGitEffects = {
  resolveExcludePath(projectRoot: string): string;
  isTracked(projectRoot: string, relativePath: string): boolean;
};

type CodexOperationRecord = {
  readonly receipt: DeveloperTeamOperationReceipt;
  state: "planned" | "applying" | "applied" | "failed" | "rolled-back";
};

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
  return slug && !slug.includes("/") && !slug.includes("\r") && !slug.includes("\n") ? slug : undefined;
}

function safePersistedReasoning(value: string | undefined): string | undefined {
  const reasoning = boundedAssignmentString(value);
  return reasoning && !reasoning.includes("\r") && !reasoning.includes("\n") ? reasoning : undefined;
}

function readCodexRoleAssignments(projectRoot?: string): CodexRoleAssignmentRead {
  const modelAssignments: import("@deck/core").DeveloperTeamModelAssignments = {};
  const thinkingAssignments: import("@deck/core").DeveloperTeamThinkingAssignments = {};
  const diagnostics: string[] = [];
  if (!projectRoot || projectRoot.trim().length === 0) return { modelAssignments, thinkingAssignments, diagnostics };

  const root = resolve(projectRoot);
  const codexRoot = join(root, ".codex");
  const codexDirectory = inspectSafeProjectReadPath(root, codexRoot, "directory");
  if (codexDirectory.state === "missing") return { modelAssignments, thinkingAssignments, diagnostics };
  if (codexDirectory.state === "unsafe") {
    diagnostics.push(".codex is unsafe or ambiguous; role assignments were ignored.");
    return { modelAssignments, thinkingAssignments, diagnostics };
  }
  const agentsRoot = join(codexRoot, "agents");
  const agentsDirectory = inspectSafeProjectReadPath(root, agentsRoot, "directory");
  if (agentsDirectory.state === "missing") return { modelAssignments, thinkingAssignments, diagnostics };
  if (agentsDirectory.state === "unsafe") {
    diagnostics.push(".codex/agents is unsafe or ambiguous; role assignments were ignored.");
    return { modelAssignments, thinkingAssignments, diagnostics };
  }
  for (const agent of DEVELOPER_TEAM_AGENTS) {
    const relativePath = `.codex/agents/${agent.id}.toml`;
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

function operationReceiptFrom(value: unknown): DeveloperTeamOperationReceipt | undefined {
  const outer = value && typeof value === "object" && "payload" in value ? (value as { payload?: unknown }).payload : value;
  if (!outer || typeof outer !== "object") return undefined;
  const candidate = outer as Partial<DeveloperTeamOperationReceipt>;
  if (candidate.runnerId !== "codex" || typeof candidate.operationId !== "string" || !Array.isArray(candidate.transactions)) return undefined;
  if (candidate.transactions.some((entry) => !entry || typeof entry.kind !== "string" || typeof entry.id !== "string")) return undefined;
  return candidate as DeveloperTeamOperationReceipt;
}

const defaultGitEffects: CodexGitEffects = {
  resolveExcludePath(projectRoot) {
    const result = spawnSync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: projectRoot, encoding: "utf8" });
    if (result.status !== 0) throw new Error("Unable to resolve Git's effective info/exclude path.");
    const value = `${result.stdout}`.trim();
    return isAbsolute(value) ? value : join(projectRoot, value);
  },
  isTracked(projectRoot, relativePath) {
    return spawnSync("git", ["ls-files", "--error-unmatch", "--", relativePath], { cwd: projectRoot, stdio: "ignore" }).status === 0;
  },
};

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

type SafeProjectReadPath =
  | { state: "missing" | "unsafe" }
  | { state: "ready"; stat: Stats };

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

function defaultProbe(): ReturnType<CodexPreflightEffects["probe"]> {
  const version = spawnSync("codex", ["--version"], { encoding: "utf8" });
  if (version.error || version.status !== 0) return Promise.resolve({ found: false });
  const help = spawnSync("codex", ["--help"], { encoding: "utf8" });
  const exec = spawnSync("codex", ["exec", "--help"], { encoding: "utf8" });
  const resume = spawnSync("codex", ["resume", "--help"], { encoding: "utf8" });
  const match = `${version.stdout}`.match(/(\d+\.\d+\.\d+)/);
  return Promise.resolve({ found: true, version: match?.[1] ?? "0.0.0", help: `${help.stdout}`, execHelp: `${exec.stdout}`, resumeHelp: `${resume.stdout}` });
}

function defaultProjectSnapshot(projectRoot: string) {
  const configPath = join(projectRoot, ".codex", "config.toml");
  const listDirectories = (path: string): string[] => {
    if (!existsSync(path)) return [];
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => entry.name);
  };
  return {
    config: existsSync(configPath) ? readFileSync(configPath, "utf8") : null,
    roles: listDirectories(join(projectRoot, ".codex", "agents")),
    skills: listDirectories(join(projectRoot, ".agents", "skills")),
    agentsInstructions: existsSync(join(projectRoot, "AGENTS.md")),
  };
}

function readExistingPlanFiles(projectRoot: string): { files: Map<string, string>; modes: Map<string, number> } {
  const empty = buildCodexDeveloperTeamInstallPlan({ projectRoot, existingFiles: new Map() });
  const existing = new Map<string, string>();
  const modes = new Map<string, number>();
  for (const relativePath of new Set([...empty.mutations.map((mutation) => mutation.relativePath), "AGENTS.md", ".codex/config.toml"])) {
    const absolute = join(projectRoot, relativePath);
    const stat = inspectSafeProjectPath(projectRoot, absolute);
    if (stat?.isFile()) {
      existing.set(relativePath, readFileSync(absolute, "utf8"));
      modes.set(relativePath, stat.mode & 0o777);
    }
  }
  const scanManagedDirectory = (relativeDirectory: string, nestedSkill: boolean): void => {
    const directory = join(projectRoot, relativeDirectory);
    if (!inspectSafeProjectPath(projectRoot, directory)?.isDirectory()) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.name.startsWith("deck-") || entry.isSymbolicLink()) continue;
      const relativePath = nestedSkill ? `${relativeDirectory}/${entry.name}/SKILL.md` : `${relativeDirectory}/${entry.name}`;
      const absolutePath = join(projectRoot, relativePath);
      const stat = inspectSafeProjectPath(projectRoot, absolutePath);
      if (!stat?.isFile()) continue;
      existing.set(relativePath, readFileSync(absolutePath, "utf8"));
      modes.set(relativePath, stat.mode & 0o777);
    }
  };
  scanManagedDirectory(".codex/agents", false);
  scanManagedDirectory(".agents/skills", true);
  const ownershipManifest = existing.get(".codex/deck-manifest.json");
  if (ownershipManifest) {
    try {
      const parsed = JSON.parse(ownershipManifest) as { files?: Record<string, unknown> };
      for (const relativePath of Object.keys(parsed.files ?? {})) {
        const absolutePath = resolve(projectRoot, relativePath);
        const stat = inspectSafeProjectPath(projectRoot, absolutePath);
        if (!stat?.isFile()) continue;
        existing.set(relativePath, readFileSync(absolutePath, "utf8"));
        modes.set(relativePath, stat.mode & 0o777);
      }
    } catch {
      // The planner reads the malformed manifest itself and blocks safely.
    }
  }
  const queue = [{ directory: projectRoot, relativeDirectory: "" }];
  let visitedPaths = 0;
  const maxVisitedPaths = 10_000;
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const entry of readdirSync(current.directory, { withFileTypes: true })) {
      visitedPaths += 1;
      if (visitedPaths > maxVisitedPaths) throw new Error(`AGENTS precedence scan exceeded ${maxVisitedPaths} project paths.`);
      if ([".git", "node_modules", "dist", "build"].includes(entry.name) || entry.isSymbolicLink()) continue;
      const relativePath = current.relativeDirectory ? `${current.relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = join(current.directory, entry.name);
      if (entry.isDirectory()) queue.push({ directory: absolutePath, relativeDirectory: relativePath });
      else if (entry.isFile() && (entry.name === "AGENTS.md" || entry.name === "AGENTS.override.md") && relativePath !== "AGENTS.md") {
        existing.set(relativePath, readFileSync(absolutePath, "utf8"));
        modes.set(relativePath, lstatSync(absolutePath).mode & 0o777);
      }
    }
  }
  return { files: existing, modes };
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
        selectionStatus: "Supermemory selected; Review & Install configures and verifies the server without authorizing it.",
        configuredDiagnostics: ["Codex will configure Supermemory without a token. Authorization remains user-owned."],
      },
      engram: {
        label: "Engram (deferred for Codex)",
        detail: "Engram is unavailable because there is no verified Codex provider contract.",
      },
    },
  } as const;
  readonly #preflight: CodexPreflightEffects;
  readonly #fileEffects?: CodexFileEffects;
  readonly #journalRoot: string;
  readonly #gitEffects: CodexGitEffects;
  readonly #mcpCapabilityIds: readonly string[];
  readonly #inventoryDiscovery: (request: RunnerModelDiscoveryRequest) => Promise<RunnerModelInventoryResult>;
  #latestReadyInventory: Extract<RunnerModelInventoryResult, { state: "ready" }> | null = null;
  readonly #sharedBinaryUsability: NonNullable<CodexRunnerAdapterOptions["sharedBinaryUsability"]>;
  readonly #codebaseIndexReadiness: NonNullable<CodexRunnerAdapterOptions["codebaseIndexReadiness"]>;
  readonly #supermemoryOAuthStatus: NonNullable<CodexRunnerAdapterOptions["supermemoryOAuthStatus"]>;
  readonly #nativePlans = new WeakMap<object, CodexMutationPlan>();
  readonly #localPlans = new WeakMap<object, CodexMutationPlan>();
  readonly #planOperations = new WeakMap<object, CodexOperationRecord>();

  constructor(options: CodexRunnerAdapterOptions = {}) {
    this.#preflight = options.preflight ?? {
      probe: defaultProbe,
      inspectTrust: async () => "indeterminate",
      readProject: async (projectRoot) => defaultProjectSnapshot(projectRoot),
    };
    this.#fileEffects = options.fileEffects;
    this.#gitEffects = options.gitEffects ?? defaultGitEffects;
    this.#mcpCapabilityIds = options.mcpCapabilityIds ?? [];
    this.#inventoryDiscovery = options.inventoryDiscovery
      ?? createDefaultCodexModelInventoryDiscovery(options.productionModelDiscoveryDependencies);
    this.#sharedBinaryUsability = options.sharedBinaryUsability ?? ((command) => checkSharedBinaryUsability(command));
    this.#codebaseIndexReadiness = options.codebaseIndexReadiness ?? ((projectRoot) => existsSync(join(projectRoot, ".codebase-memory", "graph.db")) || existsSync(join(projectRoot, ".codebase-memory", "graph.db.zst")));
    this.#supermemoryOAuthStatus = options.supermemoryOAuthStatus ?? ((projectRoot) => inspectCodexSupermemoryOAuth({ projectRoot }));
    this.#journalRoot = options.journalRoot ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "deck", "backups", "codex");
  }

  async inspectProject(projectRoot: string): Promise<RunnerProjectInspection> {
    return inspectCodexProject(projectRoot, this.#preflight);
  }
  async buildLaunchPlan(input: RunnerLaunchInput): Promise<RunnerLaunchResult> {
    const inspection = await this.inspectProject(input.projectRoot);
    if (inspection.state === "unsupported") return { status: "unsupported", code: "codex-version-unsupported", diagnostics: inspection.diagnostics };
    if (inspection.state === "blocked") return { status: "blocked", code: "codex-preflight-blocked", diagnostics: inspection.diagnostics };
    const newSession = input.mode === "interactive" || input.mode === "exec";
    const features = {
      interactive: inspection.evidence.interactive === true,
      exec: inspection.evidence.exec === true,
      resumeById: inspection.evidence.resume === true,
      resumeLatest: inspection.evidence.resumeLatest === true,
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
    const inspection = await this.inspectProject(input.projectRoot);
    const config = inspection.evidence.projectConfig === true ? defaultProjectSnapshot(input.projectRoot).config ?? "" : "";
    const mcp = new Set(inspectCodexMcpServerIds(config));
    const commands = ["context-mode", "codebase-memory-mcp", "rtk", "serena"] as const;
    const readiness = new Map(await Promise.all(commands.map(async (command) => [command, await this.#sharedBinaryUsability(command)] as const)));
    const supportStatusFor = (capabilityId: string) => CODEX_CAPABILITY_CATALOG.find((entry) => entry.capabilityId === capabilityId)?.status
      ?? getRunnerCapabilityMapping(capabilityId, this.runnerId, [CODEX_RUNNER_CAPABILITY_CONTRIBUTION])?.status
      ?? "supported";
    const capability = (capabilityId: string, label: string, command?: typeof commands[number], mcpId?: string, indexRequired = false) => {
      const binary = command ? readiness.get(command) : undefined;
      const binaryReady = !command || binary?.status === "ready";
      const mcpReady = !mcpId || mcp.has(mcpId);
      return {
        capabilityId,
        label,
        description: `${label} Codex readiness`,
        section: "tools",
        requirementLevel: "optional" as const,
        installKind: "runner-native" as const,
        supportStatus: supportStatusFor(capabilityId),
        isInstalled: binaryReady && mcpReady && !indexRequired,
        isBlocked: binary?.status === "unusable",
        diagnostics: [
          ...(binary && binary.status !== "ready" ? [`${command}: ${binary.status}`] : []),
          ...(!mcpReady ? [`${mcpId}: MCP configuration missing`] : []),
        ],
      };
    };
    const indexReady = await this.#codebaseIndexReadiness(input.projectRoot);
    const codebase = capability("codebase-memory", "Codebase Memory", "codebase-memory-mcp", "codebase-memory");
    codebase.isInstalled &&= indexReady;
    if (!indexReady) codebase.diagnostics.push("codebase-memory: project index not ready");
    const supermemory = capability("supermemory-tool-bindings", "Supermemory", undefined, "supermemory");
    if (supermemory.isInstalled) {
      const oauth = await this.#supermemoryOAuthStatus(input.projectRoot);
      supermemory.isInstalled = oauth.state === "authenticated";
      if (oauth.state === "not-authenticated") {
        supermemory.diagnostics.push("supermemory: configured; pending user authorization.");
      } else if (oauth.state === "not-configured") {
        supermemory.diagnostics.push("supermemory: Codex did not report the reviewed streamable HTTP configuration.");
      } else if (oauth.state === "unsupported") {
        supermemory.diagnostics.push("supermemory: this Codex CLI does not report native OAuth status.");
      } else if (oauth.state === "unknown") {
        supermemory.diagnostics.push("supermemory: OAuth status could not be established safely; run `codex mcp list --json` and sign in if needed.");
      }
    }
    const capabilities: CapabilityInventory["capabilities"][number][] = [
      { capabilityId: "codex-runtime", label: "Codex runtime", description: "Native roles, skills, materialization, and CLI launch", section: "runtime", requirementLevel: "required", installKind: "runner-native", supportStatus: "supported", isInstalled: inspection.evidence.binary === true, isBlocked: inspection.state === "blocked" || inspection.state === "unsupported", diagnostics: inspection.diagnostics.map((diagnostic) => diagnostic.message) },
      capability("context-mode", "Context Mode", "context-mode", "context-mode"),
      codebase,
      capability("rtk", "RTK", "rtk"),
      capability("serena", "Serena", "serena", "serena"),
      capability("context7", "Context7", undefined, "context7"),
      supermemory,
      { ...capability("engram", "Engram"), isInstalled: false, isBlocked: true, diagnostics: ["Engram Codex integration is deferred."] },
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
    const selected = new Set(Object.entries(state.selectedCapabilities).filter(([, enabled]) => enabled).map(([id]) => id));
    const byId = new Map(inventory.capabilities.map((capability) => [capability.capabilityId, capability]));
    const manualSteps: RunnerAction[] = [];
    const configWrites: RunnerAction[] = [];
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
      if (capability.isBlocked) {
        if (isApprovedStaticCompatibleGap(capability.capabilityId)) addStaticCompatibleGap(capability);
        else addBlockedCapability(capability);
      } else if (!capability.isInstalled && ["context-mode", "codebase-memory", "serena", "context7", "supermemory-tool-bindings"].includes(capabilityId)) {
        configWrites.push({ id: `codex-config:${capabilityId}`, kind: "codex-config-preview", title: `Configure ${capability.label} through the reviewed Codex plan`, capabilityId, status: "ready" });
      }
    }
    if (state.adaptiveMemory.provider === "engram") {
      const engram = byId.get("engram");
      if (engram) addBlockedCapability(engram);
      else manualSteps.push({ id: "codex-gap:engram", kind: "pending-source", title: "Engram is not available for Codex", capabilityId: "engram", status: "blocked", diagnostics: ["Engram Codex integration is deferred; no verified provider contract exists."] });
    } else if (state.adaptiveMemory.provider === "supermemory" && !byId.get("supermemory-tool-bindings")?.isInstalled) {
      configWrites.push({ id: "codex-config:supermemory", kind: "codex-config-preview", title: "Configure Supermemory through the reviewed Codex plan", capabilityId: "supermemory-tool-bindings", status: "ready" });
    }
    const teamApplications: RunnerAction[] = [{ id: "codex-developer-team", kind: "apply-team-bundle", title: "Apply and verify Codex Developer Team content", capabilityId: "developer-team", status: "ready", required: true }];
    const validations: RunnerAction[] = [
      { id: "codex-verify", kind: "validate", title: "Verify Codex managed content and runtime readiness", status: "ready", required: true },
    ];
    return {
      groups: { automaticInstalls: [], manualSteps, configWrites, teamApplications, validations },
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
  buildInstallationPlan(state: DashboardState): InstallationPlan {
    const selected = Object.entries(state.selectedCapabilities).filter(([, enabled]) => enabled).map(([id]) => id);
    return {
      steps: [
        { action: "configure", tool: "codex", capabilityId: "developer-team", reason: "Materialize project-scoped Developer Team roles, skills, bootstrap content, and instructions" },
        ...selected.filter((id) => ["context-mode", "codebase-memory", "serena", "context7", "supermemory-tool-bindings"].includes(id)).map((capabilityId) => ({ action: "configure" as const, tool: capabilityId, capabilityId, reason: "Apply reviewed Codex MCP configuration without installing runtime packages" })),
        { action: "validate", tool: "codex", capabilityId: "codex-runtime", reason: "Verify managed content, trust activation, route classification, and capability readiness" },
      ],
    };
  }
  async runAction(action: RunnerAction, _context: RunnerActionContext): Promise<RunnerActionRunResult> { return { actionId: action.id, status: "informational", message: "Codex project effects are applied through the confirmed Developer Team plan.", diagnostics: [] }; }
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
  readModelAssignments(projectRoot?: string) { return readCodexRoleAssignments(projectRoot).modelAssignments; }
  readThinkingAssignments(projectRoot?: string) { return readCodexRoleAssignments(projectRoot).thinkingAssignments; }
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
  buildDeveloperTeamInstallPlan(input: DeveloperTeamAdapterInstallInput) {
    const existing = readExistingPlanFiles(input.projectRoot);
    const config = readDeckConfig(input.projectRoot);
    const capabilityInstructions = input.capabilityInstructions
      ?? buildCapabilityInstructionBundle(getEnabledPackageInstructionIds(config, "codex"));
    let native = buildCodexDeveloperTeamInstallPlan({
      projectRoot: input.projectRoot,
      existingFiles: existing.files,
      existingModes: existing.modes,
      modelAssignments: input.modelAssignments,
      thinkingAssignments: input.thinkingAssignments,
      capabilityInstructions,
      memoryProvider: (input.memoryProvider?.id ?? config.adaptiveMemory.activeProvider) as "none" | "supermemory" | "engram",
      mcpCapabilityIds: [...new Set([...this.#mcpCapabilityIds, ...(input.capabilityIds ?? [])])],
      confirmedModels: this.#latestReadyInventory
        ? Object.values(this.#latestReadyInventory.inventory.modelsByProvider).flat().map((model) => model.id)
        : [],
      confirmedReasoningByModel: this.#latestReadyInventory
        ? Object.fromEntries(Object.values(this.#latestReadyInventory.inventory.modelsByProvider).flat().map((model) => [model.id, model.variants ?? []]))
        : {},
    });
    native = {
      ...native,
      diagnostics: [...native.diagnostics, {
        code: "node-path-cas-residual-risk",
        severity: "warning",
        message: NODE_PATH_CAS_RESIDUAL_RISK,
      }],
    };
    const files = native.mutations.filter((mutation) => mutation.operation !== "delete").map((mutation) => ({
      path: mutation.relativePath,
      content: mutation.content,
      kind: mutation.relativePath.includes("/skills/") ? "skill" as const : mutation.relativePath.includes("/agents/") ? "agent" as const : "other" as const,
    }));
    let localPlan: CodexMutationPlan | undefined;

    if (input.localOnly) {
      try {
        const excludePath = this.#gitEffects.resolveExcludePath(input.projectRoot);
        const excludeExists = existsSync(excludePath);
        const existing = excludeExists ? readFileSync(excludePath, "utf8") : "";
        const exactPaths = native.mutations
          .filter((mutation) => mutation.expected.kind === "absent" && mutation.ownership.kind === "deck-file" && !this.#gitEffects.isTracked(input.projectRoot, mutation.relativePath))
          .map((mutation) => mutation.relativePath);
        const visiblePaths = native.mutations.map((mutation) => mutation.relativePath).filter((path) => !exactPaths.includes(path));
        const composed = composeLocalOnlyExclude(existing, exactPaths);
        if (composed.blocked) throw new Error(composed.diagnostic);
        const excludeMode = excludeExists ? lstatSync(excludePath).mode & 0o777 : 0o644;
        localPlan = {
          projectRoot: dirname(excludePath),
          blocked: false,
          diagnostics: [],
          expectedFiles: [{
            relativePath: basename(excludePath),
            hash: sha256(composed.content),
            content: composed.content,
            mode: excludeMode,
            kind: "git-exclude",
          }],
          inventory: { agentRoleIds: [], agentBoundSkillIds: [], externalStandaloneSkillIds: [], bootstrapSkillIds: [] },
          mutations: composed.content === existing ? [] : [{
            relativePath: basename(excludePath),
            expected: excludeExists ? { kind: "file", hash: sha256(existing), mode: excludeMode } : { kind: "absent" },
            postimageHash: sha256(composed.content),
            postimageMode: excludeMode,
            ownership: { kind: "git-exclude-block", marker: "deck:codex-local-only" },
            rollback: excludeExists ? "restore" : "delete",
            content: composed.content,
          }],
        };
        files.push(...localPlan.mutations.map((mutation) => ({ path: `git-info-exclude:${excludePath}`, content: mutation.content, kind: "other" as const })));
        if (visiblePaths.length > 0) {
          native = {
            ...native,
            diagnostics: [...native.diagnostics, {
              code: "local-only-visible-mutations",
              severity: "warning",
              message: `Tracked or shared mutations remain visible: ${visiblePaths.join(", ")}.`,
            }],
          };
        }
      } catch (error) {
        native = {
          ...native,
          blocked: true,
          diagnostics: [...native.diagnostics, {
            code: "local-only-blocked",
            severity: "error",
            message: error instanceof Error ? error.message : "Unable to prepare exact local-only exclusions.",
          }],
        };
      }
    }

    const plan = {
      files,
      diagnostics: native.diagnostics.map((diagnostic) => diagnostic.message),
      blocked: native.blocked,
      mutationPreview: [
        ...native.mutations.map((mutation) => ({
        action: mutation.operation === "delete" ? "delete" as const : mutation.expected.kind === "absent" ? "create" as const : "update" as const,
        path: mutation.relativePath,
        preimage: mutation.expected.kind === "absent" ? "absent" : mutation.expected.hash,
        postimage: mutation.operation === "delete" ? "absent" : mutation.postimageHash,
        ownership: `${mutation.ownership.kind}:${mutation.ownership.marker}`,
        })),
        ...(localPlan?.mutations ?? []).map((mutation) => ({
          action: mutation.operation === "delete" ? "delete" as const : mutation.expected.kind === "absent" ? "create" as const : "update" as const,
          path: `git-info-exclude:${join(localPlan!.projectRoot, mutation.relativePath)}`,
          preimage: mutation.expected.kind === "absent" ? "absent" : mutation.expected.hash,
          postimage: mutation.operation === "delete" ? "absent" : mutation.postimageHash,
          ownership: `${mutation.ownership.kind}:${mutation.ownership.marker}`,
        })),
      ],
    };
    this.#nativePlans.set(plan, native);
    if (localPlan) this.#localPlans.set(plan, localPlan);
    const receipt: DeveloperTeamOperationReceipt = Object.freeze({
      runnerId: "codex",
      operationId: randomUUID(),
      transactions: Object.freeze([
        Object.freeze({ kind: "native", id: randomUUID() }),
        ...(localPlan ? [Object.freeze({ kind: "local-only", id: randomUUID() })] : []),
      ]),
    });
    const operation: CodexOperationRecord = { receipt, state: "planned" };
    this.#planOperations.set(plan, operation);
    return plan;
  }
  async applyDeveloperTeamInstall(input: DeveloperTeamApplyInput): Promise<DeveloperTeamApplyResult> {
    const native = this.#nativePlans.get(input.plan as object);
    const operation = this.#planOperations.get(input.plan as object);
    if (!native || !operation) throw new Error("Codex apply requires the exact reviewed immutable plan.");
    if (operation.state !== "planned") throw new Error(`Codex operation ${operation.receipt.operationId} is already ${operation.state}.`);
    operation.state = "applying";
    const effects = this.#fileEffects ?? createNodeCodexFileEffects({ journalRoot: this.#journalRoot });
    const nativeTransaction = operation.receipt.transactions.find((entry) => entry.kind === "native");
    const localTransaction = operation.receipt.transactions.find((entry) => entry.kind === "local-only");
    if (!nativeTransaction) throw new Error("Codex operation is missing its native transaction identity.");
    try {
      const applied = await applyCodexMutationPlan(native, effects, { journalId: nativeTransaction.id, operationId: operation.receipt.operationId, operationKind: nativeTransaction.kind });
      const local = this.#localPlans.get(input.plan as object);
      try {
        if (local) {
          if (!localTransaction) throw new Error("Codex local-only operation is missing its transaction identity.");
          await applyCodexMutationPlan(local, effects, { journalId: localTransaction.id, operationId: operation.receipt.operationId, operationKind: localTransaction.kind });
        }
      } catch (error) {
        await rollbackCodexTransaction(applied.journal, effects);
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
      const changedCount = native.mutations.length + (local?.mutations.length ?? 0);
      return {
        results,
        changedCount,
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

  async detectDeckInstall(input?: import("@deck/core").RunnerDeckInstallInput): Promise<import("@deck/core").RunnerDeckInstallStatus> {
    const projectRoot = input?.projectRoot ?? process.cwd();
    const manifestPath = join(projectRoot, ".codex", "deck-manifest.json");
    const diagnostics: string[] = [];
    const managedPaths: string[] = [];
    if (inspectSafeProjectPath(projectRoot, manifestPath)?.isFile()) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown; files?: unknown };
        if (manifest.version !== 1 || !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) throw new Error("invalid manifest");
        managedPaths.push(manifestPath);
        for (const relativePath of Object.keys(manifest.files)) {
          const absolute = resolve(projectRoot, relativePath);
          if (inspectSafeProjectPath(projectRoot, absolute)?.isFile()) managedPaths.push(absolute);
          else if (existsSync(absolute)) diagnostics.push(`Codex ownership manifest contains an unsafe managed path: ${relativePath}.`);
        }
      } catch {
        diagnostics.push("Codex Deck ownership manifest is malformed; sync is blocked until it is repaired.");
        return { installed: true, managedPaths: [manifestPath], diagnostics };
      }
    } else {
      const agentsPath = join(projectRoot, "AGENTS.md");
      if (existsSync(agentsPath) && readFileSync(agentsPath, "utf8").includes("<!-- deck:developer-team:start -->")) managedPaths.push(agentsPath);
    }
    return { installed: managedPaths.length > 0, managedPaths: [...new Set(managedPaths)].sort(), diagnostics };
  }

  async diagnoseProject(projectRoot: string): Promise<ReadonlyArray<{ category: string; status: "ok" | "warning" | "error"; message: string; suggestion?: string }>> {
    const inspection = await this.inspectProject(projectRoot);
    const install = await this.detectDeckInstall({ projectRoot });
    const plan = this.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development" });
    const inventory = await this.getCapabilityInventory({ projectRoot, environmentId: "codex-development", runnerId: "codex" });
    const roleAssignmentRead = readCodexRoleAssignments(projectRoot);
    const effects = this.#fileEffects ?? createNodeCodexFileEffects({ journalRoot: this.#journalRoot });
    const journals = await effects.listJournals();
    const checks: Array<{ category: string; status: "ok" | "warning" | "error"; message: string; suggestion?: string }> = [];
    checks.push({ category: "Binary and version", status: inspection.state === "unsupported" || inspection.state === "blocked" ? "error" : "ok", message: inspection.evidence.binary === true ? `Codex ${String(inspection.evidence.version ?? "unknown")} detected.` : "Codex binary is unavailable.", suggestion: inspection.evidence.binary === true ? undefined : "Install a supported Codex CLI release." });
    checks.push({ category: "Trust activation", status: inspection.evidence.trust === "trusted" ? "ok" : "warning", message: inspection.evidence.trust === "trusted" ? "Project-local Codex configuration is trusted and active." : "Project trust is absent or indeterminate; Deck did not change trust.", suggestion: inspection.evidence.trust === "trusted" ? undefined : "Review the repository and activate trust through Codex if appropriate." });
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
      const supermemoryPendingAuthorization = capability.capabilityId === "supermemory-tool-bindings"
        && capability.diagnostics?.some((diagnostic) => diagnostic.includes("pending user authorization"));
      const supermemoryBrokenConfiguration = capability.capabilityId === "supermemory-tool-bindings"
        && capability.diagnostics?.some((diagnostic) => (
          diagnostic.includes("MCP configuration missing")
          || diagnostic.includes("did not report the reviewed streamable HTTP configuration")
        ));
      checks.push({
        category: `Capability: ${capability.label}`,
        status: capability.isBlocked || supermemoryBrokenConfiguration ? "error" : capability.isInstalled ? "ok" : "warning",
        message: capability.diagnostics?.join("; ") || (notApplicable
          ? `Not applicable to ${this.runnerId}.`
          : capability.capabilityId === "supermemory-tool-bindings" && capability.isInstalled
            ? "Supermemory is configured and authenticated with native Codex OAuth."
            : capability.isInstalled ? "Ready." : "Not ready."),
        suggestion: capability.isInstalled || notApplicable
          ? undefined
          : capability.capabilityId === "supermemory-tool-bindings"
            ? supermemoryPendingAuthorization
              ? "Run codex mcp login supermemory when you are ready to authorize Supermemory."
              : "Apply the reviewed Supermemory MCP configuration and verify it before authorizing Supermemory."
            : "Review this capability in the Codex installation plan; Deck will not reinstall a usable shared binary.",
      });
    }
    for (const mode of ["interactive", "exec", "resume-by-id", "resume-latest"] as const) {
      const launchInput: RunnerLaunchInput = mode === "exec"
        ? { projectRoot, teamId: "developer-team", mode, prompt: [], stdin: "closed" }
        : mode === "resume-by-id"
          ? { projectRoot, teamId: "developer-team", mode, sessionId: "doctor-session" }
          : { projectRoot, teamId: "developer-team", mode };
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
  verifyDeveloperTeamInstall(plan: unknown): { valid: boolean; diagnostics: readonly string[] } {
    const native = this.#nativePlans.get(plan as object);
    if (!native) return { valid: false, diagnostics: ["Unknown Codex installation plan."] };
    const problems: string[] = [];
    for (const expected of native.expectedFiles) {
      const path = join(native.projectRoot, expected.relativePath);
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
    const local = this.#localPlans.get(plan as object);
    if (local) {
      for (const expected of local.expectedFiles) {
        const path = join(local.projectRoot, expected.relativePath);
        if (!existsSync(path)) {
          problems.push(`Missing or drifted: git-info-exclude:${path}`);
          continue;
        }
        const stat = lstatSync(path);
        if (!stat.isFile() || sha256(readFileSync(path, "utf8")) !== expected.hash || (stat.mode & 0o777) !== expected.mode) {
          problems.push(`Missing or drifted: git-info-exclude:${path}`);
        }
      }
    }
    const verificationEvidence = problems.length === 0
      && native.expectedFiles.some((expected) => expected.kind === "config" && isCodexSupermemoryMcpConfigured(expected.content))
      ? [{ id: "mcp:supermemory" }]
      : [];
    const postInstallFollowUps = verificationEvidence.length > 0
      ? [{
          id: "supermemory-user-authorization",
          message: "Run codex mcp login supermemory when you are ready to authorize Supermemory.",
        }]
      : [];
    return {
      valid: problems.length === 0,
      diagnostics: problems,
      ...(verificationEvidence.length > 0 ? { verificationEvidence } : {}),
      ...(postInstallFollowUps.length > 0 ? { postInstallFollowUps } : {}),
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

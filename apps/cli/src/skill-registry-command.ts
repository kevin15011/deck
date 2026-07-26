import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";

import type {
  AdapterRegistry,
  RunnerAdapter,
  SkillDiscoveryDiagnosticV1,
  SkillDiscoverySourceBindingV1,
  SkillDiscoverySourceProviderV1,
  SkillDiscoverySourceSetV1,
  SkillRegistryStatusV1,
  SkillRegistryWriteActionV1,
  SkillRegistryWriteAuthorityV1,
  SkillRegistryWriteTargetsV1,
  SkillRegistryWriterV1,
} from "@deck/core";
import { SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA, SKILL_DISCOVERY_V1_BOUNDS } from "@deck/core";

import { createDefaultAdapterRegistry } from "./runner-adapters";
import {
  createCoreGenericProjectSources,
  discoverSkills,
  discoverSkillsFromProvider,
  type BoundedSkillDiscoveryResultV1,
} from "../../../packages/core/src/skill-discovery/discovery";
import {
  canonicalizeSkillRegistry,
  readSkillRegistryStatus,
  type SkillRegistryCurrentEvaluationV1,
} from "../../../packages/core/src/skill-discovery/registry";

const REGISTRY_PATH = ".atl/skill-registry.md" as const;
const GITIGNORE_PATH = ".gitignore" as const;
const CLI_RESULT_SCHEMA = "skill-registry-cli-result-v1" as const;
const SAFE_RUNNER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const SAFE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_LOCATOR_PATTERN = /^[A-Za-z0-9._~:/@+%=-]{1,512}$/;

export type SkillRegistryCommandArgs = {
  command: "skill-registry-validate" | "skill-registry-discover" | "skill-registry-refresh";
  flags: {
    runner?: string;
    root?: string;
    json?: boolean;
  };
};

export interface SkillRegistryCommandDependencies {
  /** Injected in tests; the default composes the registered runner adapters. */
  readonly adapterRegistry?: AdapterRegistry;
  /** Override TTY detection for deterministic command tests. */
  readonly isInteractive?: boolean;
  /** Select one already-registered runner; selection never aggregates runners. */
  readonly selectRunner?: (
    runnerIds: readonly string[],
  ) => string | undefined | Promise<string | undefined>;
  /** Explicit top-level refresh authorization. Undefined means denied/unavailable. */
  readonly mintRefreshAuthority?: (
    input: RefreshAuthorityInput,
  ) => SkillRegistryWriteAuthorityV1 | undefined | Promise<SkillRegistryWriteAuthorityV1 | undefined>;
  /** Compatibility name for callers that model the same explicit authorization boundary. */
  readonly authorizeRefresh?: (
    input: RefreshAuthorityInput,
  ) => SkillRegistryWriteAuthorityV1 | undefined | Promise<SkillRegistryWriteAuthorityV1 | undefined>;
  /** Injected writer factory for isolated command tests. */
  readonly createWriter?: (options: RefreshWriterOptions) => SkillRegistryWriterV1;
}

export interface SkillRegistryCommandResult {
  readonly exitCode: 0 | 1 | 2;
  /** Stable, privacy-safe machine output. */
  readonly json: Readonly<Record<string, unknown>>;
  /** Stable, privacy-safe human output. */
  readonly human: string;
}

type Operation = "validate" | "discover" | "refresh";
type SafeTarget = ".atl/skill-registry.md" | ".gitignore";

interface RefreshAuthorityInput {
  readonly projectRoot: string;
  readonly projectRootDigest: `sha256:${string}`;
  readonly action: SkillRegistryWriteActionV1;
  readonly activeRunnerId: string;
  readonly allowedTargets: SkillRegistryWriteTargetsV1;
}

interface RefreshWriterOptions {
  readonly projectRoot: string;
}

interface FileSnapshot {
  readonly exists: boolean;
  readonly digest: "missing" | `sha256:${string}`;
  readonly bytes?: Buffer;
  readonly text?: string;
}

/**
 * Execute one explicit `skill-registry` operation.
 *
 * Read-only operations never load the persistence module. Refresh is the only
 * path that dynamically loads and invokes the writer after explicit command
 * authorization has been converted into an opaque, exact-scope authority.
 */
interface BoundedSourceSetResult {
  readonly sourceSet: SkillDiscoverySourceSetV1;
  readonly truncated: boolean;
}

function normalizeSourceSet(
  sourceSet: SkillDiscoverySourceSetV1,
  coreSources: readonly SkillDiscoverySourceBindingV1[] = [],
): BoundedSourceSetResult {
  const unavailable = (): BoundedSourceSetResult => ({
    sourceSet: {
      outcome: "indeterminate",
      reasonCode: "partial_source_evaluation",
      sources: [],
      diagnostics: [{ code: "source_provider_unavailable", message: "The source provider was unavailable." }],
    },
    truncated: true,
  });

  if (!isSourceSet(sourceSet)) return unavailable();

  try {
    const sourceArray = sourceSet.sources;
    const sourceLength = sourceArray.length;
    if (!Number.isSafeInteger(sourceLength) || sourceLength < 0) return unavailable();

    const maxCandidateRecords = SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords;
    const inspectedCount = Math.min(sourceLength, maxCandidateRecords + 1);
    const coreSourceIds = new Set(coreSources.map((source) => source.declaration.sourceId));
    const boundedSources: SkillDiscoverySourceBindingV1[] = [];
    for (let index = 0; index < inspectedCount; index += 1) {
      const binding = sourceArray[index];
      if (
        index < maxCandidateRecords &&
        binding !== undefined &&
        !coreSourceIds.has(binding.declaration.sourceId)
      ) boundedSources.push(binding);
    }

    const composedSources = [...coreSources, ...boundedSources];

    if (sourceLength > maxCandidateRecords) {
      return {
        sourceSet: {
          outcome: "indeterminate",
          reasonCode: "partial_source_evaluation",
          sources: composedSources,
          diagnostics: sourceSet.diagnostics,
        },
        truncated: true,
      };
    }

    return {
      sourceSet: { ...sourceSet, sources: composedSources },
      truncated: false,
    };
  } catch {
    return unavailable();
  }
}

function boundedSourceProvider(
  provider: SkillDiscoverySourceProviderV1,
  onNormalization: (truncated: boolean) => void,
): SkillDiscoverySourceProviderV1 {
  return {
    ...provider,
    async listSources(input) {
      const normalized = normalizeSourceSet(await provider.listSources(input));
      onNormalization(normalized.truncated);
      return normalized.sourceSet;
    },
  };
}

function markTruncatedDiscovery(
  discovery: BoundedSkillDiscoveryResultV1,
  truncated: boolean,
): BoundedSkillDiscoveryResultV1 {
  if (!truncated) return discovery;
  return {
    outcome: "indeterminate",
    reasonCode: "truncated_output",
    observations: discovery.observations,
    diagnostics: discovery.diagnostics,
  };
}

export async function runSkillRegistryCommand(
  args: SkillRegistryCommandArgs,
  dependencies: SkillRegistryCommandDependencies = {},
): Promise<SkillRegistryCommandResult> {
  const operation = operationFor(args.command);
  const interactive = dependencies.isInteractive ?? Boolean(process.stdin.isTTY);
  let activeRunnerId = args.flags.runner;

  if (!activeRunnerId) {
    if (operation !== "refresh" || args.flags.json || !interactive) {
      return usageFailure(operation, "runner_required");
    }

    const adapterRegistry = dependencies.adapterRegistry ?? createDefaultAdapterRegistry();
    const runnerIds = adapterRegistry.list().map((adapter) => adapter.runnerId);
    activeRunnerId = await selectInteractiveRunner(runnerIds, dependencies.selectRunner);
    if (!activeRunnerId || !runnerIds.includes(activeRunnerId)) {
      return usageFailure(operation, "runner_required");
    }
  }

  if (!SAFE_RUNNER_ID_PATTERN.test(activeRunnerId)) {
    return usageFailure(operation, "invalid_runner");
  }

  const adapterRegistry = dependencies.adapterRegistry ?? createDefaultAdapterRegistry();
  let adapter: RunnerAdapter;
  try {
    // Active-runner-only composition: one direct lookup, never list-based discovery.
    adapter = adapterRegistry.get(activeRunnerId);
  } catch {
    return usageFailure(operation, "runner_not_registered", activeRunnerId);
  }

  const rootResult = await resolveProjectRoot(args.flags.root);
  if ("error" in rootResult) {
    return operationFailure(operation, "partial_source_evaluation", rootResult.error);
  }

  const projectRoot = rootResult.projectRoot;
  const provider = adapter.skillDiscovery;

  if (operation === "validate") {
    return runValidate(projectRoot, activeRunnerId, provider);
  }

  if (operation === "discover") {
    return runDiscover(projectRoot, activeRunnerId, provider);
  }

  return runRefresh(projectRoot, activeRunnerId, provider, dependencies);
}

async function runValidate(
  projectRoot: string,
  activeRunnerId: string,
  provider?: SkillDiscoverySourceProviderV1,
): Promise<SkillRegistryCommandResult> {
  try {
    const status = await readSkillRegistryStatus({
      projectRoot,
      evaluateCurrent: () => evaluateCurrentSources(projectRoot, activeRunnerId, provider),
    });
    const json: Record<string, unknown> = {
      schema: CLI_RESULT_SCHEMA,
      command: "deck skill-registry validate",
      active_runner_id: activeRunnerId,
      status: status.status,
      reason_code: status.reason_code,
      registry_path: status.registry_path,
      next_action: nextActionForStatus(status.status),
    };
    addStatusDetails(json, status, projectRoot);
    return makeResult(status.status === "ready" ? 0 : 1, json);
  } catch {
    return operationFailure("validate", "partial_source_evaluation", "Validation could not be completed safely.");
  }
}

async function runDiscover(
  projectRoot: string,
  activeRunnerId: string,
  provider?: SkillDiscoverySourceProviderV1,
): Promise<SkillRegistryCommandResult> {
  let sourceSetTruncated = false;
  const boundedProvider = provider
    ? boundedSourceProvider(provider, (truncated) => {
        sourceSetTruncated = sourceSetTruncated || truncated;
      })
    : undefined;
  const discovery = boundedProvider
    ? await discoverSkillsFromProvider({
        projectRoot,
        activeRunnerId,
        provider: boundedProvider,
      })
    : unavailableDiscovery();
  const boundedDiscovery = markTruncatedDiscovery(discovery, sourceSetTruncated);
  const diagnostics = boundDiagnostics(boundedDiscovery.diagnostics, projectRoot);
  const locators = boundedDiscovery.observations
    .map((observation) => safeLocator(observation.locator, projectRoot))
    .filter((locator): locator is string => locator !== undefined);
  const json: Record<string, unknown> = {
    schema: CLI_RESULT_SCHEMA,
    command: "deck skill-registry discover",
    active_runner_id: activeRunnerId,
    outcome: boundedDiscovery.outcome,
    candidate_count: boundedDiscovery.observations.length,
    locators,
    diagnostics,
    next_action: boundedDiscovery.outcome === "complete" ? "none" : "use direct discovery hints; refresh explicitly if authorized",
    ...(boundedDiscovery.outcome === "indeterminate" ? { reason_code: boundedDiscovery.reasonCode } : {}),
  };
  return makeResult(boundedDiscovery.outcome === "complete" ? 0 : 1, json);
}

async function runRefresh(
  projectRoot: string,
  activeRunnerId: string,
  provider: SkillDiscoverySourceProviderV1 | undefined,
  dependencies: SkillRegistryCommandDependencies,
): Promise<SkillRegistryCommandResult> {
  const current = await evaluateCurrentSources(projectRoot, activeRunnerId, provider);
  const possibleTargets = await possibleWriteTargets(projectRoot);

  if (current.outcome !== "complete" || !current.snapshot) {
    return refreshFailure(
      current.reasonCode ?? "partial_source_evaluation",
      possibleTargets,
      boundDiagnostics(current.diagnostics, projectRoot),
      "Discovery was incomplete; no registry write was attempted.",
    );
  }

  if (current.snapshot.frontmatter.completeness !== "complete") {
    return refreshFailure(
      "truncated_output",
      possibleTargets,
      [{ code: "truncated_output", message: "Registry output was bounded before persistence." }],
      "The complete registry candidate could not be produced; no write was attempted.",
    );
  }

  const snapshots = await readRefreshSnapshots(projectRoot);
  if ("error" in snapshots) {
    return refreshFailure(snapshots.error, possibleTargets, [], "Registry persistence prerequisites were unavailable.");
  }

  const allowedTargets: SkillRegistryWriteTargetsV1 = snapshots.ignore.coversRegistry
    ? [REGISTRY_PATH]
    : [GITIGNORE_PATH, REGISTRY_PATH];
  const action: SkillRegistryWriteActionV1 = snapshots.registry.exists ? "regeneration" : "migration";
  const projectRootDigest = digest(projectRoot);
  const candidateDigest = digest(current.snapshot.document);
  const authorityInput: RefreshAuthorityInput = {
    projectRoot,
    projectRootDigest,
    action,
    activeRunnerId,
    allowedTargets,
  };

  let authority: SkillRegistryWriteAuthorityV1 | undefined;
  try {
    const authorize = dependencies.mintRefreshAuthority ?? dependencies.authorizeRefresh;
    authority = authorize
      ? await authorize(authorityInput)
      : await mintDefaultAuthority(authorityInput);
  } catch {
    return refreshFailure("authorization_unavailable", allowedTargets, [], "Refresh authorization was unavailable.");
  }
  if (!authority) {
    return refreshFailure("authorization_required", allowedTargets, [], "Refresh requires explicit modification authorization.");
  }

  const plan = {
    schema: "skill-registry-write-plan-v1" as const,
    action,
    active_runner_id: activeRunnerId,
    project_root_digest: projectRootDigest,
    allowed_targets: allowedTargets,
    expected_registry_digest: snapshots.registry.digest,
    ...(snapshots.ignore.coversRegistry
      ? {}
      : { expected_gitignore_digest: snapshots.ignore.digest }),
    candidate_document: current.snapshot.document,
    candidate_digest: candidateDigest,
  };

  try {
    const writer = dependencies.createWriter
      ? dependencies.createWriter({ projectRoot })
      : await createDefaultWriter({ projectRoot });
    const writeResult = await writer.commit(plan, authority);
    const diagnostics = boundDiagnostics(writeResult.diagnostics, projectRoot);
    if (writeResult.outcome === "committed" || writeResult.outcome === "unchanged") {
      const json: Record<string, unknown> = {
        schema: CLI_RESULT_SCHEMA,
        command: "deck skill-registry refresh",
        active_runner_id: activeRunnerId,
        outcome: writeResult.outcome,
        status: "ready",
        reason_code: "fingerprint_match",
        registry_path: REGISTRY_PATH,
        registry_digest: safeDigest(writeResult.registry_digest),
        gitignore_changed: writeResult.gitignore_changed === true,
        possible_targets: allowedTargets,
        diagnostics,
        next_action: "none",
      };
      return makeResult(0, json);
    }

    return refreshFailure(
      safeCode(writeResult.reason_code, "write_rejected"),
      allowedTargets,
      diagnostics,
      "The registry was not changed.",
    );
  } catch {
    return refreshFailure("write_failed", allowedTargets, [], "The registry was not changed.");
  }
}

async function evaluateCurrentSources(
  projectRoot: string,
  activeRunnerId: string,
  provider: SkillDiscoverySourceProviderV1 | undefined,
): Promise<SkillRegistryCurrentEvaluationV1> {
  if (!provider || provider.schema !== SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA || provider.runnerId !== activeRunnerId) {
    return {
      outcome: "indeterminate",
      reasonCode: "partial_source_evaluation",
      activeRunnerId,
      diagnostics: [{ code: "source_provider_unavailable", message: "The active runner source provider was unavailable." }],
    };
  }

  try {
    const sourceSet = await provider.listSources({ projectRoot });
    const normalized = normalizeSourceSet(sourceSet, createCoreGenericProjectSources(projectRoot));
    const sourceDeclarations = normalized.sourceSet.sources;
    const discovery = markTruncatedDiscovery(
      await discoverSkills({
        projectRoot,
        activeRunnerId,
        sourceSet: normalized.sourceSet,
      }),
      normalized.truncated,
    );
    const snapshot = canonicalizeSkillRegistry({
      activeRunnerId,
      sourceDeclarations,
      discovery,
    });
    return {
      outcome: discovery.outcome,
      ...(discovery.outcome === "indeterminate" ? { reasonCode: discovery.reasonCode } : {}),
      activeRunnerId,
      sourceDeclarations,
      observations: discovery.observations,
      diagnostics: discovery.diagnostics,
      snapshot,
    };
  } catch {
    return {
      outcome: "indeterminate",
      reasonCode: "partial_source_evaluation",
      activeRunnerId,
      diagnostics: [{ code: "source_provider_unavailable", message: "The active runner source provider was unavailable." }],
    };
  }
}

function unavailableDiscovery(): Extract<BoundedSkillDiscoveryResultV1, { outcome: "indeterminate" }> {
  return {
    outcome: "indeterminate",
    reasonCode: "partial_source_evaluation",
    observations: [],
    diagnostics: [{ code: "source_provider_unavailable", message: "The active runner source provider was unavailable." }],
  };
}

function isSourceSet(value: SkillDiscoverySourceSetV1): value is SkillDiscoverySourceSetV1 {
  return Boolean(value && typeof value === "object" && Array.isArray(value.sources));
}

async function resolveProjectRoot(rootInput?: string): Promise<{ projectRoot: string } | { error: string }> {
  const configuredRoot = path.resolve(rootInput ?? process.cwd());
  try {
    const projectRoot = await fs.realpath(configuredRoot);
    const stats = await fs.stat(projectRoot);
    if (!stats.isDirectory()) return { error: "The project root is not a directory." };
    return { projectRoot };
  } catch {
    return { error: "The project root could not be evaluated." };
  }
}

async function readRefreshSnapshots(
  projectRoot: string,
): Promise<
  | {
      registry: FileSnapshot;
      ignore: FileSnapshot & { readonly coversRegistry: boolean };
    }
  | { error: "gitignore_unavailable" | "path_containment" | "registry_unreadable" }
> {
  const registry = await readRegularFile(projectRoot, REGISTRY_PATH, false);
  if ("error" in registry) return registry;
  const ignore = await readRegularFile(projectRoot, GITIGNORE_PATH, true);
  if ("error" in ignore || ignore.snapshot.text === undefined) {
    return { error: "gitignore_unavailable" };
  }
  return {
    registry: registry.snapshot,
    ignore: {
      ...ignore.snapshot,
      coversRegistry: ignoreRulesCoverRegistry(ignore.snapshot.text),
    },
  };
}

async function possibleWriteTargets(projectRoot: string): Promise<readonly SafeTarget[]> {
  const ignore = await readRegularFile(projectRoot, GITIGNORE_PATH, true);
  if ("error" in ignore || ignore.snapshot.text === undefined) return [GITIGNORE_PATH, REGISTRY_PATH];
  return ignoreRulesCoverRegistry(ignore.snapshot.text)
    ? [REGISTRY_PATH]
    : [GITIGNORE_PATH, REGISTRY_PATH];
}

async function readRegularFile(
  projectRoot: string,
  relativePath: string,
  decodeText: boolean,
): Promise<{ snapshot: FileSnapshot } | { error: "gitignore_unavailable" | "path_containment" | "registry_unreadable" }> {
  const target = path.join(projectRoot, relativePath);
  try {
    const entry = await fs.lstat(target);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      return { error: relativePath === GITIGNORE_PATH ? "gitignore_unavailable" : "path_containment" };
    }
    const bytes = await fs.readFile(target);
    let text: string | undefined;
    if (decodeText) {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return { error: "gitignore_unavailable" };
      }
    }
    return {
      snapshot: {
        exists: true,
        digest: digest(bytes),
        bytes,
        ...(text !== undefined ? { text } : {}),
      },
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        snapshot: {
          exists: false,
          digest: "missing",
        },
      };
    }
    return { error: relativePath === GITIGNORE_PATH ? "gitignore_unavailable" : "registry_unreadable" };
  }
}

function ignoreRulesCoverRegistry(source: string): boolean {
  let ignored = false;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    const pattern = (negated ? line.slice(1) : line).trim().replaceAll("\\", "/");
    if (!pattern) continue;
    if (
      pattern === REGISTRY_PATH ||
      pattern === `/${REGISTRY_PATH}` ||
      pattern === ".atl" ||
      pattern === ".atl/" ||
      pattern === "/.atl" ||
      pattern === "/.atl/" ||
      pattern === ".atl/*" ||
      pattern === "/.atl/*" ||
      pattern === ".atl/**" ||
      pattern === "/.atl/**" ||
      pattern === "**/skill-registry.md" ||
      pattern === "skill-registry.md" ||
      pattern === "*.md" ||
      pattern === "**/*.md" ||
      pattern === "*"
    ) {
      ignored = !negated;
    }
  }
  return ignored;
}

async function selectInteractiveRunner(
  runnerIds: readonly string[],
  selectRunner?: SkillRegistryCommandDependencies["selectRunner"],
): Promise<string | undefined> {
  if (runnerIds.length === 0) return undefined;
  if (selectRunner) return selectRunner(runnerIds);

  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    process.stderr.write(`Select active runner (${runnerIds.join(", ")}): `);
    const answer = await readline.question("");
    return answer.trim();
  } finally {
    readline.close();
  }
}

async function mintDefaultAuthority(
  input: RefreshAuthorityInput,
): Promise<SkillRegistryWriteAuthorityV1> {
  const persistence = await import("../../../packages/core/src/skill-discovery/persistence");
  return persistence.createSkillRegistryWriteAuthority(input);
}

async function createDefaultWriter(options: RefreshWriterOptions): Promise<SkillRegistryWriterV1> {
  const persistence = await import("../../../packages/core/src/skill-discovery/persistence");
  return persistence.createSkillRegistryWriter(options);
}

function operationFor(command: SkillRegistryCommandArgs["command"]): Operation {
  return command.slice("skill-registry-".length) as Operation;
}

function usageFailure(operation: Operation, reasonCode: string, activeRunnerId?: string): SkillRegistryCommandResult {
  const json: Record<string, unknown> = {
    schema: CLI_RESULT_SCHEMA,
    command: `deck skill-registry ${operation}`,
    outcome: "rejected",
    reason_code: safeCode(reasonCode, "usage_error"),
    next_action: operation === "refresh" ? "provide --runner or use an interactive TTY" : `provide --runner for ${operation}`,
    ...(activeRunnerId && SAFE_RUNNER_ID_PATTERN.test(activeRunnerId)
      ? { active_runner_id: activeRunnerId }
      : {}),
  };
  return makeResult(1, json);
}

function operationFailure(
  operation: Operation,
  reasonCode: string,
  _safeMessage: string,
): SkillRegistryCommandResult {
  const json: Record<string, unknown> = {
    schema: CLI_RESULT_SCHEMA,
    command: `deck skill-registry ${operation}`,
    outcome: "rejected",
    reason_code: safeCode(reasonCode, "operation_failed"),
    next_action: operation === "refresh" ? "no files were changed; inspect the bounded status and retry explicitly" : "use bounded direct discovery",
  };
  return makeResult(1, json);
}

function refreshFailure(
  reasonCode: string,
  possibleTargets: readonly SafeTarget[],
  diagnostics: readonly Record<string, string>[],
  _safeMessage: string,
): SkillRegistryCommandResult {
  const json: Record<string, unknown> = {
    schema: CLI_RESULT_SCHEMA,
    command: "deck skill-registry refresh",
    outcome: "rejected",
    reason_code: safeCode(reasonCode, "refresh_failed"),
    possible_targets: possibleTargets,
    diagnostics,
    next_action: "no files were changed; retry only with explicit authorization",
  };
  return makeResult(1, json);
}

function addStatusDetails(
  json: Record<string, unknown>,
  status: SkillRegistryStatusV1,
  projectRoot: string,
): void {
  if ("fingerprint" in status) json.fingerprint = safeDigest(status.fingerprint);
  if ("stored_fingerprint" in status && status.stored_fingerprint) {
    json.stored_fingerprint = safeDigest(status.stored_fingerprint);
  }
  if ("current_fingerprint" in status && status.current_fingerprint) {
    json.current_fingerprint = safeDigest(status.current_fingerprint);
  }
  if ("candidate_count" in status) json.candidate_count = status.candidate_count;
  if ("diagnostics" in status) json.diagnostics = boundDiagnostics(status.diagnostics, projectRoot);
}

function nextActionForStatus(status: SkillRegistryStatusV1["status"]): string {
  return status === "ready" ? "none" : "deck skill-registry refresh";
}

function boundDiagnostics(
  diagnostics: readonly SkillDiscoveryDiagnosticV1[] | undefined,
  projectRoot: string,
): readonly Record<string, string>[] {
  const safe = (Array.isArray(diagnostics) ? diagnostics : [])
    .slice(0, SKILL_DISCOVERY_V1_BOUNDS.maxDiagnostics)
    .map((diagnostic) => {
      const sourceId = safeToken(diagnostic?.source_id);
      const locator = safeLocator(diagnostic?.locator, projectRoot);
      return {
        code: safeCode(diagnostic?.code, "diagnostic"),
        ...(sourceId ? { source_id: sourceId } : {}),
        ...(locator ? { locator } : {}),
        message: safeMessage(diagnostic?.message, projectRoot),
      };
    });
  if (Array.isArray(diagnostics) && diagnostics.length > SKILL_DISCOVERY_V1_BOUNDS.maxDiagnostics) {
    safe[safe.length - 1] = {
      code: "diagnostic_limit_reached",
      message: "Diagnostic output was bounded.",
    };
  }
  return safe;
}

function safeLocator(value: unknown, projectRoot: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.includes(projectRoot) || !SAFE_LOCATOR_PATTERN.test(normalized)) return undefined;
  return normalized;
}

function safeToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return SAFE_CODE_PATTERN.test(normalized) ? normalized : undefined;
}

function safeCode(value: unknown, fallback: string): string {
  return safeToken(value) ?? fallback;
}

function safeMessage(value: unknown, projectRoot: string): string {
  if (typeof value !== "string") return "Diagnostic output was unavailable.";
  return value
    .replaceAll(projectRoot, "[project]")
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\u202A-\u202E\u2060\uFEFF]/g, " ")
    .trim()
    .slice(0, 500) || "Diagnostic output was unavailable.";
}

function safeDigest(value: unknown): string | undefined {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value) ? value : undefined;
}

function digest(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function makeResult(exitCode: 0 | 1 | 2, json: Record<string, unknown>): SkillRegistryCommandResult {
  return {
    exitCode,
    json: Object.freeze(json),
    human: renderHuman(json),
  };
}

function renderHuman(json: Readonly<Record<string, unknown>>): string {
  const lines = [String(json.command ?? "deck skill-registry")];
  for (const key of [
    "active_runner_id",
    "status",
    "outcome",
    "reason_code",
    "registry_path",
    "candidate_count",
    "gitignore_changed",
    "next_action",
  ]) {
    const value = json[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    }
  }
  const targets = json.possible_targets;
  if (Array.isArray(targets)) lines.push(`possible_targets: ${targets.join(", ")}`);
  const locators = json.locators;
  if (Array.isArray(locators) && locators.length > 0) lines.push(`locators: ${locators.join(", ")}`);
  const diagnostics = json.diagnostics;
  if (Array.isArray(diagnostics) && diagnostics.length > 0) {
    lines.push(`diagnostics: ${diagnostics.length}`);
    for (const diagnostic of diagnostics) {
      if (diagnostic && typeof diagnostic === "object") {
        const code = "code" in diagnostic ? String(diagnostic.code) : "diagnostic";
        lines.push(`- ${code}`);
      }
    }
  }
  return lines.join("\n");
}

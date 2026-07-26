import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseDocument } from "yaml";

import type { RunnerId } from "../runner-adapter";
import {
  SKILL_DISCOVERY_SOURCE_SCHEMA,
  SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA,
  SKILL_DISCOVERY_V1_BOUNDS,
  type OpaqueSkillInventoryResultV1,
  type OpaqueSkillObservationV1,
  type SkillDiscoveryDiagnosticV1,
  type SkillDiscoveryScopeV1,
  type SkillDiscoverySourceBindingV1,
  type SkillDiscoverySourceCategoryV1,
  type SkillDiscoverySourceDeclarationV1,
  type SkillDiscoverySourceProviderV1,
  type SkillDiscoverySourceSetV1,
} from "./contracts";

const POSIX_SEPARATOR = "/";
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const SAFE_RUNNER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const INSTRUCTION_LIKE_PATTERNS = [
  /\byou\s+must\b/gi,
  /\bignore\s+(?:all\s+other\s+|previous\s+)?instructions?\b/gi,
  /\bas\s+an\s+ai\b/gi,
];
const CONTROL_OR_BIDI_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
const LOCAL_PATH_PATTERN =
  /(?:~[\\/][^\s"'`<>]+|[A-Za-z]:[\\/][^\s"'`<>]+|\\\\[^\s"'`<>]+|(?:^|[\s("'`])\/(?:[^\s/]+\/)+[^\s"'`<>]*)/g;

const SOURCE_CATEGORIES = new Set<SkillDiscoverySourceCategoryV1>([
  "project_local",
  "project_runner",
  "user_runner",
  "deck_materialized",
  "runner_exposed",
]);
const SOURCE_SCOPES = new Set<SkillDiscoveryScopeV1>(["project", "user", "runner"]);
const CORE_GENERIC_PROJECT_SOURCE_IDS = new Set(["project-agents-skills", "project-generic-skills"]);

/** A safe, read-only observation emitted by bounded discovery. */
export interface SkillDiscoveryObservationV1 {
  readonly name: string;
  readonly source_category: SkillDiscoverySourceCategoryV1;
  readonly scope: SkillDiscoveryScopeV1;
  readonly locator: string;
  readonly runner_id?: string;
  readonly description?: string;
  readonly task_signals: readonly string[];
  readonly technology_signals: readonly string[];
  readonly path_signals: readonly string[];
}

/** Result of enumerating all usable sources for one active runner. */
export type BoundedSkillDiscoveryResultV1 =
  | {
      readonly outcome: "complete";
      readonly observations: readonly SkillDiscoveryObservationV1[];
      readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
    }
  | {
      readonly outcome: "indeterminate";
      readonly reasonCode: "partial_source_evaluation" | "truncated_output";
      /** Direct-discovery hints only; never a ready-registry assertion. */
      readonly observations: readonly SkillDiscoveryObservationV1[];
      readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
    };

export interface DiscoverSkillsInputV1 {
  readonly projectRoot: string;
  readonly activeRunnerId?: RunnerId;
  readonly sourceSet: SkillDiscoverySourceSetV1;
}

export interface DiscoverFromProviderInputV1 {
  readonly projectRoot: string;
  readonly activeRunnerId?: RunnerId;
  readonly provider: SkillDiscoverySourceProviderV1;
}

export interface ParsedSkillDescriptorV1 {
  readonly name: string;
  readonly description?: string;
  readonly taskSignals: readonly string[];
  readonly technologySignals: readonly string[];
  readonly pathSignals: readonly string[];
}

export interface ParseSkillDescriptorResultV1 {
  readonly ok: boolean;
  readonly record?: ParsedSkillDescriptorV1;
  readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
}

interface DescriptorInputV1 {
  readonly content: string;
  readonly fallbackName?: string;
}

interface EvaluationState {
  incomplete: boolean;
  truncated: boolean;
  candidateCount: number;
  directoryEntryCount: number;
  fileEntryCount: number;
}

interface SanitizedField {
  readonly value: string;
  readonly truncated: boolean;
  readonly invalid?: boolean;
}

interface FileEvaluationContext {
  readonly binding: Extract<SkillDiscoverySourceBindingV1, { kind: "filesystem" }>;
  readonly sourceRoot: string;
  readonly projectRoot: string;
  readonly activeRunnerId: RunnerId;
  readonly state: EvaluationState;
  readonly collector: DiagnosticCollector;
  readonly observations: SkillDiscoveryObservationV1[];
  readonly activeResolvedDirectories: Set<string>;
}

interface SafeFileStats {
  readonly size: number;
  readonly mtimeMs: number;
  isDirectory(): boolean;
  isFile(): boolean;
}

interface DirectoryEntry {
  readonly name: string;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/**
 * Enumerate adapter-declared sources without loading, executing, or writing
 * descriptor content. All returned observations are direct-discovery hints.
 */
export async function discoverSkills(
  input: DiscoverSkillsInputV1,
): Promise<BoundedSkillDiscoveryResultV1> {
  const state: EvaluationState = {
    incomplete: false,
    truncated: false,
    candidateCount: 0,
    directoryEntryCount: 0,
    fileEntryCount: 0,
  };
  const collector = new DiagnosticCollector();
  const observations: SkillDiscoveryObservationV1[] = [];

  if (!input || typeof input !== "object") {
    collector.add({ code: "invalid_discovery_input", message: "Discovery input is invalid." });
    return finishDiscovery(state, observations, collector);
  }

  if (!isAbsoluteFilesystemPath(input.projectRoot)) {
    collector.add({ code: "invalid_project_root", message: "The project root is invalid." });
    state.incomplete = true;
    return finishDiscovery(state, observations, collector);
  }

  let canonicalProjectRoot: string;
  try {
    canonicalProjectRoot = await fs.realpath(input.projectRoot);
    const projectStats = await fs.stat(canonicalProjectRoot);
    if (!projectStats.isDirectory()) {
      collector.add({ code: "invalid_project_root", message: "The project root is not a directory." });
      state.incomplete = true;
      return finishDiscovery(state, observations, collector);
    }
  } catch {
    collector.add({ code: "unreadable_project_root", message: "The project root could not be evaluated." });
    state.incomplete = true;
    return finishDiscovery(state, observations, collector);
  }

  if (!input.activeRunnerId || !isSafeRunnerId(input.activeRunnerId)) {
    collector.add({
      code: "missing_active_runner_context",
      message: "Active-runner context is required for skill discovery.",
    });
    state.incomplete = true;
    return finishDiscovery(state, observations, collector);
  }

  const sourceSet = input.sourceSet;
  if (!sourceSet || !Array.isArray(sourceSet.sources)) {
    collector.add({ code: "invalid_source_set", message: "The declared source set is invalid." });
    state.incomplete = true;
    return finishDiscovery(state, observations, collector);
  }

  if (sourceSet.outcome !== "complete" && sourceSet.outcome !== "indeterminate") {
    collector.add({ code: "invalid_source_set", message: "The declared source set is invalid." });
    state.incomplete = true;
  }

  const sourceDiagnostics = Array.isArray(sourceSet.diagnostics) ? sourceSet.diagnostics : [];
  if (!Array.isArray(sourceSet.diagnostics)) {
    collector.add({ code: "invalid_diagnostics", message: "Source diagnostics are invalid." });
    state.incomplete = true;
  }
  addExternalDiagnostics(collector, sourceDiagnostics);
  if (sourceSet.outcome === "indeterminate") {
    state.incomplete = true;
    if (sourceSet.reasonCode !== "partial_source_evaluation") {
      collector.add({ code: "invalid_source_set", message: "The declared source set is invalid." });
    }
  }
  if (sourceDiagnostics.length > SKILL_DISCOVERY_V1_BOUNDS.maxDiagnostics) {
    state.truncated = true;
  }

  const providerBindings: SkillDiscoverySourceBindingV1[] = [];
  let sourceBindingCount = 0;
  for (const binding of sourceSet.sources) {
    // The canonical Core roots may already have been composed by a caller
    // before this boundary. They are fixed, trusted inputs and must not
    // consume the provider-source width budget or be evaluated twice.
    if (CORE_GENERIC_PROJECT_SOURCE_IDS.has(binding?.declaration?.sourceId ?? "")) continue;

    sourceBindingCount += 1;
    if (sourceBindingCount > SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords) {
      collector.add({ code: "candidate_limit_reached", message: "The candidate record limit was reached." });
      state.truncated = true;
      break;
    }

    // These IDs are Core-owned; preserve all other provider observations and
    // prevent a provider from replacing the canonical generic roots.
    if (!CORE_GENERIC_PROJECT_SOURCE_IDS.has(binding?.declaration?.sourceId ?? "")) {
      providerBindings.push(binding);
    }
  }

  const bindings = [
    ...createCoreGenericProjectSources(canonicalProjectRoot),
    ...providerBindings.sort(compareSourceBindings),
  ];
  for (const binding of bindings) {
    if (state.truncated) break;

    try {
      const declaration = binding?.declaration;
      if (!isValidSourceDeclaration(declaration)) {
        collector.add({ code: "invalid_source_declaration", message: "A source declaration is invalid." });
        state.incomplete = true;
        continue;
      }

      if (!isActiveSource(declaration, input.activeRunnerId)) {
        // Excluding another runner's root is intentional, not a partial scan.
        continue;
      }

      if (binding.kind === "filesystem") {
        await evaluateFilesystemSource({
          binding,
          sourceRoot: "",
          projectRoot: canonicalProjectRoot,
          activeRunnerId: input.activeRunnerId,
          state,
          collector,
          observations,
          activeResolvedDirectories: new Set<string>(),
        });
      } else if (binding.kind === "opaque_inventory") {
        await evaluateOpaqueSource(binding, input.activeRunnerId, state, collector, observations);
      } else {
        collector.add({ code: "invalid_source_binding", message: "A source binding is invalid." });
        state.incomplete = true;
      }
    } catch {
      collector.add({
        sourceId: binding?.declaration?.sourceId,
        code: "source_evaluation_failed",
        message: "A source could not be evaluated safely.",
      });
      state.incomplete = true;
    }
  }

  observations.sort(compareObservations);
  return finishDiscovery(state, observations, collector);
}

export function createCoreGenericProjectSources(projectRoot: string): SkillDiscoverySourceBindingV1[] {
  return [
    createCoreGenericProjectSource(projectRoot, "project-agents-skills", [".agents", "skills"], ".agents/skills"),
    createCoreGenericProjectSource(projectRoot, "project-generic-skills", [".skills"], ".skills"),
  ];
}

function createCoreGenericProjectSource(
  projectRoot: string,
  sourceId: "project-agents-skills" | "project-generic-skills",
  relativeRoot: readonly string[],
  safeLocatorBase: string,
): SkillDiscoverySourceBindingV1 {
  const binding: SkillDiscoverySourceBindingV1 = {
    kind: "filesystem",
    declaration: {
      schema: SKILL_DISCOVERY_SOURCE_SCHEMA,
      sourceId,
      sourceCategory: "project_local",
      scope: "project",
      runnerId: "runner-neutral",
      locatorStrategy: "project_relative",
      expectedContent: "skill_md",
      safeLocatorBase,
    },
    absoluteRoot: path.join(projectRoot, ...relativeRoot),
    descriptorBasename: "SKILL.md",
  };
  Object.defineProperty(binding, "absoluteRoot", { enumerable: false, value: binding.absoluteRoot });
  return binding;
}

/** Evaluate a provider after checking that it belongs to the active runner. */
export async function discoverSkillsFromProvider(
  input: DiscoverFromProviderInputV1,
): Promise<BoundedSkillDiscoveryResultV1> {
  if (!input.activeRunnerId || !isSafeRunnerId(input.activeRunnerId)) {
    return discoverSkills({
      projectRoot: input.projectRoot,
      activeRunnerId: undefined,
      sourceSet: { outcome: "complete", sources: [], diagnostics: [] },
    });
  }

  if (!input.provider || input.provider.schema !== SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA) {
    return discoverSkills({
      projectRoot: input.projectRoot,
      activeRunnerId: input.activeRunnerId,
      sourceSet: { outcome: "indeterminate", reasonCode: "partial_source_evaluation", sources: [], diagnostics: [] },
    });
  }

  if (input.provider.runnerId !== input.activeRunnerId) {
    return discoverSkills({
      projectRoot: input.projectRoot,
      activeRunnerId: input.activeRunnerId,
      sourceSet: {
        outcome: "indeterminate",
        reasonCode: "partial_source_evaluation",
        sources: [],
        diagnostics: [{ code: "provider_runner_mismatch", message: "The source provider is not active." }],
      },
    });
  }

  try {
    const sourceSet = await input.provider.listSources({ projectRoot: input.projectRoot });
    return discoverSkills({ ...input, sourceSet });
  } catch {
    return discoverSkills({
      projectRoot: input.projectRoot,
      activeRunnerId: input.activeRunnerId,
      sourceSet: {
        outcome: "indeterminate",
        reasonCode: "partial_source_evaluation",
        sources: [],
        diagnostics: [{ code: "source_provider_unavailable", message: "The source provider was unavailable." }],
      },
    });
  }
}

/**
 * Parse one descriptor as data. This overload is intentionally useful for
 * unit tests and never evaluates Markdown or YAML content as code.
 */
export function parseSkillDescriptor(input: DescriptorInputV1): ParseSkillDescriptorResultV1;
export function parseSkillDescriptor(content: string, fallbackName?: string): ParseSkillDescriptorResultV1;
export function parseSkillDescriptor(
  inputOrContent: DescriptorInputV1 | string,
  fallbackName?: string,
): ParseSkillDescriptorResultV1 {
  const input: DescriptorInputV1 =
    typeof inputOrContent === "string"
      ? { content: inputOrContent, fallbackName }
      : inputOrContent;
  const diagnostics: SkillDiscoveryDiagnosticV1[] = [];

  if (!input || typeof input.content !== "string") {
    return parseFailure("malformed_descriptor", "Descriptor content is invalid.");
  }

  if (Buffer.byteLength(input.content, "utf8") > SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes) {
    return parseFailure("oversized_file", "Descriptor exceeds the maximum file size.");
  }

  const frontmatter = extractFrontmatter(input.content);
  if (frontmatter.error) {
    return parseFailure("malformed_descriptor", "Descriptor frontmatter is incomplete.");
  }

  if (!frontmatter.present) {
    const name = sanitizeName(input.fallbackName ?? "");
    if (!name) {
      return parseFailure("invalid_name", "Descriptor has no safe name.");
    }
    return {
      ok: true,
      record: { name, taskSignals: [], technologySignals: [], pathSignals: [] },
      diagnostics,
    };
  }

  let data: unknown;
  try {
    const document = parseDocument(frontmatter.yaml, {
      customTags: [],
      prettyErrors: false,
      schema: "failsafe",
      stringKeys: true,
      uniqueKeys: true,
    });
    const inspection = inspectYamlNode(document.contents);
    if (inspection.hasAlias || inspection.hasTag || inspection.maxDepth > SKILL_DISCOVERY_V1_BOUNDS.maxFrontmatterDepth) {
      return parseFailure("unsafe_frontmatter", "Descriptor frontmatter exceeds the safe YAML policy.");
    }
    if (document.errors.length > 0 || document.warnings.length > 0) {
      return parseFailure("malformed_descriptor", "Descriptor frontmatter is not valid YAML.");
    }
    data = document.toJS({ maxAliasCount: 0 });
  } catch {
    return parseFailure("malformed_descriptor", "Descriptor frontmatter is not valid YAML.");
  }

  if (!isPlainRecord(data)) {
    return parseFailure("malformed_descriptor", "Descriptor frontmatter must be a mapping.");
  }

  const rawName = data.name;
  if (typeof rawName !== "string") {
    return parseFailure("invalid_name", "Structured descriptors require a scalar name.");
  }
  const name = sanitizeName(rawName);
  if (!name) {
    return parseFailure("invalid_name", "Descriptor has no safe name.");
  }

  const description = sanitizeDescription(data.description);
  if (description.diagnostic) diagnostics.push(description.diagnostic);
  if (description.invalid) return { ok: false, diagnostics };

  const taskSignals = parseSignals(data.task_signals, "task_signals", diagnostics);
  const technologySignals = parseSignals(data.technology_signals, "technology_signals", diagnostics);
  const pathSignals = parseSignals(data.path_signals, "path_signals", diagnostics);
  if (taskSignals === undefined || technologySignals === undefined || pathSignals === undefined) {
    return { ok: true, diagnostics };
  }

  return {
    ok: true,
    record: {
      name,
      ...(description.value ? { description: description.value } : {}),
      taskSignals,
      technologySignals,
      pathSignals,
    },
    diagnostics,
  };
}

/** Return true only for privacy-normalized project, runner, or user locators. */
export function isSafeSkillLocator(locator: string): boolean {
  return normalizeSkillLocator(locator) !== undefined;
}

/** Normalize a locator without ever returning an absolute or traversal path. */
export function normalizeSkillLocator(locator: string): string | undefined {
  if (typeof locator !== "string" || locator.length === 0 || locator !== locator.trim()) return undefined;
  if (hasUnsafePathMaterial(locator)) return undefined;

  const projectMatch = /^project:(.+)$/.exec(locator);
  if (projectMatch) {
    const relative = normalizeLocatorPath(projectMatch[1]);
    return relative ? `project:${relative}` : undefined;
  }

  const runnerMatch = /^runner:([^:]+):(.+)$/.exec(locator);
  if (runnerMatch && isSafeRunnerId(runnerMatch[1])) {
    const sourceAndObservation = normalizeLocatorPath(runnerMatch[2]);
    return sourceAndObservation ? `runner:${runnerMatch[1]}:${sourceAndObservation}` : undefined;
  }

  const userMatch = /^user:(.+)$/.exec(locator);
  if (userMatch) {
    const opaque = decodePercentRepeated(userMatch[1]);
    if (opaque && isSafeOpaqueId(opaque)) return `user:${encodeURIComponent(opaque)}`;
  }

  return undefined;
}

function finishDiscovery(
  state: EvaluationState,
  observations: readonly SkillDiscoveryObservationV1[],
  collector: DiagnosticCollector,
): BoundedSkillDiscoveryResultV1 {
  const diagnostics = collector.toArray();
  const boundedObservations = observations.slice(0, SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords);
  const truncated = state.truncated || observations.length > SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords;
  if (truncated) {
    return {
      outcome: "indeterminate",
      reasonCode: "truncated_output",
      observations: boundedObservations,
      diagnostics,
    };
  }
  if (state.incomplete) {
    return {
      outcome: "indeterminate",
      reasonCode: "partial_source_evaluation",
      observations: boundedObservations,
      diagnostics,
    };
  }
  return { outcome: "complete", observations: boundedObservations, diagnostics };
}

async function evaluateFilesystemSource(context: FileEvaluationContext): Promise<void> {
  const { binding, projectRoot, state, collector } = context;
  if (!isAbsoluteFilesystemPath(binding.absoluteRoot)) {
    collector.add({ sourceId: binding.declaration.sourceId, code: "invalid_source_root", message: "The source root is invalid." });
    state.incomplete = true;
    return;
  }

  let sourceRoot: string;
  try {
    sourceRoot = await fs.realpath(binding.absoluteRoot);
    const stats = await fs.stat(sourceRoot);
    if (!stats.isDirectory()) {
      collector.add({ sourceId: binding.declaration.sourceId, code: "source_root_not_directory", message: "The source root is not a directory." });
      state.incomplete = true;
      return;
    }
  } catch (error) {
    if (isMissingPathError(error)) return;
    collector.add({ sourceId: binding.declaration.sourceId, code: "unreadable_root", message: "The declared source root could not be read." });
    state.incomplete = true;
    return;
  }

  if (binding.declaration.scope === "project" && !isWithinRoot(projectRoot, sourceRoot)) {
    collector.add({ sourceId: binding.declaration.sourceId, code: "source_root_outside_project", message: "The project source root is outside the project boundary." });
    state.incomplete = true;
    return;
  }

  const nextContext: FileEvaluationContext = {
    ...context,
    sourceRoot,
    activeResolvedDirectories: new Set<string>([sourceRoot]),
  };
  await walkDirectory(nextContext, sourceRoot, 0, "");
}

async function walkDirectory(
  context: FileEvaluationContext,
  directory: string,
  depth: number,
  logicalRelativeDirectory: string,
): Promise<void> {
  const { binding, sourceRoot, state, collector, observations } = context;
  if (state.truncated) return;

  let directoryHandle: Awaited<ReturnType<typeof fs.opendir>>;
  try {
    directoryHandle = await fs.opendir(directory, { encoding: "utf8", bufferSize: 32 });
  } catch {
    collector.add({ sourceId: binding.declaration.sourceId, code: "unreadable_root", message: "A source directory could not be read." });
    state.incomplete = true;
    return;
  }

  try {
    while (!state.truncated) {
      const rawEntry = await directoryHandle.read();
      if (rawEntry === null) break;
      const entry = rawEntry as unknown as DirectoryEntry;

      if (entry.isDirectory()) {
        state.directoryEntryCount += 1;
        if (state.directoryEntryCount > SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords) {
          collector.add({ sourceId: binding.declaration.sourceId, code: "candidate_limit_reached", message: "The candidate record limit was reached." });
          state.truncated = true;
          return;
        }
      } else {
        state.fileEntryCount += 1;
        if (state.fileEntryCount > SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords) {
          collector.add({ sourceId: binding.declaration.sourceId, code: "candidate_limit_reached", message: "The candidate record limit was reached." });
          state.truncated = true;
          return;
        }
      }

      if (!isSafeFilesystemSegment(entry.name)) {
        collector.add({ sourceId: binding.declaration.sourceId, code: "path_traversal_rejected", message: "A filesystem path segment was rejected." });
        state.incomplete = true;
        continue;
      }

      const logicalRelative = toPosixPath(path.join(logicalRelativeDirectory, entry.name));
      const entryPath = path.join(directory, entry.name);
      let resolvedEntry: string;
      try {
        resolvedEntry = await fs.realpath(entryPath);
      } catch {
        collector.add({ sourceId: binding.declaration.sourceId, code: "race_detected", message: "A source entry changed during discovery." });
        state.incomplete = true;
        continue;
      }

      if (!isWithinRoot(sourceRoot, resolvedEntry)) {
        collector.add({
          sourceId: binding.declaration.sourceId,
          locator: safeLocatorForRelativePath(binding.declaration, context.projectRoot, sourceRoot, logicalRelative, context.activeRunnerId),
          code: entry.isSymbolicLink() ? "symlink_escape_rejected" : "source_escape_rejected",
          message: entry.isSymbolicLink() ? "A symlink escaped the declared source root." : "A source entry escaped the declared source root.",
        });
        state.incomplete = true;
        continue;
      }

      let stats: SafeFileStats;
      try {
        stats = (await fs.stat(resolvedEntry)) as unknown as SafeFileStats;
      } catch {
        collector.add({ sourceId: binding.declaration.sourceId, code: "race_detected", message: "A source entry changed during discovery." });
        state.incomplete = true;
        continue;
      }

      if (stats.isDirectory()) {
        const nextDepth = depth + 1;
        if (nextDepth > SKILL_DISCOVERY_V1_BOUNDS.maxScanDepth) {
          collector.add({ sourceId: binding.declaration.sourceId, code: "scan_depth_exceeded", message: "The source scan depth limit was reached." });
          state.incomplete = true;
          continue;
        }
        if (context.activeResolvedDirectories.has(resolvedEntry)) {
          continue;
        }
        context.activeResolvedDirectories.add(resolvedEntry);
        try {
          await walkDirectory(context, resolvedEntry, nextDepth, logicalRelative);
        } finally {
          context.activeResolvedDirectories.delete(resolvedEntry);
        }
        continue;
      }

      if (entry.name !== binding.descriptorBasename) continue;
      if (!stats.isFile()) {
        collector.add({ sourceId: binding.declaration.sourceId, code: "non_regular_descriptor", message: "A descriptor is not a regular file." });
        state.incomplete = true;
        continue;
      }

      state.candidateCount += 1;
      if (state.candidateCount > SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords) {
        collector.add({ sourceId: binding.declaration.sourceId, code: "candidate_limit_reached", message: "The candidate record limit was reached." });
        state.truncated = true;
        return;
      }

      const locator = safeLocatorForRelativePath(
        binding.declaration,
        context.projectRoot,
        sourceRoot,
        logicalRelative,
        context.activeRunnerId,
      );
      if (!locator) {
        collector.add({ sourceId: binding.declaration.sourceId, code: "path_traversal_rejected", message: "A descriptor locator was rejected." });
        state.incomplete = true;
        continue;
      }

      const descriptor = await readDescriptor(resolvedEntry, entryPath, stats, binding.declaration.sourceId, locator, collector);
      if (!descriptor) {
        state.incomplete = true;
        continue;
      }

      const parsed = parseSkillDescriptor({
        content: descriptor.content,
        fallbackName: path.posix.basename(path.posix.dirname(logicalRelative)),
      });
      for (const diagnostic of parsed.diagnostics) {
        if (!collector.add({ ...diagnostic, sourceId: binding.declaration.sourceId, locator })) break;
      }
      if (!parsed.ok || !parsed.record) {
        state.incomplete = true;
        continue;
      }

      observations.push(toFilesystemObservation(binding.declaration, locator, parsed.record));
    }
  } finally {
    try {
      await directoryHandle.close();
    } catch {
      // The runtime may close a directory handle automatically after EOF.
    }
  }
}

async function evaluateOpaqueSource(
  binding: Extract<SkillDiscoverySourceBindingV1, { kind: "opaque_inventory" }>,
  activeRunnerId: RunnerId,
  state: EvaluationState,
  collector: DiagnosticCollector,
  observations: SkillDiscoveryObservationV1[],
): Promise<void> {
  let inventory: OpaqueSkillInventoryResultV1;
  try {
    inventory = await binding.readInventory();
  } catch {
    collector.add({ sourceId: binding.declaration.sourceId, code: "opaque_inventory_unavailable", message: "The runner inventory was unavailable." });
    state.incomplete = true;
    return;
  }

  if (
    !inventory ||
    (inventory.outcome !== "complete" && inventory.outcome !== "indeterminate") ||
    !Array.isArray(inventory.observations) ||
    !Array.isArray(inventory.diagnostics)
  ) {
    collector.add({ sourceId: binding.declaration.sourceId, code: "invalid_opaque_inventory", message: "The runner inventory is invalid." });
    state.incomplete = true;
    return;
  }
  addExternalDiagnostics(collector, inventory.diagnostics, binding.declaration.sourceId);
  if (inventory.outcome === "indeterminate") state.incomplete = true;
  if (inventory.observations.length > SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords) {
    state.truncated = true;
  }

  for (const observation of inventory.observations) {
    if (state.candidateCount >= SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords) {
      collector.add({ sourceId: binding.declaration.sourceId, code: "candidate_limit_reached", message: "The candidate record limit was reached." });
      state.truncated = true;
      break;
    }
    state.candidateCount += 1;

    if (!isSafeOpaqueId(observation?.opaqueId)) {
      collector.add({ sourceId: binding.declaration.sourceId, code: "unsafe_opaque_id", message: "An opaque runner identifier was rejected." });
      state.incomplete = true;
      continue;
    }
    const metadata = sanitizeOpaqueObservation(observation);
    for (const diagnostic of metadata.diagnostics) {
      if (!collector.add({ ...diagnostic, sourceId: binding.declaration.sourceId })) break;
    }
    if (!metadata.record) {
      state.incomplete = true;
      continue;
    }

    const locator = `runner:${encodeURIComponent(activeRunnerId)}:${encodeURIComponent(binding.declaration.sourceId)}/${encodeURIComponent(observation.opaqueId)}`;
    observations.push({
      name: metadata.record.name,
      source_category: binding.declaration.sourceCategory,
      scope: binding.declaration.scope,
      locator,
      runner_id: activeRunnerId,
      ...(metadata.record.description ? { description: metadata.record.description } : {}),
      task_signals: metadata.record.taskSignals,
      technology_signals: metadata.record.technologySignals,
      path_signals: metadata.record.pathSignals,
    });
  }
}

async function readDescriptor(
  resolvedEntry: string,
  logicalEntry: string,
  initialStats: SafeFileStats,
  sourceId: string,
  locator: string,
  collector: DiagnosticCollector,
): Promise<{ content: string } | undefined> {
  if (initialStats.size > SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes) {
    collector.add({ sourceId, locator, code: "oversized_file", message: "Descriptor exceeds the maximum file size." });
    return undefined;
  }

  let contentBytes: Uint8Array;
  try {
    const handle = await fs.open(resolvedEntry, "r");
    try {
      const buffer = Buffer.alloc(initialStats.size);
      const result = await handle.read(buffer, 0, initialStats.size, 0);
      if (result.bytesRead !== initialStats.size) {
        collector.add({ sourceId, locator, code: "race_detected", message: "A descriptor changed during discovery." });
        return undefined;
      }
      contentBytes = buffer;
    } finally {
      await handle.close();
    }
  } catch {
    collector.add({ sourceId, locator, code: "unreadable_descriptor", message: "A descriptor could not be read." });
    return undefined;
  }

  try {
    const afterTarget = await fs.realpath(logicalEntry);
    const afterStats = (await fs.stat(afterTarget)) as unknown as SafeFileStats;
    if (
      afterTarget !== resolvedEntry ||
      !afterStats.isFile() ||
      afterStats.size !== initialStats.size ||
      afterStats.mtimeMs !== initialStats.mtimeMs
    ) {
      collector.add({ sourceId, locator, code: "race_detected", message: "A descriptor changed during discovery." });
      return undefined;
    }
  } catch {
    collector.add({ sourceId, locator, code: "race_detected", message: "A descriptor changed during discovery." });
    return undefined;
  }

  try {
    return { content: new TextDecoder("utf-8", { fatal: true }).decode(contentBytes) };
  } catch {
    collector.add({ sourceId, locator, code: "invalid_utf8", message: "Descriptor encoding is not valid UTF-8." });
    return undefined;
  }
}

function toFilesystemObservation(
  declaration: SkillDiscoverySourceDeclarationV1,
  locator: string,
  record: ParsedSkillDescriptorV1,
): SkillDiscoveryObservationV1 {
  const runnerId = declaration.runnerId === "runner-neutral" ? undefined : declaration.runnerId;
  return {
    name: record.name,
    source_category: declaration.sourceCategory,
    scope: declaration.scope,
    locator,
    ...(runnerId ? { runner_id: runnerId } : {}),
    ...(record.description ? { description: record.description } : {}),
    task_signals: record.taskSignals,
    technology_signals: record.technologySignals,
    path_signals: record.pathSignals,
  };
}

function sanitizeOpaqueObservation(observation: OpaqueSkillObservationV1): {
  readonly record?: ParsedSkillDescriptorV1;
  readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
} {
  const diagnostics: SkillDiscoveryDiagnosticV1[] = [];
  const name = sanitizeName(observation.name);
  if (!name) {
    diagnostics.push({ code: "invalid_name", message: "An opaque observation has no safe name." });
    return { diagnostics };
  }
  const description = sanitizeDescription(observation.description);
  if (description.diagnostic) diagnostics.push(description.diagnostic);
  if (description.invalid) return { diagnostics };
  const taskSignals = parseOpaqueSignals(observation.taskSignals, "task_signals", diagnostics);
  const technologySignals = parseOpaqueSignals(observation.technologySignals, "technology_signals", diagnostics);
  const pathSignals = parseOpaqueSignals(observation.pathSignals, "path_signals", diagnostics);
  if (!taskSignals || !technologySignals || !pathSignals) return { diagnostics };
  return {
    record: {
      name,
      ...(description.value ? { description: description.value } : {}),
      taskSignals,
      technologySignals,
      pathSignals,
    },
    diagnostics,
  };
}

function parseSignals(
  value: unknown,
  key: string,
  diagnostics: SkillDiscoveryDiagnosticV1[],
): readonly string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostics.push({ code: "invalid_signal_field", message: "A signal field must be a sequence." });
    return undefined;
  }
  const maxSignals =
    key === "task_signals"
      ? SKILL_DISCOVERY_V1_BOUNDS.maxTaskSignals
      : key === "technology_signals"
        ? SKILL_DISCOVERY_V1_BOUNDS.maxTechnologySignals
        : SKILL_DISCOVERY_V1_BOUNDS.maxPathSignals;
  if (value.length > maxSignals) {
    diagnostics.push({ code: "signal_limit_exceeded", message: `${key} exceeds its bounded signal count.` });
    return undefined;
  }
  const values: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      diagnostics.push({ code: "invalid_signal_field", message: "Signal values must be scalar strings." });
      return undefined;
    }
    const sanitized = sanitizeMetadataText(item).value;
    if (sanitized) values.push(sanitized);
  }
  return values;
}

function parseOpaqueSignals(
  value: readonly string[] | undefined,
  key: string,
  diagnostics: SkillDiscoveryDiagnosticV1[],
): readonly string[] | undefined {
  return parseSignals(value, key, diagnostics);
}

function sanitizeDescription(value: unknown): SanitizedField & { readonly diagnostic?: SkillDiscoveryDiagnosticV1 } {
  if (value === undefined) return { value: "", truncated: false };
  if (typeof value !== "string") {
    return {
      value: "",
      truncated: false,
      invalid: true,
      diagnostic: { code: "invalid_description", message: "Description must be a scalar string." },
    };
  }
  const sanitized = sanitizeMetadataText(value);
  if (sanitized.truncated) {
    return {
      ...sanitized,
      diagnostic: { code: "description_truncated", message: "Description was truncated to the bounded excerpt length." },
    };
  }
  return sanitized;
}

function sanitizeMetadataText(value: string): SanitizedField {
  let normalized = value.normalize("NFKC").replace(CONTROL_OR_BIDI_PATTERN, "");
  normalized = normalized.replace(/[\r\n\t]+/g, " ");
  normalized = redactLocalPath(normalized);
  for (const pattern of INSTRUCTION_LIKE_PATTERNS) {
    normalized = normalized.replace(pattern, "[instruction-like text removed]");
  }
  normalized = normalized.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  const truncated = characters.length > SKILL_DISCOVERY_V1_BOUNDS.maxDescriptionCharacters;
  return {
    value: characters.slice(0, SKILL_DISCOVERY_V1_BOUNDS.maxDescriptionCharacters).join(""),
    truncated,
  };
}

function sanitizeName(value: string): string {
  return sanitizeMetadataText(value).value;
}

function redactLocalPath(value: string): string {
  return value.replace(LOCAL_PATH_PATTERN, (match) => {
    const prefix = match.length > 0 && /[\s("'`]/.test(match[0]) ? match[0] : "";
    return `${prefix}[local path removed]`;
  });
}

function extractFrontmatter(content: string):
  | { readonly present: false; readonly yaml: ""; readonly error: false }
  | { readonly present: true; readonly yaml: string; readonly error: false }
  | { readonly present: true; readonly yaml: ""; readonly error: true } {
  const withoutBom = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const lines = withoutBom.split(/\r?\n/);
  if (lines[0] !== "---") return { present: false, yaml: "", error: false };
  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex < 0) return { present: true, yaml: "", error: true };
  return { present: true, yaml: lines.slice(1, closingIndex).join("\n"), error: false };
}

function inspectYamlNode(node: unknown, depth = 0, seen = new Set<object>()): {
  readonly maxDepth: number;
  readonly hasAlias: boolean;
  readonly hasTag: boolean;
} {
  if (!node || typeof node !== "object") return { maxDepth: depth, hasAlias: false, hasTag: false };
  if (seen.has(node)) return { maxDepth: depth, hasAlias: true, hasTag: false };
  seen.add(node);

  const value = node as {
    readonly type?: unknown;
    readonly tag?: unknown;
    readonly items?: readonly unknown[];
    readonly value?: unknown;
    readonly key?: unknown;
  };
  const type = typeof value.type === "string" ? value.type : "";
  if (type === "ALIAS") return { maxDepth: depth, hasAlias: true, hasTag: false };
  let maxDepth = depth;
  let hasAlias = false;
  let hasTag = typeof value.tag === "string" && value.tag.length > 0;
  const isCollection = type === "MAP" || type === "SEQ";
  if (isCollection) maxDepth = depth;

  const visit = (child: unknown, childDepth: number): void => {
    const result = inspectYamlNode(child, childDepth, seen);
    maxDepth = Math.max(maxDepth, result.maxDepth);
    hasAlias ||= result.hasAlias;
    hasTag ||= result.hasTag;
  };

  if (Array.isArray(value.items)) {
    for (const item of value.items) {
      if (type === "MAP" && item && typeof item === "object") {
        const pair = item as { readonly key?: unknown; readonly value?: unknown };
        visit(pair.key, depth + 1);
        visit(pair.value, depth + 1);
      } else {
        visit(item, depth + 1);
      }
    }
  } else if (value.value && typeof value.value === "object") {
    visit(value.value, depth + 1);
  }
  return { maxDepth, hasAlias, hasTag };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseFailure(code: string, message: string): ParseSkillDescriptorResultV1 {
  return { ok: false, diagnostics: [{ code, message }] };
}

function isValidSourceDeclaration(
  declaration: SkillDiscoverySourceDeclarationV1 | undefined,
): declaration is SkillDiscoverySourceDeclarationV1 {
  if (!declaration || typeof declaration !== "object") return false;
  if (declaration.schema !== SKILL_DISCOVERY_SOURCE_SCHEMA) return false;
  if (!isSafeToken(declaration.sourceId)) return false;
  if (!SOURCE_CATEGORIES.has(declaration.sourceCategory) || !SOURCE_SCOPES.has(declaration.scope)) return false;
  if (declaration.runnerId !== "runner-neutral" && !isSafeRunnerId(declaration.runnerId)) return false;
  if (!new Set(["project_relative", "runner_relative", "runner_opaque"]).has(declaration.locatorStrategy)) return false;
  if (!new Set(["skill_md", "opaque_inventory_v1"]).has(declaration.expectedContent)) return false;
  if (
    declaration.locatorStrategy === "project_relative"
      ? !isSafeProjectRelativeLocatorBase(declaration.safeLocatorBase)
      : !isSafeToken(declaration.safeLocatorBase)
  ) return false;
  if (declaration.expectedContent === "skill_md" && declaration.locatorStrategy === "runner_opaque") return false;
  if (declaration.expectedContent === "opaque_inventory_v1" && declaration.locatorStrategy !== "runner_opaque") return false;
  if (declaration.scope === "project" && declaration.locatorStrategy === "runner_relative") return false;
  if (declaration.scope !== "runner" && declaration.locatorStrategy === "runner_opaque") return false;
  if (declaration.sourceCategory === "project_local" && declaration.runnerId !== "runner-neutral") return false;
  if (
    (declaration.sourceCategory === "project_runner" ||
      declaration.sourceCategory === "user_runner" ||
      declaration.sourceCategory === "runner_exposed") &&
    declaration.runnerId === "runner-neutral"
  ) {
    return false;
  }
  if (declaration.sourceCategory === "project_runner" && (declaration.scope !== "project" || declaration.locatorStrategy !== "project_relative")) return false;
  if (declaration.sourceCategory === "user_runner" && (declaration.scope !== "user" || declaration.locatorStrategy !== "runner_relative")) return false;
  if (declaration.sourceCategory === "runner_exposed" && (declaration.scope !== "runner" || declaration.locatorStrategy !== "runner_opaque")) return false;
  return true;
}

function isActiveSource(declaration: SkillDiscoverySourceDeclarationV1, activeRunnerId: RunnerId): boolean {
  return declaration.runnerId === "runner-neutral" || declaration.runnerId === activeRunnerId;
}

function safeLocatorForRelativePath(
  declaration: SkillDiscoverySourceDeclarationV1,
  projectRoot: string,
  sourceRoot: string,
  logicalRelative: string,
  activeRunnerId: RunnerId,
): string | undefined {
  const relative = normalizeLocatorPath(logicalRelative);
  if (!relative) return undefined;
  if (declaration.locatorStrategy === "project_relative") {
    const projectRelative = normalizeLocatorPath(toPosixPath(path.relative(projectRoot, path.join(sourceRoot, logicalRelative))));
    return projectRelative ? normalizeSkillLocator(`project:${projectRelative}`) : undefined;
  }
  if (declaration.locatorStrategy === "runner_relative") {
    const locator = `runner:${encodeURIComponent(activeRunnerId)}:${encodeURIComponent(declaration.safeLocatorBase)}/${relative}`;
    return normalizeSkillLocator(locator);
  }
  return undefined;
}

function normalizeLocatorPath(value: string): string | undefined {
  const decoded = decodePercentRepeated(value);
  if (!decoded || path.isAbsolute(decoded) || hasUnsafePathMaterial(decoded)) return undefined;
  const normalized = toPosixPath(decoded);
  const segments = normalized.split(POSIX_SEPARATOR);
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return undefined;
  return segments.join(POSIX_SEPARATOR);
}

function hasUnsafePathMaterial(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return true;
  if (CONTROL_OR_BIDI_PATTERN.test(value)) {
    CONTROL_OR_BIDI_PATTERN.lastIndex = 0;
    return true;
  }
  if (value.includes("\\0") || value.includes("\\")) return true;
  if (/^~(?:[\\/]|$)/.test(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)) return true;
  const decoded = decodePercentRepeated(value);
  if (!decoded) return true;
  const slashNormalized = decoded.replace(/\\/g, POSIX_SEPARATOR);
  return slashNormalized.split(POSIX_SEPARATOR).some((segment) => segment === "..");
}

function decodePercentRepeated(value: string): string | undefined {
  let current = value;
  for (let index = 0; index < 4; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return current;
      current = decoded;
    } catch {
      return undefined;
    }
  }
  return current;
}

function isSafeFilesystemSegment(value: string): boolean {
  return value !== "." && value !== ".." && !hasUnsafePathMaterial(value);
}

function isSafeToken(value: unknown): value is string {
  return typeof value === "string" && SAFE_TOKEN_PATTERN.test(value) && !value.includes("..");
}

function isSafeProjectRelativeLocatorBase(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.startsWith("~") || value.includes("\\") || value.includes("\0")) {
    return false;
  }
  return value.split("/").every((segment) => (
    segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("..") && /^[A-Za-z0-9._~-]{1,128}$/.test(segment)
  ));
}

function isSafeRunnerId(value: unknown): value is RunnerId {
  return typeof value === "string" && SAFE_RUNNER_ID_PATTERN.test(value) && !value.includes("..");
}

function isSafeOpaqueId(value: unknown): value is string {
  if (typeof value !== "string" || !value || value !== value.trim()) return false;
  const decoded = decodePercentRepeated(value);
  return !!decoded && SAFE_TOKEN_PATTERN.test(decoded) && !decoded.includes("..");
}

function isAbsoluteFilesystemPath(value: unknown): value is string {
  return typeof value === "string" && path.isAbsolute(value) && !hasUnsafePathMaterial(value);
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(POSIX_SEPARATOR).replace(/\\/g, POSIX_SEPARATOR);
}

function isMissingPathError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT";
}

function compareSourceBindings(left: SkillDiscoverySourceBindingV1, right: SkillDiscoverySourceBindingV1): number {
  const sourceCompare = String(left?.declaration?.sourceId ?? "").localeCompare(String(right?.declaration?.sourceId ?? ""));
  if (sourceCompare !== 0) return sourceCompare;
  return String(left?.kind ?? "").localeCompare(String(right?.kind ?? ""));
}

function compareObservations(left: SkillDiscoveryObservationV1, right: SkillDiscoveryObservationV1): number {
  return left.locator.localeCompare(right.locator);
}

class DiagnosticCollector {
  private readonly entries: SkillDiscoveryDiagnosticV1[] = [];
  private inputCount = 0;
  private overflowed = false;

  add(input: {
    readonly code: string;
    readonly sourceId?: string;
    readonly locator?: string;
    readonly message: string;
    readonly source_id?: string;
  }): boolean {
    if (this.overflowed) return false;
    this.inputCount += 1;
    if (this.inputCount > SKILL_DISCOVERY_V1_BOUNDS.maxDiagnostics) {
      this.overflowed = true;
      return false;
    }

    const code = normalizeDiagnosticCode(input.code);
    const sourceId = input.sourceId ?? input.source_id;
    const safeSourceId = isSafeToken(sourceId) ? sourceId : undefined;
    const safeLocator = input.locator && isSafeSkillLocator(input.locator) ? input.locator : undefined;
    const message = sanitizeDiagnosticMessage(input.message);
    const diagnostic = {
      code,
      ...(safeSourceId ? { source_id: safeSourceId } : {}),
      ...(safeLocator ? { locator: safeLocator } : {}),
      message,
    } satisfies SkillDiscoveryDiagnosticV1;

    if (this.entries.some((existing) => sameDiagnostic(existing, diagnostic))) return true;
    if (this.entries.length >= SKILL_DISCOVERY_V1_BOUNDS.maxDiagnostics) {
      this.overflowed = true;
      return false;
    }
    this.entries.push(diagnostic);
    return true;
  }

  toArray(): readonly SkillDiscoveryDiagnosticV1[] {
    const sorted = [...this.entries].sort(compareDiagnostics);
    const unique = sorted.filter((diagnostic, index, all) => index === 0 || !sameDiagnostic(diagnostic, all[index - 1]));
    if (!this.overflowed) return unique;
    return [
      ...unique.slice(0, SKILL_DISCOVERY_V1_BOUNDS.maxDiagnostics - 1),
      { code: "diagnostic_limit_reached", message: "Additional discovery diagnostics were withheld." },
    ];
  }
}

function addExternalDiagnostics(
  collector: DiagnosticCollector,
  diagnostics: readonly SkillDiscoveryDiagnosticV1[] | undefined,
  sourceId?: string,
): void {
  if (!Array.isArray(diagnostics)) {
    collector.add({ sourceId, code: "invalid_diagnostics", message: "Source diagnostics are invalid." });
    return;
  }
  for (const diagnostic of diagnostics) {
    if (!diagnostic || typeof diagnostic !== "object") {
      if (!collector.add({ sourceId, code: "invalid_diagnostics", message: "Source diagnostics are invalid." })) break;
      continue;
    }
    if (!collector.add({
      code: typeof diagnostic.code === "string" ? diagnostic.code : "invalid_diagnostics",
      sourceId: sourceId ?? diagnostic.source_id,
      locator: diagnostic.locator,
      message: typeof diagnostic.message === "string" ? diagnostic.message : "Source diagnostic was invalid.",
    })) break;
  }
}

function normalizeDiagnosticCode(value: string): string {
  const normalized = String(value).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80);
  return normalized || "discovery_error";
}

function sanitizeDiagnosticMessage(value: string): string {
  const sanitized = sanitizeMetadataText(typeof value === "string" ? value : "Discovery diagnostic was invalid.").value;
  return sanitized || "Discovery diagnostic was invalid.";
}

function compareDiagnostics(left: SkillDiscoveryDiagnosticV1, right: SkillDiscoveryDiagnosticV1): number {
  return [left.code, left.source_id ?? "", left.locator ?? "", left.message].join("\u0000").localeCompare(
    [right.code, right.source_id ?? "", right.locator ?? "", right.message].join("\u0000"),
  );
}

function sameDiagnostic(left: SkillDiscoveryDiagnosticV1, right: SkillDiscoveryDiagnosticV1): boolean {
  return (
    left.code === right.code &&
    left.source_id === right.source_id &&
    left.locator === right.locator &&
    left.message === right.message
  );
}

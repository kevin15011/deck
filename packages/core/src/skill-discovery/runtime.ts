import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  SkillCandidateQueryV1,
  SkillCandidateSearchResultV1,
  SkillCandidateV1,
  SkillDiscoveryDiagnosticV1,
  SkillDiscoverySourceProviderV1,
  SkillLoadOutcomeV1,
  SkillLoadPreparationResultV1,
  SkillNativeLoadPortV1,
  SkillRegistryRecordV1,
  SkillSelectionReferenceV1,
  SkillSelectionResultV1,
} from "./contracts";
import type { BoundedSkillDiscoveryResultV1, SkillDiscoveryObservationV1 } from "./discovery";
import { computeSkillObservationId } from "./registry";

const MAX_QUERY_TERMS = 20;
const MAX_QUERY_TERM_LENGTH = 128;
const MAX_QUERY_RESULT_LIMIT = 500;
const MAX_GLOB_MATCH_WORK = 32 * 1024;
const GENERIC_PROJECT_SKILL_ROOTS = [".agents/skills", ".skills"] as const;

export interface TaskScopedSkillDiscoveryRuntimeInputV1 {
  /** Runtime-only absolute project root; it never leaves this service. */
  readonly projectRoot: string;
  readonly activeRunnerId: string;
  /** Supplied by SDD Runtime, which owns the task/session association. */
  readonly sessionId: string;
  readonly taskId: string;
  readonly registryStatus: "ready" | "missing" | "stale" | "invalid" | "indeterminate";
  readonly readRegistry?: () => Promise<readonly SkillRegistryRecordV1[]>;
  readonly discoverDirectly: () => Promise<BoundedSkillDiscoveryResultV1>;
  readonly provider: SkillDiscoverySourceProviderV1;
  readonly nativeLoader?: SkillNativeLoadPortV1;
}

export interface TaskScopedSkillDiscoveryRuntimeV1 {
  search(query: SkillCandidateQueryV1): Promise<SkillCandidateSearchResultV1>;
  select(input: { readonly observation_id?: string; readonly name?: string }): SkillSelectionResultV1;
  prepare(reference: SkillSelectionReferenceV1): Promise<SkillLoadPreparationResultV1>;
  load(reference: SkillSelectionReferenceV1): Promise<SkillLoadOutcomeV1>;
}

interface RuntimeCandidate {
  readonly record: SkillRegistryRecordV1;
  readonly public: SkillCandidateV1;
  readonly searchGeneration: number;
}

interface PreparedLoad {
  readonly reference: string;
  readonly searchGeneration: number;
  readonly prepareGeneration: number;
  readonly expectedName?: string;
  readonly expectedDirectory?: string;
}

interface NormalizedQuery {
  readonly terms: readonly string[];
  readonly targetPaths: readonly string[];
  readonly targetExtensions: readonly string[];
  readonly technologies: readonly string[];
  readonly techniques: readonly string[];
  readonly limit: number;
}

/**
 * Keeps locators and native references in a short-lived in-process closure while
 * exposing only bounded, untrusted candidate metadata to the consuming agent.
 */
export function createTaskScopedSkillDiscoveryRuntime(
  input: TaskScopedSkillDiscoveryRuntimeInputV1,
): TaskScopedSkillDiscoveryRuntimeV1 {
  const candidates = new Map<string, RuntimeCandidate>();
  const allCandidates = new Map<string, RuntimeCandidate>();
  const activeNameCounts = new Map<string, number>();
  const selections = new Map<string, RuntimeCandidate>();
  const prepared = new Map<string, PreparedLoad>();
  const prepareGenerations = new Map<string, number>();
  let searchGeneration = 0;
  let selectionCompleteness: "complete" | "indeterminate" = "indeterminate";

  async function search(query: SkillCandidateQueryV1): Promise<SkillCandidateSearchResultV1> {
    const normalized = normalizeQuery(query);
    const generation = ++searchGeneration;
    candidates.clear();
    allCandidates.clear();
    activeNameCounts.clear();
    selections.clear();
    prepared.clear();
    prepareGenerations.clear();
    if (!normalized) return emptySearch("direct_discovery", "indeterminate", "invalid_candidate_query");

    let sourceMode: "registry" | "direct_discovery" = "direct_discovery";
    let completeness: "complete" | "indeterminate" = "indeterminate";
    let records: SkillRegistryRecordV1[] = [];
    let diagnostics: readonly SkillDiscoveryDiagnosticV1[] = [];

    if (input.registryStatus === "ready" && input.readRegistry) {
      try {
        records = (await input.readRegistry()).map(copyRecord);
        sourceMode = "registry";
        completeness = "complete";
      } catch {
        diagnostics = [{ code: "registry_unavailable", message: "The ready registry could not be read." }];
      }
    }

    if (sourceMode === "direct_discovery") {
      try {
        const discovered = await input.discoverDirectly();
        records = discovered.observations.map(recordFromObservation);
        completeness = discovered.outcome === "complete" ? "complete" : "indeterminate";
        diagnostics = [...diagnostics, ...discovered.diagnostics];
      } catch {
        diagnostics = [...diagnostics, { code: "direct_discovery_unavailable", message: "Direct discovery was unavailable." }];
      }
    }

    if (generation !== searchGeneration) return supersededSearch(sourceMode, completeness, diagnostics);

    const activeRecords = records.filter((record) => belongsToActiveRunner(record, input.activeRunnerId));
    for (const record of activeRecords) {
      activeNameCounts.set(record.name, (activeNameCounts.get(record.name) ?? 0) + 1);
    }
    const matched = activeRecords
      .filter((record) => matches(record, normalized))
      .map((record) => ({ record, public: publicCandidate(record), searchGeneration: generation }));
    const visible = matched.slice(0, normalized.limit);
    if (generation !== searchGeneration) return supersededSearch(sourceMode, completeness, diagnostics);
    selectionCompleteness = completeness;
    for (const candidate of matched) allCandidates.set(candidate.public.observation_id, candidate);
    for (const candidate of visible) candidates.set(candidate.public.observation_id, candidate);

    return {
      schema: "skill-candidate-search-result-v1",
      source_mode: sourceMode,
      completeness,
      candidates: visible.map((candidate) => candidate.public),
      truncated: matched.length > visible.length,
      diagnostics: diagnostics.slice(0, 50),
    };
  }

  function select(request: { readonly observation_id?: string; readonly name?: string }): SkillSelectionResultV1 {
    const observationId = safeToken(request?.observation_id);
    if (observationId) {
      const candidate = candidates.get(observationId);
      return candidate ? selectCandidate(candidate) : { outcome: "missing" };
    }
    const name = safeToken(request?.name);
    if (!name) return { outcome: "missing" };
    const activeCount = activeNameCounts.get(name);
    if (!activeCount) return { outcome: "missing" };
    if (selectionCompleteness !== "complete" || activeCount !== 1) return { outcome: "ambiguous" };
    const named = [...allCandidates.values()].filter((candidate) => candidate.public.name === name);
    if (named.length !== 1) return { outcome: "missing" };
    return candidates.has(named[0]!.public.observation_id) ? selectCandidate(named[0]!) : { outcome: "missing" };
  }

  async function prepare(reference: SkillSelectionReferenceV1): Promise<SkillLoadPreparationResultV1> {
    const candidate = selectedCandidate(reference);
    const prepareGeneration = (prepareGenerations.get(reference?.selection_id) ?? 0) + 1;
    if (reference?.selection_id) {
      prepareGenerations.set(reference.selection_id, prepareGeneration);
      prepared.delete(reference.selection_id);
    }
    if (!candidate) return { outcome: "rejected" };
    const resolved = await resolveCurrentLocator(candidate.record.locator);
    if (!isCurrentSelection(reference, candidate) || prepareGenerations.get(reference.selection_id) !== prepareGeneration) return { outcome: "rejected" };
    if (resolved.outcome !== "available") return { outcome: resolved.outcome };
    if (!input.nativeLoader) return { outcome: "unsupported" };
    try {
      const result = await input.nativeLoader.prepare({
        activeRunnerId: input.activeRunnerId,
        selectionId: reference.selection_id,
        expectedName: candidate.record.name,
        loadReference: resolved.loadReference,
      });
      if (result.outcome === "loadable" && isCurrentSelection(reference, candidate) && prepareGenerations.get(reference.selection_id) === prepareGeneration) {
        const privateResult = result as { readonly expected_name?: string; readonly expected_directory?: string };
        prepared.set(reference.selection_id, { reference: resolved.loadReference, searchGeneration: candidate.searchGeneration, prepareGeneration, ...(privateResult.expected_name ? { expectedName: privateResult.expected_name } : {}), ...(privateResult.expected_directory ? { expectedDirectory: privateResult.expected_directory } : {}) });
      } else if (result.outcome === "loadable") {
        return { outcome: "rejected" };
      }
      return result.outcome === "loadable" ? { outcome: "loadable" } : result;
    } catch {
      return { outcome: "rejected" };
    }
  }

  async function load(reference: SkillSelectionReferenceV1): Promise<SkillLoadOutcomeV1> {
    const loaded = prepared.get(reference?.selection_id);
    const candidate = selectedCandidate(reference);
    if (!loaded || !input.nativeLoader || !candidate || loaded.searchGeneration !== searchGeneration || loaded.prepareGeneration !== prepareGenerations.get(reference.selection_id)) return { outcome: "unobserved" };
    prepared.delete(reference.selection_id);
    const resolved = await resolveCurrentLocator(candidate.record.locator);
    if (!isCurrentSelection(reference, candidate) || loaded.prepareGeneration !== prepareGenerations.get(reference.selection_id) || resolved.outcome !== "available" || resolved.loadReference !== loaded.reference) {
      return { outcome: "unobserved" };
    }
    try {
      return await input.nativeLoader.load({
        activeRunnerId: input.activeRunnerId,
        selectionId: reference.selection_id,
        loadReference: loaded.reference,
      });
    } catch {
      return { outcome: "failed" };
    }
  }

  function selectCandidate(candidate: RuntimeCandidate): SkillSelectionResultV1 {
    const selectionId = digest({
      projectRoot: input.projectRoot,
      activeRunnerId: input.activeRunnerId,
      sessionId: input.sessionId,
      taskId: input.taskId,
      observationId: candidate.public.observation_id,
      searchGeneration: candidate.searchGeneration,
    });
    selections.set(selectionId, candidate);
    return {
      outcome: "selected",
      reference: {
        schema: "skill-selection-reference-v1",
        selection_id: selectionId,
        session_id: input.sessionId,
        task_id: input.taskId,
        active_runner_id: input.activeRunnerId,
        observation_id: candidate.public.observation_id,
      },
    };
  }

  function selectedCandidate(reference: SkillSelectionReferenceV1): RuntimeCandidate | undefined {
    if (
      !reference
      || reference.schema !== "skill-selection-reference-v1"
      || reference.session_id !== input.sessionId
      || reference.task_id !== input.taskId
      || reference.active_runner_id !== input.activeRunnerId
    ) return undefined;
    const candidate = selections.get(reference.selection_id);
    return candidate?.searchGeneration === searchGeneration && candidate.public.observation_id === reference.observation_id ? candidate : undefined;
  }

  function isCurrentSelection(reference: SkillSelectionReferenceV1, candidate: RuntimeCandidate): boolean {
    return selectedCandidate(reference) === candidate;
  }

  async function resolveCurrentLocator(locator: string): Promise<
    | { readonly outcome: "available"; readonly loadReference: string }
    | { readonly outcome: "missing" | "not_exposed" | "rejected" }
  > {
    if (locator.startsWith("project:")) return resolveProjectLocator(input.projectRoot, locator);
    try {
      const result = await input.provider.resolveLocator({ projectRoot: input.projectRoot, locator });
      if (result.status === "available") return { outcome: "available", loadReference: result.loadReference };
      return result.status === "missing" ? { outcome: "not_exposed" } : { outcome: "rejected" };
    } catch {
      return { outcome: "rejected" };
    }
  }

  return { search, select, prepare, load };
}

function normalizeQuery(query: SkillCandidateQueryV1): NormalizedQuery | undefined {
  if (!query || query.schema !== "skill-candidate-query-v1" || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > MAX_QUERY_RESULT_LIMIT) return undefined;
  const terms = normalizeTokenArray(query.terms, false);
  const targetPaths = normalizePathArray(query.target_paths);
  const targetExtensions = normalizeExtensionArray(query.target_extensions);
  const technologies = normalizeTokenArray(query.technologies, true);
  const techniques = normalizeTokenArray(query.techniques, true);
  if (!terms || !targetPaths || !targetExtensions || !technologies || !techniques) return undefined;
  return { terms, targetPaths, targetExtensions, technologies, techniques, limit: query.limit };
}

function safeToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= MAX_QUERY_TERM_LENGTH && !/[\u0000-\u001F\u007F]/.test(normalized) ? normalized : undefined;
}

function normalizeTokenArray(value: unknown, optional: boolean): readonly string[] | undefined {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value) || value.length > MAX_QUERY_TERMS) return undefined;
  const tokens = value.map(safeToken);
  return tokens.every((token): token is string => token !== undefined) ? tokens : undefined;
}

function normalizeTargetPath(value: string): string | undefined {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "").toLocaleLowerCase("en-US");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) return undefined;
  return normalized;
}

function normalizePathArray(value: unknown): readonly string[] | undefined {
  const tokens = normalizeTokenArray(value, true);
  if (!tokens) return undefined;
  const paths = tokens.map(normalizeTargetPath);
  return paths.every((path): path is string => path !== undefined) ? paths : undefined;
}

function normalizeExtension(value: string): string | undefined {
  const normalized = value.toLocaleLowerCase("en-US").replace(/^\*?\./, "");
  return /^[a-z0-9]{1,16}$/.test(normalized) ? normalized : undefined;
}

function normalizeExtensionArray(value: unknown): readonly string[] | undefined {
  const tokens = normalizeTokenArray(value, true);
  if (!tokens) return undefined;
  const extensions = tokens.map(normalizeExtension);
  return extensions.every((extension): extension is string => extension !== undefined) ? extensions : undefined;
}

function matches(record: SkillRegistryRecordV1, query: NormalizedQuery): boolean {
  const haystack = [
    record.name,
    record.description ?? "",
    ...(record.task_signals ?? []),
    ...(record.technology_signals ?? []),
    ...(record.path_signals ?? []),
  ].join("\n").toLocaleLowerCase("en-US");
  return query.terms.every((term) => haystack.includes(term.toLocaleLowerCase("en-US")))
    && matchesSignals(record.technology_signals, query.technologies)
    && matchesSignals(record.task_signals, query.techniques)
    && matchesPaths(record.path_signals, query.targetPaths)
    && matchesExtensions(record.path_signals, query.targetExtensions);
}

function belongsToActiveRunner(record: SkillRegistryRecordV1, activeRunnerId: string): boolean {
  return record.runner_id === undefined || record.runner_id === activeRunnerId;
}

function matchesSignals(signals: readonly string[] | undefined, filters: readonly string[]): boolean {
  if (filters.length === 0) return true;
  const available = new Set((signals ?? []).map((signal) => signal.toLocaleLowerCase("en-US")));
  return filters.every((filter) => available.has(filter.toLocaleLowerCase("en-US")));
}

function matchesPaths(signals: readonly string[] | undefined, targets: readonly string[]): boolean {
  if (targets.length === 0) return true;
  const normalizedSignals = (signals ?? []).map(normalizeTargetPath).filter((signal): signal is string => Boolean(signal));
  return targets.every((target) => normalizedSignals.some((signal) => globMatches(signal, target)));
}

function matchesExtensions(signals: readonly string[] | undefined, extensions: readonly string[]): boolean {
  if (extensions.length === 0) return true;
  const available = new Set(
    (signals ?? [])
      .map(normalizeTargetPath)
      .filter((signal): signal is string => Boolean(signal))
      .map((signal) => /(?:^|\/)\*?\.([a-z0-9]{1,16})$/.exec(signal)?.[1])
      .filter((extension): extension is string => Boolean(extension)),
  );
  return extensions.every((extension) => available.has(extension));
}

function globMatches(pattern: string, target: string): boolean {
  const tokens = tokenizeGlob(pattern);
  if ((tokens.length + 1) * (target.length + 1) > MAX_GLOB_MATCH_WORK) return false;
  let previous = new Uint8Array(target.length + 1);
  previous[0] = 1;
  for (const token of tokens) {
    const current = new Uint8Array(target.length + 1);
    if (token === "star" || token === "globstar") {
      current[0] = previous[0]!;
      for (let index = 1; index <= target.length; index += 1) {
        const character = target[index - 1]!;
        current[index] = token === "globstar"
          ? Number(Boolean(previous[index] || current[index - 1]))
          : Number(Boolean(previous[index] || (character !== "/" && current[index - 1])));
      }
    } else if (token === "globstar-directory") {
      current[0] = previous[0]!;
      let inDirectory = false;
      for (let index = 1; index <= target.length; index += 1) {
        const character = target[index - 1]!;
        if (character === "/") {
          current[index] = Number(Boolean(previous[index] || inDirectory));
          inDirectory = false;
        } else {
          inDirectory ||= Boolean(previous[index - 1] || current[index - 1]);
          current[index] = previous[index]!;
        }
      }
    } else {
      for (let index = 1; index <= target.length; index += 1) {
        const character = target[index - 1]!;
        const matches = token === "single" ? character !== "/" : token === character;
        current[index] = Number(Boolean(matches && previous[index - 1]));
      }
    }
    previous = current;
  }
  return previous[target.length] === 1;
}

function tokenizeGlob(pattern: string): readonly ("star" | "globstar" | "globstar-directory" | "single" | string)[] {
  const tokens: ("star" | "globstar" | "globstar-directory" | "single" | string)[] = [];
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] === "*") {
      if (pattern[index + 1] === "*") {
        const directory = pattern[index + 2] === "/";
        tokens.push(directory ? "globstar-directory" : "globstar");
        index += directory ? 2 : 1;
      } else {
        tokens.push("star");
      }
    } else if (pattern[index] === "?") {
      tokens.push("single");
    } else {
      tokens.push(pattern[index]!);
    }
  }
  return tokens;
}

function publicCandidate(record: SkillRegistryRecordV1): SkillCandidateV1 {
  return {
    observation_id: record.observation_id,
    name: record.name,
    source_category: record.source_category,
    scope: record.scope,
    ...(record.runner_id ? { runner_id: record.runner_id } : {}),
    ...(record.description ? { description: record.description } : {}),
    task_signals: record.task_signals ?? [],
    technology_signals: record.technology_signals ?? [],
    path_signals: record.path_signals ?? [],
  };
}

function recordFromObservation(observation: SkillDiscoveryObservationV1): SkillRegistryRecordV1 {
  return {
    name: observation.name,
    source_category: observation.source_category,
    scope: observation.scope,
    locator: observation.locator,
    observation_id: computeSkillObservationId(observation),
    ...(observation.runner_id ? { runner_id: observation.runner_id } : {}),
    ...(observation.description ? { description: observation.description } : {}),
    task_signals: observation.task_signals,
    technology_signals: observation.technology_signals,
    path_signals: observation.path_signals,
  };
}

function copyRecord(record: SkillRegistryRecordV1): SkillRegistryRecordV1 {
  return {
    ...record,
    task_signals: record.task_signals ?? [],
    technology_signals: record.technology_signals ?? [],
    path_signals: record.path_signals ?? [],
  };
}

function emptySearch(
  sourceMode: "registry" | "direct_discovery",
  completeness: "complete" | "indeterminate",
  code: string,
): SkillCandidateSearchResultV1 {
  return {
    schema: "skill-candidate-search-result-v1",
    source_mode: sourceMode,
    completeness,
    candidates: [],
    truncated: false,
    diagnostics: [{ code, message: "The candidate query was rejected." }],
  };
}

function supersededSearch(
  sourceMode: "registry" | "direct_discovery",
  completeness: "complete" | "indeterminate",
  diagnostics: readonly SkillDiscoveryDiagnosticV1[],
): SkillCandidateSearchResultV1 {
  return {
    schema: "skill-candidate-search-result-v1",
    source_mode: sourceMode,
    completeness,
    candidates: [],
    truncated: false,
    diagnostics: [...diagnostics, { code: "search_superseded", message: "A newer search replaced this result." }].slice(0, 50),
  };
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

async function resolveProjectLocator(
  projectRoot: string,
  locator: string,
): Promise<
  | { readonly outcome: "available"; readonly loadReference: string }
  | { readonly outcome: "missing" | "rejected" }
  > {
  const relative = locator.slice("project:".length);
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) return { outcome: "rejected" };
  const declaredRoot = GENERIC_PROJECT_SKILL_ROOTS.find((root) => relative === root || relative.startsWith(`${root}/`));
  if (!declaredRoot) return { outcome: "rejected" };
  try {
    const root = await fs.realpath(projectRoot);
    const sourceRoot = await fs.realpath(path.resolve(root, declaredRoot));
    if (!isWithin(root, sourceRoot)) return { outcome: "rejected" };
    const candidate = await fs.realpath(path.resolve(root, relative));
    if (!isWithin(sourceRoot, candidate)) return { outcome: "rejected" };
    return (await fs.stat(candidate)).isFile()
      ? { outcome: "available", loadReference: candidate }
      : { outcome: "rejected" };
  } catch {
    return { outcome: "missing" };
  }
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

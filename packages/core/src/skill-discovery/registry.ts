import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseDocument, stringify } from "yaml";

import type { RunnerId } from "../runner-adapter";
import {
  SKILL_DISCOVERY_SOURCE_SCHEMA,
  SKILL_DISCOVERY_V1_BOUNDS,
  SKILL_REGISTRY_FINGERPRINT_ALGORITHM,
  SKILL_REGISTRY_PRIVACY_POLICY_VERSION,
  SKILL_REGISTRY_SCHEMA,
  SKILL_REGISTRY_SCHEMA_VERSION,
  type SkillDiscoveryDiagnosticV1,
  type SkillDiscoverySourceBindingV1,
  type SkillDiscoverySourceCategoryV1,
  type SkillDiscoverySourceDeclarationV1,
  type SkillDiscoveryScopeV1,
  type SkillDiscoveryDigestV1,
  type SkillRegistryFrontmatterV1,
  type SkillRegistryRecordV1,
  type SkillRegistryStatusReasonCodeV1,
  type SkillRegistryStatusV1,
} from "./contracts";
import {
  createCoreGenericProjectSources,
  isSafeSkillLocator,
  normalizeSkillLocator,
  type BoundedSkillDiscoveryResultV1,
  type SkillDiscoveryObservationV1,
} from "./discovery";

export const SKILL_REGISTRY_PATH_V1 = ".atl/skill-registry.md" as const;

const REGISTRY_DOMAIN = "deck.skill-registry";
const OBSERVATION_DOMAIN = `${REGISTRY_DOMAIN}.observation-id.v1`;
const SOURCE_SCOPE_DOMAIN = `${REGISTRY_DOMAIN}.source-scope.v1`;
const FINGERPRINT_DOMAIN = `${REGISTRY_DOMAIN}.fingerprint.v1`;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const CONTROL_OR_BIDI_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
const ISO_8601_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const LOCAL_PATH_PATTERN =
  /(?:~[\\/][^\s"'`<>]+|[A-Za-z]:[\\/][^\s"'`<>]+|\\\\[^\s"'`<>]+|(?:^|[\s("'`])\/(?:[^\s/]+\/)+[^\s"'`<>]*)/g;
const INSTRUCTION_LIKE_PATTERNS = [
  /\byou\s+must\b/gi,
  /\bignore\s+(?:all\s+other\s+|previous\s+)?instructions?\b/gi,
  /\bas\s+an\s+ai\b/gi,
];
const SOURCE_CATEGORIES = new Set<SkillDiscoverySourceCategoryV1>([
  "project_local",
  "project_runner",
  "user_runner",
  "deck_materialized",
  "runner_exposed",
]);
const SCOPES = new Set<SkillDiscoveryScopeV1>(["project", "user", "runner"]);
const RUNNER_SCOPED_CATEGORIES = new Set<SkillDiscoverySourceCategoryV1>([
  "project_runner",
  "user_runner",
  "runner_exposed",
]);
const CORE_GENERIC_SOURCE_DECLARATIONS = new Map(
  createCoreGenericProjectSources(path.parse(process.cwd()).root)
    .map((source) => [source.declaration.sourceId, source.declaration] as const),
);
type RegistrySourceInputV1 = SkillDiscoverySourceDeclarationV1 | SkillDiscoverySourceBindingV1;

export interface SkillRegistryCanonicalizationInputV1 {
  readonly activeRunnerId: RunnerId;
  readonly sourceDeclarations?: readonly RegistrySourceInputV1[];
  readonly observations?: readonly SkillDiscoveryObservationV1[];
  readonly diagnostics?: readonly SkillDiscoveryDiagnosticV1[];
  readonly discovery?: BoundedSkillDiscoveryResultV1;
  /** Informational only. It is deliberately excluded from fingerprints. */
  readonly generatedAt?: string;
}

export interface SkillRegistryCanonicalSnapshotV1 {
  readonly frontmatter: SkillRegistryFrontmatterV1;
  readonly body: string;
  readonly document: string;
  readonly sourceDeclarations: readonly SkillDiscoverySourceDeclarationV1[];
  /** Runtime-only context needed to re-verify provider snapshots. */
  readonly activeRunnerId?: RunnerId;
}

export interface SkillRegistryFingerprintInputV1 {
  readonly activeRunnerId: RunnerId;
  readonly sourceDeclarations?: readonly RegistrySourceInputV1[];
  readonly records: readonly SkillRegistryRecordV1[];
  readonly schema?: string;
  readonly schemaVersion?: number;
  readonly fingerprintAlgorithm?: string;
  readonly privacyPolicyVersion?: string;
}

export interface SkillRegistryParseResultV1 {
  readonly ok: boolean;
  readonly frontmatter?: SkillRegistryFrontmatterV1;
  readonly body?: string;
  readonly document?: string;
  readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
  readonly reasonCode?: Extract<
    SkillRegistryStatusReasonCodeV1,
    "unsupported_schema_version" | "missing_schema" | "malformed_frontmatter" | "oversized_candidate_count"
  >;
}

export interface SkillRegistryCurrentEvaluationV1 {
  readonly outcome: "complete" | "indeterminate";
  readonly reasonCode?: "partial_source_evaluation" | "truncated_output";
  readonly activeRunnerId?: RunnerId;
  readonly sourceDeclarations?: readonly RegistrySourceInputV1[];
  readonly observations?: readonly unknown[];
  readonly diagnostics?: readonly SkillDiscoveryDiagnosticV1[];
  readonly snapshot?: SkillRegistryCanonicalSnapshotV1;
}

export interface SkillRegistryReadInputV1 {
  readonly projectRoot: string;
  readonly currentSnapshot?:
    | SkillRegistryCanonicalSnapshotV1
    | SkillRegistryCurrentEvaluationV1
    | SkillRegistryCanonicalizationInputV1;
  readonly evaluateCurrent?: () =>
    | SkillRegistryCanonicalSnapshotV1
    | SkillRegistryCurrentEvaluationV1
    | SkillRegistryCanonicalizationInputV1
    | Promise<
        | SkillRegistryCanonicalSnapshotV1
        | SkillRegistryCurrentEvaluationV1
        | SkillRegistryCanonicalizationInputV1
      >;
}

interface NormalizedRecordResultV1 {
  readonly record?: SkillRegistryRecordV1;
  readonly diagnostic?: SkillDiscoveryDiagnosticV1;
}

interface NormalizedSourceResultV1 {
  readonly declaration?: SkillDiscoverySourceDeclarationV1;
}

interface ParsedYamlRootV1 {
  readonly data?: unknown;
  readonly body: string;
  readonly error?: "malformed_frontmatter" | "missing_schema" | "unsupported_schema_version";
  readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
}

/**
 * Canonicalize one bounded discovery result into the V1 registry document.
 * This function is pure apart from the informational default timestamp and
 * never reads, writes, executes, or resolves a filesystem path.
 */
export function canonicalizeSkillRegistry(
  input: SkillRegistryCanonicalizationInputV1,
): SkillRegistryCanonicalSnapshotV1 {
  const discovery = input.discovery;
  const observations = input.observations ?? discovery?.observations ?? [];
  const sourceNormalization = normalizeSourceDeclarations(input.activeRunnerId, input.sourceDeclarations ?? []);
  const sourceDeclarations = sourceNormalization.declarations;
  const rawDiagnostics = [...(input.diagnostics ?? discovery?.diagnostics ?? [])];
  const normalizationDiagnostics: SkillDiscoveryDiagnosticV1[] = [];
  const records: SkillRegistryRecordV1[] = [];

  for (const observation of observations) {
    // Discovery is active-runner scoped. A defensive second filter here keeps
    // a provider or caller from smuggling another runner's exclusive evidence
    // into a registry or its fingerprint.
    const observationRunnerId = observation && typeof observation === "object"
      ? (observation as unknown as Record<string, unknown>).runner_id
      : undefined;
    if (typeof observationRunnerId === "string" && observationRunnerId !== input.activeRunnerId) continue;
    const normalized = normalizeObservation(observation);
    if (normalized.record) records.push(normalized.record);
    if (normalized.diagnostic) normalizationDiagnostics.push(normalized.diagnostic);
  }

  records.sort(compareRecords);
  let truncated = sourceNormalization.truncated || discovery?.outcome === "indeterminate" || records.length > SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords;
  let retainedRecords = records.slice(0, SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords);
  const boundedDiagnostics = boundDiagnostics([
    ...rawDiagnostics,
    ...normalizationDiagnostics,
    ...(truncated ? [{ code: "truncated_output", message: "Registry output was bounded before persistence." }] : []),
  ]);

  let frontmatter = createFrontmatter({
    activeRunnerId: input.activeRunnerId,
    sourceDeclarations,
    records: retainedRecords,
    diagnostics: boundedDiagnostics,
    completeness: truncated ? "truncated" : "complete",
    generatedAt: input.generatedAt,
  });
  let document = renderSkillRegistryMarkdown(frontmatter);

  // Keep the generated artifact within the same hard read bound used by the
  // reader. Records are already canonical, so removing the tail is stable.
  while (Buffer.byteLength(document, "utf8") > SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes && retainedRecords.length > 0) {
    truncated = true;
    retainedRecords = retainedRecords.slice(0, -1);
    frontmatter = createFrontmatter({
      activeRunnerId: input.activeRunnerId,
      sourceDeclarations,
      records: retainedRecords,
      diagnostics: boundDiagnostics([
        ...rawDiagnostics,
        ...normalizationDiagnostics,
        { code: "truncated_output", message: "Registry output was bounded before persistence." },
      ]),
      completeness: "truncated",
      generatedAt: input.generatedAt,
    });
    document = renderSkillRegistryMarkdown(frontmatter);
  }

  const body = renderSkillRegistryBody(frontmatter);
  return { frontmatter, body, document, sourceDeclarations, activeRunnerId: input.activeRunnerId };
}

/** Canonical observation identity; descriptions and signals intentionally do not participate. */
export function computeSkillObservationId(input: {
  readonly source_category: SkillDiscoverySourceCategoryV1;
  readonly scope: SkillDiscoveryScopeV1;
  readonly runner_id?: string;
  readonly locator: string;
}): SkillDiscoveryDigestV1 {
  return digest(
    OBSERVATION_DOMAIN,
    canonicalJson({
      source_category: input.source_category,
      scope: input.scope,
      ...(input.runner_id ? { runner_id: input.runner_id } : {}),
      locator: input.locator,
    }),
  );
}

/** Compute a deterministic hash of the active runner's safe source declaration set. */
export function computeSkillRegistrySourceScopeHash(input: {
  readonly activeRunnerId: RunnerId;
  readonly sourceDeclarations?: readonly RegistrySourceInputV1[];
}): SkillDiscoveryDigestV1 {
  const sourceDeclarations = canonicalSourceDeclarations(input.activeRunnerId, input.sourceDeclarations ?? []);
  return digest(
    SOURCE_SCOPE_DOMAIN,
    canonicalJson({
      active_runner_id: input.activeRunnerId,
      sources: sourceDeclarations.map(toCanonicalSourceDeclaration),
    }),
  );
}

/** Compute the versioned metadata fingerprint used for freshness classification. */
export function computeSkillRegistryFingerprint(
  input: SkillRegistryFingerprintInputV1,
): SkillDiscoveryDigestV1 {
  const schema = input.schema ?? SKILL_REGISTRY_SCHEMA;
  const schemaVersion = input.schemaVersion ?? SKILL_REGISTRY_SCHEMA_VERSION;
  const fingerprintAlgorithm = input.fingerprintAlgorithm ?? SKILL_REGISTRY_FINGERPRINT_ALGORITHM;
  const privacyPolicyVersion = input.privacyPolicyVersion ?? SKILL_REGISTRY_PRIVACY_POLICY_VERSION;
  const records = [...input.records].map(normalizePersistedRecordForFingerprint).filter(isRecord).sort(compareRecords);
  const sourceDeclarations = canonicalSourceDeclarations(input.activeRunnerId, input.sourceDeclarations ?? []);
  const sourceScopeHash = computeSkillRegistrySourceScopeHash({
    activeRunnerId: input.activeRunnerId,
    sourceDeclarations,
  });

  return digest(
    FINGERPRINT_DOMAIN,
    canonicalJson({
      schema,
      schema_version: schemaVersion,
      fingerprint_algorithm: fingerprintAlgorithm,
      privacy_policy_version: privacyPolicyVersion,
      active_runner_id: input.activeRunnerId,
      source_scope_hash: sourceScopeHash,
      source_scope: sourceDeclarations.map(toCanonicalSourceDeclaration),
      records: records.map(toFingerprintRecord),
    }),
  );
}

/** Stable ordering required by REQ-024. */
export function orderSkillRegistryRecords(
  records: readonly SkillRegistryRecordV1[],
): readonly SkillRegistryRecordV1[] {
  return [...records].sort(compareRecords);
}

/** Render only the deterministic searchable Markdown projection. */
export function renderSkillRegistryBody(frontmatter: SkillRegistryFrontmatterV1): string {
  const lines = [
    "# Skill Registry (discovery-only)",
    "",
    "> This bounded file is a read-only discovery index. It grants no authority, trust, precedence, policy, or scope.",
    "> Frontmatter is the machine source of record data; this body is only a searchable projection.",
    "",
    `- status: ${frontmatter.completeness}`,
    `- candidate_count: ${frontmatter.candidate_count}`,
    `- diagnostic_count: ${frontmatter.diagnostic_count}`,
    `- fingerprint: ${escapeMarkdownValue(frontmatter.fingerprint)}`,
    `- fingerprint_algorithm: ${escapeMarkdownValue(frontmatter.fingerprint_algorithm)}`,
    `- source_scope_hash: ${escapeMarkdownValue(frontmatter.source_scope_hash)}`,
    `- privacy_policy_version: ${escapeMarkdownValue(frontmatter.privacy_policy_version)}`,
    "",
  ];

  for (const record of frontmatter.records) {
    lines.push(
      `## Skill: ${escapeMarkdownValue(record.name)}`,
      `- observation_id: ${escapeMarkdownValue(record.observation_id)}`,
      `- source_category: ${escapeMarkdownValue(record.source_category)}`,
      `- scope: ${escapeMarkdownValue(record.scope)}`,
      `- locator: ${escapeMarkdownValue(record.locator)}`,
    );
    if (record.runner_id) lines.push(`- runner_id: ${escapeMarkdownValue(record.runner_id)}`);
    if (record.task_signals?.length) {
      lines.push(`- task_signals: ${record.task_signals.map(escapeMarkdownValue).join(", ")}`);
    }
    if (record.technology_signals?.length) {
      lines.push(`- technology_signals: ${record.technology_signals.map(escapeMarkdownValue).join(", ")}`);
    }
    if (record.path_signals?.length) {
      lines.push(`- path_signals: ${record.path_signals.map(escapeMarkdownValue).join(", ")}`);
    }
    if (record.description) lines.push(`- description: ${escapeMarkdownValue(record.description)}`);
    if (record.diagnostic) lines.push(`- diagnostic: ${escapeMarkdownValue(record.diagnostic)}`);
    lines.push("");
  }

  lines.push("## Diagnostics");
  if (frontmatter.diagnostics.length === 0) {
    lines.push("- none");
  } else {
    for (const diagnostic of frontmatter.diagnostics) {
      const source = diagnostic.source_id ? ` source_id=${escapeMarkdownValue(diagnostic.source_id)}` : "";
      const locator = diagnostic.locator ? ` locator=${escapeMarkdownValue(diagnostic.locator)}` : "";
      lines.push(`- ${escapeMarkdownValue(diagnostic.code)}: ${escapeMarkdownValue(diagnostic.message)}${source}${locator}`);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Render the ordered frontmatter followed by the searchable body. */
export function renderSkillRegistryMarkdown(frontmatter: SkillRegistryFrontmatterV1): string {
  const ordered = {
    schema: SKILL_REGISTRY_SCHEMA,
    schema_version: SKILL_REGISTRY_SCHEMA_VERSION,
    generated_at: frontmatter.generated_at,
    fingerprint: frontmatter.fingerprint,
    fingerprint_algorithm: SKILL_REGISTRY_FINGERPRINT_ALGORITHM,
    source_scope_hash: frontmatter.source_scope_hash,
    candidate_count: frontmatter.candidate_count,
    diagnostic_count: frontmatter.diagnostic_count,
    privacy_policy_version: SKILL_REGISTRY_PRIVACY_POLICY_VERSION,
    completeness: frontmatter.completeness,
    diagnostics: frontmatter.diagnostics.map(toPlainDiagnostic),
    records: frontmatter.records.map(toPlainRecord),
  };
  const yaml = stringify(ordered, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${renderSkillRegistryBody(frontmatter)}`;
}

/** Parse a bounded V1 registry document without performing discovery or writes. */
export function parseSkillRegistryDocument(source: string): SkillRegistryParseResultV1 {
  if (typeof source !== "string") return parseFailure("malformed_frontmatter", "Registry content is invalid.");
  if (Buffer.byteLength(source, "utf8") > SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes) {
    return parseFailure("malformed_frontmatter", "Registry content exceeds the maximum file size.");
  }

  const parsedYaml = parseRegistryYaml(source);
  if (parsedYaml.error || !parsedYaml.data || !isPlainRecord(parsedYaml.data)) {
    return parseFailure(parsedYaml.error ?? "malformed_frontmatter", "Registry frontmatter is not valid.", parsedYaml.diagnostics);
  }

  const root = parsedYaml.data;
  const schema = root.schema;
  const schemaVersion = parseInteger(root.schema_version);
  if (schema === undefined || schemaVersion === undefined) {
    return parseFailure("missing_schema", "Registry schema fields are required.", parsedYaml.diagnostics);
  }
  if (schema !== SKILL_REGISTRY_SCHEMA || schemaVersion !== SKILL_REGISTRY_SCHEMA_VERSION) {
    return parseFailure("unsupported_schema_version", "Registry schema version is unsupported.", parsedYaml.diagnostics);
  }

  const structural = readRequiredFrontmatter(root);
  if (structural.error) return parseFailure(structural.error, structural.message ?? "Registry frontmatter is invalid.", parsedYaml.diagnostics);

  const rawRecords = structural.records;
  if (rawRecords.length > SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords || structural.candidateCount > SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords) {
    return parseFailure("oversized_candidate_count", "Registry candidate count exceeds the maximum.", parsedYaml.diagnostics);
  }

  const recordDiagnostics: SkillDiscoveryDiagnosticV1[] = [];
  const records: SkillRegistryRecordV1[] = [];
  const observationIds = new Set<string>();
  for (const rawRecord of rawRecords) {
    const normalized = normalizePersistedRecord(rawRecord);
    if (normalized.record) {
      const expectedObservationId = computeSkillObservationId({
        source_category: normalized.record.source_category,
        scope: normalized.record.scope,
        ...(normalized.record.runner_id ? { runner_id: normalized.record.runner_id } : {}),
        locator: normalized.record.locator,
      });
      if (normalized.record.observation_id !== expectedObservationId) {
        recordDiagnostics.push(safeDiagnostic(
          "invalid_observation_id",
          "A registry observation ID does not match its identity fields.",
        ));
      } else if (observationIds.has(normalized.record.observation_id)) {
        recordDiagnostics.push(safeDiagnostic(
          "duplicate_observation_id",
          "A registry contains duplicate observation IDs.",
        ));
      } else {
        observationIds.add(normalized.record.observation_id);
      }
      records.push(normalized.record);
    }
    if (normalized.diagnostic) recordDiagnostics.push(normalized.diagnostic);
  }
  if (recordDiagnostics.length > 0) {
    return parseFailure("malformed_frontmatter", "Registry contains an invalid record.", [
      ...parsedYaml.diagnostics,
      ...recordDiagnostics,
    ]);
  }

  const diagnosticsResult = normalizePersistedDiagnostics(structural.diagnostics);
  if (!diagnosticsResult.ok) {
    return parseFailure("malformed_frontmatter", "Registry diagnostics are invalid.", [
      ...parsedYaml.diagnostics,
      ...diagnosticsResult.diagnostics,
    ]);
  }
  if (structural.candidateCount !== records.length || structural.diagnosticCount !== diagnosticsResult.diagnostics.length) {
    return parseFailure("malformed_frontmatter", "Registry counts do not match retained arrays.", parsedYaml.diagnostics);
  }

  const frontmatter: SkillRegistryFrontmatterV1 = {
    schema: SKILL_REGISTRY_SCHEMA,
    schema_version: SKILL_REGISTRY_SCHEMA_VERSION,
    generated_at: structural.generatedAt,
    fingerprint: structural.fingerprint as SkillDiscoveryDigestV1,
    fingerprint_algorithm: SKILL_REGISTRY_FINGERPRINT_ALGORITHM,
    source_scope_hash: structural.sourceScopeHash,
    candidate_count: records.length,
    diagnostic_count: diagnosticsResult.diagnostics.length,
    privacy_policy_version: SKILL_REGISTRY_PRIVACY_POLICY_VERSION,
    completeness: structural.completeness,
    diagnostics: diagnosticsResult.diagnostics,
    records: orderSkillRegistryRecords(records),
  };
  const body = parsedYaml.body;
  const expectedBody = renderSkillRegistryBody(frontmatter);
  if (normalizeLf(body) !== expectedBody) {
    return parseFailure("malformed_frontmatter", "Registry Markdown projection is invalid.", parsedYaml.diagnostics);
  }

  return {
    ok: true,
    frontmatter,
    body: expectedBody,
    document: renderSkillRegistryMarkdown(frontmatter),
    diagnostics: parsedYaml.diagnostics,
  };
}

/** Compatibility alias for callers that name the operation as validation. */
export const validateSkillRegistryDocument = parseSkillRegistryDocument;

/**
 * Read-only session-start classification. The function intentionally has no
 * cache, watcher, refresh, or writer dependency; callers decide when to invoke
 * it and may invoke it once at session start.
 */
export async function readSkillRegistryStatus(
  input: SkillRegistryReadInputV1,
): Promise<SkillRegistryStatusV1> {
  if (!input || typeof input.projectRoot !== "string" || !path.isAbsolute(input.projectRoot)) {
    return indeterminateStatus("partial_source_evaluation", "The project root could not be evaluated.");
  }

  const registryPath = path.join(input.projectRoot, SKILL_REGISTRY_PATH_V1);
  let file: Buffer;
  try {
    const stats = await fs.stat(registryPath);
    if (!stats.isFile()) return indeterminateStatus("partial_source_evaluation", "The registry file could not be evaluated.");
    if (stats.size > SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes) {
      return invalidStatus("oversized_file", "Registry file exceeds the maximum size.");
    }
    file = await fs.readFile(registryPath);
  } catch (error) {
    if (isMissingFileError(error)) return missingStatus();
    return indeterminateStatus("partial_source_evaluation", "The registry file could not be read.");
  }

  if (file.byteLength > SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes) {
    return invalidStatus("oversized_file", "Registry file exceeds the maximum size.");
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(file);
  } catch {
    return invalidStatus("malformed_frontmatter", "Registry content is not valid UTF-8.");
  }

  const parsed = parseSkillRegistryDocument(source);
  if (!parsed.ok || !parsed.frontmatter) {
    return invalidStatus(parsed.reasonCode ?? "malformed_frontmatter", "Registry validation failed.", parsed.diagnostics);
  }
  if (parsed.frontmatter.completeness === "truncated") {
    return {
      status: "stale",
      reason_code: "truncated_output",
      registry_path: SKILL_REGISTRY_PATH_V1,
      stored_fingerprint: parsed.frontmatter.fingerprint,
    };
  }

  let current: SkillRegistryCanonicalSnapshotV1 | SkillRegistryCurrentEvaluationV1 | SkillRegistryCanonicalizationInputV1 | undefined;
  try {
    current = input.currentSnapshot ?? (input.evaluateCurrent ? await input.evaluateCurrent() : undefined);
  } catch {
    return indeterminateStatus("partial_source_evaluation", "Current sources could not be evaluated.", parsed.diagnostics);
  }
  if (!current) {
    return indeterminateStatus("partial_source_evaluation", "Current sources were not evaluated.", parsed.diagnostics);
  }

  if (isCurrentEvaluation(current) && current.outcome === "indeterminate") {
    return indeterminateStatus(current.reasonCode ?? "partial_source_evaluation", "Current sources could not be fully evaluated.", [
      ...parsed.diagnostics,
      ...(current.diagnostics ?? []),
    ]);
  }

  let currentSnapshot: SkillRegistryCanonicalSnapshotV1 | undefined;
  try {
    currentSnapshot = toCurrentSnapshot(current);
  } catch {
    return indeterminateStatus("partial_source_evaluation", "Current sources returned invalid registry data.", parsed.diagnostics);
  }
  if (!currentSnapshot || currentSnapshot.frontmatter.completeness !== "complete") {
    return indeterminateStatus("truncated_output", "Current registry inputs were bounded before completion.", parsed.diagnostics);
  }

  if (!currentSnapshot.activeRunnerId) {
    return indeterminateStatus("partial_source_evaluation", "Current sources did not provide an active runner.", parsed.diagnostics);
  }

  const currentSourceScopeHash = computeSkillRegistrySourceScopeHash({
    activeRunnerId: currentSnapshot.activeRunnerId,
    sourceDeclarations: currentSnapshot.sourceDeclarations,
  });
  const currentFingerprint = computeSkillRegistryFingerprint({
    activeRunnerId: currentSnapshot.activeRunnerId,
    sourceDeclarations: currentSnapshot.sourceDeclarations,
    records: currentSnapshot.frontmatter.records,
  });
  const storedFingerprint = computeSkillRegistryFingerprint({
    activeRunnerId: currentSnapshot.activeRunnerId,
    sourceDeclarations: currentSnapshot.sourceDeclarations,
    records: parsed.frontmatter.records,
  });

  if (
    parsed.frontmatter.source_scope_hash === currentSourceScopeHash &&
    parsed.frontmatter.fingerprint === storedFingerprint &&
    storedFingerprint === currentFingerprint
  ) {
    return {
      status: "ready",
      reason_code: "fingerprint_match",
      registry_path: SKILL_REGISTRY_PATH_V1,
      fingerprint: parsed.frontmatter.fingerprint,
      candidate_count: parsed.frontmatter.candidate_count,
      diagnostics: parsed.frontmatter.diagnostics,
    };
  }

  return {
    status: "stale",
    reason_code: "fingerprint_mismatch",
    registry_path: SKILL_REGISTRY_PATH_V1,
    stored_fingerprint: parsed.frontmatter.fingerprint,
    current_fingerprint: currentFingerprint,
  };
}

/** Compatibility alias for session-start callers. */
export const validateSkillRegistryAtSessionStart = readSkillRegistryStatus;

function createFrontmatter(input: {
  readonly activeRunnerId: RunnerId;
  readonly sourceDeclarations: readonly SkillDiscoverySourceDeclarationV1[];
  readonly records: readonly SkillRegistryRecordV1[];
  readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
  readonly completeness: "complete" | "truncated";
  readonly generatedAt?: string;
}): SkillRegistryFrontmatterV1 {
  const records = orderSkillRegistryRecords(input.records);
  const sourceScopeHash = computeSkillRegistrySourceScopeHash({
    activeRunnerId: input.activeRunnerId,
    sourceDeclarations: input.sourceDeclarations,
  });
  const fingerprint = computeSkillRegistryFingerprint({
    activeRunnerId: input.activeRunnerId,
    sourceDeclarations: input.sourceDeclarations,
    records,
  });
  return {
    schema: SKILL_REGISTRY_SCHEMA,
    schema_version: SKILL_REGISTRY_SCHEMA_VERSION,
    generated_at: validGeneratedAt(input.generatedAt),
    fingerprint,
    fingerprint_algorithm: SKILL_REGISTRY_FINGERPRINT_ALGORITHM,
    source_scope_hash: sourceScopeHash,
    candidate_count: records.length,
    diagnostic_count: input.diagnostics.length,
    privacy_policy_version: SKILL_REGISTRY_PRIVACY_POLICY_VERSION,
    completeness: input.completeness,
    diagnostics: input.diagnostics,
    records,
  };
}

function normalizeObservation(input: SkillDiscoveryObservationV1): NormalizedRecordResultV1 {
  if (!input || typeof input !== "object") {
    return { diagnostic: safeDiagnostic("invalid_record", "A discovery observation is invalid.") };
  }
  const raw = input as unknown as Record<string, unknown>;
  const name = normalizeMetadataText(raw.name, SKILL_DISCOVERY_V1_BOUNDS.maxDescriptionCharacters);
  const sourceCategory = raw.source_category;
  const scope = raw.scope;
  const locator = typeof raw.locator === "string" ? normalizeSkillLocator(raw.locator) : undefined;
  const runnerId = normalizeRunnerId(raw.runner_id);
  if (!name || typeof sourceCategory !== "string" || !SOURCE_CATEGORIES.has(sourceCategory as SkillDiscoverySourceCategoryV1)) {
    return { diagnostic: safeDiagnostic("invalid_record", "A discovery observation is missing a safe required field.") };
  }
  if (typeof scope !== "string" || !SCOPES.has(scope as SkillDiscoveryScopeV1) || !locator || !isSafeSkillLocator(locator)) {
    return { diagnostic: safeDiagnostic("invalid_record", "A discovery observation has an unsafe required field.") };
  }
  const category = sourceCategory as SkillDiscoverySourceCategoryV1;
  if (RUNNER_SCOPED_CATEGORIES.has(category) && !runnerId) {
    return { diagnostic: safeDiagnostic("missing_runner_id", "A runner-scoped observation has no runner identifier.") };
  }

  const signals = normalizeSignals(raw, "task_signals", "technology_signals", "path_signals");
  if (!signals.ok) return { diagnostic: safeDiagnostic("signal_limit_exceeded", "A discovery observation exceeds a signal bound.") };

  const description = optionalMetadataText(raw.description);
  const record: SkillRegistryRecordV1 = {
    name,
    source_category: category,
    scope: scope as SkillDiscoveryScopeV1,
    locator,
    observation_id: computeSkillObservationId({
      source_category: category,
      scope: scope as SkillDiscoveryScopeV1,
      ...(runnerId ? { runner_id: runnerId } : {}),
      locator,
    }),
    ...(description ? { description } : {}),
    ...(runnerId ? { runner_id: runnerId } : {}),
    ...(signals.task_signals.length ? { task_signals: signals.task_signals } : {}),
    ...(signals.technology_signals.length ? { technology_signals: signals.technology_signals } : {}),
    ...(signals.path_signals.length ? { path_signals: signals.path_signals } : {}),
  };
  return { record };
}

function normalizePersistedRecord(input: unknown): NormalizedRecordResultV1 {
  if (!isPlainRecord(input)) return { diagnostic: safeDiagnostic("invalid_record", "A registry record is not a mapping.") };
  const raw = input;
  const name = normalizeMetadataText(raw.name, SKILL_DISCOVERY_V1_BOUNDS.maxDescriptionCharacters);
  const category = raw.source_category;
  const scope = raw.scope;
  const locator = typeof raw.locator === "string" ? normalizeSkillLocator(raw.locator) : undefined;
  const observationId = normalizeDigestValue(raw.observation_id);
  const runnerId = normalizeRunnerId(raw.runner_id);
  if (!name || typeof category !== "string" || !SOURCE_CATEGORIES.has(category as SkillDiscoverySourceCategoryV1)) {
    return { diagnostic: safeDiagnostic("invalid_record", "A registry record is missing a safe required field.") };
  }
  if (typeof scope !== "string" || !SCOPES.has(scope as SkillDiscoveryScopeV1) || !locator || !isSafeSkillLocator(locator) || !observationId) {
    return { diagnostic: safeDiagnostic("invalid_record", "A registry record has an unsafe required field.") };
  }
  const sourceCategory = category as SkillDiscoverySourceCategoryV1;
  if (RUNNER_SCOPED_CATEGORIES.has(sourceCategory) && !runnerId) {
    return { diagnostic: safeDiagnostic("missing_runner_id", "A runner-scoped record has no runner identifier.") };
  }
  const signals = normalizeSignals(raw, "task_signals", "technology_signals", "path_signals");
  if (!signals.ok) return { diagnostic: safeDiagnostic("signal_limit_exceeded", "A registry record exceeds a signal bound.") };

  const description = optionalMetadataText(raw.description);
  const diagnostic = optionalMetadataText(raw.diagnostic);
  const hasDescription = Object.prototype.hasOwnProperty.call(raw, "description");
  const hasDiagnostic = Object.prototype.hasOwnProperty.call(raw, "diagnostic");
  const hasRunnerId = Object.prototype.hasOwnProperty.call(raw, "runner_id");
  if (
    (hasDescription && !description) ||
    (hasDiagnostic && !diagnostic) ||
    (hasRunnerId && !runnerId)
  ) {
    return { diagnostic: safeDiagnostic("invalid_record", "A registry record contains invalid optional metadata.") };
  }
  return {
    record: {
      name,
      source_category: sourceCategory,
      scope: scope as SkillDiscoveryScopeV1,
      locator,
      observation_id: observationId,
      ...(description ? { description } : {}),
      ...(runnerId ? { runner_id: runnerId } : {}),
      ...(signals.task_signals.length ? { task_signals: signals.task_signals } : {}),
      ...(signals.technology_signals.length ? { technology_signals: signals.technology_signals } : {}),
      ...(signals.path_signals.length ? { path_signals: signals.path_signals } : {}),
      ...(diagnostic ? { diagnostic } : {}),
    },
  };
}

function normalizePersistedRecordForFingerprint(input: SkillRegistryRecordV1): SkillRegistryRecordV1 | undefined {
  return normalizePersistedRecord(input).record;
}

function normalizeSignals(
  raw: Record<string, unknown>,
  taskKey: string,
  technologyKey: string,
  pathKey: string,
): {
  readonly ok: boolean;
  readonly task_signals: readonly string[];
  readonly technology_signals: readonly string[];
  readonly path_signals: readonly string[];
} {
  const task = normalizeSignalArray(raw[taskKey], SKILL_DISCOVERY_V1_BOUNDS.maxTaskSignals);
  const technology = normalizeSignalArray(raw[technologyKey], SKILL_DISCOVERY_V1_BOUNDS.maxTechnologySignals);
  const paths = normalizeSignalArray(raw[pathKey], SKILL_DISCOVERY_V1_BOUNDS.maxPathSignals);
  return {
    ok: task.ok && technology.ok && paths.ok,
    task_signals: task.values,
    technology_signals: technology.values,
    path_signals: paths.values,
  };
}

function normalizeSignalArray(input: unknown, max: number): { readonly ok: boolean; readonly values: readonly string[] } {
  if (input === undefined) return { ok: true, values: [] };
  if (!Array.isArray(input)) return { ok: false, values: [] };
  if (input.length > max) return { ok: false, values: [] };
  const values: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") return { ok: false, values: [] };
    const normalized = normalizeMetadataText(value, SKILL_DISCOVERY_V1_BOUNDS.maxDescriptionCharacters);
    if (!normalized) return { ok: false, values: [] };
    values.push(normalized);
  }
  return { ok: true, values: uniqueSortedStrings(values) };
}

function normalizePersistedDiagnostics(input: unknown): {
  readonly ok: boolean;
  readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
} {
  if (!Array.isArray(input) || input.length > SKILL_DISCOVERY_V1_BOUNDS.maxDiagnostics) {
    return { ok: false, diagnostics: [] };
  }
  const diagnostics: SkillDiscoveryDiagnosticV1[] = [];
  for (const value of input) {
    if (!isPlainRecord(value) || typeof value.code !== "string" || typeof value.message !== "string") {
      return { ok: false, diagnostics: [] };
    }
    const normalized = normalizeDiagnostic(value);
    if (!normalized) return { ok: false, diagnostics: [] };
    diagnostics.push(normalized);
  }
  return { ok: true, diagnostics: boundDiagnostics(diagnostics) };
}

function normalizeDiagnostic(input: Record<string, unknown>): SkillDiscoveryDiagnosticV1 | undefined {
  const code = normalizeSafeValue(input.code);
  const message = normalizeMetadataText(input.message, SKILL_DISCOVERY_V1_BOUNDS.maxDescriptionCharacters);
  if (!code || !message) return undefined;
  const sourceId = input.source_id === undefined ? undefined : normalizeSafeValue(input.source_id);
  const locator = input.locator === undefined || typeof input.locator !== "string"
    ? undefined
    : normalizeSkillLocator(input.locator);
  if (input.source_id !== undefined && !sourceId) return undefined;
  if (input.locator !== undefined && (!locator || !isSafeSkillLocator(locator))) return undefined;
  return {
    code,
    ...(sourceId ? { source_id: sourceId } : {}),
    ...(locator ? { locator } : {}),
    message,
  };
}

function boundDiagnostics(input: readonly SkillDiscoveryDiagnosticV1[]): readonly SkillDiscoveryDiagnosticV1[] {
  const normalized = input
    .map((diagnostic) => normalizeDiagnostic(diagnostic as unknown as Record<string, unknown>))
    .filter((diagnostic): diagnostic is SkillDiscoveryDiagnosticV1 => diagnostic !== undefined)
    .sort(compareDiagnostics)
    .filter((diagnostic, index, all) => index === 0 || !sameDiagnostic(diagnostic, all[index - 1]));
  if (normalized.length <= SKILL_DISCOVERY_V1_BOUNDS.maxDiagnostics) return normalized;
  return [
    ...normalized.slice(0, SKILL_DISCOVERY_V1_BOUNDS.maxDiagnostics - 1),
    { code: "diagnostic_limit_reached", message: "Additional discovery diagnostics were withheld." },
  ];
}

interface BoundedSourceInputsV1 {
  readonly inputs: readonly RegistrySourceInputV1[];
  readonly truncated: boolean;
}

interface BoundedSourceDeclarationsV1 {
  readonly declarations: readonly SkillDiscoverySourceDeclarationV1[];
  readonly truncated: boolean;
}

function normalizeSourceInputs(sourceInputs: readonly RegistrySourceInputV1[]): BoundedSourceInputsV1 {
  try {
    const sourceArray = sourceInputs as unknown as {
      readonly length?: unknown;
      readonly [index: number]: RegistrySourceInputV1 | undefined;
    };
    if (!sourceArray || typeof sourceArray !== "object") {
      return { inputs: [], truncated: true };
    }

    const sourceLength = sourceArray.length;
    if (typeof sourceLength !== "number" || !Number.isSafeInteger(sourceLength) || sourceLength < 0) {
      return { inputs: [], truncated: true };
    }

    const maxCandidateRecords = SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords;
    const firstPassCount = Math.min(sourceLength, maxCandidateRecords + 1);
    const inputs: RegistrySourceInputV1[] = [];
    let coreSourceCount = 0;
    let providerSourceCount = 0;
    let truncated = false;

    const retainInput = (sourceInput: RegistrySourceInputV1 | undefined): void => {
      const declaration = sourceInput === undefined ? undefined : getDeclaration(sourceInput);
      const isCoreSource = declaration !== undefined && CORE_GENERIC_SOURCE_DECLARATIONS.has(declaration.sourceId);
      if (!isCoreSource && providerSourceCount >= maxCandidateRecords) {
        truncated = true;
        return;
      }
      if (sourceInput !== undefined) inputs.push(sourceInput);
      if (isCoreSource) coreSourceCount += 1;
      else providerSourceCount += 1;
    };

    for (let index = 0; index < firstPassCount && !truncated; index += 1) {
      retainInput(sourceArray[index]);
    }

    if (!truncated && coreSourceCount > 0 && sourceLength > firstPassCount) {
      const extendedCount = Math.min(sourceLength, maxCandidateRecords + coreSourceCount + 1);
      for (let index = firstPassCount; index < extendedCount && !truncated; index += 1) {
        retainInput(sourceArray[index]);
      }
    }

    return {
      inputs,
      truncated: truncated || sourceLength > maxCandidateRecords + coreSourceCount,
    };
  } catch {
    return { inputs: [], truncated: true };
  }
}

function normalizeSourceDeclarations(
  activeRunnerId: RunnerId,
  sourceInputs: readonly RegistrySourceInputV1[],
): BoundedSourceDeclarationsV1 {
  const normalized = normalizeSourceInputs(sourceInputs);
  const declarations: SkillDiscoverySourceDeclarationV1[] = [];
  const seenCoreSourceIds = new Set<string>();
  for (let index = 0; index < normalized.inputs.length; index += 1) {
    const declaration = getDeclaration(normalized.inputs[index]);
    if (!declaration) continue;
    const canonicalCoreDeclaration = CORE_GENERIC_SOURCE_DECLARATIONS.get(declaration.sourceId);
    if (canonicalCoreDeclaration) {
      if (seenCoreSourceIds.has(declaration.sourceId)) continue;
      seenCoreSourceIds.add(declaration.sourceId);
      declarations.push({ ...canonicalCoreDeclaration });
      continue;
    }
    if (!isSafeSourceDeclaration(declaration)) continue;
    if (declaration.runnerId !== "runner-neutral" && declaration.runnerId !== activeRunnerId) continue;
    declarations.push({ ...declaration });
  }
  return {
    declarations: declarations.sort(compareSourceDeclarations),
    truncated: normalized.truncated,
  };
}

function canonicalSourceDeclarations(
  activeRunnerId: RunnerId,
  sourceInputs: readonly RegistrySourceInputV1[],
): readonly SkillDiscoverySourceDeclarationV1[] {
  return normalizeSourceDeclarations(activeRunnerId, sourceInputs).declarations;
}

function getDeclaration(input: RegistrySourceInputV1): SkillDiscoverySourceDeclarationV1 | undefined {
  if (!input || typeof input !== "object") return undefined;
  if ("kind" in input && (input.kind === "filesystem" || input.kind === "opaque_inventory")) {
    return input.declaration;
  }
  return input as SkillDiscoverySourceDeclarationV1;
}

function isSafeSourceDeclaration(input: SkillDiscoverySourceDeclarationV1): boolean {
  return input.schema === SKILL_DISCOVERY_SOURCE_SCHEMA &&
    SAFE_TOKEN_PATTERN.test(input.sourceId) &&
    SOURCE_CATEGORIES.has(input.sourceCategory) &&
    SCOPES.has(input.scope) &&
    (input.runnerId === "runner-neutral" || SAFE_TOKEN_PATTERN.test(input.runnerId)) &&
    ["project_relative", "runner_relative", "runner_opaque"].includes(input.locatorStrategy) &&
    ["skill_md", "opaque_inventory_v1"].includes(input.expectedContent) &&
    isSafeSourceLocatorBase(input);
}

function isSafeSourceLocatorBase(input: SkillDiscoverySourceDeclarationV1): boolean {
  if (input.locatorStrategy !== "project_relative") return SAFE_TOKEN_PATTERN.test(input.safeLocatorBase);
  const value = input.safeLocatorBase;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    value.startsWith("/") ||
    value.startsWith("~") ||
    value.startsWith("\\\\") ||
    value.includes("\\") ||
    value.includes("\0") ||
    /^[A-Za-z]:/.test(value)
  ) return false;

  return value.split("/").every((segment) => (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes("..") &&
    !segment.includes("%") &&
    /^[A-Za-z0-9._~-]{1,128}$/.test(segment)
  ));
}

function toCanonicalSourceDeclaration(input: SkillDiscoverySourceDeclarationV1): Record<string, string> {
  return {
    source_id: input.sourceId,
    source_category: input.sourceCategory,
    scope: input.scope,
    runner_id: input.runnerId,
    locator_strategy: input.locatorStrategy,
    safe_locator_base: input.safeLocatorBase,
    expected_content: input.expectedContent,
  };
}

function compareSourceDeclarations(
  left: SkillDiscoverySourceDeclarationV1,
  right: SkillDiscoverySourceDeclarationV1,
): number {
  return compareByteStrings(canonicalJson(toCanonicalSourceDeclaration(left)), canonicalJson(toCanonicalSourceDeclaration(right)));
}

function compareRecords(left: SkillRegistryRecordV1, right: SkillRegistryRecordV1): number {
  return compareByteStrings(left.source_category, right.source_category) ||
    compareByteStrings(caseFoldKey(left.name), caseFoldKey(right.name)) ||
    compareByteStrings(left.name, right.name) ||
    compareByteStrings(left.observation_id, right.observation_id);
}

function compareDiagnostics(left: SkillDiscoveryDiagnosticV1, right: SkillDiscoveryDiagnosticV1): number {
  return compareByteStrings(left.source_id ?? "", right.source_id ?? "") ||
    compareByteStrings(left.code, right.code) ||
    compareByteStrings(left.locator ?? "", right.locator ?? "") ||
    compareByteStrings(left.message, right.message);
}

function toFingerprintRecord(record: SkillRegistryRecordV1): Record<string, unknown> {
  return {
    name: record.name,
    source_category: record.source_category,
    scope: record.scope,
    locator: record.locator,
    observation_id: record.observation_id,
    ...(record.runner_id ? { runner_id: record.runner_id } : {}),
    ...(record.task_signals?.length ? { task_signals: uniqueSortedStrings(record.task_signals) } : {}),
    ...(record.technology_signals?.length ? { technology_signals: uniqueSortedStrings(record.technology_signals) } : {}),
    ...(record.path_signals?.length ? { path_signals: uniqueSortedStrings(record.path_signals) } : {}),
  };
}

function toPlainRecord(record: SkillRegistryRecordV1): Record<string, unknown> {
  return {
    name: record.name,
    source_category: record.source_category,
    scope: record.scope,
    locator: record.locator,
    observation_id: record.observation_id,
    ...(record.description ? { description: record.description } : {}),
    ...(record.runner_id ? { runner_id: record.runner_id } : {}),
    ...(record.task_signals?.length ? { task_signals: [...record.task_signals] } : {}),
    ...(record.technology_signals?.length ? { technology_signals: [...record.technology_signals] } : {}),
    ...(record.path_signals?.length ? { path_signals: [...record.path_signals] } : {}),
    ...(record.diagnostic ? { diagnostic: record.diagnostic } : {}),
  };
}

function toPlainDiagnostic(diagnostic: SkillDiscoveryDiagnosticV1): Record<string, string> {
  return {
    ...(diagnostic.code ? { code: diagnostic.code } : {}),
    ...(diagnostic.source_id ? { source_id: diagnostic.source_id } : {}),
    ...(diagnostic.locator ? { locator: diagnostic.locator } : {}),
    message: diagnostic.message,
  };
}

function parseRegistryYaml(source: string): ParsedYamlRootV1 {
  const normalizedSource = normalizeLf(source);
  const lines = normalizedSource.split("\n");
  if (lines[0]?.startsWith("\uFEFF")) lines[0] = lines[0].slice(1);
  if (lines[0] !== "---") {
    return { body: "", error: "malformed_frontmatter", diagnostics: [] };
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex < 0) {
    return { body: "", error: "malformed_frontmatter", diagnostics: [] };
  }
  const yaml = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n");
  try {
    const document = parseDocument(yaml, {
      customTags: [],
      prettyErrors: false,
      // Failsafe keeps every plain scalar inert. Numeric V1 fields are
      // converted explicitly after parsing instead of enabling implicit YAML
      // types at this trust boundary.
      schema: "failsafe",
      stringKeys: true,
      uniqueKeys: true,
    });
    const inspection = inspectYamlNode(document.contents);
    if (inspection.hasAlias || inspection.hasTag || inspection.maxDepth > SKILL_DISCOVERY_V1_BOUNDS.maxFrontmatterDepth) {
      return { body, error: "malformed_frontmatter", diagnostics: [] };
    }
    if (document.errors.length > 0 || document.warnings.length > 0) {
      return { body, error: "malformed_frontmatter", diagnostics: [] };
    }
    return { body, data: document.toJS({ maxAliasCount: 0 }), diagnostics: [] };
  } catch {
    return { body, error: "malformed_frontmatter", diagnostics: [] };
  }
}

function readRequiredFrontmatter(root: Record<string, unknown>): {
  readonly error?: Extract<SkillRegistryStatusReasonCodeV1, "malformed_frontmatter" | "oversized_candidate_count">;
  readonly message?: string;
  readonly generatedAt: string;
  readonly fingerprint: string;
  readonly sourceScopeHash: string;
  readonly candidateCount: number;
  readonly diagnosticCount: number;
  readonly completeness: "complete" | "truncated";
  readonly diagnostics: unknown[];
  readonly records: unknown[];
} {
  const generatedAt = root.generated_at;
  const fingerprint = root.fingerprint;
  const fingerprintAlgorithm = root.fingerprint_algorithm;
  const sourceScopeHash = root.source_scope_hash;
  const candidateCount = root.candidate_count;
  const diagnosticCount = root.diagnostic_count;
  const privacyPolicyVersion = root.privacy_policy_version;
  const completeness = root.completeness;
  const diagnostics = root.diagnostics;
  const records = root.records;
  if (
    typeof generatedAt !== "string" ||
    !isIso8601Timestamp(generatedAt) ||
    typeof fingerprint !== "string" ||
    !isSha256Digest(fingerprint) ||
    typeof fingerprintAlgorithm !== "string" ||
    fingerprintAlgorithm !== SKILL_REGISTRY_FINGERPRINT_ALGORITHM ||
    typeof sourceScopeHash !== "string" ||
    !isSha256Digest(sourceScopeHash) ||
    parseInteger(candidateCount) === undefined ||
    (parseInteger(candidateCount) ?? -1) < 0 ||
    parseInteger(diagnosticCount) === undefined ||
    (parseInteger(diagnosticCount) ?? -1) < 0 ||
    privacyPolicyVersion !== SKILL_REGISTRY_PRIVACY_POLICY_VERSION ||
    (completeness !== "complete" && completeness !== "truncated") ||
    !Array.isArray(diagnostics) ||
    !Array.isArray(records)
  ) {
    return {
      error: "malformed_frontmatter",
      message: "Registry required fields are invalid.",
      generatedAt: "",
      fingerprint: "",
      sourceScopeHash: "",
      candidateCount: 0,
      diagnosticCount: 0,
      completeness: "truncated",
      diagnostics: [],
      records: [],
    };
  }
  return {
    generatedAt,
    fingerprint,
    sourceScopeHash,
    candidateCount: parseInteger(candidateCount) as number,
    diagnosticCount: parseInteger(diagnosticCount) as number,
    completeness,
    diagnostics,
    records,
  };
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
  const visit = (child: unknown, childDepth: number): void => {
    const result = inspectYamlNode(child, childDepth, seen);
    maxDepth = Math.max(maxDepth, result.maxDepth);
    hasAlias ||= result.hasAlias;
    hasTag ||= result.hasTag;
  };
  if (Array.isArray(value.items)) {
    const isMap = value.items.some((item) => item !== null && typeof item === "object" && "key" in item);
    for (const item of value.items) {
      if (isMap && item && typeof item === "object") {
        const pair = item as { readonly key?: unknown; readonly value?: unknown };
        // Mapping keys are scalar labels, not additional structural depth.
        // Count the value collection itself so the V1 root -> records ->
        // record -> signals shape remains within the three-level contract.
        visit(pair.key, depth);
        visit(pair.value, depth + 1);
      } else {
        const isCollection = item !== null && typeof item === "object" && Array.isArray((item as { readonly items?: unknown }).items);
        visit(item, isCollection ? depth + 1 : depth);
      }
    }
  } else if (value.value && typeof value.value === "object") {
    visit(value.value, depth + 1);
  }
  return { maxDepth, hasAlias, hasTag };
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}

function normalizeMetadataText(input: unknown, max: number): string | undefined {
  if (typeof input !== "string") return undefined;
  let normalized = input.normalize("NFKC").replace(CONTROL_OR_BIDI_PATTERN, "");
  normalized = normalized.replace(/[\r\n\t]+/g, " ").replace(LOCAL_PATH_PATTERN, "[local path removed]");
  for (const pattern of INSTRUCTION_LIKE_PATTERNS) normalized = normalized.replace(pattern, "[instruction-like text removed]");
  normalized = normalized.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  return characters.slice(0, max).join("") || undefined;
}

function optionalMetadataText(input: unknown): string | undefined {
  return input === undefined ? undefined : normalizeMetadataText(input, SKILL_DISCOVERY_V1_BOUNDS.maxDescriptionCharacters);
}

function normalizeSafeValue(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = normalizeMetadataText(input, SKILL_DISCOVERY_V1_BOUNDS.maxDescriptionCharacters);
  return normalized && SAFE_TOKEN_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeDigestValue(input: unknown): string | undefined {
  return isSha256Digest(input) ? input : undefined;
}

function isSha256Digest(input: unknown): input is SkillDiscoveryDigestV1 {
  return typeof input === "string" && SHA256_DIGEST_PATTERN.test(input);
}

function isIso8601Timestamp(input: unknown): input is string {
  return typeof input === "string" &&
    ISO_8601_TIMESTAMP_PATTERN.test(input) &&
    !Number.isNaN(Date.parse(input));
}

function normalizeRunnerId(input: unknown): string | undefined {
  return normalizeSafeValue(input);
}

function parseInteger(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isInteger(input)) return input;
  if (typeof input !== "string" || !/^\d+$/.test(input)) return undefined;
  const parsed = Number(input);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareByteStrings);
}

function caseFoldKey(value: string): string {
  const specialCaseFolds: Record<string, string> = {
    "ß": "ss",
    "ẞ": "ss",
    "ς": "σ",
    "İ": "i\u0307",
  };
  return Array.from(value.normalize("NFKC"))
    .map((character) => specialCaseFolds[character] ?? character.toLocaleLowerCase("und"))
    .join("")
    .normalize("NFKC");
}

function compareByteStrings(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function digest(domain: string, value: string): SkillDiscoveryDigestV1 {
  return `sha256:${createHash("sha256").update(`${domain}\0${value}`, "utf8").digest("hex")}`;
}

function escapeMarkdownValue(value: string): string {
  return normalizeMetadataText(value, SKILL_DISCOVERY_V1_BOUNDS.maxDescriptionCharacters)
    ?.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_#[\]|()]/g, "\\$&") ?? "";
}

function validGeneratedAt(value: string | undefined): string {
  if (isIso8601Timestamp(value)) return value;
  return new Date().toISOString();
}

function normalizeLf(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function safeDiagnostic(code: string, message: string): SkillDiscoveryDiagnosticV1 {
  return { code: normalizeSafeValue(code) ?? "invalid_diagnostic", message: normalizeMetadataText(message, 500) ?? "Registry diagnostic." };
}

function sameDiagnostic(left: SkillDiscoveryDiagnosticV1, right: SkillDiscoveryDiagnosticV1): boolean {
  return left.code === right.code &&
    left.source_id === right.source_id &&
    left.locator === right.locator &&
    left.message === right.message;
}

function parseFailure(
  reasonCode: Extract<SkillRegistryStatusReasonCodeV1, "unsupported_schema_version" | "missing_schema" | "malformed_frontmatter" | "oversized_candidate_count">,
  message: string,
  diagnostics: readonly SkillDiscoveryDiagnosticV1[] = [],
): SkillRegistryParseResultV1 {
  return {
    ok: false,
    reasonCode,
    diagnostics: boundDiagnostics([...diagnostics, safeDiagnostic(reasonCode, message)]),
  };
}

function missingStatus(): SkillRegistryStatusV1 {
  return {
    status: "missing",
    reason_code: "file_absent",
    registry_path: SKILL_REGISTRY_PATH_V1,
  };
}

function invalidStatus(
  reasonCode: Extract<SkillRegistryStatusReasonCodeV1, "unsupported_schema_version" | "missing_schema" | "malformed_frontmatter" | "oversized_file" | "oversized_candidate_count">,
  message: string,
  diagnostics: readonly SkillDiscoveryDiagnosticV1[] = [],
): SkillRegistryStatusV1 {
  return {
    status: "invalid",
    reason_code: reasonCode,
    registry_path: SKILL_REGISTRY_PATH_V1,
    diagnostics: boundDiagnostics([...diagnostics, safeDiagnostic(reasonCode, message)]),
  };
}

function indeterminateStatus(
  reasonCode: "partial_source_evaluation" | "truncated_output",
  message: string,
  diagnostics: readonly SkillDiscoveryDiagnosticV1[] = [],
): SkillRegistryStatusV1 {
  return {
    status: "indeterminate",
    reason_code: reasonCode,
    registry_path: SKILL_REGISTRY_PATH_V1,
    diagnostics: boundDiagnostics([...diagnostics, safeDiagnostic(reasonCode, message)]),
  };
}

function isMissingFileError(error: unknown): boolean {
  return isPlainRecord(error) && error.code === "ENOENT";
}

function isCurrentEvaluation(
  input: SkillRegistryCanonicalSnapshotV1 | SkillRegistryCurrentEvaluationV1 | SkillRegistryCanonicalizationInputV1,
): input is SkillRegistryCurrentEvaluationV1 {
  return isPlainRecord(input) && input.outcome !== undefined;
}

function toCurrentSnapshot(
  input: SkillRegistryCanonicalSnapshotV1 | SkillRegistryCurrentEvaluationV1 | SkillRegistryCanonicalizationInputV1,
): SkillRegistryCanonicalSnapshotV1 | undefined {
  if (isCanonicalSnapshot(input)) {
    if (input.frontmatter.completeness !== "complete" || !input.activeRunnerId) return input;
    return canonicalizeSkillRegistry({
      activeRunnerId: input.activeRunnerId,
      sourceDeclarations: input.sourceDeclarations,
      observations: input.frontmatter.records as unknown as SkillDiscoveryObservationV1[],
      diagnostics: input.frontmatter.diagnostics,
      generatedAt: input.frontmatter.generated_at,
    });
  }
  if (isCurrentEvaluation(input)) {
    if (input.outcome !== "complete") return undefined;
    if (input.activeRunnerId && Array.isArray(input.observations)) {
      return canonicalizeSkillRegistry({
        activeRunnerId: input.activeRunnerId,
        sourceDeclarations: input.sourceDeclarations,
        observations: input.observations as SkillDiscoveryObservationV1[],
        diagnostics: input.diagnostics,
      });
    }
    if (input.snapshot) {
      return toCurrentSnapshot({
        ...input.snapshot,
        ...(input.activeRunnerId ? { activeRunnerId: input.activeRunnerId } : {}),
      });
    }
    return undefined;
  }
  return canonicalizeSkillRegistry(input);
}

function isCanonicalSnapshot(input: unknown): input is SkillRegistryCanonicalSnapshotV1 {
  return isPlainRecord(input) &&
    isPlainRecord(input.frontmatter) &&
    typeof input.document === "string" &&
    typeof input.body === "string" &&
    Array.isArray(input.sourceDeclarations);
}

function isRecord(input: SkillRegistryRecordV1 | undefined): input is SkillRegistryRecordV1 {
  return input !== undefined;
}

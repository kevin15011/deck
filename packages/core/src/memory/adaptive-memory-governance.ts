import {
  ADAPTIVE_MEMORY_CREATORS,
  ADAPTIVE_MEMORY_PROMOTION_STATUSES,
  ADAPTIVE_MEMORY_SCOPES,
  ADAPTIVE_MEMORY_SOURCES,
  ADAPTIVE_MEMORY_TYPES,
  type AdaptiveMemoryCandidate,
  type AdaptiveMemoryCommitPolicy,
  type AdaptiveMemoryCommitRequest,
  type AdaptiveMemoryContainerTag,
  type AdaptiveMemoryMetadata,
  type AdaptiveMemoryScope,
  type AdaptiveMemoryScopeRef,
  type AdaptiveMemorySearchFilters,
  mergeAdaptiveMemoryCommitPolicy,
} from "./adaptive-memory-contract";

export const MAX_ADAPTIVE_MEMORY_CONTAINER_TAG_LENGTH = 100;
export const ADAPTIVE_MEMORY_CONTAINER_TAG_PATTERN = /^[A-Za-z0-9_:-]+$/;

export type AdaptiveMemoryGovernanceErrorCode =
  | "ADAPTIVE_MEMORY_INVALID_SCOPE"
  | "ADAPTIVE_MEMORY_INVALID_CONTAINER_TAG"
  | "ADAPTIVE_MEMORY_METADATA_REQUIRED"
  | "ADAPTIVE_MEMORY_CONFIDENCE_INVALID"
  | "ADAPTIVE_MEMORY_PROMOTION_STATUS_INVALID"
  | "ADAPTIVE_MEMORY_FORBIDDEN_CONTENT"
  | "ADAPTIVE_MEMORY_COMMIT_LIMIT_EXCEEDED"
  | "ADAPTIVE_MEMORY_LOW_SIGNAL"
  | "ADAPTIVE_MEMORY_TEAM_CANDIDATE_REQUIRED"
  | "ADAPTIVE_MEMORY_SEARCH_FILTER_INVALID"
  | "ADAPTIVE_MEMORY_AUDIT_REQUIRED";

export type AdaptiveMemoryGovernanceIssue = {
  code: AdaptiveMemoryGovernanceErrorCode;
  message: string;
  field?: string;
};

export type AdaptiveMemoryGovernanceResult = {
  valid: boolean;
  issues: AdaptiveMemoryGovernanceIssue[];
};

export type AdaptiveMemoryCommitAuditDecision = {
  accepted: boolean;
  scope: AdaptiveMemoryScope;
  source: AdaptiveMemoryMetadata["source"];
  reason: string;
};

export type AdaptiveMemoryCommitAudit = {
  savedCount: number;
  discardedCount: number;
  decisions: AdaptiveMemoryCommitAuditDecision[];
};

const FORBIDDEN_CONTENT_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(active\s+spec|active\s+requirement|active\s+task)\b/i, reason: "active OpenSpec artifacts" },
  { pattern: /\b(raw\s+chat|transcript)\b/i, reason: "raw chats" },
  { pattern: /\b(secret|credential|api[-_ ]?key|token|password|private[-_ ]?key)\b/i, reason: "secrets or credentials" },
  { pattern: /\b(sensitive\s+code|proprietary\s+code)\b/i, reason: "sensitive code" },
  { pattern: /\b(unapproved\s+requirement|experimental\s+delta)\b/i, reason: "unapproved or experimental requirements" },
  { pattern: /\bengram\s+migration\b/i, reason: "Engram migration payloads" },
];

export function validateAdaptiveMemoryScope(scope: AdaptiveMemoryScopeRef): AdaptiveMemoryGovernanceResult {
  const issues: AdaptiveMemoryGovernanceIssue[] = [];

  if (!(ADAPTIVE_MEMORY_SCOPES as readonly string[]).includes(scope.scope)) {
    issues.push({
      code: "ADAPTIVE_MEMORY_INVALID_SCOPE",
      message: "Memory scope must be personal, project, team, or org.",
      field: "scope",
    });
  }

  if (scope.scope === "personal" && !hasValue(scope.userId)) {
    issues.push({
      code: "ADAPTIVE_MEMORY_INVALID_SCOPE",
      message: "Personal memory scope requires userId.",
      field: "userId",
    });
  }

  if (scope.scope === "project" && !hasValue(scope.projectId)) {
    issues.push({
      code: "ADAPTIVE_MEMORY_INVALID_SCOPE",
      message: "Project memory scope requires projectId.",
      field: "projectId",
    });
  }

  if (scope.scope === "team" && !hasValue(scope.teamId)) {
    issues.push({
      code: "ADAPTIVE_MEMORY_INVALID_SCOPE",
      message: "Team memory scope requires teamId.",
      field: "teamId",
    });
  }

  if (scope.scope === "org" && !hasValue(scope.orgId)) {
    issues.push({
      code: "ADAPTIVE_MEMORY_INVALID_SCOPE",
      message: "Org memory scope requires orgId.",
      field: "orgId",
    });
  }

  return toResult(issues);
}

export function validateContainerTag(tag: AdaptiveMemoryContainerTag): AdaptiveMemoryGovernanceResult {
  const issues: AdaptiveMemoryGovernanceIssue[] = [];

  if (!hasValue(tag)) {
    issues.push({
      code: "ADAPTIVE_MEMORY_INVALID_CONTAINER_TAG",
      message: "Container tag is required.",
      field: "containerTag",
    });
  } else {
    if (tag.length > MAX_ADAPTIVE_MEMORY_CONTAINER_TAG_LENGTH) {
      issues.push({
        code: "ADAPTIVE_MEMORY_INVALID_CONTAINER_TAG",
        message: "Container tag must be 100 characters or fewer.",
        field: "containerTag",
      });
    }

    if (!ADAPTIVE_MEMORY_CONTAINER_TAG_PATTERN.test(tag)) {
      issues.push({
        code: "ADAPTIVE_MEMORY_INVALID_CONTAINER_TAG",
        message: "Container tag may contain only letters, numbers, _, :, and -.",
        field: "containerTag",
      });
    }
  }

  return toResult(issues);
}

export function validateAdaptiveMemoryMetadata(
  metadata: Partial<AdaptiveMemoryMetadata> | undefined,
): AdaptiveMemoryGovernanceResult {
  const issues: AdaptiveMemoryGovernanceIssue[] = [];

  if (!metadata) {
    return toResult([
      {
        code: "ADAPTIVE_MEMORY_METADATA_REQUIRED",
        message: "Memory metadata is required.",
        field: "metadata",
      },
    ]);
  }

  if (!includes(ADAPTIVE_MEMORY_SOURCES, metadata.source)) {
    issues.push({
      code: "ADAPTIVE_MEMORY_METADATA_REQUIRED",
      message: "Memory source metadata is required and must be supported.",
      field: "metadata.source",
    });
  }

  if (!includes(ADAPTIVE_MEMORY_SCOPES, metadata.scope)) {
    issues.push({
      code: "ADAPTIVE_MEMORY_METADATA_REQUIRED",
      message: "Memory scope metadata is required and must be supported.",
      field: "metadata.scope",
    });
  }

  if (!includes(ADAPTIVE_MEMORY_TYPES, metadata.type)) {
    issues.push({
      code: "ADAPTIVE_MEMORY_METADATA_REQUIRED",
      message: "Memory type metadata is required and must be supported.",
      field: "metadata.type",
    });
  }

  if (typeof metadata.confidence !== "number" || !Number.isFinite(metadata.confidence)) {
    issues.push({
      code: "ADAPTIVE_MEMORY_CONFIDENCE_INVALID",
      message: "Memory confidence metadata is required and must be numeric.",
      field: "metadata.confidence",
    });
  } else if (metadata.confidence < 0 || metadata.confidence > 1) {
    issues.push({
      code: "ADAPTIVE_MEMORY_CONFIDENCE_INVALID",
      message: "Memory confidence must be between 0 and 1.",
      field: "metadata.confidence",
    });
  }

  if (!includes(ADAPTIVE_MEMORY_CREATORS, metadata.createdBy)) {
    issues.push({
      code: "ADAPTIVE_MEMORY_METADATA_REQUIRED",
      message: "Memory creator metadata is required and must be user, agent, or system.",
      field: "metadata.createdBy",
    });
  }

  if (
    metadata.promotionStatus !== undefined &&
    !includes(ADAPTIVE_MEMORY_PROMOTION_STATUSES, metadata.promotionStatus)
  ) {
    issues.push({
      code: "ADAPTIVE_MEMORY_PROMOTION_STATUS_INVALID",
      message: "Memory promotion status must be candidate, approved, or rejected.",
      field: "metadata.promotionStatus",
    });
  }

  return toResult(issues);
}

export function validateTeamCandidatePromotion(
  metadata: AdaptiveMemoryMetadata,
  options?: { explicitlyApproved?: boolean },
): AdaptiveMemoryGovernanceResult {
  if (metadata.scope !== "team" || options?.explicitlyApproved) {
    return toResult([]);
  }

  if (metadata.promotionStatus !== "candidate") {
    return toResult([
      {
        code: "ADAPTIVE_MEMORY_TEAM_CANDIDATE_REQUIRED",
        message: "Team memory requires candidate status unless explicitly approved.",
        field: "metadata.promotionStatus",
      },
    ]);
  }

  return toResult([]);
}

export function validateForbiddenMemoryContent(content: string): AdaptiveMemoryGovernanceResult {
  const issues = FORBIDDEN_CONTENT_PATTERNS.filter(({ pattern }) => pattern.test(content)).map(
    ({ reason }) => ({
      code: "ADAPTIVE_MEMORY_FORBIDDEN_CONTENT" as const,
      message: `This content is not allowed in adaptive memory: ${reason}.`,
      field: "content",
    }),
  );

  return toResult(issues);
}

export function validateAdaptiveMemoryCandidate(
  candidate: AdaptiveMemoryCandidate,
  options?: { explicitlyApprovedTeamMemory?: boolean },
): AdaptiveMemoryGovernanceResult {
  const issues = [
    ...validateAdaptiveMemoryScope(candidate.scope).issues,
    ...validateContainerTag(candidate.containerTag).issues,
    ...validateAdaptiveMemoryMetadata(candidate.metadata).issues,
    ...validateForbiddenMemoryContent(candidate.content).issues,
  ];

  if (!candidate.highSignal) {
    issues.push({
      code: "ADAPTIVE_MEMORY_LOW_SIGNAL",
      message: "Saved memory candidates must be high-signal learnings.",
      field: "highSignal",
    });
  }

  if (candidate.scope.scope !== candidate.metadata.scope) {
    issues.push({
      code: "ADAPTIVE_MEMORY_METADATA_REQUIRED",
      message: "Memory scope metadata must match the candidate scope.",
      field: "metadata.scope",
    });
  }

  issues.push(
    ...validateTeamCandidatePromotion(candidate.metadata, {
      explicitlyApproved: options?.explicitlyApprovedTeamMemory,
    }).issues,
  );

  return toResult(issues);
}

export function validateAdaptiveMemoryCommitRequest(
  request: AdaptiveMemoryCommitRequest,
  policy?: Partial<AdaptiveMemoryCommitPolicy>,
): AdaptiveMemoryGovernanceResult {
  const resolvedPolicy = mergeAdaptiveMemoryCommitPolicy({ ...request.policy, ...policy });
  const issues: AdaptiveMemoryGovernanceIssue[] = [];

  if (request.candidates.length > resolvedPolicy.maxMemoriesPerSession) {
    issues.push({
      code: "ADAPTIVE_MEMORY_COMMIT_LIMIT_EXCEEDED",
      message: `Session memory commit may save at most ${resolvedPolicy.maxMemoriesPerSession} learnings.`,
      field: "candidates",
    });
  }

  for (const [index, candidate] of request.candidates.entries()) {
    const candidateIssues = validateAdaptiveMemoryCandidate(candidate).issues;
    for (const issue of candidateIssues) {
      issues.push({ ...issue, field: issue.field ? `candidates.${index}.${issue.field}` : `candidates.${index}` });
    }
  }

  return toResult(issues);
}

export function validateAdaptiveMemorySearchFilters(
  filters: AdaptiveMemorySearchFilters | undefined,
): AdaptiveMemoryGovernanceResult {
  if (!filters) return toResult([]);

  const issues: AdaptiveMemoryGovernanceIssue[] = [];

  for (const [index, scope] of (filters.scopes ?? []).entries()) {
    for (const issue of validateAdaptiveMemoryScope(scope).issues) {
      issues.push({ ...issue, code: "ADAPTIVE_MEMORY_SEARCH_FILTER_INVALID", field: `scopes.${index}.${issue.field ?? "scope"}` });
    }
  }

  for (const [index, tag] of (filters.containerTags ?? []).entries()) {
    for (const issue of validateContainerTag(tag).issues) {
      issues.push({ ...issue, code: "ADAPTIVE_MEMORY_SEARCH_FILTER_INVALID", field: `containerTags.${index}` });
    }
  }

  if (filters.metadata?.scope !== undefined && !includes(ADAPTIVE_MEMORY_SCOPES, filters.metadata.scope)) {
    issues.push({
      code: "ADAPTIVE_MEMORY_SEARCH_FILTER_INVALID",
      message: "Metadata scope filter must be personal, project, team, or org.",
      field: "metadata.scope",
    });
  }

  return toResult(issues);
}

export function createAdaptiveMemoryCommitAudit(
  candidates: readonly AdaptiveMemoryCandidate[],
  acceptedIndexes: ReadonlySet<number>,
  reasonByIndex?: ReadonlyMap<number, string>,
): AdaptiveMemoryCommitAudit {
  const decisions = candidates.map((candidate, index) => ({
    accepted: acceptedIndexes.has(index),
    scope: candidate.metadata.scope,
    source: candidate.metadata.source,
    reason: reasonByIndex?.get(index) ?? (acceptedIndexes.has(index) ? "accepted" : "discarded"),
  }));

  return {
    savedCount: decisions.filter((decision) => decision.accepted).length,
    discardedCount: decisions.filter((decision) => !decision.accepted).length,
    decisions,
  };
}

function toResult(issues: AdaptiveMemoryGovernanceIssue[]): AdaptiveMemoryGovernanceResult {
  return { valid: issues.length === 0, issues };
}

function hasValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function includes<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

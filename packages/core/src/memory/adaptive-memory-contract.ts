export type AdaptiveMemoryProviderId = string & {};

export const ADAPTIVE_MEMORY_SCOPES = ["personal", "project", "team", "org"] as const;
export type AdaptiveMemoryScope = (typeof ADAPTIVE_MEMORY_SCOPES)[number];

export const ADAPTIVE_MEMORY_SOURCES = [
  "user_correction",
  "repeated_rejection",
  "preference",
  "project_retrospective",
  "human_review",
  "agent_summary",
  "system",
] as const;
export type AdaptiveMemorySource = (typeof ADAPTIVE_MEMORY_SOURCES)[number];

export const ADAPTIVE_MEMORY_TYPES = [
  "preference",
  "correction",
  "pattern",
  "heuristic",
  "convention",
  "workflow",
  "anti_pattern",
  "retrospective",
] as const;
export type AdaptiveMemoryType = (typeof ADAPTIVE_MEMORY_TYPES)[number];

export const ADAPTIVE_MEMORY_CREATORS = ["user", "agent", "system"] as const;
export type AdaptiveMemoryCreator = (typeof ADAPTIVE_MEMORY_CREATORS)[number];

export const ADAPTIVE_MEMORY_PROMOTION_STATUSES = [
  "candidate",
  "approved",
  "rejected",
] as const;
export type AdaptiveMemoryPromotionStatus =
  (typeof ADAPTIVE_MEMORY_PROMOTION_STATUSES)[number];

export type AdaptiveMemoryProviderIdentity = {
  id: AdaptiveMemoryProviderId;
  displayName: string;
  version?: string;
};

export type AdaptiveMemoryScopeRef = {
  scope: AdaptiveMemoryScope;
  userId?: string;
  projectId?: string;
  teamId?: string;
  orgId?: string;
};

export type AdaptiveMemoryContainerTag = string;

export type AdaptiveMemoryMetadata = {
  source: AdaptiveMemorySource;
  scope: AdaptiveMemoryScope;
  type: AdaptiveMemoryType;
  confidence: number;
  createdBy: AdaptiveMemoryCreator;
  projectId?: string;
  changeName?: string;
  phase?: string;
  artifactPath?: string;
  promotionStatus?: AdaptiveMemoryPromotionStatus;
  reason?: string;
};

export type AdaptiveMemorySearchFilters = {
  scopes?: readonly AdaptiveMemoryScopeRef[];
  containerTags?: readonly AdaptiveMemoryContainerTag[];
  metadata?: Partial<
    Pick<
      AdaptiveMemoryMetadata,
      | "source"
      | "scope"
      | "type"
      | "projectId"
      | "changeName"
      | "phase"
      | "artifactPath"
      | "promotionStatus"
    >
  >;
};

export type AdaptiveMemoryContextRequest = {
  phase?: string;
  query?: string;
  scopes: readonly AdaptiveMemoryScopeRef[];
  filters?: AdaptiveMemorySearchFilters;
  limit?: number;
};

export type AdaptiveMemoryContextItem = {
  id?: string;
  content: string;
  metadata: AdaptiveMemoryMetadata;
  containerTag?: AdaptiveMemoryContainerTag;
};

export type AdaptiveMemoryContextResult = {
  providerId: AdaptiveMemoryProviderId;
  items: readonly AdaptiveMemoryContextItem[];
  diagnostics?: readonly AdaptiveMemoryDiagnostic[];
};

export type AdaptiveMemorySearchRequest = {
  query: string;
  scopes: readonly AdaptiveMemoryScopeRef[];
  filters?: AdaptiveMemorySearchFilters;
  limit?: number;
};

export type AdaptiveMemorySearchResult = AdaptiveMemoryContextResult;

export type AdaptiveMemoryCandidate = {
  content: string;
  containerTag: AdaptiveMemoryContainerTag;
  metadata: AdaptiveMemoryMetadata;
  scope: AdaptiveMemoryScopeRef;
  highSignal: boolean;
};

export type AdaptiveMemoryCommitPolicy = {
  maxMemoriesPerSession: number;
  preferredMinimumHighSignalMemories?: number;
  requireHighSignal: boolean;
};

export const DEFAULT_ADAPTIVE_MEMORY_COMMIT_POLICY: AdaptiveMemoryCommitPolicy = {
  maxMemoriesPerSession: 7,
  preferredMinimumHighSignalMemories: 3,
  requireHighSignal: true,
};

export type AdaptiveMemoryCommitRequest = {
  candidates: readonly AdaptiveMemoryCandidate[];
  policy?: Partial<AdaptiveMemoryCommitPolicy>;
};

export type AdaptiveMemoryCommitDecision = {
  accepted: boolean;
  scope: AdaptiveMemoryScope;
  source: AdaptiveMemorySource;
  reason: string;
};

export type AdaptiveMemoryCommitResult = {
  savedCount: number;
  discardedCount: number;
  decisions: readonly AdaptiveMemoryCommitDecision[];
  diagnostics?: readonly AdaptiveMemoryDiagnostic[];
};

export type AdaptiveMemoryConfigureRequest = {
  providerId: AdaptiveMemoryProviderId;
  scopes?: readonly AdaptiveMemoryScopeRef[];
  defaults?: {
    limit?: number;
    commitPolicy?: Partial<AdaptiveMemoryCommitPolicy>;
  };
  providerState?: Record<string, unknown>;
};

export type AdaptiveMemoryHealthStatus = "available" | "unavailable" | "degraded" | "unknown";

export type AdaptiveMemoryHealthResult = {
  providerId: AdaptiveMemoryProviderId;
  status: AdaptiveMemoryHealthStatus;
  checkedAt?: string;
  diagnostics?: readonly AdaptiveMemoryDiagnostic[];
};

export type AdaptiveMemoryDiagnosticSeverity = "info" | "warning" | "error";

export type AdaptiveMemoryDiagnosticCode =
  | "ADAPTIVE_MEMORY_PROVIDER_UNAVAILABLE"
  | "ADAPTIVE_MEMORY_PROVIDER_UNSUPPORTED"
  | "ADAPTIVE_MEMORY_CONFIG_INVALID"
  | "ADAPTIVE_MEMORY_HEALTH_UNKNOWN"
  | "ADAPTIVE_MEMORY_GOVERNANCE_REJECTED"
  | "ADAPTIVE_MEMORY_OPERATION_UNSUPPORTED";

export type AdaptiveMemoryDiagnostic = {
  code: AdaptiveMemoryDiagnosticCode;
  severity: AdaptiveMemoryDiagnosticSeverity;
  message: string;
  providerId?: AdaptiveMemoryProviderId;
  recoverable: boolean;
  details?: Readonly<Record<string, unknown>>;
};

export type AdaptiveMemoryAdapter = {
  identity: AdaptiveMemoryProviderIdentity;
  loadContext(request: AdaptiveMemoryContextRequest): Promise<AdaptiveMemoryContextResult>;
  search(request: AdaptiveMemorySearchRequest): Promise<AdaptiveMemorySearchResult>;
  commit(request: AdaptiveMemoryCommitRequest): Promise<AdaptiveMemoryCommitResult>;
  configure(request: AdaptiveMemoryConfigureRequest): Promise<void>;
  health(): Promise<AdaptiveMemoryHealthResult>;
};

export function isAdaptiveMemoryScope(value: string): value is AdaptiveMemoryScope {
  return (ADAPTIVE_MEMORY_SCOPES as readonly string[]).includes(value);
}

export function createAdaptiveMemoryDiagnostic(
  code: AdaptiveMemoryDiagnosticCode,
  message: string,
  options?: {
    severity?: AdaptiveMemoryDiagnosticSeverity;
    providerId?: AdaptiveMemoryProviderId;
    recoverable?: boolean;
    details?: Readonly<Record<string, unknown>>;
  },
): AdaptiveMemoryDiagnostic {
  return {
    code,
    message,
    severity: options?.severity ?? "warning",
    providerId: options?.providerId,
    recoverable: options?.recoverable ?? true,
    details: options?.details,
  };
}

export function mergeAdaptiveMemoryCommitPolicy(
  policy?: Partial<AdaptiveMemoryCommitPolicy>,
): AdaptiveMemoryCommitPolicy {
  return {
    ...DEFAULT_ADAPTIVE_MEMORY_COMMIT_POLICY,
    ...policy,
  };
}

export function normalizeAdaptiveMemoryProviderIdentity(
  identity: AdaptiveMemoryProviderIdentity,
): AdaptiveMemoryProviderIdentity {
  return {
    ...identity,
    id: identity.id.trim(),
    displayName: identity.displayName.trim(),
    version: identity.version?.trim(),
  };
}

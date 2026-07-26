import type { RunnerId } from "../runner-adapter";

/** Stable schema identifiers shared by discovery providers and registry writers. */
export const SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA =
  "skill-discovery-source-provider-v1" as const;
export const SKILL_DISCOVERY_SOURCE_SCHEMA = "skill-discovery-source-v1" as const;
export const SKILL_REGISTRY_SCHEMA = "skill-registry-v1" as const;
export const SKILL_REGISTRY_SCHEMA_VERSION = 1 as const;
export const SKILL_REGISTRY_FINGERPRINT_ALGORITHM = "skill-registry-sha256-v1" as const;
export const SKILL_REGISTRY_PRIVACY_POLICY_VERSION = "skill-registry-privacy-v1" as const;

/** A digest with the registry's explicit algorithm prefix. */
export type SkillDiscoveryDigestV1 = `sha256:${string}`;

/** The five source categories defined by the V1 registry contract. */
export type SkillDiscoverySourceCategoryV1 =
  | "project_local"
  | "project_runner"
  | "user_runner"
  | "deck_materialized"
  | "runner_exposed";

export type SkillDiscoveryScopeV1 = "project" | "user" | "runner";

export type SkillDiscoveryLocatorStrategyV1 =
  | "project_relative"
  | "runner_relative"
  | "runner_opaque";

export type SkillDiscoveryExpectedContentV1 = "skill_md" | "opaque_inventory_v1";

/**
 * Safe, bounded diagnostic data.  The presentation is intentionally a short
 * message rather than raw exception text or descriptor prose.
 */
export interface SkillDiscoveryDiagnosticV1 {
  readonly code: string;
  readonly source_id?: string;
  readonly locator?: string;
  readonly message: string;
}

/** Exact V1 bounds used by discovery, parsing, and registry serialization. */
export const SKILL_DISCOVERY_V1_BOUNDS = Object.freeze({
  maxFileBytes: 512 * 1024,
  maxCandidateRecords: 500,
  maxDiagnostics: 50,
  maxDescriptionCharacters: 500,
  maxTaskSignals: 20,
  maxTechnologySignals: 20,
  maxPathSignals: 20,
  maxFrontmatterDepth: 3,
  maxScanDepth: 5,
} as const);

/** Runtime context supplied by the active runner before runner-owned discovery. */
export interface SkillDiscoveryRuntimeContextV1 {
  readonly activeRunnerId: RunnerId;
}

/** Privacy-normalized project, runner, or opaque locator. */
export type SkillLocatorV1 = string;

export type SkillLocatorResolutionV1 =
  | { readonly status: "available"; readonly loadReference: string }
  | { readonly status: "missing" }
  | {
      readonly status: "rejected";
      readonly diagnostic: SkillDiscoveryDiagnosticV1;
    };

export interface SkillDiscoverySourceProviderV1 {
  readonly schema: typeof SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA;
  readonly runnerId: RunnerId;

  listSources(input: {
    readonly projectRoot: string;
  }): Promise<SkillDiscoverySourceSetV1>;

  resolveLocator(input: {
    readonly projectRoot: string;
    readonly locator: SkillLocatorV1;
  }): Promise<SkillLocatorResolutionV1>;
}

export type SkillDiscoverySourceSetV1 =
  | {
      readonly outcome: "complete";
      readonly sources: readonly SkillDiscoverySourceBindingV1[];
      readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
    }
  | {
      readonly outcome: "indeterminate";
      readonly sources: readonly SkillDiscoverySourceBindingV1[];
      readonly reasonCode: "partial_source_evaluation";
      readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
    };

export type SkillDiscoverySourceBindingV1 =
  | {
      readonly kind: "filesystem";
      readonly declaration: SkillDiscoverySourceDeclarationV1;
      /** Runtime-only; never serialized or logged. */
      readonly absoluteRoot: string;
      readonly descriptorBasename: "SKILL.md";
    }
  | {
      readonly kind: "opaque_inventory";
      readonly declaration: SkillDiscoverySourceDeclarationV1;
      readonly readInventory: () => Promise<OpaqueSkillInventoryResultV1>;
    };

export interface SkillDiscoverySourceDeclarationV1 {
  readonly schema: typeof SKILL_DISCOVERY_SOURCE_SCHEMA;
  /** Stable, safe, non-path identifier. */
  readonly sourceId: string;
  readonly sourceCategory: SkillDiscoverySourceCategoryV1;
  readonly scope: SkillDiscoveryScopeV1;
  readonly runnerId: RunnerId | "runner-neutral";
  readonly locatorStrategy: SkillDiscoveryLocatorStrategyV1;
  readonly expectedContent: SkillDiscoveryExpectedContentV1;
  readonly safeLocatorBase: string;
}

export type OpaqueSkillInventoryResultV1 =
  | {
      readonly outcome: "complete";
      readonly observations: readonly OpaqueSkillObservationV1[];
      readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
    }
  | {
      readonly outcome: "indeterminate";
      /** Direct-discovery hints only. */
      readonly observations: readonly OpaqueSkillObservationV1[];
      readonly reasonCode: "partial_source_evaluation";
      readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
    };

export interface OpaqueSkillObservationV1 {
  readonly opaqueId: string;
  readonly name: string;
  readonly description?: string;
  readonly taskSignals?: readonly string[];
  readonly technologySignals?: readonly string[];
  readonly pathSignals?: readonly string[];
  readonly observedCategory?: "runner_exposed" | "deck_materialized";
}

/** Persisted record vocabulary.  runner_id is conditional on source_category. */
export interface SkillRegistryRecordV1 {
  readonly name: string;
  readonly source_category: SkillDiscoverySourceCategoryV1;
  readonly scope: SkillDiscoveryScopeV1;
  readonly locator: string;
  readonly observation_id: string;

  readonly description?: string;
  /** Required for project_runner, user_runner, and runner_exposed records. */
  readonly runner_id?: string;
  readonly task_signals?: readonly string[];
  readonly technology_signals?: readonly string[];
  readonly path_signals?: readonly string[];
  readonly diagnostic?: string;
}

export type SkillRegistryCompletenessV1 = "complete" | "truncated";

export interface SkillRegistryFrontmatterV1 {
  readonly schema: typeof SKILL_REGISTRY_SCHEMA;
  readonly schema_version: typeof SKILL_REGISTRY_SCHEMA_VERSION;
  /** Informational only; it does not determine freshness. */
  readonly generated_at: string;
  readonly fingerprint: SkillDiscoveryDigestV1;
  readonly fingerprint_algorithm: typeof SKILL_REGISTRY_FINGERPRINT_ALGORITHM;
  readonly source_scope_hash: string;
  readonly candidate_count: number;
  readonly diagnostic_count: number;
  readonly privacy_policy_version: typeof SKILL_REGISTRY_PRIVACY_POLICY_VERSION;
  readonly completeness: SkillRegistryCompletenessV1;
  readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
  readonly records: readonly SkillRegistryRecordV1[];
}

export type SkillRegistryStatusReasonCodeV1 =
  | "file_absent"
  | "unsupported_schema_version"
  | "missing_schema"
  | "malformed_frontmatter"
  | "fingerprint_mismatch"
  | "partial_source_evaluation"
  | "truncated_output"
  | "oversized_file"
  | "oversized_candidate_count";

export type SkillRegistryStatusV1 =
  | {
      readonly status: "ready";
      readonly reason_code: "fingerprint_match";
      readonly registry_path: ".atl/skill-registry.md";
      readonly fingerprint: SkillDiscoveryDigestV1;
      readonly candidate_count: number;
      readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
    }
  | {
      readonly status: "missing";
      readonly reason_code: "file_absent";
      readonly registry_path: ".atl/skill-registry.md";
    }
  | {
      readonly status: "stale";
      readonly reason_code: "fingerprint_mismatch" | "truncated_output";
      readonly registry_path: ".atl/skill-registry.md";
      readonly stored_fingerprint?: SkillDiscoveryDigestV1;
      readonly current_fingerprint?: SkillDiscoveryDigestV1;
    }
  | {
      readonly status: "invalid";
      readonly reason_code:
        | "unsupported_schema_version"
        | "missing_schema"
        | "malformed_frontmatter"
        | "oversized_file"
        | "oversized_candidate_count";
      readonly registry_path: ".atl/skill-registry.md";
      readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
    }
  | {
      readonly status: "indeterminate";
      readonly reason_code: "partial_source_evaluation" | "truncated_output";
      readonly registry_path: ".atl/skill-registry.md";
      readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
    };

export type SkillRegistryWriteActionV1 =
  | "initial_generation"
  | "migration"
  | "regeneration";

export type SkillRegistryWriteTargetsV1 =
  | readonly [".atl/skill-registry.md"]
  | readonly [".gitignore", ".atl/skill-registry.md"];

export interface SkillRegistryWritePlanV1 {
  readonly schema: "skill-registry-write-plan-v1";
  readonly action: SkillRegistryWriteActionV1;
  readonly active_runner_id: RunnerId;
  readonly project_root_digest: SkillDiscoveryDigestV1;
  readonly allowed_targets: SkillRegistryWriteTargetsV1;
  readonly expected_registry_digest: SkillDiscoveryDigestV1 | "missing";
  readonly expected_gitignore_digest?: SkillDiscoveryDigestV1 | "missing";
  readonly candidate_document: string;
  readonly candidate_digest: SkillDiscoveryDigestV1;
}

declare const skillRegistryWriteAuthorityBrand: unique symbol;

/** Opaque, process-local, one-use authority minted outside discovery. */
export interface SkillRegistryWriteAuthorityV1 {
  readonly [skillRegistryWriteAuthorityBrand]: "skill-registry-write-authority-v1";
}

export interface SkillRegistryWriteResultV1 {
  readonly outcome: "committed" | "unchanged" | "rejected";
  readonly registry_digest?: SkillDiscoveryDigestV1;
  readonly gitignore_changed?: boolean;
  readonly reason_code?: string;
  readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[];
}

export interface SkillRegistryWriterV1 {
  commit(
    plan: SkillRegistryWritePlanV1,
    authority: SkillRegistryWriteAuthorityV1,
  ): Promise<SkillRegistryWriteResultV1>;
}

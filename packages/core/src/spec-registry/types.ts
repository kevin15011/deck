/**
 * Spec Registry type definitions for Deck.
 *
 * These types model the OpenSpec-based Spec Registry: the operational
 * authority and control plane for Deck's SDD workflow.
 *
 * Design principles:
 * - OpenSpec artifacts are REQUIRED (not optional modes).
 * - Memory systems are auxiliary only (concrete adapters integrate via neutral sync keys).
 * - Sync targets use neutral keys (no adapter-specific names in core types).
 * - Graph/memory integration (Phase 4) is deferred but extension fields
 *   are designed neutrally to support future adapters.
 */

import type { ValidationRuleCode } from "./schema";

// ---------------------------------------------------------------------------
// Change lifecycle
// ---------------------------------------------------------------------------

export type ChangeStatus =
  | "draft"
  | "proposed"
  | "approved"
  | "in_progress"
  | "verifying"
  | "reviewing"
  | "completed"
  | "archived"
  | "abandoned";

export type ChangePhase =
  | "explore"
  | "proposal"
  | "spec"
  | "design"
  | "tasks"
  | "apply"
  | "verify"
  | "review"
  | "archive";

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export type ArtifactKind =
  | "exploration"
  | "proposal"
  | "spec"
  | "design"
  | "tasks"
  | "apply-progress"
  | "verify-report"
  | "review-report"
  | "archive-report";

export type ArtifactStatus =
  | "pending"
  | "draft"
  | "approved"
  | "rejected"
  | "superseded";

// ---------------------------------------------------------------------------
// Sync (future-neutral — Phase 4 extension)
// ---------------------------------------------------------------------------

export type SyncStatus =
  | "local_only"
  | "syncing"
  | "synced"
  | "error";

// ---------------------------------------------------------------------------
// Registry models
// ---------------------------------------------------------------------------

export type SpecRegistryEntry = {
  changeName: string;
  status: ChangeStatus;
  currentPhase: ChangePhase;
  createdAt: string;
  updatedAt: string;
  title?: string;
};

export type SpecRegistryArtifact = {
  changeName: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  path: string;
  version: number;
  updatedAt: string;
  /** Future-neutral sync status (Phase 4) */
  syncStatus?: SyncStatus;
  /** Neutral integration key, e.g. "graph-adapter", "memory-adapter" */
  syncTarget?: string;
  syncedAt?: string;
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type SpecRegistryEventType =
  | "change.created"
  | "change.phase_transition"
  | "artifact.updated"
  | "artifact.approved"
  | "artifact.rejected"
  | "human.approved"
  | "human.rejected"
  | "sync.targeted"
  | "sync.completed"
  | "sync.failed";

export type SpecRegistryEvent = {
  id: string;
  changeName: string;
  type: SpecRegistryEventType;
  timestamp: string;
  actor: string;
  evidence?: string;
  metadata?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

export const VALID_CHANGE_STATUSES: readonly ChangeStatus[] = [
  "draft",
  "proposed",
  "approved",
  "in_progress",
  "verifying",
  "reviewing",
  "completed",
  "archived",
  "abandoned",
] as const;

export const VALID_CHANGE_PHASES: readonly ChangePhase[] = [
  "explore",
  "proposal",
  "spec",
  "design",
  "tasks",
  "apply",
  "verify",
  "review",
  "archive",
] as const;

export const VALID_ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "exploration",
  "proposal",
  "spec",
  "design",
  "tasks",
  "apply-progress",
  "verify-report",
  "review-report",
  "archive-report",
] as const;

export const VALID_ARTIFACT_STATUSES: readonly ArtifactStatus[] = [
  "pending",
  "draft",
  "approved",
  "rejected",
  "superseded",
] as const;

export const VALID_SYNC_STATUSES: readonly SyncStatus[] = [
  "local_only",
  "syncing",
  "synced",
  "error",
] as const;

export const VALID_EVENT_TYPES: readonly SpecRegistryEventType[] = [
  "change.created",
  "change.phase_transition",
  "artifact.updated",
  "artifact.approved",
  "artifact.rejected",
  "human.approved",
  "human.rejected",
  "sync.targeted",
  "sync.completed",
  "sync.failed",
] as const;

// ---------------------------------------------------------------------------
// Validator DTOs (added by openspec-registry-schema-validator)
// ---------------------------------------------------------------------------

/**
 * Options for validating the OpenSpec registry.
 */
export type ValidateOpenSpecRegistryOptions = {
  /** Project root containing openspec/. */
  rootDir: string;
  /** Validate one change id; searches changes/ first, archive/ second. */
  changeId?: string;
  /** Defaults to true; single-change lookup searches active changes first, then archive. */
  includeArchive?: boolean;
  /** Defaults to true. */
  includeChanges?: boolean;
  /** Validation mode: legacy-tolerant or canonical-strict. */
  mode?: "legacy-tolerant" | "canonical-strict";
};

/**
 * Severity level for validation issues.
 */
export type ValidationSeverity = "error" | "warning";

/**
 * Issue reported by the validator.
 * Follows spec REQ-val-005: field is `rule` (rule identifier).
 */
export type OpenSpecRegistryValidationIssue = {
  severity: ValidationSeverity;
  /** Rule identifier (spec REQ-val-005: field is `rule`) */
  rule: ValidationRuleCode;
  message: string;
  path: string;
  changeId?: string;
  file?: "state.yaml" | "events.yaml" | "artifact" | "preconditions.md";
  field?: string;
  details?: Record<string, unknown>;
};

/**
 * Validation result for a single change.
 */
export type OpenSpecRegistryChangeValidation = {
  changeId: string;
  location: "changes" | "archive";
  path: string;
  statePath: string;
  eventsPath?: string;
  detectedSchema?: string;
  detectedEventsSchema?: string;
  currentPhase?: string;
  status?: string;
  issueCounts: {
    errors: number;
    warnings: number;
  };
};

/**
 * Summary counts from validation.
 * Follows spec REQ-val-012 field names.
 */
export type OpenSpecRegistryValidationSummary = {
  /** Total changes checked (canonical + legacy) */
  totalChanges: number;
  /** Active changes in changes/ */
  totalActiveChanges: number;
  /** Archived changes in archive/ */
  totalArchivedChanges: number;
  /** Changes with at least one error */
  changesWithErrors: number;
  /** Changes with at least one warning but no errors */
  changesWithWarnings: number;
  /** Total errors across all changes */
  totalErrors: number;
  /** Total warnings across all changes */
  totalWarnings: number;
  /** Valid changes (no errors) */
  validChanges: number;
};

/**
 * Complete validation result for the registry.
 */
export type OpenSpecRegistryValidationResult = {
  schema: "openspec-registry-validation-result-v1";
  ok: boolean;
  rootDir: string;
  summary: OpenSpecRegistryValidationSummary;
  issues: OpenSpecRegistryValidationIssue[];
  changes: OpenSpecRegistryChangeValidation[];
};

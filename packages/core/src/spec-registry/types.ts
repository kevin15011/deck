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

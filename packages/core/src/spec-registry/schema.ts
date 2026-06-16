/**
 * Canonical schema constants for OpenSpec Registry validation.
 *
 * Defines versioned schema identifiers, phase/status enums, artifact keys,
 * and validation rule codes used by the registry validator.
 */

// ---------------------------------------------------------------------------
// Schema identifiers
// ---------------------------------------------------------------------------

export const SCHEMA_STATE = "spec-registry-v1" as const;
export const SCHEMA_EVENTS = "spec-registry-events-v1" as const;

export type SchemaState = typeof SCHEMA_STATE;
export type SchemaEvents = typeof SCHEMA_EVENTS;

// ---------------------------------------------------------------------------
// Phase enum (canonical — includes closed)
// ---------------------------------------------------------------------------

export type ValidatorPhase =
  | "explore"
  | "proposal"
  | "spec"
  | "design"
  | "tasks"
  | "apply"
  | "verify"
  | "review"
  | "archive"
  | "closed";

export const VALIDATOR_PHASES: readonly ValidatorPhase[] = [
  "explore",
  "proposal",
  "spec",
  "design",
  "tasks",
  "apply",
  "verify",
  "review",
  "archive",
  "closed",
] as const;

/**
 * Phase order for sequential validation (lower index = earlier phase).
 */
export const PHASE_ORDER: readonly ValidatorPhase[] = [
  "explore",
  "proposal",
  "spec",
  "design",
  "tasks",
  "apply",
  "verify",
  "review",
  "archive",
  "closed",
] as const;

/**
 * Map phase name to order index for comparison.
 */
export const PHASE_TO_INDEX: ReadonlyMap<ValidatorPhase, number> = new Map(
  PHASE_ORDER.map((phase, index) => [phase, index])
);

// ---------------------------------------------------------------------------
// Exploration lifecycle constants (Task 2)
// ---------------------------------------------------------------------------

/**
 * Exploration context values (optional, warning-level).
 */
export type ExplorationContext = "sdd" | "delegated";

export const VALID_EXPLORATION_CONTEXTS: readonly ExplorationContext[] = [
  "sdd",
  "delegated",
] as const;

/**
 * Lifecycle status values (optional, warning-level).
 */
export type LifecycleStatus =
  | "diagnosed"
  | "deferred"
  | "closed-no-action"
  | "converted-to-change"
  | "converted-to-sdd"
  | "keep-as-reference";

export const VALID_LIFECYCLE_STATUSES: readonly LifecycleStatus[] = [
  "diagnosed",
  "deferred",
  "closed-no-action",
  "converted-to-change",
  "converted-to-sdd",
  "keep-as-reference",
] as const;

// ---------------------------------------------------------------------------
// Status enum (canonical)
// ---------------------------------------------------------------------------

export type ValidatorStatus =
  | "in_progress"
  | "completed"
  | "passed"
  | "passed_with_warnings"
  | "failed"
  | "approved"
  | "archived"
  | "abandoned"
  | "incomplete";

export const VALIDATOR_STATUSES: readonly ValidatorStatus[] = [
  "in_progress",
  "completed",
  "passed",
  "passed_with_warnings",
  "failed",
  "approved",
  "archived",
  "abandoned",
  "incomplete",
] as const;

/**
 * Statuses allowed when phase is archive.
 */
export const ARCHIVE_REQUIRED_STATUSES: readonly ValidatorStatus[] = [
  "archived",
] as const;

/**
 * Statuses allowed when phase is closed.
 */
export const CLOSED_REQUIRED_STATUSES: readonly ValidatorStatus[] = [
  "abandoned",
  "incomplete",
] as const;

// ---------------------------------------------------------------------------
// Artifact keys
// ---------------------------------------------------------------------------

export type ValidatorArtifactKind =
  | "exploration"
  | "proposal"
  | "spec"
  | "design"
  | "tasks"
  | "apply_progress"
  | "verify_report"
  | "review_report"
  | "archive_report";

export const VALIDATOR_ARTIFACT_KINDS: readonly ValidatorArtifactKind[] = [
  "exploration",
  "proposal",
  "spec",
  "design",
  "tasks",
  "apply_progress",
  "verify_report",
  "review_report",
  "archive_report",
] as const;

/**
 * Map snake_case internal key to kebab-case public key.
 */
export const ARTIFACT_KEY_TO_PUBLIC: ReadonlyMap<ValidatorArtifactKind, string> = new Map([
  ["exploration", "exploration"],
  ["proposal", "proposal"],
  ["spec", "spec"],
  ["design", "design"],
  ["tasks", "tasks"],
  ["apply_progress", "apply-progress"],
  ["verify_report", "verify-report"],
  ["review_report", "review-report"],
  ["archive_report", "archive-report"],
]);

// ---------------------------------------------------------------------------
// Validation rule codes
// ---------------------------------------------------------------------------

export type ValidationRuleCode =
  // State file rules
  | "state.yaml.missing"
  | "state.yaml.parse_error"
  | "state.yaml.duplicate_key"
  | "state.schema.missing"
  | "state.schema.invalid"
  | "state.changeId.missing"
  | "state.changeId.mismatch"
  | "state.currentPhase.missing"
  | "state.currentPhase.invalid"
  | "state.currentPhase.legacy_field"
  | "state.status.missing"
  | "state.status.invalid"
  | "state.phase_status.invalid_archive"
  | "state.phase_status.invalid_closed"
  | "state.artifacts.missing"
  | "state.artifacts.legacy_shape"
  | "state.provenance.missing"
  | "state.provenance.legacy_shape"
  | "state.closure_reason.required"
  // Events file rules
  | "events.yaml.missing"
  | "events.yaml.parse_error"
  | "events.yaml.duplicate_key"
  | "events.schema.missing"
  | "events.schema.invalid"
  | "events.events.missing"
  | "events.events.legacy_flat_list"
  | "events.event.required_field_missing"
  | "events.event.name_mismatch"
  | "events.state.last_event_mismatch"
  // Artifact rules
  | "artifact.missing_for_completed_phase"
  | "artifact.unregistered_present"
  // Precondition rules
  | "preconditions.artifact.missing"
  | "preconditions.artifact.not_referenced"
  // YAML parser rules
  | "yaml.parse_error"
  | "yaml.parse_warning"
  | "yaml.duplicate_key"
  // General rules
  | "change.not_found"
  | "change.abandoned_or_incomplete_active"
  | "runtime.error"
  | "legacy.drift"
  // Exploration lifecycle rules (warning-level)
  | "lifecycle.unknown_context"
  | "lifecycle.missing_context"
  | "lifecycle.unknown_value"
  | "lifecycle.missing_next_action"
  | "lifecycle.incomplete_deferred"
  | "lifecycle.incomplete_closed_no_action"
  | "lifecycle.missing_conversion_reference"
  | "lifecycle.missing_sdd_reference"
  | "lifecycle.missing_reference_rationale";

/**
 * All validation rule codes.
 */
export const VALIDATION_RULE_CODES: readonly ValidationRuleCode[] = [
  "state.yaml.missing",
  "state.yaml.parse_error",
  "state.yaml.duplicate_key",
  "state.schema.missing",
  "state.schema.invalid",
  "state.changeId.missing",
  "state.changeId.mismatch",
  "state.currentPhase.missing",
  "state.currentPhase.invalid",
  "state.currentPhase.legacy_field",
  "state.status.missing",
  "state.status.invalid",
  "state.phase_status.invalid_archive",
  "state.phase_status.invalid_closed",
  "state.artifacts.missing",
  "state.artifacts.legacy_shape",
  "state.provenance.missing",
  "state.provenance.legacy_shape",
  "state.closure_reason.required",
  "events.yaml.missing",
  "events.yaml.parse_error",
  "events.yaml.duplicate_key",
  "events.schema.missing",
  "events.schema.invalid",
  "events.events.missing",
  "events.events.legacy_flat_list",
  "events.event.required_field_missing",
  "events.event.name_mismatch",
  "events.state.last_event_mismatch",
  "artifact.missing_for_completed_phase",
  "artifact.unregistered_present",
  "preconditions.artifact.missing",
  "preconditions.artifact.not_referenced",
  "yaml.parse_error",
  "yaml.parse_warning",
  "yaml.duplicate_key",
  "change.not_found",
  "change.abandoned_or_incomplete_active",
  "runtime.error",
  "legacy.drift",
  // Exploration lifecycle rules (warning-level)
  "lifecycle.unknown_context",
  "lifecycle.missing_context",
  "lifecycle.unknown_value",
  "lifecycle.missing_next_action",
  "lifecycle.incomplete_deferred",
  "lifecycle.incomplete_closed_no_action",
  "lifecycle.missing_conversion_reference",
  "lifecycle.missing_sdd_reference",
  "lifecycle.missing_reference_rationale",
] as const;
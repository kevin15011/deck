/**
 * Repair Incident Contract — runner-agnostic types and parser for repair-incident.md.
 *
 * Schema: repair-incident-v1
 * Spec: bounded-developer-team-repair-loops
 *
 * Reuses `FailureFingerprint` from `loop-breaker` without redefining it.
 * The manifest failure entry maps to `FailureFingerprint` as specified by Design.
 */

import { parse as yamlParse } from "yaml";
import { type FailureFingerprint } from "../orchestrator/loop-breaker";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type RepairIncidentStatus =
  | "open"
  | "checkpoint"
  | "replan_required"
  | "escalated"
  | "blocked"
  | "resolved";

export type FailureEntryStatus =
  | "open"
  | "checkpoint"
  | "repairing"
  | "replan_required"
  | "escalated"
  | "blocked"
  | "resolved"
  | "pre_existing"
  | "out_of_scope";

export type SourcePhase = "verify" | "apply" | "review";

export type ErrorClass =
  | "assertion"
  | "typecheck"
  | "build"
  | "lint"
  | "timeout"
  | "environment"
  | "generated_artifact"
  | "unknown";

export type GeneratedArtifactClassification =
  | "not_generated"
  | "checked_in_deterministic"
  | "checked_in_environment_sensitive"
  | "untracked_build_output"
  | "unknown";

export type NextVerificationStage = "targeted" | "affected_area" | "broad_gate";

export type NextAction =
  | "continue"
  | "repair"
  | "replan"
  | "escalate"
  | "block"
  | "verify";

export type LifecycleEvent =
  | "repair.started"
  | "repair.retry_recorded"
  | "repair.checkpoint_reached"
  | "repair.replanned"
  | "repair.escalated"
  | "repair.blocked"
  | "repair.resolved";

// ---------------------------------------------------------------------------
// Budget shapes
// ---------------------------------------------------------------------------

export interface IncidentBudgetLimits {
  verifyCyclesSoft: number;
  verifyCyclesHard: number;
  repairAttemptsSoft: number;
  repairAttemptsHard: number;
}

export interface FingerprintBudgetLimits {
  repairThreshold: number;
  replanThreshold: number;
  escalationThreshold: number;
}

export interface RepairBudgets {
  incident: IncidentBudgetLimits;
  fingerprint: FingerprintBudgetLimits;
}

// ---------------------------------------------------------------------------
// Runtime budget (optional — may be null when runner does not expose metrics)
// ---------------------------------------------------------------------------

export interface RuntimeBudget {
  tokensUsed: number | null;
  turnsUsed: number | null;
  timeElapsedMs: number | null;
  toolCallsUsed: number | null;
}

// ---------------------------------------------------------------------------
// Generated artifact entry
// ---------------------------------------------------------------------------

export interface GeneratedArtifactEntry {
  path: string;
  classification: GeneratedArtifactClassification;
  generator?: string;
  regenerationCommand?: string;
  evidence?: string;
}

// ---------------------------------------------------------------------------
// Attempt history entry
// ---------------------------------------------------------------------------

export interface AttemptHistoryEntry {
  attempt: number;
  phase: SourcePhase;
  artifact: string;
  summary: string;
  verificationStage: NextVerificationStage;
  result: "passed" | "failed" | "skipped";
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export interface FailureEvidence {
  command: string;
  latestResult: "pass" | "fail" | "skipped";
  artifact: string;
  excerpt: string;
}

// ---------------------------------------------------------------------------
// Failure entry
// ---------------------------------------------------------------------------

export interface RepairFailureEntry {
  id: string;
  status: FailureEntryStatus;
  sourcePhase: SourcePhase;
  taskGroup: string;
  ownerHint?: string;
  failingContract: string;
  requirementIds?: string[];
  scenarioIds?: string[];
  errorClass: ErrorClass;
  changedFiles?: string[];
  evidence: FailureEvidence;
  attempts: {
    count: number;
    history: AttemptHistoryEntry[];
  };
  generatedArtifacts?: GeneratedArtifactEntry[];
  nextVerificationStage: NextVerificationStage;
  nextAction: NextAction;
  /** Maps to FailureFingerprint — used for loop condition evaluation */
  fingerprint?: FailureFingerprint;
}

// ---------------------------------------------------------------------------
// Lifecycle transition entry
// ---------------------------------------------------------------------------

export interface LifecycleTransition {
  event: LifecycleEvent;
  phase: SourcePhase;
  artifact: string;
  at: string;
  summary: string;
}

// ---------------------------------------------------------------------------
// Created from entry
// ---------------------------------------------------------------------------

export interface CreatedFrom {
  phase: SourcePhase;
  artifact: string;
}

// ---------------------------------------------------------------------------
// Root Repair Incident
// ---------------------------------------------------------------------------

export interface RepairIncident {
  schema: "repair-incident-v1";
  incidentId: string;
  changeId: string;
  status: RepairIncidentStatus;
  createdFrom: CreatedFrom;
  budgets: RepairBudgets;
  runtimeBudget?: RuntimeBudget;
  failures: RepairFailureEntry[];
  lifecycle: LifecycleTransition[];
}

// ---------------------------------------------------------------------------
// Parsed result
// ---------------------------------------------------------------------------

export interface RepairIncidentValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  data?: RepairIncident;
}

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

const VALID_STATUSES: readonly RepairIncidentStatus[] = [
  "open",
  "checkpoint",
  "replan_required",
  "escalated",
  "blocked",
  "resolved",
];

const VALID_FAILURE_ENTRY_STATUSES: readonly FailureEntryStatus[] = [
  "open",
  "checkpoint",
  "repairing",
  "replan_required",
  "escalated",
  "blocked",
  "resolved",
  "pre_existing",
  "out_of_scope",
];

const VALID_ERROR_CLASSES: readonly ErrorClass[] = [
  "assertion",
  "typecheck",
  "build",
  "lint",
  "timeout",
  "environment",
  "generated_artifact",
  "unknown",
];

const VALID_CLASSIFICATIONS: readonly GeneratedArtifactClassification[] = [
  "not_generated",
  "checked_in_deterministic",
  "checked_in_environment_sensitive",
  "untracked_build_output",
  "unknown",
];

const VALID_NEXT_STAGES: readonly NextVerificationStage[] = [
  "targeted",
  "affected_area",
  "broad_gate",
];

const VALID_NEXT_ACTIONS: readonly NextAction[] = [
  "continue",
  "repair",
  "replan",
  "escalate",
  "block",
  "verify",
];

const VALID_LIFECYCLE_EVENTS: readonly LifecycleEvent[] = [
  "repair.started",
  "repair.retry_recorded",
  "repair.checkpoint_reached",
  "repair.replanned",
  "repair.escalated",
  "repair.blocked",
  "repair.resolved",
];

const VALID_SOURCE_PHASES: readonly SourcePhase[] = ["verify", "apply", "review"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateTextField(obj: Record<string, unknown>, path: string, field: string, errors: string[]): void {
  if (!hasText(obj[field])) errors.push(`${path}.${field}: expected non-empty string`);
}

function validateEnumField<T extends string>(obj: Record<string, unknown>, path: string, field: string, allowed: readonly T[], errors: string[]): void {
  const value = obj[field];
  if (!hasText(value)) {
    errors.push(`${path}.${field}: expected one of ${allowed.join(", ")}`);
  } else if (!allowed.includes(value as T)) {
    errors.push(`${path}.${field}: invalid '${value}'. Allowed: ${allowed.join(", ")}`);
  }
}

function validateNonNegativeInteger(obj: Record<string, unknown>, path: string, field: string, errors: string[]): void {
  const value = obj[field];
  if (!Number.isInteger(value) || (value as number) < 0) {
    errors.push(`${path}.${field}: expected non-negative integer`);
  }
}

function validateObjectField(obj: Record<string, unknown>, path: string, field: string, errors: string[]): Record<string, unknown> | undefined {
  const value = obj[field];
  if (!isRecord(value)) {
    errors.push(`${path}.${field}: expected object`);
    return undefined;
  }
  return value;
}

function validateStringArray(obj: Record<string, unknown>, path: string, field: string, errors: string[]): void {
  const value = obj[field];
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => !hasText(item))) {
    errors.push(`${path}.${field}: expected array of non-empty strings`);
  }
}

// ---------------------------------------------------------------------------
// YAML extraction
// ---------------------------------------------------------------------------

/** Extract the fenced YAML block content from repair-incident.md markdown. */
function extractYamlBlock(markdown: string): string {
  // Matches fenced code blocks with optional 'yaml' language specifier.
  // Opening fence:  ```yaml\n  (or just ```\n)
  // Closing fence:  ```\n  (newline + three backticks + optional trailing whitespace)
  //
  // The closing fence uses \n\`\`\` to anchor before the backticks.
  // Non-greedy [\s\S]*? captures the content between fences.
  // Allows zero-or-more newlines before closing fence to support both:
  //   - fixture format (```yaml\nCONTENT\n```\n  with trailing space)
  //   - raw markdown (```yaml\nCONTENT\n\n```\n  with blank line before closing fence)
  const match = markdown.match(
    /```yaml\n([\s\S]*?)\n*```[\s\n]*/,
  );
  if (!match) {
    throw new Error("No fenced YAML block found");
  }
  let yaml = match[1]!;
  // Note: we do NOT strip 4-space indentation here because:
  //   - Fixtures use proper 2-space YAML indentation (strip would corrupt them)
  //   - Raw markdown content is not indented (strip would be a no-op)
  // If indented code blocks are ever needed, this can be extended with a smarter strip.
  return yaml;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a repair-incident.md content string and validate it.
 *
 * Extracts the fenced YAML block, parses it with the `yaml` package,
 * and validates all enum fields and required top-level keys.
 */
export function parseRepairIncidentYAML(
  content: string,
): RepairIncidentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!content || content.trim() === "") {
    return { ok: false, errors: ["repair-incident.md content is empty"], warnings: [] };
  }

  let yamlContent: string;
  try {
    yamlContent = extractYamlBlock(content);
  } catch {
    return { ok: false, errors: ["No fenced YAML block found in repair-incident.md"], warnings: [] };
  }

  let data: unknown;
  try {
    data = yamlParse(yamlContent);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`YAML parse error: ${msg}`], warnings: [] };
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ["YAML parsed to non-object root"], warnings: [] };
  }

  const obj = data as Record<string, unknown>;

  // Schema check
  if (obj["schema"] !== "repair-incident-v1") {
    errors.push(
      `Schema mismatch: expected 'repair-incident-v1', got '${String(obj["schema"] ?? "undefined")}'`,
    );
  }

  validateTextField(obj, "root", "incidentId", errors);
  validateTextField(obj, "root", "changeId", errors);
  validateEnumField(obj, "root", "status", VALID_STATUSES, errors);

  const createdFrom = validateObjectField(obj, "root", "createdFrom", errors);
  if (createdFrom) {
    validateEnumField(createdFrom, "createdFrom", "phase", VALID_SOURCE_PHASES, errors);
    validateTextField(createdFrom, "createdFrom", "artifact", errors);
  }

  const budgets = validateObjectField(obj, "root", "budgets", errors);
  if (budgets) {
    const incident = validateObjectField(budgets, "budgets", "incident", errors);
    if (incident) {
      for (const field of ["verifyCyclesSoft", "verifyCyclesHard", "repairAttemptsSoft", "repairAttemptsHard"] as const) {
        validateNonNegativeInteger(incident, "budgets.incident", field, errors);
      }
    }
    const fingerprint = validateObjectField(budgets, "budgets", "fingerprint", errors);
    if (fingerprint) {
      for (const field of ["repairThreshold", "replanThreshold", "escalationThreshold"] as const) {
        validateNonNegativeInteger(fingerprint, "budgets.fingerprint", field, errors);
      }
    }
  }

  if (obj["runtimeBudget"] !== undefined) {
    const runtimeBudget = validateObjectField(obj, "root", "runtimeBudget", errors);
    if (runtimeBudget) {
      for (const field of ["tokensUsed", "turnsUsed", "timeElapsedMs", "toolCallsUsed"] as const) {
        if (runtimeBudget[field] !== null) validateNonNegativeInteger(runtimeBudget, "runtimeBudget", field, errors);
      }
    }
  }

  // Failures array
  if (Array.isArray(obj["failures"])) {
    for (let i = 0; i < obj["failures"].length; i++) {
      const path = `failures[${i}]`;
      const f = obj["failures"][i];
      if (!isRecord(f)) { errors.push(`${path}: expected object`); continue; }
      validateTextField(f, path, "id", errors);
      validateEnumField(f, path, "status", VALID_FAILURE_ENTRY_STATUSES, errors);
      validateEnumField(f, path, "sourcePhase", VALID_SOURCE_PHASES, errors);
      validateTextField(f, path, "taskGroup", errors);
      validateTextField(f, path, "failingContract", errors);
      validateStringArray(f, path, "requirementIds", errors);
      validateStringArray(f, path, "scenarioIds", errors);
      validateStringArray(f, path, "changedFiles", errors);
      validateEnumField(f, path, "errorClass", VALID_ERROR_CLASSES, errors);
      validateEnumField(f, path, "nextVerificationStage", VALID_NEXT_STAGES, errors);
      validateEnumField(f, path, "nextAction", VALID_NEXT_ACTIONS, errors);
      const evidence = validateObjectField(f, path, "evidence", errors);
      if (evidence) {
        validateTextField(evidence, `${path}.evidence`, "command", errors);
        validateEnumField(evidence, `${path}.evidence`, "latestResult", ["pass", "fail", "skipped"] as const, errors);
        validateTextField(evidence, `${path}.evidence`, "artifact", errors);
        validateTextField(evidence, `${path}.evidence`, "excerpt", errors);
      }
      const attempts = validateObjectField(f, path, "attempts", errors);
      if (attempts) {
        validateNonNegativeInteger(attempts, `${path}.attempts`, "count", errors);
        if (!Array.isArray(attempts.history)) {
          errors.push(`${path}.attempts.history: expected array`);
        } else {
          attempts.history.forEach((entry, j) => {
            const hPath = `${path}.attempts.history[${j}]`;
            if (!isRecord(entry)) { errors.push(`${hPath}: expected object`); return; }
            validateNonNegativeInteger(entry, hPath, "attempt", errors);
            validateEnumField(entry, hPath, "phase", VALID_SOURCE_PHASES, errors);
            validateTextField(entry, hPath, "artifact", errors);
            validateTextField(entry, hPath, "summary", errors);
            validateEnumField(entry, hPath, "verificationStage", VALID_NEXT_STAGES, errors);
            validateEnumField(entry, hPath, "result", ["passed", "failed", "skipped"] as const, errors);
          });
        }
      }
      // Generated artifacts validation
      if (Array.isArray(f["generatedArtifacts"])) {
        f["generatedArtifacts"].forEach((a, j) => {
          const aPath = `${path}.generatedArtifacts[${j}]`;
          if (!isRecord(a)) { errors.push(`${aPath}: expected object`); return; }
          validateTextField(a, aPath, "path", errors);
          validateEnumField(a, aPath, "classification", VALID_CLASSIFICATIONS, errors);
          for (const optional of ["generator", "regenerationCommand", "evidence"] as const) {
            if (a[optional] !== undefined && !hasText(a[optional])) errors.push(`${aPath}.${optional}: expected non-empty string`);
          }
        });
      } else if (f["generatedArtifacts"] !== undefined) {
        errors.push(`${path}.generatedArtifacts: expected array`);
      }
    }
  } else {
    errors.push("root.failures: expected array");
  }

  // Lifecycle events
  if (Array.isArray(obj["lifecycle"])) {
    for (let i = 0; i < obj["lifecycle"].length; i++) {
      const path = `lifecycle[${i}]`;
      const l = obj["lifecycle"][i];
      if (!isRecord(l)) { errors.push(`${path}: expected object`); continue; }
      validateEnumField(l, path, "event", VALID_LIFECYCLE_EVENTS, errors);
      validateEnumField(l, path, "phase", VALID_SOURCE_PHASES, errors);
      validateTextField(l, path, "artifact", errors);
      validateTextField(l, path, "at", errors);
      validateTextField(l, path, "summary", errors);
    }
  } else {
    errors.push("root.lifecycle: expected array");
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  return {
    ok: true,
    errors: [],
    warnings,
    data: obj as unknown as RepairIncident,
  };
}

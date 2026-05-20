/**
 * Self-audit contract types for Spec, Design, and Tasks artifacts.
 *
 * Producers emit structured self-audits covering invariants, boundaries,
 * ambiguity, risk signals, readiness gaps, rollback/test direction, and confidence.
 */

// ── Base audit fields (shared by all artifact types) ──

export interface BaseAudit {
  /** Stated invariants that must hold */
  invariants: string;
  /** Boundary descriptions — what this artifact touches and does not touch */
  boundaries: string;
  /** Ambiguity items the producer could not resolve */
  ambiguity: string[];
  /** Named risk signals discovered during production */
  riskSignals: RiskSignalEntry[];
  /** Producer confidence 0..1 */
  confidence: number;
}

export interface RiskSignalEntry {
  name: string;
  evidence: string;
}

// ── Spec-specific audit ──

export interface SpecAudit extends BaseAudit {
  /** External contracts referenced (APIs, schemas, protocols) */
  externalContracts: string[];
  /** Sensitive data touched (PII, secrets, payment) */
  sensitiveData: string[];
  /** Testing direction recommendation */
  testDirection: string;
}

// ── Design-specific audit ──

export interface RiskSurfaceEntry {
  decision: string;
  risk: string;
  impact: string;
}

export interface DesignAudit extends BaseAudit {
  /** Risk surface per design decision */
  riskSurface: RiskSurfaceEntry[];
  /** State mutations introduced or changed */
  stateMutation: string[];
  /** Compatibility guarantees */
  compatibility: string;
  /** Rollback strategy */
  rollback: string;
  /** Observability hooks */
  observability: string[];
}

// ── Tasks-specific audit ──

export interface TaskReadinessEntry {
  taskId: string;
  ready: boolean;
  blockers: string[];
}

export interface TaskSplitabilityEntry {
  taskId: string;
  splittable: boolean;
  reason: string;
}

export interface TasksAudit extends BaseAudit {
  /** Per-task readiness assessment */
  taskReadiness: TaskReadinessEntry[];
  /** Per-task splitability assessment */
  splitability: TaskSplitabilityEntry[];
  /** Boundary tests to verify task completion */
  boundaryTests: string[];
  /** Rollback step per task */
  rollbackStep: string;
  /** Known blockers */
  blockers: string[];
  /** Placeholder items needing resolution */
  placeholders: string[];
}

// ── Union type ──

export type SelfAudit = SpecAudit | DesignAudit | TasksAudit;
export type AuditType = "spec" | "design" | "tasks";

// ── Validation ──

export interface AuditValidationResult {
  valid: boolean;
  missingFields: string[];
  invalidFields: string[];
}

const BASE_REQUIRED_FIELDS: (keyof BaseAudit)[] = [
  "invariants",
  "boundaries",
  "ambiguity",
  "riskSignals",
  "confidence",
];

const SPEC_EXTRA_FIELDS: (keyof SpecAudit)[] = [
  "externalContracts",
  "sensitiveData",
  "testDirection",
];

const DESIGN_EXTRA_FIELDS: (keyof DesignAudit)[] = [
  "riskSurface",
  "stateMutation",
  "compatibility",
  "rollback",
  "observability",
];

const TASKS_EXTRA_FIELDS: (keyof TasksAudit)[] = [
  "taskReadiness",
  "splitability",
  "boundaryTests",
  "rollbackStep",
  "blockers",
  "placeholders",
];

export function validateSelfAudit(
  audit: unknown,
  type: AuditType,
): AuditValidationResult {
  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  // Guard: null, undefined, primitives, non-object
  if (audit === null || audit === undefined) {
    return {
      valid: false,
      missingFields: [...BASE_REQUIRED_FIELDS, ...typeSpecificFields(type)],
      invalidFields: [],
    };
  }

  if (typeof audit !== "object" || Array.isArray(audit)) {
    return {
      valid: false,
      missingFields: [...BASE_REQUIRED_FIELDS, ...typeSpecificFields(type)],
      invalidFields: [],
    };
  }

  const record = audit as Record<string, unknown>;

  // Validate base fields
  for (const field of BASE_REQUIRED_FIELDS) {
    const value = record[field];
    if (value === undefined || value === null) {
      missingFields.push(field);
    } else if ((field === "invariants" || field === "boundaries") && typeof value === "string" && value.trim() === "") {
      missingFields.push(field);
    } else if ((field === "invariants" || field === "boundaries") && typeof value !== "string") {
      invalidFields.push(field);
    }
  }

  // Validate ambiguity is an array of strings
  const ambiguity = record["ambiguity"];
  if (ambiguity !== undefined && ambiguity !== null) {
    if (!Array.isArray(ambiguity)) {
      invalidFields.push("ambiguity");
    } else {
      for (let i = 0; i < ambiguity.length; i++) {
        if (typeof ambiguity[i] !== "string") {
          invalidFields.push(`ambiguity[${i}]`);
        }
      }
    }
  }

  // Validate riskSignals structure
  const riskSignals = record["riskSignals"];
  if (riskSignals !== undefined && riskSignals !== null) {
    if (!Array.isArray(riskSignals)) {
      invalidFields.push("riskSignals");
    } else {
      for (let i = 0; i < riskSignals.length; i++) {
        const signal = riskSignals[i];
        if (signal === null || signal === undefined || typeof signal !== "object") {
          invalidFields.push(`riskSignals[${i}]`);
        } else {
          const sig = signal as Record<string, unknown>;
          if (typeof sig.name !== "string" || typeof sig.evidence !== "string") {
            invalidFields.push(`riskSignals[${i}]`);
          }
        }
      }
    }
  }

  // Validate confidence: must be a number in [0, 1]
  const confidence = record["confidence"];
  if (confidence === undefined || confidence === null) {
    // already caught by missingFields above
  } else if (typeof confidence !== "number" || isNaN(confidence)) {
    invalidFields.push("confidence");
  } else if (confidence < 0 || confidence > 1) {
    invalidFields.push("confidence");
  }

  // Validate type-specific fields with shape checks
  if (type === "spec") {
    validateSpecFields(record, missingFields, invalidFields);
  }

  if (type === "design") {
    validateDesignFields(record, missingFields, invalidFields);
  }

  if (type === "tasks") {
    validateTasksFields(record, missingFields, invalidFields);
  }

  return {
    valid: missingFields.length === 0 && invalidFields.length === 0,
    missingFields,
    invalidFields,
  };
}

function typeSpecificFields(type: AuditType): string[] {
  switch (type) {
    case "spec": return SPEC_EXTRA_FIELDS as unknown as string[];
    case "design": return DESIGN_EXTRA_FIELDS as unknown as string[];
    case "tasks": return TASKS_EXTRA_FIELDS as unknown as string[];
  }
}

/**
 * Validates that every element in the array is a string.
 * Returns true if all elements are strings, false if any element is non-string.
 * Pushes indexed invalid-field entries for non-string elements.
 */
function validateStringArrayElements(
  arr: unknown[],
  fieldName: string,
  invalidFields: string[],
): void {
  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] !== "string") {
      invalidFields.push(`${fieldName}[${i}]`);
    }
  }
}

// ── Spec shape validation ──

function validateSpecFields(
  record: Record<string, unknown>,
  missingFields: string[],
  invalidFields: string[],
): void {
  for (const field of SPEC_EXTRA_FIELDS) {
    if (record[field] === undefined || record[field] === null) {
      missingFields.push(field);
    }
  }

  // externalContracts must be array of strings
  if (record.externalContracts !== undefined && record.externalContracts !== null) {
    if (!Array.isArray(record.externalContracts)) {
      invalidFields.push("externalContracts");
    } else {
      validateStringArrayElements(record.externalContracts, "externalContracts", invalidFields);
    }
  }

  // sensitiveData must be array of strings
  if (record.sensitiveData !== undefined && record.sensitiveData !== null) {
    if (!Array.isArray(record.sensitiveData)) {
      invalidFields.push("sensitiveData");
    } else {
      validateStringArrayElements(record.sensitiveData, "sensitiveData", invalidFields);
    }
  }

  // testDirection must be non-empty string
  if (record.testDirection !== undefined && record.testDirection !== null) {
    if (typeof record.testDirection !== "string" || record.testDirection.trim() === "") {
      invalidFields.push("testDirection");
    }
  }
}

// ── Design shape validation ──

function validateDesignFields(
  record: Record<string, unknown>,
  missingFields: string[],
  invalidFields: string[],
): void {
  for (const field of DESIGN_EXTRA_FIELDS) {
    if (record[field] === undefined || record[field] === null) {
      missingFields.push(field);
    }
  }

  // riskSurface must be array of valid entries
  if (record.riskSurface !== undefined && record.riskSurface !== null) {
    if (!Array.isArray(record.riskSurface)) {
      invalidFields.push("riskSurface");
    } else {
      for (let i = 0; i < record.riskSurface.length; i++) {
        const entry = record.riskSurface[i];
        if (!isValidRiskSurfaceEntry(entry)) {
          invalidFields.push(`riskSurface[${i}]`);
        }
      }
    }
  }

  // stateMutation must be array of strings
  if (record.stateMutation !== undefined && record.stateMutation !== null) {
    if (!Array.isArray(record.stateMutation)) {
      invalidFields.push("stateMutation");
    } else {
      validateStringArrayElements(record.stateMutation, "stateMutation", invalidFields);
    }
  }

  // compatibility must be non-empty string
  if (record.compatibility !== undefined && record.compatibility !== null) {
    if (typeof record.compatibility !== "string" || record.compatibility.trim() === "") {
      invalidFields.push("compatibility");
    }
  }

  // rollback must be non-empty string
  if (record.rollback !== undefined && record.rollback !== null) {
    if (typeof record.rollback !== "string" || record.rollback.trim() === "") {
      invalidFields.push("rollback");
    }
  }

  // observability must be array of strings
  if (record.observability !== undefined && record.observability !== null) {
    if (!Array.isArray(record.observability)) {
      invalidFields.push("observability");
    } else {
      validateStringArrayElements(record.observability, "observability", invalidFields);
    }
  }
}

function isValidRiskSurfaceEntry(entry: unknown): boolean {
  if (entry === null || entry === undefined || typeof entry !== "object") return false;
  const r = entry as Record<string, unknown>;
  return (
    typeof r.decision === "string" && r.decision.trim() !== "" &&
    typeof r.risk === "string" && r.risk.trim() !== "" &&
    typeof r.impact === "string" && r.impact.trim() !== ""
  );
}

// ── Tasks shape validation ──

function validateTasksFields(
  record: Record<string, unknown>,
  missingFields: string[],
  invalidFields: string[],
): void {
  for (const field of TASKS_EXTRA_FIELDS) {
    if (record[field] === undefined || record[field] === null) {
      missingFields.push(field);
    }
  }

  // taskReadiness must be array of valid entries
  if (record.taskReadiness !== undefined && record.taskReadiness !== null) {
    if (!Array.isArray(record.taskReadiness)) {
      invalidFields.push("taskReadiness");
    } else {
      for (let i = 0; i < record.taskReadiness.length; i++) {
        const entry = record.taskReadiness[i];
        if (!isValidTaskReadinessEntry(entry)) {
          invalidFields.push(`taskReadiness[${i}]`);
        }
      }
    }
  }

  // splitability must be array of valid entries
  if (record.splitability !== undefined && record.splitability !== null) {
    if (!Array.isArray(record.splitability)) {
      invalidFields.push("splitability");
    } else {
      for (let i = 0; i < record.splitability.length; i++) {
        const entry = record.splitability[i];
        if (!isValidSplitabilityEntry(entry)) {
          invalidFields.push(`splitability[${i}]`);
        }
      }
    }
  }

  // boundaryTests must be array of strings
  if (record.boundaryTests !== undefined && record.boundaryTests !== null) {
    if (!Array.isArray(record.boundaryTests)) {
      invalidFields.push("boundaryTests");
    } else {
      validateStringArrayElements(record.boundaryTests, "boundaryTests", invalidFields);
    }
  }

  // rollbackStep must be non-empty string
  if (record.rollbackStep !== undefined && record.rollbackStep !== null) {
    if (typeof record.rollbackStep !== "string" || record.rollbackStep.trim() === "") {
      invalidFields.push("rollbackStep");
    }
  }

  // blockers must be array of strings
  if (record.blockers !== undefined && record.blockers !== null) {
    if (!Array.isArray(record.blockers)) {
      invalidFields.push("blockers");
    } else {
      validateStringArrayElements(record.blockers, "blockers", invalidFields);
    }
  }

  // placeholders must be array of strings
  if (record.placeholders !== undefined && record.placeholders !== null) {
    if (!Array.isArray(record.placeholders)) {
      invalidFields.push("placeholders");
    } else {
      validateStringArrayElements(record.placeholders, "placeholders", invalidFields);
    }
  }
}

function isValidTaskReadinessEntry(entry: unknown): boolean {
  if (entry === null || entry === undefined || typeof entry !== "object") return false;
  const r = entry as Record<string, unknown>;
  if (
    typeof r.taskId !== "string" || r.taskId.trim() === "" ||
    typeof r.ready !== "boolean" ||
    !Array.isArray(r.blockers)
  ) {
    return false;
  }
  // Every blocker must be a string
  for (const b of r.blockers) {
    if (typeof b !== "string") return false;
  }
  return true;
}

function isValidSplitabilityEntry(entry: unknown): boolean {
  if (entry === null || entry === undefined || typeof entry !== "object") return false;
  const r = entry as Record<string, unknown>;
  return (
    typeof r.taskId === "string" && r.taskId.trim() !== "" &&
    typeof r.splittable === "boolean" &&
    typeof r.reason === "string" && r.reason.trim() !== ""
  );
}

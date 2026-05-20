/**
 * State update contracts — structured update types for artifact mutation.
 */

export type StateUpdateOperation = "patch" | "append-events" | "replace";

export interface PatchEntry {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
}

export interface EventEntry {
  type: string;
  [key: string]: unknown;
}

export interface StateUpdate {
  targetArtifact: string;
  baseVersion: number;
  operation: StateUpdateOperation;
  patch?: PatchEntry[];
  events?: EventEntry[];
  writerId: string;
  idempotencyKey: string;
  timestamp: string;
}

export interface StateUpdateValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateStateUpdate(update: unknown): StateUpdateValidationResult {
  const record = update as Record<string, unknown>;
  const errors: string[] = [];

  // targetArtifact required
  if (!record.targetArtifact || typeof record.targetArtifact !== "string") {
    errors.push("missing targetArtifact");
  }

  // baseVersion >= 0
  if (typeof record.baseVersion !== "number" || record.baseVersion < 0) {
    errors.push("baseVersion must be >= 0");
  }

  // writerId required
  if (!record.writerId || typeof record.writerId !== "string") {
    errors.push("missing writerId");
  }

  // idempotencyKey required
  if (!record.idempotencyKey || typeof record.idempotencyKey !== "string") {
    errors.push("missing idempotencyKey");
  }

  // Operation-specific validation
  const operation = record.operation as StateUpdateOperation;
  if (operation === "patch" && !Array.isArray(record.patch)) {
    errors.push("patch operation requires patch data");
  }

  if (operation === "append-events" && !Array.isArray(record.events)) {
    errors.push("append-events operation requires events data");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

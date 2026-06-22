/**
 * OpenSpec Registry Validator — Read-only validation of OpenSpec registry files.
 *
 * This module provides a read-only validator that:
 * - Discovers changes in openspec/changes/ and openspec/archive/
 * - Parses state.yaml and events.yaml with tolerant YAML parsing
 * - Validates canonical schema conformance and legacy tolerance
 * - Checks phase/status consistency and artifact alignment
 * - Reports structured issues without any filesystem mutations
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { parseYaml } from "./yaml";
import {
  SCHEMA_STATE,
  SCHEMA_EVENTS,
  PHASE_ORDER,
  PHASE_TO_INDEX,
  VALIDATOR_PHASES,
  VALIDATOR_STATUSES,
  VALID_EXPLORATION_CONTEXTS,
  VALID_LIFECYCLE_STATUSES,
  KNOWN_EVENT_NAMES,
  REPAIR_LIFECYCLE_EVENTS,
  type ValidatorPhase,
  type ValidatorStatus,
  type ValidationRuleCode,
  type ExplorationContext,
  type LifecycleStatus,
} from "./schema";
import type {
  ValidateOpenSpecRegistryOptions,
  OpenSpecRegistryValidationResult,
  OpenSpecRegistryValidationIssue,
  OpenSpecRegistryChangeValidation,
  ValidationSeverity,
} from "./types";

const PHASE_EVENT_STATUSES = new Set([
  "completed",
  "started",
  "repaired",
  "failed",
  "passed",
  "approved",
]);
const APPLY_OWNER_EVENT_NAME_PATTERN = /^apply\.[a-z][a-z0-9-]*\.(started|completed|fix_completed)$/;
const KNOWN_EVENT_NAME_SET: ReadonlySet<string> = KNOWN_EVENT_NAMES;
const REPAIR_LIFECYCLE_EVENT_SET: ReadonlySet<string> = REPAIR_LIFECYCLE_EVENTS;

function isKnownRegistryEventName(eventName: string): boolean {
  const [phase, status, extra] = eventName.split(".");

  return (
    (extra === undefined &&
      VALIDATOR_PHASES.includes(phase as ValidatorPhase) &&
      PHASE_EVENT_STATUSES.has(status)) ||
    APPLY_OWNER_EVENT_NAME_PATTERN.test(eventName) ||
    KNOWN_EVENT_NAME_SET.has(eventName)
  );
}

/**
 * Validate the OpenSpec registry.
 *
 * This is a READ-ONLY operation — it never modifies any file on disk.
 *
 * @param options - Validation options
 * @returns Structured validation result with issues
 */
export async function validateOpenSpecRegistry(
  options: ValidateOpenSpecRegistryOptions
): Promise<OpenSpecRegistryValidationResult> {
  const {
    rootDir,
    changeId,
    includeArchive = true,
    includeChanges = true,
  } = options;

  const issues: OpenSpecRegistryValidationIssue[] = [];
  const changes: OpenSpecRegistryChangeValidation[] = [];

  // Resolve paths
  const changesDir = path.join(rootDir, "openspec", "changes");
  const archiveDir = path.join(rootDir, "openspec", "archive");

  let checkedActiveChanges = 0;
  let checkedArchivedChanges = 0;

  // Single-change mode: validate only the specified change
  if (changeId) {
    // First try changes/, then archive/
    let location: "changes" | "archive" | null = null;
    let changePath: string | undefined;

    if (includeChanges) {
      try {
        const changesPath = path.join(changesDir, changeId);
        await fs.access(changesPath);
        changePath = changesPath;
        location = "changes";
      } catch {
        // Not in changes/
      }
    }

    if (!changePath && includeArchive) {
      try {
        const archivePath = path.join(archiveDir, changeId);
        await fs.access(archivePath);
        changePath = archivePath;
        location = "archive";
      } catch {
        // Not in archive/
      }
    }

    if (!changePath || !location) {
      // Change not found — this is a runtime error for CLI
      issues.push({
        severity: "error",
        rule: "change.not_found",
        message: `Change not found: ${changeId}`,
        path: rootDir,
        changeId,
      });
    } else {
      const result = await validateChange(changePath, location, changeId, issues);
      if (location === "changes") {
        checkedActiveChanges = 1;
      } else {
        checkedArchivedChanges = 1;
      }
      changes.push(result);
    }
  } else {
    // Full validation mode
    if (includeChanges) {
      try {
        const changeDirs = await fs.readdir(changesDir);
        for (const dir of changeDirs) {
          const changePath = path.join(changesDir, dir);
          const stat = await fs.stat(changePath);
          if (stat.isDirectory()) {
            const result = await validateChange(changePath, "changes", dir, issues);
            changes.push(result);
            checkedActiveChanges++;
          }
        }
      } catch (err) {
        // changes/ doesn't exist — that's ok, return empty result
      }
    }

    if (includeArchive) {
      try {
        const archiveDirs = await fs.readdir(archiveDir);
        for (const dir of archiveDirs) {
          const changePath = path.join(archiveDir, dir);
          const stat = await fs.stat(changePath);
          if (stat.isDirectory()) {
            const result = await validateChange(changePath, "archive", dir, issues);
            changes.push(result);
            checkedArchivedChanges++;
          }
        }
      } catch (err) {
        // archive/ doesn't exist — that's ok, return empty result
      }
    }
  }

  // Compute summary
  const totalErrors = issues.filter((i) => i.severity === "error").length;
  const totalWarnings = issues.filter((i) => i.severity === "warning").length;
  const totalChanges = checkedActiveChanges + checkedArchivedChanges;
  const changesWithErrors = changes.filter((c) => c.issueCounts.errors > 0).length;
  const changesWithWarnings = changes.filter((c) => c.issueCounts.warnings > 0 && c.issueCounts.errors === 0).length;
  const validChanges = changes.filter((c) => c.issueCounts.errors === 0).length;

  return {
    schema: "openspec-registry-validation-result-v1",
    ok: totalErrors === 0,
    rootDir,
    summary: {
      totalChanges,
      totalActiveChanges: checkedActiveChanges,
      totalArchivedChanges: checkedArchivedChanges,
      changesWithErrors,
      changesWithWarnings,
      totalErrors,
      totalWarnings,
      validChanges,
    },
    issues,
    changes,
  };
}

/**
 * Validate a single change directory.
 */
async function validateChange(
  changePath: string,
  location: "changes" | "archive",
  changeId: string,
  issues: OpenSpecRegistryValidationIssue[]
): Promise<OpenSpecRegistryChangeValidation> {
  const statePath = path.join(changePath, "state.yaml");
  const eventsPath = path.join(changePath, "events.yaml");

  let currentPhase: string | undefined;
  let status: string | undefined;
  let detectedSchema: string | undefined;
  let detectedEventsSchema: string | undefined;
  let changeIssues = 0;
  let warningIssues = 0;
  let isCanonical = false;
  let stateArtifacts: Record<string, string> | undefined;
  let sawRepairLifecycleEvent = false;

  // Check if state.yaml exists
  let stateData: unknown;
  try {
    await fs.access(statePath);
  } catch {
    issues.push({
      severity: "error",
      rule: "state.yaml.missing",
      message: "state.yaml is required",
      path: statePath,
      changeId,
      file: "state.yaml",
    });
    return {
      changeId,
      location,
      path: changePath,
      statePath,
      issueCounts: { errors: 1, warnings: 0 },
    };
  }

  // Parse state.yaml
  try {
    const stateContent = await fs.readFile(statePath, "utf-8");
    const parsed = parseYaml(stateContent);

    // Add parse diagnostics as issues
    for (const diag of parsed.diagnostics) {
      issues.push({
        severity: diag.severity,
        rule: diag.code,
        message: diag.message,
        path: statePath,
        changeId,
        file: "state.yaml",
        details: diag.line ? { line: diag.line, column: diag.column } : undefined,
      });
      if (diag.severity === "error") {
        changeIssues++;
      } else {
        warningIssues++;
      }
    }

    if (!parsed.ok) {
      // Parse failed — can't validate schema
      return {
        changeId,
        location,
        path: changePath,
        statePath,
        eventsPath: undefined,
        issueCounts: { errors: changeIssues, warnings: warningIssues },
      };
    }

    stateData = parsed.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    issues.push({
      severity: "error",
      rule: "state.yaml.parse_error",
      message: `Failed to read state.yaml: ${message}`,
      path: statePath,
      changeId,
      file: "state.yaml",
    });
    return {
      changeId,
      location,
      path: changePath,
      statePath,
      issueCounts: { errors: 1, warnings: 0 },
    };
  }

  // Validate state.yaml structure
  if (stateData && typeof stateData === "object") {
    const state = stateData as Record<string, unknown>;

    // Detect schema version
    detectedSchema = typeof state.schema === "string" ? state.schema : undefined;
    isCanonical = detectedSchema === SCHEMA_STATE;

    // Check for legacy drift (missing schema)
    if (!detectedSchema) {
      issues.push({
        severity: "warning",
        rule: "state.schema.missing",
        message: "Missing schema field; treating as legacy change",
        path: statePath,
        changeId,
        file: "state.yaml",
        field: "schema",
      });
      warningIssues++;
    }

    // Validate required fields for canonical schema
    if (isCanonical) {
      // changeId
      if (typeof state.changeId !== "string" || state.changeId === "") {
        issues.push({
          severity: "error",
          rule: "state.changeId.missing",
          message: "Missing required field: changeId",
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "changeId",
        });
        changeIssues++;
      }

      // currentPhase
      currentPhase = typeof state.currentPhase === "string" ? state.currentPhase : undefined;
      if (!currentPhase) {
        issues.push({
          severity: "error",
          rule: "state.currentPhase.missing",
          message: "Missing required field: currentPhase",
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "currentPhase",
        });
        changeIssues++;
      } else if (!VALIDATOR_PHASES.includes(currentPhase as ValidatorPhase)) {
        issues.push({
          severity: "error",
          rule: "state.currentPhase.invalid",
          message: `Invalid currentPhase value: ${currentPhase}`,
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "currentPhase",
        });
        changeIssues++;
      }

      // status
      status = typeof state.status === "string" ? state.status : undefined;
      if (!status) {
        issues.push({
          severity: "error",
          rule: "state.status.missing",
          message: "Missing required field: status",
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "status",
        });
        changeIssues++;
      } else if (!VALIDATOR_STATUSES.includes(status as ValidatorStatus)) {
        issues.push({
          severity: "error",
          rule: "state.status.invalid",
          message: `Invalid status value: ${status}`,
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "status",
        });
        changeIssues++;
      }

      // Phase/status consistency: archive phase requires archived status
      if (currentPhase === "archive" && status !== "archived") {
        issues.push({
          severity: "error",
          rule: "state.phase_status.invalid_archive",
          message: `Phase archive requires status archived, got ${status}`,
          path: statePath,
          changeId,
          file: "state.yaml",
        });
        changeIssues++;
      }

      // Phase/status consistency: closed phase requires abandoned or incomplete
      if (currentPhase === "closed" && status !== "abandoned" && status !== "incomplete") {
        issues.push({
          severity: "error",
          rule: "state.phase_status.invalid_closed",
          message: `Phase closed requires status abandoned or incomplete, got ${status}`,
          path: statePath,
          changeId,
          file: "state.yaml",
        });
        changeIssues++;
      }

      // closure_reason required when status is abandoned or incomplete
      if ((status === "abandoned" || status === "incomplete") && !state.closure_reason) {
        issues.push({
          severity: "error",
          rule: "state.closure_reason.required",
          message: "closure_reason required when status is abandoned or incomplete",
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "closure_reason",
        });
        changeIssues++;
      }

      // Exploration lifecycle validation (Task 3: warning-level only)
      // These fields are optional - validate only when present
      const explorationContext = state.exploration_context as string | undefined;
      const lifecycleStatus = state.lifecycle_status as string | undefined;
      const nextAction = state.next_action as string | undefined;
      const lifecycleReason = state.lifecycle_reason as string | undefined;
      const lifecycleRef = state.lifecycle_ref as string | undefined;

      // Validate exploration_context when present
      if (explorationContext && !VALID_EXPLORATION_CONTEXTS.includes(explorationContext as ExplorationContext)) {
        issues.push({
          severity: "warning",
          rule: "lifecycle.unknown_context",
          message: `Unknown exploration_context: ${explorationContext}; expected sdd or delegated`,
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "exploration_context",
        });
        warningIssues++;
      }

      // Validate lifecycle_status when present
      if (lifecycleStatus && !VALID_LIFECYCLE_STATUSES.includes(lifecycleStatus as LifecycleStatus)) {
        issues.push({
          severity: "warning",
          rule: "lifecycle.unknown_value",
          message: `Unknown lifecycle_status: ${lifecycleStatus}; expected diagnosed, deferred, closed-no-action, converted-to-change, converted-to-sdd, or keep-as-reference`,
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "lifecycle_status",
        });
        warningIssues++;
      }

      // Warn if lifecycle_status present but exploration_context missing
      if (lifecycleStatus && !explorationContext) {
        issues.push({
          severity: "warning",
          rule: "lifecycle.missing_context",
          message: "lifecycle_status present but exploration_context is missing; expected sdd or delegated",
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "exploration_context",
        });
        warningIssues++;
      }

      // Warn if diagnosed without next_action
      if (lifecycleStatus === "diagnosed" && !nextAction) {
        issues.push({
          severity: "warning",
          rule: "lifecycle.missing_next_action",
          message: "lifecycle_status is diagnosed but next_action is missing",
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "next_action",
        });
        warningIssues++;
      }

      // Warn if deferred without reason or reactivation condition
      if (lifecycleStatus === "deferred" && !lifecycleReason && !nextAction) {
        issues.push({
          severity: "warning",
          rule: "lifecycle.incomplete_deferred",
          message: "lifecycle_status is deferred but reason or reactivation condition is missing",
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "lifecycle_reason",
        });
        warningIssues++;
      }

      // Warn if closed-no-action without reason
      if (lifecycleStatus === "closed-no-action" && !lifecycleReason) {
        issues.push({
          severity: "warning",
          rule: "lifecycle.incomplete_closed_no_action",
          message: "lifecycle_status is closed-no-action but reason is missing",
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "lifecycle_reason",
        });
        warningIssues++;
      }

      // Warn if converted-to-change without reference
      if (lifecycleStatus === "converted-to-change" && !lifecycleRef) {
        issues.push({
          severity: "warning",
          rule: "lifecycle.missing_conversion_reference",
          message: "lifecycle_status is converted-to-change but reference is missing",
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "lifecycle_ref",
        });
        warningIssues++;
      }

      // Warn if converted-to-sdd without reference
      if (lifecycleStatus === "converted-to-sdd" && !lifecycleRef) {
        issues.push({
          severity: "warning",
          rule: "lifecycle.missing_sdd_reference",
          message: "lifecycle_status is converted-to-sdd but SDD reference is missing",
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "lifecycle_ref",
        });
        warningIssues++;
      }

      // Warn if keep-as-reference without rationale
      if (lifecycleStatus === "keep-as-reference" && !lifecycleReason && !nextAction) {
        issues.push({
          severity: "warning",
          rule: "lifecycle.missing_reference_rationale",
          message: "lifecycle_status is keep-as-reference but rationale is missing",
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "lifecycle_reason",
        });
        warningIssues++;
      }

      // artifacts
      if (!state.artifacts || typeof state.artifacts !== "object") {
        issues.push({
          severity: "error",
          rule: "state.artifacts.missing",
          message: "Missing required field: artifacts",
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "artifacts",
        });
        changeIssues++;
      } else {
        // Check exploration artifact exists
        const artifacts = state.artifacts as Record<string, string>;
        stateArtifacts = artifacts;
        if (!artifacts.exploration) {
          issues.push({
            severity: "error",
            rule: "state.artifacts.missing",
            message: "artifacts must contain exploration key",
            path: statePath,
            changeId,
            file: "state.yaml",
            field: "artifacts",
          });
          changeIssues++;
        }

        // Validate artifacts exist for completed phases
        const phaseIndex = currentPhase ? PHASE_TO_INDEX.get(currentPhase as ValidatorPhase) : -1;
        if (phaseIndex !== undefined && phaseIndex >= 0) {
          // Check each phase up to current
          for (let i = 0; i <= phaseIndex; i++) {
            const phase = PHASE_ORDER[i]!;
            const artifactKey = phase === "explore" ? "exploration" : phase;
            const artifactPath = artifacts[artifactKey];
            if (artifactPath) {
              const fullPath = path.join(changePath, artifactPath);
              try {
                await fs.access(fullPath);
              } catch {
                issues.push({
                  severity: "error",
                  rule: "artifact.missing_for_completed_phase",
                  message: `Artifact file not found: ${artifactPath} (required for phase ${phase})`,
                  path: fullPath,
                  changeId,
                  file: "artifact",
                  field: artifactKey,
                });
                changeIssues++;
              }
            }
          }
        }

        // Task 7: Check for preconditions.md existence at Apply+ phase (WARNING only, first iteration)
        // Scope: active changes at or beyond apply phase, not exploration-only
        const APPLY_PHASES = ["apply", "verify", "review", "archive"];
        if (currentPhase && APPLY_PHASES.includes(currentPhase) && isCanonical) {
          const preconditionsPath = path.join(changePath, "preconditions.md");
          try {
            await fs.access(preconditionsPath);
            // preconditions.md exists - check if state.yaml references it
            if (!artifacts.preconditions) {
              issues.push({
                severity: "warning",
                rule: "preconditions.artifact.not_referenced",
                message: "preconditions.md exists but not referenced in state.yaml artifacts",
                path: preconditionsPath,
                changeId,
                file: "preconditions.md",
                field: "artifacts.preconditions",
              });
              warningIssues++;
            }
          } catch {
            // preconditions.md does not exist - WARNING only (first iteration)
            if (artifacts.preconditions) {
              // Referenced but missing - this is already caught above as artifact.missing_for_completed_phase
            } else {
              issues.push({
                severity: "warning",
                rule: "preconditions.artifact.missing",
                message: "preconditions.md not found for change at Apply+ phase",
                path: preconditionsPath,
                changeId,
                file: "preconditions.md",
              });
              warningIssues++;
            }
          }
        }

        // Validate an explicitly referenced repair incident independently of
        // lifecycle telemetry. Missing references remain warning-first only
        // when repair.* events exist without this artifact key.
        if (artifacts.repair_incident) {
          const fullPath = path.join(changePath, artifacts.repair_incident);
          try {
            await fs.access(fullPath);
          } catch {
            issues.push({
              severity: "error",
              rule: "artifact.missing_for_completed_phase",
              message: `Repair incident artifact file not found: ${artifacts.repair_incident}`,
              path: fullPath,
              changeId,
              file: "artifact",
              field: "artifacts.repair_incident",
            });
            changeIssues++;
          }
        }
      }

      // provenance
      // First check if it's an object (legacy shape) — must be before array check
      if (state.provenance && typeof state.provenance === "object" && !Array.isArray(state.provenance)) {
        issues.push({
          severity: "warning",
          rule: "state.provenance.legacy_shape",
          message: "provenance is object; expected array",
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "provenance",
        });
        warningIssues++;
      } else if (!Array.isArray(state.provenance) || state.provenance.length === 0) {
        // Now handle missing or empty array — unreachable if we had object above
        issues.push({
          severity: isCanonical ? "error" : "warning",
          rule: "state.provenance.missing",
          message: isCanonical
            ? "Missing or empty provenance array"
            : "Missing provenance; treating as legacy",
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "provenance",
        });
        if (isCanonical) {
          changeIssues++;
        } else {
          warningIssues++;
        }
      }
    } else {
      // Legacy handling — check for legacy field names
      if (state.current_phase || state.phase || state.state) {
        issues.push({
          severity: "warning",
          rule: "state.currentPhase.legacy_field",
          message: "Non-canonical field: current_phase (expected currentPhase)",
          path: statePath,
          changeId,
          file: "state.yaml",
          field: "current_phase",
        });
        warningIssues++;
      }

      currentPhase =
        (state.currentPhase as string) ||
        (state.current_phase as string) ||
        (state.phase as string) ||
        (state.state as string);
      status = state.status as string | undefined;
    }
  }

  // Check events.yaml presence
  const eventsPhaseIndex = currentPhase
    ? PHASE_TO_INDEX.get(currentPhase as ValidatorPhase)
    : -1;

  // Events required when phase > explore (index > 0)
  let eventsData: unknown;
  if (eventsPhaseIndex !== undefined && eventsPhaseIndex > 0) {
    try {
      await fs.access(eventsPath);
    } catch {
      issues.push({
        severity: isCanonical ? "error" : "warning",
        rule: "events.yaml.missing",
        message: `events.yaml required when currentPhase is ${currentPhase}`,
        path: eventsPath,
        changeId,
        file: "events.yaml",
      });
      if (isCanonical) {
        changeIssues++;
      } else {
        warningIssues++;
      }
    }

    // Parse events.yaml if it exists
    if (eventsPhaseIndex > 0) {
      try {
        const eventsContent = await fs.readFile(eventsPath, "utf-8");
        const parsed = parseYaml(eventsContent);

        for (const diag of parsed.diagnostics) {
          issues.push({
            severity: diag.severity,
            rule: diag.code,
            message: diag.message,
            path: eventsPath,
            changeId,
            file: "events.yaml",
            details: diag.line ? { line: diag.line, column: diag.column } : undefined,
          });
          if (diag.severity === "error") {
            changeIssues++;
          } else {
            warningIssues++;
          }
        }

        if (parsed.ok && parsed.data) {
          const events = parsed.data as Record<string, unknown>;
          detectedEventsSchema = typeof events.schema === "string" ? events.schema : undefined;

          // Check events array
          const eventsArray = events.events;
          if (!Array.isArray(eventsArray)) {
            issues.push({
              severity: "error",
              rule: "events.events.missing",
              message: "Missing or invalid events array",
              path: eventsPath,
              changeId,
              file: "events.yaml",
              field: "events",
            });
            changeIssues++;
          } else {
            // Validate each event
            for (let i = 0; i < eventsArray.length; i++) {
              const event = eventsArray[i] as Record<string, unknown> | undefined;
              if (!event) continue;

              // Required fields
              const required = ["phase", "status", "event", "artifact", "timestamp", "actor"] as const;
              for (const field of required) {
                if (!event[field]) {
                  issues.push({
                    severity: "error",
                    rule: "events.event.required_field_missing",
                    message: `Event missing required field: ${field}`,
                    path: eventsPath,
                    changeId,
                    file: "events.yaml",
                    field,
                  });
                  changeIssues++;
                }
              }

              // Event name should match one of the known registry event naming patterns.
              const eventName = event.event as string | undefined;
              const phase = event.phase as string | undefined;
              const status = event.status as string | undefined;
              if (eventName && phase && status) {
                if (REPAIR_LIFECYCLE_EVENT_SET.has(eventName)) {
                  sawRepairLifecycleEvent = true;
                }
                const expected = `${phase}.${status}`;
                if (!isKnownRegistryEventName(eventName)) {
                  issues.push({
                    severity: "warning",
                    rule: "events.event.name_mismatch",
                    message: `Event name does not match a known registry event pattern: ${eventName} (legacy expected ${expected})`,
                    path: eventsPath,
                    changeId,
                    file: "events.yaml",
                  });
                  warningIssues++;
                }
              }
            }

            if (sawRepairLifecycleEvent) {
              const repairIncidentPath = stateArtifacts?.repair_incident;
              if (!repairIncidentPath) {
                issues.push({
                  severity: "warning",
                  rule: "repair_incident.artifact.missing",
                  message: "repair.* lifecycle events are present but artifacts.repair_incident is not referenced",
                  path: statePath,
                  changeId,
                  file: "state.yaml",
                  field: "artifacts.repair_incident",
                });
                warningIssues++;
              }
            }

            // Last phase-advancing event should match currentPhase. Repair lifecycle
            // events are auxiliary telemetry and must not advance currentPhase.
            const phaseEvents = eventsArray.filter((candidate) => {
              const candidateEvent = candidate as Record<string, unknown> | undefined;
              const candidateName = candidateEvent?.event;
              return typeof candidateName !== "string" || !REPAIR_LIFECYCLE_EVENT_SET.has(candidateName);
            });
            const lastEvent = phaseEvents[phaseEvents.length - 1] as
              | Record<string, unknown>
              | undefined;
            if (lastEvent && currentPhase) {
              const lastPhase = lastEvent.phase as string | undefined;
              if (lastPhase && lastPhase !== currentPhase) {
                issues.push({
                  severity: "warning",
                  rule: "events.state.last_event_mismatch",
                  message: `Last event phase ${lastPhase} differs from state currentPhase ${currentPhase}`,
                  path: eventsPath,
                  changeId,
                  file: "events.yaml",
                });
                warningIssues++;
              }
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        issues.push({
          severity: "error",
          rule: "events.yaml.parse_error",
          message: `Failed to read events.yaml: ${message}`,
          path: eventsPath,
          changeId,
          file: "events.yaml",
        });
        changeIssues++;
      }
    }
  }

  return {
    changeId,
    location,
    path: changePath,
    statePath,
    eventsPath,
    detectedSchema,
    detectedEventsSchema,
    currentPhase,
    status,
    issueCounts: { errors: changeIssues, warnings: warningIssues },
  };
}

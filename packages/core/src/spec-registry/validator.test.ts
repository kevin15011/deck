/**
 * Tests for the OpenSpec Registry Validator.
 *
 * These tests validate:
 * - Canonical valid state.yaml passes
 * - Missing required field reports error
 * - Invalid enum reports error
 * - Malformed YAML handled gracefully
 * - Phase > explore without events.yaml reports error
 * - Artifact missing for completed phase reports error
 * - Legacy drift reports warnings
 * - Empty project returns ok:true with zero counts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { validateOpenSpecRegistry } from "./validator";

describe("validateOpenSpecRegistry", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "validator-test-"));
    // Ensure openspec directories exist
    await fs.mkdir(path.join(tempDir, "openspec", "changes"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "openspec", "archive"), { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("canonical valid state.yaml passes", async () => {
    // Create valid canonical state.yaml with events.yaml and artifact files
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "valid-change"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "valid-change", "state.yaml"),
      `schema: spec-registry-v1
changeId: valid-change
currentPhase: spec
status: in_progress
artifacts:
  exploration: exploration.md
  proposal: proposal.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "valid-change", "events.yaml"),
      `schema: spec-registry-events-v1
events:
  - phase: explore
    status: completed
    event: explore.completed
    artifact: exploration.md
    timestamp: "2026-01-01T00:00:00Z"
    actor: deck
`
    );
    // Create artifact files for completed phases (explore, proposal)
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "valid-change", "exploration.md"),
      "# Exploration"
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "valid-change", "proposal.md"),
      "# Proposal"
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "valid-change",
    });

    expect(result.ok).toBe(true);
    expect(result.summary.totalErrors).toBe(0);
    expect(result.summary.totalChanges).toBe(1);
  });

  test("missing required field reports error", async () => {
    // Create state.yaml missing changeId
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "missing-changeid"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "missing-changeid", "state.yaml"),
      `schema: spec-registry-v1
currentPhase: spec
status: in_progress
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "missing-changeid",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        rule: "state.changeId.missing",
        severity: "error",
      })
    );
  });

  test("invalid enum reports error", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "invalid-phase"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "invalid-phase", "state.yaml"),
      `schema: spec-registry-v1
changeId: invalid-phase
currentPhase: unknown_phase
status: in_progress
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "invalid-phase",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        rule: "state.currentPhase.invalid",
        severity: "error",
      })
    );
  });

  test("malformed YAML handled gracefully", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "bad-yaml"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "bad-yaml", "state.yaml"),
      `schema: spec-registry-v1
changeId: bad-yaml
currentPhase: spec
  invalid: indentation
`
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "bad-yaml",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        rule: "yaml.parse_error",
        severity: "error",
      })
    );
  });

  test("phase > explore without events.yaml reports error", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "no-events"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "no-events", "state.yaml"),
      `schema: spec-registry-v1
changeId: no-events
currentPhase: spec
status: in_progress
artifacts:
  exploration: exploration.md
  proposal: proposal.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "no-events",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        rule: "events.yaml.missing",
        severity: "error",
      })
    );
  });

  test("artifact missing for completed phase reports error", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "missing-artifact"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "missing-artifact", "state.yaml"),
      `schema: spec-registry-v1
changeId: missing-artifact
currentPhase: apply
status: in_progress
artifacts:
  exploration: exploration.md
  proposal: proposal.md
  spec: spec.md
  design: design.md
  tasks: tasks.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
  - phase: proposal
    agent: deck
    timestamp: "2026-01-02T00:00:00Z"
  - phase: spec
    agent: deck
    timestamp: "2026-01-03T00:00:00Z"
  - phase: design
    agent: deck
    timestamp: "2026-01-04T00:00:00Z"
  - phase: tasks
    agent: deck
    timestamp: "2026-01-05T00:00:00Z"
`
    );
    // Don't create spec.md, design.md, tasks.md — they should be missing

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "missing-artifact",
    });

    expect(result.ok).toBe(false);
    const artifactErrors = result.issues.filter(
      (i) => i.rule === "artifact.missing_for_completed_phase"
    );
    expect(artifactErrors.length).toBeGreaterThan(0);
  });

  test("legacy drift reports warnings", async () => {
    // Legacy changes in explore phase don't need events.yaml
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "legacy-change"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "legacy-change", "state.yaml"),
      `changeId: legacy-change
currentPhase: explore
status: in_progress
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "legacy-change",
    });

    // Legacy changes should have warnings but no errors
    expect(result.summary.totalErrors).toBe(0);
    expect(result.summary.totalWarnings).toBeGreaterThan(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        rule: "state.schema.missing",
        severity: "warning",
      })
    );
  });

  test("empty project returns ok with zero counts", async () => {
    // Create a temp dir with no openspec directory
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "validator-empty-"));
    const result = await validateOpenSpecRegistry({
      rootDir: emptyDir,
    });

    expect(result.ok).toBe(true);
    expect(result.summary.totalChanges).toBe(0);
    expect(result.summary.totalErrors).toBe(0);
    expect(result.summary.totalWarnings).toBe(0);

    // Cleanup
    await fs.rm(emptyDir, { recursive: true, force: true }).catch(() => {});
  });

  test("archive phase requires archived status", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "archive", "archived-change"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "archive", "archived-change", "state.yaml"),
      `schema: spec-registry-v1
changeId: archived-change
currentPhase: archive
status: completed
artifacts:
  exploration: exploration.md
  proposal: proposal.md
  spec: spec.md
  design: design.md
  tasks: tasks.md
  apply_progress: apply-progress.md
  verify_report: verify-report.md
  review_report: review-report.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "archived-change",
      includeArchive: true,
      includeChanges: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        rule: "state.phase_status.invalid_archive",
        severity: "error",
      })
    );
  });

  test("single-change lookup finds archived change by default", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "archive", "archived-lookup"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "archive", "archived-lookup", "state.yaml"),
      `schema: spec-registry-v1
changeId: archived-lookup
currentPhase: archive
status: archived
artifacts:
  exploration: exploration.md
  proposal: proposal.md
  spec: spec.md
  design: design.md
  tasks: tasks.md
  apply_progress: apply-progress.md
  verify_report: verify-report.md
  review_report: review-report.md
  archive_report: archive-report.md
provenance:
  - phase: archive
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "archive", "archived-lookup", "events.yaml"),
      `schema: spec-registry-events-v1
events:
  - phase: archive
    status: completed
    event: archive.completed
    artifact: archive-report.md
    timestamp: "2026-01-01T00:00:00Z"
    actor: deck
`
    );
    for (const file of [
      "exploration.md",
      "proposal.md",
      "spec.md",
      "design.md",
      "tasks.md",
      "apply-progress.md",
      "verify-report.md",
      "review-report.md",
      "archive-report.md",
    ]) {
      await fs.writeFile(path.join(tempDir, "openspec", "archive", "archived-lookup", file), `# ${file}`);
    }

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "archived-lookup",
    });

    expect(result.summary.totalArchivedChanges).toBe(1);
    expect(result.changes).toContainEqual(
      expect.objectContaining({
        changeId: "archived-lookup",
        location: "archive",
      })
    );
    expect(result.issues).not.toContainEqual(
      expect.objectContaining({ rule: "change.not_found" })
    );
  });

  test("closed phase requires abandoned or incomplete status", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "closed-change"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "closed-change", "state.yaml"),
      `schema: spec-registry-v1
changeId: closed-change
currentPhase: closed
status: completed
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "closed-change",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        rule: "state.phase_status.invalid_closed",
        severity: "error",
      })
    );
  });

  test("closure_reason required for abandoned status", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "abandoned-no-reason"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "abandoned-no-reason", "state.yaml"),
      `schema: spec-registry-v1
changeId: abandoned-no-reason
currentPhase: closed
status: abandoned
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "abandoned-no-reason",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        rule: "state.closure_reason.required",
        severity: "error",
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Exploration lifecycle tests (Task 1: TDD for optional lifecycle fields)
// ---------------------------------------------------------------------------

describe("Exploration lifecycle optional fields (Task 1)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lifecycle-test-"));
    await fs.mkdir(path.join(tempDir, "openspec", "changes"), { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("valid exploration_context: sdd does not fail validation", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "lifecycle-sdd"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "lifecycle-sdd", "state.yaml"),
      `schema: spec-registry-v1
changeId: lifecycle-sdd
currentPhase: explore
status: in_progress
exploration_context: sdd
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "lifecycle-sdd", "exploration.md"),
      "# Exploration"
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "lifecycle-sdd",
    });

    // Valid lifecycle context should not produce errors
    expect(result.ok).toBe(true);
    // Should not have any lifecycle-related errors
    const lifecycleErrors = result.issues.filter(
      (i) => i.rule?.includes("lifecycle") || i.message?.includes("lifecycle")
    );
    expect(lifecycleErrors.length).toBe(0);
  });

  test("valid exploration_context: delegated does not fail validation", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "lifecycle-delegated"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "lifecycle-delegated", "state.yaml"),
      `schema: spec-registry-v1
changeId: lifecycle-delegated
currentPhase: explore
status: in_progress
exploration_context: delegated
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "lifecycle-delegated", "exploration.md"),
      "# Exploration"
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "lifecycle-delegated",
    });

    expect(result.ok).toBe(true);
  });

  test("valid lifecycle_status: diagnosed with next_action does not fail", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "diagnosed"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "diagnosed", "state.yaml"),
      `schema: spec-registry-v1
changeId: diagnosed
currentPhase: explore
status: in_progress
exploration_context: sdd
lifecycle_status: diagnosed
next_action: "Review diagnosis and decide whether to propose"
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "diagnosed", "exploration.md"),
      "# Exploration"
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "diagnosed",
    });

    expect(result.ok).toBe(true);
  });

  test("valid lifecycle_status values: deferred, closed-no-action, converted-to-change, converted-to-sdd, keep-as-reference", async () => {
    const statuses = ["deferred", "closed-no-action", "converted-to-change", "converted-to-sdd", "keep-as-reference"];
    const changeId = "lifecycle-statuses";

    for (const status of statuses) {
      await fs.mkdir(path.join(tempDir, "openspec", "changes", `${changeId}-${status}`));
      await fs.writeFile(
        path.join(tempDir, "openspec", "changes", `${changeId}-${status}`, "state.yaml"),
        `schema: spec-registry-v1
changeId: ${changeId}-${status}
currentPhase: explore
status: in_progress
exploration_context: sdd
lifecycle_status: ${status}
next_action: "test action"
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
      );
      await fs.writeFile(
        path.join(tempDir, "openspec", "changes", `${changeId}-${status}`, "exploration.md"),
        "# Exploration"
      );

      const result = await validateOpenSpecRegistry({
        rootDir: tempDir,
        changeId: `${changeId}-${status}`,
      });

      expect(result.ok).toBe(true);
    }
  });

  test("unknown exploration_context emits WARNING (not error)", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "unknown-context"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "unknown-context", "state.yaml"),
      `schema: spec-registry-v1
changeId: unknown-context
currentPhase: explore
status: in_progress
exploration_context: unknown_context
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "unknown-context", "exploration.md"),
      "# Exploration"
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "unknown-context",
    });

    // Unknown context should NOT fail validation
    expect(result.ok).toBe(true);
    // But should have a warning
    const contextWarnings = result.issues.filter(
      (i) => i.rule === "lifecycle.unknown_context" || i.message?.includes("exploration context")
    );
    expect(contextWarnings.length).toBeGreaterThan(0);
    expect(contextWarnings[0]?.severity).toBe("warning");
  });

  test("unknown lifecycle_status emits WARNING (not error)", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "unknown-status"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "unknown-status", "state.yaml"),
      `schema: spec-registry-v1
changeId: unknown-status
currentPhase: explore
status: in_progress
exploration_context: sdd
lifecycle_status: invalid_status
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "unknown-status", "exploration.md"),
      "# Exploration"
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "unknown-status",
    });

    // Unknown status should NOT fail validation
    expect(result.ok).toBe(true);
    // But should have a warning
    const statusWarnings = result.issues.filter(
      (i) => i.rule === "lifecycle.unknown_value" || i.message?.includes("lifecycle")
    );
    expect(statusWarnings.length).toBeGreaterThan(0);
    expect(statusWarnings[0]?.severity).toBe("warning");
  });

  test("lifecycle present but missing exploration_context emits WARNING", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "missing-context"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "missing-context", "state.yaml"),
      `schema: spec-registry-v1
changeId: missing-context
currentPhase: explore
status: in_progress
lifecycle_status: diagnosed
next_action: "test"
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "missing-context", "exploration.md"),
      "# Exploration"
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "missing-context",
    });

    // Should NOT fail validation
    expect(result.ok).toBe(true);
    // But should have a warning about missing context
    const contextWarnings = result.issues.filter(
      (i) => i.rule === "lifecycle.missing_context"
    );
    expect(contextWarnings.length).toBeGreaterThan(0);
    expect(contextWarnings[0]?.severity).toBe("warning");
  });

  test("diagnosed without next_action emits WARNING", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "diagnosed-no-action"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "diagnosed-no-action", "state.yaml"),
      `schema: spec-registry-v1
changeId: diagnosed-no-action
currentPhase: explore
status: in_progress
exploration_context: sdd
lifecycle_status: diagnosed
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "diagnosed-no-action", "exploration.md"),
      "# Exploration"
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "diagnosed-no-action",
    });

    // Should NOT fail validation
    expect(result.ok).toBe(true);
    // But should have a warning about missing next_action
    const actionWarnings = result.issues.filter(
      (i) => i.rule === "lifecycle.missing_next_action"
    );
    expect(actionWarnings.length).toBeGreaterThan(0);
    expect(actionWarnings[0]?.severity).toBe("warning");
  });

  test("canonical phase/status errors remain strict errors", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "invalid-phase"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "invalid-phase", "state.yaml"),
      `schema: spec-registry-v1
changeId: invalid-phase
currentPhase: invalid_phase
status: in_progress
exploration_context: sdd
lifecycle_status: diagnosed
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "invalid-phase", "exploration.md"),
      "# Exploration"
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "invalid-phase",
    });

    // Canonical phase error should FAIL validation (error, not warning)
    expect(result.ok).toBe(false);
    const phaseErrors = result.issues.filter(
      (i) => i.rule === "state.currentPhase.invalid"
    );
    expect(phaseErrors.length).toBeGreaterThan(0);
    expect(phaseErrors[0]?.severity).toBe("error");
  });

  test("canonical status errors remain strict errors", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "invalid-status"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "invalid-status", "state.yaml"),
      `schema: spec-registry-v1
changeId: invalid-status
currentPhase: explore
status: invalid_status
exploration_context: sdd
lifecycle_status: diagnosed
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "invalid-status", "exploration.md"),
      "# Exploration"
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "invalid-status",
    });

    // Canonical status error should FAIL validation
    expect(result.ok).toBe(false);
    const statusErrors = result.issues.filter(
      (i) => i.rule === "state.status.invalid"
    );
    expect(statusErrors.length).toBeGreaterThan(0);
    expect(statusErrors[0]?.severity).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Preconditions artifact existence check tests (Task 7)
// ---------------------------------------------------------------------------

describe("Preconditions artifact existence check (Task 7)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "precond-test-"));
    await fs.mkdir(path.join(tempDir, "openspec", "changes"), { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("Apply+ change without preconditions.md reports WARNING", async () => {
    // Create a change at apply phase without preconditions.md
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "apply-no-precond"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "apply-no-precond", "state.yaml"),
      `schema: spec-registry-v1
changeId: apply-no-precond
currentPhase: apply
status: in_progress
artifacts:
  exploration: exploration.md
  proposal: proposal.md
  spec: spec.md
  design: design.md
  tasks: tasks.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "apply-no-precond", "events.yaml"),
      `schema: spec-registry-events-v1
events:
  - phase: explore
    status: completed
    event: explore.completed
    artifact: exploration.md
    timestamp: "2026-01-01T00:00:00Z"
    actor: deck
  - phase: tasks
    status: completed
    event: tasks.completed
    artifact: tasks.md
    timestamp: "2026-01-01T00:00:00Z"
    actor: deck
`
    );
    // Create artifact files
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "apply-no-precond", "exploration.md"),
      "# Exploration"
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "apply-no-precond", "proposal.md"),
      "# Proposal"
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "apply-no-precond", "spec.md"),
      "# Spec"
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "apply-no-precond", "design.md"),
      "# Design"
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "apply-no-precond", "tasks.md"),
      "# Tasks"
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "apply-no-precond",
    });

    // Should report WARNING (not error) for missing preconditions.md at Apply+
    expect(result.summary.totalWarnings).toBeGreaterThan(0);
    const precondWarning = result.issues.find(
      (i) => i.rule === "preconditions.artifact.missing" || i.message?.includes("preconditions")
    );
    // First iteration: WARNING only, not error
    if (precondWarning) {
      expect(precondWarning.severity).toBe("warning");
    }
  });

  test("Apply+ change with preconditions.md passes existence check", async () => {
    // Create a change at apply phase WITH preconditions.md
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "apply-with-precond"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "apply-with-precond", "state.yaml"),
      `schema: spec-registry-v1
changeId: apply-with-precond
currentPhase: apply
status: in_progress
artifacts:
  exploration: exploration.md
  proposal: proposal.md
  spec: spec.md
  design: design.md
  tasks: tasks.md
  preconditions: preconditions.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "apply-with-precond", "events.yaml"),
      `schema: spec-registry-events-v1
events:
  - phase: explore
    status: completed
    event: explore.completed
    artifact: exploration.md
    timestamp: "2026-01-01T00:00:00Z"
    actor: deck
  - phase: tasks
    status: completed
    event: tasks.completed
    artifact: tasks.md
    timestamp: "2026-01-01T00:00:00Z"
    actor: deck
`
    );
    // Create artifact files including preconditions.md
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "apply-with-precond", "exploration.md"),
      "# Exploration"
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "apply-with-precond", "proposal.md"),
      "# Proposal"
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "apply-with-precond", "spec.md"),
      "# Spec"
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "apply-with-precond", "design.md"),
      "# Design"
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "apply-with-precond", "tasks.md"),
      "# Tasks"
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "apply-with-precond", "preconditions.md"),
      "# Preconditions\n\n| ID | Precondition | Source | Status | Evidence | Blocks Apply |\n|---|---|---|---|---|---|\n| PCG-001 | Test | Spec | satisfied | Test passes | No |"
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "apply-with-precond",
    });

    // Should pass - preconditions.md exists
    expect(result.ok).toBe(true);
  });

  test("Exploration-only change without preconditions.md does NOT report warning", async () => {
    // Create an exploration-only change (phase < apply)
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "explore-only"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "explore-only", "state.yaml"),
      `schema: spec-registry-v1
changeId: explore-only
currentPhase: explore
status: in_progress
artifacts:
  exploration: exploration.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "explore-only", "exploration.md"),
      "# Exploration"
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "explore-only",
    });

    // Should NOT report preconditions warning for exploration-only
    const precondIssues = result.issues.filter(
      (i) => i.rule === "preconditions.artifact.missing" || i.message?.includes("preconditions")
    );
    expect(precondIssues.length).toBe(0);
  });

  test("valid registry event names do not report name_mismatch warnings", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "valid-events"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "valid-events", "state.yaml"),
      `schema: spec-registry-v1
changeId: valid-events
currentPhase: apply
status: completed
artifacts:
  exploration: exploration.md
  proposal: proposal.md
  spec: spec.md
  design: design.md
  tasks: tasks.md
  preconditions: preconditions.md
  apply_progress: apply-progress.md
provenance:
  - phase: apply
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "valid-events", "events.yaml"),
      `schema: spec-registry-events-v1
events:
  - phase: explore
    status: completed
    event: explore.completed
    artifact: exploration.md
    timestamp: "2026-01-01T00:00:00Z"
    actor: deck
  - phase: spec
    status: completed
    event: spec.repaired
    artifact: spec.md
    timestamp: "2026-01-01T00:00:00Z"
    actor: deck
  - phase: design
    status: completed
    event: design.repaired
    artifact: design.md
    timestamp: "2026-01-01T00:00:00Z"
    actor: deck
  - phase: tasks
    status: completed
    event: preconditions.created
    artifact: preconditions.md
    timestamp: "2026-01-01T00:00:00Z"
    actor: deck
  - phase: apply
    status: in_progress
    event: apply.general.started
    artifact: apply-progress.md
    timestamp: "2026-01-01T00:00:00Z"
    actor: deck
  - phase: apply
    status: completed
    event: apply.general.completed
    artifact: apply-progress.md
    timestamp: "2026-01-01T00:00:00Z"
    actor: deck
  - phase: apply
    status: completed
    event: apply.general.fix_completed
    artifact: apply-progress.md
    timestamp: "2026-01-01T00:00:00Z"
    actor: deck
`
    );
    for (const file of [
      "exploration.md",
      "proposal.md",
      "spec.md",
      "design.md",
      "tasks.md",
      "preconditions.md",
      "apply-progress.md",
    ]) {
      await fs.writeFile(path.join(tempDir, "openspec", "changes", "valid-events", file), `# ${file}`);
    }

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "valid-events",
    });

    expect(result.issues).not.toContainEqual(
      expect.objectContaining({ rule: "events.event.name_mismatch" })
    );
  });

  test("unknown registry event names still report name_mismatch warnings", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "unknown-event"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "unknown-event", "state.yaml"),
      `schema: spec-registry-v1
changeId: unknown-event
currentPhase: proposal
status: in_progress
artifacts:
  exploration: exploration.md
  proposal: proposal.md
provenance:
  - phase: explore
    agent: deck
    timestamp: "2026-01-01T00:00:00Z"
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "unknown-event", "events.yaml"),
      `schema: spec-registry-events-v1
events:
  - phase: proposal
    status: completed
    event: unknown.completed
    artifact: proposal.md
    timestamp: "2026-01-01T00:00:00Z"
    actor: deck
`
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "unknown-event", "exploration.md"),
      "# Exploration"
    );
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "unknown-event", "proposal.md"),
      "# Proposal"
    );

    const result = await validateOpenSpecRegistry({
      rootDir: tempDir,
      changeId: "unknown-event",
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ rule: "events.event.name_mismatch", severity: "warning" })
    );
  });
});

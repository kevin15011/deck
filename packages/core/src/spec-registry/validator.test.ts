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